import { defineReveal } from '../levels/scaffold';
import { revealEscapeRoom } from '../levels/escape-room';

// The escape room: padlocks, a dial lock, a UV torch, a game master on a
// walkie-talkie — and an exit door that was never locked.

export const escapeRoom = defineReveal('escape-room', 1.1, revealEscapeRoom);
