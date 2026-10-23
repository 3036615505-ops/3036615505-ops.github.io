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
      const x0 = Math.round((r.x + r.w * 0.15) * sx), x1 = Math.round((r.x + r.w * 0.85) * sx);
      const y0 = Math.round((r.y + r.h * 0.2) * sy), y1 = Math.round((r.y + r.h * 0.8) * sy);
      if (x1 <= x0 || y1 <= y0 || x0 < 0 || y0 < 0 || x1 > bmp.width || y1 > bmp.height) return null;
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

  const collected = await ev(COLLECT);
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
  await ev(`document.getElementById('__contrast_probe').remove()`);

  const rects = collected.list.map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));
  const bgs = await ev(SAMPLE({ dataUrl: 'data:image/png;base64,' + data, rects }));

  const rows = collected.list.map((e, i) => {
    const bg = bgs[i] || [255, 255, 255];
    const fg = parseRGB(e.color);
    const cr = contrast(fg, bg);
    const need = threshold(e.fontSize, e.bold);
    return { ...e, fg: hex(fg), bg: hex(bg), cr: +cr.toFixed(2), need, pass: cr >= need };
  }).filter((r) => (MIN_ONLY === null ? true : !r.pass || r.cr < MIN_ONLY));

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
      const fails = r.rows.filter((x) => !x.pass);
      if (fails.length) exitCode = 1;
      console.log(`\n### ${r.page}  [data-theme=${r.theme}]  元素 ${r.rows.length} 个，未达标 ${fails.length} 个`);
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
