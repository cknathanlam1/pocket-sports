// Owns the renderer, the world, the input sources and the current Game; runs the frame loop.
import * as THREE from 'three';
import { defaultConfig } from '../engine/config.ts';
import { Game, type GameEvent } from '../engine/game.ts';
import type { Side } from '../engine/physics.ts';
import type { UiState } from '../shared/protocol.ts';
import { MouseInput } from './input/MouseInput.ts';
import type { PaddleInput, Swing } from './input/PaddleInput.ts';
import { PhoneHost } from './net/PhoneHost.ts';
import { World } from './scene/World.ts';
import { type Banner, type MenuSettings, store } from './store.ts';

const REASON: Record<string, string> = {
  out: 'Out',
  net: 'Into the net',
  'double bounce': 'Double bounce',
  'missed return': 'Missed return',
};

export class Runtime {
  readonly cfg = structuredClone(defaultConfig);
  readonly host = new PhoneHost();
  private renderer: THREE.WebGLRenderer;
  private world = new World();
  private mouse = new MouseInput();
  game: Game;
  private attract = true;
  private bannerKey = 0;
  private last = performance.now();
  private hudSig = '';
  private sentUi: UiState | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      this.renderer.setSize(w, h, false);
      this.world.resize(w, h);
    };
    new ResizeObserver(resize).observe(canvas);
    resize();

    this.game = this.newAttractGame();

    // Both input sources stay live: the mouse is the dev/fallback swing source while phone swings land in M3.
    for (const input of [this.mouse, this.host.input] as PaddleInput[]) {
      input.onSwing((s) => this.onSwing(s));
      input.onTap(() => this.onTap(input === this.host.input));
    }

    this.host.onStatus((s) => {
      store.set({ phone: s });
      if (s.transport === 'none') this.sentUi = null; // resend state when it comes back
      // Phone dropped mid-match → auto-pause with a reconnect QR.
      if (store.get().usingPhone && s.phone !== 'calibrated' && store.get().screen === 'playing') store.set({ screen: 'paused', pauseReason: 'phone' });
    });

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.attract) return;
      const s = store.get().screen;
      if (s === 'playing') store.set({ screen: 'paused', pauseReason: 'user' });
      else if (s === 'paused') this.resume();
    });
    requestAnimationFrame(this.frame);
  }

  private get phoneReady(): boolean {
    return this.host.status.phone === 'calibrated';
  }

  private onSwing(s: Swing): void {
    if (this.attract || store.get().screen !== 'playing') return;
    const r = this.game.swing(0, (performance.now() - s.t) / 1000, s);
    if (r.result !== 'none' && r.offsetMs !== undefined)
      store.set({ timing: { key: ++this.bannerKey, offsetMs: r.offsetMs, timing: r.timing ?? 'miss', hit: r.result === 'hit' } });
  }

  /** Space or phone tap: toss in a match; from the phone it also starts / resumes / replays. */
  private onTap(fromPhone: boolean): void {
    const { screen, settings, pauseReason } = store.get();
    if (screen === 'playing') this.game.toss(0);
    else if (!fromPhone) return;
    else if (screen === 'menu' && this.phoneReady) this.startMatch(settings);
    else if (screen === 'paused' && this.phoneReady && pauseReason === 'phone') this.resume();
    else if (screen === 'matchOver' && this.phoneReady) this.startMatch(settings);
  }

  private newAttractGame(): Game {
    return new Game({ cpuLevel: 'hard', assist: 'normal', bestOf: 5, controllers: ['cpu', 'cpu'] }, this.cfg);
  }

  startMatch(s: MenuSettings): void {
    store.set({ settings: s, screen: 'playing', banner: null, timing: null, winner: null, usingPhone: this.phoneReady, pauseReason: null });
    this.attract = false;
    this.game = new Game({ ...s, controllers: ['human', 'cpu'], initialServer: Math.random() < 0.5 ? 0 : 1 }, this.cfg);
    this.hudSig = '';
  }

  resume(): void {
    this.last = performance.now();
    store.set({ screen: 'playing', pauseReason: null, usingPhone: store.get().usingPhone || this.phoneReady });
  }

  quitToMenu(): void {
    this.attract = true;
    this.game = this.newAttractGame();
    store.set({ screen: 'menu', hud: null, banner: null, timing: null, usingPhone: false, pauseReason: null });
  }

  private frame = (now: number): void => {
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const screen = store.get().screen;
    if (screen !== 'paused') {
      this.game.update(dt);
      const events = this.game.drainEvents();
      if (!this.attract) this.handleEvents(events);
      else if (this.game.phase === 'matchOver') this.game = this.newAttractGame();
    }
    // The near paddle mirrors the phone whenever one is calibrated (even on the menu, as live feedback).
    const q = this.phoneReady ? this.host.input.orientation() : this.attract ? null : this.mouse.orientation();
    this.world.sync(this.game, q, dt);
    this.renderer.render(this.world.scene, this.world.camera);
    if (!this.attract) this.publishHud();
    this.publishUiState();
    requestAnimationFrame(this.frame);
  };

  /** Tell the phone what to show (serve / rally / between / paused / lobby). */
  private publishUiState(): void {
    if (this.host.status.transport === 'none') return;
    const screen = store.get().screen;
    const g = this.game;
    const s: UiState =
      screen === 'menu' || screen === 'matchOver' || this.attract
        ? 'lobby'
        : screen === 'paused'
          ? 'paused'
          : g.phase === 'serve' && g.server === 0
            ? 'serve'
            : g.phase === 'toss' || g.phase === 'rally'
              ? 'rally'
              : 'between';
    if (s === this.sentUi) return;
    this.sentUi = s;
    this.host.send({ k: 'st', s });
  }

  private banner(b: Omit<Banner, 'key'>): void {
    store.set({ banner: { ...b, key: ++this.bannerKey } });
  }

  private handleEvents(events: GameEvent[]): void {
    const who = (s: Side) => (s === 0 ? 'You' : 'CPU');
    for (const e of events) {
      if (e.type === 'point') this.banner({ text: e.winner === 0 ? 'Your point' : 'CPU point', sub: REASON[e.reason], tone: e.winner === 0 ? 'good' : 'bad' });
      else if (e.type === 'let') this.banner({ text: 'Let', sub: 'Replay the serve', tone: 'neutral' });
      else if (e.type === 'game') this.banner({ text: `Game: ${who(e.winner)}`, tone: e.winner === 0 ? 'good' : 'bad' });
      else if (e.type === 'match') store.set({ winner: e.winner });
      else if (e.type === 'hit' && e.side === 0) this.host.send({ k: 'hit', strength: e.strength });
    }
    if (this.game.phase === 'matchOver' && store.get().screen === 'playing') store.set({ screen: 'matchOver' });
  }

  private publishHud(): void {
    const g = this.game;
    const hud = { points: [...g.score.points] as [number, number], games: [...g.score.games] as [number, number], server: g.server, phase: g.phase, history: g.score.history.map((h) => [...h] as [number, number]) };
    const sig = JSON.stringify(hud);
    if (sig !== this.hudSig) {
      this.hudSig = sig;
      store.set({ hud });
    }
  }
}
