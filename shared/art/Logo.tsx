// Wordmark (flat, for chrome) and the expressive 7a lockup (stroked, on sunburst screens only).
import type { CSSProperties } from 'react';

export function Wordmark({ size = 40, onBrand = false, style }: { size?: number; onBrand?: boolean; style?: CSSProperties }) {
  return (
    <div
      aria-label="Pocket Sports"
      style={{ font: `800 ${size}px/1 var(--font-display)`, letterSpacing: '-0.045em', color: onBrand ? 'var(--cream-100)' : 'var(--cobalt-500)', whiteSpace: 'nowrap', ...style }}
    >
      POCKET <span style={{ color: onBrand ? 'var(--coral-400)' : 'var(--coral-500)' }}>SPORTS</span>
    </div>
  );
}

/** Chunky stroked lockup: POCKET lagoon / SPORTS vivid coral, ink stroke + solid ink drop, −5° tilt. */
export function BigLogo({ width = 760 }: { width?: number }) {
  const word = (text: string, x: number, y: number, fill: string) => (
    <>
      <text x={x} y={y} fontSize="190" fill="#10285A" stroke="#10285A" strokeWidth="30" transform="translate(0 14)">
        {text}
      </text>
      <text x={x} y={y} fontSize="190" fill={fill} stroke="#10285A" strokeWidth="24">
        {text}
      </text>
    </>
  );
  return (
    <svg viewBox="40 60 1020 440" width={width} role="img" aria-label="Pocket Sports" className="big-logo" style={{ display: 'block', overflow: 'visible' }}>
      <g transform="rotate(-5 550 300)" fontFamily="Poppins" fontWeight="800" textAnchor="middle" letterSpacing="-6" strokeLinejoin="round" paintOrder="stroke">
        {word('POCKET', 550, 278, '#5CCFE0')}
        {word('SPORTS', 570, 448, '#FD6E45')}
      </g>
      <g transform="translate(905 170) rotate(-18)">
        <g className="logo-ball">
        <circle r="44" fill="#FFD23F" stroke="#10285A" strokeWidth="8" />
        <circle cx="-14" cy="-14" r="10" fill="#fff" opacity=".8" />
        <g stroke="#fff" strokeWidth="9" strokeLinecap="round">
          <line x1="-70" y1="0" x2="-120" y2="0" />
          <line x1="-64" y1="-26" x2="-104" y2="-40" />
          <line x1="-64" y1="26" x2="-104" y2="40" />
        </g>
        </g>
      </g>
    </svg>
  );
}

/** Rotating conic ray burst centred in its parent. */
export function Sunburst({ size = 1900, a = '#255DB7', b = '#3D74CF', seconds = 40, opacity = 1 }: { size?: number; a?: string; b?: string; seconds?: number; opacity?: number }) {
  return (
    <div
      aria-hidden="true"
      className="sunburst"
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: '50%',
        opacity,
        background: `repeating-conic-gradient(${a} 0deg 10deg, ${b} 10deg 20deg)`,
        animation: `ps-spin ${seconds}s linear infinite`,
        pointerEvents: 'none',
      }}
    />
  );
}

/** Pointed star polygon points, for hit bursts. */
export function starPoints(n: number, R: number, r: number): string {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const d = i % 2 ? r : R;
    return `${(Math.cos(a) * d).toFixed(1)},${(Math.sin(a) * d).toFixed(1)}`;
  }).join(' ');
}

/** Stroked display word with a solid ink drop (SMASH!, POINT!). */
export function StampWord({ text, size, fill, stroke = 26 }: { text: string; size: number; fill: string; stroke?: number }) {
  const w = text.length * size * 0.7 + 60;
  return (
    <svg width={w} height={size * 1.3} viewBox={`0 0 ${w} ${size * 1.3}`} style={{ overflow: 'visible', display: 'block' }} role="img" aria-label={text}>
      <g fontFamily="Poppins" fontWeight="800" fontSize={size} textAnchor="middle" letterSpacing={-size * 0.03} strokeLinejoin="round" paintOrder="stroke">
        <text x="50%" y={size * 1.05 + 10} fill="#10285A" stroke="#10285A" strokeWidth={stroke + 6}>
          {text}
        </text>
        <text x="50%" y={size * 1.05} fill={fill} stroke="#10285A" strokeWidth={stroke}>
          {text}
        </text>
      </g>
    </svg>
  );
}
