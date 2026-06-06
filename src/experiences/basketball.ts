import type { Experience, ExperienceContext } from './registry';
import { revealBasketball } from '../levels/basketball';

// A 30-second basketball minigame, entered via the in-place reveal (the room
// stays enclosed so the ball bounces off the walls).

let revealing = false;

export const basketball: Experience = {
  id: 'basketball',
  weight: 1.1,
  run(ctx: ExperienceContext) {
    if (revealing) return;
    revealing = true;
    revealBasketball(ctx);
    window.setTimeout(() => {
      revealing = false;
    }, 4000);
  },
};
