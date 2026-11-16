// bots.js — bot brains. Two kinds of bot, one shared update:
//  - defenders (Ash): hold a site angle or patrol a route between the sites,
//    and react to what they see (vision cone + line of sight) and hear
//    (gunshots and the spike plant pull them toward the noise).
//  - allies (Ember): push up a lane with the player and engage what they see.
// Bots think at 10 Hz (staggered), move every fixed step, and shoot in
// bursts with an error that grows with range — they can miss, and they do.

import * as THREE from 'three';
import { SPAWN_THEM } from './world.js';
import { damageAfterArmor } from './weapons.js';

// Patrol routes: each defender owns a loop of waypoints through the yard.
const ROUTES = {
  A: [[24, -10], [10, -14], [24, -6], [30, -8]],
  B: [[-24, -10], [-10, -14], [-24, -6], [-30, -8]],
  mid: [[0, -18], [0, 2], [6, -8], [-6, -10]],
  flank: [[-14, 0], [-14, -16], [14, -16], [14, 0]],
};

const BOT_NAMES = ['Ash-1', 'Ash-2', 'Ash-3', 'Ash-4', 'Ember-2', 'Ember-3'];

export function spawnBots(state) {
  state.bots = [];
  const defs = [
    { team: 'them', kind: 'defender', route: 'A', spawn: SPAWN_THEM[0] },
    { team: 'them', kind: 'defender', route: 'B', spawn: SPAWN_THEM[1] },
    { team: 'them', kind: 'defender', route: 'mid', spawn: SPAWN_THEM[2] },
    { team: 'them', kind: 'defender', route: 'flank', spawn: SPAWN_THEM[3] },
    { team: 'us', kind: 'ally', route: 'mid', spawn: { x: -24, z: 20, yaw: 0.15 } },
    { team: 'us', kind: 'ally', route: 'flank', spawn: { x: -28, z: 16, yaw: 0.15 } },
  ];
  defs.forEach((d, i) => {
    state.bots.push({
      id: i, name: BOT_NAMES[i], team: d.team, kind: d.kind,
      x: d.spawn.x, z: d.spawn.z, yaw: d.spawn.yaw,
      hp: 100, alive: true, speed: 3.4,
      route: ROUTES[d.route], wp: Math.floor(state.rng() * ROUTES[d.route].length),
      holdT: 0, thinkT: i * 0.07, burst: 0, cooldown: 0,
      target: null, // { x, z, y, team } last seen enemy position
      hearX: 0, hearZ: 0, hearT: -99, // last heard noise
      defusing: 0, plantSeen: false,
    });
  });
}

// A noise event: gunfire and planting. Bots within earshot investigate.
export function hearNoise(state, x, z, radius) {
  for (const b of state.bots) {
    if (!b.alive || b.team !== 'them') continue;
    const dx = b.x - x, dz = b.z - z;
    if (dx * dx + dz * dz < radius * radius) {
      b.hearX = x; b.hearZ = z; b.hearT = state.time;
    }
  }
}

const _ray = new THREE.Raycaster();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

// Line of sight between two eye-level points, blocked by wall meshes.
export function hasLineOfSight(wallMeshes, ax, ay, az, bx, by, bz) {
  _from.set(ax, ay, az);
  _to.set(bx - ax, by - ay, bz - az);
  const dist = _to.length();
  if (dist < 0.001) return true;
  _ray.set(_from, _to.normalize());
  _ray.far = dist;
  return _ray.intersectObjects(wallMeshes, false).length === 0;
}

function angleTo(b, x, z) {
  return Math.atan2(-(x - b.x), -(z - b.z));
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// One bot's 10 Hz decision: pick a target it can see, or a place to go.
function think(state, b, ctx) {
  const { wallMeshes, player } = ctx;
  b.target = null;
  const eyeY = 1.5;
  // Enemies the bot can see: the player (if alive) and enemy bots.
  const foes = [];
  if (b.team === 'them' && player.alive) foes.push({ x: player.x, z: player.z, y: 1.35, who: 'player' });
  for (const o of state.bots) {
    if (!o.alive || o.team === b.team || o === b) continue;
    foes.push({ x: o.x, z: o.z, y: 1.35, who: o });
  }
  for (const f of foes) {
    const dx = f.x - b.x, dz = f.z - b.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 30) continue;
    const facing = angleDiff(angleTo(b, f.x, f.z), b.yaw);
    if (Math.abs(facing) > 1.05) continue; // ~120 degree vision cone
    if (hasLineOfSight(wallMeshes, b.x, eyeY, b.z, f.x, f.y, f.z)) {
      b.target = f;
      break;
    }
  }
  // The planted spike: defenders converge on it once anyone sees it.
  if (state.bomb.state === 'planted' && b.team === 'them') {
    b.hearX = state.bomb.x; b.hearZ = state.bomb.z; b.hearT = state.time;
  }
}

// Move + shoot one bot for one fixed step. Returns nothing; writes state.
export function stepBot(state, b, dt, ctx) {
  if (!b.alive) return;
  b.thinkT -= dt;
  if (b.thinkT <= 0) { think(state, b, ctx); b.thinkT = 0.1; }
  b.cooldown = Math.max(0, b.cooldown - dt);

  // Defuse: a defender standing on the planted spike defuses it.
  if (state.bomb.state === 'planted' && b.team === 'them') {
    const dx = b.x - state.bomb.x, dz = b.z - state.bomb.z;
    if (dx * dx + dz * dz < 2.2 * 2.2) {
      b.defusing += dt;
      if (b.defusing >= 4) {
        state.bomb.state = 'defused';
        state.bomb.progress = 0;
      }
      return; // defusing bot stands still
    }
  }
  b.defusing = 0;

  let destX = null, destZ = null, moveSpeed = b.speed;
  if (b.target) {
    // Face the target, strafe to a firing position, stop at 8–16 m.
    const dx = b.target.x - b.x, dz = b.target.z - b.z;
    const dist = Math.hypot(dx, dz);
    b.yaw += angleDiff(angleTo(b, b.target.x, b.target.z), b.yaw) * Math.min(1, dt * 8);
    if (dist > 16) { destX = b.target.x; destZ = b.target.z; }
    else if (dist < 7) { destX = b.x - dx / dist; destZ = b.z - dz / dist; moveSpeed = b.speed * 0.6; }
    // Fire in bursts: 3–5 shots, then a pause. Error grows with range.
    if (b.cooldown <= 0 && state.phase === 'live') {
      if (b.burst <= 0) b.burst = 3 + Math.floor(state.rng() * 3);
      b.burst -= 1;
      b.cooldown = b.burst > 0 ? 0.12 : 0.7 + state.rng() * 0.5;
      fireBotShot(state, b, ctx, dist);
    }
  } else if (state.time - b.hearT < 6) {
    destX = b.hearX; destZ = b.hearZ; moveSpeed = b.speed * 1.15; // investigate noise
  } else if (state.phase === 'live' || state.phase === 'freeze') {
    // Patrol: walk the route, hold each waypoint briefly to watch an angle.
    const wp = b.route[b.wp];
    const dx = wp[0] - b.x, dz = wp[1] - b.z;
    if (Math.hypot(dx, dz) < 1.2) {
      b.holdT += dt;
      if (b.holdT > 1.6) { b.wp = (b.wp + 1) % b.route.length; b.holdT = 0; }
    } else {
      destX = wp[0]; destZ = wp[1];
      b.yaw += angleDiff(angleTo(b, wp[0], wp[1]), b.yaw) * Math.min(1, dt * 5);
    }
  }
  if (destX !== null) {
    const dx = destX - b.x, dz = destZ - b.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.01) {
      const step = Math.min(len, moveSpeed * dt);
      const nx = b.x + (dx / len) * step;
      const nz = b.z + (dz / len) * step;
      const fixed = ctx.collide(nx, nz);
      b.x = fixed.x; b.z = fixed.z;
    }
  }
}

function fireBotShot(state, b, ctx, dist) {
  // Aim error: ~2 degrees at close range, ~5 at long range, plus a miss bias.
  const err = (0.03 + dist * 0.0025) * (state.rng() * 2 - 1);
  const aimYaw = b.yaw + err;
  const dirX = -Math.sin(aimYaw), dirZ = -Math.cos(aimYaw);
  // The player is not a mesh in the raycast set: test the aim ray against
  // the player's body cylinder directly when the target is the player.
  if (b.target && b.target.who === 'player') {
    const p = ctx.player;
    const toX = p.x - b.x, toZ = p.z - b.z;
    const along = toX * dirX + toZ * dirZ;
    if (along > 0 && along < 40) {
      const perpX = toX - dirX * along, perpZ = toZ - dirZ * along;
      const perp = Math.hypot(perpX, perpZ);
      if (perp < 0.55 && hasLineOfSight(ctx.wallMeshes, b.x, 1.5, b.z, p.x, 1.35, p.z)) {
        ctx.applyDamage('player', perp < 0.28 ? 34 : 17, b);
      }
    }
    ctx.muzzle(b.x, 1.5, b.z, dirX, dirZ);
    return;
  }
  const hit = ctx.shootRay(b.x, 1.5, b.z, dirX, -0.02, dirZ, 40, b);
  if (hit) ctx.applyDamage(hit.who, hit.head ? 34 : 17, b);
  ctx.muzzle(b.x, 1.5, b.z, dirX, dirZ);
}

// Team alive counts, used by the round logic.
export function aliveCount(state, team) {
  let n = 0;
  for (const b of state.bots) if (b.team === team && b.alive) n += 1;
  return n;
}
