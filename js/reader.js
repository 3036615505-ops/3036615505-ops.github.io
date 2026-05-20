/**
 * 阅读器 — 上下/左右双模式 · 阅读记录 · 目录弹窗 · 设置面板
 */
(function() {
  'use strict';

  /* ===== STATE ===== */
  var state = {
    fontSize: localStorage.getItem('reader-fontsize') || 'large',
    theme: localStorage.getItem('reader-theme') || 'wheat',
    pageMode: localStorage.getItem('reader-pagemode') === 'true',
    barsVisible: false,
    settingsVisible: false,
    autoCloseTimer: null,
    currentPage: 0,
    totalPages: 0
  };

  var fontSizes = ['small', 'medium', 'large'];
  var fontSizeLabels = { small: '小', medium: '中', large: '大' };
  var fontSizeValues = { small: 19, medium: 22, large: 25 };

  var chapterId = window.location.pathname.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');

  /* ===== INIT ===== */
  function init() {
    applyFontSize(state.fontSize);
    applyTheme(state.theme);
    initTapArea();
    initSwipe();
    initReadingProgress();
    initDirectoryPanel();
    initSettingsPanel();
    if (state.pageMode) enterPageMode();
    updatePageModeUI();
    restoreProgress();
  }

  /* ===== FONT SIZE ===== */
  function applyFontSize(size) {
    document.documentElement.setAttribute('data-fontsize', size);
    document.documentElement.style.setProperty('--font-size-base', (fontSizeValues[size] || 25) + 'px');
    state.fontSize = size;
    localStorage.setItem('reader-fontsize', size);
    var el = document.getElementById('fontSizeLabel');
    if (el) el.textContent = fontSizeLabels[size] || '大';
  }

  window.changeFontSize = function(dir) {
    var idx = fontSizes.indexOf(state.fontSize);
    if (idx === -1) idx = 2;
    idx += dir;
    if (idx < 0) idx = 0;
    if (idx >= fontSizes.length) idx = fontSizes.length - 1;
    applyFontSize(fontSizes[idx]);
    if (state.pageMode) recalcPages();
  };

  /* ===== THEME ===== */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    state.theme = theme;
    localStorage.setItem('reader-theme', theme);
    document.querySelectorAll('.theme-circle').forEach(function(el) {
      el.classList.toggle('active', el.dataset.theme === theme);
    });
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = { light: '#ffffff', wheat: '#f5efe0', green: '#d5e4d0', dark: '#1c1c1c' }[theme] || '#f5efe0';
    }
  }

  window.setTheme = function(theme) { applyTheme(theme); };

  window.toggleNightMode = function() {
    applyTheme(state.theme === 'dark' ? 'wheat' : 'dark');
  };

  /* ===== BARS ===== */
  function showBars() {
    state.barsVisible = true;
    var top = document.getElementById('readerTopbar');
    var bot = document.getElementById('readerBottombar');
    if (top) top.classList.add('visible');
    if (bot) bot.classList.add('visible');
    startAutoClose();
  }

  function hideBars() {
    state.barsVisible = false;
    state.settingsVisible = false;
    stopAutoClose();
    var top = document.getElementById('readerTopbar');
    var bot = document.getElementById('readerBottombar');
    if (top) top.classList.remove('visible');
    if (bot) { bot.classList.remove('visible'); bot.classList.remove('settings-open'); }
  }

  function startAutoClose() {
    stopAutoClose();
    state.autoCloseTimer = setTimeout(function() { if (state.barsVisible) hideBars(); }, 3000);
  }

  function stopAutoClose() {
    if (state.autoCloseTimer) { clearTimeout(state.autoCloseTimer); state.autoCloseTimer = null; }
  }

  /* ===== TAP AREA (vertical zones) ===== */
  function initTapArea() {
    var tap = document.getElementById('readerTapArea');
    if (!tap) return;

    tap.addEventListener('click', function(e) {
      var dirOv = document.getElementById('dirOverlay');
      if (dirOv && dirOv.classList.contains('visible')) { closeDirectory(); return; }
      var setOv = document.getElementById('settingsOverlay');
      if (setOv && setOv.classList.contains('visible')) { closeSettings(); return; }

      var rect = tap.getBoundingClientRect();
      var y = e.clientY - rect.top;
      var h = rect.height;
      var x = e.clientX - rect.left;
      var w = rect.width;

      if (state.pageMode) {
        // Page mode: left/center/right (horizontal)
        if (x > w * 0.30 && x < w * 0.70) {
          state.barsVisible ? hideBars() : showBars();
        } else if (x <= w * 0.30) {
          if (state.barsVisible) hideBars();
          goToPage(state.currentPage - 1);
        } else {
          if (state.barsVisible) hideBars();
          goToPage(state.currentPage + 1);
        }
      } else {
        // Scroll mode: top/center/bottom (vertical)
        if (y > h * 0.30 && y < h * 0.65) {
          state.barsVisible ? hideBars() : showBars();
        } else if (y <= h * 0.30) {
          if (state.barsVisible) hideBars();
          window.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' });
        } else {
          if (state.barsVisible) hideBars();
          window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
        }
      }
    });
  }

  /* ===== SWIPE ===== */
  function initSwipe() {
    var sx = 0, sy = 0, tracking = false;

    document.addEventListener('touchstart', function(e) {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
      if (!tracking) return; tracking = false;
      var ex = e.changedTouches[0].clientX, ey = e.changedTouches[0].clientY;
      var dx = ex - sx, dy = ey - sy;
      if (Math.abs(dx) < 40 && Math.abs(dy) < 40) return;

      if (document.getElementById('dirOverlay') && document.getElementById('dirOverlay').classList.contains('visible')) return;
      if (document.getElementById('settingsOverlay') && document.getElementById('settingsOverlay').classList.contains('visible')) return;

      if (state.pageMode) {
        // Page mode: horizontal swipe flips pages
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
          if (state.barsVisible) hideBars();
          dx < 0 ? goToPage(state.currentPage + 1) : goToPage(state.currentPage - 1);
        }
      } else {
        // Scroll mode: horizontal swipe changes chapters
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 70) {
          if (state.barsVisible) hideBars();
          if (dx < 0) {
            var n = document.querySelector('.next-ch[href]:not([href="#"])');
            if (n) window.location.href = n.getAttribute('href');
          } else {
            var p = document.querySelector('.prev-ch[href]:not([href="#"])');
            if (p) window.location.href = p.getAttribute('href');
          }
        }
      }
    }, { passive: true });
  }

  /* ===== PAGE MODE ===== */
  function enterPageMode() {
    state.pageMode = true;
    document.body.classList.add('page-mode');
    recalcPages();
    updatePageModeUI();
    localStorage.setItem('reader-pagemode', 'true');
  }

  function exitPageMode() {
    state.pageMode = false;
    document.body.classList.remove('page-mode');
    updatePageModeUI();
    localStorage.setItem('reader-pagemode', 'false');
  }

  function recalcPages() {
    var content = document.querySelector('.chapter-content');
    if (!content) return;
    var contentH = content.scrollHeight;
    var vh = window.innerHeight;
    var pageH = vh - 20; // small margin
    state.totalPages = Math.max(1, Math.ceil(contentH / pageH));
    if (state.currentPage >= state.totalPages) state.currentPage = state.totalPages - 1;
    updatePageIndicator();
  }

  function goToPage(n) {
    if (n < 0) {
      var p = document.querySelector('.prev-ch[href]:not([href="#"])');
      if (p) { saveProgress(0); window.location.href = p.getAttribute('href'); }
      return;
    }
    if (n >= state.totalPages) {
      saveProgress(100);
      var nx = document.querySelector('.next-ch[href]:not([href="#"])');
      if (nx) window.location.href = nx.getAttribute('href');
      return;
    }
    state.currentPage = n;
    var pageH = window.innerHeight - 20;
    window.scrollTo({ top: n * pageH, behavior: 'smooth' });
    updatePageIndicator();
    saveProgress(Math.round((n / state.totalPages) * 100));
  }

  function updatePageIndicator() {
    var el = document.getElementById('pageIndicator');
    if (!el) return;
    el.textContent = (state.currentPage + 1) + ' / ' + state.totalPages;
  }

  function updatePageModeUI() {
    var btn = document.getElementById('pageModeToggle');
    if (btn) btn.textContent = state.pageMode ? '左右翻页' : '上下滑动';
    var ind = document.getElementById('pageIndicator');
    if (ind) ind.style.display = state.pageMode ? 'flex' : 'none';
  }

  window.togglePageMode = function() {
    if (state.pageMode) {
      exitPageMode();
    } else {
      enterPageMode();
    }
    if (state.barsVisible) { stopAutoClose(); startAutoClose(); }
  };

  /* ===== READING PROGRESS ===== */
  function saveProgress(pct) {
    if (pct === undefined) {
      if (state.pageMode) {
        pct = state.totalPages > 1 ? Math.round((state.currentPage / state.totalPages) * 100) : 0;
      } else {
        var st = window.scrollY;
        var dh = document.documentElement.scrollHeight - window.innerHeight;
        pct = dh > 0 ? Math.min(Math.round((st / dh) * 100), 100) : 0;
      }
    }
    localStorage.setItem('reader-pos-' + chapterId, pct);
    if (pct >= 95) localStorage.setItem('reader-done-' + chapterId, '1');
    updateProgressFill(pct);
  }

  function restoreProgress() {
    var pct = parseInt(localStorage.getItem('reader-pos-' + chapterId)) || 0;
    if (pct > 0 && pct < 95) {
      setTimeout(function() {
        if (state.pageMode) {
          var page = Math.floor((pct / 100) * state.totalPages);
          state.currentPage = page;
          var pageH = window.innerHeight - 20;
          window.scrollTo({ top: page * pageH });
          updatePageIndicator();
        } else {
          var target = (pct / 100) * (document.documentElement.scrollHeight - window.innerHeight);
          window.scrollTo({ top: target });
        }
      }, 200);
    }
    updateProgressFill(pct);
  }

  function updateProgressFill(pct) {
    var line = document.querySelector('.reading-progress-line');
    var fill = document.getElementById('progressFill');
    if (line) line.style.width = pct + '%';
    if (fill) fill.style.width = pct + '%';
  }

  function initReadingProgress() {
    updateProgressFill(parseInt(localStorage.getItem('reader-pos-' + chapterId)) || 0);
    window.addEventListener('scroll', function() {
      if (!state.pageMode) saveProgress();
    }, { passive: true });
    window.addEventListener('beforeunload', function() { saveProgress(); });
  }

  /* ===== CENTERED DIRECTORY PANEL ===== */
  function initDirectoryPanel() {
    if (document.getElementById('dirOverlay')) return;
    var ov = document.createElement('div');
    ov.id = 'dirOverlay';
    ov.className = 'modal-overlay';
    ov.innerHTML =
      '<div class="modal-backdrop"></div>' +
      '<div class="modal-panel dir-modal">' +
        '<div class="modal-header"><span>目录</span>' +
          '<button class="modal-close" onclick="closeDirectory()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="modal-body" id="dirList"></div>' +
      '</div>';
    (document.querySelector('.reading-wrapper') || document.body).appendChild(ov);
    ov.querySelector('.modal-backdrop').addEventListener('click', closeDirectory);
    populateDirectory();
  }

  function populateDirectory() {
    var list = document.getElementById('dirList');
    if (!list) return;
    var path = window.location.pathname;
    var file = path.substring(path.lastIndexOf('/') + 1) || 'chapter-01.html';
    var chapters = [
      { num: 1, title: '第一章·临渊羡鱼', href: 'chapter-01.html', words: 2722, id: 'chapter-01-html' },
      { num: 2, title: '第二章·前桌', href: 'chapter-02.html', words: 2257, id: 'chapter-02-html' }
    ];

    var html = '';
    chapters.forEach(function(ch) {
      var done = localStorage.getItem('reader-done-' + ch.id) === '1';
      var pct = parseInt(localStorage.getItem('reader-pos-' + ch.id)) || 0;
      var active = ch.href === file;
      html += '<a href="' + ch.href + '" class="dir-item' + (active ? ' active' : '') + (done ? ' done' : '') + '">';
      html += '<span class="dir-item-num">第' + ch.num + '章</span>';
      html += '<span class="dir-item-title">' + ch.title + '</span>';
      html += '<span class="dir-item-info">';
      if (pct > 0 && pct < 95) html += '<span class="dir-item-progress">' + pct + '%</span>';
      html += '<span class="dir-item-words">' + ch.words + '字</span></span>';
      html += '</a>';
    });
    list.innerHTML = html;
  }

  window.openDirectory = function() {
    populateDirectory(); // refresh progress
    var ov = document.getElementById('dirOverlay');
    if (ov) { ov.classList.add('visible'); document.body.style.overflow = 'hidden'; }
    if (state.barsVisible) hideBars();
  };

  window.closeDirectory = function() {
    var ov = document.getElementById('dirOverlay');
    if (ov) { ov.classList.remove('visible'); document.body.style.overflow = ''; }
  };

  /* ===== SETTINGS PANEL ===== */
  function initSettingsPanel() {
    if (document.getElementById('settingsOverlay')) return;
    var themes = ['light','wheat','green','dark'];
    var themeNames = ['亮白','暖纸','护眼','暗夜'];
    var ov = document.createElement('div');
    ov.id = 'settingsOverlay';
    ov.className = 'modal-overlay';
    var themeHTML = '';
    themes.forEach(function(t, i) {
      themeHTML += '<div class="theme-circle' + (state.theme === t ? ' active' : '') + '" data-theme="' + t + '" onclick="setTheme(\'' + t + '\')"><div class="circle-dot ' + t + '-bg"></div><span class="theme-label">' + themeNames[i] + '</span></div>';
    });
    ov.innerHTML =
      '<div class="modal-backdrop"></div>' +
      '<div class="modal-panel settings-modal">' +
        '<div class="modal-header"><span>设置</span>' +
          '<button class="modal-close" onclick="closeSettings()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div class="setting-group"><div class="setting-label">阅读背景</div>' +
            '<div class="theme-row">' + themeHTML + '</div>' +
          '</div>' +
          '<div class="setting-group"><div class="setting-label">字号</div>' +
            '<div class="fontsize-row">' +
              '<button class="fontsize-btn" onclick="changeFontSize(-1)">A−</button>' +
              '<span class="fontsize-current" id="fontSizeLabel">大</span>' +
              '<button class="fontsize-btn" onclick="changeFontSize(1)">A+</button>' +
            '</div>' +
          '</div>' +
          '<div class="setting-group"><div class="setting-label">阅读模式</div>' +
            '<div class="mode-toggle-row">' +
              '<button id="pageModeToggle" class="mode-toggle-btn" onclick="togglePageMode()">上下滑动</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    (document.querySelector('.reading-wrapper') || document.body).appendChild(ov);
    ov.querySelector('.modal-backdrop').addEventListener('click', closeSettings);
  }

  window.openSettings = function() {
    var ov = document.getElementById('settingsOverlay');
    if (!ov) { initSettingsPanel(); ov = document.getElementById('settingsOverlay'); }
    // Refresh theme circles
    var circles = ov.querySelectorAll('.theme-circle');
    circles.forEach(function(c) { c.classList.toggle('active', c.dataset.theme === state.theme); });
    updatePageModeUI();
    if (ov) { ov.classList.add('visible'); document.body.style.overflow = 'hidden'; }
    if (state.barsVisible) { stopAutoClose(); startAutoClose(); }
  };

  window.closeSettings = function() {
    var ov = document.getElementById('settingsOverlay');
    if (ov) { ov.classList.remove('visible'); document.body.style.overflow = ''; }
  };

  /* ===== START ===== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
