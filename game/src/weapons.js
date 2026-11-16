// weapons.js — weapon definitions, spread/recoil rules and grenades.
// Gunplay rule, stated once here: stopping to aim pays. Spread grows with
// movement speed, crouching shrinks it, and every shot adds bloom that only
// settles while you stop firing. Headshots deal double damage (see player.js).

export const WEAPONS = {
  pistol: {
    name: 'Heron-9 pistol', key: '1', cost: 0,
    damage: 26, headMult: 2, rpm: 320, mag: 12, reserveStart: 36,
    reload: 1.3, auto: false, spreadBase: 0.006, spreadMove: 0.030,
    kick: 0.011, bloomPerShot: 0.004, range: 60,
  },
  rifle: {
    name: 'Kestrel-5 rifle', key: '2', cost: 2700,
    damage: 34, headMult: 2, rpm: 600, mag: 30, reserveStart: 90,
    reload: 2.2, auto: true, spreadBase: 0.004, spreadMove: 0.034,
    kick: 0.016, bloomPerShot: 0.005, range: 90,
  },
  smg: {
    name: 'Swift-9 SMG', key: '3', cost: 1500,
    damage: 22, headMult: 2, rpm: 800, mag: 32, reserveStart: 96,
    reload: 1.9, auto: true, spreadBase: 0.009, spreadMove: 0.026,
    kick: 0.009, bloomPerShot: 0.004, range: 45,
  },
};

export const GRENADE_COST = 300;
export const ARMOR_COST = 650;
export const GRENADE_DAMAGE = 95; // at the centre of the blast
export const GRENADE_RADIUS = 7;
export const GRENADE_FUSE = 1.6;

// Current spread for a shot: base + movement penalty + accumulated bloom,
// crouching cuts the total by a third. Returns radians off the aim ray.
export function currentSpread(def, speed, crouched, bloom) {
  const move = Math.min(1, speed / 5.5);
  let s = def.spreadBase + def.spreadMove * move + bloom;
  if (crouched) s *= 0.66;
  return s;
}

// Damage after armour: armour absorbs 30% while it lasts, 1 armour point
// soaks 1 damage point of the absorbed share.
export function damageAfterArmor(raw, armor) {
  if (armor <= 0) return { hp: raw, armor: 0 };
  const absorbed = Math.min(armor, raw * 0.3);
  return { hp: raw - absorbed, armor: armor - absorbed };
}

// Grenade blast falloff: full damage at the centre, none past the radius.
export function blastDamage(dist) {
  if (dist >= GRENADE_RADIUS) return 0;
  return GRENADE_DAMAGE * (1 - dist / GRENADE_RADIUS);
}
