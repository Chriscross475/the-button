import { defineReveal } from '../levels/scaffold';
import { revealYouAreButton } from '../levels/you-are-button';

// You are the button: you press it and swap. A giant you walks up to press
// you back, and the narrator narrates for it — until he wonders which of you
// is reading this.

export const youAreButton = defineReveal('you-are-button', 1.0, revealYouAreButton);
