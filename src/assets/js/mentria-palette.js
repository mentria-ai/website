(function () {
  'use strict';

  var STORAGE_KEY = 'mentria_tool_usage';
  var DAY = 86400000;
  var LIST_ID = 'm-palette-listbox';

  var built = false;
  var root = null;
  var card = null;
  var input = null;
  var listEl = null;
  var statusEl = null;
  var modalCtl = null;
  var prevFocus = null;

  var labels = {};
  var model = { tools: [], nav: [], recents: [] };
  var optionEls = [];
  var activeIndex = -1;
  var idSeq = 0;

  function data() {
    return window.MENTRIA_PALETTE_DATA || null;
  }

  function norm(v) {
    return String(v == null ? '' : v).toLowerCase();
  }

  function kwString(kw) {
    if (kw == null) return '';
    if (Object.prototype.toString.call(kw) === '[object Array]') return kw.join(' ');
    return String(kw);
  }

  function usageMap() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (_) { return {}; }
  }

  function usageScore(entry) {
    if (!entry) return 0;
    return (entry.count || 0) + 6 / (1 + (Date.now() - (entry.last || 0)) / DAY);
  }

  function buildModel() {
    var d = data();
    var prefix = (d && d.prefix) || '';
    labels = (d && d.labels) || {};
    var usage = usageMap();
    var tools = (d && d.tools) || [];
    var nav = (d && d.nav) || [];

    var bySlug = {};
    var normTools = [];
    var i;
    for (i = 0; i < tools.length; i++) {
      var t = tools[i];
      if (!t || !t.slug) continue;
      var title = t.title || t.slug;
      var cat = t.category || '';
      var entry = {
        title: title,
        hint: cat,
        href: prefix + '/tools/' + t.slug + '/',
        titleN: norm(title),
        hayN: norm(title + ' ' + t.slug + ' ' + kwString(t.keywords) + ' ' + cat),
        usage: usageScore(usage[t.slug])
      };
      normTools.push(entry);
      bySlug[t.slug] = entry;
    }

    var normNav = [];
    for (i = 0; i < nav.length; i++) {
      var n = nav[i];
      if (!n || !n.href) continue;
      var navTitle = n.title || n.href;
      normNav.push({
        title: navTitle,
        hint: '',
        href: prefix + n.href,
        titleN: norm(navTitle),
        usage: 0
      });
    }

    var slugs = Object.keys(usage);
    slugs.sort(function (a, b) { return usageScore(usage[b]) - usageScore(usage[a]); });
    var recents = [];
    for (i = 0; i < slugs.length && recents.length < 6; i++) {
      if (bySlug[slugs[i]]) recents.push(bySlug[slugs[i]]);
    }

    return { tools: normTools, nav: normNav, recents: recents };
  }

  function applyLabels() {
    if (labels.placeholder) {
      input.setAttribute('placeholder', labels.placeholder);
      input.setAttribute('aria-label', labels.placeholder);
      card.setAttribute('aria-label', labels.placeholder);
    }
    if (labels.listLabel) listEl.setAttribute('aria-label', labels.listLabel);
  }

  function clearList() {
    optionEls = [];
    activeIndex = -1;
    idSeq = 0;
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
  }

  function makeOption(entry) {
    var el = document.createElement('div');
    el.className = 'm-palette__opt';
    el.setAttribute('role', 'option');
    el.id = 'm-palette-opt-' + (idSeq++);
    el.setAttribute('aria-selected', 'false');
    el.setAttribute('data-href', entry.href);
    var title = document.createElement('span');
    title.className = 'm-palette__opt-title';
    title.textContent = entry.title;
    el.appendChild(title);
    if (entry.hint) {
      var hint = document.createElement('span');
      hint.className = 'm-palette__opt-hint';
      hint.textContent = entry.hint;
      el.appendChild(hint);
    }
    optionEls.push(el);
    return el;
  }

  function makeGroup(labelText) {
    var g = document.createElement('div');
    g.className = 'm-palette__group';
    g.setAttribute('role', 'group');
    if (labelText) g.setAttribute('aria-label', labelText);
    var head = document.createElement('div');
    head.className = 'm-palette__section';
    head.setAttribute('aria-hidden', 'true');
    head.textContent = labelText || '';
    g.appendChild(head);
    return g;
  }

  function renderEmptyState() {
    var i, j;
    if (model.recents.length) {
      var rg = makeGroup(labels.recents || 'Recents');
      for (i = 0; i < model.recents.length; i++) rg.appendChild(makeOption(model.recents[i]));
      listEl.appendChild(rg);
    }
    for (i = 0; i < model.nav.length; i++) listEl.appendChild(makeOption(model.nav[i]));
    var order = [];
    var byCat = {};
    for (i = 0; i < model.tools.length; i++) {
      var c = model.tools[i].hint || '';
      if (!byCat[c]) { byCat[c] = []; order.push(c); }
      byCat[c].push(model.tools[i]);
    }
    for (i = 0; i < order.length; i++) {
      var g = makeGroup(order[i]);
      var arr = byCat[order[i]];
      for (j = 0; j < arr.length; j++) g.appendChild(makeOption(arr[j]));
      listEl.appendChild(g);
    }
  }

  function tierOf(hayTitleIndex, hasFullMatch) {
    if (hayTitleIndex === 0) return 0;
    if (hayTitleIndex > 0) return 1;
    if (hasFullMatch) return 2;
    return -1;
  }

  function renderResults(qN) {
    var out = [];
    var i, e, idx, tier;
    for (i = 0; i < model.tools.length; i++) {
      e = model.tools[i];
      idx = e.titleN.indexOf(qN);
      tier = tierOf(idx, e.hayN.indexOf(qN) !== -1);
      if (tier < 0) continue;
      out.push({ e: e, tier: tier });
    }
    for (i = 0; i < model.nav.length; i++) {
      e = model.nav[i];
      idx = e.titleN.indexOf(qN);
      tier = tierOf(idx, false);
      if (tier < 0) continue;
      out.push({ e: e, tier: tier });
    }
    out.sort(function (a, b) {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (b.e.usage !== a.e.usage) return b.e.usage - a.e.usage;
      return a.e.titleN < b.e.titleN ? -1 : (a.e.titleN > b.e.titleN ? 1 : 0);
    });
    for (i = 0; i < out.length; i++) listEl.appendChild(makeOption(out[i].e));
  }

  function setStatus(msg) {
    statusEl.textContent = msg || '';
  }

  function render(query) {
    clearList();
    var qN = norm(query).trim();
    if (qN) renderResults(qN); else renderEmptyState();
    if (optionEls.length) {
      input.setAttribute('aria-expanded', 'true');
      setStatus('');
      setActive(0);
    } else {
      input.setAttribute('aria-expanded', 'false');
      setActive(-1);
      setStatus(labels.noResults || 'No results');
    }
  }

  function setActive(i) {
    if (activeIndex >= 0 && optionEls[activeIndex]) {
      optionEls[activeIndex].setAttribute('aria-selected', 'false');
    }
    if (i < 0 || !optionEls.length) {
      activeIndex = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    if (i >= optionEls.length) i = optionEls.length - 1;
    activeIndex = i;
    var el = optionEls[i];
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function move(delta) {
    if (!optionEls.length) return;
    var n = optionEls.length;
    var next = activeIndex < 0 ? (delta > 0 ? 0 : n - 1) : (activeIndex + delta + n) % n;
    setActive(next);
  }

  function navigate(el) {
    var href = el.getAttribute('data-href');
    if (href) window.location.href = href;
  }

  function activateCurrent() {
    if (activeIndex < 0 || !optionEls[activeIndex]) return;
    navigate(optionEls[activeIndex]);
  }

  function onInputKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    var k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (k === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (k === 'Enter') { e.preventDefault(); activateCurrent(); }
  }

  function onListClick(e) {
    var opt = e.target.closest ? e.target.closest('[role="option"]') : null;
    if (opt) navigate(opt);
  }

  function onListPointer(e) {
    var opt = e.target.closest ? e.target.closest('[role="option"]') : null;
    if (!opt) return;
    var idx = optionEls.indexOf(opt);
    if (idx >= 0 && idx !== activeIndex) setActive(idx);
  }

  function build() {
    if (built) return;
    built = true;

    root = document.createElement('div');
    root.className = 'm-palette';
    root.hidden = true;

    card = document.createElement('div');
    card.className = 'm-modal__card m-palette__card';

    input = document.createElement('input');
    input.type = 'text';
    input.className = 'm-input m-palette__input';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', LIST_ID);
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('enterkeyhint', 'go');

    listEl = document.createElement('div');
    listEl.className = 'm-palette__list';
    listEl.id = LIST_ID;
    listEl.setAttribute('role', 'listbox');

    statusEl = document.createElement('div');
    statusEl.className = 'm-palette__empty';
    statusEl.setAttribute('role', 'status');
    statusEl.setAttribute('aria-live', 'polite');

    card.appendChild(input);
    card.appendChild(listEl);
    card.appendChild(statusEl);
    root.appendChild(card);
    document.body.appendChild(root);

    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', onInputKey);
    listEl.addEventListener('click', onListClick);
    listEl.addEventListener('pointermove', onListPointer);
    root.addEventListener('mousedown', function (e) { if (e.target === root) close(); });

    if (window.MentriaUI && typeof window.MentriaUI.modal === 'function') {
      modalCtl = window.MentriaUI.modal(root);
    }
  }

  function isOpen() {
    return built && root && !root.hidden;
  }

  function onFallbackKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeFallback(); }
  }

  function openFallback() {
    prevFocus = document.activeElement;
    root.hidden = false;
    document.addEventListener('keydown', onFallbackKey, true);
    input.focus();
  }

  function closeFallback() {
    root.hidden = true;
    document.removeEventListener('keydown', onFallbackKey, true);
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (_) {} }
    prevFocus = null;
  }

  function open() {
    if (!data()) return;
    build();
    model = buildModel();
    applyLabels();
    input.value = '';
    render('');
    if (modalCtl) modalCtl.open();
    else openFallback();
  }

  function close() {
    if (!isOpen()) return;
    if (modalCtl) modalCtl.close();
    else closeFallback();
  }

  function toggle() {
    if (isOpen()) close(); else open();
  }

  document.addEventListener('keydown', function (e) {
    if (e.isComposing || e.keyCode === 229) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
      if (!data()) return;
      e.preventDefault();
      toggle();
    }
  });

  window.addEventListener('mentria:gamepad:button', function (e) {
    var d = e && e.detail;
    if (!d || d.pressed === false) return;
    if ((d.name === 'start' || d.button === 'start') && data()) toggle();
  });

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest ? e.target.closest('[data-palette-open]') : null;
    if (trigger && data()) { e.preventDefault(); open(); }
  });

  window.MentriaPalette = { open: open, close: close, toggle: toggle };
})();
