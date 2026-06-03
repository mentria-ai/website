(function (global) {
  'use strict';

  const BUTTON_NAMES = {
    0: 'a', 1: 'b', 2: 'x', 3: 'y',
    4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt',
    8: 'back', 9: 'start',
    10: 'ls', 11: 'rs',
    12: 'up', 13: 'down', 14: 'left', 15: 'right',
    16: 'home'
  };

  const AXIS_DEAD = 0.35;
  const REPEAT_INITIAL_MS = 350;
  const REPEAT_INTERVAL_MS = 110;

  const state = {
    rafId: 0,
    polling: false,
    pads: {},
    listeners: { connect: [], disconnect: [], button: [], direction: [] }
  };

  function emit(event, payload) {
    const handlers = state.listeners[event] || [];
    for (let i = 0; i < handlers.length; i++) {
      try { handlers[i](payload); } catch (_) {}
    }
    try {
      global.dispatchEvent(new CustomEvent('mentria:gamepad:' + event, { detail: payload }));
    } catch (_) {}
  }

  function on(event, fn) {
    if (!state.listeners[event]) state.listeners[event] = [];
    state.listeners[event].push(fn);
    return () => {
      state.listeners[event] = state.listeners[event].filter((f) => f !== fn);
    };
  }

  function getRawPads() {
    if (typeof navigator.getGamepads !== 'function') return [];
    const list = navigator.getGamepads();
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].connected) out.push(list[i]);
    }
    return out;
  }

  function ensurePadState(pad) {
    let s = state.pads[pad.index];
    if (!s) {
      s = {
        buttons: new Array(pad.buttons.length).fill(false),
        directions: { up: null, down: null, left: null, right: null },
        timestamp: 0
      };
      state.pads[pad.index] = s;
    }
    return s;
  }

  function processButtons(pad, s) {
    const len = Math.min(pad.buttons.length, s.buttons.length);
    for (let i = 0; i < len; i++) {
      const pressed = !!(pad.buttons[i] && pad.buttons[i].pressed);
      if (pressed !== s.buttons[i]) {
        s.buttons[i] = pressed;
        emit('button', {
          padIndex: pad.index,
          index: i,
          name: BUTTON_NAMES[i] || String(i),
          pressed,
          repeat: false
        });
      }
    }
  }

  function dirFromAxes(x, y) {
    const ax = Math.abs(x), ay = Math.abs(y);
    if (Math.max(ax, ay) < AXIS_DEAD) return null;
    if (ax >= ay) return x > 0 ? 'right' : 'left';
    return y > 0 ? 'down' : 'up';
  }

  function dirsForPad(pad) {
    const dirs = { up: false, down: false, left: false, right: false };
    if (pad.buttons[12] && pad.buttons[12].pressed) dirs.up = true;
    if (pad.buttons[13] && pad.buttons[13].pressed) dirs.down = true;
    if (pad.buttons[14] && pad.buttons[14].pressed) dirs.left = true;
    if (pad.buttons[15] && pad.buttons[15].pressed) dirs.right = true;
    if (pad.axes.length >= 2) {
      const d = dirFromAxes(pad.axes[0], pad.axes[1]);
      if (d) dirs[d] = true;
    }
    return dirs;
  }

  function processDirections(pad, s, now) {
    const dirs = dirsForPad(pad);
    ['up', 'down', 'left', 'right'].forEach((dir) => {
      const wasHeld = !!s.directions[dir];
      const heldNow = dirs[dir];
      if (heldNow && !wasHeld) {
        s.directions[dir] = { firstAt: now, lastEmittedAt: now };
        emit('direction', { padIndex: pad.index, direction: dir, repeat: false });
      } else if (heldNow && wasHeld) {
        const held = s.directions[dir];
        const sinceFirst = now - held.firstAt;
        const sinceLast = now - held.lastEmittedAt;
        if (sinceFirst >= REPEAT_INITIAL_MS && sinceLast >= REPEAT_INTERVAL_MS) {
          held.lastEmittedAt = now;
          emit('direction', { padIndex: pad.index, direction: dir, repeat: true });
        }
      } else if (!heldNow && wasHeld) {
        s.directions[dir] = null;
      }
    });
  }

  function tick(now) {
    if (!state.polling) return;
    state.rafId = requestAnimationFrame(tick);
    const pads = getRawPads();
    if (pads.length === 0) return;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      const s = ensurePadState(pad);
      processButtons(pad, s);
      processDirections(pad, s, now);
      s.timestamp = pad.timestamp;
    }
  }

  function startPolling() {
    if (state.polling) return;
    state.polling = true;
    state.rafId = requestAnimationFrame(tick);
  }

  function stopPolling() {
    state.polling = false;
    if (state.rafId) { cancelAnimationFrame(state.rafId); state.rafId = 0; }
  }

  function hasConnected() {
    return getRawPads().length > 0;
  }

  global.addEventListener('gamepadconnected', (e) => {
    const pad = e.gamepad;
    emit('connect', { padIndex: pad.index, id: pad.id, mapping: pad.mapping });
    startPolling();
  });
  global.addEventListener('gamepaddisconnected', (e) => {
    const pad = e.gamepad;
    emit('disconnect', { padIndex: pad.index, id: pad.id });
    delete state.pads[pad.index];
    if (!hasConnected()) stopPolling();
  });

  if (hasConnected()) {
    const pads = getRawPads();
    pads.forEach((pad) => emit('connect', { padIndex: pad.index, id: pad.id, mapping: pad.mapping, late: true }));
    startPolling();
  }

  let toastEl = null;
  let toastTimer = 0;
  function ensureToast() {
    if (toastEl) return toastEl;
    if (!global.document || !global.document.body) return null;
    const css = '#mentria-gamepad-toast{position:fixed;bottom:18px;left:50%;transform:translate(-50%,40px);z-index:99999;background:rgba(10,10,12,0.92);color:#67e8f9;border:1px solid #67e8f9;border-radius:999px;padding:8px 14px;font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.04em;display:flex;align-items:center;gap:8px;opacity:0;pointer-events:none;transition:transform .25s cubic-bezier(.22,1,.36,1),opacity .25s ease;backdrop-filter:blur(8px);box-shadow:0 6px 22px rgba(0,0,0,.4),0 0 18px rgba(103,232,249,.18)}#mentria-gamepad-toast.is-visible{opacity:1;transform:translate(-50%,0)}#mentria-gamepad-toast .dot{width:7px;height:7px;border-radius:50%;background:#34c46a;box-shadow:0 0 8px rgba(52,196,106,.7)}#mentria-gamepad-toast.is-disconnect{color:#f7b015;border-color:#f7b015;box-shadow:0 6px 22px rgba(0,0,0,.4),0 0 18px rgba(247,176,21,.18)}#mentria-gamepad-toast.is-disconnect .dot{background:#f7b015;box-shadow:0 0 8px rgba(247,176,21,.7)}';
    const style = global.document.createElement('style');
    style.id = 'mentria-gamepad-toast-style';
    style.textContent = css;
    global.document.head.appendChild(style);
    toastEl = global.document.createElement('div');
    toastEl.id = 'mentria-gamepad-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    global.document.body.appendChild(toastEl);
    return toastEl;
  }
  function showToast(text, tone) {
    const el = ensureToast();
    if (!el) return;
    el.classList.toggle('is-disconnect', tone === 'disconnect');
    el.innerHTML = '<span class="dot"></span><span></span>';
    el.querySelector('span:last-child').textContent = text;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('is-visible'); }, 2400);
  }

  on('connect', (info) => {
    if (info.late) return;
    showToast('🎮 controller connected', 'connect');
  });
  on('disconnect', () => showToast('🎮 controller disconnected', 'disconnect'));

  global.MentriaGamepad = {
    on,
    getState() { return Object.assign({}, state.pads); },
    getPads: getRawPads,
    isConnected: hasConnected,
    BUTTON_NAMES,
    showToast
  };
})(typeof window !== 'undefined' ? window : globalThis);
