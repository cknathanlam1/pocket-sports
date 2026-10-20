import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../engine/config.ts';
import { Game, type GameSettings } from '../engine/game.ts';

const humanVsCpu = (over: Partial<GameSettings> = {}): Game =>
  new Game({ cpuLevel: 'easy', assist: 'normal', bestOf: 1, controllers: ['human', 'cpu'], initialServer: 0, seed: 1, ...over }, defaultConfig);

const neutral = { peak: 800, face: 0, path: 0, roll: 0 };

describe('game', () => {
  it('CPU vs CPU (easy) plays a full best-of-3 match to completion with real rallies', () => {
    const g = new Game({ cpuLevel: 'easy', assist: 'normal', bestOf: 3, controllers: ['cpu', 'cpu'], seed: 42 }, defaultConfig);
    let frames = 0;
    while (g.phase !== 'matchOver' && frames < 60 * 60 * 60) {
      g.update(1 / 60);
      g.drainEvents();
      frames++;
    }
    expect(g.phase).toBe('matchOver');
    expect(g.winner).not.toBeNull();
    const avg = g.rallies.reduce((a, b) => a + b, 0) / g.rallies.length;
    expect(avg).toBeGreaterThan(2.5);
    expect(Math.max(...g.rallies)).toBeGreaterThanOrEqual(10);
  });

  it('human swing on the toss with good timing produces a serve', () => {
    const g = humanVsCpu();
    g.update(0.1);
    expect(g.toss(0)).toBe(true);
    while (g.contact && g.simTime < g.contact.t) g.update(1 / 240);
    const r = g.swing(0, 0, neutral);
    expect(r.result).toBe('hit');
    expect(g.phase).toBe('rally');
  });

  it('lag compensation: a swing stamped 80 ms in the past is judged at that moment', () => {
    const g = humanVsCpu({ assist: 'pro' });
    g.update(0.1);
    g.toss(0);
    const ideal = g.contact!.t;
    while (g.simTime < ideal + 0.08 * defaultConfig.physics.gameSpeed) g.update(1 / 240);
    const age = (g.simTime - ideal) / defaultConfig.physics.gameSpeed;
    const r = g.swing(0, age, neutral);
    expect(r.result).toBe('hit');
    expect(Math.abs(r.offsetMs!)).toBeLessThan(10);
  });

  it('lag compensation: a phone swing arriving 150 ms (relay-ish) after it happened still lands on time', () => {
    const g = humanVsCpu({ assist: 'normal' });
    g.update(0.1);
    g.toss(0);
    const ideal = g.contact!.t;
    const swingAt = ideal - 0.03 * defaultConfig.physics.gameSpeed; // swung 30 ms early (real)
    while (g.simTime < swingAt + 0.15 * defaultConfig.physics.gameSpeed) g.update(1 / 240);
    const age = (g.simTime - swingAt) / defaultConfig.physics.gameSpeed;
    const r = g.swing(0, age, neutral);
    expect(r.result).toBe('hit');
    expect(r.offsetMs!).toBeGreaterThan(-40);
    expect(r.offsetMs!).toBeLessThan(-20);
  });

  it('a swing far outside the window misses', () => {
    const g = humanVsCpu();
    g.update(0.1);
    g.toss(0);
    g.update(0.02);
    expect(g.swing(0, 0, neutral).result).toBe('miss');
  });

  it('human with perfect timing sustains rallies against easy CPU', () => {
    const g = humanVsCpu({ seed: 7 });
    let frames = 0;
    let hits = 0;
    while (g.phase !== 'matchOver' && frames < 60 * 60 * 30) {
      if (g.phase === 'serve' && g.server === 0) g.toss(0);
      const c = g.contact;
      if (c && c.side === 0 && g.simTime >= c.t && (g.phase === 'toss' || g.phase === 'rally')) {
        if (g.swing(0, 0, neutral).result === 'hit') hits++;
      }
      g.update(1 / 240);
      frames++;
    }
    expect(g.phase).toBe('matchOver');
    expect(hits).toBeGreaterThan(30);
    expect(Math.max(...g.rallies)).toBeGreaterThanOrEqual(10);
  });
});
