// Beach volleyball match: 2 v 2, each side one main player (you, or the CPU) plus an AI setter.
// The main player takes the 1st touch (dig) and the 3rd (attack); the setter always takes the 2nd.
// Same feel as table tennis: timing → quality and direction, swing speed → power, paddle (hand) tilt → depth,
// an upward brush → a soft tip. Rally scoring to 21 (15 in a deciding set), win by 2; the rally winner serves.
// Same public surface as `Game` (update/swing/toss/events/score...) so the display can drive either sport.
import type { Config } from '../config.ts';
import type { GameEvent, GameSettings, LastPoint, MachineSettings, NetOut, Phase, SwingResult } from '../game.ts';
import { type Ball, type Side, cloneBall, other, sideSign } from '../physics.ts';
import type { PointReason } from '../referee.ts';
import { type Rng, createRng } from '../rng.ts';
import { type Score, awardPoint, newScore } from '../rules.ts';
import { type SwingFeatures, type TimingClass, classifyTiming } from '../shot.ts';
import { type V3, clamp, len, v3 } from '../vec.ts';
import { driveTo, flight, isIn, lobTo, stepVolley, untilDescending, type VolleyEvent } from './physics.ts';

export type TouchKind = 'serve' | 'dig' | 'set' | 'spike' | 'tip';

/** The next planned touch: who plays the ball, where, and when (sim time). */
export interface VContact {
  side: Side;
  /** 0 = main player (human or CPU), 1 = the AI setter. */
  who: 0 | 1;
  kind: 'serve' | 'dig' | 'set' | 'attack';
  t: number;
  p: V3;
  from: number;
  done: boolean;
}

export interface VPlayer {
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  /** Last touch played, for animation. */
  action: TouchKind | null;
  actionAt: number;
}

const HAND_Y = 2.1; // m: serve toss release height

export class VolleyGame {
  readonly sport = 'volley' as const;
  readonly cfg: Config;
  readonly settings: GameSettings;
  readonly rng: Rng;
  readonly score: Score;

  phase: Phase = 'serve';
  simTime = 0;
  ball: Ball = { p: v3(), v: v3(), w: v3() };
  ballLive = false;
  /** [side][0 = main, 1 = setter]. */
  teams: [[VPlayer, VPlayer], [VPlayer, VPlayer]];
  contact: VContact | null = null;
  lastPoint: LastPoint | null = null;
  winner: Side | null = null;
  rallyShots = 0;
  rallies: number[] = [];
  /** Side serving this rally (the last rally's winner). */
  serving: Side;
  /** Unused in volleyball; present so the display can treat both sports alike. */
  readonly isPractice = false;
  readonly remoteSide: Side | null = null;
  practice = { streak: 0, best: 0, good: 0, total: 0 };
  netGraceMs = 0;

  private acc = 0;
  private pauseLeft = 0;
  private serveAt = Infinity;
  private ring: Array<{ t: number; ball: Ball }> = [];
  private events: GameEvent[] = [];
  /** Team that touched the ball last, and whether the net stopped it since. */
  private lastTouch: Side | null = null;
  private netBlocked = false;
  /** Sim time each side's main player last jumped (phone accelerometer or J key). */
  private jumpAt: [number, number] = [-Infinity, -Infinity];
  /** Set by the last human attack: it was a standing hit (no jump). */
  private standing = false;

  constructor(settings: GameSettings, cfg: Config) {
    this.cfg = cfg;
    this.settings = settings;
    this.rng = createRng(settings.seed);
    this.score = newScore(settings.bestOf, settings.initialServer ?? 0);
    this.serving = settings.initialServer ?? 0;
    const mk = (s: Side, x: number): VPlayer => {
      const z = sideSign(s) * 5.5;
      return { x, z, targetX: x, targetZ: z, action: null, actionAt: -Infinity };
    };
    this.teams = [
      [mk(0, 1.8), mk(0, -1.8)],
      [mk(1, -1.8), mk(1, 1.8)],
    ];
    this.setTarget();
    this.setupServe();
  }

  private get v(): Config['volley'] {
    return this.cfg.volley;
  }

  get dt(): number {
    return 1 / this.cfg.physics.stepHz;
  }

  get server(): Side {
    return this.serving;
  }

  get machine(): MachineSettings {
    return { speed: 0, spin: 'none', placement: 'middle', intervalMs: 0 };
  }

  /** Points to win the current set: 21, or 15 in a deciding set. */
  private setTarget(): void {
    const s = this.score;
    const deciding = s.bestOf > 1 && s.games[0] + s.games[1] === s.bestOf - 1;
    s.target = deciding ? this.v.decidingSetPoints : this.v.pointsToWin;
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  drainNet(): NetOut[] {
    return [];
  }

  replayPoint(): void {
    if (this.phase !== 'matchOver') this.setupServe();
  }

  // ───────────────────────── Loop ─────────────────────────

  update(realDt: number): void {
    realDt = Math.min(realDt, 0.1);
    if (this.phase === 'pointOver') {
      this.pauseLeft -= realDt;
      if (this.pauseLeft <= 0) {
        if (this.winner !== null) this.phase = 'matchOver';
        else this.setupServe();
      }
    }
    this.acc += realDt * this.v.gameSpeed;
    while (this.acc >= this.dt) {
      this.acc -= this.dt;
      this.stepSim();
    }
  }

  private stepSim(): void {
    this.simTime += this.dt;
    if (this.phase === 'serve') {
      this.ball = { p: this.handPos(this.serving), v: v3(), w: v3() };
      if (this.simTime >= this.serveAt) this.toss(this.serving, true);
    } else if (this.ballLive) {
      const e = stepVolley(this.ball, this.dt, this.v);
      this.record(this.simTime);
      if (e) this.onBallEvent(e);
    }
    this.runAi();
    this.movePlayers(this.dt);
  }

  private record(t: number): void {
    this.ring.push({ t, ball: cloneBall(this.ball) });
    const max = Math.ceil((this.cfg.physics.stepHz * this.cfg.hit.ringBufferMs * this.v.gameSpeed) / 1000) + 2;
    if (this.ring.length > max) this.ring.splice(0, this.ring.length - max);
  }

  private onBallEvent(e: VolleyEvent): void {
    if (e.type === 'net') {
      this.events.push({ type: 'net', kind: e.kind });
      if (e.kind === 'block') this.netBlocked = true;
      return;
    }
    this.events.push({ type: 'bounce', side: e.side, speed: e.speed });
    if (this.phase !== 'toss' && this.phase !== 'rally') return;
    // Landed in: that side failed to keep it up. Out: the last team to touch it hit it out.
    if (e.in) this.endRally(other(e.side), this.netBlocked && this.lastTouch === e.side ? 'net' : 'missed return');
    else this.endRally(this.lastTouch === null ? other(this.serving) : other(this.lastTouch), 'out');
  }

  private endRally(winner: Side, reason: PointReason): void {
    this.contact = null;
    this.ballLive = this.ball.p.y > this.v.ballR + 0.01; // let a ball in the air finish its fall
    if (this.rallyShots > 0) this.rallies.push(this.rallyShots);
    this.lastPoint = { winner, reason };
    this.events.push({ type: 'point', winner, reason });
    const r = awardPoint(this.score, winner);
    if (r.gameOver !== null) this.events.push({ type: 'game', winner: r.gameOver });
    if (r.matchOver !== null) {
      this.events.push({ type: 'match', winner: r.matchOver });
      this.winner = r.matchOver;
    }
    this.serving = winner;
    this.setTarget();
    this.phase = 'pointOver';
    this.pauseLeft = this.cfg.match.pointPauseMs / 1000;
  }

  // ───────────────────────── Serve ─────────────────────────

  private handPos(s: Side): V3 {
    const p = this.teams[s][0];
    return v3(p.x - 0.35 * sideSign(s), HAND_Y, p.z - 0.2 * sideSign(s));
  }

  setupServe(): void {
    const s = this.serving;
    this.phase = 'serve';
    this.ballLive = false;
    this.contact = null;
    this.ring = [];
    this.rallyShots = 0;
    this.lastTouch = null;
    this.netBlocked = false;
    for (const side of [0, 1] as const) {
      const g = sideSign(side);
      const [main, mate] = this.teams[side];
      if (side === s) {
        main.x = main.targetX = 1.2 * g;
        main.z = main.targetZ = g * (this.v.halfL + 0.8);
        mate.targetX = -1.8 * g;
        mate.targetZ = g * 4.2;
      } else {
        main.targetX = 1.8 * g;
        main.targetZ = g * 5.6;
        mate.targetX = -1.8 * g;
        mate.targetZ = g * 5.6;
      }
    }
    this.ball = { p: this.handPos(s), v: v3(), w: v3() };
    this.serveAt = this.settings.controllers[s] === 'cpu' ? this.simTime + (this.v.cpuServeDelayMs / 1000) * this.v.gameSpeed : Infinity;
  }

  /** Toss for the serve. Human: phone tap or Space. */
  toss(side: Side, fromCpu = false): boolean {
    if (this.phase !== 'serve' || side !== this.serving) return false;
    if (!fromCpu && this.settings.controllers[side] !== 'human') return false;
    const from = this.handPos(side);
    const vy = Math.sqrt(2 * this.v.gravity * (this.v.tossApex - from.y));
    // A small toss in front, toward the net: the server steps into it.
    this.ball = { p: from, v: v3(0, vy, -sideSign(side) * 0.8), w: v3() };
    this.ballLive = true;
    this.phase = 'toss';
    this.serveAt = Infinity;
    this.ring = [{ t: this.simTime, ball: cloneBall(this.ball) }];
    const r = untilDescending(this.ball, this.v.serveContact, this.v, this.dt);
    this.contact = { side, who: 0, kind: 'serve', t: this.simTime + r.t, p: r.p, from: this.simTime, done: false };
    this.events.push({ type: 'toss', side });
    return true;
  }

  // ───────────────────────── Human touches ─────────────────────────

  /** Is this player controlled by a person? who 0 = main player, 1 = setter. */
  isHuman(side: Side, who: 0 | 1): boolean {
    return who === 0 ? this.settings.controllers[side] === 'human' : !!this.settings.humanSetter?.[side];
  }

  /** Spikes need a jump (except on Easy assist, where it's automatic). */
  jumpRequired(): boolean {
    return this.settings.assist !== 'easy';
  }

  /** Jumped within the spike window, counting back from now (for the HUD cue). */
  hasJumped(side: Side): boolean {
    return ((this.simTime - this.jumpAt[side]) / this.v.gameSpeed) * 1000 <= this.v.jumpLeadMaxMs;
  }

  /** The main player of `side` jumped `ageReal` seconds ago. */
  jump(side: Side, ageReal: number): void {
    if (!this.isHuman(side, 0)) return;
    this.jumpAt[side] = this.simTime - Math.max(ageReal, 0) * this.v.gameSpeed;
  }

  /** A swing from `side`'s player `who` (0 = main, 1 = human setter), `ageReal` seconds ago (judged at the swing moment). */
  swing(side: Side, ageReal: number, f: SwingFeatures, who: 0 | 1 = 0): SwingResult {
    if (!this.isHuman(side, who)) return { result: 'none' };
    const tSwing = Math.max(this.simTime - Math.max(ageReal, 0) * this.v.gameSpeed, this.ring[0]?.t ?? this.simTime);
    const c = this.contact;
    const main = this.teams[side][who];
    const live = (this.phase === 'toss' || this.phase === 'rally') && c !== null && c.side === side && c.who === who && !c.done;
    if (!live) {
      main.action = 'spike';
      main.actionAt = tSwing;
      this.events.push({ type: 'whiff', side, reason: 'no-ball' });
      return { result: 'none' };
    }
    const windowMs = this.cfg.assist[this.settings.assist].timingWindowMs * this.v.windowScale;
    const offsetMs = ((tSwing - c.t) / this.v.gameSpeed) * 1000;
    const timing = classifyTiming(offsetMs, windowMs, this.cfg);
    if (timing === 'miss') {
      // The touch stays open: a stray early swing shouldn't cost the ball (same as table tennis).
      main.action = c.kind === 'dig' ? 'dig' : c.kind === 'set' ? 'set' : 'spike';
      main.actionAt = tSwing;
      this.events.push({ type: 'whiff', side, offsetMs, reason: 'timing' });
      return { result: 'miss', offsetMs, timing: 'miss' };
    }
    const at = this.ballAt(tSwing);
    this.standing = false;
    const touch =
      c.kind === 'serve'
        ? this.humanServe(side, f, offsetMs, windowMs, timing, at.ball)
        : c.kind === 'dig'
          ? this.humanDig(side, f, timing, at.ball)
          : c.kind === 'set'
            ? this.humanSet(side, offsetMs, windowMs, timing, at.ball)
            : this.humanAttack(side, f, offsetMs, windowMs, timing, at.ball, tSwing);
    this.strike(side, who, touch.kind, touch.ball, at.t, offsetMs, timing);
    const strength = clamp(len(touch.ball.v) / this.v.spikeMax, 0, 1);
    return { result: 'hit', offsetMs, timing, strength };
  }

  private ballAt(t: number): { t: number; ball: Ball } {
    for (let i = this.ring.length - 1; i >= 0; i--) if (this.ring[i]!.t <= t + 1e-9) return this.ring[i]!;
    return this.ring[0] ?? { t: this.simTime, ball: cloneBall(this.ball) };
  }

  /** Swing speed (deg/s) → 0..1, on the same curve as table tennis. */
  private power(f: SwingFeatures): number {
    const c = this.cfg.shot.speedCurve;
    return clamp((f.peak - c.minDegPerSec) / (c.maxDegPerSec - c.minDegPerSec), 0, 1);
  }

  /** Aim point on the opponent's court from timing (lateral) and hand tilt (depth), in the hitter's frame. */
  private aim(side: Side, f: SwingFeatures, offsetMs: number, windowMs: number, contactX: number, near: number, far: number): { x: number; z: number } {
    const sign = sideSign(side);
    const offN = clamp(offsetMs / windowMs, -1, 1);
    const faceN = clamp(f.face / ((this.cfg.shot.faceFullDeg * Math.PI) / 180), -1, 1);
    const contactSide = contactX * sign >= 0 ? 1 : -1;
    // Early → cross-court (away from your side of the court), late → down the line.
    const ownX = clamp(offN * this.v.lateralRange * contactSide + contactSide * 0.6, -this.v.halfW + 0.4, this.v.halfW - 0.4);
    const depth = near + ((faceN + 1) / 2) * (far - near);
    const scatter = 0.25;
    return { x: ownX * sign + this.rng.gauss() * scatter, z: -sign * depth + this.rng.gauss() * scatter };
  }

  private humanServe(side: Side, f: SwingFeatures, offsetMs: number, windowMs: number, timing: TimingClass, at: Ball): { kind: TouchKind; ball: Ball } {
    const v = this.v;
    const speed = v.serveMin + this.power(f) * (v.serveMax - v.serveMin);
    const target = this.aim(side, f, offsetMs, windowMs, at.p.x, 4.5, v.halfL - 0.6);
    const ball = this.drive(side, at.p, target, speed, timing === 'borderline' ? this.pickError() : 'none');
    return { kind: 'serve', ball };
  }

  private humanDig(side: Side, f: SwingFeatures, timing: TimingClass, at: Ball): { kind: TouchKind; ball: Ball } {
    // A chopping (downward) swing is a shank; borderline timing sprays the pass.
    const sloppy = timing === 'borderline' || f.path < -400;
    return { kind: 'dig', ball: this.pass(side, at.p, sloppy ? this.v.passErrorM : 0.25) };
  }

  /** Human setter (same-team two-player): timing places the set along the net, early = toward your left. */
  private humanSet(side: Side, offsetMs: number, windowMs: number, timing: TimingClass, at: Ball): { kind: TouchKind; ball: Ball } {
    const sign = sideSign(side);
    const offN = clamp(offsetMs / windowMs, -1, 1);
    const err = timing === 'borderline' ? this.v.passErrorM * 0.7 : 0;
    const a = this.rng.next() * Math.PI * 2;
    const x = sign * clamp(this.v.attackLane + offN * 1.2, -this.v.halfW + 0.6, this.v.halfW - 0.6) + Math.cos(a) * err;
    const to = v3(x, this.v.attackHeight, sign * (this.v.attackGap + Math.abs(Math.sin(a) * err)));
    return { kind: 'set', ball: { p: { ...at.p }, v: lobTo(at.p, to, this.v.setApex, this.v, this.dt), w: v3() } };
  }

  /** Did `side` jump in time for a swing at `tSwing`? */
  private jumped(side: Side, tSwing: number): boolean {
    const dtMs = ((tSwing - this.jumpAt[side]) / this.v.gameSpeed) * 1000;
    return dtMs <= this.v.jumpLeadMaxMs && dtMs >= -this.v.jumpLagMaxMs;
  }

  private humanAttack(side: Side, f: SwingFeatures, offsetMs: number, windowMs: number, timing: TimingClass, at: Ball, tSwing: number): { kind: TouchKind; ball: Ball } {
    const v = this.v;
    // An upward brush is a soft tip into the space behind the block.
    const tip = f.path > 250;
    // No jump: a standing hit, with power capped (it can't be a smash).
    const standing = !tip && this.jumpRequired() && !this.jumped(side, tSwing);
    this.standing = standing;
    const power = standing ? Math.min(this.power(f), v.standingSpikePower) : this.power(f);
    const speed = tip ? v.tipSpeed : v.spikeMin + power * (v.spikeMax - v.spikeMin);
    const target = tip ? this.aim(side, f, offsetMs, windowMs, at.p.x, 2.2, 4.0) : this.aim(side, f, offsetMs, windowMs, at.p.x, v.depthNear, v.depthFar);
    const ball = tip
      ? { p: { ...at.p }, v: lobTo(at.p, { x: target.x, y: v.ballR, z: target.z }, at.p.y + 1.2, v, this.dt), w: v3() }
      : this.drive(side, at.p, target, speed, timing === 'borderline' ? this.pickError() : 'none');
    return { kind: tip ? 'tip' : 'spike', ball };
  }

  private pickError(): 'net' | 'long' {
    return this.rng.next() < 0.5 ? 'net' : 'long';
  }

  /** Drive toward a target over the net; an injected error sends it into the net or long. */
  private drive(side: Side, from: V3, target: { x: number; z: number }, speed: number, error: 'none' | 'net' | 'long'): Ball {
    const t = error === 'long' ? { x: target.x, z: -sideSign(side) * (this.v.halfL + 1.3) } : target;
    const vel = driveTo(from, t, speed, this.v, this.dt);
    if (error === 'net') vel.y -= 3.5;
    return { p: { ...from }, v: vel, w: v3() };
  }

  /** First touch: pass to the setter's spot near the net (with some spray). */
  private pass(side: Side, from: V3, errM: number): Ball {
    const sign = sideSign(side);
    const a = this.rng.next() * Math.PI * 2;
    const r = errM * (0.4 + 0.6 * this.rng.next());
    const to = v3(Math.cos(a) * r, this.v.setHeight, sign * (this.v.setterGap + Math.abs(Math.sin(a) * r)));
    return { p: { ...from }, v: lobTo(from, to, this.v.passApex, this.v, this.dt), w: v3() };
  }

  // ───────────────────────── Strikes and planning ─────────────────────────

  /** Apply a touch played at sim time `tHit` and re-simulate to now. */
  private strike(side: Side, who: 0 | 1, kind: TouchKind, launched: Ball, tHit: number, offsetMs?: number, timing?: TimingClass): void {
    const player = this.teams[side][who];
    player.action = kind;
    player.actionAt = tHit;
    if (this.contact) this.contact.done = true;
    this.phase = 'rally';
    this.rallyShots++;
    this.lastTouch = side;
    this.netBlocked = false;
    const speed = len(launched.v);
    this.events.push({ type: 'hit', side, speed, strength: clamp(speed / 20, 0, 1), serve: kind === 'serve', offsetMs, timing, touch: kind, who, standing: kind === 'spike' && this.standing });
    this.standing = false;

    this.ball = cloneBall(launched);
    this.ring = this.ring.filter((r) => r.t <= tHit);
    this.ring.push({ t: tHit, ball: cloneBall(this.ball) });
    this.plan(side, kind, tHit);
    let t = tHit;
    while (t + this.dt <= this.simTime + 1e-9 && this.phase === 'rally') {
      t += this.dt;
      const e = stepVolley(this.ball, this.dt, this.v);
      this.record(t);
      if (e) this.onBallEvent(e);
    }
  }

  /** Who plays the ball next, after `side` played a `kind` touch launched at `tHit`. */
  private plan(side: Side, kind: TouchKind, tHit: number): void {
    if (kind === 'dig') this.planOwn(side, 1, 'set', this.v.setHeight, tHit);
    else if (kind === 'set') this.planOwn(side, 0, 'attack', this.v.attackHeight, tHit);
    else this.planReceive(other(side), tHit);
  }

  /** Next touch on the same side (set after a pass, attack after a set), if the ball stays playable. */
  private planOwn(side: Side, who: 0 | 1, kind: 'set' | 'attack', height: number, tHit: number): void {
    const r = untilDescending(this.ball, height, this.v, this.dt);
    const sign = sideSign(side);
    const playable = !r.landed && r.p.z * sign > 0.2 && Math.abs(r.p.x) < this.v.halfW + 2 && Math.abs(r.p.z) < this.v.halfL + 2;
    this.contact = playable ? { side, who, kind, t: tHit + r.t, p: r.p, from: tHit, done: false } : null;
  }

  /** The ball is heading to `side`: their main player digs it on the way down (unless the CPU sees it's out). */
  private planReceive(side: Side, tHit: number): void {
    const r = untilDescending(this.ball, this.v.digHeight, this.v, this.dt);
    const onSide = r.p.z * sideSign(side) > 0;
    if (r.landed || !onSide) {
      this.contact = null;
      return;
    }
    if (this.settings.controllers[side] === 'cpu') {
      const land = flight(this.ball.p, this.ball.v, this.v, this.dt).land;
      if (!isIn(land, this.v)) {
        this.contact = null; // let it go: it's out
        return;
      }
    }
    this.contact = { side, who: 0, kind: 'dig', t: tHit + r.t, p: r.p, from: tHit, done: false };
  }

  // ───────────────────────── AI (setters and the CPU team) ─────────────────────────

  private runAi(): void {
    const c = this.contact;
    if (!c || c.done || (this.phase !== 'toss' && this.phase !== 'rally')) return;
    if (this.simTime + 1e-9 < c.t) return;
    if (this.isHuman(c.side, c.who)) return;
    c.done = true;
    const lvl = this.v.cpu[this.settings.cpuLevel];
    const at = this.ball.p;
    if (c.kind === 'set') {
      const sign = sideSign(c.side);
      const to = v3(sign * this.v.attackLane, this.v.attackHeight, sign * this.v.attackGap);
      this.strike(c.side, 1, 'set', { p: { ...at }, v: lobTo(at, to, this.v.setApex, this.v, this.dt), w: v3() }, this.simTime);
      return;
    }
    if (c.kind === 'dig') {
      const incoming = len(this.ball.v);
      const chance = clamp(lvl.digRate - Math.max(0, incoming - 16) * 0.025, 0.15, 0.97);
      if (this.rng.next() < chance) {
        this.strike(c.side, 0, 'dig', this.pass(c.side, at, (1 - lvl.digRate) * this.v.passErrorM), this.simTime);
      } else {
        // Shank: it pops off the arms somewhere awkward.
        const a = this.rng.next() * Math.PI * 2;
        this.strike(c.side, 0, 'dig', { p: { ...at }, v: v3(Math.cos(a) * 3.5, 3 + this.rng.next() * 3, Math.sin(a) * 3.5), w: v3() }, this.simTime);
      }
      return;
    }
    // CPU serve or attack: a random spot in the other court, with level-based aim error and faults.
    const sign = sideSign(c.side);
    const serve = c.kind === 'serve';
    const depth = serve ? 5 + this.rng.next() * 2.4 : 3 + this.rng.next() * 4.2;
    const target = {
      x: clamp((this.rng.next() * 2 - 1) * (this.v.halfW - 0.8) + this.rng.gauss() * lvl.aimErrorM * 0.5, -this.v.halfW - 0.5, this.v.halfW + 0.5),
      z: -sign * depth + this.rng.gauss() * lvl.aimErrorM * 0.4,
    };
    const speed = serve ? this.v.serveMin + this.rng.next() * (this.v.serveMax - this.v.serveMin) * 0.6 : lvl.attackSpeed * (0.8 + this.rng.next() * 0.35);
    const error = this.rng.next() < lvl.errorRate ? this.pickError() : 'none';
    this.strike(c.side, 0, serve ? 'serve' : 'spike', this.drive(c.side, at, target, speed, error), this.simTime);
  }

  // ───────────────────────── Movement ─────────────────────────

  private movePlayers(dt: number): void {
    const c = this.contact;
    const v = this.v;
    for (const side of [0, 1] as const) {
      const g = sideSign(side);
      const [main, mate] = this.teams[side];
      if (this.phase === 'rally' || this.phase === 'toss') {
        if (c && c.side === side) {
          if (c.who === 0 && c.kind !== 'serve') {
            // Stand just behind the ball so it meets the arms.
            main.targetX = c.p.x;
            main.targetZ = c.p.z + g * (c.kind === 'attack' ? 0.45 : 0.3);
          } else if (c.who === 1) {
            main.targetX = g * v.attackLane;
            main.targetZ = g * 4.2; // approach start
          }
          if (c.who === 1) {
            mate.targetX = c.p.x;
            mate.targetZ = c.p.z + g * 0.3;
          } else if (c.kind === 'dig') {
            mate.targetX = 0;
            mate.targetZ = g * (v.setterGap + 0.4);
          }
        } else if (c && c.side !== side) {
          // Ball going to the other team: back to defence.
          main.targetX = g * 1.8;
          main.targetZ = g * 5.4;
          mate.targetX = -g * 1.8;
          mate.targetZ = g * 5.2;
        }
      }
      for (const [p, speed] of [
        [main, v.humanSpeed],
        [mate, v.mateSpeed],
      ] as const) {
        const step = speed * dt;
        p.x += clamp(p.targetX - p.x, -step, step);
        p.z += clamp(p.targetZ - p.z, -step, step);
      }
    }
  }
}
