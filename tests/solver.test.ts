import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../engine/config.ts';
import { type Ball, type PhysEvent, BALL_R, TABLE_TOP, stepBall } from '../engine/physics.ts';
import { solveDrive, solveServe } from '../engine/solver.ts';
import { type V3, v3 } from '../engine/vec.ts';

const cfg = defaultConfig;

/** Real flight (finite table, real net) → list of events until floor. */
function realFlight(p0: V3, v: V3, w: V3): PhysEvent[] {
  const b: Ball = { p: { ...p0 }, v: { ...v }, w: { ...w } };
  const out: PhysEvent[] = [];
  for (let i = 0; i < 3 * cfg.physics.stepHz; i++) {
    const e = stepBall(b, 1 / cfg.physics.stepHz, cfg.physics);
    if (e) out.push(e);
    if (e?.type === 'floor') break;
  }
  return out;
}

describe('shot solver (scatter off)', () => {
  const speeds = [4, 6, 9, 12, 15, 18];
  const spins: Array<[string, V3]> = [
    ['none', v3()],
    ['top 150', v3(-150, 0, 0)],
    ['top 300', v3(-300, 0, 0)],
    ['back 150', v3(150, 0, 0)],
    ['back 300', v3(300, 0, 0)],
    ['side +200', v3(0, 200, 0)],
    ['side −200', v3(0, -200, 0)],
    ['top+side', v3(-200, 150, 0)],
  ];
  const contacts = [v3(0.3, TABLE_TOP + 0.25, 1.6), v3(-0.5, TABLE_TOP + 0.05, 1.45), v3(0, TABLE_TOP + 0.5, 2.2)];
  const targets = [{ x: 0, z: -0.9 }, { x: 0.6, z: -1.2 }, { x: -0.6, z: -0.4 }];

  for (const [name, w] of spins) {
    it(`lands within 5 cm, clears the net — spin ${name}`, () => {
      for (const h of speeds)
        for (const p0 of contacts)
          for (const t of targets) {
            const sol = solveDrive(p0, t, h, w, cfg);
            const evs = realFlight(p0, sol.v, w);
            const first = evs[0];
            expect(first?.type, `h=${h} p0=${JSON.stringify(p0)} t=${JSON.stringify(t)}`).toBe('table');
            if (first?.type !== 'table') continue;
            expect(Math.hypot(first.p.x - t.x, first.p.z - t.z)).toBeLessThan(0.05);
          }
    });
  }

  it('serve: bounces on own half, then lands within 5 cm of target', () => {
    for (const w of [v3(), v3(-150, 0, 0), v3(150, 0, 0), v3(0, 150, 0)])
      for (const t of [{ x: 0, z: -0.8 }, { x: 0.5, z: -1.1 }, { x: -0.5, z: -0.5 }]) {
        const p0 = v3(0.2, TABLE_TOP + 0.2, 1.57);
        const sol = solveServe(p0, t, 0.8, 4, w, cfg);
        const evs = realFlight(p0, sol.v, w);
        expect(evs[0]?.type).toBe('table');
        expect(evs[1]?.type).toBe('table');
        const [a, b] = evs as Array<Extract<PhysEvent, { type: 'table' }>>;
        expect(a!.side).toBe(0);
        expect(Math.hypot(b!.p.x - t.x, b!.p.z - t.z)).toBeLessThan(0.05);
      }
  });
});

void BALL_R;
