import type { Experience, ExperienceContext } from './registry';
import { addUpdater } from './scheduler';
import { pick } from './util';
import { tone } from '../audio/sfx';
import { vo } from '../audio/vo-shared';

// Hold music. Nine seconds of synthesised bossa nova muzak, then the narrator
// reads the hold message. Updater-driven, so leaving the room stops it.

const HOLD = vo('Your press is important to us. Please continue to hold.');
const QUEUE = vo([
  'You have been moved up the queue. You are now number. Four hundred.',
  'Thank you for holding. An operator will be with you. Eventually.',
  'Did you know you can also press the button online. You cannot. But did you know.',
]);

const BEAT = 0.3; // seconds per eighth
const BARS = 4; // chord changes, 8 eighths each, looped
const LENGTH = 9;
// Maj7-ish chords (Hz) and a walking bass under each.
const CHORDS = [
  [261.6, 329.6, 392.0, 493.9], // Cmaj7
  [220.0, 261.6, 329.6, 392.0], // Am7
  [293.7, 349.2, 440.0, 523.3], // Dm7
  [196.0, 246.9, 293.7, 349.2], // G7
];
const BASS = [
  [65.4, 82.4, 98.0, 110.0],
  [55.0, 65.4, 82.4, 98.0],
  [73.4, 87.3, 110.0, 98.0],
  [49.0, 61.7, 73.4, 61.7],
];
// Bossa comping: which eighths of the bar the chord is struck on.
const COMP = [0, 3, 5];

export const elevatorMusic: Experience = {
  id: 'elevator-music',
  weight: 0.8,
  run(ctx: ExperienceContext) {
    let t = 0;
    let next = 0; // next eighth to play
    addUpdater((dt) => {
      t += dt;
      while (next * BEAT <= t && next * BEAT < LENGTH) {
        const bar = Math.floor(next / 8) % BARS;
        const e = next % 8;
        if (COMP.includes(e)) {
          for (const f of CHORDS[bar]) tone({ type: 'triangle', from: f, dur: BEAT * 1.6, gain: 0.025, attack: 0.02 });
        }
        if (e % 2 === 0) tone({ type: 'sine', from: BASS[bar][e / 2], dur: BEAT * 1.8, gain: 0.09, attack: 0.01 });
        // A lazy vibraphone melody on the off-beats.
        if (e === 6) tone({ type: 'sine', from: CHORDS[bar][3] * 2, dur: BEAT * 2.2, gain: 0.03, attack: 0.01 });
        next++;
      }
      return t >= LENGTH;
    });
    ctx.after(LENGTH * 1000 - 1500, () => {
      ctx.narrate(HOLD, 4000);
      ctx.narrate(pick(QUEUE), 4000);
    });
  },
};
