import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { RoomBounds } from '../controls/player-camera';
import { spawnPedestalButton } from '../button/pedestal-button';

// The recurring node. Every level ENDS by depositing the player into one of
// these: the same clinical white box from the start, holding one pedestal +
// button. You walk (or drop) into it — pressing its button advances onward.
//
// `facing` cuts a doorway in one wall; `openTop` omits the ceiling (you land in
// from above). `center.y > 0` raises the whole house onto pillars (e.g. the
// tunnel, where the cabin sits above the tracks) — the returned bounds carry
// that floor height so walking + flight landing put you on top of it.

const RW = 8; // width (X)
const RD = 9; // depth (Z)
export const RH = 3.6; // height (exported so flight kill-walls can match it)
const T = 0.12; // wall thickness
const DOOR_W = 2.0; // doorway opening

const WALL = 0xeeeeec;
const FLOOR = 0xe6e6e2;
const CEIL = 0xf6f6f4;

export type ExitFacing = 'posZ' | 'negZ' | 'posX' | 'negX' | 'none';

export interface ExitRoomOpts {
  center: THREE.Vector3; // room centre; center.y raises it onto pillars
  facing?: ExitFacing; // which wall has the doorway you enter through
  openTop?: boolean; // omit the ceiling (e.g. you land in from a launch)
  facade?: boolean; // wrap the white box in a brown cabin shell + roof (default true)
  /** Make the SOLID walls collide (a row of obstacles along each) so the player
   *  can't walk through them — use when the room sits in open, walkable space
   *  (e.g. the forest cabin) and the doorway must be the only way in. Leave off
   *  for ELEVATED rooms (their XZ obstacles would also block the ground below). */
  solidWalls?: boolean;
}

export function buildExitRoom(ctx: GameContext, opts: ExitRoomOpts): RoomBounds {
  const root = ctx.levelRoot;
  const cx = opts.center.x;
  const cz = opts.center.z;
  const cy = opts.center.y || 0; // floor height — raises the whole house
  const facing = opts.facing ?? 'posZ';
  const hw = RW / 2;
  const hd = RD / 2;

  // Everything for the house lives in a group raised to the floor height, so a
  // single y-offset elevates the whole thing onto its pillars.
  const rg = new THREE.Group();
  rg.position.set(0, cy, 0);
  root.add(rg);

  const floorMat = new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.95 });
  const wallMat = new THREE.MeshStandardMaterial({ color: WALL, roughness: 0.9 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: CEIL, roughness: 1 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.0, cz);
  floor.receiveShadow = true;
  rg.add(floor);

  if (!opts.openTop) {
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(cx, RH, cz);
    rg.add(ceiling);
  }

  // A row of overlapping obstacles along a solid wall (opt-in) so the player
  // can't stroll through it. Stepped tight enough to leave no gap to slip past.
  const solidRowX = (z: number) => {
    for (let x = cx - hw; x <= cx + hw + 1e-3; x += 1.0) ctx.addObstacle({ x, z, radius: 0.7 });
  };
  const solidRowZ = (x: number) => {
    for (let z = cz - hd; z <= cz + hd + 1e-3; z += 1.0) ctx.addObstacle({ x, z, radius: 0.7 });
  };

  const zWall = (z: number, gap: boolean) => {
    if (!gap) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(RW, RH, T), wallMat);
      m.position.set(cx, RH / 2, z);
      m.receiveShadow = true;
      rg.add(m);
      if (opts.solidWalls) solidRowX(z);
      return;
    }
    const sideW = (RW - DOOR_W) / 2;
    const off = DOOR_W / 2 + sideW / 2;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sideW, RH, T), wallMat);
      m.position.set(cx + s * off, RH / 2, z);
      rg.add(m);
      ctx.addObstacle({ x: cx + s * off, z, radius: 1.0 });
    }
  };
  const xWall = (x: number, gap: boolean) => {
    if (!gap) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(T, RH, RD), wallMat);
      m.position.set(x, RH / 2, cz);
      m.receiveShadow = true;
      rg.add(m);
      if (opts.solidWalls) solidRowZ(x);
      return;
    }
    const sideD = (RD - DOOR_W) / 2;
    const off = DOOR_W / 2 + sideD / 2;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(T, RH, sideD), wallMat);
      m.position.set(x, RH / 2, cz + s * off);
      rg.add(m);
      ctx.addObstacle({ x, z: cz + s * off, radius: 1.0 });
    }
  };

  zWall(cz + hd, facing === 'posZ');
  zWall(cz - hd, facing === 'negZ');
  xWall(cx + hw, facing === 'posX');
  xWall(cx - hw, facing === 'negX');

  // Outer footprint (used by the facade and, when elevated, the pillars).
  const ohw = hw + 0.35;
  const ohd = hd + 0.35;

  // ── Cabin facade: a brown timber shell + pitched roof wrapping the white box. ──
  if (opts.facade !== false) {
  const logMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.95, flatShading: true });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x47301d, roughness: 1, flatShading: true });
  const OT = 0.25; // facade thickness
  const outerZ = (z: number, gap: boolean) => {
    if (!gap) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(RW + 0.7 + OT, RH, OT), logMat);
      m.position.set(cx, RH / 2, z);
      rg.add(m);
      return;
    }
    const sideW = (RW + 0.7 - DOOR_W) / 2;
    const off = DOOR_W / 2 + sideW / 2;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sideW, RH, OT), logMat);
      m.position.set(cx + s * off, RH / 2, z);
      rg.add(m);
    }
  };
  const outerX = (x: number, gap: boolean) => {
    if (!gap) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(OT, RH, RD + 0.7 + OT), logMat);
      m.position.set(x, RH / 2, cz);
      rg.add(m);
      return;
    }
    const sideD = (RD + 0.7 - DOOR_W) / 2;
    const off = DOOR_W / 2 + sideD / 2;
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(OT, RH, sideD), logMat);
      m.position.set(x, RH / 2, cz + s * off);
      rg.add(m);
    }
  };
  outerZ(cz + ohd, facing === 'posZ');
  outerZ(cz - ohd, facing === 'negZ');
  outerX(cx + ohw, facing === 'posX');
  outerX(cx - ohw, facing === 'negX');

  // Pitched gable roof (skip when open-topped, e.g. the tunnel where you land in).
  if (!opts.openTop) {
    const overhang = 0.5;
    const halfW = ohw + overhang;
    const ridgeH = 1.6;
    const slopeLen = Math.hypot(halfW, ridgeH);
    const ang = Math.atan2(ridgeH, halfW);
    const roofDepth = 2 * ohd + 2 * overhang;
    for (const s of [-1, 1]) {
      const slope = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.12, roofDepth), roofMat);
      slope.position.set(cx + (s * halfW) / 2, RH + ridgeH / 2, cz);
      slope.rotation.z = -s * ang;
      slope.castShadow = true;
      rg.add(slope);
    }
    const triShape = () => {
      const s = new THREE.Shape();
      s.moveTo(-halfW, 0);
      s.lineTo(halfW, 0);
      s.lineTo(0, ridgeH);
      s.closePath();
      return s;
    };
    const front = new THREE.Mesh(new THREE.ShapeGeometry(triShape()), logMat);
    front.position.set(cx, RH, cz + ohd + 0.01);
    rg.add(front);
    const back = new THREE.Mesh(new THREE.ShapeGeometry(triShape()), logMat);
    back.position.set(cx, RH, cz - ohd - 0.01);
    back.rotation.y = Math.PI;
    rg.add(back);
  }
  } // end facade

  // Pillars holding the house up when it's elevated.
  if (cy > 0.1) {
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 1, flatShading: true });
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const px = cx + sx * (ohw - 0.2);
        const pz = cz + sz * (ohd - 0.2);
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, cy, 8), pillarMat);
        pillar.position.set(px, cy / 2, pz);
        pillar.castShadow = true;
        root.add(pillar);
        ctx.addObstacle({ x: px, z: pz, radius: 0.5 });
      }
    }
  }

  // Bright lights so it glows as the welcoming "light at the end".
  const hemi = new THREE.HemisphereLight(0xffffff, 0xdedede, 0.85);
  hemi.position.set(cx, RH, cz);
  rg.add(hemi);
  rg.add(new THREE.AmbientLight(0xffffff, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.55);
  sun.position.set(cx + 2, RH + 2, cz + 3);
  sun.target.position.set(cx, 0, cz);
  rg.add(sun, sun.target);

  // The button — press it to advance to the next room.
  const button = spawnPedestalButton(
    rg,
    new THREE.Vector3(cx, 0, cz),
    () => ctx.advance(new THREE.Vector3(cx, 0, cz)), // becomes the next start room, in place
    { glow: false }, // matte — no shine on the end button
  );
  ctx.addObstacle(button.obstacle);

  return { minX: cx - hw, maxX: cx + hw, minZ: cz - hd, maxZ: cz + hd, floorY: cy };
}
