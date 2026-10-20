// The design is drawn at 1440×900. Screens render on a stage of that size, scaled to fit the window.
import { type ReactNode, useEffect, useState } from 'react';

export const STAGE_W = 1440;
export const STAGE_H = 900;

function useFit(): { k: number; x: number; y: number } {
  const calc = () => {
    const k = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    return { k, x: (window.innerWidth - STAGE_W * k) / 2, y: (window.innerHeight - STAGE_H * k) / 2 };
  };
  const [fit, setFit] = useState(calc);
  useEffect(() => {
    const on = () => setFit(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return fit;
}

export function Stage({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { k, x, y } = useFit();
  return (
    <div className={`stage ${className}`} style={{ transform: `translate(${x}px, ${y}px) scale(${k})` }}>
      {children}
    </div>
  );
}

/** Full-window wash over the 3D scene (cream for menus, ink scrim for modals). */
export function Wash({ color }: { color: string }) {
  return <div className="wash" style={{ background: color }} />;
}
