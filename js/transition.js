/**
 * js/transition.js — 全站「页面切换过渡遮罩」的唯一实现
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
 *     leaves: 5,           // 环绕叶片数量；0 = 不要叶片也不要图标（首页的素遮罩）
 *     icon: true,          // 是否画中间那片叶子（SVG）
 *     initialText: '…',    // 新建遮罩时的初始文案
 *     entryText: 'random', // 入场时是否换成随机文案（章节页/书架用）
 *     skipSelector: '.tab-bar',  // 命中其内的链接直接走浏览器默认跳转
 *     mount: el,           // 遮罩挂载点（默认 document.body）
 *     delegate: false,     // 事件委托 vs. 初始化时直接绑定，详见下方说明
 *     hashScroll: false,   // 同页锚点链接改为平滑滚动、不触发过渡（章节页用）
 *     exitDelay: 120,      // 离开时先让叶子露一下再跳转
 *     enterHold: 200,
 *     enterTtl: 8000
 *   });
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
    '风从走廊尽头吹过来',
    '有些话还没说，故事已经往前了',
    '夕阳落下去的时候，影子会变长',
    '下一页有人会抬头看你一眼',
    '梧桐影子轻轻翻过一页'
  ];

  /* 环绕叶片的配色顺序，与 .transition-leaves .leaf 的既有样式一一对应 */
  var LEAF_VARIANTS = ['gold', 'green', 'brown', 'gold soft', 'green soft'];

  var ICON_SVG =
    '<svg viewBox="0 0 40 40" fill="none" width="40" height="40">' +
      '<path class="leaf-path" d="M20 4c0 0-8 4-10 12s4 16 10 20c6-4 12-12 10-20S20 4 20 4z" stroke="var(--accent)" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
      '<path class="leaf-vein" d="M20 8v24M20 14l-4 4M20 14l4 4M20 20l-5 3M20 20l5 3" stroke="var(--accent)" stroke-width="0.8" opacity="0.5" stroke-linecap="round"/>' +
    '</svg>';

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

  /** 生成遮罩内部结构：叶片数量/图标/初始文案都可配 */
  function buildHTML(o) {
    if (typeof o.html === 'string') return o.html;
    var count = (o.leaves === 0 || o.leaves === false) ? 0 : (typeof o.leaves === 'number' ? o.leaves : 5);
    var leaves = '';
    for (var i = 0; i < count; i++) {
      leaves += '<span class="leaf ' + LEAF_VARIANTS[i % LEAF_VARIANTS.length] + '"></span>';
    }
    var html = '<div class="transition-inner">';
    if (count > 0) html += '<div class="transition-leaves">' + leaves + '</div>';
    if (count > 0 && o.icon !== false) html += ICON_SVG;
    html += '<div class="transition-text">' + (o.initialText || '梧桐叶正落下') + '</div>';
    html += '</div>';
    return html;
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
    var enterHold = typeof o.enterHold === 'number' ? o.enterHold : 200;
    var enterTtl = typeof o.enterTtl === 'number' ? o.enterTtl : 8000;
    var exitDelay = typeof o.exitDelay === 'number' ? o.exitDelay : 120;
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
      var list = document.querySelectorAll('.page-transition.active');
      for (var i = 0; i < list.length; i++) list[i].classList.remove('active');
    }

    /** 离开当前页：露一下叶子再跳 */
    function start(href) {
      if (!ov || prefersReducedMotion()) {
        global.location.href = href;
        return;
      }
      ov.classList.add('active');
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
        ov.classList.add('active');
        if (o.entryText === 'random') {
          var t = textEl();
          if (t) t.textContent = getLine();
        }
        /* 第二帧再起算停留：首帧可能被弱 CPU 推迟，早算会导致没淡满就退场 */
        requestAnimationFrame(function () {
          setTimeout(function () { ov.classList.remove('active'); }, enterHold);
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
      start(href);
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
