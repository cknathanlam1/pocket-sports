// Hand holding a phone (design component "HandPhone"), with motion cues for swing / tilt / spin.
export function HandPhone({ mode = 'hold', rot = 0, size = 260, screen = '#D6E2F5' }: { mode?: 'hold' | 'swing' | 'tilt' | 'spin'; rot?: number; size?: number; screen?: string }) {
  const cue = { stroke: '#E57A58', strokeWidth: 7, strokeLinecap: 'round' as const, fill: 'none' };
  return (
    <svg viewBox="0 0 300 300" width={size} height={size} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      {mode === 'swing' && (
        <>
          <path d="M40 70 Q150 10 260 70" {...cue} strokeDasharray="3 14" />
          <path d="M246 52 L264 72 L238 78" {...cue} strokeLinejoin="round" />
        </>
      )}
      {mode === 'tilt' && (
        <>
          <path d="M235 40 A120 120 0 0 1 270 120" {...cue} strokeDasharray="3 14" />
          <path d="M254 112 L272 126 L284 104" {...cue} strokeLinejoin="round" />
        </>
      )}
      {mode === 'spin' && (
        <>
          <ellipse cx="150" cy="120" rx="118" ry="34" {...cue} strokeDasharray="3 14" />
          <path d="M252 92 L262 118 L236 118" {...cue} strokeLinejoin="round" />
        </>
      )}
      <g transform={`rotate(${rot} 150 220)`}>
        <rect x="98" y="40" width="104" height="196" rx="20" fill="#10285A" />
        <rect x="106" y="50" width="88" height="176" rx="13" fill={screen} />
        <rect x="136" y="44" width="28" height="5" rx="2.5" fill="#2A4378" />
        <circle cx="150" cy="118" r="20" fill="#fff" stroke="#10285A" strokeWidth="3" />
        <rect x="124" y="164" width="52" height="22" rx="11" fill="#E57A58" />
        <rect x="84" y="190" width="132" height="70" rx="30" fill="#E8B48A" stroke="#10285A" strokeWidth="3" />
        <rect x="104" y="170" width="24" height="46" rx="12" fill="#E8B48A" stroke="#10285A" strokeWidth="3" transform="rotate(-25 116 216)" />
        <g fill="#E8B48A" stroke="#10285A" strokeWidth="3">
          <rect x="196" y="150" width="20" height="38" rx="10" />
          <rect x="196" y="182" width="22" height="34" rx="11" />
          <rect x="192" y="208" width="22" height="34" rx="11" />
        </g>
      </g>
    </svg>
  );
}
