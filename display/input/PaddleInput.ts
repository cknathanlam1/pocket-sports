// Swappable paddle input. MouseInput (dev + fallback) now; PhoneInput in M2; a second phone later.
import type { Quat } from '../../shared/protocol.ts';
import type { SwingFeatures } from '../../engine/shot.ts';

/** A detected swing, stamped at its peak in the display's performance.now() clock (ms). */
export interface Swing extends SwingFeatures {
  t: number;
}

export interface PaddleInput {
  /** Paddle rotation relative to the neutral pose (face toward the opponent, handle down), near-player world frame. */
  orientation(): Quat;
  onSwing(cb: (s: Swing) => void): () => void;
  /** Tap = serve toss. `t` in performance.now() ms. */
  onTap(cb: (t: number) => void): () => void;
  dispose(): void;
}

/** Tiny listener set used by input implementations. */
export class Emitter<T> {
  private fns = new Set<(v: T) => void>();
  on(fn: (v: T) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(v: T): void {
    for (const f of this.fns) f(v);
  }
}
