// Procedural soundtrack: a small step sequencer with synthesised marimba, steel pan, bass, pads and
// light percussion, in the sunny poolside mood of the design. No sample files, like Sfx.
// Scheduling uses the usual Web Audio lookahead: a 25 ms timer queues notes ~120 ms ahead on the audio clock.

export type Track = 'menu' | 'match' | 'win' | 'lose' | 'none';

const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** A loop: one chord per bar (MIDI notes, low to high), 16 steps per bar. Patterns use step numbers. */
interface Song {
  bpm: number;
  chords: number[][];
  /** Bass hits: [step, chord tone index, octave shift]. */
  bass: Array<[number, number, number]>;
  kick: number[];
  /** Steps with a rim click. */
  rim?: number[];
  /** Shaker every `shaker` steps (0 = none); 16ths when intense. */
  shaker: number;
  /** Marimba arpeggio over 8th notes: chord tone indices (−1 = rest), one octave up. */
  arp?: number[];
  /** Short offbeat chord stabs (the "skank"). */
  stabs?: number[];
  /** Sustained pad on every bar. */
  pad?: boolean;
  /** Steel-pan melody in 8th notes across the whole loop (null = rest). */
  melody?: Array<number | null>;
  /** Steel-pan riff for intense moments, 8ths of chord tone indices (one octave up). */
  riff?: Array<number | null>;
}

// F major, I–vi–IV–V7 twice; the melody answers itself in bars 5–8.
const MENU: Song = {
  bpm: 100,
  chords: [
    [53, 57, 60, 64],
    [50, 53, 57, 60],
    [46, 50, 53, 57],
    [48, 52, 55, 58],
  ],
  bass: [
    [0, 0, -12],
    [6, 0, -12],
    [8, 2, -12],
    [14, 1, -12],
  ],
  kick: [0, 8],
  rim: [4, 12],
  shaker: 2,
  arp: [0, 2, 3, 2, 1, 2, 3, 2],
  // prettier-ignore
  melody: [
    72, null, 69, 72, null, 76, 74, null,
    72, null, null, 69, 65, null, 69, null,
    70, null, 74, null, 72, 70, 69, null,
    67, null, null, null, 64, 67, 70, null,
    72, null, 69, 72, null, 77, 76, null,
    74, null, 72, null, 69, null, 72, 74,
    70, 69, 70, 74, null, 72, null, 70,
    67, null, 64, null, 67, null, null, null,
  ],
};

// B♭ major, a little faster and sparse so hits and bounces stay on top. Ducked during rallies.
const MATCH: Song = {
  bpm: 112,
  chords: [
    [46, 50, 53, 57],
    [43, 46, 50, 53],
    [51, 55, 58, 62],
    [53, 57, 60, 63],
  ],
  bass: [
    [0, 0, -12],
    [3, 0, -12],
    [8, 2, -12],
    [10, 0, -12],
    [14, 1, -12],
  ],
  kick: [0, 8],
  rim: [12],
  shaker: 2,
  stabs: [2, 6, 10, 14],
  riff: [3, null, 2, 3, null, 1, 2, null],
};

const WIN: Song = {
  bpm: 108,
  chords: [
    [53, 57, 60, 64],
    [45, 48, 52, 55],
    [46, 50, 53, 57],
    [48, 52, 55, 58],
  ],
  bass: [
    [0, 0, -12],
    [6, 0, -12],
    [8, 2, -12],
    [12, 0, -12],
  ],
  kick: [0, 6, 8],
  rim: [4, 12],
  shaker: 2,
  arp: [0, 1, 2, 3, 2, 3, 1, 2],
  pad: true,
  // prettier-ignore
  melody: [
    72, null, 76, null, 77, null, 76, 72,
    76, null, 72, null, 69, null, 72, null,
    74, 72, 70, null, 74, null, 77, null,
    76, null, 74, null, 72, null, null, null,
  ],
};

// D minor, slow and soft: no drums, just a pad, a gentle arpeggio and the bass.
const LOSE: Song = {
  bpm: 84,
  chords: [
    [50, 53, 57, 60],
    [46, 50, 53, 57],
    [43, 46, 50, 53],
    [45, 50, 52, 55],
  ],
  bass: [
    [0, 0, -12],
    [10, 2, -12],
  ],
  kick: [],
  shaker: 4,
  arp: [0, -1, 2, -1, 3, -1, 2, -1],
  pad: true,
};

const SONGS: Record<Exclude<Track, 'none'>, Song> = { menu: MENU, match: MATCH, win: WIN, lose: LOSE };

interface Voice {
  track: Track;
  song: Song;
  gain: GainNode;
  step: number;
  next: number;
  timer: ReturnType<typeof setInterval>;
}

export class Music {
  private readonly ctx: AudioContext;
  private readonly noise: AudioBuffer;
  /** Bus → muffle filter → duck gain → output. */
  private readonly bus: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly duckGain: GainNode;
  private voice: Voice | null = null;
  private intense = false;
  private ducked = false;
  private muffled = false;

  constructor(ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.noise = noise;
    this.bus = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.duckGain = ctx.createGain();
    this.bus.connect(this.filter).connect(this.duckGain).connect(out);
  }

  get track(): Track {
    return this.voice?.track ?? 'none';
  }

  /** Switch tracks with a short crossfade. Calling with the current track does nothing. */
  play(track: Track): void {
    if (track === this.track) return;
    const t = this.ctx.currentTime;
    const old = this.voice;
    if (old) {
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setTargetAtTime(0, t, 0.25);
      setTimeout(() => {
        clearInterval(old.timer);
        old.gain.disconnect();
      }, 1500);
    }
    this.voice = null;
    if (track === 'none') return;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(1, t + 0.8);
    gain.connect(this.bus);
    const v: Voice = { track, song: SONGS[track], gain, step: 0, next: t + 0.08, timer: 0 as unknown as ReturnType<typeof setInterval> };
    v.timer = setInterval(() => this.schedule(v), 25);
    this.schedule(v);
    this.voice = v;
  }

  /** Quieter while the ball is in play, so the rally sounds carry. */
  duck(on: boolean): void {
    if (on === this.ducked) return;
    this.ducked = on;
    this.duckGain.gain.setTargetAtTime(on ? 0.5 : 1, this.ctx.currentTime, on ? 0.15 : 0.6);
  }

  /** Paused: the music sounds muffled, as if behind a door. */
  muffle(on: boolean): void {
    if (on === this.muffled) return;
    this.muffled = on;
    this.filter.frequency.setTargetAtTime(on ? 550 : 18000, this.ctx.currentTime, 0.2);
  }

  /** Match point / deuce: busier hats, four-on-the-floor kick and the steel riff. */
  setIntensity(on: boolean): void {
    this.intense = on;
  }

  // ───────── sequencer ─────────

  private schedule(v: Voice): void {
    const stepDur = 60 / v.song.bpm / 4;
    while (v.next < this.ctx.currentTime + 0.12) {
      this.playStep(v, v.step, v.next, stepDur);
      v.next += stepDur;
      v.step++;
    }
  }

  private playStep(v: Voice, step: number, t: number, stepDur: number): void {
    const s = v.song;
    const out = v.gain;
    const bar = Math.floor(step / 16);
    const st = step % 16;
    const chord = s.chords[bar % s.chords.length]!;
    const intense = this.intense && v.track === 'match';

    if (s.kick.includes(st) || (intense && st % 4 === 0)) this.kick(t, out);
    if (s.rim?.includes(st)) this.rim(t, out);
    const shakeEvery = intense ? 1 : s.shaker;
    if (shakeEvery && st % shakeEvery === 0) this.shaker(t, st % 4 === 2 ? 0.05 : 0.03, out);
    for (const [at, idx, oct] of s.bass) if (at === st) this.bass(mtof(chord[idx]! + oct), t, stepDur * 3, out);
    if (s.stabs?.includes(st)) this.stab(chord, t, stepDur * 0.9, out);
    if (s.pad && st === 0) this.pad(chord, t, stepDur * 16, out);

    if (st % 2 === 0) {
      const eighth = st / 2;
      const a = s.arp?.[eighth];
      if (a !== undefined && a >= 0) this.marimba(mtof(chord[a]! + 12), t, 0.07, out);
      if (s.melody) {
        const m = s.melody[(bar * 8 + eighth) % s.melody.length];
        if (m != null) this.steel(mtof(m), t, 0.09, out);
      }
      // The riff plays every other bar so it reads as call and response.
      if (intense && s.riff && bar % 2 === 1) {
        const r = s.riff[eighth];
        if (r != null) this.steel(mtof(chord[r]! + 12), t, 0.07, out);
      }
    }
  }

  // ───────── instruments ─────────

  private env(t: number, peak: number, attack: number, decay: number, out: AudioNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(out);
    return g;
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, dest: AudioNode, detune = 0): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private marimba(f: number, t: number, g: number, out: AudioNode): void {
    this.osc('sine', f, t, 0.4, this.env(t, g, 0.003, 0.4, out));
    this.osc('sine', f * 4, t, 0.06, this.env(t, g * 0.18, 0.002, 0.05, out));
  }

  /** Steel pan: a few inharmonic-ish partials with a soft attack and a ringing decay. */
  private steel(f: number, t: number, g: number, out: AudioNode): void {
    const parts: Array<[number, number, number]> = [
      [1, 1, 0.8],
      [2, 0.45, 0.5],
      [3.02, 0.2, 0.3],
      [4.16, 0.1, 0.18],
    ];
    for (const [mult, amp, dec] of parts) this.osc('sine', f * mult, t, dec + 0.02, this.env(t, g * amp, 0.006, dec, out));
  }

  private bass(f: number, t: number, dur: number, out: AudioNode): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.connect(this.env(t, 0.22, 0.006, Math.max(0.15, dur), out));
    this.osc('triangle', f, t, dur, lp);
    this.osc('sine', f / 2, t, dur, lp);
  }

  private pad(chord: number[], t: number, dur: number, out: AudioNode): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.35);
    g.gain.setValueAtTime(0.035, t + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    lp.connect(g).connect(out);
    for (const n of chord.slice(1)) {
      this.osc('sawtooth', mtof(n + 12), t, dur + 0.2, lp, -7);
      this.osc('sawtooth', mtof(n + 12), t, dur + 0.2, lp, 7);
    }
  }

  /** Offbeat organ-ish chord stab. */
  private stab(chord: number[], t: number, dur: number, out: AudioNode): void {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1600;
    lp.connect(this.env(t, 0.03, 0.004, dur, out));
    for (const n of chord.slice(1)) this.osc('square', mtof(n + 12), t, dur, lp);
  }

  private kick(t: number, out: AudioNode): void {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    o.connect(this.env(t, 0.32, 0.002, 0.22, out));
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(t: number, g: number, dur: number, type: BiquadFilterType, freq: number, q: number, out: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(this.env(t, g, 0.002, dur, out));
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  private shaker(t: number, g: number, out: AudioNode): void {
    this.noiseHit(t, g, 0.045, 'highpass', 6500, 0.7, out);
  }

  private rim(t: number, out: AudioNode): void {
    this.noiseHit(t, 0.06, 0.03, 'bandpass', 1900, 5, out);
  }
}
