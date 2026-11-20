/* 远程开关 —— 出问题时把某个功能关掉，而不是回滚整站
   设计说明、历史与踩坑记录见 _design/notes/reader.flags.js.md（原文按行号归档）。 */
(function() {
  'use strict';
  var LY = window.LY || (/** @type {any} */ (window.LY = {}));

  var DEFAULTS = {
    autoscroll: true,     /* 自动下滑翻屏 */
    readingAids: true,    /* 阅读辅助四项（对话高亮 / 直角引号 / 常亮 / 剩余时间） */
    anchorRestore: true,  /* 段落锚点恢复位置（关掉则退回按百分比） */
    backup: true,         /* 阅读数据备份与恢复 */
    infiniteScroll: true, /* 章末自动接下一章（关掉即回到「一次只装一章」） */
    search: true,         /* 阅读器内全章搜索（关掉即藏掉工具栏入口并拒绝打开） */
    upgradeExportHint: true /* S1：壳内「升级到原生版前请先备份」引导；浏览器里恒不显示 */
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
