# 交接说明（下次动工先读这份）

> 最后更新：2026-10-24 04:30 · 对应 HEAD `见 git log -1`
> 写给「几天后回来、已经忘了细节的自己」。README 讲怎么改，这份讲**现在是什么状态、哪里埋着坑**。

## 一页纸现状

| 项 | 值 |
|---|---|
| 线上 | <https://zephyrw.site>（GitHub Pages，push 即发布） |
| 站点资源版本 | `?v=100`（全站 28 个 HTML 引用统一；楷体子集另有 `?f=` 缓存键） |
| SW 缓存名 | `linyuan-v58` |
| 阅读器模块 | dom 77 行 · flags 87 · store 247 · engine 552 · ui 2719 · 入口 30 |
| 样式 | `css/style.css` 4450 行（4 套主题令牌） |
| 章节 | 7 章（2858 / 2347 / 2029 / 2496 / 2076 / 2269 / 2081 字），源稿在 `manuscript/`；`CHAPTERS` 带 `year`（四位数字）+ `date`/`dates`，首页光阴册按学年学期分段（标签如「二〇二二 · 高一上」，年级由 `COHORT_YEAR` 推出）；一章多日 → 日期列每 4 秒跳一格，章内日期（如第一章九月十七）插在场景切换后，不挂章末；与上一章同一天时用 `new-chapter.js --nodate`（数据照旧记日期供光阴册分组，但章节页不输出日期行） |
| 人物 | 18 人（新叶 7 / 青枝 4 / 乔木 7）**全部有立绘**（`assets/portrait-<slug>-1024.webp`，1024×960）；列表页 `novel/characters.html` + 每人一个详细页 `novel/character-*.html`；数据在 `js/characters-data.js`，由 `tools/make-characters.mjs` 生成 |
| 字体 | 黑体/系统/楷体 + **导入自己的字体**（FontFace + IndexedDB，reader.ui.js `installUserFont`，详见 `app/FONT-BRIDGE.md`）。楷体子集 = **GB2312 一级常用字 3755 + 已用字 + ASCII + 标点 = 3900 字 / 852KB**（`tools/make-kai-subset.py` 生成；**不在 SW 预缓存**，选楷体才懒加载；URL 里的 `?f=` 是字体缓存键，换字体必须 +1；要瘦身用 `--minimal` 回到「仅已用字」约 205KB）。系统字体在 WebView 里拿不到 ROM 主题字体，这是 ROM 限制不是 bug |
| Android 壳 | v1.9.0 / versionCode 17（v1.8.5 文件选择桥 →「导入自己的字体」在 App 里可用；v1.8.6 修更新包下载卡死；v1.8.7 修系统返回键直接退出；**v1.9.0 = A 档收官，壳进入封版状态**：桥接补丁下沉到站点 `js/native-bridge.js`（以后改桥不用发版）、原生分享桥、闪屏叠层淡出、onResume 补更新检查、锁竖屏。详见 `app/BACK-HANDLING.md` 与 `app/WEBVIEW-ROADMAP.md`） |
| 校验 | 本地 pre-push 5 项 · CI 2 个 job · 端到端 116 项 |

## 常用命令

```bash
node tools/e2e.mjs                 # 92 项端到端（真浏览器，约 95 秒）
node tools/e2e.mjs --verbose       # 附带每项实测值
npx -p typescript tsc -p jsconfig.json --noEmit   # 类型检查（零产出）
node tools/bump-assets.mjs --write # 发版前必做：全站 ?v= 统一 +1
node tools/bump-assets.mjs --check # 只检查是否混版
node tools/check-precache.mjs      # SW 预缓存条目是否存在
node tools/manuscript-sync.mjs     # 正文与 manuscript/ 源稿逐字比对
node tools/check-apk.mjs           # 安装包与 version.json 的 size/sha256 是否一致
node tools/check-apk.mjs --write   # 打完新包后重算校验值（APK 与清单同一次提交）
python tools/make-kai-subset.py --check            # 楷体子集是否覆盖正文
node new-chapter.js <原稿.md>       # 加新章节（会自动写 manuscript/）
node tools/make-characters.mjs     # 改人物后重新生成同学录与详细页
python tools/make-portrait-thumbs.py  # 为 17 张立绘生成 128×150 缩略图（列表页用，母版留给详情页/灯箱）
node tools/make-sitemap.mjs        # 重生成 sitemap.xml（章节+人物+固定页，lastmod 取源稿 mtime）
node tools/make-announce.mjs      # 重生成 announce.json（「第 N 章更新了」横幅的数据源，取章号最大者）
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

## 多机协作：版本号、同步与目录卫生

**「版本」有两个，平台限制只有一个。**

| 要改的东西 | 改在哪 | 有平台限制吗 |
|---|---|---|
| 站点资源版本 `?v=` + SW `CACHE` | 任何装了 Node 的机器 | **没有**。就是 `node tools/bump-assets.mjs --write`，Mac / Windows 完全一样 |
| App 版本 `versionCode` / `versionName`（`twa/app/build.gradle`） | 装了 Android SDK + JDK 的那台 | **有**。SDK 目前在 Windows 这台（`E:/novel-site/android-sdk`）；Mac 上若也装了 SDK 同样能打 |

所以「升版本号必须在 Windows 改」是句误解：站点版本号在哪台改都行，Mac 端已经改过很多次。
**只有要打 APK 时才必须去那台机器**，因为 Android SDK 只装在那里。

**GitHub 上的 `main` 是唯一真相，任何一台机器上的目录只是工作副本。** 没 push 的改动等于不存在——
换机器前先 push（或推分支），不要指望「另一台机器上那份」。

### 两台机器的分工

| 机器 | 路径 | 能做什么 |
|---|---|---|
| Windows | `E:/novel-site` | 全部；**打 APK 只能在这台**（Android SDK 在这里） |
| Mac | `~/linyuan-live` | 站点 / 样式 / 阅读器 JS / 跑 e2e；不能打 APK |

- **一台机器只留一个 clone。** 同一仓库放两三份（`xxx-fix`、`xxx.stale`）必然出现「我改的是哪一份」，
  而且旧副本会一路落后几十个提交。用完即删，下次 `git clone` 一分钟。
- 目录别用域名命名（`3036615505-ops.github.io` 看着像发布源，其实只是一份副本）。

### 开工 / 收工（两台一样）

```bash
# 开工
cd ~/linyuan-live               # Windows: E:/novel-site
git status -sb                  # 第一行就是 ahead / behind
git pull --ff-only              # 分叉会直接报错，不悄悄合并出烂摊子

# 改完
node tools/bump-assets.mjs --write   # 只有动了 HTML/CSS/JS 才需要
git commit -am "…"
git push                        # pre-push 四项校验 + CI 兜底
```

`--ff-only` 的意义：本地有未推提交、远程也有新提交时，它**报错而不是自动 merge**。
这时候先看清两边各改了什么，别硬合。

### `?v=` 是全局单点，最容易撞

两台机器各自 `bump --write` 会得到同一个号（都 71），后推的那次让先推的资源版本失效，读者吃旧缓存。
所以顺序永远是 **pull → 改 → bump → commit → push**，不是「改 → bump → 想起来了才 pull」。

### 改到一半要换机器

不要留未提交改动在 main 上跨机器：

```bash
git switch -c wip/mac-键盘        # 名字带机器 + 主题
git commit -am "wip: 键盘换章"
git push -u origin wip/mac-键盘
# 另一台接着写：git fetch && git switch wip/mac-键盘
# 完成后合回 main
```

只在本机离开几小时才用 `git stash push -m "wip"`——stash 不过网络，换机器拿不到。

### 每台机器配一次

```bash
git config core.hooksPath .githooks   # 没配则本地四项校验不跑，只剩 CI 兜底
```

**版本号现状**：`?v=71`（2026-10-26）。谁改谁 bump，`?v=` 与改动一起提交，不要攒——
攒多了中间任何一次 push 都可能带着别人的旧缓存。

## 两类改动，两种流程

**A. 只改站点（绝大多数情况）**——HTML/CSS/JS/章节/图片：

```bash
node tools/bump-assets.mjs --write   # ① 改 CSS/JS 必须做，否则用户吃旧缓存
# ② 若改了 sw.js 的 PRECACHE，CACHE 版本号也要 +1（v29 → v30）
git commit && git push               # ③ pre-push 会跑 4 项校验，CI 会再跑一遍
```

**B. 改到壳**（图标、应用名、权限、Manifest、WebView 设置、原生桥）——才需要：

```bash
cd <装有 android-sdk 的那台机器>/twa && ./publish-apk.sh "更新说明"
#   目前 SDK 在 Windows 这台：E:/novel-site/twa（Mac 上按本机实际路径替换）
```

## 加新章节（一条命令，其余全自动）

```bash
node new-chapter.js 原稿.md --blurb "目录页一句话" --date "九月十九" --seal "前桌"
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
然后 commit + push，CI 跑五项校验 + 69 项端到端。

新增章节**不需要**手动升 `?v=`：章节页是新 URL，导航走网络优先；`CACHE` 由脚本升。

## 人物录（一条命令，其余全自动）

```bash
node tools/make-characters.mjs
```

人物信息**只改 `js/characters-data.js`**（唯一数据源，不参与页面运行），然后跑上面
那条命令——**光改数据源网站不会变**（页面是预生成的；2026-10-25 就因为只改数据源
没跑命令，白改了 12 处文案）。它一次做完：

1. 生成 `novel/characters.html`（列表页，含「新叶 / 乔木」分组与「详细 ›」入口）
2. 生成 `novel/character-<slug>.html` × 17（详细页：立绘/占位、身份徽标、生日、
   一句台词、小传、设定标签）
3. 把新详细页登记进 `sw.js` 的 `PRECACHE` 并把 `CACHE` 名 +1（和 new-chapter.js 同一套逻辑）

两个实现要点：

- **整卡可点但不用 JS**：`.char-more` 的 `::after` 撑满卡片当热区，`.char-photo` 提
  `z-index` 保证立绘按钮（灯箱）仍可点。没有把卡片改成 `<a>`——卡里的
  `<button>` 嵌进 `<a>` 不合法。
- **详细页没有 tab 栏**（和章节页一致）：它是子页面，从列表页进、从左上角返回。

生日显示格式由生成器统一输出「阿拉伯数字 + 年/月/日」（如 `2007年4月20日`，数据源存
`YYYY.MM.DD`；作者 2026-10-25 定稿，别改回中文数字）。

姓氏占位字走 ZCOOL XiaoWei 子集（928 字），樽/颜/澜/灼 不在子集里，会回落到系统
serif——观感一致，不是 bug。（18 人全部有立绘后，占位字实际已不再显示；字段保留作兜底——沈若栖最初就是靠它上线的。）

**立绘一致性做法**：新叶 4 位学生用图生图（参考现有立绘、保真度调低、提示词显式
指定新人物的姿势发型表情 + 锁住校服校徽画风）；乔木 10 位长辈文生图（同画风描述 +
身份着装）。生成后统一裁底 64px 去水印、转 webp。保真度调高会出「换头版」——
黎颜第一版就是这么废掉的。

## 签名密钥：丢了就是灾难（2026-10-25 已做备份）

壳的签名密钥 `linyuan.keystore`（别名 `linyuan`，PKCS12，RSA 2048 到 2053 年）放在
`E:/novel-site/twa/`，**该目录不在 git 里**，所以它曾经是全项目最高危的单点：硬盘坏 =
所有已装用户必须卸载重装，**阅读进度和摘句全丢**（localStorage 随卸载清空）。

证书指纹 `FD:BE:AA:46:F7:3B:E6:B7:16:12:1C:47:AE:EE:5F:C3:4F:23:86:7A:6E:A5:D0:A5:CF:A9:41:DE:62:70:7F:CB`
（也写在 `/.well-known/assetlinks.json` 里）。

现在有三份**加密**备份（AES-256-CBC / PBKDF2 300k 迭代，内含 keystore + `.kspass` + 密钥档案）：

| 落点 | 说明 |
|---|---|
| 本机 `E:/novel-site/_backup/*.tar.enc` | 出事时的第一顺位 |
| OneDrive `密钥备份-临渊羡鱼/` | 跨设备取用（Mac 装 OneDrive 客户端即可） |
| 一个**私有** GitHub 仓库 | 异地灾备，Mac 直接 clone |

恢复：`openssl enc -d -aes-256-cbc -pbkdf2 -iter 300000 -in *.tar.enc | tar -xf -`，
解出的 `linyuan.keystore` sha256 应为 `20a0c563afff4e0f4450fe0021bbd29d4e675d907e211406fd0e47306bbb3749`。

铁律两条：**密文与密码绝不放在同一个账号/同一个地方**；**任何密文都别进公开仓库**
（站点仓库是公开的，只写这条说明、不写密码和仓库名）。

## 埋过的坑（每条都是真出过事的）

0. **生成出来的页面别手改**。`novel/characters.html` 与 `novel/character-*.html` 由
   `tools/make-characters.mjs` 从 `js/characters-data.js` 生成，和章节页同理：手改下次
   一跑就被覆盖，而且覆盖时没有任何提示。要改内容改数据文件。

1. **`content-visibility: auto` 会毁掉所有位置数学**。没进过视口的段落只有 2em 的估算高度，跳进章节中间时整章高度是假的 → 进度、页码、剩余时间、位置恢复全错。已从 `.chapter-content p` 删除，**别再以“性能”名义加回来**。
2. **`pagehide` 的强制保存会把好进度写成 0**。现在两条规则：恢复窗口内（`restoring`）连 force 都不写；没滚动过却是 0、而已有进度时，不覆盖。
3. **`new-chapter.js` 曾会覆盖第一章**。原因是它用正则解析 `CHAPTERS`，条目加了 `date/seal/leaf` 后失配 → 章号算成 1。已改为 `vm` 求值 + 目标文件存在即中止。
4. **改了 HTML 的 `?v=` 但没升 `CACHE`**，旧 `?v=` 缓存永不失效。这是“我分明发了版还是旧的”的头号原因。
5. **`a[download]` 在 WebView 里不可靠**，所以备份以「复制」为主路径，「存为文件」只在浏览器里出现。
6. **改 `.github/workflows/` 需要带 `workflow` 权限的 token**。当前 PAT 已带 `repo, workflow`（2026-10-25 更换），可以直接推；哪天换了新 token 又只勾 `repo`，这条坑会重现。
7. **`.mailmap` 不能让 GitHub 的 Contributors 面板消失**，它只影响本地 `git shortlog`。
8. 外层 `src|novels|dist` 是已退役的旧生成器（Windows 这台在 `E:/novel-site/`，Mac 上按本机 checkout 位置找）（`dist/.git` 已隔离），**别跑 `build.js`**，它有熔断会拒绝执行。

9. **全屏「点击翻页」层会吃掉正文里所有按钮**。`.reader-tap-area` 是 `fixed; inset:0; z-index:100`，
   三个分区 `pointer-events:auto` 把视口切成三块感应区 —— 摘句按钮、余韵卡的「分享这一章」、
   章末收束卡的三颗按钮全在它下面，手机上按下去只会翻页。现在 `initTapArea()` 里加了转发：
   点击时临时把分区让开一层取 `elementFromPoint`，命中可交互元素就 `target.click()` 并把这次
   点击拦下。**判据要按真实坐标点**：`el.click()` 和 `elementFromPoint` 都绕不过覆盖层，
   写着绿、手机上没反应（`tools/e2e.mjs` 的 `clickAt()` 用 `Input.dispatchTouchEvent` 真点）。
   另：分区自己是 `pointer-events:auto`，只把父层设 none 没用，子元素会重新启用命中。

10. **「底部断层」只有一个根因：留白落在了没有背景的层上**。全站出现过三次，同一种错：
    `body` 的底是 `--site-bg`，正文的底是另一层（阅读页 `--reading-bg` 纯色、其他页
    `.phone-frame` 上那层暖白纱），**两者不是同一个值**。于是只要留白落在外面，滚到底
    就露出一条不同的底色 —— 读者看到的就是一道横带。三次具体形态：
      - 收束卡用 `margin-bottom` → 塌出 `.reading-wrapper`（容器高度不含它）；
      - `.tab-page-body` 用 `padding-bottom: 72px` 给 tab 栏留位 → 这段只有 body 渐变；
      - 章节页 `body` 是站点渐变、阅读区是纯色 → 任何缝隙都是色差。
    现在的规矩：**留白必须落在有背景的那一层里面（用 padding，不用 margin），
    并且阅读页给 `body.is-reading` 铺阅读色兜底**。改动前先问一句「这段空白显示的是
    谁的背景」。`tools/e2e.mjs` 的「全站底部无缝隙」那 5 条断言就是守这个的：
    滚到底时 `.phone-frame` 的底边必须等于视口底。

11. **读「最后一个有进度的章」时，章名和百分比必须同源**。首页继续阅读卡曾把
    `lastReadPct` 攒在 `forEach` 外面的同一个变量里，而「已读完（`reader-done-*`）」的
    分支只换章、不更新它 —— 于是第七章读完时，卡片显示「第七章·余响 / 已读 22%」，
    22% 是第六章残留的旧值，看着像第七章只读了 22%。现在的写法是**每章各自算出
    `pct`（`done` 直接算 100），再把章和 pct 一起记下**，不共用累积变量。
    - 注意语义：取的是**章节顺序**里最后一个有痕迹的章，不是**时间上**最近读的章。
      存储里只有百分比、没有时间戳，所以「读完第七章后又去翻第四章」时卡片仍指着第七章。
      真要按时间就得在 `saveProgress` 里记一条 `reader-last = {id, at}`，目前没做。
    - `tools/e2e.mjs` 的「首页 · 继续阅读卡」4 条断言钉住这件事：读完末章 = 100%、
      末章未读 = 前一章的真实百分比、新读者 = 第一章且不显示百分比。

12. **「网络优先」可能其实是「HTTP 缓存优先」**。`fetch(request)` 默认先读浏览器 HTTP 缓存，
    而 Pages 给 HTML 的 `max-age` 是 600 秒 —— 按返回键重新导航到 `/` 时，10 分钟内的旧 HTML
    被当成「网络响应」秒回，整页连同它引用的旧 `?v=` 脚本一起回到发版前。「强制刷新」用
    `/?r=时间戳` 绕过缓存后又 `history.replaceState` 抹回裸 `/`，正好把历史条目指回那条旧缓存，
    于是返回必踩。现在三处一律用 `cache: 'reload'` 发起 fetch（`sw.js` 的 `fetchFresh`、
    HTML 预缓存 `precacheRequest`、`index.html` 强制刷新的裸路径 heal）。**别把它改回普通
    `fetch`，也别只靠 pageshow 兜** —— 主现场是 HTTP 缓存重取，不是 bfcache（后者恢复的
    反而是刷新后的新实例）。代价是导航放弃 HTTP 缓存的零 RTT，正确性优先；弱网仍由
    `networkFirst` 的 500ms 超时与离线 catch 兜底，一分未动。

13. **`?v=` 才是本站的发版代数，`registration.update()` 不是**。发版单位是「`?v=` 全站 +1」
    （`tools/bump-assets.mjs`），而 `sw.js` 的字节大多数发版根本不动 —— 只靠 `update()` 永远
    发现不了「只改了 CSS/JS」的发版。所以版本检查是**拉当前页 HTML 比对 `?v=N` 最大值**
    （`js/announce.js` 的 `checkSiteUpdate`），`update()` 只作免费补充。节流 10 分钟一次、
    回到前台才查、查到新版**只弹「有新版本 · 点此刷新」、点才 `location.reload()`**，
    绝不打断读者的位置（bfcache 恢复是例外，直接换新）。最坏陈旧上界 ≈ 10 分钟，
    与 Pages 的 max-age 同量级；纯前台连续阅读期间不查，是有意的。

14. **页面级 `fetch(..., {cache:'no-store'})` 会被 SW 的 `cacheFirst` 拦下、用旧缓存糊弄**。
    版本检查正依赖这个 fetch，所以 `sw.js` 的 fetch 事件里对「非导航 + 显式 no-store/reload」
    的请求必须**直接放行网络**。改 `cacheFirst` 策略时别把这条规则删掉，否则版本检查会
    永远看不到新版（自证式地永远是「没有更新」）。

15. **页面切换动画「一本书 → 翻开 → 封面放大 → 进入」：已按用户要求全站停用**。
    用户原话：「算了，我不要这个动画效果了。我只需要你做一件事，进入阅读页，不要有
    明显的卡顿，可以不要动画。」—— 要的不是「更快的动画」，是「没有动画」。
    停用前用 headless Chrome + CDP 实测（390×844，首页点 `.date-item` → chapter-01）：
      - 点下去 → 浏览器真正开始导航 **481ms**（`transition.js` 的 `exitDelay` 430ms）；
      - 章节页遮罩把正文压在下面，直到文档开始后 **708ms** 才退干净
        （`enterHold` 170 + 淡出 190 + 阅读器五层 JS 初始化）；
      - 而章节页自身 **FCP 112ms / DCL 412ms / 长任务 0 个**。
    结论：阅读页本身不慢，「卡」的全部来源就是这两段等待，合计约 1.2s。
    停用后同一次点击：**等待 4ms**、FCP 28ms、DCL 217ms、长任务 0 个、DOM 里没有遮罩。

    **停用方式（重要：别把它当"漏接线"再补回来）**
      - `index.html` / `novel/index.html` 的内联 `PageTransition.init(...)` 已摘掉，
        各页原配置以注释形式留在原位，恢复时放开注释即可；
      - `js/reader.ui.js` 的 `initPageTransition()` **连函数带调用点**一起删除 ——
        只摘调用会留一个没人用的函数，下一个人会以为「只是忘了接线」；
      - `novel/index.html` 里那个写死早期叶子结构的静态 `<div id="pageTransition">`
        也删了。留着它，遮罩元素照样在 DOM 里，只是永远不会被激活 ——
        既让「进页零等待」的断言无法成立，又让结构停留在废弃版本；
      - `js/transition.js` 与 `css/style.css` 的 `.page-transition` / `.book-*` **刻意保留**：
        `novel/chapter-*.html`、`novel/characters.html`、`novel/character-*.html` 等
        30+ 个生成页的 `<script>` 还引用它，删文件必须重新生成全站，风险与收益不成比例。
        本模块在被 `init()` 调用前不产生任何 DOM、定时器或监听，保留的代价只有一次
        静态请求。文件头已写明「当前已停用 / 如何重新启用」；
      - `js/reader.ui.js` 的 `initChapterSwap()`（捕获阶段接管章节链接）**必须留着**：
        它原来抢的正是 transition 的整页转场，现在照样要抢 —— 不抢就整页跳转，
        白屏 + 丢滚动位置，比动画更糟；
      - `sessionStorage['page-transitioning']` 的历史遗留标记现在无人消费，已由 e2e
        断言确认「不产生任何遮罩」；**不为此写迁移代码**（随 session 自然过期）。

    **若将来重启过渡，下面这些弯路结论仍然有效（停用不推翻它们）**
      参照 `CodeMyUI/book-opening-animation` 与 scastiel 的 3D 书（cover + pages
      的结构），FLIP 那套 hero 反演已弃用。最终序列曾是：屏幕中央立起一本带书口
      厚度的 3D 书 → 封面绕书脊抬起一角 → 整本书放大、**封面图本身**铺满全屏 →
      跳转 → 封面淡出揭示正文。
      - **别从点击条目 FLIP 起飞**。书架/目录是文字列表，从一行字上长出封面很怪；
        用户要的是「从一本书」开始 —— 书固定立在屏幕中央，翻开与放大的运动
        本身就是叙事。
      - **别用 `backface-visibility` + `preserve-3d` 双面翻书**。headless 与无 GPU 的
        WebView 下 backface 剔除不生效，翻过去露出的仍是封面，看着像没播。
      - **铺满全屏的必须是封面图，不是「翻过来的内页」**。内页做成空白纸（哪怕
        加假行文）看起来就是「一个奇怪的空白页面」，用户否过两次。
        `.book-page` 现在只是留口子的空元素，永远 opacity: 0。
      - **遮挡别用 `background-color` 动画**。那是绘制属性，每帧重绘整屏，顿挫比
        旧叶子遮罩还重。纯色遮挡必须走 `opacity`（合成层）。
      - **阴影别挂在容器上**。挂在 `.book` 上的话，封面走后还剩一个带阴影的空壳卡片。
      - **别靠「某个类存在时才隐藏」来藏元素**。摘类瞬间会漏（正文上闪出半透明封面）。
        要让元素默认不可见、动画让它可见，而不是反过来。
      - **别用 ease-out 短时长**。前段冲太快，260ms 内一瞬铺满，读者只看到「闪一下」。
        430ms + 前段放慢（30% 才到 0.72 倍）才看得出「一本书立起来再放大」。
      - **最该先想清楚的是「这段等待值不值」**。本轮就是因为它对「进阅读页」这个最高频
        动作收了约 1.2s 的过路费而被停用。重启前先量一次 `click → 开始导航`。
    跨页只能拆「出场放大铺满」+「入场淡出揭示」两段（真共享元素要 View Transitions
    API 或 SPA，Chrome 126+ 的 `@view-transition { navigation: auto }` 可以，但
    WebView 版本不保证），用 sessionStorage 标记衔接。
    `tools/e2e.mjs` 的「页面切换 · 过渡已停用（进阅读页零等待）」是**反向断言**，
    守新行为：首页/章节页都不许出现 `#pageTransition`，点章节链接不许出现 `flip-out`、
    且必须在 50ms 内开始导航。谁把 `init()` 或静态遮罩加回来都会立刻变红。

## 远程开关（出问题时先关功能，别回滚整站）

`flags.json`，不缓存，改完 push 一分钟生效，**不用发版也不用升 `?v=`**：

| 开关 | 关掉 | 用途 |
|---|---|---|
| `autoscroll` | 自动滚屏按钮隐藏且拒绝启动 | rAF 滚动出问题 |
| `readingAids` | 设置里「阅读辅助」整组隐藏 | 正文装饰出问题 |
| `anchorRestore` | 退回按百分比恢复（会偏但能读） | 锚点算错 |
| `backup` | 「阅读数据」整组隐藏 | 导入导出出问题 |

约定：拉不到就全开、用的时候才问 `isOn()`、只认 boolean。新增开关要同时改 `reader.flags.js` 的 `DEFAULTS`、`flags.json`、`applyFeatureVisibility()`。

## 阅读器操作（键盘 / 桌面）

手机靠点按与左右轻扫；桌面和外接键盘走 `reader.ui.js` 的 `initKeyboardNav()`：

| 键 | 行为 |
|---|---|
| `←` / `H` | 上一章 |
| `→` / `L` | 下一章 |
| `D` | 目录 |
| `T` | 夜读切换 |
| `?` | 快捷键提示 |
| `Esc` | 逐层关闭面板，最后收起工具栏 |

- 换章直接取 `.prev-ch` / `.next-ch` 的 href，与轻扫同一条链路，不另开导航；
  首章/末章只给一句 toast，不做假跳转。
- 任何面板打开时键盘完全不响应（`Esc` 除外），避免边看目录边被翻页。
- 空格、PageUp/PageDown、Home/End 不拦，交给浏览器默认滚动。
- 点上半屏上翻、中间显示工具栏、下半屏下翻（`.reader-tap-area`）。这一层盖在正文之上，
  所以点击会先转交：命中 `a[href] / button / .quote-mark` 就交给它，不翻页。
  转发出来的 click 不触发 `:active`，按下时临时打 `[data-press]` 补手感。
- 换章 = 「接上下一章」（`appendNext()`）：往下滚到离页底 900px 自动把下一章接到
  `#readingFlow` 末尾，2200px 处只预取 HTML 不插入；底部工具栏的上一章/下一章、
  键盘 `←→`、左右轻扫、目录、摘句「回到这一页」全部走 `navigateToChapter()` /
  `goToChapter()` 这一条链路。正文流里的「上一章/下一章」按钮已删除，
  章末的「一章一句」（`.chapter-afterglow`）就是接缝。
- 探测线（视口上方 15%）换块时，`syncBlockChapter()` 先把上一章按上一帧位置落盘，
  再换 `chapterId`、`replaceState` 改 URL、同步标题/顶栏/上下章链接。顺序反了
  上一章的进度就会被写成新章的值。
- 进度、锚点、剩余时间、页码全部按「当前章块」算，不再按整页 `scrollHeight`。
  一条 `reader-pos-<章>` 只记一章，接多少章都不会互相覆盖。
- 接续失败只是「这一章晚点再来」：保留正文，下一次滚动重试，不整页跳走。
- 往上同样接：滚到章首继续上滑（`prependPrev()`）把上一章插到链首，并以「正在读的那一块」
  为锚把滚动位置补回去——插入前后那一行必须停在原地。**触发要求真实手势**
  （900ms 内 `wheel deltaY<0` / 手指往下拖 / `↑` `PageUp`）：只按「y 变小」判断会被
  加载时的滚动恢复骗到，凭空插一章进来。
- 键盘 `←`、底部「上一章」、目录跳上一章：链里没有就插到上方并落位到它的开头；
  这种情况走 `settle`，不再做补偿（两次滚动会打架，人会被带过头一整章）。

### 章末收束卡（只长在最后一章）

`syncCoda()` 在 init / 接章 / 换章之后各跑一次，逻辑只有三步：先摘掉所有
`.chapter-coda`，再看链尾是不是最后一章，是就往那一块末尾补一张。要点：

- **不写进 chapter-0N.html**。章节页是生成物；而且无限流下「最后一章」是动态的
  （可能首屏就是它，也可能滚到才接上来，往回接块还会换链尾），写死就得到处同步。
- 卡片承担三件事：全书章数/字数、末章更新时间、两个出口（催更 / 读完了回目录）。
- 更新时间来自 `js/chapters.js` 的 `updated: 'YYYY-MM-DD'`（**不是**故事内 `date`）。
  显示成 今天 / 昨天 / 10月25日，跨年才带年份；漏填只是不显示那一行。
  注意 `updated` 是「读者看得出正文变了」的日期——重排、改样式**不要**跟着改，
  否则一次结构迁移就会把七章全刷成当天。
- 催更计数**双轨**：本机 `reader-nudge` 记 `{count, at}`（离线也不丢反馈），
  同时打到 Abacus 的计数器做全站总数 —— `abacus.jasoncameron.dev/{get,hit}/zephyrw.site/linyuan-nudge`。
  免注册、CORS 全开、30 次/10 秒限流、单次约 2 秒。按钮的两种说法别混：
  **「共 N 次」是服务端总数**（所有人共享），**「第 N 次」是你本机点了几次**。
  接口挂了一律安静降级回本机，绝不因为第三方不可用就让按钮失效。
  - 这是**装饰性计数**：知道 namespace/key 的人都能读写，别当统计用。要清零就换 key 名。
  - `tools/e2e.mjs` 里注入了 fetch 拦截，测试和 CI 不会真去 hit，否则每次跑测试都刷数字。
- 「写给作者 →」只做一件事：复制「你的读者求加更！」+ 唤起 QQ。落点由 `reader.ui.js`
  顶部的 `AUTHOR_QQ` 决定：**留空 → QQ 主界面（`mqq://`）**，填号 → 直达聊天
  `mqqwpa://im/chat?chat_type=wpa&uin=<QQ>&version=1&src_type=web&web_src=oicqzone`。
  现在**留空**，站点上不暴露任何作者账号，读者落到 QQ 自己搜。
  QQ 不提供预填消息的参数，所以「先复制、进去粘贴」是唯一可行路径。
  - 唤端用**隐藏 iframe**而不是 `location.href`：桌面浏览器遇到没注册的协议时，
    location 赋值可能把整篇小说顶成「无法打开页面」，iframe 失败只是静默无事发生。
  - 跳没跳成只能靠 1.6 秒内页面有没有失焦/切后台来猜 —— 微信内置浏览器会拦跳 QQ、
    没装 QQ 也不会响应，这时提示「文案已复制 · 到 QQ 里粘贴」。
  - `href` 就是 scheme 本身（不是 `#`），JS 万一没加载，直接点也还能唤端。
  - 别再把它改回 `target=_blank` 跳 issue/网页 —— 手机端会掉进登录页或空白页。
- 「读完了 · 回目录」是普通 `<a href="index.html">`，只顺手写一笔 `reader-finished`。
  不拦跳转，也不做「确定吗」的二次确认。

## 还没做的（带理由，不是待办清单凑数）

| 事项 | 建议时机 | 理由 |
|---|---|---|
| 老面板（目录/设置/摘句/备份）从 innerHTML 迁到 `el()` | 下次真要加界面时 | 纯内部质量，无用户可见收益；且 114 项断言测行为不测像素，风险兜不住 |
| `ui.js` 再拆出 `panels.js`（纯移动） | 想拆随时可做 | 风险低，但也没收益；`ui.js` 2552 行目前还能忍 |
| 选中文字气泡工具条（摘句/复制/搜索） | 想加功能时的首选 | 唯一“既有用户价值、又顺手带出 `el()` 迁移”的一步 |
| 全书搜索 | 章节多了以后 | 现在只有 7 章，索引成本大于收益 |
| 章节块回收（超出 ±3 块就移除并留占位高度） | 章节数 > 20 时 | 现在一次最多接 7 块，没有内存/滚动压力；提前做只会引入新的位置漂移 |
| 「继续阅读」改按时间取（记 `reader-last = {id, at}`） | 章节多了、读者开始跳读时 | 现在按章节顺序取最后一个有痕迹的章，读者跳回去重读旧章时卡片仍停在后面的章。要改就得在 `saveProgress` 每次落盘时多写一条，并且老数据要回退到扫描，收益还不明显 |
| 催更数据回传（真正统计「多少人催过」）| 只有确实想统计时 | 本机次数 + Abacus 总数已经能表达「有人在催」，但 Abacus 是装饰性计数（知道 key 就能改），不能当数据。真要统计就得换成能写库的端点 |
| TTS 听书 | 已决定不做 | WebView 里 `speechSynthesis` 在国产 ROM 上不稳；走原生桥要发 APK，而读者是来看字的 |

## 当前验证状态

- 本地：`node tools/e2e.mjs` 116/116；pre-push 5 项通过（?v= 统一 / 预缓存 / 楷体覆盖 / 源稿一致 / 安装包校验）
  - 本机没装 Chrome/Edge 时用 `CI=1 CHROME_BIN=<chrome-headless-shell 路径> node tools/e2e.mjs`
    （`CI=1` 才会加 `--no-sandbox`，容器/沙箱里不加必然起不来）
  - 116 = 上一版 114 + 2（「按下就亮细线 / 细线不拦点击」，2026-10-27 加）；
    那 114 = 原 110 − 2（翻书 DOM 钩子 / `flip-out` 两条正向断言）+ 6（「过渡已停用」的
    反向断言：首页无遮罩 / 点击不播过渡 / 50ms 内开始导航 / 章节页无入场遮罩 /
    正文已渲染 / 遗留标记无副作用）
- 进阅读页耗时（2026-10-26，停用过渡后实测）：点章节链接 → 开始导航 **4ms**（改前 481ms），
  章节页 FCP 28ms / DCL 217ms / 长任务 0 个（改前 112 / 412 / 0）
- 同学录专项（2026-10-24，无头 Edge 实测）：17 张卡片 + 2 个分组；点立绘弹灯箱且不跳页，
  点卡片其它位置跳详细页；详细页内容齐全；页脚不被 tab 栏遮挡；浅/深主题截图正常
- CI：`verify` 每次 push 都跑（五项静态校验 + 端到端）

## 2026-10-27 底部 tab 对比度回归修复

| 项 | 内容 |
|---|---|
| 提交 | `e215161`（已推送 main） |
| 文件 | `css/style.css` 的 `.tab-item` |
| 改动 | `color: var(--text-muted)` → `color: var(--text-secondary)`（#756654 → #6e5f4f） |
| 原因 | Mac 端「修底部断层」换了背衬色，实测 tab 栏底色变成 `#f1e6d6`，11px 文字掉到 **4.49:1**（门槛 4.5），对比度审计报 12 项未达标（四个 tab × 多页） |
| 验证 | 对比度 **12 → 0**（实测 4.99）；e2e 114/114；`?v=` 110 → 111 且 `--check` 报「版本号统一」；预缓存 / check-apk / 源稿 全绿 |

教训：**改背衬色等于改所有压在上面的小字对比度**。同一处颜色别只看「好不好看」，
改完必须跑 `node tools/contrast-audit.mjs`——它是拿真实渲染色算的，不看 CSS 变量名。

### 本机 git 操作的两个坑（2026-10-27 实测，Windows）

1. `git reset --hard` / `git checkout origin/main -- .` 会被 **SIGTERM 杀掉**，并留下 `.git/index.lock`，
   之后所有写操作都失败（报 `Another git process seems to be running`）。
   **先 `rm -f .git/index.lock`**，再**按目录分块** `git checkout origin/main -- js css tools novel assets app manuscript .github .githooks docs`，
   最后 `git update-ref refs/heads/main $(git rev-parse origin/main)`。
2. 漏掉 `docs/` 会让它在 `git status` 显示为已删除（`D`），补一句 `git checkout HEAD -- docs/` 即可。
3. `git push` 若报 `schannel: CRYPT_E_NO_REVOCATION_CHECK`，那是证书吊销检查失败（不是没外网），
   用 `git -c http.schannelCheckRevoke=false push` 即可；代理本身要通（HTTP 代理走 `CONNECT`，
   `curl --ssl-no-revoke` 能验证）。

## 2026-10-27 · 令牌移出 .git/config + e2e 不再挂死

### 令牌不再写在 remote URL 里

原来 `git remote origin` 的 URL 是 `https://<user>:<PAT>@github.com/...`，令牌明文躺在 `.git/config`：
整个仓库目录拷给别人、打包、截图排障、`git config -l` 一下就全出去了。现在改成：

```
remote.origin.url = https://3036615505-ops@github.com/3036615505-ops/3036615505-ops.github.io.git
```

只有用户名（不是秘密），密码交给 **Windows 凭据管理器**（Git Credential Manager 2.9，系统级
`credential.helper=manager`）。验证方式：`git push` 正常、`git config --local -l | grep ghp_` 为空。

**这里踩到一个坑**：`.git/config` 里原本有一条空的 `credential.helper=`（等号后什么都没有）。
空值不是「没配」，而是**把凭据助手列表清空**——system 级的 `manager` 被它顶掉，于是 git 退回
终端提示，非交互环境直接报 `fatal: could not read Password`。删掉那一行就好了：

```bash
git config --local --unset-all credential.helper
```

另外 `http.schannelCheckRevoke=false` 已经写进仓库配置，以后不用每次带 `-c`。

### e2e 三层超时

之前 CI 的 e2e 会挂到 GitHub 6 小时上限才被 cancel，日志里只有一句 job cancelled。
现在：

| 层 | 机制 | 值 |
|---|---|---|
| CDP 命令 | `send()` 每条命令一个计时器，超时抛 `CDP <method> 超过 Nms 无响应（卡在「<小节>」）` | 20s |
| 整体 | 看门狗，超时打「卡在哪一节 + 已跑断言数 + 浏览器日志尾部」再按失败退出 | 7min |
| job | workflow `timeout-minutes`（e2e 15 / 步骤 10 / 静态 5） | 15min |

另外：WebSocket 连不上原来也是无限等（`ws.onopen` 没有超时），现在是 15s 报错；
每个 `section()` 会打当前耗时（`+128.1s`），CI 上哪一节慢一眼能看出来。
本机基准：**114/114，147.7s**。

### 挂死的真凶（首轮定位结果）

加了超时之后第一轮 CI 就抓到了：**`Input.dispatchTouchEvent` 在「末章收束卡」那一节永远不回包**。
以前没有超时 → 一直等 → 6 小时被 cancel。现在 `clickAt()` 的处理顺序是：

1. 先发一次 `touchCancel` 冲掉上一次没被 ack 的触摸序列（3s，失败不报错）
2. 正常 `touchStart` / `touchEnd`（各 8s 超时）
3. 还是没响应 → 退回 `mousePressed` / `mouseReleased`，并在日志里打 `↷ 触摸事件无响应，退回鼠标点击`

鼠标那条路同样是「按坐标命中真实元素」，覆盖层照样挡得住，断言要验的东西没变。
`E2E_CLICK_MODE=mouse node tools/e2e.mjs` 可强制走降级路径自测。

两条路都本机验证过：touch **114/114 / 147.8s**，mouse **114/114 / 147.6s**。

### 结果（CI 首次跑绿）

| 指标 | 改前 | 改后 |
|---|---|---|
| e2e 在 CI 的结局 | 挂到 6 小时被 cancel（历史 4 次全是 361min） | **success** |
| 整个 verify 用时 | 361min（等于没结果） | **3.2min** |
| 断言 | 从未在 CI 跑完过 | **114/114，156.1s** |

CI 上那一次触摸仍然无响应（`Input.dispatchTouchEvent` 超 8s），日志里能看到降级那行：

```
↷ 触摸派发无响应，改用坐标命中的脚本点击：CDP Input.dispatchTouchEvent 超过 8000ms 无响应（卡在「末章收束卡」）
· 脚本点击命中：button.reader-tap-zone
```

也就是说：**焦点模拟没能解决这条无头 Chrome 的输入通道问题**，兜底那一层在顶着。
真要根治得换驱动方式（Playwright / puppeteer 的输入封装），那是另一件事，先记着。

### verify.yml 的 timeout-minutes（已推）

第一次推被 GitHub 拒绝：`refusing to allow a Personal Access Token to create or update workflow`，
原因是旧 PAT 只有 `repo` 没 `workflow`。换成带 `repo, workflow` 的 PAT 后正常推上（2026-10-27）。
真正生效的是：e2e job 15min / e2e 步骤 10min / 静态校验 5min，步骤名也去掉了过期的「38 项」。
注意：**改 workflow 文件必须用带 `workflow` scope 的凭据**，否则整笔 push 会被拒，不只是这一个文件。
## 2026-10-27 · 过渡停用后暴露的「空窗期」（点击像卡住）

**现象**：用户反馈「删掉加载动画后，点击之后页面不动了，像卡住了」。
**实测**（4G 节流 150ms RTT / 1.6Mbps，390×844，首页点 `.date-item` → chapter-01）：

| 指标 | 数值 | 含义 |
|---|---|---|
| TTFB | **524ms** | 导航 HTML 走 networkFirst + `cache:'reload'`，每次都要真网络 |
| 首绘 FCP | **884ms** | 这 0.9 秒里屏幕上**没有任何变化**，所以「像卡住」 |
| 命中缓存那次 | ~100ms | 快的跳转反而不能加遮罩，会闪 |

**三处改动**：

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

**配套**：`sw.js` PRECACHE 加 `/js/nav-feedback.js`、`CACHE v59 → v60`；`?v= 111 → 112`；
`new-chapter.js` 模板同步（否则下次生成的章节页又退回同步 announce）；
e2e 加 2 条断言钉住「按下即亮线 / 不拦点击」，**114 → 116**。

**没做**（有明确代价，先不碰）：导航改「缓存优先 + 后台校验」能省掉那 524ms，
但会把之前修过的「返回首页看到旧版」放回来 —— 要动得连更新提示一起重新设计。

## 2026-10-27 · 新增人物：沈若栖

作者给了人物小传（`沈若栖.md`），要求放在**叶羽澜前面**。

- 只改了 `js/characters-data.js`（唯一数据源），然后 `node tools/make-characters.mjs` 重新生成 ——
  列表页 18 人、详细页 `novel/character-shenruoqi.html`、sitemap 29 条、PRECACHE 登记、`CACHE v60 → v61`
- `slug: 'shenruoqi'`，`group: 'qiaomu'`（26 岁咖啡店主，属长辈/成人组），数组里紧挨在 `yeyulan` 前面
- 立绘先用 `initial: '沈'` 占位上线；当天补了 AI 生成立绘（见下一节）后改为 `portrait: 'portrait-shenruoqi-1024.webp'`
- 人设取小传原文：上海广告公司三年 → 四十八楼落地窗前那句「我又游向哪里呢？」→ 回南城开「临渊羡鱼」

### 沈若栖立绘（AI 生成，2026-10-27）

现有 17 张是作者给的定稿母版；她这一张没有，用 AI 生成补齐，要求是**风格必须与既有立绘一致**。

做法：
- 先把 `portrait-yeyulan` / `portrait-linxihe` 两张当风格样本描述出来：钢笔淡彩水彩、米白奶油+琥珀金的暖秋配色、
  逆光散景、胸像构图、柔和边缘+纸张纹理 → 作为 prompt 的风格段
- 内容按人小传：低髻碎发、洗旧的靛蓝亚麻围裙（下摆一块咖啡渍）、米色针织毛衣、眼角浅笑纹、松弛温柔
- 用户追加要求「要有梧桐树和咖啡店的暖意元素」→ 背景给到：窗外的金黄色梧桐枝叶与斑驳树影、灯串、
  咖啡机与杯子、窗边绿植、秋日午后逆光
- 生成 1024×1024 → **裁掉底部 64px**（站点母版是 1024×960，同时正好切掉工具自带的
  「AI生成 WorkBuddy」水印；水印固定在右下角，裁完无残留，已逐行核验）→ WebP quality 80 = 163.5KB
  （既有母版区间 80~185KB）

流程照旧：母版丢进 `assets/` → 数据里补 `portrait` → `node tools/make-characters.mjs`
（自动生成 128×150 缩略图、登记 PRECACHE、`CACHE v61 → v62`、刷新 sitemap）。

**注意**：AI 立绘是「风格贴合」，不是作者的手绘母版。作者日后想换成自己的画，直接替换同名 webp 再跑生成器即可，
其它地方一个字都不用改。

## 2026-10-27 · 人物分类加「青枝」

作者要求：在「新叶」和「乔木」之间插一组「青枝」，把**桃夭夭 → 肖灼 → 沈若栖 → 叶羽澜**按这个顺序放进去。

- `js/characters-data.js`：四人 `group` 由 `qiaomu` 改 `qingzhi`，并把条目整体搬到新叶之后、乔木之前
  （**列表页的显示顺序就是数组顺序，同一 group 必须连在一起**，否则会重复打印分组标题）
- `tools/make-characters.mjs`：`GROUP_NAMES` 加 `qingzhi: '青枝'` —— 这个映射是白名单，
  漏了会渲染出 `undefined` 当标题
- 结果：新叶 7 / **青枝 4** / 乔木 7，共 18 人；分组标题样式沿用 `.char-group-label`，无需改 CSS
- 数据文件头部的 group 字段说明同步更新（写清三个取值 + 「同组要连着写」这条约束）
