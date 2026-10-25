# 无限流方案（保「一章一句」，去章末按钮）

状态：**第一轮（向下接续）已上线**，`?v=81`　｜　第二轮（向上接续）未做

## 落地记录（与原方案的差异）

第一轮按下面的方案实现，额外发现并处理了四件事，都是「不加就会露馅」的：

| 发现 | 处理 |
|---|---|
| `getCurrentChapterTitle()` 取第一个 `.chapter-content h1`，无限流下永远返回第一章 | 改为只认探测线所在块（`reader.store.js`） |
| 余韵卡的「分享这一章」读全局状态，可能分享成下一章 | `shareChapter(this)` 读按钮所在块 |
| 摘句落点 `id="quote-N"` 跨块撞车，「回到这一页」会跳到别的章 | 改成 `quote-<章名>-<段号>`，链接同步生成 |
| 阅读辅助用单个 `contentSnapshot` + 第一个 `.chapter-content`：接上来的章没有对话高亮/直角引号，开关一动还会把新块冲掉 | 改成每章一份快照的数组，接章后只处理新块 |
| 沉浸栏的页码与剩余时间按整页 `scrollHeight` 算 | 都改成按当前章块算（剩余时间口径 = 本章还剩多少） |
| 自定义字体只写在第一个 `.chapter-content` 上，翻过接缝字体变回系统字 | 抽 `applyFontTo(root)`，接章时补一次 |

另外：`?v=` 期间升到 81；`flags.json` 与 `LY.flags` 的 DEFAULTS 必须成对登记，
这一条现在由 e2e 的「开关一一对应」断言守着（少登记一个就等于线上关不掉那个功能）。

## 一、结论

可行。而且「一章一句」（`.chapter-afterglow`）正好是**现成的接缝**——

现在的阅读流是：正文 → 余韵卡 → 一对「上一章 / 下一章」按钮 → 底部工具栏。
删掉那对按钮后，余韵卡本身就是「本章到此」的自然句点；滚过它，接着就是下一章标题。
不需要发明新的分隔物。

但它不是「删按钮 + 加滚动」。真正要换的是**进度模型**：整站所有"读到哪儿"的计算，现在都假设「一页 = 一章」。

## 二、结构变化

```
现在                              无限流
────────────────────────────      ────────────────────────────
body                              body
├─ .reader-topbar                 ├─ .reader-topbar
├─ article.chapter-content        ├─ #readingFlow
├─ .chapter-afterglow             │   ├─ section.chapter-block[data-file=03]
├─ .chapter-bottom-nav  ← 删      │   │   ├─ article.chapter-content
└─ .reader-bottombar              │   │   └─ .chapter-afterglow
                                  │   ├─ section.chapter-block[data-file=04]
                                  │   │   ├─ article.chapter-content
                                  │   │   └─ .chapter-afterglow
                                  │   └─ …
                                  └─ .reader-bottombar（保留）
```

`.chapter-bottom-nav` **从模板删掉**（`new-chapter.js:292-295` + `prevNav`/`nextNav` 两个变量），不做 CSS 隐藏——
隐藏了它仍然在无障碍树和 Tab 顺序里，是假删除。7 个现存章节页同一次改。

底部工具栏的 `.prev-ch` / `.next-ch` 建议**保留**：它在隐藏工具栏里，不占阅读流，是唯一的显式导航入口。
行为改成「滚到相邻章块顶部」，不再跳页。

## 三、要改的五处（按依赖顺序）

| # | 文件 | 改动 |
|---|---|---|
| 1 | `new-chapter.js` | 删 `chapter-bottom-nav` 块；正文包一层 `<section class="chapter-block">`；7 页重生成 |
| 2 | `js/reader.engine.js` | `getCurrentProgressPct` / `contentParagraphs` / `getCurrentAnchor` / `scrollToAnchor` 全部改为「当前块内」计算；新增 `currentBlock()` |
| 3 | `js/reader.ui.js` | 新增 `initFlow()`：滚到章末 800px 追加下一章（复用 `swapTo` 的取章/解析代码）；`getCurrentChapterTitle` 限定当前块；`shareChapter` 读按钮所在块 |
| 4 | `js/reader.store.js` | `chapterId` 跟随当前块切换（`setChapterId` 已有，只需在滚动监听里调用） |
| 5 | `css/style.css` | 块间距、接缝留白；`.chapter-block:not(:last-of-type) .chapter-afterglow` 的下边距 |

**能复用的（这是上一轮 `swapTo` 的地基价值）**：取章 → 解析 → 提取 `.chapter-content` / `.chapter-afterglow` → `replaceState` → `setChapterId` → 同步标题/顶栏/目录高亮 → 重装饰摘句。无限流只是把「替换」换成「追加」，失败兜底仍是整页跳转。

## 四、进度模型（真正的改动）

### 现状
```js
// reader.engine.js:42
var dh = document.documentElement.scrollHeight - window.innerHeight;
return Math.round((window.scrollY / dh) * 100);
```
一页 = 一章，所以整页比例 = 本章比例。追加章节后 `scrollHeight` 会变，这个值直接失真。

### 改法
```js
function currentBlock() {
  var probeY = window.innerHeight * 0.15;   // 与锚点用同一条探测线
  var blocks = document.querySelectorAll('.chapter-block');
  for (var i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].getBoundingClientRect().top <= probeY) return blocks[i];
  }
  return blocks[0] || null;
}

function getCurrentProgressPct() {
  var b = currentBlock();
  if (!b) return 0;
  var rect = b.getBoundingClientRect();
  var span = rect.height - window.innerHeight;   // 块内可滚距离
  if (span <= 0) return rect.top < 0 ? 100 : 0;  // 短章：一屏读完
  return clampProgress(Math.round((-rect.top / span) * 100));
}
```

**边界**：探测线在块顶上方时 `-rect.top < 0` → 0；块底对齐视口底时 = 100；继续往下滚（下一块进来了）→ 夹在 100。
语义与旧公式完全一致，只是把「整页」换成「块」。

### 连带的三处
- `contentParagraphs()`：`document.querySelector('.chapter-content')` → `currentBlock().querySelector('.chapter-content')`。不改的话锚点会把 7 章的段落串成一条，`i` 直接指错章。
- `chapterId` 切换：滚动跨块时，**先 flush 旧章**再换 id：
  ```js
  saveProgress(undefined, true);          // 旧章 id 还在，先落盘
  LY.store.setChapterId(block.dataset.file);
  ```
  顺序反了就是旧章进度被写成新章的值。
- 恢复位置：冷启动只渲染 URL 那一章，所以恢复逻辑不用改；但**滚进新块时绝不恢复**（会把人拽走）。

### 顺带变准的两件事
- `reader-done-<id>`：滚过 95% 自动标记，全书读完率第一次是真的。
- `getCurrentFileName()` 读 `location.pathname`，而 URL 用 `replaceState` 跟着块走 —— 分享、摘句归属、阅读足迹全部自动正确，不用逐个改。

## 五、六个已知坑

1. **`getCurrentChapterTitle()` 现在取 `document.querySelector('.chapter-content h1')`** —— 无限流下永远返回第一章标题。必须限定当前块。
2. **余韵卡的「分享这一章」** 是全局 `shareChapter()`，读当前状态。要改成读**按钮所在块**的章，否则站在第 4 章卡片上可能分享出第 5 章。
3. **自动滚动到章末会停**（`stopAutoScroll` 提示「已到本章末尾」）。无限流下应该无缝续，否则「自动」这个功能先于滚动断掉。
4. **`pagehide` 那一堆保护都按单章写的**（`restoring`、`userScrolled`、未滚动不许写 0）。跨块后要在切换点 clear 一次，不然新块继承上一块的 `userScrolled = true`，恢复逻辑失效。
5. **向上不接**：第一轮只做向下。`←`、上滑、底部「上一章」如果上一块已在链里就滚上去；不在（停在链首）就沿用现在的 `swapTo` / 整页跳转。第二轮再补向上插入——那个要往上方插内容并做滚动补偿，最容易"跳一下"。
6. **块要回收**：现在 7 章不用管。超过 ~20 章时，滑出 ±3 块就移除并留占位高度，否则移动端内存和滚动性能都会掉。第一轮先不做，写进门槛条件。

## 六、断言清单

现有 50 项里，**6 项换章断言要改**（它们断言"点击后 URL 变、正文变、顶栏变"——无限流下点击变成滚动，`replaceState` 时机不同）。新增约 8 项：

| 断言 | 说明 |
|---|---|
| 滚到章末自动追加下一章 | 块数 1 → 2，无整页刷新 |
| 追加后 URL 跟随新块 | `location.pathname` = 新章；`LY.store.chapterId` 同步 |
| 块内进度不再失真 | 追加前后同一位置 pct 差值 ≤ 2 |
| 旧章进度未被覆盖 | 追加后 `reader-pos-<旧章>` 仍存在且非 0 |
| 顶栏章名随块切换 | 滚进第 4 块，顶栏显示第四章 |
| 摘句归属正确 | 在第 4 块点摘句，id 前缀是 chapter-04 |
| 首章不回退 | 在首块按 `←` → 整页跳转或提示，不出现空块 |
| 末章不追加 | 最后一章滚到底不报错、不请求 404 |

## 七、灰度与回滚

**用现成的 `flags.json` 做开关**（不缓存、1.5s 超时兜底、改完 push 一分钟生效）：

```json
"infiniteScroll": true
```

关掉即回到今天的 swap 行为，**不需要发版、不需要回滚代码**。代码层回滚点就是一次 `git revert`。

## 八、两轮拆分

| 轮次 | 内容 | 量 |
|---|---|---|
| 第一轮 ✅ | 向下接续：块结构、进度/锚点重写、章末按钮删除、`←` 在链内回滚、断言、flag | 约 260 行，已上线 |
| 第二轮 | 向上接续（章首上滑插上一章 + 滚动补偿）、块回收、自动滚动无缝续 | 约 120 行，另半天 |

## 九、验收标准

- 章末滚过余韵卡，无白屏、无跳变，下一章标题自然出现；
- 进度条在追加瞬间**不回跳**（这是最容易出问题的一项）；
- 刷新后回到刚才那一章的同一句；
- 分享 / 摘句 / 足迹的归属章正确；
- e2e 全绿（改 6 + 增 8），CI `verify` 绿；
- 关掉 `infiniteScroll` 立刻回到现在的行为。
