/* DOM 工具 —— 替代手拼 innerHTML 的最小工具集
   设计说明、历史与踩坑记录见 _design/notes/reader.dom.js.md（原文按行号归档）。 */
(function() {
  'use strict';
  var LY = window.LY || (/** @type {any} */ (window.LY = {}));

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
