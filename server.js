// server.js — runs the game. Start it with: npm start
//
// What the server does:
//   1. Serves the web page (the files in /public) to each player's browser.
//   2. Keeps the list of players: kit, health, kills and deaths.
//   3. Decides whether shots hit (so players can't simply claim a kill).
//   4. Sends everyone's positions to everyone else 20 times per second.

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { WALLS, SPAWN_POINTS, ARENA_SIZE, EYE_HEIGHT } from './public/map.js';
import { KITS, DEFAULT_KIT } from './public/kits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---- Game settings (kit-specific numbers are in public/kits.js) ----
const MAX_PLAYERS = 20;
const TICK_RATE = 20;          // position updates sent per second
const RESPAWN_MS = 3000;       // minimum time on the death screen
const SHOT_RANGE = 100;
const MAX_SPEED = 12;          // units per second; faster movement is rejected
const FIRE_TOLERANCE_MS = 30;  // allows for small network timing differences

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
// Make the three.js library available to the browser at /three/...
app.use('/three', express.static(path.join(__dirname, 'node_modules/three/build')));

// All connected players, keyed by their socket id
const players = {};

function randomSpawn() {
  const s = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  return { x: s.x, y: EYE_HEIGHT, z: s.z };
}

function cleanName(name) {
  const text = String(name || '').replace(/[^\w \-]/g, '').trim().slice(0, 16);
  return text || 'Player';
}

function validKit(kitId) {
  return Object.hasOwn(KITS, kitId) ? kitId : DEFAULT_KIT;
}

// Put a player back into the game with the given kit
function spawnPlayer(p, kitId) {
  p.kit = validKit(kitId);
  const kit = KITS[p.kit];
  Object.assign(p, randomSpawn(), {
    maxHealth: kit.maxHealth,
    health: kit.maxHealth,
    alive: true,
    lastMove: Date.now(),
    lastDamaged: 0,
  });
}

// ---- Ray tests used for hit detection ----

// Returns the distance along the ray to a sphere, or Infinity on a miss.
function rayHitsSphere(origin, dir, center, radius) {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

// Returns the distance along the ray to a wall box, or Infinity on a miss.
function rayHitsWall(origin, dir, wall) {
  const min = { x: wall.x - wall.w / 2, y: 0, z: wall.z - wall.d / 2 };
  const max = { x: wall.x + wall.w / 2, y: wall.h, z: wall.z + wall.d / 2 };
  let tMin = 0, tMax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(dir[axis]) < 1e-8) {
      if (origin[axis] < min[axis] || origin[axis] > max[axis]) return Infinity;
    } else {
      let t1 = (min[axis] - origin[axis]) / dir[axis];
      let t2 = (max[axis] - origin[axis]) / dir[axis];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return Infinity;
    }
  }
  return tMin;
}

// Follows one bullet and reports the first player it hits (if any) before a wall.
function traceShot(origin, dir, shooterId) {
  let distance = SHOT_RANGE;
  for (const wall of WALLS) distance = Math.min(distance, rayHitsWall(origin, dir, wall));

  let target = null, headshot = false;
  for (const other of Object.values(players)) {
    if (other.id === shooterId || !other.alive) continue;
    const headDist = rayHitsSphere(origin, dir, { x: other.x, y: other.y, z: other.z }, 0.3);
    const bodyDist = rayHitsSphere(origin, dir, { x: other.x, y: other.y - 0.75, z: other.z }, 0.75);
    if (headDist < distance) { target = other; distance = headDist; headshot = true; }
    if (bodyDist < distance) { target = other; distance = bodyDist; headshot = false; }
  }

  const end = {
    x: origin.x + dir.x * distance,
    y: origin.y + dir.y * distance,
    z: origin.z + dir.z * distance,
  };
  return { target, headshot, end };
}

// Tilts a direction randomly inside a cone (used for shotgun pellets).
function spreadDirection(dir, angle) {
  // Two directions at right angles to dir
  const up = Math.abs(dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let rx = up.y * dir.z - up.z * dir.y, ry = up.z * dir.x - up.x * dir.z, rz = up.x * dir.y - up.y * dir.x;
  const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
  const ux = dir.y * rz - dir.z * ry, uy = dir.z * rx - dir.x * rz, uz = dir.x * ry - dir.y * rx;

  const r = Math.tan(angle) * Math.sqrt(Math.random());
  const a = Math.random() * Math.PI * 2;
  const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
  const x = dir.x + rx * ox + ux * oy, y = dir.y + ry * ox + uy * oy, z = dir.z + rz * ox + uz * oy;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
}

function applyHit(shooter, target, headshot) {
  if (!target.alive) return;
  const kit = KITS[shooter.kit];
  target.health -= headshot ? kit.headDamage : kit.damage;
  target.lastDamaged = Date.now();
  io.to(target.id).emit('hurt');

  if (kit.lifesteal && shooter.alive) {
    shooter.health = Math.min(shooter.maxHealth, shooter.health + kit.lifesteal);
  }

  if (target.health <= 0) {
    target.alive = false;
    target.health = 0;
    target.deaths += 1;
    target.canRespawnAt = Date.now() + RESPAWN_MS;
    shooter.kills += 1;
    io.emit('feed', `${shooter.name} eliminated ${target.name}${headshot ? ' (headshot)' : ''}`);
    io.to(target.id).emit('died', { by: shooter.name, byKit: KITS[shooter.kit].name, waitMs: RESPAWN_MS });
  }
}

// ---- Connections ----

io.on('connection', (socket) => {
  socket.on('join', (data) => {
    if (players[socket.id]) return;
    if (Object.keys(players).length >= MAX_PLAYERS) {
      socket.emit('full');
      socket.disconnect();
      return;
    }

    const p = {
      id: socket.id,
      name: cleanName(data && data.name),
      yaw: 0, pitch: 0,
      kills: 0, deaths: 0,
      lastShot: 0,
    };
    spawnPlayer(p, data && data.kit);
    players[socket.id] = p;

    socket.emit('spawned', { x: p.x, y: p.y, z: p.z, kit: p.kit, id: socket.id });
    io.emit('feed', `${p.name} joined as ${KITS[p.kit].name}`);
  });

  // From the death screen: "Continue" sends the same kit, "Change kit" sends a new one
  socket.on('respawn', (kitId) => {
    const p = players[socket.id];
    if (!p || p.alive || Date.now() < p.canRespawnAt) return;
    spawnPlayer(p, kitId);
    socket.emit('spawned', { x: p.x, y: p.y, z: p.z, kit: p.kit, id: socket.id });
  });

  // The browser reports where its player is. The server checks it is believable.
  socket.on('move', (data) => {
    const p = players[socket.id];
    if (!p || !p.alive || !data) return;

    const now = Date.now();
    const seconds = Math.max((now - p.lastMove) / 1000, 0.016);
    const dx = data.x - p.x, dz = data.z - p.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // Ignore updates that move too fast (basic anti-teleport check)
    if (!Number.isFinite(distance) || distance > MAX_SPEED * seconds + 0.5) {
      socket.emit('correct', { x: p.x, y: p.y, z: p.z });
      return;
    }

    const limit = ARENA_SIZE / 2;
    p.x = Math.max(-limit, Math.min(limit, data.x));
    p.z = Math.max(-limit, Math.min(limit, data.z));
    p.y = Math.max(EYE_HEIGHT, Math.min(10, Number(data.y) || EYE_HEIGHT));
    p.yaw = Number(data.yaw) || 0;
    p.pitch = Number(data.pitch) || 0;
    p.lastMove = now;
  });

  // The browser says "I fired in this direction". The server works out what was hit.
  socket.on('shoot', (dirIn) => {
    const shooter = players[socket.id];
    if (!shooter || !shooter.alive || !dirIn) return;
    const kit = KITS[shooter.kit];

    const now = Date.now();
    if (now - shooter.lastShot < kit.fireMs - FIRE_TOLERANCE_MS) return;
    shooter.lastShot = now;

    const len = Math.hypot(dirIn.x, dirIn.y, dirIn.z);
    if (!Number.isFinite(len) || len === 0) return;
    const aim = { x: dirIn.x / len, y: dirIn.y / len, z: dirIn.z / len };
    const origin = { x: shooter.x, y: shooter.y, z: shooter.z };

    const pellets = kit.pellets || 1;
    const ends = [];
    let anyHit = false, anyHead = false;

    for (let i = 0; i < pellets; i++) {
      const dir = pellets > 1 ? spreadDirection(aim, kit.spread) : aim;
      const { target, headshot, end } = traceShot(origin, dir, shooter.id);
      ends.push(end);
      if (target) {
        anyHit = true;
        anyHead = anyHead || headshot;
        applyHit(shooter, target, headshot);
      }
    }

    io.emit('shot', { from: shooter.id, origin, ends });
    if (anyHit) socket.emit('hitmarker', { headshot: anyHead });
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (!p) return;
    delete players[socket.id];
    io.emit('feed', `${p.name} left`);
  });
});

// ---- Every tick: Medic healing, then send everyone the current state ----
setInterval(() => {
  const now = Date.now();
  for (const p of Object.values(players)) {
    const regen = KITS[p.kit].regen;
    if (regen && p.alive && p.health < p.maxHealth && now - p.lastDamaged >= regen.delayMs) {
      p.health = Math.min(p.maxHealth, p.health + regen.perSecond / TICK_RATE);
    }
  }

  const state = Object.values(players).map((p) => ({
    id: p.id, name: p.name, kit: p.kit,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: Math.ceil(p.health), maxHealth: p.maxHealth,
    alive: p.alive, kills: p.kills, deaths: p.deaths,
  }));
  io.emit('state', state);
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Game server running at http://localhost:${PORT}`);
});
