import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { buildExitRoom, RH } from './exit-room';
import { addUpdater } from '../experiences/scheduler';
import { thunder, trainHorn, pop } from '../audio/sfx';
import { createAsset, makeRng, trainStrike } from '../assets';
import { registerInteractable } from '../interactables/system';
import { defineCombine, type Carryable } from '../game/combine';
import { feedsTunnel } from './slingshot-state';

// Axe a planked-shut side tunnel open. The active tunnel level wires the hook.
let breakSidePlank: (() => void) | null = null;
defineCombine('axe', 'tunnel-plank', () => {
  breakSidePlank?.();
  return true; // keep the axe
});

// THE TUNNEL — a launch puzzle laid out along one line through the spawn:
//
//   [ TUNNEL 1 ] --- (you spawn) --- ............. --- [ CABIN ] [ TUNNEL 2 ]
//     trap (dead)                                       on stilts   solution
//
// Either train KNOCKS you back and up into the air — and landing on the ground
// kills you. Tunnel 1, near spawn, just flings you down the open run: you always
// hit dirt → dead. Only tunnel 2, down by the cabin, arcs you high enough to
// reach the cabin top — bleed off speed (look down to drop) and you land safe;
// miss, and it's the ground again.

const WALL_T1 = -14; // near tunnel, close to spawn (mouth faces +Z) — the TRAP
const HOUSE_Z = 38; // elevated cabin, way down the far end, beside tunnel 2
const HOUSE_Y = 9;
const WALL_T2 = 50; // far tunnel, right beside the cabin (mouth faces −Z) — the SOLUTION

const TRACK_X = [-1.4, 1.4];
const TRAIN_SPEED = 34;
// Tunnel 1 (trap): knocks you back + up, but it always comes down on the open
// ground (short of the cabin) → dead.
const LAUNCH_T1 = new THREE.Vector3(0, 15, 13);
// Tunnel 2 (solution): a strong arc toward the cabin that OVERSHOOTS on its own —
// look down mid-air to bleed off speed and drop onto the cabin top.
const LAUNCH_T2 = new THREE.Vector3(0, 24, -7);

interface Train {
  group: THREE.Group;
  x: number;
  z: number;
  dir: number;
  launch: THREE.Vector3;
}

export function revealTunnel(ctx: GameContext): void {
  const root = ctx.levelRoot;

  // Stormy sky.
  const sky = new THREE.Color(0x10131a);
  const startBg = (ctx.scene.background as THREE.Color)?.clone() ?? new THREE.Color(0xf4f4f2);
  if (!ctx.scene.fog) ctx.scene.fog = new THREE.Fog(0x10131a, 24, 100);
  const fog = ctx.scene.fog as THREE.Fog;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(260, (WALL_T2 + 14) - (WALL_T1 - 14)),
    new THREE.MeshStandardMaterial({ color: 0x2a2f2a, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, ((WALL_T2 + 14) + (WALL_T1 - 14)) / 2);
  ground.receiveShadow = true;
  root.add(ground);

  buildBackdrop(root); // 3D distant peaks at the two ends
  buildSideWalls(root); // painted 2D mountain walls on the two sides

  // Tunnel 1 (front): default orientation (mouth +Z, bore receding −Z).
  const t1 = createAsset('tunnel-face');
  t1.position.z = WALL_T1;
  root.add(t1);
  // Tunnel 2 (far): mirrored 180° so its mouth faces −Z (back toward the cabin).
  const t2 = createAsset('tunnel-face');
  t2.position.z = WALL_T2;
  t2.rotation.y = Math.PI;
  root.add(t2);

  for (const x of TRACK_X) {
    root.add(createAsset('track', { path: [new THREE.Vector3(x, 0, WALL_T1 - 9), new THREE.Vector3(x, 0, WALL_T2 + 9)] }));
  }
  buildGroundScatter(root);

  // The elevated cabin, between spawn and tunnel 2, open on top to land in.
  const house = buildExitRoom(ctx, {
    center: new THREE.Vector3(0, HOUSE_Y, HOUSE_Z),
    facing: 'none',
    openTop: true,
  });

  root.add(new THREE.AmbientLight(0x404858, 0.55));
  const stormLight = new THREE.DirectionalLight(0xbcd0ff, 0.25);
  stormLight.position.set(-6, 22, -4);
  root.add(stormLight);

  ctx.openRoom();
  // Wide enough to roam to the side walls (where the lever + the crack are).
  const baseRegions = [
    { minX: -42, maxX: 42, minZ: WALL_T1, maxZ: WALL_T2, floorY: 0 }, // the open run + sides
    { minX: -2.4, maxX: 2.4, minZ: WALL_T1 - 9, maxZ: WALL_T1 + 1, floorY: 0 }, // tunnel-1 bore
    { minX: -2.4, maxX: 2.4, minZ: WALL_T2 - 1, maxZ: WALL_T2 + 9, floorY: 0 }, // tunnel-2 bore
    house,
  ];
  ctx.setRegions(baseRegions);

  // Walls kill from the GROUND up to the roof, so a too-low launch that would
  // slip under the cabin between the pillars still splats against it. (The open
  // roof is the interior, away from these edge slabs, so the far tunnel's
  // drop-in is unaffected.)
  const wy0 = 0;
  const wy1 = HOUSE_Y + RH;
  const TW = 0.35;
  ctx.setFlightWalls([
    { minX: house.minX, maxX: house.maxX, minY: wy0, maxY: wy1, minZ: house.minZ - TW, maxZ: house.minZ + TW },
    { minX: house.minX, maxX: house.maxX, minY: wy0, maxY: wy1, minZ: house.maxZ - TW, maxZ: house.maxZ + TW },
    { minX: house.minX - TW, maxX: house.minX + TW, minY: wy0, maxY: wy1, minZ: house.minZ, maxZ: house.maxZ },
    { minX: house.maxX - TW, maxX: house.maxX + TW, minY: wy0, maxY: wy1, minZ: house.minZ, maxZ: house.maxZ },
  ]);

  let tb = 0;
  addUpdater((dt) => {
    tb += dt;
    const k = Math.min(1, tb / 1.8);
    const c = startBg.clone().lerp(sky, k);
    (ctx.scene.background as THREE.Color).copy(c);
    fog.color.copy(c);
    return k >= 1;
  });

  ctx.setLanding(
    (pos) => {
      if (pos.y > HOUSE_Y - 1) {
        ctx.narrate('Onto the cabin. Somehow.', 4000, { priority: true }); // the only safe landing
      } else {
        ctx.die('train'); // hit the ground = dead
      }
    },
    () => true,
  );

  // ── Trains: only when you stand on a track INSIDE a tunnel. ──
  const trains: Train[] = [];
  const player = ctx.playerPos();
  let flash = 0;
  let armed = true;
  let trainsStopped = false; // the lever halts every train
  let cooldown = 0;

  const spawnTrain = (trackX: number, faceZ: number, dir: number, launch: THREE.Vector3) => {
    const g = createAsset('train') as THREE.Group;
    if (dir < 0) g.rotation.y = Math.PI;
    const z = faceZ - 9 * dir;
    g.position.set(trackX, 0, z);
    root.add(g);
    trains.push({ group: g, x: trackX, z, dir, launch });
    flash = 1;
    thunder();
    trainHorn();
  };

  addUpdater((dt) => {
    if (flash > 0) flash = Math.max(0, flash - dt * 2.5);
    stormLight.intensity = 0.25 + flash * 2.2;
    if (cooldown > 0) cooldown -= dt;

    const onTrack = TRACK_X.find((tx) => Math.abs(player.x - tx) < 1.0);
    const inT1 = onTrack !== undefined && player.z < WALL_T1 + 1 && player.z > WALL_T1 - 8;
    const inT2 = onTrack !== undefined && player.z > WALL_T2 - 1 && player.z < WALL_T2 + 8;
    // Trains only run if the slingshot (the global source) is powered + aimed here.
    if ((inT1 || inT2) && armed && !trainsStopped && feedsTunnel() && !ctx.isDead() && cooldown <= 0) {
      armed = false;
      if (inT1) spawnTrain(onTrack!, WALL_T1, 1, LAUNCH_T1); // tunnel 1: knockback → ground
      else spawnTrain(onTrack!, WALL_T2, -1, LAUNCH_T2); // tunnel 2: arc toward the cabin
    }
    if (!inT1 && !inT2 && cooldown <= 0) armed = true;

    for (let i = trains.length - 1; i >= 0; i--) {
      const t = trains[i];
      t.z += TRAIN_SPEED * t.dir * dt;
      t.group.position.z = t.z;
      // Shared train behaviour: flattened on the spot, or (with a duck) knocked
      // clear — though landing on the ground here still kills you.
      if (trainStrike(ctx, t.group.position, t.launch)) cooldown = 2.5;
      if ((t.dir > 0 && t.z > WALL_T2 + 2) || (t.dir < 0 && t.z < WALL_T1 - 2)) {
        root.remove(t.group);
        trains.splice(i, 1);
      }
    }
    return false;
  });

  // ── SECRET ROUTE: hidden lever stops the trains → grab the pickaxe from a
  //    tunnel → smash the cracked wall → step through the hole into the forest. ──
  const fwd = new THREE.Vector3();
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 1, flatShading: true });

  // A hidden lever, far off the −X side by the far tunnel (not visible at spawn).
  const leverX = -40;
  const leverZ = WALL_T2 - 4;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 6), dark);
  back.position.set(leverX - 1.5, 3, leverZ);
  root.add(back);
  const leverBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.9, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x6b6e76, roughness: 0.6, metalness: 0.4 }),
  );
  leverBase.position.set(leverX, 0.45, leverZ);
  root.add(leverBase);
  const leverArm = new THREE.Group();
  leverArm.position.set(leverX, 0.9, leverZ);
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8),
    new THREE.MeshStandardMaterial({ color: 0x33363c, metalness: 0.7, roughness: 0.4 }),
  );
  stick.position.y = 0.45;
  leverArm.add(stick);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5 }));
  knob.position.y = 0.9;
  leverArm.add(knob);
  leverArm.rotation.x = -0.7; // tilted toward you to start
  root.add(leverArm);
  let leverPulled = false;
  registerInteractable({
    id: 'tunnel-lever',
    position: new THREE.Vector3(leverX, 0, leverZ),
    radius: 2.0,
    promptLabel: 'PULL',
    labelOffsetY: 1.7,
    onUse: () => {
      if (leverPulled) return;
      leverPulled = true;
      trainsStopped = true;
      thunder();
      pop();
      let t = 0;
      addUpdater((dt) => {
        t += dt;
        leverArm.rotation.x = -0.7 + Math.min(1, t / 0.45) * 1.4;
        return t >= 0.45;
      });
      ctx.narrate('A heavy clunk in the dark. The rails fall silent — the trains have stopped.', 5500, { priority: true });
    },
  });

  // The pickaxe, on the ground deep in tunnel 1 — only safe to fetch once the
  // trains are stopped.
  const pick = createAsset('pickaxe');
  pick.position.set(1.4, 0.18, WALL_T1 - 6);
  pick.rotation.set(Math.PI / 2, 0.3, 0); // lying on the rails
  root.add(pick);

  // A cracked rock slab on the +X side wall — smash it with the pickaxe.
  const crackX = 42;
  const crackZ = 12;
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 1, flatShading: true });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 5.5), rockMat);
  slab.position.set(crackX + 0.6, 2.6, crackZ);
  root.add(slab);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x0b0c10 });
  const crackLines: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const ln = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.2 + Math.random() * 1.4, 0.08), lineMat);
    ln.position.set(crackX + 0.34, 1.6 + Math.random() * 2.6, crackZ + (Math.random() - 0.5) * 3.6);
    ln.rotation.x = (Math.random() - 0.5) * 1.3;
    root.add(ln);
    crackLines.push(ln);
  }

  let crackBroken = false;
  const tryBreakCrack = () => {
    if (crackBroken) return;
    ctx.camera.getWorldDirection(fwd);
    const ax = ctx.camera.position.x + fwd.x * 1.8;
    const az = ctx.camera.position.z + fwd.z * 1.8;
    if (Math.hypot(ax - crackX, az - crackZ) > 3.4) return; // must be right at the crack
    crackBroken = true;
    root.remove(slab);
    for (const ln of crackLines) root.remove(ln);
    pop();
    thunder();
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4), new THREE.MeshBasicMaterial({ color: 0x9ec9e8 }));
    hole.position.set(crackX + 0.72, 2.2, crackZ);
    hole.rotation.y = -Math.PI / 2;
    root.add(hole);
    // a passage notch so you can step INTO the hole
    ctx.setRegions([...baseRegions, { minX: crackX, maxX: crackX + 5, minZ: crackZ - 2, maxZ: crackZ + 2, floorY: 0 }]);
    ctx.narrate('The rock splinters and gives way — daylight beyond, and the smell of pine. A way through.', 6000, { priority: true });
    let gone = false;
    addUpdater(() => {
      if (gone) return true;
      const p = ctx.playerPos();
      if (p.x > crackX + 1.6 && Math.abs(p.z - crackZ) < 2.2) {
        gone = true;
        ctx.advanceTo('forest', new THREE.Vector3(crackX, 0, crackZ)); // step through → the forest
        return true;
      }
      return false;
    });
  };

  const pickCarry: Carryable = {
    kind: 'pickaxe',
    object: pick,
    heldDist: 0.75,
    heldRight: 0.45,
    heldDrop: 0.4,
    onTap: tryBreakCrack, // swing at the crack to smash it
  };
  ctx.addCarryable(pickCarry);

  // Walk up tunnel 2 (only safe once the trains are stopped) all the way to the
  // back, and you come out at the slingshot yard — where the trains are launched.
  let toSling = false;
  addUpdater(() => {
    if (toSling) return true;
    const p = ctx.playerPos();
    if (p.z > WALL_T2 + 5 && Math.abs(p.x) < 2.4) {
      toSling = true;
      ctx.advanceTo('slingshot', new THREE.Vector3(0, 0, WALL_T2 + 6));
      return true;
    }
    return false;
  });

  // ── A planked-shut side tunnel on the −X wall. Bring the axe (from the forest)
  //    and break the planks to open a path onward. ──
  const ptX = -42;
  const ptZ = 0;
  const sideMat = new THREE.MeshStandardMaterial({ color: 0x44474e, roughness: 1, flatShading: true });
  for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(1.0, 6, 1.0), sideMat);
    post.position.set(ptX, 3, ptZ + sz * 2.6);
    root.add(post);
  }
  const sLintel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.2, 6.2), sideMat);
  sLintel.position.set(ptX, 6.1, ptZ);
  root.add(sLintel);
  const sDark = new THREE.Mesh(new THREE.PlaneGeometry(5, 6), new THREE.MeshBasicMaterial({ color: 0x05060a }));
  sDark.position.set(ptX - 0.6, 3, ptZ);
  sDark.rotation.y = Math.PI / 2;
  root.add(sDark);
  const plankGroup = new THREE.Group();
  root.add(plankGroup);
  const plankWood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.95, flatShading: true });
  for (let k = 0; k < 4; k++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 5), plankWood);
    plank.position.set(ptX + 0.35, 1 + k * 1.1, ptZ);
    plank.rotation.z = k % 2 ? 0.05 : -0.04;
    plankGroup.add(plank);
  }
  const plankTarget = { kind: 'tunnel-plank', position: new THREE.Vector3(ptX, 0, ptZ), radius: 3.8 };
  ctx.addTarget(plankTarget);
  let plankBroken = false;
  breakSidePlank = () => {
    if (plankBroken) return;
    plankBroken = true;
    root.remove(plankGroup);
    ctx.removeTarget(plankTarget);
    pop();
    thunder();
    ctx.setRegions([...baseRegions, { minX: ptX - 5, maxX: ptX + 1, minZ: ptZ - 2.5, maxZ: ptZ + 2.5, floorY: 0 }]);
    ctx.narrate('The planks split under the axe. The side tunnel gapes open — a way through.', 5500, { priority: true });
    let gone = false;
    addUpdater(() => {
      if (gone) return true;
      const p = ctx.playerPos();
      if (p.x < ptX - 1.5 && Math.abs(p.z - ptZ) < 2.5) {
        gone = true;
        ctx.advance(new THREE.Vector3(ptX, 0, ptZ)); // step through → onward
        return true;
      }
      return false;
    });
  };

  ctx.narrate('Trains. Tunnels. A storm rolling in. You will figure it out. Or you will not.', 5500);
}

// Distant darker peaks behind BOTH tunnels for depth.
function buildBackdrop(root: THREE.Object3D): void {
  const farMat = new THREE.MeshStandardMaterial({ color: 0x191c24, roughness: 1, flatShading: true });
  const rng = makeRng(99);
  const place = (baseZ: number, sign: number) => {
    for (let i = 0; i < 7; i++) {
      const x = -38 + i * 12 + (rng() - 0.5) * 6;
      const h = 16 + rng() * 16;
      const w = 12 + rng() * 10;
      const peak = new THREE.Mesh(new THREE.ConeGeometry(w, h, 4, 1), farMat);
      peak.position.set(x, h / 2 - 2, baseZ + sign * (14 + rng() * 12));
      peak.rotation.y = rng() * Math.PI;
      root.add(peak);
    }
  };
  place(WALL_T1, -1);
  place(WALL_T2, 1);
}

// A painted stormy-mountain backdrop drawn to a canvas: dark sky + two jagged
// ridge silhouettes — used flat on the two side walls.
function mountainBackdropTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#11151f');
  sky.addColorStop(0.5, '#33405a');
  sky.addColorStop(1, '#566480'); // lighter band at the horizon so ridges read
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const rng = makeRng(7);
  const ridge = (baseY: number, amp: number, color: string, step: number) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += step) g.lineTo(x, baseY - rng() * amp);
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  };
  ridge(H * 0.55, 150, '#2b3650', 95); // far ridge
  ridge(H * 0.72, 120, '#161c28', 70); // nearer ridge (darker)
  return new THREE.CanvasTexture(canvas);
}

// The two SIDES (±X) are flat painted mountain walls facing inward.
function buildSideWalls(root: THREE.Object3D): void {
  const tex = mountainBackdropTexture();
  const H = 42;
  const len = WALL_T2 - WALL_T1 + 60; // span the run with margin
  const midZ = (WALL_T1 + WALL_T2) / 2;
  const X = 44;
  const mk = (px: number, rotY: number) => {
    const map = tex.clone();
    map.wrapS = THREE.RepeatWrapping;
    map.repeat.x = 3;
    map.needsUpdate = true;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, H), new THREE.MeshBasicMaterial({ map }));
    wall.position.set(px, H / 2 - 2, midZ);
    wall.rotation.y = rotY;
    root.add(wall);
  };
  mk(-X, Math.PI / 2); // left side, faces +X (inward)
  mk(X, -Math.PI / 2); // right side, faces −X (inward)
}

// Sparse rock detail on the ground, off the rails + centre corridor.
function buildGroundScatter(root: THREE.Object3D): void {
  const rng = makeRng(123);
  let placed = 0;
  let guard = 0;
  const span = WALL_T2 - WALL_T1;
  while (placed < 30 && guard++ < 700) {
    const x = (rng() - 0.5) * 30;
    const z = WALL_T1 + 2 + rng() * (span - 4);
    if (TRACK_X.some((tx) => Math.abs(x - tx) < 1.7)) continue;
    if (Math.abs(x) < 2.4) continue;
    const rock = createAsset('rock');
    const s = 0.5 + rng() * 1.3;
    rock.scale.setScalar(s);
    rock.position.set(x, s * 0.28, z);
    root.add(rock);
    placed++;
  }
}
