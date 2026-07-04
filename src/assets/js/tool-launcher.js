(function () {
  'use strict';
  var pinnedBand = document.getElementById('launcher-pinned');
  var pinnedRow = document.getElementById('launcher-pinned-row');
  var band = document.getElementById('launcher-recents');
  var row = document.getElementById('launcher-recents-row');
  if (!band || !row) return;

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

  function pinLabel(tile, pinned) {
    var tpl = pinnedBand ? pinnedBand.getAttribute(pinned ? 'data-label-unpin' : 'data-label-pin') : '';
    return (tpl || (pinned ? 'Unpin {name}' : 'Pin {name}')).replace('{name}', tileName(tile));
  }

  function renderPinned() {
    if (!pinnedBand || !pinnedRow) return;
    var pins = getPins();
    pinnedRow.innerHTML = '';
    var added = 0;
    pins.forEach(function (slug) {
      var tile = document.querySelector('.launcher__pages .launch-tile[data-slug="' + slug + '"]');
      if (tile) {
        var clone = tile.cloneNode(true);
        var pinBtn = clone.querySelector('.launch-pin');
        if (pinBtn) pinBtn.remove();
        pinnedRow.appendChild(clone);
        added++;
      }
    });
    pinnedBand.hidden = !added;
    document.querySelectorAll('.launcher__pages .launch-pin').forEach(function (btn) {
      var slug = btn.parentNode.getAttribute('data-slug');
      var on = pins.indexOf(slug) !== -1;
      btn.classList.toggle('is-pinned', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', pinLabel(btn.parentNode, on));
      btn.textContent = on ? '\u2605' : '\u2606';
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
    document.querySelectorAll('.launcher__pages .launch-tile').forEach(function (tile) {
      var btn = document.createElement('span');
      btn.className = 'launch-pin';
      btn.setAttribute('role', 'button');
      btn.tabIndex = 0;
      var act = function (e) {
        e.preventDefault();
        e.stopPropagation();
        togglePin(tile.getAttribute('data-slug'));
      };
      btn.addEventListener('click', act);
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') act(e);
      });
      tile.appendChild(btn);
    });
    renderPinned();
  }

  var usage = {};
  try { usage = JSON.parse(localStorage.getItem('mentria_tool_usage')) || {}; } catch (_) {}
  var pinsNow = getPins();
  var slugs = Object.keys(usage).filter(function (s) { return pinsNow.indexOf(s) === -1; });
  if (!slugs.length) return;
  var now = Date.now(), DAY = 86400000;
  function score(e) { return (e.count || 0) + 6 / (1 + (now - (e.last || 0)) / DAY); }
  slugs.sort(function (a, b) { return score(usage[b]) - score(usage[a]); });
  var added = 0;
  slugs.slice(0, 6).forEach(function (slug) {
    var tile = document.querySelector('.launcher__pages .launch-tile[data-slug="' + slug + '"]');
    if (tile) {
      var clone = tile.cloneNode(true);
      var pinBtn = clone.querySelector('.launch-pin');
      if (pinBtn) pinBtn.remove();
      row.appendChild(clone);
      added++;
    }
  });
  if (added) band.hidden = false;
})();
