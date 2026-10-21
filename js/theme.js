/**
 * theme.js — 首页/目录/人物簿的主题应用（阅读页由 reader.js 负责）
 * 规则：跟随阅读主题（reader-theme）；未设置时跟随系统 prefers-color-scheme
 * 只有 dark 会传导到全站；wheat/green/light 下 shell 保持纸色
 */
(function () {
  'use strict';
  var theme = null;
  try {
    theme = localStorage.getItem('reader-theme');
    if (!theme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      theme = 'dark';
    }
  } catch (err) { /* 隐私模式等场景下静默降级 */ }

  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = '#1c1c1c';
  }

  /* ===== Service Worker 注册（离线阅读） ===== */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function() { /* 静默失败，不影响阅读 */ });
    });
  }
})();
