import { defineReveal } from '../levels/scaffold';
import { revealQueue } from '../levels/queue';

// The queue for the button: a velvet-rope switchback full of people, each
// pressing THE button in turn. Wait your turn — or cut, and be stared at.

export const queue = defineReveal('queue', 1.1, revealQueue);
