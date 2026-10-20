// Procedural Web Audio for the laptop (design/SPEC.md "Sound"). No sample files: every sound is
// synthesised from oscillators and filtered noise, so there's nothing to download or license.
// The context is created/resumed on the first user gesture (browser autoplay rules).

type Pan = number; // −1 left … +1 right

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private ambience: AudioBufferSourceNode | null = null;
  private volume = 0.8;
  private muted = false;

  constructor() {
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
  }

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  setVolume(v: number, muted: boolean): void {
    this.volume = v;
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  private unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.amb = this.ctx.createGain();
      this.amb.gain.value = 0.18;
      this.amb.connect(this.master);
      // 2 s of white noise, reused by every noisy sound.
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ───────── building blocks ─────────

  private out(pan: Pan, gain: number): GainNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = gain;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.sfx);
    return g;
  }

  /** Percussive tone: attack-free sine/triangle with exponential decay. */
  private tone(freq: number, dur: number, gain: number, opts: { type?: OscillatorType; pan?: Pan; at?: number; glide?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = opts.at ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.glide) o.frequency.exponentialRampToValueAtTime(freq * opts.glide, t + dur);
    const g = this.out(opts.pan ?? 0, 0);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Filtered noise burst. */
  private noise(dur: number, gain: number, filter: { type: BiquadFilterType; freq: number; q?: number }, opts: { pan?: Pan; at?: number; attack?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = opts.at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    f.Q.value = filter.q ?? 0.8;
    const g = this.out(opts.pan ?? 0, 0);
    const a = opts.attack ?? 0.001;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
    src.connect(f).connect(g);
    src.start(t, Math.random() * 1.5);
    src.stop(t + a + dur + 0.02);
  }

  // ───────── game sounds ─────────

  /** Paddle hit: soft tock → crisp tick → sharp crack by speed; pitch rises with power. */
  hit(kmh: number, pan: Pan = 0): void {
    if (!this.ctx) return;
    const k = Math.max(0, Math.min(1, (kmh - 15) / 50));
    const vol = 0.35 + 0.55 * k;
    this.tone(520 + 260 * k, 0.07, vol * 0.8, { type: 'triangle', pan, glide: 0.7 }); // tock
    if (kmh > 28) this.noise(0.035, vol * 0.6, { type: 'highpass', freq: 3500 }, { pan }); // tick
    if (kmh > 50) {
      this.noise(0.06, vol * 0.9, { type: 'bandpass', freq: 2200, q: 1.2 }, { pan }); // crack
      this.tone(1600, 0.05, vol * 0.4, { type: 'square', pan, glide: 0.5 });
    }
  }

  /** Table bounce: short hollow "pok"; volume follows impact speed, pan follows the ball. */
  bounce(speed: number, pan: Pan): void {
    const vol = Math.max(0.08, Math.min(0.7, speed / 9));
    this.tone(1250, 0.05, vol * 0.5, { pan, glide: 0.85 });
    this.tone(640, 0.08, vol * 0.35, { type: 'triangle', pan });
    this.noise(0.015, vol * 0.25, { type: 'highpass', freq: 5000 }, { pan });
  }

  /** Net: soft thud + mesh rustle; edge cord: tiny tick. */
  net(kind: 'clip' | 'block', pan: Pan): void {
    if (kind === 'clip') {
      this.tone(2400, 0.03, 0.25, { pan });
      return;
    }
    this.tone(140, 0.18, 0.4, { pan, glide: 0.6 });
    this.noise(0.25, 0.18, { type: 'bandpass', freq: 900, q: 0.6 }, { pan, attack: 0.02 });
  }

  /** Ball machine launch (practice). */
  machine(): void {
    this.tone(90, 0.12, 0.25, { glide: 2.5 });
    this.noise(0.08, 0.12, { type: 'lowpass', freq: 800 });
  }

  /** Crowd clapping: many short claps scattered over `secs`. */
  clap(secs = 1, density = 26, gain = 0.22): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (let i = 0; i < density * secs; i++) {
      const at = ctx.currentTime + Math.random() * secs * (0.4 + 0.6 * Math.random());
      this.noise(0.03 + Math.random() * 0.03, gain * (0.5 + Math.random() * 0.5), { type: 'bandpass', freq: 1000 + Math.random() * 1600, q: 1.4 }, { at, pan: Math.random() * 1.6 - 0.8 });
    }
  }

  /** "Ooh" on a long rally: a few voices sliding through an "oo" formant. */
  ooh(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let v = 0; v < 5; v++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f0 = 170 + v * 23 + Math.random() * 10;
      o.frequency.setValueAtTime(f0 * 0.9, t);
      o.frequency.linearRampToValueAtTime(f0 * 1.15, t + 0.35);
      o.frequency.linearRampToValueAtTime(f0 * 0.85, t + 0.9);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 400;
      f.Q.value = 3;
      const g = this.out(v / 2.5 - 1, 0);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1);
      o.connect(f).connect(g);
      o.start(t);
      o.stop(t + 1.05);
    }
  }

  cheer(): void {
    this.noise(1.6, 0.18, { type: 'bandpass', freq: 1200, q: 0.4 }, { attack: 0.25 });
    this.clap(2, 40, 0.25);
  }

  // ───────── UI + stingers ─────────

  /** Rounded marimba blip. */
  private marimba(freq: number, at?: number, gain = 0.25): void {
    this.tone(freq, 0.25, gain, { at });
    this.tone(freq * 4, 0.06, gain * 0.25, { at });
  }

  uiSelect(): void {
    this.marimba(784);
  }
  uiBack(): void {
    this.marimba(523);
  }
  uiHover(): void {
    this.marimba(1046, undefined, 0.06);
  }

  connect(): void {
    const t = this.ctx?.currentTime ?? 0;
    this.marimba(523, t);
    this.marimba(784, t + 0.12);
  }
  disconnect(): void {
    const t = this.ctx?.currentTime ?? 0;
    this.marimba(784, t);
    this.marimba(440, t + 0.14);
  }

  /** Match point: low pulse. */
  matchPoint(): void {
    const t = this.ctx?.currentTime ?? 0;
    for (let i = 0; i < 3; i++) this.tone(62, 0.22, 0.5, { at: t + i * 0.28 });
  }

  /** Deuce: short drumroll. */
  deuce(): void {
    const t = this.ctx?.currentTime ?? 0;
    let at = t;
    for (let i = 0; i < 14; i++) {
      this.noise(0.04, 0.12 + i * 0.012, { type: 'bandpass', freq: 260, q: 1.5 }, { at });
      at += 0.07 - i * 0.003;
    }
    this.tone(196, 0.3, 0.35, { at });
  }

  /** Win: bright 2 s jingle. */
  win(): void {
    const t = this.ctx?.currentTime ?? 0;
    [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.marimba(f, t + i * 0.13 + (i > 3 ? 0.1 : 0), 0.3));
    this.cheer();
  }

  /** Soft descending two-note for a lost point. */
  pointLost(): void {
    const t = this.ctx?.currentTime ?? 0;
    this.marimba(440, t, 0.12);
    this.marimba(370, t + 0.12, 0.12);
  }

  // ───────── ambience ─────────

  /** Quiet pool ambience: slow-moving filtered noise (water + distant chatter). */
  startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || this.ambience) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(f.frequency);
    src.connect(f).connect(this.amb);
    src.start();
    lfo.start();
    this.ambience = src;
  }
}

export const sfx = new Sfx();
