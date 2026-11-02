import { createRoot } from 'react-dom/client';
import '../shared/styles/tokens.css';
import '../shared/styles/game.css';
import './display.css';
import { Runtime } from './runtime.ts';
import { store } from './store.ts';
import { sfx } from './audio/Sfx.ts';
import { App } from './ui/App.tsx';

// UI sounds (design: rounded marimba blips): select on buttons, a lower note for Back.
document.addEventListener('pointerdown', (e) => {
  const b = (e.target as HTMLElement).closest?.('#ui button');
  if (!b) return;
  if (/back|‹/i.test(b.textContent ?? '')) sfx.uiBack();
  else sfx.uiSelect();
});

function Fatal({ title, body }: { title: string; body: string }) {
  return (
    <div className="fatal">
      <div className="fatal-card">
        <div className="h-display" style={{ fontSize: 44 }}>
          {title}
        </div>
        <div className="row-desc" style={{ fontSize: 19 }}>
          {body}
        </div>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    </div>
  );
}

const ui = createRoot(document.getElementById('ui')!);
// three.js needs WebGL 2 (every current desktop browser has it; it can be off via flags, policy or a blocklisted GPU).
const hasWebGL2 = (() => {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
})();

let rt: Runtime | null = null;
try {
  if (hasWebGL2) rt = new Runtime(document.getElementById('scene') as HTMLCanvasElement);
} catch (err) {
  console.error(err);
}
if (rt) ui.render(<App rt={rt} />);
else
  ui.render(
    <Fatal
      title={hasWebGL2 ? 'The 3D view couldn’t start' : 'This browser can’t show 3D'}
      body="Pocket Sports needs WebGL 2. Use a current Chrome, Edge, Firefox or Safari, and turn on hardware acceleration (Chrome: Settings → System). On a work laptop, graphics may be blocked by policy."
    />,
  );

// Dev-only handle for console debugging and scripted playtests.
if (import.meta.env.DEV) Object.assign(window, { pocket: rt, pocketStore: store });
