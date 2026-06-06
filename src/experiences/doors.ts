import type { Experience, ExperienceContext } from './registry';
import { revealDoors } from '../levels/doors-corridor';

// The corridor-of-doors path. The room opens into a long hall of uniquely
// opening doors.

let revealing = false;

export const doorsCorridor: Experience = {
  id: 'doors',
  weight: 1.1,
  run(ctx: ExperienceContext) {
    if (revealing) return;
    revealing = true;
    revealDoors(ctx);
    window.setTimeout(() => {
      revealing = false;
    }, 4000);
  },
};
