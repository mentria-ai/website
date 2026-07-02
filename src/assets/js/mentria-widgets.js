(function () {
  'use strict';

  var band = document.getElementById('launcher-widgets');
  if (!band) return;

  var store = window.MentriaStore || null;
  var palette = window.MENTRIA_PALETTE_DATA || {};
  var prefix = (palette && typeof palette.prefix === 'string') ? palette.prefix : '';
  var lang = document.documentElement.lang || (palette && palette.locale) || 'en';

  var FALLBACK = {
    'steps': 'Steps',
    'steps-goal': 'of {goal}',
    'notes': 'Notes',
    'notes-count': '{n} notes',
    'untitled': 'Untitled',
    'storage': 'Storage',
    'storage-used': '{used} / {quota}'
  };

  function label(name) {
    var v = band.getAttribute('data-label-' + name) || '';
    if (!v || v.indexOf('widgets.') === 0) return FALLBACK[name];
    return v;
  }

  var T = {
    steps: label('steps'),
    stepsGoal: label('steps-goal'),
    notes: label('notes'),
    notesCount: label('notes-count'),
    untitled: label('untitled'),
    storage: label('storage'),
    storageUsed: label('storage-used')
  };

  var ORDER = { steps: 0, notes: 1, storage: 2 };

  function fmtNum(n) {
    try { return Number(n).toLocaleString(lang); } catch (_) { return String(n); }
  }

  function fmtBytes(bytes) {
    if (bytes == null) return '';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var n = bytes, i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    var val = (n >= 10 || i === 0) ? Math.round(n) : Math.round(n * 10) / 10;
    return fmtNum(val) + ' ' + units[i];
  }

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }

  var LOCK_SVG = '<svg class="widget__lock" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>';
  var STORAGE_SVG = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><rect x="8" y="11" width="32" height="11" rx="3"></rect><rect x="8" y="26" width="32" height="11" rx="3"></rect><circle cx="14" cy="16.5" r="1.6" fill="currentColor" stroke="none"></circle><circle cx="14" cy="31.5" r="1.6" fill="currentColor" stroke="none"></circle></svg>';

  function place(el) {
    var kind = el.getAttribute('data-kind');
    var kids = band.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i].getAttribute('data-kind');
      if (k && ORDER[k] > ORDER[kind]) { band.insertBefore(el, kids[i]); return; }
    }
    band.appendChild(el);
  }

  function upsert(kind, href, html) {
    var el = band.querySelector('.widget[data-kind="' + kind + '"]');
    var created = false;
    if (!el) {
      el = document.createElement('a');
      el.className = 'widget widget--' + kind;
      el.setAttribute('data-kind', kind);
      el.href = prefix + href;
      place(el);
      created = true;
    }
    el.innerHTML = html;
    return { el: el, created: created };
  }

  function removeKind(kind) {
    var el = band.querySelector('.widget[data-kind="' + kind + '"]');
    if (el) el.remove();
  }

  function flash(el) {
    if (!el) return;
    el.classList.remove('is-updated');
    void el.offsetWidth;
    el.classList.add('is-updated');
  }

  function renderSteps(live) {
    var data = store ? store.get('tools', 'step_counter') : null;
    var ok = data && data.date === todayKey() && typeof data.steps === 'number';
    if (!ok) { removeKind('steps'); return; }
    var goal = data.goal || 10000;
    var steps = data.steps || 0;
    var pct = Math.max(0, Math.min(100, goal > 0 ? Math.round((steps / goal) * 100) : 0));
    var html =
      '<span class="widget__top">' +
        '<span class="widget__icon" aria-hidden="true"><svg viewBox="0 0 48 48"><use href="#tool-step-counter"></use></svg></span>' +
        '<span class="widget__name">' + esc(T.steps) + '</span>' +
      '</span>' +
      '<span class="widget__value">' + esc(fmtNum(steps)) + '</span>' +
      '<span class="widget__sub">' + esc(T.stepsGoal.replace('{goal}', fmtNum(goal))) + '</span>' +
      '<span class="widget__bar" aria-hidden="true"><span class="widget__bar-fill" style="width:' + pct + '%"></span></span>';
    var res = upsert('steps', '/tools/step-counter/', html);
    if (live && !res.created) flash(res.el);
  }

  function renderNotes(live) {
    var notes = store ? store.get('quick_notes', 'blob') : null;
    if (!Array.isArray(notes) || !notes.length) { removeKind('notes'); return; }
    var latest = notes[0];
    for (var i = 1; i < notes.length; i++) {
      if ((notes[i].updatedAt || 0) > (latest.updatedAt || 0)) latest = notes[i];
    }
    var title = (latest && latest.title) ? String(latest.title).trim() : '';
    if (!title) title = T.untitled;
    var lock = (latest && latest.enc) ? LOCK_SVG : '';
    var html =
      '<span class="widget__top">' +
        '<span class="widget__icon" aria-hidden="true"><svg viewBox="0 0 48 48"><use href="#tool-quick-notes"></use></svg></span>' +
        '<span class="widget__name">' + esc(T.notes) + '</span>' +
      '</span>' +
      '<span class="widget__value widget__value--sm">' + lock + '<span class="widget__title">' + esc(title) + '</span></span>' +
      '<span class="widget__sub">' + esc(T.notesCount.replace('{n}', fmtNum(notes.length))) + '</span>';
    var res = upsert('notes', '/tools/quick-notes/', html);
    if (live && !res.created) flash(res.el);
  }

  function renderStorage() {
    var nav = window.navigator;
    if (!nav || !nav.storage || !nav.storage.estimate) { removeKind('storage'); return; }
    nav.storage.estimate().then(function (est) {
      var usage = est && typeof est.usage === 'number' ? est.usage : null;
      var quota = est && typeof est.quota === 'number' ? est.quota : null;
      if (usage == null || quota == null || quota <= 0) { removeKind('storage'); updateVisibility(); return; }
      var pct = Math.max(0, Math.min(100, Math.round((usage / quota) * 100)));
      var usedStr = T.storageUsed.replace('{used}', fmtBytes(usage)).replace('{quota}', fmtBytes(quota));
      var html =
        '<span class="widget__top">' +
          '<span class="widget__icon widget__icon--stroke" aria-hidden="true">' + STORAGE_SVG + '</span>' +
          '<span class="widget__name">' + esc(T.storage) + '</span>' +
        '</span>' +
        '<span class="widget__value widget__value--sm">' + esc(usedStr) + '</span>' +
        '<span class="widget__bar" aria-hidden="true"><span class="widget__bar-fill" style="width:' + pct + '%"></span></span>';
      upsert('storage', '/tools/files/', html);
      updateVisibility();
    }).catch(function () { removeKind('storage'); updateVisibility(); });
  }

  var cli = document.querySelector('.cli__input');
  var filterActive = false;

  function updateVisibility() {
    var has = band.querySelector('.widget') != null;
    band.hidden = !has || filterActive;
  }

  function syncFilter() {
    filterActive = !!(cli && cli.value && cli.value.trim());
    updateVisibility();
  }

  if (cli) {
    cli.addEventListener('input', syncFilter);
    cli.addEventListener('keydown', function (e) { if (e.key === 'Enter') setTimeout(syncFilter, 0); });
  }

  if (store) {
    window.addEventListener(store.EVENT_NAME || 'mentria:write', function (e) {
      var d = e.detail || {};
      if (d.ns === 'tools' && d.key === 'step_counter') { renderSteps(true); updateVisibility(); }
      else if (d.ns === 'quick_notes' && d.key === 'blob') { renderNotes(true); updateVisibility(); }
    });
  }

  renderSteps(false);
  renderNotes(false);
  syncFilter();
  renderStorage();
})();
