import { defineReveal } from '../levels/scaffold';
import { revealNightShift } from '../levels/night-shift';

// The night shift: the security office of a closed-down button restaurant,
// midnight to six, and something in the halls that wants you to press it.

export const nightShift = defineReveal('night-shift', 1.0, revealNightShift);
