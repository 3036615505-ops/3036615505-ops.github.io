#!/usr/bin/env node
/**
 * tools/gen-content.mjs —— 全量生成 content/*.json（Android 原生版内容契约）
 *
 * 只读 novel/*.html / manuscript 之外的现有文件，**不写任何现有 HTML/CSS/JS**，
 * 也不碰 sw.js / sitemap.xml / flags.json。站点视觉零变化。
 *
 *   node tools/gen-content.mjs          # 全量（幂等：内容没变则一个字节都不改）
 *
 * 作者改稿后不必单独跑它：`node tools/render-chapter.mjs --all` 会在同一次运行里
 * 刷新每章 JSON 与 manifest；人物设定同步后 `npm run gen:characters` 同理。
 * 本脚本主要用于 S0 首次铺设、以及怀疑契约漂移时从页面重建。
 *
 * 生成物不进 PRECACHE、不带 ?v= → ?v= 与 CACHE 都不动（判据是 PRECACHE 的字节）。
 */
import path from 'node:path';
import {
  CONTENT_DIR, readChapters, readCharacters, chapterPayloadFromHtml,
  buildCharactersPayload, writeJsonIfChanged, chapterJsonName, refreshManifest
} from './content-lib.mjs';

const chapters = readChapters().slice().sort((a, b) => a.num - b.num);
const chars = readCharacters();
let changed = 0;

console.log('生成内容契约：' + chapters.length + ' 章 / ' + chars.length + ' 人');
chapters.forEach((entry) => {
  const payload = chapterPayloadFromHtml(entry);
  const name = chapterJsonName(entry.num);
  const hit = writeJsonIfChanged(path.join(CONTENT_DIR, name), payload);
  if (hit) changed += 1;
  console.log((hit ? '✓ ' : '· ') + 'content/' + name +
    '（' + payload.paragraphCount + ' 段 · ' + payload.paragraphs.filter((p) => p.type !== 'p').length +
    ' 结构节点 · hash ' + payload.hash + (hit ? '' : ' · 无变化') + '）');
});

const charsHit = writeJsonIfChanged(
  path.join(CONTENT_DIR, 'characters.json'), buildCharactersPayload(chars));
if (charsHit) changed += 1;
console.log((charsHit ? '✓ ' : '· ') + 'content/characters.json（' + chars.length + ' 人' +
  (charsHit ? '' : ' · 无变化') + '）');

const manifest = refreshManifest();
if (manifest.changed) changed += 1;
console.log((manifest.changed ? '✓ ' : '· ') + 'content/manifest.json（contentVersion ' +
  manifest.contentVersion + (manifest.changed ? '' : ' · 无变化') + '）');

console.log('\n' + changed + ' 个文件有变化。下一步：node tools/check-content.mjs');
