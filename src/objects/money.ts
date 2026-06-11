import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { createAsset } from '../assets';
import { pop } from '../audio/sfx';

// THE money — a banded stack of cash. One object: grab it, carry it onward (it
// persists in hand into the next level), or throw it (it tumbles + bounces off
// walls/obstacles like anything physical, via the shared projectile system).
// Used wherever a level pays out — spawn it with spawnMoney(ctx, pos).
export function spawnMoney(ctx: GameContext, pos: THREE.Vector3): void {
  const cash = createAsset('money');
  cash.position.copy(pos);
  ctx.levelRoot.add(cash);
  ctx.addCarryable({
    kind: 'money',
    object: cash,
    persistent: true, // your cut — it comes with you
    heldDist: 0.55,
    heldDrop: 0.32,
    onGrab: () => pop(),
    // No bespoke throw: declaring `projectile` lets the engine fly it (gravity +
    // bounce off floor/walls/obstacles, then it settles) — same as everywhere.
    projectile: { radius: 0.3, restitution: 0.35, gravity: 16 },
  });
}
