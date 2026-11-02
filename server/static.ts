import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { brotliCompressSync, gzipSync, constants as zlib } from 'node:zlib';
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

const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg']);

/** Sent with every response (pages and assets). Motion sensors must stay allowed for the phone. */
export const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
};

interface Entry {
  type: string;
  cache: string;
  etag: string;
  raw: Buffer;
  br?: Buffer;
  gz?: Buffer;
}

/**
 * Serves the Vite build from memory (dist/ is small), precompressed with brotli/gzip on first request.
 * /p/:room → controller.html, / → index.html. Hashed /assets/ are immutable; pages revalidate by ETag.
 */
export function staticHandler(distDir: string) {
  const root = resolve(distDir);
  const cache = new Map<string, Entry | null>();

  const load = (path: string): Entry | null => {
    if (cache.has(path)) return cache.get(path)!;
    const file = normalize(join(root, path));
    let entry: Entry | null = null;
    if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) {
      const ext = extname(file);
      const raw = readFileSync(file);
      entry = {
        type: MIME[ext] ?? 'application/octet-stream',
        cache: path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        etag: `"${statSync(file).mtimeMs.toString(36)}-${raw.length.toString(36)}"`,
        raw,
      };
      if (COMPRESSIBLE.has(ext) && raw.length > 1024) {
        entry.br = brotliCompressSync(raw, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11 } });
        entry.gz = gzipSync(raw, { level: 9 });
      }
    }
    // Misses are cached too, but capped, so random 404 probes can't grow the map without bound.
    if (entry || cache.size < 512) cache.set(path, entry);
    return entry;
  };

  return (req: IncomingMessage, res: ServerResponse): void => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD', ...SECURITY_HEADERS }).end();
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    } catch {
      res.writeHead(400, SECURITY_HEADERS).end('Bad request');
      return;
    }
    if (path === '/') path = '/index.html';
    else if (CONTROLLER_PATH_RE.test(path)) path = '/controller.html';
    const e = load(path);
    if (!e) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }).end('Not found');
      return;
    }
    const headers: Record<string, string | number> = { 'content-type': e.type, 'cache-control': e.cache, etag: e.etag, vary: 'accept-encoding', ...SECURITY_HEADERS };
    if (req.headers['if-none-match'] === e.etag) {
      res.writeHead(304, headers).end();
      return;
    }
    const accept = String(req.headers['accept-encoding'] ?? '');
    let body = e.raw;
    if (e.br && /\bbr\b/.test(accept)) {
      body = e.br;
      headers['content-encoding'] = 'br';
    } else if (e.gz && /\bgzip\b/.test(accept)) {
      body = e.gz;
      headers['content-encoding'] = 'gzip';
    }
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
