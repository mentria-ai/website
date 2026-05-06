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

  const sheet = document.getElementById('deckSheet');
  const sheetBody = document.getElementById('deckSheetBody');
  const sheetClose = document.getElementById('deckSheetClose');
  const closeBtn = document.getElementById('deckClose');
  const hint = document.getElementById('deckHint');

  let current = 0;
  let hintFaded = false;

  const longPressTemplates = new Map();
  root.querySelectorAll('.deck__long-press').forEach((tpl) => {
    longPressTemplates.set(tpl.dataset.for, tpl.innerHTML);
  });

  function fadeHint() {
    if (hintFaded || !hint) return;
    hintFaded = true;
    hint.classList.add('is-fading');
  }

  function go(i) {
    if (i < 0 || i >= slideCount) return;
    current = i;
    slides.forEach((el, idx) => el.classList.toggle('is-active', idx === i));
    segs.forEach((el, idx) => {
      el.classList.toggle('is-done', idx < i);
      el.classList.toggle('is-active', idx === i);
    });
    closeSheet();
    fadeHint();
    try { history.replaceState(null, '', '#s' + (i + 1)); } catch (_) {}
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

  function openSheet(html) {
    if (!sheet || !sheetBody) return;
    sheetBody.innerHTML = html;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('is-open'));
  }
  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove('is-open');
    setTimeout(() => { sheet.hidden = true; }, 320);
  }

  function expandCurrent() {
    const slide = slides[current];
    const id = slide && slide.dataset.slideId;
    const html = id && longPressTemplates.get(id);
    if (html) openSheet(html);
  }

  function exit() {
    const back = document.referrer && document.referrer.indexOf(location.origin) === 0
      ? -1
      : '/feed/';
    if (back === -1) history.back();
    else location.href = '/feed/';
  }

  /* ── Tap zones ─────────────────────────────────────────── */
  root.querySelector('.deck__tap--prev').addEventListener('click', prev);
  root.querySelector('.deck__tap--next').addEventListener('click', next);

  /* ── Close + sheet close ───────────────────────────────── */
  if (closeBtn) closeBtn.addEventListener('click', exit);
  if (sheetClose) sheetClose.addEventListener('click', closeSheet);

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
    } else if (action === 'share') {
      e.preventDefault();
      shareChapter();
    }
  });

  async function shareChapter() {
    const title = root.dataset.chapterTitle || 'Mentria chapter';
    const url = location.origin + '/feed/chapter/' + chapterId + '/';
    const data = { title, text: 'Just finished: ' + title, url };
    try {
      if (navigator.share) await navigator.share(data);
      else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        flashToast('Link copied');
      }
    } catch (_) { /* user-cancel — no-op */ }
  }

  function flashToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `
      position: absolute; left: 50%; bottom: 80px; transform: translateX(-50%);
      background: rgba(34, 211, 238, 0.95); color: #000;
      padding: 8px 16px; border-radius: 18px; font-family: var(--font-mono, monospace);
      font-size: 0.78rem; font-weight: 700; z-index: 12;
      animation: fadeOut 1.6s ease forwards;
    `;
    root.appendChild(t);
    setTimeout(() => t.remove(), 1700);
  }

  /* ── Keyboard ─────────────────────────────────────────── */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); expandCurrent(); }
    else if (e.key === 'ArrowDown' || e.key === 'Escape') { e.preventDefault(); exit(); }
  });

  /* ── Touch swipes (up = expand, down = exit, l/r = nav) ── */
  let tStart = null;
  root.addEventListener('touchstart', (e) => {
    if (e.target.closest('.deck__sheet')) return;
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
      if (dy < 0) expandCurrent();    // swipe up
      else exit();                     // swipe down
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

  /* ── Style: fadeOut keyframe (toast) ───────────────────── */
  const style = document.createElement('style');
  style.textContent = '@keyframes fadeOut { 0%,70%{opacity:1} 100%{opacity:0;transform:translateX(-50%) translateY(8px)} }';
  document.head.appendChild(style);
})();
