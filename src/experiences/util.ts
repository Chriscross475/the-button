import * as THREE from 'three';
import type { RoomBounds } from '../controls/player-camera';

export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

/** A floor position inside the room (y=0), kept `margin` off the walls and at
 *  least `minPlayerDist` from the player so things don't spawn on their face. */
export function freeRoomPos(
  bounds: RoomBounds,
  player: THREE.Vector3,
  margin = 1.0,
  minPlayerDist = 1.8,
): THREE.Vector3 {
  for (let i = 0; i < 24; i++) {
    const x = rand(bounds.minX + margin, bounds.maxX - margin);
    const z = rand(bounds.minZ + margin, bounds.maxZ - margin);
    if (Math.hypot(x - player.x, z - player.z) >= minPlayerDist) {
      return new THREE.Vector3(x, 0, z);
    }
  }
  return new THREE.Vector3(0, 0, 0);
}
