import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Interactable } from '../interactables/types';

// Tap-target resolver (ported, enemy support removed). Players reach for what
// they see — a click/tap on the button should press it even if the cone check
// is borderline. Two passes: (1) a precise raycast against the interactable's
// mesh group; (2) if that misses, a screen-space proximity fallback within
// INTERACT_TAP_PROXIMITY_PX of the tap. The caller still gates on range.

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmpVec = new THREE.Vector3();

export function findTapTarget(
  clientX: number,
  clientY: number,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  interactables: readonly Interactable[],
): Interactable | null {
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);

  const roots: Array<{ root: THREE.Object3D; it: Interactable }> = [];
  for (const it of interactables) {
    if (it.destroyed || !it.promptLabel || !it.built?.group) continue;
    roots.push({ root: it.built.group, it });
  }
  if (roots.length === 0) return null;

  const hits = raycaster.intersectObjects(roots.map((r) => r.root), true);
  if (hits.length > 0) {
    const hitObj = hits[0].object;
    for (const r of roots) {
      if (isDescendantOrSelf(hitObj, r.root)) return r.it;
    }
  }

  // Screen-space proximity fallback.
  const tapPxX = clientX - rect.left;
  const tapPxY = clientY - rect.top;
  let best: Interactable | null = null;
  let bestDist2 = CONFIG.INTERACT_TAP_PROXIMITY_PX * CONFIG.INTERACT_TAP_PROXIMITY_PX;
  for (const r of roots) {
    tmpVec.copy(r.it.position);
    tmpVec.y += r.it.labelOffsetY ?? 0.6;
    tmpVec.project(camera);
    if (tmpVec.z > 1 || tmpVec.z < -1) continue;
    const sx = (tmpVec.x * 0.5 + 0.5) * rect.width;
    const sy = (-tmpVec.y * 0.5 + 0.5) * rect.height;
    const dx = sx - tapPxX;
    const dy = sy - tapPxY;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = r.it;
    }
  }
  return best;
}

function isDescendantOrSelf(obj: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}
