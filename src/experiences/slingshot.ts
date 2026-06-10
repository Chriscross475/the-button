import { defineReveal } from '../levels/scaffold';
import { revealSlingshot } from '../levels/slingshot';

// The slingshot yard — a full level (the trains' origin), entered via the
// in-place reveal. Also reachable by walking up a tunnel in the tunnel level.

export const slingshot = defineReveal('slingshot', 1.1, revealSlingshot);
