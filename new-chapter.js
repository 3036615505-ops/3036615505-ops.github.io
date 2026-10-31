#!/usr/bin/env node
/**
 * new-chapter.js — 从 Markdown 生成新章节页
 *
 * 用法：
 *   node new-chapter.js <原稿.md> [--title "标题"] [--blurb "目录简介"] [--afterglow "章末尾语"] [--year 2022] [--term "高一上"] [--dates "九月一日,九月二十七"] [--volume "卷名"] [--dry-run]
 *
 * 做三件事：
 *   1. 生成 novel/chapter-NN.html（含 SEO/OG/JSON-LD/分享按钮）
 *   2. 在 js/chapters.js 的 CHAPTERS 数组追加条目（字数自动统计，口径与线上一致：CJK 汉字 + 中文标点，含标题）
 *   3. 把上一章的"下一章"从禁用状态改为指向新章节
 *
 * Markdown 约定：
 *   第一行 "# 标题"（或 --title 指定）；空行分段；单独一行 --- / *** 视为场景分隔
 *
 * --dry-run：只输出到 novel/_dryrun-chapter.html，不改 chapters.js、不动其他章节（用于验证模板）
 *
 * 模板在哪：**不在这个文件里**。整页 HTML 模板、md→正文渲染、`?v=` 探测、章节数组
 * 求值全部在 tools/chapter-template.cjs —— 因为 tools/render-chapter.mjs（重新渲染
 * 已有章节）也要用它们。两份模板必然「改一处漏一处」（本站为这类漂移付过两次代价），
 * 所以模板只有一份，本文件只是它的调用方。要改章节页长什么样，去改那个文件。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const tpl = require('./tools/chapter-template.cjs');

const readChapters = tpl.readChapters;
const detectAssetVersion = tpl.detectAssetVersion;
const parseManuscript = tpl.parseManuscript;
const applyDates = tpl.applyDates;
const renderArticleInner = tpl.renderArticleInner;
const renderChapterPage = tpl.renderChapterPage;
const sealTextFrom = tpl.sealTextFrom;

/** 序列化条目：固定字段在前，未知字段追加在后 —— 加字段不会再把老字段吃掉 */
const KEY_ORDER = ['num', 'title', 'file', 'words', 'blurb', 'year', 'date', 'dates', 'seal', 'leaf', 'volume'];

/** 年份统一存成数字：首页要拿它算学年/年级，存「二〇二二」这种字符串没法减。
    接受 2023 与「二〇二三」「二零二三」两种写法。 */
function toYearValue(v) {
  if (v === undefined || v === null || v === '') return '';
  var str = String(v).trim();
  if (/^\d{4}$/.test(str)) return parseInt(str, 10);
  var map = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  var digits = '';
  for (var i = 0; i < str.length; i++) {
    var d = map[str.charAt(i)];
    if (d === undefined) return '';
    digits += d;
  }
  return digits.length === 4 ? parseInt(digits, 10) : '';
}
function fmtEntry(entry) {
  const keys = KEY_ORDER.filter(function (k) { return entry[k] !== undefined && entry[k] !== ''; });
  Object.keys(entry).forEach(function (k) { if (KEY_ORDER.indexOf(k) === -1) keys.push(k); });
  return '  { ' + keys.map(function (k) {
    const v = entry[k];
    if (Array.isArray(v)) {
      return k + ': [' + v.map(function (x) {
        return "'" + String(x).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
      }).join(', ') + ']';
    }
    if (typeof v === 'number') return k + ': ' + v;
    return k + ": '" + String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  }).join(', ') + ' }';
}

const ROOT = path.join(__dirname);
const NOVEL_DIR = path.join(ROOT, 'novel');
const CHAPTERS_JS = path.join(ROOT, 'js', 'chapters.js');

// ===== 参数解析 =====
const args = process.argv.slice(2);
const opts = { dryRun: false };
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') opts.dryRun = true;
  /* --nodate：日期照旧写进 chapters.js（光阴册要靠它分组），但章节页不输出日期行。
     连续几章发生在同一天时用 —— 第二、三、四章都是九月十九，每章都顶一行日期，
     等于告诉读者"这天又过了一遍"。之前是生成完手工删那行，删第三次之前先记下：
     手工删出来的漂移，比缺一行日期难查得多。 */
  else if (args[i] === '--nodate') opts.nodate = true;
  else if (args[i].startsWith('--')) {
    opts[args[i].slice(2)] = args[++i];
  } else positional.push(args[i]);
}
const mdPath = positional[0];
if (!mdPath) {
  console.error('用法: node new-chapter.js <原稿.md> [--title T] [--blurb B] [--afterglow A] [--volume V] [--dry-run]');
  process.exit(1);
}

// ===== 读取 Markdown 并转正文 HTML =====
// 切块规则、「标题行不进正文」、「场景分隔怎么记」都在共用模块的 parseManuscript 里，
// 和 tools/render-chapter.mjs 走的是同一份实现。
const md = fs.readFileSync(mdPath, 'utf-8').replace(/\r\n/g, '\n');
let parsed;
try {
  parsed = parseManuscript(md, { title: opts.title });
} catch (err) {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
}
let title = parsed.title;
const tokens = parsed.tokens;
const words = parsed.words;

// ===== 读取现有章节，推算编号 =====
// 这里曾经用正则逐条匹配 CHAPTERS 的文本。后来条目多了 date/seal/leaf 三个字段，
// 正则整体失配 → entries 变成空数组 → 章号算成 1 → 直接覆盖 chapter-01。
// 所以改成真解析：把数组字面量放进 vm 求值，字段怎么加都不会再失配。
const chaptersSrc = fs.readFileSync(CHAPTERS_JS, 'utf-8');
const entries = readChapters(chaptersSrc);
const maxNum = entries.reduce((mx, e) => Math.max(mx, e.num), 0);
const num = maxNum + 1;
const file = 'chapter-' + String(num).padStart(2, '0') + '.html';
const prev = entries.length ? entries[entries.length - 1] : null;

// 保护（误用即拒）：这个脚本只**加**新章节，不是「重新生成已有章节」。
// 2026-10-31 实测过后果：把 manuscript/chapter-01.md 传进来，它按 CHAPTERS.length+1
// 长出了 chapter-08.html，还连带改了 js/chapters.js / announce.json / sitemap.xml /
// sw.js（脚本自己会 CACHE+1）和上一章的「下一章」，全部得手工 git restore 回滚。
// 判据：**源稿自己写的 `# 标题`（或 --title 给的标题）已经在 CHAPTERS 的 title 里**。
// 已有章节的标题都带「第N章·」，重名几乎必然就是「想重渲染已有章」；真要做同名新章，
// 换个标题即可（比静默毁掉一章好得多）。
// 两种都查：传了 --title 又拿旧 md 来「加新章」时，只有 heading 能暴露误用。
const clashTitles = [parsed.heading, title].filter(function (t) { return t; });
const clash = entries.filter(function (e) { return clashTitles.indexOf(e.title) >= 0; })[0];
if (clash) {
  const clashName = clash.file.replace(/\.html$/, '');
  console.error('✗ 《' + clash.title + '》已经在 CHAPTERS 里（第 ' + clash.num + ' 章：novel/' + clash.file + '）。');
  console.error('  这个脚本只加**新**章节，会按 CHAPTERS.length+1 = ' + num + ' 生成 chapter-' + String(num).padStart(2, '0') + '.html。');
  console.error('  给已有章节改稿请用：');
  console.error('    node tools/render-chapter.mjs ' + clashName);
  console.error('  已中止，未写入任何文件（chapter-' + String(num).padStart(2, '0') + '.html、chapters.js、announce.json、sitemap.xml、sw.js 一个都没动）。');
  process.exit(1);
}

// 保护：绝不允许覆盖已有章节页（宁可停下，也不要静默毁掉一章）
const targetPath = path.join(NOVEL_DIR, file);
if (fs.existsSync(targetPath)) {
  console.error('✗ 目标章节页已存在：novel/' + file);
  console.error('  通常意味着章号推算错了（chapters.js 解析失败，或文件被手动改名）。');
  console.error('  已中止，未写入任何文件。请先检查 js/chapters.js 的 CHAPTERS 数组。');
  process.exit(1);
}

// ===== 资源版本号 =====
// 模板里的 ?v= 曾经是手写的，改版后会过期 —— 更糟的是模块拆分后这里还停留在
// 「只引一个 reader.js」，生成出来的新章会是个没有交互的空壳。
// 所以每次都从现有页面里取当前版本（detectAssetVersion 在共用模块里）。
const ASSET_V = detectAssetVersion();

// 章节页的日期行：顶部写开头那天，章末写收束那天（一章写多天时两处都有）。
// 年份取 --year，缺省沿用上一章；没年份或没日期就不输出这一行。
const pageYear = toYearValue(opts.year) || (prev && prev.year) || '';
const pageDates = opts.dates
  ? String(opts.dates).split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean)
  : (opts.date ? [String(opts.date).trim()] : []);

// 章内日期落点：日期是跟着「时间变化」走的，所以第 2 个及以后的日子
// 要贴在场景切换（--- → <div class="scene-break">）后面、下一段之前，
// 而不是塞在章末 —— 挂在末尾等于说这一章写到那天为止，位置是错的。
//   --dates "九月一日,九月十七" + 正文一处 ---  →  顶上一个九月一日，切换点后一个九月十七
//   切换点不够用（日期比切换点多）→ 剩下的退回章末，宁可位置差也别丢日期
// 具体实现见共用模块的 applyDates（token 版，与 render-chapter.mjs 同一套）。
const datedTokens = applyDates(tokens, { year: pageYear, dates: pageDates, nodate: opts.nodate });
const dateLineTop = datedTokens.dateTop;
const contentTokens = datedTokens.tokens;

// ===== 章节页内容 =====
// 整页模板本身在 tools/chapter-template.cjs（唯一副本）。这里只准备模板变量。
const prevChFile = prev ? prev.file : '';
const afterglow = opts.afterglow || '翻过这一页，故事还在继续。（这一句写在 chapter-afterglow 里，换一句属于这一章的话吧）';

// 章末印章：两字，取 --seal，或直接取标题「第三章·课上」里 · 后面那半截。
const sealText = sealTextFrom(title, opts.seal);

// 整页模板来自共用模块（tools/chapter-template.cjs 里唯一的那一份）。
// 只替换 <article> 里的正文区时（tools/render-chapter.mjs）走的也是同一个
// renderArticleInner —— 段落怎么变 <p>、日期行缩进多少，全站一处定义。
const articleInner = renderArticleInner({ title: title, dateTop: dateLineTop, tokens: contentTokens });
const page = renderChapterPage({
  title: title,
  num: num,
  file: file,
  articleInner: articleInner,
  prevFile: prevChFile,
  afterglow: afterglow,
  sealText: sealText,
  assetVersion: ASSET_V
});

// ===== 输出 =====
if (opts.dryRun) {
  const out = path.join(NOVEL_DIR, '_dryrun-chapter.html');
  fs.writeFileSync(out, page);
  console.log('✅ [dry-run] 章节页已生成: ' + out);
  console.log('   标题: ' + title + ' | 编号: ' + num + ' | 字数: ' + words);
  console.log('   dry-run 未修改 chapters.js，未改动其他章节');
  process.exit(0);
}

// 1) 写章节页
const out = path.join(NOVEL_DIR, file);
fs.writeFileSync(out, page);

// 1.2) 自检：模板必须把当前所有阅读器模块都引上，关键 UI 挂点也一个不能少。
//      模块拆分那次就是这里漏了 —— 新章只有入口脚本，页面没有交互，而且不报错。
//      第三章又漏了一次：工具栏少一个「自动」按钮，自动滚屏整个功能直接消失，
//      页面上毫无报错痕迹，只能靠人翻到那一章才发现。所以这里改成按清单比对。
//      清单本身住在共用模块里（tools/check-precache.mjs 也读同一份模板核对）。
const written = fs.readFileSync(out, 'utf-8');
const problems = tpl.missingAssetScripts(written).concat(tpl.missingHooks(written));
if (problems.length) {
  fs.unlinkSync(out);
  console.error('✗ 模板缺少必要内容：');
  problems.forEach(function (p) { console.error('   · ' + p); });
  console.error('  已删除刚生成的章节页，未改动 chapters.js。请先更新 tools/chapter-template.cjs 的模板。');
  process.exit(1);
}

// 1.5) 源稿入库：manuscript/chapter-NN.md 是这一章的「原文快照」。
//      tools/manuscript-sync.mjs 会在 push 前拿它和章节页逐字比对，
//      「哪句话被谁改了」从此有据可查，而不是只有生成后的 HTML 可看。
const msDir = path.join(ROOT, 'manuscript');
fs.mkdirSync(msDir, { recursive: true });
const msPath = path.join(msDir, file.replace(/\.html$/, '.md'));
fs.writeFileSync(msPath, md, 'utf8');
console.log('📄 源稿已存: manuscript/' + path.basename(msPath));

// 1.8) 预缓存登记 + 缓存名 +1
//      章节页在 sw.js 的 PRECACHE 里。新章节不登记，就不会被预缓存（首次访问靠
//      网络兜底，离线就打不开）；而不升 CACHE 名，老用户的 SW 不会重新 install，
//      新条目也进不去。这两步以前是手动的，最容易漏。
const SW_JS = path.join(ROOT, 'sw.js');
if (fs.existsSync(SW_JS)) {
  let swSrc = fs.readFileSync(SW_JS, 'utf-8');
  const entryPath = '/novel/' + file;
  if (swSrc.indexOf("'" + entryPath + "'") === -1) {
    const lastChapter = /(\n\s*'\/novel\/chapter-\d+\.html',)(?![\s\S]*'\/novel\/chapter-\d+\.html',)/;
    const firstEntry = /(var PRECACHE = \[\n)/;
    if (lastChapter.test(swSrc)) {
      swSrc = swSrc.replace(lastChapter, "$1\n  '" + entryPath + "',");
    } else if (firstEntry.test(swSrc)) {
      swSrc = swSrc.replace(firstEntry, "$1  '" + entryPath + "',\n");
    } else {
      console.error('⚠ 没找到 sw.js 的 PRECACHE 数组，预缓存未登记（请手动补）');
    }
    const cacheRe = /var CACHE = '([a-z-]+)-v(\d+)'/;
    const cm = swSrc.match(cacheRe);
    if (cm) {
      const nextCache = cm[1] + '-v' + (parseInt(cm[2], 10) + 1);
      swSrc = swSrc.replace(cacheRe, "var CACHE = '" + nextCache + "'");
      console.log('🔁 SW 缓存名 → ' + nextCache + '（老用户才会重新 install）');
    }
    fs.writeFileSync(SW_JS, swSrc);
    console.log('📦 已登记预缓存: ' + entryPath);
  }
}

// 2) 更新 chapters.js（保留头部注释与尾部代码，重建数组）
const head = chaptersSrc.slice(0, chaptersSrc.indexOf('var CHAPTERS = ['));
const tail = chaptersSrc.slice(chaptersSrc.indexOf('];', chaptersSrc.indexOf('var CHAPTERS = [')) + 2);
const newEntry = { num, title, file, words };
if (opts.blurb) newEntry.blurb = opts.blurb;
// 年份默认继承上一章（故事通常不会一章一跨年），要换年时用 --year 显式指定。
// 首页光阴册按它插年份分隔条，漏写就会并进上一年的组里。
newEntry.year = toYearValue(opts.year) || (prev && prev.year) || '';
if (opts.term) newEntry.term = opts.term;   // 学期默认由首页按 date 推算，只有算错时才手写
// --dates 写一章里的多个日期（逗号分隔）；只有一个就退回 date 字段。
// 首页据此显示区间「九月一日–二十七」，学期归属按第一个日期算。
if (opts.dates) {
  var dateList = String(opts.dates).split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
  if (dateList.length > 1) newEntry.dates = dateList;
  else if (dateList.length === 1) newEntry.date = dateList[0];
} else if (opts.date) newEntry.date = opts.date;
if (opts.seal) newEntry.seal = opts.seal;
newEntry.leaf = (num - 1) % 8;
if (opts.volume) newEntry.volume = opts.volume;
const all = entries.concat([newEntry]);
fs.writeFileSync(CHAPTERS_JS, head + 'var CHAPTERS = [\n' + all.map(fmtEntry).join(',\n') + '\n];' + tail);

// 3) 给上一章补"下一章"链接（只剩底部工具栏那一个；正文流里那对已经移除）
if (prev) {
  const prevPath = path.join(NOVEL_DIR, prev.file);
  let prevHtml = fs.readFileSync(prevPath, 'utf-8');
  prevHtml = prevHtml
    .replace('<a href="#" class="next-ch">下一章</a>', '<a href="' + file + '" class="next-ch">下一章</a>');
  fs.writeFileSync(prevPath, prevHtml);
}

console.log('✅ 新章节已生成: novel/' + file);
console.log('   标题: ' + title);
console.log('   字数: ' + words + '（口径：CJK 汉字 + 中文标点，含标题）');
console.log('   chapters.js 已追加第 ' + num + ' 章条目');
if (prev) console.log('   ' + prev.file + ' 的"下一章"已指向 ' + file);
if (!opts.afterglow) console.log('⚠️  章末"这一章的风"是占位文案，记得换成属于这一章的话');
if (!opts.blurb) console.log('⚠️  目录简介为空，可重新运行或手动在 chapters.js 补 blurb 字段');

// 4) 刷新 sitemap.xml：新章节不写进 sitemap 就不会被搜索引擎收录，而这种遗漏
//    没有任何报错。放在最后跑 —— 此时 chapters.js / 章节页都已就位。
//    用 spawnSync 调同一个 node：本脚本是 CommonJS，sitemap 工具是 ESM，
//    跨模块系统共享代码只能走子进程（process.execPath 保证用的是当前这个 node）。
// 5) 刷新 announce.json：新章节的「更新了」横幅数据源。零维护 —— 每发一章自动指向最新章。
const announceTool = path.join(__dirname, 'tools', 'make-announce.mjs');
const announceRun = spawnSync(process.execPath, [announceTool], { stdio: 'inherit', cwd: ROOT });
if (announceRun.status !== 0) {
  console.error('⚠ announce.json 刷新失败（章节页本身已生成，不影响阅读）。请手动跑:');
  console.error('    node tools/make-announce.mjs');
}

const sitemapTool = path.join(__dirname, 'tools', 'make-sitemap.mjs');
const sitemapRun = spawnSync(process.execPath, [sitemapTool], { stdio: 'inherit', cwd: ROOT });
if (sitemapRun.status !== 0) {
  console.error('⚠ sitemap.xml 刷新失败（章节页本身已生成，不影响阅读）。请手动跑:');
  console.error('    node tools/make-sitemap.mjs');
}
