/**
 * DOM 工具 —— 替代手拼 innerHTML 的最小工具集
 *
 * 为什么要它：本站大量面板是用字符串拼出来的（`'<div class="x">' + 变量 + '</div>'`）。
 * 字符串拼 HTML 有三个长期代价：忘了转义就是 XSS、属性里嵌套引号要靠 escapeJs 打补丁、
 * 事件只能用内联 onclick 挂（既污染全局，又没法传闭包）。
 *
 * 约定（渐进式，不要一次性重写）：
 *   · 新写的界面一律用 el() / text() 构建，不再拼字符串
 *   · 老面板在下次改到它的时候顺手换，不专门开一次大重构
 *   · 确实需要一段静态 HTML 骨架时，用 html() 包一层并注明「内容可信」
 *
 * 依赖：无。被 reader.engine.js / reader.ui.js 使用。
 */
(function() {
  'use strict';
  var LY = window.LY || (/** @type {any} */ (window.LY = {}));

  /**
   * 建元素。
   * @param {string} tag 标签名
   * @param {Object<string, any>} [attrs] 属性；on* 走 addEventListener，其余走 setAttribute
   *   （class → className，text → textContent，dataset → data-*）
   * @param {Array<Node|string|null|undefined>|string} [children] 子节点，字符串会作为文本节点（自动转义）
   * @returns {HTMLElement}
   */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function(key) {
        var val = attrs[key];
        if (val === null || val === undefined || val === false) return;
        if (key === 'class') { node.className = val; return; }
        if (key === 'text') { node.textContent = val; return; }
        if (key === 'dataset') {
          Object.keys(val).forEach(function(k) { node.dataset[k] = val[k]; });
          return;
        }
        if (key.slice(0, 2) === 'on' && typeof val === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), val);
          return;
        }
        if (val === true) { node.setAttribute(key, ''); return; }
        node.setAttribute(key, String(val));
      });
    }
    append(node, children);
    return node;
  }

  /** 把字符串 / 节点 / 数组塞进父节点；字符串一律作为文本（不解析 HTML） */
  function append(parent, children) {
    if (children === null || children === undefined || children === false) return parent;
    if (Array.isArray(children)) {
      children.forEach(function(c) { append(parent, c); });
      return parent;
    }
    if (children instanceof Node) { parent.appendChild(children); return parent; }
    parent.appendChild(document.createTextNode(String(children)));
    return parent;
  }

  /** 明确表示「这段 HTML 是我自己写的、不含外部数据」时才用 */
  function html(markup) {
    var tpl = document.createElement('template');
    tpl.innerHTML = String(markup).trim();
    return tpl.content;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  LY.dom = { el: el, add: append, html: html, escapeHtml: escapeHtml };
})();
