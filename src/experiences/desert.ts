import { defineReveal } from '../levels/scaffold';
import { revealDesert } from '../levels/desert';

// The desert — a road over a railway, the exit on the far side, and a train on
// the horizon that takes an interest. Resolution: put a decoy (the dummy, or a
// duck) on the rails, let the train charge it, and cross while it's gone.

export const desert = defineReveal('desert', 1.2, revealDesert);
