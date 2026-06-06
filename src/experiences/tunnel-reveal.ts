import type { Experience, ExperienceContext } from './registry';
import { revealTunnel } from '../levels/tunnel';

// A "path" experience (the in-place reveal model): the room opens up — pedestal
// sinks, walls topple, ceiling floats — and you're standing in the valley with
// the train tracks. Only fires while you're still inside the closed room.

let revealing = false;

export const tunnelReveal: Experience = {
  id: 'tunnel',
  weight: 1.3,
  run(ctx: ExperienceContext) {
    if (revealing) return;
    revealing = true;
    revealTunnel(ctx);
    // Reset the guard when we return to a fresh hub (next press can re-open it).
    window.setTimeout(() => {
      revealing = false;
    }, 4000);
  },
};
