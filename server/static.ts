import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONTROLLER_PATH_RE } from '../shared/constants.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

/** Serves the Vite build. /p/:room → controller.html, / → index.html. */
export function staticHandler(distDir: string) {
  const root = resolve(distDir);
  return (req: IncomingMessage, res: ServerResponse): void => {
    let path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    if (path === '/') path = '/index.html';
    else if (CONTROLLER_PATH_RE.test(path)) path = '/controller.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const immutable = path.startsWith('/assets/');
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
  };
}
