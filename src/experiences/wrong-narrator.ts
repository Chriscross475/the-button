import type { Experience, ExperienceContext } from './registry';
import { pick } from './util';
import { vo } from '../audio/vo-shared';

// The narrator starts reading a line from a completely different game, gets cut
// off by himself mid-sentence, realises, apologises, and carries on.

const WRONG = vo([
  'Previously, on Kitchen Quest. The soufflé has fallen, and Chef Marco must now face the judges with nothing but a whisk and his regrets.',
  'The ancient dragon Vorgath stirs beneath the Mountain of Ash. Only the chosen one, wielding the Blade of Seven Winters, can.',
  'Lap three. Rain on the track. The rookie is closing on the leader, and if he takes the hairpin at this speed.',
  'She looks up from her coffee and smiles at you. Choose your reply carefully. Option one. I have always loved the rain.',
  'The detective lights another cigarette. The butler, he says, did not do it. The butler, he says, was the victim all along.',
]);
const REALISE = vo([
  'Hang on. This is not my script.',
  'Wait. Wait. That is not this game.',
  'Hm. No. Wrong page.',
]);
const CARRY_ON = vo([
  'Sorry. Different game. You pressed a button. Well done.',
  'Apologies. Where were we. Ah. The button. You pressed it. Riveting.',
  'Sorry about that. I do a lot of these. Carry on.',
]);

export const wrongNarrator: Experience = {
  id: 'wrong-narrator',
  weight: 0.8,
  run(ctx: ExperienceContext) {
    ctx.narrate(pick(WRONG), 6000, { priority: true });
    // Cut off mid-sentence: a priority line interrupts the speech.
    ctx.after(3600, () => {
      ctx.narrate(pick(REALISE), 2600, { priority: true });
      ctx.narrate(pick(CARRY_ON), 4000);
    });
  },
};
