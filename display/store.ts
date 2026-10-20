// Tiny external store bridging the game loop and React overlays (useSyncExternalStore).
import { useSyncExternalStore } from 'react';
import type { Assist, CpuLevel } from '../engine/config.ts';
import type { Phase } from '../engine/game.ts';
import type { Side } from '../engine/physics.ts';
import type { BestOf } from '../engine/rules.ts';
import type { TimingClass } from '../engine/shot.ts';

export type Screen = 'menu' | 'playing' | 'paused' | 'matchOver';

export interface MenuSettings {
  cpuLevel: CpuLevel;
  assist: Assist;
  bestOf: BestOf;
}

export interface Banner {
  key: number;
  text: string;
  sub?: string;
  tone: 'good' | 'bad' | 'neutral';
}

export interface Hud {
  points: [number, number];
  games: [number, number];
  server: Side;
  phase: Phase;
  history: Array<[number, number]>;
}

export interface UiState {
  screen: Screen;
  settings: MenuSettings;
  hud: Hud | null;
  banner: Banner | null;
  timing: { key: number; offsetMs: number; timing: TimingClass; hit: boolean } | null;
  winner: Side | null;
}

const SETTINGS_KEY = 'pocket-sports.settings';

function loadSettings(): MenuSettings {
  const d: MenuSettings = { cpuLevel: 'easy', assist: 'normal', bestOf: 3 };
  try {
    return { ...d, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<MenuSettings>) };
  } catch {
    return d;
  }
}

let state: UiState = { screen: 'menu', settings: loadSettings(), hud: null, banner: null, timing: null, winner: null };
const listeners = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<UiState>): void {
    state = { ...state, ...patch };
    if (patch.settings) {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(patch.settings));
      } catch {
        /* private mode */
      }
    }
    for (const l of listeners) l();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export const useUi = (): UiState => useSyncExternalStore(store.subscribe, store.get);
