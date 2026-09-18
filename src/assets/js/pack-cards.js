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
      case 'order': body = renderOrder(card, ctx); break;
      case 'match': body = renderMatch(card, ctx); break;
      case 'canvas': body = renderCanvas(card, ctx); break;
      case 'ask': body = renderAsk(card, ctx); break;
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


  function renderOrder(card, ctx) {
    var t = ctx.t;
    var p = panel(card, ctx, 'kicker_order');
    p.appendChild(el('div', 'pack-card__q', ctx.md(card.prompt)));
    var correct = card.items.map(function (x) { return ctx.tx(x); });
    var shown = correct.slice();
    if (ctx.mode === 'quiz') { var tries = 0; do { shown = shuffle(correct); tries++; } while (tries < 8 && shown.join('||') === correct.join('||')); }
    var list = el('ol', 'pack-order');
    var graded = false;
    function renumber() { Array.prototype.forEach.call(list.children, function (li, i) { li.querySelector('.pack-order__n').textContent = String(i + 1); var up = li.querySelector('[data-dir="up"]'), dn = li.querySelector('[data-dir="down"]'); if (up) up.disabled = i === 0 || graded; if (dn) dn.disabled = i === list.children.length - 1 || graded; }); }
    shown.forEach(function (text) {
      var li = el('li', 'pack-order__item');
      li.dataset.text = text;
      li.innerHTML = '<span class="pack-order__n"></span><span class="pack-order__text">' + esc(text) + '</span>';
      if (ctx.mode === 'quiz') {
        var btns = el('span', 'pack-order__btns');
        [['up', t('move_up'), '<path d="M6 14l6-6 6 6"/>'], ['down', t('move_down'), '<path d="M6 10l6 6 6-6"/>']].forEach(function (d) {
          var b = el('button', 'pack-order__btn');
          b.type = 'button'; b.dataset.dir = d[0]; b.setAttribute('aria-label', d[1]); b.title = d[1];
          b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d[2] + '</svg>';
          b.addEventListener('click', function () {
            if (graded) return;
            var sib = d[0] === 'up' ? li.previousElementSibling : li.nextElementSibling;
            if (!sib) return;
            if (d[0] === 'up') list.insertBefore(li, sib); else list.insertBefore(sib, li);
            renumber();
            b.focus();
          });
          btns.appendChild(b);
        });
        li.appendChild(btns);
      }
      list.appendChild(li);
    });
    p.appendChild(list);
    renumber();
    if (ctx.mode === 'read') { Array.prototype.forEach.call(list.children, function (li) { li.classList.add('is-correct'); }); return p; }
    var check = el('button', 'pack-btn pack-btn--primary', esc(t('check')));
    check.type = 'button';
    check.addEventListener('click', function () {
      if (graded) return;
      graded = true;
      var right = true;
      Array.prototype.forEach.call(list.children, function (li, i) {
        var ok = li.dataset.text === correct[i];
        li.classList.toggle('is-correct', ok); li.classList.toggle('is-wrong', !ok);
        if (!ok) right = false;
      });
      renumber();
      check.remove();
      var msg = right ? '' : esc(t('answer_was')) + ' <em>' + correct.map(esc).join(' → ') + '</em>';
      feedback(p, ctx, right, msg);
      continueBtn(p, card, ctx);
      done(p, card, ctx, right);
    });
    p.appendChild(check);
    return p;
  }

  function renderMatch(card, ctx) {
    var t = ctx.t;
    var p = panel(card, ctx, 'kicker_match');
    p.appendChild(el('div', 'pack-card__q', ctx.md(card.prompt)));
    var pairs = card.pairs.map(function (pr) { return [ctx.tx(pr[0]), ctx.tx(pr[1])]; });
    var grid = el('div', 'pack-match');
    if (ctx.mode === 'read') {
      pairs.forEach(function (pr) {
        grid.appendChild(el('div', 'pack-match__row is-correct', '<span class="pack-match__cell">' + esc(pr[0]) + '</span><span class="pack-match__arrow" aria-hidden="true">→</span><span class="pack-match__cell">' + esc(pr[1]) + '</span>'));
      });
      p.appendChild(grid);
      return p;
    }
    p.appendChild(el('p', 'pack-card__note', esc(t('match_hint'))));
    var leftCol = el('div', 'pack-match__col'), rightCol = el('div', 'pack-match__col');
    var rights = shuffle(pairs.map(function (pr, i) { return { text: pr[1], i: i }; }));
    var selected = null, link = {}, graded = false;
    var leftBtns = [], rightBtns = [];
    var check = el('button', 'pack-btn pack-btn--primary', esc(t('check')));
    check.type = 'button';
    function paint() {
      leftBtns.forEach(function (b, i) { b.classList.toggle('is-selected', selected === i); b.classList.toggle('is-paired', link[i] != null); b.dataset.pair = link[i] != null ? String((link[i] % 6) + 1) : ''; });
      rightBtns.forEach(function (b, j) { var li = Object.keys(link).find(function (k) { return link[k] === j; }); b.classList.toggle('is-paired', li != null); b.dataset.pair = li != null ? String((j % 6) + 1) : ''; });
      check.disabled = Object.keys(link).length !== pairs.length;
    }
    pairs.forEach(function (pr, i) {
      var b = el('button', 'pack-match__cell pack-match__btn', esc(pr[0]));
      b.type = 'button';
      b.addEventListener('click', function () {
        if (graded) return;
        if (link[i] != null) delete link[i];
        selected = i;
        paint();
      });
      leftBtns.push(b); leftCol.appendChild(b);
    });
    rights.forEach(function (r, j) {
      var b = el('button', 'pack-match__cell pack-match__btn', esc(r.text));
      b.type = 'button';
      b.addEventListener('click', function () {
        if (graded) return;
        var owner = Object.keys(link).find(function (k) { return link[k] === j; });
        if (owner != null) { delete link[owner]; if (selected == null) { paint(); return; } }
        if (selected == null) return;
        link[selected] = j;
        selected = null;
        var nextFree = pairs.findIndex(function (_, k) { return link[k] == null; });
        if (nextFree >= 0) selected = nextFree;
        paint();
      });
      rightBtns.push(b); rightCol.appendChild(b);
    });
    grid.appendChild(leftCol); grid.appendChild(rightCol);
    p.appendChild(grid);
    check.addEventListener('click', function () {
      if (graded || check.disabled) return;
      graded = true;
      var right = true;
      pairs.forEach(function (pr, i) {
        var ok = rights[link[i]].text === pr[1];
        leftBtns[i].classList.toggle('is-correct', ok); leftBtns[i].classList.toggle('is-wrong', !ok);
        rightBtns[link[i]].classList.toggle('is-correct', ok); rightBtns[link[i]].classList.toggle('is-wrong', !ok);
        leftBtns[i].disabled = true; rightBtns[link[i]].disabled = true;
        if (!ok) right = false;
      });
      check.remove();
      var msg = right ? '' : esc(t('answer_was')) + ' <em>' + pairs.map(function (pr) { return esc(pr[0] + ' → ' + pr[1]); }).join(' · ') + '</em>';
      feedback(p, ctx, right, msg);
      continueBtn(p, card, ctx);
      done(p, card, ctx, right);
    });
    p.appendChild(check);
    selected = 0;
    paint();
    return p;
  }

  function themeSnapshot() {
    var cs = getComputedStyle(document.documentElement);
    var v = function (n, d) { return (cs.getPropertyValue(n) || '').trim() || d; };
    return { accent: v('--accent', '#6ef3c5'), bg: v('--term-bg', '#0b0e11'), fg: v('--term-fg', '#e6edf3'), muted: v('--term-muted', '#8b949e'), fontMono: v('--font-mono', 'monospace'), fontBody: v('--font-body', 'sans-serif') };
  }

  function renderCanvas(card, ctx) {
    var t = ctx.t;
    var wrap = el('div', 'pack-canvas');
    var frame = el('iframe', 'pack-canvas__frame');
    frame.setAttribute('sandbox', 'allow-scripts allow-forms allow-pointer-lock');
    frame.setAttribute('title', ctx.tx(card.title || card.id));
    var token = Math.random().toString(36).slice(2);
    var theme = themeSnapshot();
    var boot = '<scr' + 'ipt>(function(){var T=' + JSON.stringify(token) + ';var post=function(m){parent.postMessage(Object.assign({mentriaCanvas:T},m),"*")};' +
      'window.mentria={theme:' + JSON.stringify(theme) + ',lang:' + JSON.stringify(ctx.lang) + ',done:function(r){post({type:"done",right:r!==false})},next:function(){post({type:"next"})},notify:function(m){post({type:"notify",text:String(m).slice(0,120)})}};' +
      'window.addEventListener("error",function(e){post({type:"error",text:String(e.message||"error")})});})();</scr' + 'ipt>';
    var meta = '<meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;background:' + theme.bg + ';color:' + theme.fg + ';font-family:' + theme.fontBody + '}</style>';
    frame.srcdoc = meta + boot + String(card.html);
    wrap.appendChild(frame);
    var bar = el('div', 'pack-canvas__bar');
    var hint = el('span', 'pack-canvas__hint', esc(ctx.tx(card.title || '') || t('canvas_hint')));
    bar.appendChild(hint);
    var cont = el('button', 'pack-btn pack-btn--primary pack-btn--continue', esc(t('continue')));
    cont.type = 'button';
    cont.addEventListener('click', function () { ctx.onContinue(card); });
    bar.appendChild(cont);
    wrap.appendChild(bar);
    window.addEventListener('message', function (e) {
      if (!e.data || e.data.mentriaCanvas !== token || e.source !== frame.contentWindow) return;
      if (e.data.type === 'done') {
        var slide = wrap.closest('.pack-slide');
        if (slide && !slide.dataset.answered) { slide.dataset.answered = '1'; ctx.onAnswer(card, e.data.right !== false); }
        hint.textContent = e.data.right === false ? t('wrong') : t('correct');
        hint.className = 'pack-canvas__hint ' + (e.data.right === false ? 'is-wrong' : 'is-right');
      } else if (e.data.type === 'next') ctx.onContinue(card);
      else if (e.data.type === 'notify') hint.textContent = e.data.text;
      else if (e.data.type === 'error') { hint.textContent = e.data.text; hint.className = 'pack-canvas__hint is-wrong'; }
    });
    return wrap;
  }

  var enginePromise = null;
  function loadEngine() {
    if (window.__mentriaEngine) return Promise.resolve(window.__mentriaEngine);
    if (enginePromise) return enginePromise;
    enginePromise = Promise.all([import('/assets/js/mentria-model.js'), import('/assets/mentria/dist/mentria.mjs')]).then(function (mods) {
      var ensureModel = mods[0].ensureModel, MentriaEngine = mods[1].MentriaEngine;
      var createEngine = function () { var e = new MentriaEngine('/assets/mentria/dist/worker.mjs'); if (window.mentriaWrapEngine) window.mentriaWrapEngine(e); return e; };
      return ensureModel(createEngine, { cachedOnly: true }).then(function (res) { return res.engine; });
    });
    enginePromise.catch(function () { enginePromise = null; });
    return enginePromise;
  }
  function canUseModel() {
    try { return !!(navigator.gpu && localStorage.getItem('mentria-tier-validated')); } catch (_) { return false; }
  }
  function gradeWithModel(card, answer, ctx) {
    return loadEngine().then(function (engine) {
      var ref = ctx.tx(card.model_answer || ''), rubric = ctx.tx(card.rubric || '');
      var system = 'You grade a learner\'s short answer. Reply with exactly two lines. Line 1: VERDICT: RIGHT, VERDICT: PARTIAL or VERDICT: WRONG. Line 2: one short sentence of feedback addressed to the learner. No other text.';
      var user = 'Question: ' + ctx.tx(card.prompt) + (ref ? '\nReference answer: ' + ref : '') + (rubric ? '\nA good answer covers: ' + rubric : '') + '\nLearner\'s answer: ' + answer;
      var out = '';
      return engine.generate({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], maxTokens: 96, temperature: 0, enableThinking: false }, function (ev) {
        if (typeof ev.token === 'string' && !/^<\|[^|]*\|>$/.test(ev.token)) out += ev.token;
      }).then(function () {
        var m = out.match(/VERDICT:\s*(RIGHT|PARTIAL|WRONG)/i);
        if (!m) throw new Error('no-verdict');
        var line = out.replace(/[\s\S]*?VERDICT:\s*(RIGHT|PARTIAL|WRONG)\s*/i, '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean)[0] || '';
        return { verdict: m[1].toLowerCase(), text: line.slice(0, 240) };
      });
    });
  }

  function renderAsk(card, ctx) {
    var t = ctx.t;
    var p = panel(card, ctx, 'kicker_ask');
    p.appendChild(el('div', 'pack-card__q', ctx.md(card.prompt)));
    var ref = el('div', 'pack-ask__ref');
    if (card.model_answer) ref.appendChild(el('div', 'pack-ask__ref-block', '<span class="pack-ask__label">' + esc(t('reference')) + '</span>' + ctx.md(card.model_answer)));
    if (card.rubric) ref.appendChild(el('div', 'pack-ask__ref-block', '<span class="pack-ask__label">' + esc(t('rubric')) + '</span>' + ctx.md(card.rubric)));
    if (ctx.mode === 'read') { if (ref.children.length) p.appendChild(ref); continueBtn(p, card, ctx); return p; }
    var ta = el('textarea', 'pack-ask__input');
    ta.rows = 4; ta.placeholder = t('type_here'); ta.setAttribute('aria-label', t('your_answer'));
    p.appendChild(ta);
    var actions = el('div', 'pack-card__actions pack-card__actions--start');
    var useModel = canUseModel();
    var check = el('button', 'pack-btn pack-btn--primary', esc(useModel ? t('check_model') : t('compare')));
    check.type = 'button';
    actions.appendChild(check);
    p.appendChild(actions);
    var finished = false;
    function finish(right, msg) {
      if (finished) return;
      finished = true;
      if (ref.children.length && !ref.parentNode) p.appendChild(ref);
      feedback(p, ctx, right, msg);
      continueBtn(p, card, ctx);
      done(p, card, ctx, right);
    }
    function selfGrade() {
      actions.innerHTML = '';
      if (ref.children.length) p.insertBefore(ref, actions);
      var yes = el('button', 'pack-btn pack-btn--primary', esc(t('self_right')));
      var no = el('button', 'pack-btn', esc(t('self_wrong')));
      yes.type = 'button'; no.type = 'button';
      yes.addEventListener('click', function () { actions.remove(); finish(true); });
      no.addEventListener('click', function () { actions.remove(); finish(false); });
      actions.appendChild(yes); actions.appendChild(no);
    }
    check.addEventListener('click', function () {
      var answer = ta.value.trim();
      if (!answer) { ta.focus(); return; }
      ta.disabled = true;
      if (!useModel) { selfGrade(); return; }
      check.disabled = true;
      check.textContent = t('checking');
      p.classList.add('is-busy');
      gradeWithModel(card, answer, ctx).then(function (v) {
        p.classList.remove('is-busy');
        actions.remove();
        var msg = (v.verdict === 'partial' ? '<strong>' + esc(t('partial')) + '</strong> ' : '') + esc(v.text);
        finish(v.verdict === 'right', msg);
      }).catch(function () {
        p.classList.remove('is-busy');
        selfGrade();
      });
    });
    return p;
  }

  global.MentriaPackCards = { render: render, Ctx: Ctx, esc: esc, el: el };
})(typeof window !== 'undefined' ? window : globalThis);
