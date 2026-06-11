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

import { segment, hashLine } from './vo-shared';
import voManifest from './vo-manifest.json';

let enabled = true;
let primed = false;
let voice: SpeechSynthesisVoice | null = null;

const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

const TTS_VOICE = 'bm_george'; // dry British male narrator
const TTS_SPEED = 1.05;
const MAX_SEGMENTS = 6; // beyond this, don't split the LIVE path (too many TTS calls)

// Pre-baked narration: lines generated offline (npm run vo) ship as static WAVs
// in public/vo/<hash>.wav, listed here. The runtime plays them instantly — no
// /api/tts call, no server inference — which is what keeps the narrator snappy on
// the slow Oracle box. Dynamic lines (scores) aren't baked → they use the live path.
const BAKED = new Set<string>(voManifest as string[]);
function prebakedUrl(text: string): string | null {
  const h = hashLine(text);
  return BAKED.has(h) ? `${import.meta.env.BASE_URL}vo/${h}.wav` : null;
}

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

// Play a single pre-baked WAV asset (pauses already baked in). Falls back to the
// live path if the asset is missing/blocked.
function playBaked(url: string, text: string, mySeq: number): void {
  const a = new Audio(url);
  a.volume = 1;
  currentAudio = a;
  a.onended = () => {
    if (currentAudio === a) currentAudio = null;
  };
  a.onerror = () => {
    if (mySeq === seq && enabled) liveSpeak(text, mySeq); // asset 404 → generate live
  };
  a.play().catch(() => {
    if (mySeq === seq && enabled) liveSpeak(text, mySeq);
  });
}

// The live path: split into phrases, fetch each from /api/tts, play with gaps.
function liveSpeak(text: string, mySeq: number): void {
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

  // Pre-baked asset → play it instantly (no server call). This covers the fixed
  // narration; dynamic lines fall through to the live /api/tts path.
  const baked = prebakedUrl(text);
  if (baked) {
    playBaked(baked, text, mySeq);
    return;
  }
  liveSpeak(text, mySeq);
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
