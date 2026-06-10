import { defineReveal } from '../levels/scaffold';
import { revealDoors } from '../levels/doors-corridor';

// The corridor-of-doors path. The room opens into a long hall of uniquely
// opening doors.

export const doorsCorridor = defineReveal('doors', 1.1, revealDoors);
