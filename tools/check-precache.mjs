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
const needed = [
  ['/js/transition.js', ['index.html', 'novel/index.html', 'novel/chapter-01.html', 'novel/chapter-02.html']],
  ['/js/reader.js', ['novel/chapter-01.html', 'novel/chapter-02.html']],
  ['/js/chapters.js', ['index.html', 'novel/index.html', 'novel/chapter-01.html', 'novel/chapter-02.html']]
];
console.log('\n脚本引用自检：');
let refMissing = 0;
for (const [asset, pages] of needed) {
  const name = path.basename(asset);
  const absent = pages.filter((p) => {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    return html.indexOf(name) === -1;
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
console.log('\n✓ 预缓存条目全部存在，脚本引用齐全');
