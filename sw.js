/**
 * sw.js — 临渊羡鱼 Service Worker
 *
 * 策略（linyuan-v13 起）：
 *   1. 页面导航（任何 HTML）+ 章节列表 js/chapters.js → 网络优先
 *      网络秒回就用网络；**若该请求的精确 URL 已在缓存中命中**，则最多等
 *      NETWORK_TIMEOUT 就回落缓存（弱网不空等）。精确 URL 未命中时没有超时兜底，
 *      会一直等网络——所以「最多 500ms」是有前提的，不是无条件保证。
 *   2. 其余静态资源（CSS/JS/图片/字体）→ 缓存优先 + 后台静默刷新
 *      CSS/JS 的引用都带版本号（如 css/style.css?v=20）：改版时把版本号 +1，
 *      URL 变化 → 旧缓存自然失效 → 缓存优先不会让旧样式滞留。
 *      反过来，CSS 与 <head> 里的 JS 都是渲染阻塞资源，走网络优先会让首屏
 *      多等最多 NETWORK_TIMEOUT（500ms），表现为「进页面先白屏/卡一下」，
 *      所以它们必须走缓存优先。
 *   3. /app/ 前缀（安装包、version.json）不拦截，直接交给网络
 */
var CACHE = 'linyuan-v14';

/**
 * 仍然需要「网络优先 + 500ms 超时兜底」的资源：
 * - /js/chapters.js：章节列表数据源，加新章节后要立刻出现，
 *   不能等版本号 +1 才生效（它的请求量极小，且不进首屏渲染关键路径的样式）
 * 页面导航虽然不在这里，也在 fetch 分支里走同一条网络优先路径。
 * 注意：CSS、其余 JS 曾经也在这个列表里（为了「改样式第一次打开就生效」），
 * 现在改由 ?v= 版本号保证新鲜度，因此已改为缓存优先。
 */
var NETWORK_FIRST = ['/js/chapters.js'];
/**
 * 网络优先的等待上限（毫秒）。生效前提：该请求的**精确 URL 在缓存中命中**。
 * - 命中 → 超时就用缓存，不让人干等；
 * - 未命中（全新安装、或版本号刚 +1 后的首次请求）→ 定时器里 caches.match 落空，
 *   不会 resolve，也没有兜底，会一直等网络返回（实测 1.5s 也不返回）。
 *   没有缓存可退时，等网络本来就是正确行为，所以这里不做强行超时。
 */
var NETWORK_TIMEOUT = 500;

var PRECACHE = [
  '/',
  '/favicon.png',
  '/manifest.json',
  '/assets/og-cover.jpg',
  '/assets/cover.webp',
  '/assets/cover-thumb.webp',
  '/assets/paper.webp',
  '/assets/portrait-linshu.webp',
  '/assets/portrait-nanheng.webp',
  '/assets/portrait-jiangbuqiu.webp',
  /* 梧桐阶段图（6 张共 153.4KB）：首页进度带的核心意象。
     原先一张都不在预缓存里，每次切回首页都要现场取 tree-*.webp；
     装上后切页零网络、断网也长得出树。任一 404 会让 install 整体失败，
     所以这 6 条已逐条核对过文件存在。 */
  '/assets/tree-bare.webp',
  '/assets/tree-s1.webp',
  '/assets/tree-s2.webp',
  '/assets/tree-s3.webp',
  '/assets/tree-s4.webp',
  '/assets/tree-s5.webp',
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

/** 写缓存：只缓存同源、HTTP 200 的完整响应 */
function putCache(request, response) {
  if (response && response.status === 200 && response.type === 'basic') {
    var copy = response.clone();
    caches.open(CACHE).then(function(c) { c.put(request, copy); });
  }
  return response;
}

/**
 * 网络优先，带「条件性」超时兜底：
 * - 网络在 NETWORK_TIMEOUT 内返回 → 用新的（并写入缓存）
 * - 超时**且该精确 URL 在缓存中命中** → 立刻用缓存（网络回包仍然写缓存，供下次用）；
 *   精确 URL 未命中时没有超时兜底，会一直等网络（无缓存可退，见 NETWORK_TIMEOUT）
 * - 完全没网 → 先用精确缓存，再退到「忽略查询串」的预缓存，最后落回首页
 *   注意：超时兜底只认精确 URL（宁可等新的，也不拿旧版本冒充新内容）；
 *   只有网络确实失败（断网）时才用 ignoreSearch 的预缓存顶上。
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
      Promise.all([
        caches.match(request),
        // PRECACHE 里存的是不带 ?v= 的裸路径，断网时用它兜底（离线书架不空白）
        caches.match(request, { ignoreSearch: true })
      ]).then(function(found) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(found[0] || found[1] || caches.match('/'));
      });
    });
  });
}

/**
 * 缓存优先（stale-while-revalidate）：
 * - 命中缓存 → 立刻返回缓存（首屏零等待），同时后台静默拉新写回缓存
 * - 未命中 → 等网络；网络也失败时，退一步按「忽略查询串」再找一次
 *   （PRECACHE 里存的是不带 ?v= 的裸路径，这样断网首屏也能拿到样式/脚本）
 */
function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    // 无论命中与否，都发一次网络请求用于刷新缓存；失败不影响本次响应
    var revalidate = fetch(request).then(function(res) {
      putCache(request, res);
      return res;
    }).catch(function() { return null; });

    if (cached) return cached;

    return revalidate.then(function(res) {
      if (res) return res;
      return caches.match(request, { ignoreSearch: true });
    });
  });
}

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // 安装包与版本描述：绕过 SW 缓存，避免自更新拿到旧文件
  if (url.pathname.indexOf('/app/') === 0) return;

  // ① 页面导航（HTML）→ 网络优先 + 500ms 兜底：新页面立刻可见，弱网不空等
  if (e.request.mode === 'navigate') {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // ② 章节列表 chapters.js → 同上（新章节立刻出现）
  var needsFresh = NETWORK_FIRST.some(function(prefix) {
    return url.pathname.indexOf(prefix) === 0;
  });
  if (needsFresh) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // ③ CSS / JS / 图片 / 字体 → 缓存优先 + 后台刷新（渲染阻塞资源不再等网络）
  e.respondWith(cacheFirst(e.request));
});
