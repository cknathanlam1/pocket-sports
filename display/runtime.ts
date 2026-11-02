// Owns the renderer, the world, the input sources and the current Game; runs the frame loop and
// the screen flow (pairing → calibrate → menu → setup → match → results).
import * as THREE from 'three';
import { Game, type GameEvent, type MachineSettings } from '../engine/game.ts';
import { HALF_W, type Side, other } from '../engine/physics.ts';
import type { PointReason } from '../engine/referee.ts';
import { gamesToWin } from '../engine/rules.ts';
import { MARLO_LOOK } from '../shared/art/Char.tsx';
import type { HitTier, MenuMirror, UiState } from '../shared/protocol.ts';
import { sfx } from './audio/Sfx.ts';
import { loadConfig } from './devConfig.ts';
import { MouseInput } from './input/MouseInput.ts';
import type { PaddleInput, Swing } from './input/PaddleInput.ts';
import { PhoneHost } from './net/PhoneHost.ts';
import { World } from './scene/World.ts';
import { type Banner, type MenuSettings, type Screen, emptyStats, store } from './store.ts';

const LOST_REASON: Record<PointReason, string> = {
  out: 'Just out',
  net: 'Into the net',
  'double bounce': 'Double bounce',
  'missed return': 'Missed return',
};

/** Hit tier from ball speed and timing (design 7d). */
export function hitTier(kmh: number, offsetMs: number | undefined): HitTier {
  if (kmh >= 55 || (offsetMs !== undefined && Math.abs(offsetMs) < 20)) return 'smash';
  if (kmh >= 35) return 'great';
  return 'nice';
}

const TIER_FX: Record<HitTier, { stopMs: number; shake: number; hits: number }> = {
  nice: { stopMs: 0, shake: 0, hits: 0 },
  great: { stopMs: 40, shake: 0.012, hits: 2 },
  smash: { stopMs: 80, shake: 0.035, hits: 4 },
};

export class Runtime {
  /** Live tuning values (defaults + dev-panel overrides). Games read this object directly. */
  readonly cfg = loadConfig();
  readonly host = new PhoneHost();
  private renderer: THREE.WebGLRenderer;
  private world = new World();
  private mouse = new MouseInput();
  game: Game;
  private attract = true;
  private key = 0;
  private last = performance.now();
  private freezeUntil = 0;
  private hudSig = '';
  private sentUi = '';
  private lastPoint: 'won' | 'lost' | 'let' | undefined;
  private lastHitKmh: [number, number] = [0, 0];
  private calibrateTimer: ReturnType<typeof setTimeout> | undefined;
  private oohDone = false;
  private weakWarned = false;
  /** Tutorial screen listens to swings instead of the game. */
  private swingTap: ((s: Swing) => void) | null = null;
  /** Adaptive resolution: current pixel ratio and a frame-time window. */
  private pixelRatio = 1;
  private perfFrames = 0;
  private perfMs = 0;
  /** Screens with an opaque backdrop: the 3D scene is hidden, so skip rendering it. */
  private static readonly OPAQUE = new Set(['setup', 'customize', 'calibrate', 'tutorial']);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(devicePixelRatio, this.cfg.render.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      this.renderer.setSize(w, h, false);
      this.world.resize(w, h);
    };
    new ResizeObserver(resize).observe(canvas);
    resize();

    this.game = this.newAttractGame();
    this.applyLooks();
    store.subscribe(() => {
      this.applyLooks();
      const a = store.get().audio;
      sfx.setVolume(a.volume, a.muted);
    });
    sfx.setVolume(store.get().audio.volume, store.get().audio.muted);

    // Both input sources stay live: the mouse is the dev/fallback swing source while phone swings land in M3.
    for (const input of [this.mouse, this.host.input] as PaddleInput[]) {
      input.onSwing((s) => this.onSwing(s));
      input.onTap(() => this.onTap(input === this.host.input));
    }
    this.host.input.onPause(() => {
      const s = store.get().screen;
      if (s === 'playing') this.pause('user');
      else if (s === 'paused') this.resume();
    });

    this.host.input.onAction((act) => {
      const { screen, settings } = store.get();
      if (act.a === 'set') {
        if (screen === 'setup' || screen === 'menu') store.set({ settings: { ...settings, [act.key]: act.v } });
      } else if (act.a === 'play' && screen === 'menu') this.go('setup');
      else if (act.a === 'back' && screen === 'setup') this.go('menu');
      else if (act.a === 'start' && screen === 'setup') this.startMatch(settings);
      else if (act.a === 'rematch' && screen === 'matchOver') this.startMatch(settings);
      else if (act.a === 'menu' && screen === 'matchOver') this.quitToMenu();
      else if (act.a === 'practice' && screen === 'menu') this.startPractice();
    });

    this.host.onStatus((s) => this.onPhoneStatus(s));

    window.addEventListener('keydown', (e) => {
      if (e.key === '`') store.set({ devOpen: !store.get().devOpen });
      if (e.key !== 'Escape' || this.attract) return;
      const s = store.get().screen;
      if (s === 'playing') this.pause('user');
      else if (s === 'paused') this.resume();
    });
    requestAnimationFrame(this.frame);
  }

  private get phoneReady(): boolean {
    return this.host.status.phone === 'calibrated';
  }

  private onPhoneStatus(s: typeof this.host.status): void {
    const prev = store.get().phone;
    store.set({ phone: s });
    const screen = store.get().screen;
    if (s.transport === 'none') this.sentUi = ''; // resend state when it comes back
    else if (prev.transport === 'none') this.pushSwingConfig();

    // Pairing flow: connected → (show ✓ briefly) → calibrate → menu.
    if (s.phone === 'connected' && screen === 'pairing') {
      clearTimeout(this.calibrateTimer);
      this.calibrateTimer = setTimeout(() => {
        if (store.get().screen === 'pairing' && this.host.status.phone === 'connected') this.go('calibrate');
      }, 1400);
    }
    if (s.phone === 'calibrated' && (screen === 'pairing' || screen === 'calibrate' || screen === 'title')) this.go(store.get().tutorialDone ? 'menu' : 'tutorial');
    // Our room expired (or another tab took it) and a fresh code replaced it: the phone must rescan.
    if (prev.code && s.code && prev.code !== s.code) store.toast(`Room expired: new code ${s.code}. Rescan on your phone.`, '!', 'warn');
    if (prev.transport === 'none' && s.transport !== 'none') sfx.connect();
    if (prev.transport !== 'none' && s.transport === 'none') sfx.disconnect();
    if (store.get().usingPhone && s.rtt !== null && s.rtt > 150 && !this.weakWarned) {
      this.weakWarned = true;
      store.toast('Weak connection — move closer to Wi‑Fi', '!', 'warn');
    }
    if (prev.phone !== 'none' && s.phone === 'none' && !store.get().usingPhone) store.toast('Phone disconnected', '!', 'warn');
    // Phone dropped mid-match → auto-pause with the reconnect card (2r).
    if (store.get().usingPhone && s.phone !== 'calibrated' && store.get().screen === 'playing') this.pause('phone');
  }

  /** Send the swing-detector tuning to the phone (it runs detection locally). */
  pushSwingConfig(): void {
    this.host.send({ k: 'cfg', swing: { ...this.cfg.swing } });
  }

  go(screen: Screen): void {
    store.set({ screen, settingsOpen: false });
  }

  /** Route swings to a listener (tutorial) instead of the game. Returns an unsubscribe. */
  tapSwings(cb: (s: Swing) => void): () => void {
    this.swingTap = cb;
    return () => {
      if (this.swingTap === cb) this.swingTap = null;
    };
  }

  /** Live paddle face angle in degrees (+ = open), from the phone if calibrated, else the mouse. */
  liveFaceDeg(): number {
    if (this.phoneReady) {
      const q = this.host.input.orientation();
      const [x, y, z, w] = q;
      return (-Math.asin(Math.max(-1, Math.min(1, 2 * (y * z - w * x)))) * 180) / Math.PI;
    }
    return (this.mouse.face() * 180) / Math.PI;
  }

  private onSwing(s: Swing): void {
    if (this.swingTap) return this.swingTap(s);
    if (this.attract || store.get().screen !== 'playing') return;
    const r = this.game.swing(0, (performance.now() - s.t) / 1000, s);
    if (r.result !== 'none' && r.offsetMs !== undefined)
      store.set({ timing: { key: ++this.key, offsetMs: r.offsetMs, timing: r.timing ?? 'miss', hit: r.result === 'hit' } });
  }

  /** Space or phone tap: toss in a match. From the phone a tap also drives the menus. */
  private onTap(fromPhone: boolean): void {
    const { screen, settings } = store.get();
    if (screen === 'playing') {
      this.game.toss(0);
      return;
    }
    if (!fromPhone || !this.phoneReady) return;
    if (screen === 'menu') this.go('setup');
    else if (screen === 'setup' || screen === 'matchOver') this.startMatch(settings);
    else if (screen === 'paused') this.resume();
  }

  private newAttractGame(): Game {
    return new Game({ cpuLevel: 'hard', assist: 'normal', bestOf: 5, controllers: ['cpu', 'cpu'] }, this.cfg);
  }

  private applyLooks(): void {
    this.world.setLooks(this.attract ? { ...store.get().look, outfit: '#2F6FDB' } : store.get().look, MARLO_LOOK);
  }

  startMatch(s: MenuSettings): void {
    store.set({
      settings: s,
      screen: 'playing',
      banner: null,
      timing: null,
      hitFx: null,
      celebrate: null,
      winner: null,
      matchPoint: null,
      stats: [emptyStats(), emptyStats()],
      usingPhone: this.phoneReady,
      pauseReason: null,
      settingsOpen: false,
    });
    this.attract = false;
    this.lastPoint = undefined;
    this.game = new Game({ ...s, controllers: ['human', 'cpu'], initialServer: Math.random() < 0.5 ? 0 : 1 }, this.cfg);
    this.hudSig = '';
    this.oohDone = false;
    store.set({ mode: 'match' });
    this.world.setPractice(false);
    this.applyLooks();
  }

  /** Practice: ball machine on the far side, live-adjustable, no score. */
  startPractice(): void {
    const { settings, machine } = store.get();
    store.set({
      screen: 'playing',
      mode: 'practice',
      banner: null,
      timing: null,
      hitFx: null,
      celebrate: null,
      matchPoint: null,
      usingPhone: this.phoneReady,
      pauseReason: null,
      settingsOpen: false,
      practice: { streak: 0, best: 0, good: 0, total: 0, last: null },
    });
    this.attract = false;
    this.game = new Game({ ...settings, controllers: ['human', 'machine'], mode: 'practice', machine: { ...machine } }, this.cfg);
    this.hudSig = '';
    this.world.setPractice(true);
    this.applyLooks();
  }

  /** Change ball-machine settings (applies to the next feed). */
  setMachine(patch: Partial<MachineSettings>): void {
    const machine = { ...store.get().machine, ...patch };
    store.set({ machine });
    if (this.game.isPractice) Object.assign(this.game.machine, machine);
  }

  pause(reason: 'user' | 'phone'): void {
    if (store.get().screen !== 'playing') return;
    store.set({ screen: 'paused', pauseReason: reason });
  }

  resume(): void {
    this.last = performance.now();
    store.set({ screen: 'playing', pauseReason: null, usingPhone: store.get().usingPhone || this.phoneReady });
  }

  quitToMenu(): void {
    this.attract = true;
    this.game = this.newAttractGame();
    store.set({ screen: 'menu', mode: 'match', hud: null, banner: null, timing: null, hitFx: null, celebrate: null, usingPhone: false, pauseReason: null, matchPoint: null });
    this.world.setPractice(false);
    this.applyLooks();
  }

  /** Live paddle orientation for the calibration mirror (raw before calibration, relative after). */
  phonePose(): { q: [number, number, number, number] | null; calibrated: boolean } {
    const inp = this.host.input;
    return inp.calibrated ? { q: inp.orientation(), calibrated: true } : { q: inp.raw, calibrated: false };
  }

  private frame = (now: number): void => {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const screen = store.get().screen;
    if (screen !== 'paused' && now >= this.freezeUntil) {
      this.game.update(dt);
      const events = this.game.drainEvents();
      if (!this.attract) this.handleEvents(events);
      else if (this.game.phase === 'matchOver') this.game = this.newAttractGame();
    }
    // The near paddle mirrors the phone whenever one is calibrated (even on the menu, as live feedback).
    const q = this.phoneReady ? this.host.input.orientation() : this.attract ? null : this.mouse.orientation();
    this.world.sync(this.game, q, dt);
    if (!Runtime.OPAQUE.has(screen)) {
      this.renderer.render(this.world.scene, this.world.camera);
      this.adaptResolution(dt);
    }
    if (sfx.ready) sfx.startAmbience();
    if (!this.attract) this.publishHud();
    this.publishUiState();
    requestAnimationFrame(this.frame);
  };

  /** Every ~2 s of rendered frames: drop resolution while frames are slow (see render.* in config). */
  private adaptResolution(dt: number): void {
    if (dt >= 0.1) return; // a stall (tab switch, GC, alert), not steady-state cost
    this.perfFrames++;
    this.perfMs += dt * 1000;
    if (this.perfMs < 2000) return;
    const avg = this.perfMs / this.perfFrames;
    this.perfFrames = 0;
    this.perfMs = 0;
    const r = this.cfg.render;
    if (avg <= r.slowFrameMs) return;
    const next = Math.max(r.minPixelRatio, this.pixelRatio - 0.25);
    if (next >= this.pixelRatio) return;
    this.pixelRatio = next;
    this.renderer.setPixelRatio(next);
    const c = this.renderer.domElement;
    this.renderer.setSize(c.clientWidth, c.clientHeight, false);
  }

  /** Tell the phone what to show (serve / rally / between / paused / lobby) plus score context. */
  private publishUiState(): void {
    if (this.host.status.transport === 'none') return;
    const screen = store.get().screen;
    const g = this.game;
    const s: UiState =
      this.attract || !['playing', 'paused'].includes(screen)
        ? 'lobby'
        : screen === 'paused'
          ? 'paused'
          : g.phase === 'serve' && g.server === 0
            ? 'serve'
            : g.phase === 'toss' || g.phase === 'rally'
              ? 'rally'
              : 'between';
    const sc: [number, number] | undefined = this.attract ? undefined : [g.score.points[0], g.score.points[1]];
    const ui = store.get();
    const menu: MenuMirror | undefined =
      s === 'lobby'
        ? {
            screen: screen === 'menu' ? 'menu' : screen === 'setup' ? 'setup' : screen === 'matchOver' ? 'results' : 'other',
            cpuLevel: ui.settings.cpuLevel,
            assist: ui.settings.assist,
            bestOf: ui.settings.bestOf,
            ...(screen === 'matchOver' && ui.hud ? { won: ui.winner === 0, games: ui.hud.games } : {}),
          }
        : undefined;
    const msg = { k: 'st' as const, s, sc, pt: s === 'between' ? this.lastPoint : undefined, nx: g.server === 0, menu };
    const sig = JSON.stringify(msg);
    if (sig === this.sentUi) return;
    this.sentUi = sig;
    this.host.send(msg);
  }

  private banner(b: Omit<Banner, 'key'>): void {
    store.set({ banner: { ...b, key: ++this.key } });
  }

  private handleEvents(events: GameEvent[]): void {
    for (const e of events) {
      const pan = Math.max(-1, Math.min(1, this.game.ball.p.x / HALF_W));
      if (e.type === 'hit') this.onHit(e);
      else if (e.type === 'bounce') {
        sfx.bounce(e.speed, pan);
        this.world.bounceRing(this.game.ball.p.x, this.game.ball.p.z);
      } else if (e.type === 'net') sfx.net(e.kind, pan);
      else if (e.type === 'practice') this.onPractice(e);
      else if (e.type === 'point' && !this.game.isPractice) this.onPoint(e.winner, e.reason);
      else if (e.type === 'let') {
        this.lastPoint = 'let';
        this.banner({ kind: 'let', icon: '↺', text: 'Let', sub: 'Replay the serve' });
      } else if (e.type === 'game' && this.game.winner === null) {
        const [a, b] = this.game.score.history.at(-1) ?? [0, 0];
        this.banner({ kind: 'game', icon: e.winner === 0 ? '✓' : '✕', text: e.winner === 0 ? 'Game!' : 'Game: Marlo', sub: `${a}–${b}` });
      } else if (e.type === 'match') {
        store.set({ winner: e.winner });
        if (e.winner === 0) sfx.win();
        else sfx.pointLost();
      }
    }
    if (this.game.phase === 'matchOver' && store.get().screen === 'playing') {
      const stats = store.get().stats;
      const longest = Math.max(0, ...this.game.rallies);
      store.set({ screen: 'matchOver', matchPoint: null, stats: [{ ...stats[0], longest }, { ...stats[1], longest }] });
    }
  }

  private onPractice(e: Extract<GameEvent, { type: 'practice' }>): void {
    const g = this.game.practice;
    store.set({ practice: { ...g, last: { key: ++this.key, result: e.result } } });
    if (e.result === 'good') {
      sfx.uiSelect();
      if (e.streak > 0 && e.streak % 10 === 0) sfx.clap(1.2);
    }
  }

  private onHit(e: Extract<GameEvent, { type: 'hit' }>): void {
    const kmh = Math.round(e.speed * 3.6);
    const b = this.game.ball.p;
    const pan = Math.max(-1, Math.min(1, b.x / HALF_W));
    if (this.game.isPractice && e.side === 1) sfx.machine();
    else sfx.hit(kmh, pan);
    if (!this.oohDone && this.game.rallyShots >= 8 && !this.game.isPractice) {
      this.oohDone = true;
      sfx.ooh();
    }
    this.lastHitKmh[e.side] = kmh;
    const stats = store.get().stats;
    const st = [...stats] as typeof stats;
    st[e.side] = { ...st[e.side], fastest: Math.max(st[e.side].fastest, kmh) };
    store.set({ stats: st });
    if (e.side !== 0) return;
    const tier = hitTier(kmh, e.offsetMs);
    const fx = TIER_FX[tier];
    this.world.spark(b.x, b.y, b.z, tier !== 'nice');
    this.freezeUntil = performance.now() + fx.stopMs;
    if (fx.shake) this.world.shake(fx.shake, fx.hits);
    store.set({ hitFx: { key: ++this.key, tier, kmh } });
    this.host.send({ k: 'hit', strength: e.strength, tier, kmh, rally: this.game.rallyShots });
  }

  private onPoint(winner: Side, reason: PointReason): void {
    const g = this.game;
    const won = winner === 0;
    this.lastPoint = won ? 'won' : 'lost';
    this.oohDone = false;
    this.world.pose(winner, 'cheer');
    this.world.pose(other(winner), 'sad');
    if (won) sfx.clap(1);
    else sfx.pointLost();
    // Winners = the opponent failed to return; errors = the hitter put it out / into the net.
    const st = [...store.get().stats] as ReturnType<typeof store.get>['stats'];
    if (reason === 'missed return' || reason === 'double bounce') st[winner] = { ...st[winner], winners: st[winner].winners + 1 };
    else st[other(winner)] = { ...st[other(winner)], errors: st[other(winner)].errors + 1 };
    store.set({ stats: st });

    const rally = g.rallies.at(-1) ?? 0;
    const kmh = this.lastHitKmh[winner];
    const [a, b] = g.score.points;
    const deuce = a >= 10 && b >= 10 && a === b;
    const mp = this.matchPointSide();
    store.set({ matchPoint: mp });

    if (won && (rally >= 8 || kmh >= 55)) store.set({ celebrate: { key: ++this.key, line: `${rally}-hit rally · ${kmh} km/h winner` } });
    if (deuce) sfx.deuce();
    else if (mp !== null) sfx.matchPoint();
    if (deuce) this.banner({ kind: 'deuce', icon: '=', text: 'Deuce', sub: 'Win two points in a row' });
    else if (mp !== null) this.banner({ kind: 'matchpoint', icon: '★', text: mp === 0 ? 'Match point' : 'Match point: Marlo', sub: mp === 0 ? 'One point to win it all' : 'Hang in there' });
    else if (won) this.banner({ kind: 'won', icon: '✓', text: 'Point!', sub: reason === 'missed return' || reason === 'double bounce' ? `Winner · ${kmh} km/h` : `Marlo: ${LOST_REASON[reason].toLowerCase()}` });
    else this.banner({ kind: 'lost', icon: '✕', text: 'Missed it', sub: LOST_REASON[reason] });
  }

  /** The side one point from winning the match, if any. */
  private matchPointSide(): Side | null {
    const s = this.game.score;
    if (this.game.winner !== null) return null;
    for (const side of [0, 1] as const) {
      const me = s.points[side];
      const them = s.points[other(side)];
      if (me >= 10 && me - them >= 1 && s.games[side] === gamesToWin(s) - 1) return side;
    }
    return null;
  }

  private publishHud(): void {
    const g = this.game;
    const hud = {
      points: [...g.score.points] as [number, number],
      games: [...g.score.games] as [number, number],
      server: g.server,
      phase: g.phase,
      history: g.score.history.map((h) => [...h] as [number, number]),
      rally: g.rallyShots,
      game: g.score.games[0] + g.score.games[1] + 1,
    };
    const sig = JSON.stringify(hud);
    if (sig !== this.hudSig) {
      this.hudSig = sig;
      store.set({ hud });
    }
  }
}
