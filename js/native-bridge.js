/* js/native-bridge.js — Android 壳（site.zephyrw.linyuan）能力补丁
   设计说明、历史与踩坑记录见 _design/notes/native-bridge.js.md（原文按行号归档）。 */
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
      function saveFailed() {
        try {
          if (window.LY && window.LY.ui && typeof window.LY.ui.toast === 'function') {
            window.LY.ui.toast('没能存到手机，请改用「复制」自己保存');
            return;
          }
        } catch (e) {}
        if (window.console) console.warn('[bridge] saveText failed', name);
      }
      fetch(href).then(function (response) { return response.text(); })
        .then(function (text) {
          var ok = false;
          try { bridge.saveText(name, text); ok = true; } catch (e) {}
          if (!ok) saveFailed();
        })
        .catch(saveFailed);
    }, true);
  }
})();
