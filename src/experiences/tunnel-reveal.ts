import { defineReveal } from '../levels/scaffold';
import { revealTunnel } from '../levels/tunnel';

// A "path" experience (the in-place reveal model): the room opens up — pedestal
// sinks, walls topple, ceiling floats — and you're standing in the valley with
// the train tracks. Only fires while you're still inside the closed room.

export const tunnelReveal = defineReveal('tunnel', 1.3, revealTunnel);
