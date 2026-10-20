// Practice HUD: streak card, live ball-machine controls, per-feed result word.
import { useEffect, useState } from 'react';
import type { MachineSettings } from '../../../engine/game.ts';
import type { Runtime } from '../../runtime.ts';
import { useUi } from '../../store.ts';
import { Stage } from '../Stage.tsx';
import { PhoneStatusPill } from './Hud.tsx';

const RESULT: Record<string, { text: string; cls: string }> = {
  good: { text: 'Nice return!', cls: 'good' },
  miss: { text: 'Missed', cls: 'bad' },
  out: { text: 'Out', cls: 'bad' },
  net: { text: 'Net', cls: 'bad' },
};

function Seg<T extends string | number>({ label, value, opts, onPick }: { label: string; value: T; opts: Array<[T, string]>; onPick: (v: T) => void }) {
  return (
    <div className="mc-row">
      <div className="mc-label">{label}</div>
      <div className="mc-seg">
        {opts.map(([v, l]) => (
          <button key={String(v)} className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onPick(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PracticeHud({ rt }: { rt: Runtime }) {
  const { practice, machine, usingPhone, screen } = useUi();
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    if (!practice.last) return;
    setFlash(practice.last.result);
    const id = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(id);
  }, [practice.last?.key]);
  const set = (p: Partial<MachineSettings>) => rt.setMachine(p);
  const pct = practice.total ? Math.round((practice.good / practice.total) * 100) : 0;
  return (
    <Stage>
      <div className="pr-card">
        <div className="caption-caps" style={{ color: 'var(--coral-600)' }}>
          PRACTICE · BALL MACHINE
        </div>
        <div className="pr-streak">
          <div>
            <div className="pr-num">{practice.streak}</div>
            <div className="pr-cap">streak</div>
          </div>
          <div>
            <div className="pr-num small">{practice.best}</div>
            <div className="pr-cap">best</div>
          </div>
          <div>
            <div className="pr-num small">{pct}%</div>
            <div className="pr-cap">
              {practice.good}/{practice.total} returned
            </div>
          </div>
        </div>
      </div>
      <div className="mc-panel" data-ui>
        <div className="mc-title">Ball machine</div>
        <div className="mc-row">
          <div className="mc-label">
            Speed <b>{Math.round(machine.speed * 3.6)} km/h</b>
          </div>
          <input type="range" min={3} max={14} step={0.5} value={machine.speed} onChange={(e) => set({ speed: +e.target.value })} aria-label="Ball speed" />
        </div>
        <Seg label="Spin" value={machine.spin} onPick={(spin) => set({ spin })} opts={[['none', 'None'], ['top', 'Top'], ['back', 'Back'], ['side', 'Side'], ['mixed', 'Mix']]} />
        <Seg label="Placement" value={machine.placement} onPick={(placement) => set({ placement })} opts={[['backhand', 'BH'], ['middle', 'Mid'], ['forehand', 'FH'], ['random', 'Random']]} />
        <Seg label="Pace" value={machine.intervalMs} onPick={(intervalMs) => set({ intervalMs })} opts={[[1400, 'Relaxed'], [900, 'Normal'], [500, 'Fast']]} />
        <button className="btn small" onClick={() => rt.quitToMenu()}>
          End practice
        </button>
      </div>
      {flash && screen === 'playing' && (
        <div className={`pr-flash ${RESULT[flash]!.cls}`} key={practice.last?.key}>
          {RESULT[flash]!.text}
        </div>
      )}
      {screen === 'playing' && <div className="coach script">{usingPhone ? 'Swing your phone when the ball arrives' : 'Click (or flick the mouse) when the ball arrives'}</div>}
      <PhoneStatusPill />
    </Stage>
  );
}
