/**
 * 阅读器 — 上下滚动 · 阅读记录 · 目录弹窗 · 设置面板
 */
(function() {
  'use strict';

  /* ===== STATE ===== */
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var state = {
    fontSize: localStorage.getItem('reader-fontsize') || 'medium',
    theme: localStorage.getItem('reader-theme') || (systemDark ? 'dark' : 'wheat'),
    fontFamily: localStorage.getItem('reader-fontfamily') || 'fzyouhei',
    readWidth: localStorage.getItem('reader-readwidth') || 'normal',
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
  var fontFamilyLabels = { fzyouhei: '黑体', serif: '衬线' };

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
    applyReadWidth(state.readWidth);
    applyTheme(state.theme);
    initPageTransition();
    initTapArea();
    initSwipe();
    initReadingProgress();
    initDirectoryPanel();
    initSettingsPanel();
    initQuoteCollecting();
    initModalKeys();
    initSwipeHint();
    recordFootprints();
    restoreProgress();
    initImmersive();
  }

  /* ===== 沉浸模式：隐藏系统状态栏 + 底部固定状态条 =====
     参考番茄小说：底部是一条固定、不透明、不随正文滚动的状态栏，
     正文滚到它下面会被盖住；左侧为章节内位置，右侧为时间与电量。 */
  function initImmersive() {
    var bridge = window.LinyuanApp;
    var canImmersive = bridge && typeof bridge.setImmersive === 'function';

    var el = document.createElement('div');
    el.id = 'readerStatus';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<span id="readerPos">0/0</span>' +
      '<span id="readerBattery">' +
        '<span id="readerClock">--:--</span>' +
        '<span id="readerBattGlyph"></span>' +
      '</span>';
    document.body.appendChild(el);

    var posEl = el.querySelector('#readerPos');
    var clockEl = el.querySelector('#readerClock');
    var battEl = el.querySelector('#readerBattGlyph');
    var article = document.querySelector('.chapter-content');

    /* ----- 章节内页码（当前页 / 总页数，番茄同款按屏折算） ----- */
    function updatePos() {
      if (!posEl) return;
      var sc = document.scrollingElement || document.documentElement;
      var viewH = window.innerHeight || sc.clientHeight || 1;
      var total = Math.max(1, Math.ceil(sc.scrollHeight / viewH));
      var y = sc.scrollTop || window.scrollY || 0;
      var cur = Math.min(total, Math.floor(y / viewH) + 1);
      posEl.textContent = cur + '/' + total;
    }

    var posScheduled = false;
    window.addEventListener('scroll', function () {
      if (posScheduled) return;
      posScheduled = true;
      requestAnimationFrame(function () { posScheduled = false; updatePos(); });
    }, { passive: true });

    /* ----- 时间 ----- */
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function updateClock() {
      var d = new Date();
      clockEl.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    /* ----- 电量（只有 App 内才拿得到，浏览器里留空） ----- */
    function batteryHtml(level, charging) {
      if (typeof level !== 'number' || level < 0) return '';
      var pct = Math.max(0, Math.min(100, level));
      var w = Math.max(1, Math.round(13 * pct / 100));
      return '<span class="batt-shell"><span class="batt-level" style="width:' + w + 'px"></span></span>' +
        '<span class="batt-tip"></span>' +
        (charging ? '<span class="batt-charge">⚡</span>' : '') +
        '<span class="batt-pct">' + pct + '</span>';
    }

    function updateBattery() {
      if (!bridge || typeof bridge.getBattery !== 'function') {
        battEl.innerHTML = '';
        return;
      }
      try {
        var info = JSON.parse(bridge.getBattery() || '{}');
        battEl.innerHTML = batteryHtml(info.level, info.charging);
      } catch (e) {
        battEl.innerHTML = '';
      }
    }

    updatePos();
    updateClock();
    updateBattery();
    window.addEventListener('resize', updatePos);
    setInterval(updateClock, 15000);
    setInterval(updateBattery, 60000);

    if (canImmersive) {
      bridge.setImmersive(true);
      // 标记沉浸：壳已为挖孔留好顶部空间，正文不再重复叠加安全区
      document.body.classList.add('app-immersive');
    }
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

  /* ===== FONT FAMILY =====
     安卓上 PingFang / 宋体 / 微软雅黑 都不存在，原先那串字体名最后全落到同一个
     系统默认黑体，所以按钮看着像失效。这里做两件事：
       1. 用 canvas 实测系统有没有真正的中文衬线字体；
       2. 没有的话用站点自带的小薇字体（已随 SW 预缓存，不额外下载）作为衬线选项。 */
  var systemSerifAvailable = null;

  function detectSystemSerif() {
    if (systemSerifAvailable !== null) return systemSerifAvailable;
    try {
      var ctx = document.createElement('canvas').getContext('2d');
      ctx.font = '40px serif';
      var serifW = ctx.measureText('临渊羡鱼梧桐').width;
      ctx.font = '40px sans-serif';
      var sansW = ctx.measureText('临渊羡鱼梧桐').width;
      // 宽度一致说明 serif 回退到了同一套字形
      systemSerifAvailable = Math.abs(serifW - sansW) > 0.5;
    } catch (e) {
      systemSerifAvailable = false;
    }
    return systemSerifAvailable;
  }

  function serifStack() {
    return detectSystemSerif()
      ? '"Noto Serif CJK SC","Noto Serif SC","Source Han Serif SC","Songti SC",serif'
      : '"ZCOOL XiaoWei","Noto Serif CJK SC",serif';
  }

  function applyFontFamily(family) {
    state.fontFamily = family;
    localStorage.setItem('reader-fontfamily', family);
    var content = document.querySelector('.chapter-content');
    if (content) {
      content.style.fontFamily = family === 'serif'
        ? serifStack()
        : '-apple-system,"PingFang SC","Noto Sans CJK SC","Noto Sans SC","Microsoft YaHei",sans-serif';
    }
    var label = document.getElementById('fontFamilyLabel');
    if (label) label.textContent = fontFamilyLabels[family] || '黑体';
  }

  window.toggleFontFamily = function() {
    var idx = fontFamilies.indexOf(state.fontFamily);
    idx = (idx + 1) % fontFamilies.length;
    applyFontFamily(fontFamilies[idx]);
  };

  /* ===== 宽屏阅读（桌面端生效） ===== */
  function applyReadWidth(mode) {
    state.readWidth = mode;
    localStorage.setItem('reader-readwidth', mode);
    if (mode === 'wide') {
      document.documentElement.setAttribute('data-readwidth', 'wide');
    } else {
      document.documentElement.removeAttribute('data-readwidth');
    }
    var label = document.getElementById('readWidthLabel');
    if (label) label.textContent = mode === 'wide' ? '宽屏阅读 · 开' : '宽屏阅读 · 关';
  }

  window.toggleReadWidth = function() {
    applyReadWidth(state.readWidth === 'wide' ? 'normal' : 'wide');
  };

  /* ===== 首次手势提示（仅触屏设备，显示一次） ===== */
  function initSwipeHint() {
    if (!('ontouchstart' in window)) return;
    if (!document.querySelector('.chapter-content')) return;
    if (localStorage.getItem('reader-swipe-hint')) return;
    localStorage.setItem('reader-swipe-hint', '1');
    var hint = document.createElement('div');
    hint.className = 'swipe-hint';
    hint.textContent = '← 轻扫左右，翻章 →';
    document.body.appendChild(hint);
    setTimeout(function() { hint.classList.add('show'); }, 1200);
    setTimeout(function() { hint.classList.remove('show'); }, 5200);
    setTimeout(function() { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 6200);
  }

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
    var nightLabel = document.getElementById('nightModeLabel');
    if (nightLabel) nightLabel.textContent = theme === 'dark' ? '日读' : '夜读';
  }

  window.setTheme = function(theme) { applyTheme(theme); };

  window.toggleNightMode = function() {
    applyTheme(state.theme === 'dark' ? 'wheat' : 'dark');
  };

  /* ===== PAGE TRANSITION =====
   * 与首页/书架同一套约定（三处实现必须保持一致，否则遮罩会互相误触发）：
   *   标记 = sessionStorage['page-transitioning'] = { t: 时间戳, to: 目标页 pathname }
   *   只有 to === location.pathname 才认这个标记
   *   入场停留 ENTER_HOLD（原 650ms，改为 200ms）
   *   遮罩的 pointer-events 由 CSS 永久置为 none，不再拦点击
   */
  var ENTER_HOLD = 200;   // 入场遮罩停留（ms），原 650
  var ENTER_TTL = 8000;   // 标记兜底有效期（ms）

  /** 把相对 href 解析成站内绝对路径，用来和 location.pathname 比对 */
  function targetPath(href) {
    var a = document.createElement('a');
    a.href = href;
    return a.pathname;
  }

  /** 读取并消费过渡标记：只有目标页就是当前页才算数 */
  function consumeEntryFlag() {
    var raw = sessionStorage.getItem('page-transitioning');
    if (raw === null) return false;
    sessionStorage.removeItem('page-transitioning');
    var data = null;
    try { data = JSON.parse(raw); } catch (err) { return false; }
    if (!data || !data.to || !data.t) return false;
    if (Math.abs(Date.now() - data.t) > ENTER_TTL) return false;
    return data.to === location.pathname;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

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

    // 入场动画（只有真正发起过过渡、且目标就是本页时才显示）
    if (consumeEntryFlag()) {
      if (prefersReducedMotion()) return;
      requestAnimationFrame(function() {
        ov.classList.add('active');
        // 停留计时放在第二帧起算，避免弱 CPU 下首帧推迟导致遮罩没淡满就退场
        requestAnimationFrame(function() {
          setTimeout(function() { ov.classList.remove('active'); }, ENTER_HOLD);
        });
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
      if (!href || href.startsWith('javascript') || link.getAttribute('onclick') || link.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

	      // 同页锚点链接：不触发过渡动画，直接滚动
	      if (href.startsWith('#')) {
	        var target = document.getElementById(href.slice(1));
	        if (target) { target.scrollIntoView({ behavior: 'smooth' }); }
	        return;
	      }
	      var hashIdx = href.indexOf('#');
	      if (hashIdx > 0) {
	        var base = href.substring(0, hashIdx);
	        var currentPage = window.location.pathname.split('/').pop() || '';
	        if (base === currentPage) {
	          var target = document.getElementById(href.slice(hashIdx + 1));
	          if (target) { target.scrollIntoView({ behavior: 'smooth' }); }
	          return;
	        }
	      }
      e.preventDefault();
      if (prefersReducedMotion()) { window.location.href = href; return; }
      ov.querySelector('.transition-text').textContent = pickTransitionLine();
      ov.classList.add('active');
      sessionStorage.setItem('page-transitioning', JSON.stringify({ t: Date.now(), to: targetPath(href) }));
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
    var tap = document.getElementById('readerTapArea');
    if (!tap) return;
    tap.innerHTML = '<button type="button" class="reader-tap-zone top" aria-label="向上翻页"></button><button type="button" class="reader-tap-zone middle" aria-label="显示工具栏"></button><button type="button" class="reader-tap-zone bottom" aria-label="向下翻页"></button>';

    tap.querySelector('.reader-tap-zone.top').addEventListener('click', function() {
      if (state.barsVisible) hideBars();
      window.scrollBy({ top: -window.innerHeight * 0.85, behavior: 'smooth' });
    });

    tap.querySelector('.reader-tap-zone.middle').addEventListener('click', function() {
      state.barsVisible ? hideBars() : showBars();
    });

    tap.querySelector('.reader-tap-zone.bottom').addEventListener('click', function() {
      if (state.barsVisible) hideBars();
      window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
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
  var lastProgressSave = 0;
  function saveProgress(pct, force) {
    if (pct === undefined) pct = getCurrentProgressPct();
    pct = clampProgress(pct);
    refreshProgressControls(pct);
    // localStorage 是同步磁盘写入：滚动时每帧都写会掉帧，节流到约 3 次/秒。
    // 页面隐藏/卸载时传 force=true 补最后一把，保证离开前进度是准的。
    var now = Date.now();
    if (!force && now - lastProgressSave < 320) return;
    lastProgressSave = now;
    localStorage.setItem('reader-pos-' + chapterId, pct);
    if (pct >= 95) {
      localStorage.setItem('reader-done-' + chapterId, '1');
    } else {
      localStorage.removeItem('reader-done-' + chapterId);
    }
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

    var scrollScheduled = false;
    window.addEventListener('scroll', function() {
      // rAF 节流：滚动时每帧最多写一次 localStorage + 更新一次 DOM
      if (scrollScheduled) return;
      scrollScheduled = true;
      requestAnimationFrame(function() {
        scrollScheduled = false;
        saveProgress();
      });
    }, { passive: true });
    window.addEventListener('beforeunload', function() { saveProgress(undefined, true); });
    window.addEventListener('pagehide', function() { saveProgress(undefined, true); });
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') saveProgress(undefined, true);
    });
  }

  /* ===== 键盘：Escape 逐层关闭（设置 -> 摘句簿 -> 目录 -> 工具栏） ===== */
  function initModalKeys() {
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      var settings = document.getElementById('settingsOverlay');
      var quotes = document.getElementById('quotesOverlay');
      var dir = document.getElementById('dirOverlay');
      if (settings && settings.classList.contains('visible')) { closeSettings(); }
      else if (quotes && quotes.classList.contains('visible')) { closeQuotes(); }
      else if (dir && dir.classList.contains('visible')) { closeDirectory(); }
      else if (state.barsVisible) { hideBars(); }
    });
  }

  /* ===== DIRECTORY PANEL ===== */
  function initDirectoryPanel() {
    if (document.getElementById('dirOverlay')) return;
    var ov = document.createElement('div');
    ov.id = 'dirOverlay';
    ov.className = 'modal-overlay';
    ov.innerHTML =
      '<div class="modal-backdrop"></div>' +
      '<div class="modal-panel dir-modal" role="dialog" aria-modal="true" aria-label="目录">' +
        '<div class="modal-header"><div class="modal-header-left"><span>目录</span><a href="characters.html" class="dir-char-link" onclick="closeDirectory()">人物簿</a></div>' +
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

    // 按卷分组：仅当 CHAPTERS 中出现 ≥2 个不同 volume 时才渲染分组标题
    var volumes = [];
    CHAPTERS.forEach(function(ch) {
      var v = ch.volume || '';
      if (volumes.indexOf(v) === -1) volumes.push(v);
    });
    var grouped = volumes.length > 1;

    var html = '';
    volumes.forEach(function(v) {
      if (grouped) html += '<div class="dir-volume">' + escapeHtml(v) + '</div>';
      CHAPTERS.forEach(function(ch) {
        if ((ch.volume || '') !== v) return;
        var id = getChapterStorageId(ch.file);
        var done = localStorage.getItem('reader-done-' + id) === '1';
        var pct = parseInt(localStorage.getItem('reader-pos-' + id)) || 0;
        var active = ch.file === file;

        html += '<a href="' + ch.file + '" class="dir-item' + (active ? ' active' : '') + (done ? ' done' : '') + '">';
        html += '<span class="dir-item-num">第' + ch.num + '章</span>';
        html += '<span class="dir-item-title">' + escapeHtml(ch.title) + '</span>';
        html += '<span class="dir-item-info">';
        if (done) {
          html += '<span class="dir-item-done"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>';
        } else if (pct > 0) {
          html += '<span class="dir-item-progress">' + pct + '%</span>';
        }
        html += '<span class="dir-item-words">' + ch.words + '字</span>';
        html += '</span></a>';
      });
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
      '<div class="modal-panel quotes-modal" role="dialog" aria-modal="true" aria-label="摘句簿">' +
        '<div class="modal-header"><span>摘句簿</span>' +
          '<button type="button" class="modal-export" onclick="exportQuotes()">导出</button>' +
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

  /* ===== 摘句导出（Markdown 下载，把句子还给读者） ===== */
  window.exportQuotes = function() {
    var quotes = getStoredQuotes();
    if (!quotes.length) { showToast('还没有收进摘句'); return; }
    var lines = ['# 临渊羡鱼 · 摘句簿', '', '> 导出于 ' + new Date().toLocaleString('zh-CN') , ''];
    quotes.forEach(function(item) {
      lines.push('「' + item.text + '」');
      lines.push('');
      lines.push('—— 《' + item.chapterTitle + '》');
      lines.push('');
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '临渊羡鱼-摘句.md';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      URL.revokeObjectURL(a.href);
      document.body.removeChild(a);
    }, 1000);
    showToast('摘句簿已导出');
  };

  /* ===== 章末分享 ===== */
  window.shareChapter = function() {
    var title = document.title;
    var url = window.location.href;
    if (navigator.share) {
      navigator.share({ title: title, text: '临渊羡鱼 —— ' + title, url: url }).catch(function() {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function() {
        showToast('链接已复制，去分享吧');
      }, function() {
        showToast('复制失败，请手动复制地址栏');
      });
    } else {
      showToast('请手动复制地址栏链接');
    }
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
      '<div class="modal-panel settings-modal" role="dialog" aria-modal="true" aria-label="设置">' +
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
              '<button id="fontFamilyToggle" class="mode-toggle-btn" onclick="toggleFontFamily()"><span id="fontFamilyLabel">' + (fontFamilyLabels[state.fontFamily] || '黑体') + '</span></button>' +
            '</div>' +
          '</div>' +
          '<div class="setting-group"><div class="setting-label">版式</div>' +
            '<div class="mode-toggle-row">' +
              '<button id="readWidthToggle" class="mode-toggle-btn" onclick="toggleReadWidth()"><span id="readWidthLabel">' + (state.readWidth === 'wide' ? '宽屏阅读 · 开' : '宽屏阅读 · 关') + '</span></button>' +
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
    if (fl) fl.textContent = fontFamilyLabels[state.fontFamily] || '黑体';
    var rw = document.getElementById('readWidthLabel');
    if (rw) rw.textContent = state.readWidth === 'wide' ? '宽屏阅读 · 开' : '宽屏阅读 · 关';
    if (ov) { ov.classList.add('visible'); document.body.style.overflow = 'hidden'; }
    if (state.barsVisible) { stopAutoClose(); startAutoClose(); }
  };

  window.closeSettings = function() {
    var ov = document.getElementById('settingsOverlay');
    if (ov) { ov.classList.remove('visible'); document.body.style.overflow = ''; }
  };

  /* ===== START ===== */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js').catch(function() {});
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
