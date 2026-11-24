/**
 * js/transition.js — 全站「页面切换过渡遮罩」的唯一实现
 *
 * ══════════════════════════════════════════════════════════════════════
 * 【当前状态：已全站停用，没有任何页面调用 PageTransition.init()】
 *
 * 停用原因（用户明确要求）：这套动画在「点章节 → 进阅读页」上产生了可感知的
 * 等待。headless Chrome + CDP 实测（390×844，首页 .date-item → chapter-01）：
 *   点下去 → 浏览器真正开始导航      481ms（就是下面的 exitDelay 430ms）
 *   章节页遮罩盖住正文直到           708ms（enterHold 170 + 淡出 190 + 五层 JS 初始化）
 *   章节页自身 FCP 112ms、DCL 412ms、长任务 0 个
 * 也就是说：正文早就画好了，读者却在看遮罩。用户原话「进入阅读页不要有明显的卡顿，
 * 可以不要动画」→ 停用后同一次点击的等待实测 4ms（且遮罩元素不再存在），
 * 点完即见正文。
 *
 * 停用方式（**只摘调用，不删模块**）：
 *   · index.html / novel/index.html 的内联 PageTransition.init(...) 已注释掉；
 *   · js/reader.ui.js 的 initPageTransition() 连同调用点一起删除；
 *   · novel/index.html 里那个写死旧叶子结构的静态 <div id="pageTransition"> 也删了
 *     —— 留着它遮罩元素仍在 DOM 里，只是永远不会被激活。
 *   · 本文件与 css/style.css 的 .page-transition / .book-* 样式**保留**：30+ 个生成页
 *     （novel/chapter-*.html、novel/characters.html、novel/character-*.html 由
 *     new-chapter.js / tools/make-characters.mjs 生成）的 <script> 还引用它，
 *     删文件必须重新生成全站，风险与收益不成比例。保留的代价只是「加载一段没有
 *     调用方的 IIFE」——本文件在被调用前不产生任何 DOM、定时器或监听。
 *
 * 重新启用的做法：在需要过渡的页面里恢复一次 PageTransition.init({...}) 即可
 * （各页原配置见 index.html / novel/index.html 注释里保留的那几行）。
 * 所以下面这套设计说明全部**仍然有效**，是「若将来重启过渡时的注意事项」——
 * 不是「忘了接线的死代码」，请勿因为「没人调用」而删除。
 * ══════════════════════════════════════════════════════════════════════
 *
 * 历史：这段逻辑原来在三个地方各抄了一份（index.html 内联、novel/index.html 内联、
 * js/reader.js 的 initPageTransition），三份的状态机与标记格式一旦漂移就会互相
 * 误触发（改一处忘记改另一处 → 章节页认不出新标记 → 遮罩不出现或残留）。
 * 现在只保留这一份，页面差异全部走 init() 的配置项。
 *
 * 设计要点（全部有实测依据，改动前请先看这几条）：
 *   1. tab 栏内链接**不参与过渡**：同层级切换没有叙事价值，遮罩只会被感知成
 *      「点下去卡住」。不 preventDefault、不写标记、不加延迟。
 *   2. 标记 = sessionStorage['page-transitioning'] = { t: 时间戳, to: 目标页 pathname }。
 *      目标页只有 to === location.pathname 才认 —— 否则没有消费方的页面（人物/
 *      剪贴本）留下的标记会在下一次进首页/书架时误触发一层遮罩。
 *   3. 入场停留 ENTER_HOLD = 200ms（原 650ms），计时从「遮罩已提交到样式」的
 *      第二帧起算，避免弱 CPU 下首帧推迟导致还没淡满就开始退场。
 *   4. 遮罩的 pointer-events 由 CSS 永久置为 none（`.page-transition`），
 *      这里不做任何 pointer-events 操作 —— 遮罩只做视觉，任何时刻都不拦点击。
 *
 * 用法：
 *   PageTransition.init({
 *     lines: [...],        // 文案池（省略用内置默认）
 *     cover: '/assets/cover.webp',  // 翻书用的封面图（省略用内置默认）
 *     initialText: '…',    // 新建遮罩时的初始文案
 *     entryText: 'random', // 入场时是否换成随机文案（章节页/书架用）
 *     skipSelector: '.tab-bar',  // 命中其内的链接直接走浏览器默认跳转
 *     mount: el,           // 遮罩挂载点（默认 document.body）
 *     delegate: false,     // 事件委托 vs. 初始化时直接绑定，详见下方说明
 *     hashScroll: false,   // 同页锚点链接改为平滑滚动、不触发过渡（章节页用）
 *     exitDelay: 430,      // 等书翻开放大铺满再跳转
 *     enterHold: 170,
 *     enterTtl: 8000
 *   });
 *
 *   视觉：点链接 → 屏幕中央立起一本带书页厚度的 3D 书（封面 + 书口）→
 *   封面绕左侧书脊翻开、整本书同步放大 → 露出的内页铺满全屏 → 跳转 →
 *   新页面上那页纸继续放大并淡出，揭示正文。
 *   这是「番茄小说点开一本书」的运动序列：**一本书 → 翻开 → 放大 → 进入**。
 *
 *   起点刻意**不是点击的条目**。曾按 FLIP 从点击元素的 rect 起飞，但书架/目录
 *   是文字列表，从一行字上长出封面看着很怪；用户要的是「从一本书」开始。
 *   所以书固定立在屏幕中央，翻开与放大的运动本身就是叙事。
 *
 * ── 关于 delegate（重要，别当成 bug 去"修"）──────────────────────────
 *   delegate: true  = 挂在 document 上做事件委托，之后**动态插入**的链接也能抓到
 *   delegate: false = 只在 init() 执行的那一刻给已存在的 a[href] 直接绑定
 *
 *   两个 tab 页（index.html / novel/index.html）故意用 false，因此存在一个
 *   **已知且刻意保留**的行为差异：
 *     · 首页的「光阴目录」条目（.date-item）**有**过渡 —— 因为它在内联脚本里
 *       比 PageTransition.init() 更早被渲染进 DOM；
 *     · 书架的章节条目（.chapter-item）**没有**过渡 —— 因为 renderChapterList()
 *       在 PageTransition.init() **之后**才执行，那些链接在绑定时还不存在。
 *   这是抽取共享模块之前就有的既成行为，本轮刻意保持不变（改为 true 会让书架
 *   点目录条目突然多出 120ms 延迟 + 一层遮罩，属于可见的行为变化，需要单独决策）。
 *
 *   如果将来要让书架目录条目也有过渡：把该页改成 delegate: true 即可
 *   （委托不依赖渲染顺序）；或保持 false 但把 init() 挪到 renderChapterList()
 *   之后 —— 后者会连带改变首次加载时遮罩的时序，不推荐。
 *   章节页（js/reader.js）用 true 是被迫的：阅读页的目录/设置面板全部是运行时
 *   插入的，直接绑定抓不到。
 *
 * 依赖：无。非 ES module，挂到 window.PageTransition，供普通 <script> 引用。
 * 注意：三处引用方必须都加载本文件（sw.js 的 PRECACHE 里也有它）。
 */
(function (global) {
  'use strict';

  var FLAG = 'page-transitioning';
  var TEXT_KEY = 'page-transition-text';

  var DEFAULT_LINES = [
    '书页接住慢慢沉落的黄昏',
    '有些话还没说，故事已经往前了',
    '夕阳落下去的时候，影子会变长',
    '字句正在慢慢向你走来',
    '少年的心事还落在梧桐枝桠'
  ];

  /* 早先的「环绕叶片 + 叶片图标」已由 3D 翻书取代，相关常量一并删除 */

  /** 系统是否要求「减弱动态效果」 */
  function prefersReducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** 把相对 href 解析成站内绝对路径，用来和 location.pathname 比对 */
  function targetPath(href) {
    var a = document.createElement('a');
    a.href = href;
    return a.pathname;
  }

  /**
   * 生成遮罩内部结构：一本会翻开放大的 3D 书（封面 + 书页厚度）+ 兜底 veil + 底部小字。
   *
   * 结构参照 CodeMyUI/book-opening-animation 与 scastiel 的 3D 书：
   *   .book-stage  —— 透视舞台（perspective 在它身上，书自己只管变换）
   *   .book        —— 书的整体，负责放大
   *   .book-cover  —— 封面，绕左缘（书脊）翻开
   *   .book-pages  —— 右侧书页厚度（几层纸边），翻书时立着，放大后被内页接替
   *   .book-page   —— 翻开后露出的内页，最终铺满全屏的那张纸
   *
   * 刻意不用 preserve-3d + backface-visibility 做「正反两面」：那套在无 GPU /
   * headless 的 WebView 下背面剔除会失效，翻过去仍露出封面。这里封面用
   * rotateY + opacity 直说「翻走就消失」，内页用另一个元素接棒，任何渲染路径一致。
   */
  function buildHTML(o) {
    if (typeof o.html === 'string') return o.html;
    /* 封面用整书封面而不是缩略图：放大铺满时 thumb（144×196）会糊 */
    var cover = o.cover || '/assets/cover.webp';
    return '<div class="book-stage">' +
             '<div class="book">' +
               '<div class="book-cover"><img src="' + cover + '" alt="" /></div>' +
               '<div class="book-pages"></div>' +
               '<div class="book-page"></div>' +
             '</div>' +
           '</div>' +
           '<div class="page-transition-veil"></div>' +
           '<div class="transition-text">' + (o.initialText || '梧桐叶正落下') + '</div>';
  }

  /**
   * 读取并消费「上一页发起过过渡」的标记。
   * 只有 to 等于当前页才认；t 只做兜底（防止陈年脏数据）。
   */
  function consumeEntryFlag(ttl) {
    var raw;
    try {
      raw = sessionStorage.getItem(FLAG);
    } catch (err) {
      return false;
    }
    if (raw === null) return false;
    try { sessionStorage.removeItem(FLAG); } catch (err) { /* 忽略 */ }
    var data = null;
    try { data = JSON.parse(raw); } catch (err) { return false; }
    if (!data || !data.to || !data.t) return false;
    if (Math.abs(Date.now() - data.t) > ttl) return false;
    return data.to === global.location.pathname;
  }

  function init(options) {
    var o = options || {};
    var lines = o.lines && o.lines.length ? o.lines : DEFAULT_LINES;
    var enterHold = typeof o.enterHold === 'number' ? o.enterHold : 170;
    var enterTtl = typeof o.enterTtl === 'number' ? o.enterTtl : 8000;
    var exitDelay = typeof o.exitDelay === 'number' ? o.exitDelay : 430;
    var skipSelector = o.skipSelector || null;
    var hashScroll = !!o.hashScroll;
    var mount = o.mount || document.body;

    var ov = o.element || document.getElementById('pageTransition');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'page-transition';
      ov.id = 'pageTransition';
      ov.innerHTML = buildHTML(o);
      (mount || document.body).appendChild(ov);
    }

    /* ---------------------------------------------------------- 文案池 */
    function pickLine() {
      var line = lines[Math.floor(Math.random() * lines.length)];
      try { sessionStorage.setItem(TEXT_KEY, line); } catch (err) { /* 忽略 */ }
      return line;
    }

    function getLine() {
      var saved = null;
      try { saved = sessionStorage.getItem(TEXT_KEY); } catch (err) { /* 忽略 */ }
      if (saved) {
        try { sessionStorage.removeItem(TEXT_KEY); } catch (err) { /* 忽略 */ }
        return saved;
      }
      return lines[Math.floor(Math.random() * lines.length)];
    }

    /* ------------------------------------------------------- 遮罩控制 */
    function textEl() {
      return ov.querySelector('.transition-text');
    }

    function resetOverlay() {
      var list = document.querySelectorAll('.page-transition');
      for (var i = 0; i < list.length; i++) {
        list[i].classList.remove('active', 'flip-out', 'flip-in');
      }
    }

    /**
     * 离开当前页：中央的 3D 书翻开、放大铺满全屏，铺满时跳转。
     *
     * 起点刻意不是点击的条目（曾按 FLIP 从 sourceEl 的 rect 起飞，但书架/目录
     * 是文字列表，从一行字上长出封面很怪）。现在书固定立在屏幕中央，
     * 「翻开 → 放大」本身就是叙事，sourceEl 只留给将来按书籍封面定制时用。
     */
    function start(href, sourceEl) {
      if (!ov || prefersReducedMotion()) {
        global.location.href = href;
        return;
      }
      /* 先摘干净再上类：同一元素连点两次时，不重启动画会停在上一次的末态 */
      ov.classList.remove('active', 'flip-out', 'flip-in');
      void ov.offsetWidth;

      /* 书本从中央立起：起点变换写在这里（动画 keyframes 只描述翻开/放大的相对
         过程），封面默认 opacity:0，由 flip-out 露脸 —— 不靠类名「藏」它。 */
      var book = ov.querySelector('.book');
      if (book) {
        book.style.transform = '';
        void book.offsetWidth;
      }

      ov.classList.add('active', 'flip-out');
      var t = textEl();
      if (t) t.textContent = pickLine();
      try {
        sessionStorage.setItem(FLAG, JSON.stringify({ t: Date.now(), to: targetPath(href) }));
      } catch (err) { /* 忽略 */ }
      setTimeout(function () { global.location.href = href; }, exitDelay);
    }

    /* -------------------------------------------------------- 入场 */
    if (consumeEntryFlag(enterTtl) && !prefersReducedMotion()) {
      requestAnimationFrame(function () {
        ov.classList.add('active', 'flip-in');
        if (o.entryText === 'random') {
          var t = textEl();
          if (t) t.textContent = getLine();
        }
        /* 第二帧再起算停留：首帧可能被弱 CPU 推迟，早算会导致没翻完就退场 */
        requestAnimationFrame(function () {
          setTimeout(function () {
            ov.classList.remove('active', 'flip-in');
          }, enterHold);
        });
      });
    }

    /* ------------------------------------------------------ 安全网 */
    global.addEventListener('pageshow', function () { setTimeout(resetOverlay, 700); });
    global.addEventListener('focus', function () { setTimeout(resetOverlay, 700); });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) setTimeout(resetOverlay, 700);
    });

    /* ------------------------------------------------------ 点击接管 */
    /**
     * @return {boolean} true = 已接管（已 preventDefault 并起过渡）
     */
    function onClick(e, link) {
      if (!link) return false;
      var href = link.getAttribute('href');
      if (!href) return false;
      if (href.indexOf('javascript') === 0) return false;
      if (link.hasAttribute('onclick')) return false;
      if (link.target === '_blank') return false;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;

      /* 纯锚点：不接管 */
      if (href.charAt(0) === '#') {
        if (hashScroll) {
          var same = document.getElementById(href.slice(1));
          if (same) same.scrollIntoView({ behavior: 'smooth' });
        }
        return false;
      }

      /* 「同页 + #锚点」：滚过去，不跳转 */
      var hashIdx = href.indexOf('#');
      if (hashScroll && hashIdx > 0) {
        var base = href.substring(0, hashIdx);
        var here = global.location.pathname.split('/').pop() || '';
        if (base === here) {
          var target = document.getElementById(href.slice(hashIdx + 1));
          if (target) target.scrollIntoView({ behavior: 'smooth' });
          return false;
        }
      }

      /* tab 栏：同层级切换，不接管 → 走浏览器默认跳转 */
      if (skipSelector && link.closest && link.closest(skipSelector)) return false;

      e.preventDefault();
      start(href, link);   /* 把点击的链接传进去，hero 从它身上放大 */
      return true;
    }

    if (o.delegate) {
      document.addEventListener('click', function (e) {
        var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (link) onClick(e, link);
      });
    } else {
      /* 直接绑定：与抽取前的行为逐一对应（只在 init 执行的那一刻给已存在的链接挂监听，
         之后由脚本动态插入的链接不会获得过渡 —— 这是既有行为，刻意保留） */
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) {
        (function (link) {
          link.addEventListener('click', function (e) { onClick(e, link); });
        })(links[i]);
      }
    }

    return {
      start: start,
      reset: resetOverlay,
      element: ov,
      consumeEntryFlag: function () { return consumeEntryFlag(enterTtl); }
    };
  }

  global.PageTransition = {
    init: init,
    prefersReducedMotion: prefersReducedMotion,
    DEFAULT_LINES: DEFAULT_LINES
  };
})(window);
