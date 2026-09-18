(function () {
  'use strict';

  var root = document.getElementById('packRoot');
  if (!root || !window.MentriaPacks) return;
  var P = window.MentriaPacks;
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

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function md(s) {
    s = tx(s);
    if (!s) return '';
    return window.renderMarkdown ? window.renderMarkdown(s) : '<p>' + esc(s) + '</p>';
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?'"’]/g, ''); }

  var pack = null, native = false, order = [], byId = {}, sectionOf = {}, current = 0, mode = 'quiz', progress = null, reviewOnly = false;
  var slides = [], segs = [], stage, progressBar, liveEl, hint, modeWrap, secLabel;

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

  function build() {
    pack = P.normalize(pack);
    pack.cards.forEach(function (c) { byId[c.id] = c; });
    pack.sections.forEach(function (s) { s.cards.forEach(function (id) { sectionOf[id] = s; }); });
    order = [];
    pack.sections.forEach(function (s) { s.cards.forEach(function (id) { if (byId[id]) order.push(id); }); });
    progress = P.getProgress(pack.id);
    mode = progress.mode || (pack.modes.indexOf('quiz') >= 0 ? 'quiz' : 'read');
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

    var meta = el('div', 'deck__chapter-meta pack-meta');
    secLabel = el('span', 'deck__chapter-num');
    meta.appendChild(secLabel);
    meta.appendChild(el('span', 'deck__chapter-title', esc(tx(pack.title))));
    root.appendChild(meta);

    modeWrap = el('div', 'pack-mode');
    modeWrap.setAttribute('role', 'group');
    modeWrap.setAttribute('aria-label', t('mode_label'));
    ['read', 'quiz'].forEach(function (m) {
      if (pack.modes.indexOf(m) < 0) return;
      var b = el('button', 'pack-mode__btn', esc(t('mode_' + m)));
      b.type = 'button';
      b.dataset.mode = m;
      b.addEventListener('click', function () { setMode(m); });
      modeWrap.appendChild(b);
    });
    root.appendChild(modeWrap);

    var prev = el('button', 'deck__tap deck__tap--prev'); prev.type = 'button'; prev.tabIndex = -1; prev.setAttribute('aria-label', t('prev_card'));
    var next = el('button', 'deck__tap deck__tap--next'); next.type = 'button'; next.tabIndex = -1; next.setAttribute('aria-label', t('next_card'));
    prev.addEventListener('click', function () { go(current - 1); });
    next.addEventListener('click', function () { go(current + 1); });
    root.appendChild(prev); root.appendChild(next);

    stage = el('div', 'pack-stage');
    root.appendChild(stage);

    hint = el('div', 'deck__hint', '<span>' + esc(t('hint_tap')) + '</span><span>' + esc(t('hint_keys')) + '</span>');
    root.appendChild(hint);
    liveEl = el('div', 'sr-only'); liveEl.setAttribute('role', 'status'); liveEl.setAttribute('aria-live', 'polite');
    root.appendChild(liveEl);

    renderAll();
    var start = startIndex();
    go(start, true);
    bindInput();
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
    order.forEach(function (id, i) {
      var s = renderCard(byId[id], i);
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
    Array.prototype.forEach.call(modeWrap.children, function (b) { b.classList.toggle('is-active', b.dataset.mode === mode); b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false'); });
    root.dataset.mode = mode;
  }

  function renderCard(card, i) {
    var s = el('article', 'deck__slide pack-slide');
    s.dataset.idx = String(i);
    s.dataset.cardId = card.id;
    s.dataset.type = card.type;
    var interactive = !!P.INTERACTIVE[card.type];
    if (card.image) {
      var img = el('img', 'deck__slide-img');
      img.src = card.image;
      img.alt = tx(card.caption || card.title || '');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', function () { img.classList.add('is-broken'); });
      if (interactive || card.type === 'checkpoint') img.classList.add('pack-slide__bg');
      s.appendChild(img);
    } else if (!interactive && card.type !== 'checkpoint' && card.type !== 'image') {
      s.appendChild(el('div', 'deck__slide-img deck__slide-img--placeholder pack-slide__ph'));
    }
    var body;
    switch (card.type) {
      case 'slide': body = renderSlide(card); break;
      case 'image': body = renderImage(card, s); break;
      case 'mcq': body = renderMcq(card); break;
      case 'cloze': body = renderCloze(card); break;
      case 'checkpoint': body = renderCheckpoint(card); break;
      default: body = renderUnsupported(card);
    }
    s.appendChild(body);
    if (card.guess) s.appendChild(renderGuess(card, s));
    return s;
  }

  function renderSlide(card) {
    var o = el('div', 'deck__slide-overlay pack-overlay');
    if (card.title) o.appendChild(el('p', 'pack-overlay__title', esc(tx(card.title))));
    if (card.caption) o.appendChild(el('p', 'deck__caption', md(card.caption).replace(/^<p>|<\/p>$/g, '')));
    if (card.equation_html && native) o.appendChild(el('div', 'deck__eq', card.equation_html));
    if (card.body) {
      var body = el('div', 'deck__body pack-body', md(card.body));
      o.appendChild(body);
      if (body.textContent.trim().length > 220) {
        body.classList.add('is-collapsed');
        var more = el('button', 'deck__more pack-more', esc(t('more')));
        more.type = 'button';
        more.setAttribute('aria-expanded', 'false');
        more.addEventListener('click', function () {
          var open = body.classList.toggle('is-collapsed');
          more.textContent = open ? t('more') : t('less');
          more.setAttribute('aria-expanded', open ? 'false' : 'true');
        });
        o.appendChild(more);
      }
    }
    return o;
  }

  function renderImage(card, slide) {
    var wrap = el('div', 'pack-image');
    var img = slide.querySelector('.deck__slide-img');
    if (img) { img.classList.remove('deck__slide-img'); img.classList.add('pack-image__img'); wrap.appendChild(img); }
    var tip = el('div', 'pack-hotspot-tip');
    tip.hidden = true;
    (card.hotspots || []).forEach(function (h, j) {
      var b = el('button', 'pack-hotspot');
      b.type = 'button';
      b.style.left = h.x + '%'; b.style.top = h.y + '%'; b.style.width = h.w + '%'; b.style.height = h.h + '%';
      b.setAttribute('aria-label', tx(h.label));
      b.dataset.n = String(j + 1);
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = tip.dataset.n === b.dataset.n && !tip.hidden;
        Array.prototype.forEach.call(wrap.querySelectorAll('.pack-hotspot'), function (x) { x.classList.remove('is-open'); });
        if (open) { tip.hidden = true; tip.dataset.n = ''; return; }
        b.classList.add('is-open');
        tip.dataset.n = b.dataset.n;
        tip.innerHTML = '<strong>' + esc(tx(h.label)) + '</strong>' + (h.body ? md(h.body) : '');
        tip.hidden = false;
        var seen = slide.__spots || (slide.__spots = {});
        seen[j] = true;
        if (Object.keys(seen).length >= (card.hotspots || []).length) markDone(slide, true);
      });
      wrap.appendChild(b);
    });
    wrap.appendChild(tip);
    var o = el('div', 'deck__slide-overlay pack-overlay pack-overlay--thin');
    if (card.title) o.appendChild(el('p', 'pack-overlay__title', esc(tx(card.title))));
    if (card.caption) o.appendChild(el('p', 'deck__caption', md(card.caption).replace(/^<p>|<\/p>$/g, '')));
    if ((card.hotspots || []).length) o.appendChild(el('p', 'pack-overlay__hint', esc(t('hotspot_hint', { n: card.hotspots.length }))));
    var box = el('div', 'pack-image-wrap');
    box.appendChild(wrap);
    box.appendChild(o);
    return box;
  }

  function panel(card, titleKey) {
    var p = el('div', 'pack-card');
    var sec = sectionOf[card.id];
    if (card.title) p.appendChild(el('p', 'pack-card__kicker', esc(tx(card.title))));
    else if (titleKey) p.appendChild(el('p', 'pack-card__kicker', esc(t(titleKey))));
    return p;
  }

  function feedback(p, right, msg) {
    var f = p.querySelector('.pack-feedback') || el('div', 'pack-feedback');
    f.className = 'pack-feedback ' + (right ? 'is-right' : 'is-wrong');
    f.innerHTML = '<strong>' + esc(right ? t('correct') : t('wrong')) + '</strong>' + (msg ? ' <span>' + msg + '</span>' : '');
    p.appendChild(f);
    liveEl.textContent = f.textContent;
  }

  function continueBtn(p) {
    if (p.querySelector('.pack-btn--continue')) return;
    var b = el('button', 'pack-btn pack-btn--primary pack-btn--continue', esc(t('continue')));
    b.type = 'button';
    b.addEventListener('click', function () { go(current + 1); });
    p.appendChild(b);
  }

  function renderMcq(card) {
    var p = panel(card, 'kicker_question');
    p.appendChild(el('div', 'pack-card__q', md(card.question)));
    if (card.multi) p.appendChild(el('p', 'pack-card__note', esc(t('pick_all'))));
    var list = el('div', 'pack-choices');
    list.setAttribute('role', card.multi ? 'group' : 'radiogroup');
    var choices = card.choices.map(function (c, i) { return { c: c, i: i }; });
    if (card.shuffle !== false && mode === 'quiz') choices = shuffle(choices);
    var picked = {}, graded = false;
    choices.forEach(function (o) {
      var b = el('button', 'pack-choice');
      b.type = 'button';
      b.dataset.i = String(o.i);
      b.innerHTML = '<span class="pack-choice__mark" aria-hidden="true"></span><span class="pack-choice__text">' + md(o.c.text).replace(/^<p>|<\/p>$/g, '') + '</span>';
      if (o.c.why) { var why = el('div', 'pack-choice__why', md(o.c.why)); why.hidden = true; b.appendChild(why); }
      list.appendChild(b);
      if (mode === 'read') {
        b.disabled = true;
        if (o.c.correct) b.classList.add('is-correct');
        if (why) why.hidden = false;
        return;
      }
      b.addEventListener('click', function () {
        if (graded) return;
        if (card.multi) {
          picked[o.i] = !picked[o.i];
          b.classList.toggle('is-picked', !!picked[o.i]);
          b.setAttribute('aria-pressed', picked[o.i] ? 'true' : 'false');
          return;
        }
        picked = {}; picked[o.i] = true;
        grade();
      });
    });
    p.appendChild(list);
    var check;
    if (mode === 'quiz' && card.multi) {
      check = el('button', 'pack-btn pack-btn--primary', esc(t('check')));
      check.type = 'button';
      check.addEventListener('click', function () { if (Object.keys(picked).some(function (k) { return picked[k]; })) grade(); });
      p.appendChild(check);
    }
    function grade() {
      graded = true;
      var right = card.choices.every(function (c, i) { return !!c.correct === !!picked[i]; });
      Array.prototype.forEach.call(list.children, function (b) {
        var i = +b.dataset.i, c = card.choices[i];
        b.disabled = true;
        if (c.correct) b.classList.add('is-correct');
        if (picked[i] && !c.correct) b.classList.add('is-wrong');
        if (picked[i]) b.classList.add('is-picked');
        var why = b.querySelector('.pack-choice__why');
        if (why && (picked[i] || c.correct)) why.hidden = false;
      });
      if (check) check.remove();
      feedback(p, right);
      continueBtn(p);
      markDone(p.closest('.pack-slide'), right);
    }
    return p;
  }

  function renderCloze(card) {
    var p = panel(card, 'kicker_fill');
    var raw = tx(card.text);
    var parts = raw.split(/\{\{[^}]*\}\}/);
    var answers = card.answers.map(function (a) { return Array.isArray(a) ? a.map(tx) : [tx(a)]; });
    var useChips = Array.isArray(card.chips) || card.typed === false;
    var q = el('div', 'pack-cloze');
    var blanks = [];
    parts.forEach(function (part, i) {
      if (part) q.appendChild(el('span', 'pack-cloze__t', esc(part)));
      if (i < answers.length) {
        var b;
        if (mode === 'read') {
          b = el('span', 'pack-cloze__blank is-filled is-correct', esc(answers[i][0]));
        } else if (useChips) {
          b = el('button', 'pack-cloze__blank');
          b.type = 'button';
          b.dataset.i = String(i);
          b.setAttribute('aria-label', t('blank_n', { n: i + 1 }));
          b.addEventListener('click', function () {
            if (b.dataset.val) { returnChip(b); }
            active = i; setActive();
          });
        } else {
          b = el('input', 'pack-cloze__blank pack-cloze__input');
          b.type = 'text';
          b.autocomplete = 'off'; b.autocapitalize = 'off'; b.spellcheck = false;
          b.setAttribute('aria-label', t('blank_n', { n: i + 1 }));
          b.placeholder = t('type_here');
          b.style.width = Math.max(6, answers[i][0].length + 2) + 'ch';
          b.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); grade(); } });
        }
        blanks.push(b);
        q.appendChild(b);
      }
    });
    p.appendChild(q);
    var active = 0, chipsWrap;
    function setActive() { blanks.forEach(function (b, k) { b.classList.toggle('is-active', k === active && !b.dataset.val); }); }
    function returnChip(b) {
      var chip = chipsWrap && chipsWrap.querySelector('[data-val="' + CSS.escape(b.dataset.val) + '"]');
      if (chip) chip.disabled = false;
      b.dataset.val = ''; b.textContent = ''; b.classList.remove('is-filled');
    }
    if (mode === 'quiz' && useChips) {
      chipsWrap = el('div', 'pack-chips');
      var pool = shuffle(answers.map(function (a) { return a[0]; }).concat((card.chips || []).map(tx)));
      pool.forEach(function (val) {
        var c = el('button', 'pack-chip', esc(val));
        c.type = 'button';
        c.dataset.val = val;
        c.addEventListener('click', function () {
          var target = blanks[active] && !blanks[active].dataset.val ? blanks[active] : blanks.filter(function (b) { return !b.dataset.val; })[0];
          if (!target) return;
          target.dataset.val = val; target.textContent = val; target.classList.add('is-filled');
          c.disabled = true;
          var nextEmpty = blanks.findIndex(function (b) { return !b.dataset.val; });
          active = nextEmpty < 0 ? active : nextEmpty;
          setActive();
        });
        chipsWrap.appendChild(c);
      });
      p.appendChild(chipsWrap);
      setActive();
    }
    if (mode === 'quiz') {
      var check = el('button', 'pack-btn pack-btn--primary', esc(t('check')));
      check.type = 'button';
      check.addEventListener('click', grade);
      p.appendChild(check);
    }
    var graded = false;
    function grade() {
      if (graded) return;
      var allRight = true, anyFilled = false;
      blanks.forEach(function (b, i) {
        var val = useChips ? (b.dataset.val || '') : b.value;
        if (val) anyFilled = true;
        var ok = answers[i].some(function (a) { return norm(a) === norm(val); });
        b.classList.toggle('is-correct', ok);
        b.classList.toggle('is-wrong', !ok);
        if (!ok) { allRight = false; b.title = answers[i][0]; }
        if (b.tagName === 'INPUT') b.disabled = true; else b.disabled = true;
      });
      if (!anyFilled) return;
      graded = true;
      if (chipsWrap) Array.prototype.forEach.call(chipsWrap.children, function (c) { c.disabled = true; });
      check.remove();
      var reveal = allRight ? '' : esc(t('answer_was')) + ' <em>' + answers.map(function (a) { return esc(a[0]); }).join(', ') + '</em>';
      feedback(p, allRight, reveal);
      continueBtn(p);
      markDone(p.closest('.pack-slide'), allRight);
    }
    return p;
  }

  function renderCheckpoint(card) {
    var p = panel(card, 'kicker_checkpoint');
    p.appendChild(el('div', 'pack-card__text', md(card.summary)));
    var stats = el('p', 'pack-card__stats');
    stats.dataset.section = sectionOf[card.id] ? sectionOf[card.id].id : '';
    p.appendChild(stats);
    p.addEventListener('pack:enter', function () {
      var sec = sectionOf[card.id];
      var right = 0, wrong = 0;
      (sec ? sec.cards : []).forEach(function (id) { var r = progress.cards[id]; if (!r) return; if (r.r === 'right') right++; if (r.r === 'wrong') wrong++; });
      stats.textContent = t('section_stats', { right: right, wrong: wrong });
      stats.hidden = !(right + wrong);
    });
    continueBtn(p);
    return p;
  }

  function renderUnsupported(card) {
    var p = panel(card, null);
    p.appendChild(el('p', 'pack-card__kicker', esc(card.type)));
    p.appendChild(el('p', 'pack-card__text', esc(t('unsupported'))));
    if (card.title) p.appendChild(el('p', 'pack-card__text', esc(tx(card.title))));
    continueBtn(p);
    return p;
  }

  function renderGuess(card, slide) {
    var g = card.guess;
    var veil = el('div', 'pack-guess');
    var box = el('div', 'pack-card pack-card--guess');
    box.appendChild(el('p', 'pack-card__kicker', esc(t('your_guess'))));
    box.appendChild(el('div', 'pack-card__q', md(g.prompt)));
    var input, getVal, choicesWrap;
    if (g.kind === 'choice') {
      choicesWrap = el('div', 'pack-choices');
      var pickedI = -1;
      g.choices.forEach(function (c, i) {
        var b = el('button', 'pack-choice', '<span class="pack-choice__mark" aria-hidden="true"></span><span class="pack-choice__text">' + esc(tx(c)) + '</span>');
        b.type = 'button';
        b.addEventListener('click', function () { pickedI = i; Array.prototype.forEach.call(choicesWrap.children, function (x) { x.classList.toggle('is-picked', x === b); }); lock.disabled = false; });
        choicesWrap.appendChild(b);
      });
      box.appendChild(choicesWrap);
      getVal = function () { return pickedI; };
    } else if (g.kind === 'range') {
      var row = el('div', 'pack-range');
      input = el('input', 'pack-range__input');
      input.type = 'range'; input.min = g.min; input.max = g.max; input.step = g.step || Math.max(1, Math.round((g.max - g.min) / 100));
      input.value = String(g.min + (g.max - g.min) / 2);
      var out = el('output', 'pack-range__out', esc(input.value + (g.unit ? ' ' + g.unit : '')));
      input.addEventListener('input', function () { out.textContent = input.value + (g.unit ? ' ' + g.unit : ''); });
      row.appendChild(input); row.appendChild(out);
      box.appendChild(row);
      getVal = function () { return +input.value; };
    } else {
      var nrow = el('div', 'pack-number');
      input = el('input', 'pack-number__input');
      input.type = 'number'; input.inputMode = 'decimal'; input.placeholder = t('type_here');
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); reveal(); } });
      nrow.appendChild(input);
      if (g.unit) nrow.appendChild(el('span', 'pack-number__unit', esc(g.unit)));
      box.appendChild(nrow);
      getVal = function () { return input.value === '' ? null : +input.value; };
    }
    var lock = el('button', 'pack-btn pack-btn--primary', esc(t('lock_in')));
    lock.type = 'button';
    if (g.kind === 'choice') lock.disabled = true;
    lock.addEventListener('click', reveal);
    box.appendChild(lock);
    var skip = el('button', 'pack-btn pack-btn--ghost', esc(t('skip')));
    skip.type = 'button';
    skip.addEventListener('click', function () { veil.remove(); });
    box.appendChild(skip);
    veil.appendChild(box);
    veil.addEventListener('click', function (e) { e.stopPropagation(); });
    function reveal() {
      var v = getVal();
      if (v == null || (g.kind === 'choice' && v < 0)) return;
      var right, msg, distance = null;
      if (g.kind === 'choice') {
        right = v === g.answer;
        msg = esc(t('answer_was')) + ' <em>' + esc(tx(g.choices[g.answer])) + '</em>';
      } else {
        distance = Math.abs(v - g.answer);
        var tol = Math.abs(g.answer) * 0.1 || 1;
        right = distance <= tol;
        msg = esc(t('answer_was')) + ' <em>' + esc(String(g.answer) + (g.unit ? ' ' + g.unit : '')) + '</em>' + (distance ? ' · ' + esc(t('off_by', { n: +distance.toFixed(2) })) : ' · ' + esc(t('exact')));
      }
      lock.remove(); skip.remove();
      if (input) input.disabled = true;
      if (choicesWrap) Array.prototype.forEach.call(choicesWrap.children, function (b, i) { b.disabled = true; if (i === g.answer) b.classList.add('is-correct'); else if (i === v) b.classList.add('is-wrong'); });
      feedback(box, right, msg);
      var done = el('button', 'pack-btn pack-btn--primary', esc(t('reveal')));
      done.type = 'button';
      done.addEventListener('click', function () { veil.classList.add('is-gone'); setTimeout(function () { veil.remove(); }, 260); });
      box.appendChild(done);
      P.recordAnswer(pack.id, card.id, right, { distance: distance });
      progress = P.getProgress(pack.id);
      updateSeg(current);
    }
    return veil;
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
    again.addEventListener('click', function () { reviewOnly = false; rebuildOrder(); go(0); });
    var review = el('button', 'pack-btn', esc(t('review_wrong')));
    review.type = 'button';
    review.addEventListener('click', function () { reviewOnly = true; if (mode !== 'quiz') { mode = 'quiz'; P.setMode(pack.id, mode); } rebuildOrder(); go(0); });
    var lib = el('a', 'pack-btn pack-btn--ghost', esc(t('back_to_library')));
    lib.href = libraryHref;
    var row = el('div', 'pack-card__actions');
    row.appendChild(again); row.appendChild(review); row.appendChild(lib);
    p.appendChild(row);
    s.appendChild(p);
    s.addEventListener('pack:enter', function () {
      var sum = P.summary(pack, progress);
      stats.textContent = t('finish_stats', { seen: sum.seen, total: sum.total, right: sum.right, wrong: sum.wrong });
      review.hidden = !sum.wrong;
      progress.done = sum.done ? Date.now() : progress.done;
      P.setMode(pack.id, mode);
    });
    return s;
  }

  function rebuildOrder() {
    order = [];
    pack.sections.forEach(function (s) { s.cards.forEach(function (id) { if (!byId[id]) return; if (reviewOnly) { var r = progress.cards[id]; if (!r || r.r !== 'wrong') return; } order.push(id); }); });
    if (!order.length) { reviewOnly = false; rebuildOrder(); return; }
    renderAll();
  }

  function markDone(slide, right) {
    if (!slide) return;
    var id = slide.dataset.cardId;
    if (!id) return;
    P.recordAnswer(pack.id, id, right);
    progress = P.getProgress(pack.id);
    updateSeg(+slide.dataset.idx);
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
    if (i < 0) return;
    if (i > order.length) return;
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
    updateSeg(i);
    var target = s.querySelector('.pack-card') || s;
    try { target.dispatchEvent(new CustomEvent('pack:enter')); } catch (_) {}
    try { s.dispatchEvent(new CustomEvent('pack:enter')); } catch (_) {}
    if (!silent && hint) hint.classList.add('is-fading');
    var focusable = s.querySelector('input, button:not(.deck__tap):not(.pack-more):not([disabled])');
    if (focusable && !silent && document.activeElement && document.activeElement.tagName !== 'INPUT') { try { focusable.focus({ preventScroll: true }); } catch (_) {} }
  }

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    P.setMode(pack.id, mode);
    var keep = current;
    renderAll();
    go(Math.min(keep, order.length), true);
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
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(current + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(current - 1); }
      else if (e.key === 'Escape') { e.preventDefault(); exit(); }
    });
    var sx = 0, sy = 0, st = 0;
    stage.addEventListener('touchstart', function (e) { var tch = e.touches[0]; sx = tch.clientX; sy = tch.clientY; st = Date.now(); }, { passive: true });
    stage.addEventListener('touchend', function (e) {
      var tch = e.changedTouches[0];
      var dx = tch.clientX - sx, dy = tch.clientY - sy;
      if (Date.now() - st > 600 || Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
      if (e.target.closest && e.target.closest('input[type="range"]')) return;
      if (dx < 0) go(current + 1); else go(current - 1);
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
