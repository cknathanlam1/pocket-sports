// Phone paddle: orientation stream + calibration from the controller; taps (and swings in M3).
// Phone timestamps are converted to the laptop clock with the offset from clock sync.
import type { PhoneMsg, Quat } from '../../shared/protocol.ts';

export type PhoneAction = Extract<PhoneMsg, { k: 'act' }>;
import { IDENTITY, relativeTo } from '../../shared/quat.ts';
import { Emitter, type PaddleInput, type Swing } from './PaddleInput.ts';

export class PhoneInput implements PaddleInput {
  private swings = new Emitter<Swing>();
  private taps = new Emitter<number>();
  private pauses = new Emitter<void>();
  private actions = new Emitter<PhoneAction>();
  private q: Quat | null = null;
  private q0: Quat | null = null;
  /** laptop clock − phone clock (ms); null until the first sync round. */
  offset: number | null = null;
  rtt: number | null = null;
  /** Laptop time the last orientation sample arrived. */
  lastOrientAt = -Infinity;
  /** Dev graph: |ω| samples and detected swings, in laptop time (ms), last ~6 s. */
  readonly rateHistory: Array<{ t: number; w: number }> = [];
  readonly swingHistory: Array<Swing & { arrived: number }> = [];

  /** Latest raw device orientation (device → earth), before calibration. */
  get raw(): Quat | null {
    return this.q;
  }

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
        if (m.w !== undefined) {
          this.rateHistory.push({ t: this.toLocal(m.t), w: m.w });
          while (this.rateHistory.length > 400) this.rateHistory.shift();
        }
        break;
      case 'cal':
        this.q0 = m.q0;
        break;
      case 'tap':
        this.taps.emit(this.toLocal(m.t));
        break;
      case 's': {
        const sw = { t: this.toLocal(m.t), peak: m.peak, face: m.face, path: m.path, roll: m.roll };
        this.swingHistory.push({ ...sw, arrived: performance.now() });
        while (this.swingHistory.length > 20) this.swingHistory.shift();
        this.swings.emit(sw);
        break;
      }
      case 'pz':
        this.pauses.emit();
        break;
      case 'act':
        this.actions.emit(m);
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

  /** Pause button on the phone. */
  onPause(cb: () => void): () => void {
    return this.pauses.on(cb);
  }

  /** Menu actions from the phone (mirrored menu / setup / results). */
  onAction(cb: (a: PhoneAction) => void): () => void {
    return this.actions.on(cb);
  }

  dispose(): void {}
}
