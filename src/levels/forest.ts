import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { buildExitRoom } from './exit-room';
import { addUpdater } from '../experiences/scheduler';
import { pop, thud } from '../audio/sfx';
import { createAsset } from '../assets';
import { spawnDuck } from '../objects/duck';
import { spawnAxe } from '../objects/axe';
import { walkThroughPortal, crackedWall } from './scaffold';

// A LEVEL — the forest. The walls topple and you're on a wide outdoor plain
// dotted with trees, under a bright sky. Resolution: find the clearing with the
// next button (it's out there somewhere) and reach it. An axe is embedded in a
// stump near spawn — grab it; TAP = swing (fells the nearest tree, leaving a
// campfire), HOLD = throw (lands, re-grabbable). The whole area is enclosed by
// four big painted-backdrop walls for a horizon.

const HALF = 38;
const EXIT = new THREE.Vector3(-24, 0, -30); // cabin: far + off to the side, so you look around

const CHOP_REACH = 2.6; // how near a swing must land to a tree to fell it

interface Tree {
  group: THREE.Object3D;
  x: number;
  z: number;
  felled: boolean;
}

// (The duck and ALL its behaviour — wander, throw physics, splat, axe→feathers,
//  cook on a campfire — live in src/objects/duck.ts. The forest just spawns a
//  few; they behave exactly as ducks behave everywhere.)

// A painted forest backdrop drawn onto a canvas: blue sky gradient, a few soft
// white clouds, and a row of overlapping dark-green flat tree silhouettes along
// the bottom third. Used on the four enclosing horizon walls.
function forestBackdropTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;

  // Sky: vertical gradient, lighter toward the horizon.
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#5fa8e0');
  sky.addColorStop(0.6, '#9ec9e8');
  sky.addColorStop(1, '#cfe7f4');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // A few soft white clouds.
  g.fillStyle = 'rgba(255,255,255,0.85)';
  const cloud = (cx: number, cy: number, s: number) => {
    g.beginPath();
    g.ellipse(cx, cy, 70 * s, 28 * s, 0, 0, Math.PI * 2);
    g.ellipse(cx - 55 * s, cy + 8 * s, 45 * s, 20 * s, 0, 0, Math.PI * 2);
    g.ellipse(cx + 55 * s, cy + 8 * s, 50 * s, 22 * s, 0, 0, Math.PI * 2);
    g.fill();
  };
  cloud(180, 90, 1);
  cloud(520, 60, 0.8);
  cloud(820, 120, 1.1);

  // A row of overlapping flat tree silhouettes along the bottom.
  const baseY = H * 0.6;
  // Solid forest-floor below the canopy line — so NO light sky shows through as
  // pale stripes; the trunks read as brown against it.
  const floorGrad = g.createLinearGradient(0, baseY - 20, 0, H);
  floorGrad.addColorStop(0, '#2f5a2a');
  floorGrad.addColorStop(1, '#16320f');
  g.fillStyle = floorGrad;
  g.fillRect(0, baseY - 20, W, H - (baseY - 20));

  const shade = ['#1c4a1f', '#235a26', '#1a4420'];
  let i = 0;
  for (let x = -20; x < W + 40; x += 36) {
    const th = 130 + ((i * 53) % 90); // pseudo-random tree height
    const tw = 44 + ((i * 31) % 30);
    // Brown trunk (drawn under the canopy, down to the floor).
    g.fillStyle = i % 2 ? '#5a3a1e' : '#4a2f18';
    g.fillRect(x - 7, baseY, 14, H - baseY);
    // Conifer canopy (green), two tiers.
    g.fillStyle = shade[i % shade.length];
    g.beginPath();
    g.moveTo(x, baseY - th);
    g.lineTo(x - tw, baseY + 12);
    g.lineTo(x + tw, baseY + 12);
    g.closePath();
    g.fill();
    g.beginPath();
    g.moveTo(x, baseY - th * 0.55);
    g.lineTo(x - tw * 1.25, baseY + 32);
    g.lineTo(x + tw * 1.25, baseY + 32);
    g.closePath();
    g.fill();
    i++;
  }

  return new THREE.CanvasTexture(canvas);
}

export function revealForest(ctx: GameContext): void {
  const root = ctx.levelRoot;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 8, HALF * 2 + 8),
    new THREE.MeshStandardMaterial({ color: 0x3e7a3a, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  root.add(ground);

  // Bright daytime lights (the white-room lights dim during the reveal).
  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3a6a30, 1.0);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff4e0, 0.7);
  sun.position.set(12, 24, 8);
  root.add(sun);

  const bark = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2f7d33, roughness: 0.85 });

  // Track every tree so the axe can fell it.
  const trees: Tree[] = [];

  const mkTree = (x: number, z: number) => {
    const tree = createAsset('tree');
    tree.position.set(x, 0, z);
    root.add(tree);
    ctx.addObstacle({ x, z, radius: 0.35 });
    trees.push({ group: tree, x, z, felled: false });
  };

  const player = ctx.playerPos();
  const fwd = new THREE.Vector3();
  ctx.camera.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
  fwd.normalize();
  // The axe stump sits at the far end OPPOSITE the cabin — you wander across the
  // forest to find it (cabin one way, axe the other).
  const stumpPos = new THREE.Vector3(-EXIT.x, 0, -EXIT.z);

  // Scatter trees, keeping gaps around the spawn, the exit, and the axe stump.
  for (let i = 0; i < 230; i++) {
    const x = (Math.random() * 2 - 1) * HALF;
    const z = (Math.random() * 2 - 1) * HALF;
    if (Math.hypot(x, z) < 6) continue; // spawn clearing
    if (Math.hypot(x - EXIT.x, z - EXIT.z) < 5) continue; // exit clearing
    if (Math.hypot(x - stumpPos.x, z - stumpPos.z) < 2.5) continue; // axe clearing
    mkTree(x, z);
  }

  // Ground detail: dense grass (one instanced mesh = cheap) + scattered rocks.
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x4f9440, roughness: 1, flatShading: true });
  const N_GRASS = 700;
  const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(0.05, 0.45, 4), grassMat, N_GRASS);
  const gm = new THREE.Matrix4();
  const gp = new THREE.Vector3();
  const gq = new THREE.Quaternion();
  const gscale = new THREE.Vector3();
  let gPlaced = 0;
  let gGuard = 0;
  while (gPlaced < N_GRASS && gGuard++ < N_GRASS * 4) {
    const x = (Math.random() * 2 - 1) * HALF;
    const z = (Math.random() * 2 - 1) * HALF;
    if (Math.hypot(x, z) < 3.5) continue; // keep the spawn footing clear-ish
    gp.set(x, 0.18, z);
    gq.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4));
    gscale.set(1, 0.7 + Math.random() * 0.9, 1);
    gm.compose(gp, gq, gscale);
    grass.setMatrixAt(gPlaced++, gm);
  }
  grass.count = gPlaced;
  grass.instanceMatrix.needsUpdate = true;
  grass.receiveShadow = true;
  root.add(grass);

  for (let i = 0; i < 40; i++) {
    const x = (Math.random() * 2 - 1) * HALF;
    const z = (Math.random() * 2 - 1) * HALF;
    if (Math.hypot(x, z) < 4) continue;
    if (Math.hypot(x - EXIT.x, z - EXIT.z) < 5) continue;
    if (Math.hypot(x - stumpPos.x, z - stumpPos.z) < 2) continue;
    const rock = createAsset('rock');
    const s = 0.3 + Math.random() * 1.1;
    rock.scale.setScalar(s);
    rock.position.set(x, s * 0.25, z);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    root.add(rock);
  }

  // The axe — the shared object (src/objects/axe.ts). The forest just says what a
  // swing HITS here: fell the nearest tree (leaving a campfire), and smash the
  // cabin's planked door. Everything else about the axe (grab, swing animation,
  // tumbling throw, carrying it onward) lives on the object.
  let tryBreakDoor: (ax: number, az: number) => void = () => {};
  spawnAxe(ctx, stumpPos, {
    onSwing: (ax, az) => {
      let near: Tree | null = null;
      let nd = CHOP_REACH;
      for (const t of trees) {
        if (t.felled) continue;
        const d = Math.hypot(t.x - ax, t.z - az);
        if (d < nd) { nd = d; near = t; }
      }
      if (near && near.group.parent) {
        near.felled = true;
        root.remove(near.group);
        const fire = createAsset('campfire');
        fire.position.set(near.x, 0, near.z);
        root.add(fire);
        ctx.addTarget({ kind: 'campfire', position: new THREE.Vector3(near.x, 0, near.z), radius: 2.2 });
        thud();
      }
      tryBreakDoor(ax, az); // a swing near the cabin's plank smashes it open
    },
  });

  // ── A few wandering ducks, sparse — the same duck object as everywhere: grab
  //    one to carry it onward, throw it (it bounces off trees/the cabin and
  //    splats if it comes down hard), cook it on a campfire, or axe it. ──
  for (const [dx, dz] of [[11, -7], [-13, 9], [7, 16], [-9, -14]] as [number, number][]) {
    spawnDuck(ctx, dx, dz);
  }

  // ── Painted forest backdrop walls at the four edges, facing inward ──
  const WALL_H = 22;
  const span = HALF * 2 + 8;
  const baseTex = forestBackdropTexture();
  const mkWall = (px: number, pz: number, rotY: number) => {
    const map = baseTex.clone();
    map.wrapS = THREE.RepeatWrapping;
    map.repeat.x = 3;
    map.needsUpdate = true;
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(span, WALL_H),
      new THREE.MeshBasicMaterial({ map }),
    );
    wall.position.set(px, WALL_H / 2 - 0.5, pz);
    wall.rotation.y = rotY;
    root.add(wall);
  };
  // Each plane faces +Z by default; rotate so its front faces inward.
  mkWall(0, -HALF, 0);              // north wall, faces +Z (inward)
  mkWall(0, HALF, Math.PI);        // south wall, faces -Z (inward)
  mkWall(-HALF, 0, Math.PI / 2);   // west wall, faces +X (inward)
  mkWall(HALF, 0, -Math.PI / 2);   // east wall, faces -X (inward)

  // ── A cracked opening in the east wall — the passage back to the tunnel. ──
  const CRACK_Z = 0;
  crackedWall(root, new THREE.Vector3(HALF - 0.06, 0, CRACK_Z), -Math.PI / 2); // faces −X, into the forest
  if (ctx.entry === 'crack') ctx.spawnAt(new THREE.Vector3(HALF - 3, 0, CRACK_Z), Math.PI / 2); // emerge from it
  walkThroughPortal(ctx, {
    zone: (p) => p.x > HALF - 1.5 && Math.abs(p.z - CRACK_Z) < 2.5,
    to: 'tunnel',
    ref: new THREE.Vector3(HALF, 0, CRACK_Z),
    entry: 'crack',
  });

  // A white room waiting in the clearing — walk in and press to go on.
  buildExitRoom(ctx, { center: EXIT, facing: 'posZ', solidWalls: true }); // walls block — only the door lets you in

  // ── A planked double door bars the cabin entrance. By hand it won't budge —
  //    you have to smash the plank with the axe. ──
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 0.9, flatShading: true });
  const plankMat = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.85, flatShading: true });
  const DOOR_W = 2.0;
  const DOOR_H = 3.4;
  const doorX = EXIT.x;
  const doorZ = EXIT.z + 4.5; // the +Z doorway plane
  const leaves: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(doorX + (s * DOOR_W) / 2, 0, doorZ); // hinge at the outer jamb
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W / 2 + 0.04, DOOR_H, 0.1), doorMat);
    leaf.position.set((-s * DOOR_W) / 4, DOOR_H / 2, 0);
    leaf.castShadow = true;
    hinge.add(leaf);
    root.add(hinge);
    leaves.push(hinge);
  }
  const plank = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W + 0.8, 0.32, 0.16), plankMat);
  plank.position.set(doorX, DOOR_H * 0.5, doorZ + 0.13);
  plank.rotation.z = 0.26;
  plank.castShadow = true;
  root.add(plank);
  const doorBlock = { x: doorX, z: doorZ, radius: 1.3 };
  ctx.addObstacle(doorBlock); // blocks the doorway until the plank is smashed

  let doorBlocked = true;
  let hintedDoor = false;

  tryBreakDoor = (ax, az) => {
    if (!doorBlocked) return;
    if (Math.hypot(ax - doorX, az - doorZ) > CHOP_REACH + 0.4) return;
    doorBlocked = false;
    root.remove(plank); // splinter the plank
    pop();
    thud();
    ctx.removeObstacle(doorBlock);
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      const e = 1 - Math.pow(1 - Math.min(1, t / 0.6), 3);
      leaves[0].rotation.y = e * 1.3;
      leaves[1].rotation.y = -e * 1.3;
      return t >= 0.6;
    });
    ctx.narrate('The plank splinters. The way is open.', 4000, { priority: true });
  };

  // Proximity hint: the barred door tells you it won't open by hand.
  const playerP = ctx.playerPos();
  addUpdater(() => {
    if (!doorBlocked) return true; // opened — stop checking
    if (!hintedDoor && Math.hypot(playerP.x - doorX, playerP.z - doorZ) < 3.6) {
      hintedDoor = true;
      ctx.narrate('Barred. A plank across the doors. It will not come off by hand.', 5000, { priority: true });
    }
    return false;
  });

  ctx.openRoom();
  ctx.setBounds({ minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF });

  // Sky cross-fade white → daylight blue.
  const sky = new THREE.Color(0x9ec9e8);
  const startBg = (ctx.scene.background as THREE.Color)?.clone() ?? new THREE.Color(0xf4f4f2);
  if (!ctx.scene.fog) ctx.scene.fog = new THREE.Fog(0x9ec9e8, 34, 92);
  const fog = ctx.scene.fog as THREE.Fog;
  let tb = 0;
  addUpdater((dt) => {
    tb += dt;
    const k = Math.min(1, tb / 1.8);
    const c = startBg.clone().lerp(sky, k);
    (ctx.scene.background as THREE.Color).copy(c);
    fog.color.copy(c);
    return k >= 1;
  });

  // (Background birdsong disabled for now.)

  ctx.narrate('A forest. It goes on a while. There is a way out. Find it.', 5000);
}
