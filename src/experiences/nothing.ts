import type { Experience, ExperienceContext } from './registry';
import { pick } from './util';
import { blip } from '../audio/sfx';

// Sometimes you press the button and nothing happens. This is also content.
// The deadpan beat that makes the other experiences land harder.

const LINES = [
  'Nothing happened.',
  'Nothing happened. Or did it.',
  'The button does nothing. Press it again.',
  'That one was a dud. Statistically, some are.',
  'You pressed the button. The universe declined to respond.',
];

export const nothing: Experience = {
  id: 'nothing',
  weight: 1,
  run(ctx: ExperienceContext) {
    blip();
    ctx.narrate(pick(LINES));
  },
};
