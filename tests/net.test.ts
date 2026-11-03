import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../engine/config.ts';
import { Game } from '../engine/game.ts';
import { applyNet, encodeNet, mirrorBall, mirrorScore, type VsEvent } from '../engine/net.ts';
import { createRng } from '../engine/rng.ts';

/**
 * Two laptops in one process: host (authority) and guest, each with its own player as side 0, joined by a
 * fake network that delivers after `oneWayMs`. Both players swing automatically with some timing error.
 */
function playOnline(oneWayMs: number, seed: number, graceMs = 2 * oneWayMs + 120) {
  const cfg = defaultConfig;
  const host = new Game({ cpuLevel: 'easy', assist: 'normal', bestOf: 1, controllers: ['human', 'remote'], initialServer: 0, seed, net: { authority: true } }, cfg);
  const guest = new Game({ cpuLevel: 'easy', assist: 'normal', bestOf: 1, controllers: ['human', 'remote'], initialServer: 1, seed: seed + 1, net: { authority: false } }, cfg);
  host.netGraceMs = graceMs;
  const rng = createRng(seed + 7);
  const wire: Array<{ at: number; to: Game; m: VsEvent }> = [];
  const dt = 1 / 120;
  let now = 0;
  const swingAt = new Map<Game, { key: number; at: number }>();
  const rejected = { n: 0 };
  // Snapshots of |host ball − mirrored guest ball| in mid-flight, to check the two views agree.
  const gaps: number[] = [];

  const drive = (g: Game) => {
    if (g.phase === 'serve' && g.server === 0 && rng.next() < 0.02) g.toss(0);
    const c = g.contact;
    if (!c || c.side !== 0 || (g.phase !== 'toss' && g.phase !== 'rally')) return;
    let plan = swingAt.get(g);
    if (!plan || plan.key !== c.t) {
      // Aim within ±180 ms of the ideal contact, so some swings miss and points end.
      plan = { key: c.t, at: c.t + (rng.next() * 2 - 1) * 0.18 * cfg.physics.gameSpeed };
      swingAt.set(g, plan);
    }
    if (g.simTime >= plan.at) {
      g.swing(0, 0, { peak: 700 + rng.next() * 500, face: 0, path: 0, roll: 0 });
      plan.at = Infinity;
    }
  };

  for (let i = 0; i < 120 * 60 * 30 && host.phase !== 'matchOver'; i++) {
    now += dt;
    for (const [g, peer] of [
      [host, guest],
      [guest, host],
    ] as const) {
      g.update(dt);
      g.drainEvents();
      drive(g);
      for (const o of g.drainNet()) wire.push({ at: now + oneWayMs / 1000, to: peer, m: encodeNet(o, g) });
    }
    for (let j = 0; j < wire.length; j++) {
      const w = wire[j]!;
      if (w.at > now + 1e-9) continue;
      if (!applyNet(w.m, w.to, oneWayMs)) rejected.n++;
      wire.splice(j--, 1);
    }
    if (host.phase === 'rally' && guest.phase === 'rally' && i % 37 === 0) {
      const a = host.ball.p;
      const b = mirrorBall(guest.ball).p;
      gaps.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  // Let the last verdict reach the guest.
  for (const w of wire) applyNet(w.m, w.to, oneWayMs);
  for (let i = 0; i < 400; i++) guest.update(dt);
  return { host, guest, rejected: rejected.n, gaps };
}

describe('online match', () => {
  it('mirroring a ball twice is the identity, and scores swap sides', () => {
    const b = { p: { x: 0.3, y: 0.9, z: -1.1 }, v: { x: 1, y: 2, z: 8 }, w: { x: 50, y: -20, z: 10 } };
    expect(mirrorBall(mirrorBall(b))).toEqual(b);
    expect(mirrorScore({ bestOf: 3, initialServer: 0, points: [3, 5], games: [1, 0], history: [[11, 7]] })).toEqual({ bestOf: 3, initialServer: 1, points: [5, 3], games: [0, 1], history: [[7, 11]] });
  });

  for (const oneWayMs of [0, 40, 90]) {
    it(`two laptops at ${oneWayMs} ms one-way finish the same match with real rallies`, () => {
      const { host, guest, gaps } = playOnline(oneWayMs, 11 + oneWayMs);
      expect(host.phase).toBe('matchOver');
      expect(guest.phase).toBe('matchOver');
      // Same result from both seats (the guest sees it from the other end).
      expect(guest.winner).toBe(host.winner === 0 ? 1 : 0);
      expect(mirrorScore(guest.score)).toEqual(host.score);
      // Both players actually returned balls: rallies longer than serve + miss.
      expect(Math.max(...host.rallies)).toBeGreaterThanOrEqual(4);
      // Mid-rally the two views of the ball agree closely (same trajectory, same real-time clock).
      gaps.sort((a, b) => a - b);
      expect(gaps.length).toBeGreaterThan(20);
      expect(gaps[Math.floor(gaps.length * 0.8)]!).toBeLessThan(0.05);
    });
  }

  it('the host waits for a late remote hit before calling a missed return', () => {
    // 300 ms each way (a very bad link). With the grace window, the guest's returns land and none are thrown away;
    // with no grace, the host calls "missed return" before the guest's hit arrives and rejects it.
    const withGrace = playOnline(300, 5);
    const noGrace = playOnline(300, 5, 0);
    expect(Math.max(...withGrace.host.rallies)).toBeGreaterThanOrEqual(4);
    expect(withGrace.rejected).toBe(0);
    expect(noGrace.rejected).toBeGreaterThan(5);
  });
});
