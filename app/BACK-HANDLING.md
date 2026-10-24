# 壳侧修复：系统返回键不应直接退出 App（v1.8.7 待办）

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
