import { defineLevel } from '../levels/scaffold';
import { revealBooth } from '../levels/booth';

// The booth — the room turns into the narrator's recording booth, and you get
// his soundboard. Resolution: get the dummy through its door (or break it); the
// narrator comes back, and his door is your way out.

export const booth = defineLevel({ id: 'booth', weight: 1.2, build: revealBooth });
