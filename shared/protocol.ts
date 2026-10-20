// Wire protocol. JSON with short keys; see the build spec "Messages" section.
// Quaternions are [x, y, z, w]. Timestamps are sender-local ms (performance.now()) unless noted.

export type Quat = [number, number, number, number];

// ───────────── Peer messages (phone ↔ laptop; over WebRTC data channels or the server relay) ─────────────

/** Phone → laptop */
export type PhoneMsg =
  /** Raw device orientation (device → earth), ~60 Hz, lossy channel. */
  | { k: 'o'; t: number; q: Quat }
  /** Swing, stamped at its peak (M3). */
  | { k: 's'; t: number; peak: number; face: number; path: number; roll: number }
  | { k: 'tap'; t: number }
  /** Calibration pose: paddle orientation = q0⁻¹ · q. */
  | { k: 'cal'; q0: Quat }
  /** Clock sync request (t0 = phone send time). */
  | { k: 'ping'; t0: number }
  /** Result of a sync round: off = laptopClock − phoneClock (ms), rtt in ms. */
  | { k: 'sync'; off: number; rtt: number };

export type UiState = 'serve' | 'rally' | 'between' | 'paused' | 'lobby';

/** Laptop → phone */
export type DisplayMsg =
  | { k: 'st'; s: UiState }
  | { k: 'hit'; strength: number }
  /** t0 echoed; t1 = laptop receive time; t2 = laptop send time. */
  | { k: 'pong'; t0: number; t1: number; t2: number };

/** Messages that should go over the lossy/unordered channel when P2P is up. */
export const LOSSY_KINDS = new Set(['o', 'ping', 'pong']);

// ───────────── Client ↔ server (rooms, signaling, relay) ─────────────

export type Role = 'display' | 'phone';

export type RoomError = 'room-not-found' | 'bad-token' | 'replaced' | 'bad-request';

/** WebRTC signaling payload, forwarded verbatim to the other peer. */
export type Signal = { sdp: { type: 'offer' | 'answer'; sdp: string } } | { cand: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } };

export type ClientMsg =
  | { k: 'echo'; t0: number }
  /** Display: create a new room. */
  | { k: 'create' }
  /** Display: reclaim a room after a reload or network drop. */
  | { k: 'resume'; code: string; token: string }
  /** Phone: join a room. `pid` is stable per phone tab so a rejoin replaces the old socket. */
  | { k: 'join'; code: string; pid: string }
  | { k: 'sig'; d: Signal }
  | { k: 'relay'; m: PhoneMsg | DisplayMsg };

export type ServerMsg =
  | { k: 'hello'; serverTime: number }
  | { k: 'echo'; t0: number; t1: number }
  /** Display is in a room. */
  | { k: 'room'; code: string; token: string }
  /** Phone is in a room. */
  | { k: 'joined'; code: string }
  /** The other side of the room connected (up) or left. */
  | { k: 'peer'; up: boolean }
  | { k: 'sig'; d: Signal }
  | { k: 'relay'; m: PhoneMsg | DisplayMsg }
  | { k: 'err'; e: RoomError };
