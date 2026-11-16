// world.js — the Foundry Yard map. An original two-site yard: Furnace (A) in
// the north-east corner, Crane Dock (B) in the north-west, a mid lane down the
// middle and a long side lane on each flank. Every solid box is both a mesh
// and an AABB collider, so bullets and feet agree about what is solid.
// Palette: dusk foundry — dark steel, warm concrete, ember-orange accents.

import * as THREE from 'three';

export const PALETTE = {
  sky: 0x3a2a1c,
  ground: 0x6b5a48,
  concrete: 0x8a7d6d,
  steel: 0x55606a,
  darkSteel: 0x4a525c,
  rust: 0x9a5a2c,
  ember: 0xff7a1a,
  amber: 0xffb347,
  crate: 0x8a6c44,
  crateDark: 0x6d543a,
  siteA: 0xff7a1a,
  siteB: 0x4fc3f7,
};

export const SITES = {
  A: { name: 'Furnace', x: 24, z: -18, r: 5.5, color: PALETTE.siteA },
  B: { name: 'Crane Dock', x: -24, z: -18, r: 5.5, color: PALETTE.siteB },
};

export const SPAWN_US = { x: -26, z: 18, yaw: 0.15 };
export const SPAWN_THEM = [
  { x: 26, z: -16, yaw: Math.PI },
  { x: 18, z: -20, yaw: Math.PI },
  { x: -18, z: -20, yaw: Math.PI },
  { x: -26, z: -16, yaw: Math.PI },
];

// Solid boxes: { x, z, w, d, h } centred on x/z. The yard itself is
// 72 wide (x -36..36) by 52 deep (z -26..26), ringed by perimeter walls.
const BOXES = [
  // perimeter walls (h 4)
  { x: 0, z: -27, w: 74, d: 2, h: 4 },
  { x: 0, z: 27, w: 74, d: 2, h: 4 },
  { x: -37, z: 0, w: 2, d: 56, h: 4 },
  { x: 37, z: 0, w: 2, d: 56, h: 4 },
  // mid lane blocks — the long sightline down the centre, broken by cover
  { x: 0, z: 6, w: 4, d: 2, h: 1.2 },
  { x: -2, z: -6, w: 2, d: 6, h: 2.2 },
  { x: 3, z: -12, w: 5, d: 2, h: 1.2 },
  // furnace hall (site A): big block + chimney column
  { x: 28, z: -22, w: 12, d: 6, h: 4 },
  { x: 33, z: -15, w: 3, d: 3, h: 7 },
  { x: 20, z: -14, w: 2, d: 8, h: 2.4 },
  // crane dock (site B): container stack + gantry legs
  { x: -28, z: -22, w: 12, d: 6, h: 3.4 },
  { x: -24, z: -14, w: 2, d: 8, h: 2.4 },
  { x: -33, z: -14, w: 2, d: 2, h: 6 },
  // flank crates and pipes
  { x: -14, z: 10, w: 4, d: 4, h: 1.6 },
  { x: 14, z: 12, w: 4, d: 4, h: 1.6 },
  { x: -12, z: -2, w: 3, d: 3, h: 2.6 },
  { x: 12, z: 0, w: 3, d: 3, h: 2.6 },
  { x: -6, z: 18, w: 6, d: 2, h: 1.2 },
  { x: 8, z: 20, w: 6, d: 2, h: 1.2 },
  { x: 0, z: -20, w: 8, d: 2, h: 1.4 },
];

export function buildWorld(scene) {
  const colliders = [];
  const wallMeshes = []; // raycast targets for line-of-sight and bullets
  const mat = (c, rough = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.15 });

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 55, 110);

  const hemi = new THREE.HemisphereLight(0xffe0b8, 0x4a3a28, 1.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.2);
  sun.position.set(20, 30, -14);
  scene.add(sun);
  const emberGlow = new THREE.PointLight(PALETTE.ember, 60, 30, 1.8);
  emberGlow.position.set(28, 5, -20);
  scene.add(emberGlow);
  const dockGlow = new THREE.PointLight(PALETTE.siteB, 25, 24, 1.8);
  dockGlow.position.set(-28, 5, -20);
  scene.add(dockGlow);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(76, 56), mat(PALETTE.ground, 1));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // faint yard markings: a centre line down mid and a ring around each site
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x8a7a5c });
  const midLine = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 52), lineMat);
  midLine.rotation.x = -Math.PI / 2;
  midLine.position.set(0, 0.02, 0);
  scene.add(midLine);
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      new THREE.MeshBasicMaterial({ color: site.color, transparent: true, opacity: 0.7 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    scene.add(ring);
    const label = makeLabelSprite(site.name + '  ·  SITE ' + key, site.color);
    label.position.set(site.x, 5.2, site.z);
    scene.add(label);
  }

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const mats = { concrete: mat(PALETTE.concrete), steel: mat(PALETTE.steel, 0.6), dark: mat(PALETTE.darkSteel, 0.6), rust: mat(PALETTE.rust), crate: mat(PALETTE.crate), crateDark: mat(PALETTE.crateDark) };
  BOXES.forEach((b, i) => {
    const pick = i < 4 ? mats.concrete : (b.h >= 6 ? mats.rust : (b.h <= 1.6 ? mats.crate : (i % 2 ? mats.steel : mats.concrete)));
    const mesh = new THREE.Mesh(boxGeo, pick);
    mesh.scale.set(b.w, b.h, b.d);
    mesh.position.set(b.x, b.h / 2, b.z);
    scene.add(mesh);
    wallMeshes.push(mesh);
    colliders.push({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, top: b.h });
  });

  return { colliders, wallMeshes };
}

// Text sprite drawn on a canvas — no external font or image asset.
function makeLabelSprite(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = 'rgba(10,8,6,0.65)';
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(cv);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  sprite.scale.set(10, 1.9, 1);
  return sprite;
}

// Circle-vs-AABB collision in the XZ plane. Returns the corrected position;
// walls shorter than the caller's eye height still block feet (they are cover,
// not steps) — the yard is flat, so any box whose top is above knee height
// blocks movement outright.
export function collide(colliders, x, z, radius) {
  let px = x, pz = z;
  for (const c of colliders) {
    if (c.top < 0.5) continue;
    const nx = Math.max(c.minX, Math.min(px, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pz, c.maxZ));
    const dx = px - nx, dz = pz - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      px = nx + (dx / d) * radius;
      pz = nz + (dz / d) * radius;
    } else {
      // centre inside the box: push out along the smallest penetration axis
      const pushL = px - c.minX + radius, pushR = c.maxX - px + radius;
      const pushU = pz - c.minZ + radius, pushD = c.maxZ - pz + radius;
      const m = Math.min(pushL, pushR, pushU, pushD);
      if (m === pushL) px = c.minX - radius;
      else if (m === pushR) px = c.maxX + radius;
      else if (m === pushU) pz = c.minZ - radius;
      else pz = c.maxZ + radius;
    }
  }
  // clamp to the yard
  px = Math.max(-35.4, Math.min(35.4, px));
  pz = Math.max(-25.4, Math.min(25.4, pz));
  return { x: px, z: pz };
}

export function insideSite(siteKey, x, z) {
  const s = SITES[siteKey];
  const dx = x - s.x, dz = z - s.z;
  return dx * dx + dz * dz < s.r * s.r;
}
