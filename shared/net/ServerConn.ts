// Reconnecting WebSocket to our server (rooms, signaling, relay). Browser-only.
import { WS_PATH } from '../constants.ts';
import type { ClientMsg, ServerMsg } from '../protocol.ts';

type Handler = (m: ServerMsg) => void;

export class ServerConn {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private openHandlers = new Set<() => void>();
  private closed = false;
  private retryMs = 500;
  private echoTimer: ReturnType<typeof setInterval> | undefined;
  /** Round trip to the server (ms), refreshed every 2 s. */
  serverRtt: number | null = null;
  connected = false;

  constructor() {
    this.connect();
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${WS_PATH}`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.retryMs = 500;
      for (const h of this.openHandlers) h();
      clearInterval(this.echoTimer);
      this.echoTimer = setInterval(() => this.send({ k: 'echo', t0: performance.now() }), 2000);
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      if (m.k === 'echo') this.serverRtt = Math.round(performance.now() - m.t0);
      for (const h of this.handlers) h(m);
    };
    ws.onclose = () => {
      this.connected = false;
      clearInterval(this.echoTimer);
      if (this.ws === ws) this.ws = null;
      for (const h of this.handlers) h({ k: 'peer', up: false });
      if (!this.closed) {
        setTimeout(() => this.connect(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 5000);
      }
    };
  }

  send(m: ClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  /** Called on every (re)connect: rejoin/resume rooms here. Fires immediately if already open. */
  onOpen(h: () => void): () => void {
    this.openHandlers.add(h);
    if (this.connected) h();
    return () => this.openHandlers.delete(h);
  }

  /** Skip the backoff and reconnect immediately ("Rejoin now"). */
  reconnectNow(): void {
    if (this.connected) return;
    this.retryMs = 500;
    this.ws?.close();
    if (!this.ws) this.connect();
  }

  close(): void {
    this.closed = true;
    clearInterval(this.echoTimer);
    this.ws?.close();
  }
}
