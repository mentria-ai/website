(function (global) {
  'use strict';

  function unreadTotal() {
    try {
      var map = global.MentriaStore && global.MentriaStore.get('comms', 'unread');
      if (!map || typeof map !== 'object') return 0;
      var n = 0;
      for (var fp in map) {
        if (Object.prototype.hasOwnProperty.call(map, fp) && map[fp] && typeof map[fp].n === 'number') n += map[fp].n;
      }
      return n > 0 ? n : 0;
    } catch (_) {
      return 0;
    }
  }

  var pushCount = 0;

  function readPushCount() {
    if (!global.MentriaPushDB || !global.MentriaPushDB.kvGet) return Promise.resolve(0);
    return global.MentriaPushDB.kvGet('comms-msg-count').then(function (v) {
      return typeof v === 'number' && v > 0 ? v : 0;
    }).catch(function () { return 0; });
  }

  function paint() {
    var n = Math.max(unreadTotal(), pushCount);
    var nodes = document.querySelectorAll('[data-comms-badge]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = n > 99 ? '99+' : String(n);
      nodes[i].hidden = n === 0;
    }
    var links = document.querySelectorAll('[data-comms-link]');
    for (var j = 0; j < links.length; j++) {
      if (n > 0) links[j].setAttribute('data-unread', 'true');
      else links[j].removeAttribute('data-unread');
    }
  }

  function syncLocale() {
    if (!global.MentriaPushDB || !global.MentriaPushDB.kvSet) return;
    var loc = null;
    try { loc = global.localStorage.getItem('mentria_lang'); } catch (_) {}
    if (!loc) loc = document.documentElement.getAttribute('lang') || 'en';
    global.MentriaPushDB.kvSet('locale', loc).catch(function () {});
  }

  function refresh() {
    syncLocale();
    return readPushCount().then(function (n) { pushCount = n; paint(); });
  }

  global.addEventListener('mentria:comms:unread', function (e) {
    if (e && e.detail && typeof e.detail.total === 'number') pushCount = e.detail.total;
    paint();
  });
  global.addEventListener('storage', refresh);
  global.addEventListener('pageshow', refresh);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });

  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e && e.data && e.data.type === 'comms-unread') {
        pushCount = typeof e.data.n === 'number' ? e.data.n : pushCount;
        paint();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();

  global.MentriaCommsNav = { refresh: refresh, paint: paint, unreadTotal: unreadTotal };
})(window);
