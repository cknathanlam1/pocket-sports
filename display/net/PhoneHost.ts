// Laptop side of pairing: owns the room (create, or resume after a reload), the peer link to the
// phone, pong replies for clock sync, and the PhoneInput fed by the link.
import { PeerLink, type TransportKind } from '../../shared/net/PeerLink.ts';
import { ServerConn } from '../../shared/net/ServerConn.ts';
import type { DisplayMsg, PhoneMsg } from '../../shared/protocol.ts';
import { PhoneInput } from '../input/PhoneInput.ts';

export type PhoneState = 'none' | 'connected' | 'calibrated';

export interface PhoneStatus {
  serverUp: boolean;
  code: string | null;
  url: string | null;
  transport: TransportKind;
  phone: PhoneState;
  rtt: number | null;
}

const ROOM_KEY = 'pocket-sports.room';

export class PhoneHost {
  readonly input = new PhoneInput();
  private conn = new ServerConn();
  private link = new PeerLink<DisplayMsg, PhoneMsg>(this.conn, true);
  private listeners = new Set<(s: PhoneStatus) => void>();
  status: PhoneStatus = { serverUp: false, code: null, url: null, transport: 'none', phone: 'none', rtt: null };

  private readonly roomKey: string;

  /** roomKey: sessionStorage key for the room (the second phone in local two-player uses its own). */
  constructor(roomKey = ROOM_KEY) {
    this.roomKey = roomKey;
    this.conn.onOpen(() => {
      this.set({ serverUp: true });
      const saved = this.loadRoom();
      this.conn.send(saved ? { k: 'resume', code: saved.code, token: saved.token } : { k: 'create' });
    });
    this.conn.on((m) => {
      if (m.k === 'room') {
        this.saveRoom(m.code, m.token);
        this.set({ code: m.code, url: `${location.origin}/p/${m.code}` });
      } else if (m.k === 'err' && (m.e === 'room-not-found' || m.e === 'bad-token')) {
        // Our saved room expired: start a fresh one.
        this.clearRoom();
        this.set({ code: null, url: null });
        this.conn.send({ k: 'create' });
      } else if (m.k === 'err' && m.e === 'replaced') {
        // Another laptop tab took the room over: make our own.
        this.conn.send({ k: 'create' });
      }
      if (!this.conn.connected) this.set({ serverUp: false });
    });

    this.link.onStatus((s) => {
      if (s.transport === 'none') this.input.reset();
      this.refresh(s.transport);
    });

    this.link.onMessage((m) => {
      if (m.k === 'ping') {
        const t = performance.now();
        this.link.send({ k: 'pong', t0: m.t0, t1: t, t2: performance.now() });
        return;
      }
      const wasCal = this.input.calibrated;
      this.input.handle(m);
      if (m.k === 'sync' || (m.k === 'cal' && !wasCal)) this.refresh(this.link.transport);
    });
  }

  private refresh(transport: TransportKind): void {
    const phone: PhoneState = transport === 'none' ? 'none' : this.input.calibrated ? 'calibrated' : 'connected';
    this.set({ transport, phone, rtt: transport === 'none' ? null : this.input.rtt === null ? null : Math.round(this.input.rtt) });
  }

  /** "Retry now" on the server-down banner: skip the reconnect backoff. */
  reconnectNow(): void {
    this.conn.reconnectNow();
  }

  send(m: DisplayMsg): void {
    this.link.send(m);
  }

  onStatus(fn: (s: PhoneStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private set(p: Partial<PhoneStatus>): void {
    const next = { ...this.status, ...p };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    for (const l of this.listeners) l(next);
  }

  // The room survives a page reload (sessionStorage), so the phone doesn't need to rescan.
  private loadRoom(): { code: string; token: string } | null {
    try {
      return JSON.parse(sessionStorage.getItem(this.roomKey) ?? 'null') as { code: string; token: string } | null;
    } catch {
      return null;
    }
  }

  private saveRoom(code: string, token: string): void {
    try {
      sessionStorage.setItem(this.roomKey, JSON.stringify({ code, token }));
    } catch {
      /* private mode */
    }
  }

  private clearRoom(): void {
    try {
      sessionStorage.removeItem(this.roomKey);
    } catch {
      /* ignore */
    }
  }
}
