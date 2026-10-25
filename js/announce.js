/*
 * js/announce.js — 站内「新章节更新了」横幅
 *
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
