/**
 * sw.js — 临渊羡鱼 Service Worker
 * 策略：页面导航网络优先（保证更新可见）；静态资源缓存优先 + 后台更新（离线可读）
 */
var CACHE = 'linyuan-v2';

var PRECACHE = [
  '/',
  '/favicon.svg',
  '/manifest.json',
  '/assets/og-cover.jpg',
  '/assets/cover.jpg',
  '/assets/tree.jpg',
  '/assets/paper.jpg',
  '/assets/portrait-linshu.jpg',
  '/assets/portrait-nanheng.jpg',
  '/assets/portrait-jiangbuqiu.jpg',
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

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，离线回退缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(function() {
        return caches.match(e.request).then(function(r) {
          return r || caches.match('/');
        });
      })
    );
    return;
  }

  // 静态资源：缓存优先，命中后后台刷新
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var network = fetch(e.request).then(function(res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function() { return cached; });
      return cached || network;
    })
  );
});
