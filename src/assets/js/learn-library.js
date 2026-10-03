(function () {
  'use strict';
  var P = window.MentriaPacks;
  var T = window.MENTRIA_LEARN_PAGE || {};
  if (!P) return;
  var t = function (k, vars) {
    var s = T[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(String(vars[v])); });
    return s;
  };
  var lang = document.documentElement.lang || 'en';
  var plural = (function () {
    try { var rules = new Intl.PluralRules(lang); return function (n) { return rules.select(n); }; } catch (_) { return function (n) { return n === 1 ? 'one' : 'other'; }; }
  })();
  var tn = function (k, n, vars) {
    return t(plural(n) === 'one' && T[k + '_one'] ? k + '_one' : k, Object.assign({ n: n }, vars || {}));
  };
  var prefix = T.prefix || '';
  var list = document.getElementById('learn-list');
  var empty = document.getElementById('learn-empty');
  var status = document.getElementById('learn-status');
  var importBox = document.getElementById('learn-import');
  var toggle = document.getElementById('learn-import-toggle');
  var fileInput = document.getElementById('learn-file');
  var drop = document.getElementById('learn-drop');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(msg, kind, detail) {
    if (!status) return;
    status.textContent = msg;
    status.dataset.kind = kind || '';
    if (!detail) return;
    var small = document.createElement('small');
    small.textContent = detail;
    status.append(' ', document.createElement('br'), small);
  }

  function mark(li, seen, total) {
    var done = !!total && seen >= total;
    li.classList.toggle('is-done', done);
    li.classList.toggle('is-started', seen > 0 && !done);
    var text = done ? t('finished') : (seen ? t('progress_n', { n: Math.min(99, Math.round((seen / total) * 100)) }) : '');
    var badge = li.querySelector('.learn-tile__badge');
    if (!text) { if (badge) badge.remove(); return; }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'learn-tile__badge';
      var link = li.querySelector('.learn-tile__link');
      link.insertBefore(badge, link.firstChild);
    }
    badge.textContent = text;
  }

  function tile(row) {
    var li = document.createElement('li');
    li.className = 'learn-tile learn-tile--mine';
    li.dataset.packId = row.id;
    var sum = null;
    try { sum = P.summary(row.pack || { id: row.id, cards: row.cardList || [] }, P.getProgress(row.id)); } catch (_) {}
    var pct = sum && sum.total ? Math.round((sum.seen / sum.total) * 100) : 0;
    li.innerHTML =
      '<a class="learn-tile__link" href="' + esc(prefix + '/learn/play/?id=' + encodeURIComponent(row.id)) + '">' +
        (row.cover ? '<img class="learn-tile__cover" src="' + esc(row.cover) + '" alt="" loading="lazy">' : '<span class="learn-tile__cover learn-tile__cover--blank"></span>') +
        '<span class="learn-tile__body">' +
          '<span class="learn-tile__title">' + esc(P.text(row.title, lang)) + '</span>' +
          '<span class="learn-tile__meta">' + esc(tn('cards_n', row.cards)) + (row.source === 'contact' ? ' · ' + esc(t('from_contact')) : '') + '</span>' +
          '<span class="learn-tile__progress"' + (pct ? '' : ' hidden') + '><span class="learn-tile__progress-fill" style="width:' + pct + '%"></span></span>' +
        '</span>' +
      '</a>' +
      '<button type="button" class="learn-tile__share" aria-label="' + esc(t('share')) + '" title="' + esc(t('share')) + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.7" x2="15.4" y2="6.3"/><line x1="8.6" y1="13.3" x2="15.4" y2="17.7"/></svg>' +
      '</button>' +
      '<button type="button" class="learn-tile__remove" aria-label="' + esc(t('remove')) + '" title="' + esc(t('remove')) + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>';
    var blank = li.querySelector('.learn-tile__cover--blank');
    if (blank && window.MentriaBackdrop) window.MentriaBackdrop.apply(blank, 'tile/' + row.id, { square: true });
    if (sum) mark(li, sum.seen, sum.total);
    li.querySelector('.learn-tile__share').addEventListener('click', function () {
      P.get(row.id).then(function (full) {
        if (!full || !full.pack) return;
        var blob = new Blob([JSON.stringify(full.pack)], { type: 'application/json' });
        var name = row.id + '.mentria.json';
        if (window.MentriaUI && window.MentriaUI.shareFile) window.MentriaUI.shareFile(name, blob);
        else if (window.MentriaUI && window.MentriaUI.downloadFile) window.MentriaUI.downloadFile(name, blob);
        say(t('shared_hint'), 'ok');
      });
    });
    li.querySelector('.learn-tile__remove').addEventListener('click', function () {
      var ask = window.mentriaConfirm ? window.mentriaConfirm(t('remove_confirm', { title: P.text(row.title, lang) }), { danger: true }) : Promise.resolve(true);
      Promise.resolve(ask).then(function (ok) { if (ok) P.remove(row.id).then(refresh); });
    });
    return li;
  }

  var SHOW = 6;
  var expanded = {};
  function courseHead(course, rows) {
    var li = document.createElement('li');
    li.className = 'learn-course';
    li.dataset.courseId = course.id;
    var done = rows.filter(function (r) { return r.cardList && r.cardList.length && P.summary({ id: r.id, cards: r.cardList }, P.getProgress(r.id)).done; }).length;
    li.innerHTML =
      '<span class="learn-course__k">' + esc(t('course')) + '</span>' +
      '<span class="learn-course__title">' + esc(P.text(course.title, lang)) + '</span>' +
      '<span class="learn-course__meta">' + esc(tn('course_packs_n', rows.length, { done: done, total: rows.length })) + '</span>' +
      '<button type="button" class="learn-course__remove learn-link">' + esc(t('remove_course')) + '</button>';
    li.querySelector('.learn-course__remove').addEventListener('click', function () {
      var ask = window.mentriaConfirm ? window.mentriaConfirm(t('remove_course_confirm', { title: P.text(course.title, lang) }), { danger: true }) : Promise.resolve(true);
      Promise.resolve(ask).then(function (ok) { if (ok) P.removeCourse(course.id).then(refresh); });
    });
    return li;
  }

  var shelf = null, wide = false, folds = 0;
  function refresh() {
    return P.list().then(function (rows) { shelf = rows; render(); });
  }
  function render() {
    var rows = shelf || [];
    wide = searching();
    folds = 0;
    list.innerHTML = '';
    var courses = P.getCourses();
    var grouped = {}, placed = {};
    rows.forEach(function (r) {
      var cid = P.courseOf(r), c = cid && courses[cid];
      if (!c || (Array.isArray(c.packs) && c.packs.indexOf(r.id) < 0)) return;
      (grouped[cid] = grouped[cid] || []).push(r);
      placed[r.id] = true;
    });
    Object.keys(courses).sort(function (a, b) { return (courses[b].updated || 0) - (courses[a].updated || 0); }).forEach(function (cid) {
      var packs = (grouped[cid] || []).sort(function (a, b) { return (a.course.order || 0) - (b.course.order || 0); });
      if (!packs.length) return;
      var name = P.text(courses[cid].title, lang);
      list.appendChild(courseHead(courses[cid], packs));
      var firstOpen = packs.findIndex(function (r) { var pr = P.getProgress(r.id); return Object.keys(pr.cards || {}).length < r.cards; });
      var start = Math.max(0, (firstOpen < 0 ? packs.length : firstOpen) - 1);
      var visible = expanded[cid] ? packs : packs.slice(start, start + SHOW);
      folds += packs.length - visible.length;
      (wide ? packs : visible).forEach(function (r) { var li = tile(r); li.dataset.course = name; list.appendChild(li); });
      if (!wide && visible.length < packs.length) {
        var moreLi = document.createElement('li');
        moreLi.className = 'learn-course__more';
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'learn-btn';
        b.textContent = tn('show_all_packs', packs.length);
        b.addEventListener('click', function () { expanded[cid] = true; refresh(); });
        moreLi.appendChild(b);
        list.appendChild(moreLi);
      }
    });
    var loose = rows.filter(function (r) { return !placed[r.id]; });
    if (loose.length && Object.keys(grouped).length) { var h = document.createElement('li'); h.className = 'learn-course learn-course--loose'; h.innerHTML = '<span class="learn-course__title">' + esc(t('single_packs')) + '</span>'; list.appendChild(h); }
    loose.forEach(function (r) { list.appendChild(tile(r)); });
    list.hidden = !rows.length;
    empty.hidden = !!rows.length;
    renderContinue();
    filter();
  }

  function nativeProgress() {
    var tiles = document.querySelectorAll('.learn-grid--native .learn-tile');
    Array.prototype.forEach.call(tiles, function (li) {
      var p = P.getProgress(li.dataset.packId);
      var seen = Object.keys(p.cards || {}).length;
      if (!seen) return;
      var meta = li.querySelector('.learn-tile__meta');
      var m = meta && meta.textContent.match(/^(\d+)/);
      var total = m ? +m[1] : 0;
      var bar = li.querySelector('.learn-tile__progress');
      if (!bar || !total) return;
      bar.hidden = false;
      bar.querySelector('.learn-tile__progress-fill').style.width = Math.min(100, Math.round((seen / total) * 100)) + '%';
      mark(li, seen, total);
    });
  }

  function renderContinue() {
    var box = document.getElementById('learn-continue');
    var row = document.getElementById('learn-continue-list');
    if (!box || !row) return;
    var picks = [];
    Array.prototype.forEach.call(document.querySelectorAll('.learn-grid--native .learn-tile.is-started, #learn-list .learn-tile.is-started'), function (li) {
      picks.push({ last: P.getProgress(li.dataset.packId).last || 0, li: li });
    });
    picks.sort(function (a, b) { return b.last - a.last; });
    row.innerHTML = '';
    picks.slice(0, 10).forEach(function (x) {
      var c = x.li.cloneNode(true);
      c.classList.remove('is-extra', 'is-miss');
      Array.prototype.forEach.call(c.querySelectorAll('.learn-tile__share, .learn-tile__remove'), function (b) { b.remove(); });
      row.appendChild(c);
    });
    box.hidden = !picks.length;
  }

  var ROW = 12;
  function shelves() {
    Array.prototype.forEach.call(document.querySelectorAll('.learn-shelf--native'), function (sec) {
      var grid = sec.querySelector('.learn-grid--native');
      var btn = sec.querySelector('.learn-shelf__all');
      var tiles = grid ? grid.querySelectorAll('.learn-tile') : [];
      if (!btn || tiles.length <= ROW) return;
      sec.classList.add('is-row');
      Array.prototype.forEach.call(tiles, function (li, i) { if (i >= ROW) li.classList.add('is-extra'); });
      function label() {
        var open = grid.classList.contains('is-expanded');
        btn.textContent = open ? t('show_less') : tn('see_all', tiles.length);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      }
      label();
      btn.hidden = false;
      btn.addEventListener('click', function () {
        var open = grid.classList.toggle('is-expanded');
        label();
        if (!open) sec.scrollIntoView({ block: 'start' });
      });
    });
  }

  var q = document.getElementById('learn-q');
  var none = document.getElementById('learn-none');
  function norm(v) { return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
  function searching() { return !!(q && norm(q.value)); }
  function applySearch() {
    if (!q) return;
    if (shelf && folds && searching() !== wide) { render(); return; }
    filter();
  }
  function filter() {
    if (!q) return;
    var v = norm(q.value);
    document.body.classList.toggle('learn-searching', !!v);
    var hits = 0;
    Array.prototype.forEach.call(document.querySelectorAll('.learn-shelf--native, .learn-mine'), function (sec) {
      var head = sec.querySelector('h2');
      var where = head ? norm(head.textContent) + ' ' : '';
      var n = 0;
      Array.prototype.forEach.call(sec.querySelectorAll('.learn-tile'), function (li) {
        var title = li.querySelector('.learn-tile__title');
        var ok = !v || (where + norm(li.dataset.course) + ' ' + norm(title && title.textContent)).indexOf(v) >= 0;
        li.classList.toggle('is-miss', !ok);
        if (ok) n++;
      });
      sec.classList.toggle('is-empty', !!v && !n);
      hits += n;
    });
    var group = null, shown = 0;
    var endGroup = function () { if (group) group.style.display = v && !shown ? 'none' : ''; };
    Array.prototype.forEach.call(list.children, function (li) {
      if (li.classList.contains('learn-course')) { endGroup(); group = li; shown = 0; }
      else if (li.classList.contains('learn-tile') && !li.classList.contains('is-miss')) shown++;
    });
    endGroup();
    if (none) {
      none.hidden = !v || hits > 0;
      none.textContent = none.hidden ? '' : t('no_match', { q: q.value.trim() });
    }
  }
  if (q) {
    var timer = 0;
    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(applySearch, 120); });
    q.addEventListener('keydown', function (e) { if (e.key === 'Escape' && q.value) { q.value = ''; applySearch(); } });
  }

  function handleResult(res) {
    if (res.course) say(tn('imported_course', res.imported, { title: P.text(res.course.title, lang) }) + (res.warnings.length ? ' · ' + res.warnings[0] : ''), 'ok');
    else say(t(res.replaced ? 'replaced' : 'imported', { title: P.text(res.row.title, lang) }) + (res.warnings.length ? ' · ' + res.warnings[0] : ''), 'ok');
    refresh();
  }
  var ERRS = { empty: 'import_err_empty', json: 'import_err_json', kind: 'import_err_kind', size: 'import_err_size', invalid: 'import_err_invalid', network: 'import_err_network', url: 'import_err_url' };
  function handleError(e) {
    var code = e && Object.prototype.hasOwnProperty.call(ERRS, e.code) ? e.code : '';
    var detail = '';
    if (code === 'invalid') detail = (e.errors && e.errors.length ? e.errors : [e.message]).slice(0, 3).join('; ');
    else if (code === 'json' && e.line) detail = t('import_err_at', { line: e.line, column: e.column });
    else if (code === 'network' && e.status) detail = 'HTTP ' + e.status;
    else if (!code) detail = (e && e.message) || String(e);
    say(t('import_failed') + ' ' + t(code ? ERRS[code] : 'import_err_other'), 'error', detail);
  }

  function importFile(file) {
    if (!file) return;
    say(t('importing'));
    P.importFile(file).then(handleResult, handleError);
  }

  if (toggle && importBox) {
    toggle.addEventListener('click', function () {
      var open = importBox.hidden;
      importBox.hidden = !open;
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
  if (fileInput) fileInput.addEventListener('change', function () { importFile(fileInput.files[0]); fileInput.value = ''; });
  if (drop) {
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); }); });
    drop.addEventListener('drop', function (e) { importFile(e.dataTransfer && e.dataTransfer.files[0]); });
  }
  var urlGo = document.getElementById('learn-url-go'), urlIn = document.getElementById('learn-url');
  if (urlGo) urlGo.addEventListener('click', function () {
    if (!urlIn.value.trim()) return;
    say(t('importing'));
    P.importUrl(urlIn.value.trim()).then(function (r) { urlIn.value = ''; handleResult(r); }, handleError);
  });
  if (urlIn) urlIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); urlGo.click(); } });
  var pasteGo = document.getElementById('learn-paste-go'), pasteIn = document.getElementById('learn-paste');
  if (pasteGo) pasteGo.addEventListener('click', function () {
    if (!pasteIn.value.trim()) return;
    say(t('importing'));
    P.importText(pasteIn.value).then(function (r) { pasteIn.value = ''; handleResult(r); }, handleError);
  });
  var example = document.getElementById('learn-example');
  if (example) example.addEventListener('click', function () {
    if (importBox.hidden) toggle.click();
    say(t('importing'));
    P.importUrl(location.origin + '/assets/packs/example.mentria.json').then(handleResult, handleError);
  });
  var params = new URLSearchParams(location.search);
  var packUrl = params.get('pack');
  if (packUrl) {
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    var host = packUrl;
    try { host = new URL(packUrl, location.href).host; } catch (_) {}
    var ask = window.mentriaConfirm ? window.mentriaConfirm(t('import_url_confirm', { host: host })) : Promise.resolve(false);
    Promise.resolve(ask).then(function (ok) {
      if (!ok) return;
      if (importBox && importBox.hidden) toggle.click();
      say(t('importing'));
      P.importUrl(packUrl).then(handleResult, handleError);
    });
  }
  window.addEventListener('mentria:packs', refresh);
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    nativeProgress();
    refresh();
  });
  nativeProgress();
  shelves();
  refresh();
})();
