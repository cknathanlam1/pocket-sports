import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState } from 'react';
import '../shared/styles/tokens.css';
import './controller.css';
import { type PhoneSession as Session, PhoneSession, usePhone } from './session.ts';
import { platform } from './sensors.ts';

const room = (location.pathname.split('/')[2] ?? '').toUpperCase();
const session = new PhoneSession(room);

const HINT: Record<string, string> = {
  lobby: 'Tap to start the match',
  serve: 'Your serve: tap to toss, then swing',
  rally: 'Swing!',
  between: 'Get ready…',
  paused: 'Paused: tap to resume',
};

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

function Status({ s }: { s: Session }) {
  const st = usePhone(s);
  const label = st.transport === 'p2p' ? 'P2P' : st.transport === 'relay' ? 'Relay' : st.displayUp ? 'Linking…' : 'Laptop offline';
  return (
    <div className="status">
      <span className={`dot ${st.transport}`} />
      <span>{st.room}</span>
      <span className="muted">
        {label}
        {st.transport !== 'none' && st.rtt !== null ? ` · ${st.rtt} ms` : ''}
      </span>
    </div>
  );
}

function MotionError({ s }: { s: Session }) {
  const st = usePhone(s);
  const msg =
    st.motionError === 'insecure'
      ? 'Motion sensors need a secure (https) page. Open the link from the laptop’s QR code.'
      : st.motionError === 'unsupported' || st.motionError === 'no-events'
        ? 'This browser isn’t sending motion data. Use Safari on iPhone or Chrome on Android.'
        : platform === 'ios'
          ? 'Motion access was denied. Close this tab, reopen the link, and tap Allow. (If no prompt appears: Settings → Safari → Motion & Orientation Access.)'
          : 'Motion access was denied. Allow motion sensors for this site in your browser settings, then try again.';
  return (
    <div className="center">
      <h1>Motion unavailable</h1>
      <p>{msg}</p>
      <button className="primary" onClick={() => void s.enableMotion()}>Try again</button>
    </div>
  );
}

function Play({ s }: { s: Session }) {
  const st = usePhone(s);
  const lastTap = useRef(0);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!st.flash) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), 140);
    return () => clearTimeout(id);
  }, [st.flash?.key]);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const now = performance.now();
    s.tap();
    if (now - lastTap.current < 300) s.calibrate(); // double-tap anywhere = recalibrate
    lastTap.current = now;
  };
  return (
    <div className="pad" onPointerDown={onDown}>
      <Status s={s} />
      <div className={`paddle ${flash ? 'pulse' : ''}`} />
      <div className="hint">{st.displayUp ? HINT[st.ui] : 'Waiting for the laptop…'}</div>
      <div className="sub muted">Double-tap anywhere to recalibrate</div>
      {flash && <div className="flash" style={{ opacity: 0.35 + 0.5 * (st.flash?.strength ?? 0.5) }} />}
    </div>
  );
}

function App() {
  const st = usePhone(session);
  const landscape = useLandscape();
  let body: React.ReactNode;
  switch (st.step) {
    case 'connecting':
      body = (
        <div className="center">
          <h1>Connecting…</h1>
          <p className="muted">Room {room}</p>
        </div>
      );
      break;
    case 'not-found':
      body = (
        <div className="center">
          <h1>Room {room} not found</h1>
          <p>Check the code on the laptop screen, or scan its QR code again. Rooms expire after 10 minutes idle.</p>
          <RoomInput />
        </div>
      );
      break;
    case 'replaced':
      body = (
        <div className="center">
          <h1>Paddle opened elsewhere</h1>
          <p>Another phone or tab joined room {room}. Reload to take over again.</p>
          <button className="primary" onClick={() => location.reload()}>Reload</button>
        </div>
      );
      break;
    case 'motion':
      body = (
        <div className="center">
          <Status s={session} />
          <h1>Your phone is the paddle</h1>
          <p>Hold it upright like a paddle, with the screen facing you.</p>
          <button className="primary big" onClick={() => void session.enableMotion()}>Enable motion</button>
        </div>
      );
      break;
    case 'motion-error':
      body = <MotionError s={session} />;
      break;
    case 'calibrate':
      body = (
        <div className="center">
          <Status s={session} />
          <h1>Calibrate</h1>
          <p>Point the phone at the laptop like a paddle (screen facing you, top edge up), then tap Calibrate.</p>
          <button className="primary big" onClick={() => session.calibrate()}>Calibrate</button>
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
          <p>Rotate your phone to portrait</p>
        </div>
      )}
    </>
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
      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="ABCD" inputMode="text" autoCapitalize="characters" aria-label="Room code" />
      <button className="primary" disabled={code.length !== 4}>Join</button>
    </form>
  );
}

createRoot(document.getElementById('ui')!).render(<App />);
