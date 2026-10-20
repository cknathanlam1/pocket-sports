// Mouse/keyboard paddle. Mouse Y = face angle (up = open), click or sideways flick = swing with
// speed from mouse velocity, W/S = topspin/backspin, A/D = sidespin, Space = serve toss.
import type { Quat } from '../../shared/protocol.ts';
import { fromAxisAngle, multiply } from '../../shared/quat.ts';
import { Emitter, type PaddleInput, type Swing } from './PaddleInput.ts';

const FACE_MAX = (45 * Math.PI) / 180;
const SPIN_RATE = 600; // deg/s reported for path/roll while a spin key is held
const REFRACTORY_MS = 250;
const FLICK_PX_PER_S = 2500;

export class MouseInput implements PaddleInput {
  private swings = new Emitter<Swing>();
  private taps = new Emitter<number>();
  private samples: Array<{ t: number; x: number; y: number }> = [];
  private nx = 0.5; // normalised mouse position
  private ny = 0.5;
  private keys = new Set<string>();
  private lastSwing = -Infinity;
  private off: Array<() => void> = [];

  constructor() {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn as EventListener);
      this.off.push(() => window.removeEventListener(type, fn as EventListener));
    };
    on('mousemove', (e) => this.move(e));
    on('mousedown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement)?.closest?.('button, input, select, a, [data-ui]')) return;
      this.swing(this.speed());
    });
    on('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === ' ' && !e.repeat) {
        e.preventDefault();
        this.taps.emit(performance.now());
      }
      this.keys.add(k);
    });
    on('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    on('blur', () => this.keys.clear());
  }

  private move(e: MouseEvent): void {
    const t = performance.now();
    this.nx = e.clientX / window.innerWidth;
    this.ny = e.clientY / window.innerHeight;
    this.samples.push({ t, x: e.clientX, y: e.clientY });
    while (this.samples.length && this.samples[0]!.t < t - 120) this.samples.shift();
    const v = this.velocity();
    if (Math.abs(v.x) > FLICK_PX_PER_S) this.swing(Math.hypot(v.x, v.y));
  }

  /** Mouse velocity (px/s) over the last ~100 ms. */
  private velocity(): { x: number; y: number } {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const a = s[0]!;
    const b = s[s.length - 1]!;
    const dt = Math.max((b.t - a.t) / 1000, 1e-3);
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
  }

  private speed(): number {
    const now = performance.now();
    if (!this.samples.length || this.samples[this.samples.length - 1]!.t < now - 120) return 0;
    const v = this.velocity();
    return Math.hypot(v.x, v.y);
  }

  private face(): number {
    return (0.5 - this.ny) * 2 * FACE_MAX;
  }

  private axis(pos: string, neg: string): number {
    return (this.keys.has(pos) ? 1 : 0) - (this.keys.has(neg) ? 1 : 0);
  }

  private swing(pxPerSec: number): void {
    const t = performance.now();
    if (t - this.lastSwing < REFRACTORY_MS) return;
    this.lastSwing = t;
    // Still mouse + click = medium swing; faster mouse = harder swing.
    const peak = Math.min(1800, 600 + pxPerSec * 0.3);
    this.swings.emit({
      t,
      peak,
      face: this.face(),
      path: this.axis('w', 's') * SPIN_RATE,
      roll: this.axis('d', 'a') * SPIN_RATE,
    });
  }

  orientation(): Quat {
    // Visual pose only: pitch from face, a little yaw from mouse X, roll while sidespin is held.
    const pitch = fromAxisAngle(1, 0, 0, this.face());
    const yaw = fromAxisAngle(0, 1, 0, (0.5 - this.nx) * 0.6);
    const roll = fromAxisAngle(0, 0, 1, -this.axis('d', 'a') * 0.35);
    return multiply(yaw, multiply(pitch, roll));
  }

  onSwing(cb: (s: Swing) => void): () => void {
    return this.swings.on(cb);
  }

  onTap(cb: (t: number) => void): () => void {
    return this.taps.on(cb);
  }

  /** Spin keys currently held, for the HUD. */
  spinKeys(): { top: number; side: number } {
    return { top: this.axis('w', 's'), side: this.axis('d', 'a') };
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
  }
}
