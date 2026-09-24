import { defineReveal } from '../levels/scaffold';
import { revealWedding } from '../levels/wedding';

// The wedding speech: the walls fall away, you're at the top table, and the DJ
// has just introduced you as the best man. You are not the best man.

export const wedding = defineReveal('wedding', 1.0, revealWedding);
