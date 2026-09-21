(function (global) {
  'use strict';

  var TYPES = ['slide', 'image', 'mcq', 'cloze', 'order', 'match', 'canvas', 'ask', 'checkpoint'];
  var INTERACTIVE = { mcq: 1, cloze: 1, order: 1, match: 1, ask: 1 };
  var MAX_BYTES = 25 * 1024 * 1024;
  var INTERVALS = [1, 3, 7, 16, 35];
  var DAY = 86400000;
  var ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
  var DB = 'mentria-packs', STORE = 'packs', VER = 1;

  function isText(v) {
    if (typeof v === 'string') return true;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    var keys = Object.keys(v);
    if (!keys.length) return false;
    for (var i = 0; i < keys.length; i++) if (typeof v[keys[i]] !== 'string') return false;
    return true;
  }

  function text(v, lang) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v !== 'object') return String(v);
    lang = lang || (global.document && global.document.documentElement.lang) || 'en';
    if (v[lang]) return v[lang];
    var base = String(lang).split('-')[0];
    if (v[base]) return v[base];
    if (v.en) return v.en;
    var k = Object.keys(v);
    return k.length ? v[k[0]] : '';
  }

  function bytesOf(obj) {
    try { return new Blob([JSON.stringify(obj)]).size; } catch (_) { return JSON.stringify(obj).length; }
  }

  function validate(pack) {
    var errors = [], warnings = [];
    var err = function (m) { errors.push(m); };
    var warn = function (m) { warnings.push(m); };
    if (!pack || typeof pack !== 'object' || Array.isArray(pack)) { err('pack must be an object'); return { ok: false, errors: errors, warnings: warnings }; }
    if (typeof pack.id !== 'string' || !ID_RE.test(pack.id)) err('id: letters, digits, dots, dashes; 1-100 chars');
    if (pack.version != null && !(Number.isInteger(pack.version) && pack.version >= 1)) err('version: integer >= 1');
    if (!isText(pack.title)) err('title: required text');
    if (pack.subtitle != null && !isText(pack.subtitle)) err('subtitle: text');
    if (pack.language != null && typeof pack.language !== 'string') err('language: string');
    if (pack.modes != null) {
      if (!Array.isArray(pack.modes)) err('modes: array');
      else pack.modes.forEach(function (m) { if (['read', 'quiz', 'review', 'budget'].indexOf(m) < 0) warn('modes: unknown mode ' + m); });
    }
    if (!Array.isArray(pack.cards) || !pack.cards.length) { err('cards: non-empty array'); return { ok: false, errors: errors, warnings: warnings }; }
    if (pack.cards.length > 2000) err('cards: at most 2000');
    var ids = {};
    pack.cards.forEach(function (c, i) {
      var at = 'cards[' + i + ']';
      if (!c || typeof c !== 'object') { err(at + ': object'); return; }
      if (typeof c.id !== 'string' || !ID_RE.test(c.id)) err(at + '.id: required, letters/digits/dots/dashes');
      else if (ids[c.id]) err(at + '.id: duplicate ' + c.id);
      else ids[c.id] = true;
      if (typeof c.type !== 'string') { err(at + '.type: required'); return; }
      if (TYPES.indexOf(c.type) < 0) { warn(at + '.type: unknown ' + c.type + ' (shown as a placeholder)'); return; }
      if (c.title != null && !isText(c.title)) err(at + '.title: text');
      if (c.image != null && typeof c.image !== 'string') err(at + '.image: url or asset path');
      if (c.guess != null) {
        var g = c.guess;
        if (!g || typeof g !== 'object') err(at + '.guess: object');
        else {
          if (!isText(g.prompt)) err(at + '.guess.prompt: text');
          if (['number', 'range', 'choice'].indexOf(g.kind) < 0) err(at + '.guess.kind: number | range | choice');
          if (g.kind === 'choice') {
            if (!Array.isArray(g.choices) || g.choices.length < 2) err(at + '.guess.choices: 2+ items');
            if (typeof g.answer !== 'number' || !g.choices || g.answer < 0 || g.answer >= g.choices.length) err(at + '.guess.answer: index into choices');
          } else if (typeof g.answer !== 'number') err(at + '.guess.answer: number');
          if (g.kind === 'range' && (typeof g.min !== 'number' || typeof g.max !== 'number' || g.min >= g.max)) err(at + '.guess: min < max required for range');
        }
      }
      switch (c.type) {
        case 'slide':
          if (c.body != null && !isText(c.body)) err(at + '.body: text');
          if (c.caption != null && !isText(c.caption)) err(at + '.caption: text');
          if (c.body == null && c.caption == null && c.image == null && c.title == null) err(at + ': slide needs body, caption, title, or image');
          break;
        case 'image':
          if (typeof c.image !== 'string') err(at + '.image: required');
          if (c.hotspots != null) {
            if (!Array.isArray(c.hotspots)) err(at + '.hotspots: array');
            else c.hotspots.forEach(function (h, j) {
              var hat = at + '.hotspots[' + j + ']';
              if (!h || typeof h !== 'object') { err(hat + ': object'); return; }
              ['x', 'y', 'w', 'h'].forEach(function (k) { if (typeof h[k] !== 'number' || h[k] < 0 || h[k] > 100) err(hat + '.' + k + ': percent 0-100'); });
              if (!isText(h.label)) err(hat + '.label: text');
              if (h.body != null && !isText(h.body)) err(hat + '.body: text');
            });
          }
          break;
        case 'mcq':
          if (!isText(c.question)) err(at + '.question: text');
          if (!Array.isArray(c.choices) || c.choices.length < 2) err(at + '.choices: 2+ items');
          else {
            var correct = 0;
            c.choices.forEach(function (ch, j) {
              var cat = at + '.choices[' + j + ']';
              if (!ch || typeof ch !== 'object') { err(cat + ': object'); return; }
              if (!isText(ch.text)) err(cat + '.text: text');
              if (ch.why != null && !isText(ch.why)) err(cat + '.why: text');
              if (ch.correct) correct++;
            });
            if (!correct) err(at + '.choices: mark at least one correct');
            if (correct > 1 && !c.multi) warn(at + ': several correct choices; set multi: true to accept all');
          }
          break;
        case 'cloze':
          if (!isText(c.text)) err(at + '.text: text with {{blank}} markers');
          else {
            var n = (text(c.text, 'en').match(/\{\{[^}]*\}\}/g) || []).length;
            if (!n) err(at + '.text: needs at least one {{blank}}');
            if (!Array.isArray(c.answers) || c.answers.length !== n) err(at + '.answers: one per blank (' + n + ')');
            else c.answers.forEach(function (a, j) { if (!isText(a) && !(Array.isArray(a) && a.length && a.every(isText))) err(at + '.answers[' + j + ']: text or array of accepted texts'); });
          }
          if (c.chips != null && (!Array.isArray(c.chips) || !c.chips.every(isText))) err(at + '.chips: array of text');
          break;
        case 'order':
          if (!isText(c.prompt)) err(at + '.prompt: text');
          if (!Array.isArray(c.items) || c.items.length < 2 || !c.items.every(isText)) err(at + '.items: 2+ texts in correct order');
          break;
        case 'match':
          if (!isText(c.prompt)) err(at + '.prompt: text');
          if (!Array.isArray(c.pairs) || c.pairs.length < 2 || !c.pairs.every(function (p) { return Array.isArray(p) && p.length === 2 && isText(p[0]) && isText(p[1]); })) err(at + '.pairs: 2+ [left, right] pairs');
          break;
        case 'canvas':
          if (typeof c.html !== 'string' || !c.html.trim()) err(at + '.html: required');
          if (c.html && c.html.length > 512 * 1024) err(at + '.html: at most 512 KB');
          break;
        case 'ask':
          if (!isText(c.prompt)) err(at + '.prompt: text');
          if (c.model_answer != null && !isText(c.model_answer)) err(at + '.model_answer: text');
          if (c.rubric != null && !isText(c.rubric)) err(at + '.rubric: text');
          break;
        case 'checkpoint':
          if (!isText(c.summary)) err(at + '.summary: text');
          break;
      }
      if (c.after != null) {
        var afters = Array.isArray(c.after) ? c.after : [c.after];
        afters.forEach(function (a) { if (typeof a !== 'string') err(at + '.after: card id(s)'); });
      }
    });
    pack.cards.forEach(function (c, i) {
      if (!c || c.after == null) return;
      (Array.isArray(c.after) ? c.after : [c.after]).forEach(function (a) { if (!ids[a]) err('cards[' + i + '].after: unknown card ' + a); });
    });
    if (pack.sections != null) {
      if (!Array.isArray(pack.sections) || !pack.sections.length) err('sections: non-empty array when present');
      else {
        var used = {};
        pack.sections.forEach(function (s, i) {
          var sat = 'sections[' + i + ']';
          if (!s || typeof s !== 'object') { err(sat + ': object'); return; }
          if (typeof s.id !== 'string' || !ID_RE.test(s.id)) err(sat + '.id: required');
          if (!isText(s.title)) err(sat + '.title: text');
          if (!Array.isArray(s.cards) || !s.cards.length) err(sat + '.cards: non-empty array of card ids');
          else s.cards.forEach(function (cid) {
            if (!ids[cid]) err(sat + '.cards: unknown card ' + cid);
            else if (used[cid]) err(sat + '.cards: card ' + cid + ' listed twice');
            used[cid] = true;
          });
        });
        Object.keys(ids).forEach(function (cid) { if (!used[cid]) warn('card ' + cid + ' is in no section'); });
      }
    }
    var bytes = bytesOf(pack);
    if (bytes > MAX_BYTES) err('pack is ' + (bytes / 1048576).toFixed(1) + ' MB; limit is 25 MB');
    return { ok: !errors.length, errors: errors, warnings: warnings, bytes: bytes };
  }

  function normalize(pack) {
    var p = JSON.parse(JSON.stringify(pack));
    if (p.version == null) p.version = 1;
    if (!p.language) p.language = 'en';
    if (!p.modes || !p.modes.length) p.modes = ['read', 'quiz', 'review', 'budget'];
    var byId = {};
    p.cards.forEach(function (c) { byId[c.id] = c; });
    if (!p.sections || !p.sections.length) {
      p.sections = [{ id: 'all', title: p.title, cards: p.cards.map(function (c) { return c.id; }) }];
    } else {
      var used = {};
      p.sections.forEach(function (s) { s.cards.forEach(function (id) { used[id] = true; }); });
      var extra = p.cards.filter(function (c) { return !used[c.id]; }).map(function (c) { return c.id; });
      if (extra.length) p.sections.push({ id: 'more', title: p.title, cards: extra });
    }
    p.cards.forEach(function (c) {
      if (c.type === 'mcq' && c.choices.filter(function (ch) { return ch.correct; }).length > 1) c.multi = true;
    });
    return p;
  }

  function gradable(pack) {
    return (pack.cards || []).some(function (c) { return c && (INTERACTIVE[c.type] || c.guess); });
  }
  function availableModes(pack, progress) {
    var declared = pack.modes && pack.modes.length ? pack.modes : ['read', 'quiz', 'review', 'budget'];
    var modes = ['read'];
    if (gradable(pack)) {
      if (declared.indexOf('quiz') >= 0) modes.push('quiz');
      var wrong = progress && progress.cards ? Object.keys(progress.cards).some(function (id) { return progress.cards[id].r === 'wrong'; }) : false;
      if (wrong && declared.indexOf('review') >= 0) modes.push('review');
      if (declared.indexOf('budget') >= 0) modes.push('budget');
    }
    return modes.filter(function (m) { return m === 'read' ? declared.indexOf('read') >= 0 || modes.length === 1 : true; });
  }

  function isCourse(obj) {
    return !!(obj && typeof obj === 'object' && !Array.isArray(obj) && (obj.kind === 'course' || (Array.isArray(obj.packs) && !obj.cards)));
  }
  function validateCourse(course) {
    var errors = [], warnings = [];
    if (!isCourse(course)) { errors.push('not a course'); return { ok: false, errors: errors, warnings: warnings }; }
    if (typeof course.id !== 'string' || !ID_RE.test(course.id)) errors.push('id: letters, digits, dots, dashes; 1-100 chars');
    if (!isText(course.title)) errors.push('title: required text');
    if (!Array.isArray(course.packs) || !course.packs.length) errors.push('packs: non-empty array of packs or https URLs');
    else {
      if (course.packs.length > 200) errors.push('packs: at most 200');
      var seen = {};
      course.packs.forEach(function (p, i) {
        if (typeof p === 'string') { if (!/^https:\/\//.test(p) && !/^\/learn\//.test(p)) errors.push('packs[' + i + ']: https URL or an object'); return; }
        var v = validate(p);
        if (!v.ok) errors.push('packs[' + i + '] (' + (p && p.id) + '): ' + v.errors[0]);
        v.warnings.forEach(function (w) { warnings.push('packs[' + i + ']: ' + w); });
        if (p && p.id) { if (seen[p.id]) errors.push('packs[' + i + ']: duplicate pack id ' + p.id); seen[p.id] = true; }
      });
    }
    return { ok: !errors.length, errors: errors, warnings: warnings };
  }
  function getCourses() {
    var c = global.MentriaStore ? global.MentriaStore.get('packs', 'courses') : null;
    return c && typeof c === 'object' ? c : {};
  }
  function saveCourses(c) { if (global.MentriaStore) global.MentriaStore.set('packs', 'courses', c); }
  function fetchPack(url) {
    return fetch(url, { mode: 'cors' }).then(function (r) { if (!r.ok) throw new Error('fetch failed: ' + r.status + ' ' + url); return r.json(); });
  }
  function importCourse(course, meta) {
    var v = validateCourse(course);
    if (!v.ok) return Promise.reject(Object.assign(new Error(v.errors[0]), { errors: v.errors }));
    return Promise.all(course.packs.map(function (p) { return typeof p === 'string' ? fetchPack(p) : Promise.resolve(p); })).then(function (packs) {
      var order = 0, results = [];
      var chain = Promise.resolve();
      packs.forEach(function (p) {
        var idx = order++;
        chain = chain.then(function () {
          return put(p, Object.assign({}, meta || {}, { course: { id: course.id, order: idx } })).then(function (r) { results.push(r); });
        });
      });
      return chain.then(function () {
        var courses = getCourses();
        var prev = courses[course.id];
        courses[course.id] = {
          id: course.id, version: course.version || 1, title: course.title, subtitle: course.subtitle || null, cover: course.cover || (packs[0] && packs[0].cover) || null,
          packs: packs.map(function (p) { return p.id; }), added: prev ? prev.added : Date.now(), updated: Date.now(), source: (meta && meta.source) || 'import'
        };
        saveCourses(courses);
        emit('course', { id: course.id });
        return { course: courses[course.id], imported: results.length, replaced: !!prev, warnings: v.warnings.concat(results.reduce(function (a, r) { return a.concat(r.warnings); }, [])) };
      });
    });
  }
  function removeCourse(id) {
    var courses = getCourses(), c = courses[id];
    if (!c) return Promise.resolve();
    var chain = Promise.resolve();
    c.packs.forEach(function (pid) { chain = chain.then(function () { return remove(pid); }); });
    return chain.then(function () { delete courses[id]; saveCourses(courses); emit('course', { id: id }); });
  }
  function courseOf(row) { return row && row.course ? row.course.id : null; }
  function importAny(obj, meta) { return isCourse(obj) ? importCourse(obj, meta) : put(obj, meta); }

  function outline(pack) {
    var counts = {};
    pack.cards.forEach(function (c) { counts[c.type] = (counts[c.type] || 0) + 1; });
    var interactive = pack.cards.filter(function (c) { return INTERACTIVE[c.type]; }).length;
    return {
      cards: pack.cards.length,
      interactive: interactive,
      types: counts,
      sections: (pack.sections || []).map(function (s) { return { id: s.id, title: text(s.title), cards: s.cards.length }; }),
      minutes: pack.minutes || Math.max(1, Math.round(pack.cards.length * 0.6 + interactive * 0.6))
    };
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('no indexeddb')); return; }
      var req = global.indexedDB.open(DB, VER);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function tx(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode), s = t.objectStore(STORE), out = fn(s);
        t.oncomplete = function () { db.close(); resolve(out && out.result !== undefined ? out.result : undefined); };
        t.onerror = function () { db.close(); reject(t.error); };
      });
    });
  }

  function put(pack, meta) {
    var v = validate(pack);
    if (!v.ok) return Promise.reject(Object.assign(new Error(v.errors[0]), { errors: v.errors }));
    var p = normalize(pack);
    var row = {
      id: p.id, version: p.version, title: p.title, subtitle: p.subtitle || null, cover: p.cover || null,
      cards: p.cards.length, bytes: v.bytes, added: Date.now(), source: (meta && meta.source) || 'import', from: (meta && meta.from) || null, pack: p,
      course: (meta && meta.course) || p.course || null
    };
    return get(p.id).then(function (existing) {
      if (existing) row.added = existing.added;
      row.updated = Date.now();
      return tx('readwrite', function (s) { s.put(row); }).then(function () {
        emit('put', row);
        return { row: row, replaced: !!existing, warnings: v.warnings };
      });
    });
  }
  function get(id) { return tx('readonly', function (s) { return s.get(id); }).catch(function () { return undefined; }); }
  function list() {
    return tx('readonly', function (s) { return s.getAll(); }).then(function (rows) {
      return (rows || []).map(function (r) { var o = Object.assign({}, r); delete o.pack; return o; }).sort(function (a, b) { return (b.updated || b.added) - (a.updated || a.added); });
    }).catch(function () { return []; });
  }
  function remove(id) {
    return tx('readwrite', function (s) { s.delete(id); }).then(function () {
      if (global.MentriaStore) global.MentriaStore.remove('packs', 'p.' + id);
      emit('remove', { id: id });
    });
  }
  function emit(kind, detail) {
    try { global.dispatchEvent(new CustomEvent('mentria:packs', { detail: { kind: kind, id: detail && detail.id } })); } catch (_) {}
  }

  function parse(textIn) {
    var t = String(textIn || '').trim();
    if (!t) throw new Error('empty');
    if (t.charAt(0) !== '{') throw new Error('not a pack or course file');
    return JSON.parse(t);
  }
  function importText(textIn, meta) { return Promise.resolve().then(function () { return importAny(parse(textIn), meta); }); }
  function importFile(file, meta) {
    if (!file) return Promise.reject(new Error('no file'));
    if (file.size > MAX_BYTES) return Promise.reject(new Error('file is larger than 25 MB'));
    return file.text().then(function (t) { return importAny(parse(t), Object.assign({ from: file.name }, meta || {})); });
  }
  function importUrl(url, meta) {
    var u;
    try { u = new URL(url, global.location && global.location.href); } catch (_) { return Promise.reject(new Error('bad url')); }
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return Promise.reject(new Error('https only'));
    return fetch(u.href, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('fetch failed: ' + r.status);
      var len = +r.headers.get('content-length') || 0;
      if (len > MAX_BYTES) throw new Error('file is larger than 25 MB');
      return r.text();
    }).then(function (t) { return importAny(parse(t), Object.assign({ from: u.href }, meta || {})); });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function getDays() { var d = global.MentriaStore ? global.MentriaStore.get('packs', 'days') : null; return d && typeof d === 'object' ? d : {}; }
  function markDay() {
    if (!global.MentriaStore) return;
    var days = getDays(), k = dayKey();
    days[k] = (days[k] || 0) + 1;
    var keys = Object.keys(days).sort();
    while (keys.length > 120) delete days[keys.shift()];
    global.MentriaStore.set('packs', 'days', days);
  }
  function week(d) {
    d = d || new Date();
    var days = getDays(), today = dayKey(d);
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dow = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dow);
    var out = [];
    for (var i = 0; i < 7; i++) {
      var x = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var k = dayKey(x);
      out.push({ key: k, on: !!days[k], today: k === today, count: days[k] || 0 });
    }
    return out;
  }
  function progressKey(id) { return 'p.' + id; }
  function getProgress(id) {
    var p = global.MentriaStore ? global.MentriaStore.get('packs', progressKey(id)) : null;
    if (!p || typeof p !== 'object') p = { cards: {}, mode: null, last: 0 };
    if (!p.cards) p.cards = {};
    return p;
  }
  function saveProgress(id, p) {
    p.last = Date.now();
    if (global.MentriaStore) global.MentriaStore.set('packs', progressKey(id), p);
    return p;
  }
  function recordSeen(id, cardId) {
    var p = getProgress(id), c = p.cards[cardId] || { n: 0, s: 0 };
    c.n = (c.n || 0) + 1;
    if (!c.r) c.r = 'seen';
    c.t = Date.now();
    p.cards[cardId] = c;
    markDay();
    return saveProgress(id, p);
  }
  function recordAnswer(id, cardId, right, extra) {
    var p = getProgress(id), c = p.cards[cardId] || { n: 0, s: 0 };
    c.n = (c.n || 0) + 1;
    c.r = right ? 'right' : 'wrong';
    c.s = right ? Math.min((c.s || 0) + 1, INTERVALS.length - 1) : 0;
    c.d = Date.now() + INTERVALS[c.s] * DAY;
    c.t = Date.now();
    if (extra && typeof extra.distance === 'number') c.g = extra.distance;
    p.cards[cardId] = c;
    markDay();
    return saveProgress(id, p);
  }
  function setMode(id, mode) { var p = getProgress(id); p.mode = mode; return saveProgress(id, p); }
  function resetProgress(id) { return saveProgress(id, { cards: {}, mode: getProgress(id).mode, last: 0 }); }
  function summary(pack, p) {
    p = p || getProgress(pack.id);
    var seen = 0, right = 0, wrong = 0, due = 0, now = Date.now();
    pack.cards.forEach(function (c) {
      var r = p.cards[c.id];
      if (!r) return;
      seen++;
      if (r.r === 'right') right++;
      if (r.r === 'wrong') wrong++;
      if (r.d && r.d <= now) due++;
    });
    return { total: pack.cards.length, seen: seen, right: right, wrong: wrong, due: due, done: seen >= pack.cards.length };
  }

  var api = {
    TYPES: TYPES, INTERACTIVE: INTERACTIVE, MAX_BYTES: MAX_BYTES, INTERVALS: INTERVALS,
    text: text, isText: isText, validate: validate, normalize: normalize, outline: outline, gradable: gradable, availableModes: availableModes,
    isCourse: isCourse, validateCourse: validateCourse, importCourse: importCourse, importAny: importAny, getCourses: getCourses, removeCourse: removeCourse, courseOf: courseOf,
    put: put, get: get, list: list, remove: remove,
    importText: importText, importFile: importFile, importUrl: importUrl,
    getProgress: getProgress, recordSeen: recordSeen, recordAnswer: recordAnswer, setMode: setMode, resetProgress: resetProgress, summary: summary,
    dayKey: dayKey, getDays: getDays, week: week
  };
  global.MentriaPacks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
