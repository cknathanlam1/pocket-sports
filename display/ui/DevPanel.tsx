// Dev panel (toggle with `): live link/sensor readouts, rotation-rate graph with detected swings,
// last swing + last hit timing, and a slider for every tuning value (saved to localStorage).
import { useEffect, useReducer, useRef, useState } from 'react';
import { defaultConfig } from '../../engine/config.ts';
import type { Runtime } from '../runtime.ts';
import { getPath, numericLeaves, resetConfig, saveConfig, setPath, sliderRange } from '../devConfig.ts';
import { useUi } from '../store.ts';

const GRAPH_MS = 4000;

function RateGraph({ rt }: { rt: Runtime }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = ref.current;
      const ctx = c?.getContext('2d');
      if (c && ctx) {
        const W = c.width;
        const H = c.height;
        const now = performance.now();
        const maxW = 2000;
        const x = (t: number) => W - ((now - t) / GRAPH_MS) * W;
        const y = (w: number) => H - (Math.min(w, maxW) / maxW) * (H - 6) - 3;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#FFFDF8';
        ctx.fillRect(0, 0, W, H);
        // Onset threshold.
        const onset = rt.cfg.swing.onsetDegPerSec;
        ctx.strokeStyle = '#D65F3A';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y(onset));
        ctx.lineTo(W, y(onset));
        ctx.stroke();
        ctx.setLineDash([]);
        // |ω| trace.
        ctx.strokeStyle = '#255DB7';
        ctx.lineWidth = 2;
        ctx.beginPath();
        let first = true;
        for (const s of rt.host.input.rateHistory) {
          if (now - s.t > GRAPH_MS) continue;
          if (first) ctx.moveTo(x(s.t), y(s.w));
          else ctx.lineTo(x(s.t), y(s.w));
          first = false;
        }
        ctx.stroke();
        // Detected swings at their peak time (laptop clock).
        for (const s of rt.host.input.swingHistory) {
          if (now - s.t > GRAPH_MS) continue;
          ctx.fillStyle = '#FFD23F';
          ctx.strokeStyle = '#10285A';
          ctx.beginPath();
          ctx.arc(x(s.t), y(s.peak), 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.fillStyle = '#5A6F99';
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(`|ω| deg/s · onset ${onset} · last 4 s`, 6, 12);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [rt]);
  return <canvas ref={ref} width={360} height={120} className="dev-graph" />;
}

export function DevPanel({ rt }: { rt: Runtime }) {
  const { phone, timing } = useUi();
  const [, force] = useReducer((n: number) => n + 1, 0);
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const id = setInterval(force, 250); // refresh readouts
    return () => clearInterval(id);
  }, []);
  const inp = rt.host.input;
  const sw = inp.swingHistory.at(-1);
  const leaves = numericLeaves(rt.cfg).filter(([p]) => p.toLowerCase().includes(filter.toLowerCase()));
  const change = (path: string, v: number | string) => {
    setPath(rt.cfg, path, v);
    saveConfig(rt.cfg);
    if (path.startsWith('swing.')) rt.pushSwingConfig();
    force();
  };
  return (
    <div className="dev-panel" data-ui>
      <div className="dev-head">
        <b>Dev panel</b>
        <span className="dev-muted">` to close</span>
      </div>
      <div className="dev-grid">
        <span>transport</span>
        <b>{phone.transport}</b>
        <span>phone RTT</span>
        <b>{phone.rtt ?? '—'} ms</b>
        <span>clock offset</span>
        <b>{inp.offset === null ? '—' : `${inp.offset.toFixed(1)} ms`}</b>
        <span>orientation age</span>
        <b>{Number.isFinite(inp.lastOrientAt) ? `${Math.round(performance.now() - inp.lastOrientAt)} ms` : '—'}</b>
      </div>
      <RateGraph rt={rt} />
      <div className="dev-sub">Last swing</div>
      <div className="dev-grid">
        {sw ? (
          <>
            <span>peak</span>
            <b>{Math.round(sw.peak)} °/s</b>
            <span>face</span>
            <b>{Math.round((sw.face * 180) / Math.PI)}°</b>
            <span>path</span>
            <b>{Math.round(sw.path)} °/s</b>
            <span>roll</span>
            <b>{Math.round(sw.roll)} °/s</b>
            <span>delivery lag</span>
            <b>{Math.round(sw.arrived - sw.t)} ms</b>
          </>
        ) : (
          <span className="dev-muted">no phone swing yet</span>
        )}
      </div>
      <div className="dev-sub">Last hit</div>
      <div className="dev-grid">
        {timing ? (
          <>
            <span>timing</span>
            <b>
              {timing.offsetMs > 0 ? '+' : ''}
              {Math.round(timing.offsetMs)} ms ({timing.hit ? timing.timing : 'miss'})
            </b>
          </>
        ) : (
          <span className="dev-muted">no swing judged yet</span>
        )}
      </div>
      <div className="dev-sub">
        Tuning
        <input className="dev-filter" placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="dev-sliders">
        <label className="dev-row">
          <span>swing.rollAxis</span>
          <select value={rt.cfg.swing.rollAxis} onChange={(e) => change('swing.rollAxis', e.target.value)}>
            <option value="z">z (screen normal)</option>
            <option value="y">y (long axis)</option>
          </select>
        </label>
        {leaves.map(([path, v]) => {
          const def = getPath(defaultConfig, path) as number;
          const r = sliderRange(def);
          return (
            <label key={path} className={`dev-row ${v !== def ? 'changed' : ''}`}>
              <span title={path}>{path}</span>
              <input type="range" min={r.min} max={r.max} step={r.step} value={v} onChange={(e) => change(path, +e.target.value)} />
              <input type="number" step={r.step} value={+v.toFixed(5)} onChange={(e) => change(path, +e.target.value)} />
            </label>
          );
        })}
      </div>
      <div className="dev-actions">
        <button
          onClick={() => {
            void navigator.clipboard.writeText(JSON.stringify(rt.cfg, null, 2)).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied ✓' : 'Copy config'}
        </button>
        <button
          onClick={() => {
            resetConfig(rt.cfg);
            rt.pushSwingConfig();
            force();
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
