// game.js — runs in each player's browser.
//
// What the browser does:
//   1. Draws the arena and other players with three.js.
//   2. Reads keyboard and mouse to move and aim your player.
//   3. Tells the server where you are and when you fire.
//   4. Shows what the server reports: other players, shots, health, scores.

import * as THREE from '/three/three.module.js';
import { WALLS, ARENA_SIZE, EYE_HEIGHT, PLAYER_RADIUS } from './map.js';

// ---- Movement settings ----
const WALK_SPEED = 7;
const JUMP_SPEED = 7;
const GRAVITY = 20;
const MOUSE_SENSITIVITY = 0.0022;
const FIRE_INTERVAL_MS = 200; // matches the server cooldown
const SEND_RATE = 20;         // position updates sent per second

// ---- Page elements ----
const $ = (sel) => document.querySelector(sel);
const startScreen = $('#start');
const healthBox = $('#health');
const crosshair = $('#crosshair');
const feedBox = $('#feed');
const scoreboard = $('#scoreboard');
const deadBox = $('#dead');
const pausedBox = $('#paused');
const damageFlash = $('#damage');

// ---- three.js scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fb4c4);
scene.fog = new THREE.Fog(0x9fb4c4, 30, 90);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
camera.rotation.order = 'YXZ'; // yaw first, then pitch — standard for FPS cameras
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xdfe8ef, 0x5a5348, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(20, 40, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35 });
scene.add(sun);

// Floor
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x8c877c, roughness: 0.95 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(ARENA_SIZE, 30, 0x6f6a60, 0x6f6a60);
grid.position.y = 0.01;
scene.add(grid);

// Walls from the shared map
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 0.9 });
const lowMaterial = new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.7 });
for (const w of WALLS) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), w.h < 2 ? lowMaterial : wallMaterial);
  mesh.position.set(w.x, w.h / 2, w.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// A simple gun model attached to the camera
const gun = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.1, 0.5),
  new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5 })
);
gun.position.set(0.22, -0.2, -0.45);
camera.add(gun);

// ---- Local player state ----
const me = {
  id: null,
  pos: new THREE.Vector3(0, EYE_HEIGHT, 0),
  velY: 0,
  yaw: 0,
  pitch: 0,
  onGround: true,
  alive: false,
};
const keys = {};
let mouseDown = false;
let lastFire = 0;
let joined = false;

// ---- Other players ----
const others = {}; // id -> { group, target, yaw, label }

function colorFromId(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((hash % 360) / 360, 0.55, 0.5);
}

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 34px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(43,46,51,0.75)';
  const width = Math.min(ctx.measureText(text).width + 24, 256);
  ctx.fillRect(128 - width / 2, 8, width, 48);
  ctx.fillStyle = '#f2efe8';
  ctx.fillText(text, 128, 44);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.position.y = 2.2;
  return sprite;
}

// A small health bar that floats above another player and always faces you
function makeHealthBar() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 16;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(1.0, 0.125, 1);
  sprite.position.y = 1.95;
  return { sprite, canvas, texture, value: null };
}

function drawHealthBar(bar, health) {
  if (bar.value === health) return; // only redraw when it changes
  bar.value = health;
  const ctx = bar.canvas.getContext('2d');
  const { width, height } = bar.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(43,46,51,0.8)';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = health > 50 ? '#f2efe8' : health > 25 ? '#e8a33d' : '#c8463c';
  ctx.fillRect(2, 2, (width - 4) * Math.max(0, health) / 100, height - 4);
  // Segment marks every 25 health
  ctx.fillStyle = 'rgba(43,46,51,0.9)';
  for (let i = 1; i < 4; i++) ctx.fillRect(Math.round(width * i / 4) - 1, 0, 2, height);
  bar.texture.needsUpdate = true;
}

function createOther(p) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: colorFromId(p.id), roughness: 0.6 });

  // Sizes line up with the server's hit spheres
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.7, 4, 10), material);
  body.position.y = 0.85;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), material);
  head.position.y = EYE_HEIGHT;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.1, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2b2e33 })
  );
  visor.position.set(0, EYE_HEIGHT + 0.03, -0.24);
  const otherGun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x2b2e33 }));
  otherGun.position.set(0.35, 1.2, -0.35);

  for (const m of [body, head, otherGun]) m.castShadow = true;
  group.add(body, head, visor, otherGun);
  const label = makeLabel(p.name);
  group.add(label);
  const healthBar = makeHealthBar();
  drawHealthBar(healthBar, p.health);
  group.add(healthBar.sprite);
  scene.add(group);

  return {
    group,
    target: new THREE.Vector3(p.x, p.y - EYE_HEIGHT, p.z),
    yaw: p.yaw,
    healthBar,
  };
}

// ---- Shots (tracer lines) ----
const tracers = [];
function drawTracer(from, to, color) {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
  scene.add(line);
  tracers.push({ line, life: 0.12 });
}

// ---- HUD helpers ----
function setHealth(value) {
  const v = Math.max(0, value);
  healthBox.querySelector('.value').textContent = v;
  healthBox.querySelector('.fill').style.width = `${v}%`;
  healthBox.querySelector('.trail').style.width = `${v}%`; // lags behind to show damage taken
  healthBox.classList.toggle('mid', v > 25 && v <= 50);
  healthBox.classList.toggle('low', v <= 25);
}

function addFeed(text) {
  const item = document.createElement('div');
  item.textContent = text;
  feedBox.prepend(item);
  while (feedBox.children.length > 5) feedBox.lastChild.remove();
  setTimeout(() => item.remove(), 5000);
}

function updateScoreboard(state) {
  const rows = [...state].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const tbody = scoreboard.querySelector('tbody');
  tbody.innerHTML = '';
  for (const p of rows) {
    const tr = document.createElement('tr');
    if (p.id === me.id) tr.className = 'me';
    for (const value of [p.name, p.kills, p.deaths]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

// ---- Networking ----
const socket = io();

$('#joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (joined) return;
  socket.emit('join', $('#name').value);
});

socket.on('welcome', ({ id, spawn }) => {
  joined = true;
  me.id = id;
  me.alive = true;
  me.pos.set(spawn.x, spawn.y, spawn.z);
  startScreen.style.display = 'none';
  renderer.domElement.requestPointerLock();
});

socket.on('full', () => {
  $('#error').textContent = 'This match has 20 players. Try again when someone leaves.';
});

socket.on('disconnect', () => {
  if (joined) addFeed('Lost connection to the server. Refresh the page to rejoin.');
});

socket.on('state', (state) => {
  const seen = new Set();
  for (const p of state) {
    seen.add(p.id);
    if (p.id === me.id) continue;
    if (!others[p.id]) others[p.id] = createOther(p);
    const o = others[p.id];
    o.target.set(p.x, p.y - EYE_HEIGHT, p.z);
    o.yaw = p.yaw;
    o.group.visible = p.alive;
    drawHealthBar(o.healthBar, p.health);
  }
  // Remove players who left
  for (const id of Object.keys(others)) {
    if (!seen.has(id)) {
      scene.remove(others[id].group);
      delete others[id];
    }
  }
  updateScoreboard(state);
});

socket.on('shot', ({ from, origin, end }) => {
  if (from === me.id) return; // our own tracer is drawn instantly when we fire
  drawTracer(new THREE.Vector3(origin.x, origin.y - 0.3, origin.z), new THREE.Vector3(end.x, end.y, end.z), 0xffd27a);
});

socket.on('hitmarker', ({ headshot }) => {
  crosshair.className = headshot ? 'head' : 'hit';
  setTimeout(() => (crosshair.className = ''), 150);
});

socket.on('hurt', ({ health }) => {
  setHealth(health);
  damageFlash.style.opacity = 1;
  setTimeout(() => (damageFlash.style.opacity = 0), 150);
});

socket.on('died', ({ by }) => {
  me.alive = false;
  $('#deadText').textContent = `Eliminated by ${by}. Respawning…`;
  deadBox.classList.add('show');
});

socket.on('respawn', ({ x, y, z }) => {
  me.alive = true;
  me.pos.set(x, y, z);
  me.velY = 0;
  setHealth(100);
  deadBox.classList.remove('show');
});

socket.on('correct', ({ x, y, z }) => me.pos.set(x, y, z));
socket.on('feed', addFeed);

setInterval(() => {
  if (!joined || !me.alive) return;
  socket.emit('move', { x: me.pos.x, y: me.pos.y, z: me.pos.z, yaw: me.yaw, pitch: me.pitch });
}, 1000 / SEND_RATE);

// ---- Input ----
const isLocked = () => document.pointerLockElement === renderer.domElement;

renderer.domElement.addEventListener('click', () => {
  if (joined && !isLocked()) renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  pausedBox.classList.toggle('show', joined && !isLocked());
});
document.addEventListener('mousemove', (e) => {
  if (!isLocked()) return;
  me.yaw -= e.movementX * MOUSE_SENSITIVITY;
  me.pitch -= e.movementY * MOUSE_SENSITIVITY;
  me.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, me.pitch));
});
document.addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); scoreboard.classList.add('show'); }
  keys[e.code] = true;
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') scoreboard.classList.remove('show');
  keys[e.code] = false;
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function fire() {
  const now = performance.now();
  if (now - lastFire < FIRE_INTERVAL_MS) return;
  lastFire = now;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  socket.emit('shoot', { x: dir.x, y: dir.y, z: dir.z });

  // Draw our tracer right away so shooting feels responsive
  const start = new THREE.Vector3();
  gun.getWorldPosition(start);
  drawTracer(start, me.pos.clone().addScaledVector(dir, 60), 0xffffff);

  // Small recoil kick on the gun model
  gun.position.z = -0.38;
  setTimeout(() => (gun.position.z = -0.45), 60);
}

// ---- Collision with walls ----
// Highest wall top under the player's feet (0 if standing on the floor).
function groundHeightAt(x, z, feetY) {
  let ground = 0;
  for (const w of WALLS) {
    const inside =
      Math.abs(x - w.x) < w.w / 2 + PLAYER_RADIUS * 0.5 &&
      Math.abs(z - w.z) < w.d / 2 + PLAYER_RADIUS * 0.5;
    if (inside && feetY >= w.h - 0.1) ground = Math.max(ground, w.h);
  }
  return ground;
}

// True if a player standing at (x, z) with feet at feetY overlaps a wall.
function blocked(x, z, feetY) {
  for (const w of WALLS) {
    if (feetY >= w.h - 0.05) continue; // we're above this wall
    if (
      Math.abs(x - w.x) < w.w / 2 + PLAYER_RADIUS &&
      Math.abs(z - w.z) < w.d / 2 + PLAYER_RADIUS
    ) return true;
  }
  return false;
}

function updateMovement(dt) {
  if (!me.alive) return;

  // Direction from keys, rotated by where we are looking
  const forward = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const strafe = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let mx = 0, mz = 0;
  if (forward || strafe) {
    const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
    mx = strafe * cos - forward * sin;
    mz = -strafe * sin - forward * cos;
    const len = Math.hypot(mx, mz);
    mx = (mx / len) * WALK_SPEED * dt;
    mz = (mz / len) * WALK_SPEED * dt;
  }

  // Move one axis at a time so we slide along walls instead of sticking
  const feet = me.pos.y - EYE_HEIGHT;
  if (!blocked(me.pos.x + mx, me.pos.z, feet)) me.pos.x += mx;
  if (!blocked(me.pos.x, me.pos.z + mz, feet)) me.pos.z += mz;

  // Jumping and gravity
  if (keys.Space && me.onGround) { me.velY = JUMP_SPEED; me.onGround = false; }
  me.velY -= GRAVITY * dt;
  me.pos.y += me.velY * dt;

  const ground = groundHeightAt(me.pos.x, me.pos.z, me.pos.y - EYE_HEIGHT) + EYE_HEIGHT;
  if (me.pos.y <= ground) {
    me.pos.y = ground;
    me.velY = 0;
    me.onGround = true;
  } else {
    me.onGround = false;
  }
}

// ---- Main loop ----
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (joined) {
    updateMovement(dt);
    if (mouseDown && isLocked() && me.alive) fire();
  }

  camera.position.copy(me.pos);
  camera.rotation.set(me.pitch, me.yaw, 0);
  gun.visible = me.alive;

  // Smoothly move other players toward their latest known position
  const smoothing = 1 - Math.exp(-15 * dt);
  for (const o of Object.values(others)) {
    o.group.position.lerp(o.target, smoothing);
    o.group.rotation.y = o.yaw;
  }

  // Fade out tracers
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.12);
    if (t.life <= 0) {
      scene.remove(t.line);
      t.line.geometry.dispose();
      t.line.material.dispose();
      tracers.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
