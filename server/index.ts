import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import { DEV_SERVER_PORT, WS_PATH } from '../shared/constants.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';
import { staticHandler } from './static.ts';

const port = Number(process.env.PORT ?? DEV_SERVER_PORT);
const distDir = resolve(import.meta.dirname, '../dist');
const serveStatic = existsSync(distDir) && process.env.NODE_ENV !== 'development' ? staticHandler(distDir) : null;

const http = createServer((req, res) => {
  if (req.url === '/healthz') return void res.writeHead(200).end('ok');
  if (serveStatic) return serveStatic(req, res);
  res.writeHead(404).end('Static files are served by Vite in dev (port 5173).');
});

const wss = new WebSocketServer({ server: http, path: WS_PATH });

const send = (ws: import('ws').WebSocket, msg: ServerMsg) => ws.send(JSON.stringify(msg));

wss.on('connection', (ws) => {
  send(ws, { k: 'hello', serverTime: Date.now() });
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(raw)) as ClientMsg;
    } catch {
      return;
    }
    // M0: echo for connectivity checks. Rooms, signaling and relay arrive in M2.
    if (msg.k === 'echo') send(ws, { k: 'echo', t0: msg.t0, t1: Date.now() });
  });
});

http.listen(port, () => {
  console.log(`[server] http+ws on :${port}${serveStatic ? ' (serving dist/)' : ' (ws only; Vite serves pages)'}`);
});
