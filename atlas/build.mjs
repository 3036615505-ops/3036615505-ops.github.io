import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const ATLAS = path.join(ROOT, 'atlas');
const OUT = path.join(ATLAS, 'generated');
const CHECK = process.argv.includes('--check');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};
const rel = file => path.relative(ROOT, file).split(path.sep).join('/');

const schema = readJson(path.join(ATLAS, 'schema.json'));
const meta = readJson(path.join(ATLAS, 'data/meta.json'));
const overrides = readJson(path.join(ATLAS, 'data/overrides.json'));
const layout = readJson(path.join(ATLAS, 'data/layout.json'));
const relationSource = readJson(path.join(ATLAS, 'data/relations.json')).items;
const characterSource = readJson(path.join(ROOT, 'content/characters.json')).items;
const timelineSource = readJson(path.join(ATLAS, 'data/timeline.json')).items;
const claimSource = readJson(path.join(ATLAS, 'data/claims.json')).items;
const foreshadowingSource = readJson(path.join(ATLAS, 'data/foreshadowing.json')).items;
const readerSource = readJson(path.join(ATLAS, 'data/reader.json'));

const placesDir = path.join(ATLAS, 'data/entities/places');
const placeFiles = fs.readdirSync(placesDir).filter(file => file.endsWith('.json')).sort();
const placeSource = placeFiles.map(file => readJson(path.join(placesDir, file)));

const contentDir = path.join(ROOT, 'content');
const chapterFiles = fs.readdirSync(contentDir)
  .filter(file => /^chapter-\d+\.json$/.test(file))
  .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
const chapters = chapterFiles.map(file => {
  const chapter = readJson(path.join(contentDir, file));
  return {
    num: chapter.num,
    title: chapter.title,
    file: chapter.file,
    words: chapter.words,
    year: chapter.year,
    dates: chapter.dates || [],
    storyDate: chapter.storyDate || [],
    updated: chapter.updated,
    blurb: chapter.blurb || ''
  };
});

const hash = crypto.createHash('sha256');
[
  path.join(ROOT, 'content/characters.json'),
  path.join(ATLAS, 'schema.json'),
  path.join(ATLAS, 'data/meta.json'),
  path.join(ATLAS, 'data/overrides.json'),
  path.join(ATLAS, 'data/relations.json'),
  path.join(ATLAS, 'data/layout.json'),
  path.join(ATLAS, 'data/timeline.json'),
  path.join(ATLAS, 'data/claims.json'),
  path.join(ATLAS, 'data/foreshadowing.json'),
  path.join(ATLAS, 'data/reader.json'),
  ...placeFiles.map(file => path.join(placesDir, file))
].sort().forEach(file => {
  hash.update(rel(file));
  hash.update(fs.readFileSync(file));
});
const sourceHash = hash.digest('hex').slice(0, 12);

const entities = [
  ...characterSource.map(character => {
    const override = overrides.characters?.[character.slug] || {};
    return {
      id: character.slug,
      type: 'character',
      name: character.name,
      group: character.group,
      role: character.role,
      summary: character.desc,
      quote: character.quote || '',
      birthday: character.birthday || null,
      traits: character.traits || [],
      tags: character.tags || [],
      bio: character.bio || [],
      portrait: character.portrait || null,
      aliases: override.aliases || [],
      deceased: Boolean(override.deceased),
      status: override.status || 'canon',
      source: { kind: 'projection', file: 'content/characters.json', upstream: 'js/characters-data.js', id: character.slug },
      graph: layout.nodes[character.slug] || null
    };
  }),
  ...placeSource.map(place => {
    const override = overrides.places?.[place.id] || {};
    return {
      ...place,
      aliases: [...new Set([...(place.aliases || []), ...(override.aliases || [])])],
      status: override.status || place.status || 'canon',
      source: place.source || [],
      graph: layout.nodes[place.id] || null
    };
  })
];

const graphNodes = entities.map(entity => ({
  id: entity.id,
  name: entity.name,
  type: entity.type,
  group: entity.group,
  role: entity.role,
  r: entity.graph?.r ?? 20,
  x: entity.graph?.x ?? 0,
  y: entity.graph?.y ?? 0,
  primary: Boolean(entity.graph?.primary),
  deceased: Boolean(entity.deceased || entity.graph?.deceased),
  glyph: entity.graph?.glyph || '',
  portrait: entity.portrait || null,
  quote: entity.quote || '',
  summary: entity.summary
}));

const relations = relationSource.map(relation => ({
  id: relation.id,
  a: relation.a,
  b: relation.b,
  kind: relation.kind,
  label: relation.label,
  directed: Boolean(relation.directed),
  status: relation.status || 'canon',
  evidence: relation.evidence || [],
  ...(relation.note ? { note: relation.note } : {})
}));

const events = timelineSource.map((event, index) => ({
  id: event.id,
  title: event.title,
  chapter: event.chapter,
  sequence: index + 1,
  date: event.date || null,
  dateConfidence: event.dateConfidence || (event.date ? 'exact' : 'unknown'),
  timeOfDay: event.timeOfDay || 'unknown',
  place: event.place || null,
  placeText: event.placeText || '',
  participants: event.participants || [],
  summary: event.summary,
  evidence: event.evidence || []
}));

const claims = claimSource.map(claim => ({
  ...claim,
  status: claim.status || 'canon',
  evidence: claim.evidence || []
}));

const foreshadowing = foreshadowingSource.map(item => ({
  ...item,
  status: item.status || 'open',
  payoffIn: item.payoffIn ?? null,
  owner: item.owner || [],
  evidence: item.evidence || []
}));

const errors = [];
const warnings = [];
const conflicts = [];
const ids = new Set();
const relationIds = new Set();
const entityIds = new Set(entities.map(entity => entity.id));
const entityById = new Map(entities.map(entity => [entity.id, entity]));
const chapterByNum = new Map(chapters.map(chapter => [chapter.num, chapter]));
const latestChapter = chapters.length;
const publishedThrough = latestChapter;

for (const entity of entities) {
  const override = readerSource.entities?.[entity.id] || {};
  const revealAt = override.revealAt ?? null;
  entity.reader = {
    revealAt,
    summary: override.summary || entity.summary,
    visible: revealAt !== null && revealAt <= publishedThrough
  };
  if (revealAt !== null && (!Number.isInteger(revealAt) || revealAt < 1 || revealAt > publishedThrough)) {
    errors.push(`${entity.id} 的 revealAt 不合法：${revealAt}`);
  }
  if (!(entity.id in (readerSource.entities || {}))) warnings.push(`${entity.id} 没有 reader 配置，默认隐藏`);
}

for (const relation of relations) {
  const a = entityById.get(relation.a);
  const b = entityById.get(relation.b);
  const override = readerSource.relations?.[relation.id] || {};
  const aReveal = a?.reader?.revealAt ?? null;
  const bReveal = b?.reader?.revealAt ?? null;
  const derived = aReveal !== null && bReveal !== null ? Math.max(aReveal, bReveal) : null;
  const revealAt = override.revealAt ?? derived;
  relation.revealAt = revealAt;
  relation.readerLabel = override.readerLabel || relation.label;
  relation.readerVisible = override.visible !== false && revealAt !== null && revealAt <= publishedThrough;
  if (override.revealAt !== undefined && (!Number.isInteger(override.revealAt) || override.revealAt < 1 || override.revealAt > publishedThrough)) {
    errors.push(`${relation.id} 的 reader.revealAt 不合法：${override.revealAt}`);
  }
}

for (const event of events) {
  event.readerVisible = event.chapter <= publishedThrough;
}

function addConflict({ id, rule, severity, title, detail, entities: involved = [], evidence = [], suggestion = '' }) {
  if (conflicts.some(item => item.id === id)) return;
  conflicts.push({ id, rule, severity, title, detail, entities: involved, evidence, suggestion });
}

const TIME_LABEL = { morning: '上午', noon: '中午', afternoon: '下午', evening: '傍晚', night: '夜', unknown: '未标注' };
const CN_DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnNumber(text) {
  if (!text) return null;
  text = text.replace(/[年月日号\s]/g, '');
  if (!text) return null;
  if (text.includes('十')) {
    const [tens, ones] = text.split('十');
    return (tens ? CN_DIGIT[tens] : 1) * 10 + (ones ? CN_DIGIT[ones] : 0);
  }
  const digits = [...text].map(char => CN_DIGIT[char]);
  if (digits.some(value => value === undefined)) return null;
  return Number(digits.join(''));
}
function parseStoryDate(text) {
  const match = /^(.+)年\s*·\s*(.+)月(.+)$/.exec(text || '');
  if (!match) return null;
  const year = cnNumber(match[1]);
  const month = cnNumber(match[2]);
  const day = cnNumber(match[3]);
  if (![year, month, day].every(Number.isFinite)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function parseBirthday(text) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(text || '');
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}
function ageAt(birthday, date) {
  const born = parseBirthday(birthday);
  if (!born || !date) return null;
  const [year, month, day] = date.split('-').map(Number);
  let age = year - born.year;
  if (month < born.month || (month === born.month && day < born.day)) age -= 1;
  return age;
}
const chapterDates = new Map(chapters.map(chapter => [
  chapter.num,
  (chapter.storyDate || []).map(parseStoryDate).filter(Boolean).sort()
]));

const storyStart = meta.storyStart || '2022-09-01';
for (const entity of entities) {
  const age = ageAt(entity.birthday, storyStart);
  if (age !== null) entity.derived = { ageAtStoryStart: age };
}

for (const entity of entities) {
  if (ids.has(entity.id)) errors.push(`重复实体 id：${entity.id}`);
  ids.add(entity.id);
  if (!schema.groups[entity.group]) errors.push(`${entity.id} 的分组不存在：${entity.group}`);
  if (!schema.entityTypes[entity.type]) errors.push(`${entity.id} 的类型不存在：${entity.type}`);
  if (!schema.statuses.includes(entity.status)) errors.push(`${entity.id} 的状态不合法：${entity.status}`);
  if (!entity.summary) errors.push(`${entity.id} 缺少 summary`);
  if (!entity.role) errors.push(`${entity.id} 缺少 role`);
  if (!entity.graph) errors.push(`${entity.id} 缺少 layout 坐标`);
}

const layoutIds = Object.keys(layout.nodes);
for (const id of layoutIds) {
  if (!entityIds.has(id)) warnings.push(`layout 中存在没有实体的节点：${id}`);
}
if (layout.canvas.width !== schema.canvas.width || layout.canvas.height !== schema.canvas.height) {
  errors.push('layout.canvas 与 schema.canvas 尺寸不一致');
}

for (const entity of entities) {
  const node = entity.graph;
  if (!node) continue;
  const { left, top, right, bottom } = schema.canvas.safe;
  if (node.x < left || node.x > right || node.y < top || node.y > bottom) {
    errors.push(`${entity.id} 的坐标超出安全区：${node.x},${node.y}`);
  }
  if (!Number.isFinite(node.r) || node.r < 12 || node.r > 40) {
    errors.push(`${entity.id} 的半径不合法：${node.r}`);
  }
}

const relationKeys = new Set();
for (const relation of relations) {
  if (relationIds.has(relation.id)) errors.push(`重复关系 id：${relation.id}`);
  relationIds.add(relation.id);
  if (!entityIds.has(relation.a)) errors.push(`关系 ${relation.id} 的起点不存在：${relation.a}`);
  if (!entityIds.has(relation.b)) errors.push(`关系 ${relation.id} 的终点不存在：${relation.b}`);
  if (!schema.relationKinds[relation.kind]) errors.push(`关系 ${relation.id} 的类型不合法：${relation.kind}`);
  if (!schema.statuses.includes(relation.status)) errors.push(`关系 ${relation.id} 的状态不合法：${relation.status}`);
  if (!relation.label) errors.push(`关系 ${relation.id} 缺少 label`);
  if (!Array.isArray(relation.evidence) || relation.evidence.length === 0) {
    warnings.push(`关系 ${relation.id} 没有 evidence`);
  }
  const key = [relation.a, relation.b].sort().join('|') + '|' + relation.kind;
  if (relationKeys.has(key)) warnings.push(`同一对实体存在同类型关系：${relation.id}`);
  relationKeys.add(key);
}

const eventIds = new Set();
for (const event of events) {
  if (eventIds.has(event.id)) errors.push(`重复事件 id：${event.id}`);
  eventIds.add(event.id);
  if (!chapterByNum.has(event.chapter)) errors.push(`事件 ${event.id} 的章节不存在：${event.chapter}`);
  if (!schema.timeOfDay.includes(event.timeOfDay)) errors.push(`事件 ${event.id} 的时段不合法：${event.timeOfDay}`);
  if (!schema.dateConfidence.includes(event.dateConfidence)) errors.push(`事件 ${event.id} 的日期置信度不合法：${event.dateConfidence}`);
  if (event.place) {
    if (!entityIds.has(event.place)) errors.push(`事件 ${event.id} 的地点不存在：${event.place}`);
    else if (entityById.get(event.place)?.type !== 'place') errors.push(`事件 ${event.id} 的地点不是地点实体：${event.place}`);
  }
  for (const participant of event.participants) {
    if (!entityIds.has(participant)) {
      errors.push(`事件 ${event.id} 的参与者不存在：${participant}`);
      continue;
    }
    const person = entityById.get(participant);
    if (person.type !== 'character') errors.push(`事件 ${event.id} 的参与者不是人物：${participant}`);
    if (event.date && person.deceased && event.date >= (meta.storyStart || '2022-09-01')) {
      addConflict({
        id: `conflict-deceased-${event.id}-${participant}`,
        rule: 'life.deceased-appears',
        severity: 'soft',
        title: `已故人物出现在当前时间线：${person.name}`,
        detail: `${person.name} 标记为已故，却出现在 ${event.date} 的「${event.title}」。`,
        entities: [participant],
        evidence: event.evidence,
        suggestion: '确认这是回忆/梦境/讲述，还是人物状态标记有误。'
      });
    }
    const age = ageAt(person.birthday, event.date);
    if (age !== null && age < 0) {
      addConflict({
        id: `conflict-birth-${event.id}-${participant}`,
        rule: 'life.birth-after-event',
        severity: 'soft',
        title: `人物在出生前出场：${person.name}`,
        detail: `${person.name} 生于 ${person.birthday}，事件日期是 ${event.date}。`,
        entities: [participant],
        evidence: event.evidence,
        suggestion: '确认生日或事件日期。'
      });
    }
  }
  if (event.date && !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) errors.push(`事件 ${event.id} 的日期格式不合法：${event.date}`);
  if (!event.summary) errors.push(`事件 ${event.id} 缺少 summary`);
  if (!Array.isArray(event.evidence) || event.evidence.length === 0) warnings.push(`事件 ${event.id} 没有 evidence`);
}

const claimIds = new Set();
for (const claim of claims) {
  if (claimIds.has(claim.id)) errors.push(`重复 claim id：${claim.id}`);
  claimIds.add(claim.id);
  if (!schema.claimStatuses.includes(claim.status)) errors.push(`claim ${claim.id} 的状态不合法：${claim.status}`);
  if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) warnings.push(`claim ${claim.id} 没有 evidence`);
  if (claim.subject.startsWith('group:')) {
    if (!schema.groups[claim.subject.slice(6)]) errors.push(`claim ${claim.id} 的分组不存在：${claim.subject}`);
  } else if (!entityIds.has(claim.subject)) {
    errors.push(`claim ${claim.id} 的主体不存在：${claim.subject}`);
  }
}

const foreshadowingIds = new Set();
for (const item of foreshadowing) {
  if (foreshadowingIds.has(item.id)) errors.push(`重复伏笔 id：${item.id}`);
  foreshadowingIds.add(item.id);
  if (!schema.foreshadowingStatuses.includes(item.status)) errors.push(`伏笔 ${item.id} 的状态不合法：${item.status}`);
  if (!chapterByNum.has(item.plantedIn)) errors.push(`伏笔 ${item.id} 的埋设章节不存在：${item.plantedIn}`);
  if (item.payoffIn !== null && !chapterByNum.has(item.payoffIn)) errors.push(`伏笔 ${item.id} 的回收章节不存在：${item.payoffIn}`);
  if (item.payoffIn !== null && item.payoffIn < item.plantedIn) errors.push(`伏笔 ${item.id} 的回收早于埋设`);
  if (item.status === 'paid' && item.payoffIn === null) errors.push(`伏笔 ${item.id} 标记为已回收但没有 payoffIn`);
  if (item.status === 'open' && item.payoffIn !== null) warnings.push(`伏笔 ${item.id} 标记为未回收但写了 payoffIn`);
  for (const owner of item.owner) {
    if (!entityIds.has(owner)) errors.push(`伏笔 ${item.id} 的关联人物不存在：${owner}`);
  }
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) warnings.push(`伏笔 ${item.id} 没有 evidence`);
}

for (const event of events) {
  if (!event.date || event.dateConfidence !== 'exact') continue;
  const dates = chapterDates.get(event.chapter) || [];
  if (dates.length === 0) continue;
  if (event.date < dates[0] || event.date > dates[dates.length - 1]) {
    addConflict({
      id: `conflict-date-${event.id}`,
      rule: 'timeline.date-out-of-chapter',
      severity: 'soft',
      title: `事件日期超出本章标注范围：${event.title}`,
      detail: `事件标为 ${event.date}，但第 ${event.chapter} 章只标注了 ${dates.join(' / ')}。`,
      entities: event.participants,
      evidence: event.evidence,
      suggestion: '确认是章节日期标注不全，还是事件日期写错；若为前者，补章节 storyDate。'
    });
  }
}

const datedChapters = chapters
  .map(chapter => ({ chapter, dates: chapterDates.get(chapter.num) || [] }))
  .filter(item => item.dates.length > 0);
for (let i = 1; i < datedChapters.length; i++) {
  const previous = datedChapters[i - 1];
  const current = datedChapters[i];
  if (current.dates[0] < previous.dates[0]) {
    addConflict({
      id: `conflict-chapter-order-${previous.chapter.num}-${current.chapter.num}`,
      rule: 'timeline.chapter-order',
      severity: 'soft',
      title: `章节日期顺序倒置：第 ${previous.chapter.num} 章与第 ${current.chapter.num} 章`,
      detail: `第 ${previous.chapter.num} 章起始 ${previous.dates[0]}，第 ${current.chapter.num} 章起始 ${current.dates[0]}。`,
      entities: [],
      evidence: [`content/chapter-${String(previous.chapter.num).padStart(2, '0')}.json`, `content/chapter-${String(current.chapter.num).padStart(2, '0')}.json`],
      suggestion: '确认章节顺序或日期标注。'
    });
  }
}

const orderedEvents = events.slice().sort((a, b) => a.chapter - b.chapter || a.sequence - b.sequence);
for (let i = 1; i < orderedEvents.length; i++) {
  const previous = orderedEvents[i - 1];
  const current = orderedEvents[i];
  if (!previous.date || !current.date || previous.dateConfidence !== 'exact' || current.dateConfidence !== 'exact') continue;
  if (current.date < previous.date) {
    addConflict({
      id: `conflict-event-order-${previous.id}-${current.id}`,
      rule: 'timeline.event-order',
      severity: 'soft',
      title: `事件日期与章节顺序不一致：${current.title}`,
      detail: `前一个事件 ${previous.title} 是 ${previous.date}，后一个事件是 ${current.date}。`,
      entities: [...new Set([...previous.participants, ...current.participants])],
      evidence: [...previous.evidence, ...current.evidence],
      suggestion: '确认事件的先后顺序，或把日期标成 inferred/unknown。'
    });
  }
}

const locationSlots = new Map();
for (const event of events) {
  if (!event.date || event.timeOfDay === 'unknown' || !event.place) continue;
  for (const participant of event.participants) {
    const key = `${event.date}|${event.timeOfDay}|${participant}`;
    const previous = locationSlots.get(key);
    if (previous && previous.place !== event.place) {
      addConflict({
        id: `conflict-location-${previous.event}-${event.id}-${participant}`,
        rule: 'timeline.location-exclusion',
        severity: 'soft',
        title: `同一时段出现在两个地点：${entityById.get(participant)?.name || participant}`,
        detail: `${event.date} ${event.timeOfDay}，${previous.event} 在 ${entityById.get(previous.place)?.name || previous.place}，${event.id} 在 ${entityById.get(event.place)?.name || event.place}。`,
        entities: [participant],
        evidence: [...previous.evidence, ...event.evidence],
        suggestion: '确认事件时段或地点；如果两件事有先后，请把 timeOfDay 拆得更细。'
      });
    } else {
      locationSlots.set(key, { place: event.place, event: event.id, evidence: event.evidence });
    }
  }
}

for (const claim of claims) {
  if (claim.field !== 'age' || !claim.date || claim.status !== 'canon') continue;
  const targets = claim.subject.startsWith('group:')
    ? entities.filter(entity => entity.group === claim.subject.slice(6))
    : [entityById.get(claim.subject)].filter(Boolean);
  for (const target of targets) {
    if (!target.birthday) continue;
    const actual = ageAt(target.birthday, claim.date);
    if (actual === null || actual === claim.value) continue;
    addConflict({
      id: `conflict-age-${claim.id}-${target.id}`,
      rule: 'age.claim-mismatch',
      severity: 'soft',
      title: `年龄与旁白不一致：${target.name}`,
      detail: `${claim.date} 时 ${target.name} 按生日 ${target.birthday} 计算为 ${actual} 岁，但“${claim.quote || claim.field}”的表述是 ${claim.value} 岁。`,
      entities: [target.id],
      evidence: [...claim.evidence, `content/characters.json#${target.id}`],
      suggestion: '确认旁白是统称还是精确年龄；若按生日为准，可把“十五岁的他们”改成不点年龄的写法。'
    });
  }
}

const openForeshadowing = foreshadowing
  .filter(item => item.status === 'open')
  .map(item => ({ ...item, chaptersOpen: latestChapter - item.plantedIn }))
  .sort((a, b) => b.chaptersOpen - a.chaptersOpen || a.plantedIn - b.plantedIn);

const chapterNums = chapters.map(chapter => chapter.num);
for (let i = 0; i < chapterNums.length; i++) {
  if (chapterNums[i] !== i + 1) warnings.push(`章节序号不连续：第 ${i + 1} 项是 ${chapterNums[i]}`);
}

const totalWords = chapters.reduce((sum, chapter) => sum + (chapter.words || 0), 0);
const relationByEntity = new Map(entities.map(entity => [entity.id, []]));
const eventsByEntity = new Map(entities.map(entity => [entity.id, []]));
const foreshadowingByEntity = new Map(entities.map(entity => [entity.id, []]));
for (const relation of relations) {
  relationByEntity.get(relation.a)?.push({
    id: relation.id, kind: relation.kind, label: relation.label,
    directed: relation.directed, direction: 'out',
    other: { id: relation.b, name: entityById.get(relation.b)?.name || relation.b }
  });
  relationByEntity.get(relation.b)?.push({
    id: relation.id, kind: relation.kind, label: relation.label,
    directed: relation.directed, direction: 'in',
    other: { id: relation.a, name: entityById.get(relation.a)?.name || relation.a }
  });
}
for (const event of events) {
  for (const participant of event.participants) {
    eventsByEntity.get(participant)?.push({ id: event.id, title: event.title, chapter: event.chapter, date: event.date, place: event.place });
  }
}
for (const item of foreshadowing) {
  for (const owner of item.owner) {
    foreshadowingByEntity.get(owner)?.push({ id: item.id, title: item.title, status: item.status, plantedIn: item.plantedIn, payoffIn: item.payoffIn });
  }
}

const report = {
  ok: errors.length === 0,
  generatedAt: new Date().toISOString(),
  sourceHash,
  counts: {
    entities: entities.length,
    characters: entities.filter(entity => entity.type === 'character').length,
    places: entities.filter(entity => entity.type === 'place').length,
    relations: relations.length,
    events: events.length,
    claims: claims.length,
    foreshadowing: foreshadowing.length,
    openForeshadowing: openForeshadowing.length,
    readerEntities: entities.filter(entity => entity.reader?.visible).length,
    readerRelations: relations.filter(relation => relation.readerVisible).length,
    hiddenEntities: entities.filter(entity => !entity.reader?.visible).length,
    chapters: chapters.length,
    words: totalWords,
    conflictsSoft: conflicts.filter(item => item.severity === 'soft').length,
    conflictsInfo: conflicts.filter(item => item.severity === 'info').length
  },
  errors,
  warnings,
  conflicts: {
    soft: conflicts.filter(item => item.severity === 'soft').length,
    info: conflicts.filter(item => item.severity === 'info').length
  }
};

function markdownReport() {
  const lines = [];
  lines.push('# 《临渊羡鱼》星图一致性报告', '');
  lines.push(`生成时间：${report.generatedAt}`);
  lines.push(`数据指纹：\`${sourceHash}\``);
  lines.push(`结构校验：${report.ok ? '通过' : '未通过'}`);
  lines.push('');
  lines.push('## 摘要', '');
  lines.push(`- 结构错误：${errors.length}`);
  lines.push(`- 待确认冲突：${report.conflicts.soft}`);
  lines.push(`- 提示：${report.conflicts.info}`);
  lines.push(`- 未回收伏笔：${openForeshadowing.length}`);
  lines.push(`- 时间线事件：${events.length}`);
  lines.push('');
  if (errors.length) {
    lines.push('## 结构错误', '');
    errors.forEach((error, index) => lines.push(`${index + 1}. ${error}`));
    lines.push('');
  }
  const soft = conflicts.filter(item => item.severity === 'soft');
  lines.push('## 待确认', '');
  if (soft.length === 0) {
    lines.push('没有发现需要确认的冲突。', '');
  } else {
    soft.forEach((item, index) => {
      lines.push(`### ${index + 1}. ${item.title}`, '');
      lines.push(`- 规则：\`${item.rule}\``);
      lines.push(`- 涉及：${item.entities.map(id => entityById.get(id)?.name || id).join('、') || '—'}`);
      lines.push(`- 证据：${item.evidence.map(evidence => `\`${evidence}\``).join('、')}`);
      lines.push(`- 说明：${item.detail}`);
      if (item.suggestion) lines.push(`- 建议：${item.suggestion}`);
      lines.push('');
    });
  }
  lines.push('## 时间线', '');
  lines.push('| 章 | 日期 | 时段 | 地点 | 事件 | 参与者 |');
  lines.push('|---|---|---|---|---|---|');
  for (const event of orderedEvents) {
    const place = event.place ? (entityById.get(event.place)?.name || event.place) : (event.placeText || '—');
    const participants = event.participants.map(id => entityById.get(id)?.name || id).join('、');
    lines.push(`| ${event.chapter} | ${event.date || '未标注'} | ${TIME_LABEL[event.timeOfDay] || event.timeOfDay} | ${place} | ${event.title} | ${participants} |`);
  }
  lines.push('');
  lines.push('## 未回收伏笔', '');
  if (openForeshadowing.length === 0) {
    lines.push('没有未回收伏笔。', '');
  } else {
    lines.push('| 伏笔 | 埋设章 | 已过章数 | 证据 |');
    lines.push('|---|---|---|---|');
    for (const item of openForeshadowing) {
      lines.push(`| ${item.title} | ${item.plantedIn} | ${item.chaptersOpen} | ${item.evidence.map(evidence => `\`${evidence}\``).join('、')} |`);
    }
    lines.push('');
  }
  lines.push('## 数据统计', '');
  lines.push(`- 实体：${report.counts.entities}（人物 ${report.counts.characters} / 地点 ${report.counts.places}）`);
  lines.push(`- 关系：${report.counts.relations}`);
  lines.push(`- 事件：${report.counts.events}`);
  lines.push(`- 伏笔：${report.counts.foreshadowing}（未回收 ${report.counts.openForeshadowing}）`);
  lines.push(`- 章节：${report.counts.chapters} 章 / ${report.counts.words} 字`);
  lines.push('');
  return lines.join('\n');
}

if (CHECK) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(errors.length ? 1 : 0);
}

if (!report.ok) {
  writeJson(path.join(OUT, 'report.json'), report);
  console.error(`atlas build failed with ${errors.length} error(s)`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

const generatedAt = report.generatedAt;
const chaptersWithEvents = chapters.map(chapter => ({
  ...chapter,
  events: events.filter(event => event.chapter === chapter.num).map(event => event.id)
}));
const atlas = {
  schemaVersion: schema.schemaVersion,
  generatedAt,
  sourceHash,
  publishedThrough,
  meta,
  groups: schema.groups,
  counts: report.counts,
  entities,
  relations,
  chapters: chaptersWithEvents,
  timeline: events,
  claims,
  foreshadowing,
  conflicts
};
const graph = {
  generatedAt,
  sourceHash,
  meta,
  groups: schema.groups,
  nodes: graphNodes,
  edges: relations
};

const readerPayload = {
  publishedThrough,
  generatedAt,
  sourceHash,
  meta,
  groups: schema.groups,
  entities: entities.filter(entity => entity.reader?.visible).map(entity => ({
    id: entity.id,
    name: entity.name,
    type: entity.type,
    group: entity.group,
    role: entity.role,
    summary: entity.reader.summary,
    aliases: entity.aliases,
    quote: '',
    portrait: entity.portrait || null,
    glyph: entity.graph?.glyph || '',
    r: entity.graph?.r ?? 20,
    x: entity.graph?.x ?? 0,
    y: entity.graph?.y ?? 0,
    primary: Boolean(entity.graph?.primary)
  })),
  relations: relations.filter(relation => relation.readerVisible).map(relation => ({
    id: relation.id,
    a: relation.a,
    b: relation.b,
    kind: relation.kind,
    label: relation.readerLabel || relation.label,
    directed: relation.directed
  })),
  events: events.filter(event => event.readerVisible).map(event => ({
    id: event.id,
    title: event.title,
    chapter: event.chapter,
    date: event.date,
    timeOfDay: event.timeOfDay,
    place: event.place,
    placeText: event.placeText,
    participants: event.participants.filter(id => entityById.get(id)?.reader?.visible),
    summary: event.summary,
    evidence: event.evidence
  })),
  counts: {
    entities: entities.filter(entity => entity.reader?.visible).length,
    characters: entities.filter(entity => entity.reader?.visible && entity.type === 'character').length,
    places: entities.filter(entity => entity.reader?.visible && entity.type === 'place').length,
    relations: relations.filter(relation => relation.readerVisible).length,
    events: events.filter(event => event.readerVisible).length,
    hiddenEntities: entities.filter(entity => !entity.reader?.visible).length
  }
};

writeJson(path.join(OUT, 'atlas.json'), atlas);
writeJson(path.join(OUT, 'graph.json'), graph);
fs.writeFileSync(path.join(OUT, 'graph.js'), `window.ATLAS_GRAPH = ${JSON.stringify(graph).replace(/<\/script/gi, '<\\/script')};\n`);
writeJson(path.join(OUT, 'reader.json'), readerPayload);
fs.writeFileSync(path.join(OUT, 'reader.js'), `window.ATLAS_READER = ${JSON.stringify(readerPayload).replace(/<\/script/gi, '<\\/script')};\n`);
fs.writeFileSync(path.join(OUT, 'full.js'), `window.ATLAS_FULL = ${JSON.stringify(atlas).replace(/<\/script/gi, '<\\/script')};\n`);
writeJson(path.join(OUT, 'chapters.json'), { generatedAt, sourceHash, chapters: chaptersWithEvents, totalWords });
writeJson(path.join(OUT, 'timeline.json'), { generatedAt, sourceHash, events });
writeJson(path.join(OUT, 'claims.json'), { generatedAt, sourceHash, claims });
writeJson(path.join(OUT, 'foreshadowing.json'), { generatedAt, sourceHash, foreshadowing, open: openForeshadowing });
writeJson(path.join(OUT, 'conflicts.json'), {
  generatedAt,
  sourceHash,
  ok: report.ok,
  summary: report.conflicts,
  items: conflicts,
  openForeshadowing
});
fs.writeFileSync(path.join(OUT, 'conflicts.md'), markdownReport() + '\n');
writeJson(path.join(OUT, 'report.json'), report);

const entitiesDir = path.join(OUT, 'entities');
fs.rmSync(entitiesDir, { recursive: true, force: true });
fs.mkdirSync(entitiesDir, { recursive: true });
for (const entity of entities) {
  writeJson(path.join(entitiesDir, `${entity.id}.json`), {
    ...entity,
    relations: relationByEntity.get(entity.id) || [],
    events: eventsByEntity.get(entity.id) || [],
    foreshadowing: foreshadowingByEntity.get(entity.id) || []
  });
}

console.log(`atlas built: ${report.counts.entities} entities, ${report.counts.relations} relations, ${report.counts.events} events, ${report.counts.chapters} chapters`);
console.log(`soft conflicts: ${report.conflicts.soft}, info: ${report.conflicts.info}, open foreshadowing: ${report.counts.openForeshadowing}`);
console.log(`sourceHash ${sourceHash}`);
if (warnings.length) console.log(`warnings ${warnings.length}`);
