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


  /* ===== S1：带自定义字体的导出桥（Android 全原生化 M1） =====
     自定义字体存在 IndexedDB `linyuan-font` / `fonts` / `user`，localStorage
     里只有文件名（reader-custom-font）；原生版又读不到 WebView 的存储域。
     所以升级成原生 App 之前，必须把字体二进制一并导出成备份文件。

     契约（IMPLEMENTATION §6.2.3）：在 collectReaderData() 的旧结构之外
     **只追加** bridge:1 与 fonts[]，一个旧字段都不删不改 —— 旧备份文件、
     WebView 版自身的 importReaderData()、原生侧导入器三条路径零回归。

     失败降级：隐私模式 / IDB 被禁 / 记录损坏，一律返回 fonts:[]。
     「读字体失败」绝不能变成「整个备份导出不了」。 */

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

  /* ArrayBuffer → base64：按 3 的倍数分块 btoa 再拼接。
     每块 24576 字节，除末块外不会产生 '='，直接 join 仍是合法 base64；
     分块是为了避免 24MB 字体在 WebView 里一次性堆出 ~32MB 字符串峰值。 */
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
    collectReaderData: collectReaderData,
    collectReaderDataAsync: collectReaderDataAsync,
    importReaderData: importReaderData,
    getCurrentFileName: getCurrentFileName,
    getCurrentChapterTitle: getCurrentChapterTitle
  };
})();
