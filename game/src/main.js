// main.js — bootstrap, fixed-step loop and rendering for Emberline.
// The simulation runs at a fixed 60 Hz (state.js / player.js / bots.js /
// rounds.js) and rendering only reads state — the two never interleave.
// Hot-loop rule: module-level reusable vectors, no object allocation per
// frame except the pooled tracer lines.

import * as THREE from 'three';
import { freshState, SIM_DT } from './state.js';
import { buildWorld, collide, PALETTE } from './world.js';
import { stepPlayer, tryFire, startReload, throwGrenade, stepSpike, applyDamageTo, eyeHeight, playerSpeed } from './player.js';
import { spawnBots, stepBot, hearNoise } from './bots.js';
import { startMatch, startRound, stepRounds, buyItem, BUY_ITEMS } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { WEAPONS } from './weapons.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // start | play | end — screenshot staging
const SEED = Number(params.get('seed') || '7') || 7;

const state = freshState(SEED);
const audio = createAudio();
const hud = createHud();

// ---- three.js scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(78, innerWidth / innerHeight, 0.08, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);

const { colliders, wallMeshes } = buildWorld(scene);

// ---- bot meshes -----------------------------------------------------------
const botMeshes = new Map(); // bot id -> { group, body, head }
const bodyGeo = new THREE.BoxGeometry(0.72, 1.05, 0.42);
const headGeo = new THREE.SphereGeometry(0.23, 12, 10);
const legGeo = new THREE.BoxGeometry(0.6, 0.45, 0.36);
function botMaterial(team) {
  return new THREE.MeshStandardMaterial({
    color: team === 'them' ? 0x8a8f96 : 0xc96a1e,
    roughness: 0.75, metalness: 0.2,
  });
}
function headMaterial(team) {
  return new THREE.MeshStandardMaterial({ color: team === 'them' ? 0x5a6068 : 0x3a2a18, roughness: 0.8 });
}
function buildBotMeshes() {
  for (const b of state.bots) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, botMaterial(b.team));
    body.position.y = 0.95;
    body.userData.bot = b; body.userData.part = 'body';
    const head = new THREE.Mesh(headGeo, headMaterial(b.team));
    head.position.y = 1.62;
    head.userData.bot = b; head.userData.part = 'head';
    const legs = new THREE.Mesh(legGeo, new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.9 }));
    legs.position.y = 0.22;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.07, 0.05),
      new THREE.MeshBasicMaterial({ color: b.team === 'them' ? 0x4fc3f7 : 0xff7a1a }),
    );
    visor.position.set(0, 1.62, -0.2);
    group.add(body, head, legs, visor);
    group.position.set(b.x, 0, b.z);
    scene.add(group);
    botMeshes.set(b.id, { group, body, head });
  }
}
function syncBotMeshes() {
  for (const b of state.bots) {
    const m = botMeshes.get(b.id);
    if (!m) continue;
    m.group.position.set(b.x, 0, b.z);
    m.group.rotation.y = b.yaw + Math.PI;
    m.group.visible = b.alive || state.time - (b.deathT || 0) < 4;
    if (!b.alive) {
      m.group.rotation.x = -Math.PI / 2; // fallen
      m.group.position.y = 0.3;
    } else {
      m.group.rotation.x = 0;
      m.group.position.y = 0;
    }
  }
}

// ---- gun viewmodel + tracers + flashes (pooled, reused) -------------------
const gun = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.5, metalness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.ember, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), dark);
  barrel.position.set(0, 0.03, -0.38);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.3), accent);
  stripe.position.set(0, 0.05, -0.1);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), accent);
  sight.position.set(0, 0.1, -0.05);
  gun.add(body, barrel, stripe, sight);
  gun.scale.setScalar(0.55);
  gun.position.set(0.24, -0.2, -0.75);
  camera.add(gun);
}
const TRACER_POOL = 8;
const tracers = [];
for (let i = 0; i < TRACER_POOL; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0 }));
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIdx = 0;
const flashLight = new THREE.PointLight(0xffc36b, 0, 9, 2);
scene.add(flashLight);
const explosionLight = new THREE.PointLight(0xff7a1a, 0, 22, 1.6);
scene.add(explosionLight);
let explosionT = 0;

// Reusable temps — the hot loop allocates nothing.
const _raycaster = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmpV = new THREE.Vector3();

// ---- combat plumbing: raycast, damage, effects ----------------------------
const hitTargets = []; // rebuilt when bots respawn
function rebuildHitTargets() {
  hitTargets.length = 0;
  for (const m of botMeshes.values()) hitTargets.push(m.body, m.head);
}

function shootRay(ox, oy, oz, dx, dy, dz, range, shooterBot) {
  _origin.set(ox, oy, oz);
  _dir.set(dx, dy, dz).normalize();
  _raycaster.set(_origin, _dir);
  _raycaster.far = range;
  const wallHits = _raycaster.intersectObjects(wallMeshes, false);
  const wallDist = wallHits.length ? wallHits[0].distance : Infinity;
  const botHits = _raycaster.intersectObjects(hitTargets, false);
  for (const h of botHits) {
    const b = h.object.userData.bot;
    if (!b.alive) continue;
    if (shooterBot && b === shooterBot) continue;
    if (h.distance > wallDist) continue; // wall in the way
    return { who: b, head: h.object.userData.part === 'head', dist: h.distance };
  }
  return null;
}

const ctx = {
  shootRay,
  applyDamage(who, raw, attacker) {
    applyDamageTo(state, who, raw, attacker, ctx);
    if (who === 'player') audio.hurt();
    else if (attacker === 'player') audio.hit();
  },
  hitmarker(head) { hud.hitmark(head); },
  hurtFlash() { hud.hurt(); },
  clickEmpty() { audio.empty(); },
  tracer(ax, ay, az, bx, by, bz) {
    // Start the line a little in front of the eye so its near end never
    // sits behind the camera's near plane (which would smear it on screen).
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1;
    const sx = ax + (dx / len) * 0.7, sy = ay + (dy / len) * 0.7, sz = az + (dz / len) * 0.7;
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % TRACER_POOL;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = sx; pos[1] = sy; pos[2] = sz; pos[3] = bx; pos[4] = by; pos[5] = bz;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.opacity = 0.85;
    t.life = 0.07;
  },
  muzzle(x, y, z, dirX, dirZ) {
    flashLight.position.set(x + dirX * 0.6, y, z + dirZ * 0.6);
    flashLight.intensity = 14;
    audio.shot();
  },
  gunshot(x, z) { hearNoise(state, x, z, 26); },
  explosion(x, z) {
    explosionLight.position.set(x, 1.5, z);
    explosionLight.intensity = 90;
    explosionT = 0.5;
    audio.explosion();
  },
  feedLine(text) {
    state.feed.push({ text, t: state.time });
    if (state.feed.length > 8) state.feed.shift();
  },
};

// ---- input ----------------------------------------------------------------
const keys = {};
let mouseDown = false;
let pointerLocked = false;
let buyOpen = false;
const input = { f: false, b: false, l: false, r: false, crouch: false, slow: false };

function refreshInput() {
  input.f = !!keys.KeyW || !!keys.ArrowUp;
  input.b = !!keys.KeyS || !!keys.ArrowDown;
  input.l = !!keys.KeyA || !!keys.ArrowLeft;
  input.r = !!keys.KeyD || !!keys.ArrowRight;
  input.crouch = !!keys.ControlLeft || !!keys.ControlRight || !!keys.KeyC;
  input.slow = !!keys.ShiftLeft || !!keys.ShiftRight;
}

addEventListener('keydown', (e) => {
  if (e.code === 'F12') return;
  keys[e.code] = true;
  refreshInput();
  if (e.code === 'KeyR') {
    if (state.phase === 'matchEnd') { startMatch(state); rebuildHitTargets(); }
    else startReload(state.player);
  }
  if (e.code === 'KeyB' && state.phase === 'freeze') toggleBuy();
  if (e.code === 'Escape') closeBuy();
  if (e.code === 'KeyG') { if (throwGrenade(state)) audio.shot(); }
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') {
    const id = e.code === 'Digit1' ? 'pistol' : (e.code === 'Digit2' ? 'rifle' : 'smg');
    if (buyOpen) { const msg = buyItem(state, id); if (msg) ctx.feedLine(msg); }
    else if (state.player.owned[id]) state.player.weapon = id;
  }
  if (buyOpen && (e.code === 'Digit4' || e.code === 'Digit5')) {
    const msg = buyItem(state, e.code === 'Digit4' ? 'grenade' : 'armor');
    if (msg) ctx.feedLine(msg);
    syncBuy();
  }
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; refreshInput(); });
addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  const p = state.player;
  p.yaw -= e.movementX * 0.0021;
  p.pitch -= e.movementY * 0.0021;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
});
addEventListener('mousedown', (e) => {
  if (e.button !== 0 || buyOpen) return;
  if (!pointerLocked && !SHOT) {
    renderer.domElement.requestPointerLock();
    return;
  }
  mouseDown = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer.domElement;
});
document.getElementById('play').addEventListener('click', () => {
  document.getElementById('overlay').hidden = true;
  audio.unlock();
  if (state.phase === 'menu') { startMatch(state); rebuildHitTargets(); }
  hud.show();
  renderer.domElement.requestPointerLock();
});

// ---- buy menu --------------------------------------------------------------
const buyTable = document.getElementById('buy-table');
function syncBuy() {
  document.getElementById('buy-money').textContent = '$' + state.money;
  buyTable.innerHTML = BUY_ITEMS.map((item) => {
    const owned = (item.id === 'rifle' || item.id === 'smg') && state.player.owned[item.id];
    return '<tr><td><span class="key">' + item.key + '</span>' + item.name + (owned ? ' <span class="owned">owned</span>' : '') + '</td><td>$' + item.cost + '</td></tr>';
  }).join('');
}
function toggleBuy() {
  buyOpen = !buyOpen;
  document.getElementById('buy').hidden = !buyOpen;
  if (buyOpen) { syncBuy(); document.exitPointerLock?.(); }
  else if (!SHOT) renderer.domElement.requestPointerLock();
}
function closeBuy() {
  if (!buyOpen) return;
  buyOpen = false;
  document.getElementById('buy').hidden = true;
}

// ---- fixed-step simulation --------------------------------------------------
function stepSim(dt) {
  state.time += dt;
  const prevPhase = state.phase;
  stepPlayer(state, input, dt, (x, z, r) => collide(colliders, x, z, r));
  stepSpike(state, !!keys.KeyE, dt);
  const botCtx = {
    wallMeshes,
    player: state.player,
    collide: (x, z) => collide(colliders, x, z, 0.42),
    shootRay,
    applyDamage: (who, raw, attacker) => applyDamageTo(state, who, raw, attacker, ctx),
    muzzle: (x, y, z, dx, dz) => { flashLight.position.set(x + dx * 0.6, y, z + dz * 0.6); flashLight.intensity = 10; },
  };
  for (const b of state.bots) stepBot(state, b, dt, botCtx);
  // ally bots use the same stepBot; their targets are the defenders
  stepRounds(state, dt, ctx);
  if (mouseDown && state.phase === 'live') {
    const def = WEAPONS[state.player.weapon];
    if (def.auto) tryFire(state, ctx);
    else if (!stepSim._fired) { tryFire(state, ctx); stepSim._fired = true; }
  } else stepSim._fired = false;
  if (state.phase === 'roundEnd' && prevPhase !== 'roundEnd') {
    audio.roundEnd(state.roundWinner === 'us');
    if (state.roundWinner === 'us' && state.bomb.state !== 'planted') ctx.feedLine('Round ' + state.round + ' won — ' + state.roundReason);
  }
  // track deaths for the fall animation
  for (const b of state.bots) if (!b.alive && b.deathT === undefined) b.deathT = state.time;
}

let acc = 0;
let lastT = performance.now();
let frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = Math.min(0.25, (now - lastT) / 1000);
  lastT = now;
  // In screenshot mode the staged frame is frozen: the two settle steps in
  // stageShot already ran, so the capture is deterministic and bots cannot
  // kill the staged player while the driver polls for readiness.
  if (!SHOT) {
    acc += elapsed;
    let n = 0;
    while (acc >= SIM_DT && n < 5) { stepSim(SIM_DT); acc -= SIM_DT; n += 1; }
  }
  render();
  hud.update(state);
  frames += 1;
  if (SHOT && frames === 3) window.__shotReady = true;
}

function render() {
  const p = state.player;
  camera.position.set(p.x, eyeHeight(p), p.z);
  camera.rotation.y = p.yaw;
  camera.rotation.x = -p.pitch + p.recoil * 0.35;
  camera.rotation.z = 0;
  // gun bob + recoil
  const sp = playerSpeed(p);
  const bob = Math.sin(state.time * 9) * Math.min(1, sp / 5) * 0.012;
  gun.position.set(0.24, -0.2 + bob, -0.75 + p.recoil * 0.05);
  gun.visible = p.alive && state.phase !== 'menu';
  syncBotMeshes();
  for (const t of tracers) {
    if (t.life > 0 && !SHOT) {
      t.life -= 1 / 60;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
    }
  }
  if (!SHOT) flashLight.intensity = Math.max(0, flashLight.intensity - 1.4);
  if (explosionT > 0 && !SHOT) { explosionT -= 1 / 60; explosionLight.intensity = Math.max(0, explosionT * 180); }
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- screenshot staging ----------------------------------------------------
// ?shot=start|play|end stages a real frame of the live game (same code path
// as play, deterministic seed) so the screenshots are honest renders.
function stageShot() {
  document.getElementById('overlay').hidden = true;
  hud.show();
  startMatch(state);
  rebuildHitTargets();
  if (SHOT === 'start') {
    // freeze time at spawn: mid lane, two defenders holding angles ahead
    state.player.x = -16; state.player.z = 10; state.player.yaw = 0.5;
    state.bots[0].x = 4; state.bots[0].z = -6; state.bots[0].yaw = Math.PI;
    state.bots[2].x = -3; state.bots[2].z = -12; state.bots[2].yaw = Math.PI * 0.9;
  } else if (SHOT === 'play') {
    state.phase = 'live'; state.phaseT = 28; // 1:12 left on the clock
    state.round = 3; state.scoreUs = 2; state.scoreThem = 1;
    state.player.x = -4; state.player.z = 10; state.player.yaw = -0.4; state.player.pitch = 0.02;
    state.player.hp = 82; state.money = 2350;
    state.player.weapons.rifle.mag = 24;
    state.bots[0].x = 2; state.bots[0].z = -4; state.bots[0].yaw = 2.75; state.bots[0].hp = 58; state.bots[0].cooldown = 5;
    state.bots[1].alive = false; state.bots[1].deathT = 0; // Ash-2, per the killfeed line
    state.bots[2].x = 8; state.bots[2].z = -12; state.bots[2].yaw = Math.PI; state.bots[2].cooldown = 5;
    state.bots[3].x = -12; state.bots[3].z = -2; state.bots[3].yaw = 2.56; state.bots[3].cooldown = 5;
    state.feed.push({ text: 'You eliminated Ash-2  +$300', t: 0 });
    ctx.tracer(-4, 1.5, 10, 2, 1.4, -4);
  } else if (SHOT === 'end') {
    state.phase = 'roundEnd'; state.phaseT = 1;
    state.roundWinner = 'us'; state.roundReason = 'Spike detonated at Site A';
    state.scoreUs = 3; state.scoreThem = 1; state.round = 4;
    state.player.x = 4; state.player.z = 6; state.player.yaw = -0.69;
    state.player.hp = 64; state.money = 4100;
    state.bomb.state = 'exploded'; state.bomb.site = 'A';
    state.bots[0].alive = false; state.bots[0].deathT = 0;
    state.bots[1].alive = false; state.bots[1].deathT = 0;
    ctx.explosion(24, -18);
  }
  // settle two fixed steps so meshes, HUD and lights are in place
  stepSim(SIM_DT); stepSim(SIM_DT);
}

if (SHOT) stageShot();
else {
  state.phase = 'menu';
  spawnBots(state);
  buildBotMeshes();
  rebuildHitTargets();
  hud.hide();
}
if (SHOT) { buildBotMeshes(); rebuildHitTargets(); }
requestAnimationFrame(frame);
