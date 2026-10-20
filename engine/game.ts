// Match orchestration: fixed-step simulation, serving, lag-compensated hits, CPU, auto-movement.
// Pure TS: the display drives it with update(realDt) and feeds input via toss()/swing().
import type { Assist, Config, CpuLevel } from './config.ts';
import { cpuShot } from './cpu.ts';
import {
  type Ball,
  BALL_R,
  HALF_L,
  type PhysEvent,
  type Side,
  TABLE_TOP,
  cloneBall,
  other,
  sideSign,
  stepBall,
} from './physics.ts';
import { Referee, type PointReason, type Verdict } from './referee.ts';
import { type Rng, createRng } from './rng.ts';
import { type BestOf, type Score, awardPoint, currentServer, newScore } from './rules.ts';
import { type ShotError, type SwingFeatures, type TimingClass, classifyTiming, humanIntent, resolveShot } from './shot.ts';
import { type V3, clamp, len, v3 } from './vec.ts';

export type Controller = 'human' | 'cpu';
export type Phase = 'serve' | 'toss' | 'rally' | 'pointOver' | 'matchOver';

export interface GameSettings {
  cpuLevel: CpuLevel;
  assist: Assist;
  bestOf: BestOf;
  /** Side 0 is the near end (camera side). */
  controllers: [Controller, Controller];
  initialServer?: Side;
  seed?: number;
}

export type GameEvent =
  | { type: 'hit'; side: Side; speed: number; strength: number; serve: boolean; offsetMs?: number; timing?: TimingClass }
  | { type: 'whiff'; side: Side; offsetMs?: number; reason: 'timing' | 'reach' | 'no-ball' }
  | { type: 'toss'; side: Side }
  | { type: 'bounce'; side: Side; speed: number }
  | { type: 'net'; kind: 'clip' | 'block' }
  | { type: 'floor' }
  | { type: 'point'; winner: Side; reason: PointReason }
  | { type: 'let' }
  | { type: 'game'; winner: Side }
  | { type: 'match'; winner: Side };

export interface Player {
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  /** Forehand (true) or backhand for the upcoming/last contact. */
  forehand: boolean;
  /** Sim time of the last swing, for animation. */
  swingAt: number;
}

/** Predicted ideal contact for the receiver (or the server's toss). */
export interface Contact {
  side: Side;
  t: number; // sim time of the ideal contact
  p: V3; // ball position then
  bounceT: number; // sim time of the legal bounce before it (−∞ for a toss)
  forehand: boolean;
  /** Sim time the receiver may start reacting (hit time). */
  from: number;
}

export interface SwingResult {
  result: 'hit' | 'miss' | 'none';
  offsetMs?: number;
  timing?: TimingClass;
  strength?: number;
}

export interface LastPoint {
  winner: Side | null; // null for a let / retoss
  reason: PointReason | 'let' | 'retoss';
}

interface RingEntry {
  t: number;
  ball: Ball;
}

const HAND_OFFSET = 0.4; // m from body centre to paddle contact, sideways

export class Game {
  readonly cfg: Config;
  readonly settings: GameSettings;
  readonly rng: Rng;
  readonly score: Score;
  readonly referee = new Referee();

  phase: Phase = 'serve';
  simTime = 0;
  ball: Ball = { p: v3(), v: v3(), w: v3() };
  ballLive = false;
  players: [Player, Player];
  contact: Contact | null = null;
  lastPoint: LastPoint | null = null;
  winner: Side | null = null;
  /** Shots in the current rally (serve counts as 1). */
  rallyShots = 0;
  /** Lengths of completed rallies, for stats/tests. */
  rallies: number[] = [];

  private acc = 0;
  private pauseLeft = 0; // real seconds
  private serveAt = Infinity; // sim time for a CPU toss
  private ring: RingEntry[] = [];
  private events: GameEvent[] = [];
  private cpuDone = false; // CPU already acted on the current contact

  constructor(settings: GameSettings, cfg: Config) {
    this.cfg = cfg;
    this.settings = settings;
    this.rng = createRng(settings.seed);
    this.score = newScore(settings.bestOf, settings.initialServer ?? 0);
    const mk = (s: Side): Player => {
      const z = sideSign(s) * (HALF_L + 0.6);
      return { x: 0, z, targetX: 0, targetZ: z, forehand: true, swingAt: -Infinity };
    };
    this.players = [mk(0), mk(1)];
    this.setupServe();
  }

  get dt(): number {
    return 1 / this.cfg.physics.stepHz;
  }

  get server(): Side {
    return currentServer(this.score);
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ───────────────────────── Loop ─────────────────────────

  update(realDt: number): void {
    const dt = this.dt;
    realDt = Math.min(realDt, 0.1); // tab switches etc.
    if (this.phase === 'pointOver') {
      this.pauseLeft -= realDt;
      if (this.pauseLeft <= 0) this.afterPause();
    }
    this.acc += realDt * this.cfg.physics.gameSpeed;
    while (this.acc >= dt) {
      this.acc -= dt;
      this.stepSim();
    }
  }

  private stepSim(): void {
    const dt = this.dt;
    this.simTime += dt;

    if (this.phase === 'serve') {
      this.holdBall();
      if (this.simTime >= this.serveAt) this.toss(this.server, true);
    } else if (this.ballLive) {
      this.advanceBall();
    }

    this.runCpu();
    this.movePlayers(dt);
  }

  /** One physics step for the live ball, with ring-buffer record and referee. */
  private advanceBall(): void {
    const e = stepBall(this.ball, this.dt, this.cfg.physics);
    this.ring.push({ t: this.simTime, ball: cloneBall(this.ball) });
    // Lag-compensation window: hit.ringBufferMs of real time, expressed in sim steps.
    const max = Math.ceil((this.cfg.physics.stepHz * this.cfg.hit.ringBufferMs * this.cfg.physics.gameSpeed) / 1000) + 2;
    if (this.ring.length > max) this.ring.splice(0, this.ring.length - max);
    if (e) this.onPhysEvent(e);
  }

  private onPhysEvent(e: PhysEvent): void {
    if (e.type === 'table') this.events.push({ type: 'bounce', side: e.side, speed: e.speed });
    else if (e.type === 'net') this.events.push({ type: 'net', kind: e.kind });
    else this.events.push({ type: 'floor' });
    if (this.phase !== 'toss' && this.phase !== 'rally') return;
    this.applyVerdict(this.referee.onEvent(e));
  }

  private applyVerdict(v: Verdict): void {
    if (v.kind === 'continue') return;
    this.contact = null;
    if (v.kind === 'retoss') {
      this.lastPoint = { winner: null, reason: 'retoss' };
      this.pause(0.5);
      return;
    }
    if (this.rallyShots > 0) this.rallies.push(this.rallyShots);
    if (v.kind === 'let') {
      this.lastPoint = { winner: null, reason: 'let' };
      this.events.push({ type: 'let' });
      this.pause(this.cfg.match.pointPauseMs / 1000);
      return;
    }
    this.lastPoint = { winner: v.winner, reason: v.reason };
    this.events.push({ type: 'point', winner: v.winner, reason: v.reason });
    const r = awardPoint(this.score, v.winner);
    if (r.gameOver !== null) this.events.push({ type: 'game', winner: r.gameOver });
    if (r.matchOver !== null) {
      this.events.push({ type: 'match', winner: r.matchOver });
      this.winner = r.matchOver;
    }
    this.pause(this.cfg.match.pointPauseMs / 1000);
  }

  private pause(seconds: number): void {
    this.phase = 'pointOver';
    this.pauseLeft = seconds;
  }

  private afterPause(): void {
    if (this.winner !== null) {
      this.phase = 'matchOver';
      return;
    }
    this.setupServe();
  }

  // ───────────────────────── Serving ─────────────────────────

  private serveHand(): V3 {
    const s = this.server;
    return v3(this.players[s].x + HAND_OFFSET * 0.5 * sideSign(s), TABLE_TOP + 0.15, sideSign(s) * (HALF_L + 0.2));
  }

  private holdBall(): void {
    this.ball = { p: this.serveHand(), v: v3(), w: v3() };
  }

  setupServe(): void {
    const s = this.server;
    this.phase = 'serve';
    this.referee.startPoint(s);
    this.contact = null;
    this.ballLive = false;
    this.ring = [];
    this.rallyShots = 0;
    this.cpuDone = false;
    for (const side of [0, 1] as const) {
      const p = this.players[side];
      p.targetX = side === s ? -0.25 * sideSign(side) : 0;
      p.targetZ = sideSign(side) * (HALF_L + (side === s ? 0.35 : 0.6));
    }
    // Snap the server into place so the held ball is where the toss starts.
    this.players[s].x = this.players[s].targetX;
    this.players[s].z = this.players[s].targetZ;
    this.holdBall();
    this.serveAt = this.settings.controllers[s] === 'cpu' ? this.simTime + (this.cfg.serve.cpuDelayMs / 1000) * this.cfg.physics.gameSpeed : Infinity;
  }

  /** Toss the ball for the serve. Human: Space / phone tap. */
  toss(side: Side, fromCpu = false): boolean {
    if (this.phase !== 'serve' || side !== this.server) return false;
    if (!fromCpu && this.settings.controllers[side] !== 'human') return false;
    const vy = Math.sqrt(2 * this.cfg.physics.gravity * this.cfg.serve.tossHeight);
    this.ball = { p: this.serveHand(), v: v3(0, vy, 0), w: v3() };
    this.ballLive = true;
    this.ring = [{ t: this.simTime, ball: cloneBall(this.ball) }];
    this.phase = 'toss';
    this.serveAt = Infinity;
    this.cpuDone = false;
    this.contact = this.predictTossContact(side);
    this.events.push({ type: 'toss', side });
    return true;
  }

  private predictTossContact(side: Side): Contact {
    const b = cloneBall(this.ball);
    const yC = TABLE_TOP + this.cfg.serve.contactAboveTable;
    let t = this.simTime;
    for (let i = 0; i < 3 * this.cfg.physics.stepHz; i++) {
      stepBall(b, this.dt, this.cfg.physics);
      t += this.dt;
      if (b.v.y < 0 && b.p.y <= yC) break;
    }
    return { side, t, p: b.p, bounceT: -Infinity, forehand: true, from: this.simTime };
  }

  // ───────────────────────── Hitting ─────────────────────────

  /** Ball state at sim time t from the ring buffer (nearest recorded step at or before t). */
  private ringAt(t: number): RingEntry | null {
    for (let i = this.ring.length - 1; i >= 0; i--) if (this.ring[i]!.t <= t + 1e-9) return this.ring[i]!;
    return this.ring[0] ?? null;
  }

  /**
   * A swing from `side`, which happened `ageReal` seconds ago (input latency). Timing is judged at
   * the moment of the swing, not when it arrived: the ball state then comes from the ring buffer,
   * and the struck ball is re-simulated forward to now.
   */
  swing(side: Side, ageReal: number, f: SwingFeatures): SwingResult {
    if (this.settings.controllers[side] !== 'human') return { result: 'none' };
    const tSwing = Math.max(this.simTime - Math.max(ageReal, 0) * this.cfg.physics.gameSpeed, this.ring[0]?.t ?? this.simTime);
    this.players[side].swingAt = tSwing;
    const c = this.contact;
    const live = (this.phase === 'toss' || this.phase === 'rally') && c !== null && c.side === side;
    if (!live || !this.referee.canHit(side)) {
      this.events.push({ type: 'whiff', side, reason: 'no-ball' });
      return { result: 'none' };
    }
    const isServe = this.phase === 'toss';
    const windowMs = this.cfg.assist[this.settings.assist].timingWindowMs;
    const offsetMs = ((tSwing - c.t) / this.cfg.physics.gameSpeed) * 1000;
    const timing = classifyTiming(offsetMs, windowMs, this.cfg);
    const at = this.ringAt(tSwing);
    const reach = at ? len({ x: at.ball.p.x - c.p.x, y: at.ball.p.y - c.p.y, z: at.ball.p.z - c.p.z }) : Infinity;
    if (timing === 'miss' || !at || tSwing < c.bounceT || reach > this.cfg.hit.reachRadius) {
      this.events.push({ type: 'whiff', side, offsetMs, reason: timing === 'miss' ? 'timing' : 'reach' });
      return { result: 'miss', offsetMs, timing: 'miss' };
    }

    const intent = humanIntent(f, offsetMs, windowMs, side, at.ball.p.x, this.cfg);
    if (isServe) {
      const s = this.cfg.serve;
      const k = clamp((intent.hSpeed - this.cfg.shot.speedCurve.minSpeed) / (this.cfg.shot.speedCurve.maxSpeed - this.cfg.shot.speedCurve.minSpeed), 0, 1);
      intent.hSpeed = s.minSpeed + k * (s.maxSpeed - s.minSpeed);
    }
    const pullBack = this.cfg.assist[this.settings.assist].outPullBack;
    const error: ShotError = timing === 'borderline' ? (this.rng.next() < 0.5 ? 'net' : 'long') : 'none';
    const shot = resolveShot(at.ball.p, intent, { hitter: side, isServe, scatter: this.cfg.shot.scatter * (timing === 'borderline' ? 2 : 1), pullBack, errorPullBack: pullBack, error }, this.cfg, this.rng);
    this.strike(side, shot.ball, at.t, isServe, offsetMs, timing);
    const strength = clamp(intent.hSpeed / this.cfg.shot.speedCurve.maxSpeed, 0, 1);
    return { result: 'hit', offsetMs, timing, strength };
  }

  /** Apply a hit that happened at sim time `tHit` and fast-forward the new trajectory to now. */
  private strike(side: Side, launched: Ball, tHit: number, isServe: boolean, offsetMs?: number, timing?: TimingClass): void {
    this.referee.onHit(side);
    this.phase = 'rally';
    this.rallyShots++;
    this.cpuDone = false;
    this.players[side].swingAt = tHit;
    const speed = len(launched.v);
    this.events.push({ type: 'hit', side, speed, strength: clamp(speed / 20, 0, 1), serve: isServe, offsetMs, timing });

    // Rewind to the hit and re-simulate forward to the present.
    this.ball = cloneBall(launched);
    this.ring = this.ring.filter((r) => r.t <= tHit);
    this.ring.push({ t: tHit, ball: cloneBall(this.ball) });
    this.contact = this.predictContact(other(side), tHit, isServe);
    const now = this.simTime;
    let t = tHit;
    while (t + this.dt <= now + 1e-9 && this.phase === 'rally') {
      t += this.dt;
      const e = stepBall(this.ball, this.dt, this.cfg.physics);
      this.ring.push({ t, ball: cloneBall(this.ball) });
      if (e) this.onPhysEvent(e);
    }

    // Hitter recovers toward the centre.
    const p = this.players[side];
    p.targetX = 0;
    p.targetZ = sideSign(side) * (HALF_L + 0.6);
  }

  /** Simulate the struck ball to find the receiver's ideal contact (or null if it won't be playable). */
  private predictContact(receiver: Side, tHit: number, isServe: boolean): Contact | null {
    const b = cloneBall(this.ball);
    const hitter = other(receiver);
    const need: Side[] = isServe ? [hitter, receiver] : [receiver];
    const bounces: Side[] = [];
    let bounceT = -Infinity;
    let t = tHit;
    const pastBase = HALF_L + this.cfg.movement.contactPastBaseline;
    for (let i = 0; i < 4 * this.cfg.physics.stepHz; i++) {
      const prevVy = b.v.y;
      const e = stepBall(b, this.dt, this.cfg.physics);
      t += this.dt;
      if (e?.type === 'floor') return null;
      if (e?.type === 'net' && e.kind === 'block') return null;
      if (e?.type === 'table') {
        bounces.push(e.side);
        const k = bounces.length - 1;
        if (k >= need.length || bounces[k] !== need[k]) return null;
        if (bounces.length === need.length) bounceT = t;
        continue;
      }
      if (bounceT > -Infinity) {
        const apex = prevVy > 0 && b.v.y <= 0;
        const deep = Math.abs(b.p.z) >= pastBase && Math.sign(b.p.z) === sideSign(receiver);
        const low = b.v.y < 0 && b.p.y < TABLE_TOP + BALL_R + 0.08;
        if (apex || deep || low) {
          const ownX = b.p.x * sideSign(receiver);
          return { side: receiver, t, p: { ...b.p }, bounceT, forehand: ownX >= -0.1, from: tHit };
        }
      }
    }
    return null;
  }

  // ───────────────────────── CPU ─────────────────────────

  private runCpu(): void {
    const c = this.contact;
    if (!c || this.cpuDone || this.settings.controllers[c.side] !== 'cpu') return;
    if (this.phase !== 'toss' && this.phase !== 'rally') return;
    if (this.simTime + 1e-9 < c.t) return;
    this.cpuDone = true;
    const side = c.side;
    const isServe = this.phase === 'toss';
    if (!this.referee.canHit(side)) return;
    // Could the CPU get there in time?
    const p = this.players[side];
    const needX = this.bodyXFor(side, c);
    if (!isServe && Math.abs(p.x - needX) > 0.35) {
      this.events.push({ type: 'whiff', side, reason: 'reach' });
      return;
    }
    const level = this.settings.cpuLevel;
    const s = cpuShot(level, side, isServe, this.cfg, this.rng);
    const shot = resolveShot(this.ball.p, s.intent, { hitter: side, isServe, scatter: s.scatter, pullBack: 1, errorPullBack: 0, error: s.error }, this.cfg, this.rng);
    this.strike(side, shot.ball, this.simTime, isServe);
  }

  private bodyXFor(side: Side, c: Contact): number {
    return c.p.x - (c.forehand ? HAND_OFFSET : -HAND_OFFSET) * sideSign(side);
  }

  // ───────────────────────── Movement ─────────────────────────

  private movePlayers(dt: number): void {
    const c = this.contact;
    for (const side of [0, 1] as const) {
      const p = this.players[side];
      const isCpu = this.settings.controllers[side] === 'cpu';
      if (c && c.side === side && this.phase === 'rally') {
        const reaction = isCpu ? (this.cfg.cpu[this.settings.cpuLevel].reactionMs / 1000) * this.cfg.physics.gameSpeed : 0;
        if (this.simTime >= c.from + reaction) {
          p.targetX = this.bodyXFor(side, c);
          p.targetZ = c.p.z + sideSign(side) * 0.35;
          p.forehand = c.forehand;
        }
      }
      const speed = isCpu ? this.cfg.movement.cpuSpeed : this.cfg.movement.humanSpeed;
      const step = speed * dt;
      p.x += clamp(p.targetX - p.x, -step, step);
      p.z += clamp(p.targetZ - p.z, -step, step);
    }
  }
}
