import type { Experience, ExperienceContext } from './registry';
import { revealDucks } from '../levels/duck-room';

// The duck room is now a full (in-room) level: ceiling opens, ducks rain, a
// dispenser button makes more. Resolution: reach the duck quota.

let revealing = false;

export const duckLevel: Experience = {
  id: 'ducks',
  weight: 1.2,
  run(ctx: ExperienceContext) {
    if (revealing) return;
    revealing = true;
    revealDucks(ctx);
    window.setTimeout(() => {
      revealing = false;
    }, 4000);
  },
};
