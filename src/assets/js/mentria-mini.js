(function () {
  'use strict';
  if (window.self !== window.top) return;
  var S = window.MentriaStore;
  var COPY = window.MentriaMiniCopy || {};
  var COPY_KEYS = {
    open: 'common.mini.open',
    close: 'common.mini.close',
    timer: 'common.mini.timer',
    timesUp: 'common.mini.times_up',
    alarmTitle: 'tool.countdown-timer.title_alarm',
    stopAlarm: 'tool.countdown-timer.notif_stop_alarm',
    notifTitle: 'tool.countdown-timer.notif_finished_format',
    notifBody: 'tool.countdown-timer.notif_body_open',
    paused: 'common.mini.paused',
    steps: 'common.mini.steps',
    tapResume: 'common.mini.tap_resume',
    timerTool: 'tools.countdown-timer.title',
    stepsTool: 'tools.step-counter.title'
  };
  var KEY = 'mini';
  var TOOL_KEY = 'mini_tool';
  var POS_KEY = 'mini_pos';
  var MAX_AGE = 12 * 3600000;
  var RING_FRESH = 60000;
  var RING_EVERY = 1200;
  var UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'];
  var SENS = { low: 1.7, med: 1.1, high: 0.7 };
  var STEP_MIN_MS = 300;
  var TOP_GAP = 64;
  var dock = null;
  var pill = null;
  var parked = null;
  var tickTimer = 0;
  var endTimer = 0;
  var listening = false;
  var sawMotion = false;
  var granted = false;
  var probing = false;
  var wakeLock = null;
  var wakePending = false;
  var audio = null;
  var resuming = false;
  var unlockOn = false;
  var unlocked = false;
  var ringing = null;
  var ringTimer = 0;
  var rangAt = 0;
  var titleBefore = null;
  var titleShown = null;

  function copy(name, fallback) {
    var I = window.MentriaI18n;
    var v = I && typeof I.t === 'function' && COPY_KEYS[name] ? I.t(COPY_KEYS[name]) : null;
    if (typeof v === 'string' && v) return v;
    return COPY[name] || fallback;
  }

  function bare(p) {
    var locs = window.MENTRIA_LOCALES || [];
    for (var i = 0; i < locs.length; i++) {
      var pre = locs[i].prefix;
      if (pre && (p === pre || p.indexOf(pre + '/') === 0)) return p.slice(pre.length) || '/';
    }
    return p;
  }
  function prefix() {
    if (window.MentriaUI && window.MentriaUI.localePrefix) return window.MentriaUI.localePrefix();
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
    clearTimeout(endTimer);
    endTimer = 0;
    silence();
    armUnlock(false);
    if (audio) {
      var ctx = audio;
      audio = null;
      unlocked = false;
      resuming = false;
      try { ctx.close().catch(function () {}); } catch (_) {}
    }
    if (pill) { pill.remove(); pill = null; }
    tidyDock();
  }
  function leave() {
    var here = location.pathname;
    var ref = null;
    try { ref = window.MentriaNav ? window.MentriaNav.from() : (document.referrer ? new URL(document.referrer) : null); } catch (_) { ref = null; }
    if (ref && ref.origin === location.origin && ref.pathname !== here && history.length > 1) {
      var gone = false;
      window.addEventListener('pagehide', function () { gone = true; }, { once: true });
      history.back();
      setTimeout(function () { if (!gone && location.pathname === here) location.href = ref.href; }, 800);
    } else {
      location.href = prefix() + '/';
    }
  }

  function toolSession() {
    var v = S ? S.get('ui', TOOL_KEY) : null;
    if (!v || !v.path) return null;
    if (Date.now() - (v.since || 0) > MAX_AGE) { unpark(); return null; }
    return v;
  }
  function slugOf(path) {
    var m = /^\/tools\/([^/]+)\//.exec(path || '');
    return m ? m[1] : '';
  }
  function urlTail() {
    var hash = location.hash;
    if (hash && new URLSearchParams(hash.slice(1)).has('cmd')) hash = '';
    return location.search + hash;
  }
  function parkedHref(ps) {
    var tail = typeof ps.tail === 'string' ? ps.tail : '';
    var first = tail.charAt(0);
    if (first !== '?' && first !== '#') tail = ps.id ? '?id=' + encodeURIComponent(ps.id) : '';
    return prefix() + ps.path + tail;
  }
  function minimizeTool() {
    if (!S) return;
    var id = new URLSearchParams(location.search).get('id') || '';
    var nameEl = document.querySelector('.terminal-frame__filename');
    var ps = {
      path: bare(location.pathname),
      id: id,
      tail: urlTail(),
      name: (nameEl && nameEl.textContent.trim()) || document.title,
      since: Date.now()
    };
    var detail = {};
    try { document.dispatchEvent(new CustomEvent('mentria:minimize', { detail: detail })); } catch (_) {}
    if (detail.value) ps.value = String(detail.value);
    if (detail.label) ps.label = String(detail.label);
    if (detail.paused) ps.paused = true;
    S.set('ui', TOOL_KEY, ps);
    leave();
  }
  function unpark() {
    if (S) S.remove('ui', TOOL_KEY);
    if (parked) { parked.remove(); parked = null; }
    tidyDock();
  }
  function isHere(ps) {
    if (bare(location.pathname) !== ps.path) return false;
    return !ps.id || new URLSearchParams(location.search).get('id') === ps.id;
  }
  function parkedName(ps) {
    if (!ps.id && window.MentriaUI && typeof window.MentriaUI.toolTitle === 'function') {
      var title = window.MentriaUI.toolTitle(slugOf(ps.path));
      if (title) return title;
    }
    return ps.name || '';
  }

  function wakeWanted() {
    if (listening) return true;
    var ses = S ? S.get('ui', KEY) : null;
    return !!(ses && ses.kind === 'timer') && timerLive();
  }
  function holdWake() {
    if (wakeLock || wakePending || !navigator.wakeLock || document.visibilityState !== 'visible') return;
    wakePending = true;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakePending = false;
      if (!wakeWanted()) { lock.release().catch(function () {}); return; }
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
  function timerList() {
    var list = S ? S.get('tools', 'countdown_active') : null;
    return Array.isArray(list) ? list.filter(function (e) { return e && typeof e === 'object'; }) : [];
  }
  function runEntries(list) {
    return list.filter(function (e) { return e.mode === 'run' && typeof e.endAt === 'number'; })
      .sort(function (a, b) { return a.endAt - b.endAt; });
  }
  function timerLabel(e) {
    return (e && e.title) || copy('timer', 'Timer');
  }
  function timerLive() {
    var now = Date.now();
    return runEntries(timerList()).some(function (e) { return e.endAt > now; });
  }
  function timerView() {
    var list = timerList();
    if (!list.length) return null;
    var now = Date.now();
    var running = runEntries(list);
    var shown = null;
    if (ringing) {
      shown = running.filter(function (e) { return e.endAt === ringing.endAt; })[0] || null;
      if (!shown) silence();
    }
    if (!shown) shown = running.filter(function (e) { return e.endAt > now; })[0] || running[running.length - 1] || null;
    if (shown) {
      var left = (shown.endAt - now) / 1000;
      return { value: left > 0 ? fmtClock(left) : copy('timesUp', "Time's up"), label: timerLabel(shown), done: left <= 0 };
    }
    var paused = list.filter(function (e) { return e.mode === 'pause'; })[0];
    if (paused) return { value: fmtClock(paused.remaining), label: timerLabel(paused) + ' · ' + copy('paused', 'Paused') };
    return null;
  }
  function dueAlarm(ses) {
    var now = Date.now();
    var since = Math.max(typeof ses.rang === 'number' ? ses.rang : 0, rangAt);
    var hit = null;
    runEntries(timerList()).forEach(function (e) { if (e.endAt <= now && e.endAt > since) hit = e; });
    if (!hit) return null;
    rangAt = hit.endAt;
    ses.rang = hit.endAt;
    if (S) S.set('ui', KEY, ses);
    return now - hit.endAt <= RING_FRESH ? hit : null;
  }
  function armEnd() {
    clearTimeout(endTimer);
    endTimer = 0;
    var now = Date.now();
    var next = runEntries(timerList()).filter(function (e) { return e.endAt > now; })[0];
    if (!next) return;
    endTimer = setTimeout(function () {
      endTimer = 0;
      render();
      armEnd();
    }, Math.min(next.endAt - now + 25, 2147483647));
  }

  function audioCtx() {
    if (audio) return audio;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try { audio = new C(); } catch (_) { audio = null; }
    return audio;
  }
  function tones(ctx) {
    var dur = 0.15, gap = 0.08;
    for (var i = 0; i < 4; i++) {
      var t = ctx.currentTime + i * (dur + gap);
      [[880, 440, 0.4], [1760, 880, 0.2]].forEach(function (p) {
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(p[0], t);
        osc.frequency.exponentialRampToValueAtTime(p[1], t + dur);
        g.gain.setValueAtTime(p[2], t);
        g.gain.exponentialRampToValueAtTime(0.01, t + dur);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur);
      });
    }
  }
  function buzz() {
    if (!navigator.vibrate || !navigator.userActivation || !navigator.userActivation.hasBeenActive) return;
    try { navigator.vibrate([200, 100, 200]); } catch (_) {}
  }
  function bell() {
    buzz();
    var ctx = audioCtx();
    if (!ctx) return;
    if (ctx.state === 'running') { tones(ctx); return; }
    if (resuming) return;
    resuming = true;
    ctx.resume().then(function () {
      if (ctx !== audio) return;
      resuming = false;
      if (ringing && ctx.state === 'running') tones(ctx);
    }, function () { if (ctx === audio) resuming = false; });
  }
  function armUnlock(on) {
    if (on && unlocked) return;
    if (on === unlockOn) return;
    unlockOn = on;
    UNLOCK_EVENTS.forEach(function (type) {
      if (on) window.addEventListener(type, unlock, true);
      else window.removeEventListener(type, unlock, true);
    });
  }
  function unlock() {
    var ctx = audioCtx();
    if (!ctx) { armUnlock(false); return; }
    var settle = function () {
      if (ctx !== audio || ctx.state !== 'running') return;
      unlocked = true;
      armUnlock(false);
      if (!ringing) ctx.suspend().catch(function () {});
    };
    if (ctx.state === 'running') { settle(); return; }
    ctx.resume().then(settle, function () {});
  }
  function alarmTitle() {
    return copy('alarmTitle', copy('timesUp', "Time's up"));
  }
  function notifyEnd(e, label) {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.showNotification(copy('notifTitle', '{label}').split('{label}').join(label), {
        body: copy('notifBody', ''),
        icon: '/assets/img/icon-192x192.png',
        badge: '/assets/img/badge.svg',
        vibrate: [200, 100, 200],
        tag: 'mentria-timer-' + (e.id != null ? e.id : 'mini'),
        renotify: true,
        requireInteraction: true,
        data: { url: location.pathname, timerId: e.id != null ? e.id : null },
        actions: [{ action: 'stop-alarm', title: copy('stopAlarm', 'Stop alarm') }]
      });
    }).catch(function () {});
  }
  function liftToast(t) {
    if (!t || !dock || typeof t.getBoundingClientRect !== 'function') return;
    var a = t.getBoundingClientRect();
    var b = dock.getBoundingClientRect();
    if (a.right <= b.left || a.left >= b.right || a.top >= b.bottom || a.bottom <= b.top - 8) return;
    var base = parseFloat(getComputedStyle(t).bottom) || 0;
    t.style.bottom = Math.ceil(base + a.bottom - b.top + 8) + 'px';
  }
  function alarm(e) {
    var label = timerLabel(e);
    if (window.MentriaUI) liftToast(window.MentriaUI.toast(label + ' · ' + copy('timesUp', "Time's up"), { duration: 5000 }));
    notifyEnd(e, label);
    if (window.MentriaPush && e.id != null) window.MentriaPush.cancel('ct-' + e.id);
    if (titleBefore === null) titleBefore = document.title;
    titleShown = alarmTitle();
    document.title = titleShown;
    armUnlock(true);
    clearInterval(ringTimer);
    bell();
    ringTimer = setInterval(bell, RING_EVERY);
  }
  function silence() {
    if (!ringing) return;
    ringing = null;
    clearInterval(ringTimer);
    ringTimer = 0;
    if (audio && audio.state === 'running') audio.suspend().catch(function () {});
    if (titleBefore !== null) {
      if (document.title === titleShown) document.title = titleBefore;
      titleBefore = null;
    }
  }
  function dismiss() {
    if (!ringing) { stop(); return; }
    silence();
    if (timerLive()) render();
    else stop();
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
    var fmt = copy('steps', '{n} steps');
    var lang = document.documentElement.lang || undefined;
    var paused = needsGesture() && !sawMotion && !granted && !probing;
    return { value: fmt.replace('{n}', n.toLocaleString(lang)), label: paused ? copy('tapResume', 'Tap to keep counting') : '', paused: paused };
  }

  function toolName(kind) {
    return kind === 'timer' ? copy('timerTool', 'Countdown Timer') : copy('stepsTool', 'Step Counter');
  }
  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }
  function iconFor(slug) {
    var icon = document.createElement('span');
    icon.className = 'm-mini__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = '<svg viewBox="0 0 48 48" focusable="false"><use href="#tool-' + slug + '"></use></svg>';
    if (!document.getElementById('tool-' + slug) && window.MentriaToolsPopup) window.MentriaToolsPopup.load();
    return icon;
  }
  function closeButton(onClose) {
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'm-mini__close';
    close.setAttribute('aria-label', copy('close', 'Close'));
    close.textContent = '×';
    close.addEventListener('click', onClose);
    return close;
  }

  function render() {
    var ses = session();
    if (!ses) { silence(); if (pill) { pill.remove(); pill = null; tidyDock(); } return; }
    var fresh = ses.kind === 'timer' ? dueAlarm(ses) : null;
    if (fresh) ringing = fresh;
    var view = ses.kind === 'timer' ? timerView() : stepsView();
    if (!view) { stop(); return; }
    if (pill && pill.getAttribute('data-kind') !== ses.kind) { pill.remove(); pill = null; }
    if (!pill) build(ses);
    var groupName = toolName(ses.kind);
    if (pill.getAttribute('aria-label') !== groupName) pill.setAttribute('aria-label', groupName);
    setText(pill.querySelector('.m-mini__value'), view.value);
    var label = pill.querySelector('.m-mini__label');
    setText(label, view.label || '');
    label.hidden = !view.label;
    pill.classList.toggle('is-done', !!view.done);
    pill.classList.toggle('is-paused', !!view.paused);
    var name = copy('open', 'Open {name}').replace('{name}', toolName(ses.kind)) + ' · ' + view.value + (view.label ? ' · ' + view.label : '');
    var open = pill.querySelector('.m-mini__open');
    if (open.getAttribute('aria-label') !== name) open.setAttribute('aria-label', name);
    var close = pill.querySelector('.m-mini__close');
    var closeName = ringing ? copy('stopAlarm', 'Stop alarm') : copy('close', 'Close');
    if (close.getAttribute('aria-label') !== closeName) close.setAttribute('aria-label', closeName);
    if (ses.kind === 'timer') {
      if (timerLive()) holdWake();
      else releaseWake();
    }
    if (fresh) alarm(fresh);
  }
  function renderParked() {
    var ps = toolSession();
    if (!ps) { if (parked) { parked.remove(); parked = null; tidyDock(); } return; }
    if (isHere(ps)) { unpark(); return; }
    if (parked && parked.getAttribute('data-key') !== ps.path + '#' + ps.id) { parked.remove(); parked = null; }
    if (!parked) buildParked(ps);
    var name = parkedName(ps);
    var sub = [ps.label || '', ps.paused ? copy('paused', 'Paused') : ''].filter(Boolean).join(' · ');
    setText(parked.querySelector('.m-mini__value'), ps.value || name);
    var subEl = parked.querySelector('.m-mini__label');
    setText(subEl, sub);
    subEl.hidden = !sub;
    parked.classList.toggle('is-paused', !!ps.paused);
    parked.setAttribute('aria-label', name);
    var open = parked.querySelector('.m-mini__open');
    var label = copy('open', 'Open {name}').replace('{name}', name) + (ps.value ? ' · ' + ps.value : '') + (sub ? ' · ' + sub : '');
    if (open.getAttribute('aria-label') !== label) open.setAttribute('aria-label', label);
    var close = parked.querySelector('.m-mini__close');
    var closeName = copy('close', 'Close');
    if (close.getAttribute('aria-label') !== closeName) close.setAttribute('aria-label', closeName);
  }

  function applyPos() {
    if (!dock) return;
    var p = S ? S.get('ui', POS_KEY) : null;
    dock.classList.toggle('is-left', !!(p && p.side === 'left'));
    if (p && typeof p.y === 'number' && p.y > 0) dock.style.setProperty('--mini-y', p.y + 'px');
    else dock.style.removeProperty('--mini-y');
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
  function ensureDock() {
    if (!dock) {
      dock = document.createElement('div');
      dock.className = 'm-mini-dock';
      draggable(dock);
      document.body.appendChild(dock);
      applyPos();
    }
    return dock;
  }
  function tidyDock() {
    if (dock && !dock.children.length) { dock.remove(); dock = null; }
  }
  function build(ses) {
    pill = document.createElement('div');
    pill.className = 'm-mini';
    pill.setAttribute('data-kind', ses.kind);
    pill.setAttribute('role', 'group');
    pill.setAttribute('aria-label', toolName(ses.kind));
    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'm-mini__open';
    var text = document.createElement('span');
    text.className = 'm-mini__text';
    var value = document.createElement('span');
    value.className = 'm-mini__value';
    var label = document.createElement('span');
    label.className = 'm-mini__label';
    text.append(value, label);
    open.append(iconFor(ses.kind === 'timer' ? 'countdown-timer' : 'step-counter'), text);
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
    pill.append(open, closeButton(dismiss));
    ensureDock().appendChild(pill);
  }
  function buildParked(ps) {
    parked = document.createElement('div');
    parked.className = 'm-mini m-mini--tool';
    parked.setAttribute('data-key', ps.path + '#' + ps.id);
    parked.setAttribute('role', 'group');
    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'm-mini__open';
    var text = document.createElement('span');
    text.className = 'm-mini__text';
    var value = document.createElement('span');
    value.className = 'm-mini__value';
    var sub = document.createElement('span');
    sub.className = 'm-mini__label';
    sub.hidden = true;
    text.append(value, sub);
    open.append(iconFor(ps.id ? 'extensions' : slugOf(ps.path)), text);
    open.addEventListener('click', function () {
      var cur = toolSession();
      if (!cur) { renderParked(); return; }
      location.href = parkedHref(cur);
    });
    parked.append(open, closeButton(unpark));
    var host = ensureDock();
    host.insertBefore(parked, host.firstChild);
  }

  function boot() {
    clearInterval(tickTimer);
    tickTimer = 0;
    renderParked();
    var ses = session();
    if (!ses) { if (pill) { pill.remove(); pill = null; tidyDock(); } return; }
    if (bare(location.pathname) === ses.url) { stop(); return; }
    if (ses.kind === 'timer') {
      if (timerLive()) armUnlock(true);
      armEnd();
    }
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
    tickTimer = setInterval(function () { if (ses.kind === 'timer' || document.visibilityState === 'visible') render(); }, 1000);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-mini="tool"]');
    if (!btn) return;
    e.preventDefault();
    minimizeTool();
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !dock) return;
    render();
    renderParked();
    if (wakeWanted()) holdWake();
  });
  document.addEventListener('mentria:localechange', function () {
    if (!dock) return;
    render();
    renderParked();
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) boot(); });
  window.addEventListener('pagehide', silence);
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) {
      if (!ringing || !e.data || e.data.type !== 'STOP_ALARM') return;
      silence();
      render();
    });
  } catch (_) {}

  window.MentriaMini = { start: start, stop: stop, leave: leave, active: session, minimizeTool: minimizeTool };
  boot();
})();
