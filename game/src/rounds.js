// rounds.js — round flow, economy, buy menu and grenades.
// One match is first to WIN_ROUNDS. Each round: freeze (buy) -> live (100 s)
// -> round end (banner, payout) -> next freeze. The spike gives the round a
// second way to end besides elimination: plant it and it detonates, or the
// defenders defuse it in time.

import { FREEZE_TIME, ROUND_TIME, BOMB_TIME, WIN_ROUNDS, roundPayout } from './state.js';
import { WEAPONS, GRENADE_COST, ARMOR_COST, blastDamage } from './weapons.js';
import { spawnBots, aliveCount } from './bots.js';
import { SPAWN_US } from './world.js';

export const BUY_ITEMS = [
  { key: '2', id: 'rifle', name: 'Kestrel-5 rifle', cost: WEAPONS.rifle.cost },
  { key: '3', id: 'smg', name: 'Swift-9 SMG', cost: WEAPONS.smg.cost },
  { key: '4', id: 'grenade', name: 'Ember frag grenade', cost: GRENADE_COST },
  { key: '5', id: 'armor', name: 'Plate armour (50)', cost: ARMOR_COST },
];

export function startMatch(state) {
  state.scoreUs = 0;
  state.scoreThem = 0;
  state.round = 1;
  state.money = 800;
  state.matchWinner = null;
  startRound(state);
}

export function startRound(state) {
  state.phase = 'freeze';
  state.phaseT = 0;
  state.roundWinner = null;
  state.roundReason = '';
  state.bomb = { state: 'carried', site: null, progress: 0, timer: 0, x: 0, z: 0 };
  state.grenades = [];
  state.tracers = [];
  const p = state.player;
  p.x = SPAWN_US.x; p.z = SPAWN_US.z; p.yaw = SPAWN_US.yaw; p.pitch = 0;
  p.vx = 0; p.vz = 0; p.hp = 100; p.alive = true;
  p.reloading = 0; p.fireCooldown = 0; p.spread = 0; p.recoil = 0;
  p.kills = 0;
  // fresh ammo each round for owned weapons, grenades back to one
  for (const id of Object.keys(p.weapons)) {
    if (!p.owned[id]) continue;
    p.weapons[id].mag = WEAPONS[id].mag;
    p.weapons[id].reserve = WEAPONS[id].reserveStart;
  }
  p.grenades = 1;
  spawnBots(state);
}

export function buyItem(state, id) {
  if (state.phase !== 'freeze') return 'Buy menu is closed — it opens during freeze time.';
  const item = BUY_ITEMS.find((b) => b.id === id);
  if (!item) return 'Unknown item.';
  const p = state.player;
  if (item.id === 'rifle' || item.id === 'smg') {
    if (p.owned[item.id]) return `You already own the ${WEAPONS[item.id].name}.`;
    if (state.money < item.cost) return 'Not enough money.';
    state.money -= item.cost;
    p.owned[item.id] = true;
    p.weapon = item.id;
    return `Bought ${WEAPONS[item.id].name}. Press ${WEAPONS[item.id].key} to equip.`;
  }
  if (item.id === 'grenade') {
    if (p.grenades >= 2) return 'You already carry two grenades.';
    if (state.money < item.cost) return 'Not enough money.';
    state.money -= item.cost;
    p.grenades += 1;
    return 'Bought a frag grenade. Press G to throw it.';
  }
  if (item.id === 'armor') {
    if (p.armor >= 50) return 'Armour is already full.';
    if (state.money < item.cost) return 'Not enough money.';
    state.money -= item.cost;
    p.armor = 50;
    return 'Bought plate armour.';
  }
  return 'Unknown item.';
}

function endRound(state, winner, reason) {
  state.phase = 'roundEnd';
  state.phaseT = 0;
  state.roundWinner = winner;
  state.roundReason = reason;
  const won = winner === 'us';
  if (won) state.scoreUs += 1; else state.scoreThem += 1;
  const payout = roundPayout(won, state.player.kills);
  state.money += payout;
  state.bomb.progress = 0;
  if (state.scoreUs >= WIN_ROUNDS) state.matchWinner = 'us';
  else if (state.scoreThem >= WIN_ROUNDS) state.matchWinner = 'them';
}

// One fixed step of round logic: phase timers, bomb timer, grenades, and
// the win checks (elimination, detonation, defuse, timeout).
export function stepRounds(state, dt, ctx) {
  state.phaseT += dt;
  if (state.phase === 'freeze' && state.phaseT >= FREEZE_TIME) {
    state.phase = 'live';
    state.phaseT = 0;
  } else if (state.phase === 'roundEnd' && state.phaseT >= 4) {
    if (state.matchWinner) {
      state.phase = 'matchEnd';
      state.phaseT = 0;
    } else {
      state.round += 1;
      startRound(state);
    }
  }
  if (state.phase !== 'live') return;

  // Bomb countdown once planted.
  if (state.bomb.state === 'planted') {
    state.bomb.timer -= dt;
    if (state.bomb.timer <= 0) {
      state.bomb.state = 'exploded';
      ctx.explosion(state.bomb.x, state.bomb.z);
      endRound(state, 'us', 'Spike detonated at Site ' + state.bomb.site);
      return;
    }
  }
  if (state.bomb.state === 'defused') {
    endRound(state, 'them', 'Ash defused the spike');
    return;
  }

  // Grenades fly, bounce once off the ground, then explode.
  for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
    const g = state.grenades[i];
    g.vy -= 22 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y < 0.15) { g.y = 0.15; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.6; g.vz *= 0.6; }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      ctx.explosion(g.x, g.z);
      const targets = [];
      if (state.player.alive) targets.push('player');
      for (const b of state.bots) if (b.alive) targets.push(b);
      for (const t of targets) {
        const tx = t === 'player' ? state.player.x : t.x;
        const tz = t === 'player' ? state.player.z : t.z;
        const d = Math.hypot(tx - g.x, tz - g.z);
        const dmg = blastDamage(d);
        if (dmg > 0) ctx.applyDamage(t, dmg, g.owner === 'player' ? 'player' : 'grenade');
      }
      state.grenades.splice(i, 1);
    }
  }

  // Elimination wins.
  const themAlive = aliveCount(state, 'them');
  const usAlive = aliveCount(state, 'us') + (state.player.alive ? 1 : 0);
  if (themAlive === 0) { endRound(state, 'us', 'Ash team eliminated'); return; }
  if (usAlive === 0) { endRound(state, 'them', 'Ember team eliminated'); return; }

  // Timeout favours the defenders.
  if (state.phaseT >= ROUND_TIME) {
    endRound(state, 'them', 'Time expired — Ash held the sites');
  }
}

export function roundClock(state) {
  if (state.phase === 'freeze') return Math.max(0, FREEZE_TIME - state.phaseT);
  if (state.phase === 'live') return Math.max(0, ROUND_TIME - state.phaseT);
  if (state.bomb.state === 'planted') return Math.max(0, state.bomb.timer);
  return 0;
}
