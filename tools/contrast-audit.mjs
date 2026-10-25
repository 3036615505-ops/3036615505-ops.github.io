#!/usr/bin/env node
/**
 * tools/contrast-audit.mjs — 按 WCAG 2.1 相对亮度公式实算页面文字对比度
 *
 * 为什么要「采样真实像素」而不是读 CSS：
 *   本站底色大量使用 linear-gradient / radial-gradient 叠加（.phone-frame、.home-hero、
 *   .home-quote::before…），getComputedStyle 拿到的 background-color 是透明，
 *   靠人肉猜渐变色不可能得到可信的对比度。所以这里：
 *     ① 先把所有文字临时改成完全透明（color + -webkit-text-fill-color）
 *     ② 截一张图 —— 此时每个文字位置上的像素就是「真实的合成背景」
 *     ③ 在该元素的包围盒内取样，逐通道取中位数作为背景色
 *   然后和该元素真实的 color 一起算对比度。
 *
 * 用法：
 *   node tools/contrast-audit.mjs                       # 审 4 个 tab 页 × light+dark
 *   node tools/contrast-audit.mjs --theme dark          # 只看深色
 *   node tools/contrast-audit.mjs --page /index.html    # 只看一页
 *   node tools/contrast-audit.mjs --min 4.5             # 只列出低于阈值的
 *   node tools/contrast-audit.mjs --json out.json       # 额外输出 JSON
 *   node tools/contrast-audit.mjs --inject fix.css      # 注入一份候选样式再测（做方案对比用）
 *   node tools/contrast-audit.mjs --inject ':root{--text-muted:#7a6b5a}'
 *
 * 环境变量：
 *   BROWSER=/path/to/chrome|msedge    浏览器可执行文件（默认按平台猜）
 *
 * 依赖：Node 22+（内置 WebSocket / fetch），本地已装 Edge 或 Chrome。零外部包。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VIEW_W = 412;
const VIEW_H = 1500;          // 够高，让整页都在视口内，便于一次截图采样
const DPR = 2;

/* ---------------------------------------------------------------- args */
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PAGES = arg('page')
  ? [arg('page')]
  : ['/index.html', '/novel/index.html', '/novel/characters.html', '/quotes.html'];
const THEMES = arg('theme') ? [arg('theme')] : ['dark', 'light'];
const MIN_ONLY = arg('min') ? parseFloat(arg('min')) : null;
const JSON_OUT = arg('json');
/**
 * 候选样式注入：可以给一段 CSS 字面量，也可以给一个 .css 文件路径。
 * 用来做「方案 A / B / C 各自能把未达标数降到多少」的对比，不用改仓库。
 */
const INJECT = (() => {
  const v = arg('inject');
  if (!v) return null;
  const looksLikeFile = /\.css$/i.test(v) && fs.existsSync(path.resolve(v));
  return looksLikeFile ? fs.readFileSync(path.resolve(v), 'utf8') : v;
})();

/**
 * 归一化页面路径。两个坑都要吃掉：
 * ① 允许写成 index.html / novel/index.html（不强制前导斜杠）
 * ② Git Bash（MSYS2）会把 `--page /index.html` 这种以斜杠开头的参数
 *    自动改写成 Windows 路径（如 C:/Program Files/Git/index.html），
 *    这里把那段前缀剥掉，否则拼出来的 URL 非法。
 */
function normalizePage(p) {
  let s = String(p).replace(/\\/g, '/');
  const m = s.match(/^[A-Za-z]:\/Program Files\/Git\/(.*)$/i);
  if (m) s = m[1];
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}
for (let i = 0; i < PAGES.length; i++) PAGES[i] = normalizePage(PAGES[i]);

/* --------------------------------------------------------- static server */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain'
};
const GZIP = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt']);

function startServer() {
  const srv = http.createServer((req, res) => {
    let file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('404'); return; }
    const ext = path.extname(file).toLowerCase();
    const buf = fs.readFileSync(file);
    const h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' };
    if (GZIP.has(ext) && /gzip/.test(req.headers['accept-encoding'] || '')) {
      const gz = zlib.gzipSync(buf, { level: 9 });
      h['Content-Encoding'] = 'gzip'; h['Content-Length'] = gz.length;
      res.writeHead(200, h); res.end(gz);
    } else {
      h['Content-Length'] = buf.length;
      res.writeHead(200, h); res.end(buf);
    }
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* ---------------------------------------------------------------- browser */
function findBrowser() {
  if (process.env.BROWSER) return process.env.BROWSER;
  const cands = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium'
  ];
  const hit = cands.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('找不到浏览器，请设置 BROWSER= 环境变量');
  return hit;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launch(bin, userDir, port) {
  return spawn(bin, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`,
    '--no-first-run', '--no-default-browser-check', '--no-proxy-server',
    '--disable-extensions', '--disable-background-networking',
    `--window-size=${VIEW_W},${VIEW_H}`, 'about:blank'
  ], { stdio: 'ignore' });
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function connect(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
        return new CDP(ws);
      }
    } catch (e) { /* retry */ }
    await sleep(200);
  }
  throw new Error('连不上浏览器调试端口');
}

/**
 * 用 --remote-debugging-port=0 启动，再从 user-data-dir 里的 DevToolsActivePort
 * 读出真实端口。比随便猜一个端口稳，避免撞上残留的旧实例。
 */
async function launchAndConnect(bin, userDir) {
  const proc = launch(bin, userDir, 0);
  const portFile = path.join(userDir, 'DevToolsActivePort');
  for (let i = 0; i < 150; i++) {
    await sleep(100);
    if (fs.existsSync(portFile)) {
      const first = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
      if (/^\d+$/.test(first)) return { proc, cdp: await connect(Number(first)) };
    }
  }
  try { proc.kill(); } catch (e) { /* ignore */ }
  throw new Error('浏览器没写出 DevToolsActivePort');
}

/* ------------------------------------------------------------- 页面内脚本 */
const COLLECT = `(() => {
  function label(el) {
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
  }
  const out = [];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH', 'POLYLINE', 'RECT', 'CIRCLE', 'TITLE']);
  document.querySelectorAll('body *').forEach((el) => {
    if (SKIP.has(el.tagName)) return;
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim()).join(' ');
    if (!own) return;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return;
    if (r.top > window.innerHeight || r.bottom < 0) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;
    if (parseFloat(cs.opacity) < 0.1) return;
    /* 再往祖先链上查一层。本站的弹窗（设置/摘句/数据）关闭时是 overlay 上
       opacity:0 —— opacity 不继承，按钮自身仍是 opacity:1、display:flex，
       光看自己完全正常，于是被收进来；而截图里它背后其实是页面本身，
       量出来的「背景色」是假的（实测：关闭的摘句弹窗里金底白字的导出按钮
       被算成 1.02:1，打开后实测 5.09:1）。谁把它藏了就跳过谁。 */
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.visibility === 'hidden' || ps.display === 'none' || parseFloat(ps.opacity) < 0.1) return;
    }
    const col = cs.color.match(/[\\d.]+/g);
    if (!col || (col.length === 4 && parseFloat(col[3]) === 0)) return;
    out.push({
      sel: label(el),
      text: own.slice(0, 26),
      color: cs.color,
      fontSize: parseFloat(cs.fontSize),
      bold: (parseInt(cs.fontWeight, 10) || 400) >= 700,
      x: r.x, y: r.y, w: r.width, h: r.height
    });
  });
  return { list: out, viewW: window.innerWidth, viewH: window.innerHeight };
})()`;

/** 把截图喂回页面，用 canvas 采样每个元素包围盒内的背景色（逐通道中位数） */
function SAMPLE(payload) {
  return `(async () => {
    const { dataUrl, rects } = ${JSON.stringify(payload)};
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const sx = bmp.width / window.innerWidth;
    const sy = bmp.height / window.innerHeight;
    const median = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
    return rects.map((r) => {
      /* 采样区先按元素盒内缩（15%~85% / 20%~80%），再**裁进截图边界**。
         不裁的后果实测过：贴视口底边的元素（如同学录深色模式里排最后的
         .char-quote）盒子的下半截在截图之外，旧代码直接 return null，
         上层又把 null 当成白色底 [255,255,255] 算对比度 —— 深色卡片上的
         浅金文字被算成 1.94:1 的「未达标」，而它的六个同类在深色底上实测
         8.2~8.5:1。这是量程 bug，不是真实的对比度问题。 */
      const x0 = Math.max(0, Math.round((r.x + r.w * 0.15) * sx));
      const x1 = Math.min(bmp.width, Math.round((r.x + r.w * 0.85) * sx));
      const y0 = Math.max(0, Math.round((r.y + r.h * 0.2) * sy));
      const y1 = Math.min(bmp.height, Math.round((r.y + r.h * 0.8) * sy));
      if (x1 <= x0 || y1 <= y0) return null;
      const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const rs = [], gs = [], bs = [];
      for (let i = 0; i < d.length; i += 4) { rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); }
      return [median(rs), median(gs), median(bs)];
    });
  })()`;
}

/* ----------------------------------------------------------- WCAG 计算 */
const srgb = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const contrast = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
const parseRGB = (css) => {
  const n = css.match(/[\d.]+/g).map(Number);
  return [n[0], n[1], n[2]];
};
const hex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
/** WCAG 2.1：大字号（≥24px，或 ≥18.66px 且加粗）阈值 3:1，正文 4.5:1 */
const threshold = (fontSize, bold) => (fontSize >= 24 || (fontSize >= 18.66 && bold) ? 3 : 4.5);

/* ------------------------------------------------------------------ main */
async function auditPage(cdp, base, page, theme) {
  await cdp.send('Page.navigate', { url: base + '/manifest.json' });
  await sleep(400);
  await cdp.send('Runtime.evaluate', {
    expression: `localStorage.setItem('reader-theme', ${JSON.stringify(theme)})`
  });
  await cdp.send('Page.navigate', { url: base + page });
  for (let i = 0; i < 150; i++) {
    await sleep(80);
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (result.value === 'complete') break;
  }
  await sleep(1500);
  if (INJECT) {
    await cdp.send('Runtime.evaluate', {
      expression: `(() => { const s=document.createElement('style'); s.id='__inject';
        s.textContent = ${JSON.stringify(INJECT)}; document.head.appendChild(s); return s.textContent.length; })()`,
      returnByValue: true
    });
    await sleep(400);
  }

  const ev = async (expr) => {
    const { result } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return result.value;
  };

  /* 视口按页面实际高度自适应：VIEW_H 原是写死的 1500（注释说「够高，让整页都在
     视口内」），但章节从 4 章涨到 7 章后书架页已经超出 1500。贴底元素的内缩采样区
     整段落在截图外 → SAMPLE 返回 null → 上层兜底成白色 → 深色卡片上的浅金文字被
     算成 1.91:1 的假失败（2026-10-25 实测：第七章简介 y=1497、高 23，内缩后
     y0=3003 > y1=3000）。这里量一次真实高度再重建视口，从根上消除「元素在视口外」。
     上限 6000 是防个别页面（如人物簿）截图过大。 */
  const needH = await ev(`Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0) + 40`);
  const useH = Math.max(VIEW_H, Math.min(needH || VIEW_H, 6000));
  if (useH !== VIEW_H) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEW_W, height: useH, deviceScaleFactor: DPR, mobile: true
    });
    await sleep(250);
  }
  const collected = await ev(COLLECT);
  if (process.env.DBG) {
    const d = await ev(`(() => {
      const el = document.querySelector('.chapter-blurb');
      if (!el) return 'no blurb';
      const r = el.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      const chain = [];
      for (let q = el; q && chain.length < 5; q = q.parentElement) chain.push(q.tagName + '.' + (typeof q.className === 'string' ? q.className : '') + '=' + getComputedStyle(q).backgroundColor);
      return JSON.stringify({ rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], top: top ? top.tagName + '.' + (typeof top.className === 'string' ? top.className : '') : null, chain });
    })()`);
    console.log('DBG', page, theme, d);
  }
  const applied = await ev(`document.documentElement.getAttribute('data-theme') || 'light'`);

  // 文字全透明 → 截图 → 采样真实背景
  await ev(`(() => {
    const s = document.createElement('style');
    s.id = '__contrast_probe';
    s.textContent = '*,*::before,*::after{color:transparent !important;-webkit-text-fill-color:transparent !important;text-shadow:none !important}';
    document.head.appendChild(s);
    return true;
  })()`);
  await sleep(400);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  if (process.env.SHOT) fs.writeFileSync(process.env.SHOT.replace('PAGE', page.replace(/\//g, '_')).replace('THEME', theme), Buffer.from(data, 'base64'));
  await ev(`document.getElementById('__contrast_probe').remove()`);

  const rects = collected.list.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));
  const bgs = await ev(SAMPLE({ dataUrl: 'data:image/png;base64,' + data, rects }));

  /* 采样不到（null）**绝不再兜底成白色** —— 这个兜底已经制造过两次假失败：
     ① 贴底元素盒子下半截在截图外（已修：钳制 + 视口自适应）；
     ② 元素内缩后的采样区整段落在截图外（第七章简介，y=1497 超出写死的 1500 视口）。
     两次都是「深色卡片上的浅金文字被算成 1.9:1」，而它的同类实测 8.9:1。
     现在测不到就明确记为 unmeasured：不算未达标（没有证据说它不达标），
     但会在报告里单独列出，避免「悄悄少测了几个」这种更坏的可能。 */
  const rows = collected.list.map((e, i) => {
    const bgv = bgs[i];
    if (!bgv) return { ...e, fg: hex(parseRGB(e.color)), bg: null, cr: null, need: threshold(e.fontSize, e.bold), pass: null, unmeasured: true };
    const fg = parseRGB(e.color);
    const cr = contrast(fg, bgv);
    const need = threshold(e.fontSize, e.bold);
    return { ...e, fg: hex(fg), bg: hex(bgv), cr: +cr.toFixed(2), need, pass: cr >= need, unmeasured: false };
  }).filter((r) => (MIN_ONLY === null ? true : !r.pass || r.cr < MIN_ONLY || r.unmeasured));

  return { page, theme: applied, injected: INJECT ? INJECT.replace(/\s+/g, ' ').trim() : null, rows };
}

const { srv, port: httpPort } = await startServer();
const BASE = `http://127.0.0.1:${httpPort}`;
const bin = findBrowser();
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contrast-'));
const all = [];
let exitCode = 0;
let proc = null;

try {
  const conn = await launchAndConnect(bin, userDir);
  proc = conn.proc;
  const cdp = conn.cdp;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: VIEW_W, height: VIEW_H, deviceScaleFactor: DPR, mobile: true
  });

  for (const page of PAGES) {
    for (const theme of THEMES) {
      const r = await auditPage(cdp, BASE, page, theme);
      all.push(r);
      const fails = r.rows.filter((x) => x.pass === false);
      const unmeas = r.rows.filter((x) => x.unmeasured);
      if (fails.length) exitCode = 1;
      console.log(`\n### ${r.page}  [data-theme=${r.theme}]  元素 ${r.rows.length} 个，未达标 ${fails.length} 个${unmeas.length ? `，无法测量 ${unmeas.length} 个` : ''}`);
      if (r.rows.length) {
        console.log('| 元素 | 文本 | 字号 | 前景 | 背景(实测) | 对比度 | 需 ≥ | 结果 |');
        console.log('|---|---|---|---|---|---|---|---|');
        r.rows.slice().sort((a, b) => a.cr - b.cr).forEach((x) => {
          console.log(`| \`${x.sel}\` | ${x.text.replace(/\|/g, '\\|')} | ${x.fontSize}px${x.bold ? ' B' : ''} | ${x.fg} | ${x.bg} | **${x.cr}** | ${x.need} | ${x.pass ? '✅' : '❌'} |`);
        });
      }
    }
  }

  const totalFails = all.reduce((s, r) => s + r.rows.filter((x) => !x.pass).length, 0);
  console.log(`\n== 合计未达标 ${totalFails} 项 ==`);
  if (JSON_OUT) {
    fs.writeFileSync(path.resolve(JSON_OUT), JSON.stringify(all, null, 2));
    console.log('JSON 已写入', path.resolve(JSON_OUT));
  }
} finally {
  try { proc.kill(); } catch (e) { /* ignore */ }
  srv.close();
  await sleep(400);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
process.exit(exitCode);
