(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const TIME_LABEL = { morning: '上午', noon: '中午', afternoon: '下午', evening: '傍晚', night: '夜', unknown: '未标注' };
  const PLACE_ICONS = {
    linyuan: [
      'M-9 -1H9V6A6 6 0 0 1 3 12H-3A6 6 0 0 1 -9 6Z',
      'M9 2C13.5 2 13.5 8 9 8',
      'M-12 14H12',
      'M-4 -5C-6 -8 -2 -10 -4 -13',
      'M2 -5C0 -8 4 -10 2 -13'
    ],
    nancheng1: [
      'M-14 0L0 -12L14 0',
      'M-11 0V13H11V0',
      'M-3 13V7H3V13',
      'M-8 4H-5V7H-8Z',
      'M5 4H8V7H5Z'
    ],
    hospital: ['M-11 -9H11V13H-11Z', 'M0 -4V6', 'M-5 1H5'],
    beicheng: ['M0 -13A13 13 0 1 1 0 13A13 13 0 1 1 0 -13', 'M0 -9L4 3L0 1L-4 3Z']
  };

  const state = {
    mode: 'reader',
    payload: null,
    events: [],
    foreshadowing: [],
    publishedThrough: 0,
    hover: null,
    selected: null,
    query: '',
    group: null,
    view: { x: 0, y: 0, k: 1 },
    moved: false,
    fullLoading: false
  };

  let NODES = [];
  let EDGES = [];
  let nodeById = {};
  let adjacency = new Map();
  let viewport = null;
  const edgeEls = [];
  const edgeLabelEls = [];
  const nodeEls = {};

  const svg = document.getElementById('atlasMap');
  const panel = document.getElementById('atlasPanel');
  const mapWrap = document.getElementById('atlasMapWrap');

  function el(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function iconGroup(id) {
    const group = el('g', { class: 'place-icon', 'aria-hidden': 'true' });
    (PLACE_ICONS[id] || []).forEach((d, index) => {
      group.appendChild(el('path', { d, class: id === 'beicheng' && index === 1 ? 'fill' : '' }));
    });
    return group;
  }
  function iconMarkup(id) {
    const paths = (PLACE_ICONS[id] || []).map((d, index) => `<path d="${d}"${id === 'beicheng' && index === 1 ? ' class="fill"' : ''}/>`).join('');
    return `<svg viewBox="-18 -18 36 36" aria-hidden="true">${paths}</svg>`;
  }
  function formatDate(value) {
    if (!value) return '未标注';
    const parts = value.split('-');
    if (parts.length !== 3) return value;
    return `${Number(parts[1])}月${Number(parts[2])}日`;
  }
  function groupName(id) {
    return state.payload?.groups?.[id]?.name || id;
  }
  function placeName(event) {
    return event.place ? (nodeById[event.place]?.name || event.place) : (event.placeText || '—');
  }

  function setPayload(payload, full) {
    state.payload = payload;
    state.mode = full ? 'full' : 'reader';
    state.events = full ? (payload.timeline || []) : (payload.events || []);
    state.foreshadowing = full ? (payload.foreshadowing || []) : [];
    state.publishedThrough = payload.publishedThrough || 0;

    NODES = (payload.entities || []).map(entity => full
      ? {
          id: entity.id,
          name: entity.name,
          type: entity.type,
          group: entity.group,
          role: entity.role,
          summary: entity.summary,
          quote: entity.quote || '',
          bio: entity.bio || [],
          aliases: entity.aliases || [],
          portrait: entity.portrait || null,
          x: entity.graph?.x ?? 0,
          y: entity.graph?.y ?? 0,
          r: entity.graph?.r ?? 20,
          primary: Boolean(entity.graph?.primary),
          glyph: entity.graph?.glyph || '',
          deceased: Boolean(entity.deceased),
          revealAt: entity.reader?.revealAt ?? null
        }
      : {
          id: entity.id,
          name: entity.name,
          type: entity.type,
          group: entity.group,
          role: entity.role,
          summary: entity.summary,
          quote: '',
          bio: [],
          aliases: entity.aliases || [],
          portrait: entity.portrait || null,
          x: entity.x ?? 0,
          y: entity.y ?? 0,
          r: entity.r ?? 20,
          primary: Boolean(entity.primary),
          glyph: entity.glyph || '',
          deceased: Boolean(entity.deceased),
          revealAt: entity.revealAt ?? null
        });

    EDGES = (payload.relations || []).map(relation => ({ ...relation, label: relation.label }));
    nodeById = Object.fromEntries(NODES.map(node => [node.id, node]));
    adjacency = new Map(NODES.map(node => [node.id, new Set()]));
    EDGES.forEach(edge => {
      adjacency.get(edge.a)?.add(edge.b);
      adjacency.get(edge.b)?.add(edge.a);
    });
  }

  function edgePath(edge, index) {
    const a = nodeById[edge.a];
    const b = nodeById[edge.b];
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const bend = Math.min(70, length * 0.15) * (index % 2 ? 1 : -1);
    const cx = (a.x + b.x) / 2 + nx * bend;
    const cy = (a.y + b.y) / 2 + ny * bend;
    return {
      d: `M${a.x} ${a.y} Q${cx} ${cy} ${b.x} ${b.y}`,
      cx: 0.25 * a.x + 0.5 * cx + 0.25 * b.x,
      cy: 0.25 * a.y + 0.5 * cy + 0.25 * b.y
    };
  }

  function drawBackdrop() {
    const back = el('g', { 'aria-hidden': 'true' });

    back.appendChild(el('circle', { cx: 655, cy: 430, r: 210, fill: 'url(#atlasMoon)' }));
    back.appendChild(el('circle', { class: 'atlas-moon-halo', cx: 655, cy: 430, r: 148 }));
    back.appendChild(el('circle', { class: 'atlas-moon-halo', cx: 655, cy: 430, r: 96, 'stroke-dasharray': '1 6' }));

    [110, 200, 300, 405].forEach(radius => {
      back.appendChild(el('circle', { class: 'atlas-ripple', cx: 655, cy: 455, r: radius }));
    });

    [
      'M0 784 Q150 774 300 784 T600 784 T900 784 T1200 784',
      'M0 804 Q150 794 300 804 T600 804 T900 804 T1200 804',
      'M0 824 Q150 814 300 824 T600 824 T900 824 T1200 824'
    ].forEach((d, index) => {
      back.appendChild(el('path', { class: 'atlas-water-line', d, opacity: (0.10 + index * 0.02).toFixed(2) }));
    });

    const big = el('text', { class: 'atlas-calligraphy', x: 1128, y: 520, 'text-anchor': 'end', 'font-size': 208 });
    big.textContent = '渊';
    back.appendChild(big);

    let seed = 20221118;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 64; i++) {
      const x = 50 + rand() * 1100;
      const y = 50 + rand() * 700;
      if (Math.hypot(x - 655, y - 455) < 170) continue;
      back.appendChild(el('circle', { class: 'atlas-star', cx: x.toFixed(1), cy: y.toFixed(1), r: (0.7 + rand() * 1.1).toFixed(2) }));
    }

    const caption = el('text', { class: 'atlas-map-caption', x: 62, y: 76 });
    caption.textContent = `南城 · ${state.mode === 'full' ? '完整星图' : `第 ${state.publishedThrough} 章`}`;
    back.appendChild(caption);

    const quote = el('text', { class: 'atlas-map-quote', x: 62, y: 104 });
    quote.textContent = '所有的事都还没开始，一切都还来得及。';
    back.appendChild(quote);

    viewport.appendChild(back);
  }

  function drawEdges() {
    const group = el('g');
    const labels = el('g');
    edgeEls.length = 0;
    edgeLabelEls.length = 0;
    EDGES.forEach((edge, index) => {
      const geometry = edgePath(edge, index);
      if (!geometry) return;
      const path = el('path', {
        class: `atlas-edge atlas-edge--${edge.kind}`,
        d: geometry.d,
        'data-a': edge.a,
        'data-b': edge.b
      });
      if (edge.directed) path.setAttribute('marker-end', 'url(#atlasDot)');
      group.appendChild(path);
      edgeEls.push(path);

      const label = el('text', {
        class: 'atlas-edge-label',
        x: geometry.cx.toFixed(1),
        y: (geometry.cy - 5).toFixed(1),
        'data-a': edge.a,
        'data-b': edge.b
      });
      label.textContent = edge.label;
      labels.appendChild(label);
      edgeLabelEls.push(label);
    });
    viewport.appendChild(group);
    viewport.appendChild(labels);
  }

  function drawNodes() {
    const group = el('g');
    const defs = svg.querySelector('defs');
    NODES.forEach(node => {
      const isPlace = node.type === 'place';
      const element = el('g', {
        class: `atlas-node g-${node.group}${isPlace ? ' atlas-node--place' : ''}${node.primary ? ' is-primary' : ''}${node.deceased ? ' is-deceased' : ''}`,
        transform: `translate(${node.x} ${node.y})`,
        'data-id': node.id,
        tabindex: '0',
        role: 'button',
        'aria-label': `${node.name}，${node.role}`
      });
      const title = el('title');
      title.textContent = `${node.name} · ${node.role}`;
      element.appendChild(title);
      element.appendChild(el('circle', { class: 'hit', r: node.r + 10 }));
      element.appendChild(el('circle', { class: 'halo', r: node.r + 8 }));

      if (isPlace) {
        element.appendChild(el('rect', { class: 'body', x: -node.r, y: -node.r, width: node.r * 2, height: node.r * 2, rx: 11 }));
        element.appendChild(el('rect', { class: 'ring', x: -node.r + 5, y: -node.r + 5, width: node.r * 2 - 10, height: node.r * 2 - 10, rx: 7 }));
        element.appendChild(iconGroup(node.id));
      } else {
        const clip = el('clipPath', { id: `atlas-clip-${node.id}` });
        clip.appendChild(el('circle', { r: node.r - 3.4 }));
        defs.appendChild(clip);
        element.appendChild(el('circle', { class: 'body', r: node.r }));
        const size = node.r * 2 - 6;
        element.appendChild(el('image', {
          class: 'portrait',
          href: `../assets/portrait-${node.id}-thumb.webp`,
          x: -size / 2,
          y: -node.r + 2,
          width: size,
          height: (size * 150 / 128).toFixed(2),
          preserveAspectRatio: 'xMidYMin slice',
          'clip-path': `url(#atlas-clip-${node.id})`,
          'aria-hidden': 'true'
        }));
        element.appendChild(el('circle', { class: 'frame', r: node.r - 2.6 }));
        element.appendChild(el('circle', { class: 'ring', r: node.r + 1.2 }));
        if (node.primary) element.appendChild(el('circle', { class: 'ring', r: node.r + 5.4, style: 'stroke-width:.8;opacity:.35' }));
      }

      const label = el('text', { class: 'node-label', y: node.r + 17 });
      label.textContent = node.name;
      element.appendChild(label);

      element.addEventListener('pointerenter', () => { state.hover = node.id; applyFocus(); });
      element.addEventListener('pointerleave', () => { state.hover = null; applyFocus(); });
      element.addEventListener('focus', () => { state.hover = node.id; applyFocus(); });
      element.addEventListener('blur', () => { state.hover = null; applyFocus(); });
      element.addEventListener('click', event => { event.stopPropagation(); select(node.id); });
      element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.id); }
        if (event.key === 'Escape') select(null);
      });

      group.appendChild(element);
      nodeEls[node.id] = element;
    });
    viewport.appendChild(group);
  }

  function renderMap() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const defs = el('defs');
    const marker = el('marker', { id: 'atlasDot', viewBox: '0 0 6 6', refX: 5, refY: 3, markerWidth: 4, markerHeight: 4 });
    marker.appendChild(el('circle', { cx: 3, cy: 3, r: 2, fill: 'context-stroke' }));
    defs.appendChild(marker);
    const moon = el('radialGradient', { id: 'atlasMoon' });
    [['0%', '0.16'], ['46%', '0.06'], ['100%', '0']].forEach(([offset, opacity]) => {
      moon.appendChild(el('stop', { offset, 'stop-opacity': opacity, style: 'stop-color:var(--accent)' }));
    });
    defs.appendChild(moon);
    svg.appendChild(defs);
    viewport = el('g');
    svg.appendChild(viewport);
    Object.keys(nodeEls).forEach(key => delete nodeEls[key]);
    drawBackdrop();
    drawEdges();
    drawNodes();
    applyView();
  }

  function applyFocus() {
    const active = state.hover || state.selected;
    svg.classList.toggle('has-focus', Boolean(active));
    const near = active ? adjacency.get(active) : null;
    NODES.forEach(node => {
      const element = nodeEls[node.id];
      if (!element) return;
      element.classList.toggle('is-active', node.id === active);
      element.classList.toggle('is-neighbor', Boolean(near && node.id !== active && near.has(node.id)));
    });
    EDGES.forEach((edge, index) => {
      const on = Boolean(active) && (edge.a === active || edge.b === active);
      const inNeighborhood = Boolean(near) && near.has(edge.a) && near.has(edge.b);
      if (edgeEls[index]) {
        edgeEls[index].classList.toggle('is-active', on);
        edgeEls[index].classList.toggle('is-neighbor', !on && inNeighborhood);
      }
      if (edgeLabelEls[index]) edgeLabelEls[index].classList.toggle('is-active', on);
    });
  }

  function select(id, push) {
    state.selected = id && nodeById[id] ? id : null;
    applyFocus();
    renderPanel(state.selected);
    updateEventHighlight();
    if (push !== false) {
      const suffix = state.selected ? `#${state.selected}` : '';
      try { history.replaceState(null, '', location.pathname + location.search + suffix); } catch (err) { /* file:// */ }
    }
  }

  function renderPanel(id) {
    if (!id) {
      const counts = state.payload?.counts || {};
      panel.innerHTML = `
        <div class="atlas-panel-cover"><span class="atlas-panel-cover-mark">渊</span></div>
        <p class="atlas-panel-kicker">怎么读</p>
        <h2>从一个人开始</h2>
        <p class="atlas-panel-summary">圆是人物，方是地点；双圈是主视角，虚线圈是已故。线型再分关系：实线亲缘，长虚线情感，点线师生，短虚线地点。</p>
        <div class="atlas-panel-sep"></div>
        <p class="atlas-panel-label">当前视图</p>
        <p class="atlas-panel-note">${state.mode === 'full'
          ? `完整视图 · ${counts.entities || NODES.length} 个实体 · ${counts.relations || EDGES.length} 条关系`
          : `已发布至第 ${state.publishedThrough} 章 · 显示 ${counts.entities || NODES.length} 个实体；还有 ${counts.hiddenEntities || 0} 个尚未登场`}</p>
        <div class="atlas-panel-sep"></div>
        <p class="atlas-panel-label">提示</p>
        <p class="atlas-panel-note">点击地图上的肖像，或下方索引里的名字。悬停可以只看一个人的一度关系。</p>`;
      return;
    }

    const node = nodeById[id];
    const relationOrder = ['family', 'love', 'friend', 'mentor', 'place'];
    const relations = EDGES
      .filter(edge => edge.a === id || edge.b === id)
      .map(edge => ({ other: edge.a === id ? edge.b : edge.a, label: edge.label, kind: edge.kind, directed: edge.directed, outgoing: edge.a === id }))
      .sort((a, b) => relationOrder.indexOf(a.kind) - relationOrder.indexOf(b.kind));
    const events = state.events.filter(event => event.participants.includes(id)).slice(0, 5);
    const foreshadowing = state.foreshadowing.filter(item => (item.owner || []).includes(id));

    const header = node.type === 'place'
      ? `<div class="atlas-panel-portrait atlas-panel-portrait--place">${iconMarkup(node.id)}</div>`
      : `<div class="atlas-panel-portrait"><img src="../assets/portrait-${node.id}-1024.webp" alt="${esc(node.name)}立绘"><span class="atlas-panel-seal">${esc(groupName(node.group))}</span></div>`;

    panel.innerHTML = `
      ${header}
      <p class="atlas-panel-kicker">${esc(groupName(node.group))} · ${node.type === 'place' ? '地点' : '人物'}</p>
      <h2>${esc(node.name)}</h2>
      <p class="atlas-panel-role">${esc(node.role)}</p>
      ${state.mode === 'full' && node.quote ? `<blockquote>${esc(node.quote)}</blockquote>` : ''}
      <p class="atlas-panel-summary">${esc(node.summary)}</p>
      ${state.mode === 'full' && node.bio.length ? `<p class="atlas-panel-bio">${esc(node.bio[0])}</p>` : ''}
      <div class="atlas-panel-sep"></div>
      <p class="atlas-panel-label">一度关系 · ${relations.length}</p>
      <ul class="atlas-rel-list">
        ${relations.map(relation => `
          <li><button type="button" data-target="${relation.other}">
            <span>${esc(nodeById[relation.other]?.name || relation.other)}</span>
            <span class="atlas-rel-kind">${esc(relation.label)}${relation.directed ? (relation.outgoing ? ' →' : ' ←') : ''}</span>
          </button></li>`).join('')}
      </ul>
      ${events.length ? `
        <div class="atlas-panel-sep"></div>
        <p class="atlas-panel-label">出现事件 · ${events.length}</p>
        <ul class="atlas-rel-list">
          ${events.map(event => `<li><button type="button" data-event-jump="${event.id}"><span>${esc(event.title)}</span><span class="atlas-rel-kind">第 ${event.chapter} 章</span></button></li>`).join('')}
        </ul>` : ''}
      ${foreshadowing.length ? `
        <div class="atlas-panel-sep"></div>
        <p class="atlas-panel-label">相关伏笔 · ${foreshadowing.length}</p>
        <p class="atlas-panel-note">${foreshadowing.map(item => esc(item.title)).join('；')}</p>` : ''}
      <p class="atlas-panel-note">${state.mode === 'full'
        ? '完整视图包含未发布内容。'
        : `只显示第 ${state.publishedThrough} 章前的内容；完整视图里还有后续关系。`}</p>`;

    panel.querySelectorAll('[data-target]').forEach(button => {
      button.addEventListener('click', () => select(button.dataset.target));
    });
    panel.querySelectorAll('[data-event-jump]').forEach(button => {
      button.addEventListener('click', () => {
        const event = state.events.find(item => item.id === button.dataset.eventJump);
        if (event && event.participants.length) select(event.participants[0]);
      });
    });
  }

  function renderTimeline() {
    const grid = document.getElementById('timelineGrid');
    document.getElementById('timelineNote').textContent = `${state.events.length} 个事件 · 第 ${state.publishedThrough} 章前`;
    if (!state.events.length) {
      grid.innerHTML = '<div class="atlas-empty">还没有已发布的事件。</div>';
      return;
    }
    grid.innerHTML = state.events.map(event => {
      const participants = event.participants.map(id => nodeById[id]?.name).filter(Boolean).join('、');
      return `<button class="atlas-event" type="button" data-event="${event.id}">
        <span class="atlas-event-top"><span>第 ${event.chapter} 章</span><span>${esc(formatDate(event.date))} · ${esc(TIME_LABEL[event.timeOfDay] || event.timeOfDay)}</span></span>
        <strong>${esc(event.title)}</strong>
        <span class="atlas-event-meta">${esc(placeName(event))}${participants ? ' · ' + esc(participants) : ''}</span>
      </button>`;
    }).join('');
    grid.querySelectorAll('[data-event]').forEach(button => {
      button.addEventListener('click', () => {
        const event = state.events.find(item => item.id === button.dataset.event);
        if (event && event.participants.length) select(event.participants[0]);
      });
    });
  }

  function updateEventHighlight() {
    document.querySelectorAll('[data-event]').forEach(button => {
      const event = state.events.find(item => item.id === button.dataset.event);
      button.classList.toggle('is-active', Boolean(state.selected && event && event.participants.includes(state.selected)));
    });
  }

  function renderIndex() {
    const wrap = document.getElementById('atlasIndex');
    const groups = Object.entries(state.payload?.groups || {})
      .sort((a, b) => (a[1].order || 99) - (b[1].order || 99));
    const counts = state.payload?.counts || {};
    document.getElementById('indexNote').textContent = state.mode === 'full'
      ? `完整视图 · ${counts.entities || NODES.length} 个实体`
      : `已发布至第 ${state.publishedThrough} 章 · ${counts.entities || NODES.length} 个实体`;

    wrap.innerHTML = groups.map(([groupId, group]) => {
      const members = NODES.filter(node => node.group === groupId);
      if (!members.length) return '';
      return `<div class="atlas-index-group"><h3>${esc(group.name)}</h3><div class="atlas-index-grid">
        ${members.map(node => `
          <button class="atlas-index-card" type="button" data-id="${node.id}">
            <span class="atlas-index-avatar">${node.type === 'place' ? iconMarkup(node.id) : `<img src="../assets/portrait-${node.id}-thumb.webp" alt="">`}</span>
            <span><span class="atlas-index-name">${esc(node.name)}</span><span class="atlas-index-role">${esc(node.role)}</span></span>
          </button>`).join('')}
      </div></div>`;
    }).join('') + (state.mode === 'reader' && counts.hiddenEntities
      ? `<p class="atlas-index-note">还有 ${counts.hiddenEntities} 个实体尚未在第 ${state.publishedThrough} 章前登场，已隐藏。</p>`
      : '');

    wrap.querySelectorAll('[data-id]').forEach(button => {
      button.addEventListener('click', () => select(button.dataset.id));
    });
  }

  function renderSpoilers() {
    const section = document.getElementById('spoilerSection');
    const grid = document.getElementById('spoilerGrid');
    if (state.mode !== 'full') {
      section.hidden = true;
      grid.innerHTML = '';
      return;
    }
    section.hidden = false;
    grid.innerHTML = state.foreshadowing.map(item => `
      <div class="atlas-fs-card" data-status="${item.status}">
        <strong>${esc(item.title)}</strong>
        <span>第 ${item.plantedIn} 章埋设${item.payoffIn ? ` · 第 ${item.payoffIn} 章回收` : ' · 尚未回收'} · ${item.status === 'paid' ? '已回收' : item.status === 'open' ? '未回收' : '已放弃'}</span>
        <p>${esc(item.note || '')}</p>
      </div>`).join('');
  }

  function applyFilter() {
    const query = state.query.trim();
    let matches = 0;
    const visible = {};
    NODES.forEach(node => {
      const groupOk = !state.group || node.group === state.group;
      const haystack = `${node.name} ${node.role} ${node.summary} ${groupName(node.group)}`;
      const queryOk = !query || haystack.includes(query);
      visible[node.id] = groupOk && queryOk;
      if (visible[node.id] && query) matches += 1;
      nodeEls[node.id]?.classList.toggle('is-filtered', !visible[node.id]);
    });
    EDGES.forEach((edge, index) => {
      const on = visible[edge.a] && visible[edge.b];
      edgeEls[index]?.classList.toggle('is-filtered', !on);
    });
    document.querySelectorAll('#atlasIndex [data-id]').forEach(card => {
      card.classList.toggle('is-filtered', !visible[card.dataset.id]);
    });
    document.getElementById('searchNote').textContent = query ? (matches ? `找到 ${matches} 个节点` : '没有匹配的节点') : '';
  }

  function applyView() {
    if (!viewport) return;
    viewport.setAttribute('transform', `translate(${state.view.x.toFixed(2)} ${state.view.y.toFixed(2)}) scale(${state.view.k.toFixed(3)})`);
  }
  function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
  function zoomBy(factor) {
    const next = clamp(state.view.k * factor, 0.55, 2.8);
    const ratio = next / state.view.k;
    state.view.x = 600 - (600 - state.view.x) * ratio;
    state.view.y = 430 - (430 - state.view.y) * ratio;
    state.view.k = next;
    applyView();
  }
  function toSvgPoint(event) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }

  function updateModeUI() {
    const button = document.getElementById('modeToggle');
    const note = document.getElementById('modeNote');
    const counts = state.payload?.counts || {};
    button.textContent = state.mode === 'full' ? '回到已发布章节' : '显示全部（含剧透）';
    button.disabled = state.fullLoading;
    note.textContent = state.mode === 'full'
      ? `完整视图 · ${counts.entities || NODES.length} 个实体 · ${counts.relations || EDGES.length} 条关系 · 含未发布内容`
      : `已按第 ${state.publishedThrough} 章过滤 · ${counts.hiddenEntities || 0} 个实体尚未登场`;
    document.getElementById('atlasStats').textContent = `${NODES.length} 个节点 · ${EDGES.length} 条关系`;
  }

  function renderAll() {
    renderMap();
    renderTimeline();
    renderIndex();
    renderSpoilers();
    updateModeUI();
    applyFilter();
    const initial = state.selected && nodeById[state.selected] ? state.selected : null;
    select(initial, false);
  }

  function loadFull() {
    if (window.ATLAS_FULL) return Promise.resolve(window.ATLAS_FULL);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'generated/full.js?v=158';
      script.onload = () => window.ATLAS_FULL ? resolve(window.ATLAS_FULL) : reject(new Error('empty'));
      script.onerror = () => reject(new Error('load failed'));
      document.head.appendChild(script);
    });
  }

  function bindInteractions() {
    document.getElementById('atlasChips').addEventListener('click', event => {
      const button = event.target.closest('[data-group]');
      if (!button) return;
      state.group = button.dataset.group === 'all' ? null : button.dataset.group;
      document.querySelectorAll('[data-group]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      applyFilter();
    });

    document.getElementById('atlasSearch').addEventListener('input', event => {
      state.query = event.target.value;
      applyFilter();
    });

    document.querySelectorAll('[data-zoom]').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.zoom === 'in') zoomBy(1.25);
        if (button.dataset.zoom === 'out') zoomBy(0.8);
        if (button.dataset.zoom === 'reset') {
          state.view.x = 0; state.view.y = 0; state.view.k = 1; applyView();
        }
      });
    });

    document.getElementById('modeToggle').addEventListener('click', () => {
      if (state.fullLoading) return;
      if (state.mode === 'full') {
        setPayload(window.ATLAS_READER, false);
        renderAll();
        return;
      }
      if (!window.confirm('完整星图会显示尚未发布的人物、关系与伏笔，可能包含剧透。继续？')) return;
      state.fullLoading = true;
      updateModeUI();
      loadFull().then(payload => {
        setPayload(payload, true);
        state.fullLoading = false;
        renderAll();
      }).catch(() => {
        state.fullLoading = false;
        updateModeUI();
        document.getElementById('modeNote').textContent = '完整数据加载失败，请刷新后再试。';
      });
    });

    svg.addEventListener('wheel', event => {
      event.preventDefault();
      const point = toSvgPoint(event);
      const next = clamp(state.view.k * Math.pow(1.0015, -event.deltaY), 0.55, 2.8);
      const ux = (point.x - state.view.x) / state.view.k;
      const uy = (point.y - state.view.y) / state.view.k;
      state.view.x = point.x - ux * next;
      state.view.y = point.y - uy * next;
      state.view.k = next;
      applyView();
    }, { passive: false });

    let drag = null;
    svg.addEventListener('pointerdown', event => {
      if (event.target.closest('.atlas-node')) return;
      const ctm = svg.getScreenCTM();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, vx: state.view.x, vy: state.view.y, a: ctm.a, moved: false };
      svg.setPointerCapture(event.pointerId);
      svg.classList.add('is-panning');
    });
    svg.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = (event.clientX - drag.x) / drag.a;
      const dy = (event.clientY - drag.y) / drag.a;
      if (Math.hypot(dx * drag.a, dy * drag.a) > 3) drag.moved = true;
      state.view.x = drag.vx + dx;
      state.view.y = drag.vy + dy;
      applyView();
    });
    function endDrag(event) {
      if (!drag) return;
      state.moved = drag.moved;
      drag = null;
      svg.classList.remove('is-panning');
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    }
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
    svg.addEventListener('click', event => {
      if (state.moved) { state.moved = false; return; }
      if (!event.target.closest('.atlas-node')) select(null);
    });

    const syncCompact = () => mapWrap.classList.toggle('is-compact', mapWrap.clientWidth < 620);
    if ('ResizeObserver' in window) new ResizeObserver(syncCompact).observe(mapWrap);
    else window.addEventListener('resize', syncCompact);
    syncCompact();

    window.addEventListener('hashchange', () => {
      const id = decodeURIComponent(location.hash.replace(/^#/, ''));
      if (id && nodeById[id]) select(id, false);
    });
  }

  function init() {
    if (!window.ATLAS_READER) {
      panel.innerHTML = '<div class="atlas-empty">读者数据没有加载。请确认 <code>atlas/generated/reader.js</code> 已生成，并通过站点服务器打开本页。</div>';
      return;
    }
    setPayload(window.ATLAS_READER, false);
    renderAll();
    bindInteractions();
    const initial = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (initial && nodeById[initial]) select(initial, false);
  }

  init();
})();
