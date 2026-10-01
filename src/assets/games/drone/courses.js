export const GATE_SIZES = {
  square: [3.2, 2.8],
  arch: [4, 3.4],
  flag: [4.5, 3.6],
  pylon: [6, 6],
  finish: [7, 4.6],
};

export const CONTAINER_SIZE = [12.2, 2.59, 2.44];

function ground(heightAt, x, z) {
  return heightAt ? heightAt(x, z) : 0;
}

function box(cx, cy, cz, hx, hy, hz, yaw) {
  return { type: 'box', center: { x: cx, y: cy, z: cz }, half: { x: hx, y: hy, z: hz }, yaw: yaw || 0 };
}

function local(x, z, yaw, lx, lz) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [x + lx * c + lz * s, z - lx * s + lz * c];
}

export function gateColliders(gates, heightAt) {
  const out = [];
  for (const g of gates) {
    const [x, y, z] = g.pos;
    const yaw = g.yaw || 0;
    const hw = g.w / 2, hh = g.h / 2;
    const gy = ground(heightAt, x, z);
    const top = y + hh;
    if (g.type === 'pylon' || g.type === 'flag') {
      const sides = g.type === 'flag' ? [-1, 1] : [g.side === 'left' ? -1 : 1];
      for (const sd of sides) {
        const [px, pz] = local(x, z, yaw, sd * (hw + 0.3), 0);
        out.push({ type: 'cyl', x: px, z: pz, radius: g.type === 'pylon' ? 0.55 : 0.12, y0: ground(heightAt, px, pz) - 1, y1: top + 1.2 });
      }
      continue;
    }
    if (g.pitch) continue;
    const t = g.type === 'square' ? 0.32 : 0.45;
    for (const sd of [-1, 1]) {
      const [px, pz] = local(x, z, yaw, sd * (hw + t / 2), 0);
      const py0 = ground(heightAt, px, pz) - 0.5;
      out.push(box(px, (py0 + top + t) / 2, pz, t / 2, (top + t - py0) / 2, t / 2, yaw));
    }
    out.push(box(x, top + t / 2, z, hw + t, t / 2, t / 2, yaw));
    const bottom = y - hh;
    if (bottom - gy > 0.6) out.push(box(x, bottom - t / 2, z, hw + t, t / 2, t / 2, yaw));
  }
  return out;
}

export function sceneryColliders(scenery, heightAt) {
  const out = [];
  const sc = scenery || {};
  for (const c of sc.containers || []) {
    const [x, z, yawDeg, stack] = c;
    const n = stack || 1;
    const yaw = (yawDeg || 0) * Math.PI / 180;
    const gy = ground(heightAt, x, z);
    out.push(box(x, gy + (CONTAINER_SIZE[1] * n) / 2, z, CONTAINER_SIZE[0] / 2, (CONTAINER_SIZE[1] * n) / 2, CONTAINER_SIZE[2] / 2, yaw));
  }
  for (const b of sc.warehouses || []) {
    const yaw = (b.yaw || 0) * Math.PI / 180;
    const gy = ground(heightAt, b.x, b.z);
    const t = 0.5;
    const hw = b.w / 2, hd = b.d / 2;
    const walls = [
      ['n', 0, -hd, hw, true],
      ['s', 0, hd, hw, true],
      ['w', -hw, 0, hd, false],
      ['e', hw, 0, hd, false],
    ];
    for (const [side, lx, lz, half, alongX] of walls) {
      const door = (b.doors || []).find((d) => d.side === side);
      const segs = door ? [[-half, -door.w / 2], [door.w / 2, half]] : [[-half, half]];
      for (const [a0, a1] of segs) {
        const mid = (a0 + a1) / 2, len = (a1 - a0) / 2;
        const [cx, cz] = alongX ? local(b.x, b.z, yaw, lx + mid, lz) : local(b.x, b.z, yaw, lx, lz + mid);
        out.push(box(cx, gy + b.h / 2, cz, alongX ? len : t / 2, b.h / 2, alongX ? t / 2 : len, yaw));
      }
      if (door) {
        const [cx, cz] = local(b.x, b.z, yaw, lx, lz);
        out.push(box(cx, gy + (door.h + b.h) / 2, cz, alongX ? door.w / 2 : t / 2, (b.h - door.h) / 2, alongX ? t / 2 : door.w / 2, yaw));
      }
    }
    out.push(box(b.x, gy + b.h + 0.3, b.z, hw + 0.5, 0.6, hd + 0.5, yaw));
  }
  for (const k of sc.cranes || []) {
    const yaw = (k.yaw || 0) * Math.PI / 180;
    const gy = ground(heightAt, k.x, k.z);
    if (k.kind === 'tower') {
      out.push(box(k.x, gy + k.h / 2, k.z, 1.1, k.h / 2, 1.1, yaw));
      const [jx, jz] = local(k.x, k.z, yaw, 0, -k.span / 2 + 6);
      out.push(box(jx, gy + k.h + 1, jz, 0.8, 1, k.span / 2 + 6, yaw));
      continue;
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const [lx, lz] = local(k.x, k.z, yaw, sx * k.span / 2, sz * 5);
      out.push(box(lx, gy + k.h / 2, lz, 0.6, k.h / 2, 0.6, yaw));
    }
    for (const sz of [-1, 1]) {
      const [lx, lz] = local(k.x, k.z, yaw, 0, sz * 5);
      out.push(box(lx, gy + k.h - 0.8, lz, k.span / 2 + 0.6, 0.9, 0.7, yaw));
    }
  }
  for (const l of sc.lights || []) {
    const [x, z] = l;
    const gy = ground(heightAt, x, z);
    out.push({ type: 'cyl', x, z, radius: 0.18, y0: gy - 0.5, y1: gy + 10 });
  }
  for (const f of sc.flags || []) {
    const [x, z] = f;
    out.push({ type: 'cyl', x, z, radius: 0.1, y0: ground(heightAt, x, z) - 0.5, y1: ground(heightAt, x, z) + 5 });
  }
  return out;
}

export const COURSES = [
  {
    id: 'meadow',
    nameKey: 'tool.fpv-drone.course.meadow',
    kind: 'race',
    env: {preset: 'golden', terrain: {shape: 'hills', seed: 11, size: 1200, height: 32, flatten: [{x: 0, z: 20, radius: 70, height: 4, falloff: 150}]}, backdrop: 'forest-hills'},
    start: {pos: [0, 4.2, 40], yaw: 0},
    gates: [
      {pos: [0, 9.6, -50], yaw: 0.256, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-45, 2.8, -130], yaw: 0.798, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-130, -2.5, -175], yaw: 1.513, w: 4.5, h: 3.6, type: 'flag'},
      {pos: [-220, 1.4, -140], yaw: 2.31, w: 4, h: 3.4, type: 'arch'},
      {pos: [-265, 5.6, -50], yaw: 3.008, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-245, 6, 50], yaw: -2.669, w: 6, h: 6, type: 'pylon', side: 'left'},
      {pos: [-180, 8, 120], yaw: -2.104, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-100, 5.3, 140], yaw: -1.947, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-10, 13.7, 190], yaw: -1.634, w: 4, h: 3.4, type: 'arch'},
      {pos: [90, 5.9, 150], yaw: -0.434, w: 4.5, h: 3.6, type: 'flag'},
      {pos: [70, 9.8, 90], yaw: 0.561, w: 6, h: 6, type: 'pylon', side: 'left'},
      {pos: [0, 9, 22], yaw: 0, w: 7, h: 4.6, type: 'arch', finish: true},
    ],
    medals: {gold: 49, silver: 59, bronze: 72.6},
    botTime: 45.4,
    scenery: {
      scatter: [
        {kind: 'pine', count: 260, area: [-560, -560, 560, -235], seed: 11},
        {kind: 'pine', count: 200, area: [-560, 245, 560, 560], seed: 12},
        {kind: 'oak', count: 140, area: [-560, -235, -300, 245], seed: 13},
        {kind: 'oak', count: 120, area: [190, -235, 560, 245], seed: 14},
        {kind: 'bush', count: 90, area: [-300, -230, 190, 240], seed: 15},
        {kind: 'rock', count: 45, area: [-420, -320, 320, 320], seed: 16},
      ],
      flags: [[6, 30, 0], [-6, 30, 1], [8, -52, 2], [-138, -168, 3], [-96, 128, 0], [-4, 199, 1], [96, 141, 2]],
      avoid: [[0, 40, 12], [1, 11, 12], [2, -19, 12], [0, -49, 12], [-11, -76, 12], [-26, -102, 12], [-42, -127, 12], [-66, -145, 12], [-92, -160, 12], [-119, -173, 12], [-148, -172, 12], [-176, -162, 12], [-204, -150, 12], [-227, -132, 12], [-241, -106, 12], [-255, -79, 12], [-265, -51, 12], [-263, -22, 12], [-257, 8, 12], [-250, 37, 12], [-236, 63, 12], [-216, 86, 12], [-196, 107, 12], [-171, 124, 12], [-142, 130, 12], [-113, 136, 12], [-85, 147, 12], [-60, 164, 12], [-35, 180, 12], [-8, 190, 12], [21, 184, 12], [50, 174, 12], [77, 162, 12], [92, 140, 12], [81, 112, 12], [67, 85, 12], [44, 66, 12], [20, 48, 12], [-1, 27, 12]],
    },
  },
  {
    id: 'yard',
    nameKey: 'tool.fpv-drone.course.yard',
    kind: 'race',
    env: {preset: 'day', terrain: {shape: 'flat', seed: 4, size: 900, height: 6, flatten: [{x: 0, z: 0, radius: 300, height: 0, falloff: 80}]}, backdrop: 'mountains'},
    start: {pos: [0, 0.2, 160], yaw: 0},
    gates: [
      {pos: [0, 5, 75], yaw: 0, w: 3.2, h: 2.8, type: 'square'},
      {pos: [0, 5, -40], yaw: 0, w: 3.2, h: 2.8, type: 'square'},
      {pos: [6, 5.5, -112], yaw: 0.11, w: 4, h: 3.4, type: 'arch'},
      {pos: [-20, 14, -195], yaw: 0, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-34, 5, -172], yaw: 3.142, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-75, 5, -120], yaw: 2.647, w: 4.5, h: 3.6, type: 'flag'},
      {pos: [-100, 5, -45], yaw: 2.981, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-100, 5, 35], yaw: 3.075, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-110, 5, 110], yaw: -2.944, w: 6, h: 6, type: 'pylon', side: 'left'},
      {pos: [-75, 5, 170], yaw: -2.581, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-40, 5, 222], yaw: -2.215, w: 4, h: 3.4, type: 'arch'},
      {pos: [10, 6, 238], yaw: -1.348, w: 3.2, h: 2.8, type: 'square'},
      {pos: [45, 5, 205], yaw: -0.097, w: 6, h: 6, type: 'pylon', side: 'left'},
      {pos: [0, 5, 142], yaw: 0, w: 7, h: 4.6, type: 'arch', finish: true},
    ],
    medals: {gold: 45.5, silver: 54.8, bronze: 67.4},
    botTime: 42.1,
    scenery: {
      warehouses: [
        {x: 0, z: -40, yaw: 0, w: 32, d: 64, h: 14, doors: [{side: 's', w: 12, h: 10}, {side: 'n', w: 12, h: 10}]},
      ],
      containers: [[-91, -58, 90, 1, 1], [-91, -45, 90, 2, 0], [-91, -32, 90, 3, 5], [-91, -19, 90, 1, 4], [-91, -6, 90, 2, 3], [-91, 7, 90, 3, 2], [-91, 20, 90, 1, 1], [-91, 33, 90, 2, 0], [-91, 46, 90, 3, 5], [-91, 59, 90, 1, 4], [-109, -58, 90, 1, 2], [-109, -45, 90, 2, 1], [-109, -32, 90, 3, 0], [-109, -19, 90, 1, 5], [-109, -6, 90, 2, 4], [-109, 7, 90, 3, 3], [-109, 20, 90, 1, 2], [-109, 33, 90, 2, 1], [-109, 46, 90, 3, 0], [-109, 59, 90, 1, 5], [-78, -30, 90, 1, 3], [-78, -17, 90, 2, 2], [-78, -4, 90, 3, 1], [-78, 9, 90, 1, 0], [-78, 22, 90, 2, 5], [-78, 35, 90, 3, 4], [-78, 48, 90, 1, 3], [-78, 61, 90, 2, 2], [-122, -58, 90, 1, 4], [-122, -45, 90, 2, 3], [-122, -32, 90, 3, 2], [-122, -19, 90, 1, 1], [-122, -6, 90, 2, 0], [-122, 7, 90, 3, 5], [-122, 20, 90, 1, 4], [-122, 33, 90, 2, 3], [-122, 46, 90, 3, 2], [-122, 59, 90, 1, 1], [48, -100, 90, 1, 5], [48, -87, 90, 2, 4], [48, -74, 90, 3, 3], [48, -61, 90, 1, 2], [48, -48, 90, 2, 1], [48, -35, 90, 3, 0], [48, -22, 90, 1, 5], [48, 17, 90, 1, 2], [48, 30, 90, 2, 1], [48, 43, 90, 3, 0], [48, 56, 90, 1, 5], [48, 69, 90, 2, 4], [48, 82, 90, 3, 3], [48, 95, 90, 1, 2], [62, -100, 90, 1, 0], [62, -87, 90, 2, 5], [62, -74, 90, 3, 4], [62, -61, 90, 1, 3], [62, -48, 90, 2, 2], [62, -35, 90, 3, 1], [62, -22, 90, 1, 0], [62, -9, 90, 2, 5], [62, 4, 90, 3, 4], [62, 17, 90, 1, 3], [62, 30, 90, 2, 2], [62, 43, 90, 3, 1], [62, 56, 90, 1, 0], [62, 69, 90, 2, 5], [62, 82, 90, 3, 4], [62, 95, 90, 1, 3], [90, -100, 90, 1, 1], [90, -87, 90, 2, 0], [90, -74, 90, 3, 5], [90, -61, 90, 1, 4], [90, -48, 90, 2, 3], [90, -35, 90, 3, 2], [90, -22, 90, 1, 1], [90, -9, 90, 2, 0], [90, 4, 90, 3, 5], [90, 17, 90, 1, 4], [90, 56, 90, 1, 1], [90, 69, 90, 2, 0], [90, 82, 90, 3, 5], [90, 95, 90, 1, 4], [104, -100, 90, 1, 2], [104, -87, 90, 2, 1], [104, -74, 90, 3, 0], [104, -61, 90, 1, 5], [104, -48, 90, 2, 4], [104, -35, 90, 3, 3], [104, -22, 90, 1, 2], [104, -9, 90, 2, 1], [104, 4, 90, 3, 0], [104, 17, 90, 1, 5], [104, 30, 90, 2, 4], [104, 43, 90, 3, 3], [104, 56, 90, 1, 2], [104, 69, 90, 2, 1], [104, 82, 90, 3, 0], [104, 95, 90, 1, 5]],
      cranes: [
        {kind: 'gantry', x: -75, z: 170, yaw: 0, h: 22, span: 40},
        {kind: 'tower', x: 70, z: -150, yaw: 30, h: 40, span: 50},
      ],
      lights: [[22, 100], [-22, 100], [22, -120], [-22, -120], [-140, -80], [-140, 0], [-140, 80], [130, -60], [130, 60], [18, 128], [-18, 128]],
      scatter: [
        {kind: 'pine', count: 120, area: [-400, -400, 400, -300], seed: 21},
        {kind: 'pine', count: 90, area: [-400, 300, 400, 400], seed: 22},
        {kind: 'bush', count: 40, area: [-260, -280, 260, 280], seed: 23},
      ],
      flags: [[8, 150, 0], [-8, 150, 1], [-36, -185, 2], [-118, 104, 3], [52, 214, 0]],
      avoid: [[0, 160, 12], [0, 131, 12], [0, 101, 12], [0, 71, 12], [0, 41, 12], [0, 11, 12], [0, -19, 12], [0, -49, 12], [4, -79, 12], [7, -109, 12], [-1, -137, 12], [-12, -165, 12], [-20, -193, 12], [-31, -186, 12], [-39, -158, 12], [-60, -138, 12], [-78, -114, 12], [-88, -86, 12], [-97, -57, 12], [-101, -27, 12], [-100, 3, 12], [-100, 33, 12], [-104, 62, 12], [-110, 92, 12], [-107, 121, 12], [-91, 146, 12], [-74, 171, 12], [-59, 197, 12], [-41, 221, 12], [-15, 234, 12], [14, 237, 12], [38, 220, 12], [43, 193, 12], [21, 172, 12], [1, 150, 12]],
    },
  },
  {
    id: 'canyon',
    nameKey: 'tool.fpv-drone.course.canyon',
    kind: 'race',
    env: {preset: 'sunset', terrain: {shape: 'canyon', seed: 5, size: 1400, height: 70, canyonWidth: 64}, backdrop: 'desert-mesas'},
    start: {pos: [142, 58.9, 330], yaw: 0.175},
    gates: [
      {pos: [126.3, 66.2, 290], yaw: 0.548, w: 3.2, h: 2.8, type: 'square'},
      {pos: [91.1, 62.3, 250], yaw: 0.902, w: 4, h: 3.4, type: 'arch'},
      {pos: [-21.8, 5.7, 190], yaw: 0.906, w: 3.2, h: 2.8, type: 'square', dive: true},
      {pos: [-84.5, 5.5, 120], yaw: 0.181, w: 4.5, h: 3.6, type: 'flag'},
      {pos: [-57.5, 10.2, 50], yaw: 0.002, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-84.9, 5, -20], yaw: 0.215, w: 4, h: 3.4, type: 'arch'},
      {pos: [-88.9, 18.2, -90], yaw: 0.24, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-115.9, 5.5, -150], yaw: 0.201, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-114.5, 5.9, -220], yaw: -0.046, w: 4.5, h: 3.6, type: 'flag'},
      {pos: [-109.4, 5.5, -290], yaw: -0.235, w: 6, h: 6, type: 'pylon', side: 'right'},
      {pos: [-84.2, 7.6, -350], yaw: -0.3, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-71.9, 5.1, -410], yaw: -0.202, w: 7, h: 4.6, type: 'arch', finish: true},
    ],
    medals: {gold: 40.3, silver: 48.5, bronze: 59.6},
    botTime: 37.3,
    scenery: {
      scatter: [
        {kind: 'cactus', count: 160, area: [-560, -560, 560, 560], seed: 31},
        {kind: 'rock', count: 140, area: [-560, -560, 560, 560], seed: 32},
        {kind: 'bush', count: 90, area: [-560, -560, 560, 560], seed: 33},
      ],
      flags: [[145, 322, 0], [139, 338, 1], [-78, -412, 2], [-66, -408, 3]],
      avoid: [[142, 330, 12], [133, 303, 12], [117, 277, 12], [98, 255, 12], [74, 239, 12], [50, 227, 12], [26, 216, 12], [2, 204, 12], [-22, 190, 12], [-44, 170, 12], [-65, 148, 12], [-84, 125, 12], [-79, 97, 12], [-64, 71, 12], [-58, 43, 12], [-70, 15, 12], [-83, -12, 12], [-87, -41, 12], [-87, -70, 12], [-91, -99, 12], [-105, -124, 12], [-116, -151, 12], [-117, -181, 12], [-115, -211, 12], [-114, -241, 12], [-112, -271, 12], [-106, -300, 12], [-94, -328, 12], [-82, -355, 12], [-77, -385, 12], [-71, -414, 12]],
    },
  },
  {
    id: 'freestyle',
    nameKey: 'tool.fpv-drone.course.freestyle',
    kind: 'freestyle',
    env: {preset: 'day', terrain: {shape: 'valley', seed: 3, size: 1800, height: 70, flatten: [{x: 0, z: 100, radius: 120, height: 0, falloff: 60}]}, backdrop: 'mountains'},
    start: {pos: [0, -0.8, 380], yaw: 0},
    gates: [
      {pos: [0, 6.3, 300], yaw: 0, w: 3.2, h: 2.8, type: 'square'},
      {pos: [0, 5, 150], yaw: 0, w: 3.2, h: 2.8, type: 'square'},
      {pos: [10, 5, 60], yaw: -0.266, w: 4, h: 3.4, type: 'arch'},
      {pos: [48, 11.8, -25], yaw: -0.051, w: 3.2, h: 2.8, type: 'square'},
      {pos: [20, 8.1, -110], yaw: 0.597, w: 6, h: 6, type: 'pylon', side: 'left'},
      {pos: [-40, 5.2, -160], yaw: 0.743, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-110, 9.3, -260], yaw: 0.466, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-150, 13.8, -380], yaw: -0.341, w: 3.2, h: 2.8, type: 'square'},
      {pos: [-40, 5.6, -450], yaw: -0.895, w: 4, h: 3.4, type: 'arch', dive: true},
      {pos: [30, 6.8, -520], yaw: -0.572, w: 4.5, h: 3.6, type: 'flag'},
      {pos: [60, 9.2, -600], yaw: -0.359, w: 3.2, h: 2.8, type: 'square'},
    ],
    medals: null,
    botTime: 41.5,
    scenery: {
      warehouses: [
        {x: 0, z: 150, yaw: 0, w: 30, d: 56, h: 14, doors: [{side: 's', w: 12, h: 10}, {side: 'n', w: 12, h: 10}]},
      ],
      containers: [[42, -60, 90, 1, 3], [42, -47, 90, 2, 2], [42, -34, 90, 3, 1], [42, -21, 90, 1, 0], [42, -8, 90, 2, 5], [42, 5, 90, 3, 4], [42, 18, 90, 1, 3], [54, -60, 90, 1, 4], [54, -47, 90, 2, 3], [54, -34, 90, 3, 2], [54, -21, 90, 1, 1], [54, -8, 90, 2, 0], [54, 5, 90, 3, 5], [54, 18, 90, 1, 4], [66, -60, 90, 1, 5], [66, -47, 90, 2, 4], [66, -34, 90, 3, 3], [66, -21, 90, 1, 2], [66, -8, 90, 2, 1], [66, 5, 90, 3, 0], [66, 18, 90, 1, 5]],
      cranes: [
        {kind: 'gantry', x: -40, z: -160, yaw: 30, h: 22, span: 36},
        {kind: 'tower', x: 70, z: 260, yaw: -20, h: 45, span: 55},
      ],
      lights: [[20, 200], [-20, 200], [20, 100], [-20, 100]],
      scatter: [
        {kind: 'pine', count: 420, area: [-860, -860, -120, 860], seed: 41},
        {kind: 'pine', count: 420, area: [120, -860, 860, 860], seed: 42},
        {kind: 'oak', count: 90, area: [-110, -800, 110, 800], seed: 43},
        {kind: 'rock', count: 120, area: [-860, -860, 860, 860], seed: 44},
        {kind: 'bush', count: 120, area: [-200, -800, 200, 800], seed: 45},
      ],
      flags: [[8, 372, 0], [-8, 372, 1], [26, 54, 2], [-46, -444, 3]],
      avoid: [[0, 380, 12], [0, 351, 12], [0, 321, 12], [0, 291, 12], [0, 261, 12], [0, 231, 12], [0, 201, 12], [0, 171, 12], [0, 141, 12], [3, 111, 12], [6, 82, 12], [12, 52, 12], [26, 26, 12], [40, -1, 12], [48, -29, 12], [41, -58, 12], [31, -86, 12], [18, -113, 12], [-5, -132, 12], [-29, -150, 12], [-49, -171, 12], [-67, -196, 12], [-84, -220, 12], [-101, -245, 12], [-115, -271, 12], [-127, -299, 12], [-138, -327, 12], [-148, -355, 12], [-149, -384, 12], [-126, -402, 12], [-99, -416, 12], [-73, -430, 12], [-47, -445, 12], [-24, -464, 12], [-2, -485, 12], [19, -506, 12], [36, -531, 12], [46, -559, 12], [55, -587, 12]],
    },
  },
];

export function courseById(id) {
  return COURSES.find((c) => c.id === id) || null;
}
