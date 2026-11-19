// Procedural Web Audio for the laptop (design/SPEC.md "Sound"). No sample files: every sound is
// synthesised from oscillators and filtered noise, so there's nothing to download or license.
// The context is created/resumed on the first user gesture (browser autoplay rules).
// Mix: effects bus (volume) + music bus (music level) → master (mute). The soundtrack lives in Music.ts.
import { Music, type Track } from './Music.ts';

type Pan = number; // −1 left … +1 right

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private noiseBuf!: AudioBuffer;
  private musicBus!: GainNode;
  private music: Music | null = null;
  /** Track requested before the audio context existed; starts on unlock. */
  private wantTrack: Track = 'none';
  private ambience: AudioBufferSourceNode | null = null;
  private volume = 0.8;
  private musicLevel = 0.5;
  private muted = false;

  constructor() {
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    // A hidden tab throttles the music scheduler (gaps), and nobody is listening: pause all audio.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  get ready(): boolean {
    return this.ctx?.state === 'running';
  }

  /** v = effects level, music = soundtrack level (both 0–1); muted silences everything. */
  setVolume(v: number, muted: boolean, music = this.musicLevel): void {
    this.volume = v;
    this.muted = muted;
    this.musicLevel = music;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.05);
    this.sfx.gain.setTargetAtTime(v, t, 0.05);
    this.musicBus.gain.setTargetAtTime(music * 1.4, t, 0.05);
  }

  // ───────── music ─────────

  playMusic(track: Track): void {
    this.wantTrack = track;
    this.music?.play(track);
  }

  /** Lower the music while the ball is in play. */
  duckMusic(on: boolean): void {
    this.music?.duck(on);
  }

  /** Paused: muffle the music. */
  muffleMusic(on: boolean): void {
    this.music?.muffle(on);
  }

  /** Match point / deuce: the match track gets busier. */
  musicIntensity(on: boolean): void {
    this.music?.setIntensity(on);
  }

  private unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = this.volume;
      this.sfx.connect(this.master);
      this.amb = this.ctx.createGain();
      this.amb.gain.value = 0.18;
      this.amb.connect(this.sfx);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicLevel * 1.4;
      this.musicBus.connect(this.master);
      // 2 s of white noise, reused by every noisy sound.
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.music = new Music(this.ctx, this.musicBus, this.noiseBuf);
      this.music.play(this.wantTrack);
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

  /** Swing whoosh: an air sweep whose pitch and loudness follow swing speed (plays on hits and misses). */
  swing(peakDegPerSec: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const k = Math.max(0, Math.min(1, (peakDegPerSec - 300) / 1200));
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.6;
    f.frequency.setValueAtTime(500 + 400 * k, t);
    f.frequency.exponentialRampToValueAtTime(1800 + 2400 * k, t + 0.09);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.2);
    const g = this.out(0.2, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06 + 0.16 * k, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(f).connect(g);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.25);
  }

  /** Serve toss: a soft flick and a little rising blip as the ball goes up. */
  toss(pan: Pan): void {
    this.noise(0.05, 0.08, { type: 'bandpass', freq: 1400, q: 1 }, { pan });
    this.tone(660, 0.18, 0.06, { pan, glide: 1.5 });
  }

  /** Ball lands on the deck: duller than the table, with a couple of smaller rebounds. */
  floor(pan: Pan): void {
    const t = this.ctx?.currentTime ?? 0;
    [0, 0.32, 0.53, 0.66].forEach((dt, i) => {
      const k = 0.55 ** i;
      this.tone(420, 0.06, 0.22 * k, { type: 'triangle', pan, at: t + dt, glide: 0.8 });
      this.noise(0.02, 0.06 * k, { type: 'bandpass', freq: 1800, q: 1 }, { pan, at: t + dt });
    });
  }

  /** It's your serve: a light two-note bell. */
  yourServe(): void {
    const t = this.ctx?.currentTime ?? 0;
    this.tone(1318, 0.5, 0.06, { at: t });
    this.tone(1760, 0.6, 0.05, { at: t + 0.09 });
  }

  /** Won a game (not the match): short rising fanfare. */
  gameWon(): void {
    const t = this.ctx?.currentTime ?? 0;
    [523, 659, 784, 1046].forEach((f, i) => this.marimba(f, t + i * 0.09, 0.26));
    this.tone(1046, 0.6, 0.08, { type: 'triangle', at: t + 0.36 });
    this.clap(1.2, 30, 0.2);
  }

  /** Lost a game: gentle falling three-note. */
  gameLost(): void {
    const t = this.ctx?.currentTime ?? 0;
    [587, 494, 392].forEach((f, i) => this.marimba(f, t + i * 0.14, 0.16));
  }

  /** Lost the match: a soft, slightly comic "wah-wah" on a muted horn. */
  lose(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [392, 370, 349, 330].forEach((f, i) => {
      const at = t + i * 0.32;
      const dur = i === 3 ? 0.9 : 0.28;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, at);
      if (i === 3) o.frequency.linearRampToValueAtTime(f * 0.94, at + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(500, at);
      lp.frequency.linearRampToValueAtTime(1100, at + 0.08);
      lp.frequency.linearRampToValueAtTime(450, at + dur);
      const g = this.out(0, 0);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.12, at + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(lp).connect(g);
      o.start(at);
      o.stop(at + dur + 0.05);
    });
  }

  /** Pause / resume blips. */
  pause(): void {
    const t = this.ctx?.currentTime ?? 0;
    this.marimba(659, t, 0.14);
    this.marimba(440, t + 0.08, 0.14);
  }
  resume(): void {
    const t = this.ctx?.currentTime ?? 0;
    this.marimba(440, t, 0.14);
    this.marimba(659, t + 0.08, 0.14);
  }

  /** Volleyball contact: forearm thump (dig), soft double pat (set), loud palm slap (spike/serve), light pat (tip). */
  volleyHit(touch: 'serve' | 'dig' | 'set' | 'spike' | 'tip', kmh: number, pan: Pan): void {
    const k = Math.max(0, Math.min(1, (kmh - 20) / 60));
    if (touch === 'dig') {
      this.tone(150, 0.12, 0.4, { pan, glide: 0.7 });
      this.noise(0.06, 0.18, { type: 'lowpass', freq: 700 }, { pan });
    } else if (touch === 'set') {
      const t = this.ctx?.currentTime ?? 0;
      for (const dt of [0, 0.03]) this.noise(0.035, 0.12, { type: 'bandpass', freq: 900, q: 1 }, { pan, at: t + dt });
      this.tone(260, 0.06, 0.12, { pan, at: t });
    } else if (touch === 'tip') {
      this.noise(0.04, 0.12, { type: 'bandpass', freq: 1200, q: 1 }, { pan });
    } else {
      // Spike / serve: hand slap, louder and brighter with power, plus a body thump.
      this.noise(0.07, 0.35 + 0.45 * k, { type: 'bandpass', freq: 1400 + 900 * k, q: 0.7 }, { pan });
      this.tone(110, 0.14, 0.35 + 0.3 * k, { pan, glide: 0.6 });
    }
  }

  /** Ball lands in the sand: soft "pff" and a low thud. */
  sand(speed: number, pan: Pan): void {
    const vol = Math.max(0.15, Math.min(0.8, speed / 18));
    this.noise(0.16, vol * 0.35, { type: 'lowpass', freq: 900 }, { pan, attack: 0.004 });
    this.tone(85, 0.12, vol * 0.4, { pan, glide: 0.7 });
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
