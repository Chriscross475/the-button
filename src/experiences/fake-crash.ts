import type { Experience, ExperienceContext } from './registry';
import { addUpdater } from './scheduler';
import { pick } from './util';
import { tone, noise } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { FONT_SIGN } from '../ui/fonts';

// The game "freezes": the screen greys out and a not-responding dialog appears.
// A few seconds later everything snaps back. The game runs on underneath.

const KIDDING = vo(['Just kidding.', 'Just kidding. Your face, though.', 'Relax. It was a bit.']);
const CLICKED = vo('Oh. You actually clicked it.');

const HOLD = 2.8;

export const fakeCrash: Experience = {
  id: 'fake-crash',
  weight: 0.8,
  run(ctx: ExperienceContext) {
    const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
    const oldFilter = canvas?.style.filter ?? '';
    if (canvas) canvas.style.filter = 'grayscale(0.85) brightness(1.08) contrast(0.85)';
    // The hum cuts out with a stuck buzz.
    tone({ type: 'square', from: 110, dur: 0.35, gain: 0.05 });
    noise(0.2, 0.05, 900, 'bandpass');

    const wash = document.createElement('div');
    wash.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,0.28);z-index:28;';
    const box = document.createElement('div');
    box.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:42%',
      'transform:translate(-50%,-50%)',
      'width:min(420px,calc(100vw - 32px))',
      'background:#f3f3f3',
      'border:1px solid #8a8a8a',
      'box-shadow:0 8px 30px rgba(0,0,0,0.35)',
      `font-family:${FONT_SIGN}`,
      'font-size:14px',
      'color:#1a1a1a',
      'z-index:29',
    ].join(';');
    const title = document.createElement('div');
    title.style.cssText = 'padding:8px 12px;background:#fff;border-bottom:1px solid #d0d0d0;font-size:13px;';
    title.textContent = 'the_button.exe (Not Responding)';
    const body = document.createElement('div');
    body.style.cssText = 'padding:18px 16px 10px;line-height:1.45;';
    body.textContent = 'the_button.exe is not responding. If you close the program, you might lose information.';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:6px 16px 16px;';
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(row);

    let done = false;
    const restore = () => {
      if (canvas) canvas.style.filter = oldFilter;
      wash.remove();
      box.remove();
    };
    const finish = (clicked: boolean) => {
      if (done) return;
      done = true;
      restore();
      tone({ type: 'sine', from: 440, to: 880, dur: 0.12, gain: 0.06 });
      ctx.narrate(clicked ? CLICKED : pick(KIDDING), 3000, { priority: true });
    };
    for (const label of ['→ Close the program', '→ Wait for the program to respond']) {
      const b = document.createElement('div');
      b.textContent = label;
      b.style.cssText = 'padding:8px 10px;border:1px solid #c8c8c8;background:#fff;cursor:pointer;color:#1a4fa0;';
      b.addEventListener?.('click', () => finish(true));
      row.appendChild(b);
    }
    document.body.appendChild(wash);
    document.body.appendChild(box);

    // Backstop: a level change clears the updater below, but the screen must
    // never stay frozen.
    setTimeout(restore, (HOLD + 1) * 1000);
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      if (t < HOLD && !done) return false;
      finish(false);
      return true;
    });
  },
};
