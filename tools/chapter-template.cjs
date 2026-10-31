'use strict';
/**
 * tools/chapter-template.cjs —— 章节页的**唯一**模板与正文渲染实现（CommonJS）
 *
 * 为什么有这个文件：本站有两个地方要「把 Markdown 写成章节页 HTML」——
 *   · new-chapter.js            加**新**章节（整页模板）
 *   · tools/render-chapter.mjs  重新渲染**已有**章节（只换正文区）
 * 如果两处各写一份模板，必然「改一处漏一处」。这个仓库已经为同一类问题付过两次
 * 代价（announce.js 的 defer 注释、make-characters 的 headBlock）：两份模板漂移时
 * 谁都不报错，只有下次生成出来的页面悄悄少一行。所以：
 *
 *   **`<article class="chapter-content">` 里长什么样、章节页外壳长什么样，
 *    全仓库只允许在这里定义一次。**
 *
 * 校验方式（模板体只有一处，可以随手验）：
 *   grep -rn '<div class="chapter-afterglow">' --include=*.cjs --include=*.js --include=*.mjs .
 *   → 只有本文件行；别处提到 chapter-afterglow 的都是注释或运行时选择器（js/reader.ui.js）。
 *   同理 `<article class="chapter-content">` 的写法只在 renderArticleInner 里生成一次。
 *
 * 模块系统：new-chapter.js 是 CommonJS（历史原因，且它用 vm 求值 chapters.js），
 * tools/*.mjs 是 ESM。CJS 文件既能被 CJS `require()`，也能被 ESM `import`（Node 的
 * CJS 互操作），反过来不行 —— 所以共用模块只能是 CommonJS，扩展名写成 .cjs 提醒
 * 「这不是 ESM」。这样**不改变 new-chapter.js 的模块系统**，行为不动。
 *
 * 零依赖：只用 Node 内置模块。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const NOVEL_DIR = path.join(ROOT, 'novel');

/**
 * 章节页必须引用的阅读器模块（少一个 = 页面没有交互，且不报错）。
 * new-chapter.js 写盘后拿它自检，render-chapter.mjs 拿它检查已有页面。
 */
const ASSET_SCRIPTS = [
  'chapters.js', 'transition.js',
  'reader.flags.js', 'reader.dom.js', 'reader.store.js', 'reader.engine.js', 'reader.ui.js',
  'reader.js'
];

/**
 * 「少一个就等于功能消失」的 UI 挂点。第三章曾漏掉工具栏的「自动」按钮，
 * 自动滚屏整个功能消失而页面上毫无痕迹，只能靠人翻到那一章才发现。
 */
const REQUIRED_HOOKS = [
  ['toggleAutoScroll', '工具栏「自动」按钮（自动滚屏唯一入口）'],
  ['openSearch', '工具栏「搜索」按钮（阅读器内全章搜索唯一入口）'],
  ['autoScrollLabel', '自动滚屏状态文字'],
  ['chapter-seal', '章末印章'],
  ['style.css?v=', '样式表版本号（不带的 URL 会永久吃旧 CSS 缓存）'],
  ['favicon.png', '站点图标（favicon.svg 这个文件根本不存在）'],
  ['apple-touch-icon', 'iOS 加主屏图标（漏了 = 苹果用户拿整页截图当图标）']
];

/** HTML 属性 / 标题里用的转义（引号也转，避免属性值被截断）。 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 正文文本节点：引号无需转义（与原章节源码风格一致，渲染无差别）。 */
function escapeText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** escapeText 的逆运算：比对「页面上的段落」与「md 里的段落」时用。 */
function unescapeText(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 字数口径与线上一致：CJK 汉字 + 中文标点。 */
function countWords(text) {
  const m = String(text).match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g);
  return m ? m.length : 0;
}

/**
 * 当前站点资源版本号：扫现有 HTML 里最大的 `?v=`。
 * 手写版本号必然过期 —— 模块拆分那次模板里还停在「只引一个 reader.js」，
 * 生成出来的新章是个没有交互的空壳。所以每次都现取。
 *
 * @returns {number} 版本号（找不到则 1）
 */
function detectAssetVersion() {
  let max = 0;
  const dirs = [NOVEL_DIR, ROOT];
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).filter((f) => /\.html$/.test(f)).forEach((f) => {
      const html = fs.readFileSync(path.join(dir, f), 'utf8');
      const re = /\?v=(\d+)/g;
      let m;
      while ((m = re.exec(html)) !== null) max = Math.max(max, parseInt(m[1], 10));
    });
  });
  return max || 1;
}

/**
 * 把 chapters.js 里的 CHAPTERS 数组当代码求值，拿真实对象（比正则可靠）。
 * 正则版本在条目加了 date/seal/leaf 之后整体失配，章号算成 1，直接覆盖了第一章。
 *
 * @param {string} src chapters.js 全文
 * @returns {Array<Object>} 章节条目
 */
function readChapters(src) {
  const start = src.indexOf('var CHAPTERS = [');
  if (start < 0) throw new Error('chapters.js 里找不到 CHAPTERS 数组');
  const open = src.indexOf('[', start);
  const end = src.indexOf('\n];', open);
  if (end < 0) throw new Error('CHAPTERS 数组没有正常结束');
  const literal = src.slice(open, end + 2);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('result = ' + literal, sandbox);
  return Array.isArray(sandbox.result) ? sandbox.result : [];
}

/** 从文件读 CHAPTERS。 */
function readChaptersFile(file) {
  return readChapters(fs.readFileSync(file, 'utf8'));
}

/** 年份的中文数字（2022 → 二〇二二），章节页日期行用。 */
const CN_YEAR_CHARS = '〇一二三四五六七八九';
function cnYearStr(y) {
  return String(y).replace(/\d/g, (d) => CN_YEAR_CHARS.charAt(Number(d)));
}

/**
 * 把 Markdown 原稿切成「正文 token」序列。
 *
 * 约定（与 README / HANDOVER 一致）：
 *   - 首行 `# 标题`（或 --title 指定）是章节标题，**永远不进正文**
 *   - 空行分段
 *   - 单独一行 `---` / `***` / `* * *` 是场景分隔
 *
 * token 只有两种：
 *   { type: 'p', text }      一个段落
 *   { type: 'break' }        场景分隔
 *
 * @param {string} md Markdown 原文
 * @param {{title?: string}} [opts] 标题覆盖（命令行 --title）
 * @returns {{title: string, heading: string, tokens: Array<Object>, words: number}}
 *   `title` 是最终采用的标题（--title 优先）；`heading` 是**源稿自己写的**那个
 *   `# 标题`（没有就是空串）。两者分开是因为「传了 --title 又拿旧章节的 md 来加
 *   新章」时，只有 heading 能暴露误用（new-chapter.js 的守卫靠它）。
 */
function parseManuscript(md, opts) {
  const options = opts || {};
  const text = String(md).replace(/\r\n/g, '\n');
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

  let title = options.title || '';
  let headingText = '';
  const tokens = [];
  for (const block of blocks) {
    /* md 里的标题行永远不进正文。
       曾经写成 `if (heading && !title)` —— 一旦命令行也传了 --title，title 已有值，
       这个判断就落空，标题行被当成普通段落写进 <p>，页面上出现一句孤零零的
       「# 第四章·身位」，而源稿同步校验还得人工去猜哪里多了字。 */
    const heading = block.match(/^#\s+(.+)$/m);
    if (heading) {
      if (!headingText) headingText = heading[1].trim();
      if (!title) title = heading[1].trim();
      continue;
    }
    if (/^(---|\*\*\*|\* \* \*)$/.test(block)) {
      tokens.push({ type: 'break' });
      continue;
    }
    tokens.push({ type: 'p', text: block.replace(/\n/g, '') });
  }
  if (!title) throw new Error('未找到标题：Markdown 首行用 "# 标题"，或用 --title 指定');
  return { title, heading: headingText, tokens, words: countWords(text) };
}

/**
 * 把「章内日期」插到场景分隔后面（原地返回新的 token 数组）。
 *
 * 位置规则：日期是跟着「时间变化」走的，所以第 2 个及以后的日子要贴在场景切换
 * 后面、下一段之前，而不是塞在章末 —— 挂在末尾等于说这一章写到那天为止。
 *   dates "九月一日,九月十七" + 正文一处 ---  →  顶上一个九月一日，切换点后一个九月十七
 *   切换点不够用（日期比切换点多）→ 剩下的退回章末，宁可位置差也别丢日期
 *
 * @param {Array<Object>} tokens 正文 token（p / break）
 * @param {{year: (number|string), dates: string[], nodate?: boolean}} opts
 * @returns {{dateTop: string, tokens: Array<Object>}} dateTop 是顶部那一行（含缩进与换行）
 */
function applyDates(tokens, opts) {
  const options = opts || {};
  const year = options.year;
  const dates = options.dates || [];
  const showDateLine = !options.nodate && year && dates.length > 0;
  if (!showDateLine) return { dateTop: '', tokens: tokens.slice() };

  const dateTop = '    <div class="chapter-date">' + cnYearStr(year) + ' · ' + dates[0] + '</div>\n';
  const midDates = dates.slice(1);
  const out = [];
  let breakIdx = 0;
  tokens.forEach((t) => {
    out.push(t);
    if (t.type !== 'break') return;
    if (breakIdx < midDates.length) {
      out.push({ type: 'date', text: cnYearStr(year) + ' · ' + midDates[breakIdx] });
    }
    breakIdx += 1;
  });
  /* 切换点不够：多出来的日期退回章末（.chapter-date-end） */
  midDates.slice(breakIdx).forEach((d) => {
    out.push({ type: 'date', end: true, text: cnYearStr(year) + ' · ' + d });
  });
  return { dateTop, tokens: out };
}

/** 一个正文 token → 一行 HTML（段落 / 场景分隔 / 章内日期）。全站只有这一处。 */
function renderToken(t) {
  if (t.type === 'p') return '<p>' + escapeText(t.text) + '</p>\n';
  if (t.type === 'break') return '<div class="scene-break"></div>\n';
  if (t.type === 'date') {
    const cls = t.end ? 'chapter-date chapter-date-end' : 'chapter-date';
    return '    <div class="' + cls + '">' + escapeText(t.text) + '</div>\n';
  }
  throw new Error('未知的正文 token：' + JSON.stringify(t));
}

/**
 * 组装 `<article class="chapter-content">` 的**内部**（开头那个换行到 `</article>` 前的缩进）。
 *
 * 这个函数是「正文区长什么样」的唯一实现：new-chapter.js 的整页模板用它，
 * tools/render-chapter.mjs 重新渲染已有章节时也用它 —— 所以段落怎么变 <p>、
 * 场景分隔与日期行怎么缩进，两边绝不可能漂移。
 *
 * @param {{title: string, dateTop?: string, tokens: Array<Object>}} opts
 * @returns {string} 形如 "\n    <h1>…</h1>\n…<p>…</p>\n  "
 */
function renderArticleInner(opts) {
  const dateTop = opts.dateTop || '';
  let html = '\n    <h1>' + escapeHtml(opts.title) + '</h1>\n' + dateTop;
  (opts.tokens || []).forEach((t) => { html += renderToken(t); });
  return html + '  ';
}

/**
 * 整页模板。**这是章节页 HTML 的唯一副本**，不要在任何别处再抄一份。
 *
 * 正文流里不再有「上一章 / 下一章」那一对：章末的「一章一句」就是接缝，
 * 往下滚会接上下一章（见 js/reader.ui.js 的 initFlow / docs/INFINITE-SCROLL.md）。
 * 底部工具栏里的 .prev-ch / .next-ch 保留，那是隐藏的显式导航。
 *
 * @param {{
 *   title: string, num: number, file: string, articleInner: string,
 *   prevFile?: string, afterglow: string, sealText?: string, assetVersion: number
 * }} v 模板变量
 * @returns {string} 完整章节页 HTML
 */
function renderChapterPage(v) {
  const num = v.num;
  const assetVersion = v.assetVersion;
  const title = v.title;
  const file = v.file;
  const articleInner = v.articleInner;
  const prevFile = v.prevFile || '';
  const afterglow = v.afterglow;
  const prevCh = prevFile
    ? '<a href="' + prevFile + '" class="prev-ch">上一章</a>'
    : '<a href="#" class="prev-ch">上一章</a>';
  const sealText = v.sealText || '';
  const sealHtml = sealText ? '    <div class="chapter-seal"><span>' + escapeHtml(sealText) + '</span></div>\n' : '';
  return `<!DOCTYPE html>
<html lang="zh-CN" data-fontsize="large" data-theme="wheat">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#f5efe0">
  <meta name="description" content="${escapeHtml(title)} - 临渊羡鱼">
  <link rel="icon" href="../favicon.png" type="image/png">
  <link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">
  <title>${escapeHtml(title)}</title>
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="临渊羡鱼 —— 南城的梧桐枝繁未歇">
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
  <link rel="stylesheet" href="../css/style.css?v=${assetVersion}">
  <!-- 原生壳能力补丁（剪贴板 / 原生分享 / blob 导出）。章节页没有 theme.js，
       所以紧跟样式表；它必须早于正文末尾的 reader.* 模块执行 —— 那些模块
       会直接使用 navigator.clipboard 与 navigator.share。 -->
  <script src="../js/native-bridge.js?v=${assetVersion}"></script>
  <!-- 站内「新章节更新了」横幅（取 announce.json 与 localStorage 比对，每会话一次）。
       defer：它只读 DOM 与 localStorage、往 body 补一条横幅，不参与首绘；
       留在 head 里同步加载会让正文白等一个网络往返（4G 实测首绘 +150~300ms）。 -->
  <script src="../js/announce.js?v=${assetVersion}" defer></script>
  <!-- 点击即反馈：按下就在顶部点亮一条细线，盖住「跳转前的空窗期」。 -->
  <script src="../js/nav-feedback.js?v=${assetVersion}" defer></script>
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

  <!-- 阅读流：一章一个 section，往下滚会接上下一章（首章由页面自带，其余按需追加） -->
  <div id="readingFlow" class="reading-flow">
  <section class="chapter-block" data-file="${file}">
  <article class="chapter-content">${articleInner}</article>

  <div class="chapter-afterglow">
    <!-- 卡头固定写「《章节标题》」，不要再写成「这一章的XX」——
         这是站点的文案约定（见 HANDOVER「文案规则」），生成的每一章都要遵守。 -->
    <div class="afterglow-kicker">《${escapeHtml(title)}》</div>
    <p>${escapeHtml(afterglow)}</p>
    <button type="button" class="afterglow-share" onclick="shareChapter(this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
      分享这一章
    </button>
${sealHtml}  </div>
</section>
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
      <button onclick="openSearch();return false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="16.4" y1="16.4" x2="21" y2="21"/></svg>
        搜索
      </button>
      <button onclick="toggleNightMode()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
        <span id="nightModeLabel">夜读</span>
      </button>
      <button onclick="toggleAutoScroll();return false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v12"/><path d="M8 12l4 4 4-4"/><path d="M6 20h12"/></svg>
        <span id="autoScrollLabel">自动</span>
      </button>
      <button onclick="openSettings()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        设置
      </button>
    </div>
  </div>

  </div>

  <script src="../js/chapters.js?v=${assetVersion}"></script>
  <script src="../js/transition.js?v=${assetVersion}"></script>
  <script src="../js/reader.flags.js?v=${assetVersion}"></script>
  <script src="../js/reader.dom.js?v=${assetVersion}"></script>
  <script src="../js/reader.store.js?v=${assetVersion}"></script>
  <script src="../js/reader.engine.js?v=${assetVersion}"></script>
  <script src="../js/reader.ui.js?v=${assetVersion}"></script>
  <script src="../js/reader.js?v=${assetVersion}"></script>
</body>
</html>
`;
}

/** 章末印章文字：取 --seal，或直接取标题「第三章·课上」里 · 后面那半截。 */
function sealTextFrom(title, optSeal) {
  if (optSeal) return String(optSeal);
  const t = String(title);
  return t.indexOf('·') >= 0 ? t.split('·').pop().trim() : '';
}

/** 检查一段 HTML 是否带齐阅读器脚本（返回缺失列表，空数组 = 齐全）。 */
function missingAssetScripts(html) {
  return ASSET_SCRIPTS
    .filter((name) => html.indexOf('js/' + name) === -1)
    .map((name) => 'js/' + name);
}

/** 检查一段 HTML 是否带齐关键 UI 挂点（返回缺失列表）。 */
function missingHooks(html) {
  return REQUIRED_HOOKS
    .filter((h) => html.indexOf(h[0]) === -1)
    .map((h) => h[0] + ' —— ' + h[1]);
}

module.exports = {
  ROOT,
  NOVEL_DIR,
  ASSET_SCRIPTS,
  REQUIRED_HOOKS,
  escapeHtml,
  escapeText,
  unescapeText,
  countWords,
  detectAssetVersion,
  readChapters,
  readChaptersFile,
  cnYearStr,
  parseManuscript,
  applyDates,
  renderToken,
  renderArticleInner,
  renderChapterPage,
  sealTextFrom,
  missingAssetScripts,
  missingHooks
};
