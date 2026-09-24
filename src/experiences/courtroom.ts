import { defineReveal } from '../levels/scaffold';
import { revealCourtroom } from '../levels/courtroom';

// The courtroom: you stand accused of pressing the button. Plead, object, or
// present whatever you carried in as evidence.

export const courtroom = defineReveal('courtroom', 1.0, revealCourtroom);
