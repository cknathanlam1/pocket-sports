// CPU opponent: picks a target, pace and spin, and uses the same shot model as the human.
import type { Config, CpuLevel } from './config.ts';
import { HALF_L, HALF_W, type Side, sideSign } from './physics.ts';
import type { Rng } from './rng.ts';
import type { ShotError, ShotIntent } from './shot.ts';

export interface CpuShot {
  intent: ShotIntent;
  error: ShotError;
  scatter: number;
}

export function cpuShot(level: CpuLevel, hitter: Side, isServe: boolean, cfg: Config, rng: Rng): CpuShot {
  const c = cfg.cpu[level];
  const sign = sideSign(hitter);
  // Aim point: anywhere on the far half with a margin; aim error is added as scatter and then
  // clamped to the table, so misses come from the unforced-error rate rather than from scatter.
  const x = (rng.next() * 2 - 1) * (HALF_W - 0.2);
  const depth = isServe ? 0.5 + rng.next() * 0.6 : 0.45 + rng.next() * (HALF_L - 0.65);
  const hSpeed = isServe ? cfg.serve.minSpeed + rng.next() * (cfg.serve.maxSpeed - cfg.serve.minSpeed) : c.maxShotSpeed * (0.55 + 0.45 * rng.next());

  let topspin = 0;
  let sidespin = 0;
  if (rng.next() < c.spinUse) topspin = rng.next() < 0.7 ? 60 + rng.next() * 140 : -(60 + rng.next() * 90);
  if (rng.next() < c.spinUse * 0.5) sidespin = (rng.next() * 2 - 1) * 80;

  let error: ShotError = 'none';
  if (!isServe && rng.next() < c.errorRate) {
    const r = rng.next();
    error = r < 0.4 ? 'net' : r < 0.75 ? 'long' : 'wide';
  }
  return { intent: { target: { x, z: -sign * depth }, hSpeed, topspin, sidespin }, error, scatter: c.aimErrorM };
}
