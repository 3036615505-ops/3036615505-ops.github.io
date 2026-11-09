#!/usr/bin/env node
/**
 * tools/check-content.mjs —— content/*.json ↔ 站点 逐字守卫
 *
 * 为什么必须「独立解析」：生成器和守卫若共用同一个 HTML 解析器，解析器一起漏掉
 * 某类节点时两边都全绿，而段序号偏移/日期行丢失**不报错**（HANDOVER 坑 17 同型）。
 * 本文件刻意**不 import** content-lib 的 parseArticleTokens / buildParagraphs，
 * 改用「逐行解析」的另一条路径，并与 manuscript/*.md、js/chapters.js、
 * js/characters-data.js 三方交叉比对。
 *
 *   node tools/check-content.mjs              接入 npm run verify 的静态守卫
 *   node tools/check-content.mjs --self-test  内存变异测试（M-1…M-16），不写盘
 *   node tools/check-content.mjs --verbose    打印逐项检查
 *
 * 检查覆盖主理人裁定 C1/C2/C3：
 *   C2 页面 .chapter-date(+ -end) 元素数 == JSON type:'date' 数且逐条文本比对；
 *      storyDate[] 与元数据 date/dates 分开验；删日期行 / 丢 end / 混字段必须红。
 *   C3 若 twa/app/src/main/assets/content/ 存在（S2 起），种子副本必须逐字一致且
 *      同 contentVersion；只改站点 content 不改种子必须红。S0 无种子包时登记跳过。
 *   C1 App 侧映射表断言属 M2 硬闸门（不在本文件，S2 由 instrumented test 承担）。
 *
 * 零依赖：只用 Node 内置模块；不写任何文件（--self-test 也全程内存）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tpl = require('./chapter-template.cjs');
import {
  ROOT, CONTENT_DIR, SCHEMA, SITE_ASSETS_BASE,
  sha12, jsonText, chapterJsonName, chapterHtmlName, thumbName
} from './content-lib.mjs';

const SEED_DIR = process.env.LINYUAN_SEED_DIR ||
  path.resolve(ROOT, '..', 'twa', 'app', 'src', 'main', 'assets', 'content');

const verbose = process.argv.includes('--verbose');
const selfTest = process.argv.includes('--self-test');

/* ---------- 快照：所有读盘集中在这里，checkAll 只读内存 ---------- */

function buildSnapshot() {
  const files = new Map();
  const put = (rel) => {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) files.set(rel, fs.readFileSync(abs, 'utf8'));
  };
  const chaptersSrc = fs.readFileSync(path.join(ROOT, 'js', 'chapters.js'), 'utf8');
  const chapters = tpl.readChapters(chaptersSrc);
  ['js/chapters.js', 'js/characters-data.js', 'flags.json', 'sw.js',
    'content/manifest.json', 'content/characters.json'].forEach(put);
  chapters.forEach((entry) => {
    put('content/' + chapterJsonName(entry.num));
    put('novel/' + entry.file);
    put('manuscript/' + chapterHtmlName(entry) + '.md');
  });
  // 页面引用扫描：只读 novel/ 下的 HTML 文件名与内容（31 个文件，成本可忽略）
  fs.readdirSync(path.join(ROOT, 'novel')).filter((f) => /\.html$/.test(f)).forEach((f) => {
    put('novel/' + f);
  });

  const fontFiles = fs.readdirSync(path.join(ROOT, 'assets', 'fonts'))
    .filter((f) => /\.woff2$/.test(f)).sort();
  const seedFiles = new Map();
  let hasSeed = false;
  if (fs.existsSync(SEED_DIR)) {
    hasSeed = true;
    fs.readdirSync(SEED_DIR).filter((f) => /\.json$/.test(f)).forEach((f) => {
      seedFiles.set(f, fs.readFileSync(path.join(SEED_DIR, f), 'utf8'));
    });
  }
  return { files, fontFiles, seedFiles, hasSeed };
}

function cloneSnapshot(snap) {
  return {
    files: new Map(snap.files),
    fontFiles: snap.fontFiles.slice(),
    seedFiles: new Map(snap.seedFiles),
    hasSeed: snap.hasSeed
  };
}

/* ---------- 独立数据源读取（不复用生成器的构造器） ---------- */

function chaptersFrom(snap) {
  return tpl.readChapters(snap.files.get('js/chapters.js'));
}

function charactersFrom(snap) {
  const src = snap.files.get('js/characters-data.js');
  const open = src.indexOf('[', src.indexOf('var CHARACTERS = ['));
  const end = src.indexOf('\n];', open);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('result = ' + src.slice(open, end + 2), sandbox);
  return sandbox.result;
}

function payloadHash(doc) {
  const copy = Object.assign({}, doc);
  delete copy.hash;
  return sha12(jsonText(copy));
}

function unescapeText(s) {
  return tpl.unescapeText(s);
}

/**
 * 独立解析路径：按**行**切 `<article>` 内部（生成器是整段正则穷举）。
 * 任何没认出来的行直接报错，不静默跳过。
 */
function independentArticle(html, label) {
  const open = html.indexOf('<article class="chapter-content">');
  if (open < 0) throw new Error(label + '：找不到 <article class="chapter-content">');
  const start = open + '<article class="chapter-content">'.length;
  const end = html.indexOf('</article>', start);
  if (end < 0) throw new Error(label + '：找不到 </article>');
  const inner = html.slice(start, end);
  const tokens = [];
  let h1 = null;
  inner.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let m;
    if ((m = /^<h1>([\s\S]*?)<\/h1>$/.exec(line))) {
      if (h1 !== null) throw new Error(label + '：第二个 <h1>（第 ' + (i + 1) + ' 行）');
      h1 = unescapeText(m[1]).trim();
    } else if ((m = /^<p>([\s\S]*?)<\/p>$/.exec(line))) {
      tokens.push({ type: 'p', text: unescapeText(m[1]) });
    } else if (line === '<div class="scene-break"></div>') {
      tokens.push({ type: 'break' });
    } else if ((m = /^<div class="chapter-date([^"]*)">([\s\S]*?)<\/div>$/.exec(line))) {
      tokens.push({
        type: 'date', end: /chapter-date-end/.test(m[1]), text: unescapeText(m[2])
      });
    } else {
      throw new Error(label + '：正文区第 ' + (i + 1) + ' 行认不出来：' +
        JSON.stringify(line.slice(0, 60)));
    }
  });
  if (h1 === null) throw new Error(label + '：正文区没有 <h1>');
  // 转成「p 序号 + 结构节点 before」的期望序列
  let p = 0;
  const expected = tokens.map((t) => {
    if (t.type === 'p') return { index: p++, type: 'p', text: t.text };
    if (t.type === 'break') return { type: 'scene-break', before: p };
    const node = { type: 'date', before: p, text: t.text };
    if (t.end) node.end = true;
    return node;
  });
  return {
    h1,
    expected,
    pTexts: tokens.filter((t) => t.type === 'p').map((t) => t.text),
    pCount: p
  };
}

/** 余韵卡：按缩进切块（生成器用的是「到 </section>」的正则），另一条路径。 */
function independentAfterglow(html, label) {
  const start = html.indexOf('<div class="chapter-afterglow">');
  if (start < 0) throw new Error(label + '：找不到 .chapter-afterglow');
  const end = html.indexOf('\n  </div>', start);
  if (end < 0) throw new Error(label + '：.chapter-afterglow 没有正常结束');
  const block = html.slice(start, end).replace(/<!--[\s\S]*?-->/g, '');
  const kicker = /<div class="afterglow-kicker">([\s\S]*?)<\/div>/.exec(block);
  const text = /<p>([\s\S]*?)<\/p>/.exec(block);
  const seal = /<div class="chapter-seal"><span>([\s\S]*?)<\/span><\/div>/.exec(block);
  if (!kicker || !text || !seal) throw new Error(label + '：余韵卡缺 kicker / 引文 / 印章');
  return {
    kicker: unescapeText(kicker[1]).trim(),
    text: unescapeText(text[1]).trim(),
    seal: unescapeText(seal[1]).trim(),
    share: /class="afterglow-share"/.test(block)
  };
}

/** C2：从 HTML 全文数 .chapter-date（不限 article），与 JSON 的 type:'date' 互验。 */
function pageDateNodes(html) {
  const out = [];
  const re = /<div class="chapter-date([^"]*)">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ end: /chapter-date-end/.test(m[1]), text: unescapeText(m[2]).trim() });
  }
  return out;
}

/* ---------- 检查主体 ---------- */

function checkAll(snap) {
  const errors = [];
  const notes = [];
  let checks = 0;
  const err = (code, msg) => errors.push({ code, msg });
  const ok = (msg) => { checks += 1; if (verbose) console.log('  ✓ ' + msg); };
  const need = (rel) => {
    const text = snap.files.get(rel);
    if (text === undefined) { err('E_MISSING', '缺少 ' + rel); return null; }
    return text;
  };
  const parse = (rel) => {
    const text = need(rel);
    if (text === null) return null;
    try { return JSON.parse(text); } catch (e) {
      err('E_MISSING', rel + ' 不是合法 JSON：' + e.message);
      return null;
    }
  };

  const chapters = chaptersFrom(snap).slice().sort((a, b) => a.num - b.num);
  const chars = charactersFrom(snap);
  const manifest = parse('content/manifest.json');
  const charDoc = parse('content/characters.json');
  const flags = parse('flags.json');

  /* ---- S-0 schema ---- */
  if (manifest && manifest.schema !== SCHEMA) err('E_SCHEMA', 'manifest.schema 应为 ' + SCHEMA);
  if (charDoc && charDoc.schema !== SCHEMA) err('E_SCHEMA', 'characters.schema 应为 ' + SCHEMA);
  ok('schema 版本');

  /* ---- S-1 每章逐字 ---- */
  chapters.forEach((entry) => {
    const rel = 'content/' + chapterJsonName(entry.num);
    const doc = parse(rel);
    const html = need('novel/' + entry.file);
    const md = need('manuscript/' + chapterHtmlName(entry) + '.md');
    if (!doc || html === null || md === null) return;
    const label = entry.file;

    if (doc.schema !== SCHEMA) err('E_SCHEMA', label + ' 的 schema 应为 ' + SCHEMA);

    /* 元数据逐字段（含「多出来的字段」检查，防 date/dates 与 storyDate 混线） */
    const metaKeys = ['num', 'title', 'file', 'words', 'blurb', 'year',
      'date', 'dates', 'term', 'volume', 'seal', 'leaf', 'updated'];
    metaKeys.forEach((k) => {
      const want = entry[k] === undefined ? undefined : entry[k];
      const got = doc[k];
      const same = JSON.stringify(want) === JSON.stringify(got);
      if (!same) {
        err('E_META_FIELD', label + ' 元数据 ' + k + ' 与 chapters.js 不一致：' +
          JSON.stringify(got) + ' ≠ ' + JSON.stringify(want));
      }
    });
    (Object.keys(doc).filter((k) => /^(date|dates|storyDate)$/.test(k)) || []).forEach((k) => {
      if (k === 'storyDate') return;
      if (!metaKeys.includes(k)) err('E_META_FIELD', label + ' 出现多余字段 ' + k);
    });
    if (!Array.isArray(doc.storyDate)) {
      err('E_META_FIELD', label + ' storyDate 必须是数组（页面落款），不能与 date/dates 混用');
    }
    ok(label + ' 元数据');

    /* 页面 → 期望序列（独立逐行解析） */
    let page;
    try { page = independentArticle(html, label); }
    catch (e) { err('E_ARTICLE', e.message); return; }

    /* md 源（第三方）：段落文字逐字、段数守恒 */
    const mdPs = tpl.parseManuscript(md, { title: entry.title }).tokens
      .filter((t) => t.type === 'p').map((t) => t.text);
    if (mdPs.length !== page.pCount) {
      err('E_PARA_COUNT', label + ' 页面 ' + page.pCount + ' 段 vs 源稿 ' + mdPs.length + ' 段');
    }
    mdPs.forEach((t, i) => {
      if (page.pTexts[i] !== t) {
        err('E_PARA_TEXT', label + ' 第 ' + i + ' 段：页面与源稿不一致');
      }
    });
    if (doc.paragraphCount !== page.pCount) {
      err('E_PARA_COUNT', label + ' paragraphCount=' + doc.paragraphCount +
        '，页面裸 <p> 数=' + page.pCount);
    }
    ok(label + ' 段数四方守恒');

    /* paragraphs[] 逐项（index / type / text / before / end） */
    const got = Array.isArray(doc.paragraphs) ? doc.paragraphs : [];
    if (got.length !== page.expected.length) {
      err('E_PARA_COUNT', label + ' paragraphs 长度 ' + got.length +
        '，页面 token 数 ' + page.expected.length);
    }
    page.expected.forEach((want, i) => {
      const g = got[i];
      if (!g) { err('E_PARA_COUNT', label + ' paragraphs 缺第 ' + i + ' 项'); return; }
      if (g.type !== want.type) {
        err('E_PARA_TEXT', label + ' paragraphs[' + i + '].type=' + g.type + '，应为 ' + want.type);
        return;
      }
      if (want.type === 'p') {
        if (g.index !== want.index) {
          err('E_INDEX', label + ' paragraphs[' + i + '].index=' + g.index +
            '，应为 ' + want.index + '（0 基全量、连续无缺口）');
        }
        if (g.text !== want.text) {
          err('E_PARA_TEXT', label + ' 第 ' + want.index + ' 段文字与页面不一致');
        }
        if ('before' in g) err('E_BEFORE', label + ' 段落节点不该有 before');
      } else {
        if ('index' in g) {
          err('E_INDEX', label + ' 结构节点 ' + i + ' 带了 index（结构节点不占段序号）');
        }
        if (g.before !== want.before) {
          err('E_BEFORE', label + ' paragraphs[' + i + '].before=' + g.before +
            '，应为 ' + want.before);
        }
        if (want.type === 'date') {
          if (g.text !== want.text) err('E_DATE_TEXT', label + ' 日期行文字与页面不一致');
          if (!!g.end !== !!want.end) {
            err('E_DATE_END', label + ' 日期行 end 标记与页面 .chapter-date-end 不一致');
          }
        }
      }
    });
    ok(label + ' paragraphs 逐项');

    /* C2：页面 .chapter-date 元素数 == JSON type:'date' 数，且逐条文本 */
    const dateNodes = pageDateNodes(html);
    const jsonDates = got.filter((p) => p.type === 'date');
    if (dateNodes.length !== jsonDates.length) {
      err('E_DATE_COUNT', label + ' 页面 .chapter-date ' + dateNodes.length +
        ' 条 vs JSON type:date ' + jsonDates.length + ' 条（日期行是 <div>，最容易静默丢）');
    }
    dateNodes.forEach((d, i) => {
      const g = jsonDates[i];
      if (!g) return;
      if (g.text !== d.text) err('E_DATE_TEXT', label + ' 第 ' + i + ' 条日期行文字不一致');
      if (!!g.end !== !!d.end) err('E_DATE_END', label + ' 第 ' + i + ' 条日期行 end 标记不一致');
    });
    if (JSON.stringify(doc.storyDate) !== JSON.stringify(dateNodes.map((d) => d.text))) {
      err('E_STORY_DATE', label + ' storyDate[] 与页面 .chapter-date 文本序列不一致');
    }
    ok(label + ' 日期行 C2');

    /* 余韵卡：页面是唯一出处 */
    let after;
    try { after = independentAfterglow(html, label); }
    catch (e) { err('E_AFTERGLOW_TEXT', e.message); return; }
    const a = doc.afterglow || {};
    if (after.kicker !== '《' + entry.title + '》') {
      err('E_AFTERGLOW_KICKER', label + ' 页面卡头不是《' + entry.title + '》：' + after.kicker);
    }
    if (a.kicker !== after.kicker) {
      err('E_AFTERGLOW_KICKER', label + ' afterglow.kicker 与页面不一致');
    }
    if (a.text !== after.text) err('E_AFTERGLOW_TEXT', label + ' afterglow.text 与页面不一致');
    /* 页面印章与 chapters.js 的 seal 不是同一口径（第一章页面「临渊羡鱼」/ seal「临渊」），
       只验「与页面逐字一致」，不做交叉相等。 */
    if (a.seal !== after.seal) err('E_AFTERGLOW_SEAL', label + ' afterglow.seal 与页面不一致');
    if (a.share !== after.share) err('E_AFTERGLOW_SHARE', label + ' afterglow.share 与页面不一致');
    ok(label + ' 余韵卡');

    /* hash 自洽 */
    if (doc.hash !== payloadHash(doc)) {
      err('E_HASH', label + ' 章节 hash 与内容不符（' + doc.hash + ' ≠ ' + payloadHash(doc) + '）');
    }
    ok(label + ' hash');
  });

  /* ---- S-2 人物 ---- */
  if (charDoc) {
    if (charDoc.count !== chars.length || charDoc.items.length !== chars.length) {
      err('E_CHAR_FIELD', 'characters.json 人数 ' + charDoc.count + '/' + charDoc.items.length +
        '，characters-data.js 是 ' + chars.length);
    }
    charDoc.items.forEach((item, i) => {
      const c = chars[i];
      if (!c) return;
      const expect = {
        slug: c.slug, name: c.name, group: c.group, primary: !!c.primary,
        portrait: c.portrait || '', initial: c.initial || '', role: c.role || '',
        tags: (c.tags || []).slice(), quote: c.quote || '', desc: c.desc || '',
        birthday: c.birthday || '', traits: (c.traits || []).slice(),
        bio: (c.bio || []).slice(),
        portraitUrl: c.portrait ? SITE_ASSETS_BASE + c.portrait : '',
        thumbUrl: c.portrait ? SITE_ASSETS_BASE + thumbName(c.portrait) : ''
      };
      Object.keys(expect).forEach((k) => {
        if (JSON.stringify(item[k]) !== JSON.stringify(expect[k])) {
          err('E_CHAR_FIELD', 'characters[' + i + '](' + c.slug + ').' + k + ' 与数据源不一致');
        }
      });
    });
    const groups = charDoc.items.map((c) => c.group);
    const seen = [];
    groups.forEach((g) => { if (seen.indexOf(g) < 0) seen.push(g); });
    if (seen.length !== new Set(groups).size) {
      err('E_CHAR_FIELD', '人物分组不连续（同 group 必须连写）');
    }
    if (manifest && manifest.characters) {
      const real = sha12(snap.files.get('content/characters.json'));
      if (manifest.characters.hash !== real) {
        err('E_CHAR_HASH', 'manifest.characters.hash 与 characters.json 字节不符');
      }
      if (manifest.characters.count !== charDoc.count) {
        err('E_CHAR_FIELD', 'manifest.characters.count 与 characters.json 不符');
      }
    }
    ok('人物逐字段');
  }

  /* ---- S-3 manifest ---- */
  if (manifest) {
    if (!Array.isArray(manifest.chapters) || manifest.chapters.length !== chapters.length) {
      err('E_MANIFEST', 'manifest.chapters 长度应为 ' + chapters.length);
    } else {
      manifest.chapters.forEach((mc, i) => {
        const entry = chapters[i];
        const doc = parse('content/' + chapterJsonName(entry.num));
        if (mc.num !== entry.num || mc.file !== entry.file || mc.updated !== entry.updated) {
          err('E_MANIFEST', 'manifest.chapters[' + i + '] 的 num/file/updated 与 chapters.js 不符');
        }
        if (doc) {
          if (mc.hash !== doc.hash) {
            err('E_MANIFEST', 'manifest.chapters[' + i + '].hash 与章节 JSON 不符');
          }
          if (mc.paragraphCount !== doc.paragraphCount) {
            err('E_MANIFEST', 'manifest.chapters[' + i + '].paragraphCount 与章节 JSON 不符');
          }
        }
      });
    }
    const flagsText = snap.files.get('flags.json');
    if (flags) {
      const keys = Object.keys(flags.flags || {}).sort();
      if (JSON.stringify(manifest.flags && manifest.flags.keys) !== JSON.stringify(keys)) {
        err('E_MANIFEST', 'manifest.flags.keys 与 flags.json 不一致');
      }
      if (manifest.flags && manifest.flags.url !== '/flags.json') {
        err('E_MANIFEST', 'manifest.flags.url 应为 /flags.json（且不得复制开关值）');
      }
      if (manifest.flags && 'values' in manifest.flags) {
        err('E_MANIFEST', 'manifest.flags 不得复制 flags.json 的开关值');
      }
    }
    /* contentVersion 重算（用内容身份，不参与自身计算） */
    const charsReal = sha12(snap.files.get('content/characters.json'));
    const cv = sha12([
      'schema:' + SCHEMA,
      ...(manifest.chapters || []).map((e) => e.num + ':' + e.hash),
      'characters:' + charsReal,
      'flags:' + flagsText
    ].join('\n'));
    if (manifest.contentVersion !== cv) {
      err('E_MANIFEST', 'contentVersion 与章节/人物/flags 的内容身份不符：' +
        manifest.contentVersion + ' ≠ ' + cv);
    }
    if (!/^\d{4}-\d{2}-\d{2}T/.test(manifest.generatedAt || '')) {
      err('E_MANIFEST', 'generatedAt 不是 ISO8601');
    }
    /* assets 清单 */
    const assets = manifest.assets || {};
    if (assets.baseUrl !== SITE_ASSETS_BASE) err('E_ASSETS', 'assets.baseUrl 不正确');
    const portraits = [...new Set(chars.map((c) => c.portrait).filter(Boolean))].sort();
    if (JSON.stringify(assets.portraits) !== JSON.stringify(portraits)) {
      err('E_ASSETS', 'assets.portraits 与人物立绘清单不一致');
    }
    if (JSON.stringify(assets.thumbs) !== JSON.stringify(portraits.map(thumbName).sort())) {
      err('E_ASSETS', 'assets.thumbs 与缩略图清单不一致');
    }
    if (JSON.stringify(assets.fonts) !== JSON.stringify(snap.fontFiles)) {
      err('E_ASSETS', 'assets.fonts 与 assets/fonts/*.woff2 不一致');
    }
    ok('manifest 自洽');
  }

  /* ---- S-4 C3 种子副本 ---- */
  if (snap.hasSeed) {
    const siteNames = [...snap.files.keys()]
      .filter((k) => /^content\/.*\.json$/.test(k))
      .map((k) => path.basename(k)).sort();
    const seedNames = [...snap.seedFiles.keys()].sort();
    if (JSON.stringify(siteNames) !== JSON.stringify(seedNames)) {
      err('E_SEED', '种子包文件集合与站点 content/ 不一致（多余或缺失）');
    }
    siteNames.forEach((name) => {
      const site = snap.files.get('content/' + name);
      const seed = snap.seedFiles.get(name);
      if (seed === undefined) { err('E_SEED', '种子包缺 ' + name); return; }
      if (seed !== site) {
        err('E_SEED', '种子包 ' + name + ' 与站点逐字不一致（作者改稿后种子陈旧）');
      }
      if (name === 'manifest.json') {
        try {
          if (JSON.parse(seed).contentVersion !== JSON.parse(site).contentVersion) {
            err('E_SEED', '种子 manifest 的 contentVersion 与站点不一致');
          }
        } catch (e) { err('E_SEED', '种子 manifest 不是合法 JSON'); }
      }
    });
    ok('C3 种子副本');
  } else {
    notes.push('C3 种子包尚未建立（' + SEED_DIR + ' 不存在，S2 阶段创建后将自动纳入检查）');
  }

  /* ---- S-5 缓存纪律 ---- */
  const sw = snap.files.get('sw.js') || '';
  if (/\/content\//.test(sw)) {
    err('E_PRECACHE', 'sw.js 的 PRECACHE 里出现了 content/（内容契约不该进浏览器离线缓存）');
  }
  [...snap.files.keys()].filter((k) => /^novel\/.*\.html$/.test(k)).forEach((k) => {
    if (/\bcontent\/.*\.json/.test(snap.files.get(k))) {
      err('E_PRECACHE', k + ' 引用了 content/*.json（会引入 ?v= 与 PRECACHE 漂移）');
    }
  });
  ok('缓存纪律');

  return {
    errors, notes, checks,
    counts: { chapters: chapters.length, characters: charDoc ? charDoc.count : 0 }
  };
}

/* ---------- 变异测试（全程内存，不落盘） ---------- */

function mutateJson(snap, rel, fn) {
  const doc = JSON.parse(snap.files.get(rel));
  fn(doc);
  snap.files.set(rel, jsonText(doc));
}

function mutateHtml(snap, rel, fn) {
  snap.files.set(rel, fn(snap.files.get(rel)));
}

/** 让 JSON 侧的 hash / manifest / contentVersion 重新自洽，隔离出「语义」断言。 */
function resign(snap) {
  const chapters = chaptersFrom(snap);
  const manifest = JSON.parse(snap.files.get('content/manifest.json'));
  chapters.forEach((entry, i) => {
    const rel = 'content/' + chapterJsonName(entry.num);
    const doc = JSON.parse(snap.files.get(rel));
    doc.hash = payloadHash(doc);
    snap.files.set(rel, jsonText(doc));
    if (manifest.chapters[i]) {
      manifest.chapters[i].hash = doc.hash;
      manifest.chapters[i].paragraphCount = doc.paragraphCount;
    }
  });
  manifest.characters.hash = sha12(snap.files.get('content/characters.json'));
  manifest.contentVersion = sha12([
    'schema:' + SCHEMA,
    ...manifest.chapters.map((e) => e.num + ':' + e.hash),
    'characters:' + manifest.characters.hash,
    'flags:' + snap.files.get('flags.json')
  ].join('\n'));
  snap.files.set('content/manifest.json', jsonText(manifest));
}

const C1 = 'content/chapter-01.json';
const H1 = 'novel/chapter-01.html';

const MUTATIONS = [
  {
    name: 'M-1 页面改一段文字', expect: 'E_PARA_TEXT',
    fn: (s) => mutateHtml(s, H1, (h) => h.replace(/(<p>叶南衡站在分班名单前看了很久)/, '$1啊'))
  },
  {
    name: 'M-2 页面删一段', expect: 'E_PARA_COUNT',
    fn: (s) => mutateHtml(s, H1, (h) => h.replace(/\n<p>[^\n]*?<\/p>\n/, '\n'))
  },
  {
    name: 'M-3 JSON 段序号断号', expect: 'E_INDEX',
    fn: (s) => mutateJson(s, C1, (d) => { d.paragraphs[2].index = 99; resign(s); })
  },
  {
    name: 'M-4 JSON 结构节点带 index', expect: 'E_INDEX',
    fn: (s) => mutateJson(s, C1, (d) => {
      const n = d.paragraphs.find((p) => p.type !== 'p');
      if (n) n.index = 3; resign(s);
    })
  },
  {
    name: 'M-5 JSON 结构节点 before 偏移', expect: 'E_BEFORE',
    fn: (s) => mutateJson(s, C1, (d) => {
      const n = d.paragraphs.find((p) => p.type !== 'p');
      if (n) n.before += 2; resign(s);
    })
  },
  {
    name: 'M-6 页面删一条日期行（C2/M-8）', expect: 'E_DATE_COUNT',
    fn: (s) => mutateHtml(s, H1, (h) => h.replace(/\n *<div class="chapter-date">[^\n]*<\/div>/, ''))
  },
  {
    name: 'M-7 页面改日期行文字', expect: 'E_DATE_TEXT',
    fn: (s) => mutateHtml(s, H1, (h) => h.replace(/(<div class="chapter-date">二〇二二年 · 九月一日)/, '$1改'))
  },
  {
    name: 'M-8 页面注入 .chapter-date-end 但 JSON 无 end', expect: 'E_DATE_END',
    fn: (s) => mutateHtml(s, H1, (h) => h.replace('<div class="chapter-date">',
      '<div class="chapter-date chapter-date-end">'))
  },
  {
    name: 'M-9 JSON storyDate 与元数据混线（C2/M-14）', expect: 'E_STORY_DATE',
    fn: (s) => mutateJson(s, C1, (d) => { d.storyDate = [d.dates[0]]; resign(s); })
  },
  {
    name: 'M-10 页面改余韵卡卡头', expect: 'E_AFTERGLOW_KICKER',
    fn: (s) => mutateHtml(s, H1, (h) => h.replace('《第一章·临渊羡鱼》', '这一章的风'))
  },
  {
    name: 'M-11 页面改余韵卡引文', expect: 'E_AFTERGLOW_TEXT',
    fn: (s) => mutateHtml(s, H1, (h) => h.replace(/(<div class="afterglow-kicker">[^\n]*<\/div>\n    <p>阳光下)/, '$1改'))
  },
  {
    name: 'M-12 JSON 元数据字段被改', expect: 'E_META_FIELD',
    fn: (s) => mutateJson(s, C1, (d) => { d.words += 1; resign(s); })
  },
  {
    name: 'M-13 章节 hash 与内容不符', expect: 'E_HASH',
    fn: (s) => mutateJson(s, C1, (d) => { d.hash = 'deadbeef0000'; })
  },
  {
    name: 'M-14 manifest 章 hash 被改', expect: 'E_MANIFEST',
    fn: (s) => mutateJson(s, 'content/manifest.json', (d) => { d.chapters[0].hash = 'deadbeef0000'; })
  },
  {
    name: 'M-15 人物小传被改', expect: 'E_CHAR_FIELD',
    fn: (s) => mutateJson(s, 'content/characters.json', (d) => { d.items[0].bio[0] += '改'; resign(s); })
  },
  {
    name: 'M-16 删一个章节 JSON', expect: 'E_MISSING',
    fn: (s) => s.files.delete('content/chapter-09.json')
  },
  {
    name: 'M-17 只改站点 content 不改种子（C3/M-13）', expect: 'E_SEED',
    fn: (s) => {
      // 先以当前站点 content 造一份「发版时」的种子快照，再让站点内容前进一格
      [...s.files.keys()].filter((k) => /^content\/.*\.json$/.test(k)).forEach((k) => {
        s.seedFiles.set(path.basename(k), s.files.get(k));
      });
      s.hasSeed = true;
      mutateJson(s, C1, (d) => { d.paragraphs[0].text += '。'; resign(s); });
    }
  }
];

function runSelfTest(base) {
  let pass = 0;
  const failed = [];
  const baseline = checkAll(base);
  if (baseline.errors.length) {
    console.error('✗ 自测基线本身不干净，先修守卫：');
    baseline.errors.forEach((e) => console.error('  [' + e.code + '] ' + e.msg));
    process.exit(1);
  }
  MUTATIONS.forEach((mut) => {
    const snap = cloneSnapshot(base);
    try { mut.fn(snap); } catch (e) {
      failed.push(mut.name + '：变异脚本自身抛错 ' + e.message);
      return;
    }
    const res = checkAll(snap);
    const hit = res.errors.some((e) => e.code === mut.expect);
    if (hit && res.errors.length) {
      pass += 1;
      console.log('  ✓ ' + mut.name + ' → 报 ' + mut.expect +
        '（共 ' + res.errors.length + ' 条）');
    } else {
      failed.push(mut.name + '：期望 ' + mut.expect + '，实际 ' +
        (res.errors.length ? res.errors.map((e) => e.code).join(',') : '全绿（漏检！）'));
    }
  });
  console.log('\n变异测试：' + pass + '/' + MUTATIONS.length + ' 通过');
  if (failed.length) {
    failed.forEach((f) => console.error('  ✗ ' + f));
    process.exit(1);
  }
  console.log('✓ 该红的都红了');
}

/* ---------- 入口 ---------- */

const snap = buildSnapshot();
if (selfTest) {
  console.log('内容契约 · 变异测试（内存，不写盘）');
  runSelfTest(snap);
} else {
  const res = checkAll(snap);
  res.notes.forEach((n) => console.log('  · ' + n));
  if (res.errors.length) {
    console.error('\n✗ 内容契约守卫：' + res.errors.length + ' 条错误');
    res.errors.forEach((e) => console.error('  [' + e.code + '] ' + e.msg));
    process.exit(1);
  }
  console.log('✓ 内容契约守卫通过：' + res.checks + ' 项检查，' +
    res.counts.chapters + ' 章 / ' + res.counts.characters + ' 人 / manifest 全部逐字自洽');
}
