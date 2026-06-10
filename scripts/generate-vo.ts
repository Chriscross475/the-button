// Pre-bake narrator voice lines to static WAV assets.
//
//   npm run vo      (needs the local Sandbox kokoro running at localhost:37777)
//
// Scans the source for narrate('...') string literals, and for each unique line
// writes public/vo/<hash>.wav — the line synthesised by kokoro (bm_george) with
// the SAME per-phrase pauses the runtime uses, baked in. Content-hashed, so only
// new/changed lines are (re)generated and stale WAVs are pruned. Writes the hash
// list to src/audio/vo-manifest.json (imported by tts.ts).
//
// Run locally where kokoro is fast, then COMMIT public/vo/*.wav + the manifest.
// At runtime the game plays these static files — no /api/tts call, no inference.

import {
  readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, unlinkSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { segment, hashLine } from '../src/audio/vo-shared';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const VO_DIR = join(ROOT, 'public', 'vo');
const MANIFEST = join(SRC, 'audio', 'vo-manifest.json');
const API = process.env.TTS_API || 'http://localhost:37777/api/tts';
const VOICE = 'bm_george';
const SPEED = 1.05;
const SR = 24000; // kokoro WAV: mono, 16-bit, 24 kHz

// ── 1. collect every FIXED narrator line from the source ──
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function unescapeLiteral(raw: string): string {
  return raw.replace(/\\(['"`\\nrt])/g, (_, c) =>
    c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c);
}

/** The span of the balanced (...) starting at `open` (string-aware), or null. */
function parenSpan(code: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return code.slice(open + 1, i);
  }
  return null;
}

const LITERAL = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

function addLiterals(snippet: string, lines: Set<string>): number {
  let dynamic = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(LITERAL.source, 'g');
  while ((m = re.exec(snippet)) !== null) {
    if (m[1] === '`' && m[2].includes('${')) { dynamic++; continue; } // dynamic → live path
    const text = unescapeLiteral(m[2]).trim();
    if (text) lines.add(text);
  }
  return dynamic;
}

function collectLines(): string[] {
  const lines = new Set<string>();
  let dynamic = 0;
  for (const f of tsFiles(SRC)) {
    const code = readFileSync(f, 'utf8');
    // narrate('...') — an inline literal first argument.
    const re = /narrate\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g; // per-file (fresh lastIndex)
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      if (m[1] === '`' && m[2].includes('${')) { dynamic++; continue; } // dynamic → live path
      const text = unescapeLiteral(m[2]).trim();
      if (text) lines.add(text);
    }
    // vo(...) — fixed lines declared away from the narrate call (arrays, consts,
    // record values). Every string literal inside the balanced span is baked.
    const voRe = /\bvo\s*\(/g;
    while ((m = voRe.exec(code)) !== null) {
      const span = parenSpan(code, m.index + m[0].length - 1);
      if (span) dynamic += addLiterals(span, lines);
    }
  }
  if (dynamic) console.log(`  note: ${dynamic} dynamic line(s) with \${} left to the live path`);
  return [...lines];
}

// ── WAV helpers ──
function pcmOf(buf: Buffer): Buffer {
  let off = 12; // skip RIFF(4) size(4) WAVE(4)
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size & 1);
  }
  return buf.subarray(44);
}
function silence(ms: number): Buffer {
  return Buffer.alloc(Math.round((SR * ms) / 1000) * 2);
}
function writeWav(pcm: Buffer, dest: string): void {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(dest, Buffer.concat([h, pcm]));
}

async function ttsSegment(text: string): Promise<Buffer> {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: VOICE, speed: SPEED }),
  });
  if (!r.ok) throw new Error(`/api/tts ${r.status}`);
  const ab = await r.arrayBuffer();
  if (ab.byteLength === 0) throw new Error('empty audio');
  return Buffer.from(ab);
}

async function bake(text: string, dest: string): Promise<void> {
  const parts: Buffer[] = [];
  for (const s of segment(text)) {
    parts.push(pcmOf(await ttsSegment(s.text)));
    if (s.gap > 0) parts.push(silence(s.gap));
  }
  writeWav(Buffer.concat(parts), dest);
}

async function main(): Promise<void> {
  if (!existsSync(VO_DIR)) mkdirSync(VO_DIR, { recursive: true });
  const lines = collectLines();
  console.log(`Found ${lines.length} fixed narrator line(s).`);
  try {
    await ttsSegment('test');
  } catch (e: any) {
    console.error(`\n✗ Cannot reach kokoro at ${API}: ${e?.message || e}`);
    console.error('  Start the local Sandbox (localhost:37777) and retry.\n');
    process.exit(1);
  }
  const wanted = new Set<string>();
  let made = 0, kept = 0;
  for (const text of lines) {
    const h = hashLine(text);
    wanted.add(h);
    const dest = join(VO_DIR, `${h}.wav`);
    if (existsSync(dest)) { kept++; continue; }
    console.log(`  baking ${h}  "${text.slice(0, 50)}${text.length > 50 ? '…' : ''}"`);
    await bake(text, dest);
    made++;
  }
  let pruned = 0;
  for (const f of readdirSync(VO_DIR)) {
    if (f.endsWith('.wav') && !wanted.has(f.slice(0, -4))) { unlinkSync(join(VO_DIR, f)); pruned++; }
  }
  writeFileSync(MANIFEST, JSON.stringify([...wanted].sort()) + '\n');
  console.log(`\nDone — baked ${made}, kept ${kept}, pruned ${pruned}. Manifest: ${wanted.size} line(s).`);
}

main();
