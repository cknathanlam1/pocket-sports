// Dev-mode sensor recorder (/p/CODE?dev): captures raw events in the same format as
// tests/fixtures/recordings/*.json so real sessions can be replayed in tests.
import type { DetectedSwing, RawEvent } from './motion.ts';
import { platform } from './sensors.ts';

export class Recorder {
  recording = false;
  private events: RawEvent[] = [];
  private swings: DetectedSwing[] = [];
  private t0 = 0;

  start(): void {
    this.events = [];
    this.swings = [];
    this.t0 = performance.now();
    this.recording = true;
  }

  push(ev: RawEvent): void {
    if (this.recording) this.events.push({ ...ev, t: +(ev.t - this.t0).toFixed(2) } as RawEvent);
  }

  swing(s: DetectedSwing): void {
    if (this.recording) this.swings.push({ ...s, t: +(s.t - this.t0).toFixed(1) });
  }

  get count(): { events: number; swings: number } {
    return { events: this.events.length, swings: this.swings.length };
  }

  /** Stop and hand the JSON to the user (share sheet where available, else a download). */
  async stop(): Promise<void> {
    this.recording = false;
    const rec = {
      meta: { platform, ua: navigator.userAgent, createdAt: new Date().toISOString(), note: 'Add expected.peaks (ms) by hand to use as a test fixture.' },
      events: this.events,
      detected: this.swings,
    };
    const name = `${platform}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const file = new File([JSON.stringify(rec)], name, { type: 'application/json' });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch {
        /* cancelled: fall back to a download */
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
}
