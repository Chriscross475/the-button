import { defineReveal } from '../levels/scaffold';
import { revealFamilyDinner } from '../levels/family-dinner';

// Family dinner: a 1950s dining room, a family who are so pleased you came, and
// an empty chair with a place card that says YOU. Dessert is your favourite.

export const familyDinner = defineReveal('family-dinner', 1.0, revealFamilyDinner);
