/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTROLLER_PATH_RE, DEV_SERVER_PORT, DEV_CLIENT_PORT } from './shared/constants.ts';

// /p/:room is served by controller.html (same rewrite as server/static.ts in production).
const controllerRoute = (): Plugin => ({
  name: 'controller-route',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && CONTROLLER_PATH_RE.test(req.url.split('?')[0] ?? '')) req.url = '/controller.html';
      next();
    });
  },
});

// Optional mkcert certs for LAN HTTPS (see CLAUDE.md). Cloudflare Tunnel needs none.
const certDir = resolve(import.meta.dirname, 'certs');
const https = existsSync(resolve(certDir, 'cert.pem'))
  ? { cert: readFileSync(resolve(certDir, 'cert.pem')), key: readFileSync(resolve(certDir, 'key.pem')) }
  : undefined;

export default defineConfig({
  plugins: [controllerRoute()],
  server: {
    host: true,
    port: DEV_CLIENT_PORT,
    strictPort: true,
    https,
    allowedHosts: ['.trycloudflare.com'],
    proxy: { '/ws': { target: `ws://localhost:${DEV_SERVER_PORT}`, ws: true } },
  },
  build: {
    rolldownOptions: {
      input: {
        display: resolve(import.meta.dirname, 'index.html'),
        controller: resolve(import.meta.dirname, 'controller.html'),
      },
      // Vendor chunks change rarely, so they stay cached across deploys. three is display-only;
      // react is shared with the phone page.
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\/]three[\/]/ },
            { name: 'react', test: /node_modules[\/](react|react-dom|scheduler)[\/]/ },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
  test: { include: ['tests/**/*.test.ts'] },
});
