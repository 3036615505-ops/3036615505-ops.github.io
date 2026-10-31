#!/usr/bin/env node
/**
 * tools/sync-characters.mjs —— 飞书《人物设定》文档 → js/characters-data.js
 *
 * 为什么需要它：人物设定的创作源在飞书文档里（作者在手机上改一句台词，不该
 * 钻进 331 行 JS 里找那一行）。这个工具把「文档 → 数据源」这一段自动化，
 * 落盘仍是 js/characters-data.js（唯一数据源，不参与页面运行），然后由
 * tools/make-characters.mjs 生成同学录与详细页。
 *
 * 用法：
 *   node tools/sync-characters.mjs                       # 默认 dry-run：拉文档 + 打印人话 diff
 *   node tools/sync-characters.mjs --from 人物设定.md      # 从本地 md 读（离线 / 测试用）
 *   node tools/sync-characters.mjs --doc <document_id>     # 指定另一份飞书文档
 *   node tools/sync-characters.mjs --write                 # 才真正写 js/characters-data.js
 *   node tools/sync-characters.mjs --write --gen           # 写完顺便跑 tools/make-characters.mjs
 *
 * 文档结构（`document_id` 默认见下）：
 *   # 一级标题 + 说明段（不解析）
 *   ## 基础信息 → 一个 10 列表格，列序固定：
 *      姓名 | slug | 分组 | 主视觉 | 身份 | 性格标签 | 一句台词 | 一句话简介 | 生日 | 设定标签
 *      主视觉 ✓ = primary true，空 = false；分组写中文「新叶 / 青枝 / 乔木」；
 *      性格标签 1–2 个、设定标签 1–3 个，多个用「 / 」分隔；生日 2007.04.20，长辈留空
 *      **表格行序 = CHARACTERS 数组顺序 = 同学录列表顺序**
 *   ## 小传 → 每人一节 `### 姓名`，空行分段，段数 = 详细页「设定」栏的段数
 *
 * 三条设计要点：
 *   1. **merge 而不是 rebuild**。`portrait`（立绘文件名）与 `initial`（占位字）不在文档里，
 *      按 slug 从**现有的** js/characters-data.js 原样保留；新增人物没有这两项时给默认
 *      （portrait 留空 → 生成器用 initial 占位；initial = 姓名首字）。
 *   2. **默认 dry-run**，`--write` 才落盘。改错一句台词的成本，不该等于「记得先提交」。
 *   3. **严格校验，任一不过就拒绝写入**：分组必须连续（列表页顺序依赖它）、表格姓名集合
 *      与小传姓名集合必须完全一致、slug 唯一且只含 [a-z0-9-]、标签数量、生日格式、小传里
 *      不许有 HTML 标签。这些错在页面上都不报错，只会安静地长出一张丑卡片。
 *
 * **不要把它加进 pre-push / CI 的必跑项** —— 它依赖飞书凭据，CI 里没有。
 * `--from` 模式不联网，可以在任何机器上跑。
 *
 * 零依赖：只用 Node 内置模块。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_JS = path.join(ROOT, 'js', 'characters-data.js');

/** 作者的那份《人物设定》文档。换文档时用 --doc 覆盖。 */
const DEFAULT_DOC_ID = 'REiQd3RhZoXFGqxoZcRclL1NnWe';

/** 表格列序（固定）。列数或列名不对就直接停 —— 列错一位会安静地把台词写进简介。 */
const COLUMNS = ['姓名', 'slug', '分组', '主视觉', '身份', '性格标签', '一句台词', '一句话简介', '生日', '设定标签'];

/** 中文分组 → 数据里的 group 值（顺序即列表页顺序）。 */
const GROUPS = [
  { key: 'xinlei', label: '新叶' },
  { key: 'qingzhi', label: '青枝' },
  { key: 'qiaomu', label: '乔木' }
];
const GROUP_BY_LABEL = new Map(GROUPS.map((g) => [g.label, g.key]));
const LABEL_BY_GROUP = new Map(GROUPS.map((g) => [g.key, g.label]));

/** 字段顺序：与现有 js/characters-data.js 完全一致（primary 只在为 true 时输出）。 */
const FIELD_ORDER = ['slug', 'name', 'group', 'primary', 'initial', 'portrait', 'role', 'tags', 'quote', 'desc', 'birthday', 'traits', 'bio'];
const KNOWN_FIELDS = new Set(FIELD_ORDER);

/* ---------- 参数 ---------- */

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const gen = argv.includes('--gen');

/** 取 `--name value` 形式的参数值。 */
function argValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('用法: node tools/sync-characters.mjs [--from <md>] [--doc <id>] [--write] [--gen]');
  console.log('  默认 dry-run；--write 才写 js/characters-data.js；--write --gen 写完顺便生成页面。');
  process.exit(0);
}

/* ---------- 取文档 ---------- */

/**
 * 用 lark-cli 拉飞书文档的 markdown 正文。
 *
 * lark-cli 的返回是 JSON，正文在 `data.document.content`，**开头会多一行
 * `<title>…</title>`**（飞书导出的习惯），解析前要跳过，否则第一段会被当成
 * 一级标题的兄弟段落。
 *
 * @param {string} docId 文档 id
 * @returns {string} markdown 正文（含开头的 <title> 行）
 */
function fetchFromLark(docId) {
  const exe = process.env.LARK_CLI || 'lark-cli';
  const args = ['docs', '+fetch', '--doc', docId, '--doc-format', 'markdown', '--as', 'user'];
  /* Windows 上 lark-cli 是 .cmd 包装器，不开 shell 找不到可执行文件。
     这里的参数都不含空格（文档 id 是字母数字），所以 shell 拼接是安全的。 */
  const run = spawnSync(exe, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32'
  });
  if (run.error) {
    throw new Error('调用 lark-cli 失败：' + run.error.message +
      '\n  装好 lark-cli（并用 --as user 登录）后重试，或者用 --from <本地md> 离线跑。');
  }
  if (run.status !== 0) {
    throw new Error('lark-cli 退出码 ' + run.status + '：\n' + String(run.stderr || '').trim());
  }
  const raw = String(run.stdout || '');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    /* stdout 里偶尔会混进一行日志，退一步只取最外层的 {...} 再试一次 */
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('lark-cli 的输出不是 JSON：' + raw.slice(0, 200));
    json = JSON.parse(raw.slice(start, end + 1));
  }
  if (json && json.ok === false) {
    throw new Error('lark-cli 返回失败：' + JSON.stringify(json.error || json).slice(0, 400));
  }
  const content = json && json.data && json.data.document && json.data.document.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('lark-cli 返回里没有 data.document.content（文档 id 对吗？）');
  }
  return content;
}

/** 去掉飞书导出的第一行 `<title>…</title>`。 */
function stripTitleTag(text) {
  return String(text).replace(/^\uFEFF?\s*<title>[\s\S]*?<\/title>[ \t]*\n?/, '');
}

/* ---------- 解析文档 ---------- */

/**
 * 表格一行 → 单元格数组（处理 `\|` 转义）。
 *
 * @param {string} line 形如 `| a | b |`
 * @returns {string[]} 单元格（已 trim）
 */
function splitRow(line) {
  const body = String(line).trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i);
    if (ch === '\\' && body.charAt(i + 1) === '|') { cur += '|'; i += 1; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** 一行是不是表格分隔行（`|-|-|` / `|---|---|`）。 */
function isSeparatorRow(line) {
  return /^\|?[\s:|-]+\|?$/.test(String(line).trim()) && String(line).indexOf('-') >= 0;
}

/**
 * 解析文档正文。
 *
 * @param {string} markdown 去掉 <title> 之后的正文
 * @returns {{rows: Array<Record<string,string>>, bios: Map<string, string[]>}}
 */
function parseDocument(markdown) {
  const lines = String(markdown).replace(/\r\n/g, '\n').split('\n');

  const infoIdx = lines.findIndex((l) => /^##\s+基础信息\s*$/.test(l.trim()));
  if (infoIdx < 0) throw new Error('文档里找不到「## 基础信息」小节');
  const bioIdx = lines.findIndex((l) => /^##\s+小传\s*$/.test(l.trim()));
  if (bioIdx < 0) throw new Error('文档里找不到「## 小传」小节');

  /* --- 基础信息表 --- */
  const tableLines = [];
  for (let i = infoIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('|')) { tableLines.push(t); continue; }
    if (!t && !tableLines.length) continue;   // 标题与表格之间的空行
    if (!t) break;                            // 表格结束
    if (tableLines.length) break;
  }
  if (tableLines.length < 3) {
    throw new Error('「基础信息」小节下的表格没找到（至少要有表头 + 分隔行 + 一行数据）');
  }

  const header = splitRow(tableLines[0]);
  if (header.length !== COLUMNS.length || header.some((h, i) => h !== COLUMNS[i])) {
    throw new Error('表格列序不对。\n  期望：' + COLUMNS.join(' | ') +
      '\n  实际：' + header.join(' | '));
  }

  const rows = [];
  tableLines.slice(1).forEach((line) => {
    if (isSeparatorRow(line)) return;
    const cells = splitRow(line);
    if (cells.length !== COLUMNS.length) {
      throw new Error('表格有一行的列数不是 ' + COLUMNS.length + '：' + line);
    }
    const row = {};
    COLUMNS.forEach((c, i) => { row[c] = cells[i]; });
    rows.push(row);
  });
  if (!rows.length) throw new Error('基础信息表里一行数据都没有');

  /* --- 小传 --- */
  const bios = new Map();
  let current = null;
  let buf = [];
  const flush = () => {
    if (!current) return;
    const paragraphs = buf.join('\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    bios.set(current, paragraphs);
    buf = [];
  };
  for (let i = bioIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    const h3 = /^###\s+(.+)$/.exec(t);
    if (h3) {
      flush();
      current = h3[1].trim();
      if (bios.has(current)) throw new Error('小传里「' + current + '」出现了两节');
      continue;
    }
    if (/^##\s+/.test(t)) { flush(); current = null; continue; }  // 后面还有别的二级标题
    if (!current) continue;
    buf.push(lines[i]);
  }
  flush();

  return { rows, bios };
}

/* ---------- 校验 ---------- */

/**
 * 全部校验。收集**所有**错误再一起报，而不是遇到第一个就停 ——
 * 一次改十行的时候，报十次比改十次快。
 *
 * @param {Array<Record<string,string>>} rows 表格行
 * @param {Map<string, string[]>} bios 小传
 * @returns {string[]} 错误列表（空 = 通过）
 */
function validate(rows, bios) {
  const errors = [];

  const names = rows.map((r) => r['姓名']);
  const slugs = rows.map((r) => r.slug);

  /* 姓名唯一 + 姓名为空 */
  const seenNames = new Set();
  names.forEach((n, i) => {
    if (!n) { errors.push('第 ' + (i + 1) + ' 行：姓名为空'); return; }
    if (seenNames.has(n)) errors.push('第 ' + (i + 1) + ' 行：姓名「' + n + '」在表格里出现了两次');
    seenNames.add(n);
  });

  /* slug 唯一 + 字符集 */
  const seenSlugs = new Set();
  slugs.forEach((s, i) => {
    if (!s) { errors.push('第 ' + (i + 1) + ' 行（' + (names[i] || '?') + '）：slug 为空'); return; }
    if (!/^[a-z0-9-]+$/.test(s)) {
      errors.push('第 ' + (i + 1) + ' 行（' + (names[i] || '?') + '）：slug「' + s + '」只能包含小写字母、数字与连字符');
    }
    if (seenSlugs.has(s)) errors.push('第 ' + (i + 1) + ' 行：「' + (names[i] || '?') + '」的 slug「' + s + '」重复了（详细页会互相覆盖）');
    seenSlugs.add(s);
  });

  /* 分组：合法 + 同组连续 */
  const groupSeq = [];
  rows.forEach((r, i) => {
    const label = r['分组'];
    const key = GROUP_BY_LABEL.get(label);
    if (!key) {
      errors.push('第 ' + (i + 1) + ' 行（' + (r['姓名'] || '?') + '）：分组「' + label +
        '」不认识，只能是 ' + GROUPS.map((g) => g.label).join(' / '));
      return;
    }
    if (groupSeq.length === 0 || groupSeq[groupSeq.length - 1].key !== key) {
      groupSeq.push({ key, label, at: i + 1, name: r['姓名'] || '?' });
    }
  });
  const seenGroups = new Set();
  const firstSeen = new Map();
  let lastKey = null;
  groupSeq.forEach((g) => {
    if (g.key === lastKey) return;
    if (seenGroups.has(g.key)) {
      const first = firstSeen.get(g.key);
      errors.push('分组不连续：第 ' + g.at + ' 行（' + g.name + '）是「' + g.label +
        '」，但这一组在第 ' + first.at + ' 行（' + first.name + '）已经出现过。' +
        '同一组的人必须连在一起写（列表页按这个顺序分组）。');
    }
    seenGroups.add(g.key);
    if (!firstSeen.has(g.key)) firstSeen.set(g.key, g);
    lastKey = g.key;
  });

  /* 必填非空 */
  const required = [['姓名', 'name'], ['slug', 'slug'], ['分组', 'group'], ['身份', 'role'],
    ['一句台词', 'quote'], ['一句话简介', 'desc'], ['性格标签', 'tags'], ['设定标签', 'traits']];
  rows.forEach((r, i) => {
    required.forEach(([col, field]) => {
      if (!String(r[col] || '').trim()) {
        errors.push('第 ' + (i + 1) + ' 行（' + (r['姓名'] || '?') + '）：' + col + ' 不能为空（对应字段 ' + field + '）');
      }
    });
  });

  /* 标签数量 */
  rows.forEach((r, i) => {
    const who = '第 ' + (i + 1) + ' 行（' + (r['姓名'] || '?') + '）';
    const tags = splitList(r['性格标签']);
    const traits = splitList(r['设定标签']);
    if (tags.length < 1 || tags.length > 2) errors.push(who + '：性格标签要 1–2 个，现在是 ' + tags.length + ' 个');
    if (traits.length < 1 || traits.length > 3) errors.push(who + '：设定标签要 1–3 个，现在是 ' + traits.length + ' 个');
  });

  /* 生日格式 */
  rows.forEach((r, i) => {
    const b = String(r['生日'] || '').trim();
    if (b && !/^\d{4}\.\d{2}\.\d{2}$/.test(b)) {
      errors.push('第 ' + (i + 1) + ' 行（' + (r['姓名'] || '?') + '）：生日「' + b + '」不是 YYYY.MM.DD 格式（长辈留空）');
    }
  });

  /* 表格姓名集合 === 小传姓名集合 */
  names.filter(Boolean).forEach((n) => {
    if (!bios.has(n)) errors.push('「' + n + '」在基础信息表里，但「## 小传」下没有 `### ' + n + '` 这一节');
  });
  [...bios.keys()].forEach((n) => {
    if (!names.includes(n)) errors.push('「## 小传」下的 `### ' + n + '` 在基础信息表里没有对应的行（多出来的小传）');
  });

  /* 小传：非空 + 不许有 HTML 标签 */
  bios.forEach((paragraphs, name) => {
    if (!paragraphs.length) errors.push('「' + name + '」的小传是空的（至少要有一段）');
    paragraphs.forEach((p, i) => {
      if (/<\/?[a-zA-Z][^>]*>/.test(p)) {
        errors.push('「' + name + '」小传第 ' + (i + 1) + ' 段里出现了 HTML 标签（会被原样渲染成文本）');
      }
    });
  });

  return errors;
}

/** 「温暖 / 观察者」→ ['温暖', '观察者']。 */
function splitList(cell) {
  return String(cell || '').split(/\s*[/／]\s*/).map((s) => s.trim()).filter(Boolean);
}

/* ---------- 读现有数据 ---------- */

/**
 * 读现有 js/characters-data.js 的 CHARACTERS（vm 求值，和 make-characters.mjs 同一套）。
 *
 * @returns {{entries: Array<Object>, src: string}}
 */
function readExisting() {
  const src = fs.readFileSync(DATA_JS, 'utf8');
  const start = src.indexOf('var CHARACTERS = [');
  if (start < 0) throw new Error('characters-data.js 里找不到 CHARACTERS 数组');
  const open = src.indexOf('[', start);
  const end = src.indexOf('\n];', open);
  if (end < 0) throw new Error('CHARACTERS 数组没有正常结束');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext('result = ' + src.slice(open, end + 2), sandbox);
  if (!Array.isArray(sandbox.result)) throw new Error('CHARACTERS 不是数组');
  return { entries: sandbox.result, src };
}

/* ---------- 组装 ---------- */

/**
 * 表格行 + 小传 + 现有数据 → CHARACTERS 条目数组（顺序 = 表格行序）。
 *
 * @param {Array<Record<string,string>>} rows 表格行
 * @param {Map<string, string[]>} bios 小传
 * @param {Array<Object>} existing 现有条目
 * @param {string[]} notes 收集「新增人物」之类的提示
 * @returns {Array<Object>} 新条目
 */
function buildEntries(rows, bios, existing, notes) {
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  return rows.map((r) => {
    const prev = bySlug.get(r.slug);
    const name = r['姓名'].trim();
    const group = GROUP_BY_LABEL.get(r['分组']);
    const entry = {
      slug: r.slug.trim(),
      name,
      group
    };
    if (r['主视觉'].trim() === '✓' || r['主视觉'].trim() === '√') entry.primary = true;

    /* portrait / initial 不在文档里：按 slug 从现有数据原样保留。
       新增人物没有立绘时 portrait 留空（生成器回落到 initial 占位），
       initial 取姓名首字 —— 姓氏占位字走 ZCOOL XiaoWei 子集，缺字会回落系统 serif。 */
    if (prev) {
      if (prev.portrait) entry.portrait = prev.portrait;
      if (prev.initial) entry.initial = prev.initial;
    } else {
      entry.initial = name.charAt(0);
      notes.push('新增人物「' + name + '」：portrait 留空（用 initial「' + entry.initial +
        '」占位），有立绘后填 assets/portrait-' + entry.slug + '-1024.webp');
    }

    entry.role = r['身份'].trim();
    entry.tags = splitList(r['性格标签']);
    entry.quote = r['一句台词'].trim();
    entry.desc = r['一句话简介'].trim();
    const birthday = String(r['生日'] || '').trim();
    if (birthday) entry.birthday = birthday;
    entry.traits = splitList(r['设定标签']);
    entry.bio = (bios.get(name) || []).slice();
    return entry;
  });
}

/* ---------- 序列化（风格必须与现有文件一致） ---------- */

/** 单引号字符串字面量（转义反斜杠与单引号）。 */
function q(value) {
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

/**
 * 一个条目 → 多行源码。字段顺序 = FIELD_ORDER，空字段直接不输出
 * （现有文件里长辈没有 birthday 那一行，就是这个约定）。
 *
 * @param {Object} c 条目
 * @returns {string} 形如 "  {\n    slug: '…',\n    …\n  }"
 */
function serializeEntry(c) {
  const fields = [];
  FIELD_ORDER.forEach((key) => {
    const v = c[key];
    if (key === 'primary') { if (v === true) fields.push('    primary: true'); return; }
    if (key === 'bio') {
      const bio = Array.isArray(v) ? v : [];
      fields.push('    bio: [\n' + bio.map((p) => '      ' + q(p)).join(',\n') + '\n    ]');
      return;
    }
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) {
      fields.push('    ' + key + ': [' + v.map(q).join(', ') + ']');
      return;
    }
    fields.push('    ' + key + ': ' + q(v));
  });
  return '  {\n' + fields.join(',\n') + '\n  }';
}

/**
 * 条目数组 → 整个 characters-data.js 源码。
 *
 * 写法沿用现有文件：文件头那段注释**原样保留**，分组之间空一行并带组注释。
 *
 * @param {Array<Object>} entries 条目
 * @param {string} originalSrc 现有文件全文（用来取头部注释与数组边界）
 * @returns {string} 新文件内容
 */
function serializeFile(entries, originalSrc) {
  const arrStart = originalSrc.indexOf('var CHARACTERS = [');
  if (arrStart < 0) throw new Error('characters-data.js 里找不到 CHARACTERS 数组');
  const open = originalSrc.indexOf('[', arrStart);
  const close = originalSrc.indexOf('\n];', open);
  if (open < 0 || close < 0) throw new Error('CHARACTERS 数组没有正常结束');
  const head = originalSrc.slice(0, open + 1) + '\n';   // …var CHARACTERS = [\n
  const tail = originalSrc.slice(close);                // \n];\n…

  const blocks = [];
  let currentGroup = null;
  let bucket = [];
  const flush = () => {
    if (!bucket.length) return;
    blocks.push('  /* ===== ' + (LABEL_BY_GROUP.get(currentGroup) || currentGroup) + ' ===== */\n' +
      bucket.map(serializeEntry).join(',\n'));
    bucket = [];
  };
  entries.forEach((c) => {
    if (c.group !== currentGroup) { flush(); currentGroup = c.group; }
    bucket.push(c);
  });
  flush();

  /* 组与组之间是「, + 空行 + 组注释」—— 上一个组最后那个 `}` 后面照样带逗号
     （现有文件就是这么写的，少了这个逗号就不是同一个风格了）。
     整个数组最后一条不带逗号，其后空一行再 `];`。 */
  return head + blocks.join(',\n\n') + '\n' + tail;
}

/* ---------- diff ---------- */

/** 值 → 一眼能看懂的字符串（数组用「 / 」连，空值显示「（空）」）。 */
function show(v) {
  if (v === undefined || v === null || v === '') return '（空）';
  if (v === true) return 'true';
  if (Array.isArray(v)) return v.join(' / ');
  return String(v);
}

/** 长文本截断，diff 里不该出现整段小传。 */
function brief(v, max) {
  const s = show(v);
  const limit = max || 76;
  return s.length > limit ? s.slice(0, limit) + '…' : s;
}

/**
 * 打印人话 diff：谁新增、谁删除、谁哪个字段变了（旧 → 新）。
 *
 * @param {Array<Object>} oldList 现有条目
 * @param {Array<Object>} newList 新条目
 * @returns {number} 差异条数
 */
function printDiff(oldList, newList) {
  const oldBySlug = new Map(oldList.map((c) => [c.slug, c]));
  const newBySlug = new Map(newList.map((c) => [c.slug, c]));
  let count = 0;

  newList.forEach((c, i) => {
    if (!oldBySlug.has(c.slug)) {
      count += 1;
      console.log('  + 新增：' + c.name + '（' + c.slug + '，' + (LABEL_BY_GROUP.get(c.group) || c.group) +
        '，第 ' + (i + 1) + ' 位）');
    }
  });
  oldList.forEach((c) => {
    if (!newBySlug.has(c.slug)) {
      count += 1;
      console.log('  - 删除：' + c.name + '（' + c.slug + '）');
    }
  });

  newList.forEach((c) => {
    const old = oldBySlug.get(c.slug);
    if (!old) return;
    if (old.name !== c.name) {
      count += 1;
      console.log('  ~ ' + old.name + '（' + c.slug + '）的 name：' + show(old.name) + ' → ' + show(c.name));
    }
    FIELD_ORDER.forEach((key) => {
      if (key === 'name') return;
      /* portrait / initial 不在文档里，是 merge 出来的，永远不该有变化 */
      const a = old[key];
      const b = c[key];
      const same = Array.isArray(a) || Array.isArray(b)
        ? show(a) === show(b)
        : (a === undefined ? '' : a) === (b === undefined ? '' : b);
      if (same) return;
      count += 1;
      console.log('  ~ ' + c.name + '（' + c.slug + '）的 ' + key + '：' + brief(a) + ' → ' + brief(b));
    });
  });

  /* 顺序变化：列表页按数组顺序显示，挪一位就整页变 */
  const commonOld = oldList.filter((c) => newBySlug.has(c.slug)).map((c) => c.slug);
  const commonNew = newList.filter((c) => oldBySlug.has(c.slug)).map((c) => c.slug);
  if (commonOld.join() !== commonNew.join()) {
    count += 1;
    const moved = commonNew.filter((s, i) => commonOld[i] !== s);
    console.log('  ↕ 顺序变化：' + moved.map((s) => {
      const c = newBySlug.get(s);
      return c.name + ' 第 ' + (oldList.findIndex((o) => o.slug === s) + 1) + ' → 第 ' + (commonNew.indexOf(s) + 1);
    }).join('；'));
  }

  return count;
}

/* ---------- 主流程 ---------- */

let usedSource = '';
let markdown = '';

try {
  const fromPath = argValue('--from');
  if (fromPath) {
    const abs = path.resolve(process.cwd(), fromPath);
    if (!fs.existsSync(abs)) throw new Error('找不到本地 md：' + abs);
    markdown = fs.readFileSync(abs, 'utf8');
    usedSource = '本地 ' + path.relative(ROOT, abs);
  } else {
    const docId = argValue('--doc') || DEFAULT_DOC_ID;
    markdown = fetchFromLark(docId);
    usedSource = '飞书 ' + docId;
  }

  const body = stripTitleTag(markdown);
  const { rows, bios } = parseDocument(body);

  const errors = validate(rows, bios);
  if (errors.length) {
    console.error('✗ 校验没通过（' + errors.length + ' 处），**没有写入任何文件**：');
    errors.forEach((e) => console.error('   · ' + e));
    console.error('\n改好文档里的这几处再跑一次。');
    process.exit(1);
  }

  const { entries: existing, src: originalSrc } = readExisting();
  const notes = [];
  const entries = buildEntries(rows, bios, existing, notes);

  /* 现有数据里有、但这份工具不认识的字段：不静默丢掉，提醒一句 */
  const unknown = new Set();
  existing.forEach((c) => Object.keys(c).forEach((k) => { if (!KNOWN_FIELDS.has(k)) unknown.add(k); }));
  if (unknown.size) {
    notes.push('现有数据里有本工具不认识的字段：' + [...unknown].join(' / ') +
      '（它们不会被写回去 —— 如果确实要保留，请先扩展 FIELD_ORDER）');
  }

  const nextSrc = serializeFile(entries, originalSrc);
  const changed = nextSrc !== originalSrc;

  console.log('人物同步 · ' + (write ? '写盘模式' : 'dry-run（不写文件）'));
  console.log('  来源：' + usedSource);
  console.log('  现有 ' + existing.length + ' 人 → 文档 ' + entries.length + ' 人');
  console.log('');

  if (!changed) {
    console.log('✓ js/characters-data.js 与文档完全一致，没有需要改的地方。');
  } else {
    const diffCount = printDiff(existing, entries);
    console.log('');
    console.log('共 ' + diffCount + ' 处差异。');
  }

  if (notes.length) {
    console.log('');
    notes.forEach((n) => console.log('  · ' + n));
  }

  if (changed && write) {
    fs.writeFileSync(DATA_JS, nextSrc, 'utf8');
    console.log('\n✓ 已写入 js/characters-data.js');
    if (gen) {
      console.log('→ 重新生成同学录与详细页（tools/make-characters.mjs）');
      const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'make-characters.mjs')], {
        stdio: 'inherit',
        cwd: ROOT
      });
      if (run.status !== 0) {
        console.error('✗ make-characters.mjs 失败（数据源已写入，页面还没刷新）。手动跑：');
        console.error('    node tools/make-characters.mjs');
        process.exit(1);
      }
    } else {
      console.log('下一步：node tools/make-characters.mjs（光改数据源网站不会变，页面是预生成的）');
    }
  } else if (changed) {
    console.log('\n这是 dry-run，什么都没写。确认无误后加 --write 落盘：');
    console.log('    node tools/sync-characters.mjs --write');
    console.log('    node tools/sync-characters.mjs --write --gen   （写完顺便重生成页面）');
  }
} catch (err) {
  console.error('✗ ' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
