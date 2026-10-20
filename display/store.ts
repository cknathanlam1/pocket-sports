// Tiny external store bridging the game loop and React overlays (useSyncExternalStore).
import { useSyncExternalStore } from 'react';
import type { Assist, CpuLevel } from '../engine/config.ts';
import type { MachineSettings, Phase, PracticeResult } from '../engine/game.ts';
import type { Side } from '../engine/physics.ts';
import type { BestOf } from '../engine/rules.ts';
import type { TimingClass } from '../engine/shot.ts';
import { type Look, P1_LOOK } from '../shared/art/Char.tsx';
import type { HitTier } from '../shared/protocol.ts';
import type { PhoneStatus } from './net/PhoneHost.ts';

/** Laptop screens, named after the design ids (design/SPEC.md). */
export type Screen = 'title' | 'pairing' | 'calibrate' | 'tutorial' | 'menu' | 'customize' | 'setup' | 'playing' | 'paused' | 'matchOver';

export interface MenuSettings {
  cpuLevel: CpuLevel;
  assist: Assist;
  bestOf: BestOf;
}

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
  pauseReason: 'user' | 'phone' | null;
  settingsOpen: boolean;
  devOpen: boolean;
  toast: { key: number; text: string; icon: string; tone: 'info' | 'ok' | 'warn' } | null;
  /** 'practice' = ball machine on the far side, no score. */
  mode: 'match' | 'practice';
  machine: MachineSettings;
  practice: { streak: number; best: number; good: number; total: number; last: { key: number; result: PracticeResult } | null };
  audio: { volume: number; muted: boolean };
  tutorialDone: boolean;
}

const SETTINGS_KEY = 'pocket-sports.settings';
const LOOK_KEY = 'pocket-sports.look';
const MACHINE_KEY = 'pocket-sports.machine';
const AUDIO_KEY = 'pocket-sports.audio';
const TUTORIAL_KEY = 'pocket-sports.tutorialDone';

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
  settings: load<MenuSettings>(SETTINGS_KEY, { cpuLevel: 'normal', assist: 'normal', bestOf: 3 }),
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
  machine: load<MachineSettings>(MACHINE_KEY, { speed: 6, spin: 'none', placement: 'middle', intervalMs: 900 }),
  practice: { streak: 0, best: 0, good: 0, total: 0, last: null },
  audio: load(AUDIO_KEY, { volume: 0.8, muted: false }),
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
