const holds = new Set();
const GESTURES = ['pointerup', 'keydown', 'click'];
let lock = null;
let pending = false;
let retryArmed = false;

function wanted() {
  return holds.size > 0;
}

function retryOnGesture() {
  if (retryArmed || typeof window === 'undefined') return;
  retryArmed = true;
  const again = () => {
    for (const g of GESTURES) window.removeEventListener(g, again, true);
    retryArmed = false;
    grab();
  };
  for (const g of GESTURES) window.addEventListener(g, again, true);
}

function grab() {
  if (lock || pending || !wanted() || typeof navigator === 'undefined' || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  pending = true;
  navigator.wakeLock.request('screen').then((l) => {
    pending = false;
    if (!wanted()) {
      l.release().catch(() => {});
      return;
    }
    lock = l;
    l.addEventListener('release', () => { if (lock === l) lock = null; });
  }, () => {
    pending = false;
    if (wanted()) retryOnGesture();
  });
}

function drop() {
  if (!lock) return;
  const l = lock;
  lock = null;
  l.release().catch(() => {});
}

export function holdAwake() {
  const token = {};
  holds.add(token);
  grab();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holds.delete(token);
    if (!wanted()) drop();
  };
}

export function awakeHolds() {
  return holds.size;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') grab(); });
}
