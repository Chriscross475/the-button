import { defineReveal } from '../levels/scaffold';
import { revealTerms } from '../levels/terms';

// The terms & conditions: a corridor of small print with I AGREE at the end.
// Read clause 47 (the narrator skips it) and a side door lets you out; agree,
// and cancelling the subscription takes three more buttons.

export const terms = defineReveal('terms', 1.1, revealTerms);
