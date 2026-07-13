(function () {
  'use strict';

  var KEY = 'mentria_caps';
  var caps = {};
  try { caps = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { caps = {}; }
  window.MentriaCaps = caps;

  function apply() {
    document.documentElement.classList.toggle('mentria-no-motion', caps.motion === false);
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(caps)); } catch (_) {}
  }
  function settle(value) {
    caps.motion = value;
    apply();
    save();
  }
  apply();

  if (typeof DeviceMotionEvent === 'undefined') {
    settle(false);
  } else if (typeof DeviceMotionEvent.requestPermission === 'function') {
    settle(true);
  } else {
    var done = false;
    var onMotion = function (e) {
      var a = e.accelerationIncludingGravity || e.acceleration;
      if (!a || (a.x == null && a.y == null && a.z == null)) return;
      done = true;
      window.removeEventListener('devicemotion', onMotion);
      settle(true);
    };
    window.addEventListener('devicemotion', onMotion);
    setTimeout(function () {
      if (done) return;
      window.removeEventListener('devicemotion', onMotion);
      settle(false);
    }, 2000);
  }
})();
