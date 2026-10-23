# 交接说明（下次动工先读这份）

> 最后更新：2026-10-24 04:30 · 对应 HEAD `见 git log -1`
> 写给「几天后回来、已经忘了细节的自己」。README 讲怎么改，这份讲**现在是什么状态、哪里埋着坑**。

## 一页纸现状

| 项 | 值 |
|---|---|
| 线上 | <https://zephyrw.site>（GitHub Pages，push 即发布） |
| 站点资源版本 | `?v=50`（7 个 HTML 引用统一） |
| SW 缓存名 | `linyuan-v33` |
| 阅读器模块 | dom 77 行 · flags 86 · store 226 · engine 467 · ui 1356 · 入口 30 |
| 样式 | `css/style.css` 3860 行（4 套主题令牌） |
| 章节 | 3 章（ch01 2858 / ch02 2347 / ch03 2029 字），源稿在 `manuscript/`；`CHAPTERS` 带 `year`（四位数字）+ `date`/`dates`，首页光阴册按学年学期分段（标签如「二〇二二 · 高一上」，年级由 `COHORT_YEAR` 推出）；一章多日 → 日期列每 4 秒跳一格，章内日期（如第一章九月十七）插在场景切换后，不挂章末 |
| Android 壳 | v1.8.4 / versionCode 13（**本轮无壳改动，不需要重新打包**） |
| 校验 | 本地 pre-push 4 项 · CI 2 个 job · 端到端 27 项 |

## 常用命令

```bash
node tools/e2e.mjs                 # 27 项端到端（真浏览器，约 40 秒）
node tools/e2e.mjs --verbose       # 附带每项实测值
npx -p typescript tsc -p jsconfig.json --noEmit   # 类型检查（零产出）
node tools/bump-assets.mjs --write # 发版前必做：全站 ?v= 统一 +1
node tools/bump-assets.mjs --check # 只检查是否混版
node tools/check-precache.mjs      # SW 预缓存条目是否存在
node tools/manuscript-sync.mjs     # 正文与 manuscript/ 源稿逐字比对
python tools/make-kai-subset.py --check            # 楷体子集是否覆盖正文
node new-chapter.js <原稿.md>       # 加新章节（会自动写 manuscript/）
```

## 架构：五层，依赖单向

```
reader.js（入口，30 行）
   └─ reader.ui.js       界面：面板、工具栏、主题、字体、状态条、阅读辅助
        └─ reader.engine.js   引擎：百分比、段落锚点、位置恢复、自动滚屏、阅读计时
             └─ reader.store.js  存储：键名、schema+迁移、足迹、摘句、备份导入导出
reader.flags.js   远程开关（谁都能读）
reader.dom.js     DOM 工具 el()/html()/escapeHtml（谁都能用）
```

**规则**：跨层调用不改调用点，而是在文件头声明同名 shim。那份 shim 清单就是「本模块依赖外部什么」的完整答案——读一个文件就够，不用满仓库找。往 engine 里塞面板代码、往 store 里塞样式逻辑，等于把边界重新糊上。

## 数据模型（全在 localStorage）

| 键 | 内容 |
|---|---|
| `reader-schema` | 当前 v2 |
| `reader-pos-<id>` | 进度百分比 |
| `reader-anchor-<id>` | `{p,i,o}` 段落锚点（i=第几段，o=段内比例） |
| `reader-done-<id>` | 读完标记（≥95%） |
| `reader-footprints` | `{days, quotes, themeCounts, time, dayTime, v, ...}` |
| `reader-quotes` | 摘句正文 |
| `reader-theme` / `-fontsize` / `-fontfamily` / `-readwidth` | 版式偏好 |
| `reader-dialogue` / `-cornerquotes` / `-keepawake` / `-remaintime` | 阅读辅助四项 |
| `reader-autoscroll-speed` / `-swipe-hint` | 自动滚屏速度 / 首次手势提示 |

`<id>` 由路径生成：`/novel/chapter-02.html` → `-novel-chapter-02-html`。

加字段的流程：`normalizeFootprints` 补默认值 → `STORAGE_SCHEMA` +1 → `migrateStorage` 里写迁移。备份导出会自动带上所有 `reader-*` 键。

## 两类改动，两种流程

**A. 只改站点（绝大多数情况）**——HTML/CSS/JS/章节/图片：

```bash
node tools/bump-assets.mjs --write   # ① 改 CSS/JS 必须做，否则用户吃旧缓存
# ② 若改了 sw.js 的 PRECACHE，CACHE 版本号也要 +1（v29 → v30）
git commit && git push               # ③ pre-push 会跑 4 项校验，CI 会再跑一遍
```

**B. 改到壳**（图标、应用名、权限、Manifest、WebView 设置、原生桥）——才需要：

```bash
cd E:/novel-site/twa && ./publish-apk.sh "更新说明"
```

## 加新章节（一条命令，其余全自动）

```bash
node new-chapter.js 原稿.md --blurb "目录页一句话" --date "十月十日" --seal "前桌"
```

原稿写成 Markdown：首行 `# 标题`，空行分段，单独一行 `---` 是场景分隔。

脚本一次做完六件事：

1. 生成 `novel/chapter-NN.html`（八个脚本引用齐全，`?v=` 自动取当前版本）
2. 写 `manuscript/chapter-NN.md`（源稿快照，push 前逐字比对）
3. 把新章节页登记进 `sw.js` 的 `PRECACHE`
4. 把 `CACHE` 版本名 +1（不升的话老用户 SW 不会重新 install，新条目进不去）
5. 往 `js/chapters.js` 追加条目（保留 `date/seal/leaf`，未知字段也不丢）
6. 把上一章的「下一章」接上

三道保护：**目标章节页已存在 → 中止**（不覆盖旧章）；**模板漏脚本 → 删掉半成品并报错**；`check-precache.mjs` 里还有一条 CI 检查，拿现有章节页比对模板的脚本引用，模板落后会红。

人工只剩一件：把章末「这一章留下来的」占位文案换成属于这一章的话（脚本会提醒）。
然后 commit + push，CI 跑四项校验 + 27 项端到端。

新增章节**不需要**手动升 `?v=`：章节页是新 URL，导航走网络优先；`CACHE` 由脚本升。

## 埋过的坑（每条都是真出过事的）

1. **`content-visibility: auto` 会毁掉所有位置数学**。没进过视口的段落只有 2em 的估算高度，跳进章节中间时整章高度是假的 → 进度、页码、剩余时间、位置恢复全错。已从 `.chapter-content p` 删除，**别再以“性能”名义加回来**。
2. **`pagehide` 的强制保存会把好进度写成 0**。现在两条规则：恢复窗口内（`restoring`）连 force 都不写；没滚动过却是 0、而已有进度时，不覆盖。
3. **`new-chapter.js` 曾会覆盖第一章**。原因是它用正则解析 `CHAPTERS`，条目加了 `date/seal/leaf` 后失配 → 章号算成 1。已改为 `vm` 求值 + 目标文件存在即中止。
4. **改了 HTML 的 `?v=` 但没升 `CACHE`**，旧 `?v=` 缓存永不失效。这是“我分明发了版还是旧的”的头号原因。
5. **`a[download]` 在 WebView 里不可靠**，所以备份以「复制」为主路径，「存为文件」只在浏览器里出现。
6. **改 `.github/workflows/` 需要带 `workflow` 权限的 token**，当前 PAT 没有 → 走网页端编辑。
7. **`.mailmap` 不能让 GitHub 的 Contributors 面板消失**，它只影响本地 `git shortlog`。
8. `E:/novel-site/src|novels|dist` 是已退役的旧生成器（`dist/.git` 已隔离），**别跑 `build.js`**，它有熔断会拒绝执行。

## 远程开关（出问题时先关功能，别回滚整站）

`flags.json`，不缓存，改完 push 一分钟生效，**不用发版也不用升 `?v=`**：

| 开关 | 关掉 | 用途 |
|---|---|---|
| `autoscroll` | 自动滚屏按钮隐藏且拒绝启动 | rAF 滚动出问题 |
| `readingAids` | 设置里「阅读辅助」整组隐藏 | 正文装饰出问题 |
| `anchorRestore` | 退回按百分比恢复（会偏但能读） | 锚点算错 |
| `backup` | 「阅读数据」整组隐藏 | 导入导出出问题 |

约定：拉不到就全开、用的时候才问 `isOn()`、只认 boolean。新增开关要同时改 `reader.flags.js` 的 `DEFAULTS`、`flags.json`、`applyFeatureVisibility()`。

## 还没做的（带理由，不是待办清单凑数）

| 事项 | 建议时机 | 理由 |
|---|---|---|
| 老面板（目录/设置/摘句/备份）从 innerHTML 迁到 `el()` | 下次真要加界面时 | 纯内部质量，无用户可见收益；且 27 项断言测行为不测像素，风险兜不住 |
| `ui.js` 再拆出 `panels.js`（纯移动） | 想拆随时可做 | 风险低，但也没收益；`ui.js` 1356 行目前还能忍 |
| 选中文字气泡工具条（摘句/复制/搜索） | 想加功能时的首选 | 唯一“既有用户价值、又顺手带出 `el()` 迁移”的一步 |
| 全书搜索 | 章节多了以后 | 现在只有 2 章，索引成本大于收益 |
| TTS 听书 | 已决定不做 | WebView 里 `speechSynthesis` 在国产 ROM 上不稳；走原生桥要发 APK，而读者是来看字的 |

## 当前验证状态

- 本地：`node tools/e2e.mjs` 27/27；`tsc --noEmit` 零错误；pre-push 4 项通过
- CI：`verify` run #2（30s）通过 —— 静态校验 7s、端到端 26s
- 线上冒烟：5 个模块加载、`flagsLoaded: true`、位置恢复到 50%、零异常
