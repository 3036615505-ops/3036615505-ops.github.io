/*
 * js/announce.js — 站内更新提示（新章节横幅 + 新版本提示）
 *
 * ── 一、新章节横幅（本文件原有职责）────────────────────────────────
 * 做什么：打开任意页面时，取一次 announce.json（由 tools/make-announce.mjs 生成，
 * 不缓存），和 localStorage 里记的「已看到第几章」比。若远端章号更新，就在底部
 * 弹一条横幅：「第 N 章《…》更新了 · 去读 →」。点「去读」跳转到那一章，点 ✕
 * 关闭；两者都会把「已看到第 N 章」写进 localStorage，同一章节只提醒一次。
 *
 * 设计约束（都是刻意选择）：
 *   - 零权限、零后台：不申请通知权限、不常驻轮询。读者打开页面才检查，关掉页面就不干活。
 *     要「人没来也能推到手机上」得靠外部推送服务，那不是这个文件的事。
 *   - 每会话只查一次：sessionStorage 守卫，防止在站内跳页时每页都发一次请求。
 *   - 失败全静默：离线 / JSON 坏 / 字段缺失 → 什么都不做，绝不在阅读过程中弹错。
 *   - 正在读的就是最新章 → 静默标记已读，不弹（否则读者会看到「第 7 章更新了」而自己正在第 7 章）。
 *   - 浏览器里同样生效：无 window.LinyuanApp 时逻辑完全不变（本文件不依赖原生桥）。
 *
 * 数据契约（announce.json）：
 *   { "chapter": 7, "title": "第七章·梧桐叶落", "url": "/novel/chapter-07.html", "date": "十一月十二" }
 *
 * ── 二、新版本提示（Bug B：长期不关 App 时页面一直是老版本）────────
 * 做什么：页面回到前台（visibilitychange）或从 bfcache 恢复（pageshow.persisted）
 * 时，拉一份当前页面的 HTML（cache:'no-store'），比对其中的资源版本号 ?v=N 和
 * 正在运行的这份 DOM 里的 ?v=N。远端更新 → 提醒读者。
 *
 * 为什么比对 ?v= 而不是 SW 版本：本站的发版单位是「?v= 全站 +1」（tools/
 * bump-assets.mjs），sw.js 的字节大多数发版根本不动 —— 调 registration.update()
 * 永远发现不了「只改了 CSS/JS」的发版。?v= 才是真正的「发版代数」。
 * （registration.update() 仍然会调：sw.js 字节变了的发版（如 CACHE 升名）
 *   能顺手换掉 SW 与缓存，是免费的补充，不是主判据。）
 *
 * 为什么不自动刷新（正在阅读的页面）：读者可能正停在半章位置，强制重载会打断。
 * 只出一条轻提示，点一下才 location.reload()。而 bfcache 恢复的那一瞬间读者
 * 「刚刚回到页面」、还没开始读，且恢复出来的 DOM 本来就是发版前的旧实例 ——
 * 这种情况直接换新（reload），满足「返回首页时应当是新版」。
 *
 * 为什么放在 announce.js：这个检查要在**所有**页面跑（首页/书架/人物簿/章节页），
 * 全站共有的 <script> 只有 native-bridge.js 与 announce.js 两个；bridge 是原生壳
 * 补丁不该掺业务。theme.js 到不了章节页，transition.js 到不了人物簿/摘句页。
 * 提示条也直接复用「新章节横幅」的 .notice-bar 样式（reader.toast 1.6s 自动消失
 * 且 pointer-events:none，点不中，不符合「读者点提示才刷新」）。
 *
 * 绝不触碰 localStorage：阅读进度/摘句/足迹是读者数据（reader-*），
 * 本文件只读 sessionStorage（新章节的每会话守卫）与 localStorage 的
 * reader-notice-seen（原有行为），版本提示连状态都不落盘。
 */
(function () {
  'use strict';

  var SEEN_KEY = 'reader-notice-seen';
  var SESSION_KEY = 'ly-announce-checked';

  /* 页面分布在 / 与 /novel/ 两层，announce.json 在根目录；先按路径猜，猜错再试另一种 */
  function announceUrls() {
    var near = location.pathname.indexOf('/novel/') === 0 ? '../announce.json' : 'announce.json';
    var far = near.charAt(0) === '.' ? 'announce.json' : './announce.json';
    return [near, far];
  }

  function readSeen() {
    var v = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10);
    return isNaN(v) ? 0 : v;
  }

  function markSeen(chapter) {
    try { localStorage.setItem(SEEN_KEY, String(chapter)); } catch (e) { /* 隐私模式忽略 */ }
  }

  /* 当前就在最新章页面上 → 静默标记，不打扰 */
  function isOnThatPage(url) {
    if (!url) return false;
    var here = location.pathname.replace(/\/$/, '');
    var there = String(url).replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
    return here === there || here.indexOf(there.replace(/\.html$/, '')) === 0 && there.length > 1;
  }

  function show(data) {
    var chapter = parseInt(data.chapter, 10);
    if (!chapter || chapter <= readSeen()) return;
    if (isOnThatPage(data.url)) { markSeen(chapter); return; }

    var old = document.getElementById('lyNotice');
    if (old) old.remove();

    var bar = document.createElement('div');
    bar.className = 'notice-bar';
    bar.id = 'lyNotice';
    bar.setAttribute('role', 'status');

    var leaf = document.createElement('span');
    leaf.className = 'notice-leaf';
    leaf.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2C7 8 4 13 12 22c8-9 5-14 0-20z"/></svg>';

    var text = document.createElement('span');
    text.className = 'notice-text';
    text.textContent = '第 ' + chapter + ' 章' + (data.title ? '《' + data.title + '》' : '') + '更新了';

    var go = document.createElement('a');
    go.className = 'notice-go';
    go.href = data.url || '/novel/';
    go.textContent = '去读';
    go.addEventListener('click', function () { markSeen(chapter); });

    var close = document.createElement('button');
    close.className = 'notice-close';
    close.type = 'button';
    close.setAttribute('aria-label', '关闭更新提示');
    close.textContent = '✕';
    close.addEventListener('click', function () {
      markSeen(chapter);
      bar.remove();
    });

    bar.appendChild(leaf);
    bar.appendChild(text);
    bar.appendChild(go);
    bar.appendChild(close);

    /* 「有新版本」条同为 fixed 底部条，撞上了把它叠到自己上方 */
    var updateBar = document.getElementById('lyUpdateNotice');
    if (updateBar) {
      updateBar.style.bottom = 'calc(64px + env(safe-area-inset-bottom, 0px) + 72px)';
    }
    document.body.appendChild(bar);

    /* 进场动画：下一帧再挂 class，保证 transition 生效 */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { bar.classList.add('is-in'); });
    });
  }

  function check() {
    var urls = announceUrls();
    var i = 0;
    (function next() {
      if (i >= urls.length) return;
      var url = urls[i++];
      fetch(url, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)); })
        .then(function (data) { show(data); })
        .catch(function () { next(); });   /* 404 / 离线 / 坏 JSON：换种路径再试，再失败就静默放弃 */
    })();
  }

  /* 每会话只查一次；DOM 就绪后立刻挂（不等 load，横幅尽早出现） */
  if (!sessionStorage.getItem(SESSION_KEY)) {
    sessionStorage.setItem(SESSION_KEY, '1');
    var start = function () { setTimeout(check, 400); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
})();

/* ==========================================================================
 * 站点版本检查（Bug B：长期不关 App 时页面一直是老版本）
 * 见文件头「二、新版本提示」的设计说明。独立 IIFE，与新章节横幅互不干扰。
 * ========================================================================== */
(function () {
  'use strict';

  /* 检查节流：回到前台是很频繁的动作（收个消息就一次），10 分钟一次足够
     覆盖「长期不关 App」的场景，又不会把读者的流量偷偷烧在拉 HTML 上。
     （不落盘、不轮询：只在这两个事件触发时才可能发请求。） */
  var CHECK_INTERVAL_MS = 10 * 60 * 1000;
  var lastCheckAt = 0;
  var hintShown = false;

  /** 从一段 HTML 文本里取所有 ?v=N 的最大值（没有则 0） */
  function maxAssetVersion(text) {
    var max = 0;
    var re = /\?v=(\d+)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var n = parseInt(m[1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
    return max;
  }

  /** 正在运行的这份 DOM 的资源版本号：读 script[src] 与 link[rel=stylesheet] */
  function localAssetVersion() {
    var nodes = document.querySelectorAll('script[src], link[rel="stylesheet"]');
    var max = 0;
    for (var i = 0; i < nodes.length; i++) {
      var href = nodes[i].getAttribute('src') || nodes[i].getAttribute('href') || '';
      var n = maxAssetVersion(href);
      if (n > max) max = n;
    }
    return max;
  }

  /**
   * 弹出「有新版本」提示条。整条可点（点哪儿都刷新），✕ 关掉。
   * 样式整套复用新章节横幅 .notice-bar，不新增 CSS。
   */
  function showUpdateBar() {
    if (hintShown || document.getElementById('lyUpdateNotice')) return;
    if (!document.body) return;   /* 理论上只会发生在 DOM 就绪前的极小窗口，静默跳过 */
    hintShown = true;

    var bar = document.createElement('div');
    bar.className = 'notice-bar';
    bar.id = 'lyUpdateNotice';
    bar.setAttribute('role', 'status');
    /* 整条就是「点此刷新」的点击目标 —— 比让读者去戳一颗小按钮更符合文案承诺 */
    bar.style.cursor = 'pointer';
    bar.addEventListener('click', function () {
      try { location.reload(); } catch (e) { /* 忽略 */ }
    });

    var leaf = document.createElement('span');
    leaf.className = 'notice-leaf';
    leaf.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M12 2C7 8 4 13 12 22c8-9 5-14 0-20z"/></svg>';

    var text = document.createElement('span');
    text.className = 'notice-text';
    text.textContent = '有新版本 · 点此刷新';

    var go = document.createElement('button');
    go.className = 'notice-go';
    go.type = 'button';
    go.textContent = '刷新';

    var close = document.createElement('button');
    close.className = 'notice-close';
    close.type = 'button';
    close.setAttribute('aria-label', '关闭新版本提示');
    close.textContent = '✕';
    close.addEventListener('click', function (e) {
      e.stopPropagation();   /* 整条可点，✕ 必须拦住冒泡，否则关掉=刷新 */
      bar.remove();
    });

    bar.appendChild(leaf);
    bar.appendChild(text);
    bar.appendChild(go);
    bar.appendChild(close);

    /* 与「新章节横幅」同为 fixed 底部条，撞上了就叠在它上方 */
    if (document.getElementById('lyNotice')) {
      bar.style.bottom = 'calc(64px + env(safe-area-inset-bottom, 0px) + 72px)';
    }
    document.body.appendChild(bar);

    /* 进场动画：下一帧再挂 class，保证 transition 生效 */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { bar.classList.add('is-in'); });
    });
  }

  /**
   * 拉当前页面的 HTML，比对 ?v= 发版代数。
   * @param {boolean} autoReload true = 发现新版直接 location.reload()（bfcache 恢复路径）；
   *                             false = 只出轻提示，读者点了才刷新（回到前台路径）。
   * @return {Promise<boolean>} 是否发现新版（测试用）
   */
  function checkSiteUpdate(autoReload) {
    var local = localAssetVersion();
    if (!local) return Promise.resolve(false);   /* 页面上没有版本号，无从比起 */
    return fetch(location.pathname, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('http ' + r.status)); })
      .then(function (html) {
        var remote = maxAssetVersion(html);
        if (!remote || remote === local) return false;
        if (autoReload) {
          try { location.reload(); } catch (e) { /* 忽略 */ }
          return true;
        }
        showUpdateBar();
        return true;
      })
      .catch(function () { return false; });   /* 离线/弱网：静默，下次再试 */
  }

  function maybeCheck(autoReload) {
    /* autoReload（bfcache 恢复）同样受节流：恢复路径上的这次 fetch 相当于
       「本来要重新下载的那份 HTML」，节流只是把它再省一省，最坏 10 分钟后
       下一个事件补上 —— 和 Pages 的 max-age=600 同量级，可接受。 */
    var now = Date.now();
    if (now - lastCheckAt < CHECK_INTERVAL_MS) return;
    lastCheckAt = now;
    checkSiteUpdate(autoReload);
  }

  /* 回到前台：读者可能正读到一半 —— 只提示，绝不自动重载打断位置 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    maybeCheck(false);
    /* 顺手推一把 SW 自更新：sw.js 字节变了的发版（如 CACHE 升名）能换掉
       缓存；sw.js 没变的发版它什么也不做，新鲜度由上面的 ?v= 比对负责。
       失败静默（离线时 update() 会 reject，不能冒泡成未捕获异常）。 */
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.update) reg.update().catch(function () { /* 离线忽略 */ });
      }).catch(function () { /* 忽略 */ });
    }
  });

  /* 从 bfcache 恢复（典型：按系统返回键回到上一页）：恢复出来的 DOM 是发版前
     的旧实例，此刻读者刚回到页面、还没开始读 —— 发现新版直接换新，
     保证「返回时是新版」（Bug A 的 bfcache 侧）。 */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) maybeCheck(true);
  });

  /* 测试与手动触发入口：force 跳过节流 */
  window.LYUpdate = {
    check: function (autoReload) { return checkSiteUpdate(!!autoReload); },
    localVersion: localAssetVersion
  };
})();
