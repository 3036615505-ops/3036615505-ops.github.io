#!/usr/bin/env node
/**
 * atlas/query.mjs — 星图查询入口
 *
 * 给作者和 AI agent 共用：只读 atlas/generated/atlas.json，不修改任何数据。
 * 所有命令都支持 --json，方便 agent 直接消费结构化结果。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ATLAS_FILE = path.join(ROOT, 'atlas/generated/atlas.json');
const CONFLICT_FILE = path.join(ROOT, 'atlas/generated/conflicts.json');

const KIND_LABEL = { family: '亲缘', love: '情感', friend: '朋友', mentor: '师生', place: '地点' };
const TIME_LABEL = { morning: '上午', noon: '中午', afternoon: '下午', evening: '傍晚', night: '夜', unknown: '未标注' };
const STATUS_LABEL = { open: '未回收', paid: '已回收', abandoned: '已放弃' };

const jsonMode = process.argv.includes('--json');
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const command = args[0] || 'help';
const rest = args.slice(1);

function fail(message, extra = {}) {
  if (jsonMode) {
    console.log(JSON.stringify({ error: message, ...extra }, null, 2));
  } else {
    console.error(`✗ ${message}`);
    if (extra.candidates) {
      console.error('  候选：' + extra.candidates.map(item => `${item.name}（${item.id}）`).join('、'));
    }
  }
  process.exit(1);
}

if (!fs.existsSync(ATLAS_FILE)) fail('找不到 atlas/generated/atlas.json，请先运行 node atlas/build.mjs');

const atlas = JSON.parse(fs.readFileSync(ATLAS_FILE, 'utf8'));
const entities = atlas.entities || [];
const byId = new Map(entities.map(entity => [entity.id, entity]));
const relations = atlas.relations || [];
const events = atlas.timeline || [];
const foreshadowing = atlas.foreshadowing || [];
const chapters = atlas.chapters || [];
const latestChapter = chapters.length;

function entityName(id) { return byId.get(id)?.name || id; }
function kindLabel(kind) { return KIND_LABEL[kind] || kind; }
function eventPlace(event) { return event.place ? entityName(event.place) : (event.placeText || '—'); }
function formatDate(date) { return date || '未标注'; }
function formatEvent(event) {
  const participants = (event.participants || []).map(entityName).join('、');
  return `第 ${event.chapter} 章 · ${formatDate(event.date)} ${TIME_LABEL[event.timeOfDay] || event.timeOfDay} · ${eventPlace(event)} · ${event.title}${participants ? `（${participants}）` : ''}`;
}
function relationOf(id) {
  return relations
    .filter(relation => relation.a === id || relation.b === id)
    .map(relation => ({
      id: relation.id,
      kind: relation.kind,
      kindLabel: kindLabel(relation.kind),
      label: relation.label,
      directed: relation.directed,
      other: { id: relation.a === id ? relation.b : relation.a, name: entityName(relation.a === id ? relation.b : relation.a) },
      evidence: relation.evidence,
      note: relation.note || ''
    }));
}
function eventsOf(id) {
  return events.filter(event => (event.participants || []).includes(id));
}
function foreshadowingOf(id) {
  return foreshadowing.filter(item => (item.owner || []).includes(id));
}

function resolveEntity(raw) {
  const query = String(raw || '').trim();
  if (!query) fail('缺少实体名或 id');
  let hits = [];
  if (byId.has(query)) hits = [byId.get(query)];
  if (!hits.length) hits = entities.filter(entity => entity.name === query);
  if (!hits.length) hits = entities.filter(entity => (entity.aliases || []).includes(query));
  if (!hits.length) {
    hits = entities.filter(entity =>
      entity.name.includes(query) ||
      entity.id.includes(query.toLowerCase()) ||
      (entity.aliases || []).some(alias => alias.includes(query))
    );
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    fail(`“${query}”有多个匹配`, { candidates: hits.map(entity => ({ id: entity.id, name: entity.name })) });
  }
  fail(`找不到实体：“${query}”`);
}

function entityPayload(entity) {
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    group: entity.group,
    role: entity.role,
    aliases: entity.aliases || [],
    status: entity.status,
    birthday: entity.birthday || null,
    ageAtStoryStart: entity.derived?.ageAtStoryStart ?? null,
    summary: entity.summary,
    quote: entity.quote || '',
    reader: entity.reader || null,
    relations: relationOf(entity.id),
    events: eventsOf(entity.id),
    foreshadowing: foreshadowingOf(entity.id)
  };
}

function entityText(entity) {
  const lines = [];
  lines.push(`【${entity.name}】 ${entity.id} · ${entity.type === 'place' ? '地点' : '人物'} · ${atlas.groups[entity.group]?.name || entity.group}`);
  lines.push(`身份：${entity.role}`);
  if (entity.aliases?.length) lines.push(`别名：${entity.aliases.join('、')}`);
  if (entity.birthday) lines.push(`生日：${entity.birthday}（故事开始时 ${entity.derived?.ageAtStoryStart ?? '?'} 岁）`);
  lines.push(`状态：${entity.status}`);
  lines.push(`简介：${entity.summary}`);
  if (entity.quote) lines.push(`台词：${entity.quote}`);
  const rels = relationOf(entity.id);
  lines.push('', `关系（${rels.length}）`);
  rels.forEach(relation => {
    lines.push(`  ${relation.kindLabel} · ${relation.label} → ${relation.other.name}${relation.directed ? '（有向）' : ''}`);
  });
  const evs = eventsOf(entity.id);
  if (evs.length) {
    lines.push('', `事件（${evs.length}）`);
    evs.forEach(event => lines.push(`  ${formatEvent(event)}`));
  }
  const fsItems = foreshadowingOf(entity.id);
  if (fsItems.length) {
    lines.push('', `伏笔（${fsItems.length}）`);
    fsItems.forEach(item => lines.push(`  [${STATUS_LABEL[item.status] || item.status}] ${item.title} · 第 ${item.plantedIn} 章埋设${item.payoffIn ? ` / 第 ${item.payoffIn} 章回收` : ''}`));
  }
  return lines.join('\n');
}

function pathBetween(from, to) {
  const start = resolveEntity(from);
  const goal = resolveEntity(to);
  const queue = [start.id];
  const previous = new Map([[start.id, null]]);
  const adjacency = new Map(entities.map(entity => [entity.id, []]));
  relations.forEach(relation => {
    adjacency.get(relation.a)?.push({ id: relation.b, relation });
    adjacency.get(relation.b)?.push({ id: relation.a, relation });
  });
  while (queue.length) {
    const current = queue.shift();
    if (current === goal.id) break;
    for (const next of adjacency.get(current) || []) {
      if (previous.has(next.id)) continue;
      previous.set(next.id, { from: current, relation: next.relation });
      queue.push(next.id);
    }
  }
  if (!previous.has(goal.id)) return null;
  const steps = [];
  let cursor = goal.id;
  while (cursor !== start.id) {
    const prev = previous.get(cursor);
    steps.unshift({
      from: entityName(prev.from),
      to: entityName(cursor),
      relation: prev.relation.label,
      kind: kindLabel(prev.relation.kind)
    });
    cursor = prev.from;
  }
  return { from: start.name, to: goal.name, steps };
}

function searchAll(query) {
  const q = String(query || '').trim();
  if (!q) fail('缺少搜索词');
  const entityHits = entities.filter(entity =>
    entity.name.includes(q) ||
    (entity.aliases || []).some(alias => alias.includes(q)) ||
    entity.summary.includes(q) ||
    (entity.bio || []).some(paragraph => paragraph.includes(q))
  ).map(entity => ({ id: entity.id, name: entity.name, type: entity.type, role: entity.role }));
  const eventHits = events.filter(event => `${event.title} ${event.summary}`.includes(q))
    .map(event => ({ id: event.id, title: event.title, chapter: event.chapter, date: event.date }));
  const foreshadowingHits = foreshadowing.filter(item => `${item.title} ${item.note || ''}`.includes(q))
    .map(item => ({ id: item.id, title: item.title, status: item.status, plantedIn: item.plantedIn, payoffIn: item.payoffIn }));
  return { query: q, entities: entityHits, events: eventHits, foreshadowing: foreshadowingHits };
}

function printJson(data) {
  console.log(JSON.stringify(data, null, 2));
}

function stats() {
  const data = {
    title: atlas.meta?.title || '临渊羡鱼',
    counts: atlas.counts,
    groups: atlas.groups,
    chapters: chapters.map(chapter => ({ num: chapter.num, title: chapter.title, dates: chapter.storyDate })),
    sourceHash: atlas.sourceHash,
    generatedAt: atlas.generatedAt
  };
  if (jsonMode) return printJson(data);
  console.log(`《${data.title}》星图 · ${atlas.sourceHash}`);
  console.log(`实体 ${atlas.counts.entities}（人物 ${atlas.counts.characters} / 地点 ${atlas.counts.places}）`);
  console.log(`关系 ${atlas.counts.relations} · 事件 ${atlas.counts.events} · 伏笔 ${atlas.counts.foreshadowing}（未回收 ${atlas.counts.openForeshadowing}）`);
  console.log(`章节 ${atlas.counts.chapters} 章 / ${atlas.counts.words} 字`);
  console.log(`读者默认视图 ${atlas.counts.readerEntities} 实体 / ${atlas.counts.readerRelations} 关系（隐藏 ${atlas.counts.hiddenEntities}）`);
}

function runEntity(raw) {
  const entity = resolveEntity(raw);
  const payload = entityPayload(entity);
  if (jsonMode) return printJson(payload);
  console.log(entityText(entity));
}

function runRelations(raw) {
  const entity = resolveEntity(raw);
  const list = relationOf(entity.id);
  if (jsonMode) return printJson({ entity: { id: entity.id, name: entity.name }, relations: list });
  console.log(`【${entity.name}】一度关系 · ${list.length}`);
  list.forEach(relation => {
    console.log(`  ${relation.kindLabel} · ${relation.label} → ${relation.other.name}`);
    if (relation.evidence?.length) console.log(`    证据：${relation.evidence.join('、')}`);
    if (relation.note) console.log(`    注：${relation.note}`);
  });
}

function runEvents(raw) {
  const entity = resolveEntity(raw);
  const list = eventsOf(entity.id).sort((a, b) => a.chapter - b.chapter || a.sequence - b.sequence);
  if (jsonMode) return printJson({ entity: { id: entity.id, name: entity.name }, events: list });
  console.log(`【${entity.name}】事件 · ${list.length}`);
  list.forEach(event => console.log(`  ${formatEvent(event)}`));
}

function runTimeline(rawChapter) {
  let list = events.slice().sort((a, b) => a.chapter - b.chapter || a.sequence - b.sequence);
  if (rawChapter) {
    const chapter = Number(rawChapter);
    if (!Number.isInteger(chapter)) fail(`章节号不合法：${rawChapter}`);
    list = list.filter(event => event.chapter === chapter);
  }
  if (jsonMode) return printJson(list);
  console.log(`时间线 · ${list.length} 个事件`);
  list.forEach(event => console.log(`  ${formatEvent(event)}`));
}

function runChapter(raw) {
  const num = Number(raw);
  const chapter = chapters.find(item => item.num === num);
  if (!chapter) fail(`找不到第 ${raw} 章`);
  const chapterEvents = events.filter(event => event.chapter === num);
  if (jsonMode) return printJson({ ...chapter, timeline: chapterEvents });
  console.log(`第 ${num} 章 · ${chapter.title}`);
  console.log(`字数：${chapter.words} · 更新：${chapter.updated}`);
  console.log(`日期：${(chapter.storyDate || []).join(' / ') || '未标注'}`);
  console.log(`卷首：${chapter.blurb || '—'}`);
  console.log(`事件：${chapterEvents.length}`);
  chapterEvents.forEach(event => console.log(`  ${formatEvent(event)}`));
}

function runForeshadow(filter = 'open') {
  const mode = filter || 'open';
  let list = foreshadowing.slice();
  if (mode !== 'all') list = list.filter(item => item.status === mode);
  list = list.map(item => ({ ...item, chaptersOpen: latestChapter - item.plantedIn }))
    .sort((a, b) => b.chaptersOpen - a.chaptersOpen);
  if (jsonMode) return printJson(list);
  console.log(`伏笔 · ${mode === 'all' ? '全部' : STATUS_LABEL[mode] || mode} · ${list.length}`);
  list.forEach(item => {
    console.log(`  [${STATUS_LABEL[item.status] || item.status}] ${item.title}`);
    console.log(`    埋设：第 ${item.plantedIn} 章 · ${item.payoffIn ? `回收：第 ${item.payoffIn} 章` : `已过 ${item.chaptersOpen} 章`}`);
    if (item.evidence?.length) console.log(`    证据：${item.evidence.join('、')}`);
  });
}

function runConflict() {
  if (!fs.existsSync(CONFLICT_FILE)) fail('找不到 atlas/generated/conflicts.json，请先运行 node atlas/build.mjs');
  const data = JSON.parse(fs.readFileSync(CONFLICT_FILE, 'utf8'));
  if (jsonMode) return printJson(data);
  console.log(`一致性报告 · 软冲突 ${data.summary?.soft || 0} · 提示 ${data.summary?.info || 0}`);
  if (!data.items?.length) {
    console.log('  没有需要确认的冲突。');
    return;
  }
  data.items.forEach((item, index) => {
    console.log(`  ${index + 1}. [${item.severity}] ${item.title}`);
    console.log(`     规则：${item.rule}`);
    console.log(`     说明：${item.detail}`);
    if (item.evidence?.length) console.log(`     证据：${item.evidence.join('、')}`);
  });
}

function runPath(from, to) {
  if (!from || !to) fail('用法：node atlas/query.mjs path <实体A> <实体B>');
  const result = pathBetween(from, to);
  if (!result) fail(`${from} 与 ${to} 之间没有可达路径`);
  if (jsonMode) return printJson(result);
  console.log(`${result.from} → ${result.to}`);
  result.steps.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step.from} —${step.kind}·${step.relation}→ ${step.to}`);
  });
}

function runSearch(query) {
  const result = searchAll(query);
  if (jsonMode) return printJson(result);
  console.log(`搜索“${result.query}”`);
  console.log(`实体 ${result.entities.length}`);
  result.entities.forEach(item => console.log(`  ${item.name}（${item.id}）· ${item.role}`));
  console.log(`事件 ${result.events.length}`);
  result.events.forEach(item => console.log(`  第 ${item.chapter} 章 · ${item.title}`));
  console.log(`伏笔 ${result.foreshadowing.length}`);
  result.foreshadowing.forEach(item => console.log(`  [${STATUS_LABEL[item.status] || item.status}] ${item.title}`));
}

function runContext(raw) {
  const entity = resolveEntity(raw);
  const payload = entityPayload(entity);
  const chapterEvents = eventsOf(entity.id).map(event => ({
    ...event,
    placeName: eventPlace(event),
    participantNames: (event.participants || []).map(entityName)
  }));
  const context = {
    entity: {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      group: entity.group,
      role: entity.role,
      aliases: entity.aliases,
      summary: entity.summary,
      quote: entity.quote,
      birthday: entity.birthday,
      ageAtStoryStart: entity.derived?.ageAtStoryStart ?? null
    },
    relations: payload.relations,
    events: chapterEvents,
    foreshadowing: payload.foreshadowing,
    openForeshadowing: foreshadowing.filter(item => item.status === 'open').map(item => ({
      id: item.id,
      title: item.title,
      plantedIn: item.plantedIn,
      chaptersOpen: latestChapter - item.plantedIn
    }))
  };
  if (jsonMode) return printJson(context);
  console.log(entityText(entity));
  console.log('', `全书未回收伏笔 · ${context.openForeshadowing.length}`);
  context.openForeshadowing.forEach(item => console.log(`  ${item.title}（第 ${item.plantedIn} 章埋设，已过 ${item.chaptersOpen} 章）`));
}

function help() {
  console.log(`星图查询 CLI
用法：node atlas/query.mjs <命令> [参数] [--json]

命令：
  stats                       数据规模与指纹
  entity <名字|id>            实体详情（关系 / 事件 / 伏笔）
  relations <名字|id>         只看一度关系
  events <名字|id>            只看参与事件
  timeline [章号]             时间线；可只查某一章
  chapter <章号>              章节元信息与事件
  foreshadow [open|paid|all]  伏笔；默认未回收
  conflict                    读取一致性报告
  path <A> <B>                两人之间的最短关系路径
  search <关键词>             搜实体 / 事件 / 伏笔
  context <名字|id>           给 AI 的上下文包（含全书未回收伏笔）

示例：
  node atlas/query.mjs entity 林纾
  node atlas/query.mjs path 叶南衡 江不秋 --json
  node atlas/query.mjs timeline 7
  node atlas/query.mjs foreshadow open`);
}

switch (command) {
  case 'stats': stats(); break;
  case 'entity': runEntity(rest.join(' ')); break;
  case 'relations': runRelations(rest.join(' ')); break;
  case 'events': runEvents(rest.join(' ')); break;
  case 'timeline': runTimeline(rest[0]); break;
  case 'chapter': runChapter(rest[0]); break;
  case 'foreshadow': runForeshadow(rest[0]); break;
  case 'conflict': runConflict(); break;
  case 'path': runPath(rest[0], rest[1]); break;
  case 'search': runSearch(rest.join(' ')); break;
  case 'context': runContext(rest.join(' ')); break;
  case 'help':
  case '--help':
  case '-h': help(); break;
  default: fail(`未知命令：${command}（用 node atlas/query.mjs help 查看）`);
}
