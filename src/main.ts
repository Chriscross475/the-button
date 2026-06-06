import { startLoop } from './engine/loop';
import { Game } from './game/game';
import { hubLevel } from './levels/hub';
import { registerAllExperiences } from './experiences';
import { getExperience, setLastExperience } from './experiences/registry';
import { showMainMenu } from './ui/main-menu';

// Boot: register experiences, start in the white room (the recurring node),
// run the loop. The world renders behind the main menu; BEGIN starts play.
const canvas = document.getElementById('scene') as HTMLCanvasElement;

registerAllExperiences();

const game = new Game(canvas);
game.registerLevel(hubLevel);
game.boot('hub');

if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;

startLoop((dt) => game.tick(dt));

// Dev-only: ?open=<experienceId> skips the menu and fires an experience
// immediately so a specific level can be iterated on directly.
const devOpen = import.meta.env.DEV ? new URLSearchParams(location.search).get('open') : null;
function jumpToLevel(id: string): void {
  const exp = getExperience(id);
  game.start(false); // test level: no opening narration
  // Don't auto-run: wire the room button to the chosen level so it only starts
  // when the player presses it themselves (like a normal start).
  if (exp) {
    game.ctx.setRoomButton(() => {
      setLastExperience(id); // so a later advance won't repeat this same level
      exp.run(game.ctx);
    });
  }
}

if (devOpen) {
  jumpToLevel(devOpen);
} else {
  showMainMenu({
    onBegin: () => game.start(),
    onSelectLevel: jumpToLevel,
  });
}
