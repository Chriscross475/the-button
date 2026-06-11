import { defineReveal } from '../levels/scaffold';
import { revealDucks } from '../levels/duck-room';

// The duck room is now a full (in-room) level: ceiling opens, ducks rain, a
// dispenser button makes more. Resolution: reach the duck quota.

export const duckLevel = defineReveal('ducks', 1.2, revealDucks);
