// map.js — the arena layout plus the math for touching and shooting it.
// Both the server (bullet hits) and the browser (drawing, walking, jumping)
// use this file, so any change here applies to both.
//
// Shape types (all measured in metres, y is up, y = bottom of the shape):
//   box    — x, z centre, w (along x), d (along z), h height
//   cyl    — round pillar or tank: x, z centre, r radius, h height
//   prism  — straight-sided pillar: r radius, sides (3 = triangle, 6 = hexagon), rot turn in radians
//   ramp   — wedge you can run up: like a box, rising from 0 to h toward `dir` ('+x', '-x', '+z', '-z')
//   pad    — jump pad: launches you upward with speed `power`

export const ARENA_SIZE = 84;     // the floor runs from -42 to +42 on x and z
export const EYE_HEIGHT = 1.6;    // camera height above your feet
export const BODY_HEIGHT = 1.8;   // used for walking under bridges and bumping your head
export const PLAYER_RADIUS = 0.4; // used for bumping into things
export const STEP_HEIGHT = 0.5;   // you walk straight up anything this high (stairs, ramps)

export const SHAPES = [];

// ---- Helpers for building the map ----
function box(x, z, w, d, h, y = 0, style = 'wall') { SHAPES.push({ type: 'box', x, z, w, d, h, y, style }); }
function cyl(x, z, r, h, y = 0, style = 'tank') { SHAPES.push({ type: 'cyl', x, z, r, h, y, style }); }
function prism(x, z, r, sides, h, rot = 0, y = 0, style = 'crate') { SHAPES.push({ type: 'prism', x, z, r, sides, h, rot, y, style }); }
function ramp(x, z, w, d, h, dir, y = 0, style = 'ramp') { SHAPES.push({ type: 'ramp', x, z, w, d, h, dir, y, style }); }
function pad(x, z, power = 16) { SHAPES.push({ type: 'pad', x, z, r: 1.1, h: 0.15, y: 0, power, style: 'pad' }); }

// Stairs: (x, z) is where the top step meets the platform; they go down toward `dir`.
function stairs(x, z, dir, steps, rise, run, width, style = 'ramp') {
  const sign = dir[0] === '+' ? 1 : -1;
  for (let i = 0; i < steps; i++) {
    const h = rise * (steps - i);
    const offset = sign * run * (i + 0.5);
    if (dir[1] === 'x') box(x + offset, z, run, width, h, 0, style);
    else box(x, z + offset, width, run, h, 0, style);
  }
}

// ======================= THE MAP =======================

// Outer boundary
box(0, -42, 84, 1, 8);
box(0, 42, 84, 1, 8);
box(-42, 0, 1, 84, 8);
box(42, 0, 1, 84, 8);

// ---- Center: hexagon tower with ramps, bridges, side towers ----
prism(0, 0, 5, 6, 5, Math.PI / 6, 0, 'wall');   // hex tower, top at 5
box(0, 0, 1.2, 1.2, 1.2, 5, 'crate');          // crate on top of the tower
ramp(0, 9.3, 3, 10, 5, '-z');                  // ramp up from the south
ramp(0, -9.3, 3, 10, 5, '+z');                 // ramp up from the north
for (const [px, pz] of [[8, 8], [-8, 8], [8, -8], [-8, -8]]) pad(px, pz); // pads around the tower

for (const s of [1, -1]) {
  box(s * 15.1, 0, 21.8, 2.4, 0.4, 4.6, 'metal');  // bridge to the side tower (top at 5)
  cyl(s * 15, 0, 0.45, 4.6, 0, 'metal');           // bridge support
  box(s * 29, 0, 6, 6, 5, 0, 'wall');              // side tower
  stairs(s * 32, 0, s > 0 ? '+x' : '-x', 12, 0.4, 0.6, 3); // stairs up its outer side
  box(s * 30.5, -2.4, 3, 0.4, 1, 5, 'crate');      // low walls on top for cover
  box(s * 30.5, 2.4, 3, 0.4, 1, 5, 'crate');
}

// Mid-field walls
box(0, -22, 10, 1, 3);
box(0, 22, 10, 1, 3);

// ---- Sniper perches reached by a trail of rising pillars (north-east and south-west) ----
for (const s of [1, -1]) {
  const rounds = s > 0; // round pillars on one side, hexagon pillars on the other
  for (let i = 0; i < 5; i++) {
    const px = s * (10 + i * 4.6), pz = -s * 30, h = 1.2 + i;
    if (rounds) cyl(px, pz, 1.2, h, 0, 'metal');
    else prism(px, pz, 1.35, 6, h, 0, 0, 'metal');
  }
  box(s * 34.3, -s * 30, 5.4, 6, 6.2, 0, 'wall');             // the perch, top at 6.2
  box(s * 36.7, -s * 31.8, 0.4, 1.8, 1, 6.2, 'crate');         // cover on the perch
  box(s * 36.7, -s * 28.2, 0.4, 1.8, 1, 6.2, 'crate');
  box(s * 34.3, -s * 32.7, 1.8, 0.4, 1, 6.2, 'crate');

  // Triangle cover and tanks in the same quarter
  prism(s * 12, -s * 14, 1.7, 3, 1.4, 0);
  prism(s * 20, -s * 18, 1.7, 3, 1.4, Math.PI);
  prism(s * 15, -s * 22, 1.5, 3, 2.2, Math.PI / 2, 0, 'wall');
  cyl(s * 27, -s * 12, 2, 3);
  cyl(s * 31.5, -s * 16, 1.4, 2.2);
}

// ---- North-west: stacked containers, high walkway, corner platform, bunker ----
box(-30, -16, 10, 3, 2.6, 0, 'crate');            // container 1, top at 2.6
ramp(-21, -16, 8, 3, 2.6, '-x');                  // ramp onto container 1
box(-29, -19, 2, 2, 3.9, 0, 'metal');             // step block, top at 3.9
box(-33, -21.5, 3, 8, 5.2, 0, 'metal');           // container stack, top at 5.2
box(-33, -31, 2.4, 11, 0.4, 4.8, 'metal');        // high walkway, top at 5.2
cyl(-33, -31, 0.4, 4.8, 0, 'metal');              // walkway support
box(-37, -38, 9, 7, 5.2, 0, 'wall');              // corner platform
box(-39.5, -34.2, 4, 0.4, 1, 5.2, 'crate');       // cover on the corner platform

// Bunker with a roof (open toward the south)
box(-14, -33, 6, 0.5, 2.4);
box(-16.75, -30.5, 0.5, 5, 2.4);
box(-11.25, -30.5, 0.5, 5, 2.4);
box(-14, -30.6, 6, 5.4, 0.4, 2.4, 'metal');

ramp(-12, -12, 3, 1.6, 1.3, '+z', 0, 'crate');     // wedge cover
ramp(-24, -6, 1.6, 3, 1.3, '-x', 0, 'crate');

// ---- South-east: two tanks joined by a sky bridge, bunker ----
cyl(18, 22, 3, 5);                                 // tank A, top at 5
cyl(32, 22, 3, 5);                                 // tank B
box(25, 22, 8.4, 2, 0.4, 4.6, 'metal');            // sky bridge between them
pad(18, 28.5);                                     // pads to reach the tanks
pad(32, 15.5);
box(25, 25, 2, 2, 1.2, 0, 'crate');                // crates under the bridge
box(25, 19, 2, 2, 1.2, 0, 'crate');

// Bunker with a roof (open toward the north)
box(12, 33, 6, 0.5, 2.4);
box(14.75, 30.5, 0.5, 5, 2.4);
box(9.25, 30.5, 0.5, 5, 2.4);
box(12, 30.6, 6, 5.4, 0.4, 2.4, 'metal');

ramp(12, 12, 3, 1.6, 1.3, '-z', 0, 'crate');       // wedge cover
ramp(36, 8, 1.6, 3, 1.3, '+x', 0, 'crate');

// Ground-level spawn points, all checked to be clear of shapes
export const SPAWN_POINTS = [
  { x: 0, z: -36 }, { x: 0, z: 36 }, { x: -38, z: 8 }, { x: 38, z: -8 },
  { x: -20, z: -38 }, { x: 20, z: 38 }, { x: -38, z: -8 }, { x: 38, z: 8 },
  { x: 12, z: -38 }, { x: -12, z: 38 }, { x: 24, z: 4 }, { x: -24, z: -3 },
  { x: 10, z: 10 }, { x: -10, z: -10 },
];

// ======================= SHAPE MATH =======================

// Corner points of a straight-sided pillar, matching how three.js draws it.
// Round pillars use 24 corners for bullet tests (close enough to a circle).
function cornersOf(s) {
  const n = s.type === 'prism' ? s.sides : 24;
  const rot = s.rot || 0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    pts.push({ x: s.x + s.r * Math.sin(a), z: s.z + s.r * Math.cos(a) });
  }
  return pts;
}

// Edge lines of a flat shape as "nx*x + nz*z <= c", with unit-length normals
function edgesOf(pts, cx, cz) {
  const edges = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    let nx = b.z - a.z, nz = -(b.x - a.x);
    const len = Math.hypot(nx, nz);
    nx /= len; nz /= len;
    let c = nx * a.x + nz * a.z;
    if (nx * cx + nz * cz > c) { nx = -nx; nz = -nz; c = -c; } // point outward
    edges.push({ nx, nz, c });
  }
  return edges;
}

// Ramp height at a point, from 0 at the low end to 1 at the high end
function rampFraction(s, x, z) {
  const cx = Math.max(s.x - s.w / 2, Math.min(s.x + s.w / 2, x));
  const cz = Math.max(s.z - s.d / 2, Math.min(s.z + s.d / 2, z));
  switch (s.dir) {
    case '+x': return (cx - (s.x - s.w / 2)) / s.w;
    case '-x': return ((s.x + s.w / 2) - cx) / s.w;
    case '+z': return (cz - (s.z - s.d / 2)) / s.d;
    default:   return ((s.z + s.d / 2) - cz) / s.d;
  }
}

// Each solid shape as a set of flat sides "n · p <= c" (used for bullets)
function planesOf(s) {
  const planes = [{ n: [0, 1, 0], c: s.y + s.h }, { n: [0, -1, 0], c: -s.y }];
  if (s.type === 'box' || s.type === 'ramp') {
    planes.push(
      { n: [1, 0, 0], c: s.x + s.w / 2 }, { n: [-1, 0, 0], c: -(s.x - s.w / 2) },
      { n: [0, 0, 1], c: s.z + s.d / 2 }, { n: [0, 0, -1], c: -(s.z - s.d / 2) },
    );
  }
  if (s.type === 'ramp') {
    const lo = { x: s.x - s.w / 2, z: s.z - s.d / 2 }, hi = { x: s.x + s.w / 2, z: s.z + s.d / 2 };
    const axis = s.dir[1], len = axis === 'x' ? s.w : s.d, k = s.h / len;
    const n = [0, 1, 0], idx = axis === 'x' ? 0 : 2;
    if (s.dir[0] === '+') { n[idx] = -k; planes.push({ n, c: s.y - k * lo[axis] }); }
    else { n[idx] = k; planes.push({ n, c: s.y + k * hi[axis] }); }
  }
  if (s.type === 'cyl' || s.type === 'prism') {
    for (const e of s.edges) planes.push({ n: [e.nx, 0, e.nz], c: e.c });
  }
  return planes;
}

for (const s of SHAPES) {
  if (s.type === 'cyl' || s.type === 'prism') s.edges = edgesOf(cornersOf(s), s.x, s.z);
  if (s.type === 'prism') s.flatEdges = s.edges;
  if (s.type !== 'pad') s.planes = planesOf(s);
}

// Is the point (x, z) over this shape, allowing `margin` extra around it?
export function footprint(s, x, z, margin) {
  switch (s.type) {
    case 'box':
    case 'ramp':
      return Math.abs(x - s.x) < s.w / 2 + margin && Math.abs(z - s.z) < s.d / 2 + margin;
    case 'cyl':
    case 'pad':
      return Math.hypot(x - s.x, z - s.z) < s.r + margin;
    case 'prism': {
      let worst = -Infinity;
      for (const e of s.flatEdges) worst = Math.max(worst, e.nx * x + e.nz * z - e.c);
      return worst < margin;
    }
  }
  return false;
}

// Height of the top surface of a shape at (x, z)
export function topAt(s, x, z) {
  return s.type === 'ramp' ? s.y + s.h * rampFraction(s, x, z) : s.y + s.h;
}

// Distance along a ray to the first solid shape, or maxDist if nothing is hit
export function raycastMap(origin, dir, maxDist) {
  let best = maxDist;
  const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
  for (const s of SHAPES) {
    if (!s.planes) continue;
    let tIn = 0, tOut = best, hit = true;
    for (const { n, c } of s.planes) {
      const denom = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
      const dist = c - (n[0] * o[0] + n[1] * o[1] + n[2] * o[2]);
      if (Math.abs(denom) < 1e-9) {
        if (dist < 0) { hit = false; break; }
        continue;
      }
      const t = dist / denom;
      if (denom < 0) tIn = Math.max(tIn, t);
      else tOut = Math.min(tOut, t);
      if (tIn > tOut) { hit = false; break; }
    }
    if (hit && tIn < best) best = tIn;
  }
  return best;
}

// ---- Movement helpers used by the browser ----

// True if a player at (x, z) with feet at `feet` would be inside something too tall to step onto
export function blockedAt(x, z, feet) {
  for (const s of SHAPES) {
    if (feet + BODY_HEIGHT <= s.y) continue; // passing underneath (bridges, roofs)
    if (!footprint(s, x, z, PLAYER_RADIUS)) continue;
    if (feet < topAt(s, x, z) - STEP_HEIGHT) return true;
  }
  return false;
}

// Highest surface under the player that they could stand on (0 = the floor)
export function groundAt(x, z, feet) {
  let ground = 0, onPad = null;
  for (const s of SHAPES) {
    if (!footprint(s, x, z, PLAYER_RADIUS * 0.5)) continue;
    const top = topAt(s, x, z);
    if (feet >= top - STEP_HEIGHT && top >= ground) {
      ground = top;
      onPad = s.type === 'pad' && Math.hypot(x - s.x, z - s.z) < s.r ? s : null;
    }
  }
  return { ground, pad: onPad };
}

// Bottom of the lowest thing the player's head would hit while rising, or null
export function ceilingAt(x, z, oldFeet, newFeet) {
  let ceiling = null;
  for (const s of SHAPES) {
    if (s.y < oldFeet + BODY_HEIGHT - 0.05 || s.y >= newFeet + BODY_HEIGHT) continue;
    if (!footprint(s, x, z, PLAYER_RADIUS * 0.5)) continue;
    if (ceiling === null || s.y < ceiling) ceiling = s.y;
  }
  return ceiling;
}
