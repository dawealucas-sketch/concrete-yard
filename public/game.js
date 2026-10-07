// game.js — runs in each player's browser.
//
// What the browser does:
//   1. Draws the arena and other players with three.js.
//   2. Reads keyboard and mouse to move and aim your player.
//   3. Tells the server where you are and when you fire.
//   4. Shows what the server reports: other players, shots, health, scores.
//   5. Draws whichever map the server is on, and the results and vote between rounds.

import * as THREE from '/three/three.module.js';
import { MAPS, EYE_HEIGHT, BODY_HEIGHT, blockedAt, groundAt, ceilingAt, raycastMap, setActiveMap, getMap } from './map.js';
import { KITS, DEFAULT_KIT } from './kits.js';

// ---- Movement settings (speed, jumps and fire rate come from the kit) ----
const JUMP_SPEED = 7;
const GRAVITY = 20;
const MOUSE_SENSITIVITY = 0.0022;
const NORMAL_FOV = 75;
const ZOOM_FOV = 22;
const SEND_RATE = 20;         // position updates sent per second

// ---- Page elements ----
const $ = (sel) => document.querySelector(sel);
const startScreen = $('#startScreen');
const deathScreen = $('#deathScreen');
const kitScreen = $('#kitScreen');
const healthBox = $('#health');
const crosshair = $('#crosshair');
const scopeOverlay = $('#scope');
const feedBox = $('#feed');
const scoreboard = $('#scoreboard');
const pausedBox = $('#paused');
const damageFlash = $('#damage');
const intermissionScreen = $('#intermission');
const roundInfo = $('#roundInfo');

// ---- three.js scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.Fog(0x000000, 40, 120);

const camera = new THREE.PerspectiveCamera(NORMAL_FOV, window.innerWidth / window.innerHeight, 0.05, 300);
camera.rotation.order = 'YXZ'; // yaw first, then pitch — standard for FPS cameras
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
scene.add(sun.target);

// ---- Drawing maps ----

// A wedge: rises from 0 at one end to h at the other
function rampGeometry(s) {
  const hw = s.w / 2, hd = s.d / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]; // A, B, C, D
  const heightAt = ([x, z]) => {
    const t = s.dir === '+x' ? (x + hw) / s.w : s.dir === '-x' ? (hw - x) / s.w
            : s.dir === '+z' ? (z + hd) / s.d : (hd - z) / s.d;
    return s.h * t;
  };
  const bottom = corners.map(([x, z]) => [x, 0, z]);
  const top = corners.map((c) => [c[0], heightAt(c), c[1]]);
  const [A, B, C, D] = [0, 1, 2, 3];
  const tris = [
    [top[A], top[D], top[C]], [top[A], top[C], top[B]],                // sloped top
    [bottom[A], bottom[C], bottom[D]], [bottom[A], bottom[B], bottom[C]], // underside
  ];
  for (const [p, q] of [[A, B], [B, C], [C, D], [D, A]]) {             // four sides
    tris.push([bottom[p], top[p], top[q]], [bottom[p], top[q], bottom[q]]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(2), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function shapeGeometry(s) {
  switch (s.type) {
    case 'box':   return new THREE.BoxGeometry(s.w, s.h, s.d);
    case 'cyl':   return new THREE.CylinderGeometry(s.r, s.r, s.h, 32);
    case 'pad':   return new THREE.CylinderGeometry(s.r, s.r * 1.1, s.h, 32);
    case 'ramp':  return rampGeometry(s);
    case 'prism': { // flat faces so triangles and hexagons have crisp sides
      const geometry = new THREE.CylinderGeometry(s.r, s.r, s.h, s.sides).toNonIndexed();
      geometry.computeVertexNormals();
      return geometry;
    }
  }
}

let mapGroup = null;
let padMaterial = null;
let currentMapId = null;

function loadMap(mapId) {
  if (mapId === currentMapId) return;
  const map = setActiveMap(mapId);
  currentMapId = map.id;
  const t = map.theme;

  // Remove the old map
  if (mapGroup) {
    scene.remove(mapGroup);
    mapGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  mapGroup = new THREE.Group();

  // Sky, fog and lights
  scene.background.setHex(t.sky);
  scene.fog.color.setHex(t.sky);
  scene.fog.near = t.fogNear;
  scene.fog.far = t.fogFar;
  hemi.color.setHex(t.hemi[0]);
  hemi.groundColor.setHex(t.hemi[1]);
  hemi.intensity = t.hemi[2];
  sun.color.setHex(t.sun[0]);
  sun.intensity = t.sun[1];
  const half = map.size / 2 + 4;
  sun.position.set(map.size * 0.3, 70, map.size * 0.2);
  Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 220 });
  sun.shadow.camera.updateProjectionMatrix();

  // Floor and grid
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(map.size, map.size),
    new THREE.MeshStandardMaterial({ color: t.floor, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  const grid = new THREE.GridHelper(map.size, Math.round(map.size / 2), t.grid, t.grid);
  grid.position.y = 0.01;
  mapGroup.add(floor, grid);

  // One material per style in the theme, plus outline lines around every shape
  const materials = {};
  for (const [style, v] of Object.entries(t.styles)) {
    materials[style] = new THREE.MeshStandardMaterial({
      color: v.color,
      emissive: v.emissive ?? 0x000000,
      emissiveIntensity: v.glow ?? 0,
      roughness: 0.75,
      metalness: style === 'metal' ? 0.25 : 0.05,
    });
  }
  padMaterial = materials.pad;
  const edgeMaterial = new THREE.LineBasicMaterial({ color: t.edges });

  for (const s of map.shapes) {
    const geometry = shapeGeometry(s);
    const mesh = new THREE.Mesh(geometry, materials[s.style] || materials.wall);
    // Ramps are built from their base; everything else is centred
    mesh.position.set(s.x, s.type === 'ramp' ? s.y : s.y + s.h / 2, s.z);
    if (s.type === 'prism') mesh.rotation.y = s.rot;
    mesh.castShadow = s.type !== 'pad';
    mesh.receiveShadow = true;
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), edgeMaterial));
    mapGroup.add(mesh);
  }
  scene.add(mapGroup);

  roundInfo.querySelector('.map').textContent = map.name;
  $('#nowPlaying').innerHTML = '';
  const label = document.createElement('strong');
  label.textContent = map.name;
  $('#nowPlaying').append('Now playing: ', label, ` (${map.tag.toLowerCase()})`);
}

loadMap(MAPS[0].id); // replaced as soon as the server says which map is on

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
  jumpsLeft: 0,
  alive: false,
  kit: DEFAULT_KIT,
};
const keys = {};
let mouseDown = false;
let zoomed = false;
let lastFire = 0;
let joined = false;
let chosenKit = DEFAULT_KIT; // the kit highlighted in the menus
let healthMax = null;        // used to redraw the segment marks when it changes

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

function drawHealthBar(bar, health, maxHealth) {
  const key = `${health}/${maxHealth}`;
  if (bar.value === key) return; // only redraw when it changes
  bar.value = key;
  const fraction = Math.max(0, health) / maxHealth;
  const ctx = bar.canvas.getContext('2d');
  const { width, height } = bar.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(43,46,51,0.8)';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = fraction > 0.5 ? '#f2efe8' : fraction > 0.25 ? '#e8a33d' : '#c8463c';
  ctx.fillRect(2, 2, (width - 4) * fraction, height - 4);
  // Segment marks every 25 health
  ctx.fillStyle = 'rgba(43,46,51,0.9)';
  for (let hp = 25; hp < maxHealth; hp += 25) ctx.fillRect(Math.round(width * hp / maxHealth) - 1, 0, 2, height);
  bar.texture.needsUpdate = true;
}

function createOther(p) {
  const group = new THREE.Group();
  const color = colorFromId(p.id);
  const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.6 });

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
  drawHealthBar(healthBar, p.health, p.maxHealth);
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
function setHealth(value, maxHealth) {
  const v = Math.max(0, value);
  const percent = (v / maxHealth) * 100;
  healthBox.querySelector('.value').textContent = v;
  healthBox.querySelector('.fill').style.width = `${percent}%`;
  healthBox.querySelector('.trail').style.width = `${percent}%`; // lags behind to show damage taken
  healthBox.classList.toggle('mid', percent > 25 && percent <= 50);
  healthBox.classList.toggle('low', percent <= 25);

  // One segment per 25 health, so a 150-health Tank shows six segments
  if (healthMax !== maxHealth) {
    healthMax = maxHealth;
    const ticks = healthBox.querySelector('.ticks');
    ticks.innerHTML = '';
    for (let hp = 25; hp < maxHealth; hp += 25) {
      const mark = document.createElement('span');
      mark.style.left = `${(hp / maxHealth) * 100}%`;
      ticks.appendChild(mark);
    }
  }
}

// ---- Kit menus ----
function buildKitPicker(container, onChange) {
  for (const [id, kit] of Object.entries(KITS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'kit';
    button.dataset.kit = id;
    button.innerHTML = '<span class="kit-name"></span><span class="plus"></span><span class="minus"></span>';
    button.querySelector('.kit-name').textContent = kit.name;
    button.querySelector('.plus').textContent = kit.strength;
    button.querySelector('.minus').textContent = kit.weakness;
    button.addEventListener('click', () => onChange(id));
    container.appendChild(button);
  }
}

function selectKit(id) {
  chosenKit = id;
  for (const button of document.querySelectorAll('.kit')) {
    button.setAttribute('aria-pressed', String(button.dataset.kit === id));
  }
  $('#respawnButton').textContent = `Respawn as ${KITS[id].name}`;
}

buildKitPicker($('#startKits'), selectKit);
buildKitPicker($('#respawnKits'), selectKit);
selectKit(DEFAULT_KIT);

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
    for (const value of [p.name, KITS[p.kit].name, p.kills, p.deaths]) {
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
  socket.emit('join', { name: $('#name').value, kit: chosenKit });
});

// Sent when we first join and every time we respawn
socket.on('spawned', ({ id, x, y, z, kit }) => {
  joined = true;
  me.id = id;
  me.alive = true;
  me.kit = kit;
  me.pos.set(x, y, z);
  me.velY = 0;
  me.jumpsLeft = KITS[kit].jumps;
  healthBox.querySelector('.kit-label').textContent = KITS[kit].name;
  setHealth(KITS[kit].maxHealth, KITS[kit].maxHealth);
  setZoom(false);
  startScreen.classList.remove('show');
  deathScreen.classList.remove('show');
  kitScreen.classList.remove('show');
  intermissionScreen.classList.remove('show');
  clearInterval(intermissionTimer);
  lockMouse();
});

// Capture the mouse for aiming. If the browser refuses (it sometimes does
// right after a menu), show "Click to resume" so one click fixes it.
function lockMouse() {
  try {
    const request = renderer.domElement.requestPointerLock();
    if (request && request.catch) request.catch(() => {});
  } catch (err) { /* handled by the message below */ }
  pausedBox.classList.toggle('show', !isLocked());
}

socket.on('full', () => {
  $('#error').textContent = 'This match has 20 players. Try again when someone leaves.';
});

socket.on('disconnect', () => {
  if (joined) addFeed('Lost connection to the server. Refresh the page to rejoin.');
});

socket.on('state', ({ players: state, phase, mapId, secondsLeft }) => {
  loadMap(mapId);
  showRoundTime(phase, secondsLeft);
  const seen = new Set();
  for (const p of state) {
    seen.add(p.id);
    if (p.id === me.id) {
      if (me.alive) setHealth(p.health, p.maxHealth);
      continue;
    }
    if (!others[p.id]) others[p.id] = createOther(p);
    const o = others[p.id];
    o.target.set(p.x, p.y - EYE_HEIGHT, p.z);
    o.yaw = p.yaw;
    o.group.visible = p.alive;
    drawHealthBar(o.healthBar, p.health, p.maxHealth);
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

socket.on('shot', ({ from, origin, ends }) => {
  // Our own single-bullet shots are drawn instantly when we fire.
  // Shotgun pellets are drawn from here, because the server picks their spread.
  if (from === me.id && ends.length === 1) return;
  const start = new THREE.Vector3(origin.x, origin.y - 0.3, origin.z);
  if (from === me.id) gun.getWorldPosition(start);
  for (const end of ends) {
    drawTracer(start, new THREE.Vector3(end.x, end.y, end.z), from === me.id ? 0xffffff : 0xffd27a);
  }
});

socket.on('hitmarker', ({ headshot }) => {
  crosshair.className = headshot ? 'head' : 'hit';
  setTimeout(() => (crosshair.className = ''), 150);
});

socket.on('hurt', () => {
  damageFlash.style.opacity = 1;
  setTimeout(() => (damageFlash.style.opacity = 0), 150);
});

socket.on('died', ({ by, byKit, waitMs }) => {
  me.alive = false;
  mouseDown = false;
  setZoom(false);
  document.exitPointerLock();
  selectKit(me.kit);

  $('#deathTitle').textContent = `Eliminated by ${by} (${byKit})`;
  const continueButton = $('#continueButton');
  const changeButton = $('#changeKitButton');
  continueButton.textContent = `Continue as ${KITS[me.kit].name}`;
  continueButton.disabled = true;
  changeButton.disabled = true;
  deathScreen.classList.add('show');

  // Count down until the server allows a respawn
  const readyAt = performance.now() + waitMs;
  const timer = setInterval(() => {
    const left = Math.ceil((readyAt - performance.now()) / 1000);
    if (left > 0) {
      $('#deathTimer').textContent = `Respawn available in ${left}`;
    } else {
      clearInterval(timer);
      $('#deathTimer').textContent = 'Keep your kit or pick a new one.';
      continueButton.disabled = false;
      changeButton.disabled = false;
      continueButton.focus();
    }
  }, 100);
});

$('#continueButton').addEventListener('click', () => socket.emit('respawn', me.kit));
$('#changeKitButton').addEventListener('click', () => {
  deathScreen.classList.remove('show');
  kitScreen.classList.add('show');
});
$('#backButton').addEventListener('click', () => {
  kitScreen.classList.remove('show');
  deathScreen.classList.add('show');
});
$('#respawnButton').addEventListener('click', () => socket.emit('respawn', chosenKit));

socket.on('correct', ({ x, y, z }) => me.pos.set(x, y, z));

// ---- Rounds and map voting ----
let voteOptions = [];
let myVote = null;
let intermissionTimer = null;

function showRoundTime(phase, seconds) {
  const time = roundInfo.querySelector('.time');
  if (phase === 'intermission') {
    time.textContent = 'Voting';
    time.classList.remove('ending');
    return;
  }
  const m = Math.floor(seconds / 60), s = seconds % 60;
  time.textContent = `${m}:${String(s).padStart(2, '0')}`;
  time.classList.toggle('ending', seconds <= 60);
}

socket.on('map', ({ mapId, phase, secondsLeft }) => {
  loadMap(mapId);
  showRoundTime(phase, secondsLeft);
  if (phase === 'playing') {
    intermissionScreen.classList.remove('show');
    clearInterval(intermissionTimer);
  }
});

// Joined between rounds: we wait on the results screen until the next map starts
socket.on('waiting', ({ id, kit }) => {
  joined = true;
  me.id = id;
  me.kit = kit;
  me.alive = false;
  startScreen.classList.remove('show');
});

socket.on('intermission', ({ results, options, votes, secondsLeft }) => {
  me.alive = false;
  mouseDown = false;
  setZoom(false);
  document.exitPointerLock();
  deathScreen.classList.remove('show');
  kitScreen.classList.remove('show');
  scoreboard.classList.remove('show');
  pausedBox.classList.remove('show');
  if (!joined) return; // still on the start screen

  // Title and results table
  const top = results[0];
  $('#roundTitle').textContent = top && top.kills > 0 ? `${top.name} wins the round` : 'Round over';
  const tbody = $('#resultsTable tbody');
  tbody.innerHTML = '';
  for (const r of results) {
    const tr = document.createElement('tr');
    if (r.rank === 1 && r.kills > 0) tr.classList.add('first');
    if (r.id === me.id) tr.classList.add('me');
    for (const value of [r.rank, r.name, KITS[r.kit].name, r.kills, r.deaths]) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  // Vote cards
  voteOptions = options;
  myVote = null;
  const box = $('#voteOptions');
  box.innerHTML = '';
  options.forEach((id, i) => {
    const map = getMap(id);
    const t = map.theme;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'vote';
    card.dataset.map = id;
    card.setAttribute('aria-pressed', 'false');
    card.innerHTML = `
      <span class="swatch"><span></span><span></span><span></span><span></span></span>
      <span class="body">
        <span class="top"><span class="map-name"></span><span class="key"></span></span>
        <span class="tag"></span>
        <span class="blurb"></span>
        <span class="bar"><div></div></span>
        <span class="count">0 votes</span>
      </span>`;
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    const colors = [t.sky, t.floor, t.styles.wall.color, t.styles.crate.color];
    card.querySelectorAll('.swatch span').forEach((el, k) => (el.style.background = hex(colors[k])));
    card.querySelector('.map-name').textContent = map.name;
    card.querySelector('.key').textContent = `Press ${i + 1}`;
    card.querySelector('.tag').textContent = map.tag;
    card.querySelector('.blurb').textContent = map.blurb;
    card.addEventListener('click', () => castVote(id));
    box.appendChild(card);
  });
  showVotes(votes);

  // Countdown
  intermissionScreen.classList.add('show');
  const endsAt = performance.now() + secondsLeft * 1000;
  clearInterval(intermissionTimer);
  const tick = () => {
    const left = Math.max(0, Math.ceil((endsAt - performance.now()) / 1000));
    $('#roundSub').textContent = `Next map in ${left}`;
  };
  tick();
  intermissionTimer = setInterval(tick, 250);
});

function castVote(mapId) {
  if (!voteOptions.includes(mapId)) return;
  myVote = mapId;
  socket.emit('vote', mapId);
  for (const card of document.querySelectorAll('.vote')) {
    card.setAttribute('aria-pressed', String(card.dataset.map === mapId));
  }
}

function showVotes(votes) {
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  for (const card of document.querySelectorAll('.vote')) {
    const n = votes[card.dataset.map] || 0;
    card.querySelector('.count').textContent = `${n} vote${n === 1 ? '' : 's'}`;
    card.querySelector('.bar div').style.width = total ? `${(n / total) * 100}%` : '0';
  }
}

socket.on('votes', showVotes);
socket.on('feed', addFeed);

setInterval(() => {
  if (!joined || !me.alive) return;
  socket.emit('move', { x: me.pos.x, y: me.pos.y, z: me.pos.z, yaw: me.yaw, pitch: me.pitch });
}, 1000 / SEND_RATE);

// ---- Input ----
const isLocked = () => document.pointerLockElement === renderer.domElement;

renderer.domElement.addEventListener('click', () => {
  if (joined && me.alive && !isLocked()) lockMouse();
});
document.addEventListener('pointerlockchange', () => {
  pausedBox.classList.toggle('show', joined && me.alive && !isLocked());
});
function setZoom(on) {
  zoomed = on;
  camera.fov = on ? ZOOM_FOV : NORMAL_FOV;
  camera.updateProjectionMatrix();
  scopeOverlay.classList.toggle('show', on);
}

document.addEventListener('mousemove', (e) => {
  if (!isLocked()) return;
  const sensitivity = MOUSE_SENSITIVITY * (zoomed ? ZOOM_FOV / NORMAL_FOV : 1);
  me.yaw -= e.movementX * sensitivity;
  me.pitch -= e.movementY * sensitivity;
  me.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, me.pitch));
});
document.addEventListener('mousedown', (e) => {
  if (e.button === 0) mouseDown = true;
  if (e.button === 2 && isLocked() && me.alive && KITS[me.kit].zoom) setZoom(true);
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) setZoom(false);
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && joined && me.alive) { e.preventDefault(); scoreboard.classList.add('show'); }
  if (intermissionScreen.classList.contains('show') && /^Digit[1-4]$/.test(e.code)) {
    castVote(voteOptions[Number(e.code.slice(5)) - 1]);
  }
  if (e.code === 'Space' && !e.repeat && joined && me.alive && me.jumpsLeft > 0) {
    me.velY = JUMP_SPEED;
    me.jumpsLeft -= 1;
    me.onGround = false;
  }
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
  if (now - lastFire < KITS[me.kit].fireMs) return;
  lastFire = now;

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  socket.emit('shoot', { x: dir.x, y: dir.y, z: dir.z });

  // Draw our tracer right away so shooting feels responsive (shotgun waits for the server)
  if (!KITS[me.kit].pellets) {
    const start = new THREE.Vector3();
    gun.getWorldPosition(start);
    const reach = raycastMap(me.pos, dir, 180); // stop the line at the first wall
    drawTracer(start, me.pos.clone().addScaledVector(dir, reach), 0xffffff);
  }

  // Small recoil kick on the gun model
  gun.position.z = -0.38;
  setTimeout(() => (gun.position.z = -0.45), 60);
}

// Collision helpers (blockedAt, groundAt, ceilingAt) live in map.js

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
    const speed = KITS[me.kit].speed;
    mx = (mx / len) * speed * dt;
    mz = (mz / len) * speed * dt;
  }

  // Move one axis at a time so we slide along walls instead of sticking.
  // Anything lower than a step (stairs, the slope of a ramp) is walked straight onto.
  const oldFeet = me.pos.y - EYE_HEIGHT;
  if (!blockedAt(me.pos.x + mx, me.pos.z, oldFeet)) me.pos.x += mx;
  if (!blockedAt(me.pos.x, me.pos.z + mz, oldFeet)) me.pos.z += mz;

  // Gravity (jumping is handled in the keydown listener)
  me.velY -= GRAVITY * dt;
  me.pos.y += me.velY * dt;
  let feet = me.pos.y - EYE_HEIGHT;

  // Bump your head on bridges and roofs
  if (me.velY > 0) {
    const ceiling = ceilingAt(me.pos.x, me.pos.z, oldFeet, feet);
    if (ceiling !== null) {
      feet = ceiling - BODY_HEIGHT;
      me.pos.y = feet + EYE_HEIGHT;
      me.velY = 0;
    }
  }

  // Land on whatever is underneath (only while not rising, so jumps aren't cut short)
  if (me.velY <= 0) {
    const { ground, pad } = groundAt(me.pos.x, me.pos.z, Math.max(oldFeet, feet));
    // While walking, stick to the ground when going down ramps and small drops
    const followSlope = me.onGround && feet - ground < 0.35;
    if (feet <= ground || followSlope) {
      me.pos.y = ground + EYE_HEIGHT;
      me.velY = 0;
      me.onGround = true;
      me.jumpsLeft = KITS[me.kit].jumps;

      if (pad) { // jump pad: launch upward, keeping any air jumps the kit has
        me.velY = pad.power;
        me.onGround = false;
        me.jumpsLeft = Math.max(0, KITS[me.kit].jumps - 1);
      }
      return;
    }
  }
  if (me.onGround) {
    me.onGround = false;
    me.jumpsLeft = Math.max(0, KITS[me.kit].jumps - 1);
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
  if (padMaterial) padMaterial.emissiveIntensity = 0.45 + 0.35 * Math.sin(performance.now() / 250);
  gun.visible = me.alive && !zoomed;

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
