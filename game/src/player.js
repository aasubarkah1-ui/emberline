// player.js — the human player: WASD movement with acceleration and
// friction, crouch, pointer-look with recoil kick, hitscan firing with
// body/head hitboxes, reload, grenades and spike plant/defuse.
// The camera is the player's eyes: eye height 1.62 standing, 1.05 crouched.

import { WEAPONS, currentSpread, damageAfterArmor, GRENADE_FUSE } from './weapons.js';
import { insideSite } from './world.js';
import { hearNoise } from './bots.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.42;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.6;
const SLOW_SPEED = 2.2; // Shift: walk slow, quieter and steadier
const ACCEL = 42;
const FRICTION = 11;

export function eyeHeight(p) {
  return p.crouched ? EYE_CROUCH : EYE_STAND;
}

// One fixed step of player movement. input: { f, b, l, r, crouch, slow }.
export function stepPlayer(state, input, dt, collide) {
  const p = state.player;
  if (!p.alive || state.phase === 'menu') return;
  p.crouched = input.crouch;
  const top = p.crouched ? CROUCH_SPEED : (input.slow ? SLOW_SPEED : WALK_SPEED);
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  let ix = 0, iz = 0;
  if (input.f) { ix -= sin; iz -= cos; }
  if (input.b) { ix += sin; iz += cos; }
  if (input.l) { ix -= cos; iz += sin; }
  if (input.r) { ix += cos; iz -= sin; }
  const len = Math.hypot(ix, iz);
  if (len > 0) { ix /= len; iz /= len; }
  p.vx += ix * ACCEL * dt;
  p.vz += iz * ACCEL * dt;
  // friction: bleed speed when no input, cap at the current top speed
  const damp = Math.max(0, 1 - FRICTION * dt);
  if (!len) { p.vx *= damp; p.vz *= damp; }
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > top) { p.vx *= top / sp; p.vz *= top / sp; }
  const fixed = collide(p.x + p.vx * dt, p.z + p.vz * dt, RADIUS);
  p.x = fixed.x; p.z = fixed.z;
  // bloom settles while not firing; recoil settles back toward zero
  p.spread = Math.max(0, p.spread - dt * 0.045);
  p.recoil = Math.max(0, p.recoil - dt * 0.09);
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) finishReload(p);
  }
}

export function playerSpeed(p) {
  return Math.hypot(p.vx, p.vz);
}

export function startReload(p) {
  const def = WEAPONS[p.weapon];
  const slot = p.weapons[p.weapon];
  if (p.reloading > 0 || slot.mag >= def.mag || slot.reserve <= 0) return false;
  p.reloading = def.reload;
  return true;
}

function finishReload(p) {
  const def = WEAPONS[p.weapon];
  const slot = p.weapons[p.weapon];
  const need = def.mag - slot.mag;
  const take = Math.min(need, slot.reserve);
  slot.mag += take;
  slot.reserve -= take;
  p.reloading = 0;
}

// Fire one hitscan shot. shootRay is supplied by main.js (it owns the
// three.js raycaster); applyDamage and tracer hooks come through ctx.
export function tryFire(state, ctx) {
  const p = state.player;
  if (!p.alive || state.phase !== 'live') return;
  if (p.reloading > 0 || p.fireCooldown > 0) return;
  const def = WEAPONS[p.weapon];
  const slot = p.weapons[p.weapon];
  if (slot.mag <= 0) {
    p.fireCooldown = 0.25;
    ctx.clickEmpty();
    startReload(p);
    return;
  }
  slot.mag -= 1;
  p.fireCooldown = 60 / def.rpm;
  const spread = currentSpread(def, playerSpeed(p), p.crouched, p.spread);
  p.spread += def.bloomPerShot;
  p.recoil += def.kick;
  p.pitch += def.kick * 0.55; // visible kick; settles via stepPlayer
  const yaw = p.yaw + (state.rng() * 2 - 1) * spread;
  const pitch = p.pitch + (state.rng() * 2 - 1) * spread;
  const dirX = -Math.sin(yaw) * Math.cos(pitch);
  const dirY = -Math.sin(pitch);
  const dirZ = -Math.cos(yaw) * Math.cos(pitch);
  const ex = p.x, ey = eyeHeight(p), ez = p.z;
  const hit = ctx.shootRay(ex, ey, ez, dirX, dirY, dirZ, def.range, null);
  state.shotsFired += 1;
  if (hit) {
    state.shotsHit += 1;
    const raw = hit.head ? def.damage * def.headMult : def.damage;
    ctx.applyDamage(hit.who, raw, 'player');
    ctx.hitmarker(hit.head);
  }
  ctx.tracer(ex, ey, ez, ex + dirX * (hit ? hit.dist : def.range), ey + dirY * (hit ? hit.dist : def.range), ez + dirZ * (hit ? hit.dist : def.range));
  ctx.muzzle(ex, ey, ez, dirX, dirZ);
  ctx.gunshot(ex, ez);
  hearNoise(state, ex, ez, 26);
}

// Apply raw damage to a target ('player' or a bot object). Handles armour,
// death, killfeed and the damage vignette through ctx hooks.
export function applyDamageTo(state, who, raw, attacker, ctx) {
  if (who === 'player') {
    const p = state.player;
    if (!p.alive) return;
    const d = damageAfterArmor(raw, p.armor);
    p.hp -= d.hp;
    p.armor = d.armor;
    p.lastDamageAt = state.time;
    ctx.hurtFlash();
    if (p.hp <= 0) {
      p.hp = 0; p.alive = false;
      ctx.feedLine(`${attackerName(attacker)} eliminated you`);
    }
    return;
  }
  const b = who;
  if (!b.alive) return;
  b.hp -= raw;
  if (b.hp <= 0) {
    b.hp = 0; b.alive = false;
    if (attacker === 'player') {
      state.player.kills += 1;
      state.money += 300;
      ctx.feedLine(`You eliminated ${b.name}  +$300`);
    } else {
      ctx.feedLine(`${attackerName(attacker)} eliminated ${b.name}`);
    }
  }
}

function attackerName(a) {
  if (a === 'player') return 'You';
  if (a && a.name) return a.name;
  return 'Ash';
}

// Throw a grenade from the player's view. It flies, bounces once, then
// explodes after its fuse (see rounds.js grenade stepping).
export function throwGrenade(state) {
  const p = state.player;
  if (!p.alive || state.phase !== 'live' || p.grenades <= 0) return false;
  p.grenades -= 1;
  const yaw = p.yaw, pitch = p.pitch;
  const dirX = -Math.sin(yaw) * Math.cos(pitch);
  const dirY = -Math.sin(pitch) + 0.35;
  const dirZ = -Math.cos(yaw) * Math.cos(pitch);
  state.grenades.push({
    x: p.x + dirX * 0.6, y: eyeHeight(p) - 0.1, z: p.z + dirZ * 0.6,
    vx: dirX * 17, vy: dirY * 17, vz: dirZ * 17,
    fuse: GRENADE_FUSE, owner: 'player',
  });
  return true;
}

// Spike interaction: plant (attacker, on a site) or defuse (not used by the
// player — the player attacks; defenders defuse, see bots.js). Holding E
// advances progress; releasing resets it.
export function stepSpike(state, holdingE, dt) {
  const p = state.player;
  const bomb = state.bomb;
  if (!p.alive || state.phase !== 'live') { bomb.progress = 0; return; }
  if (bomb.state === 'carried') {
    const site = insideSite('A', p.x, p.z) ? 'A' : (insideSite('B', p.x, p.z) ? 'B' : null);
    if (site && holdingE) {
      bomb.state = 'planting';
      bomb.site = site;
      bomb.progress += dt / 3;
      if (bomb.progress >= 1) {
        bomb.state = 'planted';
        bomb.timer = 35;
        bomb.x = p.x; bomb.z = p.z;
        bomb.progress = 0;
      }
    } else {
      bomb.state = 'carried';
      bomb.progress = 0;
    }
  }
}
