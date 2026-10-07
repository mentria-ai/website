(function () {
  'use strict';
  var pages = document.querySelector('.launcher__pages');
  if (!pages || !window.MentriaStore) return;

  var palette = window.MENTRIA_PALETTE_DATA || {};
  var prefix = (typeof palette.prefix === 'string') ? palette.prefix : '';
  var hiddenStore = {};

  function escapeSlug(id) {
    return (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/[^a-z0-9-]/g, '');
  }

  function recount(section) {
    var count = section && section.querySelector('.launcher__count');
    if (count) count.textContent = String(section.querySelectorAll('.launch-tile').length);
  }

  function restoreStoreTiles(keep) {
    Object.keys(hiddenStore).forEach(function (id) {
      if (keep.indexOf(id) !== -1) return;
      var spot = hiddenStore[id];
      delete hiddenStore[id];
      if (!spot.parent.isConnected) return;
      spot.parent.insertBefore(spot.tile, spot.next && spot.next.parentNode === spot.parent ? spot.next : null);
      recount(spot.parent.closest('.launcher__cat'));
    });
  }

  function render(X) {
    var entries = [];
    try { entries = X.getRegistry().filter(function (e) { return e.enabled; }); } catch (_) { entries = []; }
    var withTool = entries.filter(function (e) { return e.manifest.mounts && e.manifest.mounts.tool; });
    var old = pages.querySelector('.launcher__cat--extensions');
    if (old) old.remove();
    restoreStoreTiles(withTool.map(function (e) { return e.manifest.id; }));
    if (!withTool.length) return;
    var section = document.createElement('section');
    section.className = 'launcher__cat launcher__cat--extensions';
    section.setAttribute('data-group', 'Extensions');
    var label = document.createElement('h2');
    label.className = 'launcher__label';
    var i18n = window.MentriaI18n;
    label.textContent = (i18n && i18n.t && i18n.t('home.launcher.extensions')) || 'Extensions';
    var grid = document.createElement('div');
    grid.className = 'launcher__grid';
    withTool.forEach(function (e) {
      var m = e.manifest;
      var slugSel = escapeSlug(m.id);
      if (document.querySelector('.launcher .launch-tile[data-slug="' + slugSel + '"]')) return;
      var listed = pages.querySelector('.launch-tile[data-store="' + slugSel + '"]');
      if (listed) {
        hiddenStore[m.id] = { tile: listed, parent: listed.parentNode, next: listed.nextSibling };
        var storeCat = listed.closest('.launcher__cat');
        listed.remove();
        recount(storeCat);
      }
      var a = document.createElement('a');
      a.className = 'launch-tile';
      a.setAttribute('data-slug', m.id);
      a.setAttribute('data-group', 'Extensions');
      a.setAttribute('data-search', m.name + ' ' + (m.description || '') + ' extension');
      a.href = prefix + '/tools/extensions/run/?id=' + encodeURIComponent(m.id);
      var icon = document.createElement('span');
      icon.className = 'launch-tile__icon launch-tile__icon--ext';
      icon.setAttribute('aria-hidden', 'true');
      if (/^data:image\//.test(m.icon || '')) {
        var img = document.createElement('img');
        img.src = m.icon; img.alt = '';
        icon.appendChild(img);
      } else {
        icon.textContent = m.icon || '🧩';
      }
      var lab = document.createElement('span');
      lab.className = 'launch-tile__label';
      lab.textContent = m.name;
      a.appendChild(icon); a.appendChild(lab);
      grid.appendChild(a);
    });
    if (!grid.children.length) return;
    var head = document.createElement('div');
    head.className = 'launcher__head';
    var count = document.createElement('span');
    count.className = 'launcher__count';
    count.textContent = String(grid.children.length);
    head.appendChild(label);
    head.appendChild(count);
    section.appendChild(head);
    section.appendChild(grid);
    pages.appendChild(section);
  }

  import('/assets/js/mentria-extensions.js').then(function (X) {
    var timer = 0;
    function later() {
      clearTimeout(timer);
      timer = setTimeout(function () { render(X); }, 0);
    }
    render(X);
    window.addEventListener('mentria:write', function (e) {
      var d = (e && e.detail) || {};
      if (d.ns === 'ext' && d.key === 'registry') later();
    });
    window.addEventListener('storage', function (e) {
      if (e.key === null || e.key === 'mentria.store.ext.registry') later();
    });
  }).catch(function (err) {
    console.warn('[mentria-ext] launch integration failed:', err);
  });
})();
