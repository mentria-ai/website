(function () {
  'use strict';
  var P = window.MentriaPacks, S = window.MentriaStore;
  if (!P || !S) return;
  document.documentElement.classList.add('learn-js');
  var T = window.MENTRIA_LEARN_PAGE || {};
  var packs = window.MENTRIA_PACKS || [];
  var prefix = T.prefix || '';
  var LIMIT = 10;
  var byId = {};
  packs.forEach(function (x) { byId[x.id] = x; });
  var t = function (k, vars) {
    var s = T[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(String(vars[v])); });
    return s;
  };
  function fill(s, n) { return String(s || '').split('{n}').join(String(n)); }

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

  function paint(li, seen, total) {
    var bar = li.querySelector('.learn-tile__progress');
    if (bar) {
      bar.hidden = !seen || !total;
      var fillEl = bar.querySelector('.learn-tile__progress-fill');
      if (fillEl && total) fillEl.style.width = Math.min(100, Math.round((seen / total) * 100)) + '%';
    }
    mark(li, seen, total);
  }

  function touched() {
    return S.list('packs').filter(function (k) { return k.indexOf('p.') === 0; }).map(function (k) { return k.slice(2); }).filter(function (id) { return byId[id]; });
  }
  function nativeState(id) {
    var x = byId[id];
    if (!x) return null;
    var pr = P.getProgress(id);
    return { seen: P.doneCount(pr), total: x.cards, last: pr.last || 0 };
  }
  function paintTile(li) {
    var st = nativeState(li.dataset.packId);
    if (st) paint(li, st.seen, st.total);
  }
  function paintShelves() {
    Array.prototype.forEach.call(document.querySelectorAll('.learn-grid--native > .learn-tile'), paintTile);
  }

  function nativeTile(x) {
    var tpl = document.getElementById('learn-tile-tpl');
    var proto = tpl && tpl.content ? tpl.content.firstElementChild : null;
    if (!proto) return null;
    var li = proto.cloneNode(true);
    li.className = 'learn-tile';
    li.dataset.packId = x.id;
    li.dataset.cards = x.cards;
    var link = li.querySelector('.learn-tile__link');
    if (link) link.setAttribute('href', prefix + '/learn/' + x.id + '/');
    var img = li.querySelector('img.learn-tile__cover');
    if (img && x.cover) {
      img.loading = 'eager';
      img.setAttribute('data-full', x.cover);
      img.setAttribute('src', x.thumb || x.cover);
    } else if (img) {
      var blank = document.createElement('span');
      blank.className = 'learn-tile__cover learn-tile__cover--blank';
      img.replaceWith(blank);
    }
    var title = li.querySelector('.learn-tile__title');
    if (title) title.textContent = x.title;
    var meta = li.querySelector('.learn-tile__meta');
    if (meta) meta.textContent = fill(x.cards === 1 && T.cards_n_one ? T.cards_n_one : T.cards_n, x.cards) + ' · ' + fill(T.minutes_n, x.minutes);
    return li;
  }

  var extra = [];
  function renderContinue(more) {
    if (more) extra = more;
    var box = document.getElementById('learn-continue');
    var row = document.getElementById('learn-continue-list');
    if (!box || !row) return;
    var items = {}, list = [];
    touched().forEach(function (id) {
      var st = nativeState(id), x = byId[id];
      if (!st.seen || st.seen >= st.total) return;
      items[id] = { id: id, sig: 'native', last: st.last, seen: st.seen, total: st.total, make: function () { return nativeTile(x); } };
    });
    extra.forEach(function (it) { items[it.id] = it; });
    Object.keys(items).forEach(function (id) { list.push(items[id]); });
    list.sort(function (a, b) { return b.last - a.last; });
    var have = {};
    Array.prototype.forEach.call(row.children, function (li) { have[li.dataset.packId] = li; });
    var at = 0;
    list.slice(0, LIMIT).forEach(function (it) {
      var li = have[it.id];
      if (li && li.dataset.sig === it.sig) delete have[it.id];
      else {
        li = it.make();
        if (!li) return;
        li.dataset.sig = it.sig;
      }
      paint(li, it.seen, it.total);
      if (row.children[at] !== li) row.insertBefore(li, row.children[at] || null);
      at++;
    });
    Object.keys(have).forEach(function (id) { have[id].remove(); });
    box.hidden = !at;
  }

  function watchShelves() {
    var ids = {};
    touched().forEach(function (id) { ids[id] = true; });
    if (!Object.keys(ids).length) return;
    if (document.readyState !== 'loading' || !window.MutationObserver) { paintShelves(); return; }
    var mo = new MutationObserver(function (records) {
      records.forEach(function (r) {
        Array.prototype.forEach.call(r.addedNodes, function (n) {
          if (n.nodeType !== 1 || !n.classList.contains('learn-tile__progress-fill')) return;
          var li = n.closest('.learn-grid--native > .learn-tile');
          if (li && ids[li.dataset.packId]) paintTile(li);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', function () { mo.disconnect(); }, { once: true });
  }

  function boot() {
    renderContinue();
    watchShelves();
  }

  window.MentriaLearnProgress = { boot: boot, mark: mark, paint: paint, paintShelves: paintShelves, renderContinue: renderContinue };
})();
