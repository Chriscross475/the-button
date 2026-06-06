// Narrator text-to-speech.
//
// PRIMARY: the server-side Kokoro at POST /api/tts (the same backend the Sandbox
// UI uses — it works reliably). Returns a WAV which we play via a plain <audio>
// element: no in-browser model, no WebGPU/AudioContext quirks, consistent voice
// (bm_george) in every browser. On the deployed site /api/tts is proxied to the
// Oracle server; in local dev Vite proxies it to localhost:37777.
//
// FALLBACK: the browser's Web Speech `SpeechSynthesis` — used if /api/tts is
// unreachable or playback is blocked.

let enabled = true;
let primed = false;
let voice: SpeechSynthesisVoice | null = null;

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

const TTS_VOICE = 'bm_george'; // dry British male narrator
const TTS_SPEED = 1.05;
// Inserted silence per pause type — tuned by ear (kokoro's own pauses are off:
// periods too short, em-dashes too long). Sentence ends (. ! ?) get a clear
// pause; an em/en dash is the dramatic beat (a touch longer).
const GAP_SENTENCE = 200;
const GAP_DASH = 300;
const MAX_SEGMENTS = 6; // beyond this, don't split (too many TTS calls)

// Voice source — switchable by the player. 'kokoro' = server /api/tts (the good
// British neural voice, consistent everywhere); 'basic' = the browser's built-in
// Web Speech voice (varies by browser, but zero-latency + offline).
export type TtsMode = 'kokoro' | 'basic';
const MODE_KEY = 'button-tts-mode';
function loadMode(): TtsMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'basic' ? 'basic' : 'kokoro';
  } catch {
    return 'kokoro';
  }
}
let mode: TtsMode = loadMode();

let seq = 0; // newest line wins
let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let abortCtl: AbortController | null = null;

function stopAudio(): void {
  if (abortCtl) {
    abortCtl.abort();
    abortCtl = null;
  }
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      /* ignore */
    }
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

// ── Web Speech fallback ────────────────────────────────────────────────
const PREFERRED = [
  'Google UK English Male',
  'Daniel',
  'Arthur',
  'Oliver',
  'George',
  'Microsoft Ryan',
  'Microsoft George',
  'UK English Male',
];
const FEMALE = [
  'female', 'samantha', 'karen', 'moira', 'tessa', 'serena', 'martha', 'stephanie',
  'kate', 'fiona', 'victoria', 'susan', 'zira', 'hazel', 'catherine', 'sonia', 'libby',
];

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const en = voices.filter((vo) => vo.lang.toLowerCase().startsWith('en'));
  for (const name of PREFERRED) {
    const v = en.find((vo) => vo.name.includes(name));
    if (v) return v;
  }
  const male = (vo: SpeechSynthesisVoice) => !FEMALE.some((f) => vo.name.toLowerCase().includes(f));
  const gb = en.filter((vo) => vo.lang.toLowerCase() === 'en-gb');
  const us = en.filter((vo) => vo.lang.toLowerCase() === 'en-us');
  return gb.find(male) ?? us.find(male) ?? en.find(male) ?? gb[0] ?? en[0] ?? null;
}

function speakWebSpeech(text: string): void {
  if (!supported || !text) return;
  voice = pickVoice() ?? voice;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-GB';
  if (voice) u.voice = voice;
  u.rate = 0.96;
  u.pitch = 0.9;
  u.volume = 1;
  window.speechSynthesis.speak(u);
}

// ── public API ─────────────────────────────────────────────────────────
/** Opening line: nothing to wait for now (server TTS) — fire immediately. */
export function onVoiceReady(cb: () => void): void {
  cb();
}

/** Call once on the first user gesture — warms Web Speech voices for fallback. */
export function primeTts(): void {
  if (primed) return;
  primed = true;
  if (supported) {
    voice = pickVoice();
    if (!voice) {
      window.speechSynthesis.onvoiceschanged = () => {
        voice = pickVoice();
      };
    }
  }
}

async function fetchTts(text: string, signal: AbortSignal): Promise<Blob> {
  const r = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 800), voice: TTS_VOICE, speed: TTS_SPEED }),
    signal,
  });
  if (!r.ok) throw new Error('tts ' + r.status);
  const blob = await r.blob();
  if (blob.size === 0) throw new Error('empty audio');
  return blob;
}

// Break a line into phrases + the pause that follows each. Sentence punctuation
// (. ! ?) stays attached for natural intonation; dashes are dropped. Each phrase
// is spoken on its own and we insert a controllable silence between.
function segment(text: string): { text: string; gap: number }[] {
  const out: { text: string; gap: number }[] = [];
  const re = /\s*[—–]\s*|\s+-\s+|([.!?]+)\s+/g; // dash | spaced-hyphen | sentence-end
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const isSentence = m[1] !== undefined;
    const end = isSentence ? m.index + m[1].length : m.index; // keep . ! ?, drop dashes
    const chunk = text.slice(last, end).trim();
    if (chunk) out.push({ text: chunk, gap: isSentence ? GAP_SENTENCE : GAP_DASH });
    last = m.index + m[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail) out.push({ text: tail, gap: 0 });
  return out;
}

// Play WAV blobs back-to-back, waiting gaps[i] of silence after blob i.
function playSequence(blobs: Blob[], gaps: number[], mySeq: number): void {
  let i = 0;
  const playNext = () => {
    if (mySeq !== seq || !enabled || i >= blobs.length) return;
    const url = URL.createObjectURL(blobs[i]);
    currentUrl = url;
    const a = new Audio(url);
    a.volume = 1;
    currentAudio = a;
    a.onended = () => {
      URL.revokeObjectURL(url);
      if (currentUrl === url) currentUrl = null;
      if (currentAudio === a) currentAudio = null;
      const g = gaps[i] ?? 0;
      i += 1;
      if (i < blobs.length && mySeq === seq && enabled) window.setTimeout(playNext, g);
    };
    a.play().catch(() => {});
  };
  playNext();
}

export function speak(text: string): void {
  if (!enabled || !text.trim()) return;
  const mySeq = ++seq; // newest line wins
  stopAudio();
  if (supported) window.speechSynthesis.cancel();

  // Basic mode: the browser voice (it already pauses on dashes natively).
  if (mode === 'basic') {
    speakWebSpeech(text);
    return;
  }

  // Split into phrases (at sentence ends + dashes) so each is spoken on its own
  // with a controllable silence between — kokoro's own pauses are uneven.
  let parts = segment(text);
  if (parts.length === 0 || parts.length > MAX_SEGMENTS) parts = [{ text, gap: 0 }];

  const ctl = new AbortController();
  abortCtl = ctl;
  Promise.all(parts.map((p) => fetchTts(p.text, ctl.signal)))
    .then((blobs) => {
      if (mySeq !== seq || !enabled) return; // superseded while fetching
      playSequence(blobs, parts.map((p) => p.gap), mySeq);
    })
    .catch((e) => {
      if (e?.name === 'AbortError') return;
      console.warn('[tts] /api/tts failed — Web Speech:', e?.message || e);
      if (mySeq === seq && enabled) speakWebSpeech(text);
    });
}

export function cancelSpeech(): void {
  seq++; // invalidate any in-flight fetch
  stopAudio();
  if (supported) window.speechSynthesis.cancel();
}

export function setTtsEnabled(on: boolean): void {
  enabled = on;
  if (!on) cancelSpeech();
}

export function isTtsEnabled(): boolean {
  return enabled;
}

export function toggleTts(): boolean {
  setTtsEnabled(!enabled);
  return enabled;
}

export function getTtsMode(): TtsMode {
  return mode;
}

export function setTtsMode(m: TtsMode): void {
  mode = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* ignore */
  }
  cancelSpeech(); // stop whatever's playing in the old voice
}

/** Flip between the server kokoro voice and the basic browser voice. */
export function cycleTtsMode(): TtsMode {
  setTtsMode(mode === 'kokoro' ? 'basic' : 'kokoro');
  return mode;
}
