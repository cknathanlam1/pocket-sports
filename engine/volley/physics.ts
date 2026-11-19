// Beach volleyball ball flight: gravity + quadratic drag (no spin: float serves and arcade spikes), swept
// collision with the net, and landing on the sand. Same coordinates as table tennis: x lateral, y up,
// z along the court, net at z = 0, side 0 at +z. Pure TS.
import type { Config } from '../config.ts';
import type { Ball, Side } from '../physics.ts';
import { type V3, clamp, len, v3 } from '../vec.ts';

type VCfg = Config['volley'];

export type VolleyEvent =
  | { type: 'net'; kind: 'clip' | 'block'; p: V3 }
  /** Ball touched the sand. `in` = inside the lines (the ball's footprint touching a line counts as in). */
  | { type: 'land'; side: Side; in: boolean; p: V3; speed: number };

export const netTop = (c: VCfg): number => c.netHeight;

/** Inside the court, counting a ball that touches the line as in. */
export function isIn(p: { x: number; z: number }, c: VCfg): boolean {
  return Math.abs(p.x) <= c.halfW + c.ballR && Math.abs(p.z) <= c.halfL + c.ballR;
}

function accel(vx: number, vy: number, vz: number, c: VCfg): V3 {
  const k = -c.dragK * Math.hypot(vx, vy, vz);
  return { x: k * vx, y: k * vy - c.gravity, z: k * vz };
}

/** One RK2 (midpoint) step, then net and sand checks. Mutates `b`. Returns at most one event. */
export function stepVolley(b: Ball, dt: number, c: VCfg, opts: { ignoreNet?: boolean } = {}): VolleyEvent | null {
  const p0 = b.p;
  const v = b.v;
  const a1 = accel(v.x, v.y, v.z, c);
  const vmx = v.x + a1.x * dt * 0.5;
  const vmy = v.y + a1.y * dt * 0.5;
  const vmz = v.z + a1.z * dt * 0.5;
  const a2 = accel(vmx, vmy, vmz, c);
  const p1 = v3(p0.x + vmx * dt, p0.y + vmy * dt, p0.z + vmz * dt);
  b.v = v3(v.x + a2.x * dt, v.y + a2.y * dt, v.z + a2.z * dt);

  // Net: a vertical plane at z = 0 up to the tape, between the antennas.
  if (!opts.ignoreNet && Math.sign(p0.z) !== Math.sign(p1.z) && p0.z !== 0) {
    const f = p0.z / (p0.z - p1.z);
    const y = p0.y + (p1.y - p0.y) * f;
    const x = p0.x + (p1.x - p0.x) * f;
    if (Math.abs(x) <= c.netHalfW && y < netTop(c) + c.ballR) {
      const at = v3(x, y, 0);
      if (y < netTop(c) - c.ballR * 0.3) {
        // Into the mesh: the net soaks it up and drops it back on the hitter's side.
        b.p = v3(x, y, Math.sign(p0.z) * (c.ballR + 0.01));
        b.v = v3(b.v.x * 0.3, Math.min(b.v.y, 0) * 0.3, -b.v.z * 0.15);
        return { type: 'net', kind: 'block', p: at };
      }
      // Off the tape: it carries on over, slowed and popped up.
      b.p = p1;
      b.v = v3(b.v.x * 0.7, Math.abs(b.v.y) * 0.4 + 0.8, b.v.z * 0.55);
      return { type: 'net', kind: 'clip', p: at };
    }
  }

  if (p1.y <= c.ballR && b.v.y < 0) {
    const speed = len(b.v);
    b.p = v3(p1.x, c.ballR, p1.z);
    // Sand: almost dead, a little skid.
    b.v = v3(b.v.x * 0.25, -b.v.y * 0.18, b.v.z * 0.25);
    return { type: 'land', side: p1.z >= 0 ? 0 : 1, in: isIn(p1, c), p: v3(p1.x, 0, p1.z), speed };
  }
  b.p = p1;
  return null;
}

/** Simulate forward until the ball descends through height `y`, or lands. Returns time and position. */
export function untilDescending(b: Ball, y: number, c: VCfg, dt: number, opts: { ignoreNet?: boolean; maxT?: number } = {}): { t: number; p: V3; landed: boolean } {
  const s: Ball = { p: { ...b.p }, v: { ...b.v }, w: { ...b.w } };
  let t = 0;
  const maxT = opts.maxT ?? 6;
  while (t < maxT) {
    const prevY = s.p.y;
    const e = stepVolley(s, dt, c, opts);
    t += dt;
    if (e?.type === 'land') return { t, p: s.p, landed: true };
    if (s.v.y < 0 && prevY >= y && s.p.y < y) return { t, p: s.p, landed: false };
  }
  return { t, p: s.p, landed: true };
}

/**
 * Lob from `from` to arrive at `to` (descending through to.y) with the given apex height. Used for passes
 * and sets. Starts from the drag-free solution and corrects the horizontal speed against the simulation.
 */
export function lobTo(from: V3, to: V3, apex: number, c: VCfg, dt: number): V3 {
  const top = Math.max(apex, from.y + 0.3, to.y + 0.3);
  const g = c.gravity;
  const vy = Math.sqrt(2 * g * (top - from.y));
  const flight = vy / g + Math.sqrt((2 * (top - to.y)) / g);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return v3(0, vy, 0);
  let h = d / flight;
  for (let i = 0; i < 5; i++) {
    const v = v3((dx / d) * h, vy, (dz / d) * h);
    const r = untilDescending({ p: from, v, w: v3() }, to.y, c, dt, { ignoreNet: true });
    const got = Math.hypot(r.p.x - from.x, r.p.z - from.z);
    if (got < 1e-3) break;
    h *= clamp(d / got, 0.7, 1.4);
  }
  return v3((dx / d) * h, vy, (dz / d) * h);
}

/** Where a launch lands on the sand (ignoring the net) and how high it is as it crosses the net plane. */
export function flight(from: V3, v: V3, c: VCfg, dt: number): { land: V3; netY: number | null } {
  const s: Ball = { p: { ...from }, v: { ...v }, w: v3() };
  let netY: number | null = null;
  for (let i = 0; i < 8 / dt; i++) {
    const z0 = s.p.z;
    const y0 = s.p.y;
    const e = stepVolley(s, dt, c, { ignoreNet: true });
    if (netY === null && Math.sign(z0) !== Math.sign(s.p.z) && z0 !== 0) {
      const f = z0 / (z0 - s.p.z);
      netY = y0 + (s.p.y - y0) * f;
    }
    if (e?.type === 'land') return { land: e.p, netY };
  }
  return { land: s.p, netY };
}

/**
 * Drive (spike or serve) from `from` at `speed` toward a landing point. Bisects the pitch on the flat
 * branch so the ball lands at the target distance. If that path doesn't clear the net, the pitch is
 * raised until it does (the ball then lands deeper). Returns the velocity.
 */
export function driveTo(from: V3, target: { x: number; z: number }, speed: number, c: VCfg, dt: number): V3 {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.hypot(dx, dz);
  const ux = dx / d;
  const uz = dz / d;
  const vel = (pitch: number) => v3(ux * Math.cos(pitch) * speed, Math.sin(pitch) * speed, uz * Math.cos(pitch) * speed);
  const range = (pitch: number) => {
    const f = flight(from, vel(pitch), c, dt);
    return Math.hypot(f.land.x - from.x, f.land.z - from.z);
  };
  // Range grows with pitch up to roughly 40°; search the flat (low) branch below that.
  let lo = -1.2;
  let hi = 0.7;
  if (range(hi) < d) lo = hi; // can't reach: use the longest throw
  else
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (range(mid) < d) lo = mid;
      else hi = mid;
    }
  let pitch = lo;
  const crossesNet = Math.sign(from.z) !== Math.sign(target.z);
  if (crossesNet) {
    for (let i = 0; i < 40; i++) {
      const f = flight(from, vel(pitch), c, dt);
      if (f.netY === null || f.netY > netTop(c) + c.ballR + 0.05) break;
      pitch += 0.02;
    }
  }
  return vel(pitch);
}
