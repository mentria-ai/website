const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(h, profile, root) {
  let mh = 0, mp = 0;
  for (let i = 0; i < 12; i++) { mh += h[i]; mp += profile[i]; }
  mh /= 12;
  mp /= 12;
  let num = 0, dh = 0, dp = 0;
  for (let i = 0; i < 12; i++) {
    const a = h[i] - mh, b = profile[(i - root + 12) % 12] - mp;
    num += a * b;
    dh += a * a;
    dp += b * b;
  }
  return dh > 0 && dp > 0 ? num / Math.sqrt(dh * dp) : 0;
}

export function relativeOf(key) {
  return key.mode === 'major' ? { root: (key.root + 9) % 12, mode: 'minor' } : { root: (key.root + 3) % 12, mode: 'major' };
}

export function createKeyFinder() {
  const hist = new Float64Array(12);
  const st = new Float64Array(2);
  let lastPc = -1;
  const k = {};

  k.add = (pitchHz, clarity, seconds) => {
    if (!(pitchHz > 0) || clarity < 0.85) { lastPc = -1; st[1] = 0; return; }
    const pc = ((Math.round(69 + 12 * Math.log2(pitchHz / 440)) % 12) + 12) % 12;
    if (pc === lastPc) st[1] += seconds;
    else { lastPc = pc; st[1] = seconds; }
    hist[pc] += clarity * seconds * (st[1] >= 0.1 ? 2 : 1);
    st[0] += seconds;
  };

  k.voicedSeconds = () => st[0];

  k.result = () => {
    const scores = [];
    for (let root = 0; root < 12; root++) {
      scores.push({ root, mode: 'major', r: pearson(hist, MAJOR, root) });
      scores.push({ root, mode: 'minor', r: pearson(hist, MINOR, root) });
    }
    scores.sort((a, b) => b.r - a.r);
    const best = scores[0];
    const rel = relativeOf(best);
    const other = scores.find((s) => !(s.root === best.root && s.mode === best.mode) && !(s.root === rel.root && s.mode === rel.mode));
    let confidence = 'none';
    if (st[0] >= 5 && best.r >= 0.5) confidence = best.r >= 0.75 && best.r - other.r >= 0.1 ? 'strong' : 'likely';
    return { key: { root: best.root, mode: best.mode }, relative: rel, r: best.r, confidence };
  };

  k.reset = () => {
    hist.fill(0);
    st.fill(0);
    lastPc = -1;
  };

  return k;
}
