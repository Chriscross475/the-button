import { defineReveal } from '../levels/scaffold';
import { revealWaitingRoom } from '../levels/waiting-room';

// The waiting room: take a number (948). Number two is asleep and the whole
// queue waits on him. Take his ticket, bribe the clerk, start a duck riot — or
// wait, and watch the clerk give up and race the numbers to yours.

export const waitingRoom = defineReveal('waiting-room', 1.1, revealWaitingRoom);
