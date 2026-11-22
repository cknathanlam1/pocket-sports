// Owns the renderer, the world, the input sources and the current Game; runs the frame loop and
// the screen flow (pairing → calibrate → menu → setup → match → results).
import * as THREE from 'three';
import { Game, type GameEvent, type GameSettings, type MachineSettings } from '../engine/game.ts';
import { VolleyGame } from '../engine/volley/game.ts';
import { applyNet, encodeNet, mirrorScore } from '../engine/net.ts';
import { HALF_W, type Side, other } from '../engine/physics.ts';
import type { PointReason } from '../engine/referee.ts';
import { type BestOf, type Score, gamesToWin } from '../engine/rules.ts';
import type { HitTier, MenuMirror, Quat, UiState, VersusMsg } from '../shared/protocol.ts';
import { sfx } from './audio/Sfx.ts';
import { loadConfig } from './devConfig.ts';
import { MouseInput } from './input/MouseInput.ts';
import type { PaddleInput, Swing } from './input/PaddleInput.ts';
import { PhoneHost } from './net/PhoneHost.ts';
import { VersusLink, type VsStatus } from './net/VersusLink.ts';
import { VolleyWorld } from './scene/VolleyWorld.ts';
import { World } from './scene/World.ts';
import { MARLO_LOOK } from '../shared/art/Char.tsx';
import { type Banner, MARLO, type MenuSettings, type Screen, type Sport, emptyStats, store } from './store.ts';

/** Either sport's match: both expose the same update/swing/toss/score/event surface. */
type AnyGame = Game | VolleyGame;

/** Local two-player: the second player's name and look. */
const P2 = { name: 'Player 2', look: MARLO_LOOK };

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
  /** Second phone (local two-player), created when "2 players" is picked. */
  host2: PhoneHost | null = null;
  private renderer: THREE.WebGLRenderer;
  private tt = new World();
  private volleyWorld: VolleyWorld | null = null;
  private size = { w: 1, h: 1 };
  private mouse = new MouseInput();
  game: AnyGame;
  private sentUi2 = '';
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
  /** Showed the "jump to spike" tip this match. */
  private jumpHinted = false;
  /** The ball already hit the deck this point (one floor sound per point). */
  private floorPlayed = false;
  private prevPhase = '';
  /** Online match link (lobby + match). */
  vs: VersusLink | null = null;
  private vsSig = '';
  /** Opponent's paddle orientation (their frame) and when it arrived. */
  private farQ: Quat | null = null;
  private farQAt = 0;
  private lastPq = 0;
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
      this.size = { w, h };
      this.tt.resize(w, h);
      this.volleyWorld?.resize(w, h);
    };
    new ResizeObserver(resize).observe(canvas);
    resize();

    this.game = this.newAttractGame();
    this.applyLooks();
    store.subscribe(() => {
      if (store.get().settings.players === 2) this.ensureHost2();
      this.applyLooks();
      this.introduce();
      const a = store.get().audio;
      sfx.setVolume(a.volume, a.muted, a.music);
      this.syncMusic();
    });
    const a0 = store.get().audio;
    sfx.setVolume(a0.volume, a0.muted, a0.music);
    this.syncMusic();

    // Both input sources stay live: the mouse is the dev/fallback swing source while phone swings land in M3.
    for (const input of [this.mouse, this.host.input] as PaddleInput[]) {
      input.onSwing((s) => this.onSwing(s));
      input.onTap(() => this.onTap(input === this.host.input));
      input.onJump((t) => this.onJump(t, 0));
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
      else if (act.a === 'rematch' && screen === 'matchOver') this.rematch();
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
    if (s.phone === 'calibrated' && (screen === 'pairing' || screen === 'calibrate' || screen === 'title')) this.go(this.vs ? 'lobby' : store.get().tutorialDone ? 'menu' : 'tutorial');
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

  /** Soundtrack follows the screen: menus → menu, match (and practice) → match, results → win or lose. */
  private syncMusic(): void {
    const { screen, winner } = store.get();
    const inGame = screen === 'playing' || screen === 'paused';
    sfx.playMusic(inGame ? 'match' : screen === 'matchOver' ? (winner === 0 ? 'win' : 'lose') : 'menu');
    sfx.muffleMusic(screen === 'paused');
    if (!inGame) sfx.musicIntensity(false);
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

  /**
   * Which side and role a player's phone controls: player 1 = side 0's main player. Player 2 = side 1's
   * main player (two players facing each other) or side 0's setter (same team); otherwise nothing.
   */
  private slot(player: 0 | 1): { side: Side; who: 0 | 1 } | null {
    if (player === 0) return { side: 0, who: 0 };
    if (store.get().local2p) return { side: 1, who: 0 };
    if (store.get().coop) return { side: 0, who: 1 };
    return null;
  }

  private onSwing(s: Swing, player: 0 | 1 = 0): void {
    const screen = store.get().screen;
    const slot = this.slot(player);
    if (!slot) return;
    if (screen === 'playing' || screen === 'tutorial') sfx.swing(s.peak);
    if (this.swingTap && player === 0) return this.swingTap(s);
    if (this.attract || store.get().screen !== 'playing') return;
    const age = (performance.now() - s.t) / 1000;
    const r = this.game instanceof VolleyGame ? this.game.swing(slot.side, age, s, slot.who) : this.game.swing(slot.side, age, s);
    this.flushNet();
    if (r.result !== 'none' && r.offsetMs !== undefined)
      store.set({ timing: { key: ++this.key, offsetMs: r.offsetMs, timing: r.timing ?? 'miss', hit: r.result === 'hit' } });
  }

  /** Volleyball: a jump (phone accelerometer or J) lets the next spike be a full-power smash. */
  private onJump(t: number, player: 0 | 1): void {
    const slot = this.slot(player);
    if (!slot || slot.who !== 0 || store.get().screen !== 'playing' || !(this.game instanceof VolleyGame)) return;
    this.game.jump(slot.side, (performance.now() - t) / 1000);
  }

  /** Space or phone tap: toss in a match. From the phone a tap also drives the menus. */
  private onTap(fromPhone: boolean, player: 0 | 1 = 0): void {
    const { screen, settings } = store.get();
    if (player === 1) {
      // Player 2 serves only when facing player 1 (on the same team, player 1 serves).
      if (screen === 'playing' && store.get().local2p) this.game.toss(1);
      return;
    }
    if (screen === 'playing') {
      this.game.toss(0);
      this.flushNet();
      return;
    }
    if (!fromPhone || !this.phoneReady) return;
    if (screen === 'lobby' && this.vs?.status.role === 'host' && this.vs.connected) this.hostStartVersus(store.get().settings.bestOf);
    else if (screen === 'menu') this.go('setup');
    else if (screen === 'setup' && this.canStart(settings)) this.startMatch(settings);
    else if (screen === 'matchOver') this.rematch();
    else if (screen === 'paused') this.resume();
  }

  private get sport(): Sport {
    return store.get().sport;
  }

  /** The 3D venue for the current game's sport (the volleyball beach is built on first use). */
  private get world(): World | VolleyWorld {
    return this.game instanceof VolleyGame ? this.vworld : this.tt;
  }

  private get vworld(): VolleyWorld {
    if (!this.volleyWorld) {
      const v = this.cfg.volley;
      this.volleyWorld = new VolleyWorld(v.ballR, v.halfL, v.halfW, v.netHeight, v.netHalfW);
      this.volleyWorld.resize(this.size.w, this.size.h);
    }
    return this.volleyWorld;
  }

  private newAttractGame(): AnyGame {
    const s = { cpuLevel: 'hard', assist: 'normal', controllers: ['cpu', 'cpu'] } satisfies Omit<GameSettings, 'bestOf'>;
    return this.sport === 'volley' ? new VolleyGame({ ...s, bestOf: 3 }, this.cfg) : new Game({ ...s, bestOf: 5 }, this.cfg);
  }

  /** Pick the sport (menu SPORTS card). The menu's background match switches with it. */
  setSport(sport: Sport): void {
    if (sport === this.sport) return;
    this.sportBefore = null;
    store.set({ sport });
    if (this.attract) {
      this.game = this.newAttractGame();
      this.world.setView('behind');
      this.applyLooks();
    }
  }

  /** Practice and online play are table tennis only: switch for them, and switch back afterwards. */
  private sportBefore: Sport | null = null;

  private useTableTennis(): void {
    if (this.sport === 'tt') return;
    const before = this.sport;
    this.setSport('tt');
    this.sportBefore = before;
  }

  private restoreSport(): void {
    const s = this.sportBefore;
    if (s) this.setSport(s);
  }

  /** Second phone for local two-player: its own room and QR code, its swings drive side 1. */
  ensureHost2(): PhoneHost {
    if (this.host2) return this.host2;
    const h = new PhoneHost('pocket-sports.room2');
    this.host2 = h;
    h.input.onSwing((s) => this.onSwing(s, 1));
    h.input.onTap(() => this.onTap(true, 1));
    h.input.onJump((t) => this.onJump(t, 1));
    h.input.onPause(() => {
      if (!store.get().local2p) return;
      const sc = store.get().screen;
      if (sc === 'playing') this.pause('user');
      else if (sc === 'paused') this.resume();
    });
    h.onStatus((st) => {
      const prev = store.get().phone2;
      store.set({ phone2: st });
      if (prev?.transport === 'none' && st.transport !== 'none') sfx.connect();
      if (prev && prev.transport !== 'none' && st.transport === 'none') sfx.disconnect();
      if (st.transport === 'none') this.sentUi2 = '';
      if ((store.get().local2p || store.get().coop) && store.get().screen === 'playing' && st.phone !== 'calibrated') this.pause('phone');
    });
    return h;
  }

  private get phone2Ready(): boolean {
    return this.host2?.status.phone === 'calibrated';
  }

  private applyLooks(): void {
    this.world.setLooks(this.attract ? { ...store.get().look, outfit: '#2F6FDB' } : store.get().look, store.get().opponent.look);
  }

  /** Two players need player 2's phone calibrated first. */
  canStart(s: MenuSettings): boolean {
    return s.players !== 2 || this.phone2Ready;
  }

  startMatch(s: MenuSettings): void {
    if (!this.canStart(s)) return;
    if (this.vs) this.closeVersus();
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
    // Two players: facing each other, or (volleyball) on the same team with player 2 as the setter.
    const coop = s.players === 2 && s.teamPlay && this.sport === 'volley';
    const local2p = s.players === 2 && !coop;
    const settings = { ...s, controllers: ['human', local2p ? 'human' : 'cpu'] as const, initialServer: (Math.random() < 0.5 ? 0 : 1) as Side };
    this.game =
      this.sport === 'volley'
        ? new VolleyGame({ ...settings, controllers: [...settings.controllers], humanSetter: coop ? [true, false] : undefined }, this.cfg)
        : new Game({ ...settings, controllers: [...settings.controllers] }, this.cfg);
    this.hudSig = '';
    this.oohDone = false;
    this.jumpHinted = false;
    store.set({ mode: 'match', local2p, coop, cue: null, opponent: local2p ? P2 : MARLO });
    this.world.setView(local2p ? 'side' : 'behind');
    this.world.setPractice(false);
    this.applyLooks();
  }

  /** Practice: ball machine on the far side, live-adjustable, no score. */
  startPractice(): void {
    if (this.vs) this.closeVersus();
    this.useTableTennis();
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

  pause(reason: 'user' | 'phone' | 'remote' | 'opponent'): void {
    if (store.get().screen !== 'playing') return;
    sfx.pause();
    store.set({ screen: 'paused', pauseReason: reason });
    // Online: pause both laptops (unless the other side is the one that paused or dropped).
    if (this.isVersus && (reason === 'user' || reason === 'phone')) this.vs?.send({ k: 'vpz', on: true, why: reason });
  }

  /** fromRemote: the opponent resumed. Online, the rally in progress is replayed from the serve on both laptops. */
  resume(fromRemote = false): void {
    if (store.get().screen !== 'paused') return;
    if ((store.get().local2p || store.get().coop) && !(this.phoneReady && this.phone2Ready) && store.get().pauseReason === 'phone') return;
    if (this.isVersus) {
      if (!this.vs?.connected) return; // can't resume without the opponent
      if (!fromRemote) this.vs.send({ k: 'vpz', on: false });
      this.game.replayPoint();
    }
    this.last = performance.now();
    sfx.resume();
    store.set({ screen: 'playing', pauseReason: null, usingPhone: store.get().usingPhone || this.phoneReady });
  }

  quitToMenu(): void {
    if (this.isVersus) return this.leaveVersusMatch();
    store.set({ local2p: false, coop: false, cue: null, opponent: MARLO });
    this.tt.setView('behind');
    this.volleyWorld?.setView('behind');
    if (this.game.isPractice) this.restoreSport();
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
    if (this.isVersus) this.versusFrame(now, q);
    const q2 = this.phone2Ready ? this.host2!.input.orientation() : null;
    const farQ = store.get().local2p ? q2 : this.farQ && now - this.farQAt < 500 ? this.farQ : null;
    if (this.game instanceof VolleyGame) {
      this.vworld.sync(this.game, q, dt, farQ, store.get().coop ? q2 : null);
      this.updateCue(this.game);
    }
    else this.tt.sync(this.game, q, dt, farQ);
    if (!Runtime.OPAQUE.has(screen)) {
      this.renderer.render(this.world.scene, this.world.camera);
      this.adaptResolution(dt);
    }
    if (sfx.ready) sfx.startAmbience();
    const g = this.game;
    sfx.duckMusic(!this.attract && g.ballLive && (g.phase === 'toss' || g.phase === 'rally'));
    if (!this.attract && !g.isPractice && g.phase !== this.prevPhase && g.phase === 'serve' && g.server === 0 && screen === 'playing') sfx.yourServe();
    this.prevPhase = g.phase;
    if (!this.attract) this.publishHud();
    this.publishUiState();
    this.publishUiState2();
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

  /** Volleyball HUD cue for a human attack: "Jump!" in the run-up, then "Spike!" at the moment to swing. */
  private updateCue(g: VolleyGame): void {
    const c = g.contact;
    let cue: string | null = null;
    if (store.get().screen === 'playing' && c && !c.done && c.kind === 'attack' && g.isHuman(c.side, c.who)) {
      const msLeft = ((c.t - g.simTime) / this.cfg.volley.gameSpeed) * 1000;
      const who = store.get().local2p ? `P${c.side + 1}: ` : '';
      if (g.jumpRequired() && msLeft > 160 && msLeft < 750 && !g.hasJumped(c.side)) cue = `${who}Jump!${store.get().usingPhone ? '' : ' (J)'}`;
      else if (msLeft <= 160 && msLeft > -120) cue = `${who}Spike!`;
    }
    if (cue !== store.get().cue) store.set({ cue });
  }

  /** "You"/the opponent, or Player 1/Player 2 in local two-player. */
  private sideName(side: Side): string {
    if (store.get().local2p) return side === 0 ? 'Player 1' : 'Player 2';
    return side === 0 ? 'You' : this.opName;
  }

  /** Local two-player: player 2's phone sees the match from side 1. */
  private publishUiState2(): void {
    const h = this.host2;
    if (!h || h.status.transport === 'none') return;
    const screen = store.get().screen;
    const g = this.game;
    const { local2p, coop } = store.get();
    const me: Side = coop ? 0 : 1;
    const inMatch = !this.attract && (local2p || coop) && (screen === 'playing' || screen === 'paused');
    const s: UiState = !inMatch ? 'lobby' : screen === 'paused' ? 'paused' : g.phase === 'serve' && g.server === me && !coop ? 'serve' : g.phase === 'toss' || g.phase === 'rally' ? 'rally' : 'between';
    const pt: 'won' | 'lost' | undefined = s === 'between' && g.lastPoint?.winner != null ? (g.lastPoint.winner === me ? 'won' : 'lost') : undefined;
    const sc: [number, number] | undefined = inMatch ? [g.score.points[me], g.score.points[other(me)]] : undefined;
    const msg = { k: 'st' as const, s, sc, pt, nx: g.server === me, op: coop ? this.opName : 'Player 1' };
    const sig = JSON.stringify(msg);
    if (sig === this.sentUi2) return;
    this.sentUi2 = sig;
    h.send(msg);
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
    const msg = { k: 'st' as const, s, sc, pt: s === 'between' ? this.lastPoint : undefined, nx: g.server === 0, menu, op: this.opName };
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
      if (e.type === 'hit') {
        this.floorPlayed = false;
        this.onHit(e);
      } else if (e.type === 'toss') {
        this.floorPlayed = false;
        sfx.toss(pan);
      } else if (e.type === 'floor') {
        // The ball keeps bouncing on the deck; one sound (with its own little rebounds) is enough.
        if (!this.floorPlayed) sfx.floor(pan);
        this.floorPlayed = true;
      }
      else if (e.type === 'bounce') {
        if (this.game instanceof VolleyGame) sfx.sand(e.speed, pan);
        else sfx.bounce(e.speed, pan);
        this.world.bounceRing(this.game.ball.p.x, this.game.ball.p.z);
      } else if (e.type === 'net') sfx.net(e.kind, pan);
      else if (e.type === 'practice') this.onPractice(e);
      else if (e.type === 'point' && !this.game.isPractice) this.onPoint(e.winner, e.reason);
      else if (e.type === 'let') {
        this.lastPoint = 'let';
        this.banner({ kind: 'let', icon: '↺', text: 'Let', sub: 'Replay the serve' });
      } else if (e.type === 'game' && this.game.winner === null) {
        const [a, b] = this.game.score.history.at(-1) ?? [0, 0];
        const unit = this.game instanceof VolleyGame ? 'Set' : 'Game';
        const mine = e.winner === 0 || store.get().local2p;
        this.banner({ kind: 'game', icon: mine ? '✓' : '✕', text: store.get().local2p ? `${unit}: ${this.sideName(e.winner)}` : e.winner === 0 ? `${unit}!` : `${unit}: ${this.opName}`, sub: `${a}–${b}` });
        if (e.winner === 0) sfx.gameWon();
        else sfx.gameLost();
      } else if (e.type === 'match') {
        store.set({ winner: e.winner });
        if (e.winner === 0) sfx.win();
        else sfx.lose();
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
    else if (e.touch) sfx.volleyHit(e.touch, kmh, pan);
    else sfx.hit(kmh, pan);
    // Volleyball rallies count every touch, so the crowd waits longer before the "ooh".
    if (!this.oohDone && this.game.rallyShots >= (e.touch ? 13 : 8) && !this.game.isPractice) {
      this.oohDone = true;
      sfx.ooh();
    }
    this.lastHitKmh[e.side] = kmh;
    const stats = store.get().stats;
    const st = [...stats] as typeof stats;
    st[e.side] = { ...st[e.side], fastest: Math.max(st[e.side].fastest, kmh) };
    store.set({ stats: st });
    // Feedback goes to whoever hit it: you, or player 2 in local two-player. The AI setter's sets get none.
    const coopSet = store.get().coop && e.side === 0 && e.who === 1;
    const hitter = coopSet ? this.host2 : e.side === 0 ? this.host : store.get().local2p ? this.host2 : null;
    if (!hitter || (e.touch === 'set' && !coopSet)) return;
    if (e.standing && !this.jumpHinted) {
      this.jumpHinted = true;
      store.toast(store.get().usingPhone ? 'Jump as you swing for a full-power spike!' : 'Press J just before you swing to jump and spike', '↑', 'warn');
    }
    // Digs and tips are always 'nice'; a standing spike (no jump) can't be a SMASH.
    const raw = e.touch === 'dig' || e.touch === 'tip' ? 'nice' : hitTier(kmh, e.offsetMs);
    const tier = e.standing && raw === 'smash' ? 'great' : raw;
    const fx = TIER_FX[tier];
    this.world.spark(b.x, b.y, b.z, tier !== 'nice');
    // Hit-stop freezes our sim; online that would put this laptop behind the other one, so skip it.
    if (!this.isVersus) this.freezeUntil = performance.now() + fx.stopMs;
    if (fx.shake) this.world.shake(fx.shake, fx.hits);
    store.set({ hitFx: { key: ++this.key, tier, kmh } });
    hitter.send({ k: 'hit', strength: e.strength, tier, kmh, rally: this.game.rallyShots });
  }

  private onPoint(winner: Side, reason: PointReason): void {
    const g = this.game;
    const local2p = store.get().local2p;
    // Local two-player: both players are "you", so every point is celebrated.
    const won = winner === 0 || local2p;
    this.lastPoint = winner === 0 ? 'won' : 'lost';
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
    const t = g.score.target ?? 11;
    const deuce = a >= t - 1 && b >= t - 1 && a === b;
    const mp = this.matchPointSide();
    store.set({ matchPoint: mp });

    if (won && (rally >= 8 || kmh >= 55)) store.set({ celebrate: { key: ++this.key, line: `${rally}-hit rally · ${kmh} km/h winner` } });
    // Match point or deuce: the match music gets busier until the pressure is off.
    sfx.musicIntensity(mp !== null || (a >= t - 1 && b >= t - 1));
    if (deuce) sfx.deuce();
    else if (mp !== null) sfx.matchPoint();
    if (deuce) this.banner({ kind: 'deuce', icon: '=', text: 'Deuce', sub: 'Win two points in a row' });
    else if (mp !== null && local2p) this.banner({ kind: 'matchpoint', icon: '★', text: `Match point: ${this.sideName(mp)}`, sub: 'One point to win it all' });
    else if (mp !== null) this.banner({ kind: 'matchpoint', icon: '★', text: mp === 0 ? 'Match point' : `Match point: ${this.opName}`, sub: mp === 0 ? 'One point to win it all' : 'Hang in there' });
    else if (local2p) this.banner({ kind: 'won', icon: '✓', text: `Point: ${this.sideName(winner)}`, sub: reason === 'missed return' || reason === 'double bounce' ? `Winner · ${kmh} km/h` : `${this.sideName(other(winner))}: ${LOST_REASON[reason].toLowerCase()}` });
    else if (won) this.banner({ kind: 'won', icon: '✓', text: 'Point!', sub: reason === 'missed return' || reason === 'double bounce' ? `Winner · ${kmh} km/h` : `${this.opName}: ${LOST_REASON[reason].toLowerCase()}` });
    else this.banner({ kind: 'lost', icon: '✕', text: 'Missed it', sub: LOST_REASON[reason] });
  }

  // ───────────────────────── Online match ─────────────────────────

  get isVersus(): boolean {
    return !this.attract && this.game.remoteSide !== null;
  }

  private get opName(): string {
    return store.get().opponent.name;
  }

  /** Host (no code) or join (code) an online match and open the lobby. */
  openVersus(code?: string): void {
    this.useTableTennis();
    this.vs?.close();
    const vs = new VersusLink(code ? 'guest' : 'host', code);
    this.vs = vs;
    this.vsSig = '';
    this.introduce();
    vs.onStatus((s) => this.onVsStatus(s));
    vs.onMessage((m) => this.onVsMsg(m));
    if (this.isVersus) this.toAttract();
    this.go('lobby');
  }

  /** Leave the lobby entirely (back to the menu, CPU opponent again). */
  closeVersus(): void {
    const vs = this.vs;
    this.vs = null;
    vs?.close();
    if (this.isVersus) this.toAttract();
    store.set({ vs: null, opponent: MARLO });
    this.restoreSport();
    this.applyLooks();
  }

  /** Results screen: same settings again (online, only the host can restart). */
  rematch(): void {
    if (this.isVersus) this.hostStartVersus(store.get().settings.bestOf);
    else this.startMatch(store.get().settings);
  }

  /** Host: start (or restart) the match for both laptops. */
  hostStartVersus(bestOf: BestOf): void {
    const vs = this.vs;
    if (!vs || vs.status.role !== 'host' || !vs.connected) return;
    const sv: Side = Math.random() < 0.5 ? 0 : 1;
    vs.send({ k: 'vgo', bestOf, sv: other(sv) });
    this.startVersus(bestOf, sv, true);
  }

  private startVersus(bestOf: BestOf, sv: Side, authority: boolean, score?: Score): void {
    const settings = { ...store.get().settings, bestOf };
    store.set({
      settings,
      screen: 'playing',
      mode: 'versus',
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
    // Each player's own assist level applies to their own swings (judged on their laptop).
    this.game = new Game({ ...settings, controllers: ['human', 'remote'], initialServer: sv, net: { authority } }, this.cfg);
    if (score) this.restoreScore(score);
    this.hudSig = '';
    this.oohDone = false;
    this.world.setPractice(false);
    this.applyLooks();
  }

  private restoreScore(s: Score): void {
    const sc = this.game.score;
    sc.initialServer = s.initialServer;
    sc.points = [...s.points];
    sc.games = [...s.games];
    sc.history = s.history.map((h) => [...h] as [number, number]);
    this.game.setupServe();
  }

  /** Back to the lobby from a match (tells the opponent). */
  leaveVersusMatch(): void {
    if (this.isVersus) this.vs?.send({ k: 'vbye' });
    this.toAttract();
    this.go(this.vs ? 'lobby' : 'menu');
  }

  private toAttract(): void {
    this.attract = true;
    this.game = this.newAttractGame();
    store.set({ mode: 'match', hud: null, banner: null, timing: null, hitFx: null, celebrate: null, usingPhone: false, pauseReason: null, matchPoint: null });
    this.applyLooks();
  }

  /** Tell the opponent our name, look and whether we have a phone (only when it changes). */
  private introduce(): void {
    if (!this.vs) return;
    const { name, look } = store.get();
    const me = { name, look, phone: this.phoneReady };
    const sig = JSON.stringify(me);
    if (sig === this.vsSig) return;
    this.vsSig = sig;
    this.vs.introduce(me);
  }

  private onVsStatus(s: VsStatus): void {
    const prev = store.get().vs;
    store.set({ vs: s, opponent: s.opponent ? { name: s.opponent.name, look: s.opponent.look } : MARLO });
    if (prev?.transport === 'none' && s.transport !== 'none') sfx.connect();
    if (prev && prev.transport !== 'none' && s.transport === 'none') sfx.disconnect();
    if (!this.isVersus) return;
    const screen = store.get().screen;
    if (s.transport === 'none' && screen === 'playing') this.pause('opponent');
    // Back after a drop: the host re-sends the match with the current score (the guest may have reloaded
    // into the lobby) and both replay the rally from the serve. The guest waits for that message.
    if (s.transport !== 'none' && screen === 'paused' && store.get().pauseReason === 'opponent' && s.role === 'host') {
      const g = this.game;
      this.vs?.send({ k: 'vgo', bestOf: g.score.bestOf, sv: other(g.score.initialServer), score: mirrorScore(g.score) });
      this.resume(true);
    }
  }

  private onVsMsg(m: VersusMsg): void {
    if (m.k === 'vgo') {
      if (this.vs?.status.role !== 'guest') return;
      // Rejoin of a match in progress: same game, continue from the host's score.
      if (m.score && this.isVersus && store.get().screen === 'paused') {
        this.restoreScore(m.score);
        this.resume(true);
      } else this.startVersus(m.bestOf, m.sv, false, m.score);
      return;
    }
    if (m.k === 'vpq') {
      this.farQ = m.q;
      this.farQAt = performance.now();
      return;
    }
    if (m.k === 'vbye') {
      if (this.isVersus) {
        store.toast(`${this.opName} left the match`, '!', 'warn');
        this.leaveVersusMatch();
      }
      return;
    }
    if (!this.isVersus) return;
    if (m.k === 'vpz') {
      if (m.on) this.pause('remote');
      else this.resume(true);
      return;
    }
    if (m.k === 'vt' || m.k === 'vh' || m.k === 'vv') {
      // game.simTime is as of the last frame; the message arrived since, so it is that much less old.
      const sinceFrame = performance.now() - this.last;
      const before = this.game.ball.p;
      const bx = before.x;
      const by = before.y;
      const bz = before.z;
      if (!(this.game instanceof Game)) return;
      const ok = applyNet(m, this.game, Math.max(0, (this.vs?.oneWayMs ?? 40) - sinceFrame));
      // The opponent's hit lands a one-way delay late, so the ball jumps forward along its new path.
      // Ease the drawn ball from where it was instead of snapping.
      if (ok && m.k === 'vh') {
        const p = this.game.ball.p;
        this.world.nudgeBall(bx - p.x, by - p.y, bz - p.z);
      }
    }
  }

  /** Per frame, online: latency-dependent grace, send queued events and our paddle orientation. */
  private versusFrame(now: number, q: Quat | null): void {
    const vs = this.vs;
    if (!vs) return;
    // Hold a ruling long enough for the opponent's hit to cross the network: RTT plus their phone's delay.
    this.game.netGraceMs = (vs.status.rtt ?? 160) + 150;
    if (this.game instanceof Game) this.game.netWindowBonusMs = Math.min(this.cfg.net.windowBonusMaxMs, vs.oneWayMs * this.cfg.net.windowBonusScale);
    this.flushNet();
    if (q && now - this.lastPq > 33) {
      this.lastPq = now;
      vs.send({ k: 'vpq', q });
    }
  }

  /** Send the game's outgoing events right away (also called straight after a swing or toss). */
  private flushNet(): void {
    if (!this.vs || !this.isVersus || !(this.game instanceof Game)) return;
    for (const o of this.game.drainNet()) this.vs.send(encodeNet(o, this.game));
  }

  /** The side one point from winning the match, if any. */
  private matchPointSide(): Side | null {
    const s = this.game.score;
    if (this.game.winner !== null) return null;
    for (const side of [0, 1] as const) {
      const me = s.points[side];
      const them = s.points[other(side)];
      if (me >= (s.target ?? 11) - 1 && me - them >= 1 && s.games[side] === gamesToWin(s) - 1) return side;
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
