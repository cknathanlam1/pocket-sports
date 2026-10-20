// Launch-velocity solver: find v so the ball (with its spin, drag and Magnus) lands on a target.
// Simulate-and-correct with a 2×2 Broyden update; a handful of flights per shot.
import type { Config } from './config.ts';
import { type Ball, BALL_R, HALF_L, NET_TOP, TABLE_TOP, stepBall } from './physics.ts';
import { type V3, clone, v3 } from './vec.ts';

export interface XZ {
  x: number;
  z: number;
}

export interface Flight {
  ok: boolean;
  land: XZ;
  t: number;
  /** Min height of the ball centre above the net tape at net crossings before landing (m). */
  netClear: number;
}

/** Fly a ball until its `bounceIndex`-th table contact (0 = first), on an infinite table, net ignored. */
export function fly(p0: V3, v: V3, w: V3, cfg: Config, bounceIndex = 0, maxT = 3): Flight {
  const b: Ball = { p: clone(p0), v: clone(v), w: clone(w) };
  const dt = 1 / cfg.physics.stepHz;
  let bounces = 0;
  let netClear = Infinity;
  for (let t = 0; t < maxT; t += dt) {
    const z0 = b.p.z;
    const y0 = b.p.y;
    const e = stepBall(b, dt, cfg.physics, { infiniteTable: true, ignoreNet: true });
    if (Math.sign(z0) !== Math.sign(b.p.z) && z0 !== 0) {
      const f = z0 / (z0 - b.p.z);
      netClear = Math.min(netClear, y0 + (b.p.y - y0) * f - NET_TOP);
    }
    if (e?.type === 'table') {
      if (bounces === bounceIndex) return { ok: true, land: { x: e.p.x, z: e.p.z }, t, netClear };
      bounces++;
    }
    if (e?.type === 'floor') break;
  }
  return { ok: false, land: { x: b.p.x, z: b.p.z }, t: maxT, netClear };
}

/** No-drag ballistic guess: horizontal speed h toward aim, vertical to arrive at table height.
 *  Gravity is adjusted by the Magnus force's vertical part (topspin dips, backspin floats). */
export function ballistic(p0: V3, aim: XZ, h: number, w: V3, cfg: Config): V3 {
  const dx = aim.x - p0.x;
  const dz = aim.z - p0.z;
  const d = Math.max(Math.hypot(dx, dz), 1e-3);
  const vh = v3((dx / d) * h, 0, (dz / d) * h);
  const sr = (BALL_R * Math.hypot(w.x, w.y, w.z)) / h;
  const sat = sr > cfg.physics.magnusMaxSpinRatio ? cfg.physics.magnusMaxSpinRatio / sr : 1;
  const magnusY = cfg.physics.magnusK * sat * (w.z * vh.x - w.x * vh.z); // (ω × v_h).y
  const g = Math.max(cfg.physics.gravity - magnusY, 2);
  const t = d / h;
  const dy = TABLE_TOP + BALL_R - p0.y;
  return v3(vh.x, (dy + 0.5 * g * t * t) / t, vh.z);
}

type Vec2 = [number, number];

/** Broyden's method on f: R² → R², driving f(x) to target. Returns the best x found. */
function broyden2(f: (x: Vec2) => Vec2, x0: Vec2, target: Vec2, delta: Vec2, iters: number, tol: number): { x: Vec2; err: number } {
  let x = x0;
  let fx = f(x);
  const errOf = (y: Vec2) => Math.hypot(y[0] - target[0], y[1] - target[1]);
  let best = { x, err: errOf(fx) };
  if (best.err < tol) return best;
  // Initial Jacobian by finite differences.
  const fa = f([x[0] + delta[0], x[1]]);
  const fb = f([x[0], x[1] + delta[1]]);
  let J = [
    [(fa[0] - fx[0]) / delta[0], (fb[0] - fx[0]) / delta[1]],
    [(fa[1] - fx[1]) / delta[0], (fb[1] - fx[1]) / delta[1]],
  ] as [Vec2, Vec2];
  for (let i = 0; i < iters; i++) {
    const r0 = target[0] - fx[0];
    const r1 = target[1] - fx[1];
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    if (Math.abs(det) < 1e-9) break;
    const dx0 = (J[1][1] * r0 - J[0][1] * r1) / det;
    const dx1 = (-J[1][0] * r0 + J[0][0] * r1) / det;
    const xn: Vec2 = [x[0] + dx0, x[1] + dx1];
    const fn = f(xn);
    const df0 = fn[0] - fx[0];
    const df1 = fn[1] - fx[1];
    const dd = dx0 * dx0 + dx1 * dx1;
    if (dd > 1e-12) {
      const e0 = df0 - (J[0][0] * dx0 + J[0][1] * dx1);
      const e1 = df1 - (J[1][0] * dx0 + J[1][1] * dx1);
      J = [
        [J[0][0] + (e0 * dx0) / dd, J[0][1] + (e0 * dx1) / dd],
        [J[1][0] + (e1 * dx0) / dd, J[1][1] + (e1 * dx1) / dd],
      ];
    }
    x = xn;
    fx = fn;
    const err = errOf(fx);
    if (err < best.err) best = { x, err };
    if (err < tol) break;
  }
  return best;
}

export interface Solution {
  v: V3;
  flight: Flight;
  err: number;
}

/** Keeps the aim point in front of the hitter, past the net, within a sane box. */
function clampAim(p0: V3, a: Vec2): Vec2 {
  const dir = -Math.sign(p0.z); // direction of play
  const zFar = Math.min(Math.max(a[1] * dir, 0.05), 4) * dir;
  return [Math.min(Math.max(a[0], -3), 3), zFar];
}

/** Rally shot: horizontal speed h is the intent; the solver picks direction + elevation.
 *  Some (h, spin, contact) combos have no trajectory that lands on target and clears the net
 *  (too flat to clear, so much backspin the ball floats, or a slow lob that drag stops short),
 *  so the solver searches outward from h (h·0.88ᵏ, h·1.12ᵏ, alternating) and takes the nearest
 *  speed that works. */
export function solveDrive(p0: V3, target: XZ, h: number, w: V3, cfg: Config, minNetClear = 0.045): Solution {
  const attempt = (speed: number): Solution => {
    const vel = (a: Vec2) => ballistic(p0, { x: a[0], z: a[1] }, speed, w, cfg);
    const f = (a: Vec2): Vec2 => {
      const fl = fly(p0, vel(clampAim(p0, a)), w, cfg);
      return [fl.land.x, fl.land.z];
    };
    const { x } = broyden2(f, [target.x, target.z], [target.x, target.z], [0.05, 0.05], cfg.shot.solverIterations, 0.005);
    const v = vel(clampAim(p0, x));
    const flight = fly(p0, v, w, cfg);
    return { v, flight, err: Math.hypot(flight.land.x - target.x, flight.land.z - target.z) };
  };
  const good = (s: Solution) => s.flight.ok && s.err < 0.02 && s.flight.netClear >= minNetClear;
  const score = (s: Solution) => s.err + (s.flight.ok && s.flight.netClear >= minNetClear ? 0 : 10);

  let best = attempt(h);
  if (good(best)) return best;
  for (let k = 1; k <= 12; k++) {
    for (const speed of [h * 0.88 ** k, h * 1.12 ** k]) {
      if (speed < 1.2 || speed > 25) continue;
      const s = attempt(speed);
      if (good(s)) return s;
      if (score(s) < score(best)) best = s;
    }
  }
  return best;
}

/** Serve: first bounce on the server's half at |z| = firstBounceDepth from the net, second bounce on target.
 *  Unknowns: lateral aim of the first bounce and horizontal speed. */
export function solveServe(p0: V3, target: XZ, firstBounceDepth: number, h0: number, w: V3, cfg: Config, minNetClear = 0.045): Solution {
  const dir = Math.sign(p0.z);
  let depth = firstBounceDepth;
  let sol: Solution | null = null;
  for (let tries = 0; tries < 6; tries++) {
    const b1z = dir * depth;
    const vel = (a: Vec2) => ballistic(p0, { x: a[0], z: b1z }, Math.min(Math.max(a[1], 1), 15), w, cfg);
    const f = (a: Vec2): Vec2 => {
      const fl = fly(p0, vel(a), w, cfg, 1);
      return [fl.land.x, fl.land.z];
    };
    const ax = p0.x + ((target.x - p0.x) * (p0.z - b1z)) / (p0.z - target.z);
    const { x } = broyden2(f, [ax, h0], [target.x, target.z], [0.05, 0.3], cfg.shot.solverIterations + 4, 0.005);
    const v = vel(x);
    const flight = fly(p0, v, w, cfg, 1);
    const cand = { v, flight, err: Math.hypot(flight.land.x - target.x, flight.land.z - target.z) };
    if (!sol || cand.err < sol.err) sol = cand;
    if (flight.ok && cand.err < 0.02 && flight.netClear >= minNetClear) return cand;
    depth = Math.min(depth + 0.12, HALF_L - 0.1); // bounce nearer the server for more arc
  }
  return sol!;
}
