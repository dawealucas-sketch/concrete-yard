// server.js — runs the game. Start it with: npm start
//
// What the server does:
//   1. Serves the web page (the files in /public) to each player's browser.
//   2. Keeps the list of players: kit, health, kills and deaths.
//   3. Decides whether shots hit (so players can't simply claim a kill).
//   4. Sends everyone's positions to everyone else 20 times per second.
//   5. Runs rounds: play one map, show results, vote on 4 random maps, repeat.

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import { MAPS, EYE_HEIGHT, raycastMap, setActiveMap, getMap } from './public/map.js';
import { KITS, DEFAULT_KIT } from './public/kits.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---- Game settings (kit-specific numbers are in public/kits.js) ----
const MAX_PLAYERS = 20;
const TICK_RATE = 20;          // position updates sent per second
const RESPAWN_MS = 3000;       // minimum time on the death screen
const SHOT_RANGE = 180;        // long enough to cross the biggest maps
const MAX_SPEED = 12;          // units per second; faster movement is rejected
const FIRE_TOLERANCE_MS = 30;  // allows for small network timing differences

// ---- Round settings ----
// To test rounds quickly, change ROUND_MINUTES to 1 (then change it back).
const ROUND_MINUTES = Number(process.env.ROUND_MINUTES) || 15;
const INTERMISSION_SECONDS = Number(process.env.INTERMISSION_SECONDS) || 25; // results and map vote
const VOTE_CHOICES = 4;          // maps offered in each vote

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
// Make the three.js library available to the browser at /three/...
app.use('/three', express.static(path.join(__dirname, 'node_modules/three/build')));

// All connected players, keyed by their socket id
const players = {};

// The current round
const round = {
  phase: 'playing',  // 'playing' or 'intermission'
  mapId: MAPS[Math.floor(Math.random() * MAPS.length)].id,
  endsAt: 0,
  results: [],       // final ranking shown on the results screen
  options: [],       // map ids offered in the vote
};
round.endsAt = Date.now() + ROUND_MINUTES * 60000;
setActiveMap(round.mapId);

function secondsLeft() {
  return Math.max(0, Math.ceil((round.endsAt - Date.now()) / 1000));
}

// Spawn at the open point farthest from other living players
function pickSpawn() {
  const spawns = getMap(round.mapId).spawns;
  const living = Object.values(players).filter((p) => p.alive);
  let best = spawns[0], bestDist = -1;
  for (const s of spawns) {
    const nearest = living.length
      ? Math.min(...living.map((p) => Math.hypot(p.x - s.x, p.z - s.z)))
      : Math.random() * 100; // nobody around: pick any
    if (nearest > bestDist) { bestDist = nearest; best = s; }
  }
  return { x: best.x, y: EYE_HEIGHT, z: best.z };
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
  Object.assign(p, pickSpawn(), {
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

// Follows one bullet and reports the first player it hits (if any) before a wall.
function traceShot(origin, dir, shooterId) {
  let distance = raycastMap(origin, dir, SHOT_RANGE); // nearest wall, pillar, ramp or bridge

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

// ---- Rounds ----

function ranked() {
  return Object.values(players).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.joinedAt - b.joinedAt);
}

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function tallyVotes() {
  const counts = Object.fromEntries(round.options.map((id) => [id, 0]));
  for (const p of Object.values(players)) if (p.vote in counts) counts[p.vote] += 1;
  return counts;
}

function intermissionInfo() {
  return { results: round.results, options: round.options, votes: tallyVotes(), secondsLeft: secondsLeft() };
}

function endRound() {
  const list = ranked();
  const others = MAPS.filter((m) => m.id !== round.mapId).map((m) => m.id);
  if (!list.length) { // nobody playing: switch quietly
    startRound(others[Math.floor(Math.random() * others.length)]);
    return;
  }
  round.phase = 'intermission';
  round.endsAt = Date.now() + INTERMISSION_SECONDS * 1000;
  round.results = list.map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, kit: p.kit, kills: p.kills, deaths: p.deaths }));
  round.options = shuffled(others).slice(0, VOTE_CHOICES);
  for (const p of list) { p.alive = false; p.vote = null; }
  io.emit('intermission', intermissionInfo());
  const top = list[0];
  io.emit('feed', top.kills > 0 ? `Round over. ${top.name} wins!` : 'Round over.');
}

function finishVote() {
  const counts = tallyVotes();
  const most = Math.max(...Object.values(counts));
  const leaders = round.options.filter((id) => counts[id] === most);
  startRound(leaders[Math.floor(Math.random() * leaders.length)]);
}

function startRound(mapId) {
  round.phase = 'playing';
  round.mapId = mapId;
  round.endsAt = Date.now() + ROUND_MINUTES * 60000;
  round.options = [];
  setActiveMap(mapId);
  io.emit('map', { mapId, phase: round.phase, secondsLeft: secondsLeft() });
  for (const p of Object.values(players)) {
    p.kills = 0;
    p.deaths = 0;
    p.vote = null;
    p.alive = false; // so spawns spread out as each player is placed
  }
  for (const p of Object.values(players)) {
    spawnPlayer(p, p.kit);
    io.to(p.id).emit('spawned', { x: p.x, y: p.y, z: p.z, kit: p.kit, id: p.id });
  }
  io.emit('feed', `Now playing: ${getMap(mapId).name}`);
}

// ---- Connections ----

io.on('connection', (socket) => {
  socket.emit('map', { mapId: round.mapId, phase: round.phase, secondsLeft: secondsLeft() });

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
      joinedAt: Date.now(),
      vote: null,
    };
    io.emit('feed', `${p.name} joined as ${KITS[validKit(data && data.kit)].name}`);

    if (round.phase === 'intermission') {
      // Joined between rounds: wait on the results screen, spawn when the next map starts
      p.kit = validKit(data && data.kit);
      Object.assign(p, { x: 0, y: EYE_HEIGHT, z: 0, alive: false, maxHealth: KITS[p.kit].maxHealth, health: 0 });
      players[socket.id] = p;
      socket.emit('waiting', { id: socket.id, kit: p.kit });
      socket.emit('intermission', intermissionInfo());
      return;
    }
    spawnPlayer(p, data && data.kit);
    players[socket.id] = p;
    socket.emit('spawned', { x: p.x, y: p.y, z: p.z, kit: p.kit, id: socket.id });
  });

  // From the death screen: "Continue" sends the same kit, "Change kit" sends a new one
  socket.on('respawn', (kitId) => {
    const p = players[socket.id];
    if (!p || p.alive || round.phase !== 'playing' || Date.now() < p.canRespawnAt) return;
    spawnPlayer(p, kitId);
    socket.emit('spawned', { x: p.x, y: p.y, z: p.z, kit: p.kit, id: socket.id });
  });

  // Vote for the next map between rounds
  socket.on('vote', (mapId) => {
    const p = players[socket.id];
    if (!p || round.phase !== 'intermission' || !round.options.includes(mapId)) return;
    p.vote = mapId;
    io.emit('votes', tallyVotes());
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

    const limit = getMap(round.mapId).size / 2;
    p.x = Math.max(-limit, Math.min(limit, data.x));
    p.z = Math.max(-limit, Math.min(limit, data.z));
    p.y = Math.max(EYE_HEIGHT, Math.min(40, Number(data.y) || EYE_HEIGHT)); // jump pads go high
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
    if (round.phase === 'intermission') io.emit('votes', tallyVotes());
  });
});

// ---- Every tick: round timer, Medic healing, then send everyone the current state ----
setInterval(() => {
  const now = Date.now();
  if (now >= round.endsAt) {
    if (round.phase === 'playing') endRound();
    else finishVote();
  }

  for (const p of Object.values(players)) {
    const regen = KITS[p.kit].regen;
    if (regen && p.alive && p.health < p.maxHealth && now - p.lastDamaged >= regen.delayMs) {
      p.health = Math.min(p.maxHealth, p.health + regen.perSecond / TICK_RATE);
    }
  }

  const list = Object.values(players).map((p) => ({
    id: p.id, name: p.name, kit: p.kit,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    health: Math.ceil(p.health), maxHealth: p.maxHealth,
    alive: p.alive, kills: p.kills, deaths: p.deaths,
  }));
  io.emit('state', { players: list, phase: round.phase, mapId: round.mapId, secondsLeft: secondsLeft() });
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`Game server running at http://localhost:${PORT}`);
});
