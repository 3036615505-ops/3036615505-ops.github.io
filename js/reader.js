/**
 * 阅读器交互
 * 点中央弹出工具栏 · 3秒自动关闭 · 左右滑动翻章 · 下拉目录
 */
(function() {
  'use strict';

  var state = {
    fontSize: localStorage.getItem('reader-fontsize') || 'large',
    theme: localStorage.getItem('reader-theme') || 'wheat',
    barsVisible: false,
    autoCloseTimer: null
  };

  var fontSizes = ['small', 'medium', 'large'];
  var fontSizeLabels = { small: '小', medium: '中', large: '大' };
  var fontSizeValues = { small: 19, medium: 22, large: 25 };

  function init() {
    applyFontSize(state.fontSize);
    applyTheme(state.theme);
    initTapArea();
    initSwipe();
    initReadingProgress();
    initDirectoryPanel();
  }

  // ===== 字号 =====
  function applyFontSize(size) {
    document.documentElement.setAttribute('data-fontsize', size);
    var px = fontSizeValues[size] || 25;
    document.documentElement.style.setProperty('--font-size-base', px + 'px');
    state.fontSize = size;
    localStorage.setItem('reader-fontsize', size);
    var label = document.getElementById('fontSizeLabel');
    if (label) label.textContent = fontSizeLabels[size] || '大';
  }

  window.changeFontSize = function(dir) {
    var idx = fontSizes.indexOf(state.fontSize);
    if (idx === -1) idx = 2;
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
      var colors = { light: '#ffffff', wheat: '#f5efe0', green: '#d5e4d0', dark: '#1c1c1c' };
      meta.content = colors[theme] || '#f5efe0';
    }
  }

  window.setTheme = function(theme) {
    applyTheme(theme);
  };

  window.toggleNightMode = function() {
    applyTheme(state.theme === 'dark' ? 'wheat' : 'dark');
  };

  // ===== 工具栏显隐 =====
  function showBars() {
    state.barsVisible = true;
    var topbar = document.getElementById('readerTopbar');
    var bottombar = document.getElementById('readerBottombar');
    if (topbar) topbar.classList.add('visible');
    if (bottombar) bottombar.classList.add('visible');
    startAutoClose();
  }

  function hideBars() {
    state.barsVisible = false;
    stopAutoClose();
    var topbar = document.getElementById('readerTopbar');
    var bottombar = document.getElementById('readerBottombar');
    if (topbar) topbar.classList.remove('visible');
    if (bottombar) bottombar.classList.remove('visible');
  }

  function startAutoClose() {
    stopAutoClose();
    state.autoCloseTimer = setTimeout(function() {
      if (state.barsVisible) hideBars();
    }, 3000);
  }

  function stopAutoClose() {
    if (state.autoCloseTimer) {
      clearTimeout(state.autoCloseTimer);
      state.autoCloseTimer = null;
    }
  }

  // ===== 点击区域 =====
  function initTapArea() {
    var tapArea = document.getElementById('readerTapArea');
    if (!tapArea) return;

    tapArea.addEventListener('click', function(e) {
      // 目录面板打开时，点击内容区关闭
      var dirOverlay = document.getElementById('dirOverlay');
      if (dirOverlay && dirOverlay.classList.contains('visible')) {
        closeDirectory();
        return;
      }

      var rect = tapArea.getBoundingClientRect();
      var x = e.clientX - rect.left;
      var w = rect.width;

      if (x > w * 0.30 && x < w * 0.70) {
        // 中间区域：切换工具栏
        if (state.barsVisible) {
          hideBars();
        } else {
          showBars();
        }
      } else if (x <= w * 0.30) {
        // 左侧：上翻
        if (state.barsVisible) hideBars();
        window.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' });
      } else {
        // 右侧：下翻
        if (state.barsVisible) hideBars();
        window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
      }
    });
  }

  // ===== 滑动翻章 =====
  function initSwipe() {
    var startX = 0, startY = 0, tracking = false;

    document.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
      if (!tracking) return;
      tracking = false;

      var endX = e.changedTouches[0].clientX;
      var endY = e.changedTouches[0].clientY;
      var dx = endX - startX;
      var dy = endY - startY;

      var dirOverlay = document.getElementById('dirOverlay');
      if (dirOverlay && dirOverlay.classList.contains('visible')) return;

      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 70) {
        if (state.barsVisible) hideBars();

        if (dx < 0) {
          // 左滑 → 下一章
          var nextLink = document.querySelector('.next-ch[href]:not([href="#"])');
          if (nextLink) {
            window.location.href = nextLink.getAttribute('href');
          }
        } else {
          // 右滑 → 上一章
          var prevLink = document.querySelector('.prev-ch[href]:not([href="#"])');
          if (prevLink) {
            window.location.href = prevLink.getAttribute('href');
          }
        }
      }
    }, { passive: true });
  }

  // ===== 目录下拉面板 =====
  function initDirectoryPanel() {
    if (document.getElementById('dirOverlay')) return;

    var overlay = document.createElement('div');
    overlay.id = 'dirOverlay';
    overlay.className = 'dir-overlay';
    overlay.innerHTML =
      '<div class="dir-backdrop"></div>' +
      '<div class="dir-panel">' +
        '<div class="dir-header">' +
          '<span>目录</span>' +
          '<button class="dir-close-btn" onclick="closeDirectory()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="dir-list" id="dirList"></div>' +
      '</div>';

    var wrapper = document.querySelector('.reading-wrapper');
    if (wrapper) wrapper.appendChild(overlay);

    overlay.querySelector('.dir-backdrop').addEventListener('click', closeDirectory);
    populateDirectory();
  }

  function populateDirectory() {
    var dirList = document.getElementById('dirList');
    if (!dirList) return;

    var path = window.location.pathname;
    var dir = path.substring(0, path.lastIndexOf('/'));
    var file = path.substring(path.lastIndexOf('/') + 1) || 'chapter-01.html';

    var chapters = [
      { num: 1, title: '第一章·临渊羡鱼', href: 'chapter-01.html', words: 2722 },
      { num: 2, title: '第二章·前桌', href: 'chapter-02.html', words: 2257 }
    ];

    var html = '';
    chapters.forEach(function(ch) {
      var active = ch.href === file;
      html += '<a href="' + ch.href + '" class="dir-item' + (active ? ' active' : '') + '">';
      html += '<span class="dir-item-num">第' + ch.num + '章</span>';
      html += '<div class="dir-item-main"><span class="dir-item-title">' + ch.title + '</span>';
      html += '<span class="dir-item-words">' + ch.words + '字</span></div>';
      html += '</a>';
    });

    dirList.innerHTML = html;
  }

  window.openDirectory = function() {
    var overlay = document.getElementById('dirOverlay');
    if (overlay) {
      overlay.classList.add('visible');
      document.body.style.overflow = 'hidden';
      if (state.barsVisible) hideBars();
    }
  };

  window.closeDirectory = function() {
    var overlay = document.getElementById('dirOverlay');
    if (overlay) {
      overlay.classList.remove('visible');
      document.body.style.overflow = '';
    }
  };

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
