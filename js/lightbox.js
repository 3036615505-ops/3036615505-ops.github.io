/**
 * js/lightbox.js — 同学录立绘灯箱
 *
 * 功能：人物卡里的真实立绘可点击 → 全屏查看；双击在 1x↔2.5x 间切换、双指捏合
 *       支持 1x–3x 连续缩放；缩放后可拖动平移；点遮罩 / 关闭按钮 / Esc 关闭，
 *       三种方式都走同一套 0.25s 淡出（去掉 .visible 即由 CSS 过渡完成）。
 *
 * 设计约束（来自本轮需求，改动前先读这几条）：
 *   1. 入口必须是 <button type="button" data-lightbox-src data-lightbox-name>。
 *      不能用 <a href>：js/transition.js 会接管 a[href] 点击并先播放 120ms 页面
 *      切换遮罩，表现为「打开灯箱却先播一段叶子动画」。按钮没有 href，天然不在
 *      它的接管范围内（它只 query a[href]）。
 *   2. 弹层复用 css/style.css 的通用基建：.modal-overlay / .modal-backdrop /
 *      .modal-close 与 .visible 开关、z-index 400（高于 tab-bar 的 100，低于
 *      .page-transition 的 9999 —— 后者 pointer-events 永久为 none，不冲突）。
 *      刻意不复用 .modal-panel：那是 370px 白底圆角面板，灯箱要的是全屏舞台，
 *      硬套会把立绘关进小卡片里。
 *   3. 姓氏占位卡（.char-photo.initial）没有 data-lightbox-src，点不到，
 *      也不加任何可点样式 —— 「点了没反应」比「看起来不能点」更不容易误解。
 *   4. 初始显示尺寸 = min(适配合适, 原图像素尺寸)，见 measure() 注释：
 *      512×512 源图铺满手机屏需要约 1.5~2 倍拉伸，会发糊；宁可留边也不拉伸。
 *   5. 无常驻动画：打开/关闭各一次 0.25s 过渡、双击/回弹一次 0.3s transform；
 *      捏合与拖动期间取消过渡保证 1:1 跟手。
 *
 * 依赖：无。非 ES module，普通 <script> 引入（ES5 写法，与 reader.js 一致，
 * 照顾老 WebView）。挂 window.PortraitLightbox，供调试与壳调用。
 */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */
  var MIN_SCALE = 1;            // 最小缩放：始终不小于「初始显示尺寸」
  var MAX_SCALE = 3;            // 捏合 / 滚轮上限
  var DOUBLE_TAP_SCALE = 2.5;   // 双击目标档位
  var DOUBLE_TAP_SLOP_MS = 300; // 两次点击算「双击」的时间窗
  var DOUBLE_TAP_SLOP_PX = 36;  // 两次点击算「双击」的位移容差
  var TAP_SLOP_PX = 12;         // 按下后位移超过它就不算「点击」
  var PINCH_TAP_GUARD_MS = 400; // 捏合结束后一段时间内忽略单击（防误触双击）
  var SMOOTH_MS = 300;          // 与 CSS .lightbox-image.smooth 的 transition 时长一致
  var RESIZE_DEBOUNCE_MS = 180; // 横竖屏切换时重新度量 + 复位的去抖

  /* ---------------------------------------------------------------- 状态 */
  var overlay = null;
  var backdrop = null;
  var closeBtn = null;
  var frame = null;
  var image = null;
  var nameEl = null;

  var state = { open: false, scale: 1, tx: 0, ty: 0 };
  var base = { w: 0, h: 0 };        // 初始显示尺寸（CSS px）
  var pointers = {};                // pointerId -> {x, y}（普通对象，ES5 安全）
  var pointerCount = 0;
  var mode = 'idle';                // idle | single | pinch
  var pinch = null;                 // {d0, s0, ax, ay} 捏合起始状态
  var drag = null;                  // {x, y} 拖动上一帧指针位置
  var down = null;                  // {t, x, y, moved} 单指按下（单击判定用）
  var lastTap = null;               // {t, x, y} 上一次已完成的单击
  var smoothTimer = 0;
  var resizeTimer = 0;
  var lastTrigger = null;
  var pinchEndAt = 0;
  /* 两套时间闸，语义不同、互不打架：
     pinchEndAt + PINCH_TAP_GUARD_MS(400ms)：捏合结束后忽略「单击」，防止松手
       尾焰被误判成双击缩放开关（QA Round 1 口径的 400ms guard）。
     clickGuardUntil：「空白区点击关闭」的闸。三个来源——① open() 后 350ms：
       挡掉「打开灯箱的那一次点击」的延迟合成 click（触摸→鼠标兼容事件可能晚于
       DOM 变化派发，落到新出现的遮罩/frame 空白区上，会把刚打开的灯箱立刻关掉）；
        ② 捏合/拖动移动期间持续 +500ms：松手尾焰的 click 不触发关闭。 */
  var clickGuardUntil = 0;

  /* ------------------------------------------------------------ 小工具 */
  function pointerCountOf() {
    return pointerCount;
  }

  function trackPointer(id, x, y) {
    var key = String(id);
    if (!pointers[key]) pointerCount += 1;
    pointers[key] = { x: x, y: y };
  }

  function untrackPointer(id) {
    var key = String(id);
    if (pointers[key]) {
      delete pointers[key];
      pointerCount -= 1;
    }
  }

  function lastTwoPointers() {
    var keys = Object.keys(pointers);
    if (keys.length < 2) return null;
    return [pointers[keys[keys.length - 2]], pointers[keys[keys.length - 1]]];
  }

  function firstPointer() {
    var keys = Object.keys(pointers);
    return keys.length ? pointers[keys[0]] : null;
  }

  function dist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function cancelSmooth() {
    if (image) image.classList.remove('smooth');
    clearTimeout(smoothTimer);
  }

  /* ------------------------------------------------------------ 构建 DOM */
  function build() {
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay lightbox-overlay';
    overlay.id = 'portraitLightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '立绘查看');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<div class="modal-backdrop"></div>' +
      '<button type="button" class="modal-close lightbox-close" aria-label="关闭">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
          '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>' +
        '</svg>' +
      '</button>' +
      '<figure class="lightbox-stage">' +
        '<div class="lightbox-frame"></div>' +
        '<figcaption class="lightbox-caption">' +
          '<span class="lightbox-name"></span>' +
          '<span class="lightbox-hint">双击放大 · 捏合缩放 · 拖动查看</span>' +
        '</figcaption>' +
      '</figure>';
    document.body.appendChild(overlay);

    backdrop = overlay.querySelector('.modal-backdrop');
    closeBtn = overlay.querySelector('.lightbox-close');
    frame = overlay.querySelector('.lightbox-frame');
    nameEl = overlay.querySelector('.lightbox-name');

    image = document.createElement('img');
    image.className = 'lightbox-image';
    image.alt = '';
    image.decoding = 'async';
    image.draggable = false; /* 防浏览器原生拖拽影子图 */
    frame.appendChild(image);

    /* 关闭：遮罩 / 按钮 / Esc 三条路都汇到 close()。
       遮罩这条路带 clickGuardUntil 闸——挡「打开它的那次点击」的延迟合成事件 */
    backdrop.addEventListener('click', function () {
      if (!state.open) return;
      if (Date.now() < clickGuardUntil) return;
      close();
    });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', onKeyDown);

    /* 手势：全部走 Pointer Events，鼠标 / 触摸 / 触控笔同一套代码 */
    frame.addEventListener('pointerdown', onPointerDown);
    frame.addEventListener('pointermove', onPointerMove);
    frame.addEventListener('pointerup', endPointer);
    frame.addEventListener('pointercancel', endPointer);
    frame.addEventListener('lostpointercapture', endPointer);
    frame.addEventListener('wheel', onWheel, { passive: false });

    /* 点立绘之外的空白区也关闭：桌面下 frame 几乎铺满舞台，只靠 stage 的 16px
       边沟可点太小，用户点一大片深色空白区理应关掉。点在图片上不关（双击放大
       还要用）；clickGuardUntil 窗口内不关（打开尾焰 + 手势尾焰）。 */
    frame.addEventListener('click', function (e) {
      if (!state.open) return;
      if (e.target !== frame) return;              /* 点在图片上 → 不关 */
      if (Date.now() < clickGuardUntil) return;    /* 尾焰 → 不关 */
      close();
    });

    /* 桌面便利：滚轮缩放（需求只要求双击 + 捏合，这是附赠；触屏没有 wheel） */
    global.addEventListener('resize', onResize);
    global.addEventListener('orientationchange', onResize);

    /* 缓存未命中时图片晚到：loaded 之后按真实像素重新度量一次 */
    image.addEventListener('load', function () {
      if (!state.open) return;
      measure();
      clampTranslation();
      applyTransform(false);
    });
  }

  /* -------------------------------------------------------- 入口绑定 */
  function bindTriggers() {
    /* 事件委托：人物卡是静态的，但委托只有一条监听，且对将来动态插入的卡片同样生效 */
    document.addEventListener('click', function (e) {
      if (!e || !e.target || !e.target.closest) return;
      var btn = e.target.closest('[data-lightbox-src]');
      if (!btn || btn.disabled) return;
      var src = btn.getAttribute('data-lightbox-src');
      if (!src) return;
      /* button 本来就没有默认动作，preventDefault 只是双保险 */
      e.preventDefault();
      /* 卡片上的同文件图片通常已解码：把它的自然尺寸当「宽高比提示」传给灯箱，
         让 measure() 在灯箱图还没解码的这几毫秒里也能算出正确的非等比占位尺寸
         （v3 立绘是 1024×898/954 非方形，没有提示会先按正方形显示再跳变）。 */
      var hint = null;
      var cardImg = btn.querySelector('img');
      if (cardImg && cardImg.naturalWidth && cardImg.naturalHeight) {
        hint = { w: cardImg.naturalWidth, h: cardImg.naturalHeight };
      }
      open(src, btn.getAttribute('data-lightbox-name') || '', btn, hint);
    });
  }

  /* ------------------------------------------------------------ 开 / 关 */
  function open(src, name, trigger, hint) {
    if (!overlay || state.open || !src) return;
    state.open = true;
    lastTrigger = trigger || null;
    /* 新开一轮：清掉上一轮的手势尾焰窗口，并给本次「打开的点击」留 350ms 闸
       （触摸的兼容鼠标 click 可能晚于 DOM 变化派发，落到新遮罩上会立刻关掉） */
    clickGuardUntil = Date.now() + 350;
    if (nameEl) nameEl.textContent = name || '';
    image.alt = name || '';
    image.src = src;
    /* 先锁滚动再度量：桌面 Chrome 的经典滚动条会占掉布局视口宽度，
       锁掉之后视口才变到最终尺寸（安卓 WebView 是 overlay 滚动条，无此差异，
       但顺序对了两边都不会错）。度量必须发生在锁定之后。 */
    document.body.style.overflow = 'hidden';
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    measure(hint);
    resetZoom(false);
    if (closeBtn && closeBtn.focus) closeBtn.focus({ preventScroll: true });
    /* 缓存命中时 src 是同步解码的，loaded 事件不会再触发，这里补一次度量 */
    if (image.complete && image.naturalWidth) {
      measure();
      clampTranslation();
      applyTransform(false);
    }
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    /* 去掉 .visible：CSS 过渡负责 0.25s 淡出，JS 不等它 */
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    pointers = {};
    pointerCount = 0;
    mode = 'idle';
    pinch = null;
    drag = null;
    down = null;
    lastTap = null;
    cancelSmooth();
    if (lastTrigger && lastTrigger.focus) lastTrigger.focus({ preventScroll: true });
    lastTrigger = null;
  }

  function onKeyDown(e) {
    if (e.key !== 'Escape' && e.key !== 'Esc') return;
    if (!state.open) return;
    e.preventDefault();
    e.stopPropagation(); /* 消费在最上层，不冒泡到页面其他 Esc 逻辑 */
    close();
  }

  /* ------------------------------------------------------ 尺寸与变换 */
  /**
   * 度量「初始显示尺寸」（scale=1 时图片占多少 CSS px）。
   * 封顶为原图像素尺寸：铺满屏幕需要拉伸源像素（会发糊），桌面 1:1 显示反而最锐利。
   * 放大交给用户主动的双击 / 捏合 —— 那是有意识的细节查看，糊是预期代价。
   *
   * 用 offsetWidth/offsetHeight（布局盒）而不是 getBoundingClientRect（变化后
   * 的视觉盒）：.lightbox-stage 入场时带 scale(0.94)→1 的过渡，open() 是同步
   * 紧接着加 .visible 的，那一刻视觉盒还缩着 6%——用视觉盒会把图片量小 6%，
   * 而 250ms 过渡结束后夹取边界又按稳定后的尺寸算，两者不一致。布局盒不受
   * transform 影响，任何时刻都是终值。
   *
   * @param {Object=} hint 宽高比提示 {w, h}（来自卡片上同文件已解码的 img）。
   *   灯箱图刚设 src、尚未解码时用它算占位尺寸；解码完成后 load 事件会按真实
   *   像素再度量。都没有时兜底按 512×512 正方形（本站旧立绘规格）。
   */
  function measure(hint) {
    if (!image) return;
    var natW = image.naturalWidth || (hint && hint.w) || 0;
    var natH = image.naturalHeight || (hint && hint.h) || 0;
    var availW = frame.offsetWidth || 0;
    var availH = frame.offsetHeight || 0;
    if (!availW || !availH) return;
    if (!natW || !natH) {
      natW = 512;
      natH = 512;
    }
    var fit = Math.min(availW / natW, availH / natH);
    var s = Math.min(fit, 1);
    base.w = Math.max(1, Math.round(natW * s));
    base.h = Math.max(1, Math.round(natH * s));
    image.style.width = base.w + 'px';
    image.style.height = base.h + 'px';
  }

  /** 平移边界：任何方向都不允许把图片拖出可视区（露出遮罩底）。同样用布局盒。 */
  function clampTranslation() {
    var availW = frame.offsetWidth || 0;
    var availH = frame.offsetHeight || 0;
    var maxX = Math.max(0, (base.w * state.scale - availW) / 2);
    var maxY = Math.max(0, (base.h * state.scale - availH) / 2);
    state.tx = Math.min(maxX, Math.max(-maxX, state.tx));
    state.ty = Math.min(maxY, Math.max(-maxY, state.ty));
  }

  function applyTransform(animate) {
    if (!image) return;
    image.style.transform =
      'translate(' + state.tx.toFixed(2) + 'px, ' + state.ty.toFixed(2) + 'px) ' +
      'scale(' + state.scale.toFixed(4) + ')';
    if (animate) {
      /* .smooth 只在双击 / 回弹这类「一次性补间」时挂，捏合与拖动不挂 */
      image.classList.add('smooth');
      clearTimeout(smoothTimer);
      smoothTimer = setTimeout(function () { image.classList.remove('smooth'); }, SMOOTH_MS + 20);
    }
  }

  function resetZoom(animate) {
    state.scale = 1;
    state.tx = 0;
    state.ty = 0;
    applyTransform(animate);
  }

  /**
   * 以屏幕坐标 (clientX, clientY) 为锚点缩放到 newScale：锚点下的画面保持不动。
   * 推导：基准坐标系（图片中心为原点、未缩放）里的点 p 在屏幕上的位置是
   *   screen = center + s * p + t
   * 先由当前状态反解 p，再令新状态下同一个 p 仍落在锚点上：
   *   t' = anchor - center - s' * p
   */
  function zoomTo(newScale, clientX, clientY, animate) {
    newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, newScale));
    var rect = frame.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var px = (clientX - cx - state.tx) / state.scale;
    var py = (clientY - cy - state.ty) / state.scale;
    state.scale = newScale;
    state.tx = clientX - cx - px * newScale;
    state.ty = clientY - cy - py * newScale;
    clampTranslation();
    applyTransform(animate);
  }

  /* ------------------------------------------------------------ 手势 */
  function onPointerDown(e) {
    if (!state.open) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    trackPointer(e.pointerId, e.clientX, e.clientY);
    try { frame.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }

    if (pointerCountOf() >= 2) {
      /* 第二根手指落下 → 进入捏合。锚点取双指中点，起始倍率/平移一并记录 */
      var pts = lastTwoPointers();
      mode = 'pinch';
      down = null;
      lastTap = null;
      pinch = {
        d0: Math.max(1, dist(pts[0], pts[1])),
        s0: state.scale,
        ax: (pts[0].x + pts[1].x) / 2,
        ay: (pts[0].y + pts[1].y) / 2
      };
      cancelSmooth();
      return;
    }

    /* 单指：既是拖动候选，也是单击候选 —— 两者不互斥，靠 pointerup 时的位移
       容差区分。早先版本在这里按 scale>1 直接判成拖动，结果放大后永远无法
       再用双击缩回去（单击候选根本没被记录），现在合并成同一路径。 */
    mode = 'single';
    down = { t: Date.now(), x: e.clientX, y: e.clientY, moved: false };
    drag = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e) {
    if (!state.open || !pointers[String(e.pointerId)]) return;
    trackPointer(e.pointerId, e.clientX, e.clientY);

    if (mode === 'pinch' && pinch && pointerCountOf() >= 2) {
      e.preventDefault();
      clickGuardUntil = Date.now() + 500;
      var pts = lastTwoPointers();
      var d = dist(pts[0], pts[1]);
      /* 以捏合起始状态为基准连续缩放，1x–3x；锚点固定在起始中点 */
      zoomTo(pinch.s0 * (d / pinch.d0), pinch.ax, pinch.ay, false);
      return;
    }

    if (mode === 'single' && drag) {
      e.preventDefault();
      if (down && !down.moved &&
          (Math.abs(e.clientX - down.x) > TAP_SLOP_PX ||
           Math.abs(e.clientY - down.y) > TAP_SLOP_PX)) {
        down.moved = true;
      }
      /* scale=1 时 clampTranslation 会把平移钳成 0，等效于不响应拖动，
         所以这里不需要按缩放状态分叉。 */
      state.tx += e.clientX - drag.x;
      state.ty += e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY };
      clampTranslation();
      applyTransform(false);
      clickGuardUntil = Date.now() + 500;
    }
  }

  function endPointer(e) {
    if (!pointers[String(e.pointerId)]) return;
    untrackPointer(e.pointerId);
    try { frame.releasePointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }

    if (pointerCountOf() < 2 && mode === 'pinch') {
      /* 捏合中断（抬起一指）：记录 guard 时间；剩下一指接续拖动，
         但不再产生单击（down 置空），避免松手瞬间误触双击。 */
      pinch = null;
      pinchEndAt = Date.now();
      down = null;
      if (pointerCountOf() === 1) {
        var p = firstPointer();
        mode = 'single';
        drag = { x: p.x, y: p.y };
      } else {
        mode = 'idle';
        drag = null;
      }
      return;
    }

    if (pointerCountOf() === 0) {
      if (mode === 'single' && down && !down.moved) handleTap(down);
      down = null;
      drag = null;
      mode = 'idle';
    }
  }

  /**
   * 单击 / 双击判定（鼠标与触摸共用，不依赖浏览器 dblclick —— 那个在部分
   * WebView 上会和捏合手势互相误触，这里自己算才可控）。
   * 与捏合互斥：捏合刚结束 400ms 内的单击直接忽略。
   */
  function handleTap(t) {
    if (Date.now() - pinchEndAt < PINCH_TAP_GUARD_MS) return;
    var now = Date.now();
    if (lastTap && now - lastTap.t <= DOUBLE_TAP_SLOP_MS &&
        Math.abs(t.x - lastTap.x) <= DOUBLE_TAP_SLOP_PX &&
        Math.abs(t.y - lastTap.y) <= DOUBLE_TAP_SLOP_PX) {
      lastTap = null;
      if (state.scale > MIN_SCALE + 0.001) {
        resetZoom(true);                                    /* 双击回 1x */
      } else {
        zoomTo(DOUBLE_TAP_SCALE, t.x, t.y, true);           /* 双击到 2.5x，锚在指尖 */
      }
      return;
    }
    lastTap = { t: now, x: t.x, y: t.y };
  }

  function onWheel(e) {
    if (!state.open) return;
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomTo(state.scale * factor, e.clientX, e.clientY, false);
  }

  function onResize() {
    if (!state.open) return;
    /* 横竖屏 / 键盘弹出：重新度量并回到 1x。带着缩放状态换屏幕尺寸没有意义，
       而且旧平移量大概率已超出新边界。去抖避免连续 resize 抖动。 */
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      measure();
      resetZoom(false);
    }, RESIZE_DEBOUNCE_MS);
  }

  /* ------------------------------------------------------------ 初始化 */
  function init() {
    if (overlay) return;
    build();
    bindTriggers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.PortraitLightbox = {
    open: open,
    close: close,
    isOpen: function () { return state.open; }
  };
})(window);
