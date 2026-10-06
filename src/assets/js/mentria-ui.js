(function () {
  'use strict';

  function copyText(text) {
    return Promise.resolve().then(function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no-clipboard');
      return navigator.clipboard.writeText(String(text));
    }).then(function () { return true; }, function () { return false; });
  }

  function copyButton(el, getValue, opts) {
    if (!el || typeof getValue !== 'function') return el;
    opts = opts || {};
    var copiedText = opts.copiedText || 'copied';
    var failedText = opts.failedText || 'copy failed';
    var restoreMs = opts.restoreMs != null ? opts.restoreMs : 900;
    var busy = false;
    el.addEventListener('click', function () {
      if (busy) return;
      busy = true;
      var value = String(getValue());
      var original = el.textContent;
      var settle = function (text, cls) {
        el.textContent = text;
        el.classList.add(cls);
        setTimeout(function () {
          el.textContent = original;
          el.classList.remove(cls);
          busy = false;
        }, restoreMs);
      };
      copyText(value).then(function (ok) {
        if (ok) settle(copiedText, 'is-copied');
        else settle(failedText, 'is-failed');
      });
    });
    return el;
  }

  var toastEl = null;
  var toastTimer = null;

  function toast(message, opts) {
    opts = opts || {};
    var duration = opts.duration != null ? opts.duration : 2200;
    if (!toastEl || !document.body.contains(toastEl)) {
      toastEl = document.createElement('div');
      toastEl.className = 'm-toast m-toast--hide';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
      void toastEl.offsetWidth;
    }
    toastEl.textContent = message == null ? '' : String(message);
    toastEl.classList.remove('m-toast--hide');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      var el = toastEl;
      if (!el) return;
      el.classList.add('m-toast--hide');
      setTimeout(function () {
        if (el.classList.contains('m-toast--hide') && el.parentNode) {
          el.parentNode.removeChild(el);
          if (el === toastEl) toastEl = null;
        }
      }, 320);
    }, duration);
    return toastEl;
  }

  var undoEl = null;
  var undoTimer = null;
  var undoFire = null;
  var undoTyped = null;

  function hideUndo() {
    if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
    undoFire = null;
    undoTyped = null;
    var el = undoEl;
    undoEl = null;
    if (!el) return;
    el.classList.add('m-toast--hide');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
  }

  function undoToast(message, onUndo, opts) {
    opts = opts || {};
    hideUndo();
    var el = document.createElement('div');
    el.className = 'm-toast m-toast--undo m-toast--hide';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    var text = document.createElement('span');
    text.className = 'm-toast__text';
    text.textContent = message == null ? '' : String(message);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'm-toast__action';
    btn.textContent = opts.label || uiCopy('undo', 'common.undo', 'Undo');
    el.appendChild(text);
    el.appendChild(btn);
    document.body.appendChild(el);
    void el.offsetWidth;
    el.classList.remove('m-toast--hide');
    undoEl = el;
    var used = false;
    function fire() {
      if (used) return;
      used = true;
      if (undoEl === el) hideUndo();
      try { onUndo(); } catch (_) {}
    }
    undoFire = fire;
    undoTyped = new WeakSet();
    btn.addEventListener('click', fire);
    var left = opts.duration != null ? opts.duration : 6000;
    var started = 0;
    function arm() {
      started = Date.now();
      undoTimer = setTimeout(function () { if (undoEl === el) hideUndo(); }, left);
    }
    function pause() {
      if (!undoTimer || undoEl !== el) return;
      clearTimeout(undoTimer);
      undoTimer = null;
      left = Math.max(1500, left - (Date.now() - started));
    }
    function resume() {
      if (undoTimer || undoEl !== el) return;
      arm();
    }
    el.addEventListener('mouseenter', pause);
    el.addEventListener('mouseleave', resume);
    el.addEventListener('focusin', pause);
    el.addEventListener('focusout', resume);
    arm();
    return { dismiss: function () { if (undoEl === el) hideUndo(); } };
  }

  function typable(t) {
    if (!t) return false;
    if (t.isContentEditable || t.tagName === 'TEXTAREA') return true;
    return t.tagName === 'INPUT' && /^(text|search|url|tel|email|password|number)$/.test(t.type);
  }

  document.addEventListener('input', function (e) {
    if (undoTyped && typable(e.target)) undoTyped.add(e.target);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (!undoFire || e.defaultPrevented || e.isComposing || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
    if (e.key !== 'z' && e.key !== 'Z' && !(e.code === 'KeyZ' && /^[^\x00-\x7f]$/.test(e.key))) return;
    if (undoTyped && undoTyped.has(e.target)) return;
    e.preventDefault();
    undoFire();
  });

  function takeSharedFile() {
    if (typeof caches === 'undefined') return Promise.resolve(null);
    return caches.open('mentria-share').then(function (cache) {
      return cache.match('/share-target/file').then(function (res) {
        if (!res) return null;
        return res.blob().then(function (blob) {
          var name = 'shared-image';
          try { name = decodeURIComponent(res.headers.get('x-file-name') || name); } catch (_) {}
          return cache.delete('/share-target/file').then(function () {
            return new File([blob], name, { type: blob.type || res.headers.get('content-type') || '' });
          });
        });
      });
    }).catch(function () { return null; });
  }

  function takeSharedText() {
    if (typeof caches === 'undefined') return Promise.resolve(null);
    return caches.open('mentria-share').then(function (cache) {
      return cache.match('/share-target/text').then(function (res) {
        if (!res) return null;
        return res.text().then(function (text) {
          var title = '';
          try { title = decodeURIComponent(res.headers.get('x-share-title') || ''); } catch (_) {}
          return cache.delete('/share-target/text').then(function () { return { text: text, title: title }; });
        });
      });
    }).catch(function () { return null; });
  }

  function consumeShared(onFile, onText) {
    if (!/[?&]shared=1(&|$)/.test(location.search)) return;
    try { history.replaceState(history.state, '', location.pathname + location.hash); } catch (_) {}
    takeSharedFile().then(function (file) {
      if (file) { if (onFile) onFile(file); return; }
      return takeSharedText().then(function (shared) { if (shared && shared.text && onText) onText(shared.text, { title: shared.title }); });
    });
  }

  var SEND_TARGETS = {
    image: [
      { slug: 'exif', ok: function (p) { return /^image\/(jpeg|png|webp|tiff)$/.test(p.blob.type); } },
      { slug: 'image-compressor' },
      { slug: 'qr-scanner' },
      { slug: 'annotate-image', ok: function () { return !!navigator.gpu; } }
    ],
    text: [
      { slug: 'totp', ok: function (p) { return /^(otpauth:\/\/totp\/|otpauth-migration:\/\/)/i.test(p.text.trim()); } },
      { slug: 'quick-notes', ok: function (p) { return p.text.length <= 100000; } },
      { slug: 'base64-codec', ok: function (p) { return p.text.length <= 2097152; } },
      { slug: 'json-formatter', ok: function (p) { return /^\s*[[{]/.test(p.text); } },
      { slug: 'qr-scanner', ok: function (p) { var t = p.text.trim(); return t.length <= 1000 && !/[\r\n]/.test(t); } }
    ]
  };

  function uiText(key, fallback) {
    var I = window.MentriaI18n;
    var v = I && typeof I.t === 'function' ? I.t(key) : null;
    return typeof v === 'string' && v !== key ? v : fallback;
  }

  function uiCopy(name, key, fallback) {
    var c = window.MentriaUICopy || {};
    return uiText(key, c[name] || fallback);
  }

  function localePrefix() {
    var L = window.MENTRIA_LOCALES || [];
    var p = location.pathname;
    for (var i = 0; i < L.length; i++) {
      var pre = L[i].prefix;
      if (pre && (p === pre || p.indexOf(pre + '/') === 0)) return pre;
    }
    return '';
  }

  function toolTitle(slug) {
    var tools = (window.MENTRIA_PALETTE_DATA && window.MENTRIA_PALETTE_DATA.tools) || [];
    for (var i = 0; i < tools.length; i++) {
      if (tools[i].slug === slug) return uiText('tools.' + slug + '.title', tools[i].title);
    }
    return '';
  }

  function sendTargets(payload) {
    var kind = payload && payload.blob ? 'image' : (payload && typeof payload.text === 'string' && payload.text.trim() ? 'text' : '');
    if (!kind || typeof caches === 'undefined') return [];
    var m = location.pathname.slice(localePrefix().length).match(/^\/tools\/([^/]+)\//);
    var from = m ? m[1] : '';
    return SEND_TARGETS[kind].filter(function (t) {
      return t.slug !== from && (!t.ok || t.ok(payload)) && !!toolTitle(t.slug);
    }).map(function (t) { return t.slug; });
  }

  function sendTo(slug, payload) {
    return caches.open('mentria-share').then(function (cache) {
      return Promise.all([cache.delete('/share-target/file'), cache.delete('/share-target/text')]).then(function () {
        if (payload.blob) {
          return cache.put('/share-target/file', new Response(payload.blob, { headers: { 'content-type': payload.blob.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(payload.name || 'image') } }));
        }
        return cache.put('/share-target/text', new Response(payload.text, { headers: { 'content-type': 'text/plain; charset=utf-8' } }));
      });
    }).then(function () {
      location.href = localePrefix() + '/tools/' + slug + '/?shared=1';
      return true;
    }, function () {
      toast(uiCopy('sendFailed', 'common.send_failed', 'Couldn’t send to {tool}').split('{tool}').join(toolTitle(slug)));
      return false;
    });
  }

  var sendOpen = null;

  function openSendMenu(btn, payload, slugs) {
    var menu = document.createElement('div');
    menu.className = 'm-send';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', uiCopy('sendLabel', 'common.send_to_label', 'Send to another tool'));
    slugs.forEach(function (slug) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'm-send__item';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-slug', slug);
      item.innerHTML = '<span class="m-send__icon" aria-hidden="true"><svg viewBox="0 0 48 48" focusable="false"><use href="#tool-' + slug + '"></use></svg></span><span class="m-send__name"></span>';
      item.lastChild.textContent = toolTitle(slug);
      menu.appendChild(item);
    });
    if (!document.getElementById('tool-' + slugs[0]) && window.MentriaToolsPopup) window.MentriaToolsPopup.load();
    document.body.appendChild(menu);

    var r = btn.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var vh = window.innerHeight;
    var mw = menu.offsetWidth;
    var mh = menu.offsetHeight;
    var below = r.bottom + 6 + mh <= vh - 12 || r.top - 6 - mh < 12;
    var end = r.left + mw > vw - 12;
    menu.style.left = Math.max(12, Math.min(end ? r.right - mw : r.left, vw - mw - 12)) + 'px';
    menu.style.top = Math.max(12, below ? r.bottom + 6 : r.top - 6 - mh) + 'px';
    menu.style.transformOrigin = (below ? 'top ' : 'bottom ') + (end ? 'right' : 'left');
    if (!below) menu.classList.add('is-above');
    btn.setAttribute('aria-expanded', 'true');

    var watcher = null;
    if (typeof window.CloseWatcher === 'function') {
      try {
        watcher = new window.CloseWatcher();
        watcher.addEventListener('close', function () { watcher = null; close(true); });
      } catch (_) { watcher = null; }
    }
    function items() { return Array.prototype.slice.call(menu.querySelectorAll('.m-send__item')); }
    function close(refocus) {
      if (sendOpen !== state) return;
      sendOpen = null;
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pagehide', onAway);
      if (watcher) { try { watcher.destroy(); } catch (_) {} watcher = null; }
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      btn.setAttribute('aria-expanded', 'false');
      if (refocus) { try { btn.focus({ preventScroll: true }); } catch (_) {} }
    }
    function onAway() { close(false); }
    function onScroll(e) { if (!menu.contains(e.target)) close(false); }
    function onDown(e) { if (!menu.contains(e.target) && !btn.contains(e.target)) close(false); }
    function onKey(e) {
      var list = items();
      var i = list.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close(false);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var step = e.key === 'ArrowDown' ? 1 : list.length - 1;
        list[i < 0 ? (step === 1 ? 0 : list.length - 1) : (i + step) % list.length].focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        list[e.key === 'Home' ? 0 : list.length - 1].focus();
      }
    }
    menu.addEventListener('click', function (e) {
      var item = e.target.closest && e.target.closest('.m-send__item');
      if (!item || menu.classList.contains('is-sending')) return;
      menu.classList.add('is-sending');
      item.classList.add('is-active');
      sendTo(item.getAttribute('data-slug'), payload).then(function (ok) { if (!ok) close(true); });
    });
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onAway);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('pagehide', onAway);
    var state = { btn: btn, close: close };
    sendOpen = state;
    try { items()[0].focus({ preventScroll: true }); } catch (_) {}
  }

  function sendMenu(btn, getPayload) {
    if (!btn) return;
    if (typeof caches === 'undefined') { btn.hidden = true; return; }
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function () {
      if (sendOpen) {
        var mine = sendOpen.btn === btn;
        sendOpen.close(false);
        if (mine) return;
      }
      Promise.resolve(getPayload()).then(function (payload) {
        var slugs = sendTargets(payload);
        if (slugs.length && btn.isConnected) openSendMenu(btn, payload, slugs);
      });
    });
  }

  function sendLabel(name) {
    if (name) return uiCopy('sendNamed', 'common.send_named', 'Send {name} to another tool').split('{name}').join(name);
    return uiCopy('sendTo', 'common.send_to', 'Send to…');
  }

  function floatSupported() {
    return 'documentPictureInPicture' in window;
  }

  function fontFaces() {
    var out = '';
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      var rules = null;
      try { rules = sheets[i].cssRules; } catch (_) {}
      if (!rules) continue;
      for (var j = 0; j < rules.length; j++) {
        if (rules[j] instanceof CSSFontFaceRule) out += rules[j].cssText.replace(/url\((['"]?)\/(?!\/)/g, 'url($1' + location.origin + '/');
      }
    }
    return out;
  }

  function floatWindow(opts) {
    opts = opts || {};
    if (!floatSupported()) return Promise.resolve(null);
    try { if (window.documentPictureInPicture.window) window.documentPictureInPicture.window.close(); } catch (_) {}
    return window.documentPictureInPicture.requestWindow({ width: opts.width || 300, height: opts.height || 180 }).then(function (win) {
      var cs = getComputedStyle(document.documentElement);
      var v = function (name, fallback) { return (cs.getPropertyValue(name) || '').trim() || fallback; };
      win.document.title = opts.title || document.title;
      win.document.documentElement.lang = document.documentElement.lang || 'en';
      var style = win.document.createElement('style');
      style.textContent = fontFaces() + ':root{color-scheme:dark;--bg:' + v('--term-bg', '#0b0e11') + ';--raised:' + v('--term-bg-raised', '#14181d') +
        ';--fg:' + v('--term-fg', '#e6edf3') + ';--muted:' + v('--term-muted', '#8b98a5') + ';--border:' + v('--term-border-strong', '#2a3138') +
        ';--accent:' + v('--syn-cyan', '#22d3ee') + ';--pink:' + v('--syn-pink', '#f25fa8') + '}' +
        'html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font-family:' + v('--font-mono', 'ui-monospace,SFMono-Regular,Menlo,monospace') + '}' +
        'button{font:inherit;color:var(--fg);background:var(--raised);border:1px solid var(--border);border-radius:8px;padding:6px 12px;cursor:pointer}' +
        'button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}' + (opts.css || '');
      win.document.head.appendChild(style);
      return win;
    }).catch(function () { return null; });
  }

  function status(el) {
    if (el.getAttribute('role') !== 'status') el.setAttribute('role', 'status');
    if (!el.getAttribute('aria-live')) el.setAttribute('aria-live', 'polite');
    return {
      set: function (msg, tone) {
        el.textContent = msg == null ? '' : String(msg);
        if (tone) el.dataset.tone = tone;
        else delete el.dataset.tone;
      },
      clear: function () {
        el.textContent = '';
        delete el.dataset.tone;
      }
    };
  }

  function segmented(container, onChange) {
    function buttons() {
      return Array.prototype.slice.call(container.children).filter(function (c) {
        return c.tagName === 'BUTTON' && c.hasAttribute('data-value');
      });
    }
    function reflect() {
      buttons().forEach(function (b) {
        var on = b.classList.contains('is-active');
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
    }
    function activate(btn, fire) {
      buttons().forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      reflect();
      if (fire && typeof onChange === 'function') onChange(btn.getAttribute('data-value'), btn);
    }
    if (!container.getAttribute('role')) container.setAttribute('role', 'radiogroup');
    reflect();
    if (!buttons().some(function (b) { return b.tabIndex === 0; })) {
      var first = buttons()[0];
      if (first) first.tabIndex = 0;
    }
    container.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-value]') : null;
      if (!btn || btn.parentNode !== container) return;
      activate(btn, true);
    });
    container.addEventListener('keydown', function (e) {
      var dir = 0;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') dir = 1;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') dir = -1;
      else return;
      var btns = buttons().filter(function (b) { return !b.disabled; });
      if (btns.length < 2) return;
      var idx = btns.indexOf(document.activeElement);
      if (idx === -1) return;
      e.preventDefault();
      var next = btns[(idx + dir + btns.length) % btns.length];
      next.focus();
      next.click();
    });
    return {
      set: function (value) {
        var btns = buttons();
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].getAttribute('data-value') === String(value)) { activate(btns[i], false); return; }
        }
      }
    };
  }

  function sensorsGranted(names) {
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve(false);
    return Promise.all(names.map(function (name) {
      return navigator.permissions.query({ name: name }).then(function (r) { return r.state === 'granted'; });
    })).then(function (all) { return all.every(Boolean); }, function () { return false; });
  }

  function debouncedSaver(fn, ms) {
    var delay = ms || 500;
    var timer = null;
    function flush() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      return fn();
    }
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn(); }, delay);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('pagehide', flush);
    return { schedule: schedule, flush: flush, pending: function () { return !!timer; } };
  }

  function downloadFile(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function canShareFile(filename, type) {
    if (!navigator.canShare) return false;
    try {
      return navigator.canShare({ files: [new File([new Blob()], filename, { type: type })] });
    } catch (_) { return false; }
  }

  async function shareFile(filename, blob) {
    var file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return true; }
      catch (e) { if (e && e.name === 'AbortError') return true; }
    }
    downloadFile(filename, blob);
    return false;
  }

  function migrateStore(ns, key, legacyKey, fallback) {
    if (window.MentriaStore) {
      var v = window.MentriaStore.get(ns, key);
      if (v != null) return v;
      try {
        var raw = localStorage.getItem(legacyKey);
        if (raw != null) {
          var parsed = JSON.parse(raw);
          window.MentriaStore.set(ns, key, parsed);
          localStorage.removeItem(legacyKey);
          return parsed;
        }
      } catch (e) {}
      return fallback;
    }
    try {
      var legacy = localStorage.getItem(legacyKey);
      if (legacy != null) return JSON.parse(legacy);
    } catch (e2) {}
    return fallback;
  }

  var HAS_CLOSE_WATCHER = typeof window.CloseWatcher === 'function';
  var backStack = [];
  var backGuard = false;

  if (!HAS_CLOSE_WATCHER) {
    window.addEventListener('popstate', function () {
      if (backGuard) { backGuard = false; return; }
      var fn = backStack.pop();
      if (fn) { try { fn(); } catch (e) {} }
    });
  }

  function backDismiss(closeFn) {
    if (typeof closeFn !== 'function') return { release: function () {} };
    if (HAS_CLOSE_WATCHER) {
      var w = null;
      try { w = new window.CloseWatcher(); } catch (e) { w = null; }
      if (w) {
        var fired = false;
        w.addEventListener('close', function () { fired = true; try { closeFn(); } catch (e) {} });
        return { release: function () { if (fired) return; try { w.destroy(); } catch (e) {} } };
      }
    }
    try { history.pushState({ mOverlay: backStack.length + 1 }, ''); } catch (e) {}
    backStack.push(closeFn);
    return {
      release: function () {
        var i = backStack.lastIndexOf(closeFn);
        if (i === -1) return;
        backStack.splice(i, 1);
        backGuard = true;
        try { history.back(); } catch (e) { backGuard = false; }
      }
    };
  }

  function modal(el) {
    var card = el.querySelector('.m-modal__card') || el;
    if (!card.getAttribute('role')) card.setAttribute('role', 'dialog');
    if (!card.getAttribute('aria-modal')) card.setAttribute('aria-modal', 'true');
    var isOpen = false;
    var prevFocus = null;
    var inerted = [];
    var backHandle = null;

    function focusable() {
      return Array.prototype.slice.call(
        el.querySelectorAll('button, a[href], area[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      ).filter(function (n) { return !n.disabled && !n.hidden && n.type !== 'hidden'; });
    }
    function onKey(e) {
      if (e.target && e.target.closest && e.target.closest('[popover]')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusable();
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function open() {
      if (isOpen) return;
      isOpen = true;
      prevFocus = document.activeElement;
      el.hidden = false;
      inerted = Array.prototype.slice.call(document.body.children).filter(function (c) {
        return c !== el && !c.hasAttribute('inert') && !c.hasAttribute('popover');
      });
      inerted.forEach(function (c) { c.setAttribute('inert', ''); });
      document.addEventListener('keydown', onKey);
      backHandle = backDismiss(close);
      var f = focusable();
      if (f.length) f[0].focus();
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      if (backHandle) { backHandle.release(); backHandle = null; }
      el.hidden = true;
      document.removeEventListener('keydown', onKey);
      inerted.forEach(function (c) { c.removeAttribute('inert'); });
      inerted = [];
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
      prevFocus = null;
    }
    return { open: open, close: close };
  }

  var wmenu = null;
  var wmenuModal = null;
  var lastPointer = '';

  function windowRows(dots) {
    var red = dots.querySelector('.terminal-frame__dot--red');
    var yellow = dots.querySelector('[data-mini]');
    var green = dots.querySelector('[data-action="toggle-fullscreen"]');
    var full = !!(green && green.getAttribute('aria-pressed') === 'true');
    var rows = [];
    if (red && (red.tagName === 'A' || red.tagName === 'BUTTON')) {
      rows.push({ dot: red, color: 'red', label: red.getAttribute('aria-label') || uiCopy('windowClose', 'common.close_tool', 'Close tool'), hint: uiCopy('windowCloseHint', 'common.window.close_hint', 'Back to where you were') });
    }
    if (yellow) {
      rows.push({ dot: yellow, color: 'yellow', label: uiCopy('windowMinimize', 'common.window.minimize', 'Minimize'), hint: uiCopy('windowMinimizeHint', 'common.window.minimize_hint', 'Keep it as a pill while you look around') });
    }
    if (green) {
      rows.push({
        dot: green,
        color: 'green',
        label: full ? uiCopy('windowExitFull', 'common.window.exit_fullscreen', 'Exit full screen') : uiCopy('windowFull', 'common.window.fullscreen', 'Full screen'),
        hint: full ? uiCopy('windowExitFullHint', 'common.window.exit_fullscreen_hint', 'Show the site header again') : uiCopy('windowFullHint', 'common.window.fullscreen_hint', 'Hide the site header')
      });
    }
    return rows;
  }

  function windowMenu(dots) {
    var rows = windowRows(dots);
    if (!rows.length) return;
    if (!wmenu) {
      wmenu = document.createElement('div');
      wmenu.className = 'm-wmenu';
      wmenu.hidden = true;
      wmenu.setAttribute('role', 'dialog');
      wmenu.setAttribute('aria-modal', 'true');
      wmenu.innerHTML = '<div class="m-wmenu__scrim" aria-hidden="true"></div>' +
        '<div class="m-wmenu__sheet"><span class="m-wmenu__grip" aria-hidden="true"></span>' +
        '<div class="m-wmenu__head"><span class="m-wmenu__icon" aria-hidden="true"></span><span class="m-wmenu__name"></span></div>' +
        '<div class="m-wmenu__rows"></div><button type="button" class="m-wmenu__cancel"></button></div>';
      document.body.appendChild(wmenu);
      wmenuModal = modal(wmenu);
      wmenu.querySelector('.m-wmenu__scrim').addEventListener('click', function () { wmenuModal.close(); });
      wmenu.querySelector('.m-wmenu__cancel').addEventListener('click', function () { wmenuModal.close(); });
    }
    var frame = dots.closest('.terminal-frame');
    var nameEl = frame && frame.querySelector('.terminal-frame__filename');
    var hit = location.pathname.match(/\/tools\/([^/]+)\/|^\/(comms)\//) || [];
    var slug = hit[1] || hit[2] || '';
    wmenu.setAttribute('aria-label', uiCopy('windowLabel', 'common.window.label', 'Window controls'));
    var icon = wmenu.querySelector('.m-wmenu__icon');
    icon.innerHTML = slug ? '<svg viewBox="0 0 48 48" focusable="false"><use href="#tool-' + slug + '"></use></svg>' : '';
    if (slug && !document.getElementById('tool-' + slug) && window.MentriaToolsPopup) window.MentriaToolsPopup.load();
    wmenu.querySelector('.m-wmenu__name').textContent = (nameEl && nameEl.textContent.trim()) || document.title;
    wmenu.querySelector('.m-wmenu__cancel').textContent = uiCopy('windowCancel', 'common.dialog.cancel', 'Cancel');
    var list = wmenu.querySelector('.m-wmenu__rows');
    list.innerHTML = '';
    var pushed = false;
    rows.forEach(function (r) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'm-wmenu__row';
      btn.innerHTML = '<span class="m-wmenu__dot m-wmenu__dot--' + r.color + '" aria-hidden="true"></span><span class="m-wmenu__text"><span class="m-wmenu__label"></span><span class="m-wmenu__hint"></span></span>';
      btn.querySelector('.m-wmenu__label').textContent = r.label;
      btn.querySelector('.m-wmenu__hint').textContent = r.hint;
      btn.addEventListener('click', function () {
        var done = false;
        function go() {
          if (done) return;
          done = true;
          window.removeEventListener('popstate', go);
          r.dot.click();
        }
        if (pushed) {
          window.addEventListener('popstate', go);
          setTimeout(go, 400);
        }
        wmenuModal.close();
        if (!pushed) go();
      });
      list.appendChild(btn);
    });
    wmenuModal.open();
    pushed = !!(history.state && history.state.mOverlay);
  }

  document.addEventListener('pointerdown', function (e) { lastPointer = e.pointerType || ''; }, true);
  document.addEventListener('keydown', function () { lastPointer = ''; }, true);
  document.addEventListener('click', function (e) {
    var type = lastPointer;
    lastPointer = '';
    if (type !== 'touch') return;
    var dots = e.target.closest && e.target.closest('.terminal-frame__dots');
    if (!dots) return;
    e.preventDefault();
    e.stopPropagation();
    windowMenu(dots);
  }, true);

  var helpReturn = new WeakMap();
  document.addEventListener('toggle', function (e) {
    var pop = e.target;
    if (!pop || !pop.matches || !pop.matches('.game-help[popover]')) return;
    if (e.newState === 'open') {
      helpReturn.set(pop, document.activeElement);
      var closeBtn = pop.querySelector('[popovertargetaction="hide"]');
      if (closeBtn) { try { closeBtn.focus({ preventScroll: true }); } catch (_) {} }
    } else {
      var back = helpReturn.get(pop);
      helpReturn.delete(pop);
      if (back && back !== document.body && document.contains(back) && back.focus) { try { back.focus({ preventScroll: true }); } catch (_) {} }
    }
  }, true);

  window.MentriaUI = {
    copyText: copyText,
    copyButton: copyButton,
    toast: toast,
    undoToast: undoToast,
    floatSupported: floatSupported,
    takeSharedFile: takeSharedFile,
    consumeShared: consumeShared,
    sendTargets: sendTargets,
    sendTo: sendTo,
    sendMenu: sendMenu,
    sendLabel: sendLabel,
    floatWindow: floatWindow,
    status: status,
    segmented: segmented,
    debouncedSaver: debouncedSaver,
    sensorsGranted: sensorsGranted,
    downloadFile: downloadFile,
    canShareFile: canShareFile,
    shareFile: shareFile,
    migrateStore: migrateStore,
    modal: modal,
    backDismiss: backDismiss,
    toolTitle: toolTitle,
    localePrefix: localePrefix,
    windowMenu: windowMenu
  };
})();
