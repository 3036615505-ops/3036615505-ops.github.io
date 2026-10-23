/**
 * 阅读页入口 —— 只负责按顺序装配三个模块并启动
 *
 * 加载顺序（章节页的 <script> 顺序即契约）：
 *   reader.store.js → reader.engine.js → reader.ui.js → reader.js
 * 三个模块都挂在 window.LY 上，不用打包器；SW 会一起预缓存。
 */
(function() {
  'use strict';
  var LY = window.LY || (window.LY = {});

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function() {});
    });
  }

  /* 模块脚本是同步加载的，DOM 已经解析完就直接起；否则等 DOMContentLoaded */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { LY.ui.init(); });
  } else {
    LY.ui.init();
  }
})();
