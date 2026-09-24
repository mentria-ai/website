(function () {
  'use strict';
  if (window.self !== window.top) return;
  var S = window.MentriaStore;
  var COPY = window.MentriaMiniCopy || {};
  var KEY = 'mini';
  var POS_KEY = 'mini_pos';
  var MAX_AGE = 12 * 3600000;
  var SENS = { low: 1.7, med: 1.1, high: 0.7 };
  var STEP_MIN_MS = 300;
  var TOP_GAP = 64;
  var pill = null;
  var tickTimer = 0;
  var listening = false;
  var sawMotion = false;
  var granted = false;
  var probing = false;
  var wakeLock = null;
  var wakePending = false;
  var wasDone = null;

  function bare(p) {
    var locs = window.MENTRIA_LOCALES || [];
    for (var i = 0; i < locs.length; i++) {
      var pre = locs[i].prefix;
      if (pre && (p === pre || p.indexOf(pre + '/') === 0)) return p.slice(pre.length) || '/';
    }
    return p;
  }
  function prefix() {
    return (window.MENTRIA_PALETTE_DATA && window.MENTRIA_PALETTE_DATA.prefix) || '';
  }

  function session() {
    var v = S ? S.get('ui', KEY) : null;
    if (!v || !v.kind || !v.url) return null;
    if (Date.now() - (v.since || 0) > MAX_AGE) { stop(); return null; }
    return v;
  }
  function start(kind, url) {
    if (!S) return;
    S.set('ui', KEY, { kind: kind, url: bare(url || location.pathname), since: Date.now() });
  }
  function stop() {
    if (S) S.remove('ui', KEY);
    if (listening) { window.removeEventListener('devicemotion', onMotion); listening = false; }
    releaseWake();
    clearInterval(tickTimer);
    tickTimer = 0;
    if (pill) { pill.remove(); pill = null; }
  }
  function leave() {
    var here = location.pathname;
    var ref = null;
    try { ref = document.referrer ? new URL(document.referrer) : null; } catch (_) { ref = null; }
    if (ref && ref.origin === location.origin && ref.pathname !== here && history.length > 1) {
      var gone = false;
      window.addEventListener('pagehide', function () { gone = true; }, { once: true });
      history.back();
      setTimeout(function () { if (!gone && location.pathname === here) location.href = ref.href; }, 800);
    } else {
      location.href = prefix() + '/';
    }
  }

  function holdWake() {
    if (wakeLock || wakePending || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    wakePending = true;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakePending = false;
      if (!listening) { lock.release().catch(function () {}); return; }
      wakeLock = lock;
      lock.addEventListener('release', function () { if (wakeLock === lock) wakeLock = null; });
    }).catch(function () { wakePending = false; });
  }
  function releaseWake() {
    if (!wakeLock) return;
    var lock = wakeLock;
    wakeLock = null;
    lock.release().catch(function () {});
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (h ? String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
    return h ? h + ':' + mm : mm;
  }
  function timerView() {
    var list = S ? S.get('tools', 'countdown_active') : null;
    if (!Array.isArray(list) || !list.length) return null;
    var now = Date.now();
    var running = list.filter(function (e) { return e && e.mode === 'run' && typeof e.endAt === 'number'; })
      .sort(function (a, b) { return a.endAt - b.endAt; });
    if (running.length) {
      var e = running[0];
      var left = (e.endAt - now) / 1000;
      return { value: left > 0 ? fmtClock(left) : (COPY.timesUp || "Time's up"), label: e.title || COPY.timer || 'Timer', done: left <= 0 };
    }
    var paused = list.filter(function (e) { return e && e.mode === 'pause'; })[0];
    if (paused) return { value: fmtClock(paused.remaining), label: (paused.title || COPY.timer || 'Timer') + ' · ' + (COPY.paused || 'Paused') };
    return null;
  }

  var gravity = 9.81, acEMA = 0, waitingForPeak = true, peaked = false, lastPeakAt = 0;
  function stepState() {
    var st = S ? S.get('tools', 'step_counter') : null;
    return st && typeof st === 'object' ? st : null;
  }
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function registerStep() {
    var st = stepState() || {};
    st.history = st.history || {};
    st.estHistory = st.estHistory || {};
    if (st.date && st.date !== todayKey()) {
      if (st.steps > 0) st.history[st.date] = st.steps;
      if (st.estSteps > 0) st.estHistory[st.date] = st.estSteps;
      st.steps = 0;
      st.estSteps = 0;
    }
    st.date = todayKey();
    st.steps = (st.steps || 0) + 1;
    S.set('tools', 'step_counter', st);
    render();
  }
  function onMotion(e) {
    if (document.visibilityState !== 'visible') return;
    var a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    if (!sawMotion) { sawMotion = true; render(); }
    var mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    gravity += (mag - gravity) * 0.05;
    acEMA += (mag - gravity - acEMA) * 0.4;
    var st = stepState();
    var thr = SENS[(st && st.sensitivity) || 'med'] || SENS.med;
    var now = performance.now();
    if (waitingForPeak && acEMA > thr) { peaked = true; waitingForPeak = false; }
    else if (peaked && acEMA < -thr * 0.4) {
      var interval = now - lastPeakAt;
      lastPeakAt = now;
      if (interval >= STEP_MIN_MS) registerStep();
      peaked = false;
      waitingForPeak = true;
    }
  }
  function needsGesture() {
    return typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  }
  function listen() {
    if (listening || typeof DeviceMotionEvent === 'undefined') return;
    window.addEventListener('devicemotion', onMotion);
    listening = true;
    holdWake();
  }
  function stepsView() {
    var st = stepState();
    var n = st && st.date === todayKey() ? (st.steps || 0) : 0;
    var fmt = COPY.steps || '{n} steps';
    var lang = document.documentElement.lang || undefined;
    var paused = needsGesture() && !sawMotion && !granted && !probing;
    return { value: fmt.replace('{n}', n.toLocaleString(lang)), label: paused ? (COPY.tapResume || 'Tap to keep counting') : '', paused: paused };
  }

  function toolName(kind) {
    return kind === 'timer' ? (COPY.timerTool || 'Countdown Timer') : (COPY.stepsTool || 'Step Counter');
  }
  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }
  function render() {
    var ses = session();
    if (!ses) { if (pill) { pill.remove(); pill = null; } return; }
    var view = ses.kind === 'timer' ? timerView() : stepsView();
    if (!view) { stop(); return; }
    if (!pill) build(ses);
    setText(pill.querySelector('.m-mini__value'), view.value);
    var label = pill.querySelector('.m-mini__label');
    setText(label, view.label || '');
    label.hidden = !view.label;
    pill.classList.toggle('is-done', !!view.done);
    pill.classList.toggle('is-paused', !!view.paused);
    var name = (COPY.open || 'Open {name}').replace('{name}', toolName(ses.kind)) + ' · ' + view.value + (view.label ? ' · ' + view.label : '');
    var open = pill.querySelector('.m-mini__open');
    if (open.getAttribute('aria-label') !== name) open.setAttribute('aria-label', name);
    if (ses.kind === 'timer') {
      if (wasDone === false && view.done && window.MentriaUI) window.MentriaUI.toast(view.label + ' · ' + view.value, { duration: 5000 });
      wasDone = !!view.done;
    }
  }
  function applyPos() {
    if (!pill) return;
    var p = S ? S.get('ui', POS_KEY) : null;
    pill.classList.toggle('is-left', !!(p && p.side === 'left'));
    if (p && typeof p.y === 'number' && p.y > 0) pill.style.setProperty('--mini-y', p.y + 'px');
    else pill.style.removeProperty('--mini-y');
  }
  function draggable(el) {
    var id = null, sx = 0, sy = 0, dragging = false, moved = false;
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      id = e.pointerId;
      sx = e.clientX;
      sy = e.clientY;
      dragging = false;
      moved = false;
    });
    el.addEventListener('pointermove', function (e) {
      if (e.pointerId !== id) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragging) {
        if (Math.abs(dx) + Math.abs(dy) < 8) return;
        dragging = true;
        moved = true;
        try { el.setPointerCapture(id); } catch (_) {}
        el.classList.add('is-dragging');
      }
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    });
    function end(e) {
      if (e.pointerId !== id) return;
      id = null;
      if (!dragging) return;
      dragging = false;
      var r = el.getBoundingClientRect();
      var cur = parseFloat(el.style.getPropertyValue('--mini-y')) || 0;
      var y = cur - (e.clientY - sy);
      if (r.top < TOP_GAP) y -= TOP_GAP - r.top;
      var side = r.left + r.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
      el.classList.remove('is-dragging');
      el.style.transform = '';
      if (S) S.set('ui', POS_KEY, { side: side, y: Math.max(0, Math.round(y)) });
      applyPos();
    }
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', function (e) {
      if (!moved) return;
      moved = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }
  function build(ses) {
    pill = document.createElement('div');
    pill.className = 'm-mini';
    pill.setAttribute('role', 'group');
    pill.setAttribute('aria-label', toolName(ses.kind));
    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'm-mini__open';
    var icon = document.createElement('span');
    icon.className = 'm-mini__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = ses.kind === 'timer' ? '⏱' : '\u{1F463}';
    var text = document.createElement('span');
    text.className = 'm-mini__text';
    var value = document.createElement('span');
    value.className = 'm-mini__value';
    var label = document.createElement('span');
    label.className = 'm-mini__label';
    text.append(value, label);
    open.append(icon, text);
    open.addEventListener('click', function () {
      var cur = session();
      if (!cur) { render(); return; }
      if (cur.kind === 'steps' && needsGesture() && !sawMotion && !granted) {
        DeviceMotionEvent.requestPermission().then(function (res) {
          if (res !== 'granted') return;
          granted = true;
          listen();
          render();
        }).catch(function () {});
        return;
      }
      location.href = prefix() + cur.url;
    });
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'm-mini__close';
    close.setAttribute('aria-label', COPY.close || 'Close');
    close.textContent = '×';
    close.addEventListener('click', stop);
    pill.append(open, close);
    draggable(pill);
    document.body.appendChild(pill);
    applyPos();
  }

  function boot() {
    clearInterval(tickTimer);
    tickTimer = 0;
    var ses = session();
    if (!ses) { if (pill) { pill.remove(); pill = null; } return; }
    if (bare(location.pathname) === ses.url) { stop(); return; }
    wasDone = null;
    if (ses.kind === 'steps') {
      listen();
      holdWake();
      if (needsGesture() && !granted) {
        probing = true;
        DeviceMotionEvent.requestPermission().then(function (res) { if (res === 'granted') granted = true; })
          .catch(function () {})
          .then(function () { probing = false; render(); });
      }
    }
    render();
    tickTimer = setInterval(function () { if (document.visibilityState === 'visible') render(); }, 1000);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !pill) return;
    render();
    if (listening) holdWake();
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) boot(); });

  window.MentriaMini = { start: start, stop: stop, leave: leave, active: session };
  boot();
})();
