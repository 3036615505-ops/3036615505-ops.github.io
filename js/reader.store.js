// @ts-check
/**
 * 存储层 —— 所有 localStorage 读写的唯一入口
 *
 * 这个文件不认识 DOM，也不认识滚动。它只保证三件事：
 *   1. 键名与格式集中在这一个地方（加字段不会漏改某一处）
 *   2. 读到旧数据时补齐形状（normalizeFootprints）
 *   3. 能整体导出 / 导入（备份恢复、换设备迁移）
 *
 * 依赖：无。被 reader.engine.js 与 reader.ui.js 使用。
 */
(function() {
  'use strict';
  var LY = window.LY || (/** @type {any} */ (window.LY = {}));


  function idFromPath(path) {
    return path.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  }

  var chapterId = idFromPath(window.location.pathname);

  /* 换章不换页时页面路径由 replaceState 改写，章节 id 必须跟着换 —— 否则
     进度、锚点、读完标记全都还记在上一章名下。传文件名（chapter-0N.html），
     目录沿用当前页面的目录。 */
  function setChapterId(file) {
    var path = window.location.pathname;
    var dir = path.replace(/[^\/]*$/, '');
    chapterId = idFromPath(dir + file);
    LY.store.chapterId = chapterId;
    return chapterId;
  }


  /* ===== 存储版本 =====
     阅读数据全部住在 localStorage 的 reader-* 键里，是「本地优先」的唯一副本
     —— 所以两件事必须做对：加字段时能迁移，数据能导出。
     v1 → v2：footprints 增补 time（累计秒）与 dayTime（按天秒数）。 */

  var STORAGE_SCHEMA = 2;


  /** @returns {void} */
  function migrateStorage() {
    var ver = parseInt(localStorage.getItem('reader-schema'), 10);
    if (isNaN(ver)) ver = 1;
    if (ver >= STORAGE_SCHEMA) return;
    /* 旧数据缺 time/dayTime，normalizeFootprints 会补零；写回一次即完成迁移 */
    localStorage.setItem('reader-footprints', JSON.stringify(readFootprints()));
    localStorage.setItem('reader-schema', String(STORAGE_SCHEMA));
  }


  /** @returns {Anchor|null} */
  function readAnchor() {
    var raw = localStorage.getItem('reader-anchor-' + chapterId);
    if (!raw) return null;
    try {
      var a = JSON.parse(raw);
      return (a && typeof a.i === 'number') ? a : null;
    } catch (err) { return null; }
  }



  function getStoredQuotes() {
    var raw = localStorage.getItem('reader-quotes');
    if (!raw) return [];
    try { return JSON.parse(raw) || []; } catch (err) { return []; }
  }


  function saveStoredQuotes(quotes) {
    localStorage.setItem('reader-quotes', JSON.stringify(quotes));
    mergeFootprints(function(data) {
      data.quotes = quotes.map(function(item) { return item.id; });
      return data;
    });
  }


  function recordFootprints() {
    mergeFootprints(function(data) {
      var today = getTodayToken();
      if (!Array.isArray(data.days)) data.days = [];
      if (data.days.indexOf(today) === -1) data.days.push(today);
      data.lastChapterTitle = getCurrentChapterTitle();
      data.lastChapterFile = getCurrentFileName();
      if (!Array.isArray(data.quotes)) data.quotes = [];
      if (!data.themeCounts || typeof data.themeCounts !== 'object') data.themeCounts = {};
      return data;
    });
  }


  function recordThemeUse(theme) {
    mergeFootprints(function(data) {
      if (!data.themeCounts || typeof data.themeCounts !== 'object') data.themeCounts = {};
      data.themeCounts[theme] = (data.themeCounts[theme] || 0) + 1;
      data.lastTheme = theme;
      return data;
    });
  }


  /** @param {(data: Footprints) => (Footprints|void)} mutator @returns {void} */
  function mergeFootprints(mutator) {
    var data = readFootprints();
    data = mutator(data) || data;
    localStorage.setItem('reader-footprints', JSON.stringify(normalizeFootprints(data)));
  }


  /** @returns {Footprints} */
  function readFootprints() {
    var raw = localStorage.getItem('reader-footprints');
    if (!raw) return normalizeFootprints(null);
    try { return normalizeFootprints(JSON.parse(raw)); } catch (err) { return normalizeFootprints(null); }
  }

  /* 单一入口保证形状：读的时候补、写的时候补，任何一处少字段都不会
     在别处变成 undefined。加字段就写在这里 + 升 STORAGE_SCHEMA。 */

  /** @param {any} data @returns {Footprints} */
  function normalizeFootprints(data) {
    if (!data || typeof data !== 'object') data = {};
    if (!Array.isArray(data.days)) data.days = [];
    if (!Array.isArray(data.quotes)) data.quotes = [];
    if (!data.themeCounts || typeof data.themeCounts !== 'object') data.themeCounts = {};
    if (typeof data.time !== 'number' || !isFinite(data.time) || data.time < 0) data.time = 0;
    if (!data.dayTime || typeof data.dayTime !== 'object') data.dayTime = {};
    data.v = STORAGE_SCHEMA;
    return data;
  }


  function trimDayTime(map) {
    var keys = Object.keys(map);
    if (keys.length <= 180) return;
    keys.sort();
    for (var i = 0; i < keys.length - 180; i++) delete map[keys[i]];
  }


  function getTodayToken() {
    var d = new Date();
    return [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-');
  }


  function getCurrentFileName() {
    var path = window.location.pathname;
    return path.substring(path.lastIndexOf('/') + 1) || 'chapter-01.html';
  }


  /** 当前章的标题。
   *  无限流下页面里躺着好几章，直接取第一个 h1 会永远返回第一章 ——
   *  所以有章节块时只认探测线所在那一块。 */
  function getCurrentChapterTitle() {
    var engine = window.LY && window.LY.engine;
    var block = engine && engine.currentBlock ? engine.currentBlock() : null;
    var el = (block || document).querySelector('.chapter-content h1');
    return el ? el.textContent.trim() : document.title;
  }


  var DATA_KEY_RE = /^reader-[a-z0-9-]+$/;

  function collectReaderData() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || !DATA_KEY_RE.test(key)) continue;
      data[key] = localStorage.getItem(key);
    }
    var counts = {
      chapters: 0, quotes: 0, seconds: 0
    };
    for (var k in data) {
      if (k.indexOf('reader-pos-') === 0) counts.chapters++;
    }
    var fp = readFootprints();
    counts.quotes = fp.quotes.length;
    counts.seconds = fp.time;
    return {
      app: 'linyuan-reader',
      schema: STORAGE_SCHEMA,
      exportedAt: new Date().toISOString(),
      summary: counts,
      data: data
    };
  }


  /** @param {string} text @returns {string} 出错时返回中文原因，成功返回空串 */
  function importReaderData(text) {
    var payload;
    try { payload = JSON.parse(text); } catch (e) { return '内容不是合法的备份格式'; }
    if (!payload || typeof payload !== 'object' || !payload.data || typeof payload.data !== 'object') {
      return '内容不像阅读数据备份';
    }
    var keys = Object.keys(payload.data);
    var applied = 0;
    keys.forEach(function(k) {
      if (!DATA_KEY_RE.test(k)) return;
      var v = payload.data[k];
      if (typeof v !== 'string') return;
      localStorage.setItem(k, v);
      applied++;
    });
    if (!applied) return '备份里没有可恢复的阅读数据';
    localStorage.setItem('reader-schema', String(STORAGE_SCHEMA));
    return '';
  }

  /* 锚点写入：和进度一起落盘，格式固定为 {p, i, o} */
  /** @param {Anchor|null} anchor @returns {void} */
  function writeAnchor(anchor) {
    if (!anchor) return;
    try {
      localStorage.setItem('reader-anchor-' + chapterId, JSON.stringify(anchor));
    } catch (err) { /* 存满/隐私模式：位置丢了也比页面崩了强 */ }
  }

  LY.store = {
    chapterId: chapterId,
    setChapterId: setChapterId,
    STORAGE_SCHEMA: STORAGE_SCHEMA,
    DATA_KEY_RE: DATA_KEY_RE,
    migrate: migrateStorage,
    readFootprints: readFootprints,
    mergeFootprints: mergeFootprints,
    recordFootprints: recordFootprints,
    recordThemeUse: recordThemeUse,
    getTodayToken: getTodayToken,
    trimDayTime: trimDayTime,
    readAnchor: readAnchor,
    writeAnchor: writeAnchor,
    getStoredQuotes: getStoredQuotes,
    saveStoredQuotes: saveStoredQuotes,
    collectReaderData: collectReaderData,
    importReaderData: importReaderData,
    getCurrentFileName: getCurrentFileName,
    getCurrentChapterTitle: getCurrentChapterTitle
  };
})();
