(function () {
  'use strict';
  var P = window.MentriaPacks, S = window.MentriaStore;
  if (!P || !S) return;
  var T = window.MENTRIA_STREAM_I18N || {};
  var packs = window.MENTRIA_PACKS || [];
  var prefix = T.prefix || '';
  var lang = document.documentElement.lang || 'en';
  var plural = (function () {
    try { var rules = new Intl.PluralRules(lang); return function (n) { return rules.select(n); }; } catch (_) { return function (n) { return n === 1 ? 'one' : 'other'; }; }
  })();
  var t = function (k, vars) {
    var L = window.MENTRIA_LEARN_I18N || {};
    if (vars && typeof vars.n === 'number' && plural(vars.n) === 'one' && (T[k + '_one'] != null || L[k + '_one'] != null)) k = k + '_one';
    var s = T[k] != null ? T[k] : (L[k] != null ? L[k] : k);
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(String(vars[v])); });
    return s;
  };
  var tx = function (v) { return P.text(v, lang); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  var byId = {};
  packs.forEach(function (x) { byId[x.id] = x; });

  var today0 = new Date();
  var DAY = Math.floor(Date.UTC(today0.getFullYear(), today0.getMonth(), today0.getDate()) / 86400000);
  function seededOrder(list, salt) {
    var seed = (DAY * 2654435761 + (salt || 0) * 40503) % 4294967296;
    function rng() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
    var a = list.map(function (x, i) { return { x: x, r: rng() + i * 1e-9 }; });
    a.sort(function (p, q) { return p.r - q.r; });
    return a.map(function (o) { return o.x; });
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

  function collectionLabel(c) { return c === 'source' ? 'Source' : (c === 'deepcuts' ? 'Deep Cuts' : t('imported')); }

  var HERO_BG = 'url("/assets/img/stream-hero.svg")';
  var heroCard = null, heroIntro = '';
  var hero = { pickId: null, contId: null, cont: null };

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
    seededOrder(packs, 2).some(function (x) {
      if (Object.keys(P.getProgress(x.id).cards || {}).length) return false;
      pick = x;
      return true;
    });
    return pick;
  }

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

  function mount() {
    try {
      var card = document.querySelector('.stream-card--hero');
      if (!card || heroCard) return;
      heroCard = card;
      heroCard.style.setProperty('--feed-card-bg', HERO_BG);
      var box = heroCard.querySelector('.stream-hero');
      heroIntro = box ? ['kicker', 'title', 'lede'].map(function (k) { var n = box.querySelector('.stream-hero__' + k); return n ? n.outerHTML : ''; }).join('') : '';
      renderHero(nativeContinue());
      ['online', 'offline'].forEach(function (type) {
        window.addEventListener(type, function () { if (hero.cont || hero.pickId) renderHero(hero.cont); });
      });
    } finally {
      document.documentElement.classList.remove('stream-pending');
    }
  }

  document.documentElement.classList.add('stream-pending');
  window.MentriaStream = {
    packs: packs, byId: byId, prefix: prefix, lang: lang,
    t: t, tx: tx, seededOrder: seededOrder, metaFor: metaFor,
    hero: { mount: mount, render: renderHero, nativeContinue: nativeContinue, state: hero }
  };
})();
