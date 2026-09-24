import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';

// A COIN — small change, for machines (vending, the wishing fountain, the
// snack machine…). One kind, 'coin', everywhere; persistent, so change found in
// one room can be spent in another. (The MONEY pile — src/objects/money.ts — is
// the other currency: your cut, for people: bribes and purchases.)
export function spawnCoin(ctx: GameContext, pos: THREE.Vector3, opts: { onGrab?: () => void } = {}): Carryable {
  const coin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.01, 20),
    new THREE.MeshStandardMaterial({ color: 0xe0b83a, roughness: 0.3, metalness: 0.9 }),
  );
  coin.position.copy(pos);
  coin.castShadow = true;
  ctx.levelRoot.add(coin);
  const carry: Carryable = {
    kind: 'coin',
    object: coin,
    persistent: true,
    heldDist: 0.45,
    heldDrop: 0.22,
    heldUpdate: (_dt, o, q) => o.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)), // face-on
    projectile: { radius: 0.05, restitution: 0.3, gravity: 16 },
    onGrab: opts.onGrab,
  };
  ctx.addCarryable(carry);
  return carry;
}
