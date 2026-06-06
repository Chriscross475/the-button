import type { Experience, ExperienceContext } from './registry';
import { revealSlingshot } from '../levels/slingshot';

// The slingshot yard — a full level (the trains' origin), entered via the
// in-place reveal. Also reachable by walking up a tunnel in the tunnel level.

let revealing = false;

export const slingshot: Experience = {
  id: 'slingshot',
  weight: 1.1,
  run(ctx: ExperienceContext) {
    if (revealing) return;
    revealing = true;
    revealSlingshot(ctx);
    window.setTimeout(() => {
      revealing = false;
    }, 4000);
  },
};
