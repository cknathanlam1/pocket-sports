// Shared 3D building blocks for every venue: palette, toon shading with ink outlines, the see-through
// "ghost" look for the near player, canvas textures, palms, and the big-head character.
import * as THREE from 'three';
import type { Look } from '../../shared/art/Char.tsx';

export const C = {
  ink: 0x10285a,
  skyTop: '#3FB8FF',
  skyBottom: '#C9F0FF',
  sand: 0xf6ddb0,
  sandLine: '#E8C98E',
  pool: 0x5ccfe0,
  table: 0x1fa59b,
  tableEdge: 0x137a73,
  white: 0xffffff,
  cream: 0xfffdf8,
  blush: 0xfadcd0,
  window: 0x7fa2dc,
  ball: 0xffd23f,
  palm: 0x3fae6a,
  trunk: 0x8a5a3a,
  wood: 0xc98b5b,
  pants: 0xf8f4ec,
  p1: 0x2f6fdb,
  p2: 0xff8a1f,
  flags: [0xff5fa2, 0xffd23f, 0x5dc265, 0xff8a1f, 0x2f6fdb],
};

// Three-step toon ramp shared by all materials.
const ramp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 210, 210, 210, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
export const toon = (color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
export const inkMat = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });

/** Inverted-hull outline: a slightly larger ink copy rendered back-faces only. */
export function outlined(geo: THREE.BufferGeometry, mat: THREE.Material, thickness = 1.06): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geo, mat));
  const hull = new THREE.Mesh(geo, inkMat);
  hull.scale.setScalar(thickness);
  g.add(hull);
  return g;
}

/** See-through look for the near player, who stands between the camera and the ball. */
const GHOST_OPACITY = 0.28;
const ghostInk = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide, transparent: true, opacity: GHOST_OPACITY + 0.12, depthWrite: false });
export function ghost(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.material === inkMat) {
      o.material = ghostInk;
    } else {
      const m = o.material as THREE.Material;
      m.transparent = true;
      m.opacity = GHOST_OPACITY;
      m.depthWrite = false;
    }
    o.renderOrder = 10; // after the ball and court, so they show through
  });
}

/** Undo `ghost` (local two-player uses a side camera, so nobody stands in front of it). */
export function unghost(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.material === ghostInk) o.material = inkMat;
    else {
      const m = o.material as THREE.Material;
      m.transparent = false;
      m.opacity = 1;
      m.depthWrite = true;
    }
    o.renderOrder = 0;
  });
}

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sky gradient + fog + hemisphere and sun lights. */
export function skyAndLight(s: THREE.Scene, fogNear: number, fogFar: number): void {
  s.background = canvasTexture(4, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, C.skyTop);
    g.addColorStop(1, C.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
  });
  s.fog = new THREE.Fog(0xc9f0ff, fogNear, fogFar);
  s.add(new THREE.HemisphereLight(0xffffff, 0xf6ddb0, 1.6));
  const sun = new THREE.DirectionalLight(0xfff4c7, 2.2);
  sun.position.set(3, 8, 5);
  s.add(sun);
}

/** A leaning palm tree; returns its group so callers can sway it. */
export function palm(x: number, z: number, lean: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 3.4, 8), toon(C.trunk));
  trunk.position.y = 1.7;
  g.add(trunk);
  for (let i = 0; i < 6; i++) {
    const leaf = outlined(new THREE.SphereGeometry(1, 10, 6), toon(C.palm), 1.06);
    leaf.scale.set(1.1, 0.12, 0.3);
    leaf.position.set(Math.cos((i / 6) * Math.PI * 2) * 0.8, 3.35, Math.sin((i / 6) * Math.PI * 2) * 0.8);
    leaf.rotation.y = -(i / 6) * Math.PI * 2;
    leaf.rotation.z = -0.35;
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  g.rotation.z = lean;
  g.scale.setScalar(scale);
  return g;
}

// ───────── Characters (big-head humans, ~2.5 heads tall) ─────────

export interface Avatar {
  root: THREE.Group;
  body: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** Celebration pose until `until` (world clock, s). */
  pose: { kind: 'cheer' | 'sad'; until: number } | null;
  mats: { outfit: THREE.MeshToonMaterial[]; skin: THREE.MeshToonMaterial[]; hair: THREE.MeshToonMaterial };
}

/** Build a character facing −z (rotate the root by π for the far side). Not added to any scene. */
export function makeAvatar(outfitColor: number): Avatar {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const outfit = toon(outfitColor);
  const sleeve = toon(outfitColor);
  const skinA = toon(0xc98b5b);
  const skinB = toon(0xc98b5b);
  const hair = toon(0x1e1410);

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, k = 1.06) => {
    const m = outlined(geo, mat, k);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  // Legs + shoes.
  for (const x of [-0.11, 0.11]) {
    add(body, new THREE.CapsuleGeometry(0.075, 0.32, 4, 8), toon(C.pants), x, 0.27, 0, 1.1);
    add(body, new THREE.SphereGeometry(0.11, 12, 8), toon(C.white), x, 0.06, -0.03, 1.1).scale.set(1, 0.6, 1.4);
  }
  // Torso with white stripe.
  add(body, new THREE.CapsuleGeometry(0.22, 0.32, 6, 14), outfit, 0, 0.78, 0, 1.05);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.05, 16, 1, true), toon(C.white));
  stripe.position.y = 0.66;
  body.add(stripe);
  // Head (40% of height), ears, hair cap.
  const headY = 1.36;
  add(body, new THREE.SphereGeometry(0.34, 22, 16), skinA, 0, headY, 0, 1.04);
  for (const x of [-0.34, 0.34]) add(body, new THREE.SphereGeometry(0.07, 10, 8), skinB, x, headY, 0, 1.15);
  const hairCap = outlined(new THREE.SphereGeometry(0.355, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 1.03);
  hairCap.position.y = headY + 0.01;
  hairCap.rotation.x = 0.75; // tipped back so it covers the back of the head (the camera sees the near player from behind)
  body.add(hairCap);
  const arm = (x: number, rz: number) => {
    const a = new THREE.Group();
    a.position.set(x, 0.92, 0);
    add(a, new THREE.CapsuleGeometry(0.06, 0.26, 4, 8), sleeve, 0, -0.18, 0, 1.15);
    add(a, new THREE.SphereGeometry(0.075, 10, 8), skinB, 0, -0.38, 0, 1.15);
    a.rotation.z = rz;
    body.add(a);
    return a;
  };
  const armL = arm(-0.26, 0.25);
  const armR = arm(0.26, -0.4);
  return { root, body, armL, armR, pose: null, mats: { outfit: [outfit, sleeve], skin: [skinA, skinB], hair } };
}

export function applyLook(a: Avatar, look: Look): void {
  for (const o of a.mats.outfit) o.color.set(look.outfit);
  for (const s of a.mats.skin) s.color.set(look.skin);
  a.mats.hair.color.set(look.hair);
}

/** Cheer (arms up, hop) or sad (slump) while a point pose is held. Returns true if it posed the body. */
export function animatePose(a: Avatar, clock: number): boolean {
  const pose = a.pose && clock < a.pose.until ? a.pose.kind : null;
  if (pose === 'cheer') {
    a.body.position.y = Math.abs(Math.sin(clock * 9)) * 0.16;
    a.body.rotation.x = 0;
    a.armL.rotation.set(0, 0, 2.6);
    a.armR.rotation.set(0, 0, -2.6);
    return true;
  }
  if (pose === 'sad') {
    a.body.position.y = -0.03;
    a.body.rotation.x = 0.22;
    a.armL.rotation.set(0, 0, 0.08);
    a.armR.rotation.set(0, 0, -0.08);
    return true;
  }
  return false;
}
