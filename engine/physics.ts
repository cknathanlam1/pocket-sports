// Ball flight: gravity, quadratic drag, Magnus; swept collision against table, net and floor.
// Runs in *sim* time at a fixed step (config.physics.stepHz). Pure TS.
import type { Config } from './config.ts';
import { ITTF } from './config.ts';
import { type V3, add, addScaled, clone, cross, len, lerp, scale, v3 } from './vec.ts';

export const BALL_R = ITTF.ballDiameter / 2;
export const TABLE_TOP = ITTF.tableHeight;
export const HALF_L = ITTF.tableLength / 2;
export const HALF_W = ITTF.tableWidth / 2;
export const NET_TOP = ITTF.tableHeight + ITTF.netHeight;
/** Net posts extend 15.25 cm past each sideline. */
export const NET_HALF_W = HALF_W + 0.1525;

/** 0 = near end (+z, the human by default), 1 = far end (−z). */
export type Side = 0 | 1;
export const other = (s: Side): Side => (s === 0 ? 1 : 0);
export const sideOfZ = (z: number): Side => (z >= 0 ? 0 : 1);
/** +1 for the near side, −1 for the far side: multiply a "toward my end" z by this. */
export const sideSign = (s: Side): 1 | -1 => (s === 0 ? 1 : -1);

export interface Ball {
  p: V3; // position (m)
  v: V3; // velocity (m/s)
  w: V3; // spin (rad/s)
}

export const cloneBall = (b: Ball): Ball => ({ p: clone(b.p), v: clone(b.v), w: clone(b.w) });

export type PhysEvent =
  | { type: 'table'; side: Side; p: V3; speed: number }
  | { type: 'net'; kind: 'clip' | 'block'; p: V3 }
  | { type: 'floor'; p: V3 };

export interface StepOpts {
  /** Treat the table as an infinite plane (shot solver uses this to always get a landing point). */
  infiniteTable?: boolean;
  /** Skip net collision (shot solver measures clearance instead). */
  ignoreNet?: boolean;
}

type Phys = Config['physics'];

export function accel(v: V3, w: V3, cfg: Phys): V3 {
  const speed = len(v);
  const drag = scale(v, -cfg.dragK * speed);
  // Lift saturates at high spin ratio S = r|ω|/|v| (real C_L levels off ≈0.3); linear below the cap.
  const spinRatio = (BALL_R * len(w)) / Math.max(speed, 1e-6);
  const sat = spinRatio > cfg.magnusMaxSpinRatio ? cfg.magnusMaxSpinRatio / spinRatio : 1;
  const magnus = scale(cross(w, v), cfg.magnusK * sat);
  return add(add(drag, magnus), v3(0, -cfg.gravity, 0));
}

/** Table bounce with restitution and Coulomb friction coupling spin ↔ tangential velocity.
 *  Hollow sphere: I = ⅔ m r². Friction impulse is capped at the amount that stops sliding. */
export function bounceTable(b: Ball, cfg: Phys): void {
  const { v, w } = b;
  const jn = (1 + cfg.restitution) * -v.y; // normal impulse per unit mass
  // Contact-point tangential velocity (contact at −r ŷ): u = v_t + ω × (−r ŷ)
  const ux = v.x + BALL_R * w.z;
  const uz = v.z - BALL_R * w.x;
  const u = Math.hypot(ux, uz);
  if (u > 1e-9) {
    const jt = Math.min(cfg.tableFriction * jn, 0.4 * u);
    const fx = (-ux / u) * jt;
    const fz = (-uz / u) * jt;
    v.x += fx;
    v.z += fz;
    const k = 3 / (2 * BALL_R);
    w.x += -fz * k;
    w.z += fx * k;
  }
  v.y = cfg.restitution * -v.y;
}

/** Advance one fixed step (RK2 midpoint) with swept collision. Mutates b. */
export function stepBall(b: Ball, dt: number, cfg: Phys, opts: StepOpts = {}): PhysEvent | null {
  const a0 = accel(b.v, b.w, cfg);
  const vMid = addScaled(b.v, a0, dt / 2);
  const aMid = accel(vMid, b.w, cfg);
  const p0 = b.p;
  const p1 = addScaled(p0, vMid, dt);
  const v1 = addScaled(b.v, aMid, dt);

  // Net: plane z = 0, from the table top up to NET_TOP.
  if (!opts.ignoreNet && Math.sign(p0.z) !== Math.sign(p1.z) && p0.z !== 0) {
    const f = p0.z / (p0.z - p1.z);
    const pc = lerp(p0, p1, f);
    if (Math.abs(pc.x) <= NET_HALF_W && pc.y > TABLE_TOP && pc.y < NET_TOP + BALL_R) {
      const dir = Math.sign(p0.z);
      if (pc.y < NET_TOP - BALL_R * 0.5) {
        // Blocked: bounces back off the mesh and drops on the hitter's side.
        b.p = { x: pc.x, y: pc.y, z: dir * BALL_R };
        b.v = { x: v1.x * 0.3, y: Math.min(v1.y, 0) * 0.3, z: -v1.z * 0.12 };
        b.w = scale(b.w, 0.3);
        return { type: 'net', kind: 'block', p: pc };
      }
      // Clipped the tape: pops up, loses pace, carries over.
      b.p = { x: pc.x, y: pc.y, z: -dir * BALL_R };
      b.v = { x: v1.x * 0.7, y: Math.max(v1.y, 0) * 0.4 + 0.6, z: v1.z * 0.45 };
      b.w = scale(b.w, 0.5);
      return { type: 'net', kind: 'clip', p: pc };
    }
  }

  // Table: swept test of the ball's bottom against the table plane.
  const bottom0 = p0.y - BALL_R;
  const bottom1 = p1.y - BALL_R;
  if (bottom0 >= TABLE_TOP && bottom1 < TABLE_TOP) {
    const f = (bottom0 - TABLE_TOP) / (bottom0 - bottom1);
    const pc = lerp(p0, p1, f);
    if (opts.infiniteTable || (Math.abs(pc.x) <= HALF_W && Math.abs(pc.z) <= HALF_L)) {
      const vc = lerp(b.v, v1, f);
      b.v = vc;
      const speed = len(vc);
      bounceTable(b, cfg);
      b.p = addScaled({ x: pc.x, y: TABLE_TOP + BALL_R, z: pc.z }, b.v, (1 - f) * dt);
      return { type: 'table', side: sideOfZ(pc.z), p: pc, speed };
    }
  }

  // Floor: soft visual bounce; the referee treats any floor contact as a dead ball.
  if (bottom1 < 0 && b.v.y < 0) {
    b.p = { x: p1.x, y: BALL_R, z: p1.z };
    b.v = { x: v1.x * 0.7, y: -v1.y * 0.6, z: v1.z * 0.7 };
    b.w = scale(b.w, 0.7);
    return { type: 'floor', p: clone(b.p) };
  }

  b.p = p1;
  b.v = v1;
  return null;
}
