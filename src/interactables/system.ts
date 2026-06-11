import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Interactable } from './types';

// Interactable runtime (ported from the source engine, lightly trimmed).
// Holds the live list; each frame the main loop calls tickInteractables() with
// the player position + forward direction. It computes which interactable (if
// any) is in range AND in the player's forward cone, and exposes it for the
// prompt overlay + press handler. Facing matters: you shouldn't get a PRESS
// prompt for a button behind you.

const interactables: Interactable[] = [];
let currentInRange: Interactable | null = null;

export function registerInteractable(i: Interactable): void {
  interactables.push(i);
}

export function unregisterInteractable(id: string): void {
  const idx = interactables.findIndex((i) => i.id === id);
  if (idx >= 0) interactables.splice(idx, 1);
}

/** The nearest in-range + faced interactable, or null. The prompt reads this. */
export function getInRangeInteractable(): Interactable | null {
  return currentInRange;
}

/** Read-only snapshot of the live list — used by tap-target resolution. */
export function getAllInteractables(): readonly Interactable[] {
  return interactables;
}

/**
 * Run each frame. Ticks per-interactable animation, removes destroyed ones,
 * and updates currentInRange from player position AND forward direction.
 * @param playerForward unit XZ direction the camera is looking (Y ignored).
 */
export function tickInteractables(
  dt: number,
  playerPos: THREE.Vector3,
  playerForward: THREE.Vector3,
): void {
  // Tick + reap destroyed.
  let i = 0;
  while (i < interactables.length) {
    const it = interactables[i];
    it.tick?.(dt, playerPos);
    if (it.destroyed) {
      it.onDestroy?.();
      if (it.built && !it.keepBuiltOnDestroy) {
        const parent = it.built.group.parent;
        parent?.remove(it.built.group);
      }
      interactables.splice(i, 1);
    } else {
      i++;
    }
  }

  // Forward direction projected onto XZ (Y ignored for the cone check).
  const fLen = Math.hypot(playerForward.x, playerForward.z);
  const useCone = fLen > 0.01;
  const fx = useCone ? playerForward.x / fLen : 0;
  const fz = useCone ? playerForward.z / fLen : 0;
  const dotMin = Math.cos(CONFIG.INTERACT_CONE_HALF_ANGLE);

  let nearest: Interactable | null = null;
  let nearestD = Infinity;
  let nearestUsable: Interactable | null = null;
  let nearestUsableD = Infinity;
  for (const it of interactables) {
    if (!it.promptLabel) continue; // inert
    const dx = it.position.x - playerPos.x;
    const dz = it.position.z - playerPos.z;
    const d = Math.hypot(dx, dz);
    if (d > it.radius) continue;
    if (Math.abs(it.position.y - playerPos.y) > 3.5) continue; // must be at roughly its height (no pressing an elevated button from the ground below)
    if (useCone && d > 0.01) {
      const dot = (fx * dx + fz * dz) / d;
      if (dot < dotMin) continue;
    }
    if (d < nearestD) {
      nearest = it;
      nearestD = d;
    }
    if (d < nearestUsableD && (it.canUse ? it.canUse() : true)) {
      nearestUsable = it;
      nearestUsableD = d;
    }
  }
  currentInRange = nearestUsable ?? nearest;
}

/** Fire the current in-range interactable's onUse (called by E / Space). */
export function pressUse(): void {
  if (currentInRange) currentInRange.onUse();
}

/** Reset — used on scene rebuilds. */
export function clearInteractables(): void {
  interactables.length = 0;
  currentInRange = null;
}
