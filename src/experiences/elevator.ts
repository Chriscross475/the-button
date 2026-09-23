import { defineReveal } from '../levels/scaffold';
import { revealElevator } from '../levels/elevator';

// The elevator — the white room was a lift all along. Forty floors, each a
// little diorama; the way out is pressing every button (a floor that isn't on
// the panel opens onto the exit).

export const elevator = defineReveal('elevator', 1.1, revealElevator);
