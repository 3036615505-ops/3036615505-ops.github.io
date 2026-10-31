# 改动日志

> **只追加，不改写；最新的在最上面。**
>
> 与 `HANDOVER.md` 的分工只有一条判断：**「明年还成立吗？」**
> 成立 → 写进 HANDOVER（规则、当前状态、埋过的坑）；只在某天成立 → 写在这里（那一天改了什么、为什么、怎么验的）。
>
> 拆开的原因：HANDOVER 原来把「规则」和「每天追加的流水」混在一起，910 行里 408 行是历史，
> 找一条规则得先滚过一堆某天的改动记录。**流水的归属是「历史」，不是「现状」。**
>
> 历史条目是原样搬过来的（内容逐字未改，只在块之间统一成一个空行）。

## 2026-10-31 · `render-chapter.mjs` 补 `CACHE` 提示（QA P2 · 无发版影响）

| 项 | 内容 |
|---|---|
| 动因 | QA 回归发现：工具全文没有任何 `CACHE` 版本提示。而 `sw.js` 的 `PRECACHE` 里就有那 7 个章节页，「正文改了但没升 `CACHE`」会让离线读者长期停在旧页面且**不会自愈** —— 2026-10-29（底部抽屉那次）就是这么漏的。工具本来就知道 `changed`，补一行是最划算的堵法 |
| 做法 | 真改了页面且真落盘时，在「注意事项」块**第一条**打印：`⚠ N 个章节页内容已变 → sw.js 的 CACHE 名要 +1（linyuan-v70 → linyuan-v71）` + 判据（「PRECACHE 里的字节变没变」）+ 为什么 `npm run stale` 看不出这一层（它只比带 `?v=` 的资源） |
| 两个刻意的边界 | ① **只在 `changed === true` 且非 `--dry-run` 时响** —— `--dry-run` 与「无变化」天天叫就没人看了 ② **不自动改 `sw.js`**：自动升会把「这次到底该不该发版」的判断一起吞掉（`new-chapter.js` / `make-characters.mjs` 自动升是另一种场景：那两次一定有新资源进 `PRECACHE`） |
| 版本号来源 | 从 `sw.js` 现读 `var CACHE = '<name>-v<n>'` 再 +1；读不到就只提示「手动看一眼当前值再 +1」，不猜数字（硬编码的 v70 迟早点骗人）。`PRECACHE` 里章节页的条数也是数出来的，不写死 |
| 验证 | 改 `chapter-07` 一个字 → 实跑打印 `linyuan-v70 → linyuan-v71`，且 `git status --short sw.js` 为空（没自动改）· `--all` 无变化 → 0 次提及 `CACHE` · `--dry-run`（有变化）→ 0 次提及 · `git restore` 复原后再 `--all` → `git status` 空 · `precache`/`manuscript`/`bump:check`/`stale` 绿 · `typecheck` 0 诊断 · `node tools/e2e.mjs` **179/179（192.7s，默认端口 8765）** |
| 顺带 | QA 遇到的 `EADDRINUSE 8765` 是我这边**并发跑的另一个 e2e 占用**造成的（我为了取证据连着跑了几次后台 e2e），不是工具问题；现在 `netstat` 里 8765 无监听，默认端口一次跑通 179/179。另外 QA 纠正了我一处措辞：`check-precache.mjs` 的模板路径指错时会**假红**（报 11 个脚本缺失，安全的那一侧），真正会「假绿」的只有路径指向不存在的文件、被 `existsSync` 守卫跳过那种情况 |

## 2026-10-31 · 补两处：`new-chapter.js` 的误用守卫 + 人物数据注释指向飞书（无发版影响）

| 项 | 内容 |
|---|---|
| 动因 | 上一批工具落地后，「误用 `new-chapter.js` 重新生成已有章节」这个口子反而更容易踩：两条命令名字相近（`new-chapter.js` / `render-chapter.mjs`），而以前只有一条路、人不会走错 |
| 守卫 | 判据 = **源稿自己写的 `# 标题`（或 `--title` 给的）已出现在 `CHAPTERS` 的 title 里** → 报错退出、给出 `node tools/render-chapter.mjs chapter-0N`，`--dry-run` 也拦（预检时最该被拦住）。两种标题都查，是因为「传了 `--title` 又拿旧章节 md 来加新章」时只有 `heading` 能暴露误用 → `parseManuscript()` 的返回值多了 `heading` 字段（纯增量，不影响任何输出） |
| 守卫的边界 | 已有章标题都带「第N章·」，重名几乎必然是想重渲染；**真要做同名新章必须先换标题** —— 这是刻意选的严格侧：宁可多敲一次，也不要再静默长出 `chapter-08.html` 并连带改 `chapters.js`/`announce.json`/`sitemap.xml`/`sw.js` |
| 新建路径未变 | 用 `git show HEAD~2:new-chapter.js` 当旧版对拍五种参数组合（纯 `--dry-run` / `--date --seal --afterglow --blurb` / `--dates` 三日两组分隔 / `--nodate` / `--title 覆盖 --year 二〇二三`）→ **全部逐字节相同**，含 `--dry-run` |
| 注释指向飞书 | `js/characters-data.js` 头注释里「原稿在站外，作者手里的《人物设定.md》」指向的文件已不存在 → 改成指向飞书文档（标题 + `document_id` + 同步命令），并明说**这份文件现在也是产物、不要手改**；例外是 `portrait` / `initial`（不在文档里，同步时按 slug 原样保留，只能在这里改）。同一句话在 `tools/make-characters.mjs` 头部与 `README.md` 也有一份，一并改 |
| 发版 | **`?v=` / `CACHE` 都不用动**：先确认过 `js/characters-data.js` **没有任何页面的 `<script>` 引用它**、也不在 `sw.js` 的 `PRECACHE` 里 → 改它不影响任何缓存键（`npm run bump:check` 与 `npm run stale` 都绿，可复核） |
| 验证 | 误用实测：`node new-chapter.js manuscript/chapter-01.md`（含 `--dry-run`）exit=1、报错原文给出正确命令、`git status` 空 · `node tools/render-chapter.mjs --all` 后 `git status` 仍空 · `sync-characters --write` 仍报「完全一致」（注释在头部，序列化原样保留）· `precache` / `manuscript` / `bump:check` / `stale` 绿 · `typecheck` 0 诊断 · `node tools/e2e.mjs` **179/179**（192.5s） |

## 2026-10-31 · 补上改稿缺的两条工具：重渲染已有章节 + 人物设定从飞书同步（`?v=` 不变 122 · `CACHE` 不变 v70）

| 项 | 内容 |
|---|---|
| 动因 | 改稿流程刚变成「飞书文档是唯一创作源 → 读回 → 落盘 → 发布」，但这条路上有两个洞：① **没有「md → 重新渲染已有章节页」的生成器**，所以上一次改第一章只能手工按段替换 html（坑第 19 条）② 人物设定还是 331 行 JS，改一句台词得钻进代码里找 |
| 新增文件 | `tools/chapter-template.cjs`（章节页唯一模板 + md→正文渲染，CommonJS）、`tools/render-chapter.mjs`、`tools/sync-characters.mjs`。**零新依赖、零构建步骤** |
| 改动文件 | `new-chapter.js`（改成共用模块的调用方，体积从 493 行降到 ~300 行：模板 122 行、md 解析、`?v=` 探测、日期插入全部搬走）、`tools/check-precache.mjs`（模板判据的路径改为 `tools/chapter-template.cjs`）、`package.json`（加 `render:chapter` / `sync:characters` 两个转发入口，**不进 verify/pre-push/CI**） |
| 模板只有一份（硬要求） | 整页模板与「一个段落怎么变 `<p>`」搬进 `tools/chapter-template.cjs`：`renderChapterPage()` 是整页，`renderArticleInner()` 是正文区，后者被前者调用。`new-chapter.js` 只调这两个函数，`render-chapter.mjs` 只调 `renderArticleInner` + 两份清单（`ASSET_SCRIPTS` / `REQUIRED_HOOKS`，写盘自检与页面体检共用同一份）。**CJS 是因为 `new-chapter.js` 是 CJS 且要 `require` 它**（ESM 能 import CJS，反过来不行），所以没有动 new-chapter.js 的模块系统 |
| `new-chapter.js` 行为未变 | 改动前先存基线，改完逐字比对：`node new-chapter.js manuscript/chapter-02.md --dry-run` 输出与改动**完全一致**。另外五种参数组合也和改动前的版本（`git show HEAD:new-chapter.js`）对拍通过：纯 dry-run / `--date --seal --afterglow --blurb` / `--dates` 三日两组分隔 / `--nodate` / `--title 覆盖 --year 二〇二三` —— 全部逐字节相同（含章内日期与「日期比切换点多 → 退回章末」那条分支） |
| `render-chapter.mjs` 的边界 | **只重写 `<article class="chapter-content">` 里的正文**（h1 + 段落 + 场景分隔 + 章内日期），页面其余字节原样保留。不重生成整页的理由有二：① 余韵卡那句属于这一章的话**只存在于页面里**（`chapters.js` 没有这个字段），模板重生成会把它换成占位文案 ② 三、四、六章是 `--nodate` 生成的，`chapters.js` 有 `date` 但页面刻意不显示日期行 —— 重算就会凭空多一行，把作者当初的决定静默推翻。所以**日期行一律沿用页面**，分隔「md 有 `---` 就按 md，否则沿用页面」（`manuscript/` 快照里不含分隔标记） |
| 段落对齐 | 旧段落 vs 新段落走 **LCS**（不是按序号硬替）：插入/删除一段时，场景分隔与日期行会**跟着原来那句话走**，不会整体错开一位。实测在第二章第 5 段后插一段：diff 是 `1 insertion(+), 0 deletion(-)`，两处分隔的位置一像素没动 |
| 段数告警（唯一会静默出错的地方） | 段数变了一律醒目告警、**不阻止**（作者可能是有意增删）。理由写进输出正文：搜索落点（`data-quote-index`）与阅读进度锚点（`reader-anchor-*`）全靠段序号，段数一变读者已存锚点全体偏移，而页面看着完全正常 |
| `sync-characters.mjs` 的 merge | 按 **slug** 从现有数据保留 `portrait`（立绘文件名）与 `initial`（占位字）——这两项不在文档里。新增人物：portrait 留空、initial = 姓名首字，并在输出里提示「有立绘后填 assets/portrait-<slug>-1024.webp」。**默认 dry-run**，`--write` 才落盘，`--write --gen` 接 `make-characters.mjs` |
| 严格校验（任一不过就拒写） | 表格 10 列列序逐列比对；slug 唯一且只含 `[a-z0-9-]`；分组只能是新叶/青枝/乔木且**同组必须连续**（报错会指出「第 X 行已经出现过」）；**表格姓名集合与小传姓名集合完全一致**（缺小传、多小传都报）；必填字段非空；性格标签 1–2、设定标签 1–3；生日 `YYYY.MM.DD` 或留空；小传不许含 HTML 标签。所有错误**收集齐再一起报**，不遇到第一个就停 |
| 发版 | `?v=` **不变（122）**、`CACHE` **不变（v70）**。判据是「`PRECACHE` 里的字节变没变」：这次没碰任何 CSS/JS/HTML，7 个章节页在 `--all` 之后 `git status` 为空，`js/characters-data.js` 对飞书文档往返一遍也逐字节未变；新增的三个文件都在 `tools/` 里，不属于站点资源 |
| 验证 | `node tools/render-chapter.mjs --all` 后 `git status` **空**（连跑两次都空）· 改一字的端到端：改 `chapter-02.md` 一个字 → `render-chapter chapter-02` → html 里那一行变了（`git diff --numstat` = `1 1`）、其余一字未动 → `npm run manuscript` 7 章一致 → `git restore` 只复原 md 再渲染一次，html 自动回到原样 · 段数告警实测打印 · `node tools/sync-characters.mjs --doc REiQd3RhZoXFGqxoZcRclL1NnWe --write` 后 `git status` 空 · 三种坏输入（slug 重复 / 分组不连续 / 有表格行没小传）各被拒绝且退出码 1 · `npm run typecheck` 0 诊断 · `npm run manuscript` 绿 · `npm run precache` 绿 · `npm run bump:check` 版本号统一 · `npm run stale` 绿 · `node tools/e2e.mjs` **179/179**（192.4s，一条断言没动） |
| 已知限制（写进 HANDOVER） | ① `render-chapter` 不改 `chapters.js` 的 `words`/`updated`（人工判断的字段）② md 里写 `---` 会让 `npm run manuscript` 变红：`manuscript-sync` 只把 `<p>/<blockquote>/<hr>` 反写成 md，**不认** `<div class="scene-break">`；解法是确认分隔后跑一次 `manuscript-sync --write --only <chapter>`（页面上的分隔不会丢）。这条告警里就写着 |

## 2026-10-31 · 第一章正文修订（6 段 · 首次以飞书文档为改稿入口）（`?v=` 不变 122 · `CACHE` linyuan-v69→v70）

| 项 | 内容 |
|---|---|
| 动因 | 作者改稿。这是第一次走「飞书文档改 → 读回 → 落盘 → 发布」，用来验证它能不能当长期的改稿入口（而不是「把文档抄一份到飞书」那种双份真相） |
| 改了什么 | 第一章 6 段：第 10、11、12、22、23、24 段。**段落数 73 → 73 未变** —— 这是关键：搜索的落点与阅读进度锚点全靠段序号，段数一变全体偏移且不报错。字数 2858 → 2860 |
| 具体修改 | ① 第 10 段拆句并补主语（「尤其如此——那亮看别人是远的」→「尤其如此。叶南衡总觉得那亮…」），「近到」→「近得」② 第 11 段台词改写 ③ 第 12 段「关白姨什么事」→「关她什么事」（作者决定保留后文「不知道应该叫她白姨还是白老师」，让称呼晚一点出现）④ 第 22 段删「不来就绝交」，「然后就笑了」→「然后无奈地叹了下气」⑤ 第 23 段补「虽然现在…还早」「大概是昨天」⑥ 第 24 段「又笑了一下」→「又叹了口气」。④⑥ 是同向改的（把轻松调子往沉里收） |
| 链路（可复用） | 飞书《临渊羡鱼 · 正文》是唯一创作源 → `lark-cli docs +fetch --doc-format markdown` 读回 → 按 `# ` 切章、按空行切段 → 与 `manuscript/*.md` 逐字节比对（**只有第一章有差异，其余 6 章逐字节一致** = 往返幂等）→ 按段落序号替换 `novel/chapter-01.html` 里的 6 段文本（替换前逐段验「旧文本唯一、新文本此前不存在」）→ `npm run manuscript` 校验 |
| ⚠ 踩到的坑（已写进 HANDOVER） | **`new-chapter.js` 不能用来重新生成已有章节**，它只加新章节：把 `manuscript/chapter-01.md` 传进去，它当成新稿，按 `CHAPTERS.length+1` 生成了 `chapter-08.html`，并连带改了 `js/chapters.js` / `announce.json` / `sitemap.xml` / `sw.js`（脚本会自己 +1 `CACHE`）。已 `git restore` 全部回滚 + 删掉 `chapter-08.html` 与 `chapter-08.md`。根因：**这个项目没有「md → 重新渲染已有章节页」的工具** |
| 另一个发现 | `manuscript-sync.mjs --write` 是 **HTML → md 反向**，会覆盖 `manuscript/`，方向与本次相反，**不能**拿它同步。它的注释还写明「源稿一直存在仓库外面，线上 HTML 是唯一载体」—— 也就是说过去的改稿流程是「改 HTML → 反写 md 快照」。飞书这套把方向正过来了：**md 是源、html 是生成物** |
| 发版 | `?v=` **不变（122）**：本次没碰任何 CSS/JS。`CACHE` **v69 → v70**：章节页在 `PRECACHE` 里，正文改了就是预缓存字节变了。这次正好是上一次（底部抽屉）的镜像 —— 那次是「只改 CSS/JS，但 `?v=` 升了 → 章节页字节变 → `CACHE` 要升」，这次是「只改 HTML → `?v=` 不用升，`CACHE` 照样要升」。判据始终是「`PRECACHE` 里的字节变没变」 |
| 验证 | `npm run manuscript` 7 章完全一致（第一章 73 段 / 2860 字）· `npm run precache` 绿 · `npm run bump:check` 版本号统一 · `npm run stale` 绿 · `npm run typecheck` 0 诊断 · `node tools/e2e.mjs` **179/179**（193.7s）。改正文没有影响任何断言：搜索断言只钉「有结果 / 首条含章名与第 N 处 / 命中高亮 / 无结果」，**没有硬编码命中处数**；段落对齐三条按段序号判，段数未变所以全绿 |

## 2026-10-29 · 五个面板从「居中弹窗」改成「底部抽屉」（`?v=` 121→122 · `CACHE` linyuan-v68→v69）

| 项 | 内容 |
|---|---|
| 动因 | 读者要的是番茄小说那种手感：从下往上滑出、按住往下一拉就关。原来的居中弹窗（`align-items:center` + `translateY(18px) scale(.98)`）在手机上离拇指远、且「关」只能去够右上角的 × |
| 范围 | 5 个面板全部改：目录 / 摘句簿 / 设置 / 搜索 / 阅读数据。它们本来就共用一套壳（`.modal-overlay / .modal-backdrop / .modal-panel`），所以改的是壳 + 每块面板里多一个把手节点 |
| 几何 | 贴住视口底边、左右占满（桌面 `max-width: 420px` 居中，与 `.reading-wrapper` 同一条中线）、**上圆角 22px 下圆角 0**，`max-height: 70vh → 82vh`；`border-bottom: none`，阴影由「下投」改成「上投」；`padding-bottom: env(safe-area-inset-bottom)` 给全面屏底部手势条让位 |
| 动效 | 进场 `translateY(100%) → translateY(0)`，`0.3s cubic-bezier(.32,.72,0,1)`，遮罩 `opacity` 淡入淡出（0.25s 原样保留）。**退场是同一条 transition 反向走**，不是另写一套 |
| 拖动把手 | 新增 `.modal-grabber`（面板第一个子元素，18px 高的一条槽，里面 36×4 圆角横条 = `--text-muted` 32% 透明度）。纯装饰，不绑事件——手势挂在整块面板上 |
| 下拉关闭 | `initSheetDrag()`：位移 > **96px** 或速度 > **0.5px/ms** → 关，否则 0.22s 回弹。拖动期间 `transition:none` 跟手、**遮罩保持不动**（只写 `panel.style.transform`，全程不碰 overlay / backdrop 的 opacity —— 规格里没有「遮罩随位移变淡」，初版这行写成「随位移变淡」，QA 实测证伪后改正）；松手滑出**走面板自己的 close 函数**（滚动锁、搜索防抖定时器、自动滚屏恢复一个都不能漏） |
| 最容易做错的一条 | **只有内容滚到顶（`scrollTop <= 0`）且手指向下拖才接管**。三道关：`atSheetTop()` / 位移向下过 6px / 竖直方向占优（横向归左右轻扫换章）。输入框与 textarea 上一律不接管（备份面板要能长按拖选）。已写成 HANDOVER 第 18 条坑 |
| 减弱动态效果 | `prefers-reduced-motion: reduce` 下**保留手势、去掉动画**：不跟手、不滑出/回弹，够阈值就直接关。理由写在 `initSheetDrag()` 的头注释里（这批读者要的是「别晃」，不是「别能用」）；CSS 侧那条全局 `transition-duration: .01ms !important` 顺手就把显隐也变成瞬时的 |
| 顺手修掉的隐患 | `.modal-overlay` 加 `overflow: hidden`：收起来时面板整体在视口下方 100%，不裁剪它会撑出页面的可滚动区域（「滚到底多一片空白」＝ HANDOVER 第 10 条「底部断层」的同类症状）。e2e 用「把面板 `display:none` 掉，页高应该一像素都不变」钉住 |
| 顺手清掉的死代码 | `.settings-modal .modal-panel { width: min(92vw,380px); border-radius:24px }` 与 `.data-modal` 的同款覆盖：改成抽屉后会露出左右两条缝，删掉让几何回归 `.modal-panel` 一处 |
| 新增代码落点 | **零个新文件**。`css/style.css` 的「弹窗通用」一段改写成「面板通用：底部抽屉」+ 文末未动；`js/reader.ui.js` 新增 `/* ===== 面板 = 底部抽屉 ===== */` 一段（`openSheet/closeSheet/initSheetDrag` + 三个常量），五个面板的 `innerHTML` 各加一行把手、开合各换成 `openSheet()/closeSheet()`。`reader.engine.js` / `reader.store.js` **一行未改** |
| 未改的逻辑 | 点遮罩关闭、`Esc` 逐层关闭（`initModalKeys`）、`anyPanelOpen()` 语义（仍看 `.visible`）、面板内容滚动、`body.overflow` 锁与释放时机 —— 语义全部不变，e2e 旧断言一条没删 |
| 发版 | `?v=` 全站 **121 → 122**（`npm run bump`，29 个文件 217 处）；`CACHE` **linyuan-v68 → v69**。⚠ 开发时先判成「不升」，理由是「面板是 JS 动态建的，HTML 走网络优先」——**这个判断是错的**：`?v=` +1 会改到 7 个 `novel/chapter-0N.html` 里的 `style.css?v=` / `*.js?v=` 引用，而那 7 页就在 `PRECACHE` 里，**预缓存的内容变了**。「HTML 网络优先」只保证在线读者；不升的话预缓存那份 HTML 仍指着 `?v=121`，那些键要等 TTL 自愈才换，**离线读者会长期停在「旧 HTML + 新 JS」且不会自愈**。`npm run precache` 绿、`npm run stale` 也绿 —— 但 `stale` 只比**带缓存键的资源**，看不出「预缓存 HTML 的字节变了」这一层，所以它不能当这道关的凭据（已写进 HANDOVER 的「两类改动」与坑第 4 条） |
| 验证 | `npm run typecheck` 0 诊断 · `npm run precache` 绿 · `npm run stale` 绿 · `node tools/e2e.mjs` **179/179**（160 → +19：「面板改底部抽屉」小节。逐面板量几何与两端 transform 10 条、滚动区不撑大 1、桌面 420px 居中 1、下拉 150px 关、下拉 40px 回弹仍在、内容滚到中间不接管、点遮罩关、Esc 关、搜索框仍能输入、收尾无残留各 1）。断言只钉几何（≤2px）与状态（`visible` / transform 矩阵 f 分量 / `body.overflow`），**不钉动画中间帧**——无头浏览器里 rAF 时机不稳 |
| 与规格的偏差 | ① 桌面端 `max-width` 恒为 420px，**没有跟着「宽屏阅读」（760px）变宽**：宽屏下抽屉比正文窄一截，视觉上仍成立（弹层本就该窄）。评审裁决「有意」，已写进 HANDOVER 的抽屉规则那段，免得下一个人当成 bug 来修。② 回弹与滑出用 0.22s（比进场的 0.3s 略快），手感上「关」比「开」干脆一点；评审裁决「接受」。 |

## 2026-10-28 · 阅读器内全章搜索（`?v=` 120→121 · `CACHE` linyuan-v67→v68）

| 项 | 内容 |
|---|---|
| 动因 | 读者只记得半句台词，却要七章从头翻。PRD 见仓库外 `_design/fulltext-search/PRD.md`；设计见同目录 `DESIGN.md` |
| 范围 | 只搜 7 章**正文段落**（人物页 / 金句 / 余韵卡 / 印章都不在内） |
| 索引形态 | **不落盘**。首次打开面板时从章节页现抽，复用 `ui.fetchChapterDoc()` —— 那 7 页本来就在 `PRECACHE` 里，离线同样取得到，因此不需要「首次拉取 / 失败降级 / 版本比对 / 就绪态」任何一条新链路。规模 405 段 / 7 章（73+61+43+74+49+60+45），构建**约 10ms**、单次全表扫描 **< 1ms**（量级比 150ms 防抖小两个数量级，因此不构成等待感）。⚠ 这两个数原写成「7.4ms / 0.016–0.048ms」，是开发机上的单次读数；QA 用同构实现独立复测得 9.2ms / 约 0.2ms·次，**换个口径就复现不出来**，所以这里只保留量级，精确值以自己实跑为准 |
| 匹配策略 | 1:1 字符折叠（全角→半角、ASCII 小写，**长度守恒**）+ `indexOf` 子串。**不用 `Intl.Segmenter`**（分词会制造「梧桐树 vs 梧桐+树」歧义，还多一层偏移换算）；不做 NFKC（它会把 `㍿ → 株式会社`，偏移当场漂掉）。空格多词 = AND、以第一个词定位；门槛 1 字 |
| 新增代码落点 | **零个新文件**。`reader.ui.js` 新增 `/* ===== 全书搜索 ===== */` 一段（面板 / 索引 / 查询 / 落点 / 高亮）；`reader.engine.js` +约 80 行（`scrollToAnchorIn` 把「取哪个块」显式化、`scrollToAnchor(anchor, lineRatio)` 把探测线比率参数化、一次性 `landing` 指令 + `commitLanding`、对外暴露 `pauseAutoScroll`）。`reader.store.js` **一行未改**（搜索不落任何持久状态；整页跳转的意图走 sessionStorage 且读完即删） |
| 工具栏 | 「摘句」之后加第 6 项「搜索」。390px 下 6 项各 **58.7px**（阈值 48px），因此**不迁移**「自动」。另补一条 `@media (max-width:340px) { .reader-menu-row { padding: 0 2px } }`：320px 档原来每项只有 **47.0px**（低于 48 的触控下限），收窄左右内边距后 **48.33px**；390px 等其他档位不动 |
| 模板同步 | 7 个 `novel/chapter-0N.html` + `new-chapter.js` 的模板段一起改；`tools/check-precache.mjs` 的 HOOKS 与 `new-chapter.js` 的 `REQUIRED_HOOKS` 都加上 `openSearch` —— 从此「哪个章节页漏了搜索按钮」是 CI 红，不是读者发现 |
| 落点 | 命中段停在视口 **上方 1/3**（比位置记忆的 15% 探测线略低，看得到上文）。三条分支收敛到一条路径：目标块已在滚动链里 → 直接落位；只有一块 → `swapTo` 换章 + engine 的 `landing` 走既有那串落位时序；链里已挂多章 → 整页跳转 + 一次性 sessionStorage 意图在新页面接上 |
| 位置记忆 | 落地后**跟着走**（`commitLanding()` 复用 `markUserScroll()` 再落盘一次），语义是「最后停在哪」，不是「搜索前停在哪」 |
| 高亮 | 一次性标记，三个时机清：触碰正文 / 滚开约两屏 / 再开面板。**不用索引偏移切 DOM**（正文可能已被「直角引号/对话高亮」整段重建过），而是在落地后的真实文本里重找第 k 次；找不到就只落位、不上高亮，安静降级 |
| 顺手修掉一个既有 bug | `swapTo()` 只替换 `.chapter-content`，没换章节块的 `data-file` → 目录从第 1 章跳第 5 章后，**滚一下 URL 与章节 id 就退回第 1 章**（正文还是第 5 章）。实测复现后补了一行 `section.setAttribute('data-file', file)`。搜索的「跨章落点」正走这条路径，不修则落点永远失效 |
| 远程开关 | 新增 `search`（`reader.flags.js` 的 `DEFAULTS` + `flags.json` + `applyFeatureVisibility()`）。显隐那 4 行**写在 `if (!ov) return;` 之前** —— 那行早退会在设置面板还没建过时提前退出，写在后面等于开关对搜索入口永久无效 |
| 文档 | `HANDOVER.md` 更新受影响的行（`?v=` / `CACHE` / 模块行数 / 端到端条数 / 远程开关表 / 「还没做的」里的全书搜索一行），并补两条坑（`data-file` 必须跟着换 / 两套段落编号别混） |
| 发版 | `?v=` 全站 **120 → 121**（`npm run bump`）；`CACHE` **linyuan-v67 → v68**。⚠ `CACHE` 这一条与「本次没新增文件」无关也**必须升**：改的 7 个章节页就在 `PRECACHE` 里，预缓存**内容**变了。不升的话老用户 SW 不重新 install，**离线读者拿到的章节页里根本没有搜索按钮**，而 `reader.ui.js` 已经是新版 —— 在线一切正常，只有断网才暴露且无报错 |
| 验证 | `npm run typecheck` 0 诊断 · `npm run precache` 绿（7 个章节页 + 模板带齐 7 个挂点）· `npm run manuscript` 无差异 · `node tools/e2e.mjs` **160/160**（新增 33 条：入口/布局 5 · 面板与输入 10 · 索引↔页面段落一致性 3 · 跳转落地与高亮 9 · 离线与降级 6）。其中三条专防「段落序号错位」：段数逐章相等、每章首中末段前 20 字逐段对齐、`data-quote-index === 0 基序号 + 1` 现算。断言口径：**只钉状态与结构，不钉读者可见文案**（等待态/离线/折叠行都按「有没有那个节点、几个」来判，改字不会红）；宽度断言只写阈值 48 并量 390 / 320 两档（320 能过 48 本身就是那条媒体查询还在的证据）；门槛用 48 不用 56 |
| 未做（有意） | 拼音/纠错、搜索历史、相关度排序、人物页与金句纳入范围、`Intl.Segmenter`、预构建索引文件、选中文字气泡里的「搜索」入口。触发条件写在 `HANDOVER` 的「还没做的」里 |
| 与 PRD 的偏差 | PRD 2.5 的「索引是旧版本 → 离线提示」**不实现**：索引与正文同源（就是读者手上那份 HTML），「过旧」这个判据永远为假。另补一个 PRD 未覆盖的第三态：离线且索引从没建过 → `离线 · 全书正文还没准备好，联网后会自动补齐`（自动重试一次）。三句读者可见文案（等待态 / 离线未就绪 / 在线取页失败）作者已定稿，一律说「正文」不说「索引」；**它们没有被钉进 e2e 断言** —— 断言只钉状态（有无提示节点、结果区是否为空），文案怎么改都不会红。⚠ 建议 PM 在 PRD 2.5 补一行修订说明，否则下一个人会以为是漏做 |

## 2026-10-28 · 文档整理：HANDOVER 拆成「现状/规则」+「改动流水」

| 项 | 内容 |
|---|---|
| 动因 | `HANDOVER.md` 910 行里 408 行是按日期追加的历史，找一条规则要先滚过一堆某天的改动记录；同一件事还被 README / PROJECT-OVERVIEW / 审计报告各写了一份，期间已实测漂移 3 次 |
| 做法 | 拆出本文件（只收按日期的小节）；`HANDOVER.md` 只留规则与当前状态。判断标准只有一条：**「明年还成立吗？」** |
| 历史完整性 | 9 个日期小节原样搬过来，逐块校验「在原文里能顺序找到、块间只有空白」，内容零改动；只把块之间统一成一个空行 |
| 顺手去重 | `PROJECT-OVERVIEW` 的「内容规模」「当前待办」改成指针（前者实测还停在 2026-10-25 的章节字数与字体体积）；那 4 条待办并入 `HANDOVER` 的「还没做的」，不再各存一份 |
| 归档 | `docs/REPO-AUDIT.md` → `docs/archive/2026-10-28-repo-audit.md`，顶部加「停在当天、不要当现状读」 |
| 影响面 | 纯文档 + `jsconfig.json` 一处注释里的路径。**未动 `?v=`(120) / `CACHE`(linyuan-v67)，不需要升版** |

## 2026-10-28 · 守卫补盲区：`bump-assets --stale`（提交 `0b4979c`）

| 项 | 内容 |
|---|---|
| 问题 | `--check` 只查「HTML 里的 `?v=` 是否统一」，**完全不比对文件内容**。改了 `style.css` 忘了 +1 → 全站版本号依然统一 → 8 条守卫没一条会红 → 老读者拿旧 CSS 配新 HTML |
| 做法 | 新增 `--stale`：基准取 git 远端提交（`--since` / `@{upstream}` / `origin/main`），**不造 sha256 清单**（那会立刻多一个需要保鲜的第二数据源）。比 HTML 的 `?v=` 与 CSS 里的 `?f=`；CSS 先剥注释 + 空白归一 + 行尾归一再比，JS 不剥注释（改 JS 一律要求升版）；字体/图片按原字节 |
| 接入 | `.githooks/pre-push` 第 2/6 项（真闸门）+ `verify.yml` 第 ② 步（事后闹钟，只兜「钩子没装 / `--no-verify`」的推送，为此 checkout 加 `fetch-depth: 0`） |
| 逃生门 | `ASSET_STALE_OK=1` 显式放行，并要求提交信息写清为什么不用升版 |
| 踩到的坑 | 首版拿真实历史一跑就误报 `js/theme.js` —— 它工作区至今是 CRLF（`.gitattributes` 只管新 checkout），不归一行尾会天天假红 |
| 验证 | 五场景实跑：干净 ✓ / 注释级 CSS 改动（真实历史）✓ / 真样式不升版 → 退出码 1 且只有第 2 项红 / 升到 121 ✓ / `ASSET_STALE_OK` ✓。CI 里 `--since 9a0a666` 真实执行（16 个资源参与比对，非静默跳过）。e2e 127/127 |

已知残留：`--stale` 只在「被缓存键引用的资源」上生效。改 `sw.js` 自身内容不升 `CACHE`
这类问题它管不了（那是另一条规则，见上文第 4 条与 `CACHE` 豁免说明）。

| 场景 | 期望 | 实测 |
|---|---|---|
| 干净工作区 | 通过 | ✓ |
| `style.css` 只加 57 行注释（真实历史，`--since origin/main~6`） | 通过 | ✓ |
| 加一行真实样式、不升版 | 退出码 1 | ✓ 且 pre-push 六项里只有第 2 项红 |
| 同一改动 + 升到 121 | 通过 | ✓ |
| 上面那条 + `ASSET_STALE_OK=1` | 通过并提示已放行 | ✓ |

验证过的五种场景（都实跑过，不是推演）：

- **基准取 git 里的远端提交**（`--since` → `@{upstream}` → `origin/main` 依次尝试），
  **不另造 sha256 清单** —— 那会立刻多一个需要保鲜的数据源，正是流程坑第 4 条要防的。
- 比的是「工作区 vs 基准提交」，所以**提交前就能查出来**；pre-push 时工作区=HEAD，同样成立。
- 只认带缓存键的引用：HTML 的 `?v=`、CSS 里的 `?f=`（字体）。没缓存键的资源（`sw.js` 自更新、
  `og-cover.jpg`）本来就不受这机制管辖。
- **CSS 先剥注释 + 空白归一 + 行尾归一再比**：只改注释不该被拦。
  行尾归一这条是实测逼出来的 —— `js/theme.js` 工作区至今是 CRLF（`.gitattributes` 只管新 checkout），
  不归一会天天假红。
- **JS 不剥注释**：改 JS 一律要求升版，宁可多一次 bump 也不要漏一次真实改动。
- 字体/图片按原字节比。
- 找不到基准 ref 时**打印一行说明并退出 0**，绝不因为「git 不认识基准」把 CI 或 push 弄红。
- 逃生门：`ASSET_STALE_OK=1 node tools/bump-assets.mjs --stale` 显式放行，
  并要求在提交信息里写清为什么不需要升版。
- CI 那步需要 `fetch-depth: 0`（浅克隆里 `github.event.before` 不存在，检查会静默跳过）。

设计要点（改这个脚本前先读）：

| 位置 | 作用 |
|---|---|
| `.githooks/pre-push` 第 **2/6** 项 | 真正的闸门：发版前拦住 |
| `verify.yml` static-checks 第 **②** 步 | **事后闹钟**：跑到这里时东西已经上线了，只兜「钩子没装 / 用了 `--no-verify`」的推送 |

现在 `node tools/bump-assets.mjs --stale`（`npm run stale`）补上这一步，接在两个地方：

`tools/bump-assets.mjs --check` 只看「扫所有 `.html`，是否存在**多个不同**的 `?v=`」，
**完全不比对文件内容**。于是原来有一个真空：往 `css/style.css` 混进一行真实改动却不 bump，
全站版本号依然统一 → 8 条守卫没有一条会红 → 发版 → **老读者拿旧 CSS 配新 HTML**。
症状只在别人的手机上出现。上一次安全纯属 QA 用「去注释字节级比对」把改动性质单独排除了。

### 九、`--check` 只查「版本混用」不查内容 —— 已用 `--stale` 补上（2026-10-28）

1. **提交权 ≠ 验证窗口**（主理人认领，工程师亲历）：本次有两笔提交落在 QA 独立回归期间，根因是「提交权在工程师手上，而窗口存在只告诉了架构师」。解法是结构性的：**把「窗口期不 commit」写进回归任务的定义，不要靠广播**——广播依赖在场，任务定义接手即见。
2. **并列证据必须各自可单独复现**（架构师提，工程师认领）：我曾把 `origin/main` 的 tip 当成「改过某个文件的提交」，与真证据并列写成两条（真证据是 `26106d2`）。**并列的每一条都要能用 `git log -- <path>` 单独跑出来，否则就删掉多余的**——一条真证据胜于两条看着像的。
3. **文档里只留实测值**（工程师提）：预测量要么删掉，要么紧跟实测值并写明差额来源。本次审计报告同时留着「约 5,377 KB」与实测 5,451 KB（差额是同期新增的 3 个文件），不解释就一定会被后来的人当成结果来质问「删了 729KB 怎么只少 655KB」。
4. **状态只留一个出处**（架构师提）：需要提及时用指针指向它，不要平行描述。本次同一件事在一处写「建议 mv 到 `_source-assets/`」、另一处写「已闭环」，两处必有一处过期。

### 八、本轮踩到的 4 个流程坑（都不带指责，只写下次怎么防）

- `npm run verify` 四项全绿；`npm run verify:all`（含楷体 3906 字覆盖）全绿
- `npm run typecheck` → **0 诊断**
- `npm run e2e` → **127/127，154.8s**
- `node tools/check-precache.mjs` → **77 条 / 1,451.8 KB**（比审计基线的 1,448.1 多 3.7 KB ——
  就是 `style.css` 顶部那 57 行分区目录注释；它进了线上 CSS 本体，gzip 后约 1 KB，换来翻文件不用瞎搜），
  `character-shenruoqi` 两项都在列
- `grep -n ",," sw.js` → **0 命中**
- `git ls-files --eol tools/make-kai-subset.py` → **`i/lf w/lf`**（重新检出一次后落盘为 LF）

### 七、验证

- `jsconfig.json` 的 `include` 从 5 条补到 **15 条**（`js/` 下 14 个 `.js` + `types.d.ts`）。
  补进去的是 **10 个**：`reader.dom.js`、`reader.flags.js`、`announce.js`、`lightbox.js`、
  `nav-feedback.js`、`native-bridge.js`、`chapters.js`、`transition.js`、`theme.js`、`characters-data.js`。
  注意 `reader.dom` / `reader.flags` 最容易被漏——它们不在「业务模块」清单里，却正是
  `LY.dom.*` / `LY.flags.*` 的类型来源（审计初版就漏了这两个，已记在审计 §0.1）。
  `checkJs` 仍是 **false**（开它是 46 个既有错误，等于一轮重构，见审计 §5），所以补 include
  **不引入任何错误**，只是让编辑器里这 10 个文件也能看见 `LY.*` 的共享类型。
- `css/style.css` 顶部加**分区目录注释**（带行号）。`style.css` 4,839 行不拆：拆的改动面是
  29 个页面 + 2 个生成器模板 + PRECACHE，而收益只是单人翻文件方便，且**没有构建步骤**能把它合回去。
- **不做**：ESLint / Prettier、拆 CSS、合并 JS、重写 git 历史、`checkJs: true`。理由见审计 §5。

### 六、结构优化落地（T04 只做了两项零风险的）

| 文件 | 改动 |
|---|---|
| `HANDOVER.md` | `?v=112`→**120**（两处：现状表、版本号现状）；`linyuan-v63`→**v67**；`4450 行`→**4839**；楷体 `852KB`→**891.5KB**（主片 273.1 + 兜底片 618.4）；`92 项 / 约 95 秒`→**127 项 / 约 155 秒**；`69 项`→**127 项**；`114 项断言`→**127 项**；阅读器 `ui 2719 / 2552 行`→**2726**；`17 张立绘 / × 17`→**18**；「新叶 / 乔木」→**「新叶 / 青枝 / 乔木」**；删掉悬空的 `app/WEBVIEW-ROADMAP.md`（文件不存在）；**「transition.js 有 30+ 个生成页引用」→ 实测 9 个页面**（并写明保留理由改为「重启过渡时的结论载体」，删文件的真实改动面也写全了） |
| `README.md` | 「扫描 **6** 个 HTML」→**29**；「**22** 项断言，约 40 秒」→**127 项，约 155 秒**；CI「**27** 项」→**127 项**；「× **17**」→**× 18**；「新叶 / 乔木」→**「新叶 / 青枝 / 乔木」**；pre-push 表补第 5 行（`check-apk.mjs`）；CI 静态校验补 ⑤ 安装包校验；`npx -p typescript`→`npx -y -p typescript`（首次运行会交互式询问，CI/非交互 shell 会卡住）；「改 workflow 需要 token，**当前 PAT 没有**」→ 该说法已过期（2026-10-25 已换带 `repo, workflow` 的 PAT）；文件树补 `package.json` / `.editorconfig` |
| `PROJECT-OVERVIEW.md` | `?v=70`→**120**、`linyuan-v59`→**v67**；离线预缓存 `74 条 / 1,347KB`→**77 条 / 1,451.8KB**（两处）；「**28** 个静态页面」→**29** |
| `.github/workflows/verify.yml` | 头部注释「⑥ 阅读器 **61** 项」→「**⑤ 阅读器 127 项**」（编号 ④ 跳 ⑥ 的断裂一并修好）。**逻辑一行未动** |

### 五、文档纠偏（只改数字与步骤名，没碰任何 workflow 逻辑）

1. **新增或删除**任何 PRECACHE 条目（哪怕只改一条 URL）→ 老 cache 里没有那一条，不换名就永远缺失；
2. 文件**内容**变了但 URL 没变 → 那是 `?v=` 的事，不是 `CACHE`；
3. 需要**整体作废旧离线包**（例如确认某条被缓存的响应是坏的，宁可先失去旧副本、也不愿它被当兜底）→ 只有换名能让 `activate` 把旧缓存删掉。

**这条豁免什么时候不成立**（别顺手滥用）：

一句话：**`CACHE` 名管的是「预缓存清单的变化」和「要不要把旧离线包整体作废」，不是流量**——
换名省不下流量，只会把「补齐」变成「重来」。（这段也是本轮第 3 次「结论对、依据错」，
见文末「4 个流程坑」第 2、3 条。）

- **同名**：这次没装上的那几条，读者手上仍有上一版的旧副本 → 离线包**保持完整**；
- **改名**：新缓存只有装上的那部分，紧接着 `activate` 把旧缓存整个删掉
  （`keys.filter(k => k !== CACHE)`）→ 读者手上只剩一个**残缺的离线包**。

*真正的依据是**离线韧性**，机制是「并集 vs 从零开始」*：同名 `caches.open(CACHE)` 里的 add
是**并集**，新条目补进去、旧的完整条目还在；改名则从**空缓存**开始。再叠加 install 用
`Promise.allSettled`（单条失败只 warn，install 仍算成功）：

*旧依据为什么错*：原来写「不换名能让读者省下 1.4 MB 重下」——**不成立**。install 是逐条
`c.add(precacheRequest(url))`，而 **`Cache.add()` 每次都 fetch + put，不检查条目是否已存在**
（HTML 那条还强制 `cache: 'reload'`）。所以换不换名，install 都要把 77 条走一遍
（除非 HTTP 缓存命中）——**流量成本相同，省流量不是理由**。

**不升 `CACHE`（`linyuan-v67` 保持）**：⚠ **这一段的「理由」在本轮被推翻过一次，结论没变、依据全换了。**

**不升 `?v=`（120 保持）**：本次改到的文件里，只有 `css/style.css` 被页面以 `?v=120` 引用，
而它只**加了一段注释**（分区目录），字节变了、渲染结果零变化；其余（`package.json`、
`.editorconfig`、`.gitignore`、`.gitattributes`、`robots.txt`、`sw.js`、`jsconfig.json`、各个 `.md`）
没有任何页面引用。删掉的 11 个 JPG 是零引用文件。
判断依据是**「字节变化是否改变渲染/行为」**，不是「文件是否被引用」——
所以「加了注释的 CSS」不 bump 是对的，「改了规则的 CSS」不 bump 就是错的。

### 四、版本号：本次**不升** `?v=`、**不升** `CACHE`（含豁免边界）

各多一个逗号 → 数组里各多一个**空洞**（hole）。当时没炸是两层机制叠加的结果，但**归因很容易写错**
（本轮就写错过一次，QA 抓出、已按实测改正）：`PRECACHE.map(...)` 遇到空洞会**跳过**它——
实测回调只被调用 **77 次**，而 `length` 是 **79**，返回值里那两格**仍然是空洞**。所以
`undefined` 从来不是 `map` 的产物；是 `Promise.allSettled` 用迭代器 / `Get` 取到空洞的值 →
`undefined` → 当非 thenable 处理，直接记成 `fulfilled`（值 `undefined`）。
修掉逗号后空洞消失，77 次回调覆盖全部 77 条。
更糟的是 `tools/check-precache.mjs` 用正则提取字符串、报「77 条」，**所以守卫看不见它** ——
典型的「守卫与被守卫对象同时失灵」。现在 `grep -n ",," sw.js` 零命中。

```
'/assets/portrait-shenruoqi-thumb.webp',,   ← 第 130 行
'/novel/character-shenruoqi.html',,         ← 第 131 行
```

### 三、`sw.js` 的两处双逗号（真实缺陷）

`.git` 的 19 MB 不会因此变小（blob 还在历史里）；想真瘦身只能 `filter-repo` + `--force`，
那是本仓库明确不做的事。**这次省的只是工作区体积（−11.9%）与「以为它还在用」的歧义。**

`assets/og-cover.jpg`（41.2 KB）**不在清理范围**：它是 `og:image` 的唯一来源，仍被 30 处引用。

`cover.jpg`、`paper.jpg`、`portrait-{linshu,jiangbuqiu,nanheng}.jpg`、`tree-{bare,s1,s2,s3,s4,s5}.jpg`
全部被同名 `.webp` 取代、**全仓零引用**（含 `sw.js` PRECACHE、两个生成器模板、`tools/` 全部脚本）。
**没有 `rm`，而是 `mv` 到仓库外的 `E:/novel-site/_source-assets/assets/`**（本地留一份母版，
已在 `.gitignore` 的 `_source-assets/` 里）。git 记为 deleted，提交即从仓库移除；
要取回老版本：`git show <commit>:assets/cover.jpg > cover.jpg`（前提是**永不重写历史**）。

### 二、死重清理：11 个 JPG（729.1 KB）

`package.json` 会被 GitHub Pages 当静态文件公开（`/package.json` 可读）——里面没有任何秘密，无害。

| 文件 | 作用 |
|---|---|
| `package.json` | **零依赖**（没有 `dependencies` / `devDependencies` 字段）、`private: true`、`engines.node >=22`。只有 `scripts`，全部是转发，不含逻辑。`npm run verify` = 四项静态校验，`npm run verify:all` = 五项（+ 楷体），`npm run e2e` = 端到端 |
| `.editorconfig` | 缩进 / 换行 / 末尾换行约定。与 `.gitattributes` 分工：一个管「敲键盘时」，一个管「进仓库时」 |
| `.gitignore` | 全文替换：补 Windows 噪声（`Thumbs.db`）、`node_modules/`（手滑兜底）、`package-lock.json`、`_source-assets/` `_perf/` `_backup/`（仓库外的工作目录）、`.vscode/` |
| `.gitattributes` | 追加 `*.py text eol=lf`（`tools/make-kai-subset.py` 第 1 行是 shebang，CRLF 会让 `python3\r` 当解释器名）与 `*.md text eol=lf` |
| `robots.txt` | 追加 `Disallow: /manuscript/`：源稿与正文 HTML 同内容，只拦索引，不影响任何脚本（也不能阻止直接访问） |

### 一、新增的入口与声明（零运行时影响）

完整依据与逐条证据见 `docs/archive/2026-10-28-repo-audit.md`（只读审计，本次唯一新增的文档）。这里只记**改了什么、
为什么、以及两处版本号豁免的边界**。

## 2026-10-28 · 仓库工程化整理（入口 / 死重 / 守卫缺陷 / 文档纠偏）

实测：在新叶中部点顶栏「乔木」→ `scrollY > 500`，乔木标题顶 72、顶栏底 61（不被遮），
顶栏高亮切到乔木；再点「新叶」回到第一组。e2e 4 条断言，总数 **126**。`CACHE v65 → v66`。

- 顶栏标题**左靠齐**（`.detail-header.has-tabs .detail-header-title { text-align:left }`，
  只影响有这个修饰类的同学录页，其它详细页仍居中）
- 顶栏：`<nav class="char-tabs">` 三个 `<a class="char-tab" href="#group-<key>">`，纯文字 12px，
  当前组金色 + 下划线（`--text-muted` 5.45:1 / `--accent-text` 5.88:1，都在 4.5 以上）
- 分组标题：`<a class="char-group-label" id="group-<key>" href="#group-<key>">`
- 内联 `GROUP_NAV_SNIPPET`（ES5，~25 行）：两处入口共用一套点击逻辑（平滑滚动，
  `prefers-reduced-motion` 时瞬时）；滚动时用 rAF 节流同步顶栏高亮
- 高亮判定线必须**和落位点一致**：标题 `scroll-margin-top: 72px`，判定线取
  `顶栏底(61) + 20`；若写成「顶栏底 + 4」，刚落位的标题会被判成还没到，高亮慢一组（踩过）
- **不要**写 `html { scroll-behavior: smooth }`：会把阅读器位置恢复、列表滚动恢复都变成动画

实现（都在 `tools/make-characters.mjs`，**别手改 `novel/characters.html`**）：

| 版本 | 做法 | 为什么不接受 |
|---|---|---|
| v1 | 吸顶按钮条（白底药丸 + 人数角标） | 白条在奶油底上突兀、数字多余、吸顶会压住卡片 |
| v2 | 只把分组标题变成锚点 | **标题只在各组开头**，人在组内就换不了组 |
| **v3（定稿）** | 入口放进**页面原有的 sticky 顶栏**右侧 + 标题仍可点 | 一直在屏幕上、不新增任何横条/底色/数字 |

作者两次否掉方案，记清楚，别再走回头路：

## 2026-10-28 · 同学录分类入口（两轮返工后的定稿）

验证：本地限速 300ms 复现，第二个人打开瞬间 `src` 就是 `portrait-nanheng-thumb.webp`，
1.6s 后变 `portrait-nanheng-1024.webp`（`naturalWidth=1024`）；
e2e 新增 3 条断言（119 → **122**）。

修法（LQIP 思路，不引入新资源）：
1. 打开时先摆**卡片上那张缩略图**（同一个人的图、同比例、页面里早就解码好了），
   没有缩略图（例如详细页触发器本身就是母版）就摆透明 1×1 —— 无论哪条路，
   **屏幕上绝不会出现上一个人**
2. `new Image()` 预加载 + `decode()` 解码母版，完成后原地换 `src`；此时位图已在内存，
   切换无接缝
3. `swapToken` 令牌：解码比读者手快时，上一轮的结果不能顶掉下一轮；
   `close()` 里 `swapToken++` 作废在途请求
4. 母版挂了（onerror）就停在缩略图上 —— 模糊但人是对的，比空白强

根因：`js/lightbox.js` 的 `open()` 是「先 `image.src = 新图`，再把遮罩设成 visible」。
`<img>` 在**新图解码完成之前仍显示上一张已解码的位图** —— 所以那一小段时间屏幕上
就是上一个人的脸。母版 1024 约 150KB，手机上解码要百毫秒级，肉眼完全看得出来。

现象：先点人物 A，关掉，再点人物 B，会**先出现 A 的立绘**，过一会儿才变成 B。

## 2026-10-28 · 立绘灯箱「换人先闪上一个人」

**顺带量了一遍**（headless + CPU 4× 降速）：滚动长任务 0 个、帧间隔中位 17ms、p95 19ms，
说明**页面本身不卡**，之前的「卡」主要来自上面两个自造抖动。真要再压成本可以上
`content-visibility: auto`（18 张卡片量级收益很小，且会干扰滚动恢复，暂不做）。

**修法**：
1. `nav-feedback.js` 改成手势判定：按下只记账，`pointermove` 位移 > 10px 或 `pointercancel`
   → 判定为滑动，**永不点亮**并立即收线；「短按（<700ms）且位移 ≤10px」在 `pointerup` 时才亮
   （click 紧接着发生，导航前照样亮得出来）。老 WebView 无 PointerEvent 时退回 touch 事件。
2. 扫动动画只在 `.is-on` 时跑 —— 常驻 `infinite` 动画即使 `opacity: 0` 也在每帧消耗合成器。
3. 滚动恢复加 `abort`：一有 `touchstart / wheel / keydown / pointerdown` 就放弃后续重试。
4. e2e 补一条「滑动（按下→位移→cancel）不会误亮细线」，把这个 bug 钉死（119 项）。

| 真因 | 机制 | 表现 |
|---|---|---|
| 导航细线误触发 | `nav-feedback.js` 原来在 **pointerdown** 就点亮；手指按着卡片往上一划（只想滚动）也会亮，而滑动产生的是 **pointercancel**，老代码不收 | 「划一下顶部跳一下」，一直闪 |
| 滚动恢复抢滚动 | 列表页从详情页返回时用「150ms × 6 次」重试恢复 `scrollY`，读者中途自己滑动会被**反复拽回原位** | 「往下滑又被刷回去」 |

作者反馈：人物页很卡，顶部刷新条一直在跳，往下滑就会刷。**不是预加载机制** —— 这个页面
没有预加载（立绘 `loading="lazy" decoding="async"`，`lightbox` 点开才取 1024 母版）。真因两个，
都是「我们自己加的交互」，不是渲染成本：

## 2026-10-27 · 人物列表页「划一下就刷」的两个真因

- `js/characters-data.js`：四人 `group` 由 `qiaomu` 改 `qingzhi`，并把条目整体搬到新叶之后、乔木之前
  （**列表页的显示顺序就是数组顺序，同一 group 必须连在一起**，否则会重复打印分组标题）
- `tools/make-characters.mjs`：`GROUP_NAMES` 加 `qingzhi: '青枝'` —— 这个映射是白名单，
  漏了会渲染出 `undefined` 当标题
- 结果：新叶 7 / **青枝 4** / 乔木 7，共 18 人；分组标题样式沿用 `.char-group-label`，无需改 CSS
- 数据文件头部的 group 字段说明同步更新（写清三个取值 + 「同组要连着写」这条约束）

作者要求：在「新叶」和「乔木」之间插一组「青枝」，把**桃夭夭 → 肖灼 → 沈若栖 → 叶羽澜**按这个顺序放进去。

## 2026-10-27 · 人物分类加「青枝」

**注意**：AI 立绘是「风格贴合」，不是作者的手绘母版。作者日后想换成自己的画，直接替换同名 webp 再跑生成器即可，
其它地方一个字都不用改。

流程照旧：母版丢进 `assets/` → 数据里补 `portrait` → `node tools/make-characters.mjs`
（自动生成 128×150 缩略图、登记 PRECACHE、`CACHE v61 → v62`、刷新 sitemap）。

做法：
- 先把 `portrait-yeyulan` / `portrait-linxihe` 两张当风格样本描述出来：钢笔淡彩水彩、米白奶油+琥珀金的暖秋配色、
  逆光散景、胸像构图、柔和边缘+纸张纹理 → 作为 prompt 的风格段
- 内容按人小传：低髻碎发、洗旧的靛蓝亚麻围裙（下摆一块咖啡渍）、米色针织毛衣、眼角浅笑纹、松弛温柔
- 用户追加要求「要有梧桐树和咖啡店的暖意元素」→ 背景给到：窗外的金黄色梧桐枝叶与斑驳树影、灯串、
  咖啡机与杯子、窗边绿植、秋日午后逆光
- 生成 1024×1024 → **裁掉底部 64px**（站点母版是 1024×960，同时正好切掉工具自带的
  「AI生成 WorkBuddy」水印；水印固定在右下角，裁完无残留，已逐行核验）→ WebP quality 80 = 163.5KB
  （既有母版区间 80~185KB）

现有 17 张是作者给的定稿母版；她这一张没有，用 AI 生成补齐，要求是**风格必须与既有立绘一致**。

### 沈若栖立绘（AI 生成，2026-10-27）

- 只改了 `js/characters-data.js`（唯一数据源），然后 `node tools/make-characters.mjs` 重新生成 ——
  列表页 18 人、详细页 `novel/character-shenruoqi.html`、sitemap 29 条、PRECACHE 登记、`CACHE v60 → v61`
- `slug: 'shenruoqi'`，`group: 'qiaomu'`（26 岁咖啡店主，属长辈/成人组），数组里紧挨在 `yeyulan` 前面
- 立绘先用 `initial: '沈'` 占位上线；当天补了 AI 生成立绘（见下一节）后改为 `portrait: 'portrait-shenruoqi-1024.webp'`
- 人设取小传原文：上海广告公司三年 → 四十八楼落地窗前那句「我又游向哪里呢？」→ 回南城开「临渊羡鱼」

作者给了人物小传（`沈若栖.md`），要求放在**叶羽澜前面**。

## 2026-10-27 · 新增人物：沈若栖

**没做**（有明确代价，先不碰）：导航改「缓存优先 + 后台校验」能省掉那 524ms，
但会把之前修过的「返回首页看到旧版」放回来 —— 要动得连更新提示一起重新设计。

**配套**：`sw.js` PRECACHE 加 `/js/nav-feedback.js`、`CACHE v59 → v60`；`?v= 111 → 112`；
`new-chapter.js` 模板同步（否则下次生成的章节页又退回同步 announce）；
e2e 加 2 条断言钉住「按下即亮线 / 不拦点击」，**114 → 116**。

1. `.date-item:active` —— 首页章节卡片原来**完全没有按下态**（`.chapter-item`、`.book-item` 都有，
   唯独首页这个列表漏了）。按下立刻 `rgba(184,134,78,.08)` + `scale(.994)`。
2. `js/nav-feedback.js`（新增）—— `pointerdown` 那一帧就在顶部点亮 2px 细线：
   · 不 preventDefault、不 delay，导航时序一个字不变（e2e 的「<50ms 开始导航」仍然绿）
   · `pointer-events: none`，不遮内容、不拦点击
   · 延迟 60ms 淡入：缓存命中的 ~100ms 跳转根本看不到它，不会闪
   · 没跳成（离线/被拦）6 秒自收；`prefers-reduced-motion` 下只留静态线
3. `announce.js` 全站改 `defer` —— 它在 `<head>` 里同步加载，白占一个网络往返
   （只读 DOM/localStorage、往 body 补横幅，不参与首绘）。`native-bridge.js` 保持同步：
   它必须早于正文末尾的 `reader.*` 模块。

**三处改动**：

| 指标 | 数值 | 含义 |
|---|---|---|
| TTFB | **524ms** | 导航 HTML 走 networkFirst + `cache:'reload'`，每次都要真网络 |
| 首绘 FCP | **884ms** | 这 0.9 秒里屏幕上**没有任何变化**，所以「像卡住」 |
| 命中缓存那次 | ~100ms | 快的跳转反而不能加遮罩，会闪 |

**现象**：用户反馈「删掉加载动画后，点击之后页面不动了，像卡住了」。
**实测**（4G 节流 150ms RTT / 1.6Mbps，390×844，首页点 `.date-item` → chapter-01）：

## 2026-10-27 · 过渡停用后暴露的「空窗期」（点击像卡住）

第一次推被 GitHub 拒绝：`refusing to allow a Personal Access Token to create or update workflow`，
原因是旧 PAT 只有 `repo` 没 `workflow`。换成带 `repo, workflow` 的 PAT 后正常推上（2026-10-27）。
真正生效的是：e2e job 15min / e2e 步骤 10min / 静态校验 5min，步骤名也去掉了过期的「38 项」。
注意：**改 workflow 文件必须用带 `workflow` scope 的凭据**，否则整笔 push 会被拒，不只是这一个文件。

### verify.yml 的 timeout-minutes（已推）

也就是说：**焦点模拟没能解决这条无头 Chrome 的输入通道问题**，兜底那一层在顶着。
真要根治得换驱动方式（Playwright / puppeteer 的输入封装），那是另一件事，先记着。

```
↷ 触摸派发无响应，改用坐标命中的脚本点击：CDP Input.dispatchTouchEvent 超过 8000ms 无响应（卡在「末章收束卡」）
· 脚本点击命中：button.reader-tap-zone
```

CI 上那一次触摸仍然无响应（`Input.dispatchTouchEvent` 超 8s），日志里能看到降级那行：

| 指标 | 改前 | 改后 |
|---|---|---|
| e2e 在 CI 的结局 | 挂到 6 小时被 cancel（历史 4 次全是 361min） | **success** |
| 整个 verify 用时 | 361min（等于没结果） | **3.2min** |
| 断言 | 从未在 CI 跑完过 | **114/114，156.1s** |

### 结果（CI 首次跑绿）

两条路都本机验证过：touch **114/114 / 147.8s**，mouse **114/114 / 147.6s**。

鼠标那条路同样是「按坐标命中真实元素」，覆盖层照样挡得住，断言要验的东西没变。
`E2E_CLICK_MODE=mouse node tools/e2e.mjs` 可强制走降级路径自测。

1. 先发一次 `touchCancel` 冲掉上一次没被 ack 的触摸序列（3s，失败不报错）
2. 正常 `touchStart` / `touchEnd`（各 8s 超时）
3. 还是没响应 → 退回 `mousePressed` / `mouseReleased`，并在日志里打 `↷ 触摸事件无响应，退回鼠标点击`

加了超时之后第一轮 CI 就抓到了：**`Input.dispatchTouchEvent` 在「末章收束卡」那一节永远不回包**。
以前没有超时 → 一直等 → 6 小时被 cancel。现在 `clickAt()` 的处理顺序是：

### 挂死的真凶（首轮定位结果）

另外：WebSocket 连不上原来也是无限等（`ws.onopen` 没有超时），现在是 15s 报错；
每个 `section()` 会打当前耗时（`+128.1s`），CI 上哪一节慢一眼能看出来。
本机基准：**114/114，147.7s**。

| 层 | 机制 | 值 |
|---|---|---|
| CDP 命令 | `send()` 每条命令一个计时器，超时抛 `CDP <method> 超过 Nms 无响应（卡在「<小节>」）` | 20s |
| 整体 | 看门狗，超时打「卡在哪一节 + 已跑断言数 + 浏览器日志尾部」再按失败退出 | 7min |
| job | workflow `timeout-minutes`（e2e 15 / 步骤 10 / 静态 5） | 15min |

之前 CI 的 e2e 会挂到 GitHub 6 小时上限才被 cancel，日志里只有一句 job cancelled。
现在：

### e2e 三层超时

另外 `http.schannelCheckRevoke=false` 已经写进仓库配置，以后不用每次带 `-c`。

```bash
git config --local --unset-all credential.helper
```

**这里踩到一个坑**：`.git/config` 里原本有一条空的 `credential.helper=`（等号后什么都没有）。
空值不是「没配」，而是**把凭据助手列表清空**——system 级的 `manager` 被它顶掉，于是 git 退回
终端提示，非交互环境直接报 `fatal: could not read Password`。删掉那一行就好了：

只有用户名（不是秘密），密码交给 **Windows 凭据管理器**（Git Credential Manager 2.9，系统级
`credential.helper=manager`）。验证方式：`git push` 正常、`git config --local -l | grep ghp_` 为空。

```
remote.origin.url = https://3036615505-ops@github.com/3036615505-ops/3036615505-ops.github.io.git
```

原来 `git remote origin` 的 URL 是 `https://<user>:<PAT>@github.com/...`，令牌明文躺在 `.git/config`：
整个仓库目录拷给别人、打包、截图排障、`git config -l` 一下就全出去了。现在改成：

### 令牌不再写在 remote URL 里

## 2026-10-27 · 令牌移出 .git/config + e2e 不再挂死

1. `git reset --hard` / `git checkout origin/main -- .` 会被 **SIGTERM 杀掉**，并留下 `.git/index.lock`，
   之后所有写操作都失败（报 `Another git process seems to be running`）。
   **先 `rm -f .git/index.lock`**，再**按目录分块** `git checkout origin/main -- js css tools novel assets app manuscript .github .githooks docs`，
   最后 `git update-ref refs/heads/main $(git rev-parse origin/main)`。
2. 漏掉 `docs/` 会让它在 `git status` 显示为已删除（`D`），补一句 `git checkout HEAD -- docs/` 即可。
3. `git push` 若报 `schannel: CRYPT_E_NO_REVOCATION_CHECK`，那是证书吊销检查失败（不是没外网），
   用 `git -c http.schannelCheckRevoke=false push` 即可；代理本身要通（HTTP 代理走 `CONNECT`，
   `curl --ssl-no-revoke` 能验证）。

### 本机 git 操作的两个坑（2026-10-27 实测，Windows）

教训：**改背衬色等于改所有压在上面的小字对比度**。同一处颜色别只看「好不好看」，
改完必须跑 `node tools/contrast-audit.mjs`——它是拿真实渲染色算的，不看 CSS 变量名。

| 项 | 内容 |
|---|---|
| 提交 | `e215161`（已推送 main） |
| 文件 | `css/style.css` 的 `.tab-item` |
| 改动 | `color: var(--text-muted)` → `color: var(--text-secondary)`（#756654 → #6e5f4f） |
| 原因 | Mac 端「修底部断层」换了背衬色，实测 tab 栏底色变成 `#f1e6d6`，11px 文字掉到 **4.49:1**（门槛 4.5），对比度审计报 12 项未达标（四个 tab × 多页） |
| 验证 | 对比度 **12 → 0**（实测 4.99）；e2e 114/114；`?v=` 110 → 111 且 `--check` 报「版本号统一」；预缓存 / check-apk / 源稿 全绿 |

## 2026-10-27 底部 tab 对比度回归修复
