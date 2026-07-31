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
  (function markSeen() {
    try {
      const id = root.dataset.chapterId;
      if (!id || !window.MentriaStore) return;
      const seen = window.MentriaStore.get('feed', 'seen') || {};
      if (seen[id]) return;
      seen[id] = Date.now();
      const keys = Object.keys(seen);
      if (keys.length > 400) {
        keys.sort((a, b) => seen[a] - seen[b]);
        keys.slice(0, keys.length - 400).forEach((k) => { delete seen[k]; });
      }
      window.MentriaStore.set('feed', 'seen', seen);
    } catch (_) {}
  })();

  const localePrefix = (function () {
    const locs = window.MENTRIA_LOCALES || [];
    const path = location.pathname || '/';
    for (let i = 0; i < locs.length; i++) {
      const p = locs[i].prefix;
      if (p && (path === p || path.indexOf(p + '/') === 0)) return p;
    }
    return '';
  })();

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
  function collapsedHTML(body) { return esc(body.dataset.truncated) + '… ' + moreLink('more', false); }
  function fullHTML(body) { return body.dataset.full + ' ' + moreLink('less', true); }

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

  function exit() {
    const back = document.referrer && document.referrer.indexOf(location.origin) === 0
      ? -1
      : localePrefix + '/feed/';
    if (back === -1) history.back();
    else location.href = localePrefix + '/feed/';
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
    } else if (action === 'share') {
      e.preventDefault();
      shareChapter();
    }
  });

  async function shareChapter() {
    const title = root.dataset.chapterTitle || 'Mentria chapter';
    const url = location.origin + localePrefix + '/feed/chapter/' + chapterId + '/';
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

  /* ── Share the current slide as an image card ─────── */
  const shareBtn = document.getElementById('deckShare');

  function slideImageUrl(el) {
    const img = el.querySelector('img.deck__slide-img');
    if (img && (img.currentSrc || img.src)) return img.currentSrc || img.src;
    const bg = el.style.getPropertyValue('--slide-bg');
    const m = bg && bg.match(/url\((['"]?)([^'")]+)\1\)/);
    return m ? m[2] : '';
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
  }

  function wrapLines(ctx, text, maxWidth, maxLines) {
    const words = text.split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const w of words) {
      const probe = line ? line + ' ' + w : w;
      if (ctx.measureText(probe).width <= maxWidth || !line) {
        line = probe;
      } else {
        lines.push(line);
        line = w;
        if (lines.length === maxLines - 1) break;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    const used = lines.join(' ');
    if (used.length < text.length && lines.length) {
      lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*\S*$/, '') + '…';
    }
    return lines;
  }

  async function renderShareCard() {
    const el = slides[current];
    const capEl = el.querySelector('.deck__caption');
    const caption = capEl ? capEl.textContent.trim() : '';
    const subtitle = (shareBtn.getAttribute('data-share-title') || '').trim();
    const tagEl = root.querySelector('.deck__chapter-num');
    const tag = tagEl ? tagEl.textContent.trim() : '';
    const W = 1080, H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(0, 0, W, H);
    const url = slideImageUrl(el);
    if (url) {
      try {
        const im = await loadImage(url);
        const scale = Math.max(W / im.naturalWidth, H / im.naturalHeight);
        const dw = im.naturalWidth * scale, dh = im.naturalHeight * scale;
        ctx.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
      } catch (_) {}
    }

    const scrim = ctx.createLinearGradient(0, H * 0.42, 0, H);
    scrim.addColorStop(0, 'rgba(6,6,12,0)');
    scrim.addColorStop(0.45, 'rgba(6,6,12,0.72)');
    scrim.addColorStop(1, 'rgba(6,6,12,0.94)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, H);

    try { await document.fonts.ready; } catch (_) {}
    const MONO = "'JetBrains Mono', 'Fira Code', 'Courier New', monospace";
    const PAD = 72;
    let baseline = H - PAD;

    ctx.textBaseline = 'alphabetic';
    ctx.font = '500 30px ' + MONO;
    ctx.fillStyle = '#6ef3c5';
    ctx.fillText('mentria.ai', PAD, baseline);
    if (tag) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.textAlign = 'right';
      ctx.fillText(tag, W - PAD, baseline);
      ctx.textAlign = 'left';
    }
    baseline -= 54;
    ctx.strokeStyle = 'rgba(110,243,197,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(PAD, baseline);
    ctx.lineTo(PAD + 64, baseline);
    ctx.stroke();
    baseline -= 44;

    if (subtitle && subtitle !== caption) {
      ctx.font = '400 30px ' + MONO;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      const subLines = wrapLines(ctx, subtitle, W - PAD * 2, 2).reverse();
      for (const line of subLines) {
        ctx.fillText(line, PAD, baseline);
        baseline -= 42;
      }
      baseline -= 18;
    }

    ctx.font = '600 52px ' + MONO;
    ctx.fillStyle = '#ffffff';
    const capLines = wrapLines(ctx, caption, W - PAD * 2, 6).reverse();
    for (const line of capLines) {
      ctx.fillText(line, PAD, baseline);
      baseline -= 68;
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
    });
  }

  async function shareCurrentSlide() {
    if (!shareBtn || shareBtn.classList.contains('is-busy')) return;
    shareBtn.classList.add('is-busy');
    try {
      const blob = await renderShareCard();
      const name = chapterId + '-s' + (current + 1) + '.png';
      const pageUrl = location.origin + location.pathname;
      const file = new File([blob], name, { type: 'image/png' });
      const payload = {
        files: [file],
        title: document.title,
        text: (shareBtn.getAttribute('data-share-title') || document.title) + ' — ' + pageUrl
      };
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        try {
          await navigator.share(payload);
        } catch (err) {
          if (!err || err.name !== 'AbortError') downloadBlob(name, blob);
        }
      } else {
        downloadBlob(name, blob);
      }
    } catch (_) {
    } finally {
      shareBtn.classList.remove('is-busy');
    }
  }

  function downloadBlob(name, blob) {
    if (window.MentriaUI && window.MentriaUI.downloadFile) {
      window.MentriaUI.downloadFile(name, blob);
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  if (shareBtn) shareBtn.addEventListener('click', shareCurrentSlide);

  /* ── Style: fadeOut keyframe (toast) ───────────────────── */
  const style = document.createElement('style');
  style.textContent = '@keyframes fadeOut { 0%,70%{opacity:1} 100%{opacity:0;transform:translateX(-50%) translateY(8px)} }';
  document.head.appendChild(style);
})();
