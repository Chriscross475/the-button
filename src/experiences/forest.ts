import type { Experience, ExperienceContext } from './registry';
import { revealForest } from '../levels/forest';

// The forest is now a full level (a big outdoor plain), entered via the in-place
// reveal. Resolution: find the exit clearing.

let revealing = false;

export const forest: Experience = {
  id: 'forest',
  weight: 1.2,
  run(ctx: ExperienceContext) {
    if (revealing) return;
    revealing = true;
    revealForest(ctx);
    window.setTimeout(() => {
      revealing = false;
    }, 4000);
  },
};
