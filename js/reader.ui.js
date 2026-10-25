/**
 * 界面层 —— 面板、工具栏、主题、字体、状态条、阅读辅助
 *
 * 这一层负责「看得见的东西」：把状态写成 DOM，把点击转成状态变化。
 * 不自己算位置，需要位置就问 engine。
 *
 * 依赖：reader.store.js、reader.engine.js（都在前面加载）
 */
(function() {
  'use strict';
  var LY = window.LY || (/** @type {any} */ (window.LY = {}));

  /* ---- 对 store 的依赖 ---- */
  var STORAGE_SCHEMA = LY.store.STORAGE_SCHEMA;
  function migrateStorage() { return LY.store.migrate(); }
  function readFootprints() { return LY.store.readFootprints(); }
  function mergeFootprints(fn) { return LY.store.mergeFootprints(fn); }
  function recordFootprints() { return LY.store.recordFootprints(); }
  function recordThemeUse(t) { return LY.store.recordThemeUse(t); }
  function getStoredQuotes() { return LY.store.getStoredQuotes(); }
  function saveStoredQuotes(list) { return LY.store.saveStoredQuotes(list); }
  function collectReaderData() { return LY.store.collectReaderData(); }
  function importReaderData(text) { return LY.store.importReaderData(text); }
  function getCurrentFileName() { return LY.store.getCurrentFileName(); }
  function getCurrentChapterTitle() { return LY.store.getCurrentChapterTitle(); }

  /* ---- 对 engine 的依赖 ---- */
  function clampProgress(p) { return LY.engine.clampProgress(p); }
  function getCurrentProgressPct() { return LY.engine.getCurrentProgressPct(); }
  function scrollToProgress(p) { return LY.engine.scrollToProgress(p); }
  function saveProgress(p, f) { return LY.engine.saveProgress(p, f); }
  function getCurrentAnchor() { return LY.engine.getCurrentAnchor(); }
  function scrollToAnchor(a) { return LY.engine.scrollToAnchor(a); }
  function markUserScroll() { return LY.engine.markUserScroll(); }
  function initReadingProgress() { return LY.engine.initReadingProgress(); }
  function initReadingTime() { return LY.engine.initReadingTime(); }
  function restoreProgress() { return LY.engine.restoreProgress(); }

  /* ===== STATE ===== */

  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

  var state = {
    fontSize: localStorage.getItem('reader-fontsize') || 'medium',
    theme: localStorage.getItem('reader-theme') || (systemDark ? 'dark' : 'wheat'),
    fontFamily: localStorage.getItem('reader-fontfamily') || 'fzyouhei',
    readWidth: localStorage.getItem('reader-readwidth') || 'normal',
    lineHeight: localStorage.getItem('reader-lineheight') || 'normal',
    paraGap: localStorage.getItem('reader-paragap') || 'normal',
    barsVisible: false,
    settingsVisible: false,
    autoCloseTimer: null
  };


  var fontSizes = ['small', 'medium', 'large'];

  var fontSizeLabels = { small: '小', medium: '中', large: '大' };

  /* 字号的具体像素值只在 css/style.css 的 [data-fontsize="…"] 里定义一处。
     这里曾经同时写内联 --font-size-base，和 CSS 那三条各存一份 19/22/25：
     内联优先级更高，CSS 反而成了永不生效的死代码，改一处忘另一处就悄悄分叉。
     现在 JS 只负责落属性，数值归 CSS 一家管。 */

  /* 字体四选：黑体（强制中文无衬线）/ 系统（跟随手机系统字体）/ 楷体（站点自带）
     / 自定义（读者自己导入的字体文件）。旧的「衬线」已移除——安卓几乎没有中文衬线
     字体，两个选项落到同一套字形，等于假按钮。 */

  var fontFamilies = ['fzyouhei', 'system', 'kai', 'custom'];

  /* 工具栏那个循环切换只轮前三档：自定义字体没导入时切过去就是一片空白。 */
  var CYCLE_FAMILIES = ['fzyouhei', 'system', 'kai'];

  var fontFamilyLabels = { fzyouhei: '黑体', system: '系统', kai: '楷体', custom: '自定义' };

  /* ===== 读者自带的字体 =====

     系统字体这条路在 WebView 里走不通：ROM 的主题字体只作用于原生控件，
     网页拿不到名字也拿不到文件（详见 app/FONT-BRIDGE.md）。但读者手里如果
     有字体文件，网页可以自己加载 —— FontFace 读 ArrayBuffer，二进制存进
     IndexedDB，之后每次打开都自动装回去。这是唯一完全不依赖 ROM、也不依赖
     App 壳的做法。 */

  var USER_FAMILY = 'LinyuanUser';

  var USER_FONT_KEY = 'reader-custom-font';   /* 只存文件名，用于同步显示 */

  var userFontFace = null;

  var userFontName = '';

  var userFontLoading = null;

  try { userFontName = localStorage.getItem(USER_FONT_KEY) || ''; } catch (e) { userFontName = ''; }

  var FONT_DB = 'linyuan-font';

  var FONT_STORE = 'fonts';

  var FONT_REC = 'user';

  var USER_FONT_MAX = 24 * 1024 * 1024;   /* 字体文件再大就不像话了，也怕撑爆配额 */

  /* 壳（Android App）里 <input type=file> 不是网页想弹就能弹的：
     必须壳实现 WebChromeClient.onShowFileChooser 并把结果回给 filePathCallback。
     v1.8.4 的壳没有这个回调（解包 dex 查过，只有下载相关的逻辑），
     在 App 里点「导入」就是字面意义的没反应。
     所以壳内且版本过旧时不装死，直接说明原因；壳升级后版本判断自动放行。 */
  var SHELL_PICKER_MIN = '1.8.5';

  function shellAppVersion() {
    try {
      var b = window.LinyuanApp;
      if (b && typeof b.getAppVersion === 'function') return String(b.getAppVersion() || '').trim();
    } catch (e) {}
    return '';
  }

  function shellPickerUnsupported() {
    var v = shellAppVersion();
    if (!v) return false;   /* 不在壳里 —— 手机/电脑浏览器原生就支持选文件 */
    function parse(s) {
      var m = String(s).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
      return m ? [+m[1], +m[2], +(m[3] || 0)] : null;
    }
    var a = parse(v), min = parse(SHELL_PICKER_MIN);
    if (!a || !min) return true;   /* 版本号读不出来，按不支持处理，宁可多说一句 */
    if (a[0] !== min[0]) return a[0] < min[0];
    if (a[1] !== min[1]) return a[1] < min[1];
    return a[2] < min[2];
  }


  function refreshProgressControls(pct) {
    pct = clampProgress(pct);
    updateProgressFill(pct);
  }


  /* ===== INIT ===== */

  function init() {
    migrateStorage();
    applyFontSize(state.fontSize);
    applyFontFamily(state.fontFamily);
    loadUserFontIfNeeded();
    applyReadWidth(state.readWidth);
    applyLineHeight(state.lineHeight);
    applyParaGap(state.paraGap);
    applyTheme(state.theme);
    initPageTransition();
    initTapArea();
    initSwipe();
    initReadingProgress();
    initDirectoryPanel();
    initSettingsPanel();
    initQuoteCollecting();
    initModalKeys();
    initKeyboardNav();
    initChapterSwap();
    initFlow();
    initSwipeHint();
    recordFootprints();
    applyFeatureVisibility();
    LY.flags.onChange(applyFeatureVisibility);
    initReadingTime();
    restoreProgress();
    initImmersive();
    initReadingAids();
    ready = true;
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

    /* ----- 章节内页码（当前页 / 总页数，番茄同款按屏折算） -----
       无限流下一页装好几章，所以页码按「当前章」算，不按整页算。 */
    function updatePos() {
      if (!posEl) return;
      var sc = document.scrollingElement || document.documentElement;
      var viewH = window.innerHeight || sc.clientHeight || 1;
      var y0 = sc.scrollTop || window.scrollY || 0;
      var block = LY.engine && LY.engine.currentBlock ? LY.engine.currentBlock() : null;
      var top = block ? Math.max(0, block.getBoundingClientRect().top + y0) : 0;
      var h = block ? block.getBoundingClientRect().height : sc.scrollHeight;
      var total = Math.max(1, Math.ceil(h / viewH));
      var within = Math.max(0, y0 - top);
      var cur = Math.min(total, Math.floor(within / viewH) + 1);
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
    keepPositionWhile(function() { applyFontSize(fontSizes[idx]); });
  };

  /* 改版式（字号/字体/宽度）会让整章重排。用户的心智是「我还是在那一句」，
     不是「我还是在 47%」——所以先把锚点记下来，应用后再落回同一段。
     初始化阶段不这么做（那时锚点还是空的，而且 restoreProgress 稍后会接手）。 */

  var ready = false;

  function keepPositionWhile(fn) {
    var anchor = ready ? getCurrentAnchor() : null;
    fn();
    if (!anchor) return;
    requestAnimationFrame(function() {
      scrollToAnchor(anchor);
      saveProgress(undefined, true);
    });
  }


  /* ===== FONT FAMILY =====
     三个选项的区别（这是用户真正能感知到的部分）：
       黑体 —— 明确点名中文无衬线（Noto Sans CJK / 思源黑体 / 苹方 / 雅黑）。
               手机装了主题字体时，这里仍然回到黑体，不会被系统字体带跑。
       系统 —— 只写 system-ui，完全交给手机自己的字体。MIUI / 鸿蒙 / 三星换了
               系统字体，阅读正文会跟着变——这也是它和「黑体」的唯一区别。
       楷体 —— 站点自带（霞鹜文楷子集，OFL 授权）。安卓基本没有系统楷体，
               所以这里必须自带字体文件；首次选择时才下载，不选的人不付流量。 */

  var KAI_FAMILY = 'LinyuanKai';
  /* 兜底片：GB2312 一级字里主片没覆盖的部分。只在缺字时由浏览器按需下载，
     不主动 load()/check() —— 它存在的意义就是「平常永远用不到」。 */
  var KAI_REST_FAMILY = 'LinyuanKaiRest';

  var kaiLoading = false;

  /* 系统字体名：WebView 不会自动跟随 ROM 主题字体，只能向壳要名字再交给 CSS。
     壳在 1.8.3 之后用的方法名不统一（dex 里 getSystemFontFamily 与
     getSystemFontFamilyName 同时存在），所以这里按候选表逐个试，谁能给出
     合法值就用谁 —— 只认一个名字的话，壳一旦改名，「系统」就静默退回默认字体。

     实测（荣耀，v1.8.4 壳）：三个方法都在，但返回的是 "sans-serif" —— 也就是
     Java 侧的默认 Typeface 只能报出「通用无衬线族」，报不出主题字体的名字。
     这不是壳写错了，Typeface 本来就没有「当前主题字体叫什么」的接口；
     要真拿到，得靠 SystemFonts.getAvailableFonts() 枚举家族名 + 把字体文件
     交给网页，见 app/FONT-BRIDGE.md。 */

  var SYSTEM_FONT_METHODS = ['getSystemFontFamily', 'getSystemFontFamilyName', 'getSystemFont'];

  var systemFontName = null;

  var systemFontBridge = null;   /* null=未探测，false=壳里一个方法都没有 */

  var systemFontRaw = '';        /* 壳返回的原文，提示语里回显，便于反馈问题 */

  var fontAvailCache = {};

  /* 「系统」档的字体栈。把 sans-serif 放在 system-ui 前面是有意的：
     ROM 换主题字体时替换的是字体配置文件里那个「默认无衬线族」，也就是
     sans-serif 指向的东西；system-ui 走的是 WebView 自己的 UI 字体，
     两者在真机上常常不是同一套。先写 sans-serif，等于先给主题字体一次机会。 */
  var SYSTEM_STACK = 'sans-serif,system-ui';

  /* 这些是 CSS 通用族名 / 占位词，不是某个具体字体。壳返回它们说明
     「只知道是默认无衬线，叫不出名字」—— 不是错误，只是没有信息量。 */
  var GENERIC_FAMILIES = { 'sans-serif': 1, 'system-ui': 1, 'default': 1, 'serif': 1, 'monospace': 1, 'none': 1, 'null': 1, 'undefined': 1 };

  function isGenericFamily(s) {
    return !!s && Object.prototype.hasOwnProperty.call(GENERIC_FAMILIES, String(s).toLowerCase());
  }


  /* 壳可能把 Java 对象直接 toString 回来（android.graphics.Typeface@1a2b3c），
     也可能返回 'default' / 'sans-serif' 这类占位词。这些都不是字体家族名，
     拼进 font-family 只会变成一个谁也不认识的字符串，必须挡掉。 */

  function looksLikeFontName(s) {
    if (!s) return false;
    if (s.length > 60) return false;
    if (/[@{};<>]/.test(s)) return false;
    if (/android\.|Typeface/i.test(s)) return false;
    if (isGenericFamily(s)) return false;
    return true;
  }


  /* 关键一步：壳给的名字，WebView 里未必真的有这个字体。
     判据是「换字体后画出来的像素有没有变」，做法是以 monospace 为基准：
     名字不存在时浏览器会落到基准字体，像素完全一致；存在时必然不同。
     只用中文样本 —— 我们关心的是正文字形，拉丁字母的差异说明不了问题。 */

  var HEITI_STACK = '"Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif';

  var fontSigCache = {};

  function fontSignature(family) {
    if (Object.prototype.hasOwnProperty.call(fontSigCache, family)) return fontSigCache[family];
    var sig = null;
    try {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext && canvas.getContext('2d');
      if (ctx) {
        var sample = '临渊羡鱼永';
        var w = 220, h = 90;
        canvas.width = w; canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        ctx.font = '48px ' + family;
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#000';
        ctx.fillText(sample, 6, 62);
        var d = ctx.getImageData(0, 0, w, h).data;
        var s = 0;
        for (var i = 3; i < d.length; i += 4) s = (s * 33 + d[i]) | 0;
        sig = s;
      }
    } catch (e) {
      sig = null;
    }
    fontSigCache[family] = sig;
    return sig;
  }

  function fontAvailable(name) {
    if (!name) return false;
    if (Object.prototype.hasOwnProperty.call(fontAvailCache, name)) return fontAvailCache[name];
    var a = fontSignature('"' + name + '",monospace');
    var b = fontSignature('monospace');
    var ok = (a !== null && b !== null) ? a !== b : false;
    fontAvailCache[name] = ok;
    return ok;
  }

  /* 「系统」和「黑体」画出来一模一样，就说明这台手机的默认字体本来就是
     我们在「黑体」里点名的那个 —— 手机上通常表现为「换了主题字体，正文没变」。
     这个结论比「已跟随系统字体」有用得多：它直接告诉用户，问题在手机那边，
     不是这个开关没点。 */
  function systemLooksSameAsHeiti() {
    var a = fontSignature(SYSTEM_STACK);
    var b = fontSignature(HEITI_STACK);
    return a !== null && b !== null && a === b;
  }


  function detectSystemFontName() {
    if (systemFontName !== null) return systemFontName;
    systemFontName = '';
    systemFontBridge = false;
    try {
      var bridge = window.LinyuanApp;
      if (bridge) {
        for (var i = 0; i < SYSTEM_FONT_METHODS.length; i++) {
          var key = SYSTEM_FONT_METHODS[i];
          if (typeof bridge[key] !== 'function') continue;
          systemFontBridge = true;
          var out = '';
          try { out = String(bridge[key]() || ''); } catch (e) { out = ''; }
          // 去掉引号并压掉多余空白，避免拼进 CSS 时把字体栈写坏
          out = out.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
          if (!systemFontRaw && out) systemFontRaw = out;
          if (looksLikeFontName(out)) { systemFontName = out; break; }
        }
      }
    } catch (e) {
      systemFontName = '';
    }
    return systemFontName;
  }


  /* 字体落在每篇正文上（不是 :root），所以新接上来的章要单独补一次 */
  function applyFontTo(root) {
    var stack = fontStackFor(state.fontFamily);
    (root || document).querySelectorAll('.chapter-content').forEach(function (el) {
      el.style.fontFamily = stack;
    });
  }


  function fontStackFor(family) {
    if (family === 'kai') {
      /* 自带楷体优先；万一字体没加载成功，退回系统的楷/宋，最后才是 serif。
         KAI_REST 是 GB2312 一级字的兜底片：浏览器只在 KAI_FAMILY 缺该字形时
         才会去下载它（约 630KB），主片有字就永远不碰。
         位置必须紧跟主片 —— 放到系统楷体后面就等于永远轮不到。 */
      return '"' + KAI_FAMILY + '","' + KAI_REST_FAMILY + '","Kaiti SC","STKaiti","KaiTi","楷体","Noto Serif CJK SC",serif';
    }
    if (family === 'system') {
      /* 不能点名叫 Roboto / Segoe UI：装了主题字体的 ROM 替换的是「默认字体族」，
         一旦显式写 Roboto，浏览器会优先命中 Roboto，系统字体就被挡在外面。
         所以只在拿到系统字体名时点名它，否则直接交给 system-ui / sans-serif。
         点名之前先验证这个字体真的存在 —— 壳给的名字可能是 Java 侧的叫法，
         WebView 里并不存在，那样点名等于白点，最后还是渲染成默认字体，
         而界面上写着「已跟随」，用户只会觉得功能没生效。 */
      var name = detectSystemFontName();
      return (name && fontAvailable(name)) ? '"' + name + '",system-ui,sans-serif' : SYSTEM_STACK;
    }
    if (family === 'custom') {
      /* 导入的字体多半是完整的中文 TTF，但万一是残缺的子集，后面的黑体栈兜住缺字 */
      return '"' + USER_FAMILY + '",' + HEITI_STACK;
    }
    return HEITI_STACK;
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
    /* 平时不显示提示；只有选中「系统」时才用一句话说清现状，而且要能据此判断。
       不把技术噪音丢给读者看 —— 上一版把壳返回的原文直接写成「不是网页能用的格式」，
       读者只会以为这个开关坏了。
         拿到名字 + 网页里能渲染 + 与「黑体」不同 → 真的跟随了
         拿到名字 + 网页里能渲染 + 与「黑体」相同 → 手机没给网页换字体
         名字渲染不出来 → 那是 App 那边的叫法，网页里没有这个字体
         壳只给通用族名（sans-serif）→ 只知道「默认无衬线」，叫不出名字
         壳根本没有这个方法 → App 太旧
       真机上最后两种情况最常见：荣耀 / 华为的主题字体只对原生界面生效，WebView
       读的是系统字体配置文件，看不到主题字体 —— 这一条网页端无解，只能靠壳把
       字体文件或字体家族名交出来（见 app/FONT-BRIDGE.md）。 */
    if (state.fontFamily === 'custom') return userFontName ? '已用导入的字体：' + userFontName : '';
    if (state.fontFamily !== 'system') return '';
    var name = detectSystemFontName();
    if (name) {
      if (!fontAvailable(name)) return '手机给的名字（' + name + '）网页里没有，已用默认黑体';
      if (systemLooksSameAsHeiti()) return '手机当前字体与「黑体」相同，看起来不会变';
      return '已跟随系统字体：' + name;
    }
    if (!systemLooksSameAsHeiti()) return '已用上手机当前字体';
    if (systemFontBridge === false) return '当前 App 版本读不到手机字体，已用默认黑体';
    if (isGenericFamily(systemFontRaw)) return '手机只给了通用字体名（' + systemFontRaw + '），网页用默认黑体，主题字体进不来';
    if (systemFontRaw) return '手机给的字体名不可用（' + systemFontRaw + '），已用默认黑体';
    return '手机没有提供字体名，已用默认黑体';
  }


  /* ===== 导入字体：存取 =====
     用 IndexedDB 而不是 localStorage：localStorage 只能放字符串，
     一个中文字体 10–20MB，转 base64 再塞进去会翻成 27MB，Chrome 直接抛配额错误。 */

  function idbFontOpen() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('no-idb')); return; }
      var req = indexedDB.open(FONT_DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(FONT_STORE)) db.createObjectStore(FONT_STORE);
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error || new Error('idb-open')); };
      req.onblocked = function () { rej(new Error('idb-blocked')); };
    });
  }

  /* 三个操作共用的骨架：开库 → 一个事务 → 关库。失败一律 reject，
     调用方决定是提示还是静默降级（隐私模式下 IDB 可能整个不可用）。 */

  function idbFontRun(mode, fn) {
    return idbFontOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var out = null;
        var tx;
        try {
          tx = db.transaction(FONT_STORE, mode);
          fn(tx.objectStore(FONT_STORE), function (v) { out = v; });
        } catch (e) {
          try { db.close(); } catch (e2) {}
          rej(e);
          return;
        }
        tx.oncomplete = function () { try { db.close(); } catch (e) {} res(out); };
        tx.onabort = tx.onerror = function () {
          try { db.close(); } catch (e) {}
          rej(tx.error || new Error('idb-' + mode));
        };
      });
    });
  }

  function idbFontPut(rec) {
    return idbFontRun('readwrite', function (store) { store.put(rec, FONT_REC); });
  }

  function idbFontGet() {
    return idbFontRun('readonly', function (store, keep) {
      var req = store.get(FONT_REC);
      req.onsuccess = function () { keep(req.result || null); };
    });
  }

  function idbFontDel() {
    return idbFontRun('readwrite', function (store) { store['delete'](FONT_REC); });
  }


  function readFileBuffer(file) {
    /* 老 WebView 没有 Blob.arrayBuffer()，退到 FileReader */
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error || new Error('read')); };
      fr.readAsArrayBuffer(file);
    });
  }

  function isFontFile(file) {
    var n = String(file.name || '').toLowerCase();
    if (/\.(ttf|otf|woff2?|ttc)$/.test(n)) return true;
    var t = String(file.type || '');
    return /^font\//.test(t) || /^application\/(x-)?font/.test(t);
  }

  /* 装上字体并（可选）落盘。返回是否真的存住了 —— 隐私模式 / 配额不足时
     字体本次能用，但下次打开就没了，这一点必须让读者知道。 */

  function installUserFont(buffer, name, persist) {
    if (!window.FontFace || !document.fonts || !document.fonts.add) {
      return Promise.reject(new Error('no-fontface'));
    }
    var face = new FontFace(USER_FAMILY, buffer);
    var loaded = face.load();
    return (loaded && loaded.then ? loaded : Promise.resolve(face)).then(function () {
      /* 换字体时先把上一张字面注销掉，否则同名 FontFace 会叠着占内存 */
      if (userFontFace && document.fonts['delete']) {
        try { document.fonts['delete'](userFontFace); } catch (e) {}
      }
      document.fonts.add(face);
      userFontFace = face;
      userFontName = name || '自定义';
      try { localStorage.setItem(USER_FONT_KEY, userFontName); } catch (e) {}
      if (persist === false) return true;
      return idbFontPut({ name: userFontName, data: buffer, at: Date.now() })
        .then(function () { return true; }, function () { return false; });
    });
  }


  function onFontFileChosen(ev) {
    var input = ev.target;
    var file = input && input.files && input.files[0];
    /* 清空 value，否则选同一个文件第二次不会触发 change */
    try { input.value = ''; } catch (e) {}
    if (!file) return;
    if (!isFontFile(file)) { showToast('这不是字体文件（要 .ttf / .otf / .woff / .woff2）'); return; }
    if (file.size > USER_FONT_MAX) { showToast('字体文件太大了（超过 24MB）'); return; }
    showToast('正在读取字体…');
    readFileBuffer(file).then(function (buf) {
      return installUserFont(buf, file.name, true);
    }).then(function (saved) {
      applyFontFamily('custom');
      refreshImportRow();
      showToast(saved ? '已换成你导入的字体' : '字体已应用，但没能保存，下次打开要重新导入');
    }, function (err) {
      if (window.console) console.warn('[font] 导入失败', err);
      showToast('这个字体装不上，换一个试试');
    });
  }


  /* 打开章节时把上次导入的字体装回来。记录没了（换设备 / 清过缓存 / 隐私模式）
     就老老实实退回黑体，不能把读者留在一个指向不存在字体的字体栈上。 */

  function loadUserFontIfNeeded() {
    if (state.fontFamily !== 'custom') return Promise.resolve(false);
    if (userFontLoading) return userFontLoading;
    userFontLoading = idbFontGet().then(function (rec) {
      if (!rec || !rec.data) throw new Error('empty');
      return installUserFont(rec.data, rec.name || userFontName, false);
    }).then(function () { return true; }, function () { return false; }).then(function (ok) {
      userFontLoading = null;
      if (ok) {
        applyFontFamily('custom');
      } else {
        try { localStorage.removeItem(USER_FONT_KEY); } catch (e) {}
        userFontName = '';
        applyFontFamily('fzyouhei');
        refreshImportRow();
      }
      return ok;
    });
    return userFontLoading;
  }


  window.pickFontFile = function () {
    if (shellPickerUnsupported()) {
      showToast('这版 App 还不支持选文件，先用手机浏览器打开本站试试');
      return;
    }
    var input = document.getElementById('fontFileInput');
    if (input) input.click();
  };


  window.clearFontFile = function () {
    idbFontDel().then(function () {}, function () {}).then(function () {
      if (userFontFace && document.fonts && document.fonts['delete']) {
        try { document.fonts['delete'](userFontFace); } catch (e) {}
      }
      userFontFace = null;
      userFontName = '';
      try { localStorage.removeItem(USER_FONT_KEY); } catch (e) {}
      if (state.fontFamily === 'custom') applyFontFamily('fzyouhei');
      refreshImportRow();
      showToast('已移除导入的字体');
    });
  };


  function refreshImportRow() {
    var btn = document.getElementById('fontImportBtn');
    var clearBtn = document.getElementById('fontImportClear');
    var has = !!userFontName;
    if (btn) btn.textContent = has ? '更换字体文件' : '导入自己的字体';
    if (clearBtn) clearBtn.style.display = has ? '' : 'none';
    var hint = document.getElementById('fontImportHint');
    if (hint) {
      /* 只在「壳内且这版壳没接文件选择」时亮出来，别去打扰浏览器用户 */
      hint.textContent = shellPickerUnsupported()
        ? 'App 暂不支持选文件（需壳更新到 ' + SHELL_PICKER_MIN + ' 以上）；可先用手机浏览器打开本站导入，注意导入只对当前浏览器生效'
        : '';
      hint.style.display = hint.textContent ? '' : 'none';
    }
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
    applyFontTo();
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


  window.setFontFamily = function (family) {
    keepPositionWhile(function() { applyFontFamily(family); });
  };

  /* 保留旧函数名，防止其它地方还有引用 */

  window.toggleFontFamily = function () {
    var idx = CYCLE_FAMILIES.indexOf(state.fontFamily);
    if (idx < 0) idx = 0;
    applyFontFamily(CYCLE_FAMILIES[(idx + 1) % CYCLE_FAMILIES.length]);
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


  /* ===== 行距 / 段距 =====
     只落 data 属性，具体差量在 css/style.css 的 [data-lh] / [data-para] 里；
     主题各自的基准行距不受影响（信笺本来就比晴窗松一点）。
     改动会让整章重排，所以走 keepPositionWhile —— 读者应该还停在刚才那一句。 */

  function syncChoiceButtons(attr, value) {
    var btns = document.querySelectorAll('button[' + attr + ']');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('is-on', btns[i].getAttribute(attr) === value);
    }
  }

  function applyLineHeight(mode) {
    state.lineHeight = mode;
    localStorage.setItem('reader-lineheight', mode);
    if (mode === 'normal') document.documentElement.removeAttribute('data-lh');
    else document.documentElement.setAttribute('data-lh', mode);
    syncChoiceButtons('data-lh', mode);
  }

  function applyParaGap(mode) {
    state.paraGap = mode;
    localStorage.setItem('reader-paragap', mode);
    if (mode === 'normal') document.documentElement.removeAttribute('data-para');
    else document.documentElement.setAttribute('data-para', mode);
    syncChoiceButtons('data-para', mode);
  }

  window.setLineHeight = function(mode) {
    keepPositionWhile(function () { applyLineHeight(mode); });
  };

  window.setParaGap = function(mode) {
    keepPositionWhile(function () { applyParaGap(mode); });
  };


  window.toggleReadWidth = function() {
    keepPositionWhile(function() {
      applyReadWidth(state.readWidth === 'wide' ? 'normal' : 'wide');
    });
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
        navigateToChapter(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }


  /* ===== 换章不换页 =====
     点「下一章」/ 左右轻扫 / 键盘换章时不再整页跳转，而是：取下一章的
     `.chapter-content` 与余韵卡 → 原地替换 → replaceState 改 URL → 同步章节 id、
     标题、上下章链接、目录高亮 → 恢复到这一章上次读到的位置。

     为什么不是「无限流」（两章接进同一条滚动）：进度与锚点都按整页
     `scrollHeight` 计算、安卓返回键是「退出阅读」，一旦接成一条流，这两件事
     都要重做，38 项断言也得跟着改。换页保留「一章一页」的心智模型，拿到的是
     「没有白屏、不等那 500ms 网络、不重放转场」。

     任何一步失败都退回整页跳转 —— 至少这一章能读到。 */

  var swapping = false;

  function chapterFileOf(href) {
    if (!href) return null;
    var clean = String(href).split('#')[0].split('?')[0];
    var name = clean.substring(clean.lastIndexOf('/') + 1);
    var list = window.CHAPTERS || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].file === name) return name;
    }
    return null;
  }

  function chapterIndex(file) {
    var list = window.CHAPTERS || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].file === file) return i;
    }
    return -1;
  }

  function syncChapterChrome(file) {
    var list = window.CHAPTERS || [];
    var idx = chapterIndex(file);
    var chapter = list[idx] || {};
    var prev = list[idx - 1];
    var next = list[idx + 1];

    var nameEl = document.querySelector('.reader-topbar .chapter-name');
    if (nameEl && chapter.title) nameEl.textContent = chapter.title;

    var prevEl = document.querySelector('.reader-bottombar .prev-ch');
    var nextEl = document.querySelector('.reader-bottombar .next-ch');
    if (prevEl) prevEl.setAttribute('href', prev ? prev.file : '#');
    if (nextEl) nextEl.setAttribute('href', next ? next.file : '#');

    var dir = document.getElementById('dirOverlay');
    if (dir && dir.classList.contains('visible')) populateDirectory();
  }


  /* ===== 取章 =====
     同一次加载里同一章只取一次：预取和「真的要接上」共用同一个 Promise，
     这样滚到章末时通常已经在缓存里，接续不等待网络。 */

  var chapterDocs = {};

  function fetchChapterDoc(file) {
    if (chapterDocs[file]) return chapterDocs[file];
    var url = new URL(file, window.location.href).href;
    chapterDocs[file] = fetch(url, { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      })
      .then(function (text) {
        return new DOMParser().parseFromString(text, 'text/html');
      })
      .catch(function (err) {
        delete chapterDocs[file];   /* 失败不缓存，下次滚动再试 */
        throw err;
      });
    return chapterDocs[file];
  }


  /* ===== 换章不换页（单块时的兜底） =====
     链条里没有目标章、且当前只有一个块时用它：取回整章原地替换，无白屏。
     多块时不能用它 —— 替换会把已经接好的链整条毁掉。 */

  function swapTo(file, hash) {
    if (!file || swapping) return false;
    if (file === getCurrentFileName()) return false;

    swapping = true;
    var url = new URL(file, window.location.href).href;

    fetchChapterDoc(file)
      .then(function (doc) {
        var nextContent = doc.querySelector('.chapter-content');
        if (!nextContent) throw new Error('章节内容缺失');
        var nextGlow = doc.querySelector('.chapter-afterglow');

        /* 先把「读到哪了」写回旧章（force：跳过节流） */
        saveProgress(undefined, true);

        var curContent = document.querySelector('.chapter-content');
        curContent.parentNode.replaceChild(document.importNode(nextContent, true), curContent);
        var curGlow = document.querySelector('.chapter-afterglow');
        if (curGlow && nextGlow) {
          curGlow.parentNode.replaceChild(document.importNode(nextGlow, true), curGlow);
        }

        /* URL 与章节 id 必须一起换：id 落后一章，进度就还写在上一章名下 */
        try { history.replaceState(null, '', url); } catch (err) { /* 非 http 环境 */ }
        LY.store.setChapterId(file);

        if (doc.title) document.title = doc.title;
        var nextDesc = doc.querySelector('meta[name="description"]');
        var myDesc = document.querySelector('meta[name="description"]');
        if (nextDesc && myDesc) myDesc.setAttribute('content', nextDesc.getAttribute('content') || '');

        syncChapterChrome(file);
        decorateParagraphs();

        /* 回到这一章上次读到的位置；没读过就停在章首 */
        window.scrollTo(0, 0);
        if (LY.engine.resetUserScroll) LY.engine.resetUserScroll();
        restoreProgress();

        if (hash) {
          var target = document.getElementById(hash);
          if (target) target.scrollIntoView();
        }
        LY.store.recordFootprints();
      })
      .catch(function () {
        /* 兜底：整页跳转。慢一点，但这一章一定能读到 */
        window.location.href = url + (hash ? '#' + hash : '');
      })
      .then(function () { swapping = false; });

    return true;
  }


  /* ===== 章节流：往下滚就接上下一章 =====
     章末的「一章一句」是接缝：滚过它，接着是下一章的标题。
     底部工具栏那对链接、键盘 ←→、左右轻扫都走同一条链路（navigateToChapter）。 */

  var flowAppending = {};
  var APPEND_AHEAD = 900;      /* 距页底多近开始接 */
  var PREFETCH_AHEAD = 2600;   /* 更早先把 HTML 取回来，接的时候不等待 */

  /* 关掉即回到「一次只装一章」：章节页本身仍然可用，只是不再自动续 */
  function flowEnabled() {
    return !!(LY.flags && LY.flags.isOn) ? LY.flags.isOn('infiniteScroll') !== false : true;
  }

  function flowRoot() {
    var flow = document.getElementById('readingFlow');
    if (flow) return flow;
    var first = document.querySelector('.chapter-content');
    if (!first) return null;
    /* 旧页面（正文没包 chapter-block）：现场收进一个块，后续逻辑才统一 */
    flow = document.createElement('div');
    flow.id = 'readingFlow';
    flow.className = 'reading-flow';
    first.parentNode.insertBefore(flow, first);
    var section = document.createElement('section');
    section.className = 'chapter-block';
    section.setAttribute('data-file', getCurrentFileName());
    flow.appendChild(section);
    section.appendChild(first);
    var glow = document.querySelector('.chapter-afterglow');
    if (glow) section.appendChild(glow);
    return flow;
  }

  function blockByFile(file) {
    var list = document.querySelectorAll('.chapter-block');
    for (var i = 0; i < list.length; i++) {
      if (list[i].getAttribute('data-file') === file) return list[i];
    }
    return null;
  }

  function lastBlockFile() {
    var list = document.querySelectorAll('.chapter-block');
    var last = list[list.length - 1];
    return last ? last.getAttribute('data-file') : getCurrentFileName();
  }

  function nextFileOf(file) {
    var list = window.CHAPTERS || [];
    var next = list[chapterIndex(file) + 1];
    return next ? next.file : '';
  }

  function scrollToBlock(block) {
    if (!block) return;
    /* 这是读者明确要去的地方：告诉 engine「他已经动了」，
       否则启动时那套「恢复到上次位置」的重试会把人往回拽。 */
    markUserScroll();
    var jump = function() {
      var top = window.scrollY + block.getBoundingClientRect().top;
      window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    };
    jump();
    /* 刚插入的块，第一次量到的高度可能还没算上字体/图片的最终排版，
       下一帧再落一次位，避免停在章首往下几百像素的地方。 */
    requestAnimationFrame(jump);
  }

  /* 把下一章接到链条末尾。
     返回 true 表示「确实有下一章，已接上或正在接」——自动滚屏据此决定要不要停。
     then(section) 在接上之后调用，用于「跳过去」这种需要落位的场景。 */
  function appendNext(then) {
    if (!flowEnabled()) return false;
    var file = nextFileOf(lastBlockFile());
    if (!file || blockByFile(file)) return false;
    if (flowAppending[file]) {
      if (then) setTimeout(function() { var b = blockByFile(file); if (b) then(b); }, 400);
      return true;
    }

    flowAppending[file] = true;
    fetchChapterDoc(file).then(function (doc) {
      var content = doc.querySelector('.chapter-content');
      if (!content) throw new Error('章节内容缺失');
      var glow = doc.querySelector('.chapter-afterglow');
      var flow = flowRoot();
      if (!flow) throw new Error('没有阅读流容器');

      var section = document.createElement('section');
      section.className = 'chapter-block';
      section.setAttribute('data-file', file);
      section.appendChild(document.importNode(content, true));
      if (glow) section.appendChild(document.importNode(glow, true));
      flow.appendChild(section);

      decorateParagraphs(section);
      /* 新接上来的块也要吃到阅读辅助与自定义字体，否则翻过接缝字体就变回去了 */
      captureContent(section);
      renderContentDecorations(section);
      applyFontTo(section);
      delete flowAppending[file];
      if (then) then(section);
    }).catch(function () {
      /* 接不上就安静收场，等下一次滚动重试。
         绝不整页跳走：读者正在读的地方不能因为网络抖一下而丢掉。 */
      delete flowAppending[file];
      delete chapterDocs[file];
    });

    return true;
  }


  function initFlow() {
    if (!document.querySelector('.chapter-content')) return;

    var scheduled = false;
    window.addEventListener('scroll', function () {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        if (!flowEnabled()) return;
        var remain = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
        if (remain >= PREFETCH_AHEAD) return;
        var next = nextFileOf(lastBlockFile());
        if (!next) return;
        if (remain < APPEND_AHEAD) appendNext();
        else if (!chapterDocs[next]) fetchChapterDoc(next).catch(function () {});
      });
    }, { passive: true });

    /* 首屏就装得下整章（短章 or 超高屏）：不用等滚动 */
    var remain = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
    if (remain < APPEND_AHEAD) appendNext();
  }


  /* engine 的探测线跨进新块时回调：把「当前章」同步到 URL、标题、顶栏、上下章链接。
     只动界面以外的东西，绝不碰滚动位置 —— 读者正在往下读，不能把他拽回去。 */
  function onChapterEntered(file) {
    try { history.replaceState(null, '', new URL(file, window.location.href).href); } catch (err) { /* 非 http 环境 */ }

    var list = window.CHAPTERS || [];
    var chapter = list[chapterIndex(file)] || {};
    if (chapter.title) document.title = chapter.title;

    syncChapterChrome(file);
    LY.store.recordFootprints();
  }


  function goToChapter(file, hash) {
    if (!file) return false;
    var block = blockByFile(file);
    if (block) {
      var target = hash ? document.getElementById(hash) : null;
      if (target) target.scrollIntoView({ block: 'center' });
      else scrollToBlock(block);
      return true;
    }
    /* 正好是链条末尾的下一章：接上并过去，而不是换页 */
    if (flowEnabled() && file === nextFileOf(lastBlockFile())) {
      appendNext(function (section) { scrollToBlock(section); });
      return true;
    }
    /* 不在链条里：单块时用换章不换页（无白屏）；多块时整页跳转，链条重建 */
    if (document.querySelectorAll('.chapter-block').length <= 1) return swapTo(file, hash);
    window.location.href = new URL(file, window.location.href).href + (hash ? '#' + hash : '');
    return true;
  }


  function navigateToChapter(dir) {
    var list = window.CHAPTERS || [];
    var target = list[chapterIndex(getCurrentFileName()) + (dir > 0 ? 1 : -1)];
    if (!target) {
      showToast(dir > 0 ? '已经是最后一章' : '这是第一章');
      return;
    }
    var block = blockByFile(target.file);
    if (block) { scrollToBlock(block); return; }
    /* 往下走就是「接下一章」本身，接上之后落位到那一章的开头 */
    if (dir > 0) { appendNext(function (section) { scrollToBlock(section); }); return; }
    goToChapter(target.file);
  }


  /* 正文流里的「下一章」、目录项、摘句簿的「回到这一页」都是普通链接，
     这里用捕获阶段抢先接管，否则 transition.js 会把整页转场先跑起来。 */
  function initChapterSwap() {
    document.addEventListener('click', function(e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target === '_blank') return;

      var href = a.getAttribute('href') || '';
      var isQuote = a.classList.contains('quote-action');
      var file = chapterFileOf(href);

      /* 同一章的摘句链接：浏览器原生锚点跳转就够，只需要把面板收起来，
         否则面板正好盖住刚落位的那一段。 */
      if (isQuote && (!file || file === getCurrentFileName())) {
        if (typeof closeQuotes === 'function') closeQuotes();
        return;
      }
      if (!file || file === getCurrentFileName()) return;

      e.preventDefault();
      e.stopPropagation();

      var hash = href.indexOf('#') >= 0 ? href.split('#')[1] : '';
      if (typeof closeDirectory === 'function') closeDirectory();
      if (isQuote && typeof closeQuotes === 'function') closeQuotes();
      /* 底部工具栏的上一章/下一章也走这里 —— 和键盘、轻扫同一条链路 */
      if (a.classList.contains('next-ch') || a.classList.contains('prev-ch')) {
        navigateToChapter(a.classList.contains('next-ch') ? 1 : -1);
        return;
      }
      if (!goToChapter(file, hash)) window.location.href = href;
    }, true);
  }


  function updateProgressFill(pct) {
    pct = clampProgress(pct);
    var line = document.querySelector('.reading-progress-line');
    var fill = document.getElementById('progressFill');
    if (line) line.style.width = pct + '%';
    if (fill) fill.style.width = pct + '%';
  }


  /* ===== 键盘：Escape 逐层关闭（设置 -> 摘句簿 -> 目录 -> 工具栏） ===== */

  function initModalKeys() {
    document.addEventListener('keydown', function(e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      var settings = document.getElementById('settingsOverlay');
      var quotes = document.getElementById('quotesOverlay');
      var dir = document.getElementById('dirOverlay');
      var dataOv = document.getElementById('dataOverlay');
      if (dataOv && dataOv.classList.contains('visible')) { closeDataModal(); }
      else if (settings && settings.classList.contains('visible')) { closeSettings(); }
      else if (quotes && quotes.classList.contains('visible')) { closeQuotes(); }
      else if (dir && dir.classList.contains('visible')) { closeDirectory(); }
      else if (state.barsVisible) { hideBars(); }
    });
  }


  /* ===== 键盘：← → 换章，D 目录，T 夜读 =====
     桌面/外接键盘才有，和「左右轻扫切章」走同一条链路（点 .prev-ch / .next-ch），
     不另开一套导航，免得两条路径行为分叉。空格与 PageUp/PageDown 交给浏览器默认，
     不拦；面板打开时完全不响应，避免一边看目录一边被翻页。 */

  function anyPanelOpen() {
    var ids = ['settingsOverlay', 'quotesOverlay', 'dirOverlay', 'dataOverlay'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && el.classList.contains('visible')) return true;
    }
    return false;
  }


  /* 键盘与轻扫走同一条链路：能换代就换代，换不了才整页跳转，边界给一句提示 */
  function goChapter(dir) {
    navigateToChapter(dir);
  }


  function initKeyboardNav() {
    document.addEventListener('keydown', function(e) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      var tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (t && t.isContentEditable) return;
      if (anyPanelOpen()) return;

      switch (e.key) {
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          goChapter(1);
          break;
        case 'ArrowLeft':
        case 'h':
          e.preventDefault();
          goChapter(-1);
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          window.openDirectory();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          window.toggleNightMode();
          break;
        case '?':
          e.preventDefault();
          showToast('← → 换章 · 空格翻屏 · D 目录 · T 夜读 · Esc 收起');
          break;
        default:
          break;
      }
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


  /* 摘句落点的 id 必须带章名：无限流下页面里躺着好几章，
     只按段号会在块与块之间撞车，「回到这一页」就会跳到别的章去。 */
  function fileStem(file) {
    return String(file || '').replace(/\.html$/, '');
  }

  function quoteAnchorId(file, index) {
    return 'quote-' + fileStem(file) + '-' + index;
  }

  function chapterTitleOf(file) {
    var chapter = (window.CHAPTERS || [])[chapterIndex(file)];
    return chapter ? chapter.title : document.title;
  }


  function decorateParagraphs(root) {
    var contents = (root || document).querySelectorAll('.chapter-content');
    contents.forEach(function(content) {
      var section = content.closest ? content.closest('.chapter-block') : null;
      var file = (section && section.getAttribute('data-file')) || getCurrentFileName();
      var title = chapterTitleOf(file);
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
      list.innerHTML = '<div class="quotes-empty">暂未摘句，等待你为某段文字驻足。</div>';
      return;
    }
    list.innerHTML = quotes.slice().reverse().map(function(item) {
      return '<article class="quote-entry">' +
        '<div class="quote-entry-text">' + escapeHtml(item.text) + '</div>' +
        '<div class="quote-entry-meta">' + escapeHtml(item.chapterTitle) + '</div>' +
        '<div class="quote-entry-actions">' +
          '<a href="' + item.chapterFile + '#' + quoteAnchorId(item.chapterFile, item.index) + '" class="quote-action">回到这一页</a>' +
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
        showToast('已摘句');
      }, function() {
        showToast('摘句失败，请重试');
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
    showToast('已将文字送回，等待您的下一次目光');
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

  window.shareChapter = function(from) {
    /* 卡片属于哪一章就分享哪一章：无限流下「当前章」随滚动变，
       而读者点的可能是屏幕上那一张（比如刚滚过接缝的那一刻）。 */
    var section = from && from.closest ? from.closest('.chapter-block') : null;
    var file = (section && section.getAttribute('data-file')) || getCurrentFileName();
    var chapter = (window.CHAPTERS || [])[chapterIndex(file)];
    var title = chapter ? chapter.title : document.title;
    var url = new URL(file, window.location.href).href;
    /* 壳内优先走原生分享（js/native-bridge.js 暴露的 LinyuanApp.share）。
       浏览器里 LinyuanApp 不存在，直接落到下面的 Web Share / 复制链接分支。
       注意顺序：native-bridge 会在壳内补一个 navigator.share，所以这条判断
       必须放在 navigator.share 之前，否则壳内拿到的是二手代理。 */
    var bridge = window.LinyuanApp;
    if (bridge && typeof bridge.share === 'function') {
      try {
        bridge.share('临渊羡鱼 —— ' + title, url);
        return;
      } catch (e) {
        /* 原生桥异常（极少见）：继续走后面的通用路径，不要静默失败 */
      }
    }
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
      showToast('已将文字送回，等待您的下一次目光');
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
    p.id = quoteAnchorId(p.dataset.chapterFile || getCurrentFileName(), p.dataset.quoteIndex || '0');
  }


  function refreshAllParagraphQuoteStates() {
    document.querySelectorAll('.collectable-paragraph').forEach(refreshParagraphQuoteState);
  }


  function initToast() {
    if (document.getElementById('readerToast')) return;
    var toast = LY.dom.el('div', { id: 'readerToast', class: 'reader-toast' });
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


  function escapeHtml(text) {
    return LY.dom.escapeHtml(text);
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
            '<div class="font-import-row">' +
              '<button class="font-import-btn" id="fontImportBtn" onclick="pickFontFile()">导入自己的字体</button>' +
              '<button class="font-import-clear" id="fontImportClear" onclick="clearFontFile()" style="display:none">移除</button>' +
            '</div>' +
            '<input type="file" id="fontFileInput" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" style="display:none">' +
            '<div class="setting-hint" id="fontImportHint" style="display:none"></div>' +
          '</div>' +
          '<div class="setting-group"><div class="setting-label">版式</div>' +
            '<div class="mode-toggle-row">' +
              '<button id="readWidthToggle" class="mode-toggle-btn" onclick="toggleReadWidth()"><span id="readWidthLabel">' + (state.readWidth === 'wide' ? '宽屏阅读 · 开' : '宽屏阅读 · 关') + '</span></button>' +
            '</div>' +
            '<div class="setting-sublabel">行距</div>' +
            '<div class="mode-toggle-row" id="lineHeightChoices">' +
              '<button class="mode-toggle-btn' + (state.lineHeight === 'tight' ? ' is-on' : '') + '" data-lh="tight" onclick="setLineHeight(\'tight\')">紧凑</button>' +
              '<button class="mode-toggle-btn' + (state.lineHeight === 'normal' ? ' is-on' : '') + '" data-lh="normal" onclick="setLineHeight(\'normal\')">标准</button>' +
              '<button class="mode-toggle-btn' + (state.lineHeight === 'loose' ? ' is-on' : '') + '" data-lh="loose" onclick="setLineHeight(\'loose\')">宽松</button>' +
            '</div>' +
            '<div class="setting-sublabel">段距</div>' +
            '<div class="mode-toggle-row" id="paraGapChoices">' +
              '<button class="mode-toggle-btn' + (state.paraGap === 'tight' ? ' is-on' : '') + '" data-para="tight" onclick="setParaGap(\'tight\')">紧凑</button>' +
              '<button class="mode-toggle-btn' + (state.paraGap === 'normal' ? ' is-on' : '') + '" data-para="normal" onclick="setParaGap(\'normal\')">标准</button>' +
              '<button class="mode-toggle-btn' + (state.paraGap === 'loose' ? ' is-on' : '') + '" data-para="loose" onclick="setParaGap(\'loose\')">宽松</button>' +
            '</div>' +
          '</div>' +
          '<div class="setting-group" data-group="aids"><div class="setting-label">阅读辅助</div>' +
            '<div class="mode-toggle-row">' +
              '<button class="mode-toggle-btn' + (readingAids.dialogue ? ' is-on' : '') + '" data-aid="dialogue" onclick="toggleReadingAid(\'dialogue\')">' + aidLabel('dialogue') + '</button>' +
              '<button class="mode-toggle-btn' + (readingAids.cornerQuotes ? ' is-on' : '') + '" data-aid="cornerQuotes" onclick="toggleReadingAid(\'cornerQuotes\')">' + aidLabel('cornerQuotes') + '</button>' +
            '</div>' +
            '<div class="mode-toggle-row mode-toggle-row-gap">' +
              '<button class="mode-toggle-btn' + (readingAids.keepAwake ? ' is-on' : '') + '" data-aid="keepAwake" onclick="toggleReadingAid(\'keepAwake\')">' + aidLabel('keepAwake') + '</button>' +
              '<button class="mode-toggle-btn' + (readingAids.remainTime ? ' is-on' : '') + '" data-aid="remainTime" onclick="toggleReadingAid(\'remainTime\')">' + aidLabel('remainTime') + '</button>' +
            '</div>' +
          '</div>' +
          '<div class="setting-group" data-group="backup"><div class="setting-label">阅读数据</div>' +
            '<div class="mode-toggle-row">' +
              '<button class="mode-toggle-btn" onclick="openDataModal(\'export\')">备份数据</button>' +
              '<button class="mode-toggle-btn" onclick="openDataModal(\'import\')">恢复数据</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    (document.querySelector('.reading-wrapper') || document.body).appendChild(ov);
    ov.querySelector('.modal-backdrop').addEventListener('click', closeSettings);
    var fileInput = ov.querySelector('#fontFileInput');
    if (fileInput) fileInput.addEventListener('change', onFontFileChosen);
    refreshImportRow();
  }


  /* ===== 远程开关 → 界面可见性 =====
     开关只藏按钮是不够的（用户可能从旧页面点进来），所以每个入口函数里都有
     isOn 守卫；这里负责把入口本身也拿掉 —— 点到一个死按钮比没有按钮更糟。 */
  function applyFeatureVisibility() {
    var autoBtn = document.querySelector('button[onclick*="toggleAutoScroll"]');
    if (autoBtn) autoBtn.style.display = LY.flags.isOn('autoscroll') ? '' : 'none';

    var ov = document.getElementById('settingsOverlay');
    if (!ov) return;   /* 面板还没建过，等 openSettings 时再同步 */
    var aids = ov.querySelector('[data-group="aids"]');
    if (aids) aids.style.display = LY.flags.isOn('readingAids') ? '' : 'none';
    var backup = ov.querySelector('[data-group="backup"]');
    if (backup) backup.style.display = LY.flags.isOn('backup') ? '' : 'none';
  }

  window.openSettings = function() {
    var ov = document.getElementById('settingsOverlay');
    if (!ov) { initSettingsPanel(); ov = document.getElementById('settingsOverlay'); }
    var circles = ov.querySelectorAll('.theme-circle');
    circles.forEach(function(c) { c.classList.toggle('active', c.dataset.theme === state.theme); });
    refreshFontButtons();
    refreshImportRow();
    refreshAidButtons();
    var fontHintBox = document.getElementById('fontFamilyHint');
    if (fontHintBox) {
      fontHintBox.textContent = fontHintText();
      fontHintBox.style.display = fontHintBox.textContent ? '' : 'none';
    }
    var rw = document.getElementById('readWidthLabel');
    if (rw) rw.textContent = state.readWidth === 'wide' ? '宽屏阅读 · 开' : '宽屏阅读 · 关';
    applyFeatureVisibility();
    if (ov) { ov.classList.add('visible'); document.body.style.overflow = 'hidden'; }
    if (state.barsVisible) { stopAutoClose(); startAutoClose(); }
  };


  window.closeSettings = function() {
    var ov = document.getElementById('settingsOverlay');
    if (ov) { ov.classList.remove('visible'); document.body.style.overflow = ''; }
  };


  /* ===== 阅读数据备份 =====
     本站是本地优先：进度、摘句、足迹、设置全都只存在这台机器的 localStorage，
     换手机、清缓存、重装 App 就是全丢。所以给两个出口：
       备份 —— 把 reader-* 键打包成一段 JSON，可复制、可存文件
       恢复 —— 把那段 JSON 原样写回
     为什么用文本框而不是直接触发下载：Android WebView 里 a[download] 基本
     不会真的下载（没有 DownloadListener），静默失败比没做更糟。 */

  var dataMode = 'export';

  var dataConfirmUntil = 0;


  function formatDuration(sec) {
    if (!sec) return '0 分钟';
    if (sec < 60) return '不到 1 分钟';
    var min = Math.round(sec / 60);
    if (min < 60) return min + ' 分钟';
    var h = Math.floor(min / 60);
    var m = min % 60;
    return m ? h + ' 小时 ' + m + ' 分钟' : h + ' 小时';
  }


  function openDataModal(mode) {
    if (!LY.flags.isOn('backup')) { showToast('数据备份暂时关闭'); return; }
    var ov = document.getElementById('dataOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'dataOverlay';
      ov.className = 'modal-overlay';
      ov.innerHTML =
        '<div class="modal-backdrop"></div>' +
        '<div class="modal-panel data-modal" role="dialog" aria-modal="true" aria-label="阅读数据">' +
          '<div class="modal-header"><span id="dataTitle">阅读数据</span>' +
            '<button class="modal-close" onclick="closeDataModal()">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<div class="data-hint" id="dataHint"></div>' +
            '<textarea id="dataText" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="在这里粘贴备份内容"></textarea>' +
            '<div class="data-actions">' +
              '<button class="mode-toggle-btn" id="dataPrimary" onclick="dataPrimaryAction()">复制</button>' +
              '<button class="mode-toggle-btn" onclick="dataDownload()" id="dataDownloadBtn">存为文件</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      (document.querySelector('.reading-wrapper') || document.body).appendChild(ov);
      ov.querySelector('.modal-backdrop').addEventListener('click', closeDataModal);
    }

    dataMode = mode;
    dataConfirmUntil = 0;
    var title = document.getElementById('dataTitle');
    var hint = document.getElementById('dataHint');
    var ta = document.getElementById('dataText');
    var primary = document.getElementById('dataPrimary');
    var dl = document.getElementById('dataDownloadBtn');

    if (mode === 'export') {
      var payload = collectReaderData();
      title.textContent = '备份阅读数据';
      hint.textContent = '包含 ' + payload.summary.chapters + ' 章的进度、' +
        payload.summary.quotes + ' 条摘句、阅读 ' + formatDuration(payload.summary.seconds) +
        '。复制后自己存好，换设备时用「恢复数据」贴回来。';
      ta.value = JSON.stringify(payload, null, 2);
      ta.setAttribute('readonly', 'readonly');
      primary.textContent = '复制';
      /* 壳里下不了文件，按钮直接不出现，免得更糟的静默失败 */
      dl.style.display = window.LinyuanApp ? 'none' : '';
    } else {
      title.textContent = '恢复阅读数据';
      hint.textContent = '把备份内容整段贴进下面的框里，会覆盖这台设备上现有的进度、摘句和设置。';
      ta.value = '';
      ta.removeAttribute('readonly');
      primary.textContent = '导入并覆盖';
      dl.style.display = 'none';
    }

    ov.classList.add('visible');
    document.body.style.overflow = 'hidden';
    if (state.barsVisible) { stopAutoClose(); }
    if (mode === 'import') setTimeout(function() { ta.focus(); }, 220);
  }


  window.openDataModal = openDataModal;


  window.closeDataModal = function() {
    var ov = document.getElementById('dataOverlay');
    if (!ov) return;
    ov.classList.remove('visible');
    document.body.style.overflow = '';
    if (state.barsVisible) startAutoClose();
  };


  window.dataPrimaryAction = function() {
    if (dataMode === 'export') {
      var ta = document.getElementById('dataText');
      copyText(ta.value).then(function() {
        showToast('备份内容已复制');
      }, function() {
        showToast('请长按文本框，全选复制');
        ta.focus();
        ta.setSelectionRange(0, ta.value.length);
      });
      return;
    }
    /* 导入会覆盖现有数据：第一次点击只「上膛」，3 秒内再点一次才真的写入 */
    var primary = document.getElementById('dataPrimary');
    var now = Date.now();
    if (now > dataConfirmUntil) {
      dataConfirmUntil = now + 3000;
      primary.textContent = '确认覆盖？';
      setTimeout(function() {
        if (Date.now() >= dataConfirmUntil && dataMode === 'import') {
          var btn = document.getElementById('dataPrimary');
          if (btn) btn.textContent = '导入并覆盖';
        }
      }, 3100);
      return;
    }
    dataConfirmUntil = 0;
    var err = importReaderData(document.getElementById('dataText').value);
    if (err) {
      showToast(err);
      primary.textContent = '导入并覆盖';
      return;
    }
    showToast('已恢复，正在重新载入…');
    setTimeout(function() { window.location.reload(); }, 700);
  };


  window.dataDownload = function() {
    try {
      var blob = new Blob([document.getElementById('dataText').value], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var d = new Date();
      a.href = url;
      a.download = '临渊羡鱼-阅读数据-' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function() { URL.revokeObjectURL(url); }, 4000);
    } catch (e) {
      showToast('无法保存文件，请改用复制');
    }
  };


  function pad2(n) { return (n < 10 ? '0' : '') + n; }


  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function(resolve, reject) {
      var ta = document.getElementById('dataText');
      if (!ta) { reject(); return; }
      ta.removeAttribute('readonly');
      ta.focus();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.setAttribute('readonly', 'readonly');
      ok ? resolve() : reject();
    });
  }


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

  /* 一章一份快照：无限流下一页里可能有好几章，用单一变量只记得住第一章，
     后面接上来的章节开关就会失效（或者被第一章的快照整段冲掉）。 */

  var contentSnapshots = [];   /* [{ el, html }] */

  var wakeSentinel = null;

  function snapshotOf(article) {
    for (var i = 0; i < contentSnapshots.length; i++) {
      if (contentSnapshots[i].el === article) return contentSnapshots[i];
    }
    var snap = { el: article, html: article.innerHTML };
    contentSnapshots.push(snap);
    return snap;
  }

  function captureContent(root) {
    (root || document).querySelectorAll('.chapter-content').forEach(snapshotOf);
  }

  /* 以快照为源重建正文：先做引号替换，再按需包裹对话。
     root 给定时只处理它里面的章（新接上来的那一块）。 */

  function renderContentDecorations(root) {
    contentSnapshots.forEach(function (snap) {
      if (!snap.el.isConnected) return;
      if (root && !root.contains(snap.el)) return;
      renderOneContent(snap);
    });
  }

  function renderOneContent(snap) {
    var article = snap.el;
    if (!readingAids.dialogue && !readingAids.cornerQuotes) {
      article.innerHTML = snap.html;
      return;
    }
    var holder = document.createElement('div');
    holder.innerHTML = snap.html;
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

  /* 剩余阅读时间：按中文字数折算（约 400 字/分钟），随滚动更新。
     口径是「本章还剩多少」——无限流下一页有好几章，按整页算会一直显示全书。 */

  function updateRemainTime() {
    var el = document.getElementById('readerRemain');
    if (!el) return;
    if (!readingAids.remainTime) { el.textContent = ''; return; }
    var block = LY.engine && LY.engine.currentBlock ? LY.engine.currentBlock() : null;
    var article = (block || document).querySelector('.chapter-content');
    if (!article) { el.textContent = ''; return; }
    var total = (article.textContent || '').replace(/\s+/g, '').length;
    var pct = block && LY.engine.getCurrentProgressPct ? LY.engine.getCurrentProgressPct() : 0;
    var left = Math.round(total * (1 - pct / 100));
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
    if (!LY.flags.isOn('readingAids')) { showToast('阅读辅助暂时关闭'); return; }
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

  /* ===== 对外暴露给 engine 的入口 =====
     engine 不认识面板，也不该认识；它需要「告诉界面进度变了 / 收工具栏 /
     弹个提示」时，都从这里进来。 */
  LY.ui = {
    init: init,
    syncProgress: updateProgressFill,
    onChapterEntered: onChapterEntered,
    ensureNext: appendNext,
    toast: showToast,
    hideBars: hideBars,
    startAutoClose: startAutoClose,
    stopAutoClose: stopAutoClose,
    closeSettings: function() { if (typeof closeSettings === 'function') closeSettings(); },
    isBarsVisible: function() { return !!state.barsVisible; },
    state: state
  };
})();
