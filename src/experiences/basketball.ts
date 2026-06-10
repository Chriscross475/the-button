import { defineReveal } from '../levels/scaffold';
import { revealBasketball } from '../levels/basketball';

// A 30-second basketball minigame, entered via the in-place reveal (the room
// stays enclosed so the ball bounces off the walls).

export const basketball = defineReveal('basketball', 1.1, revealBasketball);
