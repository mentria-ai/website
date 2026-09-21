(function () {
  'use strict';
  var P = window.MentriaPacks, C = window.MentriaPackCards, S = window.MentriaStore;
  var scroller = document.getElementById('stream');
  var dyn = document.getElementById('stream-dynamic');
  var tailEl = document.getElementById('stream-tail');
  var more = document.getElementById('stream-more');
  if (!P || !C || !S || !scroller || !dyn || !tailEl) return;
  var esc = C.esc, el = C.el;
  var T = window.MENTRIA_STREAM_I18N || {};
  var L = window.MENTRIA_LEARN_I18N || {};
  var tail = window.MENTRIA_STREAM_TAIL || [];
  var daily = window.MENTRIA_STREAM_DAILY || [];
  var tools = window.MENTRIA_STREAM_TOOLS || [];
  var prefix = T.prefix || '';
  var lang = document.documentElement.lang || 'en';
  var BUDGET = 10, MAX_REVIEWS = 5, MAX_PACKS = 6, PAGE = 24;
  var t = function (k, vars) {
    var s = T[k] != null ? T[k] : (L[k] != null ? L[k] : k);
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(String(vars[v])); });
    return s;
  };
  var tx = function (v) { return P.text(v, lang); };
  var byId = {};
  tail.forEach(function (x) { byId[x.id] = x; });

  var seed = Math.floor(Date.now() / 86400000);
  function rng() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
  function seededOrder(list) {
    var a = list.map(function (x, i) { return { x: x, r: rng() + i * 1e-9 }; });
    a.sort(function (p, q) { return p.r - q.r; });
    return a.map(function (o) { return o.x; });
  }

  function coverCard(item, kind, label) {
    var sec = el('section', 'feed-card stream-card stream-card--cover');
    sec.dataset.packId = item.id;
    if (item.cover) sec.style.setProperty('--feed-card-bg', 'url("' + item.cover + '")');
    var href = item.href || (prefix + '/learn/' + item.id + '/');
    sec.innerHTML =
      (item.cover ? '<img class="feed-card__media" src="' + esc(item.cover) + '" alt="" loading="lazy" decoding="async">' : '<div class="feed-card__color-bg stream-card__blank"></div>') +
      '<div class="feed-card__gradient"></div>' +
      '<div class="stream-chip stream-chip--' + kind + '">' + esc(label) + '</div>' +
      '<div class="feed-card__info">' +
        '<p class="feed-card__caption">' + esc(item.meta || '') + '</p>' +
        '<h2 class="feed-card__title">' + esc(tx(item.title)) + '</h2>' +
        '<a class="pack-btn pack-btn--primary stream-card__cta" href="' + esc(href) + '">' + esc(item.cta || t('open')) + '</a>' +
      '</div>';
    if (!item.cover && window.MentriaBackdrop) window.MentriaBackdrop.apply(sec.querySelector('.stream-card__blank'), 'cover/' + item.id);
    return sec;
  }

  function metaFor(x, progress) {
    var parts = [];
    if (x.collection === 'source') parts.push('Source');
    else if (x.collection === 'deepcuts') parts.push('Deep Cuts');
    else if (x.source === 'import' || x.source === 'contact') parts.push(t('imported'));
    parts.push(t('cards_n', { n: x.cards }));
    if (x.minutes) parts.push(t('minutes_n', { n: x.minutes }));
    if (progress) {
      var seen = Object.keys(progress.cards || {}).length;
      if (seen && x.cards) parts.push(t('progress_n', { n: Math.min(100, Math.round((seen / x.cards) * 100)) }));
    }
    return parts.join(' · ');
  }

  function packCard(pack, card, kind, label, ctxOpts) {
    var sec = el('section', 'feed-card stream-card stream-card--pack');
    sec.dataset.packId = pack.id;
    sec.dataset.cardId = card.id;
    sec.dataset.kind = kind;
    var chip = el('div', 'stream-chip stream-chip--' + kind, esc(label));
    var title = el('a', 'stream-card__pack', esc(tx(pack.title)));
    title.href = pack.href || (prefix + '/learn/' + pack.id + '/');
    var head = el('div', 'stream-card__head');
    head.appendChild(chip); head.appendChild(title);
    var slide = C.render(card, ctxOpts);
    slide.classList.add('is-active');
    sec.appendChild(slide);
    sec.appendChild(head);
    return sec;
  }

  function scrollToNext(sec) {
    var n = sec.nextElementSibling;
    while (n && !n.classList.contains('feed-card')) n = n.nextElementSibling;
    if (!n) return;
    try { n.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { n.scrollIntoView(); }
  }

  function loadNative(id) {
    return fetch('/learn/' + encodeURIComponent(id) + '/pack.json', { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function activePacks() {
    var touched = S.list('packs').filter(function (k) { return k.indexOf('p.') === 0; }).map(function (k) { return k.slice(2); });
    return P.list().then(function (allRows) {
      var now = Date.now();
      var byCourse = {};
      allRows.forEach(function (r) { var cid = P.courseOf(r); if (cid) (byCourse[cid] = byCourse[cid] || []).push(r); });
      var rows = allRows.filter(function (r) { return !P.courseOf(r); });
      Object.keys(byCourse).forEach(function (cid) {
        var packs = byCourse[cid].sort(function (a, b) { return (a.course.order || 0) - (b.course.order || 0); });
        var picked = false;
        packs.forEach(function (r) {
          var pr = P.getProgress(r.id);
          var seen = Object.keys(pr.cards || {}).length;
          var due = Object.keys(pr.cards || {}).some(function (id) { var c = pr.cards[id]; return c.r === 'wrong' && c.d && c.d <= now; });
          if (!picked && seen < r.cards) { picked = true; rows.push(r); }
          else if (due) rows.push(r);
        });
      });
      var importedIds = allRows.map(function (r) { return r.id; });
      var nativeIds = touched.filter(function (id) { return byId[id] && importedIds.indexOf(id) < 0; });
      nativeIds.sort(function (a, b) { return (P.getProgress(b).last || 0) - (P.getProgress(a).last || 0); });
      var jobs = [];
      rows.slice(0, MAX_PACKS).forEach(function (r) { jobs.push(P.get(r.id).then(function (row) { return row && row.pack ? { pack: P.normalize(row.pack), native: false, meta: row } : null; })); });
      nativeIds.slice(0, MAX_PACKS).forEach(function (id) { jobs.push(loadNative(id).then(function (p) { return p ? { pack: P.normalize(p), native: true, meta: byId[id] } : null; })); });
      return Promise.all(jobs).then(function (list) { return list.filter(Boolean); });
    });
  }

  function orderedCards(pack) {
    var map = {}; pack.cards.forEach(function (c) { map[c.id] = c; });
    var out = [];
    pack.sections.forEach(function (s) { s.cards.forEach(function (id) { if (map[id]) out.push(map[id]); }); });
    return out;
  }

  function buildDynamic(packs) {
    var now = Date.now();
    var days = P.getDays(), answeredToday = days[P.dayKey()] || 0;
    var items = [];
    var reviews = [];
    packs.forEach(function (entry) {
      var progress = P.getProgress(entry.pack.id);
      orderedCards(entry.pack).forEach(function (c) {
        var r = progress.cards[c.id];
        if (r && r.r === 'wrong' && r.d && r.d <= now) reviews.push({ entry: entry, card: c, due: r.d });
      });
    });
    reviews.sort(function (a, b) { return a.due - b.due; });
    reviews.slice(0, MAX_REVIEWS).forEach(function (r) { items.push({ kind: 'review', entry: r.entry, card: r.card }); });

    var todayKey = P.dayKey();
    daily.filter(function (d) { return d.date === todayKey; }).forEach(function (d) { items.push({ kind: 'daily', item: d }); });
    if (tools.length) {
      var tool = seededOrder(tools)[0];
      items.push({ kind: 'daily', item: { kind: 'tool', title: tx(tool.title), text: tx(tool.summary), href: prefix + '/tools/' + tool.slug + '/', cta: t('open_tool'), chip: t('try_tool') } });
    }
    if (new Date().getDay() === 6) items.push({ kind: 'daily', item: { kind: 'lab', title: t('lab_title'), text: t('lab_text'), href: prefix + '/tools/ai-chat/', cta: t('open_tool'), chip: t('lab') } });

    var picks = [];
    var busy = {};
    packs.forEach(function (e) { busy[e.pack.id] = true; });
    seededOrder(tail).some(function (x) {
      if (busy[x.id]) return false;
      var pr = P.getProgress(x.id);
      if (Object.keys(pr.cards || {}).length >= x.cards) return false;
      picks.push(x);
      return picks.length >= 2;
    });
    picks.forEach(function (x) { items.push({ kind: 'today', pick: x }); });

    var budget = Math.max(0, BUDGET - answeredToday);
    var queues = packs.map(function (entry) {
      var progress = P.getProgress(entry.pack.id);
      return { entry: entry, cards: orderedCards(entry.pack).filter(function (c) { return !progress.cards[c.id]; }), taken: 0 };
    }).filter(function (q) { return q.cards.length; });
    var added = 0;
    while (added < budget && queues.some(function (q) { return q.cards.length && q.taken < 3; })) {
      queues.forEach(function (q) {
        if (added >= budget || !q.cards.length || q.taken >= 3) return;
        items.push({ kind: 'next', entry: q.entry, card: q.cards.shift() });
        q.taken++; added++;
      });
    }
    var exhausted = packs.length && !added && !reviews.length && budget === 0;
    return { items: items, exhausted: exhausted, packs: packs };
  }

  function renderDynamic(res) {
    var frag = document.createDocumentFragment();
    res.items.forEach(function (it) {
      if (it.kind === 'today') {
        frag.appendChild(coverCard({ id: it.pick.id, title: it.pick.title, cover: it.pick.cover, meta: metaFor(it.pick), cta: t('start') }, 'today', t('today')));
        return;
      }
      if (it.kind === 'daily') {
        var d = it.item;
        var note = el('section', 'feed-card stream-card stream-card--note stream-card--daily');
        if (d.image) { note.classList.add('stream-card--cover'); note.classList.remove('stream-card--note'); note.style.setProperty('--feed-card-bg', 'url("' + d.image + '")'); }
        note.innerHTML =
          (d.image ? '<img class="feed-card__media" src="' + esc(d.image) + '" alt="" loading="lazy" decoding="async"><div class="feed-card__gradient"></div>' : '') +
          '<div class="' + (d.image ? 'feed-card__info' : 'stream-note') + '">' +
            '<p class="stream-chip stream-chip--today">' + esc(d.chip || t('today')) + '</p>' +
            '<h2 class="' + (d.image ? 'feed-card__title' : 'stream-note__title') + '">' + esc(tx(d.title)) + '</h2>' +
            (d.text ? '<p class="' + (d.image ? 'feed-card__caption stream-card__text' : 'stream-note__text') + '">' + esc(tx(d.text)) + '</p>' : '') +
            (d.href ? '<a class="pack-btn pack-btn--primary stream-card__cta" href="' + esc(d.href) + '">' + esc(d.cta || t('open')) + '</a>' : '') +
          '</div>';
        if (!d.image && window.MentriaBackdrop) window.MentriaBackdrop.apply(note, 'daily/' + (d.kind || 'note') + '/' + tx(d.title), { dim: 0.8 });
        frag.appendChild(note);
        return;
      }
      var entry = it.entry, pack = entry.pack;
      var progress = P.getProgress(pack.id);
      var mode = it.kind === 'review' ? 'quiz' : (progress.mode === 'read' || !P.gradable(pack) ? 'read' : 'quiz');
      var sectionOf = {};
      pack.sections.forEach(function (s) { s.cards.forEach(function (id) { sectionOf[id] = s; }); });
      var sec;
      var opts = new C.Ctx({
        pack: pack, mode: mode, lang: lang, t: t, native: entry.native,
        sectionOf: function (id) { return sectionOf[id] || null; },
        getProgress: function () { return P.getProgress(pack.id); },
        onAnswer: function (card, right, extra) { P.recordAnswer(pack.id, card.id, right, extra); sec.dataset.done = '1'; },
        onContinue: function () { scrollToNext(sec); },
        live: function (text) { var live = document.getElementById('stream-live'); if (live) live.textContent = text; }
      });
      var idx = orderedCards(pack).findIndex(function (c) { return c.id === it.card.id; });
      var label = it.kind === 'review' ? t('review') : t('card_pos', { n: idx + 1, total: pack.cards.length });
      sec = packCard(Object.assign({ href: entry.native ? prefix + '/learn/' + pack.id + '/' : prefix + '/learn/play/?id=' + encodeURIComponent(pack.id) }, pack), it.card, it.kind, label, opts);
      frag.appendChild(sec);
    });
    if (res.exhausted) {
      var doneCard = el('section', 'feed-card stream-card stream-card--note');
      if (window.MentriaBackdrop) window.MentriaBackdrop.apply(doneCard, 'done/' + P.dayKey(), { dim: 0.7 });
      doneCard.innerHTML = '<div class="stream-note"><p class="stream-chip stream-chip--today">' + esc(t('today')) + '</p><h2 class="stream-note__title">' + esc(t('done_title')) + '</h2><p class="stream-note__text">' + esc(t('done_text')) + '</p></div>';
      frag.appendChild(doneCard);
    }
    dyn.appendChild(frag);
    watchSeen();
  }

  function watchSeen() {
    if (!('IntersectionObserver' in window)) return;
    var timers = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var sec = e.target, key = sec.dataset.packId + '/' + sec.dataset.cardId;
        if (e.isIntersecting && e.intersectionRatio >= 0.6) {
          sec.classList.add('is-current');
          var panel = sec.querySelector('.pack-card');
          try { (panel || sec).dispatchEvent(new CustomEvent('pack:enter')); } catch (_) {}
          if (sec.dataset.seen) return;
          timers[key] = setTimeout(function () {
            var type = sec.querySelector('.pack-slide').dataset.type;
            if (!P.INTERACTIVE[type] && !sec.dataset.done) P.recordSeen(sec.dataset.packId, sec.dataset.cardId);
            sec.dataset.seen = '1';
          }, 1500);
        } else {
          sec.classList.remove('is-current');
          if (timers[key]) { clearTimeout(timers[key]); delete timers[key]; }
        }
      });
    }, { root: scroller, threshold: [0.6] });
    Array.prototype.forEach.call(dyn.querySelectorAll('.stream-card--pack'), function (s) { io.observe(s); });
  }

  function reorderTail() {
    var order = seededOrder(tail);
    var existing = {};
    Array.prototype.forEach.call(tailEl.querySelectorAll('.stream-card'), function (s) { existing[s.dataset.packId] = s; });
    var frag = document.createDocumentFragment();
    var pending = [];
    order.forEach(function (x) {
      if (existing[x.id]) { frag.appendChild(existing[x.id]); }
      else pending.push(x);
    });
    tailEl.innerHTML = '';
    tailEl.appendChild(frag);
    Array.prototype.forEach.call(tailEl.querySelectorAll('.stream-card'), function (s) {
      var x = byId[s.dataset.packId];
      var pr = P.getProgress(s.dataset.packId);
      var cap = s.querySelector('.feed-card__caption');
      if (x && cap) cap.textContent = metaFor(x, pr);
    });
    if (!pending.length || !more) return;
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      var batch = pending.splice(0, PAGE);
      var f = document.createDocumentFragment();
      batch.forEach(function (x) { f.appendChild(coverCard({ id: x.id, title: x.title, cover: x.cover, meta: metaFor(x, P.getProgress(x.id)) }, x.collection, x.collection === 'source' ? 'Source' : 'Deep Cuts')); });
      tailEl.appendChild(f);
      if (!pending.length) { io.disconnect(); more.remove(); }
    }, { root: scroller, rootMargin: '200% 0px' });
    io.observe(more);
  }

  Array.prototype.forEach.call(document.querySelectorAll('#stream-tail .stream-card__blank'), function (b) { var sec = b.closest('.stream-card'); if (window.MentriaBackdrop && sec) window.MentriaBackdrop.apply(b, 'cover/' + sec.dataset.packId); });
  reorderTail();
  activePacks().then(buildDynamic).then(renderDynamic).catch(function (e) { console.error('stream', e); });
})();
