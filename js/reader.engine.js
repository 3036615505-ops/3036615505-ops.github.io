// @ts-check
/**
 * 阅读引擎 —— 位置、滚动、计时、自动滚屏
 *
 * 这里只做「和排版打交道」的事：把滚动位置换算成段落 + 比例、改版式后把人
 * 放回同一句、把阅读时间记下来。所有界面更新都通过顶部 shim 交给 ui.js，
 * 这个文件不直接碰面板和样式。
 *
 * 依赖：reader.store.js（在前面）、reader.ui.js（在后面，运行时才取）
 */
(function() {
  'use strict';
  var LY = window.LY || (/** @type {any} */ (window.LY = {}));

  /* ---- 对 store 的依赖 ---- */
  /* 换章不换页会改写当前章节 id，所以每次现取，不在启动时快照 */
  function chapterId() { return LY.store.chapterId; }
  function readAnchor() { return LY.store.readAnchor(); }
  function writeAnchor(a) { return LY.store.writeAnchor(a); }
  function mergeFootprints(fn) { return LY.store.mergeFootprints(fn); }
  function getTodayToken() { return LY.store.getTodayToken(); }
  function trimDayTime(m) { return LY.store.trimDayTime(m); }

  /* ---- 对 ui 的依赖（ui.js 在本文件之后加载，调用时才解析）---- */
  function refreshProgressControls(pct) { if (LY.ui && LY.ui.syncProgress) LY.ui.syncProgress(pct); }
  function barsVisible() { return !!(LY.ui && LY.ui.isBarsVisible && LY.ui.isBarsVisible()); }
  function showToast(text) { if (LY.ui && LY.ui.toast) LY.ui.toast(text); }
  function hideBars() { if (LY.ui && LY.ui.hideBars) LY.ui.hideBars(); }
  function startAutoClose() { if (LY.ui && LY.ui.startAutoClose) LY.ui.startAutoClose(); }
  function stopAutoClose() { if (LY.ui && LY.ui.stopAutoClose) LY.ui.stopAutoClose(); }
  function closeSettings() { if (LY.ui && LY.ui.closeSettings) LY.ui.closeSettings(); }

  function clampProgress(pct) {
    pct = parseInt(pct, 10);
    if (isNaN(pct)) pct = 0;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    return pct;
  }


  /* ===== 章节块 =====
     无限流把多章接进同一条滚动，于是「当前章」不再等于「当前页面」。
     判断依据和锚点共用一条探测线（视口上方 15%）：探测线落在哪一块，
     那一块就是读者正在读的章。单块时它等于整页，与旧算法完全等价。 */

  function blocks() {
    return document.querySelectorAll('.chapter-block');
  }


  /** @returns {Element|null} */
  function currentBlock() {
    var list = blocks();
    if (!list.length) return null;
    var probeY = window.innerHeight * PROBE_RATIO;
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].getBoundingClientRect().top <= probeY) return list[i];
    }
    return list[0];
  }


  function getCurrentProgressPct() {
    var block = currentBlock();
    if (!block) return 0;
    var rect = block.getBoundingClientRect();
    var span = rect.height - window.innerHeight;
    /* 一屏就能读完的短章：滚过它的顶端就算读完 */
    if (span <= 0) return rect.top < 0 ? 100 : 0;
    return clampProgress(Math.round((-rect.top / span) * 100));
  }


  function scrollToProgress(pct) {
    pct = clampProgress(pct);
    var block = currentBlock();
    if (!block) return;
    var rect = block.getBoundingClientRect();
    var top = window.scrollY + rect.top;
    var span = rect.height - window.innerHeight;
    window.scrollTo({ top: span <= 0 ? top : top + (pct / 100) * span, behavior: 'auto' });
  }


  /* ===== 位置锚点 =====
     只存百分比时，改字号 / 行距 / 宽度 / 字体都会让整章重新排版，
     「47% 对应的像素位置」和「47% 对应的那句话」就分家了 —— 回来会偏半屏。
     所以额外存「第几段 + 段内比例」：恢复时按段落定位，百分比只作兜底。
     段落取 .chapter-content 里的 <p>，与正文结构一一对应，改版式不影响序号。 */

  var PROBE_RATIO = 0.15;   /* 取视口上方 15% 处的段落做锚点，避开固定章节名条 */

  var userScrolled = false; /* 用户自己滚过之后，就不再强行把我们记的位置按回去 */

  var restoring = false;    /* 恢复过程中不要写盘：否则会用错位的中间态覆盖好锚点 */


  function contentParagraphs() {
    var block = currentBlock();
    var article = block ? block.querySelector('.chapter-content') : null;
    /* 没有 .chapter-block 的旧页面 / 非阅读页：退回整页，行为与以前一致 */
    if (!article) article = document.querySelector('.chapter-content');
    if (!article) return [];
    return article.querySelectorAll('p');
  }


  /** @returns {Anchor|null} */
  function getCurrentAnchor() {
    var paras = contentParagraphs();
    if (!paras.length) return null;
    var probeY = window.innerHeight * PROBE_RATIO;
    var idx = 0;
    var off = 0;
    var hit = false;
    for (var i = 0; i < paras.length; i++) {
      var r = paras[i].getBoundingClientRect();
      if (r.bottom > probeY) {
        idx = i;
        off = r.height > 0 ? Math.min(1, Math.max(0, (probeY - r.top) / r.height)) : 0;
        hit = true;
        break;
      }
    }
    /* 探测线已经在所有段落之下（章末留白很长时）：锚到最后一段末尾 */
    if (!hit) { idx = paras.length - 1; off = 1; }
    return { p: getCurrentProgressPct(), i: idx, o: Math.round(off * 1000) / 1000 };
  }


  /** @param {Anchor|null} anchor @returns {boolean} */
  function scrollToAnchor(anchor) {
    if (!anchor || typeof anchor.i !== 'number' || anchor.i < 0) return false;
    var paras = contentParagraphs();
    if (!paras.length || !paras[anchor.i]) return false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return false;
    var r = paras[anchor.i].getBoundingClientRect();
    var probeY = window.innerHeight * PROBE_RATIO;
    var target = window.scrollY + r.top + (anchor.o || 0) * r.height - probeY;
    window.scrollTo({ top: Math.max(0, Math.min(max, target)), behavior: 'auto' });
    return true;
  }


  /* ===== READING PROGRESS ===== */

  var lastProgressSave = 0;

  /* 上一帧算出的比例。跨章落盘要用它而不是现算：现算的那一刻，
     探测线已经在新章里了，算出来的是新章的 0。 */
  var lastPct = 0;

  /* 刚跨进下一章：这一帧的 0 不是「读者回到开头」，是这一章还没开始读。
     不挡的话，每接一章就把那一章上次读到的地方抹成 0。 */
  var blockEntryHold = false;

  /** @param {number} [pct] 不传就按当前滚动位置算 @param {boolean} [force] 跳过节流与恢复期保护 @returns {void} */
  function saveProgress(pct, force) {
    if (pct === undefined) pct = getCurrentProgressPct();
    pct = clampProgress(pct);
    lastPct = pct;
    refreshProgressControls(pct);
    if (blockEntryHold) {
      if (pct <= 0) return;
      blockEntryHold = false;
      force = true;   /* 刚跨章的第一笔要立刻落盘，别被 320ms 节流吞掉 */
    }
    // localStorage 是同步磁盘写入：滚动时每帧都写会掉帧，节流到约 3 次/秒。
    // 页面隐藏/卸载时传 force=true 补最后一把，保证离开前进度是准的。
    var now = Date.now();
    if (!force && now - lastProgressSave < 320) return;
    /* 恢复位置的过程中不许写盘 —— 连 force 也不行。
       场景：打开章节的瞬间点了返回，pagehide 会强制保存，而此时页面还停在
       顶部（恢复还没落位），一写就把「读到 88%」覆盖成 0。用户自己滚过就放行。 */
    if (restoring && !userScrolled) return;

    /* 再兜一层：没滚动过就读到 0 —— 这不是「读者回到开头」，是页面还没恢复
       或者刚要卸载。典型场景是「导入备份 → 自动重载」，旧页面的 pagehide 会
       抢先写一个 0，把刚导入的进度抹掉。只有用户真的滚到顶部才允许写 0。 */
    if (!userScrolled && pct === 0 && clampProgress(localStorage.getItem('reader-pos-' + chapterId())) > 0) return;
    lastProgressSave = now;
    localStorage.setItem('reader-pos-' + chapterId(), String(pct));
    /* 同时存锚点：百分比用于显示与兜底，段落序号用于真正定位 */
    var anchor = getCurrentAnchor();
    if (anchor) {
      anchor.p = pct;
      writeAnchor(anchor);
    }
    if (pct >= 95) {
      localStorage.setItem('reader-done-' + chapterId(), '1');
    } else {
      localStorage.removeItem('reader-done-' + chapterId());
    }
  }

  /* 恢复位置：首帧 → 120ms → 600ms → 字体就绪 → load 各试一次，
     并在随后几秒里盯着页面高度：懒加载图片撑开正文会把位置顶跑，
     高度一变就按锚点重新落位。只要用户自己滚过，全部让位。
     为什么不一次到位：正文高度取决于字体度量与图片，字体没就位时算出来的
     段落位置会偏低，锚点会把人送到错的地方。 */

  /* ===== 跨章：探测线换块了就把「当前章」换掉 =====
     顺序不能颠倒 —— 先把上一章按上一帧的位置落盘（此时 chapterId 还是旧的），
     再换 id，再让界面去同步标题 / URL / 顶栏。反了就是上一章的进度被写成新章的值。 */
  function syncBlockChapter() {
    var block = currentBlock();
    if (!block) return;
    var file = block.getAttribute('data-file');
    if (!file || file === LY.store.getCurrentFileName()) return;

    saveProgress(lastPct, true);
    LY.store.setChapterId(file);
    blockEntryHold = true;
    if (LY.ui && LY.ui.onChapterEntered) LY.ui.onChapterEntered(file);
  }


  function restoreProgress() {
    var pct = clampProgress(localStorage.getItem('reader-pos-' + chapterId()));
    /* 锚点这条路出问题时的退路：只按百分比恢复（会偏，但能读） */
    var anchor = LY.flags.isOn('anchorRestore') ? readAnchor() : null;
    refreshProgressControls(pct);
    if (!(pct > 0 && pct < 95)) return;

    var observer = null;
    var finished = false;

    function apply() {
      if (userScrolled) { finish(); return; }
      if (anchor && scrollToAnchor(anchor)) return;
      scrollToProgress(pct);
    }
    function finish() {
      if (finished) return;
      finished = true;
      if (observer) { observer.disconnect(); observer = null; }
      restoring = false;
    }

    restoring = true;
    apply();
    setTimeout(apply, 120);
    setTimeout(apply, 600);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function() { apply(); }, function() {});
    }
    window.addEventListener('load', apply, { once: true });

    /* 懒加载图片的坑：视口在章首时，位于恢复点**上方**的图片根本没被加载，
       一跳过去它们才开始下载，每张撑开一点就把人往下推 —— 只靠定时器永远追不上。
       所以直接盯 scrollHeight，变化超过 4px 就重新落位。 */
    if (window.ResizeObserver) {
      var lastH = 0;
      observer = new ResizeObserver(function() {
        var h = document.documentElement.scrollHeight;
        if (Math.abs(h - lastH) < 4) return;
        lastH = h;
        apply();
      });
      observer.observe(document.documentElement);
    }
    /* 兜底收尾：网络慢也给足 5 秒；之后不再干预 */
    setTimeout(finish, 5000);
  }


  function initReadingProgress() {
    refreshProgressControls(clampProgress(localStorage.getItem('reader-pos-' + chapterId())));

    var progressBar = document.querySelector('.reader-progress-bar');
    if (progressBar) {
      var dragging = false;

      function updateFromPointer(e) {
        var rect = progressBar.getBoundingClientRect();
        var pct = clampProgress(Math.round(((e.clientX - rect.left) / rect.width) * 100));
        markUserScroll();
        scrollToProgress(pct);
        saveProgress(pct);
      }

      progressBar.addEventListener('pointerdown', function(/** @type {PointerEvent} */ e) {
        e.preventDefault();
        dragging = true;
        stopAutoClose();
        if (progressBar.setPointerCapture) progressBar.setPointerCapture(e.pointerId);
        progressBar.classList.add('dragging');
        updateFromPointer(e);
      });

      progressBar.addEventListener('pointermove', function(/** @type {PointerEvent} */ e) {
        if (!dragging) return;
        e.preventDefault();
        updateFromPointer(e);
      });

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        progressBar.classList.remove('dragging');
        if (progressBar.releasePointerCapture) progressBar.releasePointerCapture(e.pointerId);
        if (barsVisible()) startAutoClose();
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
        syncBlockChapter();
        saveProgress();
      });
    }, { passive: true });
    window.addEventListener('beforeunload', function() { saveProgress(undefined, true); });
    window.addEventListener('pagehide', function() { saveProgress(undefined, true); });
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') saveProgress(undefined, true);
    });

    /* 「用户自己动了」的判定：只有真实手势才算，脚本滚动（恢复位置、自动滚屏）不算。
       一旦用户动手，后续的定时恢复就全部让位，不能把人拽回去。 */
    ['wheel', 'touchmove'].forEach(function(type) {
      window.addEventListener(type, markUserScroll, { passive: true });
    });
    document.addEventListener('keydown', function(e) {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].indexOf(e.key) >= 0) {
        markUserScroll();
      }
    });
  }


  function markUserScroll() {
    userScrolled = true;
    restoring = false;
  }


  /* 换章不换页时用：新章还没被「用户自己滚过」，恢复逻辑应该重新接管 */
  function resetUserScroll() {
    userScrolled = false;
    restoring = false;
  }


  /* ===== 阅读时长 =====
     只在阅读页计时，且只算「页面可见」的时间：切后台、锁屏期间不计。
     15s 打一次点，攒满 60s 才落盘 —— 即每分钟最多一次同步写盘，
     和滚动写进度错开，不会在滚动时卡帧。 */

  var readingTime = { last: 0, pending: 0, timer: 0 };


  function initReadingTime() {
    readingTime.last = Date.now();
    readingTime.timer = setInterval(tickReadingTime, 15000);
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) { tickReadingTime(); flushReadingTime(); }
      else { readingTime.last = Date.now(); }
    });
    window.addEventListener('pagehide', function() { tickReadingTime(); flushReadingTime(); });
  }


  function tickReadingTime() {
    var now = Date.now();
    var delta = now - readingTime.last;
    readingTime.last = now;
    /* 后台/休眠回来会一次跳出几分钟，超过 60s 的间隔直接丢弃 */
    if (document.hidden || delta <= 0 || delta > 60000) return;
    readingTime.pending += Math.round(delta / 1000);
    if (readingTime.pending >= 60) flushReadingTime();
  }


  function flushReadingTime() {
    var sec = readingTime.pending;
    readingTime.pending = 0;
    if (sec < 5) return;  /* 随手点开就走的不算读过 */
    mergeFootprints(function(data) {
      data.time += sec;
      var day = getTodayToken();
      data.dayTime[day] = (data.dayTime[day] || 0) + sec;
      trimDayTime(data.dayTime);
      return data;
    });
  }

  /* 只留最近 180 天：老数据对「连续天数」没用，但会把 localStorage 撑大 */

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
    if (y >= max - 1) {
      /* 无限流：章末不是尽头。先让界面续下一章，续上了就继续滚；
         确实没有下一章才停。 */
      if (LY.ui && LY.ui.ensureNext && LY.ui.ensureNext()) {
        autoScroll.pos = y;
        autoScroll.lastT = 0;
        autoScroll.raf = requestAnimationFrame(autoScrollStep);
        return;
      }
      stopAutoScroll(true);
      return;
    }
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
    if (lv) lv.textContent = String(autoScroll.level);
    var pp = pill.querySelector('.auto-pp');
    if (pp) pp.textContent = autoScroll.paused ? '\u25B6' : '\u275A\u275A';
  }


  function ensureAutoPill() {
    if (document.getElementById('autoScrollPill')) return;
    var dom = LY.dom;
    var pill = dom.el('div', { id: 'autoScrollPill' }, [
      dom.el('button', { type: 'button', 'data-act': 'slower', 'aria-label': '减速' }, '\u2212'),
      dom.el('span', { class: 'auto-level' }, '3'),
      dom.el('button', { type: 'button', 'data-act': 'faster', 'aria-label': '加速' }, '\uFF0B'),
      dom.el('button', { type: 'button', class: 'auto-pp', 'data-act': 'pause', 'aria-label': '暂停或继续' }, '\u275A\u275A'),
      dom.el('button', { type: 'button', class: 'auto-stop', 'data-act': 'stop', 'aria-label': '停止' }, '\u2715')
    ]);
    document.body.appendChild(pill);
    pill.addEventListener('click', function(e) {
      var target = /** @type {Element} */ (e.target);
      var b = target.closest ? target.closest('button') : null;
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
    } else if (!LY.flags.isOn('autoscroll')) {
      /* 远程关掉了：给一句人话，别让用户以为按钮坏了 */
      showToast('自动滚屏暂时关闭');
    } else {
      startAutoScroll();
      if (typeof closeSettings === 'function') closeSettings();
      if (barsVisible()) hideBars(); /* 从工具栏开启 → 收起工具栏让出屏幕 */
      showToast('自动滚动开始，点右下角 ✕ 可停止');
    }
  };

  LY.engine = {
    clampProgress: clampProgress,
    currentBlock: currentBlock,
    blocks: blocks,
    getCurrentProgressPct: getCurrentProgressPct,
    scrollToProgress: scrollToProgress,
    getCurrentAnchor: getCurrentAnchor,
    scrollToAnchor: scrollToAnchor,
    saveProgress: saveProgress,
    restoreProgress: restoreProgress,
    markUserScroll: markUserScroll,
    resetUserScroll: resetUserScroll,
    initReadingProgress: initReadingProgress,
    initReadingTime: initReadingTime,
    autoScroll: autoScroll
  };
})();
