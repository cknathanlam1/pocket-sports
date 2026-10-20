import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** QR code as an SVG path (dark modules merged per row). Quiet zone comes from the white frame. */
export function Qr({ text, size = 260 }: { text: string; size?: number }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!qr.isDark(r, c)) {
          c++;
          continue;
        }
        const start = c;
        while (c < n && qr.isDark(r, c)) c++;
        d += `M${start} ${r}h${c - start}v1h${start - c}z`;
      }
    }
    return { d, n };
  }, [text]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${path.n} ${path.n}`} role="img" aria-label={`QR code for ${text}`} shapeRendering="crispEdges" style={{ display: 'block' }}>
      <rect width={path.n} height={path.n} fill="#fff" />
      <path d={path.d} fill="#10285A" />
    </svg>
  );
}

export const isLocalHost = (): boolean => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
