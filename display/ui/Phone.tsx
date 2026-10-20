import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { useUi } from '../store.ts';

/** QR code as an SVG path (one rect per dark module, merged per row). */
export function Qr({ text, size = 200 }: { text: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!qr.isDark(r, c)) {
          c++;
          continue;
        }
        const start = c;
        while (c < n && qr.isDark(r, c)) c++;
        d += `M${start + 4} ${r + 4}h${c - start}v1h${start - c}z`;
      }
    }
    return { d, n: n + 8 };
  }, [text]);
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${path.n} ${path.n}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges">
      <rect width={path.n} height={path.n} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

const isLocalHost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/** Pairing card: QR + code + live status. */
export function PhonePanel({ title = 'Play with your phone' }: { title?: string }) {
  const { phone } = useUi();
  const step =
    phone.phone === 'calibrated'
      ? { text: 'Ready! Tap your phone to start', tone: 'good' }
      : phone.phone === 'connected'
        ? { text: 'Phone connected: calibrate on the phone', tone: 'warn' }
        : { text: 'Scan with your phone camera', tone: 'muted' };
  return (
    <div className="card phone-panel">
      <h3>{title}</h3>
      {!phone.serverUp ? (
        <p className="muted">Connecting to the server…</p>
      ) : !phone.url ? (
        <p className="muted">Creating a room…</p>
      ) : (
        <>
          <div className="qr-wrap">
            <Qr text={phone.url} size={188} />
          </div>
          <div className="room-code" aria-label="Room code">
            {phone.code}
          </div>
          <div className="small muted url">{phone.url.replace(/^https?:\/\//, '')}</div>
          <div className={`step ${step.tone}`}>{step.text}</div>
          {phone.phone !== 'none' && <ConnectionLine />}
          {isLocalHost() && (
            <p className="small warn-text">
              This page is on localhost, so your phone can't open the link. Open the tunnel (https) URL on this laptop instead; see CLAUDE.md.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ConnectionLine() {
  const { phone } = useUi();
  return (
    <div className="conn-line small">
      <span className={`dot ${phone.transport}`} />
      {phone.transport === 'p2p' ? 'Peer-to-peer' : phone.transport === 'relay' ? 'Relay (via server)' : 'Offline'}
      {phone.rtt !== null && ` · ${phone.rtt} ms`}
    </div>
  );
}

/** HUD connection dot: transport + round-trip time. */
export function ConnectionDot() {
  const { phone, usingPhone } = useUi();
  if (!usingPhone && phone.phone === 'none') return null;
  const label = phone.transport === 'p2p' ? 'P2P' : phone.transport === 'relay' ? 'Relay' : 'Phone offline';
  return (
    <div className="conn-dot" title="Phone connection">
      <span className={`dot ${phone.transport}`} />
      {label}
      {phone.transport !== 'none' && phone.rtt !== null && ` ${phone.rtt} ms`}
    </div>
  );
}
