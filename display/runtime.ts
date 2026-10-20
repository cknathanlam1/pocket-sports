// Owns the renderer, the world, the input source and the current Game; runs the frame loop.
import * as THREE from 'three';
import { defaultConfig } from '../engine/config.ts';
import { Game, type GameEvent } from '../engine/game.ts';
import type { Side } from '../engine/physics.ts';
import { MouseInput } from './input/MouseInput.ts';
import type { PaddleInput } from './input/PaddleInput.ts';
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
  private renderer: THREE.WebGLRenderer;
  private world = new World();
  private input: PaddleInput;
  game: Game;
  private attract = true;
  private bannerKey = 0;
  private last = performance.now();
  private hudSig = '';

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
    this.input = new MouseInput();
    this.input.onSwing((s) => {
      if (this.attract || store.get().screen !== 'playing') return;
      const r = this.game.swing(0, (performance.now() - s.t) / 1000, s);
      if (r.result !== 'none' && r.offsetMs !== undefined)
        store.set({ timing: { key: ++this.bannerKey, offsetMs: r.offsetMs, timing: r.timing ?? 'miss', hit: r.result === 'hit' } });
    });
    this.input.onTap(() => {
      if (!this.attract && store.get().screen === 'playing') this.game.toss(0);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.attract) return;
      const s = store.get().screen;
      if (s === 'playing') store.set({ screen: 'paused' });
      else if (s === 'paused') this.resume();
    });
    requestAnimationFrame(this.frame);
  }

  private newAttractGame(): Game {
    return new Game({ cpuLevel: 'hard', assist: 'normal', bestOf: 5, controllers: ['cpu', 'cpu'] }, this.cfg);
  }

  startMatch(s: MenuSettings): void {
    store.set({ settings: s, screen: 'playing', banner: null, timing: null, winner: null });
    this.attract = false;
    this.game = new Game({ ...s, controllers: ['human', 'cpu'], initialServer: Math.random() < 0.5 ? 0 : 1 }, this.cfg);
    this.hudSig = '';
  }

  resume(): void {
    this.last = performance.now();
    store.set({ screen: 'playing' });
  }

  quitToMenu(): void {
    this.attract = true;
    this.game = this.newAttractGame();
    store.set({ screen: 'menu', hud: null, banner: null, timing: null });
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
    this.world.sync(this.game, this.attract ? null : this.input.orientation(), dt);
    this.renderer.render(this.world.scene, this.world.camera);
    if (!this.attract) this.publishHud();
    requestAnimationFrame(this.frame);
  };

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
