import * as THREE from 'three';
import type { GameContext } from './types';
import { createAsset } from '../assets';
import { setHandItem } from '../ui/hands';

// CARRY + COMBINE — the shared interaction framework, now DUAL-HANDED.
//
// The player has TWO hands, each shown as an arm and each able to carry its own
// item. LEFT click / left-side touch drives the LEFT hand; RIGHT click /
// right-side touch drives the RIGHT hand. Per hand: empty → grab what you look
// at; holding → tap (use, e.g. swing), hold-release (throw), or click-onto a
// target (combine recipe). A bottom-of-screen HUD labels each hand's item.
//
// Recipes are global rules: defineCombine('duck','campfire', fn).

const TAP_MS = 250;
const AIM_DIST = 1.6; // how far ahead the "click on" probe point sits
const GRAB_DIST = 3.2; // max reach to grab something you're looking at

export interface Carryable {
  kind: string;
  object: THREE.Object3D; // raycast target + the thing that gets pinned
  /** Short tap while held with no combine target (e.g. an axe swing). */
  onTap?: () => void;
  /** Hold-and-release while held with no combine (e.g. throw). charge 0..1. */
  onThrow?: (charge: number) => void;
  onGrab?: () => void;
  onRelease?: () => void;
  /** Per-frame while held: set orientation/animation. Position is handled by
   *  the framework; this is called after, with the camera quaternion + forward. */
  heldUpdate?: (dt: number, object: THREE.Object3D, camQuat: THREE.Quaternion, forward: THREE.Vector3) => void;
  heldDist?: number;
  heldDrop?: number;
  heldRight?: number;
  /** Stays in its hand across level changes (its object must live on the scene,
   *  not a level root). E.g. a cooked duck carried from the forest onward.
   *  Persistent items also stay GRABBABLE in every later level, even after being
   *  thrown down and left on the ground. */
  persistent?: boolean;
  /** Makes this a throwable PROJECTILE: releasing it (with no combine/tap) lets
   *  the engine fly it under gravity + bounce off the floor/walls in ANY level,
   *  then settle. The physics lives with the object, so a kept ball behaves the
   *  same everywhere. `speed`/`arc` tune the launch; the rest tune the flight. */
  projectile?: { radius: number; restitution?: number; gravity?: number; speed?: number; arc?: number };
  /** Re-establish this object's PER-LEVEL hooks (wander loop, combine targets)
   *  after it's CARRIED into a fresh level — the engine calls this once the new
   *  level is built, so a carried object arrives fully alive, not as a dead prop. */
  onEnterLevel?: () => void;
  /** Held, this item SHIELDS the player from an otherwise-lethal crush (a train):
   *  they get knocked clear instead of dying. `consume: true` uses the shield up
   *  (a duck — it explodes; see onCrush); `false` keeps it (a basketball just
   *  cushions and stays in hand). */
  trainShield?: { consume: boolean };
  /** Fired when a `trainShield: { consume: true }` item is used up by a crush —
   *  the object's own reaction (e.g. the duck bursts into feathers + despawns). */
  onCrush?: () => void;
}

export interface CombineTarget {
  kind: string;
  position: THREE.Vector3; // world position (live reference is fine)
  radius: number;
}

export interface CombineEnv {
  ctx: GameContext;
  carry: Carry;
  side: 'left' | 'right'; // which hand performed the combine
}

// Return true to KEEP the held item in hand (e.g. a tool breaking a block);
// otherwise it's released after the combine (e.g. a key spent in a lock).
type Recipe = (held: Carryable, target: CombineTarget, env: CombineEnv) => void | boolean;
const recipes = new Map<string, Recipe>();

/** Register a global combine rule: holding `heldKind` + clicking `targetKind`. */
export function defineCombine(heldKind: string, targetKind: string, fn: Recipe): void {
  recipes.set(heldKind + '>' + targetKind, fn);
}

export interface Carry {
  addCarryable(c: Carryable): void;
  removeCarryable(c: Carryable): void;
  addTarget(t: CombineTarget): void;
  removeTarget(t: CombineTarget): void;
  /** The item in either hand (right preferred), or null. */
  held(): Carryable | null;
  /** Fly `object` as a projectile the engine drives across levels (gravity +
   *  floor/wall/obstacle bounce, then it settles). Used for thrown keepsakes. */
  launch(object: THREE.Object3D, velocity: THREE.Vector3, opts?: { radius?: number; restitution?: number; gravity?: number; onLand?: (impactSpeed: number) => boolean; onSettle?: () => void }): void;
  /** Drive the hands each frame (called by the Game). `active` = in play. */
  tick(dt: number, active: boolean): void;
  /** Drop everything registered for the level being left, keeping the hands/arms
   *  and any PERSISTENT held items (which carry to the next level). */
  clearLevel(): void;
  /** Put an item directly into a hand (e.g. a recipe result). */
  putInHand(side: 'left' | 'right', c: Carryable): void;
  /** After a new level is built, re-install per-level hooks for items the player
   *  CARRIED in (their wander/targets were cleared on the transition). */
  enterLevel(): void;
  /** Drop EVERYTHING, including persistent items (used on death). */
  dropAll(): void;
  /** The objects currently in flight (thrown projectiles), for hit-testing
   *  against e.g. a scoring hoop. */
  looseObjects(): THREE.Object3D[];
  /** The kind held in a hand, or null. */
  inHand(side: 'left' | 'right'): string | null;
  /** True if either hand holds an item of this kind. */
  holding(kind: string): boolean;
  /** Remove one held item of this kind (its mesh + the hand). Returns true if one
   *  was consumed (e.g. a duck crushed to soften a train). */
  consume(kind: string): boolean;
  /** A crush (a train) hit the player: if a held item shields them, apply it
   *  (consume + onCrush for a duck; leave a basketball in hand) and return true.
   *  Return false → nothing shielded them (the caller should kill the player). */
  useTrainShield(): boolean;
}

type Side = 'left' | 'right';
interface Hand {
  item: Carryable | null;
  pressing: boolean;
  pressStart: number;
  arm: THREE.Object3D;
}

// ONE global instance, created once by the Game. The Game drives it via tick()
// and resets the per-level registry via clearLevel(). Levels register their
// carryables/targets through ctx (ctx.addCarryable / ctx.addTarget / …).
export function createCarry(
  ctx: GameContext,
  getObstacles: () => { x: number; z: number; radius: number }[] = () => [],
): Carry {
  const carryables: Carryable[] = [];
  const targets: CombineTarget[] = [];
  let playing = false; // true while in play (set each tick by the Game)

  // Loose projectiles — thrown items the engine flies until they settle. This
  // list (and the carry instance) outlives level changes, so a kept ball keeps
  // its physics in every level instead of freezing where a dead level's updater
  // left it. Behaviour lives with the object: each carries its own flight tuning.
  interface Loose {
    object: THREE.Object3D;
    vel: THREE.Vector3;
    radius: number;
    rest: number;
    gravity: number;
    onLand?: (impactSpeed: number) => boolean; // each ground hit; true = consumed (e.g. splat)
    onSettle?: () => void; // fired once the projectile comes to rest
  }
  const loose: Loose[] = [];
  const dropLoose = (object: THREE.Object3D) => {
    const i = loose.findIndex((l) => l.object === object);
    if (i >= 0) loose.splice(i, 1);
  };

  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const rightV = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const raycaster = new THREE.Raycaster();

  // Always-present arms (one per hand), attached to the SCENE so they persist
  // across levels; shown only when the active level actually uses the carry.
  const makeArm = (side: Side): THREE.Object3D => {
    const a = createAsset('arm');
    if (side === 'left') a.scale.x *= -1; // mirror for the off-hand
    a.visible = false;
    ctx.scene.add(a);
    return a;
  };
  const hands: Record<Side, Hand> = {
    left: { item: null, pressing: false, pressStart: 0, arm: makeArm('left') },
    right: { item: null, pressing: false, pressStart: 0, arm: makeArm('right') },
  };

  const label = (side: Side) => setHandItem(side, hands[side].item?.kind ?? null);
  const heldInAnyHand = (c: Carryable) => hands.left.item === c || hands.right.item === c;

  const pinHand = (side: Side, dt: number) => {
    const h = hands[side];
    ctx.camera.getWorldDirection(forward);
    rightV.crossVectors(forward, up).normalize();
    const cam = ctx.camera.position;
    const ro = (h.item?.heldRight ?? 0.42) * (side === 'left' ? -1 : 1);
    const d = h.item?.heldDist ?? 0.85;
    const drop = h.item?.heldDrop ?? 0.45;
    const hx = cam.x + forward.x * d + rightV.x * ro;
    const hz = cam.z + forward.z * d + rightV.z * ro;
    const yaw = Math.atan2(forward.x, forward.z) + Math.PI;
    ctx.camera.getWorldQuaternion(camQuat);
    // The arm is view-locked (forearm comes up from the screen bottom to the
    // hand) and sits a touch lower than the item it grips.
    h.arm.position.set(hx, cam.y + forward.y * d - drop - 0.12, hz);
    h.arm.quaternion.copy(camQuat);
    if (h.item) {
      h.item.object.position.set(hx, cam.y + forward.y * d - drop, hz);
      if (h.item.heldUpdate) h.item.heldUpdate(dt, h.item.object, camQuat, forward);
      else h.item.object.rotation.set(0, yaw, 0);
    }
  };

  // Advance every loose projectile one frame: gravity, then bounce off the
  // active level's floor (bounds.floorY) and side walls (bounds), then settle.
  // Uses ctx.bounds (a live getter), so it adapts to whatever level you're in.
  const stepLoose = (dt: number) => {
    if (!loose.length) return;
    const b = ctx.bounds;
    const floorY = (b.floorY ?? 0);
    for (let i = loose.length - 1; i >= 0; i--) {
      const l = loose[i];
      if (hands.left.item?.object === l.object || hands.right.item?.object === l.object) {
        loose.splice(i, 1); // grabbed back mid-flight — the hand takes over
        continue;
      }
      l.vel.y -= l.gravity * dt;
      const p = l.object.position;
      p.addScaledVector(l.vel, dt);
      if (p.x > b.maxX - l.radius) { p.x = b.maxX - l.radius; l.vel.x = -l.vel.x * l.rest; }
      else if (p.x < b.minX + l.radius) { p.x = b.minX + l.radius; l.vel.x = -l.vel.x * l.rest; }
      if (p.z > b.maxZ - l.radius) { p.z = b.maxZ - l.radius; l.vel.z = -l.vel.z * l.rest; }
      else if (p.z < b.minZ + l.radius) { p.z = b.minZ + l.radius; l.vel.z = -l.vel.z * l.rest; }
      // Bounce off the level's circular obstacles (cabin walls, posts, trees) so
      // a thrown object can't ghost through interior geometry.
      for (const o of getObstacles()) {
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const rr = o.radius + l.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const dist = Math.sqrt(d2);
          const nx = dx / dist;
          const nz = dz / dist;
          p.x = o.x + nx * rr;
          p.z = o.z + nz * rr;
          const vn = l.vel.x * nx + l.vel.z * nz;
          if (vn < 0) { l.vel.x -= (1 + l.rest) * vn * nx; l.vel.z -= (1 + l.rest) * vn * nz; }
        }
      }
      const rest = floorY + l.radius;
      if (p.y < rest) {
        p.y = rest;
        if (l.onLand && l.onLand(Math.abs(l.vel.y))) { loose.splice(i, 1); continue; } // consumed on impact (e.g. splat)
        l.vel.y = -l.vel.y * l.rest;
        l.vel.x *= 0.82;
        l.vel.z *= 0.82;
      }
      l.object.rotation.x += l.vel.z * dt * 0.4;
      l.object.rotation.z -= l.vel.x * dt * 0.4;
      if (p.y <= rest + 0.001 && Math.abs(l.vel.y) < 0.7 && Math.hypot(l.vel.x, l.vel.z) < 0.4) {
        l.vel.set(0, 0, 0);
        l.onSettle?.();
        loose.splice(i, 1); // at rest; it stays put + grabbable (still in the registry)
      }
    }
  };

  const carry: Carry = {
    addCarryable: (c) => carryables.push(c),
    removeCarryable: (c) => {
      const i = carryables.indexOf(c);
      if (i >= 0) carryables.splice(i, 1);
      for (const side of ['left', 'right'] as Side[]) {
        if (hands[side].item === c) {
          hands[side].item = null;
          label(side);
        }
      }
    },
    addTarget: (t) => targets.push(t),
    removeTarget: (t) => {
      const i = targets.indexOf(t);
      if (i >= 0) targets.splice(i, 1);
    },
    held: () => hands.right.item ?? hands.left.item,
    launch: (object, velocity, opts) => {
      dropLoose(object);
      loose.push({
        object,
        vel: velocity.clone(),
        radius: opts?.radius ?? 0.2,
        rest: opts?.restitution ?? 0.5,
        gravity: opts?.gravity ?? 16,
        onLand: opts?.onLand,
        onSettle: opts?.onSettle,
      });
    },
    tick: (dt, active) => {
      playing = active;
      // Both arms are ALWAYS shown while in play (empty hands included), not just
      // in levels that register carryables.
      hands.left.arm.visible = active;
      hands.right.arm.visible = active;
      if (!active) return;
      pinHand('left', dt);
      pinHand('right', dt);
      stepLoose(dt);
    },
    clearLevel: () => {
      // Whatever's IN your hands carries to the next level (re-parented to the
      // scene so it survives the old level root being removed). Only the level's
      // un-held ground items are dropped.
      const heldItems: Carryable[] = [];
      for (const side of ['left', 'right'] as Side[]) {
        const h = hands[side];
        if (h.item) {
          ctx.scene.add(h.item.object);
          heldItems.push(h.item);
        }
        h.pressing = false;
        h.arm.visible = false;
        label(side);
      }
      // Persistence = you CARRIED it. A persistent item still in your hand keeps
      // all its properties into the next level (stays registered → grabbable +
      // usable). Everything else — ground props, things you set down — drops with
      // the level being left.
      const kept = carryables.filter((c) => c.persistent && heldItems.includes(c));
      const keptObjs = new Set(kept.map((c) => c.object));
      for (let i = loose.length - 1; i >= 0; i--) if (!keptObjs.has(loose[i].object)) loose.splice(i, 1);
      carryables.length = 0;
      carryables.push(...kept);
      targets.length = 0;
    },
    putInHand: (side, c) => {
      hands[side].item = c;
      c.onGrab?.();
      label(side);
    },
    enterLevel: () => {
      for (const side of ['left', 'right'] as Side[]) {
        const it = hands[side].item;
        if (it?.persistent) it.onEnterLevel?.();
      }
    },
    dropAll: () => {
      loose.length = 0; // any in-flight projectile stops existing too
      for (const side of ['left', 'right'] as Side[]) {
        const h = hands[side];
        if (h.item) {
          h.item.onRelease?.();
          h.item.object.parent?.remove(h.item.object); // dying drops everything
          h.item = null;
        }
        h.pressing = false;
        h.arm.visible = false;
        label(side);
      }
    },
    looseObjects: () => loose.map((l) => l.object),
    inHand: (side) => hands[side].item?.kind ?? null,
    holding: (kind) => hands.left.item?.kind === kind || hands.right.item?.kind === kind,
    consume: (kind) => {
      for (const side of ['right', 'left'] as Side[]) {
        const h = hands[side];
        if (h.item?.kind === kind) {
          h.item.onRelease?.();
          h.item.object.parent?.remove(h.item.object);
          h.item = null;
          label(side);
          return true;
        }
      }
      return false;
    },
    useTrainShield: () => {
      for (const side of ['right', 'left'] as Side[]) {
        const it = hands[side].item;
        if (!it?.trainShield) continue;
        if (it.trainShield.consume) {
          it.onCrush?.(); // the duck bursts into feathers (its own reaction also clears the hand)
          if (hands[side].item === it) { // onCrush didn't already remove it → spend it now
            it.object.parent?.remove(it.object);
            const i = carryables.indexOf(it);
            if (i >= 0) carryables.splice(i, 1);
            hands[side].item = null;
            label(side);
          }
        }
        return true; // a basketball just cushions and stays in hand
      }
      return false;
    },
  };

  const grabNdc = new THREE.Vector2();
  // ndc: where on screen to grab from. Desktop = crosshair centre; touch = the
  // tap point, so tapping a duck (anywhere on screen) grabs THAT duck.
  const tryGrab = (side: Side, ndc: THREE.Vector2 | null = null) => {
    const h = hands[side];
    if (h.item) return;
    ctx.camera.getWorldDirection(forward);
    raycaster.setFromCamera(ndc ?? grabNdc.set(0, 0), ctx.camera);
    const grabbable = carryables.filter((c) => !heldInAnyHand(c));
    const objs = grabbable.map((c) => c.object);
    const hits = raycaster.intersectObjects(objs, true);
    let target: Carryable | null = null;
    if (hits.length && hits[0].distance <= GRAB_DIST) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !objs.includes(o)) o = o.parent;
      if (o) target = grabbable[objs.indexOf(o)];
    }
    if (!target) {
      // Fallback: grab whatever's roughly in front, in FULL 3D (so a ball/duck
      // up in the air — where you're looking UP — is easy to snatch) with a
      // forgiving reach + cone.
      const cam = ctx.camera.position;
      let best = 3.0;
      for (const c of grabbable) {
        const dx = c.object.position.x - cam.x;
        const dy = c.object.position.y - cam.y;
        const dz = c.object.position.z - cam.z;
        const dist = Math.hypot(dx, dy, dz);
        const facing = dist > 1e-3 ? (dx * forward.x + dy * forward.y + dz * forward.z) / dist : 1;
        if (dist <= best && facing > 0.6) {
          best = dist;
          target = c;
        }
      }
    }
    if (!target) return;
    h.item = target;
    dropLoose(target.object); // if it was still flying, the hand takes over
    target.onGrab?.();
    label(side);
  };

  // A combine target the player is aiming at with a matching recipe for `item`.
  const findCombo = (item: Carryable): { target: CombineTarget; recipe: Recipe } | null => {
    ctx.camera.getWorldDirection(forward);
    const ax = ctx.camera.position.x + forward.x * AIM_DIST;
    const az = ctx.camera.position.z + forward.z * AIM_DIST;
    let best: { target: CombineTarget; recipe: Recipe; d: number } | null = null;
    for (const t of targets) {
      const recipe = recipes.get(item.kind + '>' + t.kind);
      if (!recipe) continue;
      const d = Math.hypot(t.position.x - ax, t.position.z - az);
      if (d <= t.radius && (!best || d < best.d)) best = { target: t, recipe, d };
    }
    return best ? { target: best.target, recipe: best.recipe } : null;
  };

  const releaseHand = (side: Side) => {
    const h = hands[side];
    const it = h.item;
    if (it) it.onRelease?.();
    h.item = null;
    label(side);
  };

  const sideOf = (e: PointerEvent): Side => {
    if (e.pointerType === 'touch') return e.clientX < window.innerWidth / 2 ? 'left' : 'right';
    return e.button === 2 ? 'right' : 'left';
  };

  function onDown(e: PointerEvent) {
    if (!playing || ctx.isDead()) return;
    const side = sideOf(e);
    const h = hands[side];
    if (!h.item) {
      // Touch: grab from the tapped point (tap the duck itself). Mouse: crosshair.
      const ndc =
        e.pointerType === 'touch'
          ? grabNdc.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1))
          : null;
      tryGrab(side, ndc);
      h.pressing = false;
      return;
    }
    h.pressing = true;
    h.pressStart = performance.now();
  }
  function onUp(e: PointerEvent) {
    if (!playing) return;
    const side = sideOf(e);
    const h = hands[side];
    if (!h.pressing || !h.item) return;
    h.pressing = false;
    const elapsed = performance.now() - h.pressStart;
    const item = h.item;
    const combo = findCombo(item);
    if (combo) {
      const keep = combo.recipe(item, combo.target, { ctx, carry, side });
      if (keep !== true && hands[side].item === item) releaseHand(side);
      return;
    }
    // A quick tap is a press or a tool-swing, NEVER a throw. Otherwise tapping to
    // press a button (mobile, where the same touch reaches the carry system) would
    // fling a held reward — your money — out of your hand. Throwing needs a real
    // hold-and-release (elapsed >= TAP_MS).
    if (elapsed < TAP_MS) {
      if (item.onTap) item.onTap(); // e.g. an axe swing; otherwise the item just stays put
      return;
    }
    const charge = Math.min(1, elapsed / 1000);
    if (item.onThrow) {
      item.onThrow(charge);
      releaseHand(side);
      return;
    }
    // No bespoke throw, but it's a declared projectile → the engine flies it
    // (same physics in any level). Velocity = look direction × charge, + arc.
    if (item.projectile) {
      const pj = item.projectile;
      ctx.camera.getWorldDirection(forward);
      const v = forward.clone().multiplyScalar((pj.speed ?? 11) * (0.7 + 0.6 * charge));
      v.y += pj.arc ?? 1.6;
      carry.launch(item.object, v, { radius: pj.radius, restitution: pj.restitution, gravity: pj.gravity });
      releaseHand(side);
    }
  }

  if (canvas) {
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
  }

  return carry;
}
