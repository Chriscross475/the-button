import { defineReveal } from '../levels/scaffold';
import { revealTrolley } from '../levels/trolley';

// The trolley problem: five on the main line, one on the side line, a lever,
// and a philosophy lecturer who has waited his whole career for this.

export const trolley = defineReveal('trolley', 1.0, revealTrolley);
