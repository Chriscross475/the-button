import { defineReveal } from '../levels/scaffold';
import { revealGameShow } from '../levels/game-show';

// THE BUTTON — a quiz show about this game. Buzz first, point at your
// answer on the board, first to three wins a button. Losers also get a button.

export const gameShow = defineReveal('game-show', 1.1, revealGameShow);
