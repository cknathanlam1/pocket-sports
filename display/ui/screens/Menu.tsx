// 2g Main menu (+ Settings sheet), 2i Match setup.
import { Wordmark } from '../../../shared/art/Logo.tsx';
import type { Runtime } from '../../runtime.ts';
import { type MenuSettings, type Sport, store, useUi } from '../../store.ts';
import { Qr } from '../Qr.tsx';
import { Stage, Wash } from '../Stage.tsx';

export function PhonePill() {
  const { phone } = useUi();
  const ok = phone.phone === 'calibrated';
  return (
    <button className="chip phone-pill" onClick={() => !ok && store.set({ screen: 'pairing' })} data-ui>
      <span className="p1-dot" />
      {ok ? 'Phone connected · Player 1' : phone.phone === 'connected' ? 'Phone connected · calibrate it' : 'No phone · pair one ›'}
      <span className={`conn-shape ${ok ? 'good' : phone.phone === 'connected' ? 'weak' : 'lost'}`} />
    </button>
  );
}

export function Menu({ rt }: { rt: Runtime }) {
  const { settings, settingsOpen, phone, sport } = useUi();
  const volley = sport === 'volley';
  const items = [
    { t: 'Play', s: settings.players === 2 ? '2 players' : 'vs CPU', ic: '▶', primary: true, on: () => rt.go('setup') },
    { t: 'Play a friend', s: volley ? 'Online · table tennis' : 'Online', ic: '⇄', on: () => rt.openVersus() },
    { t: 'Practice', s: volley ? 'Table tennis' : 'Ball machine', ic: '○', on: () => rt.startPractice() },
    { t: 'Customize', s: 'Look & outfit', ic: '☺', on: () => rt.go('customize') },
    { t: 'Settings', s: 'Sound · Assist', ic: '⚙', on: () => store.set({ settingsOpen: true }) },
  ];
  const sports: Array<{ n: string; tag: string; id?: Sport }> = [
    { n: 'Table Tennis', tag: 'PLAY NOW', id: 'tt' },
    { n: 'Beach Volley', tag: 'NEW', id: 'volley' },
    { n: 'Mini Golf', tag: 'COMING SOON' },
    { n: 'Archery', tag: 'COMING SOON' },
  ];
  return (
    <>
      <Wash color="rgba(248,244,236,.5)" />
      <Stage>
        <div className="menu" data-ui>
          <Wordmark size={44} style={{ position: 'absolute', left: 72, top: 60 }} />
          <div className="menu-list">
            {items.map((m) => (
              <button key={m.t} className={`menu-item ${m.primary ? 'primary' : ''}`} onClick={m.on}>
                <span className="menu-ic">{m.ic}</span>
                {m.t}
                <span className="menu-sub">{m.s}</span>
              </button>
            ))}
          </div>
          <div className="sports-card panel-in">
            <div className="caption-caps muted-ink" style={{ fontSize: 14 }}>
              SPORTS
            </div>
            <div className="sports-grid">
              {sports.map((s) =>
                s.id ? (
                  <button key={s.n} className={`sport live ${sport === s.id ? 'picked' : ''}`} aria-pressed={sport === s.id} onClick={() => rt.setSport(s.id!)}>
                    <div className="sport-ic" />
                    <div className="sport-name">{s.n}</div>
                    <div className="sport-tag live">{sport === s.id ? 'SELECTED ✓' : s.tag}</div>
                  </button>
                ) : (
                  <div key={s.n} className="sport">
                    <div className="sport-ic" />
                    <div className="sport-name">{s.n}</div>
                    <div className="sport-tag">{s.tag}</div>
                  </div>
                ),
              )}
            </div>
          </div>
          <div style={{ position: 'absolute', left: 72, bottom: 44 }}>
            <PhonePill />
          </div>
          {phone.phone === 'calibrated' && <div className="menu-hint script">tap your phone to play</div>}
        </div>
        {settingsOpen && <Settings />}
      </Stage>
    </>
  );
}

function Settings() {
  const { settings, audio } = useUi();
  const set = (p: Partial<MenuSettings>) => store.set({ settings: { ...settings, ...p } });
  return (
    <div className="sheet-scrim" onClick={() => store.set({ settingsOpen: false })} data-ui>
      <div className="modal panel-in" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">Settings</div>
        <div className="setting-row">
          <div>
            <div className="row-title">Assist level</div>
            <div className="row-desc">Easy widens your timing window. Pro is exactly what you swing.</div>
          </div>
          <div className="seg-row">
            {(['easy', 'normal', 'pro'] as const).map((a) => (
              <button key={a} className={`seg small ${settings.assist === a ? 'on' : ''}`} onClick={() => set({ assist: a })}>
                {a[0]!.toUpperCase() + a.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <div className="row-title">Sound</div>
            <div className="row-desc">Hits, bounces and crowd, plus the poolside soundtrack.</div>
          </div>
          <div className="seg-row" style={{ alignItems: 'center' }}>
            <div className="vol-col">
              <label className="vol-row">
                <span>Effects</span>
                <input type="range" min={0} max={1} step={0.05} value={audio.volume} onChange={(e) => store.set({ audio: { ...audio, volume: +e.target.value, muted: false } })} />
              </label>
              <label className="vol-row">
                <span>Music</span>
                <input type="range" min={0} max={1} step={0.05} value={audio.music} onChange={(e) => store.set({ audio: { ...audio, music: +e.target.value, muted: false } })} />
              </label>
            </div>
            <button className={`seg small ${audio.muted ? 'on' : ''}`} aria-pressed={audio.muted} onClick={() => store.set({ audio: { ...audio, muted: !audio.muted } })}>
              {audio.muted ? 'Muted' : 'Mute'}
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <div className="row-title">Quick lesson</div>
            <div className="row-desc">Timing, paddle tilt and spin, in under a minute.</div>
          </div>
          <button className="btn small" onClick={() => store.set({ screen: 'tutorial', settingsOpen: false })}>
            Replay lesson
          </button>
        </div>
        <div className="setting-row">
          <div>
            <div className="row-title">Phone</div>
            <div className="row-desc">Double-tap your phone anytime to recalibrate.</div>
          </div>
          <button className="btn small" onClick={() => store.set({ screen: 'pairing', settingsOpen: false })}>
            Pair a phone
          </button>
        </div>
        <button className="btn primary" onClick={() => store.set({ settingsOpen: false })}>
          Done
        </button>
      </div>
    </div>
  );
}

type SetupRow = { key: keyof MenuSettings; t: string; d: string; o: Array<[MenuSettings[keyof MenuSettings], string, string]> };

const PLAYERS: SetupRow = { key: 'players', t: 'Players', d: 'Play the CPU, or a friend on this laptop with a second phone.', o: [[1, '1 player', 'vs CPU'], [2, '2 players', 'two phones']] };

const VOLLEY_LENGTH: SetupRow = { key: 'bestOf', t: 'Match length', d: 'Sets to 21 (win by 2); a deciding set to 15.', o: [[1, '1 set', '~6 min'], [3, 'Best of 3', '~15 min'], [5, 'Best of 5', '~25 min']] };

const SETUP: SetupRow[] = [
  { key: 'cpuLevel', t: 'CPU difficulty', d: 'How fast and accurate Marlo plays.', o: [['easy', 'Easy', 'Slow, forgiving'], ['normal', 'Normal', 'Fair fight'], ['hard', 'Hard', 'Fast, tricky spin']] },
  { key: 'assist', t: 'Assist level', d: 'Easy widens your timing window. Pro is exactly what you swing.', o: [['easy', 'Easy', 'Big timing window'], ['normal', 'Normal', 'Some help'], ['pro', 'Pro', 'No help']] },
  { key: 'bestOf', t: 'Match length', d: 'First to 11 wins a game (win by 2).', o: [[1, 'Best of 1', '~4 min'], [3, 'Best of 3', '~10 min'], [5, 'Best of 5', '~16 min']] },
];

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Local two-player: QR for player 2's phone and its status. */
function Player2Card() {
  // The second phone's room is created when "2 players" is picked (runtime store subscription).
  const { phone2 } = useUi();
  const url = phone2?.url ?? null;
  const state = phone2?.phone ?? 'none';
  return (
    <div className="setup-row">
      <div style={{ width: 360 }}>
        <div className="row-title big">Player 2's phone</div>
        <div className="row-desc">Scan with a second phone. It calibrates on the phone: hold it upright and tap.</div>
      </div>
      <div className="p2-card">
        <div className="qr-frame">{url ? <Qr text={url} size={120} /> : <div className="qr-placeholder small">…</div>}</div>
        <div className="vs-status">
          <span className={`conn-shape ${state === 'calibrated' ? 'good' : state === 'connected' ? 'weak' : 'lost'}`} />
          {state === 'calibrated' ? 'Player 2 ready' : state === 'connected' ? 'Connected · calibrate on the phone' : 'Waiting for player 2'}
          {phone2?.code && <span className="room-inline small">{phone2.code}</span>}
        </div>
      </div>
    </div>
  );
}

export function Setup({ rt }: { rt: Runtime }) {
  const { settings, phone, phone2, sport } = useUi();
  const two = settings.players === 2;
  const volley = sport === 'volley';
  const rows = [PLAYERS, ...SETUP.filter((g) => !(two && g.key === 'cpuLevel')).map((g) => (volley && g.key === 'bestOf' ? VOLLEY_LENGTH : g))];
  const p2Ready = phone2?.phone === 'calibrated';
  const summary = two ? `2 players · ${cap(settings.assist)} assist · Best of ${settings.bestOf}` : `${cap(settings.cpuLevel)} CPU · ${cap(settings.assist)} assist · Best of ${settings.bestOf}`;
  return (
    <>
      <div className="wash" style={{ background: 'var(--cream-100)' }} />
      <Stage>
        <div className="setup" data-ui>
          <div className="setup-head">
            <div className="h-display">Match setup</div>
            <div className="setup-vs">{two ? 'Player 1 vs Player 2' : 'You vs CPU'} · {volley ? 'Beach volley' : 'Table tennis'}</div>
          </div>
          {rows.map((g) => (
            <div key={g.key} className="setup-row">
              <div style={{ width: 360 }}>
                <div className="row-title big">{g.t}</div>
                <div className="row-desc">{g.d}</div>
              </div>
              <div className="setup-opts">
                {g.o.map(([v, l, s]) => (
                  <button key={String(v)} className={`setup-opt ${settings[g.key] === v ? 'on' : ''}`} onClick={() => store.set({ settings: { ...settings, [g.key]: v } })}>
                    <div className="opt-l">{l}</div>
                    <div className="opt-s">{s}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {two && <Player2Card />}
          <div className="setup-foot">
            <button className="btn" onClick={() => rt.go('menu')}>
              ‹ Back
            </button>
            <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
              <div className="script" style={{ font: '600 30px var(--font-script)', color: 'var(--coral-600)' }}>
                {two && !p2Ready ? 'waiting for player 2’s phone…' : phone.phone === 'calibrated' ? `${summary} · tap your phone to start` : summary}
              </div>
              <button className="btn primary big" onClick={() => rt.startMatch(settings)} disabled={two && !p2Ready} autoFocus>
                Serve it up ›
              </button>
            </div>
          </div>
        </div>
      </Stage>
    </>
  );
}
