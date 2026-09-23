import { defineReveal } from '../levels/scaffold';
import { revealLostFound } from '../levels/lost-found';

// Lost & Found: fill in the form, correctly, and the clerk hands your thing
// back. Anything back (even a single left shoe) and a button rises.

export const lostFound = defineReveal('lost-found', 1.1, revealLostFound);
