import * as THREE from 'three';
import { CONFIG } from '../config';
import type { InputState } from './input-types';

// First-person camera + walking, written fresh for the white room. Reads the
// shared InputState (filled by the touch/desktop schemes), applies yaw/pitch
// look, and moves the body with two collision passes:
//   1. Clamp inside the rectangular room bounds (minus the player radius).
//   2. Slide around circular obstacles (the pedestals), axis-decomposed so
//      you graze along a pedestal instead of sticking to it.
// No external level/physics dependency — bounds + obstacles are plain data.

export interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Floor height of this region (default 0). Lets a region sit ABOVE another
   *  (e.g. a room on pillars over the ground) — walking + flight landing use it. */
  floorY?: number;
  /** Jump levels only: the platform is solid this far below its floor (default:
   *  all the way down). Below that you walk (or jump) underneath it. */
  thick?: number;
}

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

let yaw = 0;
let pitch = 0;

export function createCamera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(
    CONFIG.FOV,
    window.innerWidth / window.innerHeight,
    0.05,
    CONFIG.CAMERA_FAR,
  );
}

export function setYaw(y: number): void {
  yaw = y;
}

export function getYaw(): number {
  return yaw;
}

export function getPitch(): number {
  return pitch;
}

export function setPitch(p: number): void {
  pitch = p;
}

// Eye height while walking: null = standing (CONFIG.PLAYER_HEIGHT). A level can
// lower it (sitting on a chair) — the walker, and so the hands, follow it. The
// Game resets it on every level load.
let eyeHeight: number | null = null;
export function setEyeHeight(h: number | null): void {
  eyeHeight = h;
}

// Jumping (opt-in per level; the Game resets it on every level load). While on,
// walking has real vertical physics: a jump, gravity, falling off edges, landing
// on whatever is below. Off (the default), height snaps to the floor as always.
export interface JumpOpts {
  /** Take-off speed, m/s (apex = speed² / 2g). */
  speed: number;
  /** m/s² (default 20). */
  gravity?: number;
  /** Highest ledge you can walk straight up onto (default 0.35 m). */
  step?: number;
  /** Cap on falling speed, m/s (e.g. drifting down under a spinner). */
  maxFall?: number;
}
let jump: JumpOpts | null = null;
let vy = 0;
let grounded = true;
// Forgiveness: a jump still works a moment after running off an edge (coyote),
// and a press a moment before landing jumps on touchdown (buffer).
const COYOTE = 0.12;
const BUFFER = 0.12;
let coyote = 0;
let buffered = 0;
export function setJump(opts: JumpOpts | null): void {
  // Turning it on or off starts you standing; changing the settings mid-air
  // (e.g. a fall cap) keeps the jump you're in.
  if (!jump || !opts) {
    vy = 0;
    grounded = true;
    coyote = 0;
    buffered = 0;
  }
  jump = opts;
}
export function isJumpEnabled(): boolean {
  return jump !== null;
}
/** Jump levels: on the ground (not mid-jump / mid-fall). */
export function isGrounded(): boolean {
  return grounded;
}

// The unicycle: hands-free movement that's faster but carries momentum (slides).
let wheel = false;
let wvx = 0;
let wvz = 0;
export function setWheel(on: boolean): void {
  wheel = on;
  if (!on) {
    wvx = 0;
    wvz = 0;
  }
}

/** Unit XZ direction the camera is looking (Y dropped) — for the interact cone. */
export function getForwardXZ(out = new THREE.Vector3()): THREE.Vector3 {
  out.set(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(-1);
  return out;
}

/** Apply look (yaw/pitch) from input and consume the deltas. Shared by normal
 *  walking and the airborne (launched) state, where you steer by looking. */
export function updateLook(camera: THREE.PerspectiveCamera, input: InputState): void {
  const sens = CONFIG.LOOK_SENSITIVITY;
  yaw -= input.lookDx * sens;
  pitch -= input.lookDy * sens;
  pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
  input.lookDx = 0;
  input.lookDy = 0;
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

// Movement is constrained to the UNION of one or more walkable rectangles
// (regions) so a wide room can connect to a narrower/taller corridor without a
// single bounding box. Adjacent regions must OVERLAP (≥ 2·playerRadius) so you
// can cross the seam between them.
export function updatePlayer(
  camera: THREE.PerspectiveCamera,
  input: InputState,
  dt: number,
  regions: readonly RoomBounds[],
  obstacles: readonly Obstacle[],
): void {
  updateLook(camera, input);
  const wantJump = input.jump === true;
  input.jump = false; // edge-triggered: consumed (or dropped) every walking frame
  if (jump) {
    walkWithJump(camera, input, dt, regions, obstacles, jump, wantJump);
    return;
  }

  // --- Move ---
  if (wheel) {
    // Unicycle: accelerate toward input, cap speed, decay slowly (slide), then
    // move with the same axis-decomposed collision (hitting a wall kills that
    // axis's momentum).
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));
    const want = new THREE.Vector3()
      .addScaledVector(forward, -input.moveY)
      .addScaledVector(right, input.moveX);
    if (want.lengthSq() > 0) {
      want.normalize();
      const accel = CONFIG.MOVE_SPEED * 5;
      wvx += want.x * accel * dt;
      wvz += want.z * accel * dt;
    }
    const maxSp = CONFIG.MOVE_SPEED * 1.85;
    const sp = Math.hypot(wvx, wvz);
    if (sp > maxSp) {
      wvx = (wvx / sp) * maxSp;
      wvz = (wvz / sp) * maxSp;
    }
    const fr = Math.pow(0.16, dt); // momentum: glides for ~half a second
    wvx *= fr;
    wvz *= fr;
    const r = CONFIG.PLAYER_RADIUS;
    let cx = camera.position.x;
    let cz = camera.position.z;
    const free = (x: number, z: number) => inAnyRegion(x, z, regions, r) && !blocked(cx, cz, x, z, obstacles, r);
    const tx = cx + wvx * dt;
    if (free(tx, cz)) cx = tx;
    else wvx = 0;
    const tz = cz + wvz * dt;
    if (free(cx, tz)) cz = tz;
    else wvz = 0;
    camera.position.x = cx;
    camera.position.z = cz;
    const fyw = floorYAt(camera.position.x, camera.position.z, camera.position.y, regions);
    camera.position.y = (fyw ?? 0) + (eyeHeight ?? CONFIG.PLAYER_HEIGHT);
    return;
  }
  if (input.moveX !== 0 || input.moveY !== 0) {
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));
    const move = new THREE.Vector3()
      .addScaledVector(forward, -input.moveY)
      .addScaledVector(right, input.moveX);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(CONFIG.MOVE_SPEED * dt);
      const fromX = camera.position.x;
      const fromZ = camera.position.z;
      const r = CONFIG.PLAYER_RADIUS;
      // Axis-decomposed slide against both region walls and obstacles.
      let cx = fromX;
      let cz = fromZ;
      const free = (x: number, z: number) =>
        inAnyRegion(x, z, regions, r) && !blocked(cx, cz, x, z, obstacles, r);
      const tx = fromX + move.x;
      if (free(tx, cz)) cx = tx;
      const tz = fromZ + move.z;
      if (free(cx, tz)) cz = tz;

      camera.position.x = cx;
      camera.position.z = cz;
    }
  }

  const fy = floorYAt(camera.position.x, camera.position.z, camera.position.y, regions);
  camera.position.y = (fy ?? 0) + (eyeHeight ?? CONFIG.PLAYER_HEIGHT);
}

// Walking with vertical physics (jump levels). Height is the FOOT height; a
// platform whose floor is more than `step` above your feet — and whose solid part
// reaches down past your head's level — is a wall; one you're above is a floor.
function walkWithJump(
  camera: THREE.PerspectiveCamera,
  input: InputState,
  dt: number,
  regions: readonly RoomBounds[],
  obstacles: readonly Obstacle[],
  opts: JumpOpts,
  wantJump: boolean,
): void {
  const eye = eyeHeight ?? CONFIG.PLAYER_HEIGHT;
  const g = opts.gravity ?? 20;
  const step = opts.step ?? 0.35;
  let foot = camera.position.y - eye;
  const r = CONFIG.PLAYER_RADIUS;
  // A platform side is in the way at (x,z) for feet at `foot`.
  const wall = (x: number, z: number) => {
    for (const b of regions) {
      const f = b.floorY ?? 0;
      if (f <= foot + step) continue; // a floor you can step onto (or are above)
      if (f - (b.thick ?? Infinity) >= foot + eye + 0.1) continue; // overhead: walk under it
      if (x >= b.minX - r && x <= b.maxX + r && z >= b.minZ - r && z <= b.maxZ + r) return true;
    }
    return false;
  };
  if (input.moveX !== 0 || input.moveY !== 0) {
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, yaw, 0));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, yaw, 0));
    const move = new THREE.Vector3().addScaledVector(forward, -input.moveY).addScaledVector(right, input.moveX);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(CONFIG.MOVE_SPEED * dt);
      let cx = camera.position.x;
      let cz = camera.position.z;
      const free = (x: number, z: number) =>
        inAnyRegion(x, z, regions, r) && !blocked(cx, cz, x, z, obstacles, r) && !wall(x, z);
      if (free(cx + move.x, cz)) cx += move.x;
      if (free(cx, cz + move.z)) cz += move.z;
      camera.position.x = cx;
      camera.position.z = cz;
    }
  }
  const x = camera.position.x;
  const z = camera.position.z;
  // The highest floor under you at or below `limit`.
  const floorUnder = (limit: number) => {
    let best: number | null = null;
    for (const b of regions) {
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      const f = b.floorY ?? 0;
      if (f <= limit && (best === null || f > best)) best = f;
    }
    return best;
  };
  if (wantJump) buffered = BUFFER;
  else buffered = Math.max(0, buffered - dt);
  if (grounded) {
    const f = floorUnder(foot + step);
    if (f !== null && f >= foot - 0.05) {
      foot = f; // level ground, or a step up
      coyote = COYOTE;
    } else {
      grounded = false; // walked off an edge
      vy = 0;
    }
  } else coyote = Math.max(0, coyote - dt);
  if (buffered > 0 && (grounded || coyote > 0)) {
    grounded = false;
    vy = opts.speed;
    coyote = 0;
    buffered = 0;
  }
  if (!grounded) {
    vy -= g * dt;
    if (opts.maxFall !== undefined && vy < -opts.maxFall) vy = -opts.maxFall;
    const next = foot + vy * dt;
    // Land on the highest floor under you up to a step above your feet (so you
    // catch a ledge lip mid-jump rather than sink into it) once you reach it.
    const f = floorUnder(foot + step);
    if (f !== null && next <= f) {
      foot = f;
      vy = 0;
      grounded = true;
    } else foot = next;
    if (foot < -50) {
      // Fell out of the world entirely: back onto the lowest floor here.
      foot = floorUnder(Infinity) ?? 0;
      vy = 0;
      grounded = true;
    }
  }
  camera.position.y = foot + eye;
}

/** The floor the player would stand/land on at (x,z): the HIGHEST region floor
 *  at or below their current height y. Returns null if (x,z) is over no region
 *  (a void). Used by both walking (height) and flight (landing vs falling). */
export function floorYAt(
  x: number,
  z: number,
  y: number,
  regions: readonly RoomBounds[],
): number | null {
  let best: number | null = null;
  for (const b of regions) {
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) {
      const f = b.floorY ?? 0;
      if (f <= y + 0.6 && (best === null || f > best)) best = f;
    }
  }
  return best;
}

function inAnyRegion(x: number, z: number, regions: readonly RoomBounds[], r: number): boolean {
  if (regions.length === 0) return true; // unconstrained
  for (const b of regions) {
    if (x >= b.minX + r && x <= b.maxX - r && z >= b.minZ + r && z <= b.maxZ - r) return true;
  }
  return false;
}

// A step from (fx,fz) to (x,z) is blocked if it ends inside an obstacle — unless
// you were ALREADY inside that one (something spawned or moved onto you) and the
// step doesn't take you deeper. So a player overlapping a solid can always walk
// out of it, and nothing placed on top of you is a permanent trap.
function blocked(fx: number, fz: number, x: number, z: number, obstacles: readonly Obstacle[], playerRadius: number): boolean {
  for (const o of obstacles) {
    const min = playerRadius + o.radius;
    const dNew = Math.hypot(x - o.x, z - o.z);
    if (dNew >= min) continue;
    const dOld = Math.hypot(fx - o.x, fz - o.z);
    if (dOld < min && dNew >= dOld - 1e-6) continue;
    return true;
  }
  return false;
}

