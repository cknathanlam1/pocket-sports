// 7a title (logo on sunburst) and 2a/2b pairing.
import { useEffect } from 'react';
import { Char, MARLO_LOOK } from '../../../shared/art/Char.tsx';
import { BigLogo, Sunburst, Wordmark } from '../../../shared/art/Logo.tsx';
import type { Runtime } from '../../runtime.ts';
import { useUi } from '../../store.ts';
import { Qr, isLocalHost } from '../Qr.tsx';
import { Stage, Wash } from '../Stage.tsx';

export function Title({ onDone }: { onDone: () => void }) {
  const { look } = useUi();
  useEffect(() => {
    const t = setTimeout(onDone, 3200);
    const key = () => onDone();
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', key);
    };
  }, [onDone]);
  return (
    <div className="title-screen" onClick={onDone} data-ui>
      <Sunburst size={2600} />
      <div className="title-glow" />
      <Stage>
        <div className="title-logo">
          <BigLogo width={900} />
        </div>
        <div className="title-char left">
          <Char size={330} pose="cheer" look={look} />
        </div>
        <div className="title-char right">
          <Char size={330} pose="swing" look={MARLO_LOOK} />
        </div>
        <div className="tagline">Your phone is the paddle.</div>
      </Stage>
    </div>
  );
}

export function Pairing({ rt }: { rt: Runtime }) {
  const { phone, look } = useUi();
  const connected = phone.phone !== 'none';
  const code = phone.code ?? '····';
  return (
    <>
      <Wash color="rgba(248,244,236,.62)" />
      <Stage>
        <div className="pair-card panel-in" data-ui>
          <div className="pair-qr">
            <div className="qr-frame" style={{ opacity: connected ? 0.25 : 1 }}>
              {phone.url ? <Qr text={phone.url} size={260} /> : <div className="qr-placeholder">{phone.serverUp ? 'Creating a room…' : 'Connecting…'}</div>}
            </div>
            {connected && <div className="check-disc">✓</div>}
            <div className="qr-cap">{connected ? 'Phone connected' : 'Point your camera here'}</div>
          </div>
          <div className="pair-body">
            <Wordmark size={40} />
            <div className="pair-title">{connected ? 'You’re in! Nice paddle.' : 'Scan to grab your paddle'}</div>
            <div className="pair-sub">
              {connected ? 'Hold your phone like a paddle, pointed at the screen. Next: quick calibration.' : 'Open your phone camera, scan the code, and tap the link.'}
            </div>
            <div className="field-col">
              <div className="caption-caps muted-ink">ROOM CODE</div>
              <div className="code-tiles">
                {code.split('').map((ch, i) => (
                  <div className="code-tile" key={i}>
                    {ch}
                  </div>
                ))}
              </div>
            </div>
            <div className="slots">
              <div className={`slot ${connected ? 'on' : ''}`}>
                <div className="slot-av" style={{ background: connected ? '#D6E2F5' : '#E6DFD0' }}>
                  {connected && (
                    <div style={{ position: 'absolute', left: 8, top: 6 }}>
                      <Char size={130} look={look} />
                    </div>
                  )}
                </div>
                <div>
                  <div className="slot-name">
                    <span className="p1-dot" />
                    Player 1
                  </div>
                  <div className={`slot-state ${connected ? 'ok' : ''}`}>{connected ? '● Connected' : 'Waiting for phone…'}</div>
                </div>
              </div>
              <div className="slot soon">
                <div className="slot-av q">?</div>
                <div>
                  <div className="slot-name dim">
                    <span className="p2-diamond" />
                    Player 2
                  </div>
                  <div className="soon-chip">COMING SOON</div>
                </div>
              </div>
            </div>
            <button className="link-btn" onClick={() => rt.go('menu')}>
              No phone handy? Play with the mouse ›
            </button>
          </div>
        </div>
        {isLocalHost() && <div className="warn-chip">This page is on localhost, so phones can’t open the link. Use the tunnel (https) URL. See CLAUDE.md.</div>}
        <div className="pair-foot script">no app to install · works on iPhone &amp; Android</div>
      </Stage>
    </>
  );
}
