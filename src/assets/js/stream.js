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
  var plural = (function () {
    try { var rules = new Intl.PluralRules(lang); return function (n) { return rules.select(n); }; } catch (_) { return function (n) { return n === 1 ? 'one' : 'other'; }; }
  })();
  var t = function (k, vars) {
    if (vars && typeof vars.n === 'number' && plural(vars.n) === 'one' && (T[k + '_one'] != null || L[k + '_one'] != null)) k = k + '_one';
    var s = T[k] != null ? T[k] : (L[k] != null ? L[k] : k);
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(String(vars[v])); });
    return s;
  };
  var tx = function (v) { return P.text(v, lang); };
  var byId = {};
  tail.forEach(function (x) { byId[x.id] = x; });

  var today0 = new Date();
  var DAY = Math.floor(Date.UTC(today0.getFullYear(), today0.getMonth(), today0.getDate()) / 86400000);
  function seededOrder(list, salt) {
    var seed = (DAY * 2654435761 + (salt || 0) * 40503) % 4294967296;
    function rng() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
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
    if (!item.cover && window.MentriaBackdrop) { var bl = sec.querySelector('.stream-card__blank'); window.MentriaBackdrop.apply(bl, 'cover/' + item.id); sec.style.setProperty('--feed-card-bg', bl.style.backgroundImage); }
    if (item.cover) blankOnError(sec.querySelector('.feed-card__media'), 'cover/' + item.id);
    return sec;
  }

  function blankOnError(img, seed) {
    if (!img) return;
    var swap = function () {
      var sec = img.closest('.feed-card');
      var blank = el('div', 'feed-card__color-bg stream-card__blank');
      img.replaceWith(blank);
      if (!window.MentriaBackdrop) return;
      window.MentriaBackdrop.apply(blank, seed);
      if (sec) sec.style.setProperty('--feed-card-bg', blank.style.backgroundImage);
    };
    if (img.classList.contains('is-broken')) swap();
    else img.addEventListener('error', swap);
  }

  function metaFor(x, progress) {
    var parts = [];
    if (x.collection === 'source') parts.push('Source');
    else if (x.collection === 'deepcuts') parts.push('Deep Cuts');
    else if (x.source === 'import' || x.source === 'contact') parts.push(t('imported'));
    parts.push(t('cards_n', { n: x.cards }));
    if (x.minutes) parts.push(t('minutes_n', { n: x.minutes }));
    if (progress) {
      var seen = P.doneCount(progress);
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
    var ph = slide.querySelector('.pack-slide__ph');
    if (card.image) ambient(sec, card.image);
    if (!card.image && ph && ph.style.backgroundImage) sec.style.setProperty('--feed-card-bg', ph.style.backgroundImage);
    return sec;
  }

  var currentIo = ('IntersectionObserver' in window) ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { e.target.classList.toggle('is-current', e.isIntersecting && e.intersectionRatio > 0.55); });
  }, { root: scroller, threshold: [0.55] }) : null;
  var nearIo = currentIo ? new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.setAttribute('data-near', ''); nearIo.unobserve(e.target); } });
  }, { root: scroller, rootMargin: '100% 0px' }) : null;
  function watchCurrent(root) {
    var cards = (root || scroller).querySelectorAll('.feed-card');
    if (!currentIo) { Array.prototype.forEach.call(cards, function (c) { c.setAttribute('data-near', ''); }); return; }
    Array.prototype.forEach.call(cards, function (c) { if (!c.dataset.watched) { c.dataset.watched = '1'; currentIo.observe(c); nearIo.observe(c); } });
  }
  function ambient(sec, url) {
    if (url) sec.style.setProperty('--feed-card-bg', 'url("' + url + '")');
  }

  function scrollToNext(sec) {
    var n = sec.nextElementSibling;
    while (n && !n.classList.contains('feed-card')) n = n.nextElementSibling;
    if (!n) return;
    var still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { n.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' }); } catch (_) { n.scrollIntoView(); }
  }

  function loadNative(id) {
    return fetch('/learn/' + encodeURIComponent(id) + '/pack.json', { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function firstPacks(list, rankOf) {
    if (list.length <= MAX_PACKS) return list;
    return list.map(function (x, i) { return { x: x, i: i, k: rankOf(x) }; })
      .sort(function (a, b) { return (a.k.due - b.k.due) || (b.k.open - a.k.open) || (b.k.last - a.k.last) || (b.k.added - a.k.added) || (a.i - b.i); })
      .slice(0, MAX_PACKS)
      .sort(function (a, b) { return a.i - b.i; })
      .map(function (o) { return o.x; });
  }

  function activePacks() {
    var touched = S.list('packs').filter(function (k) { return k.indexOf('p.') === 0; }).map(function (k) { return k.slice(2); });
    return P.list().then(function (allRows) {
      var now = Date.now();
      var rank = function (id, total, added) {
        var pr = P.getProgress(id), due = Infinity;
        Object.keys(pr.cards || {}).forEach(function (k) { var c = pr.cards[k]; if (P.isDue(c, now) && c.d < due) due = c.d; });
        return { due: due, open: P.doneCount(pr) < total ? 1 : 0, last: pr.last || 0, added: added || 0 };
      };
      var byCourse = {};
      allRows.forEach(function (r) { var cid = P.courseOf(r); if (cid) (byCourse[cid] = byCourse[cid] || []).push(r); });
      var rows = allRows.filter(function (r) { return !P.courseOf(r); });
      Object.keys(byCourse).forEach(function (cid) {
        var packs = byCourse[cid].sort(function (a, b) { return (a.course.order || 0) - (b.course.order || 0); });
        var picked = false;
        packs.forEach(function (r) {
          var pr = P.getProgress(r.id);
          var seen = P.doneCount(pr);
          var due = Object.keys(pr.cards || {}).some(function (id) { return P.isDue(pr.cards[id], now); });
          if (!picked && seen < r.cards) { picked = true; rows.push(r); }
          else if (due) rows.push(r);
        });
      });
      var importedIds = allRows.map(function (r) { return r.id; });
      var nativeIds = touched.filter(function (id) { return byId[id] && importedIds.indexOf(id) < 0; });
      nativeIds.sort(function (a, b) { return (P.getProgress(b).last || 0) - (P.getProgress(a).last || 0); });
      var jobs = [];
      firstPacks(rows, function (r) { return rank(r.id, r.cards, r.updated || r.added); }).forEach(function (r) { jobs.push(P.get(r.id).then(function (row) { return row && row.pack ? { pack: P.normalize(row.pack), native: false, meta: row } : null; })); });
      firstPacks(nativeIds, function (id) { return rank(id, byId[id].cards, 0); }).forEach(function (id) { jobs.push(loadNative(id).then(function (p) { return p ? { pack: P.normalize(p), native: true, meta: byId[id] } : null; })); });
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
    var dailyItems = [], toolItems = [];
    var days = P.getDays(), answeredToday = days[P.dayKey()] || 0;
    var items = [];
    var reviews = [];
    packs.forEach(function (entry) {
      var progress = P.getProgress(entry.pack.id);
      orderedCards(entry.pack).forEach(function (c) {
        var r = progress.cards[c.id];
        if (P.isDue(r, now)) reviews.push({ entry: entry, card: c, due: r.d });
      });
    });
    reviews.sort(function (a, b) { return a.due - b.due; });
    reviews.slice(0, MAX_REVIEWS).forEach(function (r) { items.push({ kind: 'review', entry: r.entry, card: r.card }); });

    var todayKey = P.dayKey();
    daily.filter(function (d) { return d.date === todayKey; }).forEach(function (d) { dailyItems.push({ kind: 'daily', item: d }); });
    if (tools.length) {
      var tool = seededOrder(tools, 1)[0];
      toolItems.push({ kind: 'daily', item: { kind: 'tool', title: tx(tool.title), text: tx(tool.summary), href: prefix + '/tools/' + tool.slug + '/', cta: t('open_tool'), chip: t('try_tool') } });
    }
    if (new Date().getDay() === 6) toolItems.push({ kind: 'daily', item: { kind: 'lab', title: t('lab_title'), text: t('lab_text'), href: prefix + '/tools/ai-chat/', cta: t('open_tool'), chip: t('lab') } });

    var picks = [];
    var busy = {};
    packs.forEach(function (e) { busy[e.pack.id] = true; });
    if (hero.pickId) busy[hero.pickId] = true;
    seededOrder(tail, 2).some(function (x) {
      if (busy[x.id]) return false;
      var pr = P.getProgress(x.id);
      if (P.doneCount(pr) >= x.cards) return false;
      picks.push(x);
      return picks.length >= 2;
    });
    picks.forEach(function (x) { items.push({ kind: 'today', pick: x }); });
    items = items.concat(dailyItems);

    var budget = Math.max(0, BUDGET - answeredToday);
    var queues = packs.map(function (entry) {
      var progress = P.getProgress(entry.pack.id);
      var readMode = progress.mode === 'read';
      return { entry: entry, cards: orderedCards(entry.pack).filter(function (c) { return readMode ? !progress.cards[c.id] : !P.isDone(c, progress.cards[c.id]); }), taken: 0 };
    }).filter(function (q) { return q.cards.length; });
    var added = 0;
    while (added < budget && queues.some(function (q) { return q.cards.length && q.taken < 3; })) {
      queues.forEach(function (q) {
        if (added >= budget || !q.cards.length || q.taken >= 3) return;
        items.push({ kind: 'next', entry: q.entry, card: q.cards.shift() });
        q.taken++; added++;
      });
    }
    items = items.concat(toolItems);
    var exhausted = packs.length && !added && !reviews.length && budget === 0;
    return { items: items, exhausted: exhausted, packs: packs };
  }

  function localHref(href) {
    var path = href.split('#')[0].split('?')[0];
    if (path.charAt(0) !== '/' || path.charAt(1) === '/' || path.indexOf('/assets/') === 0 || path.slice(-1) !== '/') return href;
    (window.MENTRIA_LOCALES || []).some(function (l) {
      if (!l.prefix || path.indexOf(l.prefix + '/') !== 0) return false;
      href = href.slice(l.prefix.length);
      path = path.slice(l.prefix.length);
      return true;
    });
    return (window.MENTRIA_EN_ONLY || []).indexOf(path) < 0 ? prefix + href : href;
  }

  function renderDynamic(res) {
    var renderedAt = Date.now();
    var frag = document.createDocumentFragment();
    res.items.forEach(function (it) {
      if (it.kind === 'today') {
        frag.appendChild(coverCard({ id: it.pick.id, title: it.pick.title, cover: it.pick.cover, meta: metaFor(it.pick), cta: t('start') }, 'today', t('today')));
        return;
      }
      if (it.kind === 'daily') {
        var d = it.item, href = localHref(tx(d.href));
        var note = el('section', 'feed-card stream-card stream-card--note stream-card--daily');
        if (d.image) { note.classList.add('stream-card--cover'); note.classList.remove('stream-card--note'); note.style.setProperty('--feed-card-bg', 'url("' + d.image + '")'); }
        var chip = '<p class="stream-chip stream-chip--today">' + esc(tx(d.chip) || t('today')) + '</p>';
        note.innerHTML =
          (d.image ? '<img class="feed-card__media" src="' + esc(d.image) + '" alt="" loading="lazy" decoding="async"><div class="feed-card__gradient"></div>' + chip : '') +
          '<div class="' + (d.image ? 'feed-card__info' : 'stream-note') + '">' +
            (d.image ? '' : chip) +
            '<h2 class="' + (d.image ? 'feed-card__title' : 'stream-note__title') + '">' + esc(tx(d.title)) + '</h2>' +
            (d.text ? '<p class="' + (d.image ? 'feed-card__caption stream-card__text' : 'stream-note__text') + '">' + esc(tx(d.text)) + '</p>' : '') +
            (href ? '<a class="pack-btn pack-btn--primary stream-card__cta" href="' + esc(href) + '">' + esc(tx(d.cta) || t('open')) + '</a>' : '') +
          '</div>';
        if (!d.image && window.MentriaBackdrop) { window.MentriaBackdrop.apply(note, 'daily/' + (d.kind || 'note') + '/' + tx(d.title), { dim: 0.8 }); note.style.setProperty('--feed-card-bg', note.style.backgroundImage); }
        if (d.image) { ambient(note, d.image); blankOnError(note.querySelector('.feed-card__media'), 'daily/' + (d.kind || 'note') + '/' + tx(d.title)); }
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
        onAnswer: function (card, right, extra) {
          var cur = P.getProgress(pack.id).cards[card.id];
          if (!(cur && (cur.r === 'right' || cur.r === 'wrong') && cur.t > renderedAt)) P.recordAnswer(pack.id, card.id, right, extra);
          sec.dataset.done = '1';
        },
        onContinue: function () { scrollToNext(sec); },
        live: function (text) { var live = document.getElementById('stream-live'); if (live) live.textContent = text; }
      });
      var idx = orderedCards(pack).findIndex(function (c) { return c.id === it.card.id; });
      var label = it.kind === 'review' ? t('review') : t('card_pos', { n: idx + 1, total: pack.cards.length });
      sec = packCard(Object.assign({ href: entry.native ? prefix + '/learn/' + pack.id + '/' : prefix + '/learn/play/?id=' + encodeURIComponent(pack.id) }, pack), it.card, it.kind, label, opts);
      sec.dataset.mode = mode;
      frag.appendChild(sec);
    });
    if (res.exhausted) {
      var doneCard = el('section', 'feed-card stream-card stream-card--note');
      if (window.MentriaBackdrop) { window.MentriaBackdrop.apply(doneCard, 'done/' + P.dayKey(), { dim: 0.7 }); doneCard.style.setProperty('--feed-card-bg', doneCard.style.backgroundImage); }
      doneCard.innerHTML = '<div class="stream-note"><p class="stream-chip stream-chip--today">' + esc(t('today')) + '</p><h2 class="stream-note__title">' + esc(t('done_title')) + '</h2><p class="stream-note__text">' + esc(t('done_text')) + '</p></div>';
      frag.appendChild(doneCard);
    }
    dyn.appendChild(frag);
    watchCurrent(dyn);
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
            if ((!P.INTERACTIVE[type] || sec.dataset.mode === 'read') && !sec.dataset.done) P.recordSeen(sec.dataset.packId, sec.dataset.cardId, !!P.INTERACTIVE[type]);
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

  function refreshTail() {
    Array.prototype.forEach.call(tailEl.querySelectorAll('.stream-card'), function (s) {
      var x = byId[s.dataset.packId];
      var cap = s.querySelector('.feed-card__caption');
      if (x && cap) cap.textContent = metaFor(x, P.getProgress(s.dataset.packId));
    });
  }

  function reorderTail() {
    var order = seededOrder(tail, 3);
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
    refreshTail();
    if (!pending.length || !more) return;
    var io = new IntersectionObserver(function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      var batch = pending.splice(0, PAGE);
      var f = document.createDocumentFragment();
      batch.forEach(function (x) { f.appendChild(coverCard({ id: x.id, title: x.title, cover: x.cover, meta: metaFor(x, P.getProgress(x.id)) }, x.collection, x.collection === 'source' ? 'Source' : 'Deep Cuts')); });
      tailEl.appendChild(f);
      watchCurrent(tailEl);
      if (!pending.length) { io.disconnect(); more.remove(); }
    }, { root: scroller, rootMargin: '200% 0px' });
    io.observe(more);
  }

  Array.prototype.forEach.call(document.querySelectorAll('#stream-tail .stream-card__blank'), function (b) { var sec = b.closest('.stream-card'); if (window.MentriaBackdrop && sec) { window.MentriaBackdrop.apply(b, 'cover/' + sec.dataset.packId); sec.style.setProperty('--feed-card-bg', b.style.backgroundImage); } });
  Array.prototype.forEach.call(tailEl.querySelectorAll('img.feed-card__media'), function (img) { var sec = img.closest('.stream-card'); if (sec) blankOnError(img, 'cover/' + sec.dataset.packId); });
  var heroCard = scroller.querySelector('.stream-card--hero');
  var HERO_BG = 'url("/assets/img/stream-hero.svg")';
  if (heroCard) heroCard.style.setProperty('--feed-card-bg', HERO_BG);
  var hero = { pickId: null, contId: null, cont: null };
  var heroIntro = (function () {
    var box = heroCard && heroCard.querySelector('.stream-hero');
    if (!box) return '';
    return ['kicker', 'title', 'lede'].map(function (k) { var n = box.querySelector('.stream-hero__' + k); return n ? n.outerHTML : ''; }).join('');
  })();

  function toolUsage() {
    try { return JSON.parse(localStorage.getItem('mentria_tool_usage')) || {}; } catch (_) { return {}; }
  }
  function recentTools(limit) {
    var usage = toolUsage();
    var data = (window.MENTRIA_PALETTE_DATA && window.MENTRIA_PALETTE_DATA.tools) || [];
    var bySlug = {};
    data.forEach(function (x) { bySlug[x.slug] = x; });
    var now = Date.now();
    function score(e) { return (e.count || 0) + 6 / (1 + (now - (e.last || 0)) / 86400000); }
    return Object.keys(usage).filter(function (s) { return bySlug[s]; })
      .sort(function (a, b) { return score(usage[b]) - score(usage[a]); })
      .slice(0, limit).map(function (s) { return bySlug[s]; });
  }
  function weekCount() {
    return P.week().filter(function (d) { return d.on; }).length;
  }
  function touchedNative() {
    return S.list('packs').filter(function (k) { return k.indexOf('p.') === 0; }).map(function (k) { return k.slice(2); }).filter(function (id) { return byId[id]; });
  }
  function nativeContinue() {
    var best = null, bestLast = -1;
    touchedNative().forEach(function (id) {
      var x = byId[id], pr = P.getProgress(id);
      var seen = P.doneCount(pr);
      if (!seen || seen >= x.cards) return;
      if ((pr.last || 0) > bestLast) { bestLast = pr.last || 0; best = { id: id, title: x.title, cover: x.cover, total: x.cards, seen: seen, collection: x.collection, href: prefix + '/learn/' + id + '/', last: pr.last || 0 }; }
    });
    return best;
  }
  function heroPick() {
    var pick = null;
    seededOrder(tail, 2).some(function (x) {
      if (Object.keys(P.getProgress(x.id).cards || {}).length) return false;
      pick = x;
      return true;
    });
    return pick;
  }
  function collectionLabel(c) { return c === 'source' ? 'Source' : (c === 'deepcuts' ? 'Deep Cuts' : t('imported')); }

  function heroWithoutCover() {
    Array.prototype.forEach.call(heroCard.querySelectorAll('.stream-hero__bg, .stream-hero__shade'), function (n) { n.remove(); });
    heroCard.classList.remove('stream-card--hero-media');
    heroCard.style.setProperty('--feed-card-bg', HERO_BG);
  }

  function opensOffline(href) {
    if (!('caches' in window)) return Promise.resolve(true);
    var u;
    try { u = new URL(href, location.href); } catch (_) { return Promise.resolve(true); }
    var path = u.pathname, base = path, locs = window.MENTRIA_LOCALES || [];
    locs.some(function (l) {
      if (!l.prefix || path.indexOf(l.prefix + '/') !== 0) return false;
      base = path.slice(l.prefix.length);
      return true;
    });
    var tries = [path + u.search];
    if (base !== path) tries.push(base);
    if (/^\/learn\/(?!format\/)[^/]+\/$/.test(base)) locs.forEach(function (l) { if (l.prefix && l.prefix + base !== path) tries.push(l.prefix + base); });
    return tries.reduce(function (found, p) {
      return found.then(function (ok) {
        return ok || caches.match(p, { ignoreSearch: true }).then(function (r) { return !!r; }, function () { return false; });
      });
    }, Promise.resolve(false));
  }

  function guardOffline(box) {
    var go = box.querySelector('.stream-hero__go');
    if (!go || navigator.onLine !== false) return;
    go.hidden = true;
    opensOffline(go.getAttribute('href')).then(function (ok) {
      if (!go.isConnected) return;
      if (ok) { go.hidden = false; return; }
      var actions = go.parentNode;
      go.remove();
      var browse = actions.querySelector('.pack-btn');
      if (browse) browse.className = 'pack-btn pack-btn--primary';
      box.insertBefore(el('p', 'stream-hero__note', esc(t('continue_offline'))), actions);
    });
  }

  function renderHero(cont) {
    var box = heroCard && heroCard.querySelector('.stream-hero');
    if (!box) return;
    hero.cont = cont || null;
    var usage = toolUsage();
    var returning = !!cont || touchedNative().length > 0 || Object.keys(usage).length > 0 || Object.keys(P.getDays() || {}).length > 0;
    var pick = cont ? null : heroPick();
    if (!returning && !pick) return;
    hero.pickId = pick ? pick.id : null;
    hero.contId = cont ? cont.id : null;
    var cover = cont ? cont.cover : pick && pick.cover;
    var media = heroCard.querySelector('.stream-hero__bg');
    if (cover) {
      if (!media) {
        media = el('img', 'feed-card__media stream-hero__bg');
        media.alt = '';
        media.decoding = 'async';
        media.fetchPriority = 'high';
        media.addEventListener('error', heroWithoutCover);
        heroCard.insertBefore(el('div', 'stream-hero__shade'), heroCard.firstChild);
        heroCard.insertBefore(media, heroCard.firstChild);
      }
      if (media.getAttribute('src') !== cover) media.src = cover;
      heroCard.classList.add('stream-card--hero-media');
      heroCard.style.setProperty('--feed-card-bg', 'url("' + cover + '")');
    }
    var html = '';
    var action = '';
    if (cont) {
      var pct = Math.round((cont.seen / cont.total) * 100);
      html += '<p class="stream-hero__kicker">' + esc(t('welcome_back')) + '</p>' +
        '<h1 class="stream-hero__title stream-hero__title--pack">' + esc(tx(cont.title)) + '</h1>' +
        '<p class="stream-hero__meta">' + esc(collectionLabel(cont.collection) + ' · ' + t('card_pos', { n: Math.min(cont.seen + 1, cont.total), total: cont.total })) + '</p>' +
        '<div class="stream-hero__bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div>';
      action = '<a class="pack-btn pack-btn--primary stream-hero__go" href="' + esc(cont.href) + '">' + esc(t('continue')) + '</a>';
    } else if (returning && !pick) {
      html += '<p class="stream-hero__kicker">' + esc(t('welcome_back')) + '</p>';
    } else if (returning) {
      html += '<p class="stream-hero__kicker">' + esc(t('welcome_back')) + '</p>' +
        '<p class="stream-chip stream-chip--today stream-hero__chip">' + esc(t('today')) + '</p>' +
        '<h1 class="stream-hero__title stream-hero__title--pack">' + esc(tx(pick.title)) + '</h1>' +
        '<p class="stream-hero__meta">' + esc(metaFor(pick)) + '</p>';
      action = '<a class="pack-btn pack-btn--primary stream-hero__go" href="' + esc(prefix + '/learn/' + pick.id + '/') + '">' + esc(t('start_today')) + '</a>';
    } else {
      html += heroIntro +
        '<p class="stream-hero__pick"><span class="stream-chip stream-chip--today">' + esc(t('today')) + '</span><span class="stream-hero__pick-title">' + esc(tx(pick.title)) + '</span><span class="stream-hero__pick-meta">' + esc(metaFor(pick)) + '</span></p>';
      action = '<a class="pack-btn pack-btn--primary stream-hero__go" href="' + esc(prefix + '/learn/' + pick.id + '/') + '">' + esc(t('start_today')) + '</a>';
    }
    html += '<div class="stream-hero__actions">' + action + '<a class="pack-btn ' + (action ? 'pack-btn--ghost' : 'pack-btn--primary') + '" href="' + esc(prefix + '/learn/') + '">' + esc(t('browse')) + '</a></div>';
    if (returning) {
      var n = weekCount();
      html += '<p class="stream-hero__week">' + esc(n ? t('week_n', { n: n }) : t('week_zero')) + '</p>';
      var recent = recentTools(4);
      if (recent.length) {
        html += '<div class="stream-hero__tools"><span class="stream-hero__tools-label">' + esc(t('your_tools')) + '</span>' +
          recent.map(function (x) { return '<a class="stream-hero__tool" href="' + esc(x.url || prefix + '/tools/' + x.slug + '/') + '">' + esc(x.title) + '</a>'; }).join('') +
          '</div>';
      }
    }
    box.innerHTML = html;
    box.classList.toggle('stream-hero--back', returning);
    guardOffline(box);
  }

  function importedContinue(packs) {
    if (hero.contId) return;
    var imported = null, last = -1;
    packs.forEach(function (e) {
      if (e.native) return;
      var pr = P.getProgress(e.pack.id), seen = P.doneCount(pr), total = e.pack.cards.length;
      if (seen && seen < total && (pr.last || 0) > last) { last = pr.last || 0; imported = { id: e.pack.id, title: e.pack.title, cover: e.pack.cover || (e.meta && e.meta.cover), total: total, seen: seen, collection: 'import', href: prefix + '/learn/play/?id=' + encodeURIComponent(e.pack.id) }; }
    });
    if (imported) renderHero(imported);
  }

  function packSection(root, id) {
    for (var n = root.firstElementChild; n; n = n.nextElementSibling) {
      if (n.dataset.packId === id) return n;
    }
    return null;
  }

  function land(id) {
    var target = packSection(dyn, id) || packSection(tailEl, id);
    if (!target) return;
    scroller.scrollTop = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  }

  var openedPack = null;
  scroller.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var sec = a.closest('.stream-card[data-pack-id]');
    openedPack = sec ? sec.dataset.packId : null;
  });

  renderHero(nativeContinue());
  watchCurrent();
  reorderTail();
  activePacks().then(function (packs) {
    importedContinue(packs);
    return buildDynamic(packs);
  }).then(renderDynamic).catch(function (e) { console.error('stream', e); });
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    var back = openedPack;
    openedPack = null;
    renderHero(nativeContinue());
    refreshTail();
    activePacks().then(function (packs) {
      importedContinue(packs);
      return buildDynamic(packs);
    }).then(function (res) {
      C.release(dyn);
      dyn.innerHTML = '';
      renderDynamic(res);
      if (back) land(back);
    }).catch(function () {});
  });
  ['online', 'offline'].forEach(function (type) {
    window.addEventListener(type, function () { if (hero.cont || hero.pickId) renderHero(hero.cont); });
  });
})();
