import { defineReveal } from '../levels/scaffold';
import { revealVending } from '../levels/vending';

// The vending machine: THE button is product B4. Find a coin, pay, key it in,
// shove the machine when it sticks, and press what drops out.

export const vending = defineReveal('vending', 1.1, revealVending);
