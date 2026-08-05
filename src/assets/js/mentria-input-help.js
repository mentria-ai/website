(function (global) {
  'use strict';

  var seen = { touch: false, keyboard: false, pointer: false, gamepad: false };

  function detect() {
    try {
      if (navigator.maxTouchPoints > 0 || ('ontouchstart' in global)) seen.touch = true;
      if (global.matchMedia && global.matchMedia('(pointer: fine)').matches) {
        seen.pointer = true;
        seen.keyboard = true;
      }
      var pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) seen.gamepad = true;
    } catch (_) {}
    if (!seen.touch && !seen.pointer && !seen.keyboard) seen.keyboard = true;
  }

  function apply() {
    var nodes = document.querySelectorAll('[data-input]');
    if (!nodes.length) return;
    var shown = 0;
    for (var i = 0; i < nodes.length; i++) {
      var kinds = (nodes[i].getAttribute('data-input') || '').split(/\s+/);
      var on = false;
      for (var k = 0; k < kinds.length; k++) if (seen[kinds[k]]) on = true;
      nodes[i].hidden = !on;
      if (on) shown++;
    }
    if (!shown) for (var j = 0; j < nodes.length; j++) nodes[j].hidden = false;
    try {
      document.dispatchEvent(new CustomEvent('mentria:inputhelp', { detail: { seen: seen, shown: shown } }));
    } catch (_) {}
  }

  function note(kind) {
    if (seen[kind]) return;
    seen[kind] = true;
    apply();
  }

  detect();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();

  global.addEventListener('gamepadconnected', function () { note('gamepad'); });
  global.addEventListener('gamepaddisconnected', function () {
    var pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) return;
    seen.gamepad = false;
    apply();
  });
  global.addEventListener('keydown', function (e) {
    if (e && (e.key === 'Tab' || e.key === 'Escape')) return;
    note('keyboard');
  }, { passive: true });
  global.addEventListener('touchstart', function () { note('touch'); }, { passive: true });
  global.addEventListener('pointerdown', function (e) {
    if (e && e.pointerType === 'touch') note('touch');
    else if (e && (e.pointerType === 'mouse' || e.pointerType === 'pen')) { note('pointer'); note('keyboard'); }
  }, { passive: true });

  global.MentriaInputHelp = { seen: seen, refresh: function () { detect(); apply(); }, note: note };
})(window);
