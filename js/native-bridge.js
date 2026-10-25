/**
 * js/native-bridge.js — Android 壳（site.zephyrw.linyuan）能力补丁
 *
 * 为什么存在这个文件：
 *   WebView 不是 Chrome。TWA 时代由 Chrome 代劳的三件事，在自建 WebView 容器里
 *   全部缺失，站点侧的调用看起来成功、实际什么都没发生：
 *
 *   1. `navigator.clipboard.writeText` 长期返回 NotAllowedError
 *      → 「复制摘句 / 分享章节 / 摘句簿复制」静默失败；
 *   2. WebView 没有 DownloadListener 时会静默丢弃 `blob:` + `<a download>`
 *      → 「导出 Markdown」看起来成功、实际什么都没存；
 *   3. WebView 不实现 Web Share API（`navigator.share` 恒为 undefined）
 *      → 「分享章节」永远走不到系统分享面板。
 *
 * 这段逻辑原本写在壳的 Java 字符串 BRIDGE_SHIM_JS 里，靠
 * `WebViewClient.onPageFinished → evaluateJavascript` 注入。那样做的问题是：
 * 每改一行 JS 都要重新打 APK，且注入时机依赖 onPageFinished（页面脚本早已执行，
 * 首帧就调 clipboard 的路径仍然吃亏）。v1.9.0 起下沉到站点，逻辑等价迁移，
 * 只是改成随页面自身加载、在任何业务脚本之前执行。
 *
 * 运行环境约定：
 *   - 只在壳内生效（`window.LinyuanApp` 由 `addJavascriptInterface` 暴露）；
 *   - 浏览器里 `window.LinyuanApp` 是 undefined，下面第一个 return 直接退出，
 *     不定义任何全局变量、不改写任何行为，对普通浏览器零影响。
 *
 * 维护约定：
 *   - 本文件只在 `?v=` 版本号变化时才会被重新下载（SW 缓存优先），改完必须
 *     `node tools/bump-assets.mjs --write`；
 *   - 不要在这里写业务逻辑或样式，它只负责把浏览器 API 接到原生能力上。
 */
(function () {
  var bridge = window.LinyuanApp;
  if (!bridge || typeof bridge.copy !== 'function') { return; }  // 浏览器里什么都不做

  /* ---------- 1. 剪贴板 ---------- */

  /* 先抓住真实实现：万一某些 WebView 版本上 writeText 是可用的（例如用户开了
     某些实验开关），原生失败时还能退回它，而不是直接判死。 */
  var realWrite = null;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      realWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
    }
  } catch (e) { realWrite = null; }

  function nativeCopy(text) {
    try { return bridge.copy(String(text)) === true; } catch (e) { return false; }
  }

  var shim = {
    writeText: function (text) {
      var value = String(text == null ? '' : text);
      /* 空串不写：既避免原生侧 Toast「已复制」误导，也避免触发空剪贴板 */
      if (value.length === 0) { return Promise.resolve(); }
      if (nativeCopy(value)) { return Promise.resolve(); }
      if (realWrite) { try { return realWrite(value); } catch (e) {} }
      return Promise.reject(new Error('clipboard unavailable'));
    },
    readText: function () { return Promise.reject(new Error('clipboard read unsupported')); }
  };

  /* 优先整体替换 navigator.clipboard（这样 writeText / readText 行为一致）；
     某些 WebView 上该属性不可重定义，退化为只覆写 writeText。 */
  var installed = false;
  try {
    Object.defineProperty(navigator, 'clipboard',
      { value: shim, configurable: true, writable: true });
    installed = navigator.clipboard === shim;
  } catch (e) { installed = false; }
  if (!installed) {
    try {
      if (navigator.clipboard) { navigator.clipboard.writeText = shim.writeText; }
    } catch (e) {}
  }

  /* ---------- 2. 原生分享 ---------- */

  /* WebView 没有 Web Share API，所以这里主动补一个 navigator.share：
     站点里任何 `if (navigator.share) { navigator.share({...}) }` 的写法都能直接用，
     不需要每处调用点都知道桥的存在。壳侧桥方法签名是 share(text, url)。
     老版本壳（v1.8.7 及以前）没有 bridge.share，此时保持「不定义 navigator.share」，
     站点会自然退回「复制链接」分支。 */
  try {
    if (typeof bridge.share === 'function') {
      var nativeShare = function (data) {
        var text = data && data.text != null ? String(data.text) : '';
        var url = data && data.url != null ? String(data.url) : '';
        /* 只给了 title 的调用方（少见）：拿 title 当正文，别发一条空消息 */
        if (!text && data && data.title != null) { text = String(data.title); }
        try {
          bridge.share(text, url);
          return Promise.resolve();
        } catch (error) {
          return Promise.reject(error);
        }
      };
      var shareInstalled = false;
      try {
        Object.defineProperty(navigator, 'share',
          { value: nativeShare, configurable: true, writable: true });
        shareInstalled = navigator.share === nativeShare;
      } catch (e) { shareInstalled = false; }
      if (!shareInstalled) {
        try { navigator.share = nativeShare; } catch (e) {}
      }
    }
  } catch (e) {}

  /* ---------- 3. blob 下载转交原生保存 ---------- */

  /* 只在捕获阶段拦「blob: 地址 + <a download>」的点击：
       别的下载（http/https 附件）交给壳的 DownloadListener → 系统浏览器，
       不在这里掺和。读出 blob 文本后交给 bridge.saveText(文件名, 正文)，
       由壳决定落到公共「下载」目录还是应用专属目录。 */
  if (!document.__linyuanDownloadHooked) {
    document.__linyuanDownloadHooked = true;
    document.addEventListener('click', function (event) {
      var node = event.target;
      var anchor = node && node.closest ? node.closest('a[download]') : null;
      if (!anchor) { return; }
      var href = anchor.href || '';
      if (href.indexOf('blob:') !== 0) { return; }
      if (typeof bridge.saveText !== 'function') { return; }
      event.preventDefault();
      var name = anchor.getAttribute('download') || '';
      fetch(href).then(function (response) { return response.text(); })
        .then(function (text) { bridge.saveText(name, text); })
        .catch(function () {});
    }, true);
  }
})();
