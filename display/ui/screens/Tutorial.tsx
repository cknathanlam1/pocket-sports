// 2d–2f Quick lesson: timing, paddle tilt, spin. Works with the phone or the mouse: each step has a
// live meter with a green zone and a success card; two successes (one for tilt/spin) advance.
import { useEffect, useRef, useState } from 'react';
import { HandPhone } from '../../../shared/art/HandPhone.tsx';
import { Wordmark } from '../../../shared/art/Logo.tsx';
import { sfx } from '../../audio/Sfx.ts';
import type { Runtime } from '../../runtime.ts';
import { store } from '../../store.ts';
import { Stage } from '../Stage.tsx';

const CYCLE_MS = 1700; // a "ball" crosses the timing meter once per cycle

interface Step {
  kick: string;
  title: string;
  body: string;
  mode: 'swing' | 'tilt' | 'spin';
  meter: string;
  zone: [number, number]; // % of the meter
  l: string;
  r: string;
  win: string;
  need: number;
}

const STEPS: Step[] = [
  {
    kick: 'TIMING',
    title: 'Swing when the ball arrives',
    body: 'Early pulls the ball across the table. Late pushes it the other way. Swing as the ball crosses the green zone.',
    mode: 'swing',
    meter: 'YOUR TIMING',
    zone: [38, 62],
    l: '← Early · cross-court',
    r: 'Late · opposite way →',
    win: 'Perfect timing!',
    need: 2,
  },
  {
    kick: 'TILT',
    title: 'Tilt to aim high or low',
    body: 'Open face (tipped back) lobs a high, soft ball. Closed face (tipped forward) drives it low and flat. Open it a little, then swing.',
    mode: 'tilt',
    meter: 'YOUR PADDLE ANGLE',
    zone: [55, 80],
    l: '← Closed · low drive',
    r: 'Open · high & soft →',
    win: 'Nice lob!',
    need: 1,
  },
  {
    kick: 'SPIN',
    title: 'Brush up for topspin',
    body: 'Brush up for topspin, chop down for backspin, roll your wrist for sidespin. Try a brush-up swing now (mouse: hold W while you click).',
    mode: 'spin',
    meter: 'YOUR SWING PATH',
    zone: [60, 92],
    l: '← Backspin',
    r: 'Topspin →',
    win: 'Topspin!',
    need: 1,
  },
];

const clampPct = (v: number) => Math.max(1, Math.min(99, v));

export function Tutorial({ rt }: { rt: Runtime }) {
  const [step, setStep] = useState(0);
  const [hits, setHits] = useState(0);
  const [mark, setMark] = useState(50);
  const [done, setDone] = useState<string | null>(null);
  const [live, setLive] = useState(50);
  const t0 = useRef(performance.now());
  const s = STEPS[step]!;

  // Live meter: timing = sweeping ball; tilt = paddle angle; spin = last swing only.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (s.mode === 'swing') setLive((((performance.now() - t0.current) % CYCLE_MS) / CYCLE_MS) * 100);
      else if (s.mode === 'tilt') setLive(clampPct(50 + (rt.liveFaceDeg() / 90) * 100));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [s.mode, rt]);

  useEffect(() => {
    setHits(0);
    setDone(null);
    setMark(50);
    t0.current = performance.now();
  }, [step]);

  const finish = () => {
    store.set({ tutorialDone: true });
    store.toast('Lesson complete. Have fun!', '✓', 'ok');
    rt.go('menu');
  };

  // Swings from phone or mouse are judged here instead of in a game.
  useEffect(
    () =>
      rt.tapSwings((sw) => {
        if (done) return;
        let pct: number;
        if (s.mode === 'swing') pct = (((sw.t - t0.current) % CYCLE_MS) / CYCLE_MS) * 100;
        else if (s.mode === 'tilt') pct = clampPct(50 + (((sw.face * 180) / Math.PI) / 90) * 100);
        else pct = clampPct(50 + (sw.path / 600) * 50);
        setMark(pct);
        const ok = pct >= s.zone[0] && pct <= s.zone[1];
        if (!ok) {
          sfx.uiBack();
          return;
        }
        sfx.hit(40);
        const n = hits + 1;
        setHits(n);
        if (n >= s.need) {
          sfx.uiSelect();
          setDone(s.mode === 'tilt' ? `You opened the face about ${Math.round((sw.face * 180) / Math.PI)}°.` : s.mode === 'spin' ? 'The ball dips and kicks forward.' : 'Ball goes straight down the middle.');
          setTimeout(() => (step < STEPS.length - 1 ? setStep(step + 1) : finish()), 1600);
        }
      }),
    [s, hits, done, step, rt],
  );

  const shown = s.mode === 'spin' ? mark : live;
  return (
    <>
      <div className="wash" style={{ background: 'var(--cream-100)' }} />
      <Stage>
        <div className="tut" data-ui>
          <div className="tut-head">
            <Wordmark size={28} />
            <div className="tut-progress">
              Quick lesson
              {STEPS.map((_, i) => (
                <span key={i} style={{ background: i <= step ? 'var(--cobalt-500)' : 'var(--cobalt-100)' }} />
              ))}
            </div>
            <button className="link-btn" style={{ color: 'var(--ink-500)' }} onClick={finish}>
              Skip tutorial ›
            </button>
          </div>
          <div className="tut-body">
            <div className="tut-left">
              <div className="caption-caps" style={{ color: 'var(--coral-600)', fontSize: 15 }}>
                STEP {step + 1} · {s.kick}
              </div>
              <div className="h-display" style={{ fontSize: 58 }}>
                {s.title}
              </div>
              <div className="tut-text">{s.body}</div>
            </div>
            <div className="tut-disc">
              <HandPhone mode={s.mode} rot={s.mode === 'tilt' ? -Math.max(-30, Math.min(30, ((live - 50) / 100) * 90)) : s.mode === 'spin' ? 8 : 0} size={320} />
            </div>
            <div className="tut-right">
              <div className="meter-card">
                <div className="meter-label">{s.meter}</div>
                <div className="meter">
                  <div className="meter-zone" style={{ left: `${s.zone[0]}%`, width: `${s.zone[1] - s.zone[0]}%` }} />
                  {s.mode === 'swing' && <div className="meter-ball" style={{ left: `${shown}%` }} />}
                  <div className="meter-mark" style={{ left: `${s.mode === 'swing' ? mark : shown}%` }} />
                </div>
                <div className="meter-ends">
                  <span>{s.l}</span>
                  <span>{s.r}</span>
                </div>
                {s.need > 1 && (
                  <div className="meter-count">
                    {hits}/{s.need} in the zone
                  </div>
                )}
              </div>
              {done ? (
                <div className="win-card panel-in">
                  <div className="win-check">✓</div>
                  <div>
                    <div className="win-title">{s.win}</div>
                    <div className="row-desc">{done}</div>
                  </div>
                </div>
              ) : (
                <div className="try-card">Your turn: swing the phone (or click).</div>
              )}
            </div>
          </div>
        </div>
      </Stage>
    </>
  );
}
