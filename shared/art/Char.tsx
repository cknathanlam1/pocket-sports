// Big-head character (design component "Char"): poses idle/ready/swing/squash/cheer/sad, front or back view.
import type { CSSProperties } from 'react';

export type Pose = 'idle' | 'ready' | 'swing' | 'squash' | 'cheer' | 'sad';
export type HairStyle = 'short' | 'bun' | 'curly' | 'spiky';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  outfit: string;
}

export const P1_LOOK: Look = { skin: '#C98B5B', hair: '#1E1410', hairStyle: 'short', outfit: '#2F6FDB' };
export const MARLO_LOOK: Look = { skin: '#F1C9A0', hair: '#E57A58', hairStyle: 'bun', outfit: '#FF8A1F' };

const POSES: Record<Pose, [number, number, string]> = {
  idle: [0, 0, ''],
  ready: [10, -30, ''],
  swing: [30, -110, 'rotate(-10 60 180)'],
  cheer: [130, -130, 'translate(0 -16)'],
  sad: [-12, 14, 'translate(0 6) rotate(4 60 180)'],
  squash: [20, -60, 'translate(0 10) scale(1.08 .94)'],
};

const INK = '#10285A';

export function Char({
  size = 200,
  pose = 'idle',
  view = 'front',
  look = P1_LOOK,
  paddle,
  marker,
  style,
}: {
  size?: number;
  pose?: Pose;
  view?: 'front' | 'back';
  look?: Look;
  /** Paddle face color (defaults to the outfit color). */
  paddle?: string;
  marker?: 'circle' | 'diamond';
  style?: CSSProperties;
}) {
  const [lArm, rArm, bodyT] = POSES[pose];
  const face = ({ cheer: 'happy', swing: 'focus', squash: 'focus', sad: 'sad' } as Record<string, string>)[pose] ?? 'open';
  const mouth = ({ cheer: 'open', swing: 'open', sad: 'frown' } as Record<string, string>)[pose] ?? 'smile';
  const color = look.outfit;
  const pad = paddle ?? color;
  const mk = marker ?? (pad.toUpperCase() === '#FF8A1F' ? 'diamond' : 'circle');
  const { skin, hair, hairStyle: hs } = look;
  const pants = '#F8F4EC';
  const front = view === 'front';
  return (
    <svg viewBox="-24 -24 168 224" width={size * 0.75} height={size} aria-hidden="true" style={{ display: 'block', overflow: 'visible', ...style }}>
      <ellipse cx="60" cy="192" rx={pose === 'cheer' ? 30 : 42} ry="7" fill="rgba(16,40,90,.22)" />
      <g transform={bodyT}>
        <rect x="40" y="130" width="15" height="40" rx="7" fill={pants} stroke={INK} strokeWidth="4" />
        <rect x="65" y="130" width="15" height="40" rx="7" fill={pants} stroke={INK} strokeWidth="4" />
        <ellipse cx="45" cy="174" rx="14" ry="8" fill="#fff" stroke={INK} strokeWidth="4" />
        <ellipse cx="75" cy="174" rx="14" ry="8" fill="#fff" stroke={INK} strokeWidth="4" />
        <path d="M33 176 L57 176" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <path d="M63 176 L87 176" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <g transform={`rotate(${lArm} 36 90)`}>
          <path d="M36 90 L18 120" stroke={INK} strokeWidth="19" strokeLinecap="round" />
          <path d="M36 90 L18 120" stroke={color} strokeWidth="11" strokeLinecap="round" />
          <circle cx="17" cy="122" r="9" fill={skin} stroke={INK} strokeWidth="3.5" />
        </g>
        <rect x="31" y="76" width="58" height="62" rx="22" fill={color} stroke={INK} strokeWidth="4.5" />
        <path d="M82 84 C88 100 88 120 82 134 L74 134 C80 118 80 100 76 82Z" fill="rgba(16,40,90,.18)" />
        <path d="M31 112 L89 112" stroke="#fff" strokeWidth="5" />
        {front && <path d="M50 77 Q60 88 70 77" stroke={INK} strokeWidth="3.5" fill={skin} />}
        {!front && mk === 'circle' && <circle cx="60" cy="96" r="11" fill="#fff" stroke={INK} strokeWidth="3.5" />}
        {!front && mk === 'diamond' && <rect x="52" y="88" width="16" height="16" fill="#fff" stroke={INK} strokeWidth="3.5" transform="rotate(45 60 96)" />}
        <circle cx="25" cy="50" r="7" fill={skin} stroke={INK} strokeWidth="3.5" />
        <circle cx="95" cy="50" r="7" fill={skin} stroke={INK} strokeWidth="3.5" />
        <circle cx="60" cy="44" r="35" fill={skin} stroke={INK} strokeWidth="4.5" />
        {front ? (
          <>
            {hs === 'short' && <path d="M25 46 C20 6 100 6 95 46 C90 30 76 22 62 28 C52 20 34 26 25 46Z" fill={hair} stroke={INK} strokeWidth="4" strokeLinejoin="round" />}
            {hs === 'bun' && (
              <>
                <circle cx="60" cy="4" r="14" fill={hair} stroke={INK} strokeWidth="4" />
                <path d="M25 50 C18 4 102 4 95 50 C92 34 82 24 60 26 C38 24 28 34 25 50Z" fill={hair} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
              </>
            )}
            {hs === 'curly' && (
              <>
                <g fill={hair} stroke={INK} strokeWidth="4">
                  <circle cx="30" cy="34" r="12" />
                  <circle cx="44" cy="18" r="13" />
                  <circle cx="62" cy="12" r="14" />
                  <circle cx="80" cy="18" r="13" />
                  <circle cx="92" cy="34" r="12" />
                </g>
                <path d="M26 38 Q60 20 94 38 L94 30 Q60 4 26 30Z" fill={hair} />
              </>
            )}
            {hs === 'spiky' && (
              <path d="M25 44 L22 20 L36 26 L40 4 L52 20 L62 0 L70 20 L84 6 L86 26 L100 22 L95 44 C88 30 74 26 60 30 C46 26 32 30 25 44Z" fill={hair} stroke={INK} strokeWidth="4" strokeLinejoin="round" />
            )}
            {face === 'open' && (
              <>
                <ellipse cx="47" cy="48" rx="5.5" ry="7.5" fill={INK} />
                <ellipse cx="73" cy="48" rx="5.5" ry="7.5" fill={INK} />
                <circle cx="49" cy="45" r="2" fill="#fff" />
                <circle cx="75" cy="45" r="2" fill="#fff" />
                <path d="M40 36 Q47 32 54 35" stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round" />
                <path d="M66 35 Q73 32 80 36" stroke={INK} strokeWidth="3.5" fill="none" strokeLinecap="round" />
              </>
            )}
            {face === 'happy' && (
              <>
                <path d="M40 50 Q47 39 54 50" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" />
                <path d="M66 50 Q73 39 80 50" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" />
              </>
            )}
            {face === 'focus' && (
              <>
                <ellipse cx="48" cy="50" rx="5" ry="5" fill={INK} />
                <ellipse cx="72" cy="50" rx="5" ry="5" fill={INK} />
                <path d="M38 37 L55 43" stroke={INK} strokeWidth="5" strokeLinecap="round" />
                <path d="M82 37 L65 43" stroke={INK} strokeWidth="5" strokeLinecap="round" />
              </>
            )}
            {face === 'sad' && (
              <>
                <ellipse cx="47" cy="51" rx="4.5" ry="5.5" fill={INK} />
                <ellipse cx="73" cy="51" rx="4.5" ry="5.5" fill={INK} />
                <path d="M39 40 L54 36" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
                <path d="M81 40 L66 36" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
                <path d="M36 60 C32 68 32 74 37 74 C42 74 41 68 36 60Z" fill="#5BC8F5" stroke={INK} strokeWidth="2" />
              </>
            )}
            <ellipse cx="38" cy="60" rx="6" ry="4" fill="#FF5FA2" opacity=".45" />
            <ellipse cx="82" cy="60" rx="6" ry="4" fill="#FF5FA2" opacity=".45" />
            {mouth === 'smile' && <path d="M50 62 Q60 72 70 62" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" />}
            {mouth === 'open' && (
              <>
                <path d="M47 59 Q60 84 73 59Z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                <ellipse cx="60" cy="71" rx="6.5" ry="4" fill="#FF5FA2" />
              </>
            )}
            {mouth === 'frown' && <path d="M51 70 Q60 62 69 70" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" />}
          </>
        ) : (
          <>
            <path d="M25 48 C20 2 100 2 95 48 C95 66 82 78 60 78 C38 78 25 66 25 48Z" fill={hair} stroke={INK} strokeWidth="4" />
            <path d="M42 22 Q60 14 78 22" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".35" />
          </>
        )}
        <g transform={`rotate(${rArm} 84 90)`}>
          <path d="M84 90 L102 120" stroke={INK} strokeWidth="19" strokeLinecap="round" />
          <path d="M84 90 L102 120" stroke={color} strokeWidth="11" strokeLinecap="round" />
          <rect x="104" y="112" width="8" height="18" rx="3" fill="#C98B5B" stroke={INK} strokeWidth="2.5" transform="rotate(-40 108 121)" />
          <circle cx="116" cy="104" r="21" fill={INK} />
          <circle cx="116" cy="104" r="17.5" fill={pad} stroke="#fff" strokeWidth="4" />
          {mk === 'circle' && <circle cx="116" cy="104" r="5.5" fill="#fff" />}
          {mk === 'diamond' && <rect x="111.5" y="99.5" width="9" height="9" fill="#fff" transform="rotate(45 116 104)" />}
          <circle cx="103" cy="122" r="9" fill={skin} stroke={INK} strokeWidth="3.5" />
        </g>
      </g>
    </svg>
  );
}
