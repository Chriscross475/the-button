import * as THREE from 'three';
import type { GameContext, RoomOpenOpts } from '../game/types';
import type { Experience } from '../experiences/registry';
import { COLOR } from '../assets/palette';

// Building blocks + a scaffold for "reveal" levels — the experiences that open
// the white hub room up into a full scene (forest, slingshot, tunnel…). They
// bake in the recurring footguns so a new level is essentially just a build()
// callback. See ARCHITECTURE.md › Levels.

/** Hide the hub's white room SHELL (toppled walls + floor + floated ceiling)
 *  that openRoom() leaves behind, so its bright panels don't z-fight up through
 *  a dark ground. Only hides LIGHT + LARGE meshes — dark grounds/props are safe. */
export function hideRoomShell(ctx: GameContext): void {
  ctx.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const c = (m.material as THREE.MeshStandardMaterial | undefined)?.color;
    if (!c || c.r < 0.7 || c.g < 0.7 || c.b < 0.7) return; // only the white shell
    const pa = (m.geometry as THREE.BufferGeometry & {
      parameters?: { width?: number; height?: number; depth?: number };
    }).parameters || {};
    if (Math.max(pa.width || 0, pa.height || 0, pa.depth || 0) > 5) m.visible = false;
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
  let revealing = false;
  return {
    id: def.id,
    weight: def.weight ?? 1,
    run(ctx) {
      if (revealing) return; // a second button press mid-reveal must not double-build
      revealing = true;
      ctx.openRoom(def.openRoom);
      hideRoomShell(ctx);
      def.build(ctx);
      window.setTimeout(() => {
        revealing = false;
      }, 4000);
    },
  };
}
