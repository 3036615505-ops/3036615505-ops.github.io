// @ts-check
/* 阅读数据存取 —— 进度、书签、摘句、设置持久化
   设计说明、历史与踩坑记录见 _design/notes/reader.store.js.md（原文按行号归档）。 */
(function() {
  'use strict';
  var LY = window.LY || (/** @type {any} */ (window.LY = {}));

  function idFromPath(path) {
    return path.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  }

  var chapterId = idFromPath(window.location.pathname);

  function setChapterId(file) {
    var path = window.location.pathname;
    var dir = path.replace(/[^\/]*$/, '');
    chapterId = idFromPath(dir + file);
    LY.store.chapterId = chapterId;
    return chapterId;
  }

  var STORAGE_SCHEMA = 3;

  /** @returns {void} */
  function migrateStorage() {
    var ver = parseInt(localStorage.getItem('reader-schema'), 10);
    if (isNaN(ver)) ver = 1;
    if (ver >= STORAGE_SCHEMA) return;
    /* 旧数据缺 time/dayTime，normalizeFootprints 会补零；写回一次即完成迁移。
       schema 3 只加了摘句的 range 字段，旧摘句不重写：读取时由 quoteRange()
       补成整段区间，写回与否都不影响展示和「回到这一页」。 */
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

  /* 摘句的定位区间：新记录带 range（段号 + 段内字符偏移），
     旧记录只有整段 index，读的时候补成 {s:index, so:0, e:index, eo:null}。
     eo === null 表示「到这一段末尾」，和偏移 0 不是一回事。 */
  /** @param {any} q @returns {{s:number, so:number, e:number, eo:number|null}|null} */
  function quoteRange(q) {
    if (q && q.range && typeof q.range === 'object') {
      var s = Number(q.range.s);
      var e = Number(q.range.e);
      if (isFinite(s) && isFinite(e) && s > 0 && e >= s) {
        return {
          s: s,
          so: Math.max(0, Number(q.range.so) || 0),
          e: e,
          eo: q.range.eo == null ? null : Math.max(0, Number(q.range.eo) || 0)
        };
      }
    }
    var i = Number(q && q.index);
    if (!isFinite(i) || i <= 0) return null;
    return { s: i, so: 0, e: i, eo: null };
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

  var EXPORT_FONT_DB = 'linyuan-font';
  var EXPORT_FONT_STORE = 'fonts';
  var EXPORT_FONT_REC = 'user';

  function exportFontMime(name) {
    var n = String(name || '').toLowerCase();
    if (/\.woff2$/.test(n)) return 'font/woff2';
    if (/\.woff$/.test(n)) return 'font/woff';
    if (/\.otf$/.test(n)) return 'font/otf';
    if (/\.ttc$/.test(n)) return 'font/collection';
    if (/\.ttf$/.test(n)) return 'font/ttf';
    return 'application/octet-stream';
  }

  function exportBufferToBase64(buf) {
    var bytes = ArrayBuffer.isView(buf)
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    var CH = 0x6000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += CH) {
      var end = Math.min(i + CH, bytes.length);
      var bin = '';
      for (var j = i; j < end; j += 0x800) {
        bin += String.fromCharCode.apply(null, bytes.subarray(j, Math.min(j + 0x800, end)));
      }
      parts.push(btoa(bin));
    }
    return parts.join('');
  }

  /** @returns {Promise<Array>} 永远 resolve，读不到字体时为 [] */
  function readExportFonts() {
    return new Promise(function (resolve) {
      if (!window.indexedDB || typeof btoa !== 'function') { resolve([]); return; }
      var req;
      try { req = indexedDB.open(EXPORT_FONT_DB, 1); }
      catch (e) { resolve([]); return; }
      var fresh = false;
      req.onupgradeneeded = function () {
        /* 从没导入过字体的读者：这里会新建一个空库，get 自然拿不到记录。
           不能 reject —— 这批读者占绝大多数。 */
        fresh = true;
        var db = req.result;
        if (!db.objectStoreNames.contains(EXPORT_FONT_STORE)) {
          db.createObjectStore(EXPORT_FONT_STORE);
        }
      };
      req.onerror = req.onblocked = function () { resolve([]); };
      req.onsuccess = function () {
        var db = req.result;
        function done(v) { try { db.close(); } catch (e) {} resolve(v || []); }
        if (fresh) { done([]); return; }
        try {
          var tx = db.transaction(EXPORT_FONT_STORE, 'readonly');
          var get = tx.objectStore(EXPORT_FONT_STORE).get(EXPORT_FONT_REC);
          get.onsuccess = function () {
            var rec = get.result;
            if (!rec || !rec.data) { done([]); return; }
            try {
              done([{
                db: EXPORT_FONT_DB, store: EXPORT_FONT_STORE, key: EXPORT_FONT_REC,
                name: String(rec.name || '自定义'),
                mime: exportFontMime(rec.name),
                at: rec.at || 0,
                base64: exportBufferToBase64(rec.data)
              }]);
            } catch (e) { done([]); }
          };
          get.onerror = function () { done([]); };
          tx.onerror = tx.onabort = function () { done([]); };
        } catch (e) { done([]); }
      };
    });
  }

  /** @returns {Promise<Object>} 带 bridge / fonts 的完整备份；任何情况下都 resolve */
  function collectReaderDataAsync() {
    function build(fonts) {
      var payload = collectReaderData();
      payload.bridge = 1;
      payload.fonts = fonts;
      return payload;
    }
    return readExportFonts().then(function (fonts) {
      return build(fonts);
    }, function () {
      return build([]);
    });
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
    quoteRange: quoteRange,
    collectReaderData: collectReaderData,
    collectReaderDataAsync: collectReaderDataAsync,
    importReaderData: importReaderData,
    getCurrentFileName: getCurrentFileName,
    getCurrentChapterTitle: getCurrentChapterTitle
  };
})();
