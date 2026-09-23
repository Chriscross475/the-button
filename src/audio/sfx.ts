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

/** The live audio graph (context + master gain) for a level that plays its own
 *  buffers (e.g. looping music), or null before the first user gesture. */
export function audioOut(): { ctx: AudioContext; master: GainNode } | null {
  ensureAudio();
  return ctx && master ? { ctx, master } : null;
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

export interface ToneOpts {
  type?: OscillatorType;
  from: number;
  to?: number;
  dur: number;
  gain?: number;
  attack?: number;
}

/** A single synthesised tone (the building block of most sounds here) —
 *  exported so a level can compose its own sounds. */
export function tone({ type = 'sine', from, to = from, dur, gain = 0.3, attack = 0.005 }: ToneOpts): void {
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

/** A burst of filtered white noise — exported alongside tone(). */
export function noise(dur: number, gain = 0.3, filterHz = 1200, type: BiquadFilterType = 'lowpass'): void {
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

/** One strike of a level-crossing bell: a bright, quick ding. `gain` lets the
 *  caller fade it with distance. */
export function crossingBell(gain = 0.12): void {
  ensureAudio();
  tone({ type: 'triangle', from: 1480, to: 1440, dur: 0.22, gain });
  tone({ type: 'sine', from: 2960, to: 2900, dur: 0.12, gain: gain * 0.4 });
}

// ── The big top ──

/** A snare roll: rapid filtered-noise hits over `dur` seconds. */
export function drumroll(dur = 1.2): void {
  ensureAudio();
  if (!ctx || !master || !noiseBuf) return;
  const t0 = now();
  for (let t = 0; t < dur; t += 0.045) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 1800;
    const g = ctx.createGain();
    const peak = 0.08 + 0.14 * (t / dur); // swells
    g.gain.setValueAtTime(peak, t0 + t);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + 0.04);
    src.connect(filt).connect(g).connect(master);
    src.start(t0 + t, Math.random() * 0.5);
    src.stop(t0 + t + 0.05);
  }
}

/** A short brassy ta-daa. */
export function fanfare(): void {
  ensureAudio();
  if (!ctx) return;
  const notes: [number, number, number][] = [[392, 0, 0.12], [523, 0.13, 0.12], [659, 0.26, 0.55]];
  for (const [f, at, dur] of notes) {
    window.setTimeout(() => {
      tone({ type: 'sawtooth', from: f, dur, gain: 0.14, attack: 0.02 });
      tone({ type: 'square', from: f * 2, dur, gain: 0.04, attack: 0.02 });
    }, at * 1000);
  }
}

/** A crowd's applause — a wash of broadband noise with a clappy flutter. */
export function applause(gain = 0.22, dur = 1.8): void {
  ensureAudio();
  noise(dur, gain, 3200, 'bandpass');
  for (let t = 0; t < dur * 0.8; t += 0.07) {
    window.setTimeout(() => noise(0.03, gain * 0.5, 2400, 'highpass'), t * 1000 * (0.8 + Math.random() * 0.4));
  }
}

/** A disappointed crowd: a low, falling "booo". */
export function boo(): void {
  ensureAudio();
  tone({ type: 'sawtooth', from: 150, to: 110, dur: 1.1, gain: 0.08, attack: 0.15 });
  tone({ type: 'sawtooth', from: 190, to: 140, dur: 1.0, gain: 0.05, attack: 0.2 });
  noise(1.0, 0.06, 500, 'lowpass');
}

/** Wah, wah, wah, wahhh. */
export function sadTrombone(): void {
  ensureAudio();
  const steps: [number, number, number][] = [[311, 0, 0.35], [294, 0.38, 0.35], [277, 0.76, 0.35], [262, 1.14, 0.9]];
  for (const [f, at, dur] of steps) {
    window.setTimeout(() => tone({ type: 'sawtooth', from: f, to: f * (dur > 0.5 ? 0.94 : 0.99), dur, gain: 0.12, attack: 0.04 }), at * 1000);
  }
}

/** A clown horn: honk-honk. */
export function honk(): void {
  ensureAudio();
  tone({ type: 'square', from: 420, to: 380, dur: 0.14, gain: 0.16 });
  window.setTimeout(() => tone({ type: 'square', from: 360, to: 320, dur: 0.18, gain: 0.16 }), 170);
}
