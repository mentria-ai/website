export function createHowlGuard() {
  const st = new Float64Array(3);
  const T = 0, L0 = 1, P0 = 2;
  const g = { armed: false, monitorDb: -60, tripped: false };

  g.update = (voiced, clarity, pitch, level, seconds) => {
    if (!g.armed || g.tripped || g.monitorDb <= -30 || !voiced || clarity < 0.95 || !(pitch > 0)) {
      st[T] = 0;
      return false;
    }
    if (st[T] === 0 || Math.abs(1200 * Math.log2(pitch / st[P0])) > 10 || st[T] > 1) {
      st[T] = seconds;
      st[L0] = level;
      st[P0] = pitch;
      return false;
    }
    st[T] += seconds;
    if (st[T] >= 0.25 && level - st[L0] >= 6) {
      g.tripped = true;
      return true;
    }
    return false;
  };

  g.reset = () => {
    g.tripped = false;
    st.fill(0);
  };

  return g;
}
