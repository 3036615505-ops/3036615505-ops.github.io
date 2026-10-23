/**
 * sw.js — 临渊羡鱼 Service Worker
 *
 * 策略（linyuan-v16 起）：
 *   1. `mode === 'navigate'` 的导航请求 + 章节列表 js/chapters.js → 网络优先
 *      （判据是 fetch 事件的 `e.request.mode`，不是文件后缀：用 fetch() 去拉一个
 *      `.html` 走的是第 2 条缓存优先，不是这条。）
 *      网络秒回就用网络；**若该请求的精确 URL 已在缓存中命中**，则最多等
 *      NETWORK_TIMEOUT 就回落缓存（弱网不空等）。精确 URL 未命中时没有超时兜底，
 *      会一直等网络——所以「最多 500ms」是有前提的，不是无条件保证。
 *   2. 其余静态资源（CSS/JS/图片/字体）→ 缓存优先
 *      **命中就立刻返回缓存，热路径零网络请求**；只有当该缓存条目「太旧」时
 *      才在后台补一次刷新（按 date 头算年龄，文本 24h / 二进制 7d，见 CACHE_TTL）。
 *      这些引用都带版本号（如 css/style.css?v=NN），改版时版本号 +1 → URL 变 →
 *      旧条目自然没人再请求，所以正常情况下根本轮不到 TTL 生效；
 *      TTL 只是「忘了 +1 版本号」时的自愈护栏，把「永久陈旧」收敛成有界陈旧
 *      （真实边界与两个前提见下面 cacheFirst 的注释，别只看这一行）。
 *      CSS 与 <head> 里的 JS 是渲染阻塞资源，走网络优先会为首屏多等最多
 *      NETWORK_TIMEOUT（500ms），所以它们必须走缓存优先。
 *   3. /app/ 前缀（安装包、version.json）不拦截，直接交给网络
 */
var CACHE = 'linyuan-v33';

/**
 * 缓存条目的「自愈 TTL」：超过这个年龄的缓存命中，会在后台补一次刷新。
 * 分两档是因为变更频率差得很远：
 *   - 文本（具体后缀见下面的 TEXT_EXTENSIONS：html/htm/css/js/mjs/json/svg/txt/xml）
 *     24 小时。
 *   - 二进制（图片 / 字体，即 TEXT_EXTENSIONS 之外的一切）：7 天，勤刷只是浪费流量。
 *
 * ⚠ 需要「立刻生效」的修复（改的是行为而不是只改样式）时，除了 +1 ?v=，
 *   还要把 CACHE 名一起 +1：activate 会删掉旧缓存，连带着把「旧 ?v= 键」清空，
 *   这样即使 HTML 本身还是旧的（请求 ?v=旧值），也会走网络拿到新内容。
 *   只改 ?v= 不升 CACHE 时，弱网/HTTP 缓存命中旧 HTML 会让旧 JS 一直留在缓存里。
 * 注意：TTL 只管「后台刷新」，**不影响本次响应** —— 命中永远先用缓存秒回。
 * 改后缀名单时只改 TEXT_EXTENSIONS，别在这里再列一遍（一次漏改就漂移）。
 */
var CACHE_TTL = {
  text: 24 * 60 * 60 * 1000,
  binary: 7 * 24 * 60 * 60 * 1000
};
var TEXT_EXTENSIONS = ['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml'];

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
  /* 人物立绘 1024 母版（3 张共 490KB，用户 2026-10 定稿版：徽章统一为圆形
     金色校徽、右下角水印以底部裁切物理消除，故高矮为 898/954/898 非方形）。
     灯箱全屏与 3x 捏合的清晰度全靠它。512 旧版（portrait-{key}.webp）已删除。
     ⚠ v18→v19 必须升 CACHE 名：文件名与 7e3dc92 那次误部署的旧图相同，
     不换名 activate 不会删旧缓存，用户会一直吃到 v18 里的错图。 */
  '/assets/portrait-linshu-1024.webp',
  '/assets/portrait-nanheng-1024.webp',
  '/assets/portrait-jiangbuqiu-1024.webp',
  /* 梧桐阶段图（6 张共 153.4KB）：首页进度带的核心意象。
     装上后切页零网络、断网也长得出树。 */
  '/assets/tree-bare.webp',
  '/assets/tree-s1.webp',
  '/assets/tree-s2.webp',
  '/assets/tree-s3.webp',
  '/assets/tree-s4.webp',
  '/assets/tree-s5.webp',
  '/assets/fonts/zcool-xiaowei-subset.woff2',
  '/css/style.css',
  '/js/transition.js',
  '/js/reader.flags.js',
  '/js/reader.dom.js',
  '/js/reader.store.js',
  '/js/reader.engine.js',
  '/js/reader.ui.js',
  '/js/reader.js',
  '/js/chapters.js',
  '/js/theme.js',
  '/js/lightbox.js',
  '/quotes.html',
  '/novel/',
  '/novel/chapter-01.html',
  '/novel/chapter-02.html',
  '/novel/chapter-03.html',
  '/novel/characters.html'
];

/**
 * 逐条预缓存，失败的只 warn、不阻断 install。
 *
 * 改前是 cache.addAll(PRECACHE)（Cache 实例上的方法；`caches` 本身没有 addAll）：**全有全无** —— 任意一条 404（改名、删图、
 * 新增文件忘了提交）都会让整个 install reject，于是 SW 永远装不上新版本，
 * 用户被钉在旧缓存上，而且表现为「明明发了版却没变化」，很难查。
 * 现在改用 Promise.allSettled：n-1 条成功也照常激活，坏的那条记日志，
 * 运行时该资源走一次网络后由 cacheFirst 写回缓存。
 *
 * 代价（必须知道）：预缓存的「齐全」不再由 install 失败来保证，
 * 所以新增资源时必须自己确认路径存在 —— tools/check-precache.mjs 就是干这个的。
 */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      return Promise.allSettled(PRECACHE.map(function(url) {
        return c.add(url).catch(function(err) {
          console.warn('[sw] 预缓存失败，跳过（运行时会走网络兜底）:', url, err && err.message);
        });
      }));
    }).then(function() { return self.skipWaiting(); })
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

/** 按扩展名判定该资源的自愈 TTL（文本 24h / 二进制 7d） */
function ttlFor(url) {
  var pathname = new URL(url).pathname.toLowerCase();
  for (var i = 0; i < TEXT_EXTENSIONS.length; i++) {
    var ext = TEXT_EXTENSIONS[i];
    if (pathname.slice(-ext.length) === ext) return CACHE_TTL.text;
  }
  return CACHE_TTL.binary;
}

/**
 * 缓存条目是否「太旧」。
 * 判据是缓存副本自带的 date 头（GitHub Pages 与本地静态服务器都会带，
 * 且 cache.put 会把它一起存进缓存），不是「我们什么时候存进去的」——
 * 这样连预缓存（install 时抓的那批）也能正确算年龄。
 *
 * date 头缺失或解析不出来时**一律当作未过期**：
 * 宁可继续用缓存，也不要因为拿不到 date 就退化成「每次命中都发请求」，
 * 那样会把这一轮优化掉的流量又全加回来。
 */
function isStale(cached, request) {
  var date = cached.headers.get('date');
  if (!date) return false;
  var timestamp = Date.parse(date);
  if (!timestamp) return false;
  return (Date.now() - timestamp) > ttlFor(request.url);
}

/** 后台补一次刷新：成功就写回缓存；失败静默（不影响本次响应，下次命中再试） */
function refreshInBackground(request) {
  fetch(request).then(function(res) {
    putCache(request, res);
  }).catch(function() { /* 离线/弱网：保持旧缓存，下次命中再试 */ });
}

/**
 * 缓存优先 + TTL 自愈。
 *
 * 历史两版对照：
 *   v15 之前：无条件 stale-while-revalidate —— 命中缓存也照样 fetch 一次刷新，
 *             理由是「样式改完第一次打开就生效」。实测在 HTTP 缓存被驱逐时，
 *             单次导航服务器仍收到 267,783B（字体 201KB + CSS 16KB + 图片…）。
 *   v15：命中即返回、不发请求，流量降到 10.7KB。
 *        但引入了新风险：若内容变了而 ?v= 与 CACHE 名都没变，
 *        缓存永远命中 → 新规则**永不生效**（reload、清 HTTP 缓存都救不回来）。
 *   v16（现在）：
 *     命中 → 立刻返回缓存（热路径仍是 0 额外请求、0 额外字节）
 *     命中且条目年龄 > TTL → 顺手发一次后台刷新（不阻塞本次响应）
 *     未命中 → 请求网络 → 写缓存 → 返回；失败才用 ignoreSearch 的预缓存兜底
 *     于是「忘了 +1 版本号」不再是永久陈旧。版本号仍是第一道防线
 *     （tools/bump-assets.mjs + pre-push hook），TTL 只是兜底。
 *
 * ⚠ 「忘了 +1 版本号」时的**真实陈旧上界**不是「一个 TTL」，而是：
 *
 *       TTL  +  HTTP 缓存 max-age  +  1 次页面加载
 *
 *   ① +1 次页面加载：触发刷新的那一次导航仍然返回旧内容（我们不等刷新结果，
 *      否则热路径就退化成网络优先了）；新内容要到**下一次**加载才可见。
 *   ② +HTTP 缓存 max-age：refreshInBackground 里的 fetch(request) 本身也要过
 *      浏览器 HTTP 缓存。线上 GitHub Pages 发 Cache-Control: max-age=600，
 *      所以最多再叠 10 分钟才真摸到源站。
 *   按文本 24h 算，实测口径下最坏约 24h + 10min + 一次加载的等待。
 *
 * ⚠ 还有一个 TTL **收敛不了**的边界（必须知道，否则会误以为 TTL 失灵）：
 *
 *   若该 URL 之后**永远不再返回 200**（文件被删/改名，但 HTML 或 PRECACHE 里
 *   还引用着它），putCache 只接受 status===200 && type==='basic'，刷新结果写不进
 *   缓存 → 这个条目会**永久陈旧**，而且**每次命中都会白发一次刷新请求**
 *   （等于多出一份永久流量，还会在控制台留下 404）。
 *
 *   也就是说 TTL 自愈的隐含前提是：**该 URL 最终还能返回新内容**。
 *   「删文件/改名」这类变更必须靠 ?v= 换 URL 或 +1 CACHE 名来解决，
 *   而不是指望 TTL —— 这也是为什么 pre-push hook 必查 PRECACHE 条目是否存在。
 */
function cacheFirst(request) {
  return caches.match(request).then(function(cached) {
    if (cached) {
      if (isStale(cached, request)) refreshInBackground(request);
      return cached;
    }

    return fetch(request).then(function(res) {
      putCache(request, res);
      return res;
    }).catch(function() {
      // 网络失败：PRECACHE 里存的是不带 ?v= 的裸路径，按忽略查询串再找一次
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

  // 远程功能开关：必须每次取最新，否则「关掉一个功能」要等缓存过期才生效
  if (url.pathname === '/flags.json') return;

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

  // ③ CSS / JS / 图片 / 字体 → 缓存优先（命中即返回，超龄才后台自愈刷新）
  e.respondWith(cacheFirst(e.request));
});
