#!/usr/bin/env node
/**
 * tools/check-storage-boundary.mjs — 存储「单入口」约定的棘轮守卫
 *
 *   node tools/check-storage-boundary.mjs               # 检查（pre-push / CI 用这个）
 *   node tools/check-storage-boundary.mjs --write       # 把基线下调到当前实际值
 *   node tools/check-storage-boundary.mjs --self-test   # 故意红：确认守卫不是「瞎」的
 *
 * 守的是什么
 *   README 写的是「js/reader.store.js 是所有 localStorage 读写的唯一入口」。
 *   2026-11-24 实测：运行时代码里 localStorage 直写共 65 处，store 只占 12 处，
 *   其余分布在 reader.ui.js / reader.engine.js / 三个页面的内联脚本 / announce.js /
 *   theme.js 里。首页的内联脚本还用 chapters.js 的 getChapterStorageId() 自己拼键名，
 *   与 store 是两套推导。后果：reader-schema 升版时，store 管得到的键会迁移，
 *   其余不会 —— 首页进度树、继续阅读卡可能在迁移后静默归零。
 *
 * 为什么是棘轮而不是一次性收口
 *   一次性收口等于把 53 处读写全部改道，那是阅读器内部的一轮重构，风险与收益
 *   不匹配，也没有用户可见的问题要修。棘轮的做法是：先保证它不再变坏，之后每
 *   改到某个面板时顺手换成 store 的读写函数，基线随之下调。
 *
 * 判定
 *   - 统计范围：js/*.js（不含 types.d.ts）与仓库里全部 *.html 的内联脚本；
 *     tools/、docs/、content/、app/ 不算运行时代码，不统计。
 *   - 计数对象：localStorage.getItem / setItem / removeItem 调用，
 *     以及 localStorage[...] = … 这种下标直写。
 *   - js/reader.store.js 是入口本身，不设上限。
 *   - 其余每个文件的实际次数 ≤ 基线即通过；严格小于基线时提示可以下调基线。
 *   - 出现基线里没有的新文件（且次数 > 0）一律失败：新代码没有理由绕开 store。
 *   - 注释里的字样不计数（整行以 // 或 * 开头的行跳过）。
 *
 * 退出码：0 通过；1 有文件超出基线。基线文件：tools/storage-boundary.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'tools', 'storage-boundary.json');
const ENTRY = 'js/reader.store.js'; /* 入口本身 */
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tools', 'docs', 'content', 'app', 'assets', 'manuscript', '_perf', '_design']);
const args = new Set(process.argv.slice(2));

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      walk(path.join(dir, ent.name), out);
    } else if (/\.(js|html)$/.test(ent.name) && ent.name !== 'types.d.ts') {
      out.push(path.join(dir, ent.name));
    }
  }
  return out;
}

const CALL = /localStorage\s*\.\s*(?:getItem|setItem|removeItem)\s*\(/g;
const INDEX = /localStorage\s*\[[^\]]+\]\s*=[^=]/g;

/** 一个文件里运行时的直写次数（整行注释跳过） */
function countFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let n = 0;
  for (const raw of lines) {
    const t = raw.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    const code = raw.replace(/\/\*.*?\*\//g, '');
    n += (code.match(CALL) || []).length + (code.match(INDEX) || []).length;
  }
  return n;
}

function collect() {
  const counts = {};
  for (const f of walk(ROOT, [])) {
    const rel = path.relative(ROOT, f).split(path.sep).join('/');
    const n = countFile(f);
    if (n) counts[rel] = n;
  }
  return counts;
}

const current = collect();
/* 每次都从 current 现算，不要在模块顶层缓存成常量：
   --self-test 的第 ③ 项会往 current 里塞一个假文件，缓存住的列表看不到它。 */
const outside = () => Object.entries(current).filter(([f]) => f !== ENTRY);

if (args.has('--write')) {
  const baseline = {};
  for (const [f, n] of outside().sort((a, b) => a[0].localeCompare(b[0]))) baseline[f] = n;
  const text = JSON.stringify(baseline, null, 2) + '\n';
  if (fs.existsSync(BASELINE_PATH) && fs.readFileSync(BASELINE_PATH, 'utf8') === text) {
    console.log('基线已是最新，未改动 tools/storage-boundary.json');
  } else {
    fs.writeFileSync(BASELINE_PATH, text);
    console.log('已写入 tools/storage-boundary.json（store 之外合计 ' + total(outside()) + ' 处）');
  }
  process.exit(0);
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('✗ 找不到 tools/storage-boundary.json。先生成基线：node tools/check-storage-boundary.mjs --write');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

/** 在给定基线下检查，返回问题列表（空数组 = 通过） */
function judge(baseline) {
  const problems = [];
  for (const [file, n] of outside()) {
    const cap = baseline[file];
    if (cap === undefined) problems.push({ kind: 'new', file, n });
    else if (n > cap) problems.push({ kind: 'over', file, n, cap });
  }
  for (const file of Object.keys(baseline)) {
    if (!(file in current)) problems.push({ kind: 'gone', file, cap: baseline[file] });
  }
  return problems;
}
const total = (rows) => rows.reduce((s, [, n]) => s + n, 0);

if (args.has('--self-test')) {
  const baseline = loadBaseline();
  const real = judge(baseline);
  console.log('故意红自测（storage-boundary）：');
  console.log(`  ${real.length ? '✗' : '✓'} ① 当前代码对真实基线：${real.length ? '不应失败却失败了' : '通过'}`);
  /* ② 把某个文件的基线人为调低 1，必须被检出 */
  const victim = Object.keys(baseline).sort((a, b) => baseline[b] - baseline[a])[0];
  const lowered = { ...baseline, [victim]: baseline[victim] - 1 };
  const caught = judge(lowered);
  console.log(`  ${caught.length ? '✓' : '✗'} ② 把 ${victim} 的基线调低 1 → ${caught.length ? '被检出' : '没检出'}`);
  /* ③ 在内存里「新增」一个绕开 store 的文件，必须被检出 */
  current['js/__not_real__.js'] = 1;
  const newCaught = judge(baseline).filter((p) => p.kind === 'new');
  console.log(`  ${newCaught.length ? '✓' : '✗'} ③ 新增一个直写 localStorage 的文件 → ${newCaught.length ? '被检出' : '没检出'}`);
  process.exit(real.length || caught.length === 0 || newCaught.length === 0 ? 1 : 0);
}

const baseline = loadBaseline();
const problems = judge(baseline);
const canLower = outside().filter(([f, n]) => n < (baseline[f] ?? Infinity));

console.log('存储边界（store 之外的 localStorage 直写，只许减少）：');
for (const [f, n] of outside().sort((a, b) => b[1] - a[1])) {
  const cap = baseline[f];
  const mark = cap === undefined ? '✗ 无基线' : n > cap ? `✗ 超出 ${n - cap}` : n < cap ? `✓ ${n}/${cap}，可下调` : `✓ ${n}/${cap}`;
  console.log(`  ${mark.padEnd(18, ' ')} ${f}`);
}
console.log(`  合计 ${total(outside())} 处，分布在 ${outside().length} 个文件（入口 ${ENTRY} 自身 ${current[ENTRY] || 0} 处不设上限）`);

if (problems.length) {
  console.error('\n✗ 存储边界被突破：');
  for (const p of problems) {
    if (p.kind === 'over') console.error(`   - ${p.file}：${p.n} 处，基线只允许 ${p.cap}`);
    else if (p.kind === 'new') console.error(`   - ${p.file}：新文件里有 ${p.n} 处直写 localStorage`);
    else console.error(`   - ${p.file}：基线里有它（${p.cap} 处），但现在已经没有直写了 —— 请下调基线`);
  }
  console.error('\n   读写阅读进度 / 设置请走 js/reader.store.js 的读写函数，不要自己拼键名。');
  console.error('   确属入口之外必须存在的（例如 theme.js 首屏防闪烁那一处），');
  console.error('   在提交说明里写清理由后更新基线：node tools/check-storage-boundary.mjs --write');
  process.exit(1);
}
if (canLower.length) {
  console.log(`\n↓ 有 ${canLower.length} 个文件的直写少于基线，建议下调：node tools/check-storage-boundary.mjs --write`);
}
console.log('\n✓ 存储边界未被突破');
