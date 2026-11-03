// Laptop ↔ laptop link for an online match. Its own server socket and a 'match' room: the host creates it
// and shares the code, the guest joins. WebRTC P2P when possible, server relay otherwise (same PeerLink as
// the phone). Measures RTT continuously (median of recent pings), which sets the netcode's latency terms.
import { PeerLink, type TransportKind } from '../../shared/net/PeerLink.ts';
import { ServerConn } from '../../shared/net/ServerConn.ts';
import type { VersusMsg } from '../../shared/protocol.ts';
import type { Look } from '../../shared/art/Char.tsx';

export type VsRole = 'host' | 'guest';
export type VsState = 'connecting' | 'waiting' | 'connected' | 'not-found' | 'full';

export interface Opponent {
  name: string;
  look: Look;
  phone: boolean;
}

export interface VsStatus {
  role: VsRole;
  code: string | null;
  state: VsState;
  transport: TransportKind;
  /** Round trip to the other laptop (ms), median of recent pings. */
  rtt: number | null;
  opponent: Opponent | null;
}

const PID_KEY = 'pocket-sports.vs-pid';

function tabId(): string {
  try {
    let id = sessionStorage.getItem(PID_KEY);
    if (!id) sessionStorage.setItem(PID_KEY, (id = crypto.randomUUID()));
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export class VersusLink {
  private conn = new ServerConn();
  private link: PeerLink<VersusMsg, VersusMsg>;
  private token: string | null = null;
  private listeners = new Set<(s: VsStatus) => void>();
  private msgHandlers = new Set<(m: VersusMsg) => void>();
  private samples: number[] = [];
  private pingTimer: ReturnType<typeof setInterval>;
  private me: Opponent | null = null;
  status: VsStatus;

  /** Host: pass no code. Guest: pass the host's code. */
  constructor(role: VsRole, code?: string) {
    this.status = { role, code: code?.toUpperCase() ?? null, state: 'connecting', transport: 'none', rtt: null, opponent: null };
    this.link = new PeerLink<VersusMsg, VersusMsg>(this.conn, role === 'host');
    const pid = tabId();

    this.conn.onOpen(() => {
      if (role === 'guest') this.conn.send({ k: 'join', code: this.status.code ?? '', pid, kind: 'match' });
      else if (this.status.code && this.token) this.conn.send({ k: 'resume', code: this.status.code, token: this.token, kind: 'match' });
      else this.conn.send({ k: 'create', kind: 'match' });
    });
    this.conn.on((m) => {
      if (m.k === 'room') {
        this.token = m.token;
        this.set({ code: m.code, state: this.link.transport === 'none' ? 'waiting' : 'connected' });
      } else if (m.k === 'joined') {
        this.set({ state: this.link.transport === 'none' ? 'waiting' : 'connected' });
      } else if (m.k === 'peer' && m.up) {
        // A (new) opponent arrived: introduce ourselves. The transport may not change (a stale P2P link
        // to the previous guest can still look open), so don't rely on the status transition alone.
        if (this.me) this.link.send({ k: 'vhi', ...this.me });
        this.set({ opponent: null });
      } else if (m.k === 'err') {
        if (m.e === 'room-not-found' && role === 'guest') this.set({ state: 'not-found' });
        else if (m.e === 'room-full') this.set({ state: 'full' });
        else if (m.e === 'room-not-found' || m.e === 'bad-token') {
          this.token = null;
          this.conn.send({ k: 'create', kind: 'match' });
        }
      }
    });

    this.link.onStatus((s) => {
      const up = s.transport !== 'none';
      if (up && this.status.transport === 'none' && this.me) this.link.send({ k: 'vhi', ...this.me });
      if (!up) this.samples = [];
      this.set({
        transport: s.transport,
        state: up ? 'connected' : this.status.state === 'connected' ? 'waiting' : this.status.state,
        ...(up ? {} : { rtt: null }),
      });
    });

    this.link.onMessage((m) => {
      if (m.k === 'vping') return this.link.send({ k: 'vpong', t0: m.t0 });
      if (m.k === 'vpong') {
        this.samples.push(performance.now() - m.t0);
        if (this.samples.length > 9) this.samples.shift();
        const sorted = [...this.samples].sort((a, b) => a - b);
        this.set({ rtt: Math.round(sorted[Math.floor(sorted.length / 2)]!) });
        return;
      }
      if (m.k === 'vhi') this.set({ opponent: { name: m.name.slice(0, 16) || 'Friend', look: m.look, phone: m.phone } });
      for (const h of this.msgHandlers) h(m);
    });

    // 4 pings a second: cheap, and the median tracks route changes within a couple of seconds.
    this.pingTimer = setInterval(() => {
      if (this.link.transport !== 'none') this.link.send({ k: 'vping', t0: performance.now() });
    }, 250);
  }

  /** One-way delay estimate (ms). Before the first ping returns, assume a typical home link. */
  get oneWayMs(): number {
    return (this.status.rtt ?? 80) / 2;
  }

  get connected(): boolean {
    return this.link.transport !== 'none';
  }

  /** Our name/look/phone: sent now and on every reconnect. */
  introduce(me: Opponent): void {
    this.me = me;
    if (this.connected) this.link.send({ k: 'vhi', ...me });
  }

  send(m: VersusMsg): void {
    this.link.send(m);
  }

  onMessage(h: (m: VersusMsg) => void): () => void {
    this.msgHandlers.add(h);
    return () => this.msgHandlers.delete(h);
  }

  onStatus(fn: (s: VsStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  reconnectNow(): void {
    this.conn.reconnectNow();
  }

  close(): void {
    if (this.connected) this.link.send({ k: 'vbye' });
    clearInterval(this.pingTimer);
    this.link.close();
    this.conn.close();
    this.listeners.clear();
    this.msgHandlers.clear();
  }

  private set(p: Partial<VsStatus>): void {
    const next = { ...this.status, ...p };
    if (JSON.stringify(next) === JSON.stringify(this.status)) return;
    this.status = next;
    for (const l of this.listeners) l(next);
  }
}
