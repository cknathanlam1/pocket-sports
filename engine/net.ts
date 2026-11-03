// Online match wire format. Each laptop runs its own Game with its own player as side 0 (near end), so
// everything crossing the wire is turned 180° about the vertical axis (x → −x, z → −z) and sides swap.
// Times travel as ages ("this happened N ms ago") so no clock sync is needed, only the one-way latency.
import type { FinalVerdict, Game, NetOut } from './game.ts';
import type { Ball, Side } from './physics.ts';
import type { Score } from './rules.ts';

export type VsEvent =
  /** The sender tossed for their serve, `ago` real ms before sending. */
  | { k: 'vt'; ago: number }
  /** The sender struck the ball `ago` ms ago; b = launch state [p, v, w] in the receiver's frame. */
  | { k: 'vh'; ago: number; b: number[]; sv: boolean }
  /** Host's ruling and the score before it, in the receiver's frame. */
  | { k: 'vv'; v: FinalVerdict; pre: Score };

const flip = (s: Side): Side => (s === 0 ? 1 : 0);

/** A 180° turn about y keeps the table and physics identical; spin (an axial vector) turns the same way. */
export function mirrorBall(b: Ball): Ball {
  return { p: { x: -b.p.x, y: b.p.y, z: -b.p.z }, v: { x: -b.v.x, y: b.v.y, z: -b.v.z }, w: { x: -b.w.x, y: b.w.y, z: -b.w.z } };
}

export function mirrorScore(s: Score): Score {
  const sw = <T>(a: [T, T]): [T, T] => [a[1], a[0]];
  return { bestOf: s.bestOf, initialServer: flip(s.initialServer), points: sw(s.points), games: sw(s.games), history: s.history.map((h) => sw(h)) };
}

export function mirrorVerdict(v: FinalVerdict): FinalVerdict {
  return v.kind === 'point' ? { ...v, winner: flip(v.winner) } : v;
}

const packBall = (b: Ball): number[] => [b.p.x, b.p.y, b.p.z, b.v.x, b.v.y, b.v.z, b.w.x, b.w.y, b.w.z];
const unpackBall = (a: number[]): Ball => ({ p: { x: a[0]!, y: a[1]!, z: a[2]! }, v: { x: a[3]!, y: a[4]!, z: a[5]! }, w: { x: a[6]!, y: a[7]!, z: a[8]! } });

/** Turn a game's outgoing event into a wire message (mirrored, time as age). Call right after drainNet. */
export function encodeNet(o: NetOut, game: Game): VsEvent {
  if (o.k === 'verdict') return { k: 'vv', v: mirrorVerdict(o.v), pre: mirrorScore(o.pre) };
  const ago = ((game.simTime - o.t) / game.cfg.physics.gameSpeed) * 1000;
  return o.k === 'toss' ? { k: 'vt', ago } : { k: 'vh', ago, b: packBall(mirrorBall(o.ball)), sv: o.serve };
}

/** Apply a wire message to our game. `oneWayMs` = estimated network delay (RTT / 2). Returns false if rejected. */
export function applyNet(m: VsEvent, game: Game, oneWayMs: number): boolean {
  if (m.k === 'vv') {
    game.remoteVerdict(m.v, m.pre);
    return true;
  }
  const t = game.simTime - ((m.ago + oneWayMs) / 1000) * game.cfg.physics.gameSpeed;
  return m.k === 'vt' ? game.remoteToss(t) : game.remoteHit(t, unpackBall(m.b), m.sv);
}
