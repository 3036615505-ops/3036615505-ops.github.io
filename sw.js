/**
 * sw.js — 临渊羡鱼 Service Worker
 *
 * 策略：
 *   1. 页面导航 + 章节列表 js/chapters.js → 网络优先，500ms 内没回来就用缓存
 *      （新章节打开即见；弱网也不空等）
 *   2. 其余静态资源（CSS/JS/图片/字体）→ 缓存优先 + 后台刷新
 *      （切换极快、离线可读；改动会在下一次打开时生效）
 */
var CACHE = 'linyuan-v12';

/**
 * 必须保证新鲜的资源（网络优先 + 500ms 超时兜底）：
 * - 页面导航（任何 HTML）
 * - 章节列表 chapters.js（新章节要立刻出现）
 * - 全部 CSS 与 JS（改版/修样式必须第一次打开就生效，
 *   否则会反复出现「推了没反应、要开两次」的问题）
 */
var NETWORK_FIRST = ['/js/chapters.js', '/css/', '/js/'];
/** 网络优先的等待上限（毫秒）：超过就直接用缓存，不让人干等 */
var NETWORK_TIMEOUT = 500;

var PRECACHE = [
  '/',
  '/favicon.png',
  '/manifest.json',
  '/assets/og-cover.jpg',
  '/assets/cover.webp',
  '/assets/paper.webp',
  '/assets/portrait-linshu.webp',
  '/assets/portrait-nanheng.webp',
  '/assets/portrait-jiangbuqiu.webp',
  '/assets/fonts/zcool-xiaowei-subset.woff2',
  '/css/style.css',
  '/js/reader.js',
  '/js/chapters.js',
  '/js/theme.js',
  '/quotes.html',
  '/novel/',
  '/novel/chapter-01.html',
  '/novel/chapter-02.html',
  '/novel/characters.html'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) { return c.addAll(PRECACHE); })
      .then(function() { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; })
        .map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

function putCache(request, response) {
  if (response && response.status === 200 && response.type === 'basic') {
    var copy = response.clone();
    caches.open(CACHE).then(function(c) { c.put(request, copy); });
  }
  return response;
}

/**
 * 网络优先，带超时兜底：
 * - 网络在 NETWORK_TIMEOUT 内返回 → 用新的（并写入缓存）
 * - 超时且有缓存 → 立刻用缓存（网络回包仍然写缓存，供下次用）
 * - 没网也没缓存 → 落回首页
 */
function networkFirst(request) {
  return new Promise(function(resolve) {
    var settled = false;
    var timer = setTimeout(function() {
      if (settled) return;
      caches.match(request).then(function(cached) {
        if (settled || !cached) return;
        settled = true;
        resolve(cached);
      });
    }, NETWORK_TIMEOUT);

    fetch(request).then(function(res) {
      putCache(request, res);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(res);
    }).catch(function() {
      caches.match(request).then(function(cached) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(cached || caches.match('/'));
      });
    });
  });
}

/** 缓存优先：命中直接返回，同时后台拉新写回缓存 */
function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    var network = fetch(request).then(function(res) {
      putCache(request, res);
      return res;
    }).catch(function() { return cached; });
    return cached || network;
  });
}

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // 安装包与版本描述：绕过 SW 缓存，避免自更新拿到旧文件
  if (url.pathname.indexOf('/app/') === 0) return;

  var isNetworkFirst = e.request.mode === 'navigate'
      || NETWORK_FIRST.some(function(prefix) { return url.pathname.indexOf(prefix) === 0; });
  if (isNetworkFirst) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  e.respondWith(cacheFirst(e.request));
});
