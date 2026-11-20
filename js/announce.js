/* js/announce.js — 站内更新提示（新章节横幅 + 新版本提示）
   设计说明、历史与踩坑记录见 _design/notes/announce.js.md（原文按行号归档）。 */
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

(function () {
  'use strict';

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
    var now = Date.now();
    if (now - lastCheckAt < CHECK_INTERVAL_MS) return;
    lastCheckAt = now;
    checkSiteUpdate(autoReload);
  }

  /* 回到前台：读者可能正读到一半 —— 只提示，绝不自动重载打断位置 */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    maybeCheck(false);
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg && reg.update) reg.update().catch(function () { /* 离线忽略 */ });
      }).catch(function () { /* 忽略 */ });
    }
  });

  window.addEventListener('pageshow', function (e) {
    if (e.persisted) maybeCheck(true);
  });

  /* 测试与手动触发入口：force 跳过节流 */
  window.LYUpdate = {
    check: function (autoReload) { return checkSiteUpdate(!!autoReload); },
    localVersion: localAssetVersion
  };
})();
