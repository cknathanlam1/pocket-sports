// Online lobby: host shares a link/code, guest joins; both see each other (name, look, phone) and the
// connection quality before the host starts the match. Each player pairs their own phone (or uses the mouse).
import { useState } from 'react';
import { Char } from '../../../shared/art/Char.tsx';
import type { BestOf } from '../../../engine/rules.ts';
import type { Runtime } from '../../runtime.ts';
import type { VsStatus } from '../../net/VersusLink.ts';
import { store, useUi } from '../../store.ts';
import { Qr } from '../Qr.tsx';
import { Stage } from '../Stage.tsx';

/** How the link will feel, from round-trip time. The thresholds follow the netcode's sensitivity. */
export function linkQuality(vs: VsStatus | null): { level: 'good' | 'weak' | 'lost'; word: string } {
  if (!vs || vs.transport === 'none') return { level: 'lost', word: 'Not connected' };
  const rtt = vs.rtt;
  if (rtt === null) return { level: 'good', word: 'Measuring…' };
  if (rtt < 80) return { level: 'good', word: 'Great' };
  if (rtt < 150) return { level: 'good', word: 'Good' };
  if (rtt < 250) return { level: 'weak', word: 'Playable' };
  return { level: 'weak', word: 'Laggy' };
}

export const inviteUrl = (code: string): string => `${location.origin}/?vs=${code}`;

function JoinBox({ rt, label }: { rt: Runtime; label: string }) {
  const [code, setCode] = useState('');
  const ok = /^[A-Za-z]{4}$/.test(code);
  return (
    <form
      className="vs-join"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) rt.openVersus(code.toUpperCase());
      }}
    >
      <span className="row-desc">{label}</span>
      <input className="vs-input code" value={code} maxLength={4} placeholder="ABCD" aria-label="Match code" onChange={(e) => setCode(e.target.value.replace(/[^a-z]/gi, '').toUpperCase())} />
      <button className="btn small" disabled={!ok}>
        Join
      </button>
    </form>
  );
}

function Invite({ rt, vs }: { rt: Runtime; vs: VsStatus }) {
  const [copied, setCopied] = useState(false);
  if (vs.role === 'guest') {
    if (vs.state === 'not-found' || vs.state === 'full')
      return (
        <div className="vs-mid">
          <div className="row-title big">{vs.state === 'full' ? 'That match is full' : `No match called ${vs.code}`}</div>
          <div className="row-desc">{vs.state === 'full' ? 'Two players are already in it.' : 'Check the code with your friend, or ask them for a new link.'}</div>
          <JoinBox rt={rt} label="Try another code" />
        </div>
      );
    return (
      <div className="vs-mid">
        <div className="caption-caps muted-ink">MATCH CODE</div>
        <div className="vs-code">{vs.code}</div>
        <div className="row-desc">{vs.state === 'connected' ? 'Connected to the host.' : 'Joining…'}</div>
      </div>
    );
  }
  if (!vs.code)
    return (
      <div className="vs-mid">
        <div className="row-desc">Creating a match…</div>
      </div>
    );
  const url = inviteUrl(vs.code);
  return (
    <div className="vs-mid">
      <div className="caption-caps muted-ink">SEND YOUR FRIEND THIS LINK</div>
      <div className="vs-link">
        <span>{url.replace(/^https?:\/\//, '')}</span>
        <button
          className="btn small"
          onClick={() =>
            void navigator.clipboard?.writeText(url).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <div style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
        <div className="qr-frame">
          <Qr text={url} size={150} />
        </div>
        <div>
          <div className="caption-caps muted-ink">OR THE CODE</div>
          <div className="vs-code">{vs.code}</div>
        </div>
      </div>
      {vs.state !== 'connected' && <div className="script vs-wait">waiting for your friend…</div>}
      {vs.state !== 'connected' && <JoinBox rt={rt} label="Got a code from a friend instead?" />}
    </div>
  );
}

export function Lobby({ rt }: { rt: Runtime }) {
  const { vs, name, look, phone, opponent, settings } = useUi();
  const [bestOf, setBestOf] = useState<BestOf>(settings.bestOf);
  if (!vs) return null;
  const connected = vs.state === 'connected';
  const q = linkQuality(vs);
  const myPhone = phone.phone === 'calibrated';
  return (
    <>
      <div className="wash" style={{ background: 'var(--cream-100)' }} />
      <Stage>
        <div className="setup" data-ui>
          <div className="setup-head">
            <div className="h-display">Play a friend</div>
            <div className="setup-vs">Online · each player on their own laptop and phone</div>
          </div>
          <div className="vs-grid">
            <div className="vs-card">
              <div className="caption-caps" style={{ color: 'var(--p1)' }}>
                YOU
              </div>
              <Char size={170} pose="ready" look={look} />
              <input className="vs-input" value={name} maxLength={16} aria-label="Your name" onChange={(e) => store.set({ name: e.target.value })} onBlur={() => !name.trim() && store.set({ name: 'Player' })} />
              <div className="vs-status">
                <span className={`conn-shape ${myPhone ? 'good' : 'weak'}`} />
                {myPhone ? 'Phone paddle ready' : 'Mouse (no phone)'}
              </div>
              {!myPhone && (
                <button className="link-btn" onClick={() => rt.go('pairing')}>
                  Pair your phone ›
                </button>
              )}
            </div>

            <Invite rt={rt} vs={vs} />

            <div className="vs-card">
              <div className="caption-caps" style={{ color: 'var(--p2)' }}>
                {vs.role === 'host' ? 'YOUR FRIEND' : 'HOST'}
              </div>
              {connected && vs.opponent ? (
                <>
                  <Char size={170} pose="ready" look={opponent.look} />
                  <div className="row-title big">{opponent.name}</div>
                  <div className="vs-status">
                    <span className={`conn-shape ${vs.opponent.phone ? 'good' : 'weak'}`} />
                    {vs.opponent.phone ? 'Phone paddle ready' : 'Mouse (no phone)'}
                  </div>
                  <div className="vs-status" title={vs.transport === 'p2p' ? 'Direct peer-to-peer link' : 'Through the game server'}>
                    <span className={`conn-shape ${q.level}`} />
                    {q.word}
                    {vs.rtt !== null && <span className="muted-ink"> · {vs.rtt} ms · {vs.transport === 'p2p' ? 'direct' : 'via server'}</span>}
                  </div>
                </>
              ) : (
                <div className="vs-empty">{vs.role === 'host' ? 'Not here yet' : 'Connecting…'}</div>
              )}
            </div>
          </div>
          <div className="setup-foot">
            <button className="btn" onClick={() => (rt.closeVersus(), rt.go('menu'))}>
              ‹ Leave
            </button>
            {vs.role === 'host' ? (
              <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
                <div className="seg-row">
                  {([1, 3, 5] as const).map((n) => (
                    <button key={n} className={`seg small ${bestOf === n ? 'on' : ''}`} onClick={() => setBestOf(n)}>
                      Best of {n}
                    </button>
                  ))}
                </div>
                <button className="btn primary big" disabled={!connected} onClick={() => rt.hostStartVersus(bestOf)}>
                  Start match ›
                </button>
              </div>
            ) : (
              <div className="script" style={{ font: '600 30px var(--font-script)', color: 'var(--coral-600)' }}>
                {connected ? `waiting for ${opponent.name} to start…` : ''}
              </div>
            )}
          </div>
        </div>
      </Stage>
    </>
  );
}

/** HUD pill during an online match: opponent's link quality. */
export function VersusPill() {
  const { vs, opponent } = useUi();
  if (!vs) return null;
  const q = linkQuality(vs);
  return (
    <div className="chip hud-vs" title={vs.transport === 'p2p' ? 'Direct peer-to-peer link' : 'Through the game server'}>
      <span className={`conn-shape ${q.level}`} />
      {opponent.name} · {q.word}
      {vs.rtt !== null && vs.transport !== 'none' && <span className="muted-ink"> · {vs.rtt} ms</span>}
    </div>
  );
}
