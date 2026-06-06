import * as THREE from 'three';
import type { Experience, ExperienceContext } from './registry';
import { addUpdater } from './scheduler';
import { pick, freeRoomPos } from './util';
import { thud } from '../audio/sfx';
import { createAsset } from '../assets';

// A blocky humanoid statue drops from above, lands with a thud, and stays —
// silently judging the room.

const LINES = [
  'A statue of you. It looks disappointed.',
  'Behold: art.',
  'Someone left this here. It was probably you.',
  'It will watch you now. Forever. No pressure.',
];

export const statue: Experience = {
  id: 'statue',
  weight: 1,
  run(ctx: ExperienceContext) {
    ctx.narrate(pick(LINES));
    const p = freeRoomPos(ctx.bounds, ctx.playerPos(), 1.0, 1.8);
    const fig = createAsset('statue');
    fig.position.set(p.x, 3.2, p.z);
    fig.rotation.y = Math.atan2(ctx.playerPos().x - p.x, ctx.playerPos().z - p.z); // face the player
    ctx.scene.add(fig);
    ctx.addObstacle({ x: p.x, z: p.z, radius: 0.45 });

    let vy = 0;
    let landed = false;
    addUpdater((dt) => {
      if (landed) return true;
      vy -= 12 * dt;
      fig.position.y += vy * dt;
      if (fig.position.y <= 0) {
        fig.position.y = 0;
        landed = true;
        thud();
        return true;
      }
      return false;
    });
  },
};
