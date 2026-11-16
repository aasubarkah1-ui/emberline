// state.js — the one place game state lives. Every module reads and writes
// this object; nothing else keeps a parallel copy of round, money or health.
// Fixed-step simulation (1/60 s) advances this state; rendering only reads it.

export const SIM_DT = 1 / 60;
export const ROUND_TIME = 100; // seconds of live play per round
export const FREEZE_TIME = 6; // seconds of buy time before the round goes live
export const PLANT_TIME = 3; // seconds holding E to plant the spike
export const DEFUSE_TIME = 4; // seconds a defender needs to defuse
export const BOMB_TIME = 35; // seconds from plant to detonation
export const WIN_ROUNDS = 5; // first team to this many rounds takes the match
export const START_MONEY = 800;

// Deterministic PRNG (mulberry32) so a seed replays the same bot spawns and
// the same screenshot staging every run.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function freshState(seed) {
  return {
    seed,
    rng: makeRng(seed),
    phase: 'menu', // menu | freeze | live | roundEnd | matchEnd
    phaseT: 0, // seconds spent in the current phase
    round: 1,
    scoreUs: 0,
    scoreThem: 0,
    money: START_MONEY,
    roundWinner: null, // 'us' | 'them' | null
    roundReason: '',
    matchWinner: null,
    bomb: {
      state: 'carried', // carried | planting | planted | defusing | exploded | defused
      site: null, // 'A' | 'B' | null
      progress: 0, // 0..1 plant/defuse progress
      timer: 0, // seconds left once planted
      x: 0, z: 0,
    },
    player: {
      x: -26, z: 18, y: 0, // feet position on the yard
      vx: 0, vz: 0,
      yaw: 0.15, pitch: 0, // yaw 0 faces -Z (north, toward the sites)
      hp: 100, armor: 0,
      crouched: false, onGround: true,
      alive: true,
      weapon: 'rifle',
      weapons: { pistol: { mag: 12, reserve: 36 }, rifle: { mag: 30, reserve: 90 }, smg: { mag: 32, reserve: 96 } },
      owned: { pistol: true, rifle: true, smg: false },
      grenades: 1,
      spread: 0, // current aim bloom, radians
      recoil: 0, // accumulated pitch kick waiting to settle
      reloading: 0, // seconds left, 0 when not reloading
      fireCooldown: 0,
      lastDamageAt: -99,
      kills: 0,
    },
    bots: [], // filled by bots.js: { id, team, kind, x, z, yaw, hp, alive, ... }
    grenades: [], // live thrown grenades: { x, y, z, vx, vy, vz, fuse, owner }
    tracers: [], // { ax, ay, az, bx, by, bz, life } — visual only, pooled
    flashes: [], // muzzle-flash light anchors, visual only
    feed: [], // killfeed lines: { text, t }
    shotsFired: 0,
    shotsHit: 0,
    time: 0, // total simulated seconds
  };
}

// Money earned for one round's outcome; the buy menu spends from state.money.
export function roundPayout(won, kills) {
  return (won ? 1000 : 500) + kills * 300;
}
