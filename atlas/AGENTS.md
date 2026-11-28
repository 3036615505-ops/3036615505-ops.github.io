# 临渊羡鱼 · 星图数据层

这是《临渊羡鱼》人物、地点、关系、时间线与伏笔的机器可读事实层。目标是让作者、AI agent 和读者端读取同一份数据，而不是各自维护一份设定。

## 事实源边界

| 内容 | 事实源 | 说明 |
|---|---|---|
| 人物 | `content/characters.json` | 由飞书《临渊羡鱼 · 人物设定》同步生成，**不要改 atlas 里的副本** |
| 地点 | `atlas/data/entities/places/*.json` | 一手维护，一个地点一个文件 |
| 关系 | `atlas/data/relations.json` | 一手维护，每条关系带 `evidence` |
| 时间线 | `atlas/data/timeline.json` | 一手维护，事件按章与场景登记 |
| 跨实体表述 | `atlas/data/claims.json` | 旁白里的统称、年龄、班级等可被检验的声明 |
| 伏笔 | `atlas/data/foreshadowing.json` | 埋设章、回收章、状态、证据 |
| 读者可见性 | `atlas/data/reader.json` | 每个实体的登场章、读者版摘要、关系覆盖 |
| 坐标 | `atlas/data/layout.json` | 构建时冻结的版面坐标，不是地理坐标 |
| 章节元信息 | `content/chapter-*.json` | 只读取 `num/title/words/dates/storyDate/updated` 等字段 |
| 生成物 | `atlas/generated/*` | 由 `atlas/build.mjs` 产出，**不要手改** |

人物数据的上游链路是：飞书文档 → `js/characters-data.js` → `content/characters.json`。atlas 读取最后一层，避免把人物小传复制成第三份。

## 命令

```bash
node atlas/build.mjs          # 校验并生成 atlas/generated/*
node atlas/build.mjs --check  # 只校验，不写文件；结构错误退出 1
node atlas/query.mjs help     # 查询入口
```

结构错误会让构建失败；年龄、地点、日期这类“需要作者确认”的软冲突只写进报告，不阻塞生成。

生成物：

```
atlas/generated/
  atlas.json              全部实体 + 关系 + 时间线 + 伏笔 + 冲突
  graph.json              星图节点/边（含冻结坐标）
  graph.js                window.ATLAS_GRAPH = {...}，原型直接加载
  chapters.json           11 章元信息 + 每章事件 id
  reader.json             默认读者视图（按已发布章节过滤）
  reader.js               window.ATLAS_READER，读者页首屏加载
  full.js                 window.ATLAS_FULL，点击“显示全部”后懒加载
  timeline.json           时间线事件
  claims.json             跨实体表述
  foreshadowing.json      伏笔与未回收列表
  conflicts.json          结构化冲突
  conflicts.md            人读的一致性报告
  entities/<id>.json      单实体 + 一度关系 + 参与事件 + 相关伏笔
  report.json             计数、错误、警告、sourceHash
```

## 查询入口

`atlas/query.mjs` 只读生成物，不修改数据；所有命令都支持 `--json`。

```bash
node atlas/query.mjs stats
node atlas/query.mjs entity 林纾
node atlas/query.mjs relations 林纾
node atlas/query.mjs events 林纾
node atlas/query.mjs timeline 7
node atlas/query.mjs chapter 7
node atlas/query.mjs foreshadow open
node atlas/query.mjs conflict
node atlas/query.mjs path 叶南衡 江不秋
node atlas/query.mjs search 咖啡
node atlas/query.mjs context 江不秋 --json
```

`context` 是给 AI 的一次性上下文包：实体、关系、参与事件、相关伏笔和全书未回收伏笔。

## AI 工作流

三个固定提示词在 `atlas/prompts/`：

| 文件 | 用途 |
|---|---|
| `pre-chapter-check.md` | 写新章前检查时间线、人物知识边界、关系阶段与可用伏笔 |
| `revision-conflict-scan.md` | 改稿后扫描事实、时间、地点、关系、术语、伏笔冲突 |
| `chapter-inspiration.md` | 从已登记伏笔和关系张力生成下一步章节方向 |

使用时先让 agent 读提示词，再让它跑 `query.mjs`，最后按提示词里的输出格式交付。不要让 agent 直接改 `canon`。

## 字段契约

实体：

```json
{
  "id": "nanheng",
  "type": "character",
  "name": "叶南衡",
  "group": "xinlei",
  "role": "主视角",
  "summary": "一句话简介",
  "aliases": ["南南"],
  "status": "canon",
  "birthday": "2006.11.18",
  "derived": { "ageAtStoryStart": 15 },
  "source": { "kind": "projection", "file": "content/characters.json", "upstream": "js/characters-data.js", "id": "nanheng" },
  "graph": { "x": 495, "y": 395, "r": 28, "primary": true }
}
```

关系：

```json
{
  "id": "rel-nanheng-guchiyan-family",
  "a": "nanheng",
  "b": "guchiyan",
  "kind": "family",
  "label": "母子",
  "directed": false,
  "status": "canon",
  "evidence": ["content/characters.json#nanheng"]
}
```

`kind` 只能是 `family / love / friend / mentor / place`。`status` 只能是 `canon / draft / retired`。

事件：

```json
{
  "id": "evt-ch01-cafe-first",
  "title": "第一次走进临渊羡鱼",
  "chapter": 1,
  "date": "2022-09-17",
  "dateConfidence": "exact",
  "timeOfDay": "afternoon",
  "place": "linyuan",
  "placeText": "临渊羡鱼",
  "participants": ["nanheng", "linshu", "shenruoqi"],
  "summary": "一句话事件",
  "evidence": ["content/chapter-01.json#p27-64"]
}
```

日期置信度：

- `exact`：章节或正文明确写出，可用于日期顺序、地点互斥检查。
- `inferred`：从上下文推断（例如第六章接续第五章当晚），只展示，不参与硬性日期范围检查。
- `unknown`：没有日期，只按章节顺序排列。

伏笔：

```json
{
  "id": "fs-cafe-promise",
  "title": "叶南衡答应下次请林纾喝咖啡",
  "plantedIn": 1,
  "payoffIn": 7,
  "status": "paid",
  "owner": ["nanheng", "linshu"],
  "evidence": ["content/chapter-01.json#p61-64", "content/chapter-07.json#p38-43"]
}
```

`status` 只能是 `open / paid / abandoned`。`paid` 必须有 `payoffIn`，且回收章不能早于埋设章。

读者视图：

- 默认只显示 `reader.json` 中 `revealAt` 不为空、且不超过当前已发布章数的实体。
- 关系默认要求两端都可见；`reader.json` 可对单条关系设 `visible: false` 或更晚的 `revealAt`。
- 默认视图只给读者版摘要，不加载人物 `bio`、台词和伏笔；点击“显示全部（含剧透）”才懒加载 `full.js`。
- `reader.json` 的 `relations.*.readerLabel` 可以用更中性的说法替换关系标签（例如“暗恋”改成“在意”）。

`claim` 的状态额外支持 `ignored`：作者确认不参与检查的表述，保留记录但不产生冲突。

## 自动检查

`node atlas/build.mjs` 会做两层检查：

1. **结构检查**：id 重复、关系端点不存在、事件参与者/地点不存在、坐标越界、章节序号连续、状态枚举合法、伏笔回收章早于埋设章等。失败则构建失败。
2. **一致性检查**（写入 `conflicts.md`，不阻塞构建）：
   - 事件日期是否落在本章 `storyDate` 范围内；
   - 章节日期是否随章号递增；
   - 事件日期是否随章节顺序递增；
   - 同一人物在同一日期/时段是否出现在两个地点；
   - 已故人物是否出现在当前时间线；
   - 人物是否在出生前出场；
   - 旁白年龄声明与生日计算是否一致。

年龄计算以 `meta.storyStart` 为锚点，当前为 `2022-09-01`。

## 新增与修改

- **新增人物**：不要直接写 atlas。先改飞书人物设定 → 同步 `js/characters-data.js` → 重新生成 `content/characters.json` → 在 `layout.json` 加坐标 → `node atlas/build.mjs`。
- **新增地点**：在 `atlas/data/entities/places/` 建一个 JSON，按 `schema.json` 的 `place` 必填字段写，再到 `layout.json` 加坐标。
- **新增关系**：在 `atlas/data/relations.json` 的 `items` 里追加，必须有 `evidence`。有方向的关系加 `"directed": true`。
- **新增事件**：在 `atlas/data/timeline.json` 的 `items` 里追加，写清 `chapter / date / timeOfDay / place / participants`；不确定日期就标 `inferred` 或 `unknown`。
- **新增伏笔**：在 `atlas/data/foreshadowing.json` 的 `items` 里追加；回收时补 `payoffIn` 并把 `status` 改成 `paid`。
- **改坐标**：只改 `layout.json`，不要改 `graph.json`。改完跑 build。

## 给 AI agent 的约束

1. 先读 `atlas/generated/atlas.json` 建立全局视图；查单个人物时读 `atlas/generated/entities/<id>.json`。
2. 任何结论都要能回指到 `evidence` 或章节段落。没有证据的推断，必须标成“推测”，不能写成 canon。
3. 发现冲突时只输出报告，不要直接改 `canon`。报告至少包含：涉及实体、两段互相矛盾的表述、各自出处、建议向作者确认的问题。
4. 区分三种状态：`canon`（已确认）、`draft`（草稿）、`retired`（已作废）。不要把 `draft` 当成事实。
5. 星图坐标只用于版面，不可用来推断人物距离、地理方位或亲疏。
6. 章节证据用 `content/chapter-XX.json#pN`，其中 `pN` 是 `paragraphs` 里 `type: "p"` 的 `index`；区间写作 `#p0-19`。引用前先核对原文。
7. 日期为 `inferred` 的事件，不得用来否定 `exact` 事件；只能作为“可能的时间关系”提示。
8. 生成 `conflicts.md` 后，先读报告，再读被点名的实体的 `entities/<id>.json`，最后回原文核对；不要只凭报告下结论。

## 当前边界

M3 已覆盖查询 CLI 与三个 AI 工作流提示词。以下还未实现：

- 事件与实体的正文段落级高亮定位（当前只有文件+段落区间）
- 伏笔的“预计回收章”与逾期提醒（当前只算已过章数）
- 关系强度的量化（当前只有类型与文字标签）
- 星图页加入 Service Worker 预缓存（当前在线可用，离线不保证）
- 让 agent 自动写回 `draft` 设定（当前只读，写回需人工确认）
