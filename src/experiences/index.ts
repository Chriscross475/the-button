// Registers every experience. Import this once at boot. To add a new
// experience: write a file exporting an Experience, import it here, and add a
// registerExperience() line. Nothing else in the engine changes.

import { registerExperience } from './registry';
import { duckLevel } from './duck';
import { forest } from './forest';
import { anotherButton } from './another-button';
import { statue } from './statue';
import { confetti } from './confetti';
import { colorFlash } from './color-flash';
import { nothing } from './nothing';
import { tunnelReveal } from './tunnel-reveal';
import { doorsCorridor } from './doors';
import { slingshot } from './slingshot';
import { basketball } from './basketball';
import { circus } from './circus';

export function registerAllExperiences(): void {
  // Levels (entered via the in-place reveal, each with its own resolution).
  registerExperience(duckLevel);
  registerExperience(forest);
  registerExperience(tunnelReveal);
  registerExperience(doorsCorridor);
  registerExperience(slingshot);
  registerExperience(basketball);
  registerExperience(circus);
  // In-room gags (trivial resolution — they just happen; press again).
  registerExperience(anotherButton);
  registerExperience(statue);
  registerExperience(confetti);
  registerExperience(colorFlash);
  registerExperience(nothing);
}
