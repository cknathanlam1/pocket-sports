# Pocket Sports: phone-as-paddle table tennis

Browser game: the laptop renders a 3D table tennis match (Three.js); a phone joins by QR
code (no install) and becomes a motion-controlled paddle. Built milestone by milestone
(M0 scaffold → M5 deploy); see the build spec for the full plan. Current: **M0 done**.

## Commands
- `npm run dev`: ws server (:8787, `node --watch`) + Vite (:5173, proxies `/ws`). Open http://localhost:5173
- `npm run tunnel`: public HTTPS URL for phone testing (needs `cloudflared`, see below)
- `npm test` / `npm run test:watch`: Vitest (`tests/**/*.test.ts`)
- `npm run typecheck`: `tsc --noEmit` (strict)
- `npm run build && npm start`: production. One Node process serves `dist/` + `/ws` on `$PORT` (default 8787)

## Architecture
- `/design`: Claude Design export, read-only. **Visuals: /design wins. Behavior: the spec wins.**
- `/shared`: protocol types (`protocol.ts`), constants, `styles/tokens.css` (design tokens), server link
- `/engine`: pure TS (rules, physics, shot model, CPU). **No DOM/Three.js imports** so it is testable and can run server-side.
  All tuning values are in `engine/config.ts` (the dev panel exposes them).
- `/display`: laptop app at `/` (`index.html` → `display/main.tsx`). Three.js scene with an explicit rAF loop; React only for menus/overlays.
- `/controller`: phone app at `/p/:room` (`controller.html` → `controller/main.tsx`)
- `/server`: Node `http` + `ws`. Rooms, signaling, relay (M2). In dev it only does ws, and Vite serves pages.
- `/tests`: Vitest

Routing: `/p/:room` → `controller.html`, via a Vite middleware in dev (`vite.config.ts`) and `server/static.ts` in prod. Both use `CONTROLLER_PATH_RE`.

Conventions: TS strict + `erasableSyntaxOnly` (no enums or parameter properties) because the server runs `.ts`
directly on Node ≥22.18 type stripping. Import local files with explicit `.ts`/`.tsx` extensions and use `import type` for types.
Quaternions on the wire are `[x,y,z,w]`. Ask before adding dependencies beyond: vite, typescript, three, react, ws, vitest.

## Phone testing over HTTPS
iOS only exposes motion sensors in a secure context, so plain `http://<lan-ip>:5173` won't do.

**Option A: Cloudflare Tunnel (recommended; also works when the phone is on cellular or campus Wi-Fi isolates devices)**
1. Install once: `winget install --id Cloudflare.cloudflared` (macOS: `brew install cloudflared`)
2. `npm run dev`, then in a second terminal `npm run tunnel`
3. Open the printed `https://<random>.trycloudflare.com` on the laptop *and* use it for phone links. Vite already allows `*.trycloudflare.com`.
   Adds roughly 20–60 ms RTT, because traffic goes through Cloudflare. Use option B to measure true LAN latency.

**Option B: mkcert on the LAN**
1. Install mkcert (`winget install FiloSottile.mkcert`), then run `mkcert -install`
2. `mkdir certs && mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost <lan-ip>`
3. Install the root CA on the phone (`mkcert -CAROOT` → `rootCA.pem`). On iOS, install the profile, then enable full trust under
   Settings → General → About → Certificate Trust Settings. Android: Settings → Security → Install certificate → CA.
4. `npm run dev` now serves HTTPS automatically when `certs/cert.pem` exists. Open `https://<lan-ip>:5173`.

The `/p/XXXX` page doubles as a connectivity check: secure context, motion API, and server RTT.

## Status / known gaps
- /design not imported yet (Claude Design needs `/design-login` from an interactive Claude Code session).
  `shared/styles/tokens.css` holds placeholder values until then.
- The repo lives in OneDrive. Consider excluding `node_modules` from sync.
