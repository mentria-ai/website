/* Feed deck — fullscreen story-style chapter reader */
(function () {
  'use strict';

  const root = document.getElementById('deckRoot');
  if (!root) return;

  const slides = Array.from(root.querySelectorAll('.deck__slide'));
  const segs = Array.from(root.querySelectorAll('.deck__progress-seg'));
  const chapterId = root.dataset.chapterId;
  const slideCount = slides.length;
  if (!slideCount) return;

  const closeBtn = document.getElementById('deckClose');
  const hint = document.getElementById('deckHint');
  const progressBar = root.querySelector('.deck__progress');
  const liveEl = document.getElementById('deckLive');

  function prefixOf(path) {
    const locs = window.MENTRIA_LOCALES || [];
    for (let i = 0; i < locs.length; i++) {
      const p = locs[i].prefix;
      if (p && (path === p || path.indexOf(p + '/') === 0)) return p;
    }
    return '';
  }
  const localePrefix = prefixOf(location.pathname || '/');
  const words = window.MENTRIA_DECK_I18N || {};

  let current = 0;
  let hintFaded = false;

  function fadeHint() {
    if (hintFaded || !hint) return;
    hintFaded = true;
    hint.classList.add('is-fading');
  }

  function announceSlide(i) {
    if (progressBar) progressBar.setAttribute('aria-valuenow', String(i + 1));
    if (liveEl && progressBar) {
      const tpl = progressBar.getAttribute('data-announce') || 'Slide {n} of {total}';
      liveEl.textContent = tpl.replace('{n}', String(i + 1)).replace('{total}', String(slides.length));
    }
  }

  function go(i) {
    if (i < 0 || i >= slideCount) return;
    current = i;
    slides.forEach((el, idx) => el.classList.toggle('is-active', idx === i));
    announceSlide(i);
    segs.forEach((el, idx) => {
      el.classList.toggle('is-done', idx < i);
      el.classList.toggle('is-active', idx === i);
    });
    collapseAll();
    fadeHint();
    try { history.replaceState(history.state, '', '#s' + (i + 1)); } catch (_) {}
    warm(i);
  }

  function imgAt(i) {
    return slides[i] ? slides[i].querySelector('img.deck__slide-img') : null;
  }
  function whenLoaded(img, fn) {
    if (!img || img.complete) { fn(); return; }
    img.addEventListener('load', fn, { once: true });
    img.addEventListener('error', fn, { once: true });
  }
  function warm(i) {
    const nextImg = imgAt(i + 1), prevImg = imgAt(i - 1);
    whenLoaded(imgAt(i), () => {
      if (nextImg) nextImg.loading = 'eager';
      whenLoaded(nextImg, () => { if (prevImg) prevImg.loading = 'eager'; });
    });
  }

  function next() {
    if (current >= slideCount - 1) {
      flashEdge('right');
      return;
    }
    go(current + 1);
  }
  function prev() {
    if (current <= 0) {
      flashEdge('left');
      return;
    }
    go(current - 1);
  }

  function flashEdge(side) {
    const flash = document.createElement('div');
    flash.style.cssText = `
      position: absolute; top: 0; bottom: 0; ${side}: 0;
      width: 30%; pointer-events: none; z-index: 8;
      background: linear-gradient(to ${side === 'left' ? 'right' : 'left'}, rgba(255,255,255,0.18), transparent);
      opacity: 1; transition: opacity 0.25s ease;
    `;
    root.appendChild(flash);
    requestAnimationFrame(() => { flash.style.opacity = '0'; });
    setTimeout(() => flash.remove(), 280);
  }

  const BODY_TRUNC = 220;
  slides.forEach((s) => {
    const body = s.querySelector('.deck__body');
    if (!body) return;
    body.dataset.full = body.innerHTML.trim();
    const text = body.textContent.trim();
    if (text.length > BODY_TRUNC + 24) {
      let t = text.slice(0, BODY_TRUNC);
      const sp = t.lastIndexOf(' ');
      if (sp > BODY_TRUNC * 0.6) t = t.slice(0, sp);
      body.dataset.truncated = t.replace(/[\s.,;:—-]+$/, '');
      body.dataset.truncatable = '1';
      body.innerHTML = collapsedHTML(body);
    }
  });

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function moreLink(label, expanded) {
    return '<button type="button" class="deck__more" data-action="expand" aria-expanded="' + (expanded ? 'true' : 'false') + '">' + label + '</button>';
  }
  function collapsedHTML(body) { return esc(body.dataset.truncated) + '… ' + moreLink(esc(words.more || 'more'), false); }
  function fullHTML(body) { return body.dataset.full + ' ' + moreLink(esc(words.less || 'less'), true); }

  function animateBody(body, html, onDone) {
    const startH = body.offsetHeight;
    body.style.transition = 'none';
    body.style.maxHeight = startH + 'px';
    body.innerHTML = html;
    const endH = Math.min(body.scrollHeight, window.innerHeight * 0.7);
    void body.offsetHeight;
    body.style.transition = 'max-height 300ms cubic-bezier(0.22, 1, 0.36, 1)';
    requestAnimationFrame(() => { body.style.maxHeight = endH + 'px'; });
    let finished = false;
    const fin = (e) => {
      if (e && e.propertyName && e.propertyName !== 'max-height') return;
      if (finished) return;
      finished = true;
      body.removeEventListener('transitionend', fin);
      body.style.transition = '';
      body.style.maxHeight = '';
      if (onDone) onDone();
    };
    body.addEventListener('transitionend', fin);
    setTimeout(fin, 380);
  }

  function setExpanded(slide, on) {
    const body = slide && slide.querySelector('.deck__body');
    if (!body || body.dataset.truncatable !== '1') return;
    if (slide.classList.contains('is-expanded') === on) return;
    if (on) {
      slide.classList.add('is-expanded');
      animateBody(body, fullHTML(body));
    } else {
      animateBody(body, collapsedHTML(body), () => slide.classList.remove('is-expanded'));
    }
  }
  function collapseAll() {
    slides.forEach((s) => {
      const body = s.querySelector('.deck__body');
      if (body && body.dataset.truncatable === '1' && s.classList.contains('is-expanded')) {
        s.classList.remove('is-expanded');
        body.style.transition = '';
        body.style.maxHeight = '';
        body.innerHTML = collapsedHTML(body);
      }
    });
  }
  function isExpanded() {
    return !!(slides[current] && slides[current].classList.contains('is-expanded'));
  }
  function expandCurrent() {
    setExpanded(slides[current], !isExpanded());
  }

  function basePath(path) {
    return path.slice(prefixOf(path).length) || '/';
  }

  function canGoBack() {
    const nav = window.navigation;
    let prev = null;
    if (nav && typeof nav.entries === 'function') {
      const cur = nav.currentEntry;
      const entry = cur && cur.index > 0 ? nav.entries()[cur.index - 1] : null;
      if (!entry || entry.sameDocument) return false;
      try { prev = new URL(entry.url); } catch (_) { return false; }
    } else {
      try { prev = window.MentriaNav ? window.MentriaNav.from() : (document.referrer ? new URL(document.referrer) : null); } catch (_) {}
      if (!prev || prev.origin !== location.origin || history.length < 2 || prefixOf(prev.pathname) !== localePrefix) return false;
    }
    return basePath(prev.pathname) !== basePath(location.pathname);
  }

  function exit() {
    if (canGoBack()) history.back();
    else location.href = localePrefix + '/learn/';
  }

  /* ── Tap zones ─────────────────────────────────────────── */
  root.querySelector('.deck__tap--prev').addEventListener('click', (e) => { e.currentTarget.blur(); prev(); });
  root.querySelector('.deck__tap--next').addEventListener('click', (e) => { e.currentTarget.blur(); next(); });

  /* ── Close ─────────────────────────────────────────────── */
  if (closeBtn) closeBtn.addEventListener('click', exit);

  /* ── Action buttons (delegated) ────────────────────────── */
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'expand') {
      e.preventDefault();
      expandCurrent();
    } else if (action === 'goto_slide') {
      e.preventDefault();
      const target = btn.dataset.target;
      const idx = slides.findIndex((s) => s.dataset.slideId === target);
      if (idx >= 0) go(idx);
    }
  });

  /* ── Keyboard ─────────────────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (t && t.closest) {
      if (t.closest('.deck__eq')) return;
      if ((e.key === ' ' || e.key === 'Enter') && t.closest('button, a[href], [role="button"]')) return;
    }
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); expandCurrent(); }
    else if (e.key === 'ArrowDown' || e.key === 'Escape') { e.preventDefault(); if (isExpanded()) collapseAll(); else exit(); }
  });

  /* ── Touch swipes (up = expand, down = exit, l/r = nav) ── */
  let tStart = null;
  root.addEventListener('touchstart', (e) => {
    if (e.target.closest('.deck__eq')) return;
    if (e.target.closest('.deck__body') && isExpanded()) return;
    const t = e.touches[0];
    tStart = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: true });

  root.addEventListener('touchend', (e) => {
    if (!tStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - tStart.x;
    const dy = t.clientY - tStart.y;
    const dt = Date.now() - tStart.time;
    tStart = null;
    if (dt > 700) return;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) < 40) return; // too small — probably a tap
    if (ay > ax) {
      if (dy < 0) expandCurrent();
      else if (isExpanded()) collapseAll();
      else exit();
    } else {
      if (dx < 0) next();              // swipe left
      else prev();                     // swipe right
    }
  }, { passive: true });

  /* ── Long-press on caption area ───────────────────────── */
  let pressTimer = null;
  function bindLongPress(el) {
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a')) return;
      pressTimer = setTimeout(expandCurrent, 450);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
      el.addEventListener(ev, () => { clearTimeout(pressTimer); }));
  }
  slides.forEach((s) => {
    const overlay = s.querySelector('.deck__slide-overlay');
    if (overlay) bindLongPress(overlay);
  });

  /* ── Deep-link slide via #s<n> ─────────────────────────── */
  if (location.hash) {
    const m = location.hash.match(/^#s(\d+)$/);
    if (m) {
      const idx = Math.max(0, Math.min(slideCount - 1, parseInt(m[1], 10) - 1));
      if (idx > 0) go(idx);
    }
  }
  if (!current) warm(0);

  /* ── Share the current slide as an image card ─────── */
  const shareBtn = document.getElementById('deckShare');

  function slideImageUrl(el) {
    const img = el.querySelector('img.deck__slide-img');
    if (img && (img.currentSrc || img.src)) return img.currentSrc || img.src;
    const bg = el.style.getPropertyValue('--slide-bg');
    const m = bg && bg.match(/url\((['"]?)([^'")]+)\1\)/);
    return m ? m[2] : '';
  }

  async function shareCurrentSlide() {
    if (!shareBtn || shareBtn.classList.contains('is-busy') || !window.MentriaShareCard) return;
    shareBtn.classList.add('is-busy');
    try {
      const el = slides[current];
      const capEl = el.querySelector('.deck__caption');
      const tagEl = root.querySelector('.deck__chapter-num');
      const blob = await window.MentriaShareCard.render({
        imageUrl: slideImageUrl(el),
        caption: capEl ? capEl.textContent.trim() : '',
        subtitle: shareBtn.getAttribute('data-share-title') || '',
        tag: tagEl ? tagEl.textContent.trim() : ''
      });
      const name = chapterId + '-s' + (current + 1) + '.png';
      const pageUrl = location.origin + location.pathname;
      await window.MentriaShareCard.share(blob, name, {
        title: document.title,
        text: (shareBtn.getAttribute('data-share-title') || document.title) + ' — ' + pageUrl
      });
    } catch (_) {
    } finally {
      shareBtn.classList.remove('is-busy');
    }
  }

  if (shareBtn) shareBtn.addEventListener('click', shareCurrentSlide);
})();
