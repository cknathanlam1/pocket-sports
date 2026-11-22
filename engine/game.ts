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
import { Referee, type PointReason, type RefereeState, type Verdict } from './referee.ts';
import { type Rng, createRng } from './rng.ts';
import { type BestOf, type Score, awardPoint, currentServer, newScore } from './rules.ts';
import { type ShotError, type SwingFeatures, type TimingClass, classifyTiming, humanIntent, resolveShot } from './shot.ts';
import { type V3, clamp, len, v3 } from './vec.ts';

/** 'remote': the other laptop in an online match. Its hits arrive as network events (remoteHit/remoteToss). */
export type Controller = 'human' | 'cpu' | 'machine' | 'remote';

/** A ruling that ends the rally (anything but 'continue'). */
export type FinalVerdict = Exclude<Verdict, { kind: 'continue' }>;

/**
 * Events an online match sends to the other laptop. Times are this game's sim time; the net layer turns
 * them into ages so the receiver can place them on its own clock. Positions are in this game's frame.
 */
export type NetOut =
  | { k: 'toss'; t: number }
  | { k: 'hit'; t: number; ball: Ball; serve: boolean }
  /** Host only: a ruling, plus the score just before it so the guest applies it to an identical score. */
  | { k: 'verdict'; v: FinalVerdict; pre: Score };

/** Practice ball machine (side 1). Speed is horizontal pace in m/s. */
export interface MachineSettings {
  speed: number;
  spin: 'none' | 'top' | 'back' | 'side' | 'mixed';
  placement: 'forehand' | 'middle' | 'backhand' | 'random';
  intervalMs: number;
}

export type PracticeResult = 'good' | 'miss' | 'out' | 'net';
export type Phase = 'serve' | 'toss' | 'rally' | 'pointOver' | 'matchOver';

export interface GameSettings {
  cpuLevel: CpuLevel;
  assist: Assist;
  bestOf: BestOf;
  /** Side 0 is the near end (camera side). */
  controllers: [Controller, Controller];
  initialServer?: Side;
  seed?: number;
  /** 'practice': side 1 is a ball machine, no score; returns build a streak. */
  mode?: 'match' | 'practice';
  machine?: MachineSettings;
  /** Volleyball only: which sides' setters are human (same-team two-player: player 2 sets for side 0). */
  humanSetter?: [boolean, boolean];
  /**
   * Online match: side 0 is this laptop's player, side 1 is 'remote'. Each laptop judges its own player's
   * hits; the authority (host) alone calls points, waiting `netGraceMs` for a late remote hit first.
   */
  net?: { authority: boolean };
}

export type GameEvent =
  /** touch: volleyball only (which kind of contact), for sounds and animation. */
  | { type: 'hit'; side: Side; speed: number; strength: number; serve: boolean; offsetMs?: number; timing?: TimingClass; touch?: 'serve' | 'dig' | 'set' | 'spike' | 'tip'; who?: 0 | 1; standing?: boolean }
  | { type: 'whiff'; side: Side; offsetMs?: number; reason: 'timing' | 'reach' | 'no-ball' }
  | { type: 'toss'; side: Side }
  | { type: 'bounce'; side: Side; speed: number }
  | { type: 'net'; kind: 'clip' | 'block' }
  | { type: 'floor' }
  | { type: 'point'; winner: Side; reason: PointReason }
  | { type: 'let' }
  | { type: 'game'; winner: Side }
  | { type: 'match'; winner: Side }
  | { type: 'practice'; result: PracticeResult; streak: number; best: number };

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
  readonly sport = 'tt' as const;
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
  /** Practice mode tallies. */
  practice = { streak: 0, best: 0, good: 0, total: 0 };

  private acc = 0;
  private pauseLeft = 0; // real seconds
  private serveAt = Infinity; // sim time for a CPU toss
  private ring: RingEntry[] = [];
  private events: GameEvent[] = [];
  private cpuDone = false; // CPU already acted on the current contact
  /** Online: events for the other laptop (drain with drainNet). */
  private outbox: NetOut[] = [];
  /** Online, host: a ruling held back in case the remote player's hit is still in flight. */
  private pending: { v: FinalVerdict; t: number; deadline: number } | null = null;
  /** Referee state over the ring-buffer window, so a late remote hit is judged from the state it happened in. */
  private refLog: Array<{ t: number; s: RefereeState }> = [];
  /** Online, host: how long (real ms) to hold a ruling that a remote hit could still overturn. Set from RTT. */
  netGraceMs = 250;
  /** Online: extra timing window (real ms) for our player, set from the one-way delay to the other laptop. */
  netWindowBonusMs = 0;

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
    return this.isPractice ? 1 : currentServer(this.score);
  }

  get isPractice(): boolean {
    return this.settings.mode === 'practice';
  }

  /** Live-adjustable machine settings (practice mode). */
  get machine(): MachineSettings {
    return (this.settings.machine ??= { speed: 6, spin: 'none', placement: 'middle', intervalMs: 900 });
  }

  drainNet(): NetOut[] {
    const o = this.outbox;
    this.outbox = [];
    return o;
  }

  /** Index of the remote side, if this is an online match. */
  get remoteSide(): Side | null {
    return this.settings.controllers[1] === 'remote' ? 1 : this.settings.controllers[0] === 'remote' ? 0 : null;
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
    if (this.pending && this.simTime >= this.pending.deadline) {
      const v = this.pending.v;
      this.pending = null;
      this.commitVerdict(v);
    }

    if (this.phase === 'serve') {
      this.holdBall();
      if (this.simTime >= this.serveAt) {
        if (this.isPractice) this.machineFeed();
        else this.toss(this.server, true);
      }
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
    const oldest = this.ring[0]!.t;
    while (this.refLog.length > 1 && this.refLog[1]!.t <= oldest) this.refLog.shift();
    if (e) this.onPhysEvent(e, this.simTime);
  }

  private onPhysEvent(e: PhysEvent, t: number): void {
    if (e.type === 'table') this.events.push({ type: 'bounce', side: e.side, speed: e.speed });
    else if (e.type === 'net') this.events.push({ type: 'net', kind: e.kind });
    else this.events.push({ type: 'floor' });
    if (this.phase !== 'toss' && this.phase !== 'rally') return;
    const v = this.referee.onEvent(e);
    this.logRef(t);
    if (v.kind !== 'continue') this.rule(v, t);
  }

  private logRef(t: number): void {
    this.refLog.push({ t, s: this.referee.snapshot() });
  }

  /** Restore the referee as it was at sim time t (latest snapshot at or before t). */
  private restoreRef(t: number): void {
    let i = this.refLog.length - 1;
    while (i > 0 && this.refLog[i]!.t > t + 1e-9) i--;
    const e = this.refLog[i];
    if (!e) return;
    this.referee.restore(e.s);
    this.refLog.length = i + 1;
  }

  /** Online: only the host rules, and it waits for a remote hit that could still be on its way. */
  private rule(v: FinalVerdict, t: number): void {
    const net = this.settings.net;
    if (!net) return this.applyVerdict(v);
    if (!net.authority) return; // the host's verdict will arrive
    if (this.remoteCouldHit()) {
      this.pending = { v, t, deadline: t + (this.netGraceMs / 1000) * this.cfg.physics.gameSpeed };
      return;
    }
    this.commitVerdict(v);
  }

  /** The remote player may still strike this ball: they're serving and haven't hit, or ours was the last hit. */
  private remoteCouldHit(): boolean {
    const r = this.remoteSide;
    if (r === null) return false;
    return this.referee.struck ? this.referee.hitter !== r : this.referee.hitter === r;
  }

  private commitVerdict(v: FinalVerdict): void {
    const s = this.score;
    this.outbox.push({ k: 'verdict', v, pre: { ...s, points: [...s.points], games: [...s.games], history: s.history.map((h) => [...h] as [number, number]) } });
    this.applyVerdict(v);
  }

  private applyVerdict(v: FinalVerdict): void {
    this.contact = null;
    if (v.kind === 'retoss') {
      this.lastPoint = { winner: null, reason: 'retoss' };
      this.pause(0.5);
      return;
    }
    if (this.rallyShots > 0) this.rallies.push(this.rallyShots);
    if (this.isPractice && v.kind === 'point') {
      const human = this.rallyShots >= 2;
      const result: PracticeResult = v.winner === 0 ? 'good' : human && (v.reason === 'out' || v.reason === 'net') ? v.reason : 'miss';
      const p = this.practice;
      p.total++;
      if (result === 'good') {
        p.good++;
        p.streak++;
        p.best = Math.max(p.best, p.streak);
      } else p.streak = 0;
      this.events.push({ type: 'practice', result, streak: p.streak, best: p.best });
      this.pause(0.5);
      return;
    }
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
    if (this.isPractice) return v3(0, TABLE_TOP + 0.32, -(HALF_L + 0.25)); // machine mouth
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
    this.pending = null;
    this.refLog = [];
    this.logRef(this.simTime);
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
    if (this.isPractice) {
      this.players[1].x = this.players[1].targetX = 0;
      this.serveAt = this.simTime + (this.machine.intervalMs / 1000) * this.cfg.physics.gameSpeed;
      return;
    }
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
    if (!fromCpu && this.settings.net) this.outbox.push({ k: 'toss', t: this.simTime });
    return true;
  }

  // ───────────────────────── Online (remote laptop) ─────────────────────────

  /** The remote player tossed at sim time t (already converted to our clock). */
  remoteToss(t: number): boolean {
    const r = this.remoteSide;
    if (r === null || this.phase === 'matchOver') return false;
    // We may still be in the between-points pause the remote already finished.
    if (this.phase === 'pointOver' && this.winner === null) this.setupServe();
    if (this.phase !== 'serve' || this.server !== r) return false;
    this.toss(r, true);
    const from = clamp(t, this.simTime - 0.5 * this.cfg.physics.gameSpeed, this.simTime);
    this.ring = [{ t: from, ball: cloneBall(this.ball) }];
    this.replay(from);
    return true;
  }

  /**
   * The remote player struck the ball at sim time t (our clock) with the launch state they resolved.
   * Rewinds to t, so the trajectory matches theirs. Rejected if the ball was already ruled dead before t.
   */
  remoteHit(t: number, launched: Ball, serve: boolean): boolean {
    const r = this.remoteSide;
    if (r === null || (this.phase !== 'toss' && this.phase !== 'rally')) return false;
    if (this.pending) {
      if (t > this.pending.t + 1e-9) return false;
      this.pending = null;
    }
    const tHit = clamp(t, this.ring[0]?.t ?? this.simTime, this.simTime);
    this.restoreRef(tHit);
    this.strike(r, launched, tHit, serve);
    return true;
  }

  /** Guest: the host's ruling, applied to the same pre-point score so both laptops stay identical. */
  remoteVerdict(v: FinalVerdict, pre: Score): void {
    if (this.phase === 'matchOver') return;
    this.pending = null;
    this.score.points = [...pre.points];
    this.score.games = [...pre.games];
    this.score.history = pre.history.map((h) => [...h] as [number, number]);
    this.referee.done = true;
    this.applyVerdict(v);
  }

  /** Online pause: the rally can't be resumed in sync, so it is replayed from the serve (no score change). */
  replayPoint(): void {
    if (this.phase === 'matchOver') return;
    this.setupServe();
  }

  /** Ball machine: launch the next practice ball at the near half. */
  private machineFeed(): void {
    const m = this.machine;
    const r = this.rng;
    const x = { forehand: 0.45, middle: 0, backhand: -0.45, random: (r.next() * 2 - 1) * 0.55 }[m.placement];
    const depth = 0.75 + r.next() * 0.4;
    const kind = m.spin === 'mixed' ? (['none', 'top', 'back', 'side'] as const)[Math.floor(r.next() * 4)]! : m.spin;
    const topspin = kind === 'top' ? 150 : kind === 'back' ? -120 : 0;
    const sidespin = kind === 'side' ? (r.next() < 0.5 ? -100 : 100) : 0;
    const mouth = this.serveHand();
    const shot = resolveShot(mouth, { target: { x, z: depth }, hSpeed: m.speed, topspin, sidespin }, { hitter: 1, isServe: false, scatter: 0.03, pullBack: 1, errorPullBack: 0, error: 'none' }, this.cfg, r);
    this.ballLive = true;
    this.ring = [{ t: this.simTime, ball: cloneBall(shot.ball) }];
    this.serveAt = Infinity;
    // A machine feed is a rally ball, not a serve: it only has to bounce on the near half.
    this.referee.struck = true;
    this.strike(1, shot.ball, this.simTime, false);
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
    const windowMs = this.cfg.assist[this.settings.assist].timingWindowMs + this.netWindowBonusMs;
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
    if (this.settings.net) this.outbox.push({ k: 'hit', t: at.t, ball: cloneBall(shot.ball), serve: isServe });
    this.strike(side, shot.ball, at.t, isServe, offsetMs, timing);
    const strength = clamp(intent.hSpeed / this.cfg.shot.speedCurve.maxSpeed, 0, 1);
    return { result: 'hit', offsetMs, timing, strength };
  }

  /** Apply a hit that happened at sim time `tHit` and fast-forward the new trajectory to now. */
  private strike(side: Side, launched: Ball, tHit: number, isServe: boolean, offsetMs?: number, timing?: TimingClass): void {
    this.refLog = this.refLog.filter((r) => r.t <= tHit);
    this.referee.onHit(side);
    this.logRef(tHit);
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
    this.replay(tHit);

    // Hitter recovers toward the centre.
    const p = this.players[side];
    p.targetX = 0;
    p.targetZ = sideSign(side) * (HALF_L + 0.6);
  }

  /** Step the live ball from sim time `from` up to now (after a rewind), recording and refereeing as it goes. */
  private replay(from: number): void {
    const now = this.simTime;
    let t = from;
    while (t + this.dt <= now + 1e-9 && (this.phase === 'rally' || this.phase === 'toss')) {
      t += this.dt;
      const e = stepBall(this.ball, this.dt, this.cfg.physics);
      this.ring.push({ t, ball: cloneBall(this.ball) });
      if (e) this.onPhysEvent(e, t);
    }
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
