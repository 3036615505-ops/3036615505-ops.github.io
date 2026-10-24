# 壳侧修复：系统返回键不应直接退出 App（v1.8.7 已发布）

## 问题（2026-10-24 用户实测视频反馈）

- **现象 1**：人物详细简介页（`novel/character-*.html`）点左上角返回 → 同学录列表回到最顶上，没有回到点进去的位置。
- **现象 2**：按系统返回键（手势/物理键）→ **直接退出程序**，而不是在 WebView 历史里后退。

现象 1 已在网页侧修复（`tools/make-characters.mjs` 列表页模板加滚动记忆脚本，
点进详情前存 `sessionStorage`，返回列表时恢复；SW 对导航请求是网络优先，无需升 CACHE）。

现象 2 只能壳侧修：网页管不到系统返回键。

## 修复（Windows 端 `E:/novel-site/twa`，Activity）

经典写法（`onBackPressed` 已废弃但仍可用）：

```kotlin
@Deprecated("Deprecated in Java")
override fun onBackPressed() {
    if (this::webView.isInitialized && webView.canGoBack()) {
        webView.goBack()
    } else {
        super.onBackPressed()   // 真正该退出时才退出
    }
}
```

AndroidX 推荐（API 33+ 预测性返回手势也兼容）：

```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
    // ... 原有初始化 ...
    onBackPressedDispatcher.addCallback(this) {
        if (webView.canGoBack()) webView.goBack() else finish()
    }
}
```

## 翻车点（都是实测过的坑）

1. **双击退出的防抖别丢**：如果壳本来有「两秒内连按两次才退出」的逻辑，要挂在
   `canGoBack() == false` 的分支里，别挂在 dispatcher 回调最外层——否则在列表页
   第一次按返回就直接退了。
2. **`canGoBack()` 会把 `about:blank` 也算历史**：壳如果初始化时先
   `loadUrl("about:blank")` 再换正式地址，返回键会退到空白页。初始化避免
   about:blank，或后退前判断 `webView.url`。
3. **预测性返回（Android 13+）**：manifest 里若开了
   `android:enableOnBackInvokedCallback="true"`，`onBackPressed` 不会再被调用，
   必须走 `OnBackInvokedCallback`；没开的话上面两段任选其一即可。
4. **离线兜底页**：壳内 `assets/offline.html` 目前只在部分错误码出现（用户实测
   `net::ERR_FAILED` 直接露了 WebView 原生错误页）。建议一并改
   `onReceivedError`：`request.isForMainFrame()` 为 true 时无论错误码一律
   `loadUrl("file:///android_asset/offline.html")`，页面上放「重试」按钮
   （重试 = 重新 load 原地址）。GitHub Pages 在国内时通时断，这个兜底很常用。

## 验证清单（打完包 v1.8.7 后过一遍）

- [ ] 同学录列表滚到中间 → 点「详细」→ 左上角返回 → 回到原滚动位置
- [ ] 详细页按系统返回 → 回列表且位置正确（goBack 路径）
- [ ] 列表页按系统返回 → 回到进入同学录前的页面（不退出）
- [ ] 首页按系统返回 → 双击确认后才退出（若保留双击退出逻辑）
- [ ] 飞行模式下打开 App → 显示 offline.html 而非系统错误页 → 关飞行模式点重试可恢复

## 结果：v1.8.7 已发布（2026-10-24，versionCode 16）

实际落地与上面的方案有出入，记在这里免得下次照着旧方案改：

- **只注册 `onBackPressed` 不管用**：targetSdk 36 下预测性返回默认开启，系统根本不回调它。
  实际做法：新增 `BackInvokedRegistrar` 独立类（API 33 类型隔离，沿用 `DownloadsWriterQ` 那套
  「独立类 + SDK_INT 判断」手法，避免 API 24–32 加载 MainActivity 时类校验失败），
  `onCreate` + `onResume` 幂等注册，`onDestroy` 反注册；API ≤32 仍走 `onBackPressed` 覆写，
  两条路径都汇聚到唯一 `handleBackPressed()`，只有一个 `finish()` 出口。
  manifest 显式写 `android:enableOnBackInvokedCallback="true"`。
- **离线兜底真凶不是「只兜部分错误码」**：`onReceivedError` 本来就无条件兜主框架。真凶是
  在错误回调里**同步** `loadUrl(offline.html)` 会被 WebView 丢掉。改成主线程 `Handler.post`
  推迟到导航收尾之后（刻意不用 `View.post`——view 被 `replaceWebView` destroy 后 RunQueue
  可能永不 flush，兜底会丢）。另外补了 `onReceivedHttpError`（仅 5xx）与 `onReceivedSslError`。
- **`onReceivedSslError` 必须自己判主框架**：这个回调不带 `WebResourceRequest`，没有
  `isForMainFrame()`。用 `SslError.getUrl()` 的 host 是否属于本站来判断——否则页面里
  `@import` 的 Google Fonts 一旦证书异常，正在读的章节会被整页顶成离线页。
- 发布包 sha256 `a7290d33…4ea13c8b`，107,934 字节；签名证书与 1.8.6 一致（可覆盖升级）。

### 已知未做（下版候选）

1. `BackInvokedRegistrar` 构造时一次性捕获 dispatcher，若为 null 则 `onResume` 的「补注册」
   实际无效（注释略夸大）。现实影响低：已 attach 的 Activity 在 API 33+ 不会返回 null。
2. 极少数定制 ROM 可能同时回调 `onBackPressed` 与 dispatcher → 一次按键连退两页。
   要防的话在 `handleBackPressed()` 加 250~400ms 防抖，本次刻意没加。
3. `onReceivedHttpError` 只兜 5xx（4xx 留给站点自己的 404 页），429/403 限流不会兜底。
4. 同 host 子资源单独证书失败会被误判为主文档而顶成离线页（实际等价于站点证书整体失效，
   用户点重试即可，属可接受降级）。
5. 真机待验：飞行模式兜底 + 重试、渲染进程回收后断网、「不保留活动」场景、
   Android 7/8 安装启动、13+ 逐级后退手感。

