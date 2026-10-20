// Placeholder 3D world: resort-ish venue, ITTF table, two characters with paddles, ball with
// blob shadow and speed trail. Simple primitives until the /design GLTF assets exist.
import * as THREE from 'three';
import { ITTF } from '../../engine/config.ts';
import type { Game } from '../../engine/game.ts';
import { BALL_R, HALF_L, HALF_W, NET_HALF_W, TABLE_TOP, type Side, sideSign } from '../../engine/physics.ts';
import type { Quat } from '../../shared/protocol.ts';

const COLORS = {
  sky: 0x8fd3f4,
  deck: 0xe8d6b0,
  court: 0x2f7d6d,
  water: 0x2aa7c9,
  table: 0x1d4f91,
  line: 0xffffff,
  net: 0xf4f4f4,
  ball: 0xff8a1f,
  human: 0x2ec4b6,
  cpu: 0xff6b6b,
  skin: 0xf2c9a0,
  rubberRed: 0xd62828,
  rubberBlack: 0x1b1b1b,
  wood: 0xc49a6c,
};

const TRAIL_POINTS = 14;

interface Avatar {
  root: THREE.Group;
  paddle: THREE.Group;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
  private ball: THREE.Mesh;
  private shadow: THREE.Mesh;
  private trail: THREE.Line;
  private trailPos: Float32Array;
  private trailHist: THREE.Vector3[] = [];
  private avatars: [Avatar, Avatar];
  private camPos = new THREE.Vector3(0, 1.8, HALF_L + 2.2);
  private camLook = new THREE.Vector3(0, TABLE_TOP, -0.5);

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(COLORS.sky);
    s.fog = new THREE.Fog(COLORS.sky, 18, 45);

    s.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.4));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.8);
    sun.position.set(3, 8, 4);
    s.add(sun);

    const plane = (w: number, h: number, color: number, y: number, z = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ color }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, y, z);
      s.add(m);
      return m;
    };
    plane(80, 80, COLORS.water, -0.05, -30);
    plane(14, 16, COLORS.deck, 0);
    plane(6, 9, COLORS.court, 0.002);

    this.buildTable();
    this.avatars = [this.buildAvatar(COLORS.human, 0), this.buildAvatar(COLORS.cpu, 1)];

    // Ball: drawn 1.5× real size for readability on a laptop screen.
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R * 1.5, 20, 14), new THREE.MeshBasicMaterial({ color: COLORS.ball }));
    s.add(this.ball);
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BALL_R * 1.4, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    s.add(this.shadow);

    this.trailPos = new Float32Array(TRAIL_POINTS * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8 }));
    this.trail.frustumCulled = false;
    s.add(this.trail);
  }

  private buildTable(): void {
    const g = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(ITTF.tableWidth, 0.03, ITTF.tableLength), new THREE.MeshLambertMaterial({ color: COLORS.table }));
    top.position.y = TABLE_TOP - 0.015;
    g.add(top);
    const lineMat = new THREE.MeshBasicMaterial({ color: COLORS.line });
    const line = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, TABLE_TOP + 0.0008, z);
      g.add(m);
    };
    line(0.02, ITTF.tableLength, -HALF_W + 0.01, 0);
    line(0.02, ITTF.tableLength, HALF_W - 0.01, 0);
    line(ITTF.tableWidth, 0.02, 0, -HALF_L + 0.01);
    line(ITTF.tableWidth, 0.02, 0, HALF_L - 0.01);
    line(0.003, ITTF.tableLength, 0, 0);
    const legMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    for (const x of [-HALF_W + 0.15, HALF_W - 0.15])
      for (const z of [-HALF_L + 0.3, HALF_L - 0.3]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, TABLE_TOP - 0.03, 0.05), legMat);
        leg.position.set(x, (TABLE_TOP - 0.03) / 2, z);
        g.add(leg);
      }
    const net = new THREE.Mesh(
      new THREE.PlaneGeometry(NET_HALF_W * 2, ITTF.netHeight),
      new THREE.MeshLambertMaterial({ color: COLORS.net, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    net.position.y = TABLE_TOP + ITTF.netHeight / 2;
    g.add(net);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(NET_HALF_W * 2, 0.012, 0.006), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    tape.position.y = TABLE_TOP + ITTF.netHeight;
    g.add(tape);
    for (const x of [-NET_HALF_W, NET_HALF_W]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, ITTF.netHeight + 0.02), legMat);
      post.position.set(x, TABLE_TOP + ITTF.netHeight / 2, 0);
      g.add(post);
    }
    this.scene.add(g);
  }

  private buildAvatar(color: number, side: Side): Avatar {
    const root = new THREE.Group();
    // The near player is see-through so they never hide the ball.
    const near = side === 0;
    const bodyMat = new THREE.MeshLambertMaterial({ color, transparent: near, opacity: near ? 0.45 : 1, depthWrite: !near });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.75, 6, 12), bodyMat);
    body.position.y = 0.95;
    root.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), new THREE.MeshLambertMaterial({ color: COLORS.skin, transparent: near, opacity: near ? 0.45 : 1, depthWrite: !near }));
    head.position.y = 1.62;
    root.add(head);
    // Face the table: near player looks toward −z.
    root.rotation.y = side === 0 ? 0 : Math.PI;
    this.scene.add(root);

    // Paddle: blade in the XY plane (face normal −z = toward the opponent for the near player), handle down.
    const paddle = new THREE.Group();
    const blade = new THREE.Group();
    const bladeGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.012, 24);
    bladeGeo.rotateX(Math.PI / 2);
    const front = new THREE.Mesh(bladeGeo, new THREE.MeshLambertMaterial({ color: COLORS.rubberRed }));
    front.position.z = -0.002;
    const back = new THREE.Mesh(bladeGeo, new THREE.MeshLambertMaterial({ color: COLORS.rubberBlack }));
    back.position.z = 0.002;
    back.scale.set(0.98, 0.98, 1);
    blade.add(front, back);
    blade.position.y = 0.09;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.1, 0.02), new THREE.MeshLambertMaterial({ color: COLORS.wood }));
    handle.position.y = -0.0;
    paddle.add(blade, handle);
    this.scene.add(paddle);
    return { root, paddle };
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Copy engine state into the scene. `humanQ` is the near player's paddle orientation from input. */
  sync(game: Game, humanQ: Quat | null, dt: number): void {
    const b = game.ball.p;
    this.ball.position.set(b.x, b.y, b.z);
    const overTable = Math.abs(b.x) <= HALF_W && Math.abs(b.z) <= HALF_L && b.y >= TABLE_TOP;
    const groundY = overTable ? TABLE_TOP + 0.001 : 0.004;
    const h = Math.max(b.y - BALL_R - groundY, 0);
    this.shadow.position.set(b.x, groundY, b.z);
    const k = 1 / (1 + h * 2.5);
    this.shadow.scale.setScalar(1 + h * 0.8);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;

    // Trail above the speed threshold (sim m/s).
    const v = game.ball.v;
    const fast = game.ballLive && Math.hypot(v.x, v.y, v.z) > game.cfg.render.trailMinSpeed;
    this.trailHist.unshift(new THREE.Vector3(b.x, b.y, b.z));
    if (this.trailHist.length > TRAIL_POINTS) this.trailHist.pop();
    this.trail.visible = fast;
    if (fast) {
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const p = this.trailHist[Math.min(i, this.trailHist.length - 1)]!;
        this.trailPos.set([p.x, p.y, p.z], i * 3);
      }
      this.trail.geometry.attributes.position!.needsUpdate = true;
    }

    for (const side of [0, 1] as const) this.syncAvatar(game, side, side === 0 ? humanQ : null);
    this.updateCamera(game, dt);
  }

  private syncAvatar(game: Game, side: Side, q: Quat | null): void {
    const p = game.players[side];
    const a = this.avatars[side];
    a.root.position.set(p.x, 0, p.z);
    const sign = sideSign(side);

    // Paddle at the hand: forehand to the player's right, backhand to the left.
    const right = sign; // world x of the player's right
    const handSide = p.forehand ? 1 : -1;
    const c = game.contact;
    const targetY = c && c.side === side ? c.p.y : TABLE_TOP + 0.15;
    const sinceSwing = (game.simTime - p.swingAt) / game.cfg.physics.gameSpeed;
    const swingAnim = sinceSwing >= 0 && sinceSwing < 0.25 ? Math.sin((sinceSwing / 0.25) * Math.PI) : 0;
    const pos = new THREE.Vector3(p.x + right * handSide * 0.4, 0, p.z - sign * (0.35 + swingAnim * 0.3));
    pos.y = THREE.MathUtils.lerp(a.paddle.position.y || targetY, targetY, 0.15);
    a.paddle.position.copy(pos);

    // Orientation: base facing (near player looks −z) × input rotation (or a neutral pose for the CPU).
    const base = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side === 0 ? 0 : Math.PI);
    const rel = q ? new THREE.Quaternion(q[0], q[1], q[2], q[3]) : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.15);
    const swingTilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -handSide * swingAnim * 0.6);
    a.paddle.quaternion.copy(base).multiply(swingTilt).multiply(rel);
  }

  private updateCamera(game: Game, dt: number): void {
    const me = game.players[0];
    // Behind and above, slightly over the left shoulder so the forehand side stays visible.
    const want = new THREE.Vector3(me.x * 0.6 - 0.35, 2.25, Math.max(me.z, HALF_L + 0.4) + 1.5);
    const look = new THREE.Vector3(me.x * 0.3, TABLE_TOP, -0.45);
    const k = 1 - Math.exp(-dt * 4);
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }
}
