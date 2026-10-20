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

const rt = new Runtime(document.getElementById('scene') as HTMLCanvasElement);
createRoot(document.getElementById('ui')!).render(<App rt={rt} />);

// Dev-only handle for console debugging and scripted playtests.
if (import.meta.env.DEV) Object.assign(window, { pocket: rt, pocketStore: store });
