#!/usr/bin/env node
/**
 * tools/check-precache.mjs — 校验 sw.js 的 PRECACHE 每一条在仓库里真实存在
 *
 * 为什么需要它：sw.js 的 install 现在用 Promise.allSettled 逐条预缓存，
 * 单条 404 只 warn、不阻断安装（这样一条坏路径不会把所有人钉在旧缓存上）。
 * 代价是「预缓存齐全」不再由 install 失败来保证 —— 所以把这项检查搬到 CI/本地：
 *
 *   node tools/check-precache.mjs        # 逐条报告，有缺失则退出码 1
 *
 * 判定规则：
 *   - 以 / 开头的条目按仓库根解析；以 / 结尾的目录条目要求存在 <dir>/index.html
 *   - 同时报告每条的真实字节数（gzip 前的原始大小），便于估算 install 负担
 *   - 引用闭环：预缓存页面 / CSS 里引用到的每个资源，要么也在清单里，
 *     要么在 RUNTIME_ON_DEMAND 白名单里（见文件后半段；2026-11-24 加）。
 *     收尾还有一段「故意红」自测：把缩略图 / 脚本 / 样式 / 字体逐条从清单里
 *     拿掉，每一次都必须被检出，检不出即退出码 1
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SW = path.join(ROOT, 'sw.js');

if (!fs.existsSync(SW)) {
  console.error('找不到 sw.js');
  process.exit(1);
}

const src = fs.readFileSync(SW, 'utf8');

/* 只取 PRECACHE = [ ... ] 这一段，避免把 NETWORK_FIRST 之类的字符串也算进来 */
const m = src.match(/var\s+PRECACHE\s*=\s*\[([\s\S]*?)\];/);
if (!m) {
  console.error('sw.js 里没找到 PRECACHE 数组');
  process.exit(1);
}
const body = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const entries = [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]);

const cacheVer = (src.match(/var\s+CACHE\s*=\s*'([^']+)'/) || [])[1] || '(未知)';

console.log(`PRECACHE 共 ${entries.length} 条，CACHE = ${cacheVer}\n`);

let missing = 0;
let totalBytes = 0;
const rows = [];

for (const url of entries) {
  let target = path.join(ROOT, url);
  let note = '';
  if (url.endsWith('/')) {
    target = path.join(target, 'index.html');
    note = '(目录 → index.html)';
  }
  const exists = fs.existsSync(target) && fs.statSync(target).isFile();
  const size = exists ? fs.statSync(target).size : 0;
  if (!exists) missing += 1;
  totalBytes += size;
  rows.push({ url, exists, size, note });
}

const w = Math.max(...rows.map((r) => r.url.length), 8);
for (const r of rows) {
  const kb = r.exists ? (r.size / 1024).toFixed(1).padStart(8) + ' KB' : '    MISS';
  console.log(`  ${r.exists ? '✓' : '✗'}  ${r.url.padEnd(w)}  ${kb}  ${r.note}`);
}

console.log(`\n合计 ${(totalBytes / 1024).toFixed(1)} KB（未压缩）`);

/* 顺带检查：新增脚本是否被所有需要的页面引用（例如 js/native-bridge.js） */

/**
 * 递归收集仓库内所有 .html（相对仓库根的 POSIX 路径）。
 *
 * <p>为什么动态收集而不是写死页面清单：清单一旦写死，加了新章节 / 新人物页就
 * 悄悄漏检。之前 bump-assets.mjs 与这里各维护一份清单就漂移过（6 个章节页、
 * 17 个人物页、quotes、书架页，一共 27 个，写死必漏）。
 *
 * @param {string} dir 起始目录（绝对路径）。
 * @param {string[]} out 累积结果。
 * @returns {string[]} 相对路径列表。
 */
function walkHtml(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkHtml(p, out);
    else if (/\.html?$/i.test(name)) out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
  }
  return out;
}

const ALL_PAGES = walkHtml(ROOT).sort();
const CHAPTER_PAGES = ALL_PAGES.filter((p) => /^novel\/chapter-\d+\.html$/.test(p));

const needed = [
  /* native-bridge.js 必须出现在**每一个**页面里。
     它是壳内剪贴板 / 原生分享 / 导出落地的唯一入口（v1.9.0 起补丁从 APK 的
     BRIDGE_SHIM_JS 下沉到站点），漏掉任何一页，那一页在壳里这三个功能就静默失效，
     而且页面本身不会报错 —— 正是最容易漏检的一类漂移。 */
  ['/js/native-bridge.js', ALL_PAGES],
  /* announce.js 同样必须在每一个页面里：它是「新章节更新了」横幅的唯一载体，
     漏一页那类页面就永远看不到更新提示，且没有任何报错。 */
  ['/js/announce.js', ALL_PAGES],
  /* apple-touch-icon 同理：27 个页面一个都不能少（少了 iOS 加主屏就拿整页
     截图当图标），而生成模板（new-chapter.js / make-characters.mjs 的 headBlock）
     是「下次一生成就丢」的高危路径，这里用全页面清单兜住。 */
  ['/assets/apple-touch-icon.png', ALL_PAGES],
  /* 章节页相关的引用按「全部章节页」比对，不写死 01/02：
     写死的清单只守得住前两章，第 03 章起的页面漏了引用也一直是绿的。 */
  ['/js/reader.js', CHAPTER_PAGES],
  ['/js/chapters.js', ['index.html', 'novel/index.html', ...CHAPTER_PAGES]],
  ['/js/lightbox.js', ['novel/characters.html']]
];
console.log('\n脚本引用自检：');
let refMissing = 0;
for (const [asset, pages] of needed) {
  const name = path.basename(asset);
  /* 必须按引用属性精确匹配，不能用 indexOf 子串 —— announce.js 是 announce.json
     的子串（announce. + json 的前两字母），页面注释里一提「announce.json」就会让
     检查假阳性（删了真引用也报绿）。2026-10-25 实测踩过，故用正则锁 src/href。
     script 与 link 都要认：js 走 <script src>，图标走 <link href>。 */
  const refRe = new RegExp('<(?:script[^>]+src|link[^>]+href)="[^"]*' + name.replace(/[.]/g, '[.]') + '(\\?[^"]*)?"');
  const absent = pages.filter((p) => {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    return !refRe.test(html);
  });
  if (absent.length) {
    refMissing += 1;
    console.log(`  ✗ ${name} 未被引用: ${absent.join(', ')}`);
  } else {
    console.log(`  ✓ ${name} 在 ${pages.length} 个页面都有引用`);
  }
}

if (missing || refMissing) {
  console.error(`\n✗ 有 ${missing} 条预缓存缺失${refMissing ? `、${refMissing} 处引用缺失` : ''}，请修掉再发`);
  process.exit(1);
}
/* ===== 章节模板完整性 =====
   tools/chapter-template.cjs 里的模板是「章节页长什么样」的唯一来源
   （new-chapter.js 加新章、tools/render-chapter.mjs 重渲染已有章都调它；
   模板以前住在 new-chapter.js 里，抽出来共用的那天这里跟着改路径）。
   模块拆分那次它漏了一半脚本，生成出来的新章没有交互、也不报错。这类漂移
   必须在 CI 拦住，而不是等下次加章节才发现。
   判据取自**现有章节页实际引用的脚本**（而不是 js/ 目录里有什么 —— 那里还有
   只属于人物页的 lightbox.js / theme.js）。这样以后给章节页加模块，这条检查
   会自动跟上。 */
const TEMPLATE = path.join(ROOT, 'tools', 'chapter-template.cjs');
const NOVEL_DIR = path.join(ROOT, 'novel');
if (fs.existsSync(TEMPLATE) && fs.existsSync(NOVEL_DIR)) {
  const pages = fs.readdirSync(NOVEL_DIR).filter((f) => /^chapter-\d+\.html$/.test(f)).sort();
  const sample = pages[0];
  if (sample) {
    const html = fs.readFileSync(path.join(NOVEL_DIR, sample), 'utf8');
    /* 字符类必须含 `-`：js/native-bridge.js 这类带连字符的文件名原先匹配不到，
       等于「模板比对」对最新下沉的桥接补丁完全没有约束力（删掉模板里那行也全绿）。
       `-` 放在字符类最后，免得被当成区间（a-z 与 `-` 相邻会解析错误或语义漂移）。 */
    const required = [...new Set(html.match(/js\/[a-z.-]+?\.js/g) || [])];
    const tpl = fs.readFileSync(TEMPLATE, 'utf8');
    const missing = required.filter((src) => tpl.indexOf(src) === -1);
    if (missing.length) {
      console.error('✗ tools/chapter-template.cjs 的章节模板缺少脚本引用（对照 ' + sample + '）：');
      missing.forEach((src) => console.error('   - ' + src));
      console.error('   生成的新章节会缺模块（很可能表现为页面无交互）。请补模板后重跑。');
      process.exit(1);
    }
    console.log('  ✓ 章节模板与 ' + sample + ' 一致（' + required.length + ' 个脚本）');
  }

  /* 除了脚本，还有一批「少一个就等于功能消失」的 UI 挂点。
     第三章就是这么中招的：工具栏漏了「自动」按钮，自动滚屏整个功能没了，
     页面不报任何错，脚本引用检查也全绿。所以这里按清单逐页比对，
     并且把模板也一起比对 —— 模板落后才是根因，章节页只是受害者。 */
  const HOOKS = [
    ['toggleAutoScroll', '工具栏「自动」按钮（自动滚屏唯一入口）'],
    ['openSearch', '工具栏「搜索」按钮（阅读器内全章搜索唯一入口）'],
    ['autoScrollLabel', '自动滚屏状态文字'],
    ['chapter-seal', '章末印章'],
    ['style.css?v=', '样式表版本号（不带 ?v= 的 URL 会永久吃旧 CSS 缓存）'],
    ['favicon.png', '站点图标（favicon.svg 这个文件并不存在）'],
    ['apple-touch-icon', 'iOS 加主屏图标（漏了 = 苹果用户拿整页截图当图标，且 regenerated 页面会悄悄丢）']
  ];
  let hookBad = 0;
  const tplSrc = fs.readFileSync(TEMPLATE, 'utf8');
  const tplMissing = HOOKS.filter(([k]) => tplSrc.indexOf(k) === -1);
  if (tplMissing.length) {
    hookBad += 1;
    console.error('✗ tools/chapter-template.cjs 的章节模板缺少 UI 挂点：');
    tplMissing.forEach(([k, why]) => console.error('   - ' + k + ' —— ' + why));
  }
  for (const page of pages) {
    const src = fs.readFileSync(path.join(NOVEL_DIR, page), 'utf8');
    const lack = HOOKS.filter(([k]) => src.indexOf(k) === -1);
    if (lack.length) {
      hookBad += 1;
      console.error(`  ✗ ${page} 缺少：` + lack.map(([k]) => k).join(', '));
      lack.forEach(([, why]) => console.error('       → ' + why));
    }
  }
  if (hookBad) {
    console.error('\n✗ 章节页 / 模板缺 UI 挂点，补齐再发（否则那个功能在页面上直接不存在）');
    process.exit(1);
  }
  console.log(`  ✓ ${pages.length} 个章节页 + 模板 都带齐 ${HOOKS.length} 个关键 UI 挂点`);
}

/* ===== 引用闭环：被预缓存的页面引用到的资源，离线时也必须拿得到 =====
 *
 * 为什么需要它（2026-11-24 发现）：上面的检查只回答「清单里的路径在不在」，
 * 不回答「清单全不全」。v95 重排 PRECACHE 时是手写的清单，漏掉了
 * /assets/portrait-shenruoqi-thumb.webp —— 文件在仓库里、novel/characters.html
 * 也引用着它，所以上面每一项都是绿的；只有断网冷启动打开同学录，才看得到
 * 沈若栖那张卡是空框，而且不报任何错。
 *
 * 判定：对 PRECACHE 里的每个 HTML，解析其中的 <script src> / <link href> /
 * <img src>；对每个 CSS，解析 url()。每个引用（去掉查询串）必须满足其一：
 *   ① 自己也在 PRECACHE 里；
 *   ② 在下面的 RUNTIME_ON_DEMAND 里，并且每一条都写明了为什么可以不预缓存。
 * 白名单刻意用精确路径或很窄的正则，不用目录前缀一把放行 —— 那样它会长成
 * 第二个「什么都能塞」的清单，等于把这道关重新关掉。
 *
 * 知情的边界（这里不解析）：内联脚本与 CSS 变量里的 url()、<a href>、
 * data-src / srcset / data-lightbox-src。<a href> 是导航，走网络优先 + 离线
 * 兜底，本来就不该进预缓存；其余几类目前都有各自的按需机制。真出现漏项
 * 再收进来，不提前做。
 */
const FAKE_ORIGIN = 'https://precache.invalid';

/* 「路径」的统一口径：目录条目落到它的 index.html，查询串不参与比较
   （PRECACHE 里存的是裸路径，页面里的引用带 ?v= / ?f=）。 */
function pagePathOf(url) {
  return url.endsWith('/') ? url + 'index.html' : url;
}

const RUNTIME_ON_DEMAND = [
  { match: /^\/assets\/portrait-[a-z0-9-]+-1024\.webp$/, why: '立绘母版：详情页 / 灯箱按需取，列表页用的是 -thumb' },
  { match: /^\/assets\/tree-s[1-5]\.webp$/, why: '梧桐后五帧：首页脚本按阅读进度只取当前那 1–2 张' },
  { match: /^\/assets\/fonts\/linyuan-kai-(subset|rest)\.woff2$/, why: '楷体两片（约 900KB）：选了楷体才懒加载，带 ?f= 内容键' },
  { match: '/assets/apple-touch-icon.png', why: '只在 iOS「添加到主屏幕」时由系统取一次，页面运行时从不请求' }
];

function isOnDemand(path) {
  const hit = RUNTIME_ON_DEMAND.find((r) => (r.match instanceof RegExp ? r.match.test(path) : r.match === path));
  return hit ? hit.why : '';
}

/** 把页面里的一个引用解析成站内路径；跨域 / data: / 自定义协议返回 null */
function resolveRef(ref, basePath) {
  let u;
  try {
    u = new URL(ref, FAKE_ORIGIN + basePath);
  } catch {
    return null;
  }
  if (u.origin !== FAKE_ORIGIN) return null;
  return pagePathOf(u.pathname);
}

/** HTML 里的 script src / link href / img src（先剥注释，注释里保留的旧标签不算引用） */
function refsOfHtml(html) {
  const out = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const m of clean.matchAll(/<(script|link|img)\b([^>]*)>/gi)) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const rel = (attrs.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (tag === 'link' && /\b(canonical|alternate)\b/i.test(rel)) continue;
    const a = attrs.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i);
    if (a && a[1]) out.push(a[1]);
  }
  return out;
}

/** CSS 里的 url()（先剥注释） */
function refsOfCss(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1].trim());
}

/** 在给定清单下，找出「被预缓存页面引用、却离线拿不到」的资源 */
function findUncached(entrySet) {
  const misses = [];
  for (const entry of entrySet) {
    const pagePath = pagePathOf(entry);
    const isHtml = /\.html?$/i.test(pagePath);
    const isCss = /\.css$/i.test(pagePath);
    if (!isHtml && !isCss) continue;
    const file = path.join(ROOT, pagePath);
    if (!fs.existsSync(file)) continue; /* 路径不存在由上面那项检查负责报 */
    const src = fs.readFileSync(file, 'utf8');
    const refs = isHtml ? refsOfHtml(src) : refsOfCss(src);
    for (const ref of refs) {
      const target = resolveRef(ref, pagePath);
      if (!target) continue;
      if (entrySet.has(target) || isOnDemand(target)) continue;
      misses.push({ from: entry, ref, target });
    }
  }
  return misses;
}

const precacheSet = new Set(entries.map(pagePathOf));
const uncached = findUncached(precacheSet);

console.log('\n引用闭环自检（被预缓存页面引用到的资源，离线时也要拿得到）：');
/* 同一个资源往往被十几个页面引用，按资源聚合再报，不然一条漏项刷十五遍 */
const byTarget = new Map();
for (const m of uncached) {
  if (!byTarget.has(m.target)) byTarget.set(m.target, []);
  byTarget.get(m.target).push(m.from);
}
if (byTarget.size) {
  for (const [target, from] of byTarget) {
    const shown = from.length > 3 ? from.slice(0, 3).join('、') + ` 等 ${from.length} 个` : from.join('、');
    console.error(`  ✗ ${target}`);
    console.error(`       被预缓存条目 ${shown} 引用，但它既不在 PRECACHE，也不在 RUNTIME_ON_DEMAND 白名单里`);
  }
  console.error('\n   修法二选一：把它加进 sw.js 的 PRECACHE（并把 CACHE 名 +1），');
  console.error('             或在 tools/check-precache.mjs 的 RUNTIME_ON_DEMAND 里登记并写明理由。');
  process.exit(1);
}
console.log(`  ✓ ${precacheSet.size} 条预缓存条目的引用全部闭环`);

/* 「故意红」自测：一个永远报绿的守卫比没有守卫更糟。
   把缩略图、JS、CSS、预缓存字体逐条从清单里拿掉，每一次都必须被上面这段
   检出 —— 检不出，说明解析器根本没从真实页面里读到引用（沈若栖那张缩略图
   就是在「守卫全绿」的情况下漏掉的）。 */
const MUST_COVER = [
  { match: /^\/assets\/portrait-[a-z0-9-]+-thumb\.webp$/, why: '同学录缩略图' },
  { match: /^\/js\//, why: '脚本' },
  { match: /^\/css\//, why: '样式表' },
  { match: /\.woff2$/, why: '预缓存字体' }
];
const mustCover = entries.filter((e) => MUST_COVER.some((g) => g.match.test(e)));
const blind = mustCover.filter((e) => {
  const reduced = new Set(precacheSet);
  reduced.delete(pagePathOf(e));
  return !findUncached(reduced).some((m) => m.target === pagePathOf(e));
});
if (blind.length) {
  console.error(`\n✗ 闭环检查是「瞎」的：下面 ${blind.length} 条从清单里拿掉也检不出来`);
  blind.forEach((e) => console.error('   - ' + e));
  process.exit(1);
}
console.log(`  ✓ 故意红自测：${mustCover.length} 条缩略图 / 脚本 / 样式 / 字体逐条拿掉，全部能被检出`);

console.log('\n✓ 预缓存条目全部存在，脚本引用齐全，引用闭环成立');
