import * as THREE from 'three';
import { CONFIG } from '../config';
import { buildWhiteRoom, openWhiteRoom } from '../room/white-room';
import { spawnPedestalButton, sinkPedestalButton } from '../button/pedestal-button';
import { pickExperience } from '../experiences/registry';
import type { Level, LevelInstance, GameContext } from '../game/types';
import type { Obstacle } from '../controls/player-camera';

// The white room — the constant. Present at the start of every run. One button
// whose press runs a random experience. "Open" experiences don't teleport you
// away: they transform THIS room in place (walls topple, ceiling floats) via
// ctx.openRoom(), revealing the environment around you.

export const hubLevel: Level = {
  id: 'hub',
  build(ctx: GameContext): LevelInstance {
    const root = new THREE.Group();
    const room = buildWhiteRoom(ctx.scene, root);
    const obstacles: Obstacle[] = [];

    // The button's action is mutable so an experience can REPURPOSE the button
    // (e.g. the duck level turns it into the dispenser) instead of sinking it.
    let buttonAction = () => {
      const e = pickExperience();
      if (e) e.run(ctx);
    };

    const first = spawnPedestalButton(root, new THREE.Vector3(0, 0, -2), () => buttonAction());
    obstacles.push(first.obstacle);

    return {
      root,
      bounds: room.bounds,
      obstacles,
      spawn: { pos: new THREE.Vector3(0, CONFIG.PLAYER_HEIGHT, 4), yaw: 0 },
      defaultButtonPress: () => buttonAction(),
      setButtonAction: (fn) => {
        buttonAction = fn;
      },
      sinkButton: () => {
        sinkPedestalButton(first);
        ctx.removeObstacle(first.obstacle);
      },
      openRoom: (opts) => {
        if (!opts?.keepButton) {
          sinkPedestalButton(first);
          ctx.removeObstacle(first.obstacle); // the sunk button must stop colliding
        }
        openWhiteRoom(room, opts);
      },
    };
  },
};
