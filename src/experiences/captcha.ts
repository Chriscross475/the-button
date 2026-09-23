import { defineReveal } from '../levels/scaffold';
import { revealCaptcha } from '../levels/captcha';

// The captcha: a giant "I'm not a robot" box, then picture grids. Pass them to
// move on — unless you pass them too well.

export const captcha = defineReveal('captcha', 1.1, revealCaptcha);
