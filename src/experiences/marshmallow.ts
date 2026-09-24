import { defineReveal } from '../levels/scaffold';
import { revealMarshmallow } from '../levels/marshmallow';

// The marshmallow test: don't press the button for ten minutes and you get two.

export const marshmallow = defineReveal('marshmallow', 1.0, revealMarshmallow);
