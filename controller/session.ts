// Phone-side session: joins the room, runs the link + clock sync, streams orientation, calibrates.
import { useSyncExternalStore } from 'react';
import { ClockSync } from '../shared/clock.ts';
import { PeerLink, type TransportKind } from '../shared/net/PeerLink.ts';
import { ServerConn } from '../shared/net/ServerConn.ts';
import type { Quat, UiState } from '../shared/protocol.ts';
import { type PermissionResult, keepAwake, requestMotion, tryLockPortrait, vibrate, watchOrientation } from './sensors.ts';

export type Step = 'connecting' | 'not-found' | 'replaced' | 'motion' | 'motion-error' | 'calibrate' | 'play';

export interface PhoneState {
  step: Step;
  room: string;
  transport: TransportKind;
  displayUp: boolean;
  rtt: number | null;
  ui: UiState;
  motionError: PermissionResult | 'no-events' | null;
  flash: { key: number; strength: number } | null;
}

const ORIENT_MIN_INTERVAL_MS = 1000 / 60 - 2;

function phoneId(): string {
  try {
    let id = sessionStorage.getItem('pocket-sports.pid');
    if (!id) sessionStorage.setItem('pocket-sports.pid', (id = crypto.randomUUID()));
    return id;
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

export class PhoneSession {
  private state: PhoneState;
  private listeners = new Set<() => void>();
  private conn = new ServerConn();
  private link = new PeerLink(this.conn, 'phone');
  private clock: ClockSync;
  private q: Quat | null = null;
  private q0: Quat | null = null;
  private lastSent = 0;
  private flashKey = 0;
  private stopWatch: (() => void) | null = null;

  constructor(room: string) {
    this.state = { step: 'connecting', room, transport: 'none', displayUp: false, rtt: null, ui: 'lobby', motionError: null, flash: null };
    const pid = phoneId();

    this.conn.onOpen(() => this.conn.send({ k: 'join', code: room, pid }));
    this.conn.on((m) => {
      if (m.k === 'joined') {
        if (this.state.step === 'connecting' || this.state.step === 'not-found') this.set({ step: this.q ? (this.q0 ? 'play' : 'calibrate') : 'motion' });
      } else if (m.k === 'err') {
        if (m.e === 'room-not-found') this.set({ step: 'not-found' });
        if (m.e === 'replaced') {
          this.set({ step: 'replaced' });
          this.conn.close();
        }
      } else if (m.k === 'peer') {
        this.set({ displayUp: m.up });
      }
    });

    this.clock = new ClockSync({
      send: (t0) => this.link.send({ k: 'ping', t0 }),
      onEstimate: (e) => {
        this.set({ rtt: Math.round(e.rtt) });
        this.link.send({ k: 'sync', off: e.offset, rtt: e.rtt });
      },
    });

    let wasUp = false;
    this.link.onStatus((s) => {
      this.set({ transport: s.transport });
      const up = s.transport !== 'none';
      if (up && !wasUp) {
        // (Re)connected: the laptop may have reloaded, so resend calibration and resync clocks.
        if (this.q0) this.link.send({ k: 'cal', q0: this.q0 });
        this.clock.start();
      }
      // Transport changed (relay → P2P): latency changed, resync now.
      else if (up) this.clock.round();
      if (!up) this.clock.stop();
      wasUp = up;
    });

    this.link.onMessage((m) => {
      if (m.k === 'pong') this.clock.onPong(m.t0, m.t1, m.t2);
      else if (m.k === 'st') this.set({ ui: m.s });
      else if (m.k === 'hit') {
        vibrate(Math.round(20 + 40 * m.strength));
        this.set({ flash: { key: ++this.flashKey, strength: m.strength } });
      }
    });
  }

  get(): PhoneState {
    return this.state;
  }

  private set(p: Partial<PhoneState>): void {
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** From the "Enable motion" tap. */
  async enableMotion(): Promise<void> {
    const perm = await requestMotion();
    if (perm === 'insecure' || perm === 'unsupported') return this.set({ step: 'motion-error', motionError: perm });
    // The permission answer is advisory: some browsers report "denied" yet still deliver events
    // (and vice versa), so the real test is whether orientation events arrive.
    this.stopWatch?.();
    const w = watchOrientation((q, t) => this.onOrientation(q, t));
    this.stopWatch = w.stop;
    keepAwake();
    void tryLockPortrait();
    if (!(await w.firstEvent)) return this.set({ step: 'motion-error', motionError: perm === 'denied' ? 'denied' : 'no-events' });
    this.set({ step: 'calibrate', motionError: null });
  }

  private onOrientation(q: Quat, t: number): void {
    this.q = q;
    if (t - this.lastSent < ORIENT_MIN_INTERVAL_MS) return;
    this.lastSent = t;
    this.link.send({ k: 'o', t, q });
  }

  /** Store the current pose as "pointing at the laptop like a paddle". */
  calibrate(): void {
    if (!this.q) return;
    this.q0 = this.q;
    this.link.send({ k: 'cal', q0: this.q0 });
    vibrate(30);
    this.set({ step: 'play' });
  }

  tap(): void {
    this.link.send({ k: 'tap', t: performance.now() });
  }
}

export function usePhone(s: PhoneSession): PhoneState {
  return useSyncExternalStore(s.subscribe, () => s.get());
}
