import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { defineCombine, type Carryable, type CombineTarget } from '../game/combine';
import { createAsset } from '../assets';
import { spawnFeathers } from '../assets/effects';
import { addUpdater } from '../experiences/scheduler';
import { quack, thud, pop } from '../audio/sfx';
import { vo } from '../audio/vo-shared';

// THE duck — ONE self-contained object, identical in every level. It wanders,
// you grab it, throw it (engine projectile physics: bounces off walls + the
// level's obstacles, and SPLATS into feathers if it lands hard from a height),
// cook it on a campfire, or axe it into feathers. Spawn it anywhere with
// spawnDuck(); the behaviour lives HERE, never in the level. Carried in hand it
// persists into the next level with all of this intact.

export const DUCK_R = 0.2;
const HARD_IMPACT = 9; // land harder than this from the air → it splats
const THROW_SPEED = 8;
const THROW_UP = 3;
const GRAVITY = 11;

// The narrator's take on a duck that came down too hard — a duck property, so it
// plays wherever a duck splats (these are the same lines the duck room bakes).
const SPLAT_LINES = vo([
  'Too high. Gravity finishes what you started.',
  'It went up. It came down. It did not get up.',
  'A long way up, a short way to the floor.',
]);

export interface Duck {
  object: THREE.Group;
  held: boolean;
  flying: boolean;
  alive: boolean;
}

export interface DuckOpts {
  /** Hook a thrown duck's ground impact — the duck ROOM uses this for its saw /
   *  farm / wolf / stand outcomes. Return true if the duck was consumed there.
   *  With no hook (or it returns false) the duck splats into feathers on a hard
   *  landing and otherwise just settles and goes back to wandering. */
  onLand?: (duck: Duck, impactSpeed: number) => boolean;
}

// ── A duck's own combine reactions: global, so they hold wherever a duck is. ──

// Axe a duck → feathers. The per-duck removal is wired to its 'duck' target.
const chop = new WeakMap<CombineTarget, () => void>();
defineCombine('axe', 'duck', (_held, target) => {
  chop.get(target)?.();
  return true; // keep the axe
});

// Duck + campfire → a roast duck on a skewer, kept in the OTHER hand (persists).
defineCombine('duck', 'campfire', (held, _t, env) => {
  env.carry.removeCarryable(held);
  held.object.parent?.remove(held.object);
  pop();
  thud();
  const cooked = createAsset('cooked-duck');
  env.ctx.scene.add(cooked);
  env.carry.putInHand(env.side, {
    kind: 'cooked-duck',
    object: cooked,
    persistent: true,
    heldDist: 0.7,
    heldDrop: 0.3,
    // Throwable like anything else, so it can leave the hand (a tap-combine onto a
    // stand still works; a plain release tosses it).
    projectile: { radius: 0.22, restitution: 0.4, gravity: 14 },
  });
  env.ctx.narrate('A whole roast duck, on a skewer, made by your own hand. Keep it. You will want it later.', 5500, {
    priority: true,
  });
});

/** Spawn one duck into the current level. Returns its live state. */
export function spawnDuck(ctx: GameContext, x: number, z: number, opts: DuckOpts = {}): Duck {
  const object = createAsset('duck') as THREE.Group;
  object.position.set(x, DUCK_R, z);
  object.rotation.y = Math.random() * Math.PI * 2;
  ctx.levelRoot.add(object);
  const duck: Duck = { object, held: false, flying: false, alive: true };

  // Wander/throw state — shared by the wander loop AND the throw's settle.
  let heading = Math.random() * 6;
  let waddle = Math.random() * 6;
  let bx = x;
  let bz = z;
  let target: CombineTarget | null = null;

  const die = () => {
    if (!duck.alive) return;
    duck.alive = false;
    spawnFeathers(ctx.levelRoot, object.position.clone());
    ctx.removeCarryable(carry);
    if (target) { ctx.removeTarget(target); chop.delete(target); }
    object.parent?.remove(object);
  };

  // The duck's PER-LEVEL hooks: a wander loop + an axe-target. Installed at spawn
  // and RE-installed whenever the duck is carried into a fresh level (its old
  // hooks were cleared on the transition) — so a carried duck keeps wandering and
  // stays axe-able wherever it ends up. This is what "keeps all properties" means.
  const installHooks = () => {
    addUpdater(() => {
      if (!object.parent || !duck.alive) return true;
      if (duck.held || duck.flying) return false;
      const dt = 1 / 60;
      if (Math.random() < 0.4 * dt) heading = Math.random() * Math.PI * 2;
      let dy = heading - object.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      object.rotation.y += dy * Math.min(1, dt * 3);
      const fx = Math.cos(object.rotation.y);
      const fz = -Math.sin(object.rotation.y);
      let nx = object.position.x + fx * 0.6 * dt;
      let nz = object.position.z + fz * 0.6 * dt;
      if (Math.abs(nx - bx) > 7) { heading = Math.PI - heading; nx = object.position.x; }
      if (Math.abs(nz - bz) > 7) { heading = -heading; nz = object.position.z; }
      object.position.x = nx;
      object.position.z = nz;
      waddle += dt * 7;
      object.rotation.z = Math.sin(waddle) * 0.22;
      object.position.y = DUCK_R + Math.abs(Math.cos(waddle)) * 0.03;
      return false;
    });
    target = { kind: 'duck', position: object.position, radius: 1.1 };
    ctx.addTarget(target);
    chop.set(target, die);
  };

  const carry: Carryable = {
    kind: 'duck',
    object,
    persistent: true, // carried in hand, it comes to the next level with everything
    onEnterLevel: installHooks, // re-establish wander + axe-target in the new level
    heldDist: 0.9,
    onGrab: () => { duck.held = true; quack(); },
    onRelease: () => { duck.held = false; },
    heldUpdate: (_dt, o, _q, f) => o.rotation.set(0, Math.atan2(f.x, f.z) + Math.PI, 0),
    onThrow: () => {
      duck.held = false;
      duck.flying = true;
      const fwd = new THREE.Vector3();
      ctx.camera.getWorldDirection(fwd);
      const v = fwd.multiplyScalar(THROW_SPEED).add(new THREE.Vector3(0, THROW_UP, 0));
      quack();
      ctx.launchProjectile(object, v, {
        radius: DUCK_R,
        restitution: 0.5,
        gravity: GRAVITY,
        onLand: (impact) => {
          if (opts.onLand && opts.onLand(duck, impact)) return true; // level-specific outcome
          if (impact > HARD_IMPACT) {
            // came down too hard → the narrator's eulogy, then feathers
            ctx.narrate(SPLAT_LINES[Math.floor(Math.random() * SPLAT_LINES.length)], 4500, { priority: true });
            die();
            return true;
          }
          return false;
        },
        onSettle: () => {
          duck.flying = false;
          bx = object.position.x;
          bz = object.position.z;
          object.rotation.set(0, object.rotation.y, 0);
          thud();
        },
      });
    },
  };
  ctx.addCarryable(carry);
  installHooks(); // wander + axe-target for the level it's spawned in

  return duck;
}
