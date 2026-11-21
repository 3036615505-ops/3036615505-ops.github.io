# 交接卡：Windows → Mac（2026-11-21 下午）

> 这是**当天交接用的临时真值卡**，不是长期文档。仓库里的 `HANDOVER.md`（停在 11-09）、
> `docs/CHANGELOG.md`（停在 11-09）、`README.md` / `PROJECT-OVERVIEW.md`（停在 11-01）
> 里的数字**已经过期**，今天下午以本卡为准。等这轮 Mac 维护结束，再把真值回填进
> `HANDOVER.md` 的一页纸表格并删掉本卡。

## 0. 一句话现状

Mac 工作副本 `~/linyuan-live` 已快进同步到 `origin/main` 的 `6ea177f`
（2026-11-20 21:35，Windows 端最后提交），工作区干净；pre-push 钩子已启用；
`npm run verify:all` 在本机全绿。下午直接在这个目录开工。

---

## 1. 真值表（2026-11-21 实测）

| 项 | 当前真值 | 旧文档写的（勿信） |
|---|---|---|
| 线上 | <https://zephyrw.site>，push 即发布 | 同 |
| 站点资源版本 | **`?v=147`**（全站 252 处引用，无混版） | `?v=131` |
| SW 缓存名 | **`linyuan-v95`** | `linyuan-v77` |
| 预缓存 | **51 项**（提交说明写 52，含 1 条动态项）；11-20 从 81 项 969KB 砍到约 52 项 433KB | 81 项 |
| 章节 | **11 章**（3043/2553/2074/2451/2013/2184/2022/2339/2134/2463/3240 字） | 7～10 章 |
| 人物 | 18 人，全部有立绘 | 同 |
| 内容契约 | `content/*.json`，70 项守卫通过：11 章 / 18 人 / manifest 逐字自洽 | 10 章 |
| APK | **v2.0.4 / versionCode 25**，226,662 字节（从 1.4MB 瘦到 0.2MB） | v1.9.3 / code 20 |
| 端到端 | 提交记录称 **187/187**；源码静态 `check()` 调用点 177 处（有循环展开，真实执行数需跑测试确认） | 179 |
| Node / Python | v22.22.2 / 3.13.12，均满足 | — |

`flags.json` 当前 7 个开关全开：`autoscroll` / `readingAids` / `anchorRestore` /
`backup` / `infiniteScroll` / `search` / `upgradeExportHint`。

---

## 2. Windows 端最近 5 个提交（Mac 之前没有的部分）

| 提交 | 日期 | 内容 |
|---|---|---|
| `ec758a5` | 11-17 | v7 视觉对齐层：页面边缘 24px / 卡片内边距 24px / 嵌套缩进 8px |
| `9ae91ec` | 11-18 | v8 视觉收编：圆角裸值 14/16/18 → 12/20，字阶 10/11px → 12px |
| `877a8c3` | 11-18 | v9 扫光骨架屏：脚本填充前的容器占位 + 只动 `transform` 的光带 |
| `dea810d` | 11-18 | 骨架屏调光：单峰对称渐隐，首页骨架高度收到 240 |
| `6ea177f` | 11-20 | **性能三批**（下面详述） |

### `6ea177f` 性能三批（下午改动时最容易碰到的部分）

1. **摘死脚本**：13 个页面 + `tools/chapter-template.cjs` 摘掉 `transition.js` 引用
   （模块早已停用，每页白背 7.1KB gzip）。文件保留在仓库，**不要当漏接线补回来**。
2. **图标重压**：icon-192 / icon-512 / apple-touch / favicon / og-cover 全部重压，
   生成器 `_design/app-icon/build-icons.py` 加了 `save_pwa()`。
3. **首页 LCP**：第一张树阶段图改静态 `src` + `fetchpriority=high`；若读者进度
   用不到这一帧，脚本立刻 `removeAttribute('src')` 取消请求。
4. **预缓存分层**：章节正文**刻意保留**（断网可读是底线）；3 张 1024 立绘、树
   s1–s5、18 个人物详细页、og-cover 改为运行时按需（cacheFirst 未命中走网络并写回）。
5. **注释外迁**：新增 `tools/compact-comments.py`，把独占整行且 ≥3 行的块注释搬到
   **仓库外** `_design/notes/<文件>.md`，代码里只留指针。**这是 Mac 端最大的信息缺口，见下。**
6. 实测：章节页 209→139KB / LCP 3260→2448ms；首页 170→122KB / LCP 1876→1332ms。

---

## 3. Mac 端特有坑（下午开工前必读）

1. **`_design/notes/` 在 Mac 上不存在。** 11-20 把 10 个文件（style.css、reader.ui.js、
   engine、store、flags、dom、lightbox、announce、native-bridge、chapters）的设计说明与
   踩坑记录搬到了 `os.path.dirname(repo)/_design/notes/`，即 **`/Users/zepher/_design/notes/`**，
   不在 git 里。现在代码头只剩「见 _design/notes/xxx.md」的指针，Mac 上点了没文件。
   → 下午要查历史决策，先从 Windows `E:/_design/notes/` 或 OneDrive 拷一份到
   `/Users/zepher/_design/notes/`；否则只能看 `docs/CHANGELOG.md` 与 `HANDOVER.md`（它们也停在 11-09）。
   **别对没有 notes 备份的机器再跑 `compact-comments.py --write`。**

2. **本机没有可用浏览器，e2e 会静默跳过。** `tools/e2e.mjs` 找不到 Chrome/Edge 时
   打印提示并 `exit 0`，本地跑出来"绿"是假绿。缓存里只有一个 **损坏的**
   `~/.cache/puppeteer/chrome/157.0.8103.38-chrome-mac-arm64.zip`（74MB，解压报
   central directory 找不到）。→ 要么装 Chrome/Edge，要么用 `CHROME_BIN` 指向可用内核；
   否则只能依赖 push 后 CI 里的端到端 job。

3. **APK 不能在这台打。** Android SDK、JDK 和签名密钥都在 Windows `E:/novel-site/twa/`，
   `twa/` 不在 git 里。Mac 今天只能改站点/样式/阅读器 JS；动到壳的改动要回 Windows 发包。

4. **内容契约 C3 种子包未落地**：`content:check` 会提示
   `/Users/zepher/twa/app/src/main/assets/content` 不存在并跳过，这是预期行为，不是失败。

5. **文档漂移**：今天看到 `HANDOVER.md` 说 10 章 / `?v=131` / v77 / e2e 179，
   都是 11-09 的旧值；README 和 PROJECT-OVERVIEW 更旧（7 章 / 44 项 e2e）。
   以本卡为准，别照旧数字判断"该不该 bump"。

---

## 4. 今天的开工 / 收工流程

```bash
cd ~/linyuan-live
git status -sb                 # 必须干净，且无 ahead
git pull --ff-only             # 分叉会报错，别硬合

# —— 改动 ——

npm run bump                   # 只要动了 HTML/CSS/JS：全站 ?v= 统一 +1（当前 147 → 148）
# 若 PRECACHE 里的字节变了 → 手动把 sw.js 的 CACHE 名 +1（当前 v95 → v96）
npm run verify:all             # 静态全量（本机已验证通过）
npm run typecheck              # 可选
git commit -am "..."
git push                       # pre-push 6 项 + CI 两个 job
```

**`CACHE` 的判据始终是「PRECACHE 里的字节变没变」，不是「改了哪个文件」。**
`?v=` 是全站单点，两台机器各自 bump 会撞号 → 顺序永远是 pull → 改 → bump → commit → push。

**紧急止血优先改 `flags.json`**：不缓存、push 后约一分钟生效，不发版、不升 `?v=`。

**回退 `6ea177f` 不要直接 `git revert`**（会连 `?v=` / `CACHE` 一起倒退）。
正确顺序见该提交说明：删 PRECACHE 新条目 → 恢复 13 个页面的 script 行 → bump → `CACHE` +1。

---

## 5. 本机环境已确认可用

- Node v22.22.2（项目要求 ≥22）
- Python 3.13.12（字体子集脚本可跑）
- git 身份 `3036615505-ops <3036615505-ops@users.noreply.github.com>`
- `core.hooksPath=.githooks` 已配置
- `npm run verify:all` 全绿：预缓存条目与脚本引用、11 章源稿逐字一致、
  APK/version.json 一致、内容契约 70 项、楷体覆盖 3925 字、ZCOOL 子集 20,984 B
- `git status` 干净，与 `origin/main` 同步
