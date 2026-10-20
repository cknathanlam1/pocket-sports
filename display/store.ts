// Tiny external store bridging the game loop and React overlays (useSyncExternalStore).
import { useSyncExternalStore } from 'react';
import type { Assist, CpuLevel } from '../engine/config.ts';
import type { Phase } from '../engine/game.ts';
import type { Side } from '../engine/physics.ts';
import type { BestOf } from '../engine/rules.ts';
import type { TimingClass } from '../engine/shot.ts';
import { type Look, P1_LOOK } from '../shared/art/Char.tsx';
import type { HitTier } from '../shared/protocol.ts';
import type { PhoneStatus } from './net/PhoneHost.ts';

/** Laptop screens, named after the design ids (design/SPEC.md). */
export type Screen = 'title' | 'pairing' | 'calibrate' | 'menu' | 'customize' | 'setup' | 'playing' | 'paused' | 'matchOver';

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
  toast: { key: number; text: string; icon: string; tone: 'info' | 'ok' | 'warn' } | null;
}

const SETTINGS_KEY = 'pocket-sports.settings';
const LOOK_KEY = 'pocket-sports.look';

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
  toast: null,
};
const listeners = new Set<() => void>();
let toastKey = 0;

export const store = {
  get: () => state,
  set(patch: Partial<UiState>): void {
    state = { ...state, ...patch };
    if (patch.settings) save(SETTINGS_KEY, patch.settings);
    if (patch.look) save(LOOK_KEY, patch.look);
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
