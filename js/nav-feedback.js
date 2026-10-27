/*
 * js/nav-feedback.js — 站内跳转的即时反馈（顶部 2px 细线）
 *
 * ── 为什么需要它 ────────────────────────────────────────────────
 * 用户要求去掉「点章节 → 进阅读页」的过渡动画（js/transition.js 已全站停用），
 * 动画一去掉就暴露出真实等待：4G 节流实测（390×844，首页点 .date-item → 章节页）
 *   TTFB 524ms → 首绘 884ms
 * 这段时间屏幕上**什么都没有发生**（旧页面静止、没有遮罩、卡片也没有按下态），
 * 读者的感受是「点空了 / 卡住了」。用户原话就是「会出现一个比较长的空窗期」。
 *
 * ── 做什么 ─────────────────────────────────────────────────────
 * 按下的那一刻（pointerdown / touchstart，早于 click 约 50~100ms）就在旧页面上
 * 点亮一条 2px 细线，明确「正在打开」。它：
 *   · 不 preventDefault、不 delay —— 导航时序一个字都不改（这条是硬约束，
 *     过渡动画当初就是死在「为了动画而延迟跳转」上）；
 *   · pointer-events: none，不遮内容、不拦点击；
 *   · 60ms 延迟淡入：命中缓存的那种跳转（约 100ms）根本看不到它，不会闪；
 *   · 新文档一解析，旧文档整体被替换，线自然消失，无需收尾。
 *   · 兜底：万一没跳成（离线 / 被拦 / 用户松手中断），6 秒后自己收起。
 *
 * ── 边界（不处理的链接）─────────────────────────────────────────
 *   · 外链与自定义协议（mqq://、weixin://、mailto:、tel: …）
 *   · target 不是 _self（新窗口）、带 download 的
 *   · 纯锚点（#foo）与 javascript:
 *   · 同页 hash 滚动（reader 的「回目录」是普通 a[href]，要处理，故只排除纯 #）
 */

(function () {
  'use strict';

  var BAR_ID = 'navOpeningBar';
  var HIDE_AFTER = 6000;

  var barEl = null;
  var hideTimer = 0;

  function ensureBar() {
    if (barEl && barEl.parentNode) return barEl;
    barEl = document.getElementById(BAR_ID);
    if (!barEl) {
      barEl = document.createElement('div');
      barEl.id = BAR_ID;
      barEl.className = 'nav-opening-bar';
      barEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(barEl);
    }
    return barEl;
  }

  function show() {
    var el = ensureBar();
    el.classList.add('is-on');
    clearTimeout(hideTimer);
    /* 跳成功了旧文档会被替换，这个定时器根本不会执行；它只为「没跳成」兜底 */
    hideTimer = setTimeout(hide, HIDE_AFTER);
  }

  function hide() {
    clearTimeout(hideTimer);
    if (barEl) barEl.classList.remove('is-on');
  }

  /* 只认「真的会跳走」的链接 */
  function shouldFollow(a) {
    if (!a || !a.getAttribute) return false;
    if (a.target && a.target !== '_self') return false;
    if (a.hasAttribute('download')) return false;
    var href = a.getAttribute('href');
    if (!href) return false;
    if (href.charAt(0) === '#') return false;                 /* 纯锚点 */
    if (/^javascript:/i.test(href)) return false;
    /* 有协议头的：只放行 http/https（同源或站外都算跳转），其余是唤端 */
    var m = /^([a-z][a-z0-9+.-]*):/i.exec(href);
    if (m && !/^https?$/i.test(m[1])) return false;
    return true;
  }

  function onPress(e) {
    var t = e.target;
    var a = t && t.closest ? t.closest('a[href]') : null;
    if (shouldFollow(a)) show();
  }

  /* pointerdown 覆盖鼠标与触摸；老 WebView 只有 touchstart，两条都挂（show 幂等） */
  document.addEventListener('pointerdown', onPress, true);
  document.addEventListener('touchstart', onPress, { capture: true, passive: true });

  /* 从 bfcache 回来：上一程留下的线要收掉 */
  window.addEventListener('pageshow', hide);
  /* 松手后如果既没跳走也没触发 click（拖拽取消），2 秒后收线 */
  document.addEventListener('pointerup', function () {
    setTimeout(function () {
      if (barEl && barEl.classList.contains('is-on') && document.visibilityState === 'visible') {
        /* 只有确实没有发生跳转时才收（click 会紧跟着发生，这里再等一拍） */
        setTimeout(hide, 800);
      }
    }, 200);
  }, true);

  window.LY = window.LY || {};
  window.LY.navFeedback = { show: show, hide: hide };
})();
