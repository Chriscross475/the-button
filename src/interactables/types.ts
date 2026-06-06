import type * as THREE from 'three';

export type EntityId = string;

// An interactable is anything the player can walk up to, face, and "press" —
// here, a red button on a pedestal. Position + radius gate the prompt; onUse
// fires when the player presses while in range and looking at it.
//
// Simplified from the source engine: `built` is just an Object3D group (no
// ModelSpec / BuiltModel pipeline) so this stays dependency-free.

export interface Interactable {
  /** Stable id. */
  id: EntityId;
  /** World position of the interactable's pivot. */
  position: THREE.Vector3;
  /** Player must be within this XZ distance to interact. */
  radius: number;
  /** Short verb shown on the prompt: 'PRESS'. Empty string = inert (no prompt,
   *  won't claim the press) — set while an experience is mid-run if desired. */
  promptLabel: string;
  /** Called when the player presses USE while in range and facing it. */
  onUse: () => void;
  /** Optional eligibility gate. Omitted = always usable. */
  canUse?: () => boolean;
  /** Optional per-frame hook (press-spring animation, glow pulse, etc.). */
  tick?: (dt: number, playerPos: THREE.Vector3) => void;
  /** Set true to remove from the system on the next tick. */
  destroyed?: boolean;
  /** Live mesh group, auto-removed on destroy unless keepBuiltOnDestroy. */
  built?: { group: THREE.Object3D };
  /** Cleanup hook, fired before built.group is removed. */
  onDestroy?: () => void;
  /** If true, don't auto-remove built.group on destroy. */
  keepBuiltOnDestroy?: boolean;
  /** Vertical offset (m) above position.y for the floating label. Default 0.6. */
  labelOffsetY?: number;
}
