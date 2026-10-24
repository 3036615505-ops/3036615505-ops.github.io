#!/usr/bin/env node
/**
 * tools/bump-assets.mjs — 统一递增全站静态资源的 ?v= 版本号
 *
 * 为什么需要它：本站的 SW 对 CSS/JS 走「缓存优先」，而 ?v= 就是唯一的
 * 缓存失效机制。手工递增 6 个 HTML、16 处引用，漏一处就有人继续吃旧缓存，
 * 而且症状是「我明明发了版，怎么还是旧的」，很难查。
 *
 * 行为：
 *   1. 扫描 --dir 下所有 .html，收集其中 ?v=N 的取值，取**最大值 +1** 作为新版本
 *   2. 把所有 ?v=<任意数字> 一次性替换成 ?v=<新版本>
 *   3. 打印每个文件的替换处数与合计
 *   4. 默认 dry-run（只报告不改），加 --write 才真正写盘
 *   **不会自动 git commit** —— 提交信息由人写。
 *
 * 用法：
 *   node tools/bump-assets.mjs                 # 看看会改成什么（dry-run）
 *   node tools/bump-assets.mjs --write         # 真的改
 *   node tools/bump-assets.mjs --write --to 30 # 指定目标版本（少用，慎用）
 *   node tools/bump-assets.mjs --check         # CI 用：若存在多个不同版本则退出码 1
 *
 * 注意：Git Bash 会把 `--dir /foo` 这类以斜杠开头的参数改写成 Windows 路径，
 * 所以 --dir 请用相对路径（默认就是仓库根）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const has = (f) => argv.includes('--' + f);
const val = (f, d) => {
  const i = argv.indexOf('--' + f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const DIR = path.resolve(ROOT, val('dir', '.').replace(/\\/g, '/'));
const WRITE = has('write');
const CHECK_ONLY = has('check');
const FORCE_TO = val('to', null);

/** 递归收集 .html */
function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.html?$/i.test(name)) out.push(p);
  }
  return out;
}

const VER_RE = /\?v=(\d+)/g;

const files = walk(DIR).sort();
if (!files.length) {
  console.error('没找到任何 .html，检查 --dir');
  process.exit(1);
}

/* 1) 收集现有版本 */
const versions = new Set();
const perFile = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const found = [...src.matchAll(VER_RE)].map((m) => Number(m[1]));
  found.forEach((n) => versions.add(n));
  perFile.push({ file: f, src, count: found.length, versions: [...new Set(found)].sort((a, b) => a - b) });
}

const list = [...versions].sort((a, b) => a - b);
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

if (CHECK_ONLY) {
  console.log(`扫描 ${files.length} 个 HTML，发现版本号: ${list.length ? list.join(', ') : '(无)'}`);
  perFile.forEach((x) => {
    if (x.count) console.log(`  ${rel(x.file).padEnd(26)} ${String(x.count).padStart(2)} 处  v=${x.versions.join(',')}`);
  });
  if (list.length > 1) {
    console.error(`\n✗ 存在 ${list.length} 个不同版本（${list.join(', ')}），会出现混版缓存，请统一`);
    process.exit(1);
  }
  console.log('\n✓ 版本号统一');
  process.exit(0);
}

if (!list.length) {
  console.error('一个 ?v= 都没找到，没什么可 bump 的');
  process.exit(1);
}

const cur = list[list.length - 1];
const next = FORCE_TO !== null ? Number(FORCE_TO) : cur + 1;
if (!Number.isInteger(next) || next <= 0) {
  console.error('--to 必须是正整数');
  process.exit(1);
}
if (next <= cur && FORCE_TO === null) {
  console.error(`目标版本 ${next} 不大于当前 ${cur}，拒绝回退`);
  process.exit(1);
}

console.log(`当前版本: ${cur}（全站取值 ${list.join(', ')}）`);
console.log(`目标版本: ${next}`);
if (list.length > 1) console.log(`⚠ 原本就存在混版（${list.join(', ')}），本次会一并统一到 ${next}`);
console.log('');

let total = 0;
const results = [];
for (const x of perFile) {
  let n = 0;
  const out = x.src.replace(VER_RE, () => { n += 1; return '?v=' + next; });
  total += n;
  results.push({ file: rel(x.file), n });
  if (WRITE && n) fs.writeFileSync(x.file, out, 'utf8');
}

const width = Math.max(...results.map((r) => r.file.length), 10);
for (const r of results) {
  console.log(`  ${r.file.padEnd(width)}  ${r.n ? String(r.n).padStart(2) + ' 处' : '—'}`);
}
console.log(`\n合计替换 ${total} 处（${results.filter((r) => r.n).length} 个文件）`);
console.log(WRITE ? `✓ 已写入，全部为 ?v=${next}` : '（dry-run，未写盘；加 --write 才生效）');
/* 这条命令是纯 Node 读写，跟操作系统无关 —— Mac / Windows / Linux 都能跑。
   之前有人因为「版本号要在某台机器上改」的说法绕了远路，其实只有打 APK
   才受限于 Android SDK 装在哪台机器。 */
console.log('  （本命令与操作系统无关，任何装了 Node 的机器都能执行；只有打 APK 才受限于 SDK 所在机器）');
if (WRITE) {
  console.log('\n下一步：');
  console.log(`  1) 若改了 sw.js 的 PRECACHE，记得同步 CACHE 版本`);
  console.log(`  2) node tools/check-precache.mjs   # 确认预缓存条目都存在`);
  console.log(`  3) git add -A && git commit && git push`);
}
