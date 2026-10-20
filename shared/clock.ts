// NTP-style clock sync. The phone pings the laptop; each sample gives
//   offset = ((t1 − t0) + (t2 − t3)) / 2     (laptop clock − phone clock)
//   rtt    = (t3 − t0) − (t2 − t1)
// and the sample with the lowest RTT wins (least queuing, so the most symmetric path).

export interface ClockSample {
  t0: number; // phone send
  t1: number; // laptop receive
  t2: number; // laptop send
  t3: number; // phone receive
}

export interface ClockEstimate {
  offset: number; // ms, laptop − phone
  rtt: number; // ms
  samples: number;
}

export function sampleOffset(s: ClockSample): { offset: number; rtt: number } {
  return { offset: (s.t1 - s.t0 + (s.t2 - s.t3)) / 2, rtt: s.t3 - s.t0 - (s.t2 - s.t1) };
}

export function estimateClock(samples: ClockSample[]): ClockEstimate | null {
  let best: { offset: number; rtt: number } | null = null;
  for (const s of samples) {
    const e = sampleOffset(s);
    if (e.rtt < 0) continue; // corrupt sample
    if (!best || e.rtt < best.rtt) best = e;
  }
  return best ? { ...best, samples: samples.length } : null;
}

export interface ClockSyncOpts {
  send: (t0: number) => void;
  onEstimate: (e: ClockEstimate) => void;
  now?: () => number;
  samplesPerRound?: number;
  spacingMs?: number;
  intervalMs?: number;
}

/**
 * Runs sync rounds: `samplesPerRound` pings spaced `spacingMs` apart, then reports the estimate.
 * Transport-agnostic: call `onPong` with each pong; `send` delivers pings.
 */
export class ClockSync {
  estimate: ClockEstimate | null = null;
  private pending: ClockSample[] = [];
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private interval: ReturnType<typeof setInterval> | undefined;
  private readonly opts: ClockSyncOpts;

  constructor(opts: ClockSyncOpts) {
    this.opts = opts;
  }

  private now(): number {
    return (this.opts.now ?? (() => performance.now()))();
  }

  start(): void {
    this.stop();
    this.round();
    this.interval = setInterval(() => this.round(), this.opts.intervalMs ?? 10_000);
  }

  stop(): void {
    clearInterval(this.interval);
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  round(): void {
    this.finish();
    const n = this.opts.samplesPerRound ?? 10;
    const spacing = this.opts.spacingMs ?? 50;
    for (let i = 0; i < n; i++) this.timers.push(setTimeout(() => this.opts.send(this.now()), i * spacing));
    // Close the round after the last ping has had time to return.
    this.timers.push(setTimeout(() => this.finish(), n * spacing + 1000));
  }

  onPong(t0: number, t1: number, t2: number): void {
    this.pending.push({ t0, t1, t2, t3: this.now() });
    if (this.pending.length >= (this.opts.samplesPerRound ?? 10)) this.finish();
  }

  private finish(): void {
    if (!this.pending.length) return;
    const e = estimateClock(this.pending);
    this.pending = [];
    if (e) {
      this.estimate = e;
      this.opts.onEstimate(e);
    }
  }
}
