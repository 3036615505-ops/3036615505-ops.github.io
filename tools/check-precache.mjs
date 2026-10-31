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

/* 顺带检查：transition.js 这类新增脚本是否被所有需要的页面引用 */

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
  ['/js/transition.js', ['index.html', 'novel/index.html', 'novel/chapter-01.html', 'novel/chapter-02.html']],
  ['/js/reader.js', ['novel/chapter-01.html', 'novel/chapter-02.html']],
  ['/js/chapters.js', ['index.html', 'novel/index.html', 'novel/chapter-01.html', 'novel/chapter-02.html']],
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

console.log('\n✓ 预缓存条目全部存在，脚本引用齐全');
