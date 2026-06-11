import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { type Carryable } from '../game/combine';
import { createAsset } from '../assets';
import { whoosh, pop, thud } from '../audio/sfx';
import { addUpdater } from '../experiences/scheduler';

// THE axe — ONE object, the same wherever it goes. It starts embedded in a
// stump; grab it, TAP to swing, HOLD to throw (it tumbles end-over-end and
// plants blade-first in the ground, then you can grab it again). Carried in hand
// it persists into the next level, where holding it + clicking a fence / plank /
// wood-block / duck fires the global axe combines (defined with those targets).
//
// What a SWING hits is the level's business — the forest fells a tree + smashes
// the cabin door — so the axe just reports the swing point via onSwing; it never
// hard-codes a level's reaction.

const SWING_DUR = 0.35;
const REACH = 1.8; // how far ahead of the player a swing connects
const THROW_BASE = 9;
const THROW_CHARGE = 9;
const THROW_UP = 2.5;
const GRAVITY = 14;
const GROUND_Y = 0.2;

export interface AxeOpts {
  /** Fired when a swing connects, at the world point (ax,az) just ahead of the
   *  player. The level reacts (fell a tree, smash a door); the axe stays generic. */
  onSwing?: (ax: number, az: number) => void;
}

/** Spawn the axe embedded in a stump at `stumpPos`. */
export function spawnAxe(ctx: GameContext, stumpPos: THREE.Vector3, opts: AxeOpts = {}): void {
  // The axe-in-trunk composition: orient its front (+Z) at the player, then
  // detach the axe to the level root so it can be carried in world space.
  const comp = createAsset('axe-in-trunk');
  const player = ctx.playerPos();
  comp.position.copy(stumpPos);
  comp.rotation.y = Math.atan2(player.x - stumpPos.x, player.z - stumpPos.z);
  ctx.levelRoot.add(comp);
  comp.updateWorldMatrix(true, true);
  const axeGroup = comp.getObjectByName('axe') as THREE.Group;
  ctx.levelRoot.attach(axeGroup); // keep its embedded world pose, parent to root
  ctx.addObstacle({ x: stumpPos.x, z: stumpPos.z, radius: 0.45 });

  let swinging = false;
  let swingT = 0;
  // Held pose: the axe stands UP (head at top), blade facing forward. (Model is
  // authored handle=+Y, blade=+X; Ry(90°) turns the blade forward.) A small
  // forward lean angles the edge down; the swing arcs it further.
  const heldGrip = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));
  const REST_LEAN = 0.5;
  const fwd = new THREE.Vector3();

  const doSwing = () => {
    if (swinging) return;
    swinging = true;
    swingT = 0;
    whoosh();
    ctx.camera.getWorldDirection(fwd);
    const ax = ctx.camera.position.x + fwd.x * REACH;
    const az = ctx.camera.position.z + fwd.z * REACH;
    // The chop connects at the peak of the arc — report it then.
    ctx.after(SWING_DUR * 500, () => opts.onSwing?.(ax, az));
  };

  const axe: Carryable = {
    kind: 'axe',
    object: axeGroup,
    persistent: true, // a tool you keep — carry it from level to level
    heldDist: 0.7,
    heldRight: 0.5,
    heldDrop: 0.4,
    onGrab: () => {
      whoosh();
      pop();
    },
    onTap: doSwing,
    heldUpdate: (dt, obj, camQuat) => {
      const q = camQuat.clone().multiply(heldGrip);
      let lean = REST_LEAN; // edge angled down at rest
      if (swinging) {
        swingT += dt;
        lean += Math.sin(Math.min(1, swingT / SWING_DUR) * Math.PI) * 1.9; // chop arc
        if (swingT >= SWING_DUR) swinging = false;
      }
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, -lean));
      obj.quaternion.copy(q);
    },
    onThrow: (charge) => {
      ctx.camera.getWorldDirection(fwd);
      const speed = THROW_BASE + charge * THROW_CHARGE;
      const v = fwd.clone().multiplyScalar(speed).add(new THREE.Vector3(0, THROW_UP, 0));
      // Throw frame: blade (+X) leads, the axe tumbles end-over-end in the
      // vertical plane of the throw (spin axis = horizontal, ⟂ to forward).
      const f = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      const r = new THREE.Vector3(f.z, 0, -f.x); // spin axis
      const negR = r.clone().negate();
      const up = new THREE.Vector3(0, 1, 0);
      const base = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, up, negR));
      // Resting pose: head/blade dives forward INTO the ground, handle up-back.
      const downFwd = new THREE.Vector3(f.x, -1.6, f.z).normalize();
      const stuckX = new THREE.Vector3().crossVectors(downFwd, negR).normalize();
      const stuck = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(stuckX, downFwd, negR));
      let spin = 0;
      whoosh();
      // Re-grabbable after it lands: out of the registry while flying, back on land.
      ctx.removeCarryable(axe);
      addUpdater((dt) => {
        v.y -= GRAVITY * dt;
        axeGroup.position.addScaledVector(v, dt);
        spin += dt * 13; // tumble forward, blade leading
        axeGroup.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(r, spin).multiply(base));
        if (axeGroup.position.y <= GROUND_Y) {
          axeGroup.position.y = GROUND_Y;
          axeGroup.quaternion.copy(stuck); // hacked into the ground, blade forward
          thud();
          ctx.addCarryable(axe); // grab + throw again
          return true;
        }
        return false;
      });
    },
  };
  ctx.addCarryable(axe);
}
