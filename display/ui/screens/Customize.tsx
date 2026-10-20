// 2h Character customization.
import { useState } from 'react';
import { Char, type HairStyle, type Look, type Pose } from '../../../shared/art/Char.tsx';
import type { Runtime } from '../../runtime.ts';
import { store, useUi } from '../../store.ts';
import { Stage } from '../Stage.tsx';

const SKINS = ['#F1C9A0', '#E8B48A', '#C98B5B', '#8A5A3A', '#5A3A28', '#3A261A'];
const HAIRS = ['#1E1410', '#3B2A20', '#8A5A3A', '#E57A58', '#FFD23F', '#7FA2DC'];
const OUTFITS = ['#2F6FDB', '#FF8A1F', '#5DC265', '#F29FB3', '#FFD23F', '#10285A'];
const STYLES: HairStyle[] = ['short', 'bun', 'curly', 'spiky'];
const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;

export function Customize({ rt }: { rt: Runtime }) {
  const ui = useUi();
  const [look, setLook] = useState<Look>(ui.look);
  const [view, setView] = useState<'front' | 'back'>('front');
  const [pose, setPose] = useState<Pose>('idle');
  const preview = () => {
    setPose('squash');
    setTimeout(() => setPose('swing'), 180);
    setTimeout(() => setPose('idle'), 900);
  };
  const groups: Array<{ g: string; key: keyof Look; items: string[]; round: boolean }> = [
    { g: 'SKIN TONE', key: 'skin', items: SKINS, round: true },
    { g: 'HAIR', key: 'hair', items: HAIRS, round: false },
    { g: 'OUTFIT COLOR', key: 'outfit', items: OUTFITS, round: false },
  ];
  return (
    <>
      <div className="wash" style={{ background: 'var(--cream-100)' }} />
      <Stage>
        <div className="custom" data-ui>
          <div className="custom-left">
            <button className="chip back-chip" onClick={() => rt.go('menu')}>
              ‹ Back
            </button>
            <div className="custom-disc" />
            <div style={{ position: 'relative' }}>
              <Char size={520} look={look} view={view} pose={pose} paddle="#2F6FDB" marker="circle" />
            </div>
            <div className="custom-actions">
              <button className="chip" onClick={() => setView(view === 'front' ? 'back' : 'front')}>
                ↺ Turn
              </button>
              <button className="chip" onClick={preview}>
                Preview swing
              </button>
            </div>
          </div>
          <div className="custom-right">
            <div className="h-display" style={{ fontSize: 56 }}>
              Make it yours
            </div>
            {groups.map((g) => (
              <div key={g.g} className="swatch-group">
                <div className="caption-caps muted-ink" style={{ fontSize: 15, letterSpacing: '.1em' }}>
                  {g.g}
                </div>
                <div className="swatches">
                  {g.items.map((c) => {
                    const on = look[g.key] === c;
                    return (
                      <button key={c} aria-label={`${g.g.toLowerCase()} ${c}`} aria-pressed={on} className={`swatch ${on ? 'on' : ''}`} style={{ background: c, borderRadius: g.round ? '50%' : 16 }} onClick={() => setLook({ ...look, [g.key]: c })}>
                        {on ? '✓' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="swatch-group">
              <div className="caption-caps muted-ink" style={{ fontSize: 15, letterSpacing: '.1em' }}>
                HAIR STYLE
              </div>
              <div className="swatches">
                {STYLES.map((s) => (
                  <button key={s} className={`seg ${look.hairStyle === s ? 'on' : ''}`} onClick={() => setLook({ ...look, hairStyle: s })}>
                    {s[0]!.toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="note-card">
              Your <b>paddle and score badge stay Player Blue ●</b> whatever you wear, so you can always find yourself.
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', gap: 16 }}>
              <button
                className="btn primary"
                onClick={() => {
                  store.set({ look });
                  store.toast('Customization saved', '✓', 'ok');
                  rt.go('menu');
                }}
              >
                Save
              </button>
              <button className="btn" onClick={() => setLook({ skin: pick(SKINS), hair: pick(HAIRS), outfit: pick(OUTFITS), hairStyle: pick(STYLES) })}>
                Randomize
              </button>
            </div>
          </div>
        </div>
      </Stage>
    </>
  );
}
