// maps.js — the 12 maps and their color themes.
//
// Each map has:
//   id, name, tag ('Parkour', 'Long range' or 'Close range'), blurb (one line for the vote screen)
//   size    — the floor is size × size, centred on 0
//   theme   — colors for the sky, floor, lights and each kind of shape
//   build   — places the shapes using the helpers below
//
// Shape helpers (measurements in metres; y = bottom of the shape, default 0):
//   b.box(x, z, w, d, h, y, style)              box, w along x and d along z
//   b.cyl(x, z, r, h, y, style)                 round pillar or tank
//   b.prism(x, z, r, sides, h, rot, y, style)   straight-sided pillar (3 = triangle, 6 = hexagon)
//   b.ramp(x, z, w, d, h, dir, y, style)        wedge rising toward dir: '+x', '-x', '+z' or '-z'
//   b.pad(x, z, power, y)                       jump pad (power 16 ≈ 6 m high, 23 ≈ 13 m high)
//   b.stairs(x, z, dir, steps, rise, run, width, style)  stairs whose top meets (x, z), going down toward dir
//   b.around(n, fn)                             runs fn n times (2 or 4), turning the map each time,
//                                               so one corner's layout is copied to the others
//
// Styles pick a color from the theme: wall, crate, metal, tank, ramp, accent, pad.

export const MAPS = [];

function makeBuilder(shapes) {
  let turns = 0; // quarter turns applied to everything placed (used by around)
  const place = (x, z) => {
    let p = [x, z];
    for (let i = 0; i < turns; i++) p = [p[1], -p[0]];
    return p;
  };
  const turnDir = (dir) => {
    const order = ['+x', '-z', '-x', '+z'];
    return order[(order.indexOf(dir) + turns) % 4];
  };
  const size = (w, d) => (turns % 2 ? [d, w] : [w, d]);

  const b = {
    box(x, z, w, d, h, y = 0, style = 'wall') {
      const [X, Z] = place(x, z), [W, D] = size(w, d);
      shapes.push({ type: 'box', x: X, z: Z, w: W, d: D, h, y, style });
    },
    cyl(x, z, r, h, y = 0, style = 'tank') {
      const [X, Z] = place(x, z);
      shapes.push({ type: 'cyl', x: X, z: Z, r, h, y, style });
    },
    prism(x, z, r, sides, h, rot = 0, y = 0, style = 'crate') {
      const [X, Z] = place(x, z);
      shapes.push({ type: 'prism', x: X, z: Z, r, sides, h, rot: rot + turns * Math.PI / 2, y, style });
    },
    ramp(x, z, w, d, h, dir, y = 0, style = 'ramp') {
      const [X, Z] = place(x, z), [W, D] = size(w, d);
      shapes.push({ type: 'ramp', x: X, z: Z, w: W, d: D, h, dir: turnDir(dir), y, style });
    },
    pad(x, z, power = 16, y = 0) {
      const [X, Z] = place(x, z);
      shapes.push({ type: 'pad', x: X, z: Z, r: 1.1, h: 0.15, y, power, style: 'pad' });
    },
    stairs(x, z, dir, steps, rise, run, width, style = 'ramp') {
      const sign = dir[0] === '+' ? 1 : -1;
      for (let i = 0; i < steps; i++) {
        const h = rise * (steps - i), offset = sign * run * (i + 0.5);
        if (dir[1] === 'x') b.box(x + offset, z, run, width, h, 0, style);
        else b.box(x, z + offset, width, run, h, 0, style);
      }
    },
    around(n, fn) {
      for (let k = 0; k < 4; k += 4 / n) { turns = k; fn(); }
      turns = 0;
    },
  };
  return b;
}

function defineMap(def) {
  const shapes = [];
  const b = makeBuilder(shapes);
  const half = def.size / 2, wallH = def.wallHeight || 8;
  b.box(0, -half, def.size, 1, wallH, 0, 'edge');
  b.box(0, half, def.size, 1, wallH, 0, 'edge');
  b.box(-half, 0, 1, def.size, wallH, 0, 'edge');
  b.box(half, 0, 1, def.size, wallH, 0, 'edge');
  def.build(b);
  MAPS.push({ ...def, shapes });
}

// Small repeatable random numbers, so the generated maze is the same on server and browser
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =====================================================================
// PARKOUR MAPS
// =====================================================================

defineMap({
  id: 'neon-yard', name: 'Neon Yard', tag: 'Parkour', size: 84,
  blurb: 'Hex tower, bridges, pillar trails and stacked containers.',
  theme: {
    sky: 0x0a0618, fogNear: 35, fogFar: 120, floor: 0x140d30, grid: 0x3a2a7a,
    hemi: [0x7b6bff, 0x1a0f2e, 0.75], sun: [0xc9a8ff, 0.55], edges: 0xff8a1f,
    styles: {
      wall:   { color: 0x1d1745, emissive: 0x2a1a6e, glow: 0.35 },
      crate:  { color: 0xff2bd6, emissive: 0xff2bd6, glow: 0.45 },
      metal:  { color: 0x0f2a3d, emissive: 0x00e5ff, glow: 0.35 },
      tank:   { color: 0x3a0ca3, emissive: 0x7b2cff, glow: 0.45 },
      ramp:   { color: 0x10324a, emissive: 0x00e5ff, glow: 0.25 },
      accent: { color: 0xff8a1f, emissive: 0xff8a1f, glow: 0.5 },
      edge:   { color: 0x2b0f3f, emissive: 0xff8a1f, glow: 0.3 },
      pad:    { color: 0x00ffd5, emissive: 0x00ffd5, glow: 0.7 },
    },
  },
  build(b) {
    b.prism(0, 0, 5, 6, 5, Math.PI / 6, 0, 'wall');
    b.box(0, 0, 1.2, 1.2, 1.2, 5, 'crate');
    b.ramp(0, 9.3, 3, 10, 5, '-z');
    b.ramp(0, -9.3, 3, 10, 5, '+z');
    for (const [px, pz] of [[8, 8], [-8, 8], [8, -8], [-8, -8]]) b.pad(px, pz);
    b.around(2, () => {
      b.box(15.1, 0, 21.8, 2.4, 0.4, 4.6, 'metal');
      b.cyl(15, 0, 0.45, 4.6, 0, 'metal');
      b.box(29, 0, 6, 6, 5, 0, 'wall');
      b.stairs(32, 0, '+x', 12, 0.4, 0.6, 3);
      b.box(30.5, -2.4, 3, 0.4, 1, 5, 'accent');
      b.box(30.5, 2.4, 3, 0.4, 1, 5, 'accent');
      b.box(0, -22, 10, 1, 3);
    });
    for (const s of [1, -1]) {
      for (let i = 0; i < 5; i++) {
        const px = s * (10 + i * 4.6), pz = -s * 30, h = 1.2 + i;
        if (s > 0) b.cyl(px, pz, 1.2, h, 0, 'metal');
        else b.prism(px, pz, 1.35, 6, h, 0, 0, 'metal');
      }
      b.box(s * 34.3, -s * 30, 5.4, 6, 6.2, 0, 'wall');
      b.box(s * 36.7, -s * 31.8, 0.4, 1.8, 1, 6.2, 'crate');
      b.box(s * 36.7, -s * 28.2, 0.4, 1.8, 1, 6.2, 'crate');
      b.box(s * 34.3, -s * 32.7, 1.8, 0.4, 1, 6.2, 'crate');
      b.prism(s * 12, -s * 14, 1.7, 3, 1.4, 0);
      b.prism(s * 20, -s * 18, 1.7, 3, 1.4, Math.PI);
      b.prism(s * 15, -s * 22, 1.5, 3, 2.2, Math.PI / 2, 0, 'accent');
      b.cyl(s * 27, -s * 12, 2, 3);
      b.cyl(s * 31.5, -s * 16, 1.4, 2.2);
    }
    // North-west containers, walkway and bunker
    b.box(-30, -16, 10, 3, 2.6, 0, 'crate');
    b.ramp(-21, -16, 8, 3, 2.6, '-x');
    b.box(-29, -19, 2, 2, 3.9, 0, 'metal');
    b.box(-33, -21.5, 3, 8, 5.2, 0, 'metal');
    b.box(-33, -31, 2.4, 11, 0.4, 4.8, 'metal');
    b.cyl(-33, -31, 0.4, 4.8, 0, 'metal');
    b.box(-37, -38, 9, 7, 5.2, 0, 'wall');
    b.box(-39.5, -34.2, 4, 0.4, 1, 5.2, 'accent');
    b.box(-14, -33, 6, 0.5, 2.4);
    b.box(-16.75, -30.5, 0.5, 5, 2.4);
    b.box(-11.25, -30.5, 0.5, 5, 2.4);
    b.box(-14, -30.6, 6, 5.4, 0.4, 2.4, 'metal');
    b.ramp(-12, -12, 3, 1.6, 1.3, '+z', 0, 'crate');
    b.ramp(-24, -6, 1.6, 3, 1.3, '-x', 0, 'crate');
    // South-east tanks, sky bridge and bunker
    b.cyl(18, 22, 3, 5);
    b.cyl(32, 22, 3, 5);
    b.box(25, 22, 8.4, 2, 0.4, 4.6, 'metal');
    b.pad(18, 28.5);
    b.pad(32, 15.5);
    b.box(25, 25, 2, 2, 1.2, 0, 'crate');
    b.box(25, 19, 2, 2, 1.2, 0, 'crate');
    b.box(12, 33, 6, 0.5, 2.4);
    b.box(14.75, 30.5, 0.5, 5, 2.4);
    b.box(9.25, 30.5, 0.5, 5, 2.4);
    b.box(12, 30.6, 6, 5.4, 0.4, 2.4, 'metal');
    b.ramp(12, 12, 3, 1.6, 1.3, '-z', 0, 'crate');
    b.ramp(36, 8, 1.6, 3, 1.3, '+x', 0, 'crate');
  },
});

defineMap({
  id: 'sky-towers', name: 'Sky Towers', tag: 'Parkour', size: 80,
  blurb: 'Four tall towers joined by a ring of bridges high above the grass.',
  theme: {
    sky: 0x7ec8ff, fogNear: 60, fogFar: 150, floor: 0x5fa052, grid: 0x4c8a40,
    hemi: [0xffffff, 0x3d6b35, 1.0], sun: [0xfff4d6, 1.8], edges: 0x14213d,
    styles: {
      wall:   { color: 0xf4f1ea },
      crate:  { color: 0xe63946 },
      metal:  { color: 0x1d3557 },
      tank:   { color: 0x457b9d },
      ramp:   { color: 0xffb703 },
      accent: { color: 0xe63946 },
      edge:   { color: 0xdfe7ee },
      pad:    { color: 0xffd60a, emissive: 0xffd60a, glow: 0.6 },
    },
  },
  build(b) {
    b.prism(0, 0, 6.5, 8, 6, Math.PI / 8, 0, 'wall');   // octagon hub, top 6
    b.box(0, 0, 1.4, 1.4, 1.2, 6, 'crate');
    b.around(4, () => {
      b.ramp(0, 12, 3, 12, 6, '-z');                    // ramp to the hub
      b.box(22, 22, 8, 8, 12, 0, 'wall');                // tower, top 12
      b.box(25, 21, 0.4, 3, 1, 12, 'crate');             // cover on the tower top
      b.box(21, 25, 3, 0.4, 1, 12, 'crate');
      b.box(22, 0, 2.4, 36, 0.4, 11.6, 'metal');         // bridge ring, top 12
      b.cyl(22, 0, 0.5, 11.6, 0, 'metal');
      for (let i = 0; i < 4; i++) {                       // floating steps from the hub up to the tower
        const d = 6 + i * 3.2;
        b.box(d, d, 2.4, 2.4, 0.4, 6.8 + i * 1.2, 'accent');
      }
      b.pad(30, 30, 23);                                  // big launch onto the tower
      b.prism(10, 30, 1.8, 3, 1.6, 0);
      b.cyl(32, 8, 2, 3);
      b.box(0, 30, 8, 1, 2.5);
    });
  },
});

defineMap({
  id: 'pillar-peaks', name: 'Pillar Peaks', tag: 'Parkour', size: 80,
  blurb: 'A stepped pyramid in the middle and pillar trails to four lookouts.',
  theme: {
    sky: 0xffd6a5, fogNear: 50, fogFar: 140, floor: 0x264653, grid: 0x1f3a45,
    hemi: [0xfff1e0, 0x1b3640, 1.0], sun: [0xffe1b8, 1.7], edges: 0x1b1b2f,
    styles: {
      wall:   { color: 0xe9c46a },
      crate:  { color: 0xe76f51 },
      metal:  { color: 0x2a9d8f },
      tank:   { color: 0xf4a261 },
      ramp:   { color: 0xf1faee },
      accent: { color: 0xe76f51 },
      edge:   { color: 0x1f3a45 },
      pad:    { color: 0x80ffdb, emissive: 0x80ffdb, glow: 0.6 },
    },
  },
  build(b) {
    b.box(0, 0, 24, 24, 2);  // pyramid tiers, tops 2, 4, 6, 8
    b.box(0, 0, 18, 18, 4);
    b.box(0, 0, 12, 12, 6);
    b.box(0, 0, 6, 6, 8, 0, 'accent');
    b.around(4, () => {
      b.ramp(0, 13.5, 3, 3, 2, '-z', 0);
      b.ramp(0, 10.5, 3, 3, 2, '-z', 2);
      b.ramp(0, 7.5, 3, 3, 2, '-z', 4);
      b.ramp(0, 4.5, 3, 3, 2, '-z', 6);
      for (let i = 0; i < 5; i++) b.cyl(-8 + i * 4.5, 30, 1.1, 1.2 + i, 0, 'metal'); // pillar trail
      b.box(15, 30, 5, 5, 6.2);                          // lookout, top 6.2
      b.box(15, 32.3, 3, 0.4, 1, 6.2, 'crate');
      b.pad(22, 24);
      b.prism(24, 12, 1.8, 3, 1.5, 0.3);
      b.cyl(34, 34, 2.2, 3.5);
    });
  },
});

defineMap({
  id: 'twin-forts', name: 'Twin Forts', tag: 'Parkour', size: 80,
  blurb: 'Two walled forts face off, joined by a sky bridge between their keeps.',
  theme: {
    sky: 0x8ecae6, fogNear: 55, fogFar: 150, floor: 0x6a994e, grid: 0x5a8542,
    hemi: [0xffffff, 0x3f5e2b, 1.0], sun: [0xfff8e7, 1.7], edges: 0x1b263b,
    styles: {
      wall:   { color: 0xd9d4c7 },
      crate:  { color: 0xc1121f },
      metal:  { color: 0x003049 },
      tank:   { color: 0x669bbc },
      ramp:   { color: 0xfdf0d5 },
      accent: { color: 0xfcbf49 },
      edge:   { color: 0x8d8778 },
      pad:    { color: 0xfcbf49, emissive: 0xfcbf49, glow: 0.6 },
    },
  },
  build(b) {
    b.box(0, 0, 2.4, 50, 0.4, 8.6, 'metal');             // sky bridge between the keeps, top 9
    b.cyl(0, -12, 0.5, 8.6, 0, 'metal');
    b.cyl(0, 12, 0.5, 8.6, 0, 'metal');
    b.box(-8, 0, 1, 6, 2.5);
    b.box(8, 0, 1, 6, 2.5);
    b.around(2, () => {
      b.box(-8.5, 18, 11, 1.5, 5);                         // front wall with a gate
      b.box(8.5, 18, 11, 1.5, 5);
      b.box(-14, 26, 1.5, 17.5, 5);                        // side walls
      b.box(14, 26, 1.5, 17.5, 5);
      b.box(0, 34, 29.5, 1.5, 5);                          // back wall
      b.stairs(-10, 18.75, '+z', 12, 0.42, 0.6, 3);        // stairs up to the wall walk
      b.stairs(10, 18.75, '+z', 12, 0.42, 0.6, 3);
      b.box(0, 28, 6, 6, 9, 0, 'accent');                  // keep, top 9
      b.box(0, 30.8, 6, 0.4, 1, 9, 'crate');
      b.pad(4.5, 22.5, 20);                                // launch onto the keep
      b.cyl(26, 20, 2, 3);
      b.box(30, 8, 1, 6, 2.5, 0, 'crate');
      b.prism(24, 32, 1.7, 3, 1.5, 0.5);
      b.ramp(-26, 10, 3, 6, 2, '+z');
      b.prism(-16, -6, 1.7, 3, 1.5, 0);
      b.cyl(-22, 0, 2, 3);
    });
  },
});

// =====================================================================
// LONG-RANGE MAPS
// =====================================================================

defineMap({
  id: 'dunes', name: 'Dunes', tag: 'Long range', size: 116,
  blurb: 'Wide desert with sand ridges, rocks and four watchtowers.',
  theme: {
    sky: 0xffe8c2, fogNear: 70, fogFar: 190, floor: 0xe9c46a, grid: 0xd4ae55,
    hemi: [0xfff4e0, 0x8a6a2e, 1.0], sun: [0xffe0b0, 1.9], edges: 0x5c3d2e,
    styles: {
      wall:   { color: 0xb5651d },
      crate:  { color: 0xd62828 },
      metal:  { color: 0x264653 },
      tank:   { color: 0x2a9d8f },
      ramp:   { color: 0xf4d58d },
      accent: { color: 0xd62828 },
      edge:   { color: 0xc98a4b },
      pad:    { color: 0x00f5d4, emissive: 0x00f5d4, glow: 0.6 },
    },
  },
  build(b) {
    b.cyl(-6, -6, 1, 4, 0, 'wall');                         // ruined columns in the middle
    b.cyl(6, -6, 1, 2.5, 0, 'wall');
    b.cyl(6, 6, 1, 5, 0, 'wall');
    b.cyl(-6, 6, 1, 3, 0, 'wall');
    b.box(0, -8, 6, 0.8, 1.6, 0, 'accent');
    b.box(0, 8, 6, 0.8, 1.6, 0, 'accent');
    b.around(4, () => {
      b.ramp(22, 20, 24, 8, 2.6, '+z');                     // sand ridge, peak 2.6
      b.ramp(22, 28, 24, 8, 2.6, '-z');
      b.prism(40, 40, 3, 5, 3.5, 0.4, 0, 'wall');           // rocks
      b.prism(46, 14, 2.2, 4, 2.4, 0.9, 0, 'wall');
      b.cyl(14, 44, 2.5, 3);
      b.box(30, 44, 4, 1, 1.8, 0, 'crate');
      b.box(48, 48, 6, 6, 6, 0, 'metal');                   // watchtower, top 6
      b.stairs(48, 45, '-z', 15, 0.4, 0.6, 3);
      b.box(50.8, 48, 0.4, 4, 1, 6, 'crate');
    });
  },
});

defineMap({
  id: 'frozen-lake', name: 'Frozen Lake', tag: 'Long range', size: 116,
  blurb: 'Open ice around a trapped ship, with shards and snowbanks for cover.',
  theme: {
    sky: 0xdbe9f6, fogNear: 60, fogFar: 180, floor: 0xbfe0f7, grid: 0xa5cfee,
    hemi: [0xffffff, 0x7fa6c4, 1.05], sun: [0xf0f7ff, 1.6], edges: 0x1d3557,
    styles: {
      wall:   { color: 0xffffff },
      crate:  { color: 0x3a86ff },
      metal:  { color: 0x1d3557 },
      tank:   { color: 0x457b9d },
      ramp:   { color: 0xf8fbff },
      accent: { color: 0xff006e },
      edge:   { color: 0xe8f1fa },
      pad:    { color: 0xff006e, emissive: 0xff006e, glow: 0.6 },
    },
  },
  build(b) {
    b.box(0, 0, 6, 22, 2.5, 0, 'metal');                    // ship hull, top 2.5
    b.box(0, -4, 4, 6, 2.2, 2.5, 'accent');                 // cabin
    b.cyl(0, 6, 0.4, 6, 2.5, 'metal');                      // mast
    b.ramp(0, -14, 3, 6, 2.5, '+z', 0, 'wall');             // snow ramps onto the deck
    b.ramp(0, 14, 3, 6, 2.5, '-z', 0, 'wall');
    b.around(4, () => {
      b.prism(20, 26, 1.4, 3, 5, 0.3);                      // ice shards
      b.prism(23, 29, 1, 4, 3, 1.1);
      b.prism(26, 24, 1.2, 5, 4, 0.6);
      b.ramp(40, 10, 8, 10, 2.2, '+x');                     // snowbank, peak 2.2
      b.ramp(48, 10, 8, 10, 2.2, '-x');
      b.box(44, 44, 6, 6, 5, 0, 'wall');                    // lookout, top 5
      b.stairs(44, 41, '-z', 12, 0.42, 0.6, 3, 'tank');
      b.box(46.8, 44, 0.4, 4, 1, 5, 'crate');
      b.cyl(12, 46, 2, 2.5);
    });
  },
});

defineMap({
  id: 'ruins', name: 'Ruins', tag: 'Long range', size: 110,
  blurb: 'Grassy field of broken temples, arches and two stone towers.',
  theme: {
    sky: 0xcde7b0, fogNear: 60, fogFar: 170, floor: 0x6a994e, grid: 0x5c8a42,
    hemi: [0xffffff, 0x386641, 1.0], sun: [0xfffbe8, 1.7], edges: 0x283618,
    styles: {
      wall:   { color: 0xf2e8cf },
      crate:  { color: 0xbc4749 },
      metal:  { color: 0x386641 },
      tank:   { color: 0xf2e8cf },
      ramp:   { color: 0xa7c957 },
      accent: { color: 0xbc4749 },
      edge:   { color: 0x9c9277 },
      pad:    { color: 0xffbe0b, emissive: 0xffbe0b, glow: 0.6 },
    },
  },
  build(b) {
    b.prism(0, 0, 5, 8, 0.5, Math.PI / 8);                   // temple base, two steps
    b.prism(0, 0, 3.6, 8, 1, Math.PI / 8, 0, 'accent');
    const heights = [5, 2, 6, 3, 5, 1.5, 4, 2.5];
    for (let i = 0; i < 8; i++) {                           // ring of broken columns
      const a = i * Math.PI / 4 + Math.PI / 8;
      b.cyl(11 * Math.sin(a), 11 * Math.cos(a), 0.9, heights[i], 0, 'wall');
    }
    b.around(2, () => {
      b.box(0, 42, 8, 6, 7, 0, 'wall');                      // stone tower, top 7
      b.stairs(-4, 42, '-x', 17, 0.41, 0.55, 3, 'ramp');
      b.box(0, 39.4, 6, 0.4, 1, 7, 'crate');
      b.cyl(-20, 20, 0.8, 4, 0, 'wall');                     // arch
      b.cyl(-14, 20, 0.8, 4, 0, 'wall');
      b.box(-17, 20, 8, 1.6, 0.6, 4, 'wall');
      b.box(24, 14, 8, 0.8, 1.4, 0, 'crate');                // low walls
      b.box(30, 26, 0.8, 8, 1.4, 0, 'crate');
      b.box(-34, 6, 0.8, 10, 1.6, 0, 'crate');
      b.cyl(38, 38, 1.2, 3.5, 0, 'wall');
      b.cyl(18, 34, 1, 2, 0, 'wall');
      b.prism(-30, 30, 1.8, 3, 1.5, 0.4, 0, 'metal');
    });
  },
});

defineMap({
  id: 'sunset-highway', name: 'Sunset Highway', tag: 'Long range', size: 120,
  blurb: 'A long road with an overpass, abandoned cars and rooftops.',
  theme: {
    sky: 0xffa45b, fogNear: 60, fogFar: 190, floor: 0x3d405b, grid: 0x4a4e6e,
    hemi: [0xffd3a5, 0x2a2b40, 0.95], sun: [0xffb26b, 1.7], edges: 0x14142b,
    styles: {
      wall:   { color: 0xe07a5f },
      crate:  { color: 0xf2cc8f },
      metal:  { color: 0x81b29a },
      tank:   { color: 0x3a86ff },
      ramp:   { color: 0xf4f1de },
      accent: { color: 0xffd60a },
      edge:   { color: 0x2b2d42 },
      pad:    { color: 0x72efdd, emissive: 0x72efdd, glow: 0.6 },
    },
  },
  build(b) {
    b.box(0, 0, 50, 6, 0.6, 5, 'metal');                     // overpass, top 5.6
    b.ramp(-31, 0, 12, 6, 5.6, '+x');
    b.ramp(31, 0, 12, 6, 5.6, '-x');
    b.cyl(-12, 0, 0.8, 5, 0, 'wall');
    b.cyl(12, 0, 0.8, 5, 0, 'wall');
    b.box(0, -2.85, 50, 0.3, 1, 5.6, 'accent');               // guard rails
    b.box(0, 2.85, 50, 0.3, 1, 5.6, 'accent');
    b.around(2, () => {
      b.box(-4, 18, 2.2, 4.4, 1.4, 0, 'crate');               // cars and a truck
      b.box(5, 30, 2.2, 4.4, 1.4, 0, 'tank');
      b.box(-5, 44, 2.6, 8, 3, 0, 'metal');
      b.box(-30, 30, 14, 14, 10, 0, 'wall');                  // buildings
      b.box(30, 40, 12, 16, 7, 0, 'wall');
      b.box(34, 16, 10, 8, 4, 0, 'wall');                     // low building, top 4
      b.stairs(29, 16, '-x', 10, 0.4, 0.6, 3);
      b.cyl(-18, 50, 0.4, 6, 0, 'metal');                     // billboard
      b.box(-18, 50, 8, 0.4, 4, 6, 'accent');
      b.box(-12, 24, 0.6, 6, 1.1, 0, 'ramp');                 // road barriers
      b.box(12, 48, 0.6, 6, 1.1, 0, 'ramp');
    });
  },
});

// =====================================================================
// CLOSE-RANGE MAPS
// =====================================================================

defineMap({
  id: 'hedge-maze', name: 'Hedge Maze', tag: 'Close range', size: 52,
  blurb: 'Tight hedge corridors around a fountain. Some hedges are low enough to jump.',
  theme: {
    sky: 0xbde0fe, fogNear: 30, fogFar: 90, floor: 0xddb892, grid: 0xc9a47c,
    hemi: [0xffffff, 0x6b4f2f, 1.0], sun: [0xfff6e0, 1.7], edges: 0x081c15,
    styles: {
      wall:   { color: 0x2d6a4f },
      crate:  { color: 0x95d5b2 },
      metal:  { color: 0x1b4332 },
      tank:   { color: 0xf1faee },
      ramp:   { color: 0xddb892 },
      accent: { color: 0xff70a6 },
      edge:   { color: 0x40916c },
      pad:    { color: 0xff70a6, emissive: 0xff70a6, glow: 0.6 },
    },
  },
  build(b) {
    const N = 8, C = 6, origin = -24;
    const rand = seededRandom(7);
    // Walls between cells: right[i][j] (between i and i+1), down[i][j] (between j and j+1)
    const right = Array.from({ length: N }, () => Array(N).fill(true));
    const down = Array.from({ length: N }, () => Array(N).fill(true));
    const seen = Array.from({ length: N }, () => Array(N).fill(false));
    // Carve a maze (every cell reachable)
    const stack = [[0, 0]];
    seen[0][0] = true;
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const options = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([di, dj]) => [i + di, j + dj, di, dj])
        .filter(([a, c]) => a >= 0 && a < N && c >= 0 && c < N && !seen[a][c]);
      if (!options.length) { stack.pop(); continue; }
      const [a, c, di, dj] = options[Math.floor(rand() * options.length)];
      if (di === 1) right[i][j] = false;
      if (di === -1) right[a][c] = false;
      if (dj === 1) down[i][j] = false;
      if (dj === -1) down[a][c] = false;
      seen[a][c] = true;
      stack.push([a, c]);
    }
    // Open the middle 2×2 cells into a fountain courtyard
    right[3][3] = right[3][4] = down[3][3] = down[4][3] = false;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i < N - 1 && right[i][j] && rand() > 0.22) {      // remove some walls to make loops
          const low = rand() < 0.18;
          b.box(origin + (i + 1) * C, origin + (j + 0.5) * C, 0.8, C + 0.8, low ? 1.1 : 3.5, 0, low ? 'crate' : 'wall');
        }
        if (j < N - 1 && down[i][j] && rand() > 0.22) {
          const low = rand() < 0.18;
          b.box(origin + (i + 0.5) * C, origin + (j + 1) * C, C + 0.8, 0.8, low ? 1.1 : 3.5, 0, low ? 'crate' : 'wall');
        }
      }
    }
    b.cyl(0, 0, 1.8, 0.8, 0, 'tank');                         // fountain
    b.prism(0, 0, 0.6, 6, 2, 0, 0.8, 'accent');
  },
});

defineMap({
  id: 'warehouse', name: 'Warehouse', tag: 'Close range', size: 60,
  blurb: 'Rows of tall shelves you can climb, with loading docks at each end.',
  theme: {
    sky: 0x22223b, fogNear: 30, fogFar: 95, floor: 0x4a4e69, grid: 0x5a5e7c,
    hemi: [0xf2e9e4, 0x22223b, 1.0], sun: [0xffe8cc, 1.4], edges: 0x0d0d16,
    styles: {
      wall:   { color: 0xc9ada7 },
      crate:  { color: 0xf4a261 },
      metal:  { color: 0x2a9d8f },
      tank:   { color: 0xe76f51 },
      ramp:   { color: 0xf2e9e4 },
      accent: { color: 0xffd166 },
      edge:   { color: 0x343650 },
      pad:    { color: 0x06d6a0, emissive: 0x06d6a0, glow: 0.6 },
    },
  },
  build(b) {
    for (const x of [-20, -12, 12, 20]) {                     // shelving, top 5
      b.box(x, -8, 2, 12, 5);
      b.box(x, 8, 2, 12, 5);
    }
    b.box(-16, -8, 6, 1.2, 0.3, 4.7, 'metal');                 // planks between shelf tops
    b.box(16, 8, 6, 1.2, 0.3, 4.7, 'metal');
    b.around(2, () => {
      b.stairs(-20, -14, '-z', 4, 1.2, 1.2, 2, 'crate');       // crate steps up to the shelves
      b.stairs(12, -14, '-z', 4, 1.2, 1.2, 2, 'crate');
      b.box(-6, 23, 12, 3, 2.6, 0, 'metal');                   // loading dock container
      b.ramp(3, 23, 6, 3, 2.6, '-x');
      b.box(14, 24, 3, 8, 2.6, 0, 'tank');
      b.box(3, -6, 2, 3, 1.6, 0, 'accent');                    // forklift
      b.box(-4, -3, 2, 2, 2.4, 0, 'crate');
      b.cyl(6, -12, 0.6, 1.2);
      b.cyl(7.3, -12.6, 0.6, 1.2);
    });
  },
});

defineMap({
  id: 'bunker-rooms', name: 'Bunker Rooms', tag: 'Close range', size: 56,
  blurb: 'Four walled rooms with doorways and sandbag lines between them.',
  theme: {
    sky: 0x8d99ae, fogNear: 35, fogFar: 100, floor: 0x5c6b4e, grid: 0x4f5d42,
    hemi: [0xedf2f4, 0x3a4530, 1.0], sun: [0xfff3df, 1.6], edges: 0x111111,
    styles: {
      wall:   { color: 0xadb5bd },
      crate:  { color: 0x9c6644 },
      metal:  { color: 0x2b2d42 },
      tank:   { color: 0xef233c },
      ramp:   { color: 0xd4a373 },
      accent: { color: 0xef233c },
      edge:   { color: 0x6c757d },
      pad:    { color: 0xffd60a, emissive: 0xffd60a, glow: 0.6 },
    },
  },
  build(b) {
    b.cyl(0, 0, 2, 3, 0, 'tank');
    b.around(4, () => {
      b.box(10, 8, 4, 0.6, 4);                                // room with two doors
      b.box(18, 8, 4, 0.6, 4);
      b.box(8, 10, 0.6, 4, 4);
      b.box(8, 18, 0.6, 4, 4);
      b.box(14, 20, 12.6, 0.6, 4);
      b.box(20, 14, 0.6, 12.6, 4);
      b.box(17, 17, 2, 2, 1.2, 0, 'crate');
      b.box(11.5, 16.5, 1.2, 3, 1, 0, 'metal');
      b.box(24, 4, 4, 1, 1.1, 0, 'ramp');                     // sandbags
      b.box(0, 24, 6, 0.6, 1.2, 0, 'crate');
      b.box(4, 12, 0.6, 3, 1.2, 0, 'crate');
      b.box(24.5, 24.5, 3, 3, 3, 0, 'metal');
    });
  },
});

defineMap({
  id: 'pillar-hall', name: 'Pillar Hall', tag: 'Close range', size: 52,
  blurb: 'A hall packed with columns around a raised dais, with balconies on every side.',
  theme: {
    sky: 0x240046, fogNear: 30, fogFar: 90, floor: 0x3c096c, grid: 0x5a189a,
    hemi: [0xe0aaff, 0x240046, 0.9], sun: [0xffe5a8, 1.3], edges: 0xffd60a,
    styles: {
      wall:   { color: 0xffd60a, emissive: 0xffaa00, glow: 0.12 },
      crate:  { color: 0xff006e, emissive: 0xff006e, glow: 0.25 },
      metal:  { color: 0x7b2cbf },
      tank:   { color: 0xc77dff },
      ramp:   { color: 0xe0aaff },
      accent: { color: 0xff006e, emissive: 0xff006e, glow: 0.3 },
      edge:   { color: 0x10002b, emissive: 0x7b2cbf, glow: 0.3 },
      pad:    { color: 0x00f5d4, emissive: 0x00f5d4, glow: 0.7 },
    },
  },
  build(b) {
    b.prism(0, 0, 7, 8, 0.45, Math.PI / 8, 0, 'ramp');         // dais, two low steps
    b.prism(0, 0, 5.5, 8, 0.9, Math.PI / 8, 0, 'ramp');
    b.prism(0, 0, 0.8, 4, 2, Math.PI / 4, 0.9, 'accent');      // statue
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        if (Math.abs(i) <= 1 && Math.abs(j) <= 1) continue;
        const x = i * 6.5, z = j * 6.5;
        if ((i + j) % 2 === 0) b.cyl(x, z, 0.9, 6, 0, 'wall');
        else b.prism(x, z, 1, 6, 6, 0, 0, 'metal');
      }
    }
    b.around(4, () => {
      b.box(22, 0, 4, 16, 0.4, 3.6, 'metal');                  // balcony, top 4
      b.ramp(22, 12, 3, 8, 4, '-z');
      b.box(23.8, 0, 0.3, 16, 1, 4, 'crate');                  // balcony rail
    });
  },
});
