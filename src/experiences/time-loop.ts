import { defineReveal } from '../levels/scaffold';
import { revealTimeLoop } from '../levels/time-loop';

// The time loop: a small-town street, the same forty seconds of a Tuesday, over
// and over — and a button in a shop that won't let you have it.

export const timeLoop = defineReveal('time-loop', 1.0, revealTimeLoop);
