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
  var prefix = T.prefix || '';
  var list = document.getElementById('learn-list');
  var empty = document.getElementById('learn-empty');
  var status = document.getElementById('learn-status');
  var importBox = document.getElementById('learn-import');
  var toggle = document.getElementById('learn-import-toggle');
  var fileInput = document.getElementById('learn-file');
  var drop = document.getElementById('learn-drop');

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function say(msg, kind) {
    if (!status) return;
    status.textContent = msg;
    status.dataset.kind = kind || '';
  }

  function tile(row) {
    var li = document.createElement('li');
    li.className = 'learn-tile learn-tile--mine';
    li.dataset.packId = row.id;
    var sum = null;
    try { sum = P.summary(row.pack || { id: row.id, cards: new Array(row.cards) }, P.getProgress(row.id)); } catch (_) {}
    var pct = sum && sum.total ? Math.round((sum.seen / sum.total) * 100) : 0;
    li.innerHTML =
      '<a class="learn-tile__link" href="' + esc(prefix + '/learn/play/?id=' + encodeURIComponent(row.id)) + '">' +
        (row.cover ? '<img class="learn-tile__cover" src="' + esc(row.cover) + '" alt="" loading="lazy">' : '<span class="learn-tile__cover learn-tile__cover--blank"></span>') +
        '<span class="learn-tile__body">' +
          '<span class="learn-tile__title">' + esc(P.text(row.title, lang)) + '</span>' +
          '<span class="learn-tile__meta">' + esc(t('cards_n', { n: row.cards })) + (row.source === 'contact' ? ' · ' + esc(t('from_contact')) : '') + '</span>' +
          '<span class="learn-tile__progress"' + (pct ? '' : ' hidden') + '><span class="learn-tile__progress-fill" style="width:' + pct + '%"></span></span>' +
        '</span>' +
      '</a>' +
      '<button type="button" class="learn-tile__share" aria-label="' + esc(t('share')) + '" title="' + esc(t('share')) + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.7" x2="15.4" y2="6.3"/><line x1="8.6" y1="13.3" x2="15.4" y2="17.7"/></svg>' +
      '</button>' +
      '<button type="button" class="learn-tile__remove" aria-label="' + esc(t('remove')) + '" title="' + esc(t('remove')) + '">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>';
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
      var ask = window.mentriaConfirm ? window.mentriaConfirm(t('remove_confirm', { title: P.text(row.title, lang) })) : Promise.resolve(true);
      Promise.resolve(ask).then(function (ok) { if (ok) P.remove(row.id).then(refresh); });
    });
    return li;
  }

  function refresh() {
    return P.list().then(function (rows) {
      list.innerHTML = '';
      rows.forEach(function (r) { list.appendChild(tile(r)); });
      list.hidden = !rows.length;
      empty.hidden = !!rows.length;
    });
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
    });
  }

  function handleResult(res) {
    say(t(res.replaced ? 'replaced' : 'imported', { title: P.text(res.row.title, lang) }) + (res.warnings.length ? ' · ' + res.warnings[0] : ''), 'ok');
    refresh();
  }
  function handleError(e) {
    var msg = (e && e.errors && e.errors.slice(0, 3).join('; ')) || (e && e.message) || String(e);
    say(t('import_failed') + ' ' + msg, 'error');
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
  if (params.get('pack')) {
    if (importBox && importBox.hidden) toggle.click();
    say(t('importing'));
    P.importUrl(params.get('pack')).then(function (r) { try { history.replaceState(null, '', location.pathname); } catch (_) {} handleResult(r); }, handleError);
  }
  window.addEventListener('mentria:packs', refresh);
  refresh();
  nativeProgress();
})();
