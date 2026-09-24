import { defineReveal } from '../levels/scaffold';
import { revealCave } from '../levels/cave';

// Plato's cave: a wall of firelit shadows (the button, huge and perfect), the
// chained prisoners who love it, the cardboard truth behind them, and a passage
// up into the sun, where the real button is.

export const cave = defineReveal('cave', 1.0, revealCave);
