(function (global) {
  'use strict';
  var BASE = 'https://relay.mentria.ai/push';
  var vapidKey = null;
  var armed = new Map();   // callerId -> { spec, scheduleId, posted }

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in global && 'Notification' in global;
  }
  function permission() { return supported() ? Notification.permission : 'denied'; }

  function newId() {
    var b = crypto.getRandomValues(new Uint8Array(16)), s = '';
    for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
  }
  function urlB64ToU8(base64) {
    var pad = '='.repeat((4 - base64.length % 4) % 4);
    var b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b64), out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  async function getVapid() {
    if (vapidKey) return vapidKey;
    var r = await fetch(BASE + '/vapid-public', { cache: 'no-store' });
    vapidKey = (await r.json()).publicKey;
    return vapidKey;
  }
  async function getSubscription() {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (sub) return sub;
    var key = await getVapid();
    return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(key) });
  }
  function subJson(sub) {
    var j = sub.toJSON();
    return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
  }

  async function requestPermission() {
    if (!supported()) return false;
    var perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    try { await getSubscription(); return true; } catch (_) { return false; }
  }

  async function postSchedule(entry) {
    var sub = await getSubscription();
    var body = {
      subscription: subJson(sub),
      fireAt: entry.spec.fireAt,
      scheduleId: entry.scheduleId,
      fallbackTitle: 'Mentria'
    };
    var r = await fetch(BASE + '/schedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true
    });
    if (r.ok) entry.posted = true;
  }
  async function deleteSchedule(scheduleId) {
    try { await fetch(BASE + '/schedule/' + scheduleId, { method: 'DELETE' }); } catch (_) {}
  }

  async function schedule(spec) {
    if (!supported() || Notification.permission !== 'granted') return false;
    if (typeof spec.fireAt !== 'number' || spec.fireAt <= Date.now() + 1000) return false;
    var entry = armed.get(spec.id);
    var scheduleId = entry ? entry.scheduleId : newId();
    entry = { spec: spec, scheduleId: scheduleId, posted: entry ? entry.posted : false };
    armed.set(spec.id, entry);
    try {
      await global.MentriaPushDB.putPending({
        scheduleId: scheduleId, callerId: spec.id, title: spec.title, body: spec.body || '',
        url: spec.url || '/', tag: spec.tag || scheduleId, icon: spec.icon || null, actions: spec.actions || null
      });
      if (document.hidden && spec.fireAt > Date.now() + 10000) await postSchedule(entry);
    } catch (_) {}
    return true;
  }

  async function cancel(callerId) {
    var entry = armed.get(callerId);
    if (entry) {
      armed.delete(callerId);
      try {
        await global.MentriaPushDB.deletePending(entry.scheduleId);
        if (entry.posted) await deleteSchedule(entry.scheduleId);
      } catch (_) {}
      return;
    }
    try {
      var all = await global.MentriaPushDB.allPending();
      for (var i = 0; i < all.length; i++) {
        if (all[i].callerId === callerId) {
          await global.MentriaPushDB.deletePending(all[i].scheduleId);
          await deleteSchedule(all[i].scheduleId);
        }
      }
    } catch (_) {}
  }

  function onHidden() {
    armed.forEach(function (entry) {
      if (!entry.posted && entry.spec.fireAt > Date.now() + 10000) postSchedule(entry).catch(function () {});
    });
  }
  function onVisible() {
    armed.forEach(function (entry) {
      if (entry.posted) { deleteSchedule(entry.scheduleId).then(function () { entry.posted = false; }); }
    });
  }
  if (supported()) {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) onHidden(); else onVisible();
    });
    global.addEventListener('pagehide', onHidden);
  }

  global.MentriaPush = {
    isSupported: supported, permission: permission, requestPermission: requestPermission,
    schedule: schedule, cancel: cancel
  };
})(typeof window !== 'undefined' ? window : self);
