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

  var transitionLines = [
    '风从走廊尽头吹过来',
    '有些话还没说，故事已经往前了',
    '夕阳落下去的时候，影子会变长',
    '下一页有人会抬头看你一眼',
    '梧桐影子轻轻翻过一页'
  ];

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
    initQuoteCollecting();
    recordFootprints();
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
    recordThemeUse(theme);
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
        '<div class="transition-leaves"><span class="leaf gold"></span><span class="leaf green"></span><span class="leaf brown"></span><span class="leaf gold soft"></span><span class="leaf green soft"></span></div>' +
        '<svg viewBox="0 0 40 40" fill="none" width="40" height="40">' +
          '<path class="leaf-path" d="M20 4c0 0-8 4-10 12s4 16 10 20c6-4 12-12 10-20S20 4 20 4z" stroke="var(--accent)" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
          '<path class="leaf-vein" d="M20 8v24M20 14l-4 4M20 14l4 4M20 20l-5 3M20 20l5 3" stroke="var(--accent)" stroke-width="0.8" opacity="0.5" stroke-linecap="round"/>' +
        '</svg>' +
        '<div class="transition-text">' + getTransitionLine() + '</div>' +
      '</div>';
    (document.querySelector('.reading-wrapper') || document.body).appendChild(ov);

    // 入场动画（从站内跳转过来时显示）
    if (sessionStorage.getItem('page-transitioning')) {
      sessionStorage.removeItem('page-transitioning');
      requestAnimationFrame(function() {
        ov.classList.add('active');
        setTimeout(function() { ov.classList.remove('active'); }, 650);
      });
    }

    // 安全网：清除任何残留的遮罩
    function resetOverlay() {
      document.querySelectorAll('.page-transition.active').forEach(function(el) { el.classList.remove('active'); });
    }
    window.addEventListener('pageshow', function() { setTimeout(resetOverlay, 700); });
    window.addEventListener('focus', function() { setTimeout(resetOverlay, 700); });
    document.addEventListener('visibilitychange', function() { if (!document.hidden) setTimeout(resetOverlay, 700); });

    // 点击跳转
    document.addEventListener('click', function(e) {
      var link = e.target.closest('a[href]');
      if (!link) return;
      var href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript') || link.getAttribute('onclick') || link.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      ov.querySelector('.transition-text').textContent = pickTransitionLine();
      ov.classList.add('active');
      sessionStorage.setItem('page-transitioning', '1');
      setTimeout(function() { window.location.href = href; }, 120);
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
    document.addEventListener('click', function(e) {
      if (e.defaultPrevented) return;
      if (window.getSelection && String(window.getSelection()).trim()) return;
      if (e.target.closest('.reader-topbar, .reader-bottombar, .chapter-bottom-nav, .modal-panel, .modal-backdrop, .quote-mark, a, button, input, textarea, select')) return;

      var dirOv = document.getElementById('dirOverlay');
      if (dirOv && dirOv.classList.contains('visible')) { closeDirectory(); return; }
      var setOv = document.getElementById('settingsOverlay');
      if (setOv && setOv.classList.contains('visible')) { closeSettings(); return; }
      var quotesOv = document.getElementById('quotesOverlay');
      if (quotesOv && quotesOv.classList.contains('visible')) { closeQuotes(); return; }

      var y = e.clientY;
      var h = window.innerHeight;

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

    var progressBar = document.querySelector('.reader-progress-bar');
    if (progressBar) {
      var dragging = false;

      function updateFromPointer(e) {
        var rect = progressBar.getBoundingClientRect();
        var pct = clampProgress(Math.round(((e.clientX - rect.left) / rect.width) * 100));
        scrollToProgress(pct);
        saveProgress(pct);
      }

      progressBar.addEventListener('pointerdown', function(e) {
        e.preventDefault();
        dragging = true;
        stopAutoClose();
        if (progressBar.setPointerCapture) progressBar.setPointerCapture(e.pointerId);
        progressBar.classList.add('dragging');
        updateFromPointer(e);
      });

      progressBar.addEventListener('pointermove', function(e) {
        if (!dragging) return;
        e.preventDefault();
        updateFromPointer(e);
      });

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        progressBar.classList.remove('dragging');
        if (progressBar.releasePointerCapture) progressBar.releasePointerCapture(e.pointerId);
        if (state.barsVisible) startAutoClose();
      }

      progressBar.addEventListener('pointerup', endDrag);
      progressBar.addEventListener('pointercancel', endDrag);
    }

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

  function initQuoteCollecting() {
    decorateParagraphs();
    initQuotesPanel();
    initToast();
  }

  function decorateParagraphs() {
    var content = document.querySelector('.chapter-content');
    if (!content) return;
    var file = getCurrentFileName();
    var title = getCurrentChapterTitle();
    var index = 0;
    content.querySelectorAll('p').forEach(function(p) {
      var text = (p.textContent || '').trim();
      if (!text) return;
      index += 1;
      p.dataset.quoteIndex = String(index);
      p.dataset.chapterFile = file;
      p.dataset.chapterTitle = title;
      p.classList.add('collectable-paragraph');
      if (p.querySelector('.quote-mark')) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quote-mark';
      btn.setAttribute('aria-label', '收藏这一句');
      btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 7H5a1 1 0 00-1 1v4a1 1 0 001 1h3v4l4-4V8a1 1 0 00-1-1H8z"/><path d="M19 7h-3a1 1 0 00-1 1v4a1 1 0 001 1h3v4l4-4V8a1 1 0 00-1-1h-3z" transform="translate(-3 0)"/></svg>';
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleQuote(p);
      });
      p.appendChild(btn);
      refreshParagraphQuoteState(p);
    });
  }

  function initQuotesPanel() {
    if (document.getElementById('quotesOverlay')) return;
    var ov = document.createElement('div');
    ov.id = 'quotesOverlay';
    ov.className = 'modal-overlay';
    ov.innerHTML =
      '<div class="modal-backdrop"></div>' +
      '<div class="modal-panel quotes-modal">' +
        '<div class="modal-header"><span>摘句簿</span>' +
          '<button class="modal-close" onclick="closeQuotes()">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="modal-body" id="quotesList"></div>' +
      '</div>';
    (document.querySelector('.reading-wrapper') || document.body).appendChild(ov);
    ov.querySelector('.modal-backdrop').addEventListener('click', closeQuotes);
  }

  window.openQuotes = function() {
    renderQuotesPanel();
    var ov = document.getElementById('quotesOverlay');
    if (ov) { ov.classList.add('visible'); document.body.style.overflow = 'hidden'; }
    if (state.barsVisible) hideBars();
  };

  window.closeQuotes = function() {
    var ov = document.getElementById('quotesOverlay');
    if (ov) { ov.classList.remove('visible'); document.body.style.overflow = ''; }
  };

  function renderQuotesPanel() {
    var list = document.getElementById('quotesList');
    if (!list) return;
    var quotes = getStoredQuotes();
    if (!quotes.length) {
      list.innerHTML = '<div class="quotes-empty">还没有收进摘句。等你在某一段前停下来，这里就会亮起来。</div>';
      return;
    }
    list.innerHTML = quotes.slice().reverse().map(function(item) {
      return '<article class="quote-entry">' +
        '<div class="quote-entry-text">' + escapeHtml(item.text) + '</div>' +
        '<div class="quote-entry-meta">' + escapeHtml(item.chapterTitle) + '</div>' +
        '<div class="quote-entry-actions">' +
          '<a href="' + item.chapterFile + '#quote-' + item.index + '" class="quote-action">回到这一页</a>' +
          '<button type="button" class="quote-action" onclick="copyQuote(\'' + escapeJs(item.id) + '\')">复制</button>' +
          '<button type="button" class="quote-action danger" onclick="removeQuote(\'' + escapeJs(item.id) + '\')">移出</button>' +
        '</div>' +
      '</article>';
    }).join('');
  }

  window.copyQuote = function(id) {
    var quote = getStoredQuotes().find(function(item) { return item.id === id; });
    if (!quote) return;
    var text = quote.text + ' ——《' + quote.chapterTitle + '》';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        showToast('这一句已经抄好');
      }, function() {
        showToast('没抄走，再试一次');
      });
    } else {
      showToast('当前环境不支持复制');
    }
  };

  window.removeQuote = function(id) {
    var quotes = getStoredQuotes().filter(function(item) { return item.id !== id; });
    saveStoredQuotes(quotes);
    refreshAllParagraphQuoteStates();
    renderQuotesPanel();
    showToast('这一句轻轻放回页边了');
  };

  function toggleQuote(p) {
    var text = (p.textContent || '').trim();
    if (!text) return;
    var quotes = getStoredQuotes();
    var file = p.dataset.chapterFile || getCurrentFileName();
    var index = p.dataset.quoteIndex || '0';
    var id = file + '::' + index;
    var existing = quotes.findIndex(function(item) { return item.id === id; });
    if (existing >= 0) {
      quotes.splice(existing, 1);
      saveStoredQuotes(quotes);
      refreshParagraphQuoteState(p);
      renderQuotesPanel();
      showToast('这一句轻轻放回页边了');
      return;
    }
    quotes.push({
      id: id,
      text: text,
      chapterFile: file,
      chapterTitle: p.dataset.chapterTitle || getCurrentChapterTitle(),
      index: index,
      savedAt: Date.now()
    });
    saveStoredQuotes(quotes);
    refreshParagraphQuoteState(p);
    renderQuotesPanel();
    showToast('已收进摘句簿');
  }

  function refreshParagraphQuoteState(p) {
    var btn = p.querySelector('.quote-mark');
    if (!btn) return;
    var id = (p.dataset.chapterFile || getCurrentFileName()) + '::' + (p.dataset.quoteIndex || '0');
    var active = getStoredQuotes().some(function(item) { return item.id === id; });
    btn.classList.toggle('active', active);
    p.classList.toggle('quoted', active);
    p.id = 'quote-' + (p.dataset.quoteIndex || '0');
  }

  function refreshAllParagraphQuoteStates() {
    document.querySelectorAll('.collectable-paragraph').forEach(refreshParagraphQuoteState);
  }

  function getStoredQuotes() {
    var raw = localStorage.getItem('reader-quotes');
    if (!raw) return [];
    try { return JSON.parse(raw) || []; } catch (err) { return []; }
  }

  function saveStoredQuotes(quotes) {
    localStorage.setItem('reader-quotes', JSON.stringify(quotes));
    mergeFootprints(function(data) {
      data.quotes = quotes.map(function(item) { return item.id; });
      return data;
    });
  }

  function initToast() {
    if (document.getElementById('readerToast')) return;
    var toast = document.createElement('div');
    toast.id = 'readerToast';
    toast.className = 'reader-toast';
    (document.querySelector('.reading-wrapper') || document.body).appendChild(toast);
  }

  function showToast(text) {
    var toast = document.getElementById('readerToast');
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function() { toast.classList.remove('visible'); }, 1600);
  }

  function recordFootprints() {
    mergeFootprints(function(data) {
      var today = getTodayToken();
      if (!Array.isArray(data.days)) data.days = [];
      if (data.days.indexOf(today) === -1) data.days.push(today);
      data.lastChapterTitle = getCurrentChapterTitle();
      data.lastChapterFile = getCurrentFileName();
      if (!Array.isArray(data.quotes)) data.quotes = [];
      if (!data.themeCounts || typeof data.themeCounts !== 'object') data.themeCounts = {};
      return data;
    });
  }

  function recordThemeUse(theme) {
    mergeFootprints(function(data) {
      if (!data.themeCounts || typeof data.themeCounts !== 'object') data.themeCounts = {};
      data.themeCounts[theme] = (data.themeCounts[theme] || 0) + 1;
      data.lastTheme = theme;
      return data;
    });
  }

  function mergeFootprints(mutator) {
    var data = readFootprints();
    data = mutator(data) || data;
    localStorage.setItem('reader-footprints', JSON.stringify(data));
  }

  function readFootprints() {
    var raw = localStorage.getItem('reader-footprints');
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch (err) { return {}; }
  }

  function getTodayToken() {
    var d = new Date();
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');
  }

  function getCurrentFileName() {
    var path = window.location.pathname;
    return path.substring(path.lastIndexOf('/') + 1) || 'chapter-01.html';
  }

  function getCurrentChapterTitle() {
    var el = document.querySelector('.chapter-content h1');
    return el ? el.textContent.trim() : document.title;
  }

  function getTransitionLine() {
    var saved = sessionStorage.getItem('page-transition-text');
    if (saved) {
      sessionStorage.removeItem('page-transition-text');
      return saved;
    }
    return transitionLines[Math.floor(Math.random() * transitionLines.length)];
  }

  function pickTransitionLine() {
    var line = transitionLines[Math.floor(Math.random() * transitionLines.length)];
    sessionStorage.setItem('page-transition-text', line);
    return line;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function escapeJs(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  /* ===== SETTINGS PANEL ===== */
  function initSettingsPanel() {
    if (document.getElementById('settingsOverlay')) return;
    var themes = ['light','wheat','green','dark'];
    var themeNames = ['晴窗','信笺','梧阴','夜读'];
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
          '<div class="setting-group"><div class="setting-label">阅读模式</div>' +
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
  }

  window.openSettings = function() {
    var ov = document.getElementById('settingsOverlay');
    if (!ov) { initSettingsPanel(); ov = document.getElementById('settingsOverlay'); }
    var circles = ov.querySelectorAll('.theme-circle');
    circles.forEach(function(c) { c.classList.toggle('active', c.dataset.theme === state.theme); });
    var fl = document.getElementById('fontFamilyLabel');
    if (fl) fl.textContent = fontFamilyLabels[state.fontFamily] || '方正悠黑';
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
