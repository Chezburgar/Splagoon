// All audio is synthesised with the WebAudio API — no sample files.

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicOn = true;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.nextNote = 0;
    this.step = 0;
    this.mode = 'lobby';
    this.noiseBuf = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(this.ctx.destination);

    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 8;
    comp.connect(this.master);
    this.bus = comp;

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.bus);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.bus);

    // reusable noise buffer
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.nextNote = this.ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 60);
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
    return this.muted;
  }

  setMode(mode) {
    this.mode = mode;
    this.step = 0;
  }

  /* ------------------------------- helpers ----------------------------- */

  noise(dur, { freq = 1200, q = 1, gain = 0.4, type = 'bandpass', sweep = 0, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(60, freq + sweep), t + dur);
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.sfxGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  tone(freq, dur, { type = 'sine', gain = 0.25, to = null, delay = 0, detune = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /* -------------------------------- sfx -------------------------------- */

  shoot(weapon = 'shooter') {
    switch (weapon) {
      case 'charger': this.noise(0.28, { freq: 2600, q: 2, gain: 0.3, sweep: -2200 }); this.tone(420, 0.2, { type: 'sawtooth', gain: 0.12, to: 120 }); break;
      case 'roller': this.noise(0.24, { freq: 700, q: 0.8, gain: 0.4, sweep: -420 }); break;
      case 'slosher': this.noise(0.3, { freq: 500, q: 0.7, gain: 0.42, sweep: -300 }); this.tone(160, 0.22, { type: 'sine', gain: 0.16, to: 70 }); break;
      default: this.noise(0.1, { freq: 1500, q: 1.4, gain: 0.26, sweep: -900 }); break;
    }
  }

  charge(level) {
    this.tone(220 + level * 900, 0.08, { type: 'square', gain: 0.05 });
  }

  splat() { this.noise(0.22, { freq: 900, q: 0.6, gain: 0.32, sweep: -700 }); }
  hitMarker() { this.tone(1400, 0.07, { type: 'square', gain: 0.14, to: 1900 }); }
  jump() { this.tone(340, 0.16, { type: 'sine', gain: 0.16, to: 760 }); }
  land() { this.noise(0.1, { freq: 300, q: 0.7, gain: 0.2, sweep: -180 }); }
  squidIn() { this.noise(0.26, { freq: 1800, q: 0.8, gain: 0.22, sweep: -1500 }); this.tone(600, 0.2, { type: 'sine', gain: 0.1, to: 180 }); }
  squidOut() { this.tone(200, 0.22, { type: 'sine', gain: 0.12, to: 800 }); this.noise(0.2, { freq: 600, q: 0.7, gain: 0.18, sweep: 900 }); }
  swim() { this.noise(0.14, { freq: 420, q: 0.6, gain: 0.06, sweep: 260 }); }
  bomb() {
    this.noise(0.85, { freq: 220, q: 0.4, gain: 0.6, sweep: -180, type: 'lowpass' });
    this.tone(90, 0.6, { type: 'sine', gain: 0.4, to: 32 });
  }
  death() {
    this.noise(0.5, { freq: 1100, q: 0.6, gain: 0.4, sweep: -900 });
    this.tone(500, 0.45, { type: 'sawtooth', gain: 0.16, to: 90 });
  }
  respawn() {
    this.tone(220, 0.32, { type: 'triangle', gain: 0.2, to: 880 });
    this.tone(330, 0.34, { type: 'sine', gain: 0.12, to: 1320, delay: 0.05 });
  }
  special() {
    for (let i = 0; i < 5; i++) this.tone(440 * Math.pow(1.26, i), 0.3, { type: 'square', gain: 0.11, delay: i * 0.05 });
  }
  specialReady() {
    this.tone(880, 0.16, { type: 'triangle', gain: 0.18 });
    this.tone(1320, 0.22, { type: 'triangle', gain: 0.14, delay: 0.11 });
  }
  ui() { this.tone(760, 0.07, { type: 'square', gain: 0.1 }); }
  countdown(final = false) {
    if (final) { this.tone(1200, 0.5, { type: 'square', gain: 0.22 }); this.tone(600, 0.5, { type: 'sawtooth', gain: 0.14 }); }
    else this.tone(700, 0.12, { type: 'square', gain: 0.16 });
  }
  whistle() {
    this.tone(1800, 0.5, { type: 'sine', gain: 0.2, to: 2400 });
    this.noise(0.5, { freq: 2500, q: 6, gain: 0.16 });
  }
  fanfare(win) {
    const notes = win ? [523, 659, 784, 1046] : [523, 466, 415, 349];
    notes.forEach((n, i) => this.tone(n, 0.5, { type: 'triangle', gain: 0.18, delay: i * 0.13 }));
  }

  /* ------------------------------- music ------------------------------- */

  scheduleMusic() {
    if (!this.ctx || this.muted || !this.musicOn) return;
    const now = this.ctx.currentTime;
    const bpm = this.mode === 'battle' ? 158 : 116;
    const spb = 60 / bpm / 2;
    while (this.nextNote < now + 0.35) {
      this.playStep(this.step, this.nextNote, spb);
      this.step = (this.step + 1) % 32;
      this.nextNote += spb;
    }
  }

  playStep(step, t, spb) {
    const battle = this.mode === 'battle';
    const scale = battle ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
    const root = battle ? 55 : 49;

    // bass
    if (step % 4 === 0) {
      const n = root + scale[(step / 4) % scale.length];
      this.mNote(n, t, spb * 2.6, 'sawtooth', 0.5, 420);
    }
    // arp
    if (battle ? step % 2 === 0 : step % 4 === 2) {
      const n = root + 24 + scale[(step * 3) % scale.length];
      this.mNote(n, t, spb * 1.2, 'square', 0.16, 2600);
    }
    // hat
    if (battle ? step % 2 === 1 : step % 4 === 0) this.mNoise(t, 0.035, 0.06);
    // kick
    if (step % 8 === 0 || (battle && step % 8 === 6)) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(38, t + 0.14);
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g); g.connect(this.musicGain);
      o.start(t); o.stop(t + 0.18);
    }
  }

  mNote(midi, t, dur, type, gain, cutoff) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(filt); filt.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  mNoise(t, dur, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(this.musicGain);
    src.start(t); src.stop(t + dur + 0.02);
  }
}

export const audio = new Audio();
