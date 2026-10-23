#!/usr/bin/env node
/**
 * tools/manuscript-sync.mjs — 章节源稿（manuscript/）与线上 HTML 的一致性校验
 *
 * 为什么需要：`new-chapter.js` 是把 Markdown 生成章节页的工具，但源稿一直存在
 * 仓库外面（写作目录）。于是出现了「线上 HTML 是唯一载体」的局面：哪天一段话被
 * 误改（例如上周「找我自己」那句），git 只能证明这个文件变了，证明不了原文是什么，
 * 也就无法自动发现"这一改是不是笔误"。
 *
 * 这个工具把 source of truth 补回来：`manuscript/chapter-NN.md` 是原文快照，
 * 每次 push 前比对一次，不一致就报出第一个不同的位置。
 *
 * 用法：
 *   node tools/manuscript-sync.mjs                 # 校验（不一致则退出码 1）
 *   node tools/manuscript-sync.mjs --verbose       # 额外打印每章字数与段落数
 *   node tools/manuscript-sync.mjs --write         # 用当前 HTML 反向生成源稿
 *                                                  #   （改完线上正文后同步用，它会覆盖 manuscript/）
 *   node tools/manuscript-sync.mjs --write --only chapter-02
 *
 * 比对口径：去掉所有空白字符后逐字比。这样只关心「字有没有变」，
 * 不关心 Markdown 的空行/缩进排版。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOVEL_DIR = path.join(ROOT, 'novel');
const MS_DIR = path.join(ROOT, 'manuscript');

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const verbose = argv.includes('--verbose');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;

/* ---------- 从 HTML 里取正文 ---------- */

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim();
}

/**
 * 取一篇文章的「标题 + 段落」。
 * 只认 .chapter-content 里的内容，章末尾语（.chapter-afterglow）属于页面装饰，不算正文。
 * @param {string} html
 * @returns {{title: string, blocks: string[]}|null}
 */
function parseChapter(html) {
  const m = html.match(/<article class="chapter-content">([\s\S]*?)<\/article>/);
  if (!m) return null;
  const body = m[1];

  const h1 = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = h1 ? stripTags(h1[1]) : '';

  const blocks = [];
  const re = /<(p|blockquote)\b[^>]*>([\s\S]*?)<\/\1>|<hr\s*\/?>/g;
  let hit;
  while ((hit = re.exec(body)) !== null) {
    if (!hit[1]) { blocks.push('---'); continue; }
    const text = stripTags(hit[2]);
    if (!text) continue;
    blocks.push(hit[1] === 'blockquote' ? '> ' + text : text);
  }
  return { title, blocks };
}

/** Markdown 源稿 → 标题 + 段落（只支持本项目的子集：标题/段落/引用/分割线） */
function parseMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let title = '';
  const blocks = [];
  const buf = [];
  const flush = () => {
    if (!buf.length) return;
    blocks.push(buf.join('').trim());
    buf.length = 0;
  };
  for (const line of lines) {
    const t = line.trim();
    if (!title && /^#\s+/.test(t)) { title = t.replace(/^#\s+/, '').trim(); continue; }
    if (!t) { flush(); continue; }
    if (/^(---|\*\*\*)$/.test(t)) { flush(); blocks.push('---'); continue; }
    if (/^>\s?/.test(t)) { flush(); blocks.push('> ' + t.replace(/^>\s?/, '')); continue; }
    buf.push(t);
  }
  flush();
  return { title, blocks };
}

/** 比对用的口径：去掉所有空白，减少排版差异带来的噪声 */
function norm(text) {
  return String(text).replace(/\s+/g, '');
}

function textOf(parsed) {
  return norm([parsed.title].concat(parsed.blocks).join(''));
}

/* ---------- 主流程 ---------- */

if (!fs.existsSync(NOVEL_DIR)) {
  console.error('找不到 novel/ 目录');
  process.exit(1);
}

const chapters = fs.readdirSync(NOVEL_DIR)
  .filter((f) => /^chapter-\d+\.html$/.test(f))
  .filter((f) => !only || f.indexOf(only) === 0)
  .sort();

if (!chapters.length) {
  console.error('novel/ 下没有章节文件');
  process.exit(1);
}

if (write) fs.mkdirSync(MS_DIR, { recursive: true });

let failed = 0;
let checked = 0;

for (const file of chapters) {
  const name = file.replace(/\.html$/, '');
  const html = fs.readFileSync(path.join(NOVEL_DIR, file), 'utf8');
  const parsed = parseChapter(html);
  if (!parsed) {
    console.error(`✗ ${file}：找不到 <article class="chapter-content">，跳过`);
    failed++;
    continue;
  }

  const mdPath = path.join(MS_DIR, name + '.md');
  const md = `# ${parsed.title}\n\n` + parsed.blocks.join('\n\n') + '\n';

  if (write) {
    fs.writeFileSync(mdPath, md, 'utf8');
    console.log(`✓ 写入 manuscript/${name}.md（${parsed.blocks.length} 段，${textOf(parsed).length} 字）`);
    continue;
  }

  checked++;

  if (!fs.existsSync(mdPath)) {
    console.error(`✗ ${name}：缺少源稿 manuscript/${name}.md`);
    console.error(`   生成：node tools/manuscript-sync.mjs --write --only ${name}`);
    failed++;
    continue;
  }

  const src = parseMarkdown(fs.readFileSync(mdPath, 'utf8'));
  const a = textOf(src);
  const b = textOf(parsed);

  if (a === b) {
    if (verbose) console.log(`✓ ${name}：${parsed.blocks.length} 段，${b.length} 字，与源稿一致`);
    else console.log(`✓ ${name} 一致（${b.length} 字）`);
    continue;
  }

  /* 报第一个差异点，并给出前后文 —— 修的时候不用全篇 diff */
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = (s) => s.slice(Math.max(0, i - 14), i + 14) + '…';
  console.error(`✗ ${name}：正文与源稿不一致（第 ${i + 1} 个字起）`);
  console.error(`   源稿：…${ctx(a)}`);
  console.error(`   线上：…${ctx(b)}`);
  console.error(`   若线上是有意修改，跑一次：node tools/manuscript-sync.mjs --write --only ${name}`);
  failed++;
}

if (write) {
  console.log('\n源稿已按当前章节页重新生成。记得把 manuscript/ 的改动一起提交。');
  process.exit(0);
}

console.log(`\n${failed ? '✗ 有 ' + failed + ' 章不一致' : '✓ ' + checked + ' 章正文与源稿完全一致'}`);
process.exit(failed ? 1 : 0);
