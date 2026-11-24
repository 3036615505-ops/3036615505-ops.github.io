/**
 * sw.js — 临渊羡鱼 Service Worker
 *
 * 策略（linyuan-v16 起）：
 *   1. `mode === 'navigate'` 的导航请求 + 章节列表 js/chapters.js → 网络优先
 *      （判据是 fetch 事件的 `e.request.mode`，不是文件后缀：用 fetch() 去拉一个
 *      `.html` 走的是第 2 条缓存优先，不是这条。）
 *      **网络请求一律 cache:'reload' 绕过 HTTP 缓存读取**（见 fetchFresh 的注释：
 *      Pages 给 HTML 的 max-age=600 会让「网络优先」退化成「HTTP 缓存优先」，
 *      这是「强制刷新后按返回又回到旧版」的根因）。网络秒回就用网络；
 *      **若该请求的精确 URL 已在缓存中命中**，则最多等
 *      NETWORK_TIMEOUT 就回落缓存（弱网不空等）。精确 URL 未命中时没有超时兜底，
 *      会一直等网络——所以「最多 500ms」是有前提的，不是无条件保证。
 *   2. 其余静态资源（CSS/JS/图片/字体）→ 缓存优先
 *      **命中就立刻返回缓存，热路径零网络请求**；只有当该缓存条目「太旧」时
 *      才在后台补一次刷新（按 date 头算年龄，文本 24h / 二进制 7d，见 CACHE_TTL）。
 *      这些引用都带版本号（如 css/style.css?v=NN），改版时版本号 +1 → URL 变 →
 *      旧条目自然没人再请求，所以正常情况下根本轮不到 TTL 生效；
 *      ⚠ 代价（2026-11-09 作者反馈「进阅读页好久才刷出来」时定位）：`?v=` 是
 *      **全站统一号**，任何一个 JS 改动都会让全部 CSS/JS 的 URL 失效。发版后
 *      第一次打开这些新 URL 全部 cache miss，只能走网络，而且**没有导航那条
 *      500ms 兜底**（那是 networkFirst 专属）。PRECACHE 里存的是裸路径，只作
 *      离线 ignoreSearch 兜底，救不了这次 miss。慢链路实测 133KB CSS 约 5s、
 *      楷体主片 323KB 约 14s，所以发版后头一两次打开明显慢；缓存填好后
 *      每次命中即零等待。若要根治得改成「按文件内容 hash 的单文件版本号」，
 *      属工具链级改动，本轮不做。
 *      TTL 只是「忘了 +1 版本号」时的自愈护栏，把「永久陈旧」收敛成有界陈旧
 *      （真实边界与两个前提见下面 cacheFirst 的注释，别只看这一行）。
 *      CSS 与 <head> 里的 JS 是渲染阻塞资源，走网络优先会为首屏多等最多
 *      NETWORK_TIMEOUT（500ms），所以它们必须走缓存优先。
 *   3. /app/ 前缀（安装包、version.json）不拦截，直接交给网络
 *   4. 页面主动声明 cache:'no-store'/'reload' 的非导航 fetch（如站点版本检查）
 *      → 放行给网络，SW 缓存不许糊弄（见 fetch 事件里的注释）
 *
 *
 * ── CACHE 什么时候必须升（判据，不随版本变）────────────────────────────
 *   预缓存条目的**字节**变了就得 +1：新增/删除条目，或 PRECACHE 里某个文件的内容
 *   改了 —— 最隐蔽的一种是「只改了 CSS/JS、一个 HTML 都没手改」，但 ?v= 跟着 +1，
 *   所有预缓存 HTML 里的引用都变了，字节同样变了。只改 sw.js 自己的逻辑、预缓存
 *   字节没变 → 不升，免得老读者把整份预缓存白重下一遍。
 *   这件事的机器判据：node tools/check-precache.mjs（条目存在 + 引用闭环）、
 *   npm run docs:check（文档里写的缓存名与这里一致）。「预缓存字节到底变没变」
 *   仍要在 npm run bump --write 之后看一眼 git diff 里有没有 PRECACHE 条目。
 *
 * ── 逐版变更记录 ───────────────────────────────────────────────────────
 *   v68 – v98 的记录在 docs/SW-HISTORY.md，不在这里（浏览器每次检查 SW 更新
 *   都要重新下载整个文件，变更史没必要跟着传）。新版本在那一头追加。
 *
 *   v99（2026-11-24 · 补漏 + 清死代码）：PRECACHE 补回沈若栖缩略图（v95 手写
 *   清单时漏的）；同批删除零引用的 transition.js 与切换动画样式段，?v= 升到 151。
 */
var CACHE = 'linyuan-v99';

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

/**
 * 预缓存清单 = 「壳」，不是「全站」。
 *
 * 2026-11-20 重构（作者批准，直接动因：三天发了 5 版，老读者每版都重下近 1 MB）：
 * 原来 81 项 / 969 KB，而 precacheBatch 对每一条都发真实网络请求（install 时
 * cache:'reload' 绕 HTTP 缓存），所以**每次 CACHE +1 都是全量重下**。现在按
 * 「离线还读不读得到东西」分成三层：
 *
 *   预缓存（下面这张表）  壳 + 马上要用的内容：首页 / 书架 / 同学录 /
 *                        18 张列表缩略图 / 11 章正文 / CSS / 全部 JS / 字体 /
 *                        封面 / 纸张 / 树的第一帧          ≈ 771 KB（未压缩）
 *   运行时按需（cacheFirst 自动写回，看过就有）
 *                        18 张 1024 立绘、树 s1–s5、18 个人物详细页
 *   完全不缓存            og-cover.jpg（只给社交抓取，站内从不显示）
 *
 * ⚠ 章节正文**刻意留在预缓存里**：断网可读是这个 App 的立身之本，而 11 章合计
 *   约 147 KB（未压缩，占预缓存不到两成）。真要再省，删掉这一段即可，代价是断网只能读
 *   看过的章（看过的会由 cacheFirst 写回）。
 * ⚠ 移出清单 ≠ 下线：cacheFirst 未命中会走网络并写回，第二次打开就有。
 * ⚠ 预缓存里只放「已在仓库、路径正确」的文件 —— 漏一条会让 install 少一项，
 *   tools/check-precache.mjs 会逐条核对存在性。
 */
var PRECACHE = [
  '/',
  '/favicon.png',
  '/manifest.json',
  /* 封面与纸面：书架、阅读页首屏就用 */
  '/assets/cover.webp',
  '/assets/cover-thumb.webp',
  '/assets/paper.webp',
  /* 梧桐只预缓存「未萌」这一帧；其余 5 帧由首页脚本按进度按需设置 src */
  '/assets/tree-bare.webp',
  '/assets/fonts/zcool-xiaowei-subset.woff2',
  '/css/style.css',
  '/js/reader.flags.js',
  '/js/reader.dom.js',
  '/js/reader.store.js',
  '/js/reader.engine.js',
  '/js/reader.ui.js',
  '/js/reader.js',
  '/js/chapters.js',
  '/js/theme.js',
  /* 原生壳能力补丁（v1.9.0 起从 APK 的 BRIDGE_SHIM_JS 下沉到站点）：
     <head> 里的渲染路径脚本，剪贴板 / 分享 / 导出全靠它，缺了等于功能消失。 */
  '/js/native-bridge.js',
  '/js/announce.js',
  /* 跳转即时反馈：首页/书架/章节页的 <head> 里 defer 引用，弱网必命中 */
  '/js/nav-feedback.js',
  '/js/lightbox.js',
  '/quotes.html',
  '/novel/',
  '/novel/chapter-01.html',
  '/novel/chapter-02.html',
  '/novel/chapter-03.html',
  '/novel/chapter-04.html',
  '/novel/chapter-05.html',
  '/novel/chapter-06.html',
  '/novel/chapter-07.html',
  '/novel/chapter-08.html',
  '/novel/chapter-09.html',
  '/novel/chapter-10.html',
  '/novel/chapter-11.html',
  '/novel/characters.html',
  /* 同学录列表页的 18 张缩略图（128×150，合计约 76 KB）：
     列表首屏就是它们的网格，缺一张就是一个空框。母版按需取。
     ⚠ 这段清单与人物是一一对应的：加了人物、跑完 make-characters.mjs 后，
     用 `node tools/check-precache.mjs` 的引用闭环检查确认一张不少。 */
  '/assets/portrait-linshu-thumb.webp',
  '/assets/portrait-nanheng-thumb.webp',
  '/assets/portrait-jiangbuqiu-thumb.webp',
  '/assets/portrait-liyan-thumb.webp',
  '/assets/portrait-ningzunjiu-thumb.webp',
  '/assets/portrait-yangmenghan-thumb.webp',
  '/assets/portrait-baiyuhuan-thumb.webp',
  '/assets/portrait-guchiyan-thumb.webp',
  '/assets/portrait-yeyuan-thumb.webp',
  '/assets/portrait-baiyu-thumb.webp',
  '/assets/portrait-linwangshu-thumb.webp',
  '/assets/portrait-taoyaoyao-thumb.webp',
  '/assets/portrait-xiaozhuo-thumb.webp',
  '/assets/portrait-sujiwen-thumb.webp',
  '/assets/portrait-jiangzhenmo-thumb.webp',
  '/assets/portrait-linxihe-thumb.webp',
  '/assets/portrait-yeyulan-thumb.webp',
  '/assets/portrait-shenruoqi-thumb.webp',
];

/**
 * 生成预缓存用的请求。
 *
 * HTML 条目（含 `/` 这类目录首页）必须带 cache:'reload'：c.add(url) 走默认
 * cache 模式会**先读浏览器 HTTP 缓存**，而线上 Pages 给 HTML 的 max-age 是
 * 600 秒 —— 强制刷新清完 Cache Storage 后重新 install 时，`c.add('/')` 会把
 * 「还在 max-age 内的旧 HTML」原样写进 SW 缓存，连 500ms 兜底 / 离线兜底
 * 一起被投毒（Bug「强制刷新后按返回又回到旧版」的帮凶之一）。
 * 用 reload 而不是 no-store：同样不读缓存，但会把新响应写回 HTTP 缓存，
 * 顺手把裸路径的缓存条目也治新（见 fetchFresh 的注释）。
 * 其余资源（CSS/JS/图片/字体）继续吃 HTTP 缓存省流量：它们的失效靠 ?v= 换 URL，
 * 且 PRECACHE 里存的是裸路径、只作离线 ignoreSearch 兜底，不是新鲜度来源。
 */
function precacheRequest(url) {
  var path = new URL(url, self.location.origin).pathname;
  var isHtml = path.charAt(path.length - 1) === '/' || /\.html?$/i.test(path);
  return isHtml ? new Request(url, { cache: 'reload' }) : url;
}

/**
 * 预缓存的「先来后到」。只用来排序，**不改 PRECACHE 的条目**
 * （tools/check-precache.mjs 仍按原数组逐条校验）。
 *
 * 原来 80 条一起 Promise.allSettled 打出去，慢网下 1024 立绘 / 封面图会把
 * CSS 与 JS 的队头占满：读者看到的是「页面好久才刷出来」，而带宽其实正被
 * 他这一屏根本用不上的图片吃着。现在按渲染关键路径分三层，每批只放 4 条。
 */
function precachePriority(url) {
  if (url === '/css/style.css' || url.indexOf('/js/') === 0) return 0; /* 渲染关键路径 */
  if (url === '/') return 1;                                            /* 离线首页兜底 */
  if (/\.html?$/.test(url) || url === '/novel/') return 2;                /* 正文 / 书架 */
  return 3;                                                             /* 图片 / manifest */
}

/** 每批并发上限：手机 WebView 上 4 条足够吃满链路，再多是互相抢 */
var PRECACHE_BATCH = 4;

/**
 * 逐条预缓存，失败的只 warn、不阻断 install。
 *
 * 改前是 cache.addAll(PRECACHE)（Cache 实例上的方法；`caches` 本身没有 addAll）：**全有全无** —— 任意一条 404（改名、删图、
 * 新增文件忘了提交）都会让整个 install reject，于是 SW 永远装不上新版本，
 * 用户被钉在旧缓存上，而且表现为「明明发了版却没变化」，很难查。
 * 之后改成 Promise.allSettled 全量齐发，现在再加两件事：
 *   ① 分批 + 命中即跳过 —— SW 自更新（CACHE 名没变）时几乎零下载，
 *      不再为了「改了 sw.js 一行」把 80 条重下一遍；
 *   ② 关键路径排前面 —— 换 CACHE 名后首屏先拿到 CSS/JS，图片慢慢补。
 *
 * 代价（必须知道）：预缓存的「齐全」不再由 install 失败来保证，
 * 所以新增资源时必须自己确认路径存在 —— tools/check-precache.mjs 就是干这个的。
 */
function precacheBatch(cache, urls, from) {
  if (from >= urls.length) return Promise.resolve();
  var batch = urls.slice(from, from + PRECACHE_BATCH);
  return Promise.all(batch.map(function(url) {
    /* 「命中即跳过」的前提是项目约定：PRECACHE 里的字节变了就必须 +1 CACHE 名。
       所以同名 CACHE 下条目存在 ⇔ 内容没变；万一条目真陈旧，cacheFirst 的
       TTL 自愈（文本 24h / 二进制 7d）仍会在后台把它治新。 */
    return cache.match(precacheRequest(url)).catch(function() { return null; }).then(function(hit) {
      if (hit) return;                       /* 同名 CACHE 已有条目 → 不重下 */
      return cache.add(precacheRequest(url)).catch(function(err) {
        console.warn('[sw] 预缓存失败，跳过（运行时会走网络兜底）:', url, err && err.message);
      });
    });
  })).then(function() { return precacheBatch(cache, urls, from + PRECACHE_BATCH); });
}

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(c) {
      var ordered = PRECACHE.slice().sort(function(a, b) {
        return precachePriority(a) - precachePriority(b);
      });
      return precacheBatch(c, ordered, 0);
    }).then(function() { return self.skipWaiting(); })
  );
});

/**
 * 换 CACHE 名时，把旧缓存里的「楷体两片」搬进新缓存。
 *
 * 为什么只搬这两片、不无差别搬所有二进制：/favicon.png 之类 URL 不带内容键，
 * 换图标靠的**正是** CACHE +1 强制重下；无差别搬会让旧图标永久残留。
 * 楷体主片 / 兜底片在 CSS 里带 `?f=` 内容键（子集内容变了必然改 ?f=，
 * 见 css/style.css 的 @font-face），所以「URL 相同」⇔「内容相同」，搬运安全。
 *
 * 这两片合计约 919KB，不在 PRECACHE 里，是 cacheFirst 运行时写进来的。
 * 改前每次发版 CACHE +1 → activate 删旧缓存 → 读者第一次选楷体要重新下
 * 十几秒（慢链路实测主片 323KB / 14s）；这正是「选楷体反应慢」的直接原因，
 * 而且**每次发版都会复发**，不是某次过渡版独有。
 */
function migrateFonts(target, oldName) {
  return caches.open(oldName).then(function(old) {
    return old.keys().then(function(reqs) {
      var fonts = reqs.filter(function(r) {
        return r.url.indexOf('/assets/fonts/') >= 0 && r.url.indexOf('?f=') >= 0;
      });
      return Promise.all(fonts.map(function(r) {
        return target.match(r).then(function(hit) {
          if (hit) return;
          return old.match(r).then(function(res) {
            if (res) return target.put(r, res);
          });
        });
      }));
    });
  });
}

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      var olds = keys.filter(function(k) { return k !== CACHE; });
      if (!olds.length) return;
      return caches.open(CACHE).then(function(target) {
        return Promise.all(olds.map(function(k) {
          return migrateFonts(target, k)
            .catch(function(err) {
              console.warn('[sw] 字体缓存迁移失败（退化为重新下载）:', k, err && err.message);
            })
            .then(function() { return caches.delete(k); });
        }));
      });
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
 * 无视 HTTP 缓存、直接向服务器要一份新响应（网络优先路径专用）。
 *
 * 为什么必须绕过 HTTP 缓存（Bug「强制刷新后按返回又回到旧版」的根因）：
 * 改前这里写的是 fetch(request)，走默认 cache 模式，会**先读浏览器 HTTP 缓存** ——
 * 线上 Pages 给 HTML 的 max-age 是 600 秒，于是「网络优先」实际是「HTTP 缓存优先」：
 * 按返回键重新导航到 / 时，10 分钟内 HTTP 缓存里的旧 HTML 被当作「网络响应」秒回，
 * 整页连同它引用的旧 ?v= 脚本一起回到发版前。换 URL 的 ?r= 只能救它自己那条 URL，
 * 救不了裸 `/` 的缓存条目。
 *
 * 为什么是 cache:'reload' 而不是 'no-store'：两者都不读 HTTP 缓存，但 reload
 * 会把新响应**写回** HTTP 缓存 —— 每来一次受控导航，就把那条 URL 的 HTTP 缓存
 * 条目顺手治新。这样即便 SW 随后被 unregister（「强制刷新」按钮会清 SW），
 * 裸路径的 HTTP 缓存条目也已经是新版，窗口期里未受控的导航同样不会变旧。
 *
 * ⚠ 不能写成 fetch(request, { cache: 'reload' })：mode==='navigate' 的 Request
 *   带非空 init 会直接 TypeError（fetch 规范禁止），必须按 URL 重建请求。
 *   重建后 redirect 从导航请求的 'manual' 变成默认 'follow'：本站没有重定向；
 *   将来即便有，把最终内容写进缓存也比缓存一条 opaqueredirect 合理。
 *
 * 代价：导航吃不到 HTTP 缓存的「零 RTT 秒回」，每次都要摸一次网络（弱网由
 * NETWORK_TIMEOUT 兜底回 SW 缓存，离线走 catch 分支）。换来的是「返回 = 最新版」
 * 的确定性 —— 对 HTML 这个「全站版本号的载体」，正确性优先于省一次往返。
 */
function fetchFresh(url) {
  return fetch(url, { cache: 'reload' });
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

    fetchFresh(request.url).then(function(res) {
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

  // 页面明确声明「别拿缓存糊弄我」的请求（fetch 的 cache:'no-store'/'reload'）：
  // 直接放行给网络，SW 缓存连看都不看。否则站点版本检查（announce.js 拉当前页
  // HTML 比对 ?v=）会被下面的 cacheFirst 用旧缓存顶回来，永远发现不了新版 ——
  // Bug B 的检查必须自己先摸得到新内容才成立。
  // 导航请求除外：它们本来就要走 networkFirst（带离线兜底），reload 语义由
  // fetchFresh 里的 cache:'reload' 保证，不能在这里放行掉兜底。
  if (e.request.mode !== 'navigate' &&
      (e.request.cache === 'no-store' || e.request.cache === 'reload')) return;

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
