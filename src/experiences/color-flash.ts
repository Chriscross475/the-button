import * as THREE from 'three';
import type { Experience, ExperienceContext } from './registry';
import { addUpdater } from './scheduler';
import { pick } from './util';
import { pop } from '../audio/sfx';

// The whole room briefly floods with a vivid colour, then eases back to white.
// Cheap, fast, and a little unsettling — pure mood.

const LINES = ['Mood lighting.', 'The room felt a colour.', 'Ambiance.', 'A vibe, briefly.'];
const COLORS = [0xff3b3b, 0x3b6bff, 0x9b3bff, 0x18c98a, 0xff8c1a, 0xff3bd0];

export const colorFlash: Experience = {
  id: 'color-flash',
  weight: 1,
  run(ctx: ExperienceContext) {
    ctx.narrate(pick(LINES));
    pop();

    const white = new THREE.Color(0xf4f4f2);
    const target = new THREE.Color(pick(COLORS));
    const bg = (ctx.scene.background as THREE.Color) ?? white;
    const fog = ctx.scene.fog as THREE.Fog | null;

    let t = 0;
    addUpdater((dt) => {
      t += dt;
      // Ease in over 0.25s, hold briefly, ease back by 2s total.
      const k = t < 0.25 ? t / 0.25 : Math.max(0, 1 - (t - 0.25) / 1.75);
      bg.copy(white).lerp(target, k);
      if (fog) fog.color.copy(bg);
      if (t > 2) {
        bg.copy(white);
        if (fog) fog.color.copy(white);
        return true;
      }
      return false;
    });
  },
};
