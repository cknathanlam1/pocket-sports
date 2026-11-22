import { describe, expect, it } from 'vitest';
import { JumpDetector } from '../controller/motion.ts';
import { defaultConfig } from '../engine/config.ts';
import { Game } from '../engine/game.ts';
import { VolleyGame } from '../engine/volley/game.ts';
import type { GameEvent, GameSettings } from '../engine/game.ts';

/** Feed |a| samples (m/s², straight down the phone's y axis) at 100 Hz; return detected take-off times. */
function detect(profile: Array<[ms: number, a: number]>): number[] {
  const d = new JumpDetector({ ...defaultConfig.jump });
  const out: number[] = [];
  let t = 0;
  for (const [ms, a] of profile)
    for (let i = 0; i < ms; i += 10, t += 10) {
      const j = d.push(t, [0.3, a, 0.2]);
      if (j !== null) out.push(j);
    }
  return out;
}

describe('jump detection (phone accelerometer)', () => {
  it('finds a real jump: push off, then free fall in the air', () => {
    // Arrange: stand, push off at ~1.8 g, ~350 ms airborne, land.
    const takeOffAt = 500 + 150;
    // Act
    const jumps = detect([
      [500, 9.8],
      [150, 18],
      [350, 0.8],
      [200, 25],
      [500, 9.8],
    ]);
    // Assert
    expect(jumps).toEqual([takeOffAt]);
  });

  it('ignores a dropped phone (free fall with no push) and a hard arm swing (never weightless)', () => {
    expect(
      detect([
        [500, 9.8],
        [400, 0.3],
        [300, 30],
      ]),
    ).toEqual([]);
    expect(
      detect([
        [300, 9.8],
        [250, 28],
        [100, 14],
        [300, 9.8],
      ]),
    ).toEqual([]);
  });
});


const volley = (over: Partial<GameSettings> = {}): VolleyGame =>
  new VolleyGame({ cpuLevel: 'easy', assist: 'normal', bestOf: 1, controllers: ['human', 'cpu'], initialServer: 1, seed: 9, ...over }, defaultConfig);

/** Play until side 0's main player has an attack to make, then spike it on time, optionally jumping first. */
function firstSpike(g: VolleyGame, jump: boolean): Extract<GameEvent, { type: 'hit' }> | undefined {
  for (let i = 0; i < 60 * 60; i++) {
    g.update(1 / 60);
    const c = g.contact;
    if (c && c.side === 0 && c.who === 0 && !c.done && g.simTime >= c.t) {
      if (c.kind === 'attack' && jump) g.jump(0, 0.3);
      g.swing(0, 0, { peak: 1450, face: 0, path: c.kind === 'attack' ? -300 : 60, roll: 0 });
    }
    for (const e of g.drainEvents()) if (e.type === 'hit' && e.touch === 'spike' && e.side === 0) return e;
  }
  return undefined;
}

describe('volleyball spikes need a jump', () => {
  it('a jumping spike is a full-power smash; the same swing standing is capped', () => {
    const jumped = firstSpike(volley(), true)!;
    const standing = firstSpike(volley(), false)!;
    expect(jumped.standing).toBe(false);
    expect(standing.standing).toBe(true);
    expect(jumped.speed * 3.6).toBeGreaterThan(70); // km/h
    expect(standing.speed).toBeLessThan(jumped.speed * 0.75);
  });

  it('on Easy assist the jump is automatic', () => {
    const e = firstSpike(volley({ assist: 'easy' }), false)!;
    expect(e.standing).toBe(false);
  });
});

describe('volleyball same-team two-player (player 2 sets)', () => {
  it('the setter waits for player 2, and player 2 swinging on time sets player 1 up', () => {
    const g = volley({ humanSetter: [true, false] });
    let waited = false;
    let set: Extract<GameEvent, { type: 'hit' }> | undefined;
    for (let i = 0; i < 60 * 60 && !set; i++) {
      g.update(1 / 60);
      const c = g.contact;
      if (c && c.side === 0 && !c.done && g.simTime >= c.t) {
        if (c.who === 0) g.swing(0, 0, { peak: 1000, face: 0, path: 60, roll: 0 });
        else {
          waited = true; // the AI didn't play it at contact time
          g.swing(0, 0, { peak: 800, face: 0, path: 80, roll: 0 }, 1);
        }
      }
      for (const e of g.drainEvents()) if (e.type === 'hit' && e.touch === 'set' && e.side === 0) set = e;
    }
    expect(waited).toBe(true);
    expect(set?.who).toBe(1);
    // …and the attack comes to player 1 next.
    expect(g.contact).toMatchObject({ side: 0, who: 0, kind: 'attack' });
  });
});

describe('online timing window', () => {
  it('the latency bonus turns a late (borderline) swing into a clean hit', () => {
    const late = (bonus: number) => {
      const g = new Game({ cpuLevel: 'easy', assist: 'normal', bestOf: 1, controllers: ['human', 'remote'], initialServer: 0, seed: 1, net: { authority: true } }, defaultConfig);
      g.netWindowBonusMs = bonus;
      g.update(0.1);
      g.toss(0);
      const c = g.contact!;
      while (g.simTime < c.t + (0.13 * defaultConfig.physics.gameSpeed)) g.update(1 / 240); // 130 ms late
      return g.swing(0, 0, { peak: 900, face: 0, path: 0, roll: 0 }).timing;
    };
    expect(late(0)).toBe('borderline');
    expect(late(60)).toBe('good');
  });
});

