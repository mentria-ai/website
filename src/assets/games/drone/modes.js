import { courseCheckpoints, gateCrossing } from './flight.js';

export function createRings(course) {
  const cps = courseCheckpoints(course);
  return {
    cps,
    passed: cps.map(() => false),
    count: 0,
    done: false,
    nearest: cps.length ? 0 : -1
  };
}

export function ringStep(rings, prevPos, pos) {
  let hit = -1;
  const cps = rings.cps;
  for (let i = 0; i < cps.length; i++) {
    if (rings.passed[i]) continue;
    const cp = cps[i];
    if (gateCrossing(cp, prevPos, pos) >= 0 || gateCrossing(cp, pos, prevPos) >= 0) {
      hit = i;
      break;
    }
  }
  if (hit >= 0) {
    rings.passed[hit] = true;
    rings.count++;
    rings.done = rings.count >= cps.length;
  }
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < cps.length; i++) {
    if (rings.passed[i]) continue;
    const p = cps[i].pos;
    const dx = p.x - pos.x;
    const dy = p.y - pos.y;
    const dz = p.z - pos.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  rings.nearest = best;
  return hit;
}
