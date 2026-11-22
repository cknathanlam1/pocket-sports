// Tiny external store bridging the game loop and React overlays (useSyncExternalStore).
import { useSyncExternalStore } from 'react';
import type { Assist, CpuLevel } from '../engine/config.ts';
import type { MachineSettings, Phase, PracticeResult } from '../engine/game.ts';
import type { Side } from '../engine/physics.ts';
import type { BestOf } from '../engine/rules.ts';
import type { TimingClass } from '../engine/shot.ts';
import { type Look, MARLO_LOOK, P1_LOOK } from '../shared/art/Char.tsx';
import type { HitTier } from '../shared/protocol.ts';
import type { PhoneStatus } from './net/PhoneHost.ts';
import type { VsStatus } from './net/VersusLink.ts';

/** Laptop screens, named after the design ids (design/SPEC.md). */
export type Screen = 'title' | 'pairing' | 'calibrate' | 'tutorial' | 'menu' | 'customize' | 'setup' | 'lobby' | 'playing' | 'paused' | 'matchOver';

export interface MenuSettings {
  cpuLevel: CpuLevel;
  assist: Assist;
  bestOf: BestOf;
  /** 1 = you vs the CPU; 2 = two phones on this laptop (local two-player). */
  players: 1 | 2;
  /** Volleyball with two players: on the same team (player 2 sets) instead of facing each other. */
  teamPlay: boolean;
}

export type Sport = 'tt' | 'volley';

export type BannerKind = 'won' | 'lost' | 'deuce' | 'matchpoint' | 'let' | 'game';

export interface Banner {
  key: number;
  kind: BannerKind;
  text: string;
  icon: string;
  sub?: string;
}

export interface Hud {
  points: [number, number];
  games: [number, number];
  server: Side;
  phase: Phase;
  history: Array<[number, number]>;
  rally: number;
  game: number;
}

export interface SideStats {
  longest: number;
  fastest: number; // km/h
  winners: number;
  errors: number;
}

export interface UiState {
  screen: Screen;
  settings: MenuSettings;
  look: Look;
  hud: Hud | null;
  banner: Banner | null;
  timing: { key: number; offsetMs: number; timing: TimingClass; hit: boolean } | null;
  /** Hit-tier word + burst (7c/7d). */
  hitFx: { key: number; tier: HitTier; kmh: number } | null;
  /** Big POINT! celebration (7e). */
  celebrate: { key: number; line: string } | null;
  matchPoint: Side | null;
  winner: Side | null;
  stats: [SideStats, SideStats];
  phone: PhoneStatus;
  /** The current match is controlled by the phone (pause if it drops). */
  usingPhone: boolean;
  /** user: you paused. phone: your phone dropped. remote: your opponent paused. opponent: their laptop dropped. */
  pauseReason: 'user' | 'phone' | 'remote' | 'opponent' | null;
  settingsOpen: boolean;
  devOpen: boolean;
  toast: { key: number; text: string; icon: string; tone: 'info' | 'ok' | 'warn' } | null;
  /** 'practice' = ball machine on the far side, no score. 'versus' = online match against another laptop. */
  mode: 'match' | 'practice' | 'versus';
  /** Online match link (lobby + match), null when not in one. */
  vs: VsStatus | null;
  /** Who's on the far side: Marlo (CPU) or your online opponent. */
  opponent: { name: string; look: Look };
  /** Your display name for online matches. */
  name: string;
  /** Selected sport (menu SPORTS card). */
  sport: Sport;
  /** Second phone on this laptop (local two-player), once one is set up. */
  phone2: PhoneStatus | null;
  /** The current match is two players on this laptop facing each other (side camera, names P1/P2). */
  local2p: boolean;
  /** Volleyball, two players on the same team: player 2's phone is the setter. */
  coop: boolean;
  /** Big timing cue in the HUD ("Jump!", "Spike!"), or null. */
  cue: string | null;
  machine: MachineSettings;
  practice: { streak: number; best: number; good: number; total: number; last: { key: number; result: PracticeResult } | null };
  /** volume = effects, music = soundtrack (0–1). */
  audio: { volume: number; muted: boolean; music: number };
  tutorialDone: boolean;
}

const SETTINGS_KEY = 'pocket-sports.settings';
const LOOK_KEY = 'pocket-sports.look';
const MACHINE_KEY = 'pocket-sports.machine';
const AUDIO_KEY = 'pocket-sports.audio';
const TUTORIAL_KEY = 'pocket-sports.tutorialDone';
const NAME_KEY = 'pocket-sports.name';
const SPORT_KEY = 'pocket-sports.sport';

export const MARLO = { name: 'Marlo', look: MARLO_LOOK };

function load<T>(key: string, d: T): T {
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<T>) };
  } catch {
    return d;
  }
}

function save(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

export const emptyStats = (): SideStats => ({ longest: 0, fastest: 0, winners: 0, errors: 0 });

let state: UiState = {
  screen: 'title',
  settings: load<MenuSettings>(SETTINGS_KEY, { cpuLevel: 'normal', assist: 'normal', bestOf: 3, players: 1, teamPlay: false }),
  look: load<Look>(LOOK_KEY, P1_LOOK),
  hud: null,
  banner: null,
  timing: null,
  hitFx: null,
  celebrate: null,
  matchPoint: null,
  winner: null,
  stats: [emptyStats(), emptyStats()],
  phone: { serverUp: false, code: null, url: null, transport: 'none', phone: 'none', rtt: null },
  usingPhone: false,
  pauseReason: null,
  settingsOpen: false,
  devOpen: false,
  toast: null,
  mode: 'match',
  vs: null,
  opponent: MARLO,
  name: load<{ name: string }>(NAME_KEY, { name: 'Player' }).name,
  sport: load<{ sport: Sport }>(SPORT_KEY, { sport: 'tt' }).sport,
  phone2: null,
  local2p: false,
  coop: false,
  cue: null,
  machine: load<MachineSettings>(MACHINE_KEY, { speed: 6, spin: 'none', placement: 'middle', intervalMs: 900 }),
  practice: { streak: 0, best: 0, good: 0, total: 0, last: null },
  audio: load(AUDIO_KEY, { volume: 0.8, muted: false, music: 0.5 }),
  tutorialDone: load<{ done: boolean }>(TUTORIAL_KEY, { done: false }).done,
};
const listeners = new Set<() => void>();
let toastKey = 0;

export const store = {
  get: () => state,
  set(patch: Partial<UiState>): void {
    state = { ...state, ...patch };
    if (patch.settings) save(SETTINGS_KEY, patch.settings);
    if (patch.look) save(LOOK_KEY, patch.look);
    if (patch.machine) save(MACHINE_KEY, patch.machine);
    if (patch.audio) save(AUDIO_KEY, patch.audio);
    if (patch.tutorialDone !== undefined) save(TUTORIAL_KEY, { done: patch.tutorialDone });
    if (patch.name !== undefined) save(NAME_KEY, { name: patch.name });
    if (patch.sport !== undefined) save(SPORT_KEY, { sport: patch.sport });
    for (const l of listeners) l();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  toast(text: string, icon = 'i', tone: 'info' | 'ok' | 'warn' = 'info'): void {
    store.set({ toast: { key: ++toastKey, text, icon, tone } });
  },
};

export const useUi = (): UiState => useSyncExternalStore(store.subscribe, store.get);
