// 2p Paused, 2r Connection lost (auto-paused), 2q Results, and toasts.
import { useEffect, useState } from 'react';
import { Char } from '../../../shared/art/Char.tsx';
import type { Runtime } from '../../runtime.ts';
import { store, useUi } from '../../store.ts';
import { Qr } from '../Qr.tsx';
import { Stage, Wash } from '../Stage.tsx';
import { Confetti } from './Hud.tsx';

export function Paused({ rt }: { rt: Runtime }) {
  const { pauseReason, phone, hud, usingPhone, mode, opponent, vs } = useUi();
  if (pauseReason === 'phone') return <ConnectionLost rt={rt} />;
  const online = mode === 'versus';
  const lost = online && pauseReason === 'opponent';
  return (
    <>
      <Wash color="rgba(14,36,73,.55)" />
      <Stage>
        <div className="center-modal" data-ui>
          <div className="modal panel-in" style={{ width: 560 }}>
            <div className="modal-title">{lost ? `Waiting for ${opponent.name}` : pauseReason === 'remote' ? `${opponent.name} paused` : 'Paused'}</div>
            <div className="row-desc" style={{ fontSize: 19 }}>
              {lost
                ? 'Their connection dropped. The match picks up again as soon as they’re back.'
                : online
                  ? 'Resuming replays the rally from the serve, for both of you.'
                  : usingPhone
                    ? 'Phone: tap the pause button to resume, or pick here.'
                    : 'Press Esc to resume, or pick here.'}
            </div>
            {lost ? (
              <button className="btn primary big" onClick={() => rt.vs?.reconnectNow()}>
                Retry now
              </button>
            ) : (
              <button className="btn primary big" onClick={() => rt.resume()} disabled={online && vs?.transport === 'none'} autoFocus>
                Resume
              </button>
            )}
            {phone.phone !== 'none' && (
              <button className="btn" onClick={() => store.toast('Hold your phone like a paddle and double-tap it', 'i')}>
                Recalibrate phone
              </button>
            )}
            <button className="btn" onClick={() => rt.quitToMenu()}>
              {mode === 'practice' ? 'End practice' : online ? 'Leave match' : 'Quit to menu'}
            </button>
          </div>
        </div>
        {hud && mode !== 'practice' && <div className="paused-score">{hud.points.join(' – ')}</div>}
      </Stage>
    </>
  );
}

function ConnectionLost({ rt }: { rt: Runtime }) {
  const { phone: phone1, phone2, hud, local2p } = useUi();
  // Local two-player: show player 2's code if theirs is the phone that's missing.
  const p2Lost = local2p && phone1.phone === 'calibrated' && phone2 !== null && phone2.phone !== 'calibrated';
  const phone = p2Lost ? phone2 : phone1;
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
                {back ? 'PHONE IS BACK · GAME PAUSED' : `${p2Lost ? 'PLAYER 2 ' : ''}PHONE DISCONNECTED · GAME PAUSED`}
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
                  {back || local2p ? '' : 'Resume with the mouse ›'}
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
  const { winner, hud, settings, stats, look, opponent, mode, vs, local2p } = useUi();
  const won = winner === 0 || local2p;
  const p1 = local2p ? 'Player 1' : 'You';
  const online = mode === 'versus';
  const canRematch = !online || vs?.role === 'host';
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
              <Char size={600} pose={won ? 'cheer' : 'sad'} look={winner === 0 ? look : opponent.look} paddle={won ? '#2F6FDB' : '#FF8A1F'} />
            </div>
          </div>
          <div className="results-right">
            <div className="results-title">{local2p ? `${winner === 0 ? 'Player 1' : 'Player 2'} wins!` : won ? 'You win!' : `${opponent.name} wins`}</div>
            <div className="results-chips">
              <span className="res-chip p1">● {p1} {games[0]}</span>
              <span className="res-chip p2">◆ {opponent.name} {games[1]}</span>
              <span className="res-games">{hud?.history.map(([a, b]) => `${a}–${b}`).join(' · ')}</span>
            </div>
            <div className="stat-grid">
              {cards.map((c) => (
                <div key={c.l} className="stat-card">
                  <div className="stat-l">{c.l}</div>
                  <div className="stat-v">{c.v}</div>
                  <div className="stat-o">{opponent.name}: {c.o}</div>
                </div>
              ))}
            </div>
            <div className="results-actions">
              {canRematch ? (
                <button className="btn primary big" style={{ flex: 1.4 }} onClick={() => (online ? rt.hostStartVersus(settings.bestOf) : rt.startMatch(settings))} disabled={online && vs?.transport === 'none'} autoFocus>
                  Rematch
                </button>
              ) : (
                <div className="script" style={{ flex: 1.4, font: '600 28px var(--font-script)', color: 'var(--coral-600)' }}>
                  {opponent.name} can start a rematch…
                </div>
              )}
              <button className="btn big" style={{ flex: 1 }} onClick={() => rt.quitToMenu()}>
                {online ? 'Lobby' : 'Menu'}
              </button>
            </div>
          </div>
        </div>
      </Stage>
    </>
  );
}

/** Shown when the WebSocket to our server has been down for a few seconds. The game keeps running (CPU, mouse). */
export function ServerBanner({ rt }: { rt: Runtime }) {
  const { phone } = useUi();
  const [down, setDown] = useState(false);
  const [everUp, setEverUp] = useState(false);
  useEffect(() => {
    if (phone.serverUp) {
      setEverUp(true);
      setDown(false);
      return;
    }
    const id = setTimeout(() => setDown(true), 4000);
    return () => clearTimeout(id);
  }, [phone.serverUp]);
  if (!down) return null;
  return (
    <Stage>
      <div className="server-banner panel-in" role="alert" data-ui>
        <span className="conn-shape lost" style={{ borderRadius: '50%' }} />
        <div>
          <div className="row-title">{everUp ? 'Lost the game server' : 'Can’t reach the game server'}</div>
          <div className="row-desc">{everUp ? 'Reconnecting… your phone will rejoin on its own.' : 'Retrying… check your internet connection.'} You can still play with the mouse.</div>
        </div>
        <button className="btn small" onClick={() => rt.host.reconnectNow()}>
          Retry now
        </button>
      </div>
    </Stage>
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
