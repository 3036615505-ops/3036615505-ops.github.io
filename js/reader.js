/**
 * 阅读器交互
 * 点击中央弹出工具栏，左右区域翻页
 */
(function() {
  'use strict';

  var state = {
    fontSize: localStorage.getItem('reader-fontsize') || 'medium',
    theme: localStorage.getItem('reader-theme') || 'wheat',
    barsVisible: false
  };

  var fontSizes = ['small', 'medium', 'large', 'xlarge'];
  var fontSizeLabels = { small: '小', medium: '中', large: '大', xlarge: '特' };

  function init() {
    applyFontSize(state.fontSize);
    applyTheme(state.theme);
    initTapArea();
    initReadingProgress();
  }

  // ===== 字号 =====
  function applyFontSize(size) {
    document.documentElement.setAttribute('data-fontsize', size);
    state.fontSize = size;
    localStorage.setItem('reader-fontsize', size);
    var label = document.getElementById('fontSizeLabel');
    if (label) label.textContent = fontSizeLabels[size] || '中';
  }

  window.changeFontSize = function(dir) {
    var idx = fontSizes.indexOf(state.fontSize);
    if (idx === -1) idx = 1;
    idx += dir;
    if (idx < 0) idx = 0;
    if (idx >= fontSizes.length) idx = fontSizes.length - 1;
    applyFontSize(fontSizes[idx]);
  };

  // ===== 主题 =====
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    state.theme = theme;
    localStorage.setItem('reader-theme', theme);

    document.querySelectorAll('.theme-circle').forEach(function(el) {
      el.classList.toggle('active', el.dataset.theme === theme);
    });

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      var colors = {
        light: '#ffffff',
        wheat: '#f5efe0',
        green: '#d5e4d0',
        dark: '#1c1c1c'
      };
      meta.content = colors[theme] || '#f5efe0';
    }
  }

  window.setTheme = function(theme) {
    applyTheme(theme);
  };

  window.toggleNightMode = function() {
    var newTheme = state.theme === 'dark' ? 'wheat' : 'dark';
    applyTheme(newTheme);
  };

  // ===== 点击区域 =====
  function initTapArea() {
    var tapArea = document.getElementById('readerTapArea');
    if (!tapArea) return;

    tapArea.addEventListener('click', function(e) {
      var rect = tapArea.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var w = rect.width;

      if (x > w * 0.25 && x < w * 0.75) {
        toggleBars();
      } else if (x <= w * 0.25) {
        window.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' });
      } else {
        window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
      }
    });
  }

  function toggleBars() {
    state.barsVisible = !state.barsVisible;
    var topbar = document.getElementById('readerTopbar');
    var bottombar = document.getElementById('readerBottombar');
    if (topbar) topbar.classList.toggle('visible', state.barsVisible);
    if (bottombar) bottombar.classList.toggle('visible', state.barsVisible);

    var tapArea = document.getElementById('readerTapArea');
    if (tapArea) {
      tapArea.style.pointerEvents = state.barsVisible ? 'none' : 'auto';
    }
  }

  // ===== 阅读进度 =====
  function initReadingProgress() {
    var progressLine = document.querySelector('.reading-progress-line');
    var progressFill = document.getElementById('progressFill');

    if (!progressLine && !progressFill) return;

    function updateProgress() {
      var scrollTop = window.scrollY;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      var pct = Math.min(Math.round((scrollTop / docHeight) * 100), 100);

      if (progressLine) progressLine.style.width = pct + '%';
      if (progressFill) progressFill.style.width = pct + '%';
    }

    window.addEventListener('scroll', updateProgress, { passive: true });
    updateProgress();
  }

  // ===== 启动 =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
