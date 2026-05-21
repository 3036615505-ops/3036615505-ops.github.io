/**
 * 阅读器 — 上下滚动 · 阅读记录 · 目录弹窗 · 设置面板
 */
(function() {
  'use strict';

  /* ===== STATE ===== */
  var state = {
    fontSize: localStorage.getItem('reader-fontsize') || 'large',
    theme: localStorage.getItem('reader-theme') || 'wheat',
    fontFamily: localStorage.getItem('reader-fontfamily') || 'fzyouhei',
    barsVisible: false,
    settingsVisible: false,
    autoCloseTimer: null
  };

  var fontSizes = ['small', 'medium', 'large'];
  var fontSizeLabels = { small: '小', medium: '中', large: '大' };
  var fontSizeValues = { small: 19, medium: 22, large: 25 };

  var fontFamilies = ['fzyouhei', 'serif'];
  var fontFamilyLabels = { fzyouhei: '方正悠黑', serif: '宋体' };

  var chapterId = window.location.pathname.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');

  function clampProgress(pct) {
    pct = parseInt(pct, 10);
    if (isNaN(pct)) pct = 0;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    return pct;
  }

  function getCurrentProgressPct() {
    var dh = document.documentElement.scrollHeight - window.innerHeight;
    if (dh <= 0) return 0;
    return clampProgress(Math.round((window.scrollY / dh) * 100));
  }

  function scrollToProgress(pct) {
    pct = clampProgress(pct);
    var dh = document.documentElement.scrollHeight - window.innerHeight;
    if (dh <= 0) return;
    window.scrollTo({ top: (pct / 100) * dh, behavior: 'auto' });
  }

  function refreshProgressControls(pct) {
    pct = clampProgress(pct);
    updateProgressFill(pct);
    var slider = document.getElementById('chapterProgressSlider');
    if (slider) {
      slider.value = pct;
      slider.style.setProperty('--progress-pct', pct + '%');
    }
    var value = document.getElementById('chapterProgressValue');
    if (value) value.textContent = pct + '%';
  }


  /* ===== INIT ===== */
  function init() {
    applyFontSize(state.fontSize);
    applyFontFamily(state.fontFamily);
    applyTheme(state.theme);
    initPageTransition();
    initTapArea();
    initSwipe();
    initReadingProgress();
    initDirectoryPanel();
    initSettingsPanel();
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
  };

  /* ===== FONT FAMILY ===== */
  function applyFontFamily(family) {
    state.fontFamily = family;
    localStorage.setItem('reader-fontfamily', family);
    var content = document.querySelector('.chapter-content');
    if (!content) return;
    if (family === 'fzyouhei') {
      content.style.fontFamily = '"FZYouHei","方正悠黑","PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    } else {
      content.style.fontFamily = '"Noto Serif SC","STSong","SimSun",serif';
    }
    var label = document.getElementById('fontFamilyLabel');
    if (label) label.textContent = fontFamilyLabels[family] || '方正悠黑';
  }

  window.toggleFontFamily = function() {
    var idx = fontFamilies.indexOf(state.fontFamily);
    idx = (idx + 1) % fontFamilies.length;
    applyFontFamily(fontFamilies[idx]);
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

  /* ===== PAGE TRANSITION ===== */
  function initPageTransition() {
    var ov = document.createElement('div');
    ov.className = 'page-transition';
    ov.id = 'pageTransition';
    ov.innerHTML =
      '<div class="transition-inner">' +
        '<svg viewBox="0 0 40 40" fill="none" width="40" height="40">' +
          '<path class="leaf-path" d="M20 4c0 0-8 4-10 12s4 16 10 20c6-4 12-12 10-20S20 4 20 4z" stroke="var(--accent)" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
          '<path class="leaf-vein" d="M20 8v24M20 14l-4 4M20 14l4 4M20 20l-5 3M20 20l5 3" stroke="var(--accent)" stroke-width="0.8" opacity="0.5" stroke-linecap="round"/>' +
        '</svg>' +
      '</div>';
    (document.querySelector('.reading-wrapper') || document.body).appendChild(ov);

    // 入场动画（从站内跳转过来时显示）
    if (sessionStorage.getItem('page-transitioning')) {
      sessionStorage.removeItem('page-transitioning');
      ov.classList.add('active');
      setTimeout(function() { ov.classList.remove('active'); }, 600);
    }

    // 安全网：清除任何残留的遮罩
    function resetOverlay() {
      document.querySelectorAll('.page-transition.active').forEach(function(el) { el.classList.remove('active'); });
    }
    window.addEventListener('pageshow', resetOverlay);
    window.addEventListener('focus', resetOverlay);
    document.addEventListener('visibilitychange', function() { if (!document.hidden) resetOverlay(); });

    // 点击跳转
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a[href]');
      if (!link) return;
      var href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript') || link.getAttribute('onclick')) return;
      e.preventDefault();
      sessionStorage.setItem('page-transitioning', '1');
      window.location.href = href;
    });
  }

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

  /* ===== TAP AREA (上下滚动) ===== */
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

      if (y > h * 0.30 && y < h * 0.65) {
        state.barsVisible ? hideBars() : showBars();
      } else if (y <= h * 0.30) {
        if (state.barsVisible) hideBars();
        window.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' });
      } else {
        if (state.barsVisible) hideBars();
        window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
      }
    });
  }

  /* ===== SWIPE (左右切章) ===== */
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
    }, { passive: true });
  }

  /* ===== READING PROGRESS ===== */
  function saveProgress(pct) {
    if (pct === undefined) pct = getCurrentProgressPct();
    pct = clampProgress(pct);
    localStorage.setItem('reader-pos-' + chapterId, pct);
    if (pct >= 95) {
      localStorage.setItem('reader-done-' + chapterId, '1');
    } else {
      localStorage.removeItem('reader-done-' + chapterId);
    }
    refreshProgressControls(pct);
  }

  function restoreProgress() {
    var pct = clampProgress(localStorage.getItem('reader-pos-' + chapterId));
    if (pct > 0 && pct < 95) {
      setTimeout(function() { scrollToProgress(pct); }, 200);
    }
    refreshProgressControls(pct);
  }

  function updateProgressFill(pct) {
    pct = clampProgress(pct);
    var line = document.querySelector('.reading-progress-line');
    var fill = document.getElementById('progressFill');
    if (line) line.style.width = pct + '%';
    if (fill) fill.style.width = pct + '%';
  }

  function initReadingProgress() {
    refreshProgressControls(clampProgress(localStorage.getItem('reader-pos-' + chapterId)));
    window.addEventListener('scroll', function() { saveProgress(); }, { passive: true });
    window.addEventListener('beforeunload', function() { saveProgress(); });
  }

  /* ===== DIRECTORY PANEL ===== */
  function getChapterStorageId(href) {
    var path = '/novel/' + href;
    return path.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  }

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
      { num: 1, title: '第一章·临渊羡鱼', href: 'chapter-01.html', words: 2722 },
      { num: 2, title: '第二章·前桌', href: 'chapter-02.html', words: 2257 }
    ];

    var html = '';
    chapters.forEach(function(ch) {
      var id = getChapterStorageId(ch.href);
      var done = localStorage.getItem('reader-done-' + id) === '1';
      var pct = parseInt(localStorage.getItem('reader-pos-' + id)) || 0;
      var active = ch.href === file;

      html += '<a href="' + ch.href + '" class="dir-item' + (active ? ' active' : '') + (done ? ' done' : '') + '">';
      html += '<span class="dir-item-num">第' + ch.num + '章</span>';
      html += '<span class="dir-item-title">' + ch.title + '</span>';
      html += '<span class="dir-item-info">';
      if (done) {
        html += '<span class="dir-item-done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>';
      } else if (pct > 0) {
        html += '<span class="dir-item-progress">' + pct + '%</span>';
      }
      html += '<span class="dir-item-words">' + ch.words + '字</span>';
      html += '</span></a>';
    });
    list.innerHTML = html;
  }

  window.openDirectory = function() {
    populateDirectory();
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
          '<div class="setting-group progress-setting"><div class="setting-row-head"><div class="setting-label">当前章节进度</div><span class="progress-value" id="chapterProgressValue">0%</span></div>' +
            '<input type="range" min="0" max="100" value="0" class="chapter-progress-slider" id="chapterProgressSlider" aria-label="当前章节进度">' +
            '<div class="progress-hints"><span>开头</span><span>本章末尾</span></div>' +
          '</div>' +
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
          '<div class="setting-group"><div class="setting-label">字体</div>' +
            '<div class="mode-toggle-row">' +
              '<button id="fontFamilyToggle" class="mode-toggle-btn" onclick="toggleFontFamily()"><span id="fontFamilyLabel">' + (fontFamilyLabels[state.fontFamily] || '方正悠黑') + '</span></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    (document.querySelector('.reading-wrapper') || document.body).appendChild(ov);
    ov.querySelector('.modal-backdrop').addEventListener('click', closeSettings);

    var slider = document.getElementById('chapterProgressSlider');
    if (slider) {
      slider.addEventListener('input', function() {
        refreshProgressControls(slider.value);
      });
      slider.addEventListener('change', function() {
        var pct = clampProgress(slider.value);
        scrollToProgress(pct);
        saveProgress(pct);
      });
    }
  }

  window.openSettings = function() {
    var ov = document.getElementById('settingsOverlay');
    if (!ov) { initSettingsPanel(); ov = document.getElementById('settingsOverlay'); }
    var circles = ov.querySelectorAll('.theme-circle');
    circles.forEach(function(c) { c.classList.toggle('active', c.dataset.theme === state.theme); });
    var fl = document.getElementById('fontFamilyLabel');
    if (fl) fl.textContent = fontFamilyLabels[state.fontFamily] || '方正悠黑';
    refreshProgressControls(getCurrentProgressPct());
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
