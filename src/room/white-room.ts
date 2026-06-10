import * as THREE from 'three';
import { CONFIG } from '../config';
import type { RoomBounds } from '../controls/player-camera';
import type { WallDir } from '../game/types';
import { addUpdater } from '../experiences/scheduler';

// The empty white room — the constant. It's present at the start of every
// level. A clean, clinical "liminal space" box. For "open" experiences it
// doesn't get left behind: openWhiteRoom() topples its walls outward and floats
// the ceiling away, revealing the environment that was around you all along.

interface WallHandle {
  mesh: THREE.Mesh;
  axis: 'x' | 'z'; // which world axis it topples about
  sign: number; // direction of the topple
  dir: WallDir; // which side of the room
}

export interface BuiltRoom {
  group: THREE.Group;
  bounds: RoomBounds;
  walls: WallHandle[];
  ceiling: THREE.Mesh;
  lights: THREE.Light[];
}

const WALL = 0xeeeeec;
const FLOOR = 0xe6e6e2;
const CEIL = 0xf6f6f4;

export function buildWhiteRoom(scene: THREE.Scene, parent: THREE.Object3D): BuiltRoom {
  const { width: w, depth: d, height: h } = CONFIG.ROOM;
  const group = new THREE.Group();

  const bg = new THREE.Color(0xf4f4f2);
  scene.background = bg;
  scene.fog = new THREE.Fog(bg.getHex(), 9, 34);

  const floorMat = new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.95, metalness: 0 });
  const wallMat = new THREE.MeshStandardMaterial({ color: WALL, roughness: 0.9, metalness: 0 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: CEIL, roughness: 1, metalness: 0 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.userData.isRoomShell = true; // hideRoomShell() hides by this tag
  group.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = h;
  ceiling.userData.isRoomShell = true;
  group.add(ceiling);

  // Walls (thin boxes). Each records how it should topple outward.
  const t = 0.12;
  const walls: WallHandle[] = [];
  const mkWall = (sx: number, sy: number, sz: number, x: number, z: number, axis: 'x' | 'z', sign: number, dir: WallDir) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMat);
    m.position.set(x, h / 2, z);
    m.receiveShadow = true;
    m.userData.isRoomShell = true;
    group.add(m);
    walls.push({ mesh: m, axis, sign, dir });
  };
  mkWall(w, h, t, 0, -d / 2, 'x', -1, 'back'); // −Z (the wall you face at spawn)
  mkWall(w, h, t, 0, d / 2, 'x', 1, 'front'); // +Z
  mkWall(t, h, d, -w / 2, 0, 'z', 1, 'left'); // −X
  mkWall(t, h, d, w / 2, 0, 'z', -1, 'right'); // +X

  // ── Lighting: bright, soft. ──
  const hemi = new THREE.HemisphereLight(0xffffff, 0xdedede, 0.85);
  group.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);
  group.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(3, h + 2, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 30;
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = -w;
  cam.right = w;
  cam.top = d;
  cam.bottom = -d;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0008;
  group.add(sun);
  group.add(sun.target);

  parent.add(group);

  const bounds: RoomBounds = { minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 };
  return { group, bounds, walls, ceiling, lights: [hemi, ambient, sun] };
}

export interface OpenOpts {
  /** Topple walls: true = all, false = none, or a list of sides. Default true. */
  walls?: boolean | WallDir[];
  /** Float the ceiling up + fade (default true). */
  ceiling?: boolean;
  /** Dim the bright room lights (default = whether any wall opens). */
  dimLights?: boolean;
  onDone?: () => void;
}

// The reveal. Each wall tips outward about its base; the ceiling rises and
// fades; the bright room lights dim so a darker environment can take over.
// Pass opts to open only part of the room (e.g. ceiling-only for an in-room
// level where the walls stay up).
export function openWhiteRoom(room: BuiltRoom, opts: OpenOpts = {}): void {
  const wallsOpt = opts.walls ?? true;
  const opensWall = (dir: WallDir) =>
    wallsOpt === true ? true : Array.isArray(wallsOpt) ? wallsOpt.includes(dir) : false;
  const anyWall = wallsOpt === true || (Array.isArray(wallsOpt) && wallsOpt.length > 0);
  const doCeiling = opts.ceiling ?? true;
  const dimLights = opts.dimLights ?? anyWall;
  const onDone = opts.onDone;
  const h = CONFIG.ROOM.height;

  for (const w of room.walls) {
    if (!opensWall(w.dir)) continue;
    const mesh = w.mesh;
    const parentGroup = mesh.parent;
    if (!parentGroup) continue;
    // Reparent the wall into a pivot at its base so it tips about the floor.
    const pivot = new THREE.Group();
    pivot.position.set(mesh.position.x, 0, mesh.position.z);
    parentGroup.add(pivot);
    mesh.position.set(0, h / 2, 0);
    pivot.add(mesh);
    const targetAngle = w.sign * (Math.PI / 2);
    let t = 0;
    const dur = 1.5 + Math.random() * 0.4;
    addUpdater((dt) => {
      t += dt;
      const k = Math.min(1, t / dur);
      const e = 1 - Math.pow(1 - k, 3);
      if (w.axis === 'x') pivot.rotation.x = targetAngle * e;
      else pivot.rotation.z = targetAngle * e;
      return k >= 1;
    });
  }

  // Ceiling floats up and fades.
  if (doCeiling) {
    const ceil = room.ceiling;
    const mat = ceil.material as THREE.MeshStandardMaterial;
    mat.transparent = true;
    const startY = ceil.position.y;
    let tc = 0;
    const durC = 1.9;
    let doneFired = false;
    addUpdater((dt) => {
      tc += dt;
      const k = Math.min(1, tc / durC);
      const e = 1 - Math.pow(1 - k, 3);
      ceil.position.y = startY + e * 20;
      mat.opacity = 1 - e;
      if (k >= 1 && !doneFired) {
        doneFired = true;
        ceil.visible = false;
        onDone?.();
        return true;
      }
      return k >= 1;
    });
  } else {
    onDone?.();
  }

  // Dim the bright room lighting as it opens.
  if (dimLights) {
    const startIntensity = room.lights.map((l) => l.intensity);
    let tl = 0;
    const durL = 1.6;
    addUpdater((dt) => {
      tl += dt;
      const k = Math.min(1, tl / durL);
      room.lights.forEach((l, i) => {
        l.intensity = startIntensity[i] * (1 - 0.8 * k); // fade to 20%
      });
      return k >= 1;
    });
  }
}
