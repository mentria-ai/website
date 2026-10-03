(function () {
  'use strict';
  var launcher = document.querySelector('.launcher');
  var pages = document.querySelector('.launcher__pages');
  var pinnedBand = document.getElementById('launcher-pinned');
  var pinnedRow = document.getElementById('launcher-pinned-row');
  var band = document.getElementById('launcher-recents');
  var row = document.getElementById('launcher-recents-row');
  var find = document.getElementById('tools-find');
  var none = document.getElementById('launcher-nomatch');
  if (!launcher || !pages) return;

  function getPins() {
    var v = window.MentriaStore ? window.MentriaStore.get('ui', 'pinned_tools') : null;
    return Array.isArray(v) ? v : [];
  }
  function setPins(pins) {
    if (window.MentriaStore) window.MentriaStore.set('ui', 'pinned_tools', pins);
  }

  function tileName(tile) {
    var l = tile.querySelector('.launch-tile__label');
    return l ? l.textContent.trim() : tile.getAttribute('data-slug');
  }

  function gated(tile) {
    var req = tile.getAttribute('data-requires');
    return !!req && document.documentElement.classList.contains('mentria-no-' + req);
  }

  function pinLabel(tile, pinned) {
    var tpl = pinnedBand ? pinnedBand.getAttribute(pinned ? 'data-label-unpin' : 'data-label-pin') : '';
    return (tpl || (pinned ? 'Unpin {name}' : 'Pin {name}')).replace('{name}', tile.getAttribute('data-name') || tileName(tile));
  }

  function renderPinned() {
    if (!pinnedBand || !pinnedRow) return;
    var pins = getPins();
    pinnedRow.innerHTML = '';
    var added = 0;
    pins.forEach(function (slug) {
      var tile = pages.querySelector('.launch-tile[data-slug="' + slug + '"]');
      if (tile && !gated(tile)) {
        pinnedRow.appendChild(tile.cloneNode(true));
        added++;
      }
    });
    pinnedBand.hidden = !added;
    pages.querySelectorAll('.launch-pin').forEach(function (btn) {
      var tile = btn.previousElementSibling;
      var on = pins.indexOf(btn.getAttribute('data-slug')) !== -1;
      btn.classList.toggle('is-pinned', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', pinLabel(tile, on));
      btn.textContent = on ? '★' : '☆';
    });
  }

  function togglePin(slug) {
    var pins = getPins();
    var i = pins.indexOf(slug);
    if (i === -1) pins.push(slug); else pins.splice(i, 1);
    setPins(pins);
    renderPinned();
  }

  if (pinnedBand && window.MentriaStore) {
    pages.querySelectorAll('.launch-tile').forEach(function (tile) {
      var slot = document.createElement('div');
      slot.className = 'launch-slot';
      if (tile.hasAttribute('data-requires')) slot.setAttribute('data-requires', tile.getAttribute('data-requires'));
      tile.parentNode.insertBefore(slot, tile);
      slot.appendChild(tile);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'launch-pin';
      btn.setAttribute('data-slug', tile.getAttribute('data-slug'));
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        togglePin(tile.getAttribute('data-slug'));
      });
      slot.appendChild(btn);
    });
    renderPinned();
    document.addEventListener('mentria:localechange', renderPinned);
  }

  function renderRecents() {
    if (!band || !row) return;
    var usage = {};
    try { usage = JSON.parse(localStorage.getItem('mentria_tool_usage')) || {}; } catch (_) {}
    var pinsNow = getPins();
    var slugs = Object.keys(usage).filter(function (s) { return pinsNow.indexOf(s) === -1; });
    var now = Date.now(), DAY = 86400000;
    function score(e) { return (e.count || 0) + 6 / (1 + (now - (e.last || 0)) / DAY); }
    slugs.sort(function (a, b) { return score(usage[b]) - score(usage[a]); });
    row.innerHTML = '';
    var added = 0;
    slugs.forEach(function (slug) {
      if (added >= 6) return;
      var tile = pages.querySelector('.launch-tile[data-slug="' + slug + '"]');
      if (tile && !gated(tile)) {
        row.appendChild(tile.cloneNode(true));
        added++;
      }
    });
    band.hidden = !added;
  }
  renderRecents();

  function norm(v) {
    return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  }
  var firstHit = null;
  function filter() {
    var raw = find ? find.value.trim() : '';
    var q = norm(raw);
    launcher.classList.toggle('is-searching', !!q);
    var hits = 0;
    firstHit = null;
    pages.querySelectorAll('.launcher__cat').forEach(function (cat) {
      var shown = 0;
      cat.querySelectorAll('.launch-tile').forEach(function (tile) {
        var text = tileName(tile) + ' ' + (tile.getAttribute('data-name') || '') + ' ' + (tile.getAttribute('data-search') || '');
        var ok = !gated(tile) && (!q || norm(text).indexOf(q) !== -1);
        var box = tile.parentNode && tile.parentNode.classList.contains('launch-slot') ? tile.parentNode : tile;
        box.hidden = !ok;
        if (ok) {
          shown++;
          if (!firstHit) firstHit = tile;
        }
      });
      cat.hidden = shown === 0;
      var count = cat.querySelector('.launcher__count');
      if (count) count.textContent = String(shown);
      hits += shown;
    });
    if (none) {
      none.hidden = !q || hits > 0;
      var I = window.MentriaI18n;
      var tpl = (I && typeof I.t === 'function' && I.t('tools_page.no_match')) || none.getAttribute('data-label') || '';
      none.textContent = none.hidden ? '' : tpl.split('{q}').join(raw);
    }
    if (!q) firstHit = null;
  }

  if (find) {
    find.addEventListener('input', filter);
    find.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && firstHit) {
        e.preventDefault();
        firstHit.click();
      } else if (e.key === 'Escape' && find.value) {
        e.preventDefault();
        e.stopPropagation();
        find.value = '';
        filter();
      }
    });
  }
  if (window.MutationObserver) {
    new MutationObserver(function () { if (find && find.value.trim()) filter(); }).observe(pages, { childList: true });
    var root = document.documentElement;
    var capsKey = function () {
      var out = [];
      for (var i = 0; i < root.classList.length; i++) if (root.classList[i].indexOf('mentria-no-') === 0) out.push(root.classList[i]);
      return out.join(' ');
    };
    var caps = capsKey();
    new MutationObserver(function () {
      var now = capsKey();
      if (now === caps) return;
      caps = now;
      renderPinned();
      renderRecents();
      filter();
    }).observe(root, { attributes: true, attributeFilter: ['class'] });
  }
  filter();
})();
