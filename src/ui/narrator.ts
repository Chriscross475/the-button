// Stanley-Parable-style narrator. A single italic line that fades in, holds,
// and fades out, and is spoken aloud via the self-contained TTS module.
//
// Ordinary lines QUEUE so a rapid sequence reads one at a time. But a PRIORITY
// line (a reaction that must land on the moment — a death, a duck hitting the
// saw, a clean landing) jumps the whole queue: it drops everything pending,
// interrupts whatever is speaking, and plays immediately so the timing fits.

import { speak } from '../audio/tts';

interface Line {
  text: string;
  hold: number; // ms visible at full opacity
  interruptible?: boolean; // a low-prio line that the next line replaces at once
}

export interface NarrateOpts {
  /** Clear the queue + interrupt the current line and play this one NOW. */
  priority?: boolean;
  /** A LOW-priority line: the next line (even an ordinary one) replaces it
   *  immediately instead of queueing, so the player never has to wait it out.
   *  Used for the idle intro line. */
  interruptible?: boolean;
}

const queue: Line[] = [];
let showing = false;
let currentInterruptible = false; // is the line on screen a low-prio one?
let el: HTMLDivElement | null = null;
let timers: number[] = []; // pending fade-out / next-pump timeouts for the current line

function element(): HTMLDivElement {
  if (!el) el = document.getElementById('narrator') as HTMLDivElement;
  return el;
}

function clearTimers(): void {
  for (const t of timers) window.clearTimeout(t);
  timers = [];
}

export function narrate(text: string, holdMs = 3200, opts?: NarrateOpts): void {
  const line: Line = { text, hold: holdMs, interruptible: opts?.interruptible };
  if (opts?.priority) {
    queue.length = 0; // drop everything waiting — this line wins
    present(line, true); // interrupt the current line + speech, show immediately
    return;
  }
  // If the line currently on screen is low-priority, don't wait it out — replace
  // it now so the player hears this one straight away.
  if (showing && currentInterruptible) {
    queue.length = 0;
    present(line, false);
    return;
  }
  queue.push(line);
  if (!showing) pump();
}

function pump(): void {
  clearTimers();
  const line = queue.shift();
  if (!line) {
    showing = false;
    return;
  }
  present(line, false);
}

function present(line: Line, immediate: boolean): void {
  clearTimers();
  showing = true;
  currentInterruptible = !!line.interruptible;
  const node = element();
  node.textContent = line.text;
  speak(line.text); // speak() cancels any current utterance — newest wins
  const fadeMs = 600;
  if (immediate) {
    node.style.opacity = '1'; // no fade-in: a priority line lands on the beat
  } else {
    node.style.opacity = '0';
    requestAnimationFrame(() => {
      node.style.opacity = '1';
    });
  }
  timers.push(
    window.setTimeout(() => {
      node.style.opacity = '0';
      timers.push(window.setTimeout(pump, fadeMs + 120));
    }, line.hold),
  );
}
