/**
 * 阅读页入口 —— 只负责按顺序装配模块并启动
 *
 * 加载顺序（章节页的 <script> 顺序即契约）：
 *   reader.flags.js → reader.dom.js → reader.store.js → reader.engine.js → reader.ui.js → reader.js
 * 模块都挂在 window.LY 上，不用打包器；SW 会一起预缓存。
 */
(function() {
  'use strict';
  var LY = window.LY || (window.LY = {});

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function() {});
    });
  }

  /* 远程开关先发出请求（不阻塞启动）：拉回来之前一律按默认值（全开）运行，
     1.5 秒还没回来就当作全部开启 —— 开关挂了不能连累读书 */
  LY.flags.load();

  function boot() { LY.ui.init(); }

  /* 模块脚本是同步加载的，DOM 已经解析完就直接起；否则等 DOMContentLoaded */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
