// Minimal server WebSocket with an echo-based RTT probe. Used by both apps in M0.
import { WS_PATH } from './constants.ts';
import type { ServerMsg } from './protocol.ts';

export type LinkStatus = { connected: boolean; rttMs: number | null };

export function openServerLink(onStatus: (s: LinkStatus) => void): () => void {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}${WS_PATH}`);
    ws.onopen = () => {
      onStatus({ connected: true, rttMs: null });
      timer = setInterval(() => ws?.send(JSON.stringify({ k: 'echo', t0: performance.now() })), 1000);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMsg;
      if (msg.k === 'echo') onStatus({ connected: true, rttMs: Math.round(performance.now() - msg.t0) });
    };
    ws.onclose = () => {
      clearInterval(timer);
      onStatus({ connected: false, rttMs: null });
      if (!closed) setTimeout(connect, 1000);
    };
  };
  connect();
  return () => {
    closed = true;
    ws?.close();
  };
}
