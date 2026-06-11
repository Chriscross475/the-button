import * as THREE from 'three';
import type { GameContext, RoomOpenOpts } from '../game/types';
import type { Experience } from '../experiences/registry';
import { COLOR } from '../assets/palette';
import { currentGeneration } from '../experiences/scheduler';

// Building blocks + a scaffold for "reveal" levels — the experiences that open
// the white hub room up into a full scene (forest, slingshot, tunnel…). They
// bake in the recurring footguns so a new level is essentially just a build()
// callback. See ARCHITECTURE.md › Levels.

/** Hide the hub's white room SHELL (toppled walls + floor + floated ceiling)
 *  that openRoom() leaves behind, so its bright panels don't z-fight up through
 *  a dark ground. Shell meshes are tagged at build time (white-room.ts) — a
 *  level can add any large/bright mesh of its own without it vanishing. */
export function hideRoomShell(ctx: GameContext): void {
  ctx.scene.traverse((o) => {
    if (o.userData.isRoomShell) o.visible = false;
  });
}

export interface GroundOpts {
  color?: number;
  size?: number;
}

/** A big dark ground plane that reliably covers the hub floor (polygonOffset
 *  wins the coplanar depth test) — the standard floor for an opened-up level. */
export function groundPlane(opts?: GroundOpts): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(opts?.size ?? 260, opts?.size ?? 260),
    new THREE.MeshStandardMaterial({
      color: opts?.color ?? COLOR.gravel,
      roughness: 1,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.01;
  m.receiveShadow = true;
  return m;
}

export interface LevelDef {
  id: string;
  /** Relative likelihood of being picked at the button (default 1). */
  weight?: number;
  /** Which walls openRoom drops when revealing (default: all). */
  openRoom?: RoomOpenOpts;
  /** Build the level into ctx.levelRoot. By the time this runs the room is
   *  already opened and the white shell hidden. */
  build: (ctx: GameContext) => void;
}

/** Wrap a reveal-style level as an Experience: it opens the room, hides the white
 *  shell, guards against button-spam double-reveal, then runs build(). Register
 *  the returned experience in src/experiences/index.ts like any other.
 *
 *    export const forest = defineLevel({ id: 'forest', weight: 1.2, build(ctx) {
 *      ctx.levelRoot.add(groundPlane({ color: COLOR.gravel }));
 *      // …terrain, props, exit…
 *    }});
 */
export function defineLevel(def: LevelDef): Experience {
  return defineReveal(def.id, def.weight ?? 1, (ctx) => {
    ctx.openRoom(def.openRoom);
    hideRoomShell(ctx);
    def.build(ctx);
  });
}

/** Wrap a reveal function as a once-per-room Experience. The guard is tied to
 *  the updater-pool generation (bumped on every level load), NOT a timer: a
 *  room can only be revealed once for its whole lifetime, and a fresh room
 *  resets the guard immediately — so a quick advanceTo back into the same
 *  level can't hit a still-armed 4-second timeout and silently no-op. */
export function defineReveal(
  id: string,
  weight: number,
  reveal: (ctx: GameContext) => void,
): Experience {
  let revealedGen = -1;
  return {
    id,
    weight,
    run(ctx) {
      if (revealedGen === currentGeneration()) return; // this room is already revealed
      revealedGen = currentGeneration();
      reveal(ctx);
    },
  };
}
