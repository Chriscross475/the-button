import { defineReveal } from '../levels/scaffold';
import { revealTutorial } from '../levels/tutorial';

// The tutorial: a cheerful card teaches you what you already know, on a loop.
// Obey it and it starts again; press the button it told you not to and you're out.

export const tutorial = defineReveal('tutorial', 1.1, revealTutorial);
