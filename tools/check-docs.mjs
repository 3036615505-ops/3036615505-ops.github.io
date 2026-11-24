#!/usr/bin/env node
/**
 * tools/check-docs.mjs — 交接文档里的数字必须与代码一致
 *
 *   node tools/check-docs.mjs               # 检查（pre-push / CI 用这个）
 *   node tools/check-docs.mjs --facts       # 只打印从代码里读出来的事实表（改文档时照着抄）
 *   node tools/check-docs.mjs --self-test   # 故意红：确认每条都能被检出
 *
 * 为什么需要它
 *   2026-11-24 实测：HANDOVER 写 10 章 / ?v=131 / v77，README 写 7 章，
 *   PROJECT-OVERVIEW 写 7 章 / e2e 44 项，sw.js 注释写 15 章 —— 而实际是
 *   11 章 / 150 / v98。CHANGELOG 自 11-09 起停更，之后 21 个版本没人记。
 *   这个项目自己的原则是「同一件事只写一处」，但那一处没人校验，照样会过期。
 *
 * 约定（也是本脚本的判定依据）
 *   - 会变的事实（版本号、章数、行数、体积、App 版本）**只写在 HANDOVER.md 的
 *     「一页纸现状」与「版本号现状」**，格式固定成下面 regex 认得的形状。
 *     改了数字的形状，这里要跟着改。
 *   - README.md 与 PROJECT-OVERVIEW.md **不许出现** `?v=数字` / `linyuan-v数字`。
 *     它们讲「怎么改」与「全貌」，要数字就指向 HANDOVER。
 *   - 历史叙述（CHANGELOG、HANDOVER 的「坑」、SW-HISTORY）里的数字不查：
 *     那些是「某天是多少」，本来就该过期。
 *
 * 退出码：0 一致；1 有不一致（打印「文档写的 → 实际」）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'node_modules', 'docs', 'tools', '_perf', '_design', '_source-assets']);
const args = new Set(process.argv.slice(2));

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const wc = (rel) => {
  const t = read(rel);
  return t.length - (t.endsWith('\n') ? 1 : 0) === 0 ? 0 : t.split('\n').length - (t.endsWith('\n') ? 1 : 0);
};

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP.has(ent.name) || ent.name.startsWith('.')) continue;
      walk(path.join(dir, ent.name), out);
    } else out.push(path.join(dir, ent.name));
  }
  return out;
}

/* ---------- 从代码里读事实 ---------- */
function facts() {
  const f = {};
  const html = walk(ROOT, []).filter((p) => p.endsWith('.html'));
  let maxV = 0;
  for (const p of html) for (const m of fs.readFileSync(p, 'utf8').matchAll(/\?v=(\d+)/g)) maxV = Math.max(maxV, Number(m[1]));
  f.v = maxV;
  f.html = html.length;

  const sw = read('sw.js');
  f.cache = Number((sw.match(/^var CACHE = 'linyuan-v(\d+)'/m) || [])[1]);
  const block = (sw.split('var PRECACHE')[1] || '').split('];')[0];
  f.precache = (block.match(/'[^']+'/g) || []).length;

  const ctx = { window: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('js/chapters.js'), ctx);
  const CH = ctx.CHAPTERS || [];
  f.chapters = CH.length;
  f.words = CH.map((c) => c.words);

  f.style = wc('css/style.css');
  for (const k of ['dom', 'flags', 'store', 'engine', 'ui']) f[k] = wc(`js/reader.${k}.js`);
  f.reader = wc('js/reader.js');

  f.kaiMain = (fs.statSync(path.join(ROOT, 'assets/fonts/linyuan-kai-subset.woff2')).size / 1024).toFixed(1);
  f.kaiRest = (fs.statSync(path.join(ROOT, 'assets/fonts/linyuan-kai-rest.woff2')).size / 1024).toFixed(1);
  f.portraits = walk(path.join(ROOT, 'assets'), []).filter((p) => /portrait-[a-z0-9-]+-1024\.webp$/.test(p)).length;

  const ver = JSON.parse(read('app/version.json'));
  f.app = ver.versionName;
  f.appCode = ver.versionCode;

  f.prePush = Number((read('.githooks/pre-push').match(/检查 (\d+) 项/m) || [])[1]);
  /* CI 静态校验的步数 = verify.yml 里带圈编号的步骤数 − 1（最后一个是端到端那个 job） */
  f.ci = (read('.github/workflows/verify.yml').match(/^\s+- name: [①-⑳]/gm) || []).length - 1;
  f.kaiChars = read('assets/fonts/linyuan-kai-subset.chars.txt').replace(/\s+/g, '').length;
  return f;
}

/* ---------- HANDOVER 里被校验的行 ---------- */
const RULES = [
  { name: '站点资源版本', re: /\| 站点资源版本 \| `\?v=(\d+)`/, key: 'v', fmt: String },
  { name: '版本号现状', re: /\*\*版本号现状\*\*：`\?v=(\d+)`/, key: 'v', fmt: String },
  { name: 'SW 缓存名', re: /\| SW 缓存名 \| `linyuan-v(\d+)`/, key: 'cache', fmt: String },
  { name: '内容契约的章数', re: /manifest \+ (\d+) 章 \+ (\d+) 人/, key: 'chapters', fmt: String },
  { name: '内容契约的人数', re: /manifest \+ \d+ 章 \+ (\d+) 人/, key: 'portraits', fmt: String },
  { name: '阅读器 dom 行数', re: /\| 阅读器模块 \| dom (\d+) 行/, key: 'dom', fmt: String },
  { name: '阅读器 flags 行数', re: /· flags (\d+) ·/, key: 'flags', fmt: String },
  { name: '阅读器 store 行数', re: /· store (\d+) ·/, key: 'store', fmt: String },
  { name: '阅读器 engine 行数', re: /· engine (\d+) ·/, key: 'engine', fmt: String },
  { name: '阅读器 ui 行数', re: /· ui (\d+) ·/, key: 'ui', fmt: String },
  { name: '阅读器入口行数', re: /· 入口 (\d+)/, key: 'reader', fmt: String },
  { name: 'style.css 行数', re: /\| 样式 \| `css\/style\.css` (\d+) 行/, key: 'style', fmt: String },
  { name: '章节数', re: /\| 章节 \| (\d+) 章（/, key: 'chapters', fmt: String },
  { name: '各章字数', re: /\| 章节 \| \d+ 章（([\d ]+(?: \/ [\d ]+)+)字/, key: 'words', fmt: (w) => w.join(' / '), clean: (s) => s.replace(/\s+/g, '').split('/').map(Number).join(' / ') },
  { name: '「重新渲染」一节的章数', re: /--all\s+# 全部 (\d+) 章/, key: 'chapters', fmt: String },
  { name: '楷体主片 KB', re: /主片 ([\d.]+) \+ 兜底片/, key: 'kaiMain', fmt: String },
  { name: '楷体兜底片 KB', re: /主片 [\d.]+ \+ 兜底片 ([\d.]+)/, key: 'kaiRest', fmt: String },
  { name: 'Android 壳版本', re: /\| Android 壳 \| v([\d.]+) \/ versionCode (\d+)/, key: 'app', fmt: String },
  { name: 'Android versionCode', re: /\| Android 壳 \| v[\d.]+ \/ versionCode (\d+)/, key: 'appCode', fmt: String },
  { name: 'pre-push 项数', re: /本地 pre-push (\d+) 项/, key: 'prePush', fmt: String }
];

function judge(f) {
  const doc = read('HANDOVER.md');
  const problems = [];
  for (const r of RULES) {
    const m = doc.match(r.re);
    if (!m) { problems.push({ name: r.name, doc: '（没找到这一行）', actual: r.fmt(f[r.key]) }); continue; }
    const docVal = r.clean ? r.clean(m[1]) : m[1];
    const actual = r.fmt(f[r.key]);
    if (docVal !== actual) problems.push({ name: r.name, doc: docVal, actual });
  }
  /* README / PROJECT-OVERVIEW 不许携带版本号 */
  for (const file of ['README.md', 'PROJECT-OVERVIEW.md']) {
    const t = read(file);
    const hit = t.match(/\?v=\d+|linyuan-v\d+/);
    if (hit) problems.push({ name: `${file} 里出现了版本号`, doc: hit[0], actual: '（要数字请指向 HANDOVER「一页纸现状」）' });
  }
  return problems;
}

const F = facts();
if (args.has('--facts')) {
  console.log('代码里的事实（照这个改 HANDOVER.md）：');
  for (const r of RULES) console.log(`  ${r.name.padEnd(14, '　')} ${r.fmt(F[r.key])}`);
  console.log(`  HTML 个数　　　  ${F.html}`);
  console.log(`  PRECACHE 条数　  ${F.precache}`);
  console.log(`  CI 静态校验步数  ${F.ci}`);
  console.log(`  楷体子集字数　　  ${F.kaiChars}`);
  process.exit(0);
}

if (args.has('--self-test')) {
  console.log('故意红自测（check-docs）：');
  let ok = true;
  /* 逐条把事实改掉，对应的规则必须报不一致；一条都报不出 = 这条规则是「瞎」的 */
  for (const key of new Set(RULES.map((r) => r.key))) {
    const f2 = { ...F };
    f2[key] = Array.isArray(F[key]) ? F[key].map((n) => n + 1) : typeof F[key] === 'number' ? F[key] + 1 : String(Number(F[key]) + 1);
    if (!Number.isFinite(Number(f2[key])) && !Array.isArray(f2[key])) f2[key] = F[key] + 'x';
    const caught = judge(f2).some((p) => RULES.some((r) => r.key === key && r.name === p.name));
    if (!caught) ok = false;
    console.log(`  ${caught ? '✓' : '✗'} 改掉 ${key} → ${caught ? '被检出' : '没检出'}`);
  }
  process.exit(ok ? 0 : 1);
}

const problems = judge(F);
console.log('文档数字核对（HANDOVER.md 对照代码）：');
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p.name}：文档写 ${p.doc} → 实际 ${p.actual}`);
  console.error('\n   修法：按「实际」改 HANDOVER.md（或跑 node tools/check-docs.mjs --facts 看全表）。');
  console.error('   不要反过来改代码去凑文档里的数字。');
  process.exit(1);
}
console.log(`  ✓ ${RULES.length} 项全部一致（?v=${F.v} / v${F.cache} / ${F.chapters} 章 / style ${F.style} 行 / ui ${F.ui} 行）`);
