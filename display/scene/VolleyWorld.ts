// Beach volleyball venue in the same toon style: sand, sea, a 16 × 8 m court, net with antennas,
// palms and umbrellas, four players (each side: main player + AI setter). Engine coords map 1:1.
import * as THREE from 'three';
import type { Side } from '../../engine/physics.ts';
import type { VContact, VPlayer, VolleyGame } from '../../engine/volley/game.ts';
import type { Look } from '../../shared/art/Char.tsx';
import type { Quat } from '../../shared/protocol.ts';
import { type Avatar, C, animatePose, applyLook, canvasTexture, ghost, makeAvatar, outlined, palm, skyAndLight, toon, unghost } from './kit.ts';

const SCALE = 1.15; // volleyball players are a bit taller than the table tennis cast
const BALL_VIS = 1.35; // drawn a little larger for readability
const JUMP_H = 0.75; // m
const JUMP_T = 0.7; // s (sim) for the whole jump
const RING_GEO = new THREE.RingGeometry(0.14, 0.2, 28);
const SPARK_GEO = [new THREE.CircleGeometry(0.22, 5), new THREE.CircleGeometry(0.38, 5)] as const;

// Kinect-style timing circle: a fixed target ring where the ball will be played, and a ring that shrinks
// onto it, meeting it exactly at the moment to swing.
const TARGET_R = 0.55; // m
const SHRINK_FROM = 3.2; // m: radius when the circle appears
const CUE_COLORS = { p1: 0x2f6fdb, p2: 0xff8a1f, now: 0xffd23f };

const _want = new THREE.Vector3();
const _look = new THREE.Vector3();
const _q = new THREE.Quaternion();
const REST_R = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.4));

/** Which avatar each [side][who] is, and whether it's a side's main player. */
interface Slot {
  a: Avatar;
  side: Side;
  who: 0 | 1;
}

export class VolleyWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 300);
  private ball: THREE.Group;
  private shadow: THREE.Mesh;
  private slots: Slot[] = [];
  private view: 'behind' | 'side' = 'behind';
  private camPos = new THREE.Vector3(0, 5.6, 15);
  private camLook = new THREE.Vector3(0, 1.4, -3);
  private shakeT = Infinity;
  private shakeAmp = 0;
  private shakeHits = 0;
  private clock = 0;
  private palms: THREE.Group[] = [];
  private sea: THREE.MeshBasicMaterial;
  private rings: Array<{ mesh: THREE.Mesh; t: number }> = [];
  private sparks: Array<{ mesh: THREE.Mesh; t: number }> = [];
  private squashT = Infinity;
  private ballR: number;
  private cueTarget: THREE.Mesh;
  private cueRing: THREE.Mesh;

  constructor(ballR: number, halfL: number, halfW: number, netHeight: number, netHalfW: number) {
    this.ballR = ballR;
    const s = this.scene;
    skyAndLight(s, 40, 90);
    this.sea = new THREE.MeshBasicMaterial({ color: C.pool });
    this.buildBeach(halfL);
    this.buildCourt(halfL, halfW, netHeight, netHalfW);
    for (const side of [0, 1] as const)
      for (const who of [0, 1] as const) {
        const a = makeAvatar(side === 0 ? C.p1 : C.p2);
        a.root.scale.setScalar(SCALE);
        a.root.rotation.y = side === 0 ? 0 : Math.PI;
        if (side === 0 && who === 0) ghost(a.root);
        s.add(a.root);
        this.slots.push({ a, side, who });
      }

    // Volleyball: white with blue and yellow panels, ink outline.
    const tex = canvasTexture(128, 64, (ctx) => {
      ctx.fillStyle = '#FFFDF8';
      ctx.fillRect(0, 0, 128, 64);
      ctx.fillStyle = '#2F6FDB';
      ctx.fillRect(0, 10, 128, 12);
      ctx.fillStyle = '#FFD23F';
      ctx.fillRect(0, 40, 128, 12);
    });
    const geo = new THREE.SphereGeometry(ballR * BALL_VIS, 24, 16);
    this.ball = outlined(geo, new THREE.MeshBasicMaterial({ map: tex }), 1.12);
    s.add(this.ball);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(ballR * BALL_VIS * 1.2, 20), new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0.35, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    s.add(this.shadow);

    const flat = (inner: number, outer: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 56), new THREE.MeshBasicMaterial({ color: CUE_COLORS.p1, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 5;
      m.visible = false;
      s.add(m);
      return m;
    };
    this.cueTarget = flat(TARGET_R - 0.08, TARGET_R);
    this.cueRing = flat(0.9, 1); // unit ring, scaled to the current radius
  }

  // ───────── Venue ─────────

  private buildBeach(halfL: number): void {
    const s = this.scene;
    const sandTex = canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = '#F6DDB0';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#EACB93';
      for (let i = 0; i < 90; i++) ctx.fillRect((i * 53) % 128, (i * 97) % 128, 2, 2);
    });
    sandTex.wrapS = sandTex.wrapT = THREE.RepeatWrapping;
    sandTex.repeat.set(30, 30);
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), toon(0xffffff, { map: sandTex }));
    sand.rotation.x = -Math.PI / 2;
    s.add(sand);
    // Sea along the far end, with a white foam line.
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(140, 60), this.sea);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, 0.01, -halfL - 12 - 30);
    s.add(sea);
    const foam = new THREE.Mesh(new THREE.PlaneGeometry(140, 0.6), new THREE.MeshBasicMaterial({ color: C.white }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, 0.012, -halfL - 12);
    s.add(foam);

    for (const [x, z, lean] of [
      [-11, -9, 0.1],
      [12, -6, -0.12],
      [-13, 4, 0.06],
      [13, 7, -0.05],
      [-9, 12, 0.08],
    ] as const) {
      const g = palm(x, z, lean, 1.4);
      s.add(g);
      this.palms.push(g);
    }
    // Umbrellas and towels along the sides, and a row of spectators.
    const umbrella = (x: number, z: number, col: number) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), toon(C.cream));
      pole.position.set(x, 1.15, z);
      const top = outlined(new THREE.ConeGeometry(1.2, 0.5, 10), toon(col), 1.04);
      top.position.set(x, 2.4, z);
      s.add(pole, top);
    };
    umbrella(-8.5, -3, 0xff5fa2);
    umbrella(8.8, 1.5, 0xffd23f);
    umbrella(-8.8, 6, 0x5dc265);
    const skins = [0xf1c9a0, 0xc98b5b, 0x8a5a3a, 0x5a3a28];
    const cols = [0xff8a1f, 0x2f6fdb, 0xffd23f, 0xf6baca, 0x5dc265, 0xffffff];
    for (let i = 0; i < 14; i++) {
      const x = i < 7 ? -7.2 : 7.2;
      const z = -6 + (i % 7) * 2;
      const body = outlined(new THREE.CapsuleGeometry(0.22, 0.34, 4, 10), toon(cols[(i * 5) % 6]!), 1.08);
      body.position.set(x + (i % 2) * 0.3, 0.5, z);
      const head = outlined(new THREE.SphereGeometry(0.19, 14, 10), toon(skins[(i * 3) % 4]!), 1.08);
      head.position.set(x + (i % 2) * 0.3, 1.0, z);
      s.add(body, head);
    }
  }

  private buildCourt(halfL: number, halfW: number, netH: number, netHalfW: number): void {
    const s = this.scene;
    // Court lines: blue tape, 5 cm wide (beach courts have no centre line).
    const tape = new THREE.MeshBasicMaterial({ color: C.p1 });
    const line = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), tape);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.015, z);
      s.add(m);
    };
    line(0.08, halfL * 2, -halfW, 0);
    line(0.08, halfL * 2, halfW, 0);
    line(halfW * 2, 0.08, 0, -halfL);
    line(halfW * 2, 0.08, 0, halfL);
    // Net: posts, translucent mesh, white top band, red/white antennas at the sidelines.
    for (const x of [-netHalfW - 0.4, netHalfW + 0.4]) {
      const post = outlined(new THREE.CylinderGeometry(0.06, 0.06, netH + 0.2, 10), toon(C.cream), 1.1);
      post.position.set(x, (netH + 0.2) / 2, 0);
      s.add(post);
    }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(netHalfW * 2, 1.0), new THREE.MeshBasicMaterial({ color: C.ink, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    mesh.position.y = netH - 0.5;
    s.add(mesh);
    const band = outlined(new THREE.BoxGeometry(netHalfW * 2, 0.07, 0.02), new THREE.MeshBasicMaterial({ color: C.white }), 1.05);
    band.position.y = netH - 0.035;
    s.add(band);
    for (const x of [-halfW, halfW]) {
      for (let i = 0; i < 6; i++) {
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.15, 6), new THREE.MeshBasicMaterial({ color: i % 2 ? C.white : 0xe5484d }));
        seg.position.set(x, netH - 0.9 + 0.15 * i + 0.9, 0);
        s.add(seg);
      }
    }
  }

  // ───────── Runtime interface (same as World) ─────────

  setLooks(near: Look, far: Look): void {
    for (const sl of this.slots) {
      const base = sl.side === 0 ? near : far;
      // Teammates wear the same outfit with their own hair, so each pair reads as a team.
      applyLook(sl.a, sl.who === 0 ? base : { ...base, hair: sl.side === 0 ? '#C0623A' : '#3A2A1E' });
    }
  }

  setView(view: 'behind' | 'side'): void {
    if (view === this.view) return;
    this.view = view;
    const near = this.slots[0]!.a.root;
    if (view === 'side') unghost(near);
    else ghost(near);
  }

  setPractice(_on: boolean): void {
    /* no ball machine in volleyball */
  }

  nudgeBall(_dx: number, _dy: number, _dz: number): void {
    /* volleyball is local only */
  }

  pose(side: Side, kind: 'cheer' | 'sad', seconds = 1.4): void {
    for (const sl of this.slots) if (sl.side === side) sl.a.pose = { kind, until: this.clock + seconds };
  }

  /** Sand puff ring where the ball lands. */
  bounceRing(x: number, z: number): void {
    const m = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, z);
    this.scene.add(m);
    this.rings.push({ mesh: m, t: 0 });
    this.squashT = 0;
  }

  spark(x: number, y: number, z: number, big: boolean): void {
    const m = new THREE.Mesh(SPARK_GEO[big ? 1 : 0], new THREE.MeshBasicMaterial({ color: big ? 0xffd23f : 0xffffff, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(this.camera.position);
    this.scene.add(m);
    this.sparks.push({ mesh: m, t: 0 });
  }

  shake(amp: number, hits: number): void {
    this.shakeT = 0;
    this.shakeAmp = amp * 2.5; // bigger venue, bigger jolt
    this.shakeHits = hits;
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * `humanQ`: side 0's main player's hand (phone 1). `farQ`: side 1's (two players facing each other).
   * `mateQ`: side 0's setter (two players on the same team).
   */
  sync(game: VolleyGame, humanQ: Quat | null, dt: number, farQ: Quat | null = null, mateQ: Quat | null = null): void {
    this.clock += dt;
    const b = game.ball.p;
    this.ball.position.set(b.x, b.y, b.z);
    this.ball.rotation.x += dt * Math.min(12, Math.hypot(game.ball.v.x, game.ball.v.z) * 0.8);
    const h = Math.max(b.y - this.ballR, 0);
    this.shadow.position.set(b.x, 0.02, b.z);
    this.shadow.scale.setScalar(1 + h * 0.25);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.38 / (1 + h * 0.5);
    for (const sl of this.slots) this.syncAvatar(game, sl, sl.who === 0 ? (sl.side === 0 ? humanQ : farQ) : sl.side === 0 ? mateQ : null);
    this.syncCue(game);
    this.updateFx(dt);
    for (let i = 0; i < this.palms.length; i++) this.palms[i]!.rotation.x = Math.sin(this.clock * 0.7 + i) * 0.025;
    const sh = 0.5 + 0.5 * Math.sin(this.clock * 0.9);
    this.sea.color.setRGB(0.3 + sh * 0.04, 0.74 + sh * 0.04, 0.88 + sh * 0.03);
    this.updateCamera(game, dt);
  }

  private syncAvatar(game: VolleyGame, sl: Slot, q: Quat | null): void {
    const p: VPlayer = game.teams[sl.side][sl.who];
    const a = sl.a;
    a.root.position.set(p.x, this.jump(game, sl, p), p.z);
    if (animatePose(a, this.clock)) return;
    const since = game.simTime - p.actionAt;
    const act = since >= 0 && since < 0.4 ? p.action : null;
    a.body.rotation.x = 0;
    a.body.position.y = Math.abs(Math.sin(this.clock * 4 + sl.side * 2 + sl.who)) * 0.02;
    if (act === 'dig') {
      // Platform: both arms forward and together, knees bent.
      a.body.position.y = -0.12;
      a.body.rotation.x = 0.3;
      a.armL.rotation.set(-1.3, 0, -0.25);
      a.armR.rotation.set(-1.3, 0, 0.25);
    } else if (act === 'set') {
      a.armL.rotation.set(0, 0, 2.7);
      a.armR.rotation.set(0, 0, -2.7);
    } else if (act === 'spike' || act === 'tip' || act === 'serve') {
      // Arm whips from overhead to forward.
      const k = Math.min(since / 0.2, 1);
      a.armL.rotation.set(0, 0, 0.6);
      a.armR.rotation.set(-k * 1.4, 0, -2.8 + k * 1.8);
    } else if (this.cocked(game, sl)) {
      a.armL.rotation.set(0, 0, 1.2);
      a.armR.rotation.set(0, 0, -2.8);
    } else {
      a.armL.rotation.set(0, 0, 0.25);
      if (q) {
        // The phone is the hand: the right arm mirrors its tilt between touches.
        _q.set(q[0], q[1], q[2], q[3]);
        a.armR.quaternion.copy(_q).multiply(REST_R);
      } else a.armR.rotation.set(0, 0, -0.4);
    }
  }

  /** Timing circle for the next touch a person plays: shrinks onto the target ring at the moment to swing. */
  private syncCue(game: VolleyGame): void {
    const c = game.contact;
    const live = (game.phase === 'toss' || game.phase === 'rally') && c !== null && !c.done && game.isHuman(c.side, c.who);
    const lead = game.cfg.volley.timingRingSec;
    const left = live ? (c.t - game.simTime) / game.cfg.volley.gameSpeed : Infinity; // real seconds to contact
    const show = live && left < lead && left > -0.15;
    this.cueTarget.visible = this.cueRing.visible = show;
    if (!show) return;
    // Player 1 (side 0's main player) is blue; player 2 (far side, or the setter) is orange.
    const p1 = c.side === 0 && c.who === 0;
    const now = Math.abs(left) < 0.07;
    const color = now ? CUE_COLORS.now : p1 ? CUE_COLORS.p1 : CUE_COLORS.p2;
    const fadeIn = Math.min(1, (lead - left) / 0.2);
    for (const m of [this.cueTarget, this.cueRing]) {
      m.position.set(c.p.x, 0.04, c.p.z);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.color.setHex(color);
      mat.opacity = 0.85 * fadeIn;
    }
    const k = Math.max(0, left) / lead;
    this.cueRing.scale.setScalar(TARGET_R + (SHRINK_FROM - TARGET_R) * k);
  }

  /** About to attack or serve: arm drawn back overhead. */
  private cocked(game: VolleyGame, sl: Slot): boolean {
    const c: VContact | null = game.contact;
    return !!c && !c.done && c.side === sl.side && c.who === sl.who && (c.kind === 'attack' || c.kind === 'serve') && game.simTime > c.t - JUMP_T;
  }

  /** Jump height: centred on the planned attack/serve contact, or on the hit once it happened. */
  private jump(game: VolleyGame, sl: Slot, p: VPlayer): number {
    const c = game.contact;
    let centre: number | null = null;
    if (c && !c.done && c.side === sl.side && c.who === sl.who && (c.kind === 'attack' || c.kind === 'serve')) centre = c.t;
    else if (p.action === 'spike' || p.action === 'tip' || p.action === 'serve') centre = p.actionAt;
    if (centre === null) return 0;
    const u = (game.simTime - centre) / JUMP_T + 0.5; // 0 → take-off, 1 → landing
    return u > 0 && u < 1 ? Math.sin(u * Math.PI) * JUMP_H : 0;
  }

  private updateFx(dt: number): void {
    for (const r of this.rings) {
      r.t += dt;
      const k = r.t / 0.45;
      r.mesh.scale.setScalar(1 + k * 3);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 * (1 - k));
    }
    for (const sp of this.sparks) {
      sp.t += dt;
      const k = sp.t / 0.25;
      sp.mesh.scale.setScalar(0.6 + k * 1.2);
      sp.mesh.rotation.z += dt * 6;
      (sp.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
    }
    for (const list of [this.rings, this.sparks])
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]!.t <= 0.5) continue;
        this.scene.remove(list[i]!.mesh);
        (list[i]!.mesh.material as THREE.Material).dispose();
        list.splice(i, 1);
      }
    this.squashT += dt;
    const sq = this.squashT < 0.08 ? 1 - 0.3 * Math.sin((this.squashT / 0.08) * Math.PI) : 1;
    this.ball.scale.set(1 + (1 - sq) * 0.5, sq, 1 + (1 - sq) * 0.5);
  }

  private updateCamera(game: VolleyGame, dt: number): void {
    const me = game.teams[0][0];
    if (this.view === 'side') {
      _want.set(-17, 6.5, 0);
      _look.set(0, 1.4, 0);
    } else {
      // Behind the near baseline, high enough to see the whole far court over the net.
      _want.set(me.x * 0.35, 5.8, 15.5);
      _look.set(me.x * 0.15, 1.2, -3.5);
    }
    const k = 1 - Math.exp(-dt * 3);
    this.camPos.lerp(_want, k);
    this.camLook.lerp(_look, k);
    this.camera.position.copy(this.camPos);
    this.shakeT += dt;
    const dur = 0.06 * this.shakeHits;
    if (this.shakeT < dur) {
      const decay = 1 - this.shakeT / dur;
      const dir = Math.floor((this.shakeT / dur) * this.shakeHits) % 2 ? -1 : 1;
      this.camera.position.x += dir * this.shakeAmp * decay;
      this.camera.position.y += -dir * this.shakeAmp * 0.6 * decay;
    }
    this.camera.lookAt(this.camLook);
  }
}
