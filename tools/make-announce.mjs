#!/usr/bin/env node
/**
 * tools/make-announce.mjs — 生成 announce.json（站内「新章节更新了」横幅的数据源）
 *
 * 为什么需要它：连载作品最常被问的一句是「更新了没」。这个站点没有后端、没有推送，
 * 但有一个几乎零成本的替代 —— 读者打开任意页面时，客户端拿 announce.json 和
 * localStorage 里「已看到第几章」比一次，大了就弹一条可点的横幅。
 * 见 js/announce.js。
 *
 * 数据源：js/chapters.js 的 CHAPTERS 数组，取最后一条（章号最大 = 最新发布）。
 * 因此「零维护」：new-chapter.js 追加章节后自动重跑本工具，文件自然就是最新的。
 *
 * 为什么单独一个文件而不是塞进 flags.json：flags.json 的语义是「功能开关」，
 * 混进内容字段会让「关功能」的远程开关变得不纯粹；而且 announce.json 只在
 * 每会话第一次加载时取一次，代价同样为零。
 *
 * 用法：node tools/make-announce.mjs
 * 由 new-chapter.js（新增章节后）自动调用。零依赖，与操作系统无关。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'announce.json');

/* ---------- 读 CHAPTERS（与 make-sitemap.mjs 同一手法：vm 求值数组字面量） ---------- */
function readChapters() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'chapters.js'), 'utf8');
  const start = src.indexOf('var CHAPTERS = [');
  if (start < 0) throw new Error('js/chapters.js 里找不到 CHAPTERS 数组');
  const open = src.indexOf('[', start);
  const end = src.indexOf('\n];', open);
  if (end < 0) throw new Error('CHAPTERS 数组没有正常结束');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('result = ' + src.slice(open, end + 2), sandbox);
  if (!Array.isArray(sandbox.result)) throw new Error('CHAPTERS 不是数组');
  return sandbox.result;
}

const chapters = readChapters();
if (!chapters.length) throw new Error('CHAPTERS 为空，没有可发布的章节');

/* 章号最大者视为最新（不假设数组顺序，防手写错位） */
const latest = chapters.reduce((a, b) => ((b.num || 0) >= (a.num || 0) ? b : a));
if (!latest || !latest.num) throw new Error('最新章节缺少 num 字段');

const announce = {
  chapter: Number(latest.num),
  title: String(latest.title || ''),
  url: '/novel/' + String(latest.file || ''),
  date: String(latest.date || (Array.isArray(latest.dates) ? latest.dates[latest.dates.length - 1] : '') || '')
};

fs.writeFileSync(OUT, JSON.stringify(announce, null, 2) + '\n', 'utf8');
console.log('✓ announce.json：第 ' + announce.chapter + ' 章《' + announce.title + '》' + (announce.date ? '（' + announce.date + '）' : ''));
