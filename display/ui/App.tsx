import { useEffect, useState } from 'react';
import type { Runtime } from '../runtime.ts';
import { type MenuSettings, useUi } from '../store.ts';
import { ConnectionDot, PhonePanel } from './Phone.tsx';

type Opt<T> = { value: T; label: string };

function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Opt<T>[]; onChange: (v: T) => void }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Menu({ rt }: { rt: Runtime }) {
  const ui = useUi();
  const [s, setS] = useState<MenuSettings>(ui.settings);
  return (
    <div className="screen menu" data-ui>
      <div className="card">
        <h1 className="title">Pocket Sports</h1>
        <p className="subtitle">Table Tennis</p>
        <Segmented label="Opponent" value={s.cpuLevel} onChange={(cpuLevel) => setS({ ...s, cpuLevel })} options={[{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }]} />
        <Segmented label="Assist" value={s.assist} onChange={(assist) => setS({ ...s, assist })} options={[{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'pro', label: 'Pro' }]} />
        <Segmented label="Match" value={s.bestOf} onChange={(bestOf) => setS({ ...s, bestOf })} options={[{ value: 1, label: '1 game' }, { value: 3, label: 'Best of 3' }, { value: 5, label: 'Best of 5' }]} />
        {ui.phone.phone === 'calibrated' ? (
          <>
            <button className="primary" onClick={() => rt.startMatch(s)}>
              Start with phone
            </button>
            <p className="muted small">Or tap your phone. Swings still come from the mouse until phone swing detection lands (M3).</p>
          </>
        ) : (
          <button className="primary" onClick={() => rt.startMatch(s)}>
            Play with mouse
          </button>
        )}
      </div>
      <PhonePanel />
      <Controls />
    </div>
  );
}

function Controls() {
  return (
    <div className="card controls">
      <h3>Mouse controls</h3>
      <ul>
        <li><kbd>Space</kbd> toss the ball to serve</li>
        <li><kbd>Click</kbd> or flick the mouse sideways to swing. A faster mouse hits harder.</li>
        <li>Mouse <b>up</b> opens the paddle face (deeper, loopier). Mouse <b>down</b> closes it (flatter drive).</li>
        <li>Swing <b>early</b> to go cross-court, <b>late</b> to go down the line.</li>
        <li>Hold <kbd>W</kbd> to brush up for topspin, <kbd>S</kbd> to chop down for backspin, <kbd>A</kbd>/<kbd>D</kbd> to roll your wrist for sidespin.</li>
        <li><kbd>Esc</kbd> pause</li>
      </ul>
    </div>
  );
}

function Scoreboard() {
  const { hud, settings } = useUi();
  if (!hud) return null;
  const dot = (side: 0 | 1) => <span className={hud.server === side ? 'serve-dot' : 'serve-dot off'} title={hud.server === side ? 'Serving' : undefined} />;
  return (
    <div className="scoreboard">
      <div className="row you">
        {dot(0)}
        <span className="name">You</span>
        {settings.bestOf > 1 && <span className="games">{hud.games[0]}</span>}
        <span className="pts">{hud.points[0]}</span>
      </div>
      <div className="row cpu">
        {dot(1)}
        <span className="name">CPU</span>
        {settings.bestOf > 1 && <span className="games">{hud.games[1]}</span>}
        <span className="pts">{hud.points[1]}</span>
      </div>
    </div>
  );
}

function Flash() {
  const { banner, timing } = useUi();
  const [visible, setVisible] = useState(false);
  const [tVisible, setTVisible] = useState(false);
  useEffect(() => {
    if (!banner) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 1400);
    return () => clearTimeout(id);
  }, [banner?.key]);
  useEffect(() => {
    if (!timing) return;
    setTVisible(true);
    const id = setTimeout(() => setTVisible(false), 900);
    return () => clearTimeout(id);
  }, [timing?.key]);
  const tLabel = timing
    ? Math.abs(timing.offsetMs) < 25
      ? 'Perfect'
      : `${timing.offsetMs < 0 ? 'Early' : 'Late'} ${Math.round(Math.abs(timing.offsetMs))} ms`
    : '';
  return (
    <>
      {banner && visible && (
        <div key={banner.key} className={`banner ${banner.tone}`}>
          <div className="banner-text">{banner.text}</div>
          {banner.sub && <div className="banner-sub">{banner.sub}</div>}
        </div>
      )}
      {timing && tVisible && (
        <div key={timing.key} className={`timing ${timing.hit ? timing.timing : 'miss'}`}>
          {timing.hit ? tLabel : `Miss: ${tLabel}`}
        </div>
      )}
    </>
  );
}

function Hint() {
  const { hud, usingPhone } = useUi();
  if (!hud) return null;
  const text = hud.phase === 'serve' && hud.server === 0 ? (usingPhone ? 'Tap your phone to toss' : 'Press Space to toss') : hud.phase === 'toss' && hud.server === 0 ? 'Swing as it drops!' : '';
  return text ? <div className="hint">{text}</div> : null;
}

function Pause({ rt }: { rt: Runtime }) {
  const { pauseReason, phone } = useUi();
  const phoneDrop = pauseReason === 'phone';
  return (
    <div className="screen dim" data-ui>
      <div className="card">
        <h2>{phoneDrop ? (phone.phone === 'calibrated' ? 'Phone is back' : 'Phone disconnected') : 'Paused'}</h2>
        {phoneDrop && (
          <p className="muted">
            {phone.phone === 'calibrated' ? 'Tap your phone to resume the match.' : 'Reopen the link on your phone or scan the code. The match resumes where you left off.'}
          </p>
        )}
        <button className="primary" onClick={() => rt.resume()}>
          {phoneDrop && phone.phone !== 'calibrated' ? 'Resume with mouse' : 'Resume'}
        </button>
        <button onClick={() => rt.quitToMenu()}>Quit to menu</button>
      </div>
      {phoneDrop ? <PhonePanel title="Reconnect your phone" /> : <Controls />}
    </div>
  );
}

function MatchOver({ rt }: { rt: Runtime }) {
  const { winner, hud, settings } = useUi();
  return (
    <div className="screen dim" data-ui>
      <div className="card">
        <h2 className={winner === 0 ? 'good' : 'bad'}>{winner === 0 ? 'You win!' : 'CPU wins'}</h2>
        <div className="history">
          {hud?.history.map(([a, b], i) => (
            <span key={i} className={a > b ? 'good' : 'bad'}>
              {a}-{b}
            </span>
          ))}
        </div>
        <button className="primary" onClick={() => rt.startMatch(settings)}>Play again</button>
        <button onClick={() => rt.quitToMenu()}>Menu</button>
      </div>
    </div>
  );
}

export function App({ rt }: { rt: Runtime }) {
  const { screen } = useUi();
  return (
    <>
      {screen !== 'menu' && <Scoreboard />}
      <ConnectionDot />
      {screen === 'playing' && (
        <>
          <Flash />
          <Hint />
        </>
      )}
      {screen === 'menu' && <Menu rt={rt} />}
      {screen === 'paused' && <Pause rt={rt} />}
      {screen === 'matchOver' && <MatchOver rt={rt} />}
    </>
  );
}
