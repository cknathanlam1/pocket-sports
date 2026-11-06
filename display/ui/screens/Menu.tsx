// 2g Main menu (+ Settings sheet), 2i Match setup.
import { Wordmark } from '../../../shared/art/Logo.tsx';
import type { Runtime } from '../../runtime.ts';
import { type MenuSettings, store, useUi } from '../../store.ts';
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
  const { settings, settingsOpen, phone } = useUi();
  const items = [
    { t: 'Play vs CPU', s: `Best of ${settings.bestOf}`, ic: '▶', primary: true, on: () => rt.go('setup') },
    { t: 'Play a friend', s: 'Online', ic: '⇄', on: () => rt.openVersus() },
    { t: 'Practice', s: 'Ball machine', ic: '○', on: () => rt.startPractice() },
    { t: 'Customize', s: 'Look & outfit', ic: '☺', on: () => rt.go('customize') },
    { t: 'Settings', s: 'Sound · Assist', ic: '⚙', on: () => store.set({ settingsOpen: true }) },
  ];
  const sports = [
    { n: 'Table Tennis', tag: 'PLAY NOW', live: true },
    { n: 'Beach Volley', tag: 'COMING SOON' },
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
              {sports.map((s) => (
                <div key={s.n} className={`sport ${s.live ? 'live' : ''}`}>
                  <div className="sport-ic" />
                  <div className="sport-name">{s.n}</div>
                  <div className={`sport-tag ${s.live ? 'live' : ''}`}>{s.tag}</div>
                </div>
              ))}
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

const SETUP: Array<{ key: keyof MenuSettings; t: string; d: string; o: Array<[MenuSettings[keyof MenuSettings], string, string]> }> = [
  { key: 'cpuLevel', t: 'CPU difficulty', d: 'How fast and accurate Marlo plays.', o: [['easy', 'Easy', 'Slow, forgiving'], ['normal', 'Normal', 'Fair fight'], ['hard', 'Hard', 'Fast, tricky spin']] },
  { key: 'assist', t: 'Assist level', d: 'Easy widens your timing window. Pro is exactly what you swing.', o: [['easy', 'Easy', 'Big timing window'], ['normal', 'Normal', 'Some help'], ['pro', 'Pro', 'No help']] },
  { key: 'bestOf', t: 'Match length', d: 'First to 11 wins a game (win by 2).', o: [[1, 'Best of 1', '~4 min'], [3, 'Best of 3', '~10 min'], [5, 'Best of 5', '~16 min']] },
];

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function Setup({ rt }: { rt: Runtime }) {
  const { settings, phone } = useUi();
  const summary = `${cap(settings.cpuLevel)} CPU · ${cap(settings.assist)} assist · Best of ${settings.bestOf}`;
  return (
    <>
      <div className="wash" style={{ background: 'var(--cream-100)' }} />
      <Stage>
        <div className="setup" data-ui>
          <div className="setup-head">
            <div className="h-display">Match setup</div>
            <div className="setup-vs">You vs CPU · Table tennis</div>
          </div>
          {SETUP.map((g) => (
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
          <div className="setup-foot">
            <button className="btn" onClick={() => rt.go('menu')}>
              ‹ Back
            </button>
            <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
              <div className="script" style={{ font: '600 30px var(--font-script)', color: 'var(--coral-600)' }}>
                {phone.phone === 'calibrated' ? `${summary} · tap your phone to start` : summary}
              </div>
              <button className="btn primary big" onClick={() => rt.startMatch(settings)} autoFocus>
                Serve it up ›
              </button>
            </div>
          </div>
        </div>
      </Stage>
    </>
  );
}
