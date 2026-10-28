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
 *   node tools/bump-assets.mjs --stale         # 发版用：资源内容变了但 ?v=/?f= 没变 → 退出码 1
 *   node tools/bump-assets.mjs --stale --since origin/main~3   # 指定比较基准
 *
 * 注意：Git Bash 会把 `--dir /foo` 这类以斜杠开头的参数改写成 Windows 路径，
 * 所以 --dir 请用相对路径（默认就是仓库根）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
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
const STALE = has('stale');
const SINCE = val('since', null);
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

/* ---------- --stale：内容变了，但缓存键没变 ----------
 *
 * --check 只看「HTML 里的 ?v= 是否统一」，**完全不比对文件内容**。
 * 于是有人改了 style.css 却忘了 +1，全站 ?v= 依然统一 → 五项检查全绿 → 发版 →
 * 老读者拿旧 CSS 配新 HTML。这类失效是静默的：只有别人的手机上才看得出来。
 * 2026-10-28 那次给 style.css 加 57 行注释，就是靠人工做「去注释后逐字节比对」
 * 才证明「渲染没变、不升版是对的」。这里把那次的判断固化成代码。
 *
 * 设计取舍：
 *   · 基准取 **git 里的旧提交**，不另造 sha256 清单文件 ——
 *     清单本身会成为第二个需要保鲜的数据源，正是这轮刚立下的「状态只留一个出处」要防的。
 *   · 比较的是「工作区 vs 基准提交」：提交前就能查出来，pre-push（此时工作区=HEAD）也适用。
 *   · 只认带缓存键的引用：HTML 的 ?v=、CSS 里的 ?f=（字体）。
 *     没缓存键的资源（sw.js 自更新、og 图）本来就不受这机制管辖。
 *   · CSS 先剥注释并归一空白再比 —— **只改注释不该被拦**。
 *   · JS 不剥注释：改 JS 一律要求升版，宁可多一次 bump，也不要漏掉一次真实改动。
 *   · 找不到基准 ref 时**不拦**（退出码 0），绝不因为「git 状态不认识」堵住发版。
 */
const sha12 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

/** CSS 去注释 + 空白归一。字符串里的空白有意义（content: "a  b"），所以串内原样保留。 */
function stripCssComments(s) {
  let out = '';
  let i = 0;
  let state = 0; /* 0 普通 / 1 双引号串 / 2 单引号串 / 3 注释 */
  let space = false;
  const push = (ch) => { if (space) { out += ' '; space = false; } out += ch; };
  while (i < s.length) {
    const c = s[i];
    const d = s[i + 1];
    if (state === 3) {
      if (c === '*' && d === '/') { state = 0; i += 2; } else i += 1;
      continue;
    }
    if (state === 0) {
      if (c === '/' && d === '*') { state = 3; i += 2; continue; }
      if (c === '"') { state = 1; push(c); i += 1; continue; }
      if (c === "'") { state = 2; push(c); i += 1; continue; }
      if (/\s/.test(c)) { space = true; i += 1; continue; }
      push(c); i += 1; continue;
    }
    /* 串内：逐字复制，含空白与转义 */
    if (c === '\\') { out += c + (d === undefined ? '' : d); i += 2; continue; }
    if ((state === 1 && c === '"') || (state === 2 && c === "'")) state = 0;
    out += c; i += 1;
  }
  return out.trim();
}

function gitText(args) {
  return execFileSync('git', args, {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']
  });
}
function gitBytes(args) {
  return execFileSync('git', args, {
    cwd: ROOT, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore']
  });
}
function refExists(ref) {
  try { gitText(['rev-parse', '--verify', '--quiet', ref + '^{commit}']); return true; } catch { return false; }
}
function readAt(rev, p) {
  try { return gitBytes(['cat-file', 'blob', `${rev}:${p}`]); } catch { return null; }
}
/** 从一段文本里抽出带缓存键的资源引用，返回仓库相对路径 + 版本值 */
function keyedRefs(text, baseDir, isCss) {
  const out = [];
  const re = isCss
    ? /url\(\s*(['"]?)([^'")]+)\1\s*\)/g
    : /(?:src|href)\s*=\s*"([^"]+)"/g;
  for (const m of text.matchAll(re)) {
    const raw = (isCss ? m[2] : m[1]).trim();
    const q = raw.match(/\?([vf])=(\d+)/);
    if (!q) continue;
    const clean = raw.split('?')[0];
    if (!/\.(css|js|woff2?|webp|png|jpe?g|svg)$/i.test(clean)) continue;
    const relPath = path.relative(ROOT, path.resolve(ROOT, baseDir, clean)).replace(/\\/g, '/');
    if (relPath.startsWith('..')) continue;
    out.push({ path: relPath, tag: q[1] + '=' + q[2] });
  }
  return out;
}
function walkByExt(dir, re, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkByExt(p, re, out);
    else if (re.test(name)) out.push(p);
  }
  return out;
}

if (STALE) process.exit(staleCheck());

function staleCheck() {
  let base = SINCE;
  if (!base) {
    for (const cand of ['@{upstream}', 'origin/main', 'origin/master']) {
      if (refExists(cand)) { base = cand; break; }
    }
  }
  if (!base || !refExists(base)) {
    console.log('⚠ --stale 跳过：找不到比较基准（--since / @{upstream} / origin/main 都不可用）');
    return 0;
  }
  const baseFull = gitText(['rev-parse', base]).trim();
  const headFull = gitText(['rev-parse', 'HEAD']).trim();
  const short = (s) => s.slice(0, 7);
  /* 这里**不能**因为「基准 == HEAD」就提前返回：改了 CSS 但还没提交时，
     两者确实相同，而正是这种时候最容易忘了 +1。一律比到底。 */

  /* 基准侧：从 git 树里读（HTML 与 CSS 的引用都要看，字体缓存键写在 CSS 里） */
  const baseRefs = new Map();
  for (const f of gitText(['ls-tree', '-r', '--name-only', base]).split('\n').map((s) => s.trim())) {
    if (!/\.(html|css)$/i.test(f)) continue;
    const buf = readAt(base, f);
    if (!buf) continue;
    for (const r of keyedRefs(buf.toString('utf8'), path.posix.dirname(f), /\.css$/i.test(f))) {
      if (!baseRefs.has(r.path)) baseRefs.set(r.path, new Set());
      baseRefs.get(r.path).add(r.tag);
    }
  }

  /* 工作区侧 */
  const headRefs = new Map();
  const headSources = [
    ...walkByExt(DIR, /\.html?$/i).map((f) => ({ f, isCss: false })),
    ...walkByExt(DIR, /\.css$/i).map((f) => ({ f, isCss: true }))
  ];
  for (const { f, isCss } of headSources) {
    const relPath = rel(f);
    for (const r of keyedRefs(fs.readFileSync(f, 'utf8'), path.posix.dirname(relPath), isCss)) {
      if (!headRefs.has(r.path)) headRefs.set(r.path, new Set());
      headRefs.get(r.path).add(r.tag);
    }
  }

  const stale = [];
  let checked = 0;
  for (const [p, headVers] of headRefs) {
    const baseVers = baseRefs.get(p);
    if (!baseVers) continue; /* 新增资源：没有基线可比 */
    const hb = fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p)) : null;
    const bb = readAt(base, p);
    if (!hb || !bb) continue; /* 本次删除的资源 */
    checked += 1;
    const isCss = /\.css$/i.test(p);
    const id = (buf) => {
      if (!/\.(css|js)$/i.test(p)) return sha12(buf);            /* 二进制按原字节比 */
      /* 行尾先归一：本机有些老文件工作区还是 CRLF（.gitattributes 只管新 checkout），
         而 CRLF/LF 对 JS/CSS 的行为毫无差别，不归一就会天天假红。 */
      const t = buf.toString('utf8').replace(/\r\n/g, '\n');
      return sha12(Buffer.from(isCss ? stripCssComments(t) : t, 'utf8'));
    };
    const verSame = [...headVers].sort().join() === [...baseVers].sort().join();
    if (id(hb) !== id(bb) && verSame) {
      stale.push({ p, tag: [...headVers].join(',') });
    }
  }

  console.log(`比较基准: ${base} (${short(baseFull)})   工作区: HEAD ${short(headFull)}`);
  console.log(`扫描 ${headSources.length} 个 HTML/CSS → ${checked} 个带缓存键的资源参与比对`);

  if (!stale.length) {
    console.log('\n✓ 内容与缓存键同步');
    return 0;
  }

  console.error('\n✗ 以下资源内容变了，但缓存键没变（老读者会继续吃旧文件）：');
  const w = Math.max(...stale.map((s) => s.p.length));
  for (const s of stale) {
    console.error(`   ${s.p.padEnd(w)}   ?${s.tag} 未变`);
  }
  console.error('   → 修：node tools/bump-assets.mjs --write        （全站 +1 并统一替换）');
  console.error('   → 若这次改动不影响渲染/行为（只改注释、纯数据整理等），显式放行：');
  console.error('        ASSET_STALE_OK=1 node tools/bump-assets.mjs --stale');
  console.error('      并在提交信息里写清为什么不需要升版。');
  if (process.env.ASSET_STALE_OK) {
    console.error('\n（ASSET_STALE_OK 已设置，本次放行）');
    return 0;
  }
  return 1;
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
