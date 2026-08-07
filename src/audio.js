import { KT } from './aircraft.js';

/** Everything is synthesised — no samples, no files. */
export class Audio {
  constructor() { this.ctx = null; }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    this.master = master;

    // 3 s of noise, looped
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460;
      b1 = 0.96300 * b1 + w * 0.2965164;
      b2 = 0.57000 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
    }
    this.noiseBuf = buf;

    const src = (filterType, freq, q) => {
      const n = ctx.createBufferSource();
      n.buffer = buf; n.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType; f.frequency.value = freq; f.Q.value = q ?? 1;
      const g = ctx.createGain(); g.gain.value = 0;
      n.connect(f); f.connect(g); g.connect(master);
      n.start();
      return { g, f };
    };

    this.engine = src('bandpass', 140, 1.1);
    this.engineHi = src('bandpass', 900, 2.4);
    this.wind = src('lowpass', 700, 0.7);
    this.rain = src('highpass', 1800, 0.6);
    this.rumble = src('lowpass', 90, 1.0);

    // turbine whine
    this.whine = [];
    for (const [mult, gain] of [[1, 0.045], [2.02, 0.022], [3.05, 0.012]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 6;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(f); f.connect(g); g.connect(master);
      o.start();
      this.whine.push({ o, g, mult, gain });
    }
  }

  thump(v) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(v, 1) * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.5);

    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf; n.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(Math.min(v, 1) * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n.connect(f); f.connect(ng); ng.connect(this.master);
    n.start(t); n.stop(t + 0.4);
  }

  update(ac, preset, dt, inCockpit) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.09;
    const set = (node, v) => node.gain.setTargetAtTime(Math.max(v, 0.0001), t, k);

    const n1 = (ac.n1[0] + ac.n1[1]) / 2;
    const frac = Math.max(0, (n1 - 18) / 82);
    const muffle = inCockpit ? 0.55 : 1.0;

    set(this.engine.g, (0.10 + frac * 0.55) * muffle);
    this.engine.f.frequency.setTargetAtTime(90 + frac * 130, t, 0.2);
    set(this.engineHi.g, frac * frac * 0.28 * muffle * (ac.reverse ? 1.8 : 1));

    for (const w of this.whine) {
      w.o.frequency.setTargetAtTime(120 * w.mult * (0.55 + frac * 1.25), t, 0.15);
      set(w.g, w.gain * frac * (inCockpit ? 0.7 : 1.35));
    }

    const kt = ac.ias / KT;
    const windAmt = Math.pow(Math.min(kt / 340, 1.2), 2.1);
    set(this.wind.g, windAmt * (inCockpit ? 0.30 : 0.85));
    this.wind.f.frequency.setTargetAtTime(400 + kt * 4.5, t, 0.2);

    set(this.rain.g, preset.rain * 0.35 * (inCockpit ? 0.8 : 0.4) + preset.snow * 0.03);

    const rolling = ac.onGround ? Math.min(Math.hypot(ac.vel.x, ac.vel.z) / 60, 1) : 0;
    set(this.rumble.g, rolling * 0.55);

    if (ac.touchdownVS < -0.4) {
      this.thump(Math.min(-ac.touchdownVS / 3.5, 1));
      ac.touchdownVS = 0;
    }
  }
}
