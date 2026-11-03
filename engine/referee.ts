// Rally adjudication from ball events. Decides lets and who wins the point, and why.
import type { PhysEvent, Side } from './physics.ts';
import { other } from './physics.ts';

export type PointReason = 'out' | 'net' | 'double bounce' | 'missed return';

export type Verdict =
  | { kind: 'continue' }
  | { kind: 'let' }
  | { kind: 'retoss' }
  | { kind: 'point'; winner: Side; reason: PointReason };

const CONTINUE: Verdict = { kind: 'continue' };

export interface RefereeState {
  hitter: Side;
  isServe: boolean;
  struck: boolean;
  bounces: Side[];
  netTouched: boolean;
  netBlocked: boolean;
  done: boolean;
}

export class Referee {
  /** Side holding/tossing the serve, or the last hitter during a rally. */
  hitter: Side = 0;
  isServe = true;
  /** Ball has been struck at least once this point (a dropped toss is not a fault). */
  struck = false;
  /** Table bounces since the last hit, in order. */
  bounces: Side[] = [];
  netTouched = false;
  netBlocked = false;
  done = false;

  /** Copy of the mutable state, for rewinding when a late network hit arrives. */
  snapshot(): RefereeState {
    return { hitter: this.hitter, isServe: this.isServe, struck: this.struck, bounces: [...this.bounces], netTouched: this.netTouched, netBlocked: this.netBlocked, done: this.done };
  }

  restore(s: RefereeState): void {
    Object.assign(this, s, { bounces: [...s.bounces] });
  }

  startPoint(server: Side): void {
    this.hitter = server;
    this.isServe = true;
    this.struck = false;
    this.bounces = [];
    this.netTouched = false;
    this.netBlocked = false;
    this.done = false;
  }

  /** The receiver may only strike after exactly one legal bounce on their side. */
  canHit(side: Side): boolean {
    if (this.done) return false;
    if (!this.struck) return side === this.hitter; // the serve itself
    const need = this.isServe ? 2 : 1;
    return side === other(this.hitter) && this.bounces.length === need && this.bounces[need - 1] === side;
  }

  onHit(side: Side): void {
    if (this.struck) this.isServe = false;
    this.struck = true;
    this.hitter = side;
    this.bounces = [];
    this.netTouched = false;
    this.netBlocked = false;
  }

  onEvent(e: PhysEvent): Verdict {
    if (this.done) return CONTINUE;
    const v = this.judge(e);
    if (v.kind !== 'continue') this.done = true;
    return v;
  }

  private judge(e: PhysEvent): Verdict {
    const h = this.hitter;
    const r = other(h);
    const lose = (loser: Side, reason: PointReason): Verdict => ({ kind: 'point', winner: other(loser), reason });
    const failReason: PointReason = this.netTouched ? 'net' : 'out';

    if (!this.struck) return e.type === 'floor' ? { kind: 'retoss' } : CONTINUE;

    if (e.type === 'net') {
      this.netTouched = true;
      if (e.kind === 'block') this.netBlocked = true;
      return CONTINUE;
    }

    if (e.type === 'floor') {
      const legal = this.isServe ? 2 : 1;
      if (this.bounces.length >= legal) return lose(r, 'missed return');
      return lose(h, failReason);
    }

    // Table bounce
    this.bounces.push(e.side);
    const n = this.bounces.length;
    if (this.isServe) {
      if (n === 1) return e.side === h ? CONTINUE : lose(h, failReason);
      if (n === 2) {
        if (e.side !== r) return lose(h, this.netTouched ? 'net' : 'double bounce');
        return this.netTouched ? { kind: 'let' } : CONTINUE;
      }
      return lose(r, 'double bounce');
    }
    if (n === 1) return e.side === r ? CONTINUE : lose(h, 'net');
    return lose(r, 'double bounce');
  }
}
