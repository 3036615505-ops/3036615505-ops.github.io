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

  var fontSizes = ['small', 'medium', 'large'];
  var fontSizeLabels = { small: '小', medium: '中', large: '大' };
  var fontSizeValues = { small: 19, medium: 22, large: 25 };

  /* 字体三选：黑体（强制中文无衬线）/ 系统（跟随手机系统字体）/ 楷体（站点自带）
     旧的「衬线」已移除——安卓几乎没有中文衬线字体，两个选项落到同一套字形，等于假按钮。 */
  var fontFamilies = ['fzyouhei', 'system', 'kai'];
  var fontFamilyLabels = { fzyouhei: '黑体', system: '系统', kai: '楷体' };

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
    initReadingAids();
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
    el.innerHTML = '<span id="readerPos">0/0</span><span id="readerRemain"></span>' +
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
      updateRemainTime();
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
     三个选项的区别（这是用户真正能感知到的部分）：
       黑体 —— 明确点名中文无衬线（Noto Sans CJK / 思源黑体 / 苹方 / 雅黑）。
               手机装了主题字体时，这里仍然回到黑体，不会被系统字体带跑。
       系统 —— 只写 system-ui，完全交给手机自己的字体。MIUI / 鸿蒙 / 三星换了
               系统字体，阅读正文会跟着变——这也是它和「黑体」的唯一区别。
       楷体 —— 站点自带（霞鹜文楷子集，OFL 授权）。安卓基本没有系统楷体，
               所以这里必须自带字体文件；首次选择时才下载，不选的人不付流量。 */
  var KAI_FAMILY = 'LinyuanKai';
  var kaiLoading = false;

  /* 系统字体名：WebView 不会自动跟随 ROM 主题字体，只能向壳要名字再交给 CSS。
     壳（v1.8.3+）通过 getSystemFontFamily() 返回，老壳没有这个方法 → 返回空串。 */
  var systemFontName = null;
  var systemFontBridge = null;   /* null=未探测，false=壳太旧没有这个方法 */

  function detectSystemFontName() {
    if (systemFontName !== null) return systemFontName;
    systemFontName = '';
    systemFontBridge = false;
    try {
      var bridge = window.LinyuanApp;
      if (bridge && typeof bridge.getSystemFontFamily === 'function') {
        systemFontBridge = true;
        var raw = String(bridge.getSystemFontFamily() || '').trim();
        // 去掉可能存在的引号，避免拼进 CSS 时把字体栈写坏
        raw = raw.replace(/["']/g, '');
        if (raw && raw !== 'sans-serif' && raw !== 'default') systemFontName = raw;
      }
    } catch (e) {
      systemFontName = '';
    }
    return systemFontName;
  }

  function fontStackFor(family) {
    if (family === 'kai') {
      /* 自带楷体优先；万一字体没加载成功，退回系统的楷/宋，最后才是 serif */
      return '"' + KAI_FAMILY + '","Kaiti SC","STKaiti","KaiTi","楷体","Noto Serif CJK SC",serif';
    }
    if (family === 'system') {
      /* 不能点名叫 Roboto / Segoe UI：装了主题字体的 ROM 替换的是「默认字体族」，
         一旦显式写 Roboto，浏览器会优先命中 Roboto，系统字体就被挡在外面。
         所以只在拿到系统字体名时点名它，否则直接交给 system-ui / sans-serif。 */
      var name = detectSystemFontName();
      return name ? '"' + name + '",system-ui,sans-serif' : 'system-ui,sans-serif';
    }
    return '"Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';
  }

  /* 楷体按需加载：第一次选到它才拉 woff2，避免没用的人白付流量 */
  function ensureKaiLoaded() {
    if (!document.fonts || !document.fonts.load) return;
    try {
      if (document.fonts.check('16px ' + KAI_FAMILY, '临渊羡鱼')) return;
    } catch (e) { /* 忽略，继续走加载 */ }
    if (kaiLoading) return;
    kaiLoading = true;
    showToast('正在加载楷体…');
    document.fonts.load('16px ' + KAI_FAMILY, '临渊羡鱼').then(function () {
      kaiLoading = false;
    }, function () {
      kaiLoading = false;
    });
  }

  function fontHintText() {
    /* 平时不显示提示；只有选中「系统」时说明一句现状，
       并且能区分「手机没开放字体名」与「App 版本太旧」。 */
    if (state.fontFamily !== 'system') return '';
    var name = detectSystemFontName();
    if (name) return '已跟随系统字体：' + name;
    if (systemFontBridge === false) return '跟随系统默认字体（App 需更新到 1.8.3 以上）';
    return '跟随系统默认字体（手机未提供字体名）';
  }

  function refreshFontButtons() {
    var wrap = document.getElementById('fontFamilyChoices');
    if (!wrap) return;
    var btns = wrap.querySelectorAll('button[data-font]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('is-on', btns[i].getAttribute('data-font') === state.fontFamily);
    }
  }

  function applyFontFamily(family) {
    /* 老版本存过 'serif'，这里兜底回黑体，避免空字体栈 */
    if (fontFamilies.indexOf(family) < 0) family = 'fzyouhei';
    state.fontFamily = family;
    localStorage.setItem('reader-fontfamily', family);
    var content = document.querySelector('.chapter-content');
    if (content) content.style.fontFamily = fontStackFor(family);
    if (family === 'kai') ensureKaiLoaded();
    var label = document.getElementById('fontFamilyLabel');
    if (label) label.textContent = fontFamilyLabels[family] || '黑体';
    var hint = document.getElementById('fontFamilyHint');
    if (hint) {
      hint.textContent = fontHintText();
      hint.style.display = hint.textContent ? '' : 'none';
    }
    refreshFontButtons();
  }

  window.setFontFamily = function (family) { applyFontFamily(family); };

  /* 保留旧函数名，防止其它地方还有引用 */
  window.toggleFontFamily = function () {
    var idx = fontFamilies.indexOf(state.fontFamily);
    if (idx < 0) idx = 0;
    applyFontFamily(fontFamilies[(idx + 1) % fontFamilies.length]);
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
   * 实现在 js/transition.js（全站唯一一份，与首页/书架同一套状态机）。
   * 这里只传章节页的差异参数：
   *   mount        —— 遮罩挂在 .reading-wrapper 内（沿用原来的层级，不影响 fixed 定位）
   *   delegate     —— 事件委托：目录/设置面板里的链接是运行时插入的，必须委托才抓得到
   *   hashScroll   —— 同页锚点链接改为平滑滚动，不触发过渡
   *   leaves/icon  —— 与原来一致：5 片环绕叶 + 中间叶片图标
   *   entryText    —— 入场时把文案换成随机诗句
   * 不传 skipSelector：章节页没有底部 tab bar。
   */
  function initPageTransition() {
    PageTransition.init({
      mount: document.querySelector('.reading-wrapper') || document.body,
      delegate: true,
      hashScroll: true,
      leaves: 5,
      icon: true,
      entryText: 'random'
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
            '<div class="mode-toggle-row" id="fontFamilyChoices">' +
              '<button class="mode-toggle-btn" data-font="fzyouhei" onclick="setFontFamily(\'fzyouhei\')">黑体</button>' +
              '<button class="mode-toggle-btn" data-font="system" onclick="setFontFamily(\'system\')">系统</button>' +
              '<button class="mode-toggle-btn" data-font="kai" onclick="setFontFamily(\'kai\')">楷体</button>' +
            '</div>' +
            '<div class="setting-hint" id="fontFamilyHint"' + (fontHintText() ? '' : ' style="display:none"') + '>' + fontHintText() + '</div>' +
          '</div>' +
          '<div class="setting-group"><div class="setting-label">版式</div>' +
            '<div class="mode-toggle-row">' +
              '<button id="readWidthToggle" class="mode-toggle-btn" onclick="toggleReadWidth()"><span id="readWidthLabel">' + (state.readWidth === 'wide' ? '宽屏阅读 · 开' : '宽屏阅读 · 关') + '</span></button>' +
            '</div>' +
          '</div>' +
          '<div class="setting-group"><div class="setting-label">阅读辅助</div>' +
            '<div class="mode-toggle-row">' +
              '<button class="mode-toggle-btn' + (readingAids.dialogue ? ' is-on' : '') + '" data-aid="dialogue" onclick="toggleReadingAid(\'dialogue\')">' + aidLabel('dialogue') + '</button>' +
              '<button class="mode-toggle-btn' + (readingAids.cornerQuotes ? ' is-on' : '') + '" data-aid="cornerQuotes" onclick="toggleReadingAid(\'cornerQuotes\')">' + aidLabel('cornerQuotes') + '</button>' +
            '</div>' +
            '<div class="mode-toggle-row mode-toggle-row-gap">' +
              '<button class="mode-toggle-btn' + (readingAids.keepAwake ? ' is-on' : '') + '" data-aid="keepAwake" onclick="toggleReadingAid(\'keepAwake\')">' + aidLabel('keepAwake') + '</button>' +
              '<button class="mode-toggle-btn' + (readingAids.remainTime ? ' is-on' : '') + '" data-aid="remainTime" onclick="toggleReadingAid(\'remainTime\')">' + aidLabel('remainTime') + '</button>' +
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
    refreshFontButtons();
    refreshAidButtons();
    var fontHintBox = document.getElementById('fontFamilyHint');
    if (fontHintBox) {
      fontHintBox.textContent = fontHintText();
      fontHintBox.style.display = fontHintBox.textContent ? '' : 'none';
    }
    var rw = document.getElementById('readWidthLabel');
    if (rw) rw.textContent = state.readWidth === 'wide' ? '宽屏阅读 · 开' : '宽屏阅读 · 关';
    if (ov) { ov.classList.add('visible'); document.body.style.overflow = 'hidden'; }
    if (state.barsVisible) { stopAutoClose(); startAutoClose(); }
  };

  window.closeSettings = function() {
    var ov = document.getElementById('settingsOverlay');
    if (ov) { ov.classList.remove('visible'); document.body.style.overflow = ''; }
  };

  /* ===== 自动滚动（自动下滑翻页） =====
     rAF 逐帧滚动，速度按时间计算（与帧率无关）；速度 10 档存 localStorage。
     停止条件：点屏幕（touchstart/mousedown，悬浮条除外）、点悬浮条 ✕、到章末。
     打开任何面板/工具栏也必然经过一次触摸 → 自动停止，与站点交互一致。 */
  var autoScroll = { active: false, paused: false, level: 5, raf: 0, lastT: 0, pos: 0 };
  var AS_SPEEDS = [8, 15, 24, 35, 48, 64, 84, 108, 136, 170]; /* px/s */

  function loadAutoSpeed() {
    var v = parseInt(localStorage.getItem('reader-autoscroll-speed') || '5', 10);
    autoScroll.level = isNaN(v) ? 5 : Math.min(10, Math.max(1, v));
  }
  function saveAutoSpeed() {
    localStorage.setItem('reader-autoscroll-speed', String(autoScroll.level));
  }

  function autoScrollStep(t) {
    if (!autoScroll.active || autoScroll.paused) return;
    var dt = autoScroll.lastT ? Math.min(100, t - autoScroll.lastT) : 16; /* 切后台回来不跳变 */
    autoScroll.lastT = t;
    var doc = document.documentElement;
    var max = doc.scrollHeight - window.innerHeight;
    var y = window.scrollY || doc.scrollTop || 0;
    if (y >= max - 1) { stopAutoScroll(true); return; } /* 到章末自动停 */
    /* 用户手动滚动接管：与累积值偏差超过 3px 说明不是我们滚的，以实际位置为准，
       避免自动滚动把用户的手指操作"顶回去"。 */
    if (Math.abs(y - Math.round(autoScroll.pos)) > 3) autoScroll.pos = y;
    /* 慢速档每帧步长 < 1px，直接 scrollTo 会被取整卡死 → 必须浮点累积 */
    autoScroll.pos = Math.min(max, autoScroll.pos + AS_SPEEDS[autoScroll.level - 1] * dt / 1000);
    window.scrollTo(0, Math.round(autoScroll.pos));
    autoScroll.raf = requestAnimationFrame(autoScrollStep);
  }

  function startAutoScroll() {
    if (autoScroll.active) return;
    loadAutoSpeed();
    autoScroll.active = true; autoScroll.paused = false; autoScroll.lastT = 0;
    autoScroll.pos = window.scrollY || 0; /* 从当前位置起步 */
    ensureAutoPill();
    updateAutoUI();
    autoScroll.raf = requestAnimationFrame(autoScrollStep);
  }

  function stopAutoScroll(reachedEnd) {
    if (!autoScroll.active) return;
    autoScroll.active = false; autoScroll.paused = false;
    cancelAnimationFrame(autoScroll.raf);
    updateAutoUI();
    if (reachedEnd) showToast('已到本章末尾');
  }

  function pauseAutoScroll(paused) {
    if (!autoScroll.active) return;
    autoScroll.paused = paused;
    autoScroll.lastT = 0;
    autoScroll.pos = window.scrollY || 0; /* 位置与实际滚动对齐 */
    if (!paused) autoScroll.raf = requestAnimationFrame(autoScrollStep);
    updateAutoUI();
  }

  function nudgeAutoScroll(delta) {
    autoScroll.level = Math.min(10, Math.max(1, autoScroll.level + delta));
    saveAutoSpeed();
    updateAutoUI();
  }

  function updateAutoUI() {
    var label = document.getElementById('autoScrollLabel');
    if (label) label.textContent = autoScroll.active ? (autoScroll.paused ? '已暂停' : '进行中') : '自动';
    var pill = document.getElementById('autoScrollPill');
    if (!pill) return;
    pill.classList.toggle('visible', autoScroll.active);
    var lv = pill.querySelector('.auto-level');
    if (lv) lv.textContent = autoScroll.level;
    var pp = pill.querySelector('.auto-pp');
    if (pp) pp.textContent = autoScroll.paused ? '\u25B6' : '\u275A\u275A';
  }

  function ensureAutoPill() {
    if (document.getElementById('autoScrollPill')) return;
    var pill = document.createElement('div');
    pill.id = 'autoScrollPill';
    pill.innerHTML =
      '<button type="button" data-act="slower" aria-label="减速">\u2212</button>' +
      '<span class="auto-level">3</span>' +
      '<button type="button" data-act="faster" aria-label="加速">\uFF0B</button>' +
      '<button type="button" class="auto-pp" data-act="pause" aria-label="暂停或继续">\u275A\u275A</button>' +
      '<button type="button" class="auto-stop" data-act="stop" aria-label="停止">\u2715</button>';
    document.body.appendChild(pill);
    pill.addEventListener('click', function(e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'slower') nudgeAutoScroll(-1);
      else if (act === 'faster') nudgeAutoScroll(1);
      else if (act === 'pause') pauseAutoScroll(!autoScroll.paused);
      else if (act === 'stop') stopAutoScroll(false);
    });
  }

  window.toggleAutoScroll = function() {
    if (autoScroll.active) {
      stopAutoScroll(false);
    } else {
      startAutoScroll();
      if (typeof closeSettings === 'function') closeSettings();
      if (state.barsVisible) hideBars(); /* 从工具栏开启 → 收起工具栏让出屏幕 */
      showToast('自动滚动开始，点右下角 ✕ 可停止');
    }
  };

  /* ===== 阅读辅助（做法借鉴 Readest）=====
     四项互相独立，全部可在设置里开关，默认遵守「不打扰」：
       dialogue     对话高亮：成对引号里的说话内容套一层淡色底（默认关）
       cornerQuotes 直角引号：弯引号 “” → 直角引号「」（默认关）
       keepAwake    阅读常亮：阅读页不让屏幕自动熄灭（默认开）
       remainTime   底部显示剩余阅读时间（默认开）
     所有内容改动都从 contentSnapshot 重新渲染，因此任意开关组合都能反复切，
     不会出现「开过一次再关就回不去」。 */
  var readingAids = {
    dialogue: localStorage.getItem('reader-dialogue') === '1',
    cornerQuotes: localStorage.getItem('reader-cornerquotes') === '1',
    keepAwake: localStorage.getItem('reader-keepawake') !== '0',
    remainTime: localStorage.getItem('reader-remaintime') !== '0'
  };
  var READER_KEYS = {
    dialogue: 'reader-dialogue',
    cornerQuotes: 'reader-cornerquotes',
    keepAwake: 'reader-keepawake',
    remainTime: 'reader-remaintime'
  };
  var contentSnapshot = null;
  var wakeSentinel = null;

  function captureContent() {
    if (contentSnapshot !== null) return;
    var article = document.querySelector('.chapter-content');
    if (article) contentSnapshot = article.innerHTML;
  }

  /* 以快照为源重建正文：先做引号替换，再按需包裹对话 */
  function renderContentDecorations() {
    var article = document.querySelector('.chapter-content');
    if (!article || contentSnapshot === null) return;
    if (!readingAids.dialogue && !readingAids.cornerQuotes) {
      article.innerHTML = contentSnapshot;
      return;
    }
    var holder = document.createElement('div');
    holder.innerHTML = contentSnapshot;
    var walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    var open = readingAids.cornerQuotes ? '\u300c' : '\u201c';
    var close = readingAids.cornerQuotes ? '\u300d' : '\u201d';

    nodes.forEach(function (node) {
      var text = node.nodeValue;
      if (!text) return;
      if (readingAids.cornerQuotes) {
        text = text.replace(/\u201c/g, '\u300c').replace(/\u201d/g, '\u300d');
      }
      if (!readingAids.dialogue) {
        node.nodeValue = text;
        return;
      }
      var frag = document.createDocumentFragment();
      var i = 0;
      while (i < text.length) {
        var start = text.indexOf(open, i);
        if (start < 0) { frag.appendChild(document.createTextNode(text.slice(i))); break; }
        var end = text.indexOf(close, start + 1);
        if (end < 0) { frag.appendChild(document.createTextNode(text.slice(i))); break; }
        if (start > i) frag.appendChild(document.createTextNode(text.slice(i, start)));
        var span = document.createElement('span');
        span.className = 'dlg';
        span.textContent = text.slice(start, end + 1);
        frag.appendChild(span);
        i = end + 1;
      }
      node.parentNode.replaceChild(frag, node);
    });
    article.innerHTML = holder.innerHTML;
  }

  function applyKeepAwake() {
    var on = !!readingAids.keepAwake;
    var bridge = window.LinyuanApp;
    if (bridge && typeof bridge.setKeepScreenOn === 'function') {
      try { bridge.setKeepScreenOn(on); } catch (e) { /* 忽略 */ }
      return;
    }
    if (!navigator.wakeLock) return;
    if (on) {
      if (wakeSentinel) return;
      navigator.wakeLock.request('screen').then(function (sentinel) {
        wakeSentinel = sentinel;
        sentinel.addEventListener('release', function () { wakeSentinel = null; });
      }).catch(function () { wakeSentinel = null; });
    } else if (wakeSentinel) {
      try { wakeSentinel.release(); } catch (e) { /* 忽略 */ }
      wakeSentinel = null;
    }
  }

  function releaseKeepAwake() {
    var bridge = window.LinyuanApp;
    if (bridge && typeof bridge.setKeepScreenOn === 'function') {
      try { bridge.setKeepScreenOn(false); } catch (e) { /* 忽略 */ }
    }
    if (wakeSentinel) {
      try { wakeSentinel.release(); } catch (e) { /* 忽略 */ }
      wakeSentinel = null;
    }
  }

  /* 剩余阅读时间：按中文字数折算（约 400 字/分钟），随滚动更新 */
  function updateRemainTime() {
    var el = document.getElementById('readerRemain');
    if (!el) return;
    if (!readingAids.remainTime) { el.textContent = ''; return; }
    var article = document.querySelector('.chapter-content');
    if (!article) { el.textContent = ''; return; }
    var total = (article.textContent || '').replace(/\s+/g, '').length;
    var sc = document.scrollingElement || document.documentElement;
    var max = sc.scrollHeight - window.innerHeight;
    if (max <= 0) { el.textContent = ''; return; }
    var y = sc.scrollTop || window.scrollY || 0;
    var ratio = Math.min(1, Math.max(0, y / max));
    var left = Math.round(total * (1 - ratio));
    if (left <= 0) { el.textContent = ''; return; }
    var minutes = left / 400;
    el.textContent = '\u00b7 ' + (minutes < 1 ? '<1' : Math.round(minutes)) + ' \u5206';
  }

  function aidLabel(key) {
    var names = { dialogue: '对话高亮', cornerQuotes: '直角引号', keepAwake: '阅读常亮', remainTime: '剩余时间' };
    var on = readingAids[key];
    return names[key] + ' \u00b7 ' + (on ? '开' : '关');
  }

  function refreshAidButtons() {
    var keys = ['dialogue', 'cornerQuotes', 'keepAwake', 'remainTime'];
    keys.forEach(function (key) {
      var btn = document.querySelector('[data-aid="' + key + '"]');
      if (!btn) return;
      btn.textContent = aidLabel(key);
      btn.classList.toggle('is-on', !!readingAids[key]);
    });
  }

  window.toggleReadingAid = function (key) {
    if (!(key in readingAids)) return;
    readingAids[key] = !readingAids[key];
    localStorage.setItem(READER_KEYS[key], readingAids[key] ? '1' : '0');
    if (key === 'dialogue' || key === 'cornerQuotes') renderContentDecorations();
    if (key === 'keepAwake') { readingAids.keepAwake ? applyKeepAwake() : releaseKeepAwake(); }
    if (key === 'remainTime') updateRemainTime();
    refreshAidButtons();
  };

  function initReadingAids() {
    captureContent();
    renderContentDecorations();
    applyKeepAwake();
    updateRemainTime();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) releaseKeepAwake();
      else applyKeepAwake();
    });
    window.addEventListener('pagehide', releaseKeepAwake);
  }

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
