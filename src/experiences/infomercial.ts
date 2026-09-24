import { defineReveal } from '../levels/scaffold';
import { revealInfomercial } from '../levels/infomercial';

// The infomercial: a screaming shopping-channel host sells you THE BUTTON, and
// every press is "but wait, there's more" — until the studio is on fire.

export const infomercial = defineReveal('infomercial', 1.0, revealInfomercial);
