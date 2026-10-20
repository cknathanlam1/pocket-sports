import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEV_SERVER_PORT, WS_PATH } from '../shared/constants.ts';
import { Rooms } from './rooms.ts';
import { staticHandler } from './static.ts';

const port = Number(process.env.PORT ?? DEV_SERVER_PORT);
const distDir = resolve(import.meta.dirname, '../dist');
const serveStatic = existsSync(distDir) && process.env.NODE_ENV !== 'development' ? staticHandler(distDir) : null;

const http = createServer((req, res) => {
  if (req.url === '/healthz') return void res.writeHead(200).end('ok');
  if (serveStatic) return serveStatic(req, res);
  res.writeHead(404).end('Static files are served by Vite in dev (port 5173).');
});

const rooms = new Rooms();
const wss = new WebSocketServer({ server: http, path: WS_PATH });
const alive = new WeakMap<WebSocket, boolean>();

wss.on('connection', (ws) => {
  ws.binaryType = 'nodebuffer';
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));
  rooms.connect(ws);
  ws.on('message', (raw) => rooms.message(ws, String(raw)));
  ws.on('close', () => rooms.disconnect(ws));
  ws.on('error', () => ws.terminate());
});

// Detect dead sockets (phones that sleep or lose signal) so the display learns quickly.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, 5000);

setInterval(() => {
  const gone = rooms.sweep();
  if (gone.length) console.log(`[server] expired rooms: ${gone.join(', ')}`);
}, 30_000);

http.listen(port, () => {
  console.log(`[server] http+ws on :${port}${serveStatic ? ' (serving dist/)' : ' (ws only; Vite serves pages)'}`);
});
