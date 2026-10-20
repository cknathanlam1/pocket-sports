# Pocket Sports: phone-as-paddle table tennis

Browser game: the laptop renders a 3D table tennis match (Three.js); a phone joins by QR
code (no install) and becomes a motion-controlled paddle. Built milestone by milestone
(M0 scaffold → M5 deploy); see the build spec for the full plan. Current: **M3 built** (phone swing detection, lag-compensated phone hits, dev panel, sensor recording + replay tests) on top of the Claude Design reskin. Real-phone verification is pending.

## Commands
- Windows PowerShell blocks `npm.ps1`: use `npm.cmd ...` there (or Git Bash / cmd).
- `npm run dev`: ws server (:8787, `node --watch`) + Vite (:5173, proxies `/ws`). Open http://localhost:5173
- `npm run tunnel`: public HTTPS URL for phone testing (needs `cloudflared`, see below)
- `npm test` / `npm run test:watch`: Vitest (`tests/**/*.test.ts`)
- `npm run fixtures`: regenerate the synthetic sensor recordings in `tests/fixtures/recordings/`
- `npm run typecheck`: `tsc --noEmit` (strict)
- `npm run build && npm start`: production. One Node process serves `dist/` + `/ws` on `$PORT` (default 8787)

## Architecture
- `/design`: Claude Design reference, read-only: `tokens/` (design-system CSS, verbatim) and `SPEC.md` (a digest of every screen, game token, hit tier, motion/sound rule and the 3D asset list). **Visuals: /design wins. Behavior: the spec wins.**
  The raw `.dc.html` lives in Claude Design (link in `design/README.md`). Reading it from here needs `/design-login`, or Claude in Chrome with your claude.ai session.
- `/shared`: protocol types (`protocol.ts`), constants, net (`ServerConn`, `PeerLink`), `quat.ts`, `clock.ts`.
  `styles/`: `tokens.css` (DS tokens in `ds/` + game tokens like `--p1`/`--p2`/`--ball`/`--table`), `fonts.css`, and `game.css` (chunky buttons, chips, keyframes).
  Fonts: Poppins + Caveat from Google Fonts, Open Sauce One from Fontsource on jsDelivr (pinned 5.3.0).
  `art/`: React ports of the design components (`Char` with poses and looks, `Paddle`, `HandPhone`, `Wordmark`/`BigLogo`/`Sunburst`/`StampWord`).
- `/engine`: pure TS (rules, physics, shot model, CPU). **No DOM/Three.js imports** so it is testable and can run server-side.
  All tuning values are in `engine/config.ts` (the dev panel exposes them).
- `/display`: laptop app at `/` (`index.html` → `display/main.tsx`). Three.js scene with an explicit rAF loop; React only for menus/overlays.
- `/controller`: phone app at `/p/:room` (`controller.html` → `controller/main.tsx`)
- `/server`: Node `http` + `ws`. `rooms.ts` holds one display + one phone per 4-letter code (10 min idle expiry), forwards WebRTC signaling, and relays peer messages. A ws ping every 5 s drops dead sockets. In dev it only does ws, and Vite serves pages.
- `/tests`: Vitest

### Engine (`/engine`)
- `config.ts`: every tuning value (physics, shot model, assist, CPU table, serve, movement). `Game` reads it live, so the dev panel (M3) can mutate it.
- `physics.ts`: ball step at 240 Hz in *sim* time (RK2), gravity + drag + Magnus, swept collision vs table/net/floor, spin-coupled table bounce (Coulomb friction, hollow-sphere inertia).
  Deviation from the spec: Magnus lift saturates above spin ratio r|ω|/|v| = `magnusMaxSpinRatio` (0.5). The spec's linear formula lets heavy backspin out-lift gravity, so some shots couldn't land.
- `solver.ts`: simulate-and-correct launch solver (2×2 Broyden on the aim point). It searches outward from the intended pace when no trajectory at that pace lands and clears the net. `solveServe` targets the 2nd bounce.
- `shot.ts`: swing features → intent (timing → lateral, face → depth/arc, peak → pace, path → top/back, roll → side) → `resolveShot` (scatter, assist pull-back, injected borderline errors).
- `rules.ts` (score/serve rotation/deuce/match), `referee.ts` (lets, faults, point reasons from ball events), `cpu.ts` (shot choice per level).
- `game.ts`: orchestrator. `update(realDt)` accumulates realDt × `gameSpeed` into fixed steps. `swing(side, ageRealSec, features)` is lag-compensated:
  it looks up the ball at the swing moment in a ring buffer, judges timing against the predicted ideal contact (apex after the bounce, or 0.3 m past the end line),
  then re-simulates the struck ball forward to now. Players auto-move to the predicted contact (CPU after its reaction delay).
- Coordinates: x lateral (+x = near player's right), y up, z along the table (+z = near/human end), net at z = 0. Side 0 = near, side 1 = far.

### Display (`/display`)
- `runtime.ts` owns renderer, `World` (scene/World.ts: primitives venue, table, avatars, paddle, ball, blob shadow, trail, camera), input, and the current `Game`.
  The menu shows a CPU-vs-CPU attract match. In dev, `window.pocket` exposes the runtime for scripted playtests.
- `input/PaddleInput.ts` is the swappable input interface. `MouseInput`: mouse Y = face, click / sideways flick = swing (pace from mouse speed), W/S = top/backspin, A/D = sidespin, Space = toss.
- `store.ts` + `ui/`: React screens on a 1440×900 stage scaled to the window (`ui/Stage.tsx`), named after the design ids:
  title 7a → pairing 2a/2b → calibrate 2c (live tilt/roll mirror) → menu 2g (+ settings) → setup 2i → match HUD 2j–2o (score cards, rally pill, phone pill, banners, coach hint,
  hit tiers 7c/7d, POINT! 7e, match-point glow) → paused 2p / connection lost 2r → results 2q. Customize 2h saves a look to localStorage.
  Phone taps drive the whole flow: menu → setup → start; pause button toggles pause. Hit tiers: Nice < 35 km/h, Great 35–55, SMASH 55+ or |timing| < 20 ms
  (hit-stop 40/80 ms, camera shake, flash). In dev, `window.pocketStore` exposes the UI store.
- Not built yet from the design: tutorial 2d–2f (needs phone swings, M3), practice mode and sound (M4), 3D poses beyond swing (cheer/sad).

### Pairing + transport (M2)
- `shared/protocol.ts`: peer messages (`PhoneMsg`/`DisplayMsg`, short keys) and client↔server messages (create/resume/join/sig/relay).
- `shared/net/ServerConn.ts`: reconnecting WebSocket. `shared/net/PeerLink.ts`: relay through the server carries traffic as soon as the peer is present. WebRTC (display offers; channels `o` unordered with maxRetransmits 0, and `r` reliable) takes over once open.
  It reports `relay` if P2P isn't up in 3 s, but still upgrades if P2P connects later. Lossy kinds (`o`, `ping`, `pong`) use `o`. Add `?relay` to either page's URL to force relay.
- `shared/clock.ts`: phone pings, laptop pongs (t0,t1,t2), and the lowest-RTT sample of 10 wins. Rounds run on connect, on transport change, and every 10 s. The phone reports `{sync: off, rtt}` and the laptop converts phone timestamps with `off`.
- Laptop: `display/net/PhoneHost.ts` owns the room (it survives reloads via sessionStorage + token) and feeds `display/input/PhoneInput.ts` (paddle = q0⁻¹·q).
  `runtime.ts`: a phone tap starts a match / resumes / tosses. Losing the phone mid-match auto-pauses and shows the reconnect QR. `st` UI state and `hit` feedback go to the phone.
- Phone (`/controller`): `orientation.ts` (W3C alpha/beta/gamma → quaternion, pure), `sensors.ts` (iOS permission from the tap, orientation stream, wake lock, portrait lock, vibrate), `session.ts` (join, link, clock sync, 60 Hz `o` stream, calibration), `main.tsx` (screens 3a–3l, plus the 7f SMASH flood with tier-based vibration).
  Calibration pose: phone upright, screen toward the player. In that pose the device axes equal the paddle axes, so q0⁻¹·q drives the on-screen paddle directly. Motion is judged by events arriving, not by the permission answer.

### Swings (M3)
- `controller/motion.ts` (pure, replayable): `RateAdapter` → `SwingDetector` → `MotionPipeline`. Browsers disagree on rotationRate axis labels and units, so the adapter starts with the
  W3C mapping and **auto-calibrates**: it compares rotationRate against the ω derived from successive orientation quaternions, then locks the best of 96 signed permutation × unit candidates.
- Detector: |ω| ≥ `swing.onsetDegPerSec` starts tracking. The swing is emitted once |ω| < peak × `peakDropRatio`, stamped at the parabolic-refined peak; refractory `refractoryMs`.
  Features: peak |ω|; face = paddle pitch vs calibration (+ = open: the phone's back tilts up); path = −mean ω_x (+ = upward brush/topspin); roll = mean ω about `swing.rollAxis`.
  **Deviation:** the spec says roll is about the phone's long axis (y), but with the phone held upright the main swing rotates about y, so every swing would get sidespin.
  The default is `z` (screen normal, steering-wheel twist). Switch in the dev panel.
- Phone sends `s` (reliable channel, phone clock) and |ω| inside `o`. The laptop converts with the clock offset; `Game.swing` judges at the swing moment
  (ring buffer = `hit.ringBufferMs` of real time) and re-simulates forward.
- Dev panel on the laptop (backtick key): link/RTT/clock offset, a |ω| graph with swing markers, last swing features + delivery lag, last hit timing, and sliders for every numeric
  config value (saved to localStorage via `display/devConfig.ts`; "Copy config"). Swing params are pushed to the phone live (`cfg` message).
- Phone dev mode `/p/CODE?dev`: Record button → raw sensor JSON (share sheet or download). Add `expected.peaks` (ms) and drop it into `tests/fixtures/recordings/`.
  `tests/swing.test.ts` replays every file there; the current iPhone/Android files are synthetic (60 Hz / 100 Hz + jitter), so replace them with real ones.

Routing: `/p/:room` → `controller.html`, via a Vite middleware in dev (`vite.config.ts`) and `server/static.ts` in prod. Both use `CONTROLLER_PATH_RE`.

Conventions: TS strict + `erasableSyntaxOnly` (no enums or parameter properties) because the server runs `.ts`
directly on Node ≥22.18 type stripping. Import local files with explicit `.ts`/`.tsx` extensions and use `import type` for types.
Quaternions on the wire are `[x,y,z,w]`. Ask before adding dependencies beyond: vite, typescript, three, react, ws, vitest, qrcode-generator.

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

The laptop QR encodes `location.origin`, so open the laptop page via the tunnel URL (not localhost) before scanning. The menu warns when it is on localhost.
Desktop testing without a phone: open `/p/CODE` in a mobile-sized tab and dispatch `DeviceOrientationEvent`s from the console. The tap on Enable motion must be a real click.

## Status / known gaps
- Mouse swings still work alongside the phone (useful for testing).
- Testing in the hidden Claude browser pane throttles rAF, and with the 0.1 s frame clamp the game then runs slower than real time. Judge timing feel on a real, visible screen.
- Not yet verified on a real iPhone/Android, or on cellular. No TURN server: symmetric NATs fall back to the relay by design.
- Audio, dev panel, practice mode: M3–M4.
- /design not imported yet (Claude Design needs `/design-login` from an interactive Claude Code session).
  `shared/styles/tokens.css` holds placeholder values until then.
- The repo lives in OneDrive. Consider excluding `node_modules` from sync.
