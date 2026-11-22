// Phone motion pipeline (pure, DOM-free so recordings can be replayed in tests):
//   raw DeviceMotionEvent.rotationRate → RateAdapter → body-frame ω (deg/s, x/y/z) → SwingDetector.
//
// Platform normalisation: browsers disagree on which rotationRate component is which axis and
// (historically) on units. Instead of hard-coding per-platform guesses, the adapter starts with the
// W3C mapping (alpha = z, beta = x, gamma = y, deg/s) and auto-calibrates: it compares rotationRate
// against the angular velocity derived from successive DeviceOrientation quaternions (consistent
// across browsers) and locks the signed axis permutation + unit scale that fits best.
import type { Quat } from '../shared/protocol.ts';
import { invert, multiply } from '../shared/quat.ts';
import { eulerToQuat } from './orientation.ts';

export type V3 = [number, number, number];
const DEG = 180 / Math.PI;

export interface AxisMap {
  /** Which raw component (0 = alpha, 1 = beta, 2 = gamma) feeds body x, y, z. */
  idx: V3;
  sign: V3;
  /** Multiplier to deg/s (1, or 180/π if the browser reports rad/s). */
  scale: number;
}

export const SPEC_MAP: AxisMap = { idx: [1, 2, 0], sign: [1, 1, 1], scale: 1 };

export function applyMap(m: AxisMap, raw: V3): V3 {
  return [raw[m.idx[0]]! * m.sign[0] * m.scale, raw[m.idx[1]]! * m.sign[1] * m.scale, raw[m.idx[2]]! * m.sign[2] * m.scale];
}

const PERMS: V3[] = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];
const SIGNS: V3[] = [-1, 1].flatMap((a) => [-1, 1].flatMap((b) => [-1, 1].map((c) => [a, b, c] as V3)));

/** Every signed permutation × unit scale (96 candidates). */
export const CANDIDATES: AxisMap[] = PERMS.flatMap((idx) => SIGNS.flatMap((sign) => [1, DEG].map((scale) => ({ idx, sign, scale }))));

/** Body-frame angular velocity (deg/s) that takes q0 to q1 over dt seconds. */
export function derivedOmega(q0: Quat, q1: Quat, dt: number): V3 {
  let d = multiply(invert(q0), q1);
  if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
  const s = Math.hypot(d[0], d[1], d[2]);
  if (s < 1e-9 || dt <= 0) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, d[3]);
  const k = (angle / dt / s) * DEG;
  return [d[0] * k, d[1] * k, d[2] * k];
}

export class RateAdapter {
  map: AxisMap = SPEC_MAP;
  locked = false;
  private pairs: Array<{ raw: V3; w: V3 }> = [];
  private lastRaw: { t: number; raw: V3 } | null = null;
  private lastQ: { t: number; q: Quat } | null = null;

  /** Raw rotationRate sample [alpha, beta, gamma] → body ω (deg/s). */
  rate(raw: V3, t: number): V3 {
    this.lastRaw = { t, raw };
    return applyMap(this.map, raw);
  }

  /** Feed orientation for auto-calibration. */
  orientation(q: Quat, t: number): void {
    const prev = this.lastQ;
    this.lastQ = { t, q };
    if (this.locked || !prev || !this.lastRaw) return;
    const dt = (t - prev.t) / 1000;
    if (dt < 0.005 || dt > 0.1 || Math.abs(this.lastRaw.t - t) > 40) return;
    const w = derivedOmega(prev.q, q, dt);
    if (Math.hypot(...w) < 90) return; // only informative while actually rotating
    this.pairs.push({ raw: this.lastRaw.raw, w });
    if (this.pairs.length >= 40) this.solve();
  }

  private solve(): void {
    const err = (m: AxisMap) => {
      let e = 0;
      let n = 0;
      for (const p of this.pairs) {
        const g = applyMap(m, p.raw);
        e += (g[0] - p.w[0]) ** 2 + (g[1] - p.w[1]) ** 2 + (g[2] - p.w[2]) ** 2;
        n += p.w[0] ** 2 + p.w[1] ** 2 + p.w[2] ** 2;
      }
      return e / Math.max(n, 1e-9); // relative error
    };
    let best = this.map;
    let bestErr = err(best);
    for (const c of CANDIDATES) {
      const e = err(c);
      if (e < bestErr) {
        best = c;
        bestErr = e;
      }
    }
    if (bestErr < 0.35) {
      this.map = best;
      this.locked = true;
    } else {
      this.pairs.splice(0, 20); // inconclusive: keep collecting
    }
  }
}

// ───────────────────────── Swing detection ─────────────────────────

export interface SwingParams {
  onsetDegPerSec: number;
  refractoryMs: number;
  /** Swing ends once |ω| falls below peak × this (past the peak). */
  peakDropRatio: number;
  maxDurationMs: number;
  /** Body axis used for "roll" → sidespin. See CLAUDE.md: the long axis (y) carries the main swing. */
  rollAxis: 'y' | 'z';
}

export interface DetectedSwing {
  /** Phone time of the peak (ms), refined by parabolic interpolation. */
  t: number;
  peak: number; // deg/s
  face: number; // rad, + = open
  path: number; // deg/s, + = upward brush (topspin)
  roll: number; // deg/s
}

/**
 * Onset → track to peak → emit stamped at the peak. Emitted as soon as the peak is confirmed
 * (|ω| has dropped below peak × peakDropRatio), not at the end of the follow-through.
 */
export class SwingDetector {
  params: SwingParams;
  private state: 'idle' | 'tracking' | 'cooldown' = 'idle';
  private start = 0;
  private peak = 0;
  private peakT = 0;
  private peakFace = 0;
  private prev: { t: number; m: number } | null = null;
  private peakNeighbors: [number, number, number, number] = [0, 0, 0, 0]; // tPrev, mPrev, tNext?, mNext
  private sumX = 0;
  private sumRoll = 0;
  private n = 0;
  private lastPeakT = -Infinity;

  constructor(params: SwingParams) {
    this.params = params;
  }

  /** Feed one body-frame rate sample. `face` = current paddle pitch (rad). */
  push(t: number, w: V3, face: number): DetectedSwing | null {
    const p = this.params;
    const m = Math.hypot(w[0], w[1], w[2]);
    let out: DetectedSwing | null = null;

    if (this.state === 'cooldown' && m < p.onsetDegPerSec * 0.6 && t - this.lastPeakT >= p.refractoryMs) this.state = 'idle';
    if (this.state === 'idle' && m >= p.onsetDegPerSec && t - this.lastPeakT >= p.refractoryMs) {
      this.state = 'tracking';
      this.start = t;
      this.peak = 0;
      this.sumX = 0;
      this.sumRoll = 0;
      this.n = 0;
    }
    if (this.state === 'tracking') {
      this.sumX += w[0];
      this.sumRoll += p.rollAxis === 'y' ? w[1] : w[2];
      this.n++;
      if (m > this.peak) {
        this.peak = m;
        this.peakT = t;
        this.peakFace = face;
        this.peakNeighbors = [this.prev?.t ?? t, this.prev?.m ?? m, NaN, NaN];
      } else if (Number.isNaN(this.peakNeighbors[2])) {
        this.peakNeighbors[2] = t;
        this.peakNeighbors[3] = m;
      }
      if (m < this.peak * p.peakDropRatio || t - this.start > p.maxDurationMs) {
        out = this.emit();
      }
    }
    this.prev = { t, m };
    return out;
  }

  private emit(): DetectedSwing {
    const [t0, m0, t2, m2] = this.peakNeighbors;
    let tPeak = this.peakT;
    // Parabolic refinement of the peak time from the samples either side.
    if (!Number.isNaN(t2) && t0 < this.peakT && t2 > this.peakT) {
      const h1 = this.peakT - t0;
      const h2 = t2 - this.peakT;
      const denom = (m0 - this.peak) / h1 + (m2 - this.peak) / h2;
      if (Math.abs(h1 - h2) < 0.5 * Math.max(h1, h2) && denom < 0) {
        const h = (h1 + h2) / 2;
        const off = (h * (m0 - m2)) / (2 * (m0 - 2 * this.peak + m2));
        if (Number.isFinite(off) && Math.abs(off) < h) tPeak += off;
      }
    }
    this.state = 'cooldown';
    this.lastPeakT = tPeak;
    const n = Math.max(this.n, 1);
    return { t: tPeak, peak: this.peak, face: this.peakFace, path: -this.sumX / n, roll: this.sumRoll / n };
  }
}

// ───────────────────────── Pipeline ─────────────────────────

/**
 * Paddle pitch in radians, + = open. The hitting face is the phone's back (−z). It opens when its
 * normal tilts up, i.e. when the screen normal (+z) tilts down. Calibrated frame: up = y; raw earth frame: up = z.
 */
export function paddleFace(q: Quat | null, q0: Quat | null): number {
  if (!q) return 0;
  const [x, y, z, w] = q0 ? multiply(invert(q0), q) : q;
  const screenUp = q0 ? 2 * (y * z - w * x) : 1 - 2 * (x * x + y * y);
  return -Math.asin(Math.max(-1, Math.min(1, screenUp)));
}

/** Raw sensor events as recorded (and as the browser delivers them). `a` = accelerationIncludingGravity (m/s²). */
export type RawEvent = { k: 'o'; t: number; e: V3 } | { k: 'm'; t: number; rr: V3 | null; a?: V3 | null };

export interface JumpParams {
  pushMs2: number;
  freefallMs2: number;
  minAirMs: number;
  pushToAirMs: number;
  refractoryMs: number;
}

/**
 * Jump from the accelerometer (including gravity), whatever way the phone is held: standing still reads
 * |a| ≈ 9.8; a jump is a takeoff push (|a| well above g) followed by free fall (|a| near 0) while airborne.
 * A dropped phone has free fall without the push, and an arm swing pushes but never goes weightless, so
 * neither counts. Returns the take-off time (start of free fall).
 */
export class JumpDetector {
  private readonly p: JumpParams;
  private lastPush = -Infinity;
  private airSince: number | null = null;
  private lastJump = -Infinity;

  constructor(p: JumpParams) {
    this.p = p;
  }

  push(t: number, a: V3): number | null {
    const m = Math.hypot(a[0], a[1], a[2]);
    if (m >= this.p.pushMs2) this.lastPush = t;
    if (m > this.p.freefallMs2) {
      this.airSince = null;
      return null;
    }
    this.airSince ??= t;
    const air = t - this.airSince;
    if (air < this.p.minAirMs || t - this.lastJump < this.p.refractoryMs) return null;
    if (this.airSince - this.lastPush > this.p.pushToAirMs) return null;
    this.lastJump = t;
    return this.airSince;
  }
}

export class MotionPipeline {
  readonly adapter = new RateAdapter();
  readonly detector: SwingDetector;
  q: Quat | null = null;
  q0: Quat | null = null;
  /** Latest |ω| in deg/s, for the dev graph. */
  lastRate = 0;

  constructor(params: SwingParams) {
    this.detector = new SwingDetector(params);
  }

  /** Paddle pitch relative to calibration (rad, + = open face, i.e. the phone's back tilts toward the sky). */
  face(): number {
    return paddleFace(this.q, this.q0);
  }

  push(ev: RawEvent): DetectedSwing | null {
    if (ev.k === 'o') {
      this.q = eulerToQuat(ev.e[0], ev.e[1], ev.e[2]);
      this.adapter.orientation(this.q, ev.t);
      return null;
    }
    if (!ev.rr) return null;
    const w = this.adapter.rate(ev.rr, ev.t);
    this.lastRate = Math.hypot(...w);
    return this.detector.push(ev.t, w, this.face());
  }
}
