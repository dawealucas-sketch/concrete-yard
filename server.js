// server.js — runs the game. Start it with: npm start
//
// What the server does:
//   1. Serves the web page (the files in /public) to each player's browser.
//   2. Keeps the list of players and their health, kills and deaths.
//   3. Decides whether shots hit (so players can't simply claim a kill).
//   4. Sends everyone's positions to everyone else 20 times per second.

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { WALLS, SPAWN_POINTS, ARENA_SIZE, EYE_HEIGHT } from './public/map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---- Game settings (change these to tune the game) ----
const MAX_PLAYERS = 20;
const TICK_RATE = 20;          // position updates sent per second
const MAX_HEALTH = 100;
const BODY_DAMAGE = 25;
const HEAD_DAMAGE = 50;
const FIRE_COOLDOWN_MS = 200;  // minimum time between shots
const RESPAWN_MS = 3000;
const SHOT_RANGE = 100;
const MAX_SPEED = 12;          // units per second; faster movement is rejected

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

// ---- Connections ----

io.on('connection', (socket) => {
  socket.on('join', (name) => {
    if (players[socket.id]) return;
    if (Object.keys(players).length >= MAX_PLAYERS) {
      socket.emit('full');
      socket.disconnect();
      return;
    }

    const spawn = randomSpawn();
    players[socket.id] = {
      id: socket.id,
      name: cleanName(name),
      ...spawn,
      yaw: 0,
      pitch: 0,
      health: MAX_HEALTH,
      alive: true,
      kills: 0,
      deaths: 0,
      lastShot: 0,
      lastMove: Date.now(),
    };

    socket.emit('welcome', { id: socket.id, spawn });
    io.emit('feed', `${players[socket.id].name} joined`);
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

    const now = Date.now();
    if (now - shooter.lastShot < FIRE_COOLDOWN_MS) return;
    shooter.lastShot = now;

    const len = Math.hypot(dirIn.x, dirIn.y, dirIn.z);
    if (!Number.isFinite(len) || len === 0) return;
    const dir = { x: dirIn.x / len, y: dirIn.y / len, z: dirIn.z / len };
    const origin = { x: shooter.x, y: shooter.y, z: shooter.z };

    // Nearest wall in the line of fire
    let wallDist = SHOT_RANGE;
    for (const wall of WALLS) wallDist = Math.min(wallDist, rayHitsWall(origin, dir, wall));

    // Nearest player in front of that wall
    let target = null, targetDist = wallDist, headshot = false;
    for (const other of Object.values(players)) {
      if (other.id === shooter.id || !other.alive) continue;
      const head = { x: other.x, y: other.y, z: other.z };
      const body = { x: other.x, y: other.y - 0.75, z: other.z };
      const headDist = rayHitsSphere(origin, dir, head, 0.3);
      const bodyDist = rayHitsSphere(origin, dir, body, 0.75);
      if (headDist < targetDist) { target = other; targetDist = headDist; headshot = true; }
      if (bodyDist < targetDist) { target = other; targetDist = bodyDist; headshot = false; }
    }

    const end = {
      x: origin.x + dir.x * targetDist,
      y: origin.y + dir.y * targetDist,
      z: origin.z + dir.z * targetDist,
    };
    io.emit('shot', { from: shooter.id, origin, end });

    if (!target) return;

    target.health -= headshot ? HEAD_DAMAGE : BODY_DAMAGE;
    io.to(target.id).emit('hurt', { health: target.health });
    socket.emit('hitmarker', { headshot });

    if (target.health <= 0) {
      target.alive = false;
      target.health = 0;
      target.deaths += 1;
      shooter.kills += 1;
      io.emit('feed', `${shooter.name} eliminated ${target.name}${headshot ? ' (headshot)' : ''}`);
      io.to(target.id).emit('died', { by: shooter.name });

      setTimeout(() => {
        if (!players[target.id]) return; // they left while dead
        Object.assign(target, randomSpawn(), { health: MAX_HEALTH, alive: true, lastMove: Date.now() });
        io.to(target.id).emit('respawn', { x: target.x, y: target.y, z: target.z });
      }, RESPAWN_MS);
    }
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (!p) return;
    delete players[socket.id];
    io.emit('feed', `${p.name} left`);
  });
});

// ---- Send everyone the current state, TICK_RATE times per second ----
setInterval(() => {
  const state = Object.values(players).map((p) => ({
    id: p.id, name: p.name,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: p.health, alive: p.alive, kills: p.kills, deaths: p.deaths,
  }));
  io.emit('state', state);
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Game server running at http://localhost:${PORT}`);
});
