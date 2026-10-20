import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../engine/config.ts';
import { Game, type GameEvent, type MachineSettings } from '../engine/game.ts';

const neutral = { peak: 800, face: 0, path: 0, roll: 0 };

function practice(machine: MachineSettings, swing: boolean, seconds = 40): { results: Array<Extract<GameEvent, { type: 'practice' }>>; g: Game } {
  const g = new Game({ cpuLevel: 'easy', assist: 'normal', bestOf: 1, controllers: ['human', 'machine'], mode: 'practice', machine, seed: 3 }, defaultConfig);
  const results: Array<Extract<GameEvent, { type: 'practice' }>> = [];
  for (let f = 0; f < seconds * 240; f++) {
    const c = g.contact;
    if (swing && c && c.side === 0 && g.simTime >= c.t && g.phase === 'rally') g.swing(0, 0, neutral);
    g.update(1 / 240);
    for (const e of g.drainEvents()) if (e.type === 'practice') results.push(e);
  }
  return { results, g };
}

describe('practice ball machine', () => {
  it('feeds balls that land on the near half; perfect returns build a streak', () => {
    const { results, g } = practice({ speed: 6, spin: 'none', placement: 'middle', intervalMs: 800 }, true);
    expect(results.length).toBeGreaterThan(8);
    expect(g.practice.good / g.practice.total).toBeGreaterThan(0.8);
    expect(g.practice.best).toBeGreaterThanOrEqual(5);
    expect(g.score.points).toEqual([0, 0]); // no scoring in practice
  });

  it('no swing → every feed is a miss', () => {
    const { results } = practice({ speed: 8, spin: 'top', placement: 'random', intervalMs: 600 }, false, 20);
    expect(results.length).toBeGreaterThan(5);
    expect(results.every((r) => r.result === 'miss' && r.streak === 0)).toBe(true);
  });

  it('every spin and placement produces playable balls (contact predicted on the near side)', () => {
    for (const spin of ['none', 'top', 'back', 'side', 'mixed'] as const)
      for (const placement of ['forehand', 'middle', 'backhand', 'random'] as const) {
        const { g } = practice({ speed: 9, spin, placement, intervalMs: 700 }, true, 15);
        expect(g.practice.total, `${spin}/${placement}`).toBeGreaterThan(4);
        expect(g.practice.good / g.practice.total, `${spin}/${placement}`).toBeGreaterThan(0.6);
      }
  });
});
