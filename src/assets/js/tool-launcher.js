(function () {
  'use strict';
  var band = document.getElementById('launcher-recents');
  var row = document.getElementById('launcher-recents-row');
  if (!band || !row) return;
  var usage = {};
  try { usage = JSON.parse(localStorage.getItem('mentria_tool_usage')) || {}; } catch (_) {}
  var slugs = Object.keys(usage);
  if (!slugs.length) return;
  var now = Date.now(), DAY = 86400000;
  function score(e) { return (e.count || 0) + 6 / (1 + (now - (e.last || 0)) / DAY); }
  slugs.sort(function (a, b) { return score(usage[b]) - score(usage[a]); });
  var added = 0;
  slugs.slice(0, 6).forEach(function (slug) {
    var tile = document.querySelector('.launcher__pages .launch-tile[data-slug="' + slug + '"]');
    if (tile) { row.appendChild(tile.cloneNode(true)); added++; }
  });
  if (added) band.hidden = false;
})();
