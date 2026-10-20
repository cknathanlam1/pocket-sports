import { describe, expect, it } from 'vitest';
import { type PhysEvent, type Side } from '../engine/physics.ts';
import { Referee } from '../engine/referee.ts';
import { awardPoint, currentServer, firstServerOfGame, newScore } from '../engine/rules.ts';
import { v3 } from '../engine/vec.ts';

const table = (side: Side): PhysEvent => ({ type: 'table', side, p: v3(), speed: 5 });
const floor: PhysEvent = { type: 'floor', p: v3() };
const clip: PhysEvent = { type: 'net', kind: 'clip', p: v3() };
const block: PhysEvent = { type: 'net', kind: 'block', p: v3() };

describe('scoring', () => {
  it('serve switches every 2 points', () => {
    const s = newScore(1, 0);
    const servers: Side[] = [];
    for (let i = 0; i < 8; i++) {
      servers.push(currentServer(s));
      awardPoint(s, (i % 2) as Side);
    }
    expect(servers).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
  });

  it('deuce: serve alternates every point from 10-10 and a game needs a 2-point lead', () => {
    const s = newScore(3, 0);
    for (let i = 0; i < 10; i++) {
      awardPoint(s, 0);
      awardPoint(s, 1);
    }
    expect(s.points).toEqual([10, 10]);
    const a = currentServer(s);
    awardPoint(s, 0); // 11-10
    expect(s.games).toEqual([0, 0]);
    const b = currentServer(s);
    expect(b).not.toBe(a);
    awardPoint(s, 1); // 11-11
    expect(currentServer(s)).toBe(a);
    awardPoint(s, 1); // 11-12
    const r = awardPoint(s, 1); // 11-13
    expect(r.gameOver).toBe(1);
    expect(s.history).toEqual([[11, 13]]);
    expect(s.points).toEqual([0, 0]);
  });

  it('11-9 wins a game; first server alternates each game', () => {
    const s = newScore(3, 1);
    expect(firstServerOfGame(s)).toBe(1);
    for (let i = 0; i < 9; i++) awardPoint(s, 1);
    for (let i = 0; i < 10; i++) awardPoint(s, 0);
    const r = awardPoint(s, 0);
    expect(r.gameOver).toBe(0);
    expect(firstServerOfGame(s)).toBe(0);
    expect(currentServer(s)).toBe(0);
  });

  it('best of 3 ends after 2 games; awarding after the end throws', () => {
    const s = newScore(3, 0);
    let last: { gameOver: Side | null; matchOver: Side | null } = { gameOver: null, matchOver: null };
    for (let g = 0; g < 2; g++) for (let i = 0; i < 11; i++) last = awardPoint(s, 1);
    expect(last.matchOver).toBe(1);
    expect(s.games).toEqual([0, 2]);
    expect(() => awardPoint(s, 0)).toThrow();
  });

  it('best of 1 and best of 5', () => {
    const one = newScore(1, 0);
    let r: { matchOver: Side | null } = { matchOver: null };
    for (let i = 0; i < 11; i++) r = awardPoint(one, 0);
    expect(r.matchOver).toBe(0);
    const five = newScore(5, 0);
    for (let g = 0; g < 2; g++) for (let i = 0; i < 11; i++) r = awardPoint(five, 0);
    expect(r.matchOver).toBe(null);
    for (let i = 0; i < 11; i++) r = awardPoint(five, 0);
    expect(r.matchOver).toBe(0);
  });
});

describe('referee', () => {
  const served = (server: Side) => {
    const r = new Referee();
    r.startPoint(server);
    r.onHit(server);
    return r;
  };

  it('legal serve: own side then receiver side, receiver may then hit', () => {
    const r = served(0);
    expect(r.onEvent(table(0)).kind).toBe('continue');
    expect(r.onEvent(table(1)).kind).toBe('continue');
    expect(r.canHit(1)).toBe(true);
  });

  it('serve that clips the net and lands in is a let', () => {
    const r = served(0);
    r.onEvent(table(0));
    r.onEvent(clip);
    expect(r.onEvent(table(1))).toEqual({ kind: 'let' });
  });

  it('serve that clips the net and goes out is a point to the receiver', () => {
    const r = served(0);
    r.onEvent(table(0));
    r.onEvent(clip);
    expect(r.onEvent(floor)).toEqual({ kind: 'point', winner: 1, reason: 'net' });
  });

  it('serve that misses its own side first is a fault', () => {
    const r = served(1);
    expect(r.onEvent(table(0))).toEqual({ kind: 'point', winner: 0, reason: 'out' });
  });

  it('dropped toss (never struck) is a retoss, not a point', () => {
    const r = new Referee();
    r.startPoint(0);
    expect(r.onEvent(floor)).toEqual({ kind: 'retoss' });
  });

  it('rally outcomes: out, net, double bounce, missed return', () => {
    const rally = () => {
      const r = served(0);
      r.onEvent(table(0));
      r.onEvent(table(1));
      r.onHit(1); // receiver returns
      return r;
    };
    expect(rally().onEvent(floor)).toEqual({ kind: 'point', winner: 0, reason: 'out' });
    const n = rally();
    n.onEvent(block);
    expect(n.onEvent(table(1))).toEqual({ kind: 'point', winner: 0, reason: 'net' });
    const d = rally();
    d.onEvent(table(0));
    expect(d.onEvent(table(0))).toEqual({ kind: 'point', winner: 1, reason: 'double bounce' });
    const m = rally();
    m.onEvent(table(0));
    expect(m.onEvent(floor)).toEqual({ kind: 'point', winner: 1, reason: 'missed return' });
  });

  it('cannot volley: receiver may not hit before the ball bounces on their side', () => {
    const r = served(0);
    r.onEvent(table(0));
    r.onEvent(table(1));
    r.onHit(1);
    expect(r.canHit(0)).toBe(false);
    r.onEvent(table(0));
    expect(r.canHit(0)).toBe(true);
  });
});
