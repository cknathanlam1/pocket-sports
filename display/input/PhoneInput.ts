// Phone paddle: orientation stream + calibration from the controller; taps (and swings in M3).
// Phone timestamps are converted to the laptop clock with the offset from clock sync.
import type { PhoneMsg, Quat } from '../../shared/protocol.ts';
import { IDENTITY, relativeTo } from '../../shared/quat.ts';
import { Emitter, type PaddleInput, type Swing } from './PaddleInput.ts';

export class PhoneInput implements PaddleInput {
  private swings = new Emitter<Swing>();
  private taps = new Emitter<number>();
  private q: Quat | null = null;
  private q0: Quat | null = null;
  /** laptop clock − phone clock (ms); null until the first sync round. */
  offset: number | null = null;
  rtt: number | null = null;
  /** Laptop time the last orientation sample arrived. */
  lastOrientAt = -Infinity;

  get calibrated(): boolean {
    return this.q0 !== null;
  }

  /** Forget calibration (phone disconnected; it resends q0 when it comes back). */
  reset(): void {
    this.q0 = null;
    this.q = null;
  }

  /** Phone timestamp → laptop performance.now(). Before sync, assume "just now". */
  toLocal(t: number): number {
    return this.offset === null ? performance.now() : Math.min(t + this.offset, performance.now());
  }

  handle(m: PhoneMsg): void {
    switch (m.k) {
      case 'o':
        this.q = m.q;
        this.lastOrientAt = performance.now();
        break;
      case 'cal':
        this.q0 = m.q0;
        break;
      case 'tap':
        this.taps.emit(this.toLocal(m.t));
        break;
      case 's':
        this.swings.emit({ t: this.toLocal(m.t), peak: m.peak, face: m.face, path: m.path, roll: m.roll });
        break;
      case 'sync':
        this.offset = m.off;
        this.rtt = m.rtt;
        break;
    }
  }

  orientation(): Quat {
    return this.q && this.q0 ? relativeTo(this.q0, this.q) : IDENTITY;
  }

  onSwing(cb: (s: Swing) => void): () => void {
    return this.swings.on(cb);
  }

  onTap(cb: (t: number) => void): () => void {
    return this.taps.on(cb);
  }

  dispose(): void {}
}
