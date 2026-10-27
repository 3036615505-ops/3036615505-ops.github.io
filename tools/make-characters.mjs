#!/usr/bin/env node
/**
 * tools/make-characters.mjs —— 从 js/characters-data.js 生成同学录
 *
 * 产物：
 *   novel/characters.html        同学录列表页（整页生成，别手改）
 *   novel/character-<slug>.html  每个人的详细页
 *
 * 另外自动做四件以前靠人记的事（和 new-chapter.js 一致）：
 *   - 列表页立绘用 128×150 缩略图（portrait-<slug>-thumb.webp）；缺了/过期了就调
 *     tools/make-portrait-thumbs.py 现画（Pillow），画不出来直接报错并给出手动命令
 *   - 把新详细页 + 立绘缩略图登记进 sw.js 的 PRECACHE（漏了 = 离线打开是破图）
 *   - 刷新 sitemap.xml（人物页是 sitemap 的一部分，漏刷新 = 新人物不被收录）
 *   - 把 sw.js 的 CACHE 名 +1（不升 = 老用户的 SW 不会重新 install）
 *
 * 用法：node tools/make-characters.mjs
 * 改人物信息请改 js/characters-data.js，不要改生成出来的 HTML。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_JS = path.join(ROOT, 'js', 'characters-data.js');
const NOVEL_DIR = path.join(ROOT, 'novel');
const SW_JS = path.join(ROOT, 'sw.js');

/* ---------- 读数据 ---------- */
function readCharacters() {
  const src = fs.readFileSync(DATA_JS, 'utf8');
  const start = src.indexOf('var CHARACTERS = [');
  if (start < 0) throw new Error('characters-data.js 里找不到 CHARACTERS 数组');
  const open = src.indexOf('[', start);
  const end = src.indexOf('\n];', open);
  if (end < 0) throw new Error('CHARACTERS 数组没有正常结束');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('result = ' + src.slice(open, end + 2), sandbox);
  if (!Array.isArray(sandbox.result) || sandbox.result.length === 0) {
    throw new Error('CHARACTERS 不是非空数组');
  }
  return sandbox.result;
}

/* ---------- 资源版本号：扫现有页面里最大的 ?v=（与 new-chapter.js 同一思路，
   手写必然过期；模块拆分那次就是模板里的手写版本号坑了新章节） ---------- */
function detectAssetVersion() {
  let max = 0;
  const dirs = [NOVEL_DIR, ROOT];
  dirs.forEach((dir) => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir)
      .filter((f) => /\.html$/.test(f))
      .forEach((f) => {
        const html = fs.readFileSync(path.join(dir, f), 'utf8');
        const re = /\?v=(\d+)/g;
        let m;
        while ((m = re.exec(html)) !== null) max = Math.max(max, parseInt(m[1], 10));
      });
  });
  return max || 1;
}

/* ---------- 小工具 ---------- */
const CN_DIGIT = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function cnNumber(n) {
  if (n < 10) return CN_DIGIT[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + CN_DIGIT[n % 10];
  const tens = Math.floor(n / 10), ones = n % 10;
  return CN_DIGIT[tens] + '十' + (ones ? CN_DIGIT[ones] : '');
}

/** '2007.04.20' → '2007年4月20日'（作者定稿：阿拉伯数字 + 年/月/日） */
function birthdayText(raw) {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(String(raw).trim());
  if (!m) return '';
  return m[1] + '年' + String(+m[2]) + '月' + String(+m[3]) + '日';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
  ));
}

const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">\n          <polyline points="15 18 9 12 15 6"></polyline>\n        </svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

/* ---------- 立绘缩略图（列表页专用，128×150 webp） ---------- */
/** 'portrait-linshu-1024.webp' → 'portrait-linshu-thumb.webp' */
function thumbName(portrait) {
  return String(portrait).replace(/-1024\.webp$/, '-thumb.webp');
}

/** 有立绘缺缩略图、或缩略图比母版旧（母版换画了）时为 true */
function thumbsStale(chars) {
  return chars.some((c) => {
    if (!c.portrait) return false;
    const master = path.join(ROOT, 'assets', c.portrait);
    const thumb = path.join(ROOT, 'assets', thumbName(c.portrait));
    if (!fs.existsSync(master)) return false;   // 母版缺失由下面的校验报错
    if (!fs.existsSync(thumb)) return true;
    return fs.statSync(thumb).mtimeMs < fs.statSync(master).mtimeMs;
  });
}

/**
 * 调 tools/make-portrait-thumbs.py 补画缩略图。
 *
 * Python 探测顺序（两台机器都要能跑）：
 *   ① python3 / python 全局能 import PIL（Mac/Linux 常见）
 *   ② 站点仓库外的 _perf/pylibs（本机 Windows：Pillow 只装在那里，
 *      靠 PYTHONPATH 指过去；仓库里不留 node_modules 式的第三方目录）
 * 都找不到就抛错并给出手动命令 —— 不静默跳过：缩略图缺失时列表页全是破图，
 * 而 tools/check-precache.mjs 只兜「PRECACHE 条目存在」，兜不住「没生成」。
 */
function ensureThumbs(chars) {
  if (!thumbsStale(chars)) return;
  const pylibs = path.resolve(ROOT, '..', '_perf', 'pylibs');
  const attempts = [];
  for (const py of ['python3', 'python']) {
    attempts.push({ py, env: process.env });
    if (fs.existsSync(pylibs)) {
      attempts.push({
        py,
        env: Object.assign({}, process.env, {
          PYTHONPATH: pylibs + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : '')
        })
      });
    }
  }
  const usable = attempts.find((a) => {
    const probe = spawnSync(a.py, ['-c', 'import PIL'], { stdio: 'ignore', env: a.env });
    return !probe.error && probe.status === 0;
  });
  if (!usable) {
    throw new Error(
      '找不到带 Pillow 的 Python（试过 python3 / python，全局与 ../_perf/pylibs 都没有）。\n' +
      '  列表页立绘缩略图缺失会直接破图，请先装好再跑本脚本：\n' +
      '    pip install Pillow\n' +
      '  或（本机 Windows）: PYTHONPATH=' + pylibs + ' python tools/make-portrait-thumbs.py\n' +
      '  装好后重跑: node tools/make-characters.mjs'
    );
  }
  console.log('🖼  补画立绘缩略图（' + usable.py + (usable.env.PYTHONPATH ? '，PYTHONPATH=' + usable.env.PYTHONPATH : '') + '）…');
  const run = spawnSync(usable.py, [path.join(ROOT, 'tools', 'make-portrait-thumbs.py')], {
    stdio: 'inherit',
    env: usable.env,
    cwd: ROOT
  });
  if (run.status !== 0) {
    throw new Error('缩略图工具执行失败（见上方输出）。可手动跑: ' + usable.py + ' tools/make-portrait-thumbs.py');
  }
}

function tagChips(c, cls) {
  const items = [];
  (c.tags || []).forEach((t) => items.push('<span class="char-tag">' + esc(t) + '</span>'));
  if (c.role) items.push('<span class="char-tag role">' + esc(c.role) + '</span>');
  return '<div class="char-tags' + (cls ? ' ' + cls : '') + '">\n' +
    items.map((s) => '              ' + s).join('\n') + '\n' +
    '            </div>';
}

/**
 * 头像：有立绘走灯箱按钮，没有走姓氏占位（与旧页面完全一致的结构）。
 *
 * 图片文件分两档（别混）：
 *   - <img src>：列表页卡片位只有 48×56，用缩略图 -thumb.webp（128×150，
 *     2× DPR 也清晰；17 张合计约 70KB，母版要 2276KB）；
 *   - data-lightbox-src：永远指 1024 母版 —— 灯箱要全屏 + 3x 捏合，
 *     缩略图撑不住（详细页同样继续用母版）。
 * useThumb=false（默认，详细页）时 img 也用母版。
 */
function photoHtml(c, sizeClass, useThumb) {
  const cls = 'char-photo' + (sizeClass ? ' ' + sizeClass : '');
  if (c.portrait) {
    const src = '../assets/' + c.portrait;
    const imgSrc = useThumb ? '../assets/' + thumbName(c.portrait) : src;
    return '<div class="' + cls + '">\n' +
      '            <button type="button" class="char-photo-btn" data-lightbox-src="' + src + '" data-lightbox-name="' + esc(c.name) + '" aria-label="查看' + esc(c.name) + '的立绘">\n' +
      '              <img src="' + imgSrc + '" loading="lazy" decoding="async" alt="' + esc(c.name) + '">\n' +
      '            </button>\n' +
      '          </div>';
  }
  return '<div class="' + cls + ' initial"><span>' + esc(c.initial || c.name[0]) + '</span></div>';
}

/* ---------- 页面骨架 ---------- */
const ASSET_V = detectAssetVersion();

function headBlock(title, description, ogTitle, ogDescription) {
  return '<!DOCTYPE html>\n' +
    '<html lang="zh-CN">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '  <meta name="theme-color" content="#f8f4ed">\n' +
    '  <meta name="description" content="' + esc(description) + '">\n' +
    '  <link rel="icon" href="../favicon.png" type="image/png">\n' +
    '  <link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">\n' +
    '  <title>' + esc(title) + '</title>\n' +
    '  <meta property="og:title" content="' + esc(ogTitle) + '">\n' +
    '  <meta property="og:description" content="' + esc(ogDescription || description) + '">\n' +
    '  <meta property="og:image" content="https://zephyrw.site/assets/og-cover.jpg">\n' +
    '  <meta property="og:type" content="article">\n' +
    '  <link rel="manifest" href="../manifest.json">\n' +
    '  <link rel="stylesheet" href="../css/style.css?v=' + ASSET_V + '">\n' +
    '  <script src="../js/theme.js?v=' + ASSET_V + '"></script>\n' +
    // 原生壳能力补丁（剪贴板 / 原生分享 / blob 导出）。必须紧跟 theme.js：
    // 它在浏览器里会立刻 return，只有壳内才改写 navigator 行为。
    '  <script src="../js/native-bridge.js?v=' + ASSET_V + '"></script>\n' +
    // 站内「新章节更新了」横幅（取 announce.json 与 localStorage 比对，每会话一次）。
    // defer：它只读 DOM 与 localStorage、往 body 补一条横幅，不参与首绘；
    // 留在 head 里同步加载会让正文白等一个网络往返（4G 实测首绘 +150~300ms）。
    '  <script src="../js/announce.js?v=' + ASSET_V + '" defer></script>\n' +
    // 点击即反馈：按下就在顶部点亮一条细线，盖住「跳转前的空窗期」。
    '  <script src="../js/nav-feedback.js?v=' + ASSET_V + '" defer></script>\n' +
    '</head>\n';
}

const TAB_BAR = [
  '  <nav class="tab-bar">',
  '    <a class="tab-item" href="../index.html">',
  '      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  '      <span>首页</span>',
  '    </a>',
  '    <a class="tab-item" href="index.html">',
  '      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4.5" width="5" height="15" rx="1"/><rect x="10" y="4.5" width="5" height="15" rx="1"/><path d="M16.6 5.7l3.5 1-3 13.4-3.5-1z"/></svg>',
  '      <span>书架</span>',
  '    </a>',
  '    <a class="tab-item active" href="characters.html">',
  '      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  '      <span>人物</span>',
  '    </a>',
  '    <a class="tab-item" href="../quotes.html">',
  '      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7H5a1 1 0 00-1 1v4a1 1 0 001 1h3v4l4-4V8a1 1 0 00-1-1H8z"/><path d="M19 7h-3a1 1 0 00-1 1v4a1 1 0 001 1h3v4l4-4V8a1 1 0 00-1-1h-3z" transform="translate(-3 0)"/></svg>',
  '      <span>剪贴本</span>',
  '    </a>',
  '  </nav>'
].join('\n');

const GROUP_NAMES = { xinlei: '新叶', qiaomu: '乔木' };

/* ---------- 1. 列表页 ---------- */
/* 滚动位置记忆（ES5，照顾老 WebView）：
   点进任何 character-*.html 之前，capture 阶段把当前 scrollY + 返回标记写进
   sessionStorage（capture 先于 transition.js 的接管，但两条路都在导航前执行，
   顺序无关）；列表页加载时见标记才恢复 —— 直接进列表 / 底部 tab 切换不受影响。
   卡片高度固定（.char-photo 48×56），恢复不依赖懒加载图；
   150ms × 6 次短重试只兜「布局比脚本晚一拍」的极端抖动，到位即停。 */
const LIST_SCROLL_SNIPPET = [
  '  <script>',
  '  (function () {',
  '    var KEY_Y = \'linyuan.charListY\';',
  '    var KEY_BACK = \'linyuan.charListBack\';',
  '    document.addEventListener(\'click\', function (e) {',
  '      var el = e.target;',
  '      while (el && el !== document && el.tagName !== \'A\') el = el.parentNode;',
  '      if (!el || el === document) return;',
  '      var href = el.getAttribute(\'href\') || \'\';',
  '      if (href.indexOf(\'character-\') !== 0) return;',
  '      try {',
  '        sessionStorage.setItem(KEY_Y, String(window.scrollY || window.pageYOffset || 0));',
  '        sessionStorage.setItem(KEY_BACK, \'1\');',
  '      } catch (err) {}',
  '    }, true);',
  '    var y = 0;',
  '    try {',
  '      if (sessionStorage.getItem(KEY_BACK) === \'1\') {',
  '        sessionStorage.removeItem(KEY_BACK);',
  '        y = parseInt(sessionStorage.getItem(KEY_Y) || \'0\', 10) || 0;',
  '      }',
  '    } catch (err) {}',
  '    if (!y) return;',
  '    if (\'scrollRestoration\' in history) history.scrollRestoration = \'manual\';',
  '    var tries = 0;',
  '    (function restore() {',
  '      window.scrollTo(0, y);',
  '      tries++;',
  '      var cur = window.scrollY || window.pageYOffset || 0;',
  '      if (Math.abs(cur - y) > 4 && tries < 6) setTimeout(restore, 150);',
  '    })();',
  '  })();',
  '  </script>'
].join('\n');

function buildListPage(chars) {
  const cards = [];
  let lastGroup = null;
  chars.forEach((c) => {
    if (c.group !== lastGroup) {
      lastGroup = c.group;
      cards.push('      <div class="char-group-label">' + GROUP_NAMES[c.group] + '</div>');
    }
    cards.push(
      '      <section class="character-card' + (c.primary ? ' primary' : '') + '">\n' +
      '        <div class="char-top">\n' +
      '          ' + photoHtml(c, '', true) + '\n' +
      '          <div class="char-id">\n' +
      '            <h2>' + esc(c.name) + '</h2>\n' +
      '            ' + tagChips(c) + '\n' +
      '          </div>\n' +
      '        </div>\n' +
      '        <div class="char-quote">' + esc(c.quote) + '</div>\n' +
      '        <p class="char-desc">' + esc(c.desc) + '</p>\n' +
      '        <a class="char-more" href="character-' + c.slug + '.html">详细' + CHEVRON_SVG + '</a>\n' +
      '      </section>'
    );
  });

  return headBlock('临渊羡鱼 - 同学录', '临渊羡鱼 - 同学录', '临渊羡鱼 · 同学录', '一页页翻过去，都是他们') +
    '<body class="tab-page-body">\n' +
    '  <div class="phone-frame">\n' +
    '\n' +
    '    <div class="detail-header">\n' +
    '      <a href="../index.html" class="detail-back">\n' +
    '        ' + BACK_SVG + '\n' +
    '      </a>\n' +
    '      <span class="detail-header-title">同学录</span>\n' +
    '    </div>\n' +
    '\n' +
    '    <div class="char-hero">\n' +
    '      <div class="char-hero-kicker">一页页翻过去</div>\n' +
    '      <h1 class="char-hero-title">都是他们</h1>\n' +
    '    </div>\n' +
    '\n' +
    '    <div class="character-list">\n' +
    '\n' +
    cards.join('\n\n') + '\n' +
    '\n' +
    '    </div>\n' +
    '\n' +
    '    <div class="home-footer">名字记住以后，故事就会自己发光</div>\n' +
    '\n' +
    '  </div>\n' +
    '\n' +
    TAB_BAR + '\n' +
    '  <script src="../js/lightbox.js?v=' + ASSET_V + '"></script>\n' +
    LIST_SCROLL_SNIPPET + '\n' +
    '</body>\n' +
    '</html>\n';
}

/* ---------- 2. 详细页 ---------- */
function buildDetailPage(c) {
  const birth = c.birthday ? birthdayText(c.birthday) : '';
  const bioParas = (c.bio || []).map((p) => '          <p>' + esc(p) + '</p>').join('\n');

  return headBlock(c.name + ' · 同学录 - 临渊羡鱼', c.name + ' - 临渊羡鱼', c.name + ' · 同学录', c.desc) +
    '<body class="tab-page-body">\n' +
    '  <div class="phone-frame">\n' +
    '\n' +
    '    <div class="detail-header">\n' +
    '      <a href="characters.html" class="detail-back">\n' +
    '        ' + BACK_SVG + '\n' +
    '      </a>\n' +
    '      <span class="detail-header-title">同学录</span>\n' +
    '    </div>\n' +
    '\n' +
    '    <article class="char-detail">\n' +
    '      <div class="char-detail-card">\n' +
    '        <div class="char-detail-top">\n' +
    '          ' + photoHtml(c, 'char-detail-photo') + '\n' +
    '          <div class="char-detail-id">\n' +
    '            <h1>' + esc(c.name) + '</h1>\n' +
    '            ' + tagChips(c) + '\n' +
    (birth ? '            <div class="char-detail-birth">' + birth + '</div>\n' : '') +
    '          </div>\n' +
    '        </div>\n' +
    '        <div class="char-quote char-detail-quote">' + esc(c.quote) + '</div>\n' +
    '      </div>\n' +
    '\n' +
    '      <div class="char-detail-section">\n' +
    '        <div class="char-detail-section-title">小传</div>\n' +
    '        <div class="char-detail-bio">\n' +
    bioParas + '\n' +
    '        </div>\n' +
    '      </div>\n' +
    '\n' +
    '      <div class="char-detail-section">\n' +
    '        <div class="char-detail-section-title">设定</div>\n' +
    '        <div class="char-tags char-detail-traits">' +
    (c.traits || []).map((t) => '<span class="char-tag">' + esc(t) + '</span>').join('') +
    '</div>\n' +
    '      </div>\n' +
    '    </article>\n' +
    '\n' +
    '    <div class="home-footer">名字记住以后，故事就会自己发光</div>\n' +
    '\n' +
    '  </div>\n' +
    '  <script src="../js/lightbox.js?v=' + ASSET_V + '"></script>\n' +
    '</body>\n' +
    '</html>\n';
}

/* ---------- 3. 主流程 ---------- */
const chars = readCharacters();

// 校验 slug 唯一、必填字段齐全
const seen = new Set();
chars.forEach((c) => {
  if (!c.slug || !/^[a-z][a-z0-9-]*$/.test(c.slug)) {
    throw new Error('slug 不合法（小写字母/数字/连字符）: ' + JSON.stringify(c.name));
  }
  if (seen.has(c.slug)) throw new Error('slug 重复: ' + c.slug);
  seen.add(c.slug);
  ['name', 'group', 'quote', 'desc'].forEach((k) => {
    if (!c[k]) throw new Error(c.slug + ' 缺少字段 ' + k);
  });
  if (!c.portrait && !c.initial) throw new Error(c.slug + ' 既没有 portrait 也没有 initial');
  if (c.portrait && !fs.existsSync(path.join(ROOT, 'assets', c.portrait))) {
    throw new Error(c.slug + ' 的立绘文件不存在：assets/' + c.portrait +
      '（先把图放进 assets/ 再跑本脚本）');
  }
  if (!Array.isArray(c.bio) || c.bio.length === 0) throw new Error(c.slug + ' 没有 bio');
});

// 0) 立绘缩略图就位（缺了/母版换新了就现画；画不了会带着手动命令报错）
ensureThumbs(chars);

// 写文件
const listPath = path.join(NOVEL_DIR, 'characters.html');
fs.writeFileSync(listPath, buildListPage(chars));
console.log('✓ 同学录列表页：novel/characters.html（' + chars.length + ' 人，立绘用 -thumb.webp）');

chars.forEach((c) => {
  const p = path.join(NOVEL_DIR, 'character-' + c.slug + '.html');
  fs.writeFileSync(p, buildDetailPage(c));
});
console.log('✓ 人物详细页：novel/character-*.html × ' + chars.length);

// 登记预缓存（详细页 + 立绘缩略图 + 三位主角母版）+ 升 CACHE 名
// 立绘也要登记：漏了就是「离线打开同学录，新人物是破图」。文件名不带 ?v=，
// 全靠 PRECACHE 保证首次安装时就进缓存。
//   - 缩略图（-thumb.webp）：列表页首屏就要画，17 张全登记；
//   - 母版（-1024.webp）：只保留 primary 三位主角（林纾/叶南衡/江不秋，
//     合计约 490KB）—— 灯箱全屏与 3x 捏合的清晰度靠它。其余 14 人的母版
//     不预缓存：详细页/灯箱打开时才按需拉，cacheFirst 会写回缓存。
let sw = fs.readFileSync(SW_JS, 'utf8');
const anchor = "  '/novel/characters.html'";
if (sw.indexOf(anchor) === -1) throw new Error('sw.js 里找不到 PRECACHE 的 characters.html 条目');
const toAdd = chars
  .map((c) => "  '/novel/character-" + c.slug + ".html',")
  .filter((e) => sw.indexOf(e) === -1);
const thumbsToAdd = chars
  .filter((c) => c.portrait)
  .map((c) => "  '/assets/" + thumbName(c.portrait) + "',")
  .filter((e) => sw.indexOf(e) === -1);
const mastersToAdd = chars
  .filter((c) => c.portrait && c.primary)
  .map((c) => "  '/assets/" + c.portrait + "',")
  .filter((e) => sw.indexOf(e) === -1);
const precacheAdded = toAdd.length + thumbsToAdd.length + mastersToAdd.length;
if (precacheAdded > 0) {
  sw = sw.replace(anchor, anchor + ',\n' + toAdd.concat(thumbsToAdd, mastersToAdd).join('\n'));
  const m = sw.match(/var CACHE = '([a-z-]+)-v(\d+)'/);
  if (m) {
    const next = m[1] + '-v' + (parseInt(m[2], 10) + 1);
    sw = sw.replace(/var CACHE = '[a-z-]+-v\d+'/, "var CACHE = '" + next + "'");
    console.log('🔁 SW 缓存名 → ' + next + '（老用户的 SW 才会重新 install）');
  }
  fs.writeFileSync(SW_JS, sw);
  console.log('📦 已登记预缓存 ' + precacheAdded +
    ' 条（详细页 ' + toAdd.length + ' · 缩略图 ' + thumbsToAdd.length + ' · 主角母版 ' + mastersToAdd.length + '）');
} else {
  console.log('· 预缓存已全部登记，CACHE 名未动');
}

// 4) 刷新 sitemap.xml：人物详细页是 sitemap 的一部分，漏刷新 = 新人物不被收录。
//    spawnSync 调同一个 node（本脚本 ESM、sitemap 工具也是 ESM，直接 import 会
//    把「生成 sitemap」和「生成页面」耦合成本次运行的硬依赖；子进程失败只警告，
//    页面产物已经落盘，不该被一篇 sitemap 拖死）。
const sitemapTool = path.join(ROOT, 'tools', 'make-sitemap.mjs');
const sitemapRun = spawnSync(process.execPath, [sitemapTool], { stdio: 'inherit', cwd: ROOT });
if (sitemapRun.status !== 0) {
  console.error('⚠ sitemap.xml 刷新失败（页面已生成，不影响阅读）。请手动跑:');
  console.error('    node tools/make-sitemap.mjs');
}

console.log('\n下一步：');
console.log('  1) node tools/bump-assets.mjs --write   # 升全站 ?v=（CSS 若改了必须升）');
console.log('  2) node tools/check-precache.mjs && node tools/e2e.mjs');
console.log('  3) git add -A && git commit && git push');
