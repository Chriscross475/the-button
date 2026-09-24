import { defineReveal } from '../levels/scaffold';
import { revealSelfCheckout } from '../levels/self-checkout';

// The self-checkout: a small sum. Make the total exactly £10.00, the button
// included, and it's on us.

export const selfCheckout = defineReveal('self-checkout', 1.1, revealSelfCheckout);
