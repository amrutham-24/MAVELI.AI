/* ============================================================
   AudioManager
   ------------------------------------------------------------
   Everything is synthesized with WebAudio so there are no asset
   downloads, no CORS issues, and no Quest-browser autoplay pain.

   To use real samples instead:
     AudioManager.useSamples = true;
     AudioManager.samplePaths.hitL = 'assets/audio/chenda_left.mp3';
     ...
   ============================================================ */
window.AudioManager = {

  ctx: null,
  master: null,
  ready: false,

  useSamples: false,
  samplePaths: {
    hitL: 'assets/audio/chenda_left.mp3',
    hitR: 'assets/audio/chenda_right.mp3'
  },
  buffers: {},

  /* Must be called from a real user gesture (START click / enter-vr). */
  init() {
    if (this.ctx) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    this.ready = true;
    if (this.useSamples) this._loadSamples();
    this.resume();
  },

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  _loadSamples() {
    Object.entries(this.samplePaths).forEach(([k, url]) => {
      fetch(url).then(r => r.arrayBuffer())
        .then(b => this.ctx.decodeAudioData(b))
        .then(buf => { this.buffers[k] = buf; })
        .catch(() => { /* silently fall back to synthesis */ });
    });
  },

  _now() { return this.ctx.currentTime; },

  /* ---------- core: a chenda-ish struck-membrane hit ---------- */
  chenda(hand = 'L', velocity = 1.0) {
    if (!this.ready) return;
    this.resume();

    // sample path, if loaded
    const key = hand === 'L' ? 'hitL' : 'hitR';
    if (this.useSamples && this.buffers[key]) {
      const s = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      s.buffer = this.buffers[key];
      g.gain.value = velocity;
      s.connect(g); g.connect(this.master); s.start();
      return;
    }

    const t = this._now();
    // left = deeper "thom", right = sharper "tha"
    const baseFreq = hand === 'L' ? 132 : 196;
    const decay = hand === 'L' ? 0.42 : 0.28;
    const pan = hand === 'L' ? -0.45 : 0.45;

    const panner = this.ctx.createStereoPanner
      ? this.ctx.createStereoPanner() : null;
    if (panner) { panner.pan.value = pan; panner.connect(this.master); }
    const out = panner || this.master;

    // 1) pitched body — two detuned partials, fast downward sweep
    [1, 1.58].forEach((mult, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq * mult * 1.9, t);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * mult, t + 0.055);
      const amp = (i === 0 ? 0.75 : 0.28) * velocity;
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
      osc.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + decay + 0.05);
    });

    // 2) attack transient — filtered noise burst = stick on skin
    const len = Math.floor(this.ctx.sampleRate * 0.14);
    const noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);

    const ns = this.ctx.createBufferSource();
    const bp = this.ctx.createBiquadFilter();
    const ng = this.ctx.createGain();
    ns.buffer = noise;
    bp.type = 'bandpass';
    bp.frequency.value = hand === 'L' ? 1100 : 2000;
    bp.Q.value = 0.9;
    ng.gain.setValueAtTime(0.5 * velocity, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    ns.connect(bp); bp.connect(ng); ng.connect(out);
    ns.start(t); ns.stop(t + 0.15);
  },

  /* ---------- generic UI blip ---------- */
  tone(freq, dur = 0.14, type = 'sine', vol = 0.3, delay = 0) {
    if (!this.ready) return;
    this.resume();
    const t = this._now() + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },

  countdownTick() { this.tone(660, 0.10, 'square', 0.20); },
  countdownGo() { this.tone(990, 0.22, 'square', 0.26); },
  perfect() {
    this.tone(1320, 0.11, 'triangle', 0.24);
    this.tone(1760, 0.13, 'triangle', 0.20, 0.06);
  },
  good() { this.tone(880, 0.12, 'triangle', 0.22); },
  wrong() { this.tone(150, 0.24, 'sawtooth', 0.20); },
  wrongHand() {
    this.tone(300, 0.16, 'square', 0.18);
    this.tone(220, 0.18, 'square', 0.16, 0.09);
  },
  miss() { this.tone(180, 0.20, 'sawtooth', 0.16); },

  levelComplete() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.30, 'triangle', 0.26, i * 0.11));
  },

  victory() {
    [523, 659, 784, 1047, 1319, 1047, 1319, 1568]
      .forEach((f, i) => this.tone(f, 0.42, 'triangle', 0.28, i * 0.13));
    // a couple of celebratory chenda rolls under the fanfare
    for (let i = 0; i < 8; i++) {
      setTimeout(() => this.chenda(i % 2 ? 'R' : 'L', 0.7), 120 + i * 95);
    }
  },

  comboUp(level) {
    this.tone(600 + level * 55, 0.13, 'triangle', 0.22);
  }
};