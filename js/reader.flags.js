/**
 * 远程开关 —— 出问题时把某个功能关掉，而不是回滚整站
 *
 * 为什么需要：这是纯静态站，一个功能出问题只能改代码 → 升 ?v= → push → 等
 * GitHub Pages 发布，最快也要几分钟；如果人不在电脑前就更久。而 `flags.json`
 * 是一个不缓存的静态文件，改一行、push、用户下次进章节页就生效。
 *
 * 设计上的三条：
 *   1. **失败即全开**：拉不到、超时、格式不对，都保持默认（全部 true）。
 *      开关是止血工具，不是可用性依赖 —— 它挂了不能让读者也读不了书。
 *   2. **用的时候才问**：不在 init 时快照一堆 boolean，而是在操作发生的那一刻
 *      调 isOn()。这样 1.5 秒后才到的开关值也能立刻生效，不需要刷新。
 *   3. **只认 boolean**：写 "false" 字符串不算关，避免手滑造成"看着关了其实没关"。
 *
 * 约定：新增功能时，把开关名加到 DEFAULTS 与 flags.json 里，默认 true；
 * 功能入口处用 LY.flags.isOn('名字') 守卫，并在 applyFeatureVisibility() 里
 * 把入口按钮一起藏掉（否则用户点到一个死按钮，比没有更糟）。
 *
 * 依赖：无。被 reader.engine.js / reader.ui.js 使用。
 */
(function() {
  'use strict';
  var LY = window.LY || (/** @type {any} */ (window.LY = {}));

  var DEFAULTS = {
    autoscroll: true,     /* 自动下滑翻屏 */
    readingAids: true,    /* 阅读辅助四项（对话高亮 / 直角引号 / 常亮 / 剩余时间） */
    anchorRestore: true,  /* 段落锚点恢复位置（关掉则退回按百分比） */
    backup: true          /* 阅读数据备份与恢复 */
  };

  var current = {};
  Object.keys(DEFAULTS).forEach(function(k) { current[k] = DEFAULTS[k]; });

  var listeners = [];
  var loaded = false;

  /** @param {string} name @returns {boolean} 未声明/取值非法时按「开」处理 */
  function isOn(name) {
    return current[name] !== false;
  }

  /** 合并一份开关值（测试与调试也走这里，保证和线上同一条路径） */
  function apply(next) {
    if (!next || typeof next !== 'object') return;
    Object.keys(DEFAULTS).forEach(function(k) {
      if (typeof next[k] === 'boolean') current[k] = next[k];
    });
    listeners.forEach(function(fn) {
      try { fn(current); } catch (err) { /* 一个监听器出错不影响别人 */ }
    });
  }

  function load() {
    var settled = false;
    var timer = setTimeout(function() { settled = true; }, 1500);
    function finish(payload) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      loaded = true;
      apply(payload && payload.flags);
    }
    try {
      /* ?t= 再兜一层：万一 SW 的放行规则出问题，也不会吃到旧开关 */
      fetch('/flags.json?t=' + Date.now(), { cache: 'no-store' })
        .then(function(r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(finish)
        .catch(function() { finish(null); });
    } catch (err) {
      finish(null);
    }
  }

  LY.flags = {
    isOn: isOn,
    apply: apply,
    load: load,
    onChange: function(fn) { if (typeof fn === 'function') listeners.push(fn); },
    all: function() { return Object.assign({}, current); },
    isLoaded: function() { return loaded; }
  };
})();
