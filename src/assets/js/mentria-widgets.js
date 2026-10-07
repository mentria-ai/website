(function () {
  'use strict';

  var band = document.getElementById('launcher-widgets');
  if (!band) return;

  var store = window.MentriaStore || null;
  var palette = window.MENTRIA_PALETTE_DATA || {};

  function prefix() {
    var I = window.MentriaI18n;
    var code = I && typeof I.locale === 'function' ? I.locale() : '';
    var L = window.MENTRIA_LOCALES || [];
    for (var i = 0; i < L.length; i++) {
      if (L[i].code === code) return L[i].prefix || '';
    }
    return (palette && typeof palette.prefix === 'string') ? palette.prefix : '';
  }

  function lang() {
    return document.documentElement.lang || (palette && palette.locale) || 'en';
  }

  var KEYS = {
    'steps': 'widgets.steps_label',
    'steps-goal': 'widgets.steps_of_goal',
    'notes': 'widgets.notes_label',
    'notes-count': 'widgets.notes_count',
    'notes-count-one': 'widgets.notes_count_one',
    'untitled': 'widgets.untitled',
    'storage': 'widgets.storage_label',
    'storage-used': 'widgets.storage_used'
  };

  var FALLBACK = {
    'steps': 'Steps',
    'steps-goal': 'of {goal}',
    'notes': 'Notes',
    'notes-count': '{n} notes',
    'notes-count-one': '{n} note',
    'untitled': 'Untitled',
    'storage': 'Storage',
    'storage-used': '{used} / {quota}'
  };

  function label(name) {
    var I = window.MentriaI18n;
    var v = I && typeof I.t === 'function' ? I.t(KEYS[name]) : null;
    if (typeof v !== 'string' || !v) v = band.getAttribute('data-label-' + name) || '';
    if (!v || v.indexOf('widgets.') === 0) return FALLBACK[name];
    return v;
  }

  function readLabels() {
    return {
      steps: label('steps'),
      stepsGoal: label('steps-goal'),
      notes: label('notes'),
      notesCount: label('notes-count'),
      notesCountOne: label('notes-count-one'),
      untitled: label('untitled'),
      storage: label('storage'),
      storageUsed: label('storage-used')
    };
  }

  var T = readLabels();

  var ORDER = { steps: 0, notes: 1, storage: 2 };

  function fmtNum(n) {
    try { return Number(n).toLocaleString(lang()); } catch (_) { return String(n); }
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

  function orderOf(kind) {
    return (kind && Object.prototype.hasOwnProperty.call(ORDER, kind)) ? ORDER[kind] : 99;
  }

  function place(el) {
    var mine = orderOf(el.getAttribute('data-kind'));
    var kids = band.children;
    for (var i = 0; i < kids.length; i++) {
      if (orderOf(kids[i].getAttribute('data-kind')) > mine) { band.insertBefore(el, kids[i]); return; }
    }
    band.appendChild(el);
  }

  function link(el, href) {
    var want = prefix() + href;
    if (el.getAttribute('href') !== want) el.setAttribute('href', want);
  }

  function upsert(kind, href, html) {
    var el = band.querySelector('.widget[data-kind="' + kind + '"]');
    var created = false;
    if (!el) {
      el = document.createElement('a');
      el.className = 'widget widget--' + kind;
      el.setAttribute('data-kind', kind);
      place(el);
      created = true;
    }
    link(el, href);
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
    var countTmpl = notes.length === 1 ? T.notesCountOne : T.notesCount;
    var html =
      '<span class="widget__top">' +
        '<span class="widget__icon" aria-hidden="true"><svg viewBox="0 0 48 48"><use href="#tool-quick-notes"></use></svg></span>' +
        '<span class="widget__name">' + esc(T.notes) + '</span>' +
      '</span>' +
      '<span class="widget__value widget__value--sm">' + lock + '<span class="widget__title">' + esc(title) + '</span></span>' +
      '<span class="widget__sub">' + esc(countTmpl.replace('{n}', fmtNum(notes.length))) + '</span>';
    var res = upsert('notes', '/tools/quick-notes/', html);
    if (live && !res.created) flash(res.el);
  }

  function renderStorage() {
    var nav = window.navigator;
    if (!nav || !nav.storage || !nav.storage.estimate) { removeKind('storage'); return; }
    nav.storage.estimate().then(function (est) {
      var usage = est && typeof est.usage === 'number' ? est.usage : null;
      var quota = est && typeof est.quota === 'number' ? est.quota : null;
      if (usage == null || quota == null || quota <= 0 || usage < 1024 * 1024) { removeKind('storage'); updateVisibility(); return; }
      var pct = Math.max(0, Math.min(100, Math.round((usage / quota) * 100)));
      var usedStr = T.storageUsed.replace('{used}', fmtBytes(usage)).replace('{quota}', fmtBytes(quota));
      var html =
        '<span class="widget__top">' +
          '<span class="widget__icon widget__icon--stroke" aria-hidden="true">' + STORAGE_SVG + '</span>' +
          '<span class="widget__name">' + esc(T.storage) + '</span>' +
        '</span>' +
        '<span class="widget__value widget__value--sm' + (usedStr.length > 12 ? ' is-long' : '') + '">' + esc(usedStr) + '</span>' +
        '<span class="widget__bar" aria-hidden="true"><span class="widget__bar-fill" style="width:' + pct + '%"></span></span>';
      upsert('storage', '/tools/files/', html);
      updateVisibility();
    }).catch(function () { removeKind('storage'); updateVisibility(); });
  }

  var extEls = {};

  function extNs(id) { return 'extdata.' + id; }

  function capStr(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n) : s;
  }

  function forLocale(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
    var code = String(lang()).toLowerCase(), base = code.split('-')[0], exact = null, near = null;
    Object.keys(map).forEach(function (k) {
      var v = map[k], key = k.toLowerCase();
      if (!v || typeof v !== 'object' || typeof v.text !== 'string' || !v.text.trim()) return;
      if (key === code) exact = v;
      else if (!near && key.split('-')[0] === base) near = v;
    });
    return exact || near;
  }

  function validSnapshot(snap) {
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return null;
    var pick = forLocale(snap.locales) || snap;
    if (typeof pick.text !== 'string' || !pick.text.trim()) return null;
    var out = { text: capStr(pick.text.trim(), 80) };
    if (typeof pick.detail === 'string' && pick.detail.trim()) out.detail = capStr(pick.detail.trim(), 120);
    if (typeof snap.progress === 'number' && isFinite(snap.progress)) out.progress = Math.max(0, Math.min(1, snap.progress));
    return out;
  }

  function buildExtList() {
    var out = [];
    if (!store) return out;
    try {
      var reg = store.get('ext', 'registry');
      if (!Array.isArray(reg)) return out;
      for (var i = 0; i < reg.length; i++) {
        var e = reg[i];
        if (!e || !e.enabled || !e.manifest) continue;
        var m = e.manifest;
        var w = m.mounts && m.mounts.widget;
        if (typeof m.id !== 'string' || !w || typeof w.key !== 'string' || typeof w.label !== 'string') continue;
        out.push({ id: m.id, key: w.key, label: w.label, icon: m.icon });
      }
    } catch (_) {}
    return out;
  }

  var extList = buildExtList();

  function renderExt(ext, live) {
    var snap = store ? validSnapshot(store.get(extNs(ext.id), ext.key)) : null;
    var el = extEls[ext.id] || null;
    if (!snap) {
      if (el) { el.remove(); extEls[ext.id] = null; }
      return;
    }
    var created = false;
    if (!el) {
      el = document.createElement('a');
      el.className = 'widget widget--ext';
      el.setAttribute('data-kind', 'ext:' + ext.id);
      place(el);
      extEls[ext.id] = el;
      created = true;
    }
    link(el, '/tools/extensions/run/?id=' + encodeURIComponent(ext.id));
    while (el.firstChild) el.removeChild(el.firstChild);

    var top = document.createElement('span');
    top.className = 'widget__top';
    var icon = document.createElement('span');
    icon.className = 'widget__icon widget__icon--ext';
    icon.setAttribute('aria-hidden', 'true');
    if (/^data:image\//.test(ext.icon || '')) {
      var img = document.createElement('img');
      img.src = ext.icon;
      img.alt = '';
      img.style.cssText = 'width:22px;height:22px;object-fit:contain;border-radius:4px';
      icon.appendChild(img);
    } else {
      icon.textContent = ext.icon || '🧩';
    }
    var name = document.createElement('span');
    name.className = 'widget__name';
    name.textContent = ext.label;
    top.appendChild(icon);
    top.appendChild(name);
    el.appendChild(top);

    var value = document.createElement('span');
    value.className = 'widget__value widget__value--sm';
    var titleSpan = document.createElement('span');
    titleSpan.className = 'widget__title';
    titleSpan.textContent = snap.text;
    value.appendChild(titleSpan);
    el.appendChild(value);

    if (snap.detail) {
      var detail = document.createElement('span');
      detail.className = 'widget__sub';
      detail.textContent = snap.detail;
      el.appendChild(detail);
    }

    if (typeof snap.progress === 'number') {
      var bar = document.createElement('span');
      bar.className = 'widget__bar';
      bar.setAttribute('aria-hidden', 'true');
      var fill = document.createElement('span');
      fill.className = 'widget__bar-fill';
      fill.style.width = Math.round(snap.progress * 100) + '%';
      bar.appendChild(fill);
      el.appendChild(bar);
    }

    if (live && !created) flash(el);
  }

  function renderExts(live) {
    for (var i = 0; i < extList.length; i++) renderExt(extList[i], live);
  }

  function extByWrite(ns, key) {
    for (var i = 0; i < extList.length; i++) {
      if (ns === extNs(extList[i].id) && key === extList[i].key) return extList[i];
    }
    return null;
  }

  function updateVisibility() {
    band.hidden = band.querySelector('.widget') == null;
  }

  if (store) {
    window.addEventListener(store.EVENT_NAME || 'mentria:write', function (e) {
      var d = e.detail || {};
      if (d.ns === 'tools' && d.key === 'step_counter') { renderSteps(true); updateVisibility(); }
      else if (d.ns === 'quick_notes' && d.key === 'blob') { renderNotes(true); updateVisibility(); }
      else {
        var ext = extByWrite(d.ns, d.key);
        if (ext) { renderExt(ext, true); updateVisibility(); }
      }
    });
  }

  document.addEventListener('mentria:localechange', function () {
    T = readLabels();
    renderSteps(false);
    renderNotes(false);
    renderExts(false);
    updateVisibility();
    renderStorage();
  });

  renderSteps(false);
  renderNotes(false);
  renderExts(false);
  updateVisibility();
  renderStorage();
})();
