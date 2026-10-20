// Tuning overrides from the dev panel: persisted to localStorage and merged over defaultConfig at boot.
import { type Config, defaultConfig } from '../engine/config.ts';

const KEY = 'pocket-sports.config';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merge `src` into `dst` for keys that exist in `dst` with the same type. */
function merge(dst: Obj, src: Obj): void {
  for (const [k, v] of Object.entries(src)) {
    if (!(k in dst)) continue;
    if (isObj(dst[k]) && isObj(v)) merge(dst[k] as Obj, v);
    else if (typeof dst[k] === typeof v) dst[k] = v;
  }
}

export function loadConfig(): Config {
  const cfg = structuredClone(defaultConfig);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    if (isObj(saved)) merge(cfg as unknown as Obj, saved);
  } catch {
    /* ignore corrupt or blocked storage */
  }
  return cfg;
}

export function saveConfig(cfg: Config): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* private mode */
  }
}

export function resetConfig(cfg: Config): void {
  const fresh = structuredClone(defaultConfig) as unknown as Obj;
  merge(cfg as unknown as Obj, fresh);
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Every numeric leaf as [path, value]. */
export function numericLeaves(o: unknown, prefix = ''): Array<[string, number]> {
  if (!isObj(o)) return [];
  return Object.entries(o).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'number' ? [[p, v] as [string, number]] : numericLeaves(v, p);
  });
}

export function setPath(o: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = o as Obj;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Obj;
  cur[keys.at(-1)!] = value;
}

/** Slider range for a default value: generous around the default, sensible step. */
export function sliderRange(def: number): { min: number; max: number; step: number } {
  if (def === 0) return { min: 0, max: 1, step: 0.01 };
  const a = Math.abs(def);
  const max = def > 0 && def <= 1 ? Math.max(1, a * 2) : a * 3;
  const step = a >= 100 ? 1 : a >= 10 ? 0.5 : a >= 1 ? 0.05 : a >= 0.1 ? 0.005 : 0.0001;
  return { min: def < 0 ? -a * 3 : 0, max, step };
}

export function getPath(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, k) => (isObj(cur) ? cur[k] : undefined), o);
}
