// Phone-side session: joins the room, runs the link + clock sync, streams orientation, calibrates.
import { useSyncExternalStore } from 'react';
import { ClockSync } from '../shared/clock.ts';
import { PeerLink, type TransportKind } from '../shared/net/PeerLink.ts';
import { ServerConn } from '../shared/net/ServerConn.ts';
import type { DisplayMsg, HitTier, MenuMirror, PhoneMsg, Quat, UiState } from '../shared/protocol.ts';
import { defaultConfig } from '../engine/config.ts';
import { type DetectedSwing, MotionPipeline, type RawEvent } from './motion.ts';
import { Recorder } from './recorder.ts';
import { type PermissionResult, keepAwake, requestMotion, tryLockPortrait, vibrate, watchSensors } from './sensors.ts';

export type Step = 'connecting' | 'not-found' | 'replaced' | 'motion' | 'motion-error' | 'calibrate' | 'play';

export interface PhoneState {
  step: Step;
  room: string;
  transport: TransportKind;
  displayUp: boolean;
  rtt: number | null;
  ui: UiState;
  motionError: PermissionResult | 'no-events' | null;
  flash: { key: number; strength: number; tier: HitTier; kmh: number; rally: number } | null;
  /** [you, cpu] points, last point result, next server is you. */
  score: [number, number] | null;
  lastPoint: 'won' | 'lost' | 'let' | null;
  nextYou: boolean;
  /** Opponent's name (Marlo, or the online friend). */
  op: string;
  /** Was connected to the laptop at least once (so a drop shows Reconnecting, not Joining). */
  wasLinked: boolean;
  /** Dev mode (?dev): recorder state and the last detected swing. */
  dev: boolean;
  recording: boolean;
  recCount: { events: number; swings: number };
  lastSwing: DetectedSwing | null;
  axisLocked: boolean;
  /** Laptop menu state while not in a match. */
  menu: MenuMirror | null;
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
  private link = new PeerLink<PhoneMsg, DisplayMsg>(this.conn, false);
  private clock: ClockSync;
  private q: Quat | null = null;
  private q0: Quat | null = null;
  private pipe = new MotionPipeline({ ...defaultConfig.swing });
  private recorder = new Recorder();
  private lastSent = 0;
  private flashKey = 0;
  private stopWatch: (() => void) | null = null;

  constructor(room: string) {
    this.state = { step: 'connecting', room, transport: 'none', displayUp: false, rtt: null, ui: 'lobby', motionError: null, flash: null, score: null, lastPoint: null, nextYou: false, op: 'Marlo', wasLinked: false, dev: new URLSearchParams(location.search).has('dev'), recording: false, recCount: { events: 0, swings: 0 }, lastSwing: null, axisLocked: false, menu: null };
    const pid = phoneId();

    // A not-found right after a server restart usually means the laptop hasn't re-created the room yet,
    // so keep retrying quietly for a minute (the not-found screen shows meanwhile).
    let retries = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    this.conn.onOpen(() => this.conn.send({ k: 'join', code: room, pid }));
    this.conn.on((m) => {
      if (m.k === 'joined') {
        retries = 0;
        if (this.state.step === 'connecting' || this.state.step === 'not-found') this.set({ step: this.q ? (this.q0 ? 'play' : 'calibrate') : 'motion' });
      } else if (m.k === 'err') {
        if (m.e === 'room-not-found') {
          this.set({ step: 'not-found' });
          clearTimeout(retryTimer);
          if (retries++ < 20) retryTimer = setTimeout(() => this.conn.send({ k: 'join', code: room, pid }), 3000);
        }
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
      this.set({ transport: s.transport, ...(s.transport !== 'none' ? { wasLinked: true } : {}) });
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
      else if (m.k === 'cfg') this.pipe.detector.params = { ...m.swing };
      else if (m.k === 'st') this.set({ ui: m.s, score: m.sc ?? null, lastPoint: m.pt ?? null, nextYou: !!m.nx, menu: m.menu ?? null, op: m.op ?? 'Marlo' });
      else if (m.k === 'hit') {
        const tier = m.tier ?? 'nice';
        vibrate(tier === 'smash' ? [40, 30, 40] : tier === 'great' ? 25 : 10);
        this.set({ flash: { key: ++this.flashKey, strength: m.strength, tier, kmh: m.kmh ?? 0, rally: m.rally ?? 0 } });
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
    const w = watchSensors((ev) => this.onSensor(ev));
    this.stopWatch = w.stop;
    keepAwake();
    void tryLockPortrait();
    if (!(await w.firstEvent)) return this.set({ step: 'motion-error', motionError: perm === 'denied' ? 'denied' : 'no-events' });
    this.set({ step: 'calibrate', motionError: null });
  }

  private onSensor(ev: RawEvent): void {
    this.recorder.push(ev);
    const swing = this.pipe.push(ev);
    if (ev.k === 'o' && this.pipe.q) {
      this.q = this.pipe.q;
      if (ev.t - this.lastSent >= ORIENT_MIN_INTERVAL_MS) {
        this.lastSent = ev.t;
        this.link.send({ k: 'o', t: ev.t, q: this.q, w: Math.round(this.pipe.lastRate) });
      }
    }
    if (swing) {
      // Swings go on the reliable channel, stamped at the peak in the phone clock.
      this.link.send({ k: 's', t: swing.t, peak: swing.peak, face: swing.face, path: swing.path, roll: swing.roll });
      this.recorder.swing(swing);
      if (this.state.dev) this.set({ lastSwing: swing, recCount: this.recorder.count });
    }
    if (this.state.dev && this.pipe.adapter.locked !== this.state.axisLocked) this.set({ axisLocked: this.pipe.adapter.locked });
  }

  /** Dev: start/stop a raw sensor recording. */
  toggleRecording(): void {
    if (this.recorder.recording) {
      void this.recorder.stop();
      this.set({ recording: false });
    } else {
      this.recorder.start();
      this.set({ recording: true, recCount: { events: 0, swings: 0 } });
    }
  }

  /** Store the current pose as "pointing at the laptop like a paddle". */
  calibrate(): void {
    if (!this.q) return;
    this.q0 = this.q;
    this.pipe.q0 = this.q0;
    this.link.send({ k: 'cal', q0: this.q0 });
    vibrate(30);
    this.set({ step: 'play' });
  }

  /** Pause button: toggles pause / resume on the laptop. */
  pause(): void {
    this.link.send({ k: 'pz' });
  }

  /** Drive the laptop's menu from the phone. */
  act(m: Extract<PhoneMsg, { k: 'act' }>): void {
    this.link.send(m);
  }

  rejoin(): void {
    this.conn.reconnectNow();
  }

  tap(): void {
    this.link.send({ k: 'tap', t: performance.now() });
  }
}

export function usePhone(s: PhoneSession): PhoneState {
  return useSyncExternalStore(s.subscribe, () => s.get());
}
