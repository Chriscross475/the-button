import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { createAsset } from '../assets';
import { spawnFeathers } from '../assets/effects';
import { discover } from '../graph/progress';
import { thud } from '../audio/sfx';

// THE baby wolf you win in the duck room. It follows you — and it is still a
// wolf. Near a loose duck (in ANY level), it eats it and grows a little; after
// TEN ducks it is the size of its mother, out of ducks, and turns on you. The
// behaviour lives on the wolf via a per-frame companion tick the Game drives, so
// it keeps eating wherever you take it — exactly the "behaviour on the object"
// rule. It uses the duck tags (userData.kind/.carryable) the duck sets on itself.

const BABY = 0.4; // starting scale (a pup)
const MOTHER = 1.0; // full grown
const TO_DOOM = 10; // ducks until it's mother-sized and comes for you
const EAT_RANGE = 2.7; // metres
const EAT_COOLDOWN = 0.55; // seconds between bites (so you SEE it happen)

export function spawnBabyWolf(ctx: GameContext, pos: THREE.Vector3): void {
  const pup = createAsset('wolf');
  pup.scale.setScalar(BABY);
  pup.position.set(pos.x, 0.95, pos.z); // perched on the plinth until you approach
  let fed = 0;
  let cool = 0;
  let doomed = false;

  // Driven every frame by the Game's companion update (persists across levels).
  pup.userData.companionTick = (dt: number) => {
    if (doomed) return;
    cool -= dt;
    if (cool > 0) return;
    // nearest duck in the world near the wolf (ducks tag themselves)
    const wp = pup.position;
    let best: THREE.Object3D | null = null;
    let bestD = EAT_RANGE * EAT_RANGE;
    for (const o of ctx.levelRoot.children) {
      if ((o.userData as { kind?: string }).kind !== 'duck') continue;
      const dx = o.position.x - wp.x, dz = o.position.z - wp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = o; }
    }
    if (!best) return;

    // Chomp: feathers, deregister it from carry, remove the mesh, grow.
    cool = EAT_COOLDOWN;
    spawnFeathers(ctx.levelRoot, best.position.clone());
    thud();
    const carryable = (best.userData as { carryable?: unknown }).carryable;
    if (carryable) ctx.removeCarryable(carryable as never);
    best.parent?.remove(best);
    fed++;
    pup.scale.setScalar(BABY + (MOTHER - BABY) * Math.min(1, fed / TO_DOOM));

    if (fed === 1) ctx.narrate('Oh — it eats ducks. Of course it eats ducks.', 4000, { interruptible: true });
    else if (fed === TO_DOOM - 3) ctx.narrate('It is getting big. It is also still hungry. These facts are related.', 4500, { interruptible: true });

    if (fed >= TO_DOOM) {
      doomed = true;
      ctx.narrate(
        'Ten ducks. It is the size of its mother now, and it has run out of ducks. You are not a duck — but you fed it every one, and it has decided that is close enough. It used you exactly like you used them.',
        9000,
        { priority: true },
      );
      ctx.scene.remove(pup); // it leaves nothing behind to follow
      ctx.die('wolf');
    }
  };

  ctx.setCompanion(pup); // follows you AND survives level transitions
  discover('reward:baby-wolf');
}
