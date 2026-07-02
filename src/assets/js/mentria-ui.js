(function () {
  'use strict';

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
      Promise.resolve()
        .then(function () {
          if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('no-clipboard');
          return navigator.clipboard.writeText(value);
        })
        .then(function () { settle(copiedText, 'is-copied'); })
        .catch(function () { settle(failedText, 'is-failed'); });
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
    function activate(btn, fire) {
      buttons().forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      if (fire && typeof onChange === 'function') onChange(btn.getAttribute('data-value'), btn);
    }
    container.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-value]') : null;
      if (!btn || btn.parentNode !== container) return;
      activate(btn, true);
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

  function debouncedSaver(fn, ms) {
    var delay = ms || 500;
    var timer = null;
    function flush() {
      if (timer) { clearTimeout(timer); timer = null; }
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
    return { schedule: schedule, flush: flush };
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

  function modal(el) {
    var card = el.querySelector('.m-modal__card') || el;
    if (!card.getAttribute('role')) card.setAttribute('role', 'dialog');
    if (!card.getAttribute('aria-modal')) card.setAttribute('aria-modal', 'true');
    var isOpen = false;
    var prevFocus = null;
    var inerted = [];

    function focusable() {
      return Array.prototype.slice.call(
        el.querySelectorAll('button, [href], input, select, textarea')
      ).filter(function (n) { return !n.disabled && !n.hidden && n.type !== 'hidden'; });
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
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
        return c !== el && !c.hasAttribute('inert');
      });
      inerted.forEach(function (c) { c.setAttribute('inert', ''); });
      document.addEventListener('keydown', onKey);
      var f = focusable();
      if (f.length) f[0].focus();
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      el.hidden = true;
      document.removeEventListener('keydown', onKey);
      inerted.forEach(function (c) { c.removeAttribute('inert'); });
      inerted = [];
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (e) {} }
      prevFocus = null;
    }
    return { open: open, close: close };
  }

  window.MentriaUI = {
    copyButton: copyButton,
    toast: toast,
    status: status,
    segmented: segmented,
    debouncedSaver: debouncedSaver,
    downloadFile: downloadFile,
    migrateStore: migrateStore,
    modal: modal
  };
})();
