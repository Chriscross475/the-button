import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { addUpdater } from '../experiences/scheduler';
import { pop } from '../audio/sfx';

// THE SPINNER — the loading spinner, pushed off the loading screen (drive the
// bar back to 0%). Held, things load faster near it: levels with waiting in
// them (queues, holds, lifts, "now serving") read spinnerSpeed(ctx) and scale
// their clocks by it. It spins while it works.

export const SPINNER_SPEED = 4;
/** How much faster waiting goes right now (×1 without the spinner in hand). */
export function spinnerSpeed(ctx: GameContext): number {
  return ctx.isHolding('spinner') ? SPINNER_SPEED : 1;
}

export function spawnSpinner(ctx: GameContext, pos: THREE.Vector3, opts: { onGrab?: () => void } = {}): Carryable {
  const g = new THREE.Group();
  const dot = new THREE.SphereGeometry(0.03, 10, 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const m = new THREE.Mesh(dot, new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.58, 0.6, 0.35 + (i / 8) * 0.5) }));
    m.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0);
    m.scale.setScalar(0.5 + (i / 8) * 0.8);
    g.add(m);
  }
  g.position.copy(pos);
  ctx.levelRoot.add(g);
  let held = false;
  // It spins (faster in hand), for as long as it exists.
  addUpdater((dt) => {
    if (!g.parent) return true;
    if (!held) g.rotation.z -= dt * 3;
    return false;
  });
  const carry: Carryable = {
    kind: 'spinner',
    object: g,
    persistent: true,
    heldDist: 0.55,
    heldDrop: 0.25,
    heldRight: 0.3,
    heldUpdate: (dt, o, q) => {
      o.quaternion.copy(q);
      o.userData.spin = ((o.userData.spin as number) ?? 0) - dt * 9;
      o.rotateZ(o.userData.spin as number);
    },
    onGrab: () => {
      held = true;
      pop();
      opts.onGrab?.();
    },
    onRelease: () => {
      held = false;
    },
    projectile: { radius: 0.14, restitution: 0.4, gravity: 16 },
  };
  ctx.addCarryable(carry);
  return carry;
}
