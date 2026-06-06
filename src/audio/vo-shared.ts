// Shared narrator-line logic used by BOTH the runtime (tts.ts) and the offline
// pre-bake generator (scripts/generate-vo.ts). Keep this free of any vite/browser
// APIs so `bun` can import it directly from the generator.

// Inserted silence per pause type (ms) — tuned by ear (kokoro's own pauses are
// off: periods too short, em-dashes too long). The generator bakes these gaps
// into the WAV; the runtime inserts them between live segments.
export const GAP_SENTENCE = 200;
export const GAP_DASH = 300;

// Break a line into phrases + the pause that follows each. Sentence punctuation
// (. ! ?) stays attached for natural intonation; dashes are dropped. The tail
// has gap 0 (no trailing pause).
export function segment(text: string): { text: string; gap: number }[] {
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

// Stable content hash of a line → 8 hex chars (FNV-1a). A line's pre-baked WAV
// lives at `vo/<hashLine(text)>.wav`. The SAME function runs on both sides, so
// the runtime finds exactly what the generator produced. Change a line's text →
// new hash → the generator bakes a fresh WAV and prunes the stale one.
export function hashLine(text: string): string {
  let h = 0x811c9dc5;
  const s = text.trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
