#!/usr/bin/env node
/**
 * tools/content-lib.mjs —— Android 原生版「内容契约」的共享实现
 *
 * 站点仍是唯一发布面：content/*.json 只是给原生 App 读的一份同源数据镜像，
 * 由站点自己的数据源派生，**不进 PRECACHE、不带 ?v=、不被任何页面引用**。
 * 因此新增/更新这些文件既不升 ?v= 也不升 CACHE（判据永远是 PRECACHE 的字节）。
 *
 * 三个入口共用本文件：
 *   tools/gen-content.mjs       全量生成（不碰任何现有 HTML/CSS/JS）
 *   tools/render-chapter.mjs    作者改稿后，同一次运行刷新该章 JSON + manifest
 *   tools/make-characters.mjs   人物设定同步后，刷新 characters.json + manifest
 *
 * 守卫 tools/check-content.mjs **刻意不 import 本文件的 HTML 解析器**：它用另一套
 * 独立解析路径 + manuscript / chapters.js / characters-data.js 三方交叉比对。
 * 生成器与守卫同源解析会让「解析器一起漏掉某种节点」变成静默全绿 —— 这是本项目
 * 段序号坑 17 的同型风险，必须靠不同解析路径互检。
 *
 * 零依赖：只用 Node 内置模块。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tpl = require('./chapter-template.cjs');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT_DIR = path.join(ROOT, 'content');
export const CHAPTERS_JS = path.join(ROOT, 'js', 'chapters.js');
export const CHARACTERS_JS = path.join(ROOT, 'js', 'characters-data.js');
export const FLAGS_JSON = path.join(ROOT, 'flags.json');
export const NOVEL_DIR = path.join(ROOT, 'novel');
export const MS_DIR = path.join(ROOT, 'manuscript');
export const ASSETS_DIR = path.join(ROOT, 'assets');
export const SCHEMA = 1;
export const SITE_ASSETS_BASE = 'https://zephyrw.site/assets/';

export const ARTICLE_OPEN = '<article class="chapter-content">';
export const ARTICLE_CLOSE = '</article>';

/* ---------- 通用 ---------- */

export function sha12(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function jsonText(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 只在字节真的变化时落盘，保证「对同一份数据跑两次，git status 为空」。 */
export function writeJsonIfChanged(file, obj) {
  const text = jsonText(obj);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.writeFileSync(file, text, 'utf8');
  return true;
}

export function chapterJsonName(num) {
  return 'chapter-' + String(num).padStart(2, '0') + '.json';
}

export function chapterHtmlName(entry) {
  return String(entry.file).replace(/\.html$/, '');
}

export function readChapters() {
  return tpl.readChaptersFile(CHAPTERS_JS);
}

/** 独立求值 js/characters-data.js 的 CHARACTERS（口径同 make-characters.mjs）。 */
export function readCharacters() {
  const src = fs.readFileSync(CHARACTERS_JS, 'utf8');
  const start = src.indexOf('var CHARACTERS = [');
  if (start < 0) throw new Error('characters-data.js 里找不到 CHARACTERS 数组');
  const open = src.indexOf('[', start);
  const end = src.indexOf('\n];', open);
  if (end < 0) throw new Error('CHARACTERS 数组没有正常结束');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('result = ' + src.slice(open, end + 2), sandbox);
  if (!Array.isArray(sandbox.result) || !sandbox.result.length) {
    throw new Error('CHARACTERS 不是非空数组');
  }
  return sandbox.result;
}

export function thumbName(portrait) {
  return String(portrait).replace(/-1024\.webp$/, '-thumb.webp');
}

export function unescapeText(s) {
  return tpl.unescapeText(s);
}

/* ---------- 页面 → token（生成器侧） ---------- */

/**
 * 把章节页 `<article class="chapter-content">` 内部切成 token。
 *
 * 刻意写成「整段正则穷举 + 空隙必须全空白」而不是逐字符扫描：任何新出现的
 * 标签/文本都会落在空隙里并报错，不会静默从契约里消失。
 */
export function parseArticleTokens(html, label) {
  const open = html.indexOf(ARTICLE_OPEN);
  if (open < 0) throw new Error(label + '：找不到 ' + ARTICLE_OPEN);
  const start = open + ARTICLE_OPEN.length;
  const end = html.indexOf(ARTICLE_CLOSE, start);
  if (end < 0) throw new Error(label + '：找不到 ' + ARTICLE_CLOSE);
  const inner = html.slice(start, end);

  const re = /<h1>([\s\S]*?)<\/h1>|<p>([\s\S]*?)<\/p>|<div class="scene-break"><\/div>|<div class="chapter-date([^"]*)">([\s\S]*?)<\/div>/g;
  const found = [];
  let m;
  let pos = 0;
  while ((m = re.exec(inner)) !== null) {
    if (inner.slice(pos, m.index).replace(/\s/g, '')) {
      throw new Error(label + '：正文区有未识别的结构（第 ' + (pos + 1) + ' 字符起）：' +
        JSON.stringify(inner.slice(pos, pos + 60)));
    }
    found.push(m);
    pos = m.index + m[0].length;
  }
  if (inner.slice(pos).replace(/\s/g, '')) {
    throw new Error(label + '：正文区末尾有未识别的结构：' +
      JSON.stringify(inner.slice(pos, pos + 60)));
  }

  let h1 = '';
  const tokens = [];
  found.forEach((hit) => {
    if (hit[1] !== undefined) {
      if (h1) throw new Error(label + '：正文区出现第二个 <h1>');
      h1 = unescapeText(hit[1]).trim();
    } else if (hit[2] !== undefined) {
      tokens.push({ type: 'p', text: unescapeText(hit[2]) });
    } else if (hit[3] !== undefined) {
      tokens.push({ type: 'date', end: /chapter-date-end/.test(hit[3]), text: unescapeText(hit[4]) });
    } else {
      tokens.push({ type: 'break' });
    }
  });
  if (!h1) throw new Error(label + '：正文区没有 <h1>');
  if (!tokens.some((t) => t.type === 'p')) throw new Error(label + '：正文区一个 <p> 都没有');
  return { h1, tokens };
}

/** 余韵卡在 </article> 之外、</section> 之前，是页面 HTML 里唯一的文案出处。 */
export function parseAfterglowBlock(html, label) {
  const outer = /<div class="chapter-afterglow">([\s\S]*?)<\/div>\s*<\/section>/.exec(html);
  if (!outer) throw new Error(label + '：找不到 .chapter-afterglow 区块');
  const block = outer[1].replace(/<!--[\s\S]*?-->/g, '');
  const kicker = /<div class="afterglow-kicker">([\s\S]*?)<\/div>/.exec(block);
  const text = /<p>([\s\S]*?)<\/p>/.exec(block);
  const seal = /<div class="chapter-seal"><span>([\s\S]*?)<\/span><\/div>/.exec(block);
  if (!kicker || !text || !seal) {
    throw new Error(label + '：余韵卡缺 kicker / 引文 / 印章（不允许静默补占位文案）');
  }
  return {
    kicker: unescapeText(kicker[1]).trim(),
    text: unescapeText(text[1]).trim(),
    seal: unescapeText(seal[1]).trim(),
    share: /class="afterglow-share"/.test(block)
  };
}

/* ---------- token → JSON ---------- */

/**
 * 段序号的命门：`index` 只对 type:'p' 递增，且是 `.chapter-content` 内
 * querySelectorAll('p') 的 0 基全量序号（含空段、不过滤），与 Web 版
 * 进度锚点 anchor.i、搜索落点 {i,o} 同口径。结构节点用 before 定位，**不占号**。
 */
export function buildParagraphs(tokens) {
  let pIndex = 0;
  const out = [];
  tokens.forEach((t) => {
    if (t.type === 'p') {
      out.push({ index: pIndex, type: 'p', text: t.text });
      pIndex += 1;
    } else if (t.type === 'break') {
      out.push({ type: 'scene-break', before: pIndex });
    } else if (t.type === 'date') {
      const node = { type: 'date', before: pIndex, text: t.text };
      if (t.end) node.end = true;
      out.push(node);
    } else {
      throw new Error('未知正文 token：' + JSON.stringify(t));
    }
  });
  return out;
}

export function hashChapter(payload) {
  const copy = Object.assign({}, payload);
  delete copy.hash;
  return sha12(jsonText(copy));
}

export function buildChapterPayload(entry, tokens, afterglow) {
  const paragraphs = buildParagraphs(tokens);
  const paragraphCount = paragraphs.filter((p) => p.type === 'p').length;
  const payload = {
    schema: SCHEMA,
    num: entry.num,
    title: entry.title,
    file: entry.file,
    words: entry.words,
    blurb: entry.blurb,
    year: entry.year
  };
  if (entry.date !== undefined) payload.date = entry.date;
  if (entry.dates !== undefined) payload.dates = entry.dates.slice();
  if (entry.term !== undefined) payload.term = entry.term;
  if (entry.volume !== undefined) payload.volume = entry.volume;
  payload.seal = entry.seal;
  payload.leaf = entry.leaf;
  payload.updated = entry.updated;
  /* 页内落款（页面 .chapter-date 文本）与元数据 date/dates 是两套东西，分开存、分开验。 */
  payload.storyDate = paragraphs.filter((p) => p.type === 'date').map((p) => p.text);
  payload.paragraphCount = paragraphCount;
  payload.paragraphs = paragraphs;
  payload.afterglow = {
    kicker: afterglow.kicker,
    text: afterglow.text,
    seal: afterglow.seal,
    share: !!afterglow.share
  };
  payload.hash = '';
  payload.hash = hashChapter(payload);
  return payload;
}

/** 从磁盘上的某一章页面直接产出 JSON（gen-content 用）。 */
export function chapterPayloadFromHtml(entry) {
  const file = path.join(NOVEL_DIR, entry.file);
  const html = fs.readFileSync(file, 'utf8');
  const { tokens } = parseArticleTokens(html, entry.file);
  const afterglow = parseAfterglowBlock(html, entry.file);
  return buildChapterPayload(entry, tokens, afterglow);
}

/* ---------- 人物 / 资源 ---------- */

export function buildCharactersPayload(chars) {
  return {
    schema: SCHEMA,
    count: chars.length,
    items: chars.map((c) => ({
      slug: c.slug,
      name: c.name,
      group: c.group,
      primary: !!c.primary,
      portrait: c.portrait || '',
      initial: c.initial || '',
      role: c.role || '',
      tags: (c.tags || []).slice(),
      quote: c.quote || '',
      desc: c.desc || '',
      birthday: c.birthday || '',
      traits: (c.traits || []).slice(),
      bio: (c.bio || []).slice(),
      portraitUrl: c.portrait ? SITE_ASSETS_BASE + c.portrait : '',
      thumbUrl: c.portrait ? SITE_ASSETS_BASE + thumbName(c.portrait) : ''
    }))
  };
}

export function buildAssetsPayload(chars) {
  const portraits = [...new Set(chars.map((c) => c.portrait).filter(Boolean))].sort();
  const fonts = fs.readdirSync(path.join(ASSETS_DIR, 'fonts'))
    .filter((f) => /\.woff2$/.test(f)).sort();
  return {
    baseUrl: SITE_ASSETS_BASE,
    portraits,
    thumbs: portraits.map(thumbName).sort(),
    fonts
  };
}

/* ---------- manifest ---------- */

/**
 * 汇总全部章节 JSON + characters.json + flags.json 的字节身份。
 * contentVersion 用 hash 不用时间戳：重新生成但内容没变时**不变**，客户端不会白拉。
 * generatedAt 只在 contentVersion 真的变化时更新，否则重跑生成器会污染 git status。
 */
export function buildManifest() {
  const chapters = readChapters().slice().sort((a, b) => a.num - b.num);
  const entries = chapters.map((entry) => {
    const file = path.join(CONTENT_DIR, chapterJsonName(entry.num));
    if (!fs.existsSync(file)) {
      throw new Error('缺少 ' + path.relative(ROOT, file) +
        '（先跑 node tools/gen-content.mjs 或 node tools/render-chapter.mjs --all）');
    }
    const doc = readJson(file);
    return {
      num: entry.num,
      file: entry.file,
      updated: entry.updated,
      hash: doc.hash,
      paragraphCount: doc.paragraphCount
    };
  });

  const charsFile = path.join(CONTENT_DIR, 'characters.json');
  if (!fs.existsSync(charsFile)) {
    throw new Error('缺少 content/characters.json（先跑 node tools/gen-content.mjs）');
  }
  const charsDoc = readJson(charsFile);
  const charsHash = sha12(fs.readFileSync(charsFile, 'utf8'));
  const flagsText = fs.readFileSync(FLAGS_JSON, 'utf8');
  const flagKeys = Object.keys(JSON.parse(flagsText).flags || {}).sort();
  const contentVersion = sha12([
    'schema:' + SCHEMA,
    ...entries.map((e) => e.num + ':' + e.hash),
    'characters:' + charsHash,
    'flags:' + flagsText
  ].join('\n'));

  const manifestFile = path.join(CONTENT_DIR, 'manifest.json');
  let generatedAt = new Date().toISOString();
  if (fs.existsSync(manifestFile)) {
    try {
      const old = readJson(manifestFile);
      if (old.contentVersion === contentVersion && old.generatedAt) generatedAt = old.generatedAt;
    } catch (err) { /* 旧文件坏了就直接用当前时间重写 */ }
  }

  return {
    schema: SCHEMA,
    contentVersion,
    generatedAt,
    chapters: entries,
    characters: { hash: charsHash, count: charsDoc.count },
    flags: { url: '/flags.json', keys: flagKeys },
    assets: buildAssetsPayload(charsDoc.items)
  };
}

/** 返回 { changed, contentVersion }；写盘前会确认全部章节 JSON 齐全。 */
export function refreshManifest() {
  const manifest = buildManifest();
  const changed = writeJsonIfChanged(path.join(CONTENT_DIR, 'manifest.json'), manifest);
  return { changed, contentVersion: manifest.contentVersion };
}
