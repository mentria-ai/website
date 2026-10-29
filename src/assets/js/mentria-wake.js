const holds = new Set();
let lock = null;
let pending = false;

function wanted() {
  return holds.size > 0;
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
  }, () => { pending = false; });
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
