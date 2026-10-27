# ⏳ 待推送：底部 tab 对比度修复（2026-10-27）

> 这份本应写进 `HANDOVER.md` 末尾，但 2026-10-27 19:06 该文件被某个进程独占（读写都返回 Permission denied），故先单列一份。**下次能写时把这个文件的内容并回 HANDOVER 末尾再删掉本文件。**

## 状态

已修好、已验证、**未推**。Windows 这台当时无出网路由：代理端口 `127.0.0.1:5389` 无进程监听，`1080` 上的 SOCKS 不可用，直连被封。

## 改了什么

| 项 | 内容 |
|---|---|
| 本地提交 | `e215161`（领先 `origin/main` 1 个提交） |
| 文件 | `css/style.css` 的 `.tab-item` |
| 改动 | `color: var(--text-muted)` → `color: var(--text-secondary)`（#756654 → #6e5f4f） |
| 原因 | Mac 端「修底部断层」换了背衬色，实测 tab 栏底色变成 `#f1e6d6`，11px 文字掉到 **4.49:1**（门槛 4.5），对比度审计报 12 项未达标（四个 tab × 多页） |
| 验证 | 对比度 **12 → 0**；e2e **114/114**；`?v=` 110 → 111；预缓存 / check-apk / 源稿 全绿 |

## 接续方式（二选一）

```bash
# A. 网络恢复后，在 Windows 这台直接推
cd E:/novel-site/3036615505-ops.github.io && git push origin HEAD:main

# B. 改由 Mac 端重做（与 A 等价；做完 Windows 本地那条丢弃即可）
#    css/style.css: .tab-item 的 color 改成 var(--text-secondary)
node tools/bump-assets.mjs --write && node tools/contrast-audit.mjs   # 应 0 未达标
git commit -am "修底部 tab 文字对比度：--text-secondary" && git push
```

若走 B，Windows 这边 `git fetch && git reset --hard origin/main` 丢弃 `e215161`，不丢任何东西。

## 本机 git 操作的两个坑（2026-10-27 实测）

1. `git reset --hard` / `git checkout origin/main -- .` 会被 **SIGTERM 杀掉**，并留下 `.git/index.lock`，之后所有写操作都失败（报 `Another git process seems to be running`）。**先 `rm -f .git/index.lock`**，再**按目录分块** `git checkout origin/main -- js css tools novel assets app manuscript .github .githooks docs`，最后 `git update-ref refs/heads/main $(git rev-parse origin/main)`。
2. 漏掉 `docs/` 会让它在 `git status` 显示为已删除（`D`），补一句 `git checkout HEAD -- docs/` 即可。
