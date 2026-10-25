#!/usr/bin/env node
/**
 * tools/make-sitemap.mjs — 从数据源生成 sitemap.xml
 *
 * 为什么需要它：sitemap.xml 原来是手维护的 5 条，新章节 / 新人物页全靠人记着补。
 * 漏一条 = 那个页面不被搜索引擎收录，而且没有任何报错。本工具把「章节」与
 * 「人物页」两类会随内容增长的页面都从唯一数据源读出来，加上固定清单，一次生成。
 *
 * 数据源：
 *   js/chapters.js        的 CHAPTERS 数组（num/title/file）
 *   js/characters-data.js 的 CHARACTERS 数组（slug）
 *   固定清单：/、/novel/、/quotes.html、/novel/characters.html
 *
 * <lastmod> 取值（刻意不用「今天」——那等于每跑一次都告诉搜索引擎全站刚改过）：
 *   章节        → manuscript/chapter-NN.md 的 mtime（这一章正文的真实最后修改时间；
 *                  章节页是从它生成的，它才是最贴近「内容何时变」的文件）
 *   人物详细页  → js/characters-data.js 的 mtime（17 个详情页的共同内容源）
 *   固定清单页  → 对应页面文件自身的 mtime
 *   注意：git 不保留 mtime，刚 clone 的仓库里所有文件都是 checkout 时间，
 *         此时 lastmod 会整体偏新但不颠倒先后 —— 可接受，且远好过写死「今天」。
 *
 * changefreq / priority（贴合实际更新频率：章节随写作增长，人物设定极少动）：
 *   /                        weekly  1.0
 *   /novel/                  weekly  0.9
 *   /novel/chapter-NN.html   monthly 0.8
 *   /novel/characters.html   monthly 0.6
 *   /novel/character-*.html  monthly 0.5
 *   /quotes.html             weekly  0.7
 *
 * 用法：node tools/make-sitemap.mjs
 * 由 new-chapter.js（新增章节后）与 tools/make-characters.mjs（重生成人物页后）
 * 自动调用，保持「跑一个命令、产物全齐」。零依赖，与操作系统无关。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const BASE = 'https://zephyrw.site';

/* ---------- 读数据源（与 make-characters.mjs 同一手法：vm 求值数组字面量） ---------- */
function readArray(jsPath, varName) {
  const src = fs.readFileSync(jsPath, 'utf8');
  const start = src.indexOf('var ' + varName + ' = [');
  if (start < 0) throw new Error(jsPath + ' 里找不到 ' + varName + ' 数组');
  const open = src.indexOf('[', start);
  const end = src.indexOf('\n];', open);
  if (end < 0) throw new Error(varName + ' 数组没有正常结束');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('result = ' + src.slice(open, end + 2), sandbox);
  if (!Array.isArray(sandbox.result)) throw new Error(varName + ' 不是数组');
  return sandbox.result;
}

/** 文件 mtime → YYYY-MM-DD（UTC，避免跨机器时区把日期蹭偏一天）；文件不存在返回 null */
function lastmodOf(file) {
  if (!file || !fs.existsSync(file)) return null;
  return new Date(fs.statSync(file).mtimeMs).toISOString().slice(0, 10);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]
));

/* ---------- 汇总条目 ---------- */
const chapters = readArray(path.join(ROOT, 'js', 'chapters.js'), 'CHAPTERS');
const characters = readArray(path.join(ROOT, 'js', 'characters-data.js'), 'CHARACTERS');
const charsDataMtime = lastmodOf(path.join(ROOT, 'js', 'characters-data.js'));

/** @type {Array<{loc: string, lastmod: string|null, changefreq: string, priority: string}>} */
const urls = [];

// 固定清单
urls.push({ loc: '/', lastmod: lastmodOf(path.join(ROOT, 'index.html')), changefreq: 'weekly', priority: '1.0' });
urls.push({ loc: '/novel/', lastmod: lastmodOf(path.join(ROOT, 'novel', 'index.html')), changefreq: 'weekly', priority: '0.9' });

// 章节（按 num 排序，lastmod 取源稿 mtime）
chapters
  .slice()
  .sort((a, b) => a.num - b.num)
  .forEach((c) => {
    const md = path.join(ROOT, 'manuscript', String(c.file).replace(/\.html$/, '.md'));
    urls.push({
      loc: '/novel/' + c.file,
      lastmod: lastmodOf(md) || lastmodOf(path.join(ROOT, 'novel', c.file)),
      changefreq: 'monthly',
      priority: '0.8'
    });
  });

// 同学录列表页 + 每个人的详细页（顺序与 characters-data.js 一致）
urls.push({ loc: '/novel/characters.html', lastmod: charsDataMtime, changefreq: 'monthly', priority: '0.6' });
characters.forEach((c) => {
  urls.push({ loc: '/novel/character-' + c.slug + '.html', lastmod: charsDataMtime, changefreq: 'monthly', priority: '0.5' });
});

// 剪贴本
urls.push({ loc: '/quotes.html', lastmod: lastmodOf(path.join(ROOT, 'quotes.html')), changefreq: 'weekly', priority: '0.7' });

/* ---------- 输出（2 空格缩进，与既有 sitemap.xml 风格一致） ---------- */
const blocks = urls.map((u) => [
  '  <url>',
  '    <loc>' + esc(BASE + u.loc) + '</loc>',
  u.lastmod ? '    <lastmod>' + u.lastmod + '</lastmod>' : null,
  '    <changefreq>' + u.changefreq + '</changefreq>',
  '    <priority>' + u.priority + '</priority>',
  '  </url>'
].filter(Boolean).join('\n'));

const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  blocks.join('\n') + '\n' +
  '</urlset>\n';

const before = fs.existsSync(SITEMAP) ? fs.readFileSync(SITEMAP, 'utf8') : null;
if (before === xml) {
  console.log('· sitemap.xml 已是最新（' + urls.length + ' 条），未改动');
} else {
  fs.writeFileSync(SITEMAP, xml);
  console.log('✓ sitemap.xml 已生成：' + urls.length + ' 条' +
    '（章节 ' + chapters.length + ' · 人物详细页 ' + characters.length + ' · 固定页 4）');
  const noLastmod = urls.filter((u) => !u.lastmod).length;
  if (noLastmod) console.log('⚠ ' + noLastmod + ' 条没有 lastmod（对应文件不存在）');
}
