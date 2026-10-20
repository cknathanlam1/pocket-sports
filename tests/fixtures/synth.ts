// Synthetic sensor sessions in the same format the phone's dev recorder writes (see controller/recorder.ts).
// Body-frame angular velocity is scripted (stillness, tremor, waggles, swings), integrated into
// orientation, and emitted as raw DeviceOrientation (alpha/beta/gamma) + rotationRate events.
import { type AxisMap, type RawEvent, SPEC_MAP, type V3 } from '../../controller/motion.ts';
import { eulerToQuat } from '../../controller/orientation.ts';
import { createRng } from '../../engine/rng.ts';
import type { Quat } from '../../shared/protocol.ts';
import { multiply } from '../../shared/quat.ts';

export interface Recording {
  meta: { platform: string; ua?: string; createdAt?: string; synthetic?: boolean; note?: string };
  events: RawEvent[];
  /** Ground truth: swing peak times (ms, recording clock). */
  expected?: { peaks: number[] };
}

export interface ScriptedSwing {
  t: number; // peak time, ms
  peak: number; // deg/s
  /** Direction mix in the body frame (normalised). Mostly y = horizontal sweep. */
  dir?: V3;
  widthMs?: number; // gaussian sigma
}

const DEG = Math.PI / 180;

/** W3C Z-X'-Y'' Euler (deg) from a device→earth quaternion. */
export function quatToEuler(q: Quat): V3 {
  const [x, y, z, w] = q;
  const r12 = 2 * (x * y - w * z);
  const r22 = 1 - 2 * (x * x + z * z);
  const r31 = 2 * (x * z - w * y);
  const r32 = 2 * (y * z + w * x);
  const r33 = 1 - 2 * (x * x + y * y);
  const beta = Math.asin(Math.max(-1, Math.min(1, r32)));
  let alpha = Math.atan2(-r12, r22) / DEG;
  if (alpha < 0) alpha += 360;
  return [alpha, beta / DEG, Math.atan2(-r31, r33) / DEG];
}

/** Inverse of an AxisMap: body ω → what the browser would report. */
function unmap(m: AxisMap, body: V3): V3 {
  const raw: V3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) raw[m.idx[i]!] = (body[i]! * m.sign[i]!) / m.scale;
  return raw;
}

export interface SynthOpts {
  platform: string;
  durationMs: number;
  motionHz: number;
  orientHz: number;
  jitterMs?: number;
  swings: ScriptedSwing[];
  /** Small deliberate motions that must NOT count as swings (deg/s peak, all below onset). */
  waggles?: Array<{ t: number; peak: number }>;
  noise?: number; // deg/s sigma
  tremor?: number; // deg/s amplitude of an 8–10 Hz hand tremor
  map?: AxisMap;
  seed?: number;
}

export function synthesize(o: SynthOpts): Recording {
  const rng = createRng(o.seed ?? 1);
  const map = o.map ?? SPEC_MAP;
  const omega = (t: number): V3 => {
    const w: V3 = [rng.gauss() * (o.noise ?? 3), rng.gauss() * (o.noise ?? 3), rng.gauss() * (o.noise ?? 3)];
    const tr = o.tremor ?? 6;
    w[0] += tr * Math.sin(2 * Math.PI * 9 * (t / 1000));
    w[2] += tr * 0.7 * Math.sin(2 * Math.PI * 8.3 * (t / 1000) + 1);
    for (const s of o.swings) {
      const sig = s.widthMs ?? 45;
      const g = Math.exp(-0.5 * ((t - s.t) / sig) ** 2);
      const d = s.dir ?? [0.25, 0.95, 0.15];
      const n = Math.hypot(...d);
      for (let i = 0; i < 3; i++) w[i]! += (s.peak * g * d[i]!) / n;
    }
    for (const wg of o.waggles ?? []) {
      const g = Math.exp(-0.5 * ((t - wg.t) / 80) ** 2);
      w[0] += wg.peak * g * 0.8;
      w[2] += wg.peak * g * 0.6;
    }
    return w;
  };

  // Integrate orientation at 1 kHz, sample events at the platform rates.
  const events: RawEvent[] = [];
  let q: Quat = eulerToQuat(20, 80, 0); // held upright-ish, screen toward the player
  const dt = 1;
  let nextM = 0;
  let nextO = 0;
  for (let t = 0; t <= o.durationMs; t += dt) {
    const w = omega(t);
    const ang = Math.hypot(...w) * DEG * (dt / 1000);
    if (ang > 0) {
      const s = Math.sin(ang / 2) / (Math.hypot(...w) || 1);
      q = multiply(q, [w[0] * s, w[1] * s, w[2] * s, Math.cos(ang / 2)]);
    }
    if (t >= nextM) {
      const jt = o.jitterMs ? rng.gauss() * o.jitterMs : 0;
      events.push({ k: 'm', t: +(t + jt).toFixed(2), rr: unmap(map, w).map((v) => +v.toFixed(3)) as V3 });
      nextM += 1000 / o.motionHz;
    }
    if (t >= nextO) {
      events.push({ k: 'o', t, e: quatToEuler(q).map((v) => +v.toFixed(3)) as V3 });
      nextO += 1000 / o.orientHz;
    }
  }
  events.sort((a, b) => a.t - b.t);
  return { meta: { platform: o.platform, synthetic: true, createdAt: '2026-10-20' }, events, expected: { peaks: o.swings.map((s) => s.t) } };
}

/** A realistic test session: stillness, adjustments, then a mix of soft/hard swings incl. a quick double. */
export function standardSession(platform: 'iphone' | 'android', seed: number, map?: AxisMap): Recording {
  const swings: ScriptedSwing[] = [
    { t: 3500, peak: 520 },
    { t: 5200, peak: 900, dir: [0.5, 0.85, 0.1] },
    { t: 7000, peak: 1500, widthMs: 35 },
    { t: 8700, peak: 700, dir: [-0.45, 0.85, 0.2] },
    { t: 10400, peak: 1200, dir: [0.2, 0.9, -0.4] },
    { t: 12100, peak: 420, widthMs: 60 },
    { t: 13600, peak: 1000 },
    { t: 13980, peak: 950 }, // quick second swing 380 ms later
    { t: 15800, peak: 1800, widthMs: 30 },
  ];
  return synthesize({
    platform,
    durationMs: 17500,
    motionHz: platform === 'iphone' ? 60 : 100,
    orientHz: 60,
    jitterMs: platform === 'android' ? 1.5 : 0.3,
    swings,
    waggles: [{ t: 1500, peak: 160 }, { t: 9600, peak: 210 }, { t: 14900, peak: 190 }],
    seed,
    map,
  });
}
