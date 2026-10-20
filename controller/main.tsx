import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../shared/styles/tokens.css';
import { openServerLink, type LinkStatus } from '../shared/serverLink.ts';

const room = location.pathname.split('/')[2]?.toUpperCase() ?? '';

function Controller() {
  const [link, setLink] = useState<LinkStatus>({ connected: false, rttMs: null });
  useEffect(() => openServerLink(setLink), []);
  const hasMotion = 'DeviceMotionEvent' in window;

  return (
    <div style={{ padding: 24, display: 'grid', gap: 12 }}>
      <h1 style={{ margin: 0 }}>Paddle · {room}</h1>
      <Row ok={window.isSecureContext} label="Secure context (HTTPS)" />
      <Row ok={hasMotion} label="DeviceMotion API present" />
      <Row ok={link.connected} label={`Server ${link.connected ? `${link.rttMs ?? '…'} ms` : 'offline'}`} />
      <p style={{ color: 'var(--color-text-muted)' }}>M0 check page. Pairing and motion arrive in M2.</p>
    </div>
  );
}

function Row({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div>
      <span style={{ color: ok ? 'var(--color-ok)' : 'var(--color-bad)' }}>{ok ? '✔' : '✘'}</span> {label}
    </div>
  );
}

createRoot(document.getElementById('ui')!).render(<Controller />);
