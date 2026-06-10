import { defineReveal } from '../levels/scaffold';
import { revealForest } from '../levels/forest';

// The forest is now a full level (a big outdoor plain), entered via the in-place
// reveal. Resolution: find the exit clearing.

export const forest = defineReveal('forest', 1.2, revealForest);
