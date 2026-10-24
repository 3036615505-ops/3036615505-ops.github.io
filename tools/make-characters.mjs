#!/usr/bin/env node
/**
 * tools/make-characters.mjs —— 从 js/characters-data.js 生成同学录
 *
 * 产物：
 *   novel/characters.html        同学录列表页（整页生成，别手改）
 *   novel/character-<slug>.html  每个人的详细页
 *
 * 另外自动做两件以前靠人记的事（和 new-chapter.js 一致）：
 *   - 把新详细页登记进 sw.js 的 PRECACHE（漏了 = 离线打不开详细页）
 *   - 把 sw.js 的 CACHE 名 +1（不升 = 老用户的 SW 不会重新 install）
 *
 * 用法：node tools/make-characters.mjs
 * 改人物信息请改 js/characters-data.js，不要改生成出来的 HTML。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
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

/** '2007.04.20' → '二〇〇七年四月二十日' */
function birthdayText(raw) {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(String(raw).trim());
  if (!m) return '';
  const year = m[1].split('').map((d) => CN_DIGIT[+d]).join('');
  return year + '年' + cnNumber(+m[2]) + '月' + cnNumber(+m[3]) + '日';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]
  ));
}

const BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">\n          <polyline points="15 18 9 12 15 6"></polyline>\n        </svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';

function tagChips(c, cls) {
  const items = [];
  (c.tags || []).forEach((t) => items.push('<span class="char-tag">' + esc(t) + '</span>'));
  if (c.role) items.push('<span class="char-tag role">' + esc(c.role) + '</span>');
  return '<div class="char-tags' + (cls ? ' ' + cls : '') + '">\n' +
    items.map((s) => '              ' + s).join('\n') + '\n' +
    '            </div>';
}

/** 头像：有立绘走灯箱按钮，没有走姓氏占位（与旧页面完全一致的结构） */
function photoHtml(c, sizeClass) {
  const cls = 'char-photo' + (sizeClass ? ' ' + sizeClass : '');
  if (c.portrait) {
    const src = '../assets/' + c.portrait;
    return '<div class="' + cls + '">\n' +
      '            <button type="button" class="char-photo-btn" data-lightbox-src="' + src + '" data-lightbox-name="' + esc(c.name) + '" aria-label="查看' + esc(c.name) + '的立绘">\n' +
      '              <img src="' + src + '" loading="lazy" decoding="async" alt="' + esc(c.name) + '">\n' +
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
    '  <title>' + esc(title) + '</title>\n' +
    '  <meta property="og:title" content="' + esc(ogTitle) + '">\n' +
    '  <meta property="og:description" content="' + esc(ogDescription || description) + '">\n' +
    '  <meta property="og:image" content="https://zephyrw.site/assets/og-cover.jpg">\n' +
    '  <meta property="og:type" content="article">\n' +
    '  <link rel="manifest" href="../manifest.json">\n' +
    '  <link rel="stylesheet" href="../css/style.css?v=' + ASSET_V + '">\n' +
    '  <script src="../js/theme.js?v=' + ASSET_V + '"></script>\n' +
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
      '          ' + photoHtml(c) + '\n' +
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

// 写文件
const listPath = path.join(NOVEL_DIR, 'characters.html');
fs.writeFileSync(listPath, buildListPage(chars));
console.log('✓ 同学录列表页：novel/characters.html（' + chars.length + ' 人）');

chars.forEach((c) => {
  const p = path.join(NOVEL_DIR, 'character-' + c.slug + '.html');
  fs.writeFileSync(p, buildDetailPage(c));
});
console.log('✓ 人物详细页：novel/character-*.html × ' + chars.length);

// 登记预缓存（详细页 + 立绘）+ 升 CACHE 名
// 立绘也要登记：漏了就是「离线打开同学录，新人物是破图」。文件名不带 ?v=，
// 全靠 PRECACHE 保证首次安装时就进缓存。
let sw = fs.readFileSync(SW_JS, 'utf8');
const anchor = "  '/novel/characters.html'";
if (sw.indexOf(anchor) === -1) throw new Error('sw.js 里找不到 PRECACHE 的 characters.html 条目');
const toAdd = chars
  .map((c) => "  '/novel/character-" + c.slug + ".html',")
  .filter((e) => sw.indexOf(e) === -1);
const portraitsToAdd = chars
  .filter((c) => c.portrait)
  .map((c) => "  '/assets/" + c.portrait + "',")
  .filter((e) => sw.indexOf(e) === -1);
if (toAdd.length || portraitsToAdd.length) {
  sw = sw.replace(anchor, anchor + ',\n' + toAdd.concat(portraitsToAdd).join('\n'));
  const m = sw.match(/var CACHE = '([a-z-]+)-v(\d+)'/);
  if (m) {
    const next = m[1] + '-v' + (parseInt(m[2], 10) + 1);
    sw = sw.replace(/var CACHE = '[a-z-]+-v\d+'/, "var CACHE = '" + next + "'");
    console.log('🔁 SW 缓存名 → ' + next + '（老用户的 SW 才会重新 install）');
  }
  fs.writeFileSync(SW_JS, sw);
  console.log('📦 已登记预缓存 ' + (toAdd.length + portraitsToAdd.length) +
    ' 条（详细页 ' + toAdd.length + ' · 立绘 ' + portraitsToAdd.length + '）');
} else {
  console.log('· 预缓存已全部登记，CACHE 名未动');
}

console.log('\n下一步：');
console.log('  1) node tools/bump-assets.mjs --write   # 升全站 ?v=（CSS 若改了必须升）');
console.log('  2) node tools/check-precache.mjs && node tools/e2e.mjs');
console.log('  3) git add -A && git commit && git push');
