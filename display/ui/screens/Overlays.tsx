// 2p Paused, 2r Connection lost (auto-paused), 2q Results, and toasts.
import { useEffect, useState } from 'react';
import { Char, MARLO_LOOK } from '../../../shared/art/Char.tsx';
import type { Runtime } from '../../runtime.ts';
import { store, useUi } from '../../store.ts';
import { Qr } from '../Qr.tsx';
import { Stage, Wash } from '../Stage.tsx';
import { Confetti } from './Hud.tsx';

export function Paused({ rt }: { rt: Runtime }) {
  const { pauseReason, phone, hud, usingPhone, mode } = useUi();
  if (pauseReason === 'phone') return <ConnectionLost rt={rt} />;
  return (
    <>
      <Wash color="rgba(14,36,73,.55)" />
      <Stage>
        <div className="center-modal" data-ui>
          <div className="modal panel-in" style={{ width: 560 }}>
            <div className="modal-title">Paused</div>
            <div className="row-desc" style={{ fontSize: 19 }}>
              {usingPhone ? 'Phone: tap the pause button to resume, or pick here.' : 'Press Esc to resume, or pick here.'}
            </div>
            <button className="btn primary big" onClick={() => rt.resume()} autoFocus>
              Resume
            </button>
            {phone.phone !== 'none' && (
              <button className="btn" onClick={() => store.toast('Hold your phone like a paddle and double-tap it', 'i')}>
                Recalibrate phone
              </button>
            )}
            <button className="btn" onClick={() => rt.quitToMenu()}>
              {mode === 'practice' ? 'End practice' : 'Quit to menu'}
            </button>
          </div>
        </div>
        {hud && mode === 'match' && <div className="paused-score">{hud.points.join(' – ')}</div>}
      </Stage>
    </>
  );
}

function ConnectionLost({ rt }: { rt: Runtime }) {
  const { phone, hud } = useUi();
  const back = phone.phone === 'calibrated';
  return (
    <>
      <Wash color="rgba(14,36,73,.62)" />
      <Stage>
        <div className="center-modal" data-ui>
          <div className="lost-card panel-in">
            <div className="qr-frame">{phone.url ? <Qr text={phone.url} size={240} /> : <div className="qr-placeholder small">Reconnecting…</div>}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
              <div className="lost-kicker">
                <span className="conn-shape lost" style={{ borderRadius: '50%' }} />
                {back ? 'PHONE IS BACK · GAME PAUSED' : 'PHONE DISCONNECTED · GAME PAUSED'}
              </div>
              <div className="h-display" style={{ fontSize: 52, lineHeight: 1.02 }}>
                {back ? 'Paddle found!' : 'Lost your paddle!'}
              </div>
              <div className="row-desc" style={{ fontSize: 22 }}>
                {back ? 'Tap your phone to jump back in.' : `Reopen the link on your phone, or scan this code. Your score (${hud ? hud.points.join('–') : '0–0'}) is safe.`}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="caption-caps muted-ink" style={{ fontSize: 14 }}>
                  ROOM
                </span>
                <span className="room-inline">{phone.code ?? '····'}</span>
              </div>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                {back ? (
                  <button className="btn primary small" onClick={() => rt.resume()}>
                    Resume
                  </button>
                ) : (
                  <div className="script" style={{ font: '600 28px var(--font-script)', color: 'var(--coral-600)' }}>
                    trying to reconnect automatically…
                  </div>
                )}
                <button className="link-btn" onClick={() => rt.resume()}>
                  {back ? '' : 'Resume with the mouse ›'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </Stage>
    </>
  );
}

export function Results({ rt }: { rt: Runtime }) {
  const { winner, hud, settings, stats, look } = useUi();
  const won = winner === 0;
  const games = hud?.games ?? [0, 0];
  const cards = [
    { l: 'Longest rally', v: `${stats[0].longest}`, o: `${stats[1].longest}` },
    { l: 'Fastest shot', v: `${stats[0].fastest} km/h`, o: `${stats[1].fastest}` },
    { l: 'Winners', v: `${stats[0].winners}`, o: `${stats[1].winners}` },
    { l: 'Errors', v: `${stats[0].errors}`, o: `${stats[1].errors}` },
  ];
  return (
    <>
      <div className="wash" style={{ background: won ? 'var(--sun-300)' : 'var(--blush-100)' }} />
      <Stage>
        <div className="results" data-ui>
          {won && <Confetti clearRight />}
          <div className="results-left">
            <div className="results-disc" />
            <div style={{ position: 'relative', marginBottom: 60 }}>
              <Char size={600} pose={won ? 'cheer' : 'sad'} look={won ? look : MARLO_LOOK} paddle={won ? '#2F6FDB' : '#FF8A1F'} />
            </div>
          </div>
          <div className="results-right">
            <div className="results-title">{won ? 'You win!' : 'Marlo wins'}</div>
            <div className="results-chips">
              <span className="res-chip p1">● You {games[0]}</span>
              <span className="res-chip p2">◆ Marlo {games[1]}</span>
              <span className="res-games">{hud?.history.map(([a, b]) => `${a}–${b}`).join(' · ')}</span>
            </div>
            <div className="stat-grid">
              {cards.map((c) => (
                <div key={c.l} className="stat-card">
                  <div className="stat-l">{c.l}</div>
                  <div className="stat-v">{c.v}</div>
                  <div className="stat-o">Marlo: {c.o}</div>
                </div>
              ))}
            </div>
            <div className="results-actions">
              <button className="btn primary big" style={{ flex: 1.4 }} onClick={() => rt.startMatch(settings)} autoFocus>
                Rematch
              </button>
              <button className="btn big" style={{ flex: 1 }} onClick={() => rt.quitToMenu()}>
                Menu
              </button>
            </div>
          </div>
        </div>
      </Stage>
    </>
  );
}

export function Toast() {
  const { toast } = useUi();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShown(true);
    const id = setTimeout(() => setShown(false), 3000);
    return () => clearTimeout(id);
  }, [toast?.key]);
  if (!toast || !shown) return null;
  return (
    <Stage>
      <div className={`toast ${toast.tone}`} key={toast.key} role="status">
        <b>{toast.icon}</b>
        {toast.text}
      </div>
    </Stage>
  );
}
