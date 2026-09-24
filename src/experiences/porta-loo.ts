import { defineReveal } from '../levels/scaffold';
import { revealPortaLoo } from '../levels/porta-loo';

// The porta-loo: a festival toilet on day four. The only button is the flush,
// and it does not flush.

export const portaLoo = defineReveal('porta-loo', 1.0, revealPortaLoo);
