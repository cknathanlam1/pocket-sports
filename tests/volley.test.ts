import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../engine/config.ts';
import type { GameEvent, GameSettings } from '../engine/game.ts';
import { driveTo, flight, lobTo, untilDescending } from '../engine/volley/physics.ts';
import { VolleyGame } from '../engine/volley/game.ts';
import { v3 } from '../engine/vec.ts';

const V = defaultConfig.volley;
const DT = 1 / defaultConfig.physics.stepHz;

const volley = (over: Partial<GameSettings> = {}): VolleyGame =>
  new VolleyGame({ cpuLevel: 'normal', assist: 'normal', bestOf: 1, controllers: ['cpu', 'cpu'], initialServer: 0, seed: 3, ...over }, defaultConfig);

/** Run until the match ends (or a frame cap), collecting events. */
function play(g: VolleyGame, onFrame?: (g: VolleyGame) => void, maxFrames = 60 * 60 * 40): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < maxFrames && g.phase !== 'matchOver'; i++) {
    g.update(1 / 60);
    onFrame?.(g);
    events.push(...g.drainEvents());
  }
  return events;
}

describe('volleyball physics', () => {
  it('a spike from the net lands where it was aimed and clears the tape', () => {
    // Arrange: contact 1.4 m from the net at 3 m, aimed 5 m deep, cross-court.
    const from = v3(2.2, 3.0, 1.4);
    const target = { x: -2, z: -5 };
    // Act
    const v = driveTo(from, target, 20, V, DT);
    const f = flight(from, v, V, DT);
    // Assert
    expect(Math.hypot(f.land.x - target.x, f.land.z - target.z)).toBeLessThan(0.3);
    expect(f.netY!).toBeGreaterThan(V.netHeight + V.ballR);
  });

  it('a pass lobs to the setter spot with the requested apex', () => {
    const from = v3(1.5, 0.8, 5.5);
    const to = v3(0, V.setHeight, V.setterGap);
    const v = lobTo(from, to, V.passApex, V, DT);
    const r = untilDescending({ p: from, v, w: v3() }, to.y, V, DT, { ignoreNet: true });
    expect(Math.hypot(r.p.x - to.x, r.p.z - to.z)).toBeLessThan(0.15);
  });
});

describe('volleyball rules', () => {
  it('sets go to 21 (win by 2) and a deciding set to 15', () => {
    const g = volley({ bestOf: 3 });
    expect(g.score.target).toBe(21);
    g.score.games = [1, 1];
    g.replayPoint();
    // The target is refreshed when a rally ends; simulate the next point being awarded.
    const events = play(g, undefined, 60 * 60 * 3);
    expect(events.some((e) => e.type === 'point')).toBe(true);
    expect(g.score.target).toBe(15);
  });

  it('the rally winner serves next (side-out scoring)', () => {
    const g = volley();
    const events = play(g, undefined, 60 * 60 * 4);
    const points = events.filter((e): e is Extract<GameEvent, { type: 'point' }> => e.type === 'point');
    expect(points.length).toBeGreaterThan(3);
    expect(g.server).toBe(points.at(-1)!.winner);
  });
});

describe('volleyball match', () => {
  it('CPU vs CPU plays a full set with real rallies (dig, set, attack)', () => {
    const g = volley({ cpuLevel: 'hard' });
    const events = play(g);
    expect(g.phase).toBe('matchOver');
    expect(g.winner).not.toBeNull();
    const [a, b] = g.score.history[0]!;
    expect(Math.max(a, b)).toBeGreaterThanOrEqual(21);
    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(2);
    const touches = new Set(events.flatMap((e) => (e.type === 'hit' && e.touch ? [e.touch] : [])));
    expect([...touches].sort()).toEqual(['dig', 'serve', 'set', 'spike']);
    // Some rallies go back and forth: serve + 3 touches + 3 more.
    expect(Math.max(...g.rallies)).toBeGreaterThanOrEqual(7);
  });

  it('a human who swings on time digs, gets a set, and attacks', () => {
    const g = volley({ controllers: ['human', 'cpu'], initialServer: 1 });
    const swung = new Set<number>();
    const kinds: string[] = [];
    play(
      g,
      (gg) => {
        const c = gg.contact;
        if (c && c.side === 0 && c.who === 0 && !c.done && gg.simTime >= c.t && !swung.has(c.t)) {
          swung.add(c.t);
          // Arrange the swing like a phone would: fast, neutral tilt, slightly downward for spikes.
          gg.swing(0, 0, { peak: 1200, face: 0, path: c.kind === 'attack' ? -200 : 100, roll: 0 });
        }
        if (gg.phase === 'serve' && gg.server === 0) gg.toss(0);
        for (const e of gg.drainEvents()) if (e.type === 'hit' && e.side === 0 && e.touch) kinds.push(e.touch);
      },
      60 * 60 * 4,
    );
    expect(kinds).toContain('dig');
    expect(kinds).toContain('spike');
    expect(kinds).toContain('serve');
    // The AI teammate set every good pass: sets follow digs for side 0 (sets are logged as side 0 hits too).
    expect(kinds.filter((k) => k === 'set').length).toBeGreaterThan(0);
  });

  it('an early twitch does not use up the touch: a later on-time swing still digs', () => {
    const g = volley({ controllers: ['human', 'cpu'], initialServer: 1 });
    let twitched = false;
    let dug = false;
    play(
      g,
      (gg) => {
        const c = gg.contact;
        if (!c || c.side !== 0 || c.kind !== 'dig' || c.done) return;
        if (!twitched && gg.simTime >= c.t - 0.32) twitched = gg.swing(0, 0, { peak: 900, face: 0, path: 0, roll: 0 }).result === 'miss';
        else if (twitched && !dug && gg.simTime >= c.t) dug = gg.swing(0, 0, { peak: 1000, face: 0, path: 50, roll: 0 }).result === 'hit';
      },
      60 * 30,
    );
    expect(twitched).toBe(true);
    expect(dug).toBe(true);
  });

  it('a mistimed swing misses and the ball lands for the other side', () => {
    const g = volley({ controllers: ['human', 'cpu'], initialServer: 1 });
    let missed = false;
    const events = play(
      g,
      (gg) => {
        const c = gg.contact;
        // Far too early (≈0.4 s): a late dig can't miss, the ball would already be in the sand.
        if (!missed && c && c.side === 0 && c.kind === 'dig' && !c.done && gg.simTime >= c.t - 0.32) {
          missed = gg.swing(0, 0, { peak: 1000, face: 0, path: 0, roll: 0 }).result === 'miss';
        }
      },
      60 * 30,
    );
    expect(missed).toBe(true);
    const firstPoint = events.find((e) => e.type === 'point');
    expect(firstPoint).toMatchObject({ winner: 1 });
  });
});
