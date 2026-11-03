// Phone controller UI (design 3a–3l and 7f). Portrait, full-width tap targets, screen kept awake.
import { createRoot } from 'react-dom/client';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import '../shared/styles/tokens.css';
import '../shared/styles/game.css';
import './controller.css';
import { HandPhone } from '../shared/art/HandPhone.tsx';
import { StampWord, Sunburst, Wordmark } from '../shared/art/Logo.tsx';
import { Paddle } from '../shared/art/Paddle.tsx';
import { PhoneMenu } from './PhoneMenu.tsx';
import { type PhoneSession as Session, PhoneSession, usePhone } from './session.ts';
import { platform } from './sensors.ts';

const room = (location.pathname.split('/')[2] ?? '').toUpperCase();
const session = new PhoneSession(room);

function useLandscape(): boolean {
  const q = '(orientation: landscape)';
  const [l, setL] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setL(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return l;
}

/** Visible for `ms` after each change of `key`. */
function useBlink(key: number | undefined, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (key === undefined) return;
    setOn(true);
    const id = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(id);
  }, [key]);
  return on;
}

function StatusPill({ s }: { s: Session }) {
  const st = usePhone(s);
  const level = st.transport === 'none' ? 'lost' : (st.rtt ?? 0) > 120 ? 'weak' : 'good';
  const word = st.transport === 'none' ? (st.displayUp ? 'Linking' : 'Lost') : level === 'weak' ? 'Weak' : 'OK';
  return (
    <div className="status-pill" title={st.transport === 'p2p' ? 'Peer-to-peer' : st.transport === 'relay' ? 'Relay via server' : 'Not connected'}>
      <span className={`conn-shape ${level}`} />
      {word}
      {st.transport !== 'none' && st.rtt !== null && <span className="dim"> · {st.rtt} ms</span>}
    </div>
  );
}

/** Cream message screen: big icon disc, title, body, optional steps, one full-width button. */
function Message({ icon, iconBg, title, body, steps, button, onButton, primary = true, children }: { icon: string; iconBg: string; title: string; body: string; steps?: string; button?: string; onButton?: () => void; primary?: boolean; children?: ReactNode }) {
  return (
    <div className="screen cream msg">
      <div className="icon-disc" style={{ background: iconBg }}>
        {icon}
      </div>
      <div className="p-title">{title}</div>
      <div className="p-body">{body}</div>
      {steps && <div className="steps">{steps}</div>}
      {children}
      {button && (
        <button className={`p-btn ${primary ? 'primary' : ''}`} onClick={onButton}>
          {button}
        </button>
      )}
    </div>
  );
}

function MotionError({ s }: { s: Session }) {
  const st = usePhone(s);
  const [copied, setCopied] = useState(false);
  if (st.motionError === 'unsupported' || st.motionError === 'no-events' || st.motionError === 'insecure') {
    return (
      <Message
        icon="?"
        iconBg="var(--sun-200)"
        title="Try a different browser"
        body={st.motionError === 'insecure' ? 'Motion needs a secure (https) link. Scan the QR code on the laptop again.' : 'This browser can’t read motion. Open this link in Safari (iPhone) or Chrome (Android).'}
        button={copied ? 'Link copied ✓' : 'Copy link'}
        primary={false}
        onButton={() => void navigator.clipboard?.writeText(location.href).then(() => setCopied(true), () => {})}
      />
    );
  }
  return (
    <Message
      icon="✕"
      iconBg="var(--blush-300)"
      title="Motion is blocked"
      body="Your phone can’t feel the swing yet. Turn it on:"
      steps={
        platform === 'ios'
          ? '1. Settings › Safari › Motion & Orientation Access\n2. Switch it on\n3. Come back and tap Try again'
          : '1. Tap the lock icon next to the address\n2. Site settings › Motion sensors › Allow\n3. Come back and tap Try again'
      }
      button="Try again"
      onButton={() => void s.enableMotion()}
    />
  );
}

/** Paddle mode (3d idle · 3e serve · 3f hit flash · 3g between points · 7f SMASH). */
function Play({ s }: { s: Session }) {
  const st = usePhone(s);
  const lastTap = useRef(0);
  const hit = useBlink(st.flash?.key, st.flash?.tier === 'smash' ? 600 : 160);
  const smash = hit && st.flash?.tier === 'smash';

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.pause-btn, .dev-bar')) return;
    e.preventDefault();
    const now = performance.now();
    s.tap();
    if (now - lastTap.current < 300) s.calibrate(); // double-tap anywhere = recalibrate
    lastTap.current = now;
  };

  if (st.ui === 'paused') return <Message icon="II" iconBg="var(--sun-200)" title="Game paused" body="Your match is waiting on the laptop." button="Resume" onButton={() => s.pause()} />;
  if (st.wasLinked && st.transport === 'none') {
    return <Message icon="↻" iconBg="var(--cobalt-100)" title="Reconnecting…" body="Hang on — we’re finding your laptop. The game is paused." button="Rejoin now" primary={false} onButton={() => s.rejoin()} />;
  }

  // Between matches the phone mirrors the laptop menu so you can set up the game from your hand.
  if (st.ui === 'lobby' && st.menu && st.menu.screen !== 'other') return <PhoneMenu s={s} menu={st.menu} status={<StatusPill s={s} />} />;

  const mode = smash ? 'smash' : st.ui === 'serve' ? 'serve' : st.ui === 'between' ? 'between' : hit ? 'flash' : 'idle';
  const bg = { idle: 'var(--phone-bg)', serve: 'var(--sun-400)', between: 'var(--phone-bg)', flash: 'var(--cobalt-50)', smash: 'var(--p1)' }[mode];
  let hint = 'Double-tap to recalibrate';
  if (mode === 'serve') hint = 'Your serve';
  if (mode === 'between') hint = `Next serve: ${st.nextYou ? 'you' : st.op}`;
  if (st.ui === 'lobby') hint = st.displayUp ? 'Tap to play · double-tap to recalibrate' : 'Waiting for the laptop…';
  if (mode === 'flash') hint = '';

  return (
    <div className={`screen pad ${mode}`} style={{ background: bg }} onPointerDown={onDown}>
      {mode === 'smash' && (
        <div className="phone-burst">
          <Sunburst size={1100} a="#2F6FDB" b="#4A86E8" seconds={1.2} />
        </div>
      )}
      <button className="pause-btn" aria-label="Pause" onClick={() => s.pause()}>
        <span />
        <span />
      </button>
      <div className="pad-status">
        <StatusPill s={s} />
      </div>
      {mode === 'flash' && (
        <>
          <div className="ring r1" />
          <div className="ring r2" />
        </>
      )}
      {mode === 'serve' && <div className="pad-big">TAP TO TOSS</div>}
      {mode === 'between' && st.score && <div className="pad-big cream">{`${st.score[0]} – ${st.score[1]}`}</div>}
      <div className={`pad-paddle ${mode}`}>
        <Paddle size={mode === 'serve' ? 190 : mode === 'between' ? 170 : 260} glow={mode === 'idle' || mode === 'flash' || mode === 'smash'} />
      </div>
      {mode === 'serve' && <div className="pad-sub">then swing!</div>}
      {mode === 'between' && st.lastPoint === 'won' && <div className="pad-sub lime">✓ Point!</div>}
      {mode === 'between' && st.lastPoint === 'lost' && <div className="pad-sub blush">✕ Missed it</div>}
      {mode === 'between' && st.lastPoint === 'let' && <div className="pad-sub cream">Let · replay</div>}
      {mode === 'smash' && (
        <div className="smash-col">
          <StampWord text="SMASH!" size={64} fill="#FFD23F" stroke={10} />
          <div className="chip">
            {st.flash?.kmh ?? 0} km/h · rally {st.flash?.rally ?? 0}
          </div>
        </div>
      )}
      {st.dev && <DevBar s={s} />}
      {hint && <div className={`pad-hint ${mode === 'serve' ? 'ink' : ''}`}>{hint}</div>}
      {mode === 'flash' && <div className="white-flash" />}
    </div>
  );
}

/** Dev mode (?dev): record raw sensor sessions for replay tests; show the last detected swing. */
function DevBar({ s }: { s: Session }) {
  const st = usePhone(s);
  const sw = st.lastSwing;
  return (
    <div className="dev-bar">
      <button className={`rec ${st.recording ? 'on' : ''}`} onClick={() => s.toggleRecording()}>
        {st.recording ? `■ Stop (${st.recCount.swings} swings)` : '● Record'}
      </button>
      <div className="dev-read">
        axes {st.axisLocked ? 'locked' : 'calibrating…'}
        {sw && (
          <>
            <br />
            peak {Math.round(sw.peak)}°/s · face {Math.round((sw.face * 180) / Math.PI)}° · path {Math.round(sw.path)} · roll {Math.round(sw.roll)}
          </>
        )}
      </div>
    </div>
  );
}

function RoomInput() {
  const [code, setCode] = useState('');
  return (
    <form
      className="room-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 4) location.href = `/p/${code}`;
      }}
    >
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="ABCD" autoCapitalize="characters" aria-label="Room code" />
      <button className="p-btn small primary" disabled={code.length !== 4}>
        Join
      </button>
    </form>
  );
}

/** "Finding your laptop…", then after a while a hint that the server or the signal may be the problem. */
function SlowJoin() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(id);
  }, []);
  return <div className="p-body">{slow ? 'Still trying… check your signal. If the laptop page just opened, the server may be waking up (up to a minute).' : 'Finding your laptop…'}</div>;
}

function App() {
  const st = usePhone(session);
  const landscape = useLandscape();
  let body: ReactNode;
  switch (st.step) {
    case 'connecting':
      body = (
        <div className="screen cream join">
          <Wordmark size={34} />
          <div className="ball-disc">●</div>
          <div className="p-title ink">
            Joining room
            <br />
            <span className="code">{room}</span>
          </div>
          <div className="progress">
            <div />
          </div>
          <SlowJoin />
        </div>
      );
      break;
    case 'not-found':
      body = (
        <Message icon="⌕" iconBg="var(--blush-300)" title="Room not found" body="That code isn’t active. Check the 4 letters on your laptop, or scan the QR code again.">
          <RoomInput />
        </Message>
      );
      break;
    case 'replaced':
      body = <Message icon="↻" iconBg="var(--cobalt-100)" title="Paddle opened elsewhere" body={`Another phone or tab joined room ${room}. Reload to take it back.`} button="Reload" onButton={() => location.reload()} />;
      break;
    case 'motion':
      body = (
        <div className="screen cream perm">
          <div className="hand-disc">
            <HandPhone mode="tilt" rot={-10} size={230} />
          </div>
          <div className="p-title">Turn your phone into a paddle</div>
          <div className="p-body">We read tilt and swing only. Nothing is recorded.</div>
          <button className="p-btn primary" onClick={() => void session.enableMotion()}>
            Allow motion
          </button>
        </div>
      );
      break;
    case 'motion-error':
      body = <MotionError s={session} />;
      break;
    case 'calibrate':
      body = (
        <div className="screen cream calib">
          <div className="calib-top">
            <StatusPill s={session} />
          </div>
          <div className="p-title" style={{ fontSize: 40 }}>
            Point at the laptop
          </div>
          <div className="p-body">Hold it like a paddle, then tap.</div>
          <div className="hand-disc big">
            <HandPhone mode="hold" size={250} />
          </div>
          <button className="p-btn primary huge" onClick={() => session.calibrate()}>
            Calibrate
          </button>
          <div className="script note">double-tap anytime to recalibrate</div>
        </div>
      );
      break;
    case 'play':
      body = <Play s={session} />;
      break;
  }
  return (
    <>
      {body}
      {landscape && (
        <div className="rotate">
          <div className="rotate-icon">⟳</div>
          <div className="p-title">Rotate to portrait</div>
          <div className="p-body">Hold your phone upright, like a paddle.</div>
        </div>
      )}
    </>
  );
}

createRoot(document.getElementById('ui')!).render(<App />);
