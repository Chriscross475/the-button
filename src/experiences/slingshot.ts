import { defineReveal } from '../levels/scaffold';
import { revealSlingshot } from '../levels/slingshot';

// The slingshot yard — a full level (the trains' origin). NOT in the button's
// random pool (weight 0): it's only reached by walking up the tunnel from the
// tunnel level (which advanceTo's here by id), making it a discovered place
// rather than another roll of the dice.

export const slingshot = defineReveal('slingshot', 0, revealSlingshot);
