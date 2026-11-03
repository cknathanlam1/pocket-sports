// Wire protocol. JSON with short keys; see the build spec "Messages" section.
import type { VsEvent } from '../engine/net.ts';
import type { Score } from '../engine/rules.ts';
import type { Look } from './art/Char.tsx';
// Quaternions are [x, y, z, w]. Timestamps are sender-local ms (performance.now()) unless noted.

export type Quat = [number, number, number, number];

// ───────────── Peer messages (phone ↔ laptop; over WebRTC data channels or the server relay) ─────────────

/** Phone → laptop */
export type PhoneMsg =
  /** Raw device orientation (device → earth), ~60 Hz, lossy channel. w = current |ω| (deg/s) for the dev graph. */
  | { k: 'o'; t: number; q: Quat; w?: number }
  /** Swing, stamped at its peak (M3). */
  | { k: 's'; t: number; peak: number; face: number; path: number; roll: number }
  | { k: 'tap'; t: number }
  /** Calibration pose: paddle orientation = q0⁻¹ · q. */
  | { k: 'cal'; q0: Quat }
  /** Clock sync request (t0 = phone send time). */
  | { k: 'ping'; t0: number }
  /** Result of a sync round: off = laptopClock − phoneClock (ms), rtt in ms. */
  | { k: 'sync'; off: number; rtt: number }
  /** Pause button on the phone: toggles pause / resume. */
  | { k: 'pz' }
  /** Menu actions from the phone's mirrored menu (see MenuMirror). */
  | { k: 'act'; a: MenuAction }
  | { k: 'act'; a: 'set'; key: 'cpuLevel' | 'assist' | 'bestOf'; v: string | number };

export type MenuAction = 'play' | 'start' | 'back' | 'menu' | 'rematch' | 'practice';

/** What the laptop's menus show, mirrored on the phone so you can set up a match from it. */
export interface MenuMirror {
  screen: 'menu' | 'setup' | 'results' | 'other';
  cpuLevel: 'easy' | 'normal' | 'hard';
  assist: 'easy' | 'normal' | 'pro';
  bestOf: 1 | 3 | 5;
  /** Results only: did you win, and the games score. */
  won?: boolean;
  games?: [number, number];
}

export type UiState = 'serve' | 'rally' | 'between' | 'paused' | 'lobby';

export type HitTier = 'nice' | 'great' | 'smash';

/** Laptop → phone */
export type DisplayMsg =
  /** UI state. sc = [you, opponent] points; pt = how the last point went; nx = next server is you; op = opponent's name. */
  | { k: 'st'; s: UiState; sc?: [number, number]; pt?: 'won' | 'lost' | 'let'; nx?: boolean; menu?: MenuMirror; op?: string }
  /** Your hit landed: feedback tier, ball speed (km/h) and rally length. */
  | { k: 'hit'; strength: number; tier?: HitTier; kmh?: number; rally?: number }
  /** Live swing-detector tuning from the dev panel. */
  | { k: 'cfg'; swing: { onsetDegPerSec: number; refractoryMs: number; peakDropRatio: number; maxDurationMs: number; rollAxis: 'y' | 'z' } }
  /** t0 echoed; t1 = laptop receive time; t2 = laptop send time. */
  | { k: 'pong'; t0: number; t1: number; t2: number };

// ───────────── Versus messages (laptop ↔ laptop, online match; same transport as the phone link) ─────────────

/** Host → guest, and back. Everything in the receiver's frame (their player is side 0). */
export type VersusMsg =
  | VsEvent
  /** Who I am: sent on connect and whenever it changes. */
  | { k: 'vhi'; name: string; look: Look; phone: boolean }
  /**
   * Host: start (or restart) a match. sv = who serves first, in the receiver's frame. score: continue from
   * this score (receiver's frame), sent when the link comes back after a drop so a reloaded guest rejoins.
   */
  | { k: 'vgo'; bestOf: 1 | 3 | 5; sv: 0 | 1; score?: Score }
  /** Either side paused (on) or resumed; the rally in progress is replayed. why: what paused it. */
  | { k: 'vpz'; on: boolean; why?: 'user' | 'phone' }
  /** Left the match (back to the lobby). */
  | { k: 'vbye' }
  | { k: 'vping'; t0: number }
  | { k: 'vpong'; t0: number }
  /** My paddle orientation relative to calibration (my frame), ~30 Hz, so you see my tilt. */
  | { k: 'vpq'; q: Quat };

export type PeerMsg = PhoneMsg | DisplayMsg | VersusMsg;

/** Messages that should go over the lossy/unordered channel when P2P is up. */
export const LOSSY_KINDS = new Set(['o', 'ping', 'pong', 'vping', 'vpong', 'vpq']);

// ───────────── Client ↔ server (rooms, signaling, relay) ─────────────

export type Role = 'display' | 'phone';

export type RoomError = 'room-not-found' | 'bad-token' | 'replaced' | 'bad-request' | 'room-full';

/** 'pair' = laptop + its phone. 'match' = two laptops in an online match (host + guest). */
export type RoomKind = 'pair' | 'match';

/** WebRTC signaling payload, forwarded verbatim to the other peer. */
export type Signal = { sdp: { type: 'offer' | 'answer'; sdp: string } } | { cand: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } };

export type ClientMsg =
  | { k: 'echo'; t0: number }
  /** Display (or match host): create a new room. */
  | { k: 'create'; kind?: RoomKind }
  /** Display: reclaim a room after a reload or network drop. */
  | { k: 'resume'; code: string; token: string; kind?: RoomKind }
  /** Phone (or match guest): join a room. `pid` is stable per tab so a rejoin replaces the old socket. */
  | { k: 'join'; code: string; pid: string; kind?: RoomKind }
  | { k: 'sig'; d: Signal }
  | { k: 'relay'; m: PeerMsg };

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
  | { k: 'relay'; m: PeerMsg }
  | { k: 'err'; e: RoomError };
