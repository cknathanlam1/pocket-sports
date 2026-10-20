// Wire protocol. JSON with short keys; see the build spec "Messages" section.
// Quaternions are [x, y, z, w]. Timestamps are sender-local ms (performance.now()).

export type Quat = [number, number, number, number];

/** Phone → laptop */
export type PhoneMsg =
  | { k: 'o'; t: number; q: Quat }
  | { k: 's'; t: number; peak: number; face: number; path: number; roll: number }
  | { k: 'tap'; t: number }
  | { k: 'cal'; q0: Quat }
  | { k: 'ping'; t0: number };

export type UiState = 'serve' | 'rally' | 'between' | 'paused';

/** Laptop → phone */
export type DisplayMsg =
  | { k: 'st'; s: UiState }
  | { k: 'hit'; strength: number }
  | { k: 'pong'; t0: number; t1: number; t2: number };

/** Client ↔ server (rooms, signaling, relay). Filled out in M2. */
export type ServerMsg =
  | { k: 'hello'; serverTime: number }
  | { k: 'echo'; t0: number; t1: number };

export type ClientMsg = { k: 'echo'; t0: number };
