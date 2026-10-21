#!/usr/bin/env node
/**
 * new-chapter.js — 从 Markdown 生成新章节页
 *
 * 用法：
 *   node new-chapter.js <原稿.md> [--title "标题"] [--blurb "目录简介"] [--afterglow "章末尾语"] [--volume "卷名"] [--dry-run]
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
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const NOVEL_DIR = path.join(ROOT, 'novel');
const CHAPTERS_JS = path.join(ROOT, 'js', 'chapters.js');

// ===== 参数解析 =====
const args = process.argv.slice(2);
const opts = { dryRun: false };
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--dry-run') opts.dryRun = true;
  else if (args[i].startsWith('--')) {
    opts[args[i].slice(2)] = args[++i];
  } else positional.push(args[i]);
}
const mdPath = positional[0];
if (!mdPath) {
  console.error('用法: node new-chapter.js <原稿.md> [--title T] [--blurb B] [--afterglow A] [--volume V] [--dry-run]');
  process.exit(1);
}

// ===== 字数统计（与线上口径一致：CJK 汉字 + 中文标点，含标题行） =====
function countWords(text) {
  const m = text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g);
  return m ? m.length : 0;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 正文文本节点：引号无需转义（与原章节源码风格一致，渲染无差别）
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== 读取 Markdown 并转正文 HTML =====
const md = fs.readFileSync(mdPath, 'utf-8').replace(/\r\n/g, '\n');
const blocks = md.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

let title = opts.title || '';
let contentHtml = '';
for (const block of blocks) {
  const heading = block.match(/^#\s+(.+)$/m);
  if (heading && !title) { title = heading[1].trim(); continue; }
  if (/^(---|\*\*\*|\* \* \*)$/.test(block)) { contentHtml += '<div class="scene-break"></div>\n'; continue; }
  const text = block.replace(/\n/g, '');
  contentHtml += '<p>' + escapeText(text) + '</p>\n';
}
if (!title) { console.error('未找到标题：Markdown 首行用 "# 标题"，或用 --title 指定'); process.exit(1); }

const words = countWords(md);

// ===== 读取现有章节，推算编号 =====
const chaptersSrc = fs.readFileSync(CHAPTERS_JS, 'utf-8');
const entryRe = /\{\s*num:\s*(\d+),\s*title:\s*'((?:[^'\\]|\\.)*)',\s*file:\s*'([^']+)',\s*words:\s*(\d+)(?:,\s*blurb:\s*'((?:[^'\\]|\\.)*)')?(?:,\s*volume:\s*'((?:[^'\\]|\\.)*)')?\s*\}/g;
const entries = [];
let m;
while ((m = entryRe.exec(chaptersSrc)) !== null) {
  entries.push({ num: +m[1], title: m[2], file: m[3], words: +m[4], blurb: m[5] || '', volume: m[6] || '' });
}
const maxNum = entries.reduce((mx, e) => Math.max(mx, e.num), 0);
const num = maxNum + 1;
const file = 'chapter-' + String(num).padStart(2, '0') + '.html';
const prev = entries.length ? entries[entries.length - 1] : null;

// ===== 章节页模板 =====
const prevNav = prev ? '<a href="' + prev.file + '">上一章</a>' : '<span>上一章</span>';
const nextNav = '<span>下一章</span>';
const prevCh = prev ? '<a href="' + prev.file + '" class="prev-ch">上一章</a>' : '<a href="#" class="prev-ch">上一章</a>';
const afterglow = opts.afterglow || '翻过这一页，故事还在继续。（这一句写在 chapter-afterglow 里，换一句属于这一章的话吧）';

const tpl = `<!DOCTYPE html>
<html lang="zh-CN" data-fontsize="large" data-theme="wheat">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f5efe0">
  <meta name="description" content="${escapeHtml(title)} - 临渊羡鱼">
  <link rel="icon" href="../favicon.svg" type="image/svg+xml">
  <title>${escapeHtml(title)}</title>
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="临渊羡鱼 —— 南城的梧桐树还在长">
  <meta property="og:image" content="https://zephyrw.site/assets/og-cover.jpg">
  <meta property="og:type" content="article">
  <link rel="manifest" href="../manifest.json">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Chapter",
    "position": ${num},
    "name": "${escapeHtml(title)}",
    "isPartOf": { "@type": "Book", "name": "临渊羡鱼", "inLanguage": "zh-CN" },
    "inLanguage": "zh-CN"
  }
  </script>
  <link rel="stylesheet" href="../css/style.css">
</head>
<body class="reading-page">
  <div class="reading-wrapper">

  <div class="reading-progress-line"></div>

  <div class="reader-topbar" id="readerTopbar">
    <a href="index.html" class="back-btn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"></polyline>
      </svg>
    </a>
    <span class="chapter-name">${escapeHtml(title)}</span>
  </div>

  <div class="reader-tap-area" id="readerTapArea"></div>

  <article class="chapter-content">
    <h1>${escapeHtml(title)}</h1>
${contentHtml}  </article>

  <div class="chapter-afterglow">
    <div class="afterglow-kicker">这一章的风</div>
    <p>${escapeHtml(afterglow)}</p>
    <button type="button" class="afterglow-share" onclick="shareChapter()">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
      分享这一章
    </button>
  </div>

  <div class="chapter-bottom-nav">
    ${prevNav}
    ${nextNav}
  </div>

  <div class="reader-bottombar" id="readerBottombar">
    <div class="reader-progress-area">
      ${prevCh}
      <div class="reader-progress-bar">
        <div class="fill" id="progressFill" style="width:0%"></div>
      </div>
      <a href="#" class="next-ch">下一章</a>
    </div>
    <div class="reader-menu-row">
      <a href="#" onclick="openDirectory();return false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
        目录
      </a>
      <button onclick="openQuotes();return false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7H5a1 1 0 00-1 1v4a1 1 0 001 1h3v4l4-4V8a1 1 0 00-1-1H8z"/><path d="M19 7h-3a1 1 0 00-1 1v4a1 1 0 001 1h3v4l4-4V8a1 1 0 00-1-1h-3z" transform="translate(-3 0)"/></svg>
        摘句
      </button>
      <button onclick="toggleNightMode()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
        <span id="nightModeLabel">夜读</span>
      </button>
      <button onclick="openSettings()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        设置
      </button>
    </div>
  </div>

  </div>

  <script src="../js/chapters.js"></script>
  <script src="../js/reader.js"></script>
</body>
</html>
`;

// ===== 输出 =====
if (opts.dryRun) {
  const out = path.join(NOVEL_DIR, '_dryrun-chapter.html');
  fs.writeFileSync(out, tpl);
  console.log('✅ [dry-run] 章节页已生成: ' + out);
  console.log('   标题: ' + title + ' | 编号: ' + num + ' | 字数: ' + words);
  console.log('   dry-run 未修改 chapters.js，未改动其他章节');
  process.exit(0);
}

// 1) 写章节页
const out = path.join(NOVEL_DIR, file);
fs.writeFileSync(out, tpl);

// 2) 更新 chapters.js（保留头部注释与尾部代码，重建数组）
const head = chaptersSrc.slice(0, chaptersSrc.indexOf('var CHAPTERS = ['));
const tail = chaptersSrc.slice(chaptersSrc.indexOf('];', chaptersSrc.indexOf('var CHAPTERS = [')) + 2);
const newEntry = { num, title, file, words, blurb: opts.blurb || '', volume: opts.volume || '' };
const all = entries.concat([newEntry]);
const fmt = e => {
  let s = "  { num: " + e.num + ", title: '" + e.title.replace(/'/g, "\\'") + "', file: '" + e.file + "', words: " + e.words;
  if (e.blurb) s += ", blurb: '" + e.blurb.replace(/'/g, "\\'") + "'";
  if (e.volume) s += ", volume: '" + e.volume.replace(/'/g, "\\'") + "'";
  return s + ' }';
};
fs.writeFileSync(CHAPTERS_JS, head + 'var CHAPTERS = [\n' + all.map(fmt).join(',\n') + '\n];' + tail);

// 3) 给上一章补"下一章"链接
if (prev) {
  const prevPath = path.join(NOVEL_DIR, prev.file);
  let prevHtml = fs.readFileSync(prevPath, 'utf-8');
  prevHtml = prevHtml
    .replace('<span>下一章</span>', '<a href="' + file + '">下一章</a>')
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
