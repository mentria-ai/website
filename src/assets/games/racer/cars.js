export const CAR_PAINTS = [
  { id: 'crimson', hex: 0x9a0a14, metal: 0.55, rough: 0.34 },
  { id: 'sunburst', hex: 0xe2520c, metal: 0.45, rough: 0.32 },
  { id: 'saffron', hex: 0xf0aa06, metal: 0.4, rough: 0.32 },
  { id: 'lime', hex: 0x86c40e, metal: 0.45, rough: 0.32 },
  { id: 'mint', hex: 0x2fcf9c, metal: 0.5, rough: 0.32 },
  { id: 'emerald', hex: 0x0a4a32, metal: 0.65, rough: 0.32 },
  { id: 'electric', hex: 0x1347cc, metal: 0.6, rough: 0.32 },
  { id: 'midnight', hex: 0x0c1c48, metal: 0.7, rough: 0.3 },
  { id: 'amethyst', hex: 0x4a1a72, metal: 0.65, rough: 0.32 },
  { id: 'bronze', hex: 0x7c5422, metal: 0.8, rough: 0.33 },
  { id: 'silver', hex: 0xaeb2b8, metal: 0.85, rough: 0.3 },
  { id: 'graphite', hex: 0x33373c, metal: 0.75, rough: 0.33 },
  { id: 'obsidian', hex: 0x0b0b0e, metal: 0.5, rough: 0.28 },
  { id: 'pearl', hex: 0xe8e7e2, metal: 0.12, rough: 0.26 }
];

export const CAR_STAT_KEYS = ['accel', 'top', 'handling', 'nitro'];

export const CARS = [
  {
    id: 'shardfire',
    name: 'Shardfire',
    nameKey: 'tool.nitro-racer.cars.shardfire.name',
    kind: 'wedge',
    kindKey: 'tool.nitro-racer.cars.kind.wedge',
    stats: { accel: 8, top: 9, handling: 7, nitro: 6 },
    paints: ['sunburst', 'lime', 'crimson', 'obsidian', 'pearl'],
    rim: 0x2b2d31,
    caliper: 0xe8b50c,
    body: {
      length: 4.56,
      wheelbase: 2.66,
      frontOverhang: 1.02,
      wheel: { radius: [0.335, 0.35], width: [0.255, 0.33], rim: 0.75, style: 'split', dish: 0.05 },
      flare: [0.05, 0.085],
      flareLen: 0.62,
      noseRound: 0.46, nosePow: 2.2, tailRound: 0.24, tailPow: 3.2,
      tuckLow: 0.05, tuckUp: 0.075, upPow: 1, shoulderDrop: 0.06, hoodPow: 3,
      bottom: [[0, 0.2], [0.1, 0.13], [0.5, 0.11], [3.85, 0.11], [4.3, 0.2], [4.56, 0.34]],
      deck: [[0, 0.46], [0.05, 0.52], [0.3, 0.58], [0.9, 0.66], [1.45, 0.74], [2.2, 0.8], [3.0, 0.85], [3.5, 0.88], [4.25, 0.895], [4.46, 0.91], [4.56, 0.83]],
      roof: [[1.4, 0.67], [1.47, 0.76], [1.8, 0.95], [2.15, 1.09], [2.4, 1.12], [2.8, 1.11], [3.25, 1.02], [3.7, 0.92], [3.85, 0.86]],
      rail: [[1.5, 0.72], [1.62, 0.79], [2.0, 0.97], [2.35, 1.06], [2.8, 1.05], [3.2, 0.97], [3.55, 0.9], [3.72, 0.86]],
      fender: [[0, 0.45], [0.08, 0.53], [0.45, 0.65], [0.95, 0.72], [1.5, 0.74], [2.2, 0.76], [3.0, 0.83], [3.6, 0.895], [4.2, 0.91], [4.46, 0.915], [4.56, 0.83]],
      char: [[0, 0.33], [1.0, 0.41], [2.4, 0.43], [3.6, 0.49], [4.56, 0.5]],
      half: [[0, 0.86], [0.6, 0.92], [1.2, 0.93], [2.3, 0.91], [3.3, 0.94], [4.56, 0.93]],
      r5: [[1.4, 0.82], [2.4, 0.78], [3.7, 0.84]],
      r6: [[1.45, 0.74], [2.2, 0.53], [2.9, 0.53], [3.72, 0.76]],
      scoop: { d0: 2.74, d1: 3.3, y0: 0.38, y1: 0.78, depth: 0.05 },
      glass: { ws: [1.53, 2.3], side: [1.72, 2.32, 2.92, 3.3], rear: [2.86, 3.3, 0.55] },
      lamps: {
        head: [[0.05, 5.55], [0.44, 5.95], [0.46, 6.35], [0.08, 6.02]],
        drl: [[0.07, 5.62], [0.43, 6.0], [0.44, 6.1], [0.08, 5.72]],
        tail: [[4.3, 5.65], [4.56, 5.75], [4.56, 6.05], [4.3, 5.98]],
        brake: [[4.4, 5.72], [4.56, 5.78], [4.56, 5.86], [4.4, 5.8]]
      },
      intakes: [
        { part: 'grille', q: [[0.0, 4.2], [0.26, 4.25], [0.3, 5.15], [0.0, 5.2]] },
        { part: 'grille', q: [[0.34, 4.3], [0.62, 4.5], [0.6, 5.1], [0.36, 5.05]] },
        { part: 'grille', q: [[2.88, 5.15], [3.24, 5.15], [3.24, 5.85], [2.92, 5.8]] },
        { part: 'matte', q: [[4.47, 3.5], [4.56, 3.5], [4.56, 5.1], [4.47, 5.1]] }
      ],
      vents: [{ q: [[0.95, 7.35], [1.3, 7.35], [1.3, 7.75], [0.95, 7.75]], slats: 5 }],
      splitter: { out: 0.045, depth: 0.32 },
      diffuser: { fins: 4, len: 0.5 },
      skirt: true,
      exhaust: { x: [0.1], y: 0.33, r: 0.042, d: 4.5 },
      wing: { d: 4.22, chord: 0.27, span: 0.86, height: 0.2, posts: 0.32, part: 'carbon' },
      mirror: { d: 1.86, part: 'paint' },
      lines: [[1.9, 3.0], [2.86, 3.5]]
    }
  },
  {
    id: 'marlowe',
    name: 'Marlowe GT',
    nameKey: 'tool.nitro-racer.cars.marlowe.name',
    kind: 'gt',
    kindKey: 'tool.nitro-racer.cars.kind.gt',
    stats: { accel: 7, top: 8, handling: 7, nitro: 8 },
    paints: ['midnight', 'emerald', 'silver', 'crimson', 'bronze'],
    rim: 0xc6c9ce,
    caliper: 0xc4161c,
    body: {
      length: 4.7,
      wheelbase: 2.78,
      frontOverhang: 0.93,
      wheel: { radius: [0.345, 0.355], width: [0.255, 0.295], rim: 0.74, style: 'ten', dish: 0.03 },
      flare: [0.04, 0.065],
      flareLen: 0.66,
      noseRound: 0.48, nosePow: 2.4, tailRound: 0.32, tailPow: 2.6,
      tuckLow: 0.05, tuckUp: 0.065, upPow: 1.4, shoulderDrop: 0.05, hoodPow: 2.6,
      bottom: [[0, 0.26], [0.12, 0.15], [0.5, 0.13], [3.9, 0.13], [4.45, 0.2], [4.7, 0.33]],
      deck: [[0, 0.56], [0.06, 0.62], [0.4, 0.69], [1.2, 0.76], [2.0, 0.83], [2.6, 0.88], [3.4, 0.93], [3.9, 0.95], [4.45, 0.965], [4.63, 0.985], [4.7, 0.86]],
      roof: [[1.95, 0.76], [2.05, 0.86], [2.35, 1.07], [2.7, 1.24], [3.0, 1.29], [3.3, 1.27], [3.8, 1.13], [4.25, 1.0], [4.45, 0.93]],
      rail: [[2.07, 0.83], [2.2, 0.9], [2.55, 1.12], [2.9, 1.225], [3.25, 1.21], [3.7, 1.08], [4.1, 0.97], [4.26, 0.93]],
      fender: [[0, 0.55], [0.08, 0.63], [0.5, 0.74], [1.0, 0.8], [1.9, 0.84], [2.8, 0.88], [3.8, 0.965], [4.45, 0.975], [4.7, 0.87]],
      char: [[0, 0.4], [1.0, 0.49], [2.5, 0.5], [3.8, 0.56], [4.7, 0.58]],
      half: [[0, 0.82], [0.6, 0.9], [1.5, 0.91], [2.6, 0.9], [3.6, 0.93], [4.7, 0.91]],
      r5: [[2.0, 0.83], [3.0, 0.8], [4.3, 0.85]],
      r6: [[2.0, 0.74], [2.8, 0.56], [3.4, 0.56], [4.3, 0.74]],
      glass: { ws: [2.09, 2.74], side: [2.26, 2.76, 3.4, 3.78], rear: [3.36, 4.2, 0.8] },
      lamps: {
        head: [[0.06, 5.75], [0.5, 6.05], [0.5, 6.45], [0.08, 6.2]],
        drl: [[0.08, 5.8], [0.48, 6.1], [0.48, 6.2], [0.09, 5.9]],
        tail: [[4.42, 5.7], [4.7, 5.8], [4.7, 6.15], [4.42, 6.05]],
        brake: [[4.52, 5.78], [4.7, 5.84], [4.7, 5.92], [4.52, 5.86]]
      },
      intakes: [
        { part: 'grille', q: [[0.0, 4.4], [0.22, 4.5], [0.24, 5.3], [0.0, 5.35]] },
        { part: 'matte', q: [[4.58, 3.5], [4.7, 3.5], [4.7, 5.15], [4.58, 5.15]] }
      ],
      vents: [{ q: [[1.25, 6.4], [1.6, 6.45], [1.6, 6.75], [1.25, 6.7]], slats: 4 }],
      splitter: { out: 0.03, depth: 0.22 },
      diffuser: { fins: 3, len: 0.42 },
      skirt: false,
      exhaust: { x: [0.62, 0.52], y: 0.29, r: 0.038, d: 4.62 },
      mirror: { d: 2.38, part: 'paint' },
      lines: [[2.3, 3.62]]
    }
  },
  {
    id: 'aethra',
    name: 'Aethra',
    nameKey: 'tool.nitro-racer.cars.aethra.name',
    kind: 'hyper',
    kindKey: 'tool.nitro-racer.cars.kind.hyper',
    stats: { accel: 10, top: 10, handling: 5, nitro: 5 },
    paints: ['pearl', 'electric', 'obsidian', 'amethyst', 'mint'],
    rim: 0x1e2024,
    caliper: 0x2fd0ff,
    body: {
      length: 4.8,
      wheelbase: 2.74,
      frontOverhang: 1.0,
      wheel: { radius: [0.34, 0.36], width: [0.265, 0.345], rim: 0.76, style: 'blade', dish: 0.06 },
      flare: [0.06, 0.09],
      flareLen: 0.6,
      noseRound: 0.55, nosePow: 2.0, tailRound: 0.2, tailPow: 3.5,
      tuckLow: 0.055, tuckUp: 0.08, upPow: 1, shoulderDrop: 0.06, hoodPow: 3.2,
      bottom: [[0, 0.17], [0.15, 0.11], [0.5, 0.1], [3.9, 0.1], [4.5, 0.2], [4.8, 0.36]],
      deck: [[0, 0.4], [0.08, 0.46], [0.5, 0.58], [1.0, 0.68], [1.32, 0.74], [2.2, 0.82], [3.0, 0.9], [3.8, 0.93], [4.6, 0.95], [4.8, 0.85]],
      roof: [[1.28, 0.66], [1.36, 0.76], [1.65, 0.95], [2.0, 1.07], [2.25, 1.09], [2.6, 1.06], [3.0, 0.99], [3.5, 0.94], [3.7, 0.9]],
      rail: [[1.38, 0.73], [1.5, 0.8], [1.85, 0.97], [2.2, 1.03], [2.55, 1.0], [2.9, 0.95], [3.2, 0.91]],
      fender: [[0, 0.4], [0.08, 0.47], [0.5, 0.64], [1.0, 0.76], [1.4, 0.77], [2.3, 0.81], [3.2, 0.93], [3.8, 0.965], [4.6, 0.965], [4.8, 0.86]],
      char: [[0, 0.3], [1.0, 0.4], [2.4, 0.42], [3.7, 0.52], [4.8, 0.52]],
      half: [[0, 0.8], [0.6, 0.92], [1.2, 0.92], [2.2, 0.9], [3.3, 0.95], [4.8, 0.92]],
      r5: [[1.35, 0.74], [2.2, 0.7], [3.2, 0.78]],
      r6: [[1.35, 0.68], [2.0, 0.47], [2.6, 0.47], [3.2, 0.62]],
      scoop: { d0: 2.75, d1: 3.38, y0: 0.38, y1: 0.82, depth: 0.09 },
      glass: { ws: [1.41, 2.05], side: [1.6, 2.06, 2.55, 2.85], rear: null },
      lamps: {
        head: [[0.1, 5.85], [0.52, 6.15], [0.53, 6.4], [0.12, 6.1]],
        drl: [[0.12, 5.88], [0.5, 6.18], [0.5, 6.26], [0.12, 5.96]],
        tail: [[4.62, 5.85], [4.8, 5.9], [4.8, 6.08], [4.62, 6.04]],
        brake: [[4.68, 5.9], [4.8, 5.93], [4.8, 6.0], [4.68, 5.97]]
      },
      intakes: [
        { part: 'grille', q: [[0.0, 4.6], [0.3, 4.7], [0.34, 5.6], [0.0, 5.6]] },
        { part: 'grille', q: [[2.88, 5.2], [3.24, 5.2], [3.22, 5.85], [2.92, 5.8]] },
        { part: 'matte', q: [[4.7, 3.5], [4.8, 3.5], [4.8, 5.45], [4.7, 5.45]] }
      ],
      vents: [{ q: [[0.75, 7.2], [1.15, 7.2], [1.15, 7.7], [0.75, 7.7]], slats: 6 }, { q: [[3.6, 7.3], [4.3, 7.3], [4.3, 7.75], [3.6, 7.75]], slats: 8 }],
      splitter: { out: 0.06, depth: 0.42 },
      diffuser: { fins: 5, len: 0.6 },
      skirt: true,
      exhaust: { x: [0.08, 0.2], y: 0.46, r: 0.036, d: 4.72 },
      wing: { d: 4.45, chord: 0.32, span: 0.92, height: 0.3, posts: 0.28, part: 'carbon' },
      fin: { d0: 2.6, d1: 4.45, height: 0.2, part: 'carbon' },
      mirror: { d: 1.72, part: 'carbon' },
      lines: [[1.75, 2.82]]
    }
  },
  {
    id: 'ironjaw',
    name: 'Ironjaw',
    nameKey: 'tool.nitro-racer.cars.ironjaw.name',
    kind: 'muscle',
    kindKey: 'tool.nitro-racer.cars.kind.muscle',
    stats: { accel: 9, top: 7, handling: 4, nitro: 10 },
    paints: ['saffron', 'crimson', 'obsidian', 'electric', 'emerald'],
    rim: 0x9a9da3,
    caliper: 0x111214,
    livery: { stripes: 'twin', color: 0x0b0b0e },
    body: {
      length: 4.86,
      wheelbase: 2.82,
      frontOverhang: 0.98,
      wheel: { radius: [0.345, 0.355], width: [0.27, 0.305], rim: 0.7, style: 'five', dish: 0.035 },
      flare: [0.025, 0.05],
      flareLen: 0.7,
      noseRound: 0.24, nosePow: 3.4, tailRound: 0.2, tailPow: 3.5,
      tuckLow: 0.06, tuckUp: 0.1, upPow: 1, shoulderDrop: 0.035, hoodPow: 2.2,
      bottom: [[0, 0.3], [0.1, 0.17], [0.45, 0.14], [4.0, 0.14], [4.6, 0.2], [4.86, 0.35]],
      deck: [[0, 0.7], [0.05, 0.76], [0.25, 0.8], [1.2, 0.845], [2.05, 0.88], [3.0, 0.92], [3.9, 0.95], [4.6, 0.97], [4.8, 0.975], [4.86, 0.9]],
      roof: [[2.0, 0.82], [2.1, 0.93], [2.45, 1.18], [2.8, 1.32], [3.3, 1.34], [3.7, 1.25], [4.1, 1.06], [4.3, 0.98], [4.45, 0.92]],
      rail: [[2.12, 0.9], [2.3, 1.02], [2.65, 1.22], [3.0, 1.285], [3.4, 1.28], [3.75, 1.17], [4.05, 1.03], [4.2, 0.97]],
      fender: [[0, 0.72], [0.06, 0.78], [0.4, 0.84], [1.1, 0.865], [2.0, 0.89], [3.0, 0.92], [3.9, 0.97], [4.7, 0.98], [4.86, 0.91]],
      char: [[0, 0.55], [1.0, 0.62], [2.5, 0.62], [3.9, 0.66], [4.86, 0.68]],
      half: [[0, 0.88], [0.5, 0.93], [2.4, 0.93], [4.86, 0.94]],
      r5: [[2.05, 0.86], [3.0, 0.84], [4.2, 0.87]],
      r6: [[2.05, 0.76], [2.9, 0.63], [3.5, 0.63], [4.2, 0.72]],
      glass: { ws: [2.14, 2.74], side: [2.3, 2.75, 3.45, 3.86], rear: [3.6, 4.2, 0.85] },
      lamps: {
        head: [[0.0, 5.3], [0.24, 5.3], [0.24, 6.0], [0.0, 6.0]],
        drl: [[0.02, 5.82], [0.22, 5.82], [0.22, 5.92], [0.02, 5.92]],
        tail: [[4.68, 5.3], [4.86, 5.3], [4.86, 6.1], [4.68, 6.1]],
        brake: [[4.74, 5.5], [4.86, 5.5], [4.86, 5.9], [4.74, 5.9]]
      },
      grilleFull: true,
      intakes: [
        { part: 'grille', q: [[0.0, 4.15], [0.2, 4.2], [0.2, 4.85], [0.0, 4.85]] }
      ],
      hoodScoop: { d0: 0.75, d1: 1.55, w: 0.3, h: 0.075 },
      splitter: null,
      diffuser: null,
      skirt: false,
      exhaust: { x: [0.66, 0.54], y: 0.24, r: 0.045, d: 4.78 },
      spoiler: { d: 4.62, h: 0.05 },
      mirror: { d: 2.38, part: 'paint' },
      lines: [[2.35, 3.68]]
    }
  },
  {
    id: 'mudlark',
    name: 'Mudlark R',
    nameKey: 'tool.nitro-racer.cars.mudlark.name',
    kind: 'rally',
    kindKey: 'tool.nitro-racer.cars.kind.rally',
    stats: { accel: 7, top: 5, handling: 10, nitro: 8 },
    paints: ['electric', 'pearl', 'lime', 'sunburst', 'midnight'],
    rim: 0xe9e9ea,
    caliper: 0xc4161c,
    livery: { stripes: 'rally', color: 0xf2f2f2, number: 7 },
    body: {
      length: 4.18,
      wheelbase: 2.6,
      frontOverhang: 0.86,
      wheel: { radius: [0.34, 0.34], width: [0.245, 0.245], rim: 0.64, style: 'dish', dish: 0.015 },
      flare: [0.1, 0.1],
      flareLen: 0.56,
      boxFlare: true,
      noseRound: 0.28, nosePow: 2.6, tailRound: 0.14, tailPow: 3.2,
      tuckLow: 0.05, tuckUp: 0.06, upPow: 1.3, shoulderDrop: 0.04, hoodPow: 2.4,
      bottom: [[0, 0.32], [0.1, 0.19], [0.4, 0.165], [3.6, 0.165], [4.0, 0.23], [4.18, 0.36]],
      deck: [[0, 0.66], [0.05, 0.72], [0.3, 0.79], [0.9, 0.86], [1.2, 0.9], [2.4, 0.95], [3.4, 0.98], [3.9, 0.99], [4.18, 0.96]],
      roof: [[1.16, 0.85], [1.24, 0.95], [1.55, 1.2], [1.9, 1.37], [2.3, 1.4], [3.2, 1.39], [3.55, 1.36], [3.85, 1.2], [4.1, 1.02], [4.18, 0.98]],
      rail: [[1.26, 0.93], [1.4, 1.05], [1.75, 1.28], [2.15, 1.345], [3.2, 1.34], [3.5, 1.3], [3.8, 1.14], [4.02, 1.0]],
      fender: [[0, 0.66], [0.06, 0.74], [0.35, 0.81], [0.9, 0.86], [1.25, 0.89], [2.5, 0.93], [3.4, 0.97], [4.1, 0.97], [4.18, 0.94]],
      char: [[0, 0.52], [1, 0.58], [2.5, 0.6], [4.18, 0.64]],
      half: [[0, 0.8], [0.5, 0.85], [2.0, 0.85], [4.18, 0.85]],
      r5: [[1.2, 0.88], [2.5, 0.86], [4.0, 0.88]],
      r6: [[1.2, 0.78], [1.95, 0.68], [3.5, 0.68], [4.02, 0.76]],
      glass: { ws: [1.28, 1.88], side: [1.46, 1.9, 3.3, 3.5], split: [2.5, 0.08], rear: [3.62, 4.02, 0.85] },
      lamps: {
        head: [[0.02, 5.5], [0.26, 5.6], [0.26, 6.2], [0.03, 6.1]],
        drl: [[0.03, 5.56], [0.25, 5.64], [0.25, 5.74], [0.03, 5.66]],
        tail: [[4.04, 5.5], [4.18, 5.5], [4.18, 6.3], [4.04, 6.3]],
        brake: [[4.1, 5.62], [4.18, 5.62], [4.18, 5.9], [4.1, 5.9]]
      },
      intakes: [
        { part: 'grille', q: [[0.0, 4.2], [0.18, 4.25], [0.2, 5.25], [0.0, 5.3]] },
        { part: 'matte', q: [[4.1, 3.5], [4.18, 3.5], [4.18, 5.0], [4.1, 5.0]] }
      ],
      roofScoop: { d: 2.05, w: 0.2, h: 0.06, len: 0.32 },
      splitter: { out: 0.025, depth: 0.2 },
      diffuser: null,
      skirt: true,
      flaps: true,
      exhaust: { x: [0.42], y: 0.3, r: 0.05, d: 4.1, single: true },
      wing: { d: 3.86, chord: 0.24, span: 0.8, height: 0.1, posts: 0.3, part: 'paint', roofLevel: true },
      mirror: { d: 1.62, part: 'paint' },
      lines: [[1.62, 2.5], [2.54, 3.28]]
    }
  },
  {
    id: 'nocturne',
    name: 'Nocturne S',
    nameKey: 'tool.nitro-racer.cars.nocturne.name',
    kind: 'sedan',
    kindKey: 'tool.nitro-racer.cars.kind.sedan',
    stats: { accel: 7, top: 7, handling: 9, nitro: 7 },
    paints: ['crimson', 'graphite', 'pearl', 'midnight', 'amethyst'],
    rim: 0x2a2c30,
    caliper: 0x1d63d6,
    body: {
      length: 4.8,
      wheelbase: 2.86,
      frontOverhang: 0.9,
      wheel: { radius: [0.34, 0.34], width: [0.25, 0.27], rim: 0.73, style: 'star', dish: 0.04 },
      flare: [0.035, 0.05],
      flareLen: 0.68,
      noseRound: 0.32, nosePow: 2.6, tailRound: 0.24, tailPow: 3,
      tuckLow: 0.05, tuckUp: 0.07, upPow: 1.2, shoulderDrop: 0.04, hoodPow: 2.4,
      bottom: [[0, 0.3], [0.1, 0.16], [0.45, 0.14], [4.0, 0.14], [4.55, 0.22], [4.8, 0.36]],
      deck: [[0, 0.66], [0.05, 0.72], [0.3, 0.77], [1.0, 0.83], [1.75, 0.9], [2.8, 0.95], [3.8, 0.99], [4.45, 1.01], [4.72, 1.025], [4.8, 0.94]],
      roof: [[1.7, 0.84], [1.78, 0.93], [2.1, 1.2], [2.45, 1.37], [2.8, 1.4], [3.35, 1.38], [3.7, 1.25], [4.0, 1.07], [4.15, 1.0]],
      rail: [[1.8, 0.92], [1.95, 1.05], [2.3, 1.29], [2.7, 1.355], [3.3, 1.34], [3.6, 1.25], [3.85, 1.1], [3.97, 1.02]],
      fender: [[0, 0.66], [0.06, 0.74], [0.4, 0.82], [1.0, 0.86], [1.8, 0.91], [3.0, 0.95], [3.9, 1.0], [4.6, 1.02], [4.8, 0.95]],
      char: [[0, 0.52], [1, 0.6], [2.5, 0.62], [4.8, 0.66]],
      half: [[0, 0.82], [0.5, 0.9], [2.4, 0.9], [4.8, 0.9]],
      r5: [[1.75, 0.87], [2.8, 0.85], [4.0, 0.88]],
      r6: [[1.8, 0.76], [2.6, 0.63], [3.4, 0.63], [4.0, 0.75]],
      glass: { ws: [1.82, 2.42], side: [1.98, 2.43, 3.38, 3.72], split: [2.86, 0.07], rear: [3.44, 3.96, 0.86] },
      lamps: {
        head: [[0.03, 5.7], [0.36, 5.95], [0.37, 6.4], [0.05, 6.15]],
        drl: [[0.05, 5.74], [0.35, 5.98], [0.35, 6.08], [0.05, 5.84]],
        tail: [[4.5, 5.75], [4.8, 5.85], [4.8, 6.25], [4.5, 6.15]],
        brake: [[4.62, 5.84], [4.8, 5.9], [4.8, 5.98], [4.62, 5.92]]
      },
      intakes: [
        { part: 'grille', q: [[0.0, 4.75], [0.2, 4.8], [0.22, 5.55], [0.0, 5.6]] },
        { part: 'grille', q: [[0.0, 4.05], [0.3, 4.1], [0.32, 4.5], [0.0, 4.5]] }
      ],
      splitter: { out: 0.02, depth: 0.2 },
      diffuser: { fins: 2, len: 0.35 },
      skirt: false,
      exhaust: { x: [0.62, 0.5], y: 0.28, r: 0.04, d: 4.7 },
      spoiler: { d: 4.68, h: 0.035 },
      mirror: { d: 2.06, part: 'paint' },
      lines: [[2.0, 2.86], [2.9, 3.62]]
    }
  }
];

export function carById(id) {
  return CARS.find((c) => c.id === id) || CARS[0];
}

export function paintById(id) {
  return CAR_PAINTS.find((p) => p.id === id) || CAR_PAINTS[0];
}

export function carStatsTotal(car) {
  return CAR_STAT_KEYS.reduce((sum, k) => sum + car.stats[k], 0);
}
