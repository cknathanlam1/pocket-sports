import { createRoot } from 'react-dom/client';
import '../shared/styles/tokens.css';
import './display.css';
import { startScene } from './scene.ts';
import { App } from './ui/App.tsx';

startScene(document.getElementById('scene') as HTMLCanvasElement);
createRoot(document.getElementById('ui')!).render(<App />);
