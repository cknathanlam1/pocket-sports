// 2c Calibration mirror: the on-screen paddle copies the phone's tilt and roll until it calibrates.
import { useEffect, useState } from 'react';
import { Paddle } from '../../../shared/art/Paddle.tsx';
import { rotate } from '../../../shared/quat.ts';
import type { Runtime } from '../../runtime.ts';
import { useUi } from '../../store.ts';
import { Stage } from '../Stage.tsx';

const DEG = 180 / Math.PI;

/** Tilt (+ = face opened up) and roll (+ = clockwise) in degrees. Raw poses use earth z-up; calibrated poses use y-up. */
export function tiltRoll(q: [number, number, number, number], calibrated: boolean): { tilt: number; roll: number } {
  const z = rotate(q, [0, 0, 1]);
  const x = rotate(q, [1, 0, 0]);
  const up = calibrated ? 1 : 2;
  return { tilt: Math.asin(Math.max(-1, Math.min(1, z[up]))) * DEG, roll: -Math.asin(Math.max(-1, Math.min(1, x[up]))) * DEG };
}

function usePose(rt: Runtime): { tilt: number; roll: number; live: boolean } {
  const [pose, setPose] = useState({ tilt: 0, roll: 0, live: false });
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = rt.phonePose();
      if (p.q) setPose({ ...tiltRoll(p.q, p.calibrated), live: true });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rt]);
  return pose;
}

const fmt = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}°`;

export function Calibrate({ rt }: { rt: Runtime }) {
  const { phone } = useUi();
  const pose = usePose(rt);
  return (
    <>
      <div className="wash" style={{ background: 'var(--cream-100)' }} />
      <Stage>
        <div className="calib" data-ui>
          <div className="calib-left">
            <div className="caption-caps" style={{ color: 'var(--sun-300)' }}>
              STEP 1 OF 2 · CALIBRATE
            </div>
            <div className="calib-title">Hold it like a paddle. Point at the screen.</div>
            <div className="calib-sub">
              Then tap <b style={{ color: 'var(--sun-300)' }}>Calibrate</b> on your phone. Double-tap the phone anytime to reset.
            </div>
            <div className="calib-phone-row">
              <div className="mock-phone">
                <div className="mock-screen">
                  <div style={{ font: '700 15px/1.2 var(--font-display)' }}>Point at the laptop</div>
                  <div className="mock-btn">Calibrate</div>
                </div>
              </div>
              <div className="script" style={{ font: '600 30px/1.1 var(--font-script)', color: 'var(--sun-300)' }}>
                what your phone is asking for →
              </div>
            </div>
          </div>
          <div className="calib-right">
            <div className="target">
              <div className="target-ring" />
              <div className="target-v" />
              <div className="target-h" />
              <div style={{ transform: `rotate(${pose.roll}deg) scaleY(${Math.max(0.35, Math.cos((pose.tilt * Math.PI) / 180))})`, transition: 'transform 60ms linear' }}>
                <Paddle size={230} glow />
              </div>
              <div className="readout">
                Tilt {fmt(pose.tilt)} · Roll {fmt(pose.roll)}
              </div>
            </div>
            <div className="calib-status">
              <div className="chip">
                <span className={`conn-shape ${pose.live && phone.phone !== 'none' ? 'good' : 'lost'}`} />
                {pose.live && phone.phone !== 'none' ? 'Motion live' : 'Waiting for motion'}
              </div>
              <div className="script" style={{ font: '600 28px/1.1 var(--font-script)', color: 'var(--coral-600)', textAlign: 'right' }}>
                the paddle copies
                <br />
                your phone’s tilt
              </div>
            </div>
            <div className="calib-wait">Waiting for you to tap Calibrate on the phone…</div>
          </div>
        </div>
      </Stage>
    </>
  );
}
