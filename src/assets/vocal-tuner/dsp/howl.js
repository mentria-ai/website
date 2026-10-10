export function createHowlGuard() {
  const st = new Float64Array(5);
  const T = 0, L0 = 1, P0 = 2, S = 3, PS = 4;
  const g = { armed: false, monitorDb: -60, tripped: false };

  g.update = (voiced, clarity, pitch, level, seconds) => {
    if (!g.armed || g.tripped || g.monitorDb <= -30 || !voiced || clarity < 0.95 || !(pitch > 0)) {
      st[T] = 0;
      st[S] = 0;
      return false;
    }
    const pure = clarity >= 0.98 && level >= -40;
    if (pure && st[S] > 0 && Math.abs(1200 * Math.log2(pitch / st[PS])) <= 2) {
      st[S] += seconds;
      if (st[S] >= 2) {
        g.tripped = true;
        return true;
      }
    } else {
      st[S] = pure ? seconds : 0;
      st[PS] = pitch;
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
