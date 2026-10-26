# 无限流方案（保「一章一句」，去章末按钮）

状态：**两轮都已上线**，`?v=86`　｜　向下接续 + 向上接续都在跑

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

第二轮（向上接续）落地时又踩了三个坑，都是实测出来的：

| 发现 | 处理 |
|---|---|
| **只按「y 变小」判断上滑会被误触发**：加载时浏览器的滚动恢复（y 10 → 0）被当成用户上滑，凭空把上一章拉进来，还顺带把进度写到了上一章 | 加手势判定：必须有 900ms 内的 `wheel deltaY<0` / 手指往下拖 / `↑` `PageUp`，且 `y < 240`，才往上接 |
| 补偿和「跳过去」打架：`prependPrev(settle)` 里先补滚动再 `settle`，两次滚动互相拉扯，人会被带过头一整章 | 有 `settle` 就完全不做补偿，落位交给调用方 |
| 首屏 `appendNext()` 在 init 时读 `scrollHeight`，布局还没算完时会被误判成「这章很短」 | 挪到 `requestAnimationFrame` 里再判断 |

另外：`?v=` 期间升到 86；`flags.json` 与 `LY.flags` 的 DEFAULTS 必须成对登记，
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
5. ~~向上不接~~（第二轮已解决）：`prependPrev()` 把上一章插到链首，并以「正在读的那块」为锚做滚动补偿。实测教训是**别只按 y 变小判断上滑**——加载时的滚动恢复就是一次 y 变小，会凭空插一章进来，所以要求 900ms 内有真实手势。
6. **块要回收**：现在 7 章不用管。超过 ~20 章时，滑出 ±3 块就移除并留占位高度，否则移动端内存和滚动性能都会掉。这是唯一还没做的一条。

## 六、断言清单

基线 50 项 → **69 项**。换章那 6 项断言被重写（无限流下点击变成滚动，`replaceState` 时机不同），新增 14 项：

| 断言 | 说明 |
|---|---|
| 正文流里没有上一章/下一章按钮 | `.chapter-bottom-nav a` 数量为 0 |
| 首屏只装当前一章 | 块数 1，且 `#readingFlow` 存在 |
| 滚到章末自动追加下一章 | 块数 1 → 2，无整页刷新 |
| 接章后本章进度不被拉回 | 追加后 pct ≥ 95（旧算法会掉到 50 左右） |
| 滚进新章：URL / 章节 id 同步 | `location.pathname` 与 `LY.store.chapterId` |
| 滚进新章：标题与顶栏同步 | 与 `CHAPTERS` 里的 title 一致 |
| 上下章链接重新指过 | `.prev-ch` / `.next-ch` 的 href |
| 进度按当前章块算 | 进章 600px 应为小比例，不是整页比例 |
| 上一章进度保留、新章单独落盘 | 两个 `reader-pos-*` 都在 |
| 读完的章被标记为已读 | `reader-done-*` |
| 底部「下一章」接上并落位章首 | 块 2 存在且其 top ≈ 0 |
| 接上来的章继承自定义字体 | 两块的 computed fontFamily 相同 |
| 阅读辅助作用到接上来的章 | 两块都有 `.dlg` |
| 跨块摘句 id 不撞车 | 两块同序号段落的 id 不同且各带章名 |
| 上滑到章首把上一章插到上方 | 块序列变成 [前一章, 当前章] |
| 插入后滚动量 = 新块高度 | 补偿到位，视线不跳 |
| 正在读的那一块仍停在原位 | 该块 `rect.top` ≈ 0 |
| 继续上滑把第一章也接上 / 到第一章就停 | 块数 3，再上滑仍为 3 |
| 往上滚进上一章：URL 与 id 同步 | `location.pathname` |
| 键盘 ← 把上一章插到上方并落位章首 | 块首 top ≈ 0，URL 同步 |
| 末章滚到底不追加 | 块数仍为 1，pct ≥ 95 |

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
| 第二轮 ✅ | 向上接续：`prependPrev()` 以「正在读的块」为锚做滚动补偿、真实上滑手势判定、`settle` 与补偿互斥 | 约 90 行，已上线 |
| 第三轮（未做） | 块回收（滑出 ±3 块就移除并留占位高度） | 章节数 > 20 再说 |

## 九、验收标准

- 章末滚过余韵卡，无白屏、无跳变，下一章标题自然出现；
- 进度条在追加瞬间**不回跳**（这是最容易出问题的一项）；
- 刷新后回到刚才那一章的同一句；
- 分享 / 摘句 / 足迹的归属章正确；
- e2e 全绿（改 6 + 增 8），CI `verify` 绿；
- 关掉 `infiniteScroll` 立刻回到现在的行为。
