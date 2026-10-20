import { useEffect, useState } from 'react';
import { openServerLink, type LinkStatus } from '../../shared/serverLink.ts';

export function App() {
  const [link, setLink] = useState<LinkStatus>({ connected: false, rttMs: null });
  useEffect(() => openServerLink(setLink), []);

  const controllerUrl = `${location.origin}/p/TEST`;
  return (
    <div className="hud">
      <h1>Pocket Sports</h1>
      <p>
        <span className={`dot ${link.connected ? 'ok' : 'bad'}`} /> server{' '}
        {link.connected ? `connected · ${link.rttMs ?? '…'} ms` : 'offline'}
      </p>
      <p className="muted">
        M0 scaffold. Phone check: open <a href={controllerUrl}>{controllerUrl}</a>
      </p>
    </div>
  );
}
