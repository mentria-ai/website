(function (global) {
  'use strict';
  var P = global.MentriaPacks;
  if (!P) return;

  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
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
  function inline(html) { return html.replace(/^<p>|<\/p>\s*$/g, ''); }

  function Ctx(opts) {
    this.pack = opts.pack;
    this.mode = opts.mode || 'quiz';
    this.lang = opts.lang || document.documentElement.lang || 'en';
    this.t = opts.t || function (k) { return k; };
    this.native = !!opts.native;
    this.sectionOf = opts.sectionOf || function () { return null; };
    this.getProgress = opts.getProgress || function () { return P.getProgress(opts.pack.id); };
    this.onAnswer = opts.onAnswer || function () {};
    this.onContinue = opts.onContinue || function () {};
    this.live = opts.live || function () {};
  }
  Ctx.prototype.tx = function (v) { return P.text(v, this.lang); };
  Ctx.prototype.md = function (v) {
    var s = this.tx(v);
    if (!s) return '';
    return global.renderMarkdown ? global.renderMarkdown(s) : '<p>' + esc(s) + '</p>';
  };

  function render(card, opts) {
    var ctx = opts instanceof Ctx ? opts : new Ctx(opts);
    var s = el('article', 'deck__slide pack-slide');
    s.dataset.cardId = card.id;
    s.dataset.type = card.type;
    var interactive = !!P.INTERACTIVE[card.type];
    if (card.image) {
      var img = el('img', 'deck__slide-img');
      img.src = card.image;
      img.alt = ctx.tx(card.caption || card.title || '');
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
      case 'slide': body = renderSlide(card, ctx); break;
      case 'image': body = renderImage(card, ctx, s); break;
      case 'mcq': body = renderMcq(card, ctx); break;
      case 'cloze': body = renderCloze(card, ctx); break;
      case 'checkpoint': body = renderCheckpoint(card, ctx); break;
      default: body = renderUnsupported(card, ctx);
    }
    s.appendChild(body);
    if (card.guess) s.appendChild(renderGuess(card, ctx));
    return s;
  }

  function renderSlide(card, ctx) {
    var t = ctx.t;
    var o = el('div', 'deck__slide-overlay pack-overlay');
    if (card.title) o.appendChild(el('p', 'pack-overlay__title', esc(ctx.tx(card.title))));
    if (card.caption) o.appendChild(el('p', 'deck__caption', inline(ctx.md(card.caption))));
    if (card.equation_html && ctx.native) o.appendChild(el('div', 'deck__eq', card.equation_html));
    if (card.body) {
      var body = el('div', 'deck__body pack-body', ctx.md(card.body));
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

  function renderImage(card, ctx, slide) {
    var t = ctx.t;
    var wrap = el('div', 'pack-image');
    var img = slide.querySelector('.deck__slide-img');
    if (img) { img.classList.remove('deck__slide-img'); img.classList.add('pack-image__img'); wrap.appendChild(img); }
    var tip = el('div', 'pack-hotspot-tip');
    tip.hidden = true;
    var seen = {};
    (card.hotspots || []).forEach(function (h, j) {
      var b = el('button', 'pack-hotspot');
      b.type = 'button';
      b.style.left = h.x + '%'; b.style.top = h.y + '%'; b.style.width = h.w + '%'; b.style.height = h.h + '%';
      b.setAttribute('aria-label', ctx.tx(h.label));
      b.dataset.n = String(j + 1);
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = tip.dataset.n === b.dataset.n && !tip.hidden;
        Array.prototype.forEach.call(wrap.querySelectorAll('.pack-hotspot'), function (x) { x.classList.remove('is-open'); });
        if (open) { tip.hidden = true; tip.dataset.n = ''; return; }
        b.classList.add('is-open');
        tip.dataset.n = b.dataset.n;
        tip.innerHTML = '<strong>' + esc(ctx.tx(h.label)) + '</strong>' + (h.body ? ctx.md(h.body) : '');
        tip.hidden = false;
        seen[j] = true;
        if (Object.keys(seen).length >= card.hotspots.length && !slide.dataset.answered) { slide.dataset.answered = '1'; ctx.onAnswer(card, true); }
      });
      wrap.appendChild(b);
    });
    wrap.appendChild(tip);
    var o = el('div', 'deck__slide-overlay pack-overlay pack-overlay--thin');
    if (card.title) o.appendChild(el('p', 'pack-overlay__title', esc(ctx.tx(card.title))));
    if (card.caption) o.appendChild(el('p', 'deck__caption', inline(ctx.md(card.caption))));
    if ((card.hotspots || []).length) o.appendChild(el('p', 'pack-overlay__hint', esc(t('hotspot_hint', { n: card.hotspots.length }))));
    var box = el('div', 'pack-image-wrap');
    box.appendChild(wrap);
    box.appendChild(o);
    return box;
  }

  function panel(card, ctx, titleKey) {
    var p = el('div', 'pack-card');
    if (card.title) p.appendChild(el('p', 'pack-card__kicker', esc(ctx.tx(card.title))));
    else if (titleKey) p.appendChild(el('p', 'pack-card__kicker', esc(ctx.t(titleKey))));
    return p;
  }

  function feedback(p, ctx, right, msg) {
    var f = p.querySelector('.pack-feedback') || el('div', 'pack-feedback');
    f.className = 'pack-feedback ' + (right ? 'is-right' : 'is-wrong');
    f.innerHTML = '<strong>' + esc(right ? ctx.t('correct') : ctx.t('wrong')) + '</strong>' + (msg ? ' <span>' + msg + '</span>' : '');
    p.appendChild(f);
    ctx.live(f.textContent);
  }

  function continueBtn(p, card, ctx) {
    if (p.querySelector('.pack-btn--continue')) return;
    var b = el('button', 'pack-btn pack-btn--primary pack-btn--continue', esc(ctx.t('continue')));
    b.type = 'button';
    b.addEventListener('click', function () { ctx.onContinue(card); });
    p.appendChild(b);
  }

  function done(p, card, ctx, right) {
    var slide = p.closest('.pack-slide');
    if (slide && slide.dataset.answered) return;
    if (slide) slide.dataset.answered = '1';
    ctx.onAnswer(card, right);
  }

  function renderMcq(card, ctx) {
    var t = ctx.t;
    var p = panel(card, ctx, 'kicker_question');
    p.appendChild(el('div', 'pack-card__q', ctx.md(card.question)));
    if (card.multi) p.appendChild(el('p', 'pack-card__note', esc(t('pick_all'))));
    var list = el('div', 'pack-choices');
    list.setAttribute('role', card.multi ? 'group' : 'radiogroup');
    var choices = card.choices.map(function (c, i) { return { c: c, i: i }; });
    if (card.shuffle !== false && ctx.mode === 'quiz') choices = shuffle(choices);
    var picked = {}, graded = false, check;
    choices.forEach(function (o) {
      var b = el('button', 'pack-choice');
      b.type = 'button';
      b.dataset.i = String(o.i);
      b.innerHTML = '<span class="pack-choice__mark" aria-hidden="true"></span><span class="pack-choice__text">' + inline(ctx.md(o.c.text)) + '</span>';
      var why = null;
      if (o.c.why) { why = el('div', 'pack-choice__why', ctx.md(o.c.why)); why.hidden = true; b.appendChild(why); }
      list.appendChild(b);
      if (ctx.mode === 'read') {
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
    if (ctx.mode === 'quiz' && card.multi) {
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
      feedback(p, ctx, right);
      continueBtn(p, card, ctx);
      done(p, card, ctx, right);
    }
    return p;
  }

  function renderCloze(card, ctx) {
    var t = ctx.t;
    var p = panel(card, ctx, 'kicker_fill');
    var raw = ctx.tx(card.text);
    var parts = raw.split(/\{\{[^}]*\}\}/);
    var answers = card.answers.map(function (a) { return Array.isArray(a) ? a.map(function (x) { return ctx.tx(x); }) : [ctx.tx(a)]; });
    var useChips = Array.isArray(card.chips) || card.typed === false;
    var q = el('div', 'pack-cloze');
    var blanks = [], active = 0, chipsWrap, check, graded = false;
    function setActive() { blanks.forEach(function (b, k) { b.classList.toggle('is-active', k === active && !b.dataset.val); }); }
    function returnChip(b) {
      var chip = chipsWrap && chipsWrap.querySelector('[data-val="' + CSS.escape(b.dataset.val) + '"]');
      if (chip) chip.disabled = false;
      b.dataset.val = ''; b.textContent = ''; b.classList.remove('is-filled');
    }
    parts.forEach(function (part, i) {
      if (part) q.appendChild(el('span', 'pack-cloze__t', esc(part)));
      if (i < answers.length) {
        var b;
        if (ctx.mode === 'read') {
          b = el('span', 'pack-cloze__blank is-filled is-correct', esc(answers[i][0]));
        } else if (useChips) {
          b = el('button', 'pack-cloze__blank');
          b.type = 'button';
          b.dataset.i = String(i);
          b.setAttribute('aria-label', t('blank_n', { n: i + 1 }));
          b.addEventListener('click', function () {
            if (graded) return;
            if (b.dataset.val) returnChip(b);
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
    if (ctx.mode === 'quiz' && useChips) {
      chipsWrap = el('div', 'pack-chips');
      var pool = shuffle(answers.map(function (a) { return a[0]; }).concat((card.chips || []).map(function (x) { return ctx.tx(x); })));
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
    if (ctx.mode === 'quiz') {
      check = el('button', 'pack-btn pack-btn--primary', esc(t('check')));
      check.type = 'button';
      check.addEventListener('click', grade);
      p.appendChild(check);
    }
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
      });
      if (!anyFilled) return;
      graded = true;
      blanks.forEach(function (b) { b.disabled = true; });
      if (chipsWrap) Array.prototype.forEach.call(chipsWrap.children, function (c) { c.disabled = true; });
      if (check) check.remove();
      var reveal = allRight ? '' : esc(t('answer_was')) + ' <em>' + answers.map(function (a) { return esc(a[0]); }).join(', ') + '</em>';
      feedback(p, ctx, allRight, reveal);
      continueBtn(p, card, ctx);
      done(p, card, ctx, allRight);
    }
    return p;
  }

  function renderCheckpoint(card, ctx) {
    var t = ctx.t;
    var p = panel(card, ctx, 'kicker_checkpoint');
    p.appendChild(el('div', 'pack-card__text', ctx.md(card.summary)));
    var stats = el('p', 'pack-card__stats');
    stats.hidden = true;
    p.appendChild(stats);
    p.addEventListener('pack:enter', function () {
      var sec = ctx.sectionOf(card.id);
      var progress = ctx.getProgress();
      var right = 0, wrong = 0;
      (sec ? sec.cards : []).forEach(function (id) { var r = progress.cards[id]; if (!r) return; if (r.r === 'right') right++; if (r.r === 'wrong') wrong++; });
      stats.textContent = t('section_stats', { right: right, wrong: wrong });
      stats.hidden = !(right + wrong);
    });
    continueBtn(p, card, ctx);
    return p;
  }

  function renderUnsupported(card, ctx) {
    var p = panel(card, ctx, null);
    p.appendChild(el('p', 'pack-card__kicker', esc(card.type)));
    p.appendChild(el('p', 'pack-card__text', esc(ctx.t('unsupported'))));
    if (card.title) p.appendChild(el('p', 'pack-card__text', esc(ctx.tx(card.title))));
    continueBtn(p, card, ctx);
    return p;
  }

  function renderGuess(card, ctx) {
    var t = ctx.t, g = card.guess;
    var veil = el('div', 'pack-guess');
    var box = el('div', 'pack-card pack-card--guess');
    box.appendChild(el('p', 'pack-card__kicker', esc(t('your_guess'))));
    box.appendChild(el('div', 'pack-card__q', ctx.md(g.prompt)));
    var input, getVal, choicesWrap, pickedI = -1;
    if (g.kind === 'choice') {
      choicesWrap = el('div', 'pack-choices');
      g.choices.forEach(function (c, i) {
        var b = el('button', 'pack-choice', '<span class="pack-choice__mark" aria-hidden="true"></span><span class="pack-choice__text">' + esc(ctx.tx(c)) + '</span>');
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
        msg = esc(t('answer_was')) + ' <em>' + esc(ctx.tx(g.choices[g.answer])) + '</em>';
      } else {
        distance = Math.abs(v - g.answer);
        var tol = Math.abs(g.answer) * 0.1 || 1;
        right = distance <= tol;
        msg = esc(t('answer_was')) + ' <em>' + esc(String(g.answer) + (g.unit ? ' ' + g.unit : '')) + '</em>' + (distance ? ' · ' + esc(t('off_by', { n: +distance.toFixed(2) })) : ' · ' + esc(t('exact')));
      }
      lock.remove(); skip.remove();
      if (input) input.disabled = true;
      if (choicesWrap) Array.prototype.forEach.call(choicesWrap.children, function (b, i) { b.disabled = true; if (i === g.answer) b.classList.add('is-correct'); else if (i === v) b.classList.add('is-wrong'); });
      feedback(box, ctx, right, msg);
      var show = el('button', 'pack-btn pack-btn--primary', esc(t('reveal')));
      show.type = 'button';
      show.addEventListener('click', function () { veil.classList.add('is-gone'); setTimeout(function () { veil.remove(); }, 260); });
      box.appendChild(show);
      var slide = veil.closest('.pack-slide');
      if (slide) slide.dataset.answered = '1';
      ctx.onAnswer(card, right, { distance: distance });
    }
    return veil;
  }

  global.MentriaPackCards = { render: render, Ctx: Ctx, esc: esc, el: el };
})(typeof window !== 'undefined' ? window : globalThis);
