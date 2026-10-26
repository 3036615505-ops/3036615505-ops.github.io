#!/usr/bin/env node
/**
 * tools/e2e.mjs — 阅读器端到端测试（零依赖，真浏览器）
 *
 * 为什么不是 jsdom：这个阅读器的关键逻辑全在布局上 —— 位置锚点、进度百分比、
 * 页码、剩余时间、自动滚屏，都依赖真实的排版结果。假 DOM 里这些永远是 0，
 * 测试会绿得毫无意义。所以直接开一个无头 Chromium 内核，用 CDP 驱动。
 *
 * 依赖：Node 22+（自带 WebSocket）+ 本机装了 Chrome / Edge（任一）。
 * 没有浏览器时打印提示并 exit 0 —— 不让没有浏览器的机器卡住 push。
 *
 * 用法：
 *   node tools/e2e.mjs              # 跑全部
 *   node tools/e2e.mjs --verbose    # 打印断言明细
 *   node tools/e2e.mjs --port 8799  # 换端口（端口被占时）
 *
 * 退出码：0 全绿 / 1 有失败 / 0 跳过（无浏览器）
 *
 * 覆盖范围（每次改 reader.js 或 style.css 都应跑一遍）：
 *   init 与存储迁移 · 位置锚点的写入与恢复 · 改字号不跑位 · 目录/摘句/设置面板
 *   主题持久化 · 自动滚屏（启动、速度、手动接管）· 备份导出/导入 · 书架页指标
 *   全程无未捕获异常
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const portIdx = argv.indexOf('--port');
const PORT = portIdx >= 0 ? parseInt(argv[portIdx + 1], 10) : 8765;
const CDP_PORT = PORT + 300;

/* ---------- 浏览器探测 ---------- */
const CANDIDATES = {
  win32: [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge'
  ]
};
/* 显式指定优先：CI 用 setup-chrome 装下来的那份走环境变量，本机也可以用 CHROME_BIN 指自己那份。
   排在候选列表前面 —— 镜像自带的 Chrome 版本随时会变，显式路径才是可复现的。 */
const envBrowser = [process.env.CHROME_BIN, process.env.CHROME_PATH, process.env.PUPPETEER_EXECUTABLE_PATH]
  .find(p => p && fs.existsSync(p));
const browserPath = envBrowser || (CANDIDATES[process.platform] || []).find(p => fs.existsSync(p));

if (typeof WebSocket === 'undefined' || !browserPath) {
  const reason = typeof WebSocket === 'undefined'
    ? 'Node 版本低于 22（无内置 WebSocket）'
    : '未找到 Chrome/Edge';
  /* 本地没有浏览器就跳过，别卡住 push；但 CI 里"跳过"等于假绿，
     必须报错 —— 否则哪天镜像里没装浏览器，测试会一路绿灯放行。 */
  if (process.env.CI) {
    console.error('✗ CI 环境必须能跑端到端测试，但' + reason);
    process.exit(1);
  }
  console.log('↷ 跳过端到端测试：' + reason);
  process.exit(0);
}

/* ---------- 静态服务器 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, rel);
  /* path.join 之后统一成绝对路径再比，否则 Windows 上全是反斜杠、前缀永远对不上 */
  if (!path.resolve(file).startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, '127.0.0.1', resolve);
});

/* ---------- 启动浏览器 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'linyuan-e2e-'));
const BASE_ARGS = [
  '--remote-debugging-port=' + CDP_PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
  '--disable-gpu', '--disable-features=Translate', '--hide-scrollbars',
  '--window-size=390,844',
  /* GitHub Actions 的容器里没有 user namespace，沙箱起不来；这两个参数是 CI 标配 */
  ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
  'about:blank'
];
/* Chrome 131 之后 `--headless=new` 的写法被逐步收敛，个别版本会直接拒收；
   两条都试一遍，谁先起得来算谁 —— 比钉死一个版本稳。 */
const LAUNCH_VARIANTS = [
  ['--headless=new', ...BASE_ARGS],
  ['--headless', ...BASE_ARGS]
];

let browser = null;
let browserLog = '';

function launch(args) {
  browserLog = '';
  const child = spawn(browserPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  /* 以前用 stdio:'ignore'，浏览器挂掉时一个字都不剩，只能干看「端口没起来」。
     现在把输出留住 —— 下一次失败能直接告诉我们是哪一步不对。 */
  const collect = buf => { browserLog = (browserLog + buf.toString()).slice(-4000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.on('error', e => { browserLog += '\n[spawn error] ' + e.message; });
  return child;
}

async function waitForTarget(limitMs, child) {
  const deadline = Date.now() + limitMs;
  while (Date.now() < deadline) {
    /* 浏览器提前退出了就别再空等 —— 之前只能干耗满 15s 再报「端口没起来」，
       既慢又把「进程崩了」和「只是慢」混成一件事。 */
    if (child && child.exitCode !== null) return null;
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const t = Array.isArray(list) ? list.find(x => x.type === 'page') : null;
      if (t) return t;
    } catch (e) { /* 端口还没开 */ }
    await sleep(250);
  }
  return null;
}

async function cleanup(code) {
  try { browser.kill(); } catch (e) { /* 已退出 */ }
  try { server.close(); } catch (e) { /* 已关闭 */ }
  /* 浏览器进程退出前还握着 Crashpad 文件，删不掉就留给系统临时目录，
     不能因为清理失败把测试结果判成失败 */
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* EBUSY，忽略 */ }
  process.exit(code);
}

let target = null;
let launchedWith = '';
for (let i = 0; i < LAUNCH_VARIANTS.length && !target; i++) {
  browser = launch(LAUNCH_VARIANTS[i]);
  target = await waitForTarget(15000, browser);
  if (target) { launchedWith = LAUNCH_VARIANTS[i][0]; break; }
  try { browser.kill('SIGKILL'); } catch (e) { /* 已退出 */ }
  await sleep(300);
  if (i === 0) console.log('↻ 首次启动没等到调试端口，改用 --headless 重试');
}
if (!target) {
  console.error('✗ 浏览器调试端口没起来，无法继续');
  console.error('  浏览器: ' + browserPath);
  console.error('  参数: ' + LAUNCH_VARIANTS.map(v => v[0]).join(' / '));
  if (browserLog.trim()) console.error('  浏览器输出:\n' + browserLog.trim());
  else console.error('  浏览器没有任何输出（可能被杀，或参数被静默拒绝）');
  /* 注意：cleanup 里是 process.exit，必须 await —— 否则会继续往下跑到
     target.webSocketDebuggerUrl 上抛 TypeError，把真正的错误盖掉。 */
  await cleanup(1);
}
/* 把「实际生效的启动参数」打出来：哪天 Chrome 不再认 --headless=new，
   日志里能直接看到它退到了第二条，而不是默默变慢。 */
console.log('浏览器就绪：' + launchedWith);
if (verbose) console.log('  可执行: ' + browserPath);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

let msgId = 0;
const pending = new Map();
const pageErrors = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(JSON.stringify(m.error)));
    else resolve(m.result);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    pageErrors.push((d.text || '') + ' ' + (d.exception && d.exception.description || ''));
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    pageErrors.push('console.error: ' + m.params.args.map(a => a.value || a.description).join(' '));
  }
};

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.text || '') + ' :: ' + ((r.exceptionDetails.exception || {}).description || ''));
  }
  return r.result.value;
}

/** 按视口坐标真点一下。elementFromPoint / el.click() 都会绕过覆盖层，
 *  只有派发真实鼠标事件才能复现「按钮被翻页层挡住」。 */
async function clickAt(x, y) {
  /* 这个浏览器是按 mobile:true 起的，鼠标事件不会合成 click，必须发触摸。
     touchEnd 之后再等一小会儿，click 是浏览器在 touch 序列结束后补发的。 */
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 1, radiusY: 1, force: 1 }]
  });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const BASE = `http://127.0.0.1:${PORT}`;
const CHAPTER = BASE + '/novel/chapter-02.html';
const SHELF = BASE + '/novel/index.html';
const HOME = BASE + '/';
const CHAPTER_KEY = '--novel-chapter-02-html';
const POS_KEY = 'reader-pos' + CHAPTER_KEY;
const ANCHOR_KEY = 'reader-anchor' + CHAPTER_KEY;

async function goto(url, wait = 2200) {
  await send('Page.navigate', { url });
  await sleep(wait);
}

/* ---------- 断言 ---------- */
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  const line = (ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail ? '  → ' + detail : (verbose && detail ? '  (' + detail + ')' : ''));
  console.log(line);
}
function section(title) { console.log('\n' + title); }

/* ================= 阅读页 ================= */
section('阅读页 · 初始化');
await goto(CHAPTER);
const smoke = await evaluate(`({
  settings: !!document.getElementById('settingsOverlay'),
  status: !!document.getElementById('readerStatus'),
  paras: document.querySelectorAll('.chapter-content p').length,
  schema: localStorage.getItem('reader-schema')
})`);
check('阅读器初始化完成（设置面板、底部状态条已注入）', smoke.settings && smoke.status && smoke.paras > 10, JSON.stringify(smoke));
check('存储 schema 已写入 v2', smoke.schema === '2', 'schema=' + smoke.schema);

section('阅读页 · 位置锚点');
await evaluate(`localStorage.clear(); location.reload(); 1`);
await sleep(2000);
await evaluate(`window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * 0.5); 1`);
/* 1200ms 而不是 700：headless 下 rAF 偶尔被节流，700ms 会读到还没落盘的旧值 */
await sleep(1200);
const saved = await evaluate(`({ pos: localStorage.getItem('${POS_KEY}'), anchor: localStorage.getItem('${ANCHOR_KEY}'), y: Math.round(scrollY) })`);
const savedPos = Number(saved.pos);
check('滚动后写入进度百分比（40–60）', savedPos > 40 && savedPos < 60, 'pos=' + saved.pos);
check('滚动后写入段落锚点', !!saved.anchor && JSON.parse(saved.anchor || '{}').i >= 0, saved.anchor);

await evaluate(`location.reload(); 1`);
await sleep(4000);
const restored = await evaluate(`(() => {
  const max = document.documentElement.scrollHeight - innerHeight;
  return { pct: Math.round(scrollY / max * 100), y: Math.round(scrollY) };
})()`);
check('重载后回到原位置（±6%）', Math.abs(restored.pct - 50) <= 6, JSON.stringify(restored));

const anchorBefore = await evaluate(`JSON.parse(localStorage.getItem('${ANCHOR_KEY}')).i`);
const fsBefore = await evaluate(`parseFloat(getComputedStyle(document.querySelector('.chapter-content')).fontSize)`);
await evaluate(`changeFontSize(-1); 1`);
await sleep(900);
const anchorAfter = await evaluate(`JSON.parse(localStorage.getItem('${ANCHOR_KEY}') || '{}').i`);
const fsAfter = await evaluate(`parseFloat(getComputedStyle(document.querySelector('.chapter-content')).fontSize)`);
check('改字号后仍停在同一段（视线不漂）', Math.abs(anchorAfter - anchorBefore) <= 1, `before=${anchorBefore} after=${anchorAfter}`);
/* 字号数值只在 CSS 的 [data-fontsize] 里定义一次；JS 只落属性。
   这条防止有人把内联 setProperty 加回来 —— 那样 CSS 又变成永不生效的死代码。 */
check('改字号真的生效（数值由 CSS 单一数据源给出）', fsAfter < fsBefore, `${fsBefore}px → ${fsAfter}px`);

section('阅读页 · 面板与主题');
await evaluate(`openDirectory(); 1`);
await sleep(400);
const dir = await evaluate(`({ visible: document.getElementById('dirOverlay').classList.contains('visible'), items: document.querySelectorAll('#dirList .dir-item').length, chapters: (window.CHAPTERS || []).length })`);
check('目录面板可打开且条目与章节数一致', dir.visible && dir.items === dir.chapters && dir.items > 0, JSON.stringify(dir));
await evaluate(`closeDirectory(); 1`);

await evaluate(`openQuotes(); 1`);
await sleep(300);
const quotes = await evaluate(`!!document.getElementById('quotesOverlay') && document.getElementById('quotesOverlay').classList.contains('visible')`);
check('摘句面板可打开', quotes === true);
await evaluate(`closeQuotes(); 1`);

await evaluate(`setTheme('dark'); 1`);
await sleep(300);
const theme = await evaluate(`({ attr: document.documentElement.getAttribute('data-theme'), stored: localStorage.getItem('reader-theme'), meta: (document.querySelector('meta[name="theme-color"]') || {}).content })`);
check('切换主题同时落到 DOM / localStorage / theme-color', theme.attr === 'dark' && theme.stored === 'dark' && theme.meta === '#1c1c1c', JSON.stringify(theme));
await evaluate(`setTheme('wheat'); 1`);

section('阅读页 · 自动滚屏');
await evaluate(`window.scrollTo(0, 0); toggleAutoScroll(); 1`);
await sleep(1200);
const auto = await evaluate(`({
  active: !!document.getElementById('autoScrollPill'),
  level: document.querySelector('#autoScrollPill .auto-level') ? document.querySelector('#autoScrollPill .auto-level').textContent : null,
  y: Math.round(scrollY),
  stored: localStorage.getItem('reader-autoscroll-speed')
})`);
check('自动滚屏启动：悬浮条出现、默认速度 5、页面在动', auto.active && auto.level === '5' && auto.y > 0, JSON.stringify(auto));
await evaluate(`window.scrollTo(0, scrollY + 400); 1`);
await sleep(600);
const tookOver = await evaluate(`Math.round(scrollY) >= 400`);
check('手动滚动能接管（不会被顶回原位）', tookOver === true);
await evaluate(`toggleAutoScroll(); 1`);
await sleep(200);
const stopped = await evaluate(`(() => {
  const p = document.getElementById('autoScrollPill');
  return !!p && p.classList.contains('visible');
})()`);
check('再点一次即停止（悬浮条隐藏）', stopped === false);

await evaluate(`toggleAutoScroll(); 1`);
await sleep(800);
await evaluate(`document.querySelector('#autoScrollPill .auto-stop').click(); 1`);
await sleep(300);
const clickedStop = await evaluate(`document.getElementById('autoScrollPill').classList.contains('visible')`);
check('点悬浮条 ✕ 能真的停下（真实点击路径）', clickedStop === false);

section('阅读页 · 远程开关');
const flagFile = await evaluate(`fetch('/flags.json', { cache: 'no-store' }).then(r => r.json()).then(j => ({ keys: Object.keys(j.flags || {}).sort() }))`);
/* 不写死数量：开关是成对登记的（DEFAULTS 与 flags.json），少一个就等于
   线上关不掉那个功能。这条断言专门防「加了开关却忘了登记」。 */
const flagKeys = await evaluate(`Object.keys(LY.flags.all()).sort()`);
check('flags.json 与前端登记的开关一一对应',
  JSON.stringify(flagFile.keys) === JSON.stringify(flagKeys),
  JSON.stringify({ file: flagFile.keys, js: flagKeys }));
await evaluate(`LY.flags.apply({ autoscroll: false }); 1`);
const flagHidden = await evaluate(`(() => {
  const b = document.querySelector('button[onclick*="toggleAutoScroll"]');
  return b ? getComputedStyle(b).display === 'none' : null;
})()`);
check('关掉 autoscroll：工具栏入口被隐藏', flagHidden === true, 'hidden=' + flagHidden);
await evaluate(`window.scrollTo(0, 0); toggleAutoScroll(); 1`);
await sleep(500);
const notStarted = await evaluate(`(() => {
  const p = document.getElementById('autoScrollPill');
  return p ? p.classList.contains('visible') : false;
})()`);
check('关掉 autoscroll：直接调用也不会启动', notStarted === false);
await evaluate(`LY.flags.apply({ autoscroll: true }); 1`);
const flagBack = await evaluate(`(() => {
  const b = document.querySelector('button[onclick*="toggleAutoScroll"]');
  return b ? getComputedStyle(b).display !== 'none' : null;
})()`);
check('恢复开关：入口立刻回来（不用刷新）', flagBack === true, 'shown=' + flagBack);

section('阅读页 · 阅读数据备份');
await evaluate(`localStorage.setItem('${POS_KEY}', '42'); openDataModal('export'); 1`);
await sleep(300);
const exported = await evaluate(`(() => {
  const raw = document.getElementById('dataText').value;
  let p = null;
  try { p = JSON.parse(raw); } catch (e) {}
  return { ok: !!p, schema: p && p.schema, hasPos: !!(p && p.data && p.data['${POS_KEY}']),
           foreign: !!(p && p.data && p.data['other-app']),
           readonly: document.getElementById('dataText').hasAttribute('readonly') };
})()`);
check('导出：JSON 合法、含进度键、不含无关键', exported.ok && exported.schema === 2 && exported.hasPos && !exported.foreign, JSON.stringify(exported));
check('导出：文本框只读（防误改）', exported.readonly === true);

await evaluate(`closeDataModal(); localStorage.setItem('${POS_KEY}', '7'); openDataModal('import'); 1`);
await sleep(200);
const importPayload = JSON.stringify({ app: 'linyuan-reader', schema: 2, data: { [POS_KEY]: '88', 'other-app': 'x' } });
await evaluate(`document.getElementById('dataText').value = ${JSON.stringify(importPayload)}; dataPrimaryAction(); 1`);
const armed = await evaluate(`({ text: document.getElementById('dataPrimary').textContent, pos: localStorage.getItem('${POS_KEY}') })`);
check('导入：第一次点击只上膛、不写入', armed.text.indexOf('确认') >= 0 && armed.pos === '7', JSON.stringify(armed));
await evaluate(`dataPrimaryAction(); 1`);
await sleep(300);
const applied = await evaluate(`({ pos: localStorage.getItem('${POS_KEY}'), foreign: localStorage.getItem('other-app') })`);
/* 导入后会自动 reload。旧页面的 pagehide 会抢先写一个 0，把刚导入的进度抹掉 ——
   这条断言就是防它回潮（只有用户真滚到顶部才允许写 0）。 */
await sleep(1800);
const afterImportReload = await evaluate(`({ pos: localStorage.getItem('${POS_KEY}'), y: Math.round(scrollY) })`);
check('导入后自动重载：进度没被抹成 0，且已落回原位', afterImportReload.pos === '88' && afterImportReload.y > 0, JSON.stringify(afterImportReload));
check('导入：第二次点击写入备份值', applied.pos === '88', 'pos=' + applied.pos);
check('导入：白名单外的键被忽略', applied.foreign === null);

/* ================= 楷体双片 ================= */
section('阅读页 · 楷体双片（主片必下，兜底片按需）');
await evaluate(`setFontFamily('kai'); 1`);
await sleep(900);
const kai = await evaluate(`(() => {
  const fams = Array.from(document.fonts).map(f => ({ n: f.family.replace(/"/g, ''), s: f.status }));
  return {
    stack: getComputedStyle(document.querySelector('.chapter-content')).fontFamily,
    main: fams.find(x => x.n === 'LinyuanKai'),
    rest: fams.find(x => x.n === 'LinyuanKaiRest')
  };
})()`);
/* 浏览器回读字体栈时会把不含空格的族名去掉引号（LinyuanKai, LinyuanKaiRest, "Kaiti SC"），
   所以不能按带引号的字符串匹配，得按逗号切开逐项比。 */
const kaiTokens = (kai.stack || '').split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
const iMain = kaiTokens.indexOf('LinyuanKai');
const iRest = kaiTokens.indexOf('LinyuanKaiRest');
check('楷体字体栈里兜底片紧跟主片（放后面就永远轮不到）',
  iMain >= 0 && iRest === iMain + 1, kai.stack);
check('主片已加载，兜底片保持未下载',
  !!kai.main && kai.main.s === 'loaded' && (!kai.rest || kai.rest.s === 'unloaded'),
  JSON.stringify(kai));
await evaluate(`setFontFamily('fzyouhei'); 1`);

/* ================= 导入字体 ================= */
section('阅读页 · 导入自己的字体');
await evaluate(`openSettings(); 1`);
await sleep(300);
const fontUi = await evaluate(`({
  btn: !!document.getElementById('fontImportBtn'),
  input: !!document.getElementById('fontFileInput'),
  clearHidden: (() => {
    const c = document.getElementById('fontImportClear');
    return !!c && getComputedStyle(c).display === 'none';
  })()
})`);
check('设置面板有导入入口，未导入时不显示「移除」', fontUi.btn && fontUi.input && fontUi.clearHidden, JSON.stringify(fontUi));

/* 拿站点自带的楷体子集当「读者的字体文件」：走真实的 change 事件，
   所以文件校验、FileReader/arrayBuffer、FontFace、IndexedDB 都会被真的跑一遍。 */
await evaluate(`(async () => {
  const res = await fetch('/assets/fonts/linyuan-kai-subset.woff2');
  const buf = await res.arrayBuffer();
  const input = document.getElementById('fontFileInput');
  const dt = new DataTransfer();
  dt.items.add(new File([buf], '测试字体.woff2', { type: 'font/woff2' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change'));
  return true;
})()`);
await sleep(1600);
/* 用 FontFaceSet 里的记录判断「装上了没有」，不用 fonts.check()：
   check 要传样本字，子集字体缺这个字就会误报 false。 */
const FONT_ON = `Array.from(document.fonts).some(f => f.family.replace(/"/g, '') === 'LinyuanUser' && f.status === 'loaded')`;
const fontApplied = await evaluate(`({
  stored: localStorage.getItem('reader-fontfamily'),
  name: localStorage.getItem('reader-custom-font'),
  stack: getComputedStyle(document.querySelector('.chapter-content')).fontFamily,
  loaded: ${FONT_ON},
  hint: (document.getElementById('fontFamilyHint') || {}).textContent
})`);
const stackAtHead = (fontApplied.stack || '').indexOf('LinyuanUser');
check('导入后正文切到自定义字体栈', fontApplied.stored === 'custom' && stackAtHead >= 0 && stackAtHead < 3, JSON.stringify(fontApplied));
check('字体真的装进了 FontFaceSet', fontApplied.loaded === true, JSON.stringify(fontApplied));
check('文件名写进提示语', (fontApplied.hint || '').indexOf('测试字体.woff2') >= 0, fontApplied.hint);

await evaluate(`location.reload(); 1`);
await sleep(3200);
const fontRestored = await evaluate(`({
  stored: localStorage.getItem('reader-fontfamily'),
  stack: getComputedStyle(document.querySelector('.chapter-content')).fontFamily,
  loaded: ${FONT_ON}
})`);
check('重载后从 IndexedDB 自动装回（不用再导入一次）',
  fontRestored.stored === 'custom' && (fontRestored.stack || '').indexOf('LinyuanUser') >= 0 && fontRestored.loaded === true,
  JSON.stringify(fontRestored));

await evaluate(`openSettings(); 1`);
await sleep(300);
const beforeClear = await evaluate(`({
  text: document.getElementById('fontImportBtn').textContent,
  clearShown: getComputedStyle(document.getElementById('fontImportClear')).display !== 'none'
})`);
check('已导入时按钮变「更换字体文件」并出现「移除」', beforeClear.text.indexOf('更换') >= 0 && beforeClear.clearShown, JSON.stringify(beforeClear));
await evaluate(`clearFontFile(); 1`);
await sleep(900);
const fontCleared = await evaluate(`({
  stored: localStorage.getItem('reader-fontfamily'),
  name: localStorage.getItem('reader-custom-font'),
  stack: getComputedStyle(document.querySelector('.chapter-content')).fontFamily,
  text: document.getElementById('fontImportBtn').textContent
})`);
check('移除后回到黑体，记录一并清掉',
  fontCleared.stored === 'fzyouhei' && fontCleared.name === null && (fontCleared.stack || '').indexOf('LinyuanUser') < 0,
  JSON.stringify(fontCleared));
await evaluate(`closeSettings(); 1`);

/* ================= 书架页 ================= */
section('书架页 · 阅读足迹');
const today = new Date();
const token = d => [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');
const dayAgo = n => { const d = new Date(today); d.setDate(d.getDate() - n); return token(d); };
await evaluate(`localStorage.setItem('reader-footprints', JSON.stringify({
  days: ['${dayAgo(1)}', '${dayAgo(2)}', '${dayAgo(9)}'],
  quotes: ['a', 'b', 'c'],
  time: 5400,
  dayTime: {}
})); 1`);
await goto(SHELF);
const shelf = await evaluate(`({
  pills: Array.from(document.querySelectorAll('#novelFootprintsMetrics .footprint-pill')).map(el => el.textContent),
  visible: (document.getElementById('novelFootprints') || {}).style ? document.getElementById('novelFootprints').style.display : '',
  debug: {
    ready: document.readyState,
    hasFp: !!document.getElementById('novelFootprints'),
    fp: (localStorage.getItem('reader-footprints') || '').slice(0, 40),
    pos: localStorage.getItem('reader-pos${CHAPTER_KEY}')
  },
  /* 章节进度条：每章一段，且不能撑破卡片（章数增长时缝隙要跟着收） */
  segs: (function() {
    var row = document.querySelector('#overviewChapters .overview-chapter-row');
    if (!row) return null;
    return {
      n: row.querySelectorAll('.dot').length,
      gap: getComputedStyle(row).gap,
      over: row.scrollWidth - row.clientWidth
    };
  })(),
  chapters: (window.CHAPTERS || []).length,
  /* 书讯两行：第一行「连载中 · N 章 · N 字」，第二行「已读 N%」且不带前导「·」 */
  stats: (function() {
    var el = document.querySelector('.detail-meta .stats');
    if (!el) return null;
    var lines = Array.from(el.querySelectorAll('.stats-line')).map((n) => n.textContent);
    return { lines: lines, lineCount: lines.length, html: el.innerHTML.length };
  })()
})`);
const pills = shelf.pills || [];
check('足迹显示为 3 枚指标（已读/摘句/时长）', pills.length === 3, JSON.stringify(pills) + ' debug=' + JSON.stringify(shelf.debug));
check('书讯拆成两行，「已读」在第二行且不带前导「·」',
  !!shelf.stats && shelf.stats.lineCount === 2
    && /^连载中 · \d+ 章 · \d+ 字$/.test(shelf.stats.lines[0] || '')
    && /^已读 \d+%$/.test(shelf.stats.lines[1] || ''),
  JSON.stringify(shelf.stats));
check('时长格式正确（1 时 30 分）', pills.some(t => t.indexOf('1 时 30 分') >= 0), JSON.stringify(pills));
/* 「连续 N 天」这枚指标已按设计移除，别被后续改动悄悄加回来 */
check('不再显示「连续」天数', !pills.some(t => t.indexOf('连续') >= 0), JSON.stringify(pills));
const segs = shelf.segs;
check('章节进度条一章一段、且不溢出版心',
  !!segs && segs.n === shelf.chapters && segs.n > 0 && segs.over <= 1,
  JSON.stringify(segs) + ' chapters=' + shelf.chapters);

/* ================= 站内「新章节更新了」横幅 =================
   数据源 announce.json 由 tools/make-announce.mjs 从 CHAPTERS 生成（取章号最大者）。
   被测行为：远端章号 > 已记录章号 → 弹横幅；点「去读」/「✕」→ 记录并消失；
   已记录到最新章 → 不弹；正停在最新章页面上 → 静默记录不弹。 */
section('站内更新横幅');
/* 期望值一律从 announce.json 现取（不写死章号）—— 硬编码在第七章上线当天
   就连挂 4 条「正确的功能 vs 过期的期望」。 */
await evaluate(`sessionStorage.clear(); 1`);
await goto(HOME);
const ann = await evaluate(`fetch('announce.json', { cache: 'no-store' }).then((r) => r.json())`);
const LATEST = ann.chapter;
const LATEST_URL = ann.url;
const SEEN = String(LATEST - 1);
await evaluate(`sessionStorage.clear(); localStorage.setItem('reader-notice-seen', '${SEEN}'); 1`);
await goto(HOME);
await sleep(600);
const noticeShown = await evaluate(`(() => {
  const bar = document.getElementById('lyNotice');
  return {
    exists: !!bar,
    text: bar ? (bar.querySelector('.notice-text') || {}).textContent : '',
    href: bar ? (bar.querySelector('.notice-go') || {}).getAttribute('href') : '',
    visible: bar ? getComputedStyle(bar).opacity : ''
  };
})()`);
check('看到第 ' + SEEN + ' 章时弹出「第 ' + LATEST + ' 章更新了」横幅',
  noticeShown.exists && noticeShown.text.indexOf('第 ' + LATEST + ' 章') >= 0 && noticeShown.visible === '1',
  JSON.stringify(noticeShown));
check('横幅「去读」指向最新章节', noticeShown.href === LATEST_URL, String(noticeShown.href) + ' != ' + LATEST_URL);
await evaluate(`document.querySelector('#lyNotice .notice-close').click(); 1`);
await sleep(120);
const noticeClosed = await evaluate(`(() => ({
  gone: !document.getElementById('lyNotice'),
  seen: localStorage.getItem('reader-notice-seen')
}))()`);
check('点 ✕ 后横幅消失且已记录到第 ' + LATEST + ' 章', noticeClosed.gone && noticeClosed.seen === String(LATEST), JSON.stringify(noticeClosed));
await goto(HOME);
await sleep(600);
const noticeQuiet = await evaluate(`!!document.getElementById('lyNotice')`);
check('已看到最新章后不再弹', noticeQuiet === false, 'exists=' + noticeQuiet);
await evaluate(`sessionStorage.clear(); localStorage.setItem('reader-notice-seen', '${SEEN}'); 1`);
await goto(BASE + LATEST_URL);
await sleep(600);
const noticeOnLatest = await evaluate(`(() => ({
  exists: !!document.getElementById('lyNotice'),
  seen: localStorage.getItem('reader-notice-seen')
}))()`);
check('正停留在最新章节页时不弹、只静默标记', noticeOnLatest.exists === false && noticeOnLatest.seen === String(LATEST), JSON.stringify(noticeOnLatest));

section('无限流：章末接续');
/* 这一组盯的是「往下读不换页」：章末的「一章一句」是接缝，滚过去就是下一章。
   用 window 上的标记判断有没有真刷新，期望的章名从 CHAPTERS 现取。 */
await goto(BASE + '/novel/chapter-03.html');
const flowStart = await evaluate(`({
  blocks: document.querySelectorAll('.chapter-block').length,
  navs: document.querySelectorAll('.chapter-bottom-nav a').length,
  flow: !!document.getElementById('readingFlow'),
  cur: LY.store.getCurrentFileName()
})`);
check('正文流里不再有上一章/下一章按钮', flowStart.navs === 0, 'navs=' + flowStart.navs);
check('首屏只装当前一章', flowStart.blocks === 1 && flowStart.cur === 'chapter-03.html' && flowStart.flow, JSON.stringify(flowStart));

/* 滚到章末：自动接上第四章，且不整页刷新 */
await evaluate(`window.__noReload = 1; window.scrollTo(0, document.documentElement.scrollHeight); 1`);
await sleep(1500);
const appended = await evaluate(`({
  noReload: window.__noReload === 1,
  blocks: [...document.querySelectorAll('.chapter-block')].map(b => b.dataset.file),
  pct: LY.engine.getCurrentProgressPct()
})`);
check('滚到章末自动接上第四章', appended.blocks.length === 2 && appended.blocks[1] === 'chapter-04.html', JSON.stringify(appended.blocks));
check('接章不整页刷新', appended.noReload);
check('接章后本章进度不被拉回（≥95）', appended.pct >= 95, 'pct=' + appended.pct);

/* 滚进新章：URL / 章节 id / 标题 / 顶栏 一起换 */
await evaluate(`(() => {
  const b = document.querySelectorAll('.chapter-block')[1];
  window.scrollTo(0, b.getBoundingClientRect().top + window.pageYOffset + 600);
  return 1;
})()`);
await sleep(1000);
const entered = await evaluate(`({
  cur: LY.store.getCurrentFileName(),
  path: location.pathname,
  title: document.title,
  topbar: (document.querySelector('.chapter-name') || {}).textContent || '',
  prev: document.querySelector('.prev-ch').getAttribute('href'),
  next: document.querySelector('.next-ch').getAttribute('href'),
  pct: LY.engine.getCurrentProgressPct(),
  expected: (window.CHAPTERS.filter(c => c.file === 'chapter-04.html')[0] || {}).title,
  pos: Object.keys(localStorage)
    .filter(k => k.indexOf('reader-pos') === 0)
    .reduce((m, k) => (m[k] = localStorage.getItem(k), m), {})
})`);
check('滚进第四章：URL 与章节 id 同步', entered.cur === 'chapter-04.html' && entered.path.indexOf('chapter-04') >= 0, entered.cur + ' / ' + entered.path);
check('滚进第四章：标题与顶栏同步', entered.title === entered.expected && entered.topbar === entered.expected, entered.title + ' / ' + entered.topbar);
check('上下章链接重新指过', entered.prev === 'chapter-03.html' && entered.next === 'chapter-05.html', entered.prev + ' / ' + entered.next);
/* 进度按章块算：进章 600px 应该是个小比例，而不是整页 scrollHeight 的比例 */
check('进度按当前章块算，不是整页比例', entered.pct >= 0 && entered.pct <= 30, 'pct=' + entered.pct);
check('上一章进度保留、新章单独落盘',
  entered.pos['reader-pos--novel-chapter-03-html'] !== undefined &&
  entered.pos['reader-pos--novel-chapter-04-html'] !== undefined,
  JSON.stringify(entered.pos));
check('读完的第三章被标记为已读', await evaluate(`localStorage.getItem('reader-done--novel-chapter-03-html') === '1'`));

/* 底部工具栏「下一章」= 接上并落位，不是换页 */
await goto(BASE + '/novel/chapter-02.html');
await evaluate(`document.querySelector('.next-ch').click(); 1`);
await sleep(1500);
const viaBar = await evaluate(`({
  blocks: [...document.querySelectorAll('.chapter-block')].map(b => b.dataset.file),
  cur: LY.store.getCurrentFileName(),
  top: Math.round(document.querySelectorAll('.chapter-block')[1].getBoundingClientRect().top)
})`);
check('底部「下一章」接上并把读者送到章首',
  viaBar.blocks[1] === 'chapter-03.html' && Math.abs(viaBar.top) < 4 && viaBar.cur === 'chapter-03.html',
  JSON.stringify(viaBar));

/* 接上来的章必须和第一章一个待遇：自定义字体、阅读辅助都要跟过去 */
const inherited = await evaluate(`(() => {
  setFontFamily('kai');
  const blocks = document.querySelectorAll('.chapter-block');
  const fonts = [...blocks].map(b => getComputedStyle(b.querySelector('.chapter-content')).fontFamily);
  toggleReadingAid('dialogue');   /* 默认关 → 打开，两章都应有 .dlg */
  const dlg = [...blocks].map(b => b.querySelectorAll('.dlg').length > 0);
  toggleReadingAid('dialogue');   /* 关回去，别影响后面的断言 */
  return { fonts, dlg, same: fonts[0] === fonts[1] };
})()`);
check('接上来的章继承自定义字体', inherited.same && /kai|楷/i.test(inherited.fonts[1]), JSON.stringify(inherited.fonts));
check('阅读辅助也作用到接上来的章', inherited.dlg[0] && inherited.dlg[1], JSON.stringify(inherited.dlg));

/* 跨块摘句：id 必须带章，否则「回到这一页」会跳到别的章 */
await goto(BASE + '/novel/chapter-03.html');
await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight); 1`);
await sleep(1400);
const quoteIds = await evaluate(`(() => {
  const blocks = document.querySelectorAll('.chapter-block');
  const a = blocks[0].querySelectorAll('.collectable-paragraph')[2];
  const b = blocks[1].querySelectorAll('.collectable-paragraph')[2];
  return { a: a.id, b: b.id, af: a.dataset.chapterFile, bf: b.dataset.chapterFile };
})()`);
check('跨块摘句 id 不撞车',
  quoteIds.a !== quoteIds.b && quoteIds.a.indexOf('chapter-03') >= 0 && quoteIds.b.indexOf('chapter-04') >= 0,
  JSON.stringify(quoteIds));

/* 往上接：滚到章首继续上滑，把上一章插到上方，且视线不能跳 */
/* 模拟一次真正的「往上滑」：先给一个上滑手势，再把位置挪回章首。
   只 scrollTo(0,0) 不算 —— 代码要求同时有手势，否则加载时的滚动恢复会被误判。 */
async function pullUpTo(top = 0) {
  await evaluate(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 })); 1`);
  await evaluate(`window.scrollTo(0, ${top}); 1`);
}

section('无限流：章首往回接');
await goto(BASE + '/novel/chapter-03.html');
await evaluate(`window.scrollTo(0, 600); 1`);
await sleep(450);
await pullUpTo();
await sleep(1600);
const afterUp = await evaluate(`({
  blocks: [...document.querySelectorAll('.chapter-block')].map(b => b.dataset.file),
  y: Math.round(window.scrollY),
  h0: Math.round(document.querySelectorAll('.chapter-block')[0].getBoundingClientRect().height),
  top: Math.round(document.querySelectorAll('.chapter-block')[1].getBoundingClientRect().top),
  cur: LY.store.getCurrentFileName()
})`);
check('上滑到章首把上一章插到上方',
  afterUp.blocks[0] === 'chapter-02.html' && afterUp.blocks[1] === 'chapter-03.html',
  JSON.stringify(afterUp.blocks));
/* 补偿到位的判据：滚动量正好等于新插进来的那一块高度，
   而且正在读的那一块仍停在视口顶端（插入前它就在 0）。 */
check('插入后滚动量 = 新块高度（视线不跳）', Math.abs(afterUp.y - afterUp.h0) <= 8, JSON.stringify({ y: afterUp.y, h0: afterUp.h0 }));
check('正在读的那一块仍停在原位', Math.abs(afterUp.top) <= 6, 'top=' + afterUp.top);
check('插入后当前章不变', afterUp.cur === 'chapter-03.html', afterUp.cur);

/* 再往上一次：第一章接上；第二次就该到底不动了 */
await evaluate(`window.scrollTo(0, 600); 1`);
await sleep(450);
await pullUpTo();
await sleep(1500);
const upTwice = await evaluate(`[...document.querySelectorAll('.chapter-block')].map(b => b.dataset.file)`);
check('继续上滑把第一章也接上', upTwice[0] === 'chapter-01.html' && upTwice.length === 3, JSON.stringify(upTwice));
await evaluate(`window.scrollTo(0, 600); 1`);
await sleep(450);
await pullUpTo();
await sleep(1200);
const upStop = await evaluate(`document.querySelectorAll('.chapter-block').length`);
check('到第一章就停，不再往上插', upStop === 3, 'blocks=' + upStop);

/* 滚回上一章的正文里，URL 与章节 id 要跟着走 */
await evaluate(`(() => {
  const b = document.querySelectorAll('.chapter-block')[1];
  window.scrollTo(0, b.getBoundingClientRect().top + window.pageYOffset + 500);
  return 1;
})()`);
await sleep(900);
const upEntered = await evaluate(`({ cur: LY.store.getCurrentFileName(), path: location.pathname })`);
check('往上滚进上一章：URL 与章节 id 同步',
  upEntered.cur === 'chapter-02.html' && upEntered.path.indexOf('chapter-02') >= 0,
  JSON.stringify(upEntered));

/* 键盘 ←：链条里没有上一章时，插到上方并落位到它的开头 */
await goto(BASE + '/novel/chapter-02.html');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); 1`);
await sleep(1500);
const kbdUp = await evaluate(`({
  blocks: [...document.querySelectorAll('.chapter-block')].map(b => b.dataset.file),
  top: Math.round(document.querySelector('.chapter-block').getBoundingClientRect().top),
  cur: LY.store.getCurrentFileName()
})`);
check('键盘 ← 把上一章插到上方并落位到章首',
  kbdUp.blocks[0] === 'chapter-01.html' && Math.abs(kbdUp.top) < 4 && kbdUp.cur === 'chapter-01.html',
  JSON.stringify(kbdUp));

/* 末章滚到底不追加、不报错 */
await goto(BASE + '/novel/chapter-07.html');
await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight); 1`);
await sleep(1300);
const lastCh = await evaluate(`({
  blocks: document.querySelectorAll('.chapter-block').length,
  pct: LY.engine.getCurrentProgressPct()
})`);
check('末章滚到底不再追加、不报错', lastCh.blocks === 1 && lastCh.pct >= 95, JSON.stringify(lastCh));

section('末章收束卡');

/* 中间章不该出现「读完了」——那个按钮只在真有下一章可等时才成立 */
await goto(BASE + '/novel/chapter-03.html');
await sleep(700);
const midCoda = await evaluate(`document.querySelectorAll('.chapter-coda').length`);
check('中间章没有收束卡', midCoda === 0, 'count=' + midCoda);

await goto(BASE + '/novel/chapter-07.html');
await sleep(900);
/* 期望值全部按 CHAPTERS 现算，不在测试里写死「7 章 / 15,648 字」——
   加一章之后这条断言不该需要跟着改 */
const coda = await evaluate(`(() => {
  const box = document.querySelector('.chapter-coda');
  if (!box) return { ok: false };
  const list = window.CHAPTERS;
  const words = list.reduce((n, c) => n + (c.words || 0), 0);
  const last = list[list.length - 1];
  const say = box.querySelector('.coda-say');
  return {
    ok: true,
    inLast: box.parentNode.dataset.file === last.file,
    countText: box.querySelector('.coda-count').textContent,
    updatedText: (box.querySelector('.coda-updated') || {}).textContent || '',
    expectCount: list.length + ' 章',
    /* 不在模板字符串里写正则转义：\d 会被吞成 d，改用 toLocaleString */
    expectWords: Number(words).toLocaleString('en-US'),
    hasUpdated: !!last.updated,
    back: box.querySelector('.coda-back').getAttribute('href'),
    sayHref: say ? (say.getAttribute('href') || '') : ''
  };
})()`);
check('末章出现收束卡，且只挂在最后一块上', coda.ok && coda.inLast, JSON.stringify(coda).slice(0, 200));
check('收束卡显示全书章数与字数',
  coda.countText.indexOf(coda.expectCount) >= 0 && coda.countText.indexOf(coda.expectWords) >= 0,
  coda.countText);
/* 漏填 updated 时给一条说得清失败的断言，而不是让下面那条含糊地挂掉 */
check('末章登记了 updated 字段', coda.hasUpdated, '在 js/chapters.js 给末章补 updated: YYYY-MM-DD');
check('收束卡显示最近更新日期',
  coda.updatedText.indexOf('最近更新') >= 0 && /今天|昨天|月/.test(coda.updatedText),
  coda.updatedText);
check('回目录按钮指向目录页', coda.back === 'index.html', coda.back);
check('「写给作者」指向 issue 新建页', coda.sayHref.indexOf('github.com') >= 0 && coda.sayHref.indexOf('issues/new') >= 0, coda.sayHref.slice(0, 60));

/* 可点性必须按真实坐标点：el.click() 和 elementFromPoint 都绕不过覆盖层，
   章末三颗按钮曾被全屏的 .reader-tap-area 整个盖住，直接调用照样绿，手机上一按没反应。 */
await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight); 1`);
await sleep(700);

const nudgeAt = await evaluate(`(() => {
  const el = document.querySelector('.chapter-coda .coda-nudge');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
           before: (JSON.parse(localStorage.getItem('reader-nudge') || '{"count":0}').count || 0) };
})()`);
await evaluate(`window.__ev = []; ['pointerdown','pointerup','touchstart','touchend','mousedown','mouseup','click'].forEach(function(t){ document.addEventListener(t, function(e){ window.__ev.push(t + '@' + (e.target.className || e.target.tagName)); }, true); }); 1`);
await clickAt(nudgeAt.x, nudgeAt.y);
await sleep(500);
console.log('EVENTS:', JSON.stringify(await evaluate(`window.__ev`)), 'AT', nudgeAt.x, nudgeAt.y);
const nudgeAfterReal = await evaluate(`(JSON.parse(localStorage.getItem('reader-nudge') || '{"count":0}').count || 0)`);
check('真实坐标点「催更」：按钮真的响应',
  nudgeAfterReal === nudgeAt.before + 1,
  nudgeAt.before + ' → ' + nudgeAfterReal);

/* 「写给作者」会开新标签，先就地拦一次，只验证它确实被点中 */
const sayAt = await evaluate(`(() => {
  const a = document.querySelector('.chapter-coda .coda-say');
  window.__sayFired = 0;
  a.addEventListener('click', function (e) { e.preventDefault(); window.__sayFired = 1; }, { once: true });
  const r = a.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
await clickAt(sayAt.x, sayAt.y);
await sleep(350);
const sayFired = await evaluate(`window.__sayFired === 1`);
check('真实坐标点「写给作者」：链接被点中', sayFired);

/* 但空白处仍然要能翻页：修遮挡不能顺手把「点下半屏翻页」弄丢 */
const zoneHit = await evaluate(`(() => {
  const el = document.elementFromPoint(Math.round(innerWidth / 2), Math.round(innerHeight * 0.92));
  return { cls: el ? (el.className || el.tagName) : 'null' };
})()`);
check('空白处仍在翻页感应区内', /reader-tap-zone/.test(zoneHit.cls), zoneHit.cls);

/* 底部断层：coda 的留白如果用 margin，会塌出 .reading-wrapper，
   滚到底就露一条 body 的站点渐变（阅读区是纯色，两色一撞就是一道横带） */
const seam = await evaluate(`({
  wrapBottom: Math.round(document.querySelector('.reading-wrapper').getBoundingClientRect().bottom),
  vh: innerHeight,
  bodyImage: getComputedStyle(document.body).backgroundImage,
  bodyColor: getComputedStyle(document.body).backgroundColor,
  wrapColor: getComputedStyle(document.querySelector('.reading-wrapper')).backgroundColor
})`);
check('滚到底阅读容器铺到视口底部，不露缝',
  seam.wrapBottom >= seam.vh - 1,
  seam.wrapBottom + ' / ' + seam.vh);
check('阅读页 body 是纯色阅读底，不是站点渐变',
  seam.bodyImage === 'none' && seam.bodyColor === seam.wrapColor,
  seam.bodyImage + ' | ' + seam.bodyColor + ' vs ' + seam.wrapColor);

const nudge = await evaluate(`(() => {
  const btn = document.querySelector('.chapter-coda .coda-nudge');
  const before = JSON.parse(localStorage.getItem('reader-nudge') || '{"count":0}').count || 0;
  btn.click();
  const after = JSON.parse(localStorage.getItem('reader-nudge') || '{"count":0}').count || 0;
  return { before, after, text: btn.textContent, toast: (document.getElementById('readerToast') || {}).textContent || '' };
})()`);
check('催更点一次计数 +1 并落盘', nudge.after === nudge.before + 1, JSON.stringify(nudge));
check('催更后按钮显示累计次数', /第 \d+ 次/.test(nudge.text), nudge.text);
check('催更后有反馈提示', /催更/.test(nudge.toast), nudge.toast);

/* 无限流：从第六章往下接到第七章，收束卡得跟着出现，且只能有一张 */
await goto(BASE + '/novel/chapter-06.html');
await sleep(800);
await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight); 1`);
await sleep(1800);
const flowCoda = await evaluate(`(() => {
  const blocks = [...document.querySelectorAll('.chapter-block')];
  const box = document.querySelector('.chapter-coda');
  return {
    blocks: blocks.map(b => b.dataset.file),
    codaIn: box ? (box.parentNode.dataset.file || '') : '',
    codas: document.querySelectorAll('.chapter-coda').length
  };
})()`);
check('接到末章后收束卡出现在末章块里、只一张',
  flowCoda.blocks.length === 2 && flowCoda.codaIn === 'chapter-07.html' && flowCoda.codas === 1,
  JSON.stringify(flowCoda));

/* 「读完了」是普通跳转：点完真的到目录，并留下读完的标记 */
await goto(BASE + '/novel/chapter-07.html');
await sleep(900);
await evaluate(`window.scrollTo(0, document.documentElement.scrollHeight); 1`);
await sleep(600);
const backAt = await evaluate(`(() => {
  const r = document.querySelector('.chapter-coda .coda-back').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`);
await clickAt(backAt.x, backAt.y);   /* 真实坐标：这颗按钮同样压在翻页层下面 */
await sleep(1400);
const backNav = await evaluate(`({
  path: location.pathname,
  finished: !!localStorage.getItem('reader-finished')
})`);
check('点「读完了」回到目录并记下读完',
  backNav.path.indexOf('/novel/index.html') >= 0 && backNav.finished,
  JSON.stringify(backNav));

await goto(BASE + '/novel/chapter-01.html');
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); 1`);
await sleep(700);
const edge = await evaluate(`({
  path: location.pathname,
  toast: (document.getElementById('readerToast') || {}).textContent || ''
})`);
check('第一章按 ← 只给提示、不跳转',
  edge.path.indexOf('chapter-01') >= 0 && /第一章/.test(edge.toast),
  edge.path + ' / ' + edge.toast);

section('全局');
check('全程无未捕获异常', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));

const passed = results.filter(r => r.ok).length;
console.log('\n' + (passed === results.length ? '✓ 全部通过' : '✗ 有失败') + `：${passed}/${results.length}`);
await cleanup(passed === results.length ? 0 : 1);
