// Phone ↔ laptop link. Relay through the server WebSocket is first-class: it carries traffic from
// the moment the peer is present. WebRTC is negotiated in parallel and takes over once both data
// channels open (lossy channel: unordered, maxRetransmits 0; reliable channel: ordered). If P2P
// isn't up within `p2pTimeoutMs` we report relay and stop waiting, but still upgrade if it connects.
import { type DisplayMsg, LOSSY_KINDS, type PhoneMsg, type Role, type ServerMsg, type Signal } from '../protocol.ts';
import type { ServerConn } from './ServerConn.ts';

export type TransportKind = 'p2p' | 'relay' | 'none';

const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

type Out<R extends Role> = R extends 'display' ? DisplayMsg : PhoneMsg;
type In<R extends Role> = R extends 'display' ? PhoneMsg : DisplayMsg;

export interface LinkStatus {
  transport: TransportKind;
  /** True once P2P negotiation has given up (or failed) for this attempt. */
  p2pFailed: boolean;
}

export class PeerLink<R extends Role> {
  private pc: RTCPeerConnection | null = null;
  private lossy: RTCDataChannel | null = null;
  private reliable: RTCDataChannel | null = null;
  private pendingCands: RTCIceCandidateInit[] = [];
  private peerUp = false;
  private p2pFailed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private msgHandlers = new Set<(m: In<R>) => void>();
  private statusHandlers = new Set<(s: LinkStatus) => void>();
  private lastStatus = '';
  private readonly role: R;
  private readonly conn: ServerConn;
  private readonly p2pTimeoutMs: number;
  /** Disable WebRTC entirely (forced relay, for testing the fallback path). */
  forceRelay = false;

  constructor(conn: ServerConn, role: R, p2pTimeoutMs = 3000) {
    this.conn = conn;
    this.role = role;
    this.p2pTimeoutMs = p2pTimeoutMs;
    conn.on((m) => this.onServer(m));
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('relay')) this.forceRelay = true;
  }

  get transport(): TransportKind {
    if (this.p2pOpen) return 'p2p';
    return this.peerUp && this.conn.connected ? 'relay' : 'none';
  }

  get status(): LinkStatus {
    return { transport: this.transport, p2pFailed: this.p2pFailed };
  }

  private get p2pOpen(): boolean {
    return this.lossy?.readyState === 'open' && this.reliable?.readyState === 'open';
  }

  send(m: Out<R>): void {
    const s = JSON.stringify(m);
    if (this.p2pOpen) {
      const ch = LOSSY_KINDS.has(m.k) ? this.lossy! : this.reliable!;
      // Drop lossy frames if the channel is backed up rather than adding latency.
      if (ch === this.lossy && ch.bufferedAmount > 16_000) return;
      ch.send(s);
      return;
    }
    if (this.peerUp) this.conn.send({ k: 'relay', m });
  }

  onMessage(h: (m: In<R>) => void): () => void {
    this.msgHandlers.add(h);
    return () => this.msgHandlers.delete(h);
  }

  onStatus(h: (s: LinkStatus) => void): () => void {
    this.statusHandlers.add(h);
    h(this.status);
    return () => this.statusHandlers.delete(h);
  }

  private emitStatus(): void {
    const s = this.status;
    const sig = JSON.stringify(s);
    if (sig === this.lastStatus) return;
    this.lastStatus = sig;
    for (const h of this.statusHandlers) h(s);
  }

  private deliver(raw: string | In<R>): void {
    let m: In<R>;
    try {
      m = typeof raw === 'string' ? (JSON.parse(raw) as In<R>) : raw;
    } catch {
      return;
    }
    for (const h of this.msgHandlers) h(m);
  }

  private onServer(m: ServerMsg): void {
    if (m.k === 'peer') {
      const was = this.peerUp;
      this.peerUp = m.up;
      // (Re)negotiate when the peer appears and P2P isn't already carrying traffic.
      if (m.up && (!was || !this.p2pOpen) && this.role === 'display') this.startOffer();
      this.emitStatus();
    } else if (m.k === 'relay') {
      this.deliver(m.m as In<R>);
    } else if (m.k === 'sig') {
      void this.onSignal(m.d);
    }
  }

  // ───────── WebRTC ─────────

  private reset(): void {
    clearTimeout(this.timer);
    this.lossy?.close();
    this.reliable?.close();
    this.pc?.close();
    this.pc = null;
    this.lossy = null;
    this.reliable = null;
    this.pendingCands = [];
    this.p2pFailed = false;
  }

  private newPc(): RTCPeerConnection {
    this.reset();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ cand: e.candidate.toJSON() as Extract<Signal, { cand: unknown }>['cand'] });
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.p2pFailed = true;
      this.emitStatus();
    };
    pc.ondatachannel = (e) => this.adopt(e.channel);
    this.timer = setTimeout(() => {
      if (!this.p2pOpen) {
        this.p2pFailed = true;
        this.emitStatus();
      }
    }, this.p2pTimeoutMs);
    return pc;
  }

  private adopt(ch: RTCDataChannel): void {
    if (ch.label === 'o') this.lossy = ch;
    else if (ch.label === 'r') this.reliable = ch;
    else return;
    ch.onopen = () => this.emitStatus();
    ch.onclose = () => this.emitStatus();
    ch.onmessage = (e) => this.deliver(String(e.data));
  }

  private async startOffer(): Promise<void> {
    if (this.forceRelay || typeof RTCPeerConnection === 'undefined') {
      this.p2pFailed = true;
      return this.emitStatus();
    }
    const pc = this.newPc();
    this.adopt(pc.createDataChannel('o', { ordered: false, maxRetransmits: 0 }));
    this.adopt(pc.createDataChannel('r', { ordered: true }));
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signal({ sdp: { type: 'offer', sdp: offer.sdp ?? '' } });
    } catch {
      this.p2pFailed = true;
      this.emitStatus();
    }
  }

  private async onSignal(d: Signal): Promise<void> {
    try {
      if ('sdp' in d) {
        if (d.sdp.type === 'offer') {
          if (this.forceRelay || typeof RTCPeerConnection === 'undefined') return;
          const pc = this.newPc();
          await pc.setRemoteDescription(d.sdp);
          await this.flushCands();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.signal({ sdp: { type: 'answer', sdp: answer.sdp ?? '' } });
        } else if (this.pc) {
          await this.pc.setRemoteDescription(d.sdp);
          await this.flushCands();
        }
      } else if (this.pc?.remoteDescription) {
        await this.pc.addIceCandidate(d.cand);
      } else {
        this.pendingCands.push(d.cand);
      }
    } catch {
      /* stale or malformed signal: relay keeps working */
    }
  }

  private async flushCands(): Promise<void> {
    const c = this.pendingCands;
    this.pendingCands = [];
    for (const cand of c) await this.pc?.addIceCandidate(cand).catch(() => {});
  }

  private signal(d: Signal): void {
    this.conn.send({ k: 'sig', d });
  }

  close(): void {
    this.reset();
  }
}
