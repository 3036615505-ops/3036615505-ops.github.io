# 临渊羡鱼 · 站点仓库

纯静态站点（HTML/CSS/JS + Service Worker），部署在 GitHub Pages，被一个 Android WebView 壳加载。
线上地址：<https://zephyrw.site>

```
index.html            首页（梧桐进度带 / 光阴目录 / 金句轮播）
novel/index.html      书架（目录 + 阅读进度）
novel/chapter-*.html  章节页
novel/characters.html 人物
quotes.html           剪贴本
css/style.css         全站样式（含浅色 / 深色两套令牌）
js/chapters.js        章节数据（唯一数据源，加章节只改这里）
flags.json            线上功能开关（不缓存，改一行即生效，见下）
manuscript/           章节源稿（原文快照，push 前与章节页逐字比对）
js/reader.flags.js    阅读页 · 远程开关客户端
js/reader.dom.js      阅读页 · DOM 工具（el/text，替代手拼 innerHTML）
js/reader.store.js    阅读页 · 存储层（所有 localStorage 读写的唯一入口）
js/reader.engine.js   阅读页 · 引擎（位置锚点、恢复、自动滚屏、阅读计时）
js/reader.ui.js       阅读页 · 界面层（面板、主题、字体、状态条、阅读辅助）
js/reader.js          阅读页 · 入口（按顺序装配上面四个模块并启动）
js/transition.js      页面切换过渡（全站唯一实现）
js/theme.js           主题 + Service Worker 注册
js/types.d.ts         共享类型声明（只给 JSDoc / 编辑器用，不产出代码）
jsconfig.json         类型检查配置（npx tsc -p jsconfig.json --noEmit）
sw.js                 Service Worker
tools/                开发/校验脚本（不参与页面运行）
.github/workflows/    服务端校验（每次 push 跑四项静态校验 + 端到端）
app/                  安装包与 version.json（SW 不拦截，直连网络）
```

## 发版前必须做的一件事：升 `?v=`

`sw.js` 的 `cacheFirst` 是**命中就返回缓存**。让新 CSS/JS 生效靠的是 URL 里的版本号：

```bash
node tools/bump-assets.mjs --write   # 扫描 6 个 HTML，取最大 ?v= +1，全站统一替换
```

漏了这一步，用户最长要吃一天旧缓存（`sw.js` 里 24h 的 TTL 自愈才会兜回来），
所以**别靠记性**——把下面的 pre-push hook 打开，漏了会被直接拦住。

## 一次性启用 pre-push 校验（每个 clone 做一次）

```bash
git config core.hooksPath .githooks
```

启用后每次 `git push` 会先跑：

| 检查 | 脚本 | 拦住什么 |
|---|---|---|
| 全站 `?v=` 是否统一 | `node tools/bump-assets.mjs --check` | 有人拿到旧 CSS/JS（混版缓存） |
| PRECACHE 条目是否都存在、脚本引用是否齐全 | `node tools/check-precache.mjs` | SW 预缓存里放了一条 404 |
| 楷体子集是否覆盖正文 | `python tools/make-kai-subset.py --check` | 新章节用了子集里没有的字，显示成豆腐块 |
| 章节正文与源稿是否一致 | `node tools/manuscript-sync.mjs` | 正文被误改而没人发现 |

任一失败会**阻止 push** 并打印修复命令；hook 只做拦截，不改你的文件。
没装 Node 的环境会打印提示并放行（不会把 push 卡死）。
紧急情况下可 `git push --no-verify` 跳过——但不建议养成习惯。

## 线上开关：出问题时先关功能，别回滚整站

`flags.json` 是不缓存的静态文件（SW 明确放行），改完 push 最多一分钟生效，
**不需要发版、不需要升 `?v=`**：

```json
{
  "flags": {
    "autoscroll": true,
    "readingAids": true,
    "anchorRestore": true,
    "backup": true
  }
}
```

| 开关 | 关掉之后 |
|---|---|
| `autoscroll` | 工具栏「自动」按钮隐藏，直接调用也只弹一句「暂时关闭」 |
| `readingAids` | 设置里的「阅读辅助」整组隐藏，开关调用被拒 |
| `anchorRestore` | 位置恢复退回按百分比（会偏一点，但能读） |
| `backup` | 「阅读数据」整组隐藏，弹窗入口被拒 |

三条设计约定：**拉不到就全开**（开关是止血工具，不能反过来影响可用性）；
**用的时候才问**（1.5 秒后才到的值立刻生效，不用刷新）；**只认 boolean**
（写 `"false"` 字符串不算关）。新增功能时把名字加进 `DEFAULTS` 与 `flags.json`。

## 章节源稿：manuscript/

`manuscript/chapter-NN.md` 是每一章的原文快照，由 `new-chapter.js` 在生成章节页时
一并写入。push 前会拿它和 `novel/chapter-NN.html` **逐字比对**（忽略空白），
不一致就拦住并打印第一个差异点：

```bash
node tools/manuscript-sync.mjs                        # 校验
node tools/manuscript-sync.mjs --verbose              # 附带每章字数
node tools/manuscript-sync.mjs --write --only chapter-02   # 有意改文后重新生成快照
```

为什么要有它：上周有一段正文被误改（「找我自己」那句），git 只能证明文件变了，
证明不了原文是什么。有了源稿，这类改动才有据可查。

## 改了阅读器之后：跑一遍端到端测试

阅读器的关键逻辑全是布局数学（位置锚点、进度百分比、页码、剩余时间、自动滚屏），
在假 DOM 里测没有意义，所以测试直接开无头 Chromium 驱动真页面：

```bash
node tools/e2e.mjs            # 22 项断言，约 40 秒；失败退出码 1
node tools/e2e.mjs --verbose  # 顺带打印每项的实际值
```

它会自己起静态服务器（默认 8765，可用 `--port` 改）、自己找本机 Chrome/Edge、
跑完自清理。**没有浏览器或 Node < 22 时打印提示并 exit 0**，不会卡住 push。
覆盖：init 与存储迁移、锚点写入/恢复（±6%）、改字号不跑位、目录/摘句/设置面板、
主题三处同步、自动滚屏四条路径、备份导出/导入、书架页指标、全程无未捕获异常。

类型检查（JSDoc，不产出文件；VS Code 打开即有波浪线）：

```bash
npx -p typescript tsc -p jsconfig.json --noEmit
```

## 服务端校验（GitHub Actions）

`.github/workflows/verify.yml` —— 每次 push / PR 跑两个 job：

| job | 内容 |
|---|---|
| 静态校验 | ① `?v=` 统一 ② 预缓存条目 ③ 楷体子集覆盖 ④ 正文与源稿一致 |
| 端到端 | 27 项真浏览器断言（ubuntu 自带 Chrome，`CI=true` 时自动补 `--no-sandbox`） |

为什么还要 CI：pre-push 钩子只在**配过 `core.hooksPath` 的那个 clone** 里生效。
换台机器（比如 Mac 上）改完推上去，一项都不会跑；CI 在服务端跑，谁的机器都一样。

首次运行 28 秒（2026-10-24，run #1 通过）。两点提醒：

- 改这个文件需要带 `workflow` 权限的 token，当前 PAT 没有 —— 要么重签，要么在网页端编辑；
- `tools/e2e.mjs` 在 `CI` 环境下找不到浏览器会**直接失败**（本地才跳过），避免"假绿"。

## 其它工具

```bash
node tools/contrast-audit.mjs                 # 4 个页面 × 浅色/深色 的文字对比度审计（WCAG）
node tools/contrast-audit.mjs --min 4.5       # 只列未达标
node tools/contrast-audit.mjs --theme dark    # 只看深色
node tools/contrast-audit.mjs --inject ':root{--text-muted:#756654}'   # 不改仓库，试一个令牌取值
node tools/bump-assets.mjs                    # dry-run，先看版本号会变成什么
node new-chapter.js <原稿.md>                  # 从 Markdown 生成新章节（见脚本头部注释）
```

对比度审计不读 CSS 的 `background-color`（本站底色大量是渐变叠加，读到的是透明），
而是把文字临时置透明后**截图采样真实合成背景**再按 WCAG 相对亮度实算。

## 约定

- **阅读器的模块依赖是单向的**：`reader.js`（入口）→ `reader.ui.js` → `reader.engine.js` → `reader.store.js`，
  工具 `reader.dom.js` 谁都能用。每一层要调外层的东西时，在文件头声明同名 shim ——
  那份 shim 清单就是这个模块「依赖外部什么」的全部答案，不需要读别的文件去猜。
- **store 不认识 DOM，engine 不认识面板**。往 engine 里加面板代码、往 store 里加样式逻辑，
  都是在把刚拆开的边界重新糊上。
- 新写的界面用 `LY.dom.el()` 构建，不要拼 innerHTML；老面板下次改到时顺手换，不专门开重构。
- `js/chapters.js` 是章节的唯一数据源；加章节用 `new-chapter.js`，不要手改目录页。
- 深浅两套颜色令牌都在 `css/style.css` 的 `:root` / `[data-theme="dark"]` 里，
  新增颜色请走令牌，不要在组件里写死——深色主题的坑基本都来自写死的浅色值。
- 改 `sw.js` 的 `PRECACHE` 内容时，`CACHE` 版本号要一起 +1，否则老用户不会重新 install。
