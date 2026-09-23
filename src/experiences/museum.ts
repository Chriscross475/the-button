import { defineReveal } from '../levels/scaffold';
import { revealMuseum } from '../levels/museum';

// The museum — a gallery about this game. The centrepiece is THE button, do
// not touch, and a guard is watching it. Press it unseen to move on.

export const museum = defineReveal('museum', 1.1, revealMuseum);
