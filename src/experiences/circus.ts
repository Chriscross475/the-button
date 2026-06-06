import type { Experience, ExperienceContext } from './registry';
import { revealCircus } from '../levels/circus';

// The circus big-top: a vertical trampoline climb to a unicycle, then a thin
// twisting walkway out to the exit. Entered via the in-place reveal.

let revealing = false;

export const circus: Experience = {
  id: 'circus',
  weight: 1.1,
  run(ctx: ExperienceContext) {
    if (revealing) return;
    revealing = true;
    revealCircus(ctx);
    window.setTimeout(() => {
      revealing = false;
    }, 4000);
  },
};
