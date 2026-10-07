// map.js — the math for walking on and shooting at the map, shared by the
// server (bullet hits) and the browser (drawing, walking, jumping).
// The maps themselves are in maps.js.

import { MAPS } from './maps.js';
export { MAPS };

export const EYE_HEIGHT = 1.6;    // camera height above your feet
export const BODY_HEIGHT = 1.8;   // used for walking under bridges and bumping your head
export const PLAYER_RADIUS = 0.4; // used for bumping into things
export const STEP_HEIGHT = 0.5;   // you walk straight up anything this high (stairs, ramps)

// The map currently being played. Everything below works on these.
export let SHAPES = [];
export let ACTIVE_MAP = null;

export function getMap(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}

export function setActiveMap(id) {
  ACTIVE_MAP = getMap(id);
  SHAPES = ACTIVE_MAP.shapes;
  return ACTIVE_MAP;
}

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

function prepareShapes(shapes) {
  for (const s of shapes) {
    if (s.type === 'cyl' || s.type === 'prism') s.edges = edgesOf(cornersOf(s), s.x, s.z);
    if (s.type === 'prism') s.flatEdges = s.edges;
    if (s.type !== 'pad') s.planes = planesOf(s);
  }
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

// ---- Spawn points, picked automatically for each map ----
// Looks for open ground (nothing nearby, nothing low overhead, not on a pad),
// then picks 14 points spread as far apart as possible.
function findSpawns(map) {
  const half = map.size / 2 - 3;
  const open = [];
  for (let x = -half; x <= half; x += 2) {
    for (let z = -half; z <= half; z += 2) {
      const clear = map.shapes.every((s) => !footprint(s, x, z, 1.4) || s.y >= 3);
      if (clear) open.push({ x, z });
    }
  }
  if (!open.length) return [{ x: 0, z: 0 }];
  const picked = [open.reduce((a, p) => (p.x + p.z < a.x + a.z ? p : a))];
  while (picked.length < 14 && picked.length < open.length) {
    let best = null, bestDist = -1;
    for (const p of open) {
      const d = Math.min(...picked.map((q) => Math.hypot(p.x - q.x, p.z - q.z)));
      if (d > bestDist) { bestDist = d; best = p; }
    }
    picked.push(best);
  }
  return picked;
}

for (const map of MAPS) {
  prepareShapes(map.shapes);
  map.spawns = findSpawns(map);
}
setActiveMap(MAPS[0].id);
