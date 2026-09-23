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
import { doorsCorridor } from './doors';
import { basketball } from './basketball';
import { circus } from './circus';
import { booth } from './booth';
import { desert } from './desert';
import { elevator } from './elevator';
import { museum } from './museum';
import { waitingRoom } from './waiting-room';
import { tutorial } from './tutorial';
import { loadingScreen } from './loading-screen';
import { evilTwin } from './evil-twin';
import { customerSupport } from './customer-support';
import { terms } from './terms';
import { captcha } from './captcha';
import { queue } from './queue';
import { giftShop } from './gift-shop';
import { lostFound } from './lost-found';

export function registerAllExperiences(): void {
  // Levels (entered via the in-place reveal, each with its own resolution).
  registerExperience(duckLevel);
  registerExperience(forest);
  registerExperience(doorsCorridor);
  registerExperience(basketball);
  registerExperience(circus);
  registerExperience(booth);
  registerExperience(desert);
  registerExperience(elevator);
  registerExperience(museum);
  registerExperience(waitingRoom);
  registerExperience(tutorial);
  registerExperience(loadingScreen);
  registerExperience(evilTwin);
  registerExperience(customerSupport);
  registerExperience(terms);
  registerExperience(captcha);
  registerExperience(queue);
  registerExperience(giftShop);
  registerExperience(lostFound);
  // In-room gags (trivial resolution — they just happen; press again).
  registerExperience(anotherButton);
  registerExperience(statue);
  registerExperience(confetti);
  registerExperience(colorFlash);
  registerExperience(nothing);
}
