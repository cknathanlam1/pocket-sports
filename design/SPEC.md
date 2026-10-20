# Pocket Sports design digest

Transcribed from `Pocket Sports Design.dc.html` (Claude Design). Sections keep the design's ids (7a, 2j, 3e…).

## Brand
- **Name:** Pocket Sports. Wordmark = Poppins 800, tracking −4.5%: "POCKET" cobalt (or cream on cobalt), "SPORTS" coral.
- **7a Expressive logo** (title, menu and win screens only, never in play): Poppins ExtraBold, −6 tracking, 24px ink stroke + 14px solid ink drop (no blur).
  POCKET in lagoon `#5CCFE0`, SPORTS in vivid coral `#FD6E45`, lockup tilted −5°, on a cobalt sunburst (20° rays, `#255DB7`/`#3D74CF`)
  rotating 40 s/rev with a sun glow behind. Idle: lockup breathes 1.00→1.06 every 2.4 s; ball mark bobs 18px. Freeze when reduced motion is on.
  Tagline pill: "Your phone is the paddle." (sun fill, 4px ink border, `0 7px 0` ink shadow, −2°).
- App / QR badge: "PS" in lagoon with ink stroke on a cobalt rounded square plus a sun ball.
- Script line (Caveat): "swing your phone. win the poolside…"

## Game tokens (06 handoff)
| token | value |
|---|---|
| --p1 | `#2F6FDB` ● circle |
| --p2 | `#FF8A1F` ◆ diamond |
| --ball | `#FFD23F` |
| --table | `#1FA59B` (edge/legs `#137A73`) |
| --pool | `#5CCFE0` |
| --win / --lose | `#2E8B57` ✓ / `#D65F3A` ✕ |
| --phone-bg | `#1B4AA8` |
| deck sand / sky | `#F6DDB0` / `#9FD8FF` (sky gradient `#3FB8FF`→`#C9F0FF`) |
| ink | `#10285A` (3px borders everywhere) |

Type: display-xl Poppins 800 120/0.95 −4% · display 800 64/1 −3% · h1/h2 Poppins 700 40/28 · body Open Sauce 400 20/1.4 · label Open Sauce 600 16 ·
caption Open Sauce 500 14 (min) · phone-huge Poppins 800 72/56 · note Caveat 600 28–40 (coach hints only, one per screen max).
Spacing 4px base; laptop margins 36 (HUD) / 72 (screens); phone gutter 24–28; phone tap min 96px tall, full width.
Radii: chip 99, card 18–22, panel 28, phone 44. Shadows: buttons `0 5px 0` darker fill; cards `6–8px 8px 0` cobalt.
Motion: ease-out `cubic-bezier(.2,.8,.2,1)`, pop `cubic-bezier(.34,1.56,.64,1)`; fast 120ms (flash, press), base 340ms (score, banners), slow 420ms (panels).
Players always carry shape + color (● P1 / ◆ P2), so color is never the only cue.

## Components (05)
- **Buttons (laptop, 72–104px tall, 4px press-down):** primary coral `#E57A58` + `0 5px 0 #B44A29` (one per screen); secondary cream + ink `0 5px 0 #10285A`;
  pressed `#D65F3A` + `0 1px 0`; focus = 5px sun ring; disabled `#E6DFD0` fill, `#5A6F99` text, `#CFC5B0` border. Segments: selected cobalt fill, white text.
- **HUD score card:** 330×96, cream, 3px player-color border + `0 5px 0` player color; avatar disc/diamond, name, game dots (filled = won), score 64px/800.
  Server = small sun ball beside the name. Score change: number slides up 24px and settles with a bounce, "+1" chip pops above for 800ms.
- **Rally pill:** "Rally N" (count in coral) + "Best of 3 · Game N" caption, top center.
- **QR + room code:** QR on white with a 20px quiet zone; code letters on sun tiles with ink border + `0 4–5px 0` ink.
  (Design shows digits like "K7QM"; the build spec's 4-letter alphabet wins.)
- **Connection indicator (dot + word):** Good `#2E8B57` circle · Weak `#F5C12B` rounded square · Lost `#D65F3A` square.
- **Toasts (bottom-center, 3 s):** "Phone recalibrated" (cobalt-50), "Customization saved" (green bg), "Weak connection — move closer to Wi‑Fi" (sun-100).

## Laptop screens (1440×900)
- **2a Pairing — waiting:** scene behind a cream 62% wash; floating cream card (3px cobalt border, `8px 8px 0` cobalt). QR left ("Point your camera here").
  Right: wordmark, "Scan to grab your paddle", "Open your phone camera, scan the code, and tap the link.", ROOM CODE tiles,
  Player 1 slot (dashed, "Waiting for phone…") and Player 2 slot (dashed, "COMING SOON"). Footer Caveat: "no app to install · works on iPhone & Android".
- **2b Pairing — connected:** QR fades to 25% under a green ✓ disc; "You’re in! Nice paddle." / "Hold your phone like a paddle, pointed at the screen. Next: quick calibration."
  Player 1 slot solid P1 border, avatar shows the character, "● Connected".
- **2c Calibration mirror:** left cobalt panel: "STEP 1 OF 2 · CALIBRATE", "Hold it like a paddle. Point at the screen.",
  "Then tap **Calibrate** on your phone. Double-tap the phone anytime to reset.", phone mock + Caveat "what your phone is asking for →".
  Right: target rings with a live paddle that copies the phone's tilt, a "Tilt +14° · Roll −3°" readout, a "Motion live" pill,
  and "Waiting for you to tap Calibrate on the phone…".
- **2d–2f Tutorial 1–3 (timing / tilt / spin):** header with wordmark, 3-step progress, "Skip tutorial ›". Big title + body, HandPhone illustration in a sun disc,
  a meter with a green zone and live marker, a success card ("Perfect timing!", "Nice lob!", "Topspin!"). Needs phone swings (M3).
- **2g Main menu:** wordmark top-left; stacked 104px buttons: Play vs CPU (coral, "Best of 3"), Practice ("No score"), Customize ("Look & outfit"),
  Settings ("Sound · Assist"); SPORTS card: Table Tennis (PLAY NOW) + Beach Volley / Mini Golf / Archery (COMING SOON, dashed);
  bottom-left pill "Phone connected · Player 1 ●".
- **2h Customization:** left sun panel with a large character + "↺ Turn" / "Preview swing"; right "Make it yours": SKIN TONE, HAIR, OUTFIT COLOR swatches
  (selected = 4px ink + sun ring + ✓). Note: "Your paddle and score badge stay Player Blue ● whatever you wear." Save (coral) / Randomize.
- **2i Match setup:** "Match setup" / "You vs CPU · Table tennis". Rows: CPU difficulty (Easy "Slow, forgiving" / Normal "Fair fight" / Hard "Fast, tricky spin"),
  Assist level ("Easy widens your timing window. Pro is exactly what you swing."), Match length ("First to 11 wins a game (win by 2)." Best of 1 ~4 min / 3 ~10 / 5 ~16).
  Footer: ‹ Back, Caveat summary "Normal CPU · Normal assist · Best of 3", coral "Serve it up ›".
- **2j–2p In-game:** P1 card top-left ("You"), P2 card top-right ("Marlo", CPU), rally pill top-center, phone pill bottom-right ("Phone · Good").
  Banners (center, 230px from top): Point! ✓ green `#5DC265` + sub "Winner · 52 km/h"; Missed it ✕ blush `#F6BAC8` + sub e.g. "Swung a touch late";
  Deuce = sun + "Win two points in a row"; Match point ★ orange + "One point to win it all" + sun/orange edge glow around the screen.
  Hint (Caveat 36, cream pill, bottom): "Tap your phone to toss, then swing!", "Next serve: Marlo".
  Paused modal (ink 55% scrim): "Paused", "Phone: tap the pause button to resume, or pick here.", Resume (coral), Recalibrate phone, Quit to menu.
- **2q Results:** sun background with confetti; big character (left); "You win!" 100px; chips "● You 2", "◆ Marlo 0", game scores "11–8 · 11–6";
  stat cards: Longest rally, Fastest shot (km/h), Winners, Errors (each with "Marlo: N"); Rematch (coral) / Menu.
- **2r Connection lost (auto-paused):** ink 62% scrim; card with coral border/shadow: QR, "PHONE DISCONNECTED · GAME PAUSED", "Lost your paddle!",
  "Reopen the link on your phone, or scan this code. Your score (6–6) is safe.", ROOM code tile, Caveat "trying to reconnect automatically…".

## 07 Expressive pass: game-show energy
- **Cast (7b):** big-head humans: head 40% of height, ears out, no neck, 4.5px ink outline at 200px. Poses: idle, ready (small bounce), squash (wind-up, brows down),
  swing (mouth open), cheer (jump 16px), sad (slump + tear). Every gameplay event maps to a pose + face held ≥300ms.
  Team color on shirt, sleeves, shoe stripe, paddle; ●/◆ marker on shirt back and paddle face.
- **Hit tiers (7d):**
  | tier | when | hit-stop | burst | shake | haptic |
  |---|---|---|---|---|---|
  | Nice! (cobalt on cream) | clean return, < 35 km/h | — | small sparkle | none | 10ms tick |
  | Great! (sun on lagoon) | 35–55 km/h or edge-near | 40ms | star + ring | 5px · 2 hits | 25ms |
  | SMASH! (sun on coral) | 55+ km/h or perfect timing | 80ms + flash | star, ring, rays | 16px · 4 hits | 40 · 40ms double |
- **SMASH timeline:** 0ms contact, paddle squash, hit-stop → 80ms 1-frame white flash, star burst, ring → 120ms camera shake, 4 decaying hits →
  200ms "SMASH!" slams 3×→1× at −7° with a bounce → 360ms ball rockets out, ghost trail, rays fade → 1.6s stamp floats up and out, crowd "OOOH".
- **7e POINT!:** cobalt wash, confetti, sun ray burst, cheering character, "POINT!" stamp (lime `#5DC265`, ink stroke, pulsing), score cards with "+1",
  footer pill "9-hit rally · 61 km/h winner".
- **7f Phone on SMASH:** background floods team color, rays spin once, "SMASH!" sun text with ink outline, chip "61 km/h · rally 9";
  returns to paddle idle after 600ms. Double haptic (40ms · 30ms gap · 40ms) where vibration exists.

## Phone screens (390×844, portrait locked, screen stays awake)
- **3a Joining:** wordmark, sun ball disc, "Joining room ABCD", progress bar, "Finding your laptop…".
- **3b Motion permission:** HandPhone (tilt) in a sun disc, "Turn your phone into a paddle", "We read tilt and swing only. Nothing is recorded.", coral "Allow motion".
- **3c Calibrate:** "Point at the laptop", "Hold it like a paddle, then tap.", HandPhone (hold), 150px coral "Calibrate", Caveat "double-tap anytime to recalibrate".
- **3d Paddle idle:** phone-bg `#1B4AA8`, glowing P1 paddle (260), pause button top-left (64px cream circle), "OK" status pill top-right, hint "Double-tap to recalibrate".
- **3e Serve:** sun background, "TAP TO TOSS" (72px ink), paddle 190, "then swing!", hint "Your serve".
- **3f Hit flash:** cobalt-50 bg, white flash 120ms, paddle 1.12× tilted −8°, two blue rings expand and fade.
- **3g Between points:** paddle at 55% opacity, score "5 – 3" (72px cream), "✓ Point!" (lime) or a loss line, hint "Next serve: you".
- **3h Paused:** "Game paused", "Your match is waiting on the laptop.", coral Resume.
- **3i Reconnecting:** "Reconnecting…", "Hang on — we’re finding your laptop. The game is paused.", "Rejoin now".
- **3j Motion blocked:** "Motion is blocked", steps "1. Settings › Safari › Motion & Orientation Access / 2. Switch it on / 3. Come back and tap Try again", Try again.
- **3k Unsupported browser:** "Try a different browser", "This browser can’t read motion. Open this link in Safari (iPhone) or Chrome (Android).", Copy link.
- **3l Room not found:** "Room not found", "That code isn’t active. Check the 4 letters on your laptop, or scan the QR code again.", Scan again.
- Design note says "no haptics (visual + laptop sound only)"; the build spec asks for `navigator.vibrate` on Android, so the spec wins (visual flash is shown everywhere).

## Motion (04)
- Phone hit flash 120ms (see 3f). Ball trail above 45 km/h: four fading ghosts shrinking 35%.
- Score change 340ms bounce + "+1" chip 800ms. Point won 1.6s: banner stamps in with ✓, player hops, pool splash; phone shows "✓ Point!".
- Point lost 1.4s: banner slides in with ✕, short and soft; player shrugs; phone dims paddle to 55%. No harsh red flash.
- Serve toss 600ms: ball rises with a slow-down at apex, shadow shrinks; phone turns yellow "Tap to toss", then paddle idle once tossed.

## Sound (laptop)
Paddle hit: three layers (soft tock → crisp tick → sharp crack) by swing speed, pitch rises with power. Table bounce: hollow "pok", volume by height, pan by side.
Net: soft thud + mesh rustle; edge cord tiny "tick". Crowd: pool ambience, clap on point, "ooh" on long rally, cheer on win.
UI: rounded marimba blips; connect rising two-note, disconnect falling two-note. Stingers: match point low pulse, deuce drumroll, win jingle (2s).

## Control cheat sheet (tutorial + settings help)
When you swing: timing. Early pulls the ball across the table; late pushes it the other way. · Paddle tilt: open face = higher, softer; closed = low drive. ·
Swing speed: ball speed. · Wrist roll: topspin, backspin, sidespin (build spec copy: brush up for topspin, chop down for backspin, roll your wrist for sidespin). ·
Swing side: forehand or backhand, automatic. · Serve: tap the phone to toss, then swing.

## 3D asset list (06b; stylized low-poly, flat-shaded toon ramp, ≤2K textures)
| asset | notes | budget | rig / anims |
|---|---|---|---|
| Character base | chunky ~3-heads-tall body, mitten hands; swappable head, 6 hair, outfit tint, 6 skin tones | ≤6k tris, 1 atlas | idle, ready, forehand, backhand, serve, celebrate, shrug |
| CPU "Marlo" | same base, unique hair (bun), orange outfit with ◆ patch | shares base | + taunt |
| Paddle | oversized round face, white rim, wood grip, ●/◆ decal, tint per player | ≤800 | parented to hand |
| Ball | sun yellow, ink outline shader, always-on blob shadow, trail ribbon | ≤300 | squash on bounce |
| Table + net | lagoon top, white lines, dark teal edge + legs, translucent net, white tape | ≤2k | net wobble |
| Pool deck | sand tiles, pool with water shader, back rail, hotel facade | ≤20k | water scroll |
| Props | 2 palms, 3 umbrellas, loungers, towel stacks (HUD is 2D) | ≤8k | palm sway |
| Crowd | 12 billboard/low-poly spectators, 6 outfits | ≤150 each | idle, clap, cheer |
| Sky + lighting | soft sun, toon ramp, gradient dome, cloud cards | 1 dome | — |
| VFX | splash, confetti, hit spark, trail, table bounce ring | sprites | — |

Venue key art (Scene): sky gradient + sun; two facades (cream, blush) with blue windows; palms left/right; bunting line with colored flags;
sand deck with tile lines; pool strips both sides with floats; crowd row behind a cream rail; lagoon table with white lines; camera behind and above P1.

Customization options: skin `#F1C9A0 #E8B48A #C98B5B #8A5A3A #5A3A28 #3A261A`; hair `#1E1410 #3B2A20 #8A5A3A #E57A58 #FFD23F #7FA2DC`;
outfit `#2F6FDB #FF8A1F #5DC265 #F29FB3 #FFD23F #10285A`; hair styles short, bun, curly, spiky.
Default P1: skin `#C98B5B`, hair `#1E1410` short. Marlo: skin `#F1C9A0`, hair `#E57A58` bun, outfit `#FF8A1F`.
