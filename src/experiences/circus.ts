import { defineReveal } from '../levels/scaffold';
import { revealCircus } from '../levels/circus';

// The big top: you are the act. Cannon, tightrope, clown car; fill the applause
// meter for the unicycle and the curtain out, or leave by the back door.

export const circus = defineReveal('circus', 1.1, revealCircus);
