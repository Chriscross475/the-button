import type { Experience, ExperienceContext } from './registry';
import { addUpdater } from './scheduler';
import { vo } from '../audio/vo-shared';
import { FONT_VOICE } from '../ui/fonts';

// The end credits start rolling. Then the narrator stops them, and they roll
// back down off the screen.

const NOT_YET = vo('No. Not yet. Sorry.');

const LINES: [string, string][] = [
  ['THE BUTTON', ''],
  ['Directed by', 'the button'],
  ['Pressed by', 'you'],
  ['Narrated by', 'a man in a small room'],
  ['Catering', 'the ducks'],
  ['Stunts', 'also the ducks'],
  ['Button consultant', 'the button'],
  ['Best boy', 'the statue'],
  ['', 'No statues were harmed in the making of this press.'],
];

const UP = 3.6; // seconds rolling up
const SPEED = 95; // px/s up
const BACK = 900; // px/s down

export const credits: Experience = {
  id: 'credits',
  weight: 0.8,
  run(ctx: ExperienceContext) {
    const band = document.createElement('div');
    band.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:linear-gradient(rgba(0,0,0,0.25),rgba(0,0,0,0.72) 30%,rgba(0,0,0,0.72) 70%,rgba(0,0,0,0.25))',
      'overflow:hidden',
      'pointer-events:none',
      'z-index:28',
    ].join(';');
    const roll = document.createElement('div');
    roll.style.cssText = [
      'position:absolute',
      'left:0',
      'right:0',
      'top:100%',
      'text-align:center',
      `font-family:${FONT_VOICE}`,
      'color:#f2efe6',
      'text-shadow:0 1px 6px rgba(0,0,0,0.8)',
    ].join(';');
    for (const [role, who] of LINES) {
      const row = document.createElement('div');
      row.style.cssText = 'margin:0 16px 22px;';
      if (!who) {
        row.textContent = role;
        row.style.cssText += 'font-size:34px;letter-spacing:0.3em;margin-bottom:44px;';
      } else {
        const r = document.createElement('div');
        r.textContent = role;
        r.style.cssText = 'font-size:12px;letter-spacing:0.25em;text-transform:uppercase;opacity:0.7;';
        const w = document.createElement('div');
        w.textContent = who;
        w.style.cssText = 'font-size:20px;font-style:italic;';
        if (role) row.appendChild(r);
        row.appendChild(w);
      }
      roll.appendChild(row);
    }
    band.appendChild(roll);
    document.body.appendChild(band);

    // Backstop: a level change clears the updater below; the band still goes.
    setTimeout(() => band.remove(), (UP + 3) * 1000);
    let y = 0; // px scrolled up
    let t = 0;
    let back = false;
    addUpdater((dt) => {
      t += dt;
      if (!back && t >= UP) {
        back = true;
        ctx.narrate(NOT_YET, 2600, { priority: true });
      }
      y += (back ? -BACK : SPEED) * dt;
      roll.style.transform = `translateY(${-Math.max(0, y)}px)`;
      if (back && y <= -40) {
        band.remove();
        return true;
      }
      return false;
    });
  },
};
