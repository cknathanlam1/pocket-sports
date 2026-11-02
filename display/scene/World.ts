// 3D world in the design's poolside style (design/SPEC.md "Venue key art" + 3D asset list):
// toon-shaded primitives with ink outlines until GLTF assets exist. Engine coords map 1:1 to Three.
import * as THREE from 'three';
import { ITTF } from '../../engine/config.ts';
import type { Game } from '../../engine/game.ts';
import { BALL_R, HALF_L, HALF_W, NET_HALF_W, TABLE_TOP, type Side, sideSign } from '../../engine/physics.ts';
import type { Look } from '../../shared/art/Char.tsx';
import type { Quat } from '../../shared/protocol.ts';

const C = {
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

const BALL_VIS_R = BALL_R * 1.6; // drawn larger than real for readability on a laptop
const GHOSTS = 4;

// Per-frame scratch objects: sync() runs every frame, so it must not allocate (GC hitches show up as dropped frames).
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const _pos = new THREE.Vector3();
const _want = new THREE.Vector3();
const _look = new THREE.Vector3();
const _base = new THREE.Quaternion();
const _rel = new THREE.Quaternion();
const _tilt = new THREE.Quaternion();
const IDLE_TILT = new THREE.Quaternion().setFromAxisAngle(X_AXIS, 0.15);
const BASE_Q = [new THREE.Quaternion(), new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI)] as const;
// FX meshes share geometry; each gets its own material (opacity fades per instance).
const RING_GEO = new THREE.RingGeometry(0.04, 0.06, 28);
const SPARK_GEO = [new THREE.CircleGeometry(0.09, 5), new THREE.CircleGeometry(0.16, 5)] as const;

// Three-step toon ramp shared by all materials.
const ramp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 210, 210, 210, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
const toon = (color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
const inkMat = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });

/** Inverted-hull outline: a slightly larger ink copy rendered back-faces only. */
function outlined(geo: THREE.BufferGeometry, mat: THREE.Material, thickness = 1.06): THREE.Group {
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
function ghost(root: THREE.Object3D): void {
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
    o.renderOrder = 10; // after the ball and table, so they show through
  });
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Avatar {
  root: THREE.Group;
  body: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  /** Celebration pose until `until` (world clock, s). */
  pose: { kind: 'cheer' | 'sad'; until: number } | null;
  paddle: THREE.Group;
  mats: { outfit: THREE.MeshToonMaterial[]; skin: THREE.MeshToonMaterial[]; hair: THREE.MeshToonMaterial };
}

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 1, 0.05, 200);
  private ball: THREE.Group;
  private shadow: THREE.Mesh;
  private ghosts: THREE.Mesh[] = [];
  /** Ball position history for the ghost trail: a fixed ring of vectors, newest at histHead. */
  private hist = Array.from({ length: GHOSTS * 2 + 1 }, () => new THREE.Vector3());
  private histHead = 0;
  private histCount = 0;
  private avatars: [Avatar, Avatar];
  private camPos = new THREE.Vector3(0, 2.2, HALF_L + 2.6);
  private camLook = new THREE.Vector3(0, TABLE_TOP, -0.5);
  private shakeT = Infinity;
  private shakeAmp = 0;
  private shakeHits = 0;
  private clock = 0;
  private palms: THREE.Group[] = [];
  private machine: THREE.Group;
  private practice = false;
  private rings: Array<{ mesh: THREE.Mesh; t: number }> = [];
  private sparks: Array<{ mesh: THREE.Mesh; t: number }> = [];
  private squashT = Infinity;
  private pool: THREE.MeshBasicMaterial[] = [];

  constructor() {
    const s = this.scene;
    s.background = canvasTexture(4, 256, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, C.skyTop);
      g.addColorStop(1, C.skyBottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 256);
    });
    s.fog = new THREE.Fog(0xc9f0ff, 22, 48);

    s.add(new THREE.HemisphereLight(0xffffff, 0xf6ddb0, 1.6));
    const sun = new THREE.DirectionalLight(0xfff4c7, 2.2);
    sun.position.set(3, 8, 5);
    s.add(sun);

    this.buildVenue();
    this.buildTable();
    this.avatars = [this.buildAvatar(0), this.buildAvatar(1)];
    this.machine = this.buildMachine();

    // Ball: sun yellow + ink outline + highlight, always-on blob shadow, four ghosts for the trail.
    const ballGeo = new THREE.SphereGeometry(BALL_VIS_R, 20, 14);
    this.ball = outlined(ballGeo, new THREE.MeshBasicMaterial({ color: C.ball }), 1.22);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(BALL_VIS_R * 0.3, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    hl.position.set(-BALL_VIS_R * 0.4, BALL_VIS_R * 0.45, BALL_VIS_R * 0.4);
    this.ball.add(hl);
    s.add(this.ball);
    for (let i = 0; i < GHOSTS; i++) {
      const g = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: C.ball, transparent: true, opacity: 0.5 - i * 0.1, depthWrite: false }));
      g.scale.setScalar(1 - ((i + 1) / (GHOSTS + 1)) * 0.35);
      g.visible = false;
      this.ghosts.push(g);
      s.add(g);
    }
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_VIS_R * 1.1, 20),
      new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    s.add(this.shadow);
  }

  // ───────── Venue ─────────

  private buildVenue(): void {
    const s = this.scene;
    // Sand deck with tile lines.
    const deckTex = canvasTexture(256, 256, (ctx) => {
      ctx.fillStyle = '#F6DDB0';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = C.sandLine;
      ctx.lineWidth = 3;
      for (let i = 0; i <= 256; i += 64) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.stroke();
      }
    });
    deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
    deckTex.repeat.set(12, 12);
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), toon(0xffffff, { map: deckTex }));
    deck.rotation.x = -Math.PI / 2;
    s.add(deck);

    // Pool strips left and right, white coping, two floats.
    for (const x of [-4.4, 4.4]) {
      const poolMat = new THREE.MeshBasicMaterial({ color: C.pool });
      this.pool.push(poolMat);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 14), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, 0.006, 0);
      s.add(pool);
      const coping = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 14.3), new THREE.MeshBasicMaterial({ color: C.white }));
      coping.rotation.x = -Math.PI / 2;
      coping.position.set(x, 0.004, 0);
      s.add(coping);
    }
    const floatGeo = new THREE.TorusGeometry(0.32, 0.12, 10, 24);
    for (const [x, z, col] of [[-4.2, 0.8, 0xff5fa2], [4.6, 2.6, 0xffd23f]] as const) {
      const f = outlined(floatGeo, toon(col), 1.08);
      f.rotation.x = -Math.PI / 2;
      f.position.set(x, 0.08, z);
      s.add(f);
    }

    // Back rail, crowd and facades.
    const rail = outlined(new THREE.BoxGeometry(12, 0.22, 0.12), toon(C.cream), 1.03);
    rail.position.set(0, 1.0, -5.2);
    s.add(rail);
    for (const x of [-5.6, -2.8, 0, 2.8, 5.6]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), toon(C.cream));
      post.position.set(x, 0.5, -5.2);
      s.add(post);
    }
    const skins = [0xf1c9a0, 0xc98b5b, 0x8a5a3a, 0x5a3a28];
    const cols = [0xff8a1f, 0x2f6fdb, 0xffd23f, 0xf6baca, 0x5dc265, 0xffffff];
    for (let i = 0; i < 12; i++) {
      const x = -5.2 + i * 0.95 + (i % 3) * 0.07;
      const body = outlined(new THREE.CapsuleGeometry(0.2, 0.3, 4, 10), toon(cols[(i * 5) % 6]!), 1.08);
      body.position.set(x, 1.45, -5.6);
      const head = outlined(new THREE.SphereGeometry(0.17, 14, 10), toon(skins[(i * 3) % 4]!), 1.08);
      head.position.set(x, 1.9, -5.6);
      s.add(body, head);
    }
    const facade = (x: number, w: number, h: number, color: number) => {
      const b = outlined(new THREE.BoxGeometry(w, h, 0.6), toon(color), 1.01);
      b.position.set(x, h / 2, -9);
      s.add(b);
      for (let i = 0; i < Math.floor(w / 1.1); i++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), toon(C.window));
        win.position.set(x - w / 2 + 0.75 + i * 1.1, h - 0.9, -8.69);
        s.add(win);
      }
    };
    facade(-5, 6.5, 4, C.cream);
    facade(5, 6, 4.6, C.blush);

    // Bunting across the back.
    const flagGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.17, 0, 0), new THREE.Vector3(0.17, 0, 0), new THREE.Vector3(0, -0.36, 0)]);
    flagGeo.setIndex([0, 2, 1]);
    flagGeo.computeVertexNormals();
    for (let i = 0; i < 20; i++) {
      const x = -6.5 + i * 0.68;
      const sag = 3.4 - Math.sin((i / 19) * Math.PI) * 0.5;
      const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: C.flags[i % 5]!, side: THREE.DoubleSide }));
      flag.position.set(x, sag, -5.0);
      s.add(flag);
    }

    // Palms.
    const palm = (x: number, z: number, lean: number) => {
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
      s.add(g);
      this.palms.push(g);
    };
    palm(-6.6, -4, 0.08);
    palm(6.8, -3, -0.1);
    palm(-7.2, 3, 0.05);
  }

  private buildTable(): void {
    const g = new THREE.Group();
    const top = outlined(new THREE.BoxGeometry(ITTF.tableWidth, 0.03, ITTF.tableLength), toon(C.table), 1.008);
    top.position.y = TABLE_TOP - 0.015;
    g.add(top);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(ITTF.tableWidth + 0.01, 0.05, ITTF.tableLength + 0.01), toon(C.tableEdge));
    edge.position.y = TABLE_TOP - 0.05;
    g.add(edge);
    const lineMat = new THREE.MeshBasicMaterial({ color: C.white });
    const line = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, TABLE_TOP + 0.0008, z);
      g.add(m);
    };
    line(0.025, ITTF.tableLength, -HALF_W + 0.0125, 0);
    line(0.025, ITTF.tableLength, HALF_W - 0.0125, 0);
    line(ITTF.tableWidth, 0.025, 0, -HALF_L + 0.0125);
    line(ITTF.tableWidth, 0.025, 0, HALF_L - 0.0125);
    line(0.006, ITTF.tableLength, 0, 0);
    for (const x of [-HALF_W + 0.18, HALF_W - 0.18])
      for (const z of [-HALF_L + 0.35, HALF_L - 0.35]) {
        const leg = outlined(new THREE.BoxGeometry(0.06, TABLE_TOP - 0.06, 0.06), toon(C.tableEdge), 1.12);
        leg.position.set(x, (TABLE_TOP - 0.06) / 2, z);
        g.add(leg);
      }
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(NET_HALF_W * 2, ITTF.netHeight),
      new THREE.MeshBasicMaterial({ color: C.white, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }),
    );
    net.position.y = TABLE_TOP + ITTF.netHeight / 2;
    g.add(net);
    const tape = outlined(new THREE.BoxGeometry(NET_HALF_W * 2, 0.014, 0.008), new THREE.MeshBasicMaterial({ color: C.white }), 1.15);
    tape.position.y = TABLE_TOP + ITTF.netHeight;
    g.add(tape);
    for (const x of [-NET_HALF_W, NET_HALF_W]) {
      const post = outlined(new THREE.BoxGeometry(0.02, ITTF.netHeight + 0.03, 0.02), toon(C.white), 1.2);
      post.position.set(x, TABLE_TOP + ITTF.netHeight / 2, 0);
      g.add(post);
    }
    // Soft ground shadow under the table.
    const sh = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0.1, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2;
    sh.scale.set(1.1, 1.8, 1);
    sh.position.y = 0.003;
    g.add(sh);
    this.scene.add(g);
  }

  // ───────── Characters (big-head humans, ~2.5 heads tall) ─────────

  private buildAvatar(side: Side): Avatar {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const outfit = toon(side === 0 ? C.p1 : C.p2);
    const sleeve = toon(side === 0 ? C.p1 : C.p2);
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
    // Left arm.
    const armL = new THREE.Group();
    armL.position.set(-0.26, 0.92, 0);
    add(armL, new THREE.CapsuleGeometry(0.06, 0.26, 4, 8), sleeve, 0, -0.18, 0, 1.15);
    add(armL, new THREE.SphereGeometry(0.075, 10, 8), skinB, 0, -0.38, 0, 1.15);
    armL.rotation.z = 0.25;
    body.add(armL);
    // Right (paddle) arm.
    const armR = new THREE.Group();
    armR.position.set(0.26, 0.92, 0);
    add(armR, new THREE.CapsuleGeometry(0.06, 0.26, 4, 8), sleeve, 0, -0.18, 0, 1.15);
    add(armR, new THREE.SphereGeometry(0.075, 10, 8), skinB, 0, -0.38, 0, 1.15);
    armR.rotation.z = -0.4;
    body.add(armR);

    root.rotation.y = side === 0 ? 0 : Math.PI;
    if (side === 0) ghost(root);
    this.scene.add(root);

    const paddle = this.buildPaddle(side === 0 ? C.p1 : C.p2, side === 0 ? 'circle' : 'diamond');
    this.scene.add(paddle);
    return { root, body, armL, armR, pose: null, paddle, mats: { outfit: [outfit, sleeve], skin: [skinA, skinB], hair } };
  }

  /** Oversized round face, white rim, wood grip, white ●/◆ marker. Face normal −z in local space. */
  private buildPaddle(color: number, marker: 'circle' | 'diamond'): THREE.Group {
    const paddle = new THREE.Group();
    const r = 0.095;
    const faceGeo = new THREE.CylinderGeometry(r, r, 0.014, 28);
    faceGeo.rotateX(Math.PI / 2);
    const rim = outlined(new THREE.CylinderGeometry(r * 1.17, r * 1.17, 0.012, 28).rotateX(Math.PI / 2), toon(C.white), 1.06);
    rim.position.y = 0.11;
    const face = new THREE.Mesh(faceGeo, toon(color));
    face.position.set(0, 0.11, 0);
    const mk = new THREE.Mesh(marker === 'circle' ? new THREE.CircleGeometry(r * 0.33, 20) : new THREE.CircleGeometry(r * 0.38, 4), new THREE.MeshBasicMaterial({ color: C.white, side: THREE.DoubleSide }));
    mk.position.set(0, 0.11, -0.0085);
    mk.rotation.y = Math.PI;
    const handle = outlined(new THREE.BoxGeometry(0.032, 0.11, 0.024), toon(C.wood), 1.12);
    paddle.add(rim, face, mk, handle);
    return paddle;
  }

/** Practice ball machine: a chunky coral box with a lagoon barrel, at the far end. */
  private buildMachine(): THREE.Group {
    const g = new THREE.Group();
    const body = outlined(new THREE.BoxGeometry(0.5, 0.55, 0.45), toon(0xe57a58), 1.04);
    body.position.y = TABLE_TOP + 0.05;
    const legs = outlined(new THREE.CylinderGeometry(0.04, 0.04, TABLE_TOP - 0.2, 8), toon(0x10285a), 1.1);
    legs.position.y = (TABLE_TOP - 0.2) / 2;
    const barrel = outlined(new THREE.CylinderGeometry(0.07, 0.09, 0.32, 16).rotateX(Math.PI / 2), toon(0x5ccfe0), 1.08);
    barrel.position.set(0, TABLE_TOP + 0.3, 0.2);
    const hopper = outlined(new THREE.CylinderGeometry(0.22, 0.12, 0.25, 16), toon(0xfffdf8), 1.05);
    hopper.position.y = TABLE_TOP + 0.45;
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), new THREE.MeshBasicMaterial({ color: C.ball }));
      b.position.set(Math.cos(i * 1.3) * 0.1, TABLE_TOP + 0.58, Math.sin(i * 1.3) * 0.1);
      g.add(b);
    }
    g.add(body, legs, barrel, hopper);
    g.position.set(0, 0, -(HALF_L + 0.45));
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  /** Practice mode: show the ball machine instead of Marlo. */
  setPractice(on: boolean): void {
    this.practice = on;
    this.machine.visible = on;
    this.avatars[1].root.visible = !on;
    this.avatars[1].paddle.visible = !on;
  }

  /** Point reaction (design 7b): cheer = arms up + hop, sad = slump. Held ≥ 300 ms. */
  pose(side: Side, kind: 'cheer' | 'sad', seconds = 1.4): void {
    this.avatars[side].pose = { kind, until: this.clock + seconds };
  }

  /** Expanding ring where the ball hits the table. */
  bounceRing(x: number, z: number): void {
    const m = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, TABLE_TOP + 0.003, z);
    this.scene.add(m);
    this.rings.push({ mesh: m, t: 0 });
    this.squashT = 0;
  }

  /** Star spark at the contact point. */
  spark(x: number, y: number, z: number, big: boolean): void {
    const m = new THREE.Mesh(SPARK_GEO[big ? 1 : 0], new THREE.MeshBasicMaterial({ color: big ? 0xffd23f : 0xffffff, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(this.camera.position);
    this.scene.add(m);
    this.sparks.push({ mesh: m, t: 0 });
  }

  private updateFx(dt: number): void {
    for (const r of this.rings) {
      r.t += dt;
      const k = r.t / 0.45;
      r.mesh.scale.setScalar(1 + k * 4);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
    }
    for (const sp of this.sparks) {
      sp.t += dt;
      const k = sp.t / 0.25;
      sp.mesh.scale.setScalar(0.6 + k * 1.2);
      sp.mesh.rotation.z += dt * 6;
      (sp.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
    }
    this.reap(this.rings);
    this.reap(this.sparks);
    // Ball squash for 70 ms after a bounce.
    this.squashT += dt;
    const sq = this.squashT < 0.07 ? 1 - 0.35 * Math.sin((this.squashT / 0.07) * Math.PI) : 1;
    this.ball.scale.set(1 + (1 - sq) * 0.5, sq, 1 + (1 - sq) * 0.5);
    // Gentle pool shimmer.
    const sh = 0.5 + 0.5 * Math.sin(this.clock * 1.3);
    for (const m of this.pool) m.color.setRGB(0.36 + sh * 0.04, 0.81 + sh * 0.03, 0.88 + sh * 0.02);
  }

  private reap(list: Array<{ mesh: THREE.Mesh; t: number }>): void {
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i]!.t <= 0.5) continue;
      this.scene.remove(list[i]!.mesh);
      (list[i]!.mesh.material as THREE.Material).dispose(); // geometry is shared
      list.splice(i, 1);
    }
  }

  setLooks(near: Look, far: Look): void {
    for (const [side, look] of [[0, near], [1, far]] as const) {
      const m = this.avatars[side].mats;
      for (const o of m.outfit) o.color.set(look.outfit);
      for (const s of m.skin) s.color.set(look.skin);
      m.hair.color.set(look.hair);
    }
  }

  /** Camera shake: amplitude in metres, `hits` decaying jolts (design 7d). */
  shake(amp: number, hits: number): void {
    this.shakeT = 0;
    this.shakeAmp = amp;
    this.shakeHits = hits;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Copy engine state into the scene. `humanQ` is the near player's paddle orientation from input. */
  sync(game: Game, humanQ: Quat | null, dt: number): void {
    this.clock += dt;
    const b = game.ball.p;
    this.ball.position.set(b.x, b.y, b.z);
    const overTable = Math.abs(b.x) <= HALF_W && Math.abs(b.z) <= HALF_L && b.y >= TABLE_TOP;
    const groundY = overTable ? TABLE_TOP + 0.001 : 0.004;
    const h = Math.max(b.y - BALL_R - groundY, 0);
    this.shadow.position.set(b.x, groundY, b.z);
    this.shadow.scale.setScalar(1 + h * 0.6);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 / (1 + h * 2.2);

    // Ghost trail above the speed threshold.
    const v = game.ball.v;
    const fast = game.ballLive && Math.hypot(v.x, v.y, v.z) > game.cfg.render.trailMinSpeed;
    const n = this.hist.length;
    this.histHead = (this.histHead + n - 1) % n;
    this.hist[this.histHead]!.set(b.x, b.y, b.z);
    this.histCount = Math.min(this.histCount + 1, n);
    for (let i = 0; i < this.ghosts.length; i++) {
      const back = (i + 1) * 2;
      const g = this.ghosts[i]!;
      g.visible = fast && back < this.histCount;
      if (g.visible) g.position.copy(this.hist[(this.histHead + back) % n]!);
    }

    this.syncAvatar(game, 0, humanQ);
    this.syncAvatar(game, 1, null);
    this.updateFx(dt);
    for (let i = 0; i < this.palms.length; i++) this.palms[i]!.rotation.x = Math.sin(this.clock * 0.8 + i) * 0.02;
    this.updateCamera(game, dt);
  }

  private syncAvatar(game: Game, side: Side, q: Quat | null): void {
    const p = game.players[side];
    const a = this.avatars[side];
    a.root.position.set(p.x, 0, p.z);
    const sign = sideSign(side);
    const sinceSwing = (game.simTime - p.swingAt) / game.cfg.physics.gameSpeed;
    const swingAnim = sinceSwing >= 0 && sinceSwing < 0.3 ? Math.sin((sinceSwing / 0.3) * Math.PI) : 0;
    // Ready bounce + swing squash.
    const pose = a.pose && this.clock < a.pose.until ? a.pose.kind : null;
    if (pose === 'cheer') {
      // Arms up, hop.
      a.body.position.y = Math.abs(Math.sin(this.clock * 9)) * 0.16;
      a.body.rotation.x = 0;
      a.armL.rotation.z = 2.6;
      a.armR.rotation.z = -2.6;
      a.armR.rotation.x = 0;
    } else if (pose === 'sad') {
      // Slump forward, arms hang.
      a.body.position.y = -0.03;
      a.body.rotation.x = 0.22;
      a.armL.rotation.z = 0.08;
      a.armR.rotation.z = -0.08;
      a.armR.rotation.x = 0;
    } else {
      a.body.position.y = Math.abs(Math.sin(this.clock * 4 + side)) * 0.025;
      a.body.rotation.x = 0;
      a.armL.rotation.z = 0.25;
      a.armR.rotation.z = -0.4;
      a.armR.rotation.x = -swingAnim * 1.2;
    }
    a.body.scale.set(1 + swingAnim * 0.04, 1 - swingAnim * 0.04, 1);

    // Paddle at the hand: forehand to the player's right, backhand to the left.
    const handSide = p.forehand ? 1 : -1;
    const c = game.contact;
    const targetY = c && c.side === side ? c.p.y : TABLE_TOP + 0.15;
    _pos.set(p.x + sign * handSide * 0.42, 0, p.z - sign * (0.32 + swingAnim * 0.3));
    _pos.y = THREE.MathUtils.lerp(a.paddle.position.y || targetY, targetY, 0.15);
    a.paddle.position.copy(_pos);

    _base.copy(BASE_Q[side]);
    if (q) _rel.set(q[0], q[1], q[2], q[3]);
    else _rel.copy(IDLE_TILT);
    _tilt.setFromAxisAngle(Y_AXIS, -handSide * swingAnim * 0.6);
    a.paddle.quaternion.copy(_base).multiply(_tilt).multiply(_rel);
  }

  private updateCamera(game: Game, dt: number): void {
    const me = game.players[0];
    // Behind and above the near player, looking down the table (design 1E key art).
    _want.set(me.x + 0.75, 2.75, Math.max(me.z, HALF_L + 0.4) + 2.1);
    _look.set(me.x * 0.3 + 0.15, TABLE_TOP - 0.15, -0.85);
    const k = 1 - Math.exp(-dt * 4);
    this.camPos.lerp(_want, k);
    this.camLook.lerp(_look, k);
    this.camera.position.copy(this.camPos);
    this.shakeT += dt;
    const dur = 0.06 * this.shakeHits;
    if (this.shakeT < dur) {
      const decay = 1 - this.shakeT / dur;
      const ph = Math.floor((this.shakeT / dur) * this.shakeHits);
      const dir = ph % 2 ? -1 : 1;
      this.camera.position.x += dir * this.shakeAmp * decay;
      this.camera.position.y += -dir * this.shakeAmp * 0.6 * decay;
    }
    this.camera.lookAt(this.camLook);
  }
}
