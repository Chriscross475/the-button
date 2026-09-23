import { defineReveal } from '../levels/scaffold';
import { revealEvilTwin } from '../levels/evil-twin';

// The button's evil twin: two identical buttons and a narrator who says which
// to press. When he says "Trust me", he's lying. Three right in a row → out.

export const evilTwin = defineReveal('evil-twin', 1.1, revealEvilTwin);
