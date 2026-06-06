// Tiny Web Audio synth. Sounds are generated, with ONE exception: the duck
// quack uses a real recorded clip (public/quack.mp3) loaded on demand, falling
// back to the synth until it has decoded. The context is created lazily and must
// be resumed from a user gesture (the first click / tap / keypress), which main
// wires through input's onFirstInput.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let quackBuf: AudioBuffer | null = null;
let quackLoading = false;
let quackSource: AudioBufferSourceNode | null = null; // the one quack allowed at a time

function loadQuack(): void {
  if (!ctx || quackBuf || quackLoading) return;
  quackLoading = true;
  fetch(`${import.meta.env.BASE_URL}quack.mp3`)
    .then((r) => r.arrayBuffer())
    .then((b) => ctx!.decodeAudioData(b))
    .then((buf) => { quackBuf = buf; })
    .catch(() => { quackLoading = false; });
}

export function ensureAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  // One second of white noise, reused by the noise-based sounds.
  const len = ctx.sampleRate;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  loadQuack();
}

function now(): number {
  return ctx ? ctx.currentTime : 0;
}

interface ToneOpts {
  type?: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  gain?: number;
  attack?: number;
}

function tone({ type = 'sine', from, to = from, dur, gain = 0.3, attack = 0.005 }: ToneOpts): void {
  if (!ctx || !master) return;
  const t = now();
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, gain = 0.3, filterHz = 1200, type: BiquadFilterType = 'lowpass'): void {
  if (!ctx || !master || !noiseBuf) return;
  const t = now();
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = filterHz;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// ── The sound palette ──

/** Satisfying mechanical button press: a click transient + low thunk. */
export function click(): void {
  ensureAudio();
  noise(0.04, 0.35, 2600, 'highpass');
  tone({ type: 'square', from: 220, to: 90, dur: 0.12, gain: 0.28 });
}

/** A duck. A nasal "qu-ack": sawtooth through two vocal-tract formant
 *  bandpasses, with a fast pitch contour and a two-bump amplitude envelope.
 *  Base pitch varies per call so a flock doesn't sound like one duck. */
export function quack(): void {
  ensureAudio();
  if (!ctx || !master) return;
  // Real recorded quack, once it has loaded; pitch-varied slightly per call.
  if (quackBuf) {
    if (quackSource) return; // only ever ONE quack playing at once
    const src = ctx.createBufferSource();
    src.buffer = quackBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const g = ctx.createGain();
    g.gain.value = 0.8;
    src.connect(g).connect(master);
    src.onended = () => {
      if (quackSource === src) quackSource = null;
    };
    quackSource = src;
    src.start();
    return;
  }
  quackSynth();
}

// Synthesised fallback used until the recorded quack has decoded.
function quackSynth(): void {
  if (!ctx || !master) return;
  const t = now();
  const base = 250 + Math.random() * 130;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  // Pitch contour: a quick rise then a fall — the "qu↗-ack↘".
  osc.frequency.setValueAtTime(base * 0.8, t);
  osc.frequency.exponentialRampToValueAtTime(base * 1.3, t + 0.04);
  osc.frequency.exponentialRampToValueAtTime(base * 0.68, t + 0.2);

  // Two formants in parallel give the open, nasal duck timbre.
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 1100;
  f1.Q.value = 5;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 2400;
  f2.Q.value = 9;
  const formants = ctx.createGain();
  osc.connect(f1).connect(formants);
  osc.connect(f2).connect(formants);

  // Two-bump envelope: the short "qu" then the louder "ack".
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.4, t + 0.11);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);

  formants.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.28);
}

/** Soft whoosh — something appearing / sweeping in. */
export function whoosh(): void {
  ensureAudio();
  noise(0.5, 0.22, 700, 'bandpass');
}

/** Light pop. */
export function pop(): void {
  ensureAudio();
  tone({ type: 'sine', from: 400, to: 900, dur: 0.12, gain: 0.25 });
}

/** Heavy soft thud (a duck landing, a statue dropping). */
export function thud(): void {
  ensureAudio();
  tone({ type: 'sine', from: 140, to: 60, dur: 0.18, gain: 0.4 });
  noise(0.08, 0.18, 400);
}

/** Two-note bird chirp. */
export function chirp(): void {
  ensureAudio();
  tone({ type: 'sine', from: 1800, to: 2300, dur: 0.08, gain: 0.12 });
  setTimeout(() => tone({ type: 'sine', from: 2100, to: 2600, dur: 0.07, gain: 0.1 }), 90);
}

/** A scatter of bright blips — confetti / sparkle. */
export function sparkle(): void {
  ensureAudio();
  for (let i = 0; i < 6; i++) {
    const f = 900 + Math.random() * 1600;
    setTimeout(() => tone({ type: 'triangle', from: f, to: f * 1.4, dur: 0.1, gain: 0.12 }), i * 45);
  }
}

/** Deadpan low blip — "nothing happened". */
export function blip(): void {
  ensureAudio();
  tone({ type: 'sine', from: 200, to: 150, dur: 0.18, gain: 0.2 });
}

/** A rolling thunderclap: a sharp crack into a long low rumble. */
export function thunder(): void {
  ensureAudio();
  noise(0.06, 0.4, 4000, 'highpass'); // crack
  noise(1.4, 0.5, 220, 'lowpass'); // rumble
  tone({ type: 'sine', from: 70, to: 35, dur: 1.2, gain: 0.3 });
}

/** A two-note train horn, low and ominous. */
export function trainHorn(): void {
  ensureAudio();
  tone({ type: 'sawtooth', from: 150, to: 145, dur: 0.5, gain: 0.22 });
  tone({ type: 'sawtooth', from: 110, to: 108, dur: 0.7, gain: 0.22 });
}
