// Mirrored laptop menus on the phone (menu 2g, setup 2i, results 2q) so the match can be set up from
// the phone in your hand. Every button sends an `act` message; the laptop stays the source of truth.
import { Wordmark } from '../shared/art/Logo.tsx';
import type { MenuMirror } from '../shared/protocol.ts';
import type { PhoneSession } from './session.ts';

type Key = 'cpuLevel' | 'assist' | 'bestOf';

const ROWS: Array<{ key: Key; title: string; opts: Array<[string | number, string, string]> }> = [
  { key: 'cpuLevel', title: 'CPU difficulty', opts: [['easy', 'Easy', 'Slow, forgiving'], ['normal', 'Normal', 'Fair fight'], ['hard', 'Hard', 'Fast, tricky spin']] },
  { key: 'assist', title: 'Assist level', opts: [['easy', 'Easy', 'Big timing window'], ['normal', 'Normal', 'Some help'], ['pro', 'Pro', 'No help']] },
  { key: 'bestOf', title: 'Match length', opts: [[1, 'Best of 1', '~4 min'], [3, 'Best of 3', '~10 min'], [5, 'Best of 5', '~16 min']] },
];

export function PhoneMenu({ s, menu, status }: { s: PhoneSession; menu: MenuMirror; status: React.ReactNode }) {
  if (menu.screen === 'setup') {
    return (
      <div className="screen cream pm">
        <div className="pm-top">
          <button className="chip pm-back" onClick={() => s.act({ k: 'act', a: 'back' })}>
            ‹ Back
          </button>
          {status}
        </div>
        <div className="p-title" style={{ alignSelf: 'flex-start' }}>
          Match setup
        </div>
        {ROWS.map((r) => (
          <div key={r.key} className="pm-row">
            <div className="pm-row-title">{r.title}</div>
            <div className="pm-opts">
              {r.opts.map(([v, l, sub]) => (
                <button key={String(v)} className={`pm-opt ${menu[r.key] === v ? 'on' : ''}`} aria-pressed={menu[r.key] === v} onClick={() => s.act({ k: 'act', a: 'set', key: r.key, v })}>
                  <span className="pm-opt-l">{l}</span>
                  <span className="pm-opt-s">{sub}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <button className="p-btn primary" onClick={() => s.act({ k: 'act', a: 'start' })}>
          Serve it up ›
        </button>
      </div>
    );
  }

  if (menu.screen === 'results') {
    return (
      <div className="screen pm results" style={{ background: menu.won ? 'var(--sun-300)' : 'var(--blush-100)' }}>
        <div className="pm-top end">{status}</div>
        <div className="pm-result-title">{menu.won ? 'You win!' : 'Marlo wins'}</div>
        {menu.games && (
          <div className="pm-chips">
            <span className="res p1">● You {menu.games[0]}</span>
            <span className="res p2">◆ Marlo {menu.games[1]}</span>
          </div>
        )}
        <button className="p-btn primary" onClick={() => s.act({ k: 'act', a: 'rematch' })}>
          Rematch
        </button>
        <button className="p-btn" style={{ marginTop: 0 }} onClick={() => s.act({ k: 'act', a: 'menu' })}>
          Menu
        </button>
      </div>
    );
  }

  // Main menu
  const summary = `${cap(menu.cpuLevel)} CPU · ${cap(menu.assist)} assist · Best of ${menu.bestOf}`;
  return (
    <div className="screen cream pm">
      <div className="pm-top end">{status}</div>
      <Wordmark size={34} />
      <div className="pm-list">
        <button className="pm-item primary" onClick={() => s.act({ k: 'act', a: 'play' })}>
          <span className="pm-ic">▶</span>
          Play vs CPU
        </button>
        <button className="pm-item" disabled>
          <span className="pm-ic">○</span>
          Practice
          <span className="pm-soon">SOON</span>
        </button>
      </div>
      <div className="script pm-summary">{summary}</div>
      <button className="p-btn" onClick={() => s.calibrate()}>
        Recalibrate paddle
      </button>
      <div className="pm-hint">Customize and settings are on the laptop.</div>
    </div>
  );
}

const cap = (x: string) => x[0]!.toUpperCase() + x.slice(1);
