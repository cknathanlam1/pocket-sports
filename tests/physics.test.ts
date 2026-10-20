import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../engine/config.ts';
import { type Ball, BALL_R, TABLE_TOP, accel, stepBall } from '../engine/physics.ts';
import { v3 } from '../engine/vec.ts';

const cfg = defaultConfig.physics;
const dt = 1 / cfg.stepHz;

describe('physics', () => {
  it('a 30 cm drop onto the table bounces 21–25 cm', () => {
    const b: Ball = { p: v3(0, TABLE_TOP + BALL_R + 0.3, 0.5), v: v3(), w: v3() };
    let bounced = false;
    let apex = 0;
    for (let i = 0; i < 2 * cfg.stepHz; i++) {
      const e = stepBall(b, dt, cfg);
      if (e?.type === 'table') {
        if (bounced) break;
        bounced = true;
      }
      if (bounced) apex = Math.max(apex, b.p.y - BALL_R - TABLE_TOP);
    }
    expect(bounced).toBe(true);
    expect(apex).toBeGreaterThanOrEqual(0.21);
    expect(apex).toBeLessThanOrEqual(0.25);
  });

  it('drag opposes velocity and is ≈50 m/s² at 20 m/s', () => {
    const a = accel(v3(0, 0, -20), v3(), cfg);
    expect(a.z).toBeGreaterThan(0);
    expect(a.z).toBeCloseTo(cfg.dragK * 400, 6);
    expect(a.z).toBeGreaterThan(45);
    expect(a.z).toBeLessThan(55);
  });

  it('topspin dips the ball, backspin lifts it (Magnus)', () => {
    // Ball travelling −z: topspin axis is −x (forward rotation over the top).
    const v = v3(0, 0, -10);
    const noSpin = accel(v, v3(), cfg).y;
    expect(accel(v, v3(-100, 0, 0), cfg).y).toBeLessThan(noSpin);
    expect(accel(v, v3(100, 0, 0), cfg).y).toBeGreaterThan(noSpin);
  });

  it('sidespin curves the ball sideways', () => {
    const a = accel(v3(0, 0, -10), v3(0, 100, 0), cfg);
    expect(Math.abs(a.x)).toBeGreaterThan(1);
  });

  it('topspin makes the ball kick forward off the table, backspin checks it', () => {
    const run = (wx: number) => {
      const b: Ball = { p: v3(0, TABLE_TOP + BALL_R + 0.01, -0.5), v: v3(0, -4, -3), w: v3(wx, 0, 0) };
      for (let i = 0; i < 50; i++) if (stepBall(b, dt, cfg)?.type === 'table') return b.v.z;
      throw new Error('no bounce');
    };
    const flat = run(0);
    expect(run(-200)).toBeLessThan(flat); // faster toward −z
    expect(run(200)).toBeGreaterThan(flat);
  });

  it('swept collision: a 20 m/s ball cannot tunnel through the table', () => {
    const b: Ball = { p: v3(0, TABLE_TOP + 0.1, -0.2), v: v3(0, -20, -2), w: v3() };
    let hit = false;
    for (let i = 0; i < 20; i++) if (stepBall(b, dt, cfg)?.type === 'table') hit = true;
    expect(hit).toBe(true);
    expect(b.p.y).toBeGreaterThan(TABLE_TOP);
  });

  it('a low ball is blocked by the net', () => {
    const b: Ball = { p: v3(0, TABLE_TOP + 0.08, 0.3), v: v3(0, 0, -15), w: v3() };
    let kind: string | undefined;
    for (let i = 0; i < 20 && !kind; i++) {
      const e = stepBall(b, dt, cfg);
      if (e?.type === 'net') kind = e.kind;
    }
    expect(kind).toBe('block');
    expect(b.v.z).toBeGreaterThan(0);
  });
});
