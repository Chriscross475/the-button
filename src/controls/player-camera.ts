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
    const free = (x: number, z: number) => inAnyRegion(x, z, regions, r) && !collides(x, z, obstacles, r);
    let cx = camera.position.x;
    let cz = camera.position.z;
    const tx = cx + wvx * dt;
    if (free(tx, cz)) cx = tx;
    else wvx = 0;
    const tz = cz + wvz * dt;
    if (free(cx, tz)) cz = tz;
    else wvz = 0;
    camera.position.x = cx;
    camera.position.z = cz;
    const fyw = floorYAt(camera.position.x, camera.position.z, camera.position.y, regions);
    camera.position.y = (fyw ?? 0) + CONFIG.PLAYER_HEIGHT;
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
      const free = (x: number, z: number) =>
        inAnyRegion(x, z, regions, r) && !collides(x, z, obstacles, r);

      // Axis-decomposed slide against both region walls and obstacles.
      let cx = fromX;
      let cz = fromZ;
      const tx = fromX + move.x;
      if (free(tx, cz)) cx = tx;
      const tz = fromZ + move.z;
      if (free(cx, tz)) cz = tz;

      camera.position.x = cx;
      camera.position.z = cz;
    }
  }

  const fy = floorYAt(camera.position.x, camera.position.z, camera.position.y, regions);
  camera.position.y = (fy ?? 0) + CONFIG.PLAYER_HEIGHT;
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

function collides(x: number, z: number, obstacles: readonly Obstacle[], playerRadius: number): boolean {
  for (const o of obstacles) {
    const dx = x - o.x;
    const dz = z - o.z;
    const min = playerRadius + o.radius;
    if (dx * dx + dz * dz < min * min) return true;
  }
  return false;
}
