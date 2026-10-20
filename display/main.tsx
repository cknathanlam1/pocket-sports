import { createRoot } from 'react-dom/client';
import '../shared/styles/tokens.css';
import './display.css';
import { Runtime } from './runtime.ts';
import { App } from './ui/App.tsx';

const rt = new Runtime(document.getElementById('scene') as HTMLCanvasElement);
createRoot(document.getElementById('ui')!).render(<App rt={rt} />);

// Dev-only handle for console debugging and scripted playtests.
if (import.meta.env.DEV) (window as unknown as { pocket: Runtime }).pocket = rt;
