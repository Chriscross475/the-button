import { defineReveal } from '../levels/scaffold';
import { revealBasketball } from '../levels/basketball';

// Hoops: the room opens onto a gym. Pick an opponent (THE WALL or THE FLEA)
// and outscore him before the clock runs out.

export const basketball = defineReveal('basketball', 1.1, revealBasketball);
