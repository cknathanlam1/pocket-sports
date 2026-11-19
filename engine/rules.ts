// Scoring and serve rotation (ITTF): games to 11, win by 2; serve changes every 2 points,
// every point from 10–10; first server alternates each game; best of 1/3/5.
import type { Side } from './physics.ts';

export type BestOf = 1 | 3 | 5;

export interface Score {
  bestOf: BestOf;
  /** Points to win a game (11 in table tennis; 21 or 15 in a volleyball set). Win by 2. */
  target?: number;
  /** Who served first in game 0. */
  initialServer: Side;
  points: [number, number];
  games: [number, number];
  /** Completed game scores, for the match summary. */
  history: Array<[number, number]>;
}

export function newScore(bestOf: BestOf, initialServer: Side): Score {
  return { bestOf, initialServer, points: [0, 0], games: [0, 0], history: [] };
}

export const gameIndex = (s: Score): number => s.games[0] + s.games[1];
export const gamesToWin = (s: Score): number => Math.ceil(s.bestOf / 2);

export function firstServerOfGame(s: Score): Side {
  return (gameIndex(s) % 2 === 0 ? s.initialServer : 1 - s.initialServer) as Side;
}

export function currentServer(s: Score): Side {
  const n = s.points[0] + s.points[1];
  const deuce = s.points[0] >= 10 && s.points[1] >= 10;
  const switches = deuce ? n : Math.floor(n / 2); // only parity matters past 20 points
  return ((firstServerOfGame(s) + switches) % 2) as Side;
}

export function gameWinner(points: [number, number], target = 11): Side | null {
  const [a, b] = points;
  if (a >= target && a - b >= 2) return 0;
  if (b >= target && b - a >= 2) return 1;
  return null;
}

export const matchWinner = (s: Score): Side | null =>
  s.games[0] >= gamesToWin(s) ? 0 : s.games[1] >= gamesToWin(s) ? 1 : null;

export type PointResult = { gameOver: Side | null; matchOver: Side | null };

/** Award a point (mutates). Lets never reach here: they replay with no score change. */
export function awardPoint(s: Score, winner: Side): PointResult {
  if (matchWinner(s) !== null) throw new Error('match already over');
  s.points[winner]++;
  const g = gameWinner(s.points, s.target);
  if (g === null) return { gameOver: null, matchOver: null };
  s.history.push([s.points[0], s.points[1]]);
  s.games[g]++;
  s.points = [0, 0];
  return { gameOver: g, matchOver: matchWinner(s) };
}
