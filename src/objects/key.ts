import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { createAsset } from '../assets';

// THE COLOURED KEYS — found in different levels, each opening only the lock of
// its own colour (wherever that lock is). A key is a persistent carryable: pick
// it up and it comes with you into the next rooms, until you spend it. Its kind
// is `key-<colour>`; a lock is a combine target the level defines with
// defineCombine(keyKind(colour), '<its lock kind>', …).
//
//   blue — the corridor of doors (behind you at the start); opens its last door.
//   red  — the desert (behind the exit cabin); opens grandma's cottage
//   yellow — the lift's hidden floor 13; opens the museum's STAFF ONLY door
//          in the forest.

export type KeyColor = 'red' | 'blue' | 'yellow';
export const KEY_COLORS: Record<KeyColor, number> = { red: 0xd23a2a, blue: 0x2f6fd6, yellow: 0xe8c21e };
export const keyKind = (c: KeyColor) => `key-${c}`;

/** Put a coloured key into the level at `pos`. */
export function spawnKey(
  ctx: GameContext,
  color: KeyColor,
  pos: THREE.Vector3,
  opts: { onGrab?: () => void; rotation?: THREE.Euler } = {},
): Carryable {
  const object = createAsset('key', { color: KEY_COLORS[color] });
  object.position.copy(pos);
  if (opts.rotation) object.rotation.copy(opts.rotation);
  ctx.levelRoot.add(object);
  const carry: Carryable = {
    kind: keyKind(color),
    object,
    heldDist: 0.6,
    heldDrop: 0.28,
    persistent: true, // it comes along, room to room, until you use it
    onGrab: opts.onGrab,
  };
  ctx.addCarryable(carry);
  return carry;
}

/** A lock plate in a key's colour: a coloured ring round a dark keyhole. Faces
 *  +Z; the caller positions and turns it. */
export function buildLock(color: KeyColor): THREE.Group {
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.7 }));
  g.add(plate);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.022, 8, 20), new THREE.MeshStandardMaterial({ color: KEY_COLORS[color], roughness: 0.4, metalness: 0.5 }));
  ring.position.set(0, 0.04, 0.03);
  g.add(ring);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.035, 12), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
  hole.position.set(0, 0.04, 0.031);
  g.add(hole);
  const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.025, 0.07), hole.material);
  slot.position.set(0, -0.01, 0.031);
  g.add(slot);
  return g;
}
