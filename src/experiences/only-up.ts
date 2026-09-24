import { defineReveal } from '../levels/scaffold';
import { revealOnlyUp } from '../levels/only-up';

// Only up: a tower of the game's own junk into the sky, the button at the top.
// The one level where you can jump.

export const onlyUp = defineReveal('only-up', 1.0, revealOnlyUp);
