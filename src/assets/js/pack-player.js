(function () {
  'use strict';

  var root = document.getElementById('packRoot');
  if (!root || !window.MentriaPacks || !window.MentriaPackCards) return;
  var P = window.MentriaPacks;
  var C = window.MentriaPackCards;
  var esc = C.esc, el = C.el;
  var T = window.MENTRIA_LEARN_I18N || {};
  var t = function (k, vars) {
    var s = T[k] || k;
    if (vars) Object.keys(vars).forEach(function (v) { s = s.split('{' + v + '}').join(String(vars[v])); });
    return s;
  };
  var lang = document.documentElement.lang || 'en';
  var tx = function (v) { return P.text(v, lang); };
  var localePrefix = root.dataset.prefix || '';
  var libraryHref = localePrefix + '/learn/';

  var pack = null, native = false, order = [], byId = {}, sectionOf = {}, current = 0, mode = 'quiz', progress = null;
  var BUDGET = 10;
  function renderMode() { return mode === 'read' ? 'read' : 'quiz'; }
  var slides = [], segs = [], stage, progressBar, liveEl, hint, modeWrap, secLabel, shareBtn;
  var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  function load() {
    var inline = document.getElementById('pack-data');
    if (inline) {
      try { native = true; return Promise.resolve(JSON.parse(inline.textContent)); } catch (_) { return Promise.resolve(null); }
    }
    var id = new URLSearchParams(location.search).get('id');
    if (!id) return Promise.resolve(null);
    return P.get(id).then(function (row) { return row ? row.pack : null; });
  }

  function notFound() {
    root.innerHTML = '';
    var panel = el('div', 'pack-card pack-card--center');
    panel.appendChild(el('h2', 'pack-card__title', esc(t('not_found'))));
    panel.appendChild(el('p', 'pack-card__text', esc(t('not_found_hint'))));
    var a = el('a', 'pack-btn pack-btn--primary', esc(t('back_to_library')));
    a.href = libraryHref;
    panel.appendChild(a);
    root.appendChild(panel);
  }

  function ctx() {
    return new C.Ctx({
      pack: pack, mode: renderMode(), lang: lang, t: t, native: native,
      sectionOf: function (id) { return sectionOf[id] || null; },
      getProgress: function () { return progress; },
      onAnswer: function (card, right, extra) {
        P.recordAnswer(pack.id, card.id, right, extra);
        progress = P.getProgress(pack.id);
        updateSeg(current);
        refreshModes();
      },
      onContinue: function () { go(current + 1); },
      live: function (text) { if (liveEl) liveEl.textContent = text; }
    });
  }

  function build() {
    pack = P.normalize(pack);
    pack.cards.forEach(function (c) { byId[c.id] = c; });
    pack.sections.forEach(function (s) { s.cards.forEach(function (id) { sectionOf[id] = s; }); });
    progress = P.getProgress(pack.id);
    var avail = P.availableModes(pack, progress);
    mode = avail.indexOf(progress.mode) >= 0 ? progress.mode : (avail.indexOf('quiz') >= 0 ? 'quiz' : 'read');
    root.innerHTML = '';
    root.dataset.mode = mode;

    progressBar = el('div', 'deck__progress');
    progressBar.setAttribute('role', 'progressbar');
    progressBar.setAttribute('aria-label', t('progress_label'));
    progressBar.setAttribute('aria-valuemin', '1');
    root.appendChild(progressBar);

    var close = el('button', 'deck__close');
    close.type = 'button';
    close.setAttribute('aria-label', t('exit'));
    close.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    close.addEventListener('click', exit);
    root.appendChild(close);

    shareBtn = el('button', 'deck__share');
    shareBtn.type = 'button';
    shareBtn.id = 'deckShare';
    shareBtn.setAttribute('aria-label', t('share_card'));
    shareBtn.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.7" x2="15.4" y2="6.3"/><line x1="8.6" y1="13.3" x2="15.4" y2="17.7"/></svg>';
    shareBtn.addEventListener('click', shareCard);
    root.appendChild(shareBtn);

    var meta = el('div', 'deck__chapter-meta pack-meta');
    secLabel = el('span', 'deck__chapter-num');
    meta.appendChild(secLabel);
    meta.appendChild(el('span', 'deck__chapter-title', esc(tx(pack.title))));
    root.appendChild(meta);

    modeWrap = el('div', 'pack-mode');
    modeWrap.setAttribute('role', 'group');
    modeWrap.setAttribute('aria-label', t('mode_label'));
    root.appendChild(modeWrap);
    refreshModes();

    var prev = el('button', 'deck__tap deck__tap--prev'); prev.type = 'button'; prev.tabIndex = -1; prev.setAttribute('aria-label', t('prev_card'));
    var next = el('button', 'deck__tap deck__tap--next'); next.type = 'button'; next.tabIndex = -1; next.setAttribute('aria-label', t('next_card'));
    prev.addEventListener('click', function () { go(current - 1); });
    next.addEventListener('click', function () { go(current + 1); });
    root.appendChild(prev); root.appendChild(next);

    stage = el('div', 'pack-stage');
    root.appendChild(stage);

    hint = el('div', 'deck__hint', coarse
      ? '<span>' + esc(t('hint_tap_short')) + '</span><span>' + esc(t('hint_depth')) + '</span><span>' + esc(t('hint_exit')) + '</span>'
      : '<span>' + esc(t('hint_tap')) + '</span><span>' + esc(t('hint_keys')) + '</span>');
    root.appendChild(hint);
    liveEl = el('div', 'sr-only'); liveEl.setAttribute('role', 'status'); liveEl.setAttribute('aria-live', 'polite');
    root.appendChild(liveEl);

    rebuildOrder();
    go(startIndex(), true);
    bindInput();
  }

  function refreshModes() {
    var avail = P.availableModes(pack, progress);
    modeWrap.innerHTML = '';
    avail.forEach(function (m) {
      var b = el('button', 'pack-mode__btn', esc(t('mode_' + m)));
      b.type = 'button';
      b.dataset.mode = m;
      b.classList.toggle('is-active', m === mode);
      b.setAttribute('aria-pressed', m === mode ? 'true' : 'false');
      b.addEventListener('click', function () { setMode(m); });
      modeWrap.appendChild(b);
    });
    modeWrap.hidden = avail.length < 2;
  }

  function startIndex() {
    var m = (location.hash || '').match(/^#c(\d+)$/);
    if (m) { var i = +m[1] - 1; if (i >= 0 && i < order.length) return i; }
    for (var k = 0; k < order.length; k++) if (!progress.cards[order[k]]) return k;
    return 0;
  }

  function renderAll() {
    stage.innerHTML = '';
    progressBar.innerHTML = '';
    slides = []; segs = [];
    var showSegs = order.length <= 40;
    progressBar.classList.toggle('deck__progress--bar', !showSegs);
    progressBar.setAttribute('aria-valuemax', String(order.length));
    var c = ctx();
    order.forEach(function (id, i) {
      var s = C.render(byId[id], c);
      s.dataset.idx = String(i);
      stage.appendChild(s);
      slides.push(s);
      if (showSegs) {
        var seg = el('div', 'deck__progress-seg', '<span class="deck__progress-fill"></span>');
        progressBar.appendChild(seg);
        segs.push(seg);
      }
    });
    if (!showSegs) {
      var seg1 = el('div', 'deck__progress-seg', '<span class="deck__progress-fill"></span>');
      progressBar.appendChild(seg1);
      segs.push(seg1);
    }
    var fin = renderFinish();
    stage.appendChild(fin);
    slides.push(fin);
    refreshModes();
    root.dataset.mode = mode;
  }

  function renderFinish() {
    var s = el('article', 'deck__slide pack-slide pack-slide--finish');
    s.dataset.idx = String(order.length);
    var p = el('div', 'pack-card pack-card--center');
    p.appendChild(el('p', 'pack-card__kicker', esc(t('finish_kicker'))));
    p.appendChild(el('h2', 'pack-card__title', esc(tx(pack.title))));
    var stats = el('p', 'pack-card__stats');
    p.appendChild(stats);
    var again = el('button', 'pack-btn pack-btn--primary', esc(t('restart')));
    again.type = 'button';
    again.addEventListener('click', function () { if (mode === 'review' || mode === 'budget') setMode('quiz', true); else { rebuildOrder(); go(0); } });
    var review = el('button', 'pack-btn', esc(t('review_wrong')));
    review.type = 'button';
    review.addEventListener('click', function () { setMode('review', true); });
    var lib = el('a', 'pack-btn pack-btn--ghost', esc(t('back_to_library')));
    lib.href = libraryHref;
    var row = el('div', 'pack-card__actions');
    row.appendChild(again); row.appendChild(review); row.appendChild(lib);
    p.appendChild(row);
    s.appendChild(p);
    var note = el('p', 'pack-card__text');
    note.hidden = true;
    p.insertBefore(note, stats);
    s.addEventListener('pack:enter', function () {
      var sum = P.summary(pack, progress);
      stats.textContent = t('finish_stats', { seen: sum.seen, total: sum.total, right: sum.right, wrong: sum.wrong });
      note.hidden = !(mode === 'review' && !order.length) && !(mode === 'budget');
      note.textContent = mode === 'review' && !order.length ? t('nothing_to_review') : (mode === 'budget' ? t('budget_done') : '');
      review.hidden = !sum.wrong || mode === 'review';
      P.setMode(pack.id, mode);
    });
    return s;
  }

  function rebuildOrder() {
    var all = [];
    pack.sections.forEach(function (s) { s.cards.forEach(function (id) { if (byId[id]) all.push(id); }); });
    if (mode === 'review') {
      order = all.filter(function (id) { var r = progress.cards[id]; return r && r.r === 'wrong'; });
    } else if (mode === 'budget') {
      var now = Date.now();
      var due = all.filter(function (id) { var r = progress.cards[id]; return r && r.r === 'wrong' && r.d && r.d <= now; });
      var fresh = all.filter(function (id) { return !progress.cards[id]; });
      var answeredToday = P.getDays()[P.dayKey()] || 0;
      order = due.concat(fresh).slice(0, Math.max(0, BUDGET - answeredToday) + due.length).slice(0, BUDGET);
    } else {
      order = all;
    }
    renderAll();
  }

  function updateSeg(i) {
    if (segs.length === 1 && order.length > 40) {
      segs[0].querySelector('.deck__progress-fill').style.width = Math.round((Math.min(i, order.length) / order.length) * 100) + '%';
      segs[0].classList.add('is-active');
      return;
    }
    segs.forEach(function (seg, k) {
      var r = progress.cards[order[k]];
      seg.classList.toggle('is-done', k < i);
      seg.classList.toggle('is-active', k === i);
      seg.classList.toggle('is-right', !!r && r.r === 'right');
      seg.classList.toggle('is-wrong', !!r && r.r === 'wrong');
    });
  }

  function go(i, silent) {
    if (i < 0 || i > order.length) return;
    current = i;
    slides.forEach(function (s, k) { s.classList.toggle('is-active', k === i); });
    var s = slides[i];
    if (i < order.length) {
      var id = order[i];
      var sec = sectionOf[id];
      var secTitle = sec ? tx(sec.title) : '';
      secLabel.textContent = secTitle === tx(pack.title) ? '' : secTitle;
      if (!progress.cards[id] || !P.INTERACTIVE[byId[id].type]) { P.recordSeen(pack.id, id); progress = P.getProgress(pack.id); }
      progressBar.setAttribute('aria-valuenow', String(i + 1));
      liveEl.textContent = t('card_of', { n: i + 1, total: order.length });
      try { history.replaceState(null, '', '#c' + (i + 1)); } catch (_) {}
    } else {
      secLabel.textContent = '';
      try { history.replaceState(null, '', '#end'); } catch (_) {}
    }
    if (shareBtn) shareBtn.hidden = i >= order.length;
    updateSeg(i);
    var target = s.querySelector('.pack-card') || s;
    try { target.dispatchEvent(new CustomEvent('pack:enter')); } catch (_) {}
    try { s.dispatchEvent(new CustomEvent('pack:enter')); } catch (_) {}
    if (hint && (!silent || (i < order.length && byId[order[i]].type === 'canvas'))) hint.classList.add('is-fading');
    var focusable = s.querySelector('input, button:not(.deck__tap):not(.pack-more):not([disabled])');
    if (focusable && !silent && document.activeElement && document.activeElement.tagName !== 'INPUT') { try { focusable.focus({ preventScroll: true }); } catch (_) {} }
  }

  function setMode(m, restart) {
    if (m === mode && !restart) return;
    var structural = m === 'review' || m === 'budget' || mode === 'review' || mode === 'budget';
    mode = m;
    P.setMode(pack.id, mode);
    var keep = current;
    rebuildOrder();
    go(structural || restart ? 0 : Math.min(keep, order.length), true);
  }

  function moreBtn() { return slides[current] ? slides[current].querySelector('.pack-more') : null; }
  function isExpanded() { var m = moreBtn(); return !!m && m.getAttribute('aria-expanded') === 'true'; }
  function expandCurrent() { var m = moreBtn(); if (m && !isExpanded()) m.click(); }
  function collapseCurrent() { var m = moreBtn(); if (m && isExpanded()) m.click(); }

  function slideImageUrl(s) {
    var img = s.querySelector('img.deck__slide-img, img.pack-image__img');
    if (img && (img.currentSrc || img.src)) return img.currentSrc || img.src;
    var bg = s.style.getPropertyValue('--slide-bg');
    var m = bg && bg.match(/url\((['"]?)([^'")]+)\1\)/);
    return m ? m[2] : '';
  }

  function shareCard() {
    if (!shareBtn || shareBtn.classList.contains('is-busy') || !window.MentriaShareCard || current >= order.length) return;
    var s = slides[current];
    var textEl = s.querySelector('.deck__caption, .pack-card__q, .pack-cloze, .pack-card__text, .pack-overlay__title, .pack-card__title');
    var caption = textEl ? textEl.textContent.replace(/\s+/g, ' ').trim() : tx(pack.title);
    var tag = secLabel.textContent || t('card_of', { n: current + 1, total: order.length });
    var pageUrl = native ? location.origin + location.pathname : location.origin + libraryHref;
    shareBtn.classList.add('is-busy');
    window.MentriaShareCard.render({ imageUrl: slideImageUrl(s), caption: caption, subtitle: tx(pack.title), tag: tag })
      .then(function (blob) {
        return window.MentriaShareCard.share(blob, pack.id + '-c' + (current + 1) + '.png', { title: document.title, text: tx(pack.title) + ' — ' + pageUrl });
      })
      .catch(function () {})
      .then(function () { shareBtn.classList.remove('is-busy'); });
  }

  function exit() {
    try {
      var ref = document.referrer ? new URL(document.referrer) : null;
      if (ref && ref.origin === location.origin && history.length > 1) { history.back(); return; }
    } catch (_) {}
    location.href = libraryHref;
  }

  function bindInput() {
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') { if (e.key === 'Escape') { e.target.blur(); } return; }
      if (e.target && e.target.closest && (e.key === ' ' || e.key === 'Enter') && e.target.closest('button, a[href], [role="button"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(current + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(current - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); expandCurrent(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (isExpanded()) collapseCurrent(); else exit(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (isExpanded()) collapseCurrent(); else exit(); }
    });
    var sx = 0, sy = 0, st = 0, scrolls = false;
    root.addEventListener('touchstart', function (e) {
      var tch = e.touches[0]; sx = tch.clientX; sy = tch.clientY; st = Date.now();
      var c = e.target.closest ? e.target : null;
      scrolls = !!(c && c.closest('.pack-card, .pack-canvas, .pack-body:not(.is-collapsed), input, textarea'));
    }, { passive: true });
    root.addEventListener('touchend', function (e) {
      var tch = e.changedTouches[0];
      var dx = tch.clientX - sx, dy = tch.clientY - sy;
      var ax = Math.abs(dx), ay = Math.abs(dy);
      if (Date.now() - st > 700 || Math.max(ax, ay) < 40) return;
      if (e.target.closest && e.target.closest('input[type="range"]')) return;
      if (ay > ax) {
        if (scrolls) return;
        if (dy < 0) expandCurrent();
        else if (isExpanded()) collapseCurrent();
        else exit();
      } else if (ax >= 50) {
        if (dx < 0) go(current + 1); else go(current - 1);
      }
    }, { passive: true });
  }

  load().then(function (p) {
    if (!p) { notFound(); return; }
    var v = P.validate(p);
    if (!v.ok) { notFound(); return; }
    pack = p;
    build();
  }).catch(notFound);
})();
