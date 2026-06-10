import { defineReveal } from '../levels/scaffold';
import { revealCircus } from '../levels/circus';

// The circus big-top: a vertical trampoline climb to a unicycle, then a thin
// twisting walkway out to the exit. Entered via the in-place reveal.

export const circus = defineReveal('circus', 1.1, revealCircus);
