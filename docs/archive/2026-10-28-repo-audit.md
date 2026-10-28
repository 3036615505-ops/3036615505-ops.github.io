# 仓库审计（只读）

> **归档快照：2026-10-28。**
> 这是一次性仓库审计的原文，**里面的数字、目录结构、`?v=` / `CACHE` 值都停在当天**，不要当现状读。
> 当前状态看 `HANDOVER.md`（规则与现状）与 `docs/CHANGELOG.md`（改动流水）。
> 保留它的理由：审计里的「什么能删 / 什么看着能删但绝不能删」清单和 11 条「不做什么」的判断依据仍然有效，
> 那不是过期信息，是**当时为什么那样决定**的证据。

> 审计对象：`3036615505-ops.github.io`（线上 <https://zephyrw.site>，GitHub Pages，push 即发布）
> 审计日期：2026-10-28 · 基线 HEAD `3169339`
> 性质：**只读审计**。本文档是本次唯一新增的文件，仓库内任何既有文件未被修改。
> 结论只写「可证伪的事实 + 命令」，不写「我觉得」。

---

## 0. 基线：审计当时的真实绿状态

所有数字都是本次实测，不是从文档里抄的（文档里的数字有 8 处已过期，见 §3.4）。

| 项 | 实测值 | 命令 |
|---|---|---|
| 文件数 / 工作区体积 | **153 个 / 6,106 KB**（`.git` 另占 19 MB） | `find . -type f -not -path "./.git/*" \| wc -l` |
| `?v=` 版本 | **120**（29 个 HTML 全统一，共 217 处） | `node tools/bump-assets.mjs --check` |
| SW 缓存名 | **linyuan-v67** | `grep "var CACHE" sw.js` |
| PRECACHE | **77 条 / 1,448.1 KB** | `node tools/check-precache.mjs` |
| 正文与源稿 | 7 章逐字一致 | `node tools/manuscript-sync.mjs` |
| 安装包校验 | 一致（107,934 字节） | `node tools/check-apk.mjs` |
| 端到端 | **127/127，155.0s** | `node tools/e2e.mjs` |
| 类型检查 | 0 诊断（但见 §3.5「它其实只是语法闸」） | `npx -y -p typescript tsc -p jsconfig.json --noEmit` |

**审计结论：仓库是健康的。** 没有死配置、没有互相矛盾的生成器、没有退化的守卫。本报告要处理的不是「修烂摊子」，而是三件更小的事：**删掉 729 KB 死重、修 2 个真实缺陷、把 11 条命令收进一个入口**。

> **基线口径**：以上数字是 HEAD `3169339` 的**快照**。落地提交 `45a171e` / `bde4425` 之后部分数字已变：PRECACHE **条目数仍 77 条**，但合计因 CSS 顶部目录增至 **1,451.8 KB**（+3.6 KB，见 §3.5①）；CSS 行数 4,839 → **4,896**；`jsconfig.json` 的 include 5 → **15 条**；工作区文件数 153 → **145**（−11 个 jpg，+3 个新文件）。读本文时请把 §0 当作「审计当时的事实」，不是「当前状态」。

### 0.1 勘误（v3）：三处**自身**错误 + 一处复核发现的**外部**错误

审计报告也是要接受审计的。下表是**本审计自己**的三处错误，记录在此以免下次再犯，**三处的根因完全相同**——见本节末尾的通用规则。（第 3 条勘误的**出处我又写错了一次**，已就地改正并保留记录，见该条下方附注。）

**归属先说清楚，免得算错账**：本报告修订过程中出现过 **4 个**错误记录，其中 **3 个是我的**（下表），**1 个不是我的**（见本节「(2) 复核发现的外部错误」）。别人的错不揽，自己的错不轻描淡写。

**(1) 本审计自己的三处错误**

| # | 位置 | 初版写的 | 实测 | 错因 |
|---|---|---|---|---|
| 1 | §3.5② / §4-T04 | 「`js/` **11 个**模块」「include 缺 **8 个**」 | `ls js/*.js \| wc -l` → **14 个**；include 缺 **10 个**（漏了 `reader.dom.js`、`reader.flags.js`） | 沿用任务书里的「js 11 个文件」，**没有自己数**。而漏掉的这两个恰是 `LY.dom.*` / `LY.flags.*` 的类型来源 |
| 2 | §4-T03 | 「`PROJECT-OVERVIEW.md` 有『**17 人**』过期数字」 | 全文 `grep "17"` 只命中「code 17」与「JDK17」；该文件人物一直写 **18 人**，是对的 | 把 `README.md` 的「× 17」（人物页数量）**串到了 OVERVIEW** 上——两个文件都有「17/18」这类数字，没逐文件核对 |
| 3 | §4-T03「独有的 push 风险」/ §0.2 | 「改 `verify.yml` 需要 `workflow` scope，当前 PAT 没有 → 撤掉这一行改动」 | **PAT 有该 scope**。决定性证据：`git merge-base --is-ancestor 26106d2 origin/main` → **YES**，而 `26106d2` 正是改了 `.github/workflows/verify.yml` 的提交；`git log origin/main -- .github/workflows/verify.yml` 显示 **3 笔** workflow 提交都已上线。**不构成 push 风险，该行改动应保留** | 照抄了 `README.md:177`「当前 PAT 没有」。**但基线 `HANDOVER.md:263` 写的是相反且正确的**：「当前 PAT **已带** `repo, workflow`（2026-10-25 更换）」，同文件 `:593-596` 甚至记录了那次被拒→重签的全过程。**我没注意到两份文档当时就是互相矛盾的，挑了过期的那份** |

> **本条勘误的初版把出处错记成「HANDOVER 第 6 条」——这也错了，已改正。** 实际出处是 `README.md:177`；基线 `HANDOVER.md:263` 恰恰是对的。也就是说：我不仅抄了过期文本，还在**两份文档明确打架时没有察觉冲突**。
>
> 这暴露出一个结构性隐患，比数字本身值得记：**`README.md` 负责「怎么改」（流程），`HANDOVER.md` 负责「现在是什么状态」（事实）。状态类事实写进「怎么改」的文档里，就必然过期**——README 那句「当前 PAT 没有」写下的当天可能是真的，换 token 后没人会回去改一篇教程。更可操作的说法是：**同一件事散写两处，必然有一处过期**（本报告自己就撞了两次：这次是 README vs HANDOVER；§2.1 的「建议 mv」vs §6-Q2 的「已闭环」是同一种病）。

**(2) 复核发现的外部错误（不是本审计产出的，但必须记录）**

> **`3169339` 被误当作「workflow 改动已上线」的第二条证据——已删。**
>
> **归属**：这条由工程师在 `9aed645` 引入（他的原话：「拿『`origin/main` 的 tip』当成了『改过 workflow 的提交』，两件事被我合并成一句」），**本审计初版并未引用它**；是我在复核时发现并提出，他认领并修正。**所以它不计入上表，也不算我的错**。
>
> **错在哪**：`3169339` 只改 HANDOVER / css / index / 章节页 / 人物页，**根本没动 workflow 文件**（`git show --stat 3169339` 可证）。
>
> **现在只留一条真证据**：`git merge-base --is-ancestor 26106d2 origin/main` → YES，而 `26106d2` 正是改 `.github/workflows/verify.yml` 内容的提交。
>
> **为什么值得留着这段**：这类错误比「抄错文档」更隐蔽——它读起来完全合理，只差一次 `git show --stat`。两个 hash 都在 workflow 段落附近被提到过，按印象归类就会把「在 `origin/main` 上」和「改过 workflow」合并成一句话。**一条可复跑的证据胜于两条看起来像的**；下一个人复用这个论证时，会先看到这句话而不是先踩空。

真正的 `PROJECT-OVERVIEW.md` 过期项是另外三条（已按实测改掉）：`28 个静态页面`→29（§二，且与同文件 §三 的 29 自相矛盾）、`74 条 / 1,347KB`**两处**→77 / 1,448.1、`?v=70` / `linyuan-v59`→120 / v67。

**三处错误的根因是同一条**：**信了上游的转述，没有自己做一次可证伪的测量**（数一遍文件、逐文件 grep 一次、跑一条 `git merge-base`）。它们都不改变架构结论，但每一条都足以让工程师白做一步。本报告最贵的一课是「报绿的假检查比没有更糟」——在文档里，它的等价物就是**「抄来的数字比没有数字更糟」**，因为抄来的数字带着前一份文档的全部权威。

**由此得到一条通用规则（比修任何一处数字都值钱）——本报告认为它是这次整理最大的产出，两条子句是一个整体**：

> **状态只留一个出处；确实需要提及时，用指针指向那个出处，不要平行描述。**
>
> 推论一：**描述行为，不描述此刻的统计量。** 数量也是状态。`pre-push` 的「扫描 **6** 个 HTML」被工程师改成「扫描**全站** HTML」（`bde4425`）而不是改成 29——修数字只是把下一次漂移往后推，描述行为不会过期。同理 `HANDOVER.md` 的「92 项断言」应改成**指向命令**（"跑 `node tools/e2e.mjs` 看当前项数"）。本报告 §0.2 的时点也按这条改了：不写「ahead 4」，写「截至本文最后一笔提交，`git log -1 --oneline` 可查」。
>
> 推论二：**平行描述必然分叉。** 同一件事写在两处，就一定会有一处先过期，而且**过期的那处往往是"读起来更顺"的那处**——A 处说「建议 mv」、B 处说「已闭环」（§2.1 vs §6-Q2）；README 说「PAT 没有」、HANDOVER 说「PAT 已有」。三次撞车（含 §0.1 那两条）都是同一形状。
>
> 落地检查：**写完一句话先问「这句话的状态归谁管」**——归别人管就改成链接/指针（"见 X"），归自己管就确保别处不再复述。


### 0.2 执行状态（截至本文最后一笔提交，`git log -1 --oneline` 可查；**未 push**）

| 工作包 | 状态 | 说明 |
|---|---|---|
| T01 元数据与工具链补齐 | **已落地**（`45a171e`） | `package.json` / `.editorconfig` / `.gitignore` / `.gitattributes` / `robots.txt` 全部按草案；运行时不涉及，`?v=`/`CACHE` 未动 ✓ |
| T02 删 11 个孤儿 JPG + 修 `sw.js` 双逗号 | **已落地**（`45a171e`） | 11 个 jpg 全删（−729 KB）；`grep -n ",," sw.js` → 0；`check-precache` 仍报 77 条、`character-shenruoqi` 两项在列 ✓；`CACHE` 按论证保持 `linyuan-v67` ✓ |
| T03 文档纠偏 | **已落地**（`45a171e` + `bde4425`，含我的两处勘误）——**`verify.yml` 已改（1 行注释）；push 无阻塞，当前 PAT 已带 `workflow` scope** | `bde4425` 另外修了 `pre-push` 提示、`style.css` 字体体积、`README` 的 `transition.js` 停用标注 |
| T04 结构决策 | **部分**（`45a171e`） | `jsconfig.json` include 5→15 ✓、`style.css` 顶部 57 行带行号目录 ✓（行数 4,839 → 4,896）；③ `transition.js` **已拍板保留**（§6-Q1）；④ `checkJs` **已拍板保持 `false`**（§5「不开启 `checkJs: true`」，46 个既有错误） |
| §6-Q2（JPG 母版去哪） | **已闭环**（落地时按选项 B 执行，`45a171e`） | 11 个 jpg 已 `mv` 到仓库外 `E:/novel-site/_source-assets/assets/`：**11 个文件 / 746,613 字节（729.1 KB）**，与 `45a171e` 从索引删除的清单**逐名一致**（`diff` 验过）。在仓库外 → `git status` 永远看不到；作者不想留可整目录删除，历史里仍可取回。详见 §6-Q2 |

**push 前无需额外动作（勘误后的结论）**：`45a171e` 改了 `.github/workflows/verify.yml`（1 行注释），这**不构成阻塞**。决定性证据（可自行复跑，只有一条，但它是真的）：

```bash
git merge-base --is-ancestor 26106d2 origin/main && echo YES   # → YES
git log origin/main --oneline -- .github/workflows/verify.yml  # → 3 笔都已上线
```

`26106d2` 正是改 `verify.yml` 的提交且已在 `origin/main`，说明当前凭据**推得上去 workflow 文件**。`HANDOVER.md` 第 6 条「当前 PAT 没有」在审计基线上就已经过期（PAT 于 2026-10-25 换成带 `repo, workflow`，而 HANDOVER 最后更新是 10-24）——本报告初版照抄了它，见 §0.1 第 3 条。

**唯一要留的提醒**：换新 token 时别只勾 `repo`。缺 `workflow` scope 时 GitHub 拒绝的是**整笔 push**、报错却只提 workflow 文件，极易误判成别的问题。


---

## 1. TL;DR

1. **11 个 JPG 是真孤儿，共 729.1 KB（工作区体积的 11.9%）**——全部被同名 `.webp` 取代，全仓零引用（已含 `sw.js` PRECACHE、两个生成器模板、`tools/` 全部脚本）；删除可用 git 历史回滚，**不需要升 `?v=`、不需要升 `CACHE`**。
2. **`sw.js` 的 PRECACHE 里有两处双逗号**（`'...thumb.webp',,` / `'...character-shenruoqi.html',,`），造成 2 个数组空洞；当前只靠 `Promise.allSettled` 把 `undefined` 嚼掉才没出事，是真实缺陷。
3. **`linyuan-kai-rest.woff2` 绝不能删**——它在 `css/style.css:27` 作为独立 `font-family: LinyuanKaiRest` 挂在正文栈上，是「生僻字不变豆腐块」的兜底片（618 KB，按需下载）。
4. **`assets/og-cover.jpg`（41.2 KB）被预缓存但只有爬虫读**——页面渲染一次都不用，摘出 PRECACHE 是唯一干净的瘦身项。
5. **不引 ESLint、不拆 CSS、不合并 JS。** 依据见 §3.5 与 §5：拆分的改动面是 29 个页面 + 2 个生成器模板，收益只是作者阅读体验；而 `checkJs: true` 一开就是 **46 个既有类型错误**，说明这个仓库离「lint 全绿」不是一步之遥，是一轮重构。

---

## 2. 审计表

结论只有四种：**保留** / **删除** / **迁移**（移出仓库但保留本地） / **合并**（并入他处）。
体积单位 KB；「引用」= 全仓 `grep -rIl --exclude-dir=.git` 的命中文件（含 html / css / js / mjs / py / json / sw.js PRECACHE / 生成器模板）。

### 2.1 可以删（11 个文件，729.1 KB）

判定方法：对每个 `assets/` 文件取 basename 做全仓子串扫描，再对「可能被子串误命中」的（`cover.jpg` ⊂ `og-cover.jpg`）改用词边界正则复核。

| 路径 | 体积 | 被谁引用 | 结论 | 证据 |
|---|---|---|---|---|
| `assets/cover.jpg` | 318.3 | **无** | **删除** | `grep -rn -E "cover\.jpg" . \| grep -v og-cover` → 0 命中。线上封面走 `cover.webp`（`css/style.css:3272`）+ `cover-thumb.webp`（`index.html:23`），两者都在 PRECACHE。这是封面重设计的**原始母版**，是 `.webp` 的来源 |
| `assets/portrait-jiangbuqiu.jpg` | 51.0 | **无** | 删除 | `grep -E "portrait-jiangbuqiu\.jpg"` → 0。线上用 `-1024.webp`（PRECACHE）+ `-thumb.webp` |
| `assets/portrait-linshu.jpg` | 54.7 | **无** | 删除 | 同上 |
| `assets/portrait-nanheng.jpg` | 39.2 | **无** | 删除 | 同上 |
| `assets/tree-bare.jpg` | 30.8 | **无** | 删除 | 首页进度带只认 `tree-*.webp`（PRECACHE 6 条全是 webp） |
| `assets/tree-s1.jpg` | 25.4 | **无** | 删除 | 同上 |
| `assets/tree-s2.jpg` | 26.0 | **无** | 删除 | 同上 |
| `assets/tree-s3.jpg` | 38.3 | **无** | 删除 | 同上 |
| `assets/tree-s4.jpg` | 36.8 | **无** | 删除 | 同上 |
| `assets/tree-s5.jpg` | 54.9 | **无** | 删除 | 同上 |
| `assets/paper.jpg` | 53.7 | **无** | 删除 | 线上纹理用 `paper.webp`（PRECACHE 第 7 条） |

**合计 729.1 KB → 工作区 6,106 KB 降到约 5,377 KB（−11.9%），`assets/` 4,868 KB 降到约 4,139 KB。** ✅ 已在 `45a171e` 执行（`sw.js` 的 PRECACHE 未含其中任何一条，故 77 条不变，`CACHE` 保持 `linyuan-v67`）。

> **实测落地值（`du -sk --exclude=.git`，便于下次对照）**：工作区 **6,106 → 5,451 KB**、`assets/` **4,868 → 4,120 KB**、文件数 **153 → 145**。工作区比上面预测的 5,377 高 74 KB，原因不是瘦身没生效，而是**同一批还新增了 3 个文件**：`package.json`（2,130 B）、`.editorconfig`（829 B）、本审计文档（约 58 KB）。`assets/` 那 −748 KB 与预测的 −729 KB 之差只是 `du` 按 4K 块取整。

三条必须一起记住的限定：

- **不可逆性很有限**：这些文件已在 git 历史里，`git show HEAD~N:assets/cover.jpg > cover.jpg` 随时挖回来。**前提是不重写历史**（永远不要对 main 跑 `filter-repo` / `--force`）。
- **克隆体积不会变小**：`.git` 的 19 MB 里仍然躺着这些 blob。想真正减克隆体积只能重写历史，而那是本仓库**明确不该做**的事（公开仓库 + 多机协作 + 已发布）。
- **它们确实是母版**：**已按 §6-Q2 执行——11 个 JPG 已 `mv` 到仓库外的 `E:/novel-site/_source-assets/assets/`（746,613 字节 / 729.1 KB，逐名与删除清单一致，不进 git）**。`PROJECT-OVERVIEW.md` §九说封面三方向候选在 `_perf/cover-candidates/`，说明作者本来就有「母版放仓库外」的习惯；这次只是把它变成惯例。

**这一类不涉及任何运行时引用，所以：不升 `?v=`，不升 `CACHE`，不需要重新生成任何页面。**

### 2.2 看着像能删，但绝对不能删

| 路径 | 体积 | 被谁引用 | 结论 | 为什么不能删 |
|---|---|---|---|---|
| `app/linyuan-latest.apk` | 105.4 | `app/version.json` 的 `apkUrl` 指向线上此路径；`check-apk.mjs` 校验其 size/sha256 | **保留** | 它是**线上唯一的分发通道**——App 内「检查更新」就是下载这个 URL。删了 = 所有已装用户的更新按钮变成 404，且**无法回滚**（用户已经装了的版本还要靠它升级）。它还和 `version.json` 构成一对必须同次提交的原子体 |
| `app/version.json` | 0.5 | APK 壳启动时拉取；`tools/check-apk.mjs` | **保留** | 同上。`.nojekyll` 之外它是 App 侧唯一契约 |
| `manuscript/chapter-*.md` ×7 | 48.8 | `tools/manuscript-sync.mjs`（pre-push 第 4 项 + CI 第 4 项）；`new-chapter.js` 写入 | **保留** | 它是**唯一能证明「正文被谁改过」的东西**。git 只能证明文件变了，证明不了原文是什么（README 原话，且真出过事）。删了 = 第 4 项守卫直接失去被校验的一方，守卫变成空转 |
| `announce.json` | 0.1 | `js/announce.js:55-56`（运行时 fetch，不缓存）；`tools/make-announce.mjs` 生成 | **保留** | 「第 N 章更新了」横幅的**唯一数据源**。它**不在** PRECACHE（SW 明确放行），所以改它不用发版——这正是它的价值 |
| `flags.json` | 0.4 | `js/reader.flags.js:67`（`fetch('/flags.json?t=...', {cache:'no-store'})`） | **保留** | **线上止血开关**。四个功能出问题时靠它一分钟内关掉，不用回滚整站。删了 = 唯一的熔断手段消失 |
| `CNAME` | 0.01 | GitHub Pages 平台读取 | **保留** | 删了自定义域 `zephyrw.site` 立刻掉线，退回 `*.github.io`。这是**平台契约文件**，不是站点资源 |
| `.nojekyll` | 0 | GitHub Pages 平台读取 | **保留** | 删了 Pages 会跑 Jekyll，**下划线开头的目录/文件会被吞掉**。本项目暂无 `_` 目录，但 `_perf/` 之类一旦进仓库就会静默消失。零字节、零成本，别碰 |
| `.well-known/assetlinks.json` | 0.3 | Android 系统（Digital Asset Links 校验）；`HANDOVER.md` 记录了证书指纹 | **保留** | 它是 TWA / 自定义域验证的**平台契约**。删了 App 里的域名归属校验失败（`HANDOVER.md` §签名密钥 明确写了指纹也写在这份文件里） |
| `js/types.d.ts` | 1.5 | `jsconfig.json` 的 `include` 第一条 | **保留** | 它不产代码，但**是类型闸的地基**。删了 `tsc --noEmit` 连 `LY.*` 的形状都不知道，编辑器的波浪线全部失效 |
| `js/characters-data.js` | 17.9 | **没有任何页面引用**（`grep -l characters-data *.html` → 0）；只被 `tools/make-characters.mjs` 读 | **保留** | 这是「看着最像死代码」的文件，但它是**人物唯一数据源**（README 明文）。18 个人物页 + 列表页都是它的派生物。删了 = 下次跑生成器直接崩 |
| `tools/e2e.mjs` | 83.5 | `verify.yml` 的 e2e job | **保留** | 127 条断言全在这里。它是唯一能测「布局数学」的东西（假 DOM 测不出来） |
| `assets/fonts/*.woff2` ×3 | 1,088.5 | `css/style.css` 的 3 条 `@font-face` | **保留** | 见 §2.3 字体专节 |
| `assets/fonts/linyuan-kai-subset.chars.txt` | 11.3 | `tools/make-kai-subset.py:67`（`MANIFEST`） | **保留** | 它是 `--check` 的比对基准。删了第 3 项守卫没有基准可对 |
| `docs/INFINITE-SCROLL.md` | 11.8 | `new-chapter.js:222` 注释指向 | **保留** | 不是过期文档：它记录的是无限流**两轮返工的 9 个实测坑**，`reader.ui.js` 里那些看似多余的手势判定/顺序依赖，答案全在这份文档。删了 = 下一个人会把它们当 bug 改回去 |
| `js/transition.js` | 16.8 | **9 个页面**（`index.html`、`novel/index.html`、7 个章节页）+ `new-chapter.js:339` 模板 + `check-precache.mjs` 的 `needed` 白名单 | **保留（但前提错了，见 §5-1）** | 模块已全站停用，但**删文件的代价被文档高估了**：`HANDOVER.md` 说「30+ 生成页还引用它」，实测只有 **9 页**——18 个人物页根本不引它（`make-characters.mjs:252` 只是注释里提到） |

### 2.3 字体专节：`linyuan-kai-rest.woff2` 是不是孤儿？

**不是。** 这是本次审计里最容易误删的一个，值得单独立证。

`css/style.css:19-29` 声明了**两个不同 family**，靠 CSS 字体栈的逐字形回退串起来：

```css
@font-face { font-family: 'LinyuanKai';     src: url('../assets/fonts/linyuan-kai-subset.woff2?f=8'); }
@font-face { font-family: 'LinyuanKaiRest'; src: url('../assets/fonts/linyuan-kai-rest.woff2?f=1'); }
```

正文用 `font-family: "LinyuanKai","LinyuanKaiRest", ...`。浏览器**只在主片缺字形时才去取第二片**，所以正常阅读永远只付 273 KB，新章用到 GB2312 一级字时也不会变豆腐块（`make-kai-subset.py` 的设计意图，注释写在 `style.css:12-16`）。

| 文件 | 体积 | 角色 | 何时下载 |
|---|---|---|---|
| `linyuan-kai-subset.woff2` | 273.1 | 主片（正文已用字 + 已用字扩展） | 选「楷体」时必下 |
| `linyuan-kai-rest.woff2` | 618.4 | 兜底片（GB2312 一级字里主片没有的部分） | 仅当遇到主片缺字 |
| `zcool-xiaowei-subset.woff2` | 197.0 | 标题/展示字（`.character-hero h1` 等 8+ 处） | 首屏标题渲染，**在 PRECACHE 里** |

- **删 `-rest` 的后果**：生僻字回落到系统 serif，观感断层（不是乱码，但一眼看得出）。**这是行为回归，不是省空间。**
- **三片都不在 PRECACHE，唯 `zcool` 在**——这是对的：`zcool` 决定首屏标题，另两片是「选了才付」。
- 唯一的真实成本是**文档漂移**：`HANDOVER.md:17` 说「3900 字 / 852KB」，实测 **891.5 KB**（273.1 + 618.4）；`make-kai-subset.py`「现在的做法」一节写「253KB / 638KB」，实测 **273.1 / 618.4**（注意方向相反：主片**变大**、兜底片**变小**——7 章新增的字从兜底片迁到了主片，两片合计 3906 字不变）。文件本身没问题，是数字过期（见 §3.4）；该注释已在紧随 `bde4425` 的那笔 docs 提交里一并纠正（只动 24/25/28 三行，13–15 行的历史实验记录保留）。
- `?f=8` / `?f=1` 是**字体缓存键**，两片各自独立。换哪一片就 +1 哪一片的 `f`，不要一起改（改了没换的那片会让读者白下一遍）。

### 2.4 专题：`manuscript/` 随站点公开，能接受吗？

**能接受，且不应该为此改动。** 但可以花一行成本把副作用去掉。

事实与代价必须分清：

- GitHub Pages **无法按路径排除**。仓库里的一切都会在 `zephyrw.site/manuscript/` 下公开可读——`.nojekyll`、`_config.yml`、`.gitignore` 都不影响这一点（`.gitignore` 只管本地，不管已提交的文件）。所以「不公开」只有「移出仓库」一条路。
- **保密性不是问题**：正文本来就以 HTML 公开，`.md` 只是同一内容的另一种序列化。没有泄露任何未发布内容（`announce.json` 也说明第 7 章已上线）。
- **真正的副作用只有两个**：① 搜索引擎可能把 7 篇 `.md` 当正文索引，与 `.html` 构成重复内容；② 站点上多了一层「未加工的源稿」观感。

三个可选方案：

| 方案 | 做法 | 代价 | 评价 |
|---|---|---|---|
| **A. 原样保留** | 不动 | 重复内容 / 观感 | 零成本，可接受 |
| **B. 移出仓库** | `manuscript/` 挪到私仓或本地；`manuscript-sync.mjs` 改成读环境变量路径 | **丢掉唯一的跨机守卫**：CI 里没有源稿可比，第 4 项检查在服务端彻底失效；`new-chapter.js` 的「自动写源稿」也要改；两台机器各自持有一份 = 一定漂移 | **不建议**。用「内容被误改查不出来」换「搜索里少两页」，是亏的 |
| **C. 保留 + `robots.txt` 一行**（推荐） | `Disallow: /manuscript/` | 只能阻止**索引**，不能阻止直接访问；成本 1 行、零风险、不影响任何脚本 | **最小代价换掉唯一实质副作用** |

选 C 的理由：项目已经有 `robots.txt`（`Allow: /` + Sitemap），加一行不引入任何新概念；而 B 会拆掉「两道守卫互为备份」的结构（pre-push 只管配过 hook 的 clone，CI 才是不管谁推的都跑的那一道）。

---

## 3. 工程化补齐

原则：**补齐的是「入口」和「声明」，不是「工具链」。** 这个项目最珍贵的东西是「零依赖 / 零构建 / 十年后还能跑」（`PROJECT-OVERVIEW.md` 自述），任何补齐都必须能用一个 `rm` 撤回。

### 3.1 缺口清单

| 缺口 | 现状 | 影响 | 该不该补 |
|---|---|---|---|
| 无 `package.json` | 11 个脚本靠 README 记忆调用 | 新机器/半年后要翻文档才能记起 `--write` 还是 `--check`；打错参数是**静默**的（`bump-assets.mjs` 不带 `--write` 就是 dry-run，看着成功其实没改） | **补**（只有 `scripts`，零依赖） |
| 无 `.editorconfig` | 换编辑器靠自觉 | 缩进/EOL 漂移只在 diff 里暴露 | **补** |
| `.gitignore` 太薄 | 只有 `.DS_Store` / `.claude/` / `~/` | `node_modules/`、`_perf/`、`_backup/`、`Thumbs.db` 会变成 `git status` 噪声 | **补** |
| `.gitattributes` 漏 `*.py` | 已有 `*.js/*.mjs/*.css/*.html/*.json/*.yml` | `tools/make-kai-subset.py` **第 1 行是 shebang** `#!/usr/bin/env python3`，而本机 `core.autocrlf=true` → 该文件工作区是 **CRLF**。哪天有人 `./tools/make-kai-subset.py` 直接执行，Linux/macOS 会把 `python3\r` 当解释器名 → 报错。当前所有调用点都是 `python xxx.py`，所以**今天是潜伏 bug、不是活 bug** | **补**（这一条是 §2 之外的独立发现） |
| `.gitattributes` 漏 `*.md` | 5 个 `.md` 工作区为 CRLF | 目前无害（索引里是 LF，`git status` 干净）。补上只为消除跨机 diff 噪声 | 补（顺手） |
| 无 ESLint | — | 见 §3.5 | **不补** |
| `package-lock.json` | 无 | 没有依赖，就没有锁 | 不补（写进 `.gitignore`） |

### 3.2 `package.json` 完整草案（新增）

设计要点：`private: true`（永远不发布成 npm 包）、**没有任何 `dependencies` / `devDependencies` 字段**（保持「零依赖」可验证）、`engines` 写死 e2e 的真实要求（README：Node < 22 会跳过 e2e）。所有脚本都是**薄包装**，一行都不含逻辑——脚本本身仍是唯一实现，`package.json` 只是索引。

```json
{
  "name": "linyuan-site",
  "version": "0.0.0",
  "private": true,
  "description": "《临渊羡鱼》纯静态站点。零依赖、零构建；此文件只提供 npm run 入口，不含任何依赖。",
  "//": "约定：scripts 里只有转发，不含逻辑。改行为请改 tools/ 下的脚本，不要写在这里。",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "//1": "— 发版（改 HTML/CSS/JS 后必做）—",
    "bump": "node tools/bump-assets.mjs --write",
    "bump:check": "node tools/bump-assets.mjs --check",

    "//2": "— 五项静态守卫（与 pre-push / CI 一一对应）—",
    "precache": "node tools/check-precache.mjs",
    "kai:check": "python tools/make-kai-subset.py --check",
    "manuscript": "node tools/manuscript-sync.mjs",
    "apk": "node tools/check-apk.mjs",

    "//3": "— 一个入口跑完静态五项（Node 四项；字体那项见 verify:all）—",
    "verify": "npm run bump:check && npm run precache && npm run manuscript && npm run apk",

    "//4": "— 端到端 —",
    "e2e": "node tools/e2e.mjs",
    "e2e:verbose": "node tools/e2e.mjs --verbose",

    "//5": "— 生成器（改了数据源才跑）—",
    "chapter": "node new-chapter.js",
    "gen:characters": "node tools/make-characters.mjs",
    "gen:sitemap": "node tools/make-sitemap.mjs",
    "gen:announce": "node tools/make-announce.mjs",
    "gen:thumbs": "python tools/make-portrait-thumbs.py",
    "kai": "python tools/make-kai-subset.py",

    "//6": "— 修数据（有意改动后重算）—",
    "manuscript:write": "node tools/manuscript-sync.mjs --write",
    "apk:write": "node tools/check-apk.mjs --write",

    "//7": "— 审计与类型 —",
    "contrast": "node tools/contrast-audit.mjs",
    "contrast:dark": "node tools/contrast-audit.mjs --theme dark",
    "typecheck": "npx -y -p typescript tsc -p jsconfig.json --noEmit",

    "//8": "— 一次性：给本 clone 打开 pre-push 钩子 —",
    "hooks:install": "git config core.hooksPath .githooks",
    "hooks:status": "git config --get core.hooksPath"
  }
}
```

**11 个 tools 脚本的覆盖对照**（一项不漏，可逐条核对）：

| tools 脚本 | npm 入口 |
|---|---|
| `bump-assets.mjs` | `bump`（写入）/ `bump:check`（只查） |
| `check-precache.mjs` | `precache` |
| `check-apk.mjs` | `apk` / `apk:write` |
| `contrast-audit.mjs` | `contrast` / `contrast:dark` |
| `e2e.mjs` | `e2e` / `e2e:verbose` |
| `make-announce.mjs` | `gen:announce` |
| `make-characters.mjs` | `gen:characters` |
| `make-kai-subset.py` | `kai` / `kai:check` |
| `make-portrait-thumbs.py` | `gen:thumbs` |
| `make-sitemap.mjs` | `gen:sitemap` |
| `manuscript-sync.mjs` | `manuscript` / `manuscript:write` |
| （根目录）`new-chapter.js` | `chapter` |

**三个刻意的取舍，都有代价，作者可选：**

1. **`verify` 只含 Node 四项，`kai:check` 单独挂。** 原因：Windows 上是 `python`，macOS 上通常只有 `python3`，npm script 里没法跨平台探测（`.githooks/pre-push` 里有 20 行 shell 做这件事，搬进 `package.json` 就只能靠 `&&` 拼死）。**不想为了「一条命令」在 package.json 里写 shell 兼容代码。** 想一条命令跑全（Windows）：`npm run verify && npm run kai:check && npm run e2e`。
2. **没有 `e2e:mouse`。** `E2E_CLICK_MODE=mouse node tools/e2e.mjs` 这种 `VAR=x cmd` 前缀在 cmd.exe / PowerShell 里不生效——写进去就是一个**在 Windows 上静默失效的脚本**，比没有更糟。留在 README 里让人手打。
3. **`typecheck` 用了 `npx -y`。** README 现在写的是 `npx -p typescript tsc`，首次运行会**交互式询问是否安装**，在 CI / 非交互 shell 里会卡住。`-y` 一行修掉。

**兼容性核对（都已验证）**：GitHub Pages 会把 `package.json` 当静态文件公开（`/package.json` 可读）——无害，里面没有任何秘密；`.nojekyll` 已存在，不需要 Jekyll 配合；`sw.js` 的 PRECACHE 不含它，不进离线缓存；没有任何页面引用它，所以**不需要升 `?v=`**。

### 3.3 `.editorconfig` 完整草案（新增）

取值不是拍的，是从文件里量出来的：CSS/JS/HTML 都是 **2 空格缩进**；`css/style.css`、`js/reader.ui.js`、`sw.js` 的**行尾空格数 = 0**；`.gitattributes` 已经统一 LF。

```ini
# .editorconfig — 编辑器层面的格式约定
# 与 .gitattributes 分工：.gitattributes 管「进仓库时怎么存」（强制 LF），
# .editorconfig 管「敲键盘时怎么打」（缩进、行尾空格、末尾换行）。
# 两者都必要：.gitattributes 管不了 IDE 的 Tab 键，.editorconfig 管不了 Windows 的 autocrlf。
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

# Markdown 的行尾两个空格是有意义的硬换行，不能裁
[*.md]
trim_trailing_whitespace = false

# Python 生态惯例，且 tools/*.py 现有代码就是 4 空格
[*.py]
indent_size = 4

# 钩子脚本：LF + 可执行位由 .gitattributes 保证，这里只管缩进
[.githooks/*]
indent_style = space
indent_size = 2
```

### 3.4 `.gitignore` 补强草案（修改现有 4 行 → 全文替换）

现状只有 3 条（`.DS_Store` / `.claude/` / `~/`）。下面新增的每一行都对应一个**真实会出现的路径**，不是抄模板：

```gitignore
# ── macOS ──────────────────────────────────────────
.DS_Store

# ── Windows ────────────────────────────────────────
# 本仓库的主力机器是 Windows，资源管理器一浏览缩略图就会生成 Thumbs.db
Thumbs.db
desktop.ini

# ── 误提交防护：本仓库只放站点文件 ──────────────────
.claude/
~/

# ── Node ───────────────────────────────────────────
# 本项目零依赖，永远不会真的有 node_modules；
# 这一行是给「有人手滑跑了 npm install」兜底，不让 3000 个文件进 git status。
# package-lock.json 同理：没有依赖就不该有锁文件。
node_modules/
package-lock.json
npm-debug.log*

# ── 本地工作目录（不进仓库，但会真实出现在工作区）──
# _source-assets/  图片母版（cover.jpg / tree-*.jpg / portrait-*.jpg 的原始件，见本审计 §2.1）
# _perf/           性能测试产物与封面候选（PROJECT-OVERVIEW.md §九 提到的 _perf/cover-candidates/）
# _backup/         签名密钥的加密备份（HANDOVER.md 明确写了不进公开仓库）
_source-assets/
_perf/
_backup/

# ── 编辑器 ─────────────────────────────────────────
# 项目靠 jsconfig.json 提供 IntelliSense，不需要提交编辑器私有配置。
# 若日后想共享调试配置，把这一行删掉并只提交 settings.json。
.vscode/
```

### 3.5 结构优化：拆不拆？合不合？降不降？（三个「不」+ 一个「是」）

#### ① `css/style.css` 4,839 行要不要拆？——**不拆**

先算改动面，再谈收益：

| 维度 | 事实 |
|---|---|
| 引用面 | **29 个 HTML** 全部引用 `css/style.css?v=120`（全站 `?v=` 共 217 处，其中 CSS 29 处） |
| 生成器 | 其中 **26 个页面是生成物**（7 章节 + 18 人物页 + 列表页），模板分散在 `new-chapter.js` 与 `tools/make-characters.mjs` —— 正是 HANDOVER 三令五申「两个模板必须同步」的地方。拆 CSS 意味着**两个模板同时改 `<link>`** |
| 版本机制 | `bump-assets.mjs` 是文件无关的（`walk()` 扫所有 `.html`，正则替换每个 `?v=\d+`），所以**拆成几个文件后 bump 仍然正确**——这一点不是障碍 |
| 缓存机制 | **是障碍**。`sw.js` 的 PRECACHE 是按路径列的（`'/css/style.css'`），拆成 3 个文件要多 3 条 PRECACHE 条目 + `CACHE` 名 +1（导致 1.4 MB 全量重下）；不拆则**一次请求 120 KB、gzip 后约 25 KB、命中缓存零 RTT** |
| 收益 | 只有一个：作者翻文件方便 |

**结论：不拆。** 拆分的本质是「用 29 个页面的改动 + 一次全量重缓存，换单人阅读体验」。而这个仓库**没有构建步骤**——拆了就永远是多个请求，没有打包步骤能把它合回去。

**替代方案（零风险，真有收益）**：在 `css/style.css` 顶部加一份**分区目录注释**（`/* 1. 字体 2. 令牌 3. 布局 4. 首页 5. 书架 6. 章节页 7. 人物页 8. 弹层 9. 主题 … 行号 */`）。40 行注释解决 80% 的「翻文件」痛苦，改动面 1 个文件、1 处，且注释不影响任何 selector。

> **落地的代价，我该给出数字**：`css/style.css` **在 PRECACHE 里**，所以给它加注释 = 每个读者的安装体积 +同样的量。实测 57 行目录让该文件 120.0 → **123.6 KB（+3.6 KB）**，PRECACHE 合计 1,448.1 → 1,451.8 KB。**这个量级可接受**（0.25%），但它划出一条线：目录控制在 **≤60 行**，不要膨胀成一张「全文索引」——那样就是拿每个读者的流量换作者一个人的方便。
>
> **这是本次整理中唯一一处「为了可读性主动增加了读者下载量」的改动**，所以它必须留一条硬边界，而不是靠自觉：**上限 60 行**。超过就该换方案（例如只留一级分区名、去掉行号、或挪到 `docs/` 里当独立文档）。日后若有人想「把目录写得更全」，先看这条。
>
> 另外，带行号的目录**必然漂移**（这正是 §0.1 那条通用规则要防的东西）。工程师的缓解办法是对的：目录头部写了「行号为插入本目录之后的实测值；增删区块后重核对：`grep -n \"^/\* =====\" css/style.css`」。我实测该命令有 **43 个锚点**（多于目录的 35 条，是超集），**所以这条自维护指令是真的能用的**，不是装饰。任何带行号的索引都必须配这样一条可执行的重算命令，否则 57 行会一起变成谎言。

#### ② `js/` 14 个 `.js` 文件要不要合并/重分层？——**不合并**

- 现有分层（`reader.js → ui → engine → store`，`dom`/`flags` 横切）**已经是文档化并由 e2e 守护的结构**，`HANDOVER.md` §架构 明确写了「跨层调用不改调用点，而是在文件头声明同名 shim」。
- 合并 = 把刚拆开的边界重新糊上，同时**让所有 127 条断言的调试粒度变粗**（现在报错能定位到层）。
- 改动面同样是 29 个页面 + 2 个模板 + PRECACHE 11 条。
- **唯一真实的小问题**：`jsconfig.json` 的 `include` 只覆盖 **5 个文件**（`types.d.ts` + `reader.store/engine/ui/reader.js`）。`js/` 下共 **14 个 `.js` + 1 个 `.d.ts`**，也就是说 **10 个**拿不到共享类型：`reader.dom.js`、`reader.flags.js`、`announce.js`、`lightbox.js`、`nav-feedback.js`、`native-bridge.js`、`chapters.js`、`transition.js`、`theme.js`、`characters-data.js`。其中 **`reader.dom.js` 与 `reader.flags.js` 最容易漏**——它们不在「业务模块」清单里，但恰恰是 `LY.dom.*` / `LY.flags.*` 的类型来源。补 `include` 是纯配置改动、零运行时影响（`jsconfig.json` 不参与页面加载）。**这是本项里唯一的「该做」。**
  > ⚠ 勘误（v2）：本节初版写「11 个模块 / 缺 8 个」，漏了上面这两个。由工程师在落地时实测纠正（`ls js/*.js | wc -l` → 14）。

#### ③ PRECACHE 还能不能降？——**能，但只有一项干净**

实测 77 条 / 1,448.1 KB。逐项找「预缓存了但页面渲染一次都不用」的：

| 候选 | 体积 | 判定 | 理由 |
|---|---|---|---|
| `/assets/og-cover.jpg` | **41.2** | **可摘** | 全部引用都是 `<meta property="og:image">`（30 处）。**og:image 只被社交爬虫读，爬虫不跑 Service Worker** —— 预缓存它对读者零收益，纯占安装体积 |
| `/js/transition.js` | 16.8 | 不建议摘 | 模块已停用，但 9 个页面仍会请求它；摘出 PRECACHE 只是把它变成「首次访问多一个网络请求的 404 风险」，省的 16.8 KB 换不来什么。真正的解是删文件（见 §5-1），那是 P2 |
| `/js/lightbox.js` | 23.1 | 不建议摘 | 只有同学录页用（1 个页面）。但「断网也能看同学录」是设计目标（`announce`/离线书架同理），摘了会在弱网破图 |
| 3 张 1024 母版 | 316.4 | 不建议 | `sw.js` 注释已论证这是「门面清晰度」的刻意代价，其余 15 人已改成按需拉取 |
| `zcool` 字体 | 197.0 | 不建议 | 首屏标题就用它，摘了首屏会 FOUT |

**结论：只摘 `og-cover.jpg`，1,448.1 → 1,406.9 KB。** 但见 §4-T02 的取舍说明：**为了省 41 KB 而升 `CACHE` 名会让全体用户重下 1.4 MB，是净亏**。正确做法是**攒着**——把这条改动跟下一次因别的原因必须升 `CACHE` 的改动**合并提交**。

#### ④ `.github/workflows/` 与守卫的计数漂移——**顺手修**

`verify.yml` 头部注释还写着「⑥ 阅读器 61 项端到端断言」且编号从 ④ 跳到 ⑥；`README.md` 写「扫描 6 个 HTML」（实际 29）、「22 项断言」（实际 127）、「27 项」（实际 127）、「× 17」（实际 18 人）、「新叶 / 乔木 分组」（实际 3 组）。这些**不影响行为，但会主动误导下一个人**——本项目最贵的一课就是「检查工具静默报绿比没有更糟」，文档报错数字是同一类风险的软版本。

---

## 4. 分阶段任务列表

四个工作包（按依赖排序），每包内按 P0 → P1 → P2。**每个包的验证命令与回滚方式都写全了，没有「看情况」。**

### T01 · 元数据与工具链补齐（P0，零运行时风险）

| 项 | 内容 |
|---|---|
| **改什么** | 新增 `package.json`、`.editorconfig`；修改 `.gitignore`（全文替换）、`.gitattributes`（+2 行 `*.py` / `*.md`）、`robots.txt`（+1 行 `Disallow: /manuscript/`）；新增 `docs/REPO-AUDIT.md`（本文件） |
| **为什么** | ① 11 条命令没有入口，参数打错是**静默**的；② `.gitattributes` 漏 `*.py` 而该文件有 shebang + 本机 `autocrlf=true`（潜伏 bug）；③ `manuscript/` 公开的唯一实质副作用是搜索重复内容，1 行 robots 就能去掉 |
| **文件数** | 6 |
| **验证** | `npm run verify`（应全绿）<br>`npm run typecheck`（应 0 诊断）<br>`npm run hooks:status`（应输出 `.githooks`）<br>`git status -sb`（应**无** md/js 文件被标为 modified —— 证明 EOL 规则没制造噪声）<br>`git ls-files --eol \| grep w/crlf`（`tools/make-kai-subset.py` 应从列表消失或仅在重新 checkout 后消失） |
| **回滚** | `rm package.json .editorconfig`<br>`git checkout HEAD -- .gitignore .gitattributes robots.txt` |
| **不升版本** | 无任何页面引用这些文件 → **不升 `?v=`，不升 `CACHE`** |

`.gitattributes` 追加的两行（放在现有 `*.json` 之后，保持分组）：

```gitattributes
# Python：tools/make-kai-subset.py 第 1 行是 #!/usr/bin/env python3，
# 本机 core.autocrlf=true 会给它 CRLF → 直接在 Linux/macOS 执行时解释器名变成 "python3\r"。
# 今天所有调用点都是 `python xxx.py`（不受影响），但别留这个坑。
*.py text eol=lf
# Markdown 统一 LF：消除跨机 diff 噪声（索引里本来就是 LF，这条只是让工作区跟上）
*.md text eol=lf
```

### T02 · 删除 11 个孤儿 JPG + 修 `sw.js` 数组空洞（P0 / P1）

| 项 | 内容 |
|---|---|
| **改什么** | 删 `assets/cover.jpg`、`assets/paper.jpg`、`assets/portrait-{linshu,jiangbuqiu,nanheng}.jpg`、`assets/tree-{bare,s1,s2,s3,s4,s5}.jpg`（共 11 个）；改 `sw.js` 两处双逗号 |
| **为什么** | 前者 729.1 KB 零引用死重（−11.9% 工作区）；后者是真实缺陷：`'/assets/portrait-shenruoqi-thumb.webp',,` 与 `'/novel/character-shenruoqi.html',,` 各制造一个数组空洞，`Promise.allSettled(PRECACHE.map(...))` 把 `undefined` 当非 thenable 咽掉才没炸。`check-precache.mjs` 用正则提取字符串（报 77 条）所以**也看不见它**——典型的「守卫与被守卫对象同时失灵」 |
| **文件数** | 12 |
| **验证** | `npm run precache`（应显示 **77 条**，且 `character-shenruoqi` 两项仍在 ✓）<br>`npm run verify`<br>`npm run e2e`（127/127，重点看「同学录」与「离线」相关小节）<br>`node -e "console.log(require('fs').readFileSync('sw.js','utf8').match(/var PRECACHE = \[([\s\S]*?)\];/)[0].length)"` 前后对比，并人工确认无 `,,`：`grep -n ",," sw.js`（应 0 命中） |
| **回滚** | 删文件：`git checkout HEAD -- assets/`<br>`sw.js`：`git checkout HEAD -- sw.js`<br>（**不要**用 `git reset --hard` / `git checkout origin/main -- .` —— `HANDOVER.md` §本机 git 操作的两个坑 记录了它会被 SIGTERM 杀掉并留下 `.index.lock`） |
| **不升版本** | 删的是零引用文件 → **不升 `?v=`**。双逗号修复不改变任何缓存键 → **不升 `CACHE`** |

**P2（可选，建议攒着做）**：把 `/assets/og-cover.jpg` 从 PRECACHE 摘掉（−41.2 KB）。**但不要为此单独升 `CACHE`**——升 `CACHE` 会让全体用户重下 1.4 MB，净亏 1.36 MB。攒到下一次因别的原因必须升 `CACHE` 时一起提交。

### T03 · 文档与守卫计数纠偏（P1）

| 项 | 内容 |
|---|---|
| **改什么** | **①** `HANDOVER.md`：`?v=112`→120、`linyuan-v63`→v67、`4450 行`→4839、「852KB」→891.5KB（273.1+618.4）、`92 项`→127、悬空的 `app/WEBVIEW-ROADMAP.md` 引用（该文件不存在）。<br>**②** `README.md`：「6 个 HTML」→29、「22 项」→127、「27 项」→127、人物「× 17」→18、「新叶 / 乔木」→新叶/青枝/乔木、`transition.js` 那行补「（已停用）」标注。<br>**③** `PROJECT-OVERVIEW.md`：「28 个静态页面」→29（§二 与 §三 自相矛盾）、「74 条 / 1,347KB」→77 条 / 1,451.8KB（**两处**：内容规模表 + §四 架构图；**注意不是本报告基线的 1,448.1** —— `45a171e` 加的 57 行目录注释本身进了线上 CSS，+3.7KB 即 1,451.8，`HANDOVER` 本次记录里已写清差额来源）、「`?v=70` / `linyuan-v59`」→120 / v67、「楷体子集…主片 260KB + 兜底片」→273.1 + 618.4。<br>**④** `.githooks/pre-push` 第 91 行失败提示「扫描 **6** 个 HTML」→ **去掉数字**（改为「扫描全站 HTML」）。**不要改成 29**：硬编码计数必然再次漂移，而「扫描全站」描述的是行为、不会过期。这是本次唯一一条「修法本身被改进过」的项（工程师在 `bde4425` 里做对了，我的原建议「→29」是次优解，见 §0.1）。<br>**⑤** `css/style.css` 字体注释「约 260KB / 约 630KB」→273.1 / 618.4；`tools/make-kai-subset.py` 同理，但**只改 24/25/28 三行**（「现在的做法」一节，描述当前产物）→ `主片 1316 字 / 273.1KB`、`兜底片 2590 字 / 618.4KB`、`正常阅读只付 273.1KB`。**第 13–15 行不能动**：那是「实测（2026-10，6 章正文）」的 A/B 实验记录（853KB 单文件 / 253KB 仅已用字 / 分片更差），是**历史基线**，改了等于篡改当初的决策依据；已在旁边加一句说明「那节是 6 章时的实验记录，数字不同是正常的」。<br>**⑥** `.github/workflows/verify.yml` 头部注释「61 项」+ 编号 ④→⑥ 断裂（**push 无阻塞，见下方说明**）。<br>**⑦** `docs/REPO-AUDIT.md` 追加勘误与执行状态。 |
| **workflow 的 push 前提（已核实：无阻塞）** | **`.github/workflows/verify.yml` 是唯一一个「可能因为 token 权限而整笔 push 被拒」的文件。** 规则仍然成立：改 workflow 需要带 `workflow` scope 的 token，缺了它 GitHub 拒绝的是**整笔 push**，而报错只提该文件（`refusing to allow a Personal Access Token to create or update workflow`），极易误判成别的问题。**但「当前 PAT 没有 scope」这个前提是错的**（本报告初版抄了 `README.md:177` 的过期表述；**基线 `HANDOVER.md:263` 当时就写着相反的正确结论**，两份文档互相矛盾而我没察觉——完整复盘见 §0.1 第 3 条）：现在 `HANDOVER.md:267` 写明当前 PAT 已带 `repo, workflow`（2026-10-25 更换，起因正是 2026-10-27 那次被拒后重签）；硬证据只有一条，但它是决定性的：`git merge-base --is-ancestor 26106d2 origin/main` → **YES**，而 `26106d2`（CI timeout-minutes）正是改了 `.github/workflows/verify.yml` **内容**的提交。**结论：保留该行注释改动，不必撤。** 唯一要记住的：换新 token 时别只勾 `repo`。 |
| **为什么** | 这些数字全部**主动误导**下一个人。本项目最贵的教训就是「报绿的假检查比没有更糟」；文档报错数字是同一类风险的软版本。特别是 `HANDOVER.md` 里「`transition.js` 有 30+ 生成页引用」这句**已被实测证伪（实际 9 页）**，它正在支撑一个可能不必要的决策（见 §5-1） |
| **文件数** | 8（含 `css/style.css`、`.githooks/pre-push` 两个新增项；`tools/make-kai-subset.py` 的注释可归入同一提交） |
| **验证** | 无代码影响。跑 `npm run verify` 确认没手滑碰到代码；逐条 `grep` 复核新数字（例如 `grep -c "<loc>" sitemap.xml` = 29、`wc -l css/style.css` = 4839、`ls js/*.js \| wc -l` = 14、`ls -l assets/fonts/*.woff2` 见 273.1/618.4） |
| **回滚** | `git checkout HEAD -- HANDOVER.md README.md PROJECT-OVERVIEW.md .githooks/pre-push css/style.css tools/make-kai-subset.py .github/workflows/verify.yml`<br>（`verify.yml` 也可单独撤：`git checkout HEAD -- .github/workflows/verify.yml` —— 但**没有必要**，push 不会因它被拒） |
| **不升版本** | 纯文档/注释 → **不升 `?v=`、不升 `CACHE`**。`css/style.css` 只加顶部注释，注释不改变任何规则，也不需要 bump（但若与 §3.5① 的 TOC 一起做，**只在确实改了 CSS 规则时才 bump**） |

### T04 · 结构决策落地（P2，需作者拍板）

| 项 | 内容 |
|---|---|
| **改什么** | ① `jsconfig.json` 的 `include` 补齐 **10 个** js（`reader.dom` / `reader.flags` / `announce` / `lightbox` / `nav-feedback` / `native-bridge` / `chapters` / `transition` / `theme` / `characters-data`；include 5 → 15 条，零风险，**建议无论如何都做**）；② `css/style.css` 顶部加分区目录注释（零风险）；③ **`js/transition.js` 去留**（需拍板，见 §6-Q1）；④ **`checkJs` 是否开启**（需拍板，见 §6-Q2，实测 46 个既有错误） |
| **为什么** | ①② 是「不拆文件也能提升可读性」的唯一正确解；③④ 是本次审计里唯二「文档给的依据已过期、需要重新决策」的地方 |
| **文件数** | 3~4 |
| **验证** | ① `npm run typecheck`（仍应 0 诊断——`checkJs:false` 时补 include 不引入错误，只让编辑器有类型）<br>② 纯注释，`npm run bump:check` + `npm run contrast`（应 0 未达标）+ 任意页面人工看一眼<br>③ 若删 `transition.js`：`npm run precache` + `npm run e2e`（HANDOVER 明确有反向断言「页面切换 · 过渡已停用」，它会立刻抓到漏改） |
| **回滚** | ① `git checkout HEAD -- jsconfig.json`　② `git checkout HEAD -- css/style.css`　③ `git checkout HEAD -- js/ transition.js check-precache.mjs index.html novel/index.html novel/chapter-0*.html` |
| **不升版本** | ①② 无运行时影响 → 不升。③ **必须升**：删脚本 = 改 9 个 HTML，`?v=` +1，且若 PRECACHE 有变动则 `CACHE` +1 |

---

## 5. 明确「不做」的项与理由

这一节比上面任何一节都重要。**过度工程对一个「零构建、零依赖、十年后还能跑」的项目是净损失。**

| 不做 | 理由（含实测数据） |
|---|---|
| **不引 ESLint / Prettier** | 决定性证据：把 `jsconfig.json` 的 `checkJs` 临时改成 `true` 跑一遍（未改动仓库，用 `/tmp` 下的等价配置），**实测 46 个既有错误**——大量是 `Cannot find name 'closeSettings'`（跨层 shim，运行时才存在）、`Property 'value' does not exist on type 'HTMLElement'`、`EventTarget.tagName`。要让 lint 全绿，得动 `reader.ui.js`（2,719 行，是全仓 e2e 断言最密集的文件）。**这不是「补个配置」，是一轮重构**——而重构的收益是「零用户可见变化」。Prettier 更糟：它会让 4,839 行 CSS 和 29 个生成页一次性全量 diff，把 `git blame` 彻底废掉。**维持现状：`tsc --noEmit` 当语法闸（诚实说明：`checkJs:false` 下它基本只验「能不能解析」，但它是零成本护栏，留着）** |
| **不拆 `css/style.css`（4,839 行）** | 改动面 29 个页面 + 2 个生成器模板 + PRECACHE；无构建步骤 → 拆了永远是多个请求；收益仅为单人阅读体验。**替代：顶部加分区目录注释**（见 §3.5①） |
| **不合并/重分层 `js/`（14 个文件）** | 五层单向依赖是文档化 + 被 e2e 守护的结构；合并让 127 条断言的调试粒度变粗；改动面同样 29 页 + 2 模板 + 11 条 PRECACHE。**替代：补 `jsconfig.json` 的 `include`**（见 §3.5②） |
| **不开启 `checkJs: true`** | 46 个既有错误。开 = 要么修 46 处（高风险重构），要么加 46 条 `// @ts-ignore`（把护栏变成装饰）。**两个都比现状差** |
| **不重写 git 历史瘦身** | 11 个 jpg 删掉后 `.git` 仍是 19 MB。要真瘦身得 `filter-repo` + `force push`——在一个**公开仓库 + 多机协作 + 已发布站点**上重写历史，风险量级远超省下的 4 MB。**明确不做** |
| **不把 `manuscript/` 移出仓库** | 会拆掉 CI 里唯一能跨机生效的正文一致性守卫（见 §2.4 方案 B） |
| **不为「整理」而升 `?v=` / `CACHE`** | 本报告里 T01/T02 的绝大多数改动**不触碰任何被 HTML 引用的资源**。乱 bump 的代价是真实的：`CACHE` 名 +1 = 全体读者重下 1.4 MB。升版本是**行为变更**的配套动作，不是「整理完的仪式」 |
| **不引入构建工具（Vite/webpack/esbuild）** | 项目自述的核心资产是「十年后打开还能跑」。引入构建 = 引入 `node_modules`、锁文件、版本腐坏路径，以及**发布物不再等于仓库内容**（现在的「push 即发布」是它最大的运维优势） |
| **不做 Workbox / epub.js / Readium** | `PROJECT-OVERVIEW.md` §八 已决策「不引」，理由（会引入构建步骤或换定位模型）至今成立，本次审计未发现新证据推翻 |
| **不改 `.github/workflows/` 的逻辑** | 只改注释里的数字。改逻辑需要带 `workflow` scope 的 token（HANDOVER 记过：不带会让**整笔 push** 被拒，不只是这个文件） |
| **不动 `new-chapter.js` / `make-characters.mjs` 的模板** | 两个生成器模板的同步是铁律。本报告没有任何任务需要改模板——一旦需要，就必须同时改两处并重跑生成器，那已经不叫「整理」了 |

---

## 6. 三个决策问题（**已全部拍板**，保留论证以备复用）

只问三个。前两个有我的倾向性建议，第三个纯需知情。

> **三个都已在落地时拍板，结论写在各节开头。** 本节保留原始论证过程（为什么这么问、代价各是什么），不要因为「已拍板」就删掉——下次同类问题还要靠它复用。

### Q1 · `js/transition.js`（16.8 KB，已全站停用）留还是删？

> **已拍板（主理人，落地前）：选 A，保留。** 落地时做了三件事：① 本报告建议的
> 「把 `HANDOVER.md` 里『30+ 页』改成实测 9 页」已改，并顺手把**真要删除时的改动面**
> 写全（9 个页面 + `new-chapter.js:339` 模板 + `check-precache.mjs` 的 `needed` 白名单，
> `?v=` 与 `CACHE` 各 +1），让下次重新决策有真实成本可算；② 保留理由改成
> 「重启过渡时的弯路结论需要它这个可执行载体」，不再用被证伪的成本依据；
> ③ `README.md` 文件树补了「已全站停用，模块保留备用」标注（`bde4425`）。
> **代码与 PRECACHE 一行未动。**

**背景更正**：`HANDOVER.md` §15 说「`novel/chapter-*.html`、`characters.html`、`character-*.html` 等 **30+ 个生成页**的 `<script>` 还引用它，删文件必须重新生成全站」。**实测只有 9 个页面**：`index.html`、`novel/index.html`、7 个章节页。18 个人物页**都不引它**（`make-characters.mjs:252` 只是注释里提到 transition）。也就是说，当初支撑「保留」的**成本被高估了约 3 倍**。

| 选项 | 代价 | 收益 |
|---|---|---|
| **A. 保留（现状）** | 9 个页面各多一次静态请求；PRECACHE 多 16.8 KB | 零改动，零风险 |
| **B. 删掉** | 改 9 个 HTML + `new-chapter.js:339` 模板 + `check-precache.mjs` 的 `needed` 白名单；`?v=` +1；`CACHE` +1（1.4 MB 重下） | 少 16.8 KB、少一个「已停用但还在」的歧义状态 |

**我的建议：A（保留）。** 理由不是成本——B 的成本其实可控——而是 `HANDOVER.md` §15 已经明确写了「重启过渡时那些弯路结论仍然有效」，`transition.js` 是那些结论的**唯一可执行载体**。删了文件，重启时要从零重写 430ms 曲线和 3D 结构。**但请把 HANDOVER 里「30+ 页」改成「9 页」**——用错误的成本依据维持一个决定，比决定本身更危险。

### Q2 · `assets/*.jpg` 母版删掉之后，本地那份放哪？

> **已闭环：落地时按选项 B 执行（`45a171e`）。** 11 个 JPG 已 `mv` 到仓库外
> `E:/novel-site/_source-assets/assets/`，共 **746,613 字节（729.1 KB）**，文件名与
> `45a171e` 从索引删除的清单**逐名一致**。复核命令（可重跑，两端各列一份名单再 diff）：
>
> ```bash
> git show --name-only --pretty=format: 45a171e -- assets | sed '/^$/d;s#^assets/##' | sort > /tmp/a
> ls /e/novel-site/_source-assets/assets/*.jpg | xargs -n1 basename | sort > /tmp/b
> diff /tmp/a /tmp/b && echo 一致
> ```
>
> 该目录在**仓库外**（`git status` 永远看不到它），`.gitignore` 里的 `_source-assets/`
> 只是「万一有人把副本放进仓库」的兜底。作者若不想要这份副本，直接删目录即可 ——
> 不影响 git 历史，取回仍可用 `git show 3169339:assets/cover.jpg`（`3169339` = 删除前
> 最后一笔，已验 `git cat-file -e` 通过、325,924 字节与原文件相同）。

11 个 JPG 是 `cover.webp` / `tree-*.webp` / `3 张 1024 母版` 的**图片母版**。删掉后它们只存在于 git 历史里（可 `git show <commit>:<path>` 取回，前提是不重写历史）。

- **选项 A**：只删，不留本地副本。取回靠 `git show`。（最省空间，但需要记得那个 commit）
- **选项 B（我的建议）**：删之前 `mv` 到 `E:/novel-site/_source-assets/`（仓库外，已在 `.gitignore` 里声明）。理由：`PROJECT-OVERVIEW.md` §九 说封面重设计「进行中」、三方向候选在 `_perf/cover-candidates/`——**封面母版马上就要被用到**，不该只躺在 git 历史里。
- **选项 C**：不删，保持现状（放弃 11.9% 瘦身）。

需要你确认：**封面重设计还要不要用 `assets/cover.jpg` 这张母版？** 要，就选 B。

### Q3 · `npm run verify` 要不要为了「一条命令」妥协跨平台？

> **已拍板（主理人）：选 A，维持两条，不新增 `tools/verify.mjs`。** 落地为
> `package.json` 里 `verify`（Node 四项静态校验）+ `verify:all`（五项，多一个 `kai:check`），
> e2e 仍是独立命令（155 秒不该混进「静态校验」）。`tools/verify.mjs` 这条路留着——
> 哪天真的嫌两条麻烦再做，那时它仍然要面对同一个 `python` / `python3` 探测问题。

现状：`package.json` 里 `verify` 只含 Node 四项，Python 的 `kai:check` 单独挂。原因是 Windows 认 `python`、macOS 通常只有 `python3`，`&&` 拼不出跨平台判断。

- **选项 A（我的建议）**：保持两条命令（`npm run verify && npm run kai:check && npm run e2e`）。`.githooks/pre-push` 里那 20 行探测逻辑已经解决了这个问题，**没必要在 package.json 里复制一份**。
- **选项 B**：新增 `tools/verify.mjs` 做串行编排 + 解释器探测。代价：多一个脚本要维护，且它本身不受任何守卫保护。

这个不影响任何发布行为，**只是记录一下知情选择**——如果你觉得两条命令麻烦，说一声我把它写进 `tools/`。

---

## 附：本次审计用到的复核命令（可直接重跑）

```bash
# ① 孤儿素材（词边界精确版；cover.jpg ⊂ og-cover.jpg，必须排除子串误命中）
for f in $(find assets -type f | sed 's|^|/|'); do
  base=$(basename "$f")
  hits=$(grep -rIl --exclude-dir=.git -F "$base" . 2>/dev/null | grep -v "^./$f")
  [ -z "$hits" ] && echo "ORPHAN  $f"
done
grep -rn --exclude-dir=.git -E "cover\.jpg" . | grep -v "og-cover"   # → 0 命中，确认 cover.jpg 真孤儿

# ② PRECACHE 数组空洞
grep -n ",," sw.js                                                # → 2 处（第 130、131 行）

# ③ 脚本引用面（证伪 HANDOVER 的「30+ 页」）
grep -rln --exclude-dir=.git "transition\.js" --include="*.html" . | wc -l   # → 9

# ④ EOL 状态（索引 vs 工作区）
git ls-files --eol | grep "w/crlf"
git config --get core.autocrlf                                     # → true（本机）

# ⑤ 类型闸的真实效力（不改仓库，用 /tmp 下的等价配置）
#    把 include 指向仓库文件、checkJs 改 true → 46 个 error
grep -c "error TS" <(npx -y -p typescript tsc -p /tmp/tscheck/jsconfig.json --noEmit 2>&1)
```

---

*本审计**初版**为只读产物：产出时仓库内既有文件零改动，`git status` 只显示本文档为新增。
此后本文档仅修正**自身**的勘误（§0.1）、执行状态（§0.2）与拍板结果（§6），
以及落地时被实测证伪的数字；**没有改动任何被审计的代码文件**——那些改动全部另开提交。*
