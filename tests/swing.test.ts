import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type AxisMap, type DetectedSwing, MotionPipeline, SPEC_MAP, paddleFace } from '../controller/motion.ts';
import { eulerToQuat } from '../controller/orientation.ts';
import { defaultConfig } from '../engine/config.ts';
import { fromAxisAngle, multiply } from '../shared/quat.ts';
import { type Recording, standardSession, synthesize } from './fixtures/synth.ts';

const params = defaultConfig.swing;

function replay(rec: Recording): { swings: DetectedSwing[]; pipe: MotionPipeline } {
  const pipe = new MotionPipeline({ ...params });
  const swings: DetectedSwing[] = [];
  for (const ev of rec.events) {
    const s = pipe.push(ev);
    if (s) swings.push(s);
  }
  return { swings, pipe };
}

function expectMatches(rec: Recording, swings: DetectedSwing[]) {
  const peaks = rec.expected!.peaks;
  expect(swings.length, `${rec.meta.platform}: detected ${swings.map((s) => s.t.toFixed(0)).join(', ')}`).toBe(peaks.length);
  peaks.forEach((p, i) => expect(Math.abs(swings[i]!.t - p), `swing ${i} at ${p}`).toBeLessThanOrEqual(20));
}

describe('swing detector: recorded sessions', () => {
  const dir = resolve(import.meta.dirname, 'fixtures/recordings');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('has iPhone and Android recordings', () => {
    expect(files.some((f) => f.startsWith('iphone'))).toBe(true);
    expect(files.some((f) => f.startsWith('android'))).toBe(true);
  });

  for (const f of files) {
    it(`${f}: expected swing count, peaks within ±20 ms`, () => {
      const rec = JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as Recording;
      if (!rec.expected) return; // unlabeled real recording
      expectMatches(rec, replay(rec).swings);
    });
  }
});

describe('swing detector: robustness', () => {
  it('holding still (noise + tremor) for 60 s never triggers', () => {
    for (const seed of [1, 2, 3]) {
      const rec = synthesize({ platform: 'still', durationMs: 60_000, motionHz: 60, orientHz: 60, swings: [], noise: 6, tremor: 12, seed });
      expect(replay(rec).swings).toHaveLength(0);
    }
  });

  it('adjusting the grip (waggles up to 250°/s) never triggers', () => {
    const waggles = Array.from({ length: 20 }, (_, i) => ({ t: 500 + i * 900, peak: 120 + (i % 6) * 26 }));
    const rec = synthesize({ platform: 'waggle', durationMs: 19_000, motionHz: 100, orientHz: 60, swings: [], waggles, seed: 5 });
    expect(replay(rec).swings).toHaveLength(0);
  });

  it('a clear swing always registers, across peak speeds, widths and sample rates', () => {
    for (const hz of [50, 60, 100, 200])
      for (const peak of [380, 600, 1000, 1600, 2200])
        for (const widthMs of [25, 45, 80]) {
          const rec = synthesize({ platform: 'sweep', durationMs: 1200, motionHz: hz, orientHz: 60, swings: [{ t: 600, peak, widthMs }], seed: peak + hz });
          const { swings } = replay(rec);
          expect(swings, `hz=${hz} peak=${peak} w=${widthMs}`).toHaveLength(1);
          expect(Math.abs(swings[0]!.t - 600)).toBeLessThanOrEqual(20);
          expect(swings[0]!.peak).toBeGreaterThan(peak * 0.85);
        }
  });

  it('refractory period: no double count inside 250 ms', () => {
    const rec = synthesize({ platform: 'r', durationMs: 1500, motionHz: 100, orientHz: 60, swings: [{ t: 500, peak: 900, widthMs: 70 }, { t: 640, peak: 800 }], seed: 9 });
    expect(replay(rec).swings).toHaveLength(1);
  });
});

describe('rotationRate adapter', () => {
  // Browsers that label axes differently or report rad/s are recovered by auto-calibration.
  const variants: Array<[string, AxisMap]> = [
    ['spec (alpha=z, beta=x, gamma=y)', SPEC_MAP],
    ['alpha=x, beta=y, gamma=z', { idx: [0, 1, 2], sign: [1, 1, 1], scale: 1 }],
    ['spec in rad/s', { ...SPEC_MAP, scale: 180 / Math.PI }],
    ['flipped signs', { idx: [1, 2, 0], sign: [-1, 1, -1], scale: 1 }],
  ];
  for (const [name, map] of variants) {
    it(`locks the right mapping: ${name}`, () => {
      const rec = standardSession('android', 3, map);
      const { pipe, swings } = replay(rec);
      expect(pipe.adapter.locked).toBe(true);
      expect(pipe.adapter.map).toEqual(map);
      // Swings after calibration locks are still detected (magnitude may be off until then).
      expect(swings.length).toBeGreaterThanOrEqual(rec.expected!.peaks.length - 2);
    });
  }
});

describe('swing features', () => {
  it('upward brush → positive path, downward chop → negative', () => {
    const run = (dx: number) =>
      replay(synthesize({ platform: 'p', durationMs: 1200, motionHz: 100, orientHz: 60, swings: [{ t: 600, peak: 900, dir: [dx, 0.8, 0] }], seed: 4 })).swings[0]!;
    expect(run(-0.6).path).toBeGreaterThan(150); // top tips forward = face closes over the ball
    expect(run(0.6).path).toBeLessThan(-150);
  });

  it('face angle: tipping the phone top toward you opens the face', () => {
    const q0 = eulerToQuat(30, 85, 0);
    expect(paddleFace(q0, q0)).toBeCloseTo(0, 6);
    const open = multiply(q0, fromAxisAngle(1, 0, 0, (20 * Math.PI) / 180));
    expect((paddleFace(open, q0) * 180) / Math.PI).toBeCloseTo(20, 4);
    const closed = multiply(q0, fromAxisAngle(1, 0, 0, (-15 * Math.PI) / 180));
    expect((paddleFace(closed, q0) * 180) / Math.PI).toBeCloseTo(-15, 4);
  });
});
