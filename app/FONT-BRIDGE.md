# 系统字体：网页端能做的、和只能靠壳做的

这份文档记录「跟随系统字体」这个开关为什么在部分手机上点了没反应，
以及要真正修好，Android 壳那边需要提供什么。

## 现状（v1.8.4 壳实测）

`js/reader.ui.js` 会依次调用 `LinyuanApp.getSystemFontFamily()` /
`getSystemFontFamilyName()` / `getSystemFont()`，把返回值当字体家族名交给 CSS。

在荣耀机型上实测，方法都在，返回的是 **`sans-serif`** —— 这是 CSS 的通用族名，
不是某个具体字体。它说明：

- Java 侧的默认 `Typeface` 只能报出「通用无衬线族」，报不出当前主题字体叫什么；
- 这不是壳写错，`Typeface` 本身就没有「当前主题字体叫什么」这个接口。

## 为什么网页端到此为止

1. 浏览器 / WebView **没有任何 API 能枚举系统已安装的字体**，只能靠壳把名字交出来。
2. 主题字体是否透传给 WebView，由 ROM 决定。华为 / 荣耀的主题字体是在系统层替换
   原生控件的字体，而 WebView（Chromium）读的是系统字体配置文件，
   通常看不到主题字体 —— 所以「别的 App 变了、网页没变」是预期行为。
3. 名字拿到了也不一定有用：如果这个名字在 WebView 里不存在，`font-family` 会静默
   落空。所以网页侧还要用 canvas 比像素验真（已有：`fontAvailable()`）。

## 壳需要补的接口

### 方案 A（首选）：把系统字体家族名列表交给网页

```java
@JavascriptInterface
public String getSystemFontFamilies() {
    java.util.LinkedHashSet<String> names = new java.util.LinkedHashSet<>();
    try {
        // API 29+，读取系统字体配置文件里真实可用的家族
        for (android.graphics.fonts.Font f :
                android.graphics.fonts.SystemFonts.getAvailableFonts()) {
            if (f.getFamilyName() != null) names.add(f.getFamilyName());
        }
    } catch (Throwable ignored) { }
    return new org.json.JSONArray(names).toString();   // 例如 ["sans-serif","HONOR Sans", ...]
}
```

网页侧拿到数组后，逐个用 `fontAvailable()` 验真，把「真的能渲染、且与默认黑体不同」
的家族列成可选按钮。这样即使叫不出主题字体的名字，也能让读者手动选中
手机里实际存在的那一个。

注意：这是**值得一试，但不是保证**。主题字体如果只存在于 `/data/themes/...`，
不在 `fonts.xml` 里，这个接口同样枚举不到。

### 方案 B（保底）：把字体文件本身交给网页

如果方案 A 枚举不到主题字体，但能拿到字体文件路径（`Font.getFile()`，通常在
`/system/fonts/` 下），就把这个文件通过 `WebViewAssetLoader` 挂到
`https://appassets.androidplatform.net/fonts/theme.ttf`，网页侧用 `@font-face`
加载。这条路不依赖「字体名」，命中率最高，但要改资源加载方式，工作量比 A 大。

### 都不行的话

网页侧可以加「导入字体文件」入口：读者自己选一个 `.ttf/.otf`，通过
`FontFace` + IndexedDB 存下来并应用到正文。不依赖 ROM，也不需要改壳，
代价是需要读者自己准备字体文件。

## 网页侧的对应改动

壳一旦提供 `getSystemFontFamilies()`，需要同步改 `js/reader.ui.js`：

- `SYSTEM_FONT_METHODS` 旁边加一个 `SYSTEM_FONT_LIST_METHODS`；
- 解析数组 → 用 `fontAvailable()` + 与 `SYSTEM_STACK` 比像素，筛出真正不同的家族；
- 在 `#fontFamilyChoices` 里追加按钮（值用 `sys:<家族名>`），
  `fontStackFor()` 对该前缀返回 `"<家族名>",sans-serif`；
- `applyFontFamily()` 里的白名单校验要放行 `sys:` 前缀。
