import { defineReveal } from '../levels/scaffold';
import { revealSchrodinger } from '../levels/schrodinger';

// Schrödinger's box: a steel box in a clean lab. The button inside is pressed and
// not pressed until somebody looks. Things in here only change while nobody is.

export const schrodinger = defineReveal('schrodinger', 1.0, revealSchrodinger);
