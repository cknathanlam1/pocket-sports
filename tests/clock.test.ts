import { describe, expect, it } from 'vitest';
import { type ClockSample, estimateClock } from '../shared/clock.ts';
import { createRng } from '../engine/rng.ts';

/** Simulate a ping/pong with asymmetric jittery one-way delays. */
function simulate(trueOffset: number, seed: number, n = 10): ClockSample[] {
  const rng = createRng(seed);
  const out: ClockSample[] = [];
  let phone = 5000;
  for (let i = 0; i < n; i++) {
    // Base 10 ms each way plus exponential jitter (queuing), sometimes big spikes.
    const jitter = () => -Math.log(1 - rng.next()) * 15 + (rng.next() < 0.2 ? 80 * rng.next() : 0);
    const up = 10 + jitter();
    const down = 10 + jitter();
    const t0 = phone;
    const t1 = t0 + up + trueOffset; // laptop clock
    const t2 = t1 + 0.2;
    const t3 = t2 - trueOffset + down;
    out.push({ t0, t1, t2, t3 });
    phone += 50;
  }
  return out;
}

describe('clock sync', () => {
  it('recovers a known offset under jitter (lowest-RTT sample)', () => {
    const errs: number[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const offset = 123_456.7 - seed * 37;
      const e = estimateClock(simulate(offset, seed))!;
      errs.push(Math.abs(e.offset - offset));
    }
    errs.sort((a, b) => a - b);
    // Error is bounded by half the asymmetry of the best sample: median well under 5 ms.
    expect(errs[Math.floor(errs.length / 2)]!).toBeLessThan(5);
    expect(errs[Math.floor(errs.length * 0.95)]!).toBeLessThan(12);
  });

  it('exact with symmetric delays; picks the lowest RTT sample', () => {
    const s: ClockSample[] = [
      { t0: 0, t1: 1050, t2: 1050, t3: 100 }, // rtt 100, offset 1000
      { t0: 200, t1: 1210, t2: 1210, t3: 220 }, // rtt 20, offset 1000
    ];
    const e = estimateClock(s)!;
    expect(e.offset).toBe(1000);
    expect(e.rtt).toBe(20);
  });

  it('ignores corrupt samples', () => {
    expect(estimateClock([{ t0: 10, t1: 0, t2: 50, t3: 0 }])).toBeNull();
  });
});
