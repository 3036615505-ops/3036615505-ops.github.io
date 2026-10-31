#!/usr/bin/env node
/**
 * tools/render-chapter.mjs —— 用 manuscript/*.md 重新渲染**已有**章节页
 *
 * 为什么需要它（HANDOVER「埋过的坑」第 19 条）：
 *   `new-chapter.js` 是「加新章节」，不是「重新生成章节」。把已有章节的 md 传给它，
 *   它会按 `CHAPTERS.length + 1` 生成新的一章（2026-10-31 实测：改第一章正文，
 *   结果长出了 chapter-08.html，还连带改了 chapters.js / announce.json /
 *   sitemap.xml / sw.js / 上一章的「下一章」）。改已有正文此前只有两条手工路径
 *   （直接改 html 的 <p> 再反写快照、或按段替换 + 手动同步 md），都不是生成器路径。
 *   这个脚本补上那条缺的路：**md 是源，html 是产物**。
 *
 * 用法：
 *   node tools/render-chapter.mjs chapter-01            # 重新渲染某一章
 *   node tools/render-chapter.mjs chapter-01 --dry-run  # 只比对不写
 *   node tools/render-chapter.mjs --all                 # 全部（按 js/chapters.js 的章号）
 *   node tools/render-chapter.mjs 1 3 5 --dry-run        # 也可以按章号
 *
 * 它只改一件事：`<article class="chapter-content">` 里的**正文**（h1 + 段落 +
 * 场景分隔 + 章内日期行）。页面上其余每一字节都原样保留 —— head、顶栏、
 * 余韵卡（`.chapter-afterglow`，那句属于这一章的话只存在于页面里）、章末印章、
 * 底部工具栏的 7 个挂点、prev/next 链接、所有 `?v=`。
 * 理由：md 描述不了那些东西，重新生成它们等于用模板覆盖掉人工写的内容。
 * 结果就是「对当前 md 跑两次，git status 必须为空」（幂等）。
 *
 * 真改了页面时，结尾会提醒 **`sw.js` 的 `CACHE` 名 +1**（章节页在 `PRECACHE` 里，
 * 正文一变预缓存字节就变；不升名，离线读者会长期停在旧页面且不会自愈）。
 * 只提醒、不自动改 —— 自动升会把「这次到底该不该发版」的判断一起吞掉。
 *
 * 段落怎么变 <p>、日期行怎么缩进，用的是 tools/chapter-template.cjs 里那份
 * 唯一模板（和 new-chapter.js 同一份实现，见那个文件的头注释）。
 *
 * 唯一会静默出错的地方是**段数变化**：搜索落点（`data-quote-index`）与阅读进度
 * 锚点（`reader-anchor-<id>` 的 `{p,i,o}`）全靠段序号，段数一变全体偏移，而页面
 * 看着完全正常。所以段数不一致会醒目打印告警 —— 但**不阻止**（作者可能是有意增删段）。
 *
 * 零依赖：只用 Node 内置模块。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* 共用模板是 CommonJS（new-chapter.js 要 require 它），ESM 这边用 createRequire 取。
   反过来不行：CJS 不能 require 一个 .mjs。所以这一层只能这么接，且**不改动**
   new-chapter.js 的模块系统 —— 它的行为一个字都不许变。 */
const require = createRequire(import.meta.url);
const tpl = require('./chapter-template.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOVEL_DIR = path.join(ROOT, 'novel');
const MS_DIR = path.join(ROOT, 'manuscript');
const CHAPTERS_JS = path.join(ROOT, 'js', 'chapters.js');

/* ---------- 参数 ---------- */

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const all = argv.includes('--all');
const selectors = argv.filter((a) => !a.startsWith('-'));

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法: node tools/render-chapter.mjs <chapter-01|1> [...] [--all] [--dry-run]');
  process.exit(0);
}

if (!all && selectors.length === 0) {
  console.error('用法: node tools/render-chapter.mjs <chapter-01|1> [...] [--all] [--dry-run]');
  console.error('  例: node tools/render-chapter.mjs chapter-01');
  console.error('  例: node tools/render-chapter.mjs --all --dry-run');
  process.exit(1);
}

/* ---------- 小工具 ---------- */

/**
 * 两条序列的 LCS 对齐。段落数都是几十，O(n·m) 完全够用。
 *
 * @param {string[]} a 旧序列
 * @param {string[]} b 新序列
 * @returns {Array<{op: 'keep'|'del'|'ins', ai?: number, bi?: number}>} 操作序列
 */
function alignSequences(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ op: 'keep', ai: i, bi: j }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: 'del', ai: i }); i++; }
    else { ops.push({ op: 'ins', bi: j }); j++; }
  }
  while (i < n) { ops.push({ op: 'del', ai: i }); i++; }
  while (j < m) { ops.push({ op: 'ins', bi: j }); j++; }
  return ops;
}

/** 行级 diff 文本（每处变更保留 2 行上下文，中间用 … 省略）。 */
function diffLines(oldLines, newLines) {
  const ops = alignSequences(oldLines, newLines);
  const mark = new Array(ops.length).fill(false);
  ops.forEach((op, i) => {
    if (op.op === 'keep') return;
    for (let k = Math.max(0, i - 2); k <= Math.min(ops.length - 1, i + 2); k++) mark[k] = true;
  });
  const out = [];
  let gap = false;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (!mark[i]) { gap = true; continue; }
    if (gap) { out.push('      …'); gap = false; }
    if (op.op === 'keep') out.push('    ' + oldLines[op.ai]);
    else if (op.op === 'del') out.push('  - ' + oldLines[op.ai]);
    else out.push('  + ' + newLines[op.bi]);
  }
  return out;
}

/** 比对口径与 tools/manuscript-sync.mjs 一致：去掉所有空白后逐字比。 */
function norm(text) {
  return String(text).replace(/\s+/g, '');
}

/**
 * 读 sw.js 当前的 `CACHE` 名与 `PRECACHE` 里的章节页条数。
 *
 * 为什么要读而不是写死：`CACHE` 的名字每个月都在变，提示里硬编码一个
 * 「linyuan-v70」迟早会骗人；读不到就只提示、不猜数字。
 *
 * @returns {{name: string, version: number, chapterEntries: number}|null} 读不到返回 null
 */
function readServiceWorkerCache() {
  const swPath = path.join(ROOT, 'sw.js');
  if (!fs.existsSync(swPath)) return null;
  const src = fs.readFileSync(swPath, 'utf8');
  const m = /var\s+CACHE\s*=\s*'([A-Za-z0-9-]+)-v(\d+)'/.exec(src);
  if (!m) return null;
  const pre = /var\s+PRECACHE\s*=\s*\[([\s\S]*?)\];/.exec(src);
  const chapterEntries = pre ? (pre[1].match(/\/novel\/chapter-\d+\.html/g) || []).length : 0;
  return { name: m[1], version: parseInt(m[2], 10), chapterEntries };
}

/* ---------- 解析已有章节页 ---------- */

const ARTICLE_OPEN = '<article class="chapter-content">';
const ARTICLE_CLOSE = '</article>';

/* 正文区里允许出现的结构。刻意写死、不做通用 HTML 解析：
   认不出来就报错停下 —— 与其静默丢一段结构，不如让人先看一眼页面被谁手改过。 */
const PATTERNS = [
  { type: 'h1', re: /^[ \t]*<h1>([\s\S]*?)<\/h1>/ },
  { type: 'p', re: /^[ \t]*<p>([\s\S]*?)<\/p>/ },
  { type: 'break', re: /^[ \t]*<div class="scene-break"><\/div>/ },
  { type: 'date', re: /^[ \t]*<div class="chapter-date((?:[ \t][a-z-]+)*)">([\s\S]*?)<\/div>/ }
];

/**
 * 把 `<article class="chapter-content">` 的内部切成 token。
 *
 * @param {string} inner 文章标签内部的原文
 * @returns {{h1: string, items: Array<Object>}} h1 是标题原文；items 按出现顺序
 */
function tokenizeArticleInner(inner) {
  const frame = /^\n([\s\S]*)\n {2}$/.exec(inner);
  if (!frame) {
    throw new Error('正文区的首尾不是预期的「换行 … 两个空格」，页面可能被手改过（已中止，未写入）');
  }
  const body = frame[1];
  const items = [];
  let h1 = '';
  let pos = 0;
  while (pos < body.length) {
    if (/\s/.test(body.charAt(pos))) { pos += 1; continue; }
    const rest = body.slice(pos);
    let hit = null;
    for (const p of PATTERNS) {
      const m = p.re.exec(rest);
      if (m) { hit = { type: p.type, m }; break; }
    }
    if (!hit) {
      throw new Error('正文区里有认不出的结构（第 ' + (pos + 1) + ' 个字符起）：' +
        JSON.stringify(body.slice(pos, pos + 60)) + '\n  这个工具只重写 <p>、场景分隔与章内日期行，' +
        '其余结构请先手工确认（已中止，未写入）');
    }
    if (hit.type === 'h1') {
      if (items.length || h1) throw new Error('正文区里出现了第二个 <h1>（已中止，未写入）');
      h1 = tpl.unescapeText(hit.m[1]).trim();
    } else if (hit.type === 'p') {
      items.push({ type: 'p', text: tpl.unescapeText(hit.m[1]) });
    } else if (hit.type === 'break') {
      items.push({ type: 'break' });
    } else {
      const cls = hit.m[1] || '';
      items.push({ type: 'date', end: /chapter-date-end/.test(cls), text: tpl.unescapeText(hit.m[2]) });
    }
    pos += hit.m[0].length;
  }
  if (!h1) throw new Error('正文区里没有 <h1> 标题（已中止，未写入）');
  return { h1, items };
}

/* ---------- 段落对齐 ---------- */

/**
 * 计算「旧段落序号 → 新段落序号」的映射（未对齐的旧段落为 undefined）。
 *
 * @param {string[]} oldPs 旧段落
 * @param {string[]} newPs 新段落
 * @returns {Array<number|undefined>} 长度 = oldPs.length
 */
function mapOldToNew(oldPs, newPs) {
  const map = new Array(oldPs.length).fill(undefined);
  alignSequences(oldPs, newPs).forEach((op) => {
    if (op.op === 'keep') map[op.ai] = op.bi;
  });
  return map;
}

/**
 * 旧段落序号 → 「结构 token 应该插在第几段之前」。
 *
 * - 文首的结构（`-1`）→ 0
 * - 紧跟某段之后 → 该段在新序列里的位置 + 1
 * - 那段被删了 → 往前找最近的对齐段；再不行往后找；实在没有就 0
 *
 * @param {Array<number|undefined>} oldToNew 旧→新段落映射
 * @param {number} oldIndex 旧段落序号（-1 表示「第一段之前」）
 * @param {number} oldCount 旧段落总数
 * @returns {number} 新序列里的插入位置（0 表示插在第一段之前）
 */
function resolveStructurePosition(oldToNew, oldIndex, oldCount) {
  if (oldIndex < 0) return 0;
  if (oldToNew[oldIndex] !== undefined) return oldToNew[oldIndex] + 1;
  for (let k = oldIndex - 1; k >= 0; k--) {
    if (oldToNew[k] !== undefined) return oldToNew[k] + 1;
  }
  for (let k = oldIndex + 1; k < oldCount; k++) {
    if (oldToNew[k] !== undefined) return oldToNew[k];
  }
  return 0;
}

/* ---------- 单章渲染 ---------- */

/**
 * 渲染一章的正文区。
 *
 * @param {Object} entry js/chapters.js 里的章节条目
 * @param {{dryRun: boolean, assetVersion: number}} ctx 运行上下文
 * @returns {{name: string, changed: boolean, warnings: string[], oldCount: number, newCount: number}}
 */
function renderChapter(entry, ctx) {
  const name = String(entry.file).replace(/\.html$/, '');
  const warnings = [];
  const htmlPath = path.join(NOVEL_DIR, entry.file);
  const mdPath = path.join(MS_DIR, name + '.md');

  if (!fs.existsSync(htmlPath)) {
    throw new Error(name + '：章节页不存在 novel/' + entry.file +
      '（新章节请用 new-chapter.js，这个工具只重渲染已有的章）');
  }
  if (!fs.existsSync(mdPath)) {
    throw new Error(name + '：缺少源稿 manuscript/' + name + '.md\n' +
      '  这个工具以 md 为源，没有 md 就无从重渲染。要么先补源稿，要么按老办法改 html。');
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  const md = fs.readFileSync(mdPath, 'utf8');
  const parsedMd = tpl.parseManuscript(md);

  /* md 的标题行只用来交叉核对，不写进页面：真正的标题在页面 <h1> 与
     js/chapters.js 的 title 里，三处不一致说明有人只改了其中一处。 */
  if (parsedMd.title && parsedMd.title !== entry.title) {
    warnings.push(name + '：源稿标题「' + parsedMd.title + '」与 js/chapters.js 的 title「' +
      entry.title + '」不一致（本工具不改标题，请确认哪一处该改）');
  }

  const open = html.indexOf(ARTICLE_OPEN);
  if (open < 0) throw new Error(name + '：找不到 ' + ARTICLE_OPEN + '（已中止，未写入）');
  const innerStart = open + ARTICLE_OPEN.length;
  const innerEnd = html.indexOf(ARTICLE_CLOSE, innerStart);
  if (innerEnd < 0) throw new Error(name + '：找不到 </article>（已中止，未写入）');

  const oldInner = html.slice(innerStart, innerEnd);
  const { h1, items } = tokenizeArticleInner(oldInner);

  if (h1 !== entry.title) {
    warnings.push(name + '：页面 <h1>「' + h1 + '」与 js/chapters.js 的 title「' +
      entry.title + '」不一致（本工具保留页面上的标题，请确认哪一处该改）');
  }

  /* 页面结构守卫：用的是共用模板里那两份清单（new-chapter.js 写盘后自检也用它）。
     缺挂点不阻止重渲染 —— 这个工具不碰那些区域，但它该被看见。 */
  const scriptLack = tpl.missingAssetScripts(html);
  if (scriptLack.length) warnings.push(name + '：页面缺少脚本引用 ' + scriptLack.join(' / '));
  const hookLack = tpl.missingHooks(html);
  if (hookLack.length) warnings.push(name + '：页面缺少 UI 挂点 ' + hookLack.join(' / '));
  const dataFile = /<section class="chapter-block" data-file="([^"]*)"/.exec(html);
  if (dataFile && dataFile[1] !== entry.file) {
    warnings.push(name + '：data-file="' + dataFile[1] + '" 与 chapters.js 的 file="' +
      entry.file + '" 不一致（换章不换页时进度会记到错章名下，见 HANDOVER 坑 16）');
  }
  const pageVersions = [...html.matchAll(/\?v=(\d+)/g)].map((m) => parseInt(m[1], 10));
  const pageMax = pageVersions.length ? Math.max(...pageVersions) : 0;
  if (pageMax && pageMax !== ctx.assetVersion) {
    warnings.push(name + '：页面的 ?v=' + pageMax + ' 落后于全站最大 ?v=' + ctx.assetVersion +
      '（跑 node tools/bump-assets.mjs --write 统一）');
  }

  /* 页面上的日期行**原样保留**：`--nodate` 的章（第三、四、六章）在 chapters.js
     里照样有 date 字段，但页面上刻意没有日期行。重算的话那三章会凭空多出一行，
     把作者当初的决定推翻，而且不报错。 */
  const oldPs = items.filter((t) => t.type === 'p').map((t) => t.text);
  const newPs = parsedMd.tokens.filter((t) => t.type === 'p').map((t) => t.text);
  const oldToNew = mapOldToNew(oldPs, newPs);

  /* 场景分隔的来源：md 里有 `---` 就以 md 为准（说明源稿开始写分隔了）；
     否则沿用页面上的位置 —— manuscript/ 里不含分隔标记（manuscript-sync 只记段落），
     重生成时分隔只能从页面拿回来。 */
  const mdBreaks = parsedMd.tokens.filter((t) => t.type === 'break').length;
  const breakFromMd = mdBreaks > 0;

  const slots = new Map();
  const pushSlot = (pos, token) => {
    if (!slots.has(pos)) slots.set(pos, []);
    slots.get(pos).push(token);
  };

  if (breakFromMd) {
    let pIdx = 0;
    parsedMd.tokens.forEach((t) => {
      if (t.type === 'p') { pIdx += 1; return; }
      pushSlot(pIdx, { type: 'break' });
    });
    if (items.some((t) => t.type === 'break')) {
      warnings.push(name + '：源稿里有 ' + mdBreaks + ' 处 ---，场景分隔改以源稿为准' +
        '（页面上原有的分隔位置被忽略）');
    }
    /* 这条必须说清楚，否则「md 里加了 --- 之后 npm run manuscript 变红」会被当成谜题：
       tools/manuscript-sync.mjs 只把 <p>/<blockquote>/<hr> 反写成 md，**不认**
       <div class="scene-break">，所以 md 里的 --- 在比对时是「多出来的字符」。
       解法：确认页面上的分隔没问题后跑一次
       `node tools/manuscript-sync.mjs --write --only <chapter>`（它是 HTML → md），
       快照里就不再有 ---，而页面上的分隔原样保留。 */
    warnings.push(name + '：md 里的 --- 会让 `npm run manuscript` 报「正文与源稿不一致」——' +
      'manuscript-sync 不把 <div class="scene-break"> 反写成 ---。' +
      '分隔确认无误后跑一次 `node tools/manuscript-sync.mjs --write --only ' + name + '` 让快照跟上' +
      '（页面上的分隔不会丢）。');
  } else {
    let lastP = -1;
    items.forEach((t) => {
      if (t.type === 'p') { lastP += 1; return; }
      if (t.type === 'break') {
        pushSlot(resolveStructurePosition(oldToNew, lastP, oldPs.length), { type: 'break' });
      }
    });
  }

  /* 日期行（含章末 .chapter-date-end）始终沿用页面：见上面那段注释。 */
  {
    let lastP = -1;
    items.forEach((t) => {
      if (t.type === 'p') { lastP += 1; return; }
      if (t.type === 'date') {
        pushSlot(resolveStructurePosition(oldToNew, lastP, oldPs.length),
          { type: 'date', end: t.end, text: t.text });
      }
    });
  }

  const newTokens = [];
  for (let i = 0; i <= newPs.length; i++) {
    (slots.get(i) || []).forEach((t) => newTokens.push(t));
    if (i < newPs.length) newTokens.push({ type: 'p', text: newPs[i] });
  }

  const newInner = tpl.renderArticleInner({ title: h1, dateTop: '', tokens: newTokens });

  /* 自校验（口径同 tools/manuscript-sync.mjs）：重渲染出来的正文文字必须和源稿逐字一致。
     不成立就说明解析/对齐出了问题 —— 宁可停下，也不要把错页写进去。 */
  const renderedText = norm(newTokens.filter((t) => t.type === 'p').map((t) => t.text).join(''));
  const mdText = norm(newPs.join(''));
  if (renderedText !== mdText) {
    throw new Error(name + '：重渲染后的正文与源稿不一致（内部自校验失败，已中止，未写入）');
  }

  const changed = newInner !== oldInner;
  if (changed && !ctx.dryRun) {
    fs.writeFileSync(htmlPath, html.slice(0, innerStart) + newInner + html.slice(innerEnd), 'utf8');
  }

  /* 段数告警：这是唯一会静默出错的地方。告警但**不阻止** —— 作者可能是有意增删段。 */
  if (oldPs.length !== newPs.length) {
    const delta = newPs.length - oldPs.length;
    warnings.push('⚠ 段数变化：' + name + ' ' + oldPs.length + ' → ' + newPs.length +
      '（' + (delta > 0 ? '+' : '') + delta + ' 段）\n' +
      '    搜索落点（data-quote-index）与阅读进度锚点（reader-anchor-*）全靠段序号，\n' +
      '    段数一变，读者已存的锚点会整体偏移，而页面看起来完全正常。\n' +
      '    确认这是有意的增删再提交。');
  }

  if (changed && ctx.dryRun) {
    const oldLines = oldInner.split('\n');
    const newLines = newInner.split('\n');
    console.log('\n[dry-run] ' + entry.file + ' 需要更新：');
    diffLines(oldLines, newLines).forEach((l) => console.log(l));
  } else if (changed) {
    console.log('✓ ' + entry.file + ' 已更新（正文 ' + newPs.length + ' 段）');
  } else {
    console.log('· ' + entry.file + ' 无变化（正文 ' + newPs.length + ' 段）');
  }

  return { name, changed, warnings, oldCount: oldPs.length, newCount: newPs.length };
}

/* ---------- 主流程 ---------- */

if (!fs.existsSync(CHAPTERS_JS)) {
  console.error('找不到 js/chapters.js');
  process.exit(1);
}

const chapters = tpl.readChaptersFile(CHAPTERS_JS);

/**
 * 把命令行参数解析成章节条目（支持 `chapter-01` / `chapter-01.html` / `chapter-1` / `1`）。
 *
 * @param {string[]} list 位置参数
 * @returns {Array<Object>} 章节条目（去重、保持命令行顺序）
 */
function resolveTargets(list) {
  const targets = [];
  list.forEach((raw) => {
    const clean = String(raw).trim()
      .replace(/^novel[\\/]/, '')
      .replace(/\.html$/, '')
      .replace(/\.md$/, '');
    const numMatch = /^chapter-?0*(\d+)$/i.exec(clean);
    const byNum = /^\d+$/.test(clean) ? parseInt(clean, 10) : null;
    const picked = numMatch
      ? chapters.filter((c) => c.num === parseInt(numMatch[1], 10))
      : (byNum !== null
        ? chapters.filter((c) => c.num === byNum)
        : chapters.filter((c) => String(c.file).replace(/\.html$/, '') === clean));
    if (!picked.length) {
      console.error('✗ 找不到章节：' + raw + '（js/chapters.js 里没有这一章）');
      process.exit(1);
    }
    picked.forEach((c) => { if (!targets.includes(c)) targets.push(c); });
  });
  return targets;
}

const targets = all ? chapters.slice() : resolveTargets(selectors);
const assetVersion = tpl.detectAssetVersion();

console.log('重新渲染 ' + targets.length + ' 章' + (dryRun ? '（dry-run，只比对不写）' : '') + '：');

let failures = 0;
const allWarnings = [];
const results = [];
targets.forEach((entry) => {
  try {
    const r = renderChapter(entry, { dryRun, assetVersion });
    results.push(r);
    allWarnings.push(...r.warnings);
  } catch (err) {
    failures += 1;
    console.error('✗ ' + (err && err.message ? err.message : String(err)));
  }
});

/* CACHE 提示：**只**在「真的改了页面」且「真的落盘」时出现。
   --dry-run 不响（还没改任何东西）、无变化不响（天天叫就没人看了）。
   为什么必须提示：7 个章节页都在 sw.js 的 PRECACHE 里，正文一变预缓存字节就变了；
   不升 CACHE 名，老用户的 SW 不会重新 install，离线读者会长期停在旧页面且**不会自愈**
   （2026-10-29 底部抽屉那次就是这么漏的）。`npm run stale` 看不出这一层 ——
   它只比对带缓存键（?v=）的资源，而章节页的 CACHE 是靠 PRECACHE 字节判的。
   这里**只提示、不自动改**：自动升会把「这次到底该不该发版」这个判断也一起吞掉。 */
const changedCount = results.filter((r) => r.changed).length;
if (!dryRun && changedCount > 0) {
  const cache = readServiceWorkerCache();
  const why = '\n    判据是「PRECACHE 里的字节变没变」，不是「改的是哪个文件」。' +
    (cache && cache.chapterEntries
      ? cache.chapterEntries + ' 个章节页都在 PRECACHE 里，'
      : '章节页在 PRECACHE 里，') +
    '不升的话离线读者会长期停在旧页面且不会自愈。' +
    '\n    `npm run stale` 看不出这一层 —— 它只比带缓存键（?v=）的资源，不看 PRECACHE。';
  allWarnings.unshift(cache
    ? '⚠ ' + changedCount + ' 个章节页内容已变 → sw.js 的 CACHE 名要 +1（' +
      cache.name + '-v' + cache.version + ' → ' + cache.name + '-v' + (cache.version + 1) + '）' + why
    : '⚠ ' + changedCount + ' 个章节页内容已变 → sw.js 的 CACHE 名要 +1' +
      '（没读到 sw.js 里的 `var CACHE = \'…-vN\'`，请手动看一眼当前值再 +1）' + why);
}

if (allWarnings.length) {
  console.log('\n' + '='.repeat(64));
  console.log('注意事项（' + allWarnings.length + ' 条）：');
  allWarnings.forEach((w) => console.log('  ' + w));
  console.log('='.repeat(64));
}

if (failures) {
  console.error('\n✗ 有 ' + failures + ' 章失败，其余未受影响。');
  process.exit(1);
}

if (dryRun) {
  console.log('\ndry-run 结束，没有写入任何文件。去掉 --dry-run 才会真正落盘。');
} else {
  console.log('\n下一步自校验：npm run manuscript（正文与源稿逐字比对）');
  if (targets.length > 1) console.log('               npm run precache（章节页预缓存条目齐全）');
}
