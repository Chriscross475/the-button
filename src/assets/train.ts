import * as THREE from 'three';
import { defineAsset } from './registry';

// THE TRAIN — geometry + its shared behaviour. A train flattens the player on
// contact, or, if they're clutching a duck, knocks them clear instead (the duck
// is consumed). That rule is the same everywhere a train runs — the tunnel level
// and the slingshot crossroads — so it lives HERE with the train, not copied
// into each level.

function makeTrain(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.6, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x551111, emissive: 0xaa2200, emissiveIntensity: 0.6, roughness: 0.5 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.1, 4.2), body);
  hull.position.y = 1.25;
  hull.castShadow = true;
  g.add(hull);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, 0.6), trim);
  nose.position.set(0, 1.1, 2.2);
  g.add(nose);
  const lamp = new THREE.PointLight(0xff3300, 1.4, 9, 2);
  lamp.position.set(0, 1.3, 2.6);
  g.add(lamp);
  return g;
}

defineAsset('train', makeTrain);

// The minimal slice of GameContext a strike needs (GameContext satisfies it).
interface TrainCtx {
  playerPos(): THREE.Vector3;
  isAirborne(): boolean;
  isDead(): boolean;
  isHolding(kind: string): boolean;
  consumeHeld(kind: string): boolean;
  launchPlayer(vel: THREE.Vector3): void;
  die(cause?: string): void;
}

/** If a train at `pos` is on top of the player, hit them: knock them clear with
 *  `knockback` (a duck in hand cushions it and is consumed), otherwise flatten
 *  them. Returns true if it connected, so callers can set a hit cooldown. */
export function trainStrike(ctx: TrainCtx, pos: THREE.Vector3, knockback: THREE.Vector3): boolean {
  if (ctx.isAirborne() || ctx.isDead()) return false;
  const p = ctx.playerPos();
  if (Math.abs(p.x - pos.x) >= 1.6 || Math.abs(p.z - pos.z) >= 1.9) return false;
  if (ctx.isHolding('duck')) {
    ctx.consumeHeld('duck');
    ctx.launchPlayer(knockback.clone());
  } else {
    ctx.die('train');
  }
  return true;
}
