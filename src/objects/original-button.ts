import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { click, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';

// THE BUTTON (2026) — the museum's centrepiece, swapped for a replica and taken.
// The rarest thing in the game: press it (a quick click) in ANY room and that
// room counts as done — you move on, as if you'd found its exit. Once. Then
// it's spent. makeMiniButton() is its model (and the gift shop's replica's).

const PRESSED = vo('The original. Pressed. The room gives up and lets you go. It will never work again. Nothing that good ever does.');

/** A little pedestal button: a dark base and a red dome. */
export function makeMiniButton(dome = 0xe0271c): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 18), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.4 }));
  base.position.y = 0.025;
  g.add(base);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: dome, roughness: 0.3 }));
  cap.name = 'dome';
  cap.position.y = 0.05;
  g.add(cap);
  return g;
}

/** Put THE BUTTON (2026) into your hand (or the level, at `pos`). */
export function spawnOriginalButton(ctx: GameContext, pos: THREE.Vector3): Carryable {
  const g = makeMiniButton();
  g.position.copy(pos);
  ctx.levelRoot.add(g);
  let used = false;
  const carry: Carryable = {
    kind: 'original-button',
    object: g,
    persistent: true,
    heldDist: 0.5,
    heldDrop: 0.26,
    heldUpdate: (_dt, o) => o.rotation.set(0.5, 0, 0), // dome up, toward you
    onTap: () => {
      if (used) return;
      used = true;
      click();
      sparkle();
      const dome = g.getObjectByName('dome');
      if (dome) dome.position.y = 0.03;
      discover('reward:original-pressed');
      ctx.narrate(PRESSED, 6000, { priority: true });
      const at = ctx.playerPos().clone().setY(0);
      ctx.after(500, () => {
        ctx.removeCarryable(carry);
        g.parent?.remove(g);
      });
      ctx.after(1400, () => ctx.advance(at));
    },
  };
  ctx.addCarryable(carry);
  return carry;
}
