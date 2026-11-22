// In-game overlay (2j–2o, 7c–7e): score cards, rally pill, phone pill, banners, coach hint,
// hit-tier stamp + burst, POINT! celebration and the match-point edge glow.
import { useEffect, useState } from 'react';
import { StampWord, Sunburst, starPoints } from '../../../shared/art/Logo.tsx';
import type { HitTier } from '../../../shared/protocol.ts';
import { useUi } from '../../store.ts';
import { VersusPill } from './Versus.tsx';
import { Stage } from '../Stage.tsx';

/** Show `value` for `ms` after each change of `key`. */
function useFlash<T>(value: T | null, key: number | undefined, ms: number): T | null {
  const [shown, setShown] = useState<T | null>(null);
  useEffect(() => {
    if (value === null || key === undefined) return;
    setShown(value);
    const id = setTimeout(() => setShown(null), ms);
    return () => clearTimeout(id);
  }, [key]);
  return shown;
}

function ScoreCard({ side }: { side: 0 | 1 }) {
  const { hud, settings, banner, opponent, local2p, coop } = useUi();
  const chip = useFlash(side === 0 ? banner?.kind === 'won' : banner?.kind === 'lost', banner?.key, 900);
  if (!hud) return null;
  const pts = hud.points[side];
  const won = hud.games[side];
  const dots = Array.from({ length: Math.ceil(settings.bestOf / 2) }, (_, i) => i < won);
  const serving = hud.server === side && (hud.phase === 'serve' || hud.phase === 'toss');
  const mark = side === 0 ? <div className="hud-av p1" /> : <div className="hud-av p2" />;
  const name = (
    <div className="hud-name-col" style={{ alignItems: side === 0 ? 'flex-start' : 'flex-end' }}>
      <div className="hud-name">
        {side === 1 && serving && <span className="serve-ball" title="Serving" />}
        {side === 0 ? (local2p ? 'Player 1' : coop ? 'P1 + P2' : 'You') : opponent.name}
        {side === 0 && serving && <span className="serve-ball" title="Serving" />}
      </div>
      {settings.bestOf > 1 && (
        <div className="game-dots">
          {dots.map((d, i) => (
            <span key={i} className="game-dot" style={{ background: d ? (side === 0 ? 'var(--p1)' : 'var(--p2)') : 'var(--cream-50)' }} />
          ))}
        </div>
      )}
    </div>
  );
  const score = (
    <div className="hud-score">
      <span key={pts} className="score-num">
        {pts}
      </span>
      {chip && <span className="plus-one">+1</span>}
    </div>
  );
  return (
    <div className={`hud-card ${side === 0 ? 'p1' : 'p2'}`}>
      {side === 0 ? (
        <>
          {mark}
          {name}
          {score}
        </>
      ) : (
        <>
          {score}
          {name}
          {mark}
        </>
      )}
    </div>
  );
}

const TIER_STYLE: Record<HitTier, { word: string; size: number; fg: string; star: string; sz: number }> = {
  nice: { word: 'Nice!', size: 70, fg: '#255DB7', star: starPoints(8, 56, 34), sz: 150 },
  great: { word: 'Great!', size: 96, fg: '#FFD23F', star: starPoints(9, 58, 30), sz: 220 },
  smash: { word: 'SMASH!', size: 150, fg: '#FFD23F', star: starPoints(10, 58, 24), sz: 340 },
};

function HitFx() {
  const { hitFx } = useUi();
  const fx = useFlash(hitFx, hitFx?.key, 1400);
  if (!fx) return null;
  const st = TIER_STYLE[fx.tier];
  return (
    <div className={`hitfx ${fx.tier}`} key={hitFx?.key}>
      {fx.tier === 'smash' && <div className="hit-flash" />}
      {fx.tier === 'smash' && <div className="speed-lines" />}
      <div className="hit-burst" style={{ width: st.sz, height: st.sz, marginLeft: -st.sz / 2, marginTop: -st.sz / 2 }}>
        <svg viewBox="-60 -60 120 120" width={st.sz} height={st.sz}>
          <polygon points={st.star} fill={fx.tier === 'nice' ? '#fff' : '#FFD23F'} stroke="#10285A" strokeWidth="3" strokeLinejoin="round" />
          <polygon points={starPoints(10, 36, 16)} fill="#fff" />
        </svg>
      </div>
      {fx.tier !== 'nice' && <div className="hit-ring" />}
      <div className="hit-word">
        <StampWord text={st.word} size={st.size} fill={st.fg} stroke={fx.tier === 'smash' ? 26 : 18} />
        <div className="kmh-chip">{fx.kmh} km/h</div>
      </div>
    </div>
  );
}

const CONFETTI = Array.from({ length: 26 }, (_, i) => ({
  x: 40 + ((i * 197) % 1360),
  y: 30 + ((i * 131) % 520),
  w: 14 + (i % 3) * 8,
  h: 10 + (i % 4) * 5,
  a: (i * 47) % 180,
  r: i % 3 ? '3px' : '50%',
  c: ['#2F6FDB', '#FF8A1F', '#FFFDF8', '#E57A58', '#5DC265'][i % 5]!,
}));

/** Confetti pieces; `clearRight` keeps them off the right-hand content area (results screen). */
export function Confetti({ clearRight = false }: { clearRight?: boolean }) {
  const pieces = clearRight ? CONFETTI.filter((c) => c.x < 560 || c.y < 40 || c.y > 700) : CONFETTI;
  return (
    <>
      {pieces.map((c, i) => (
        <div key={i} className="confetti" style={{ left: c.x, top: c.y, width: c.w, height: c.h, background: c.c, borderRadius: c.r, transform: `rotate(${c.a}deg)`, animationDelay: `${(i % 7) * 40}ms` }} />
      ))}
    </>
  );
}

function Celebrate() {
  const { celebrate } = useUi();
  const c = useFlash(celebrate, celebrate?.key, 1800);
  if (!c) return null;
  return (
    <div className="celebrate" key={celebrate?.key}>
      <div className="celebrate-wash" />
      <div className="celebrate-burst">
        <Sunburst size={820} a="rgba(255,210,63,.95)" b="rgba(255,255,255,0)" seconds={18} />
      </div>
      <Confetti />
      <div className="celebrate-stamp">
        <StampWord text="POINT!" size={190} fill="#5DC265" stroke={28} />
      </div>
      <div className="celebrate-line">{c.line}</div>
    </div>
  );
}

function Banner() {
  const { banner } = useUi();
  const b = useFlash(banner, banner?.key, banner?.kind === 'matchpoint' || banner?.kind === 'deuce' ? 2000 : 1500);
  if (!b) return null;
  return (
    <div className={`banner-wrap ${b.kind}`} key={banner?.key}>
      <div className={`banner ${b.kind}`}>
        <span className="banner-ic">{b.icon}</span>
        <span className="banner-text">{b.text}</span>
      </div>
      {b.sub && <div className="banner-sub">{b.sub}</div>}
    </div>
  );
}

function Hint() {
  const { hud, usingPhone, timing, opponent, local2p } = useUi();
  const t = useFlash(timing, timing?.key, 900);
  if (!hud) return null;
  let text = '';
  if (hud.phase === 'serve' && hud.server === 0) text = usingPhone ? 'Tap your phone to toss, then swing!' : 'Press Space to toss, then click to swing!';
  else if (hud.phase === 'toss' && hud.server === 0) text = 'Swing as it drops!';
  else if (hud.phase === 'pointOver' && hud.server === 1) text = `Next serve: ${opponent.name}`;
  if (local2p && hud.phase === 'serve') text = `Player ${hud.server + 1}: tap your phone to toss, then swing!`;
  if (t && !t.hit) text = Math.abs(t.offsetMs) < 400 ? (t.offsetMs < 0 ? 'A touch early…' : 'A touch late…') : 'Swing when the ball arrives…';
  return text ? <div className="coach script">{text}</div> : null;
}

/** Big volleyball timing cue: "Jump!" then "Spike!". */
function Cue() {
  const { cue, screen } = useUi();
  if (!cue || screen !== 'playing') return null;
  return (
    <div className="cue" key={cue}>
      {cue}
    </div>
  );
}

export function PhoneStatusPill() {
  const { phone, usingPhone } = useUi();
  if (!usingPhone && phone.phone === 'none') return null;
  const level = phone.transport === 'none' ? 'lost' : (phone.rtt ?? 0) > 120 ? 'weak' : 'good';
  const word = { good: 'Good', weak: 'Weak', lost: 'Lost' }[level];
  return (
    <div className="chip hud-phone" title={phone.transport === 'p2p' ? 'Peer-to-peer' : phone.transport === 'relay' ? 'Relay via server' : 'Disconnected'}>
      <span className={`conn-shape ${level}`} />
      Phone · {word}
      {phone.transport !== 'none' && phone.rtt !== null && (
        <span className="muted-ink">
          {' '}
          · {phone.transport === 'p2p' ? 'P2P' : 'Relay'} {phone.rtt} ms
        </span>
      )}
    </div>
  );
}

export function Hud() {
  const { hud, settings, matchPoint, screen } = useUi();
  if (!hud) return null;
  const live = screen === 'playing';
  return (
    <>
      {matchPoint === 0 && <div className="edge-glow" />}
      <Stage>
        <ScoreCard side={0} />
        <ScoreCard side={1} />
        <div className="rally">
          <div className="rally-pill">
            Rally <span style={{ color: 'var(--coral-600)' }}>{hud.rally}</span>
          </div>
          <div className="rally-sub">{settings.bestOf > 1 ? `Best of ${settings.bestOf} · Game ${hud.game}` : 'One game · first to 11'}</div>
        </div>
        <PhoneStatusPill />
        <VersusPill />
        <Cue />
        {live && (
          <>
            <Banner />
            <Hint />
            <HitFx />
            <Celebrate />
          </>
        )}
      </Stage>
    </>
  );
}
