// Shot model: swing features + timing → intent (target, pace, spin) → launch velocity.
// Intent first, then physics: the solver finds the launch that realises the intent.
import type { Assist, Config } from './config.ts';
import { type Ball, BALL_R, HALF_L, HALF_W, type Side, sideSign } from './physics.ts';
import type { Rng } from './rng.ts';
import { type XZ, solveDrive, solveServe } from './solver.ts';
import { type V3, clamp, clampLen, clone, cross, normalize, v3 } from './vec.ts';

/** Swing features as measured by the input source (phone or mouse). */
export interface SwingFeatures {
  /** Peak angular speed |ω|, deg/s. */
  peak: number;
  /** Paddle pitch at peak, rad. + = open (face tilted up), − = closed. */
  face: number;
  /** Signed pitch rate through the swing, deg/s. + = upward brush (topspin), − = downward chop (backspin). */
  path: number;
  /** Roll rate about the phone's long axis, deg/s. + = curve to the hitter's right. */
  roll: number;
}

export interface ShotIntent {
  target: XZ; // where the ball should land (2nd bounce for serves)
  hSpeed: number; // horizontal pace, m/s
  topspin: number; // rad/s, + = topspin, − = backspin
  sidespin: number; // rad/s, + = curves to the hitter's right
}

export type TimingClass = 'good' | 'borderline' | 'miss';
export type ShotError = 'none' | 'net' | 'long' | 'wide';

export function classifyTiming(offsetMs: number, windowMs: number, cfg: Config): TimingClass {
  const a = Math.abs(offsetMs);
  if (a <= windowMs) return 'good';
  if (a <= windowMs * cfg.shot.borderlineFactor) return 'borderline';
  return 'miss';
}

export function launchSpeed(peakDegPerSec: number, cfg: Config): number {
  const c = cfg.shot.speedCurve;
  const t = clamp((peakDegPerSec - c.minDegPerSec) / (c.maxDegPerSec - c.minDegPerSec), 0, 1);
  return c.minSpeed + t * (c.maxSpeed - c.minSpeed);
}

/** Spin vector for a ball travelling horizontally along `dir`. */
export function spinVector(dir: XZ, topspin: number, sidespin: number, cfg: Config): V3 {
  const d = normalize(v3(dir.x, 0, dir.z));
  const topAxis = normalize(cross(v3(0, 1, 0), d)); // forward rotation over the top
  // (ŷ × d) points to the hitter's left, so curving right needs ω_y = −sidespin.
  return clampLen(v3(topAxis.x * topspin, -sidespin, topAxis.z * topspin), cfg.physics.maxSpin);
}

/** Human rally/serve intent from swing features and timing.
 *  Timing → lateral (early = cross-court, late = down the line); face → depth/arc; peak → pace;
 *  path → top/backspin; roll → sidespin. */
export function humanIntent(f: SwingFeatures, offsetMs: number, windowMs: number, hitter: Side, contactX: number, cfg: Config): ShotIntent {
  const s = cfg.shot;
  const sign = sideSign(hitter);
  const pace = launchSpeed(f.peak, cfg);
  const faceN = clamp(f.face / ((s.faceFullDeg * Math.PI) / 180), -1, 1);
  const offN = clamp(offsetMs / windowMs, -1, 1);
  // Hitter's own frame: +x = their right. Near player (side 0) faces −z so their right is +x.
  const ownX = contactX * sign;
  const contactSide = ownX >= 0 ? 1 : -1;
  const targetOwnX = offN * s.lateralRange * contactSide; // early → opposite side (cross-court)
  const depth = clamp(s.depthBase + s.depthFaceRange * faceN, 0.35, HALF_L - 0.1);
  const strength = 0.5 + 0.5 * clamp((pace - s.speedCurve.minSpeed) / (s.speedCurve.maxSpeed - s.speedCurve.minSpeed), 0, 1);
  return {
    target: { x: targetOwnX * sign, z: -sign * depth },
    hSpeed: pace * (1 - s.openSlowdown * Math.max(faceN, 0)),
    topspin: clamp(f.path / s.pathFullDegPerSec, -1, 1) * s.topspinMax * strength,
    sidespin: clamp(f.roll / s.rollFullDegPerSec, -1, 1) * s.sidespinMax * strength,
  };
}

const inBounds = (t: XZ, hitter: Side): boolean => {
  const depth = -t.z * sideSign(hitter);
  return Math.abs(t.x) <= HALF_W - BALL_R && depth >= 0.05 && depth <= HALF_L - BALL_R;
};

const clampToTable = (t: XZ, hitter: Side): XZ => {
  const sign = sideSign(hitter);
  const depth = clamp(-t.z * sign, 0.15, HALF_L - 0.08);
  return { x: clamp(t.x, -HALF_W + 0.08, HALF_W - 0.08), z: -sign * depth };
};

export interface ResolveOpts {
  hitter: Side;
  isServe: boolean;
  scatter: number; // m std dev added to the target
  /** 0..1: pulls a scattered target that is off the table back toward it (assist level, or 1 for CPU aim error). */
  pullBack: number;
  /** 0..1: same, applied after an injected long/wide error (assist rescues; CPU unforced errors stay out). */
  errorPullBack: number;
  error: ShotError;
  maxSpeed?: number;
}

/** Turn an intent into a launched ball from contact point p0. */
export function resolveShot(p0: V3, intent: ShotIntent, opts: ResolveOpts, cfg: Config, rng: Rng): { ball: Ball; target: XZ } {
  const sign = sideSign(opts.hitter);
  const pull = (t: XZ, k: number): XZ => {
    if (k <= 0 || inBounds(t, opts.hitter)) return t;
    const inside = clampToTable(t, opts.hitter);
    return { x: t.x + (inside.x - t.x) * k, z: t.z + (inside.z - t.z) * k };
  };
  let target = pull({ x: intent.target.x + rng.gauss() * opts.scatter, z: intent.target.z + rng.gauss() * opts.scatter }, opts.pullBack);
  if (opts.error === 'long') target = pull({ x: target.x, z: -sign * (HALF_L + 0.15 + rng.next() * 0.35) }, opts.errorPullBack);
  if (opts.error === 'wide') target = pull({ x: (target.x >= 0 ? 1 : -1) * (HALF_W + 0.15 + rng.next() * 0.3), z: target.z }, opts.errorPullBack);

  const dir = { x: target.x - p0.x, z: target.z - p0.z };
  const w = spinVector(dir, intent.topspin, intent.sidespin, cfg);
  let hSpeed = intent.hSpeed;
  if (opts.maxSpeed !== undefined) hSpeed = Math.min(hSpeed, opts.maxSpeed);

  const sol = opts.isServe
    ? solveServe(p0, target, cfg.serve.firstBounceDepth, clamp(hSpeed, cfg.serve.minSpeed, cfg.serve.maxSpeed), w, cfg, cfg.shot.minNetClear)
    : solveDrive(p0, target, hSpeed, w, cfg, cfg.shot.minNetClear);
  const v = clone(sol.v);
  if (opts.error === 'net') v.y -= 1.2 + rng.next() * 1.2; // dumps into the net
  return { ball: { p: clone(p0), v, w }, target };
}

export const assistOf = (cfg: Config, a: Assist) => cfg.assist[a];
