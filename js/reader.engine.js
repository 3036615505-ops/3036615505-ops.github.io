// @ts-check
/* 阅读引擎 —— 位置、滚动、计时、自动滚屏
   设计说明、历史与踩坑记录见 _design/notes/reader.engine.js.md（原文按行号归档）。 */
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

  var PROBE_RATIO = 0.15;   /* 取视口上方 15% 处的段落做锚点，避开固定章节名条 */

  var LANDING_RATIO = 1 / 3;

  var userScrolled = false; /* 用户自己滚过之后，就不再强行把我们记的位置按回去 */

  var restoring = false;    /* 恢复过程中不要写盘：否则会用错位的中间态覆盖好锚点 */

  function paragraphsIn(block) {
    if (!block) return [];
    var article = block.querySelector ? block.querySelector('.chapter-content') : null;
    if (!article) return [];
    return article.querySelectorAll('p');
  }

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

  function scrollToAnchorIn(block, anchor, lineRatio) {
    if (!anchor || typeof anchor.i !== 'number' || anchor.i < 0) return false;
    var paras = paragraphsIn(block || document);
    if (!paras.length || !paras[anchor.i]) return false;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (max <= 0) return false;
    var r = paras[anchor.i].getBoundingClientRect();
    var ratio = (typeof lineRatio === 'number' && lineRatio >= 0 && lineRatio <= 1) ? lineRatio : PROBE_RATIO;
    var target = window.scrollY + r.top + (anchor.o || 0) * r.height - window.innerHeight * ratio;
    window.scrollTo({ top: Math.max(0, Math.min(max, target)), behavior: 'auto' });
    return true;
  }

  /* 第二参数是「探测线比率」：不传时行为与旧版逐字等价（默认 PROBE_RATIO）。
     搜索跳转传 LANDING_RATIO，位置记忆那条路径一个字符都不用改。 */
  /** @param {Anchor|null} anchor @param {number} [lineRatio] @returns {boolean} */
  function scrollToAnchor(anchor, lineRatio) {
    return scrollToAnchorIn(currentBlock() || document, anchor, lineRatio);
  }

  var landing = null;

  /** @param {Anchor} anchor @param {number} [ratio] @returns {void} */
  function setLanding(anchor, ratio) {
    if (!anchor || typeof anchor.i !== 'number' || anchor.i < 0) { landing = null; return; }
    landing = {
      anchor: { p: typeof anchor.p === 'number' ? anchor.p : 0, i: anchor.i, o: typeof anchor.o === 'number' ? anchor.o : 0 },
      ratio: (typeof ratio === 'number' && ratio >= 0 && ratio <= 1) ? ratio : LANDING_RATIO
    };
  }

  function commitLanding() {
    markUserScroll();
    saveProgress(undefined, true);
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
    if (restoring && !userScrolled) return;

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
    /* 落位指令是一次性的：取走即清。有它时**不受**「没读过就返回」的限制 ——
       搜索跳过去的章可能一次都没读过（pct === 0），那道闸门会把落点吞掉。 */
    var wanted = landing;
    landing = null;

    var pct = clampProgress(localStorage.getItem('reader-pos-' + chapterId()));
    /* 锚点这条路出问题时的退路：只按百分比恢复（会偏，但能读） */
    var anchor = wanted ? wanted.anchor : (LY.flags.isOn('anchorRestore') ? readAnchor() : null);
    refreshProgressControls(pct);
    if (!wanted && !(pct > 0 && pct < 95)) return;

    var observer = null;
    var finished = false;
    var landingApplied = false;

    function apply() {
      if (userScrolled) { finish(); return; }
      if (anchor && scrollToAnchor(anchor, wanted ? wanted.ratio : undefined)) {
        if (wanted) landingApplied = true;
        return;
      }
      /* 有落位指令时不退回百分比：否则等于把读者送回旧位置 */
      if (!wanted) scrollToProgress(pct);
    }
    function finish() {
      if (finished) return;
      finished = true;
      if (observer) { observer.disconnect(); observer = null; }
      restoring = false;
      /* 只在「真的落成了、且读者没有自己动过」时把位置写成进度。
         两个条件缺一不可，否则会把手动滚到的位置写成落点（见 HANDOVER 坑 2）。 */
      if (wanted && landingApplied && !userScrolled) commitLanding();
    }

    restoring = true;
    apply();
    setTimeout(apply, 120);
    setTimeout(apply, 600);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function() { apply(); }, function() {});
    }
    window.addEventListener('load', apply, { once: true });
    /* 搜索落位是「一次明确的目的地」，不需要守到 5 秒：900ms 后收尾并落盘，
       让进度条 / 状态条立刻跟上（再晚读者会看到页码停在上一个位置）。 */
    if (wanted) setTimeout(finish, 900);

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
    scrollToAnchorIn: scrollToAnchorIn,
    setLanding: setLanding,
    commitLanding: commitLanding,
    saveProgress: saveProgress,
    restoreProgress: restoreProgress,
    markUserScroll: markUserScroll,
    resetUserScroll: resetUserScroll,
    initReadingProgress: initReadingProgress,
    initReadingTime: initReadingTime,
    pauseAutoScroll: pauseAutoScroll,
    autoScroll: autoScroll
  };
})();
