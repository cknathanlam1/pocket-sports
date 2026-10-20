// Paddle illustration (design component "Paddle"): oversized round face, white rim, wood grip, ●/◆ marker.
import type { CSSProperties } from 'react';

export type Marker = 'circle' | 'diamond' | 'none';

export function Paddle({ color = '#2F6FDB', marker = 'circle', size = 200, glow = false, style }: { color?: string; marker?: Marker; size?: number; glow?: boolean; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 200 320"
      width={size}
      height={size * 1.6}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible', filter: glow ? `drop-shadow(0 0 ${size * 0.12}px ${color})` : undefined, ...style }}
    >
      <rect x="82" y="176" width="36" height="118" rx="16" fill="#C98B5B" stroke="#10285A" strokeWidth="5" />
      <rect x="82" y="268" width="36" height="26" rx="13" fill="#10285A" opacity=".85" />
      <circle cx="100" cy="100" r="92" fill="#fff" stroke="#10285A" strokeWidth="5" />
      <circle cx="100" cy="100" r="78" fill={color} stroke="#10285A" strokeWidth="4" />
      <path d="M44 78 A62 62 0 0 1 96 38" stroke="#fff" strokeWidth="9" fill="none" strokeLinecap="round" opacity=".45" />
      {marker === 'circle' && <circle cx="100" cy="104" r="26" fill="#fff" stroke="#10285A" strokeWidth="4" />}
      {marker === 'diamond' && <polygon points="100,70 134,104 100,138 66,104" fill="#fff" stroke="#10285A" strokeWidth="4" strokeLinejoin="round" />}
    </svg>
  );
}
