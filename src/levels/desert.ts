import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Obstacle } from '../controls/player-camera';
import { buildExitRoom } from './exit-room';
import { groundPlane } from './scaffold';
import { addUpdater } from '../experiences/scheduler';
import { trainHorn, crossingBell, click, thud } from '../audio/sfx';
import { createAsset, makeRng, trainStrike } from '../assets';
import { vo } from '../audio/vo-shared';
import type { Carryable } from '../game/combine';
import { registerInteractable } from '../interactables/system';
import { discover, isDiscovered } from '../graph/progress';
import { spawnKey } from '../objects/key';
import { FONT_DISPLAY } from '../ui/fonts';

// THE DESERT — the room opens onto a desert. A road runs from where you stand,
// over a railway at a level crossing, to the exit cabin on the far side:
//
//        (you) ── road ──[ CROSSING ]── road ── [ CABIN ]        (−Z →)
//   train ═══════════════════╪═════════════════════════════ track (along X)
//
// The train waits on the horizon, and it is paying attention:
//   • The road is safe: on it, the train stays on the horizon (and backs off if
//     it had crept up). Railings run from the barriers to the rails, boxing the
//     crossing in, so the safe strip reads at a glance.
//   • Beside the road, it creeps closer the nearer you get to the rails (and
//     backs off again when you back off).
//   • Near the crossing the barriers come down, the lights flash, the bell
//     rings — for a train that never actually comes.
//   • Set foot on the rails anywhere (crossing included) and it runs you down.
//     (A held cushion — a duck, the basketball — knocks you clear instead: the
//     shared trainStrike rule.)
//
// THE SOLUTION — it charges whatever is on the rails, not just you. Your first
// death teaches that — and only after it (this session) does a crash-test dummy
// turn up, slumped by a broken-down car off the road: carry it over, throw it on the rails, and the train charges IT —
// limbs everywhere — then runs off over the horizon. For WINDOW seconds there
// is no train: the barriers lift and you walk across. A duck on the rails works
// the same (it gets fed to the train). The yellow WAIT button on the barrier
// post is a red herring: it lights WAIT, and that is all it will ever do.

// The track: a line through the crossing point CROSS along TRACK_DIR. Positions
// on it are `s` (metres along it from CROSS; negative = ahead-left, toward the
// horizon the train waits at), distances off it are measured along TRACK_N.
const CROSS = new THREE.Vector3(0, 0, -26);
// Run over while looking away: after the eye-contact advice, or without it.
const NO_EYE_CONTACT = vo('No eye contact. Exactly as I said. I never said it would help.');
const NEVER_LOOKED = vo('You never saw it coming. In fairness, you never looked.');
// The decoy lands: the window is open.
// The dummy only turns up once the train has killed you: the first death
// teaches the rule, and then there's something to use it with. Remembered with
// the saved progress (so it survives a reload, and the map's Reset clears it):
// a flag id, not a map node.
const RUN_OVER = 'flag:desert-run-over';
let dummyAnnounced = false;
let saidRedKey = false;
const RED_KEY = vo('A red key, behind the exit, where nobody looks. You looked. Somewhere, a red lock is waiting.');
const DUMMY_APPEARS = vo('There is a dummy by that car now. It was not there last time. I have no idea why. None.');

const HIT_DUMMY = vo('It hit the dummy. It looks very pleased with itself. Go. Now. While it is gloating.');
const HIT_DUCK = vo('You fed it a duck. It seems to count that as a meal. Go, before it wants dessert.');
const WINDOW_CLOSING = vo('It is coming back. I would hurry.');
// The WAIT button, pressed again and again.
const WAIT_LINES: Record<number, string> = vo({
  3: 'It has said WAIT since 1987. It is very committed.',
  6: 'Pressing it harder does not make it faster. I have checked. For years.',
});

const TRACK_DIR = new THREE.Vector3(1, 0, 0); // square across the road
const TRACK_N = new THREE.Vector3(-TRACK_DIR.z, 0, TRACK_DIR.x); // points to your side
const along = (x: number, z: number) => (x - CROSS.x) * TRACK_DIR.x + (z - CROSS.z) * TRACK_DIR.z;
const across = (x: number, z: number) => (x - CROSS.x) * TRACK_N.x + (z - CROSS.z) * TRACK_N.z;
const onLine = (s: number, off = 0) => CROSS.clone().addScaledVector(TRACK_DIR, s).addScaledVector(TRACK_N, off);
const EXIT = new THREE.Vector3(0, 0, -46); // the cabin, doorway toward the road
const ROAD_HALF = 3;
const ROAD_FROM = 10; // road starts behind the start room…
const ROAD_TO = EXIT.z + 4.5; // …and ends at the cabin door
const BOUNDS = { minX: -48, maxX: 48, minZ: -54, maxZ: 14 };

const REST_S = -130; // the train's nose, waiting on the horizon (off to the left)
const CREEP_FROM = 34; // m from the rails where, off the road, it starts creeping
const CLOSEST_GAP = 12; // how near its nose comes (along the track) to you
const CREEP_SPEED = [10, 45]; // closing speed, far from the rails → right at them
const RETREAT_SPEED = 14;
const CHARGE_SPEED = 120;
const CHARGE_FROM = 45; // a charge starts no further back than this, so you can't outwalk it
const ON_TRACK = 1.4; // distance off the line that counts as standing on the rails
const ON_ROAD = ROAD_HALF + 0.4; // |s| within which you are on the road (the railing line)
const CLOSE_RADIUS = 22; // the barriers come down when you are this near the crossing
const BARRIER_DZ = 10; // barriers stand this far up/down the road from the crossing
const WRAP_S = 280; // a charge runs off to here, then the train reappears behind
const CAR_GAP = 5.2;
const CARS = 5;
const WINDOW = 10; // seconds with no train after a decoy (or anything) is run over
const DECOY_ON_RAILS = 1.6; // how near the line a resting decoy must lie
const BROKEN_CAR = new THREE.Vector3(-18, 0, -6); // where the dummy slumps, off the road

export function revealDesert(ctx: GameContext): void {
  const root = ctx.levelRoot;
  root.add(groundPlane({ color: 0xd6b07a, size: 900 }));

  // Hazy desert daylight.
  const hemi = new THREE.HemisphereLight(0xfff1d6, 0xb58a55, 1.0);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 0.9);
  sun.position.set(-14, 26, 10);
  root.add(sun);

  buildRoad(root);
  root.add(createAsset('track', { path: [onLine(-WRAP_S - 40), onLine(WRAP_S + 40)] }));
  buildPoles(root);
  buildScenery(ctx);

  // ── The crossing: a barrier + signal on each side of the rails ──
  const crossing = [
    buildCrossingSide(ctx, 1), // near side (your side), post on +X, faces you
    buildCrossingSide(ctx, -1), // far side, post on −X, faces the cabin
  ];
  buildRailings(ctx);

  buildExitRoom(ctx, { center: EXIT, facing: 'posZ', solidWalls: true });

  // ── The train: a locomotive + boxcars, nose pointing down the line (+s) ──
  const train = new THREE.Group();
  train.rotation.y = Math.atan2(TRACK_DIR.x, TRACK_DIR.z); // the asset's nose (+Z) → TRACK_DIR
  train.add(createAsset('train'));
  const carBody = new THREE.MeshStandardMaterial({ color: 0x7a3b22, roughness: 0.85, flatShading: true });
  const carDark = new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.7, flatShading: true });
  const carGeo = new THREE.BoxGeometry(1.8, 2.1, 4.6);
  const chassisGeo = new THREE.BoxGeometry(1.6, 0.4, 4.8);
  for (let i = 1; i <= CARS; i++) {
    const car = new THREE.Mesh(carGeo, carBody);
    car.position.set(0, 1.75, -CAR_GAP * i);
    car.castShadow = true;
    train.add(car);
    const chassis = new THREE.Mesh(chassisGeo, carDark);
    chassis.position.set(0, 0.5, -CAR_GAP * i);
    train.add(chassis);
  }
  let trainS = REST_S;
  train.position.copy(onLine(trainS));
  root.add(train);

  ctx.openRoom();
  ctx.setBounds(BOUNDS);

  // Sky cross-fade white → desert haze.
  const sky = new THREE.Color(0xecd3a8);
  const startBg = (ctx.scene.background as THREE.Color)?.clone() ?? new THREE.Color(0xf4f4f2);
  // Set the distances outright: the white room's fog (9–34 m) is still on the
  // scene here and would swallow the horizon — and the train on it.
  const fog = new THREE.Fog(0xecd3a8, 70, 280);
  ctx.scene.fog = fog;
  let tb = 0;
  addUpdater((dt) => {
    tb += dt;
    const k = Math.min(1, tb / 1.8);
    const c = startBg.clone().lerp(sky, k);
    (ctx.scene.background as THREE.Color).copy(c);
    fog.color.copy(c);
    return k >= 1;
  });

  // ── The decoys: the dummy by the broken-down car, and any duck ──
  buildBrokenCar(ctx);
  // The RED key, hidden in the sand behind the exit cabin: you only find it if
  // you get across and wander round the back instead of pressing on. It opens
  // grandma's cottage in the forest.
  spawnKey(ctx, 'red', EXIT.clone().add(new THREE.Vector3(1.4, 0.05, -6.6)), {
    rotation: new THREE.Euler(Math.PI / 2, 0, 0.7),
    onGrab: () => {
      if (saidRedKey) return;
      saidRedKey = true;
      ctx.narrate(RED_KEY, 4500, { priority: true });
    },
  });
  const dummy = isDiscovered(RUN_OVER) ? spawnDummy(ctx) : null;
  buildWaitButton(ctx);

  // Something (not you) lying on the rails: the dummy at rest, or a duck on the
  // ground (level ducks and carried-in ducks alike; ducks tag themselves).
  interface Decoy { s: number; smash: () => void; line: string }
  const decoyOnRails = (): Decoy | null => {
    const dc = dummy?.restingAt();
    if (dummy && dc && Math.abs(across(dc.x, dc.z)) < DECOY_ON_RAILS) {
      return { s: along(dc.x, dc.z), smash: dummy.smash, line: HIT_DUMMY };
    }
    for (const holder of [root, ctx.scene]) {
      for (const o of holder.children) {
        const ud = o.userData as { kind?: string; onScored?: () => void };
        if (ud.kind !== 'duck' || !ud.onScored || o.position.y > 0.7) continue; // held ducks ride high
        if (Math.abs(across(o.position.x, o.position.z)) > DECOY_ON_RAILS) continue;
        const eat = ud.onScored;
        return { s: along(o.position.x, o.position.z), smash: () => eat(), line: HIT_DUCK };
      }
    }
    return null;
  };

  // ── Behaviour ──
  let charging = false;
  let chargeV = 0;
  let decoy: Decoy | null = null; // what this charge is for, if not you
  let absent = 0; // > 0: gone over the horizon — the window to cross
  let warned = false;
  let creeping = false; // was closing in last frame (for the horn + the line)
  let hornCooldown = 0;
  let saidCreep = false;
  let saidRetreat = false;
  let menaced = false; // it has come within striking distance of you
  let closed = false;
  let bellT = 0;
  const hit = new THREE.Vector3();
  const look = new THREE.Vector3();

  // Run over. If you weren't facing up the line it came down, the narrator's
  // eye-contact advice gets its follow-up (replacing the generic death line).
  const onRunOver = () => {
    ctx.camera.getWorldDirection(look);
    look.y = 0;
    const facingIt = look.lengthSq() > 1e-4 && look.normalize().dot(TRACK_DIR) < -Math.cos(THREE.MathUtils.degToRad(50));
    if (facingIt) return;
    ctx.narrate(saidCreep ? NO_EYE_CONTACT : NEVER_LOOKED, 6000, { priority: true });
  };

  const charge = (fromS: number) => {
    discover('mech:train');
    charging = true;
    trainS = Math.max(trainS, fromS - CHARGE_FROM); // no outwalking it
    chargeV = 60;
    trainHorn();
  };

  addUpdater((dt) => {
    const p = ctx.playerPos();
    const ps = along(p.x, p.z);
    const dz = Math.abs(across(p.x, p.z));
    const onRoad = Math.abs(ps) < ON_ROAD;
    hornCooldown = Math.max(0, hornCooldown - dt);

    if (absent > 0) {
      // Over the horizon. Nothing comes; the crossing opens. Near the end, a
      // horn from far off says it's on its way back.
      absent -= dt;
      if (absent < 3 && !warned) {
        warned = true;
        trainHorn();
        ctx.narrate(WINDOW_CLOSING, 3000, { priority: true });
      }
      if (absent <= 0) {
        trainS = -WRAP_S; // back from behind the horizon, heading for its spot
        train.visible = true;
      }
    } else if (!charging) {
      // Step on the rails → it comes for you, flat out. Anything else lying on
      // them gets the same treatment.
      if (dz < ON_TRACK && !ctx.isAirborne() && !ctx.isDead()) {
        charge(ps);
      } else if ((decoy = decoyOnRails())) {
        charge(decoy.s);
      }
    }

    if (charging) {
      chargeV = Math.min(CHARGE_SPEED, chargeV + 120 * dt);
      trainS += chargeV * dt;
      if (decoy && trainS >= decoy.s) {
        decoy.smash();
        ctx.narrate(decoy.line, 5500, { priority: true });
        decoy = null;
      }
      // Every car is lethal, not just the nose. A cushion bounces you off the
      // rails, down the line and back to the side you came from.
      const side = Math.sign(across(p.x, p.z)) || 1;
      const knock = TRACK_DIR.clone().multiplyScalar(10).addScaledVector(TRACK_N, side * 7).setY(8);
      for (let i = 0; i <= CARS; i++) {
        hit.copy(onLine(trainS - CAR_GAP * i));
        if (trainStrike(ctx, hit, knock)) {
          if (ctx.isDead()) {
            discover(RUN_OVER);
            onRunOver();
          }
          break;
        }
      }
      if (trainS > WRAP_S) {
        charging = false; // gone over the horizon: the window opens
        decoy = null;
        absent = WINDOW;
        warned = false;
        train.visible = false;
      }
    } else if (absent <= 0) {
      // Off the road and nearing the rails: it creeps up, stopping a menacing
      // distance short of you. On the road, it backs off to rest.
      let target = REST_S;
      let near = 0; // 0 far from the rails → 1 right at them
      if (!onRoad && dz < CREEP_FROM) {
        near = 1 - (dz - ON_TRACK) / (CREEP_FROM - ON_TRACK);
        target = Math.max(REST_S, ps - THREE.MathUtils.lerp(ps - REST_S, CLOSEST_GAP, near));
      }
      const closing = target > trainS + 0.5;
      const speed = closing ? THREE.MathUtils.lerp(CREEP_SPEED[0], CREEP_SPEED[1], near) : RETREAT_SPEED;
      trainS += THREE.MathUtils.clamp(target - trainS, -speed * dt, speed * dt);
      if (closing && !creeping && hornCooldown <= 0 && !ctx.isDead()) {
        trainHorn();
        hornCooldown = 8;
        if (!saidCreep) {
          saidCreep = true;
          ctx.narrate('Did the train just get closer? Trains do not creep up on people. Keep walking. Do not make eye contact.', 5500, { priority: true });
        }
      }
      if (ps - trainS < 40) menaced = true;
      if (menaced && !closing && onRoad && !saidRetreat && target === REST_S) {
        saidRetreat = true;
        ctx.narrate('It backed off. It respects the road. A very law-abiding train.', 5000, { priority: true });
      }
      creeping = closing;
    }
    train.position.copy(onLine(trainS));

    // The barriers drop when you come near the crossing (or the train charges)
    // — unless the train is gone, when there is nothing to stop you for.
    const toCross = Math.hypot(p.x - CROSS.x, p.z - CROSS.z);
    closed = charging || (absent <= 0 && toCross < CLOSE_RADIUS);
    if (closed) discover('mech:crossing');
    for (const side of crossing) side.update(dt, closed);
    if (closed) {
      bellT -= dt;
      if (bellT <= 0) {
        bellT = 0.5;
        crossingBell(0.12 * Math.max(0.15, 1 - toCross / 40));
      }
    } else {
      bellT = 0;
    }
    return false;
  });

  ctx.narrate('A desert. A road. A railway, and a train on the horizon, minding its own business. The way out is across the tracks.', 6500);
  if (dummy && !dummyAnnounced) {
    dummyAnnounced = true;
    ctx.narrate(DUMMY_APPEARS, 5500); // queued after the intro
  }
}

// One side of the level crossing: a post with a striped boom that swings down
// across its lane, and a signal mast with a crossbuck and two lamps that flash
// alternately while closed. `side` +1 = the near (+Z) side, −1 = the far side.
function buildCrossingSide(ctx: GameContext, side: number): { update: (dt: number, closed: boolean) => void } {
  const root = ctx.levelRoot;
  const postX = side * ON_ROAD; // on the railing line, at the rectangle's corner
  const z = CROSS.z + side * BARRIER_DZ;
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.6 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x5b5e66, roughness: 0.5, metalness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.8 });

  // Barrier post + boom. The boom pivots at the post top; down = across the lane.
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.35), grey);
  post.position.set(postX, 0.55, z);
  root.add(post);
  const pivot = new THREE.Group();
  pivot.position.set(postX, 1.0, z);
  root.add(pivot);
  const SEG = 0.5;
  const SEGS = Math.ceil((ROAD_HALF * 2 + 1.1) / SEG); // the whole road, post to past the far kerb
  for (let i = 0; i < SEGS; i++) {
    const seg = new THREE.Mesh(new THREE.BoxGeometry(SEG, 0.14, 0.1), i % 2 ? white : red);
    seg.position.set(-side * (0.2 + SEG * (i + 0.5)), 0, 0);
    pivot.add(seg);
  }
  const counter = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), black); // counterweight
  counter.position.set(side * 0.35, 0, 0);
  pivot.add(counter);
  ctx.addObstacle({ x: postX, z, radius: 0.35 });

  // Signal mast: crossbuck on top, two lamps below it, facing the approach.
  const mastX = postX + side * 0.9;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.6, 8), grey);
  mast.position.set(mastX, 1.8, z);
  root.add(mast);
  ctx.addObstacle({ x: mastX, z, radius: 0.3 });
  for (const tilt of [0.6, -0.6]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 0.05), white);
    arm.position.set(mastX, 3.3, z + side * 0.1);
    arm.rotation.z = tilt;
    root.add(arm);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.06, 0.04), red);
    edge.position.copy(arm.position).setZ(z + side * 0.13);
    edge.rotation.z = tilt;
    root.add(edge);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.06), black);
  plate.position.set(mastX, 2.5, z + side * 0.1);
  root.add(plate);
  const lampOn = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const lampOff = new THREE.MeshBasicMaterial({ color: 0x3a0d0a });
  const lamps: THREE.Mesh[] = [];
  for (const lx of [-0.3, 0.3]) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), lampOff);
    lamp.position.set(mastX + lx, 2.5, z + side * 0.14);
    if (side < 0) lamp.rotation.y = Math.PI; // the far signal faces the cabin
    root.add(lamp);
    lamps.push(lamp);
  }

  // Down, the boom is solid: a row of obstacles along it, from the post to its
  // tip. Up, they're lifted out.
  const boomLen = 0.2 + SEG * SEGS;
  const boomBlock: Obstacle[] = [];
  for (let d = 0.3; d <= boomLen; d += 0.45) boomBlock.push({ x: postX - side * d, z, radius: 0.3 });
  let blocking = false;

  let angle = Math.PI / 2; // start raised
  let flashT = 0;
  // The boom keeps people OUT of the boxed crossing, never in it: while you're in
  // this side's half of the box (between the boom line and the rails, or on the
  // boom line itself), this boom stays up so you can always walk back out. A
  // boom dropping onto you would wedge you inside its obstacles.
  const player = ctx.playerPos();
  // (0.55 < the 0.6 a boom stops you at, so pressing against it from outside
  // never counts as standing on its line.)
  const inMyHalf = () =>
    Math.abs(player.x) < ON_ROAD + 0.7 &&
    (side > 0 ? player.z > CROSS.z && player.z < z + 0.55 : player.z < CROSS.z && player.z > z - 0.55);
  return {
    update(dt, closed) {
      const goal = closed && !inMyHalf() ? 0 : Math.PI / 2;
      angle += THREE.MathUtils.clamp(goal - angle, -1.4 * dt, 1.4 * dt);
      pivot.rotation.z = -side * angle; // swings up away from the road
      const down = angle < 0.35;
      if (down !== blocking) {
        blocking = down;
        for (const o of boomBlock) (down ? ctx.addObstacle : ctx.removeObstacle)(o);
      }
      if (closed) {
        flashT += dt;
        const phase = Math.floor(flashT / 0.5) % 2;
        lamps[0].material = phase ? lampOn : lampOff;
        lamps[1].material = phase ? lampOff : lampOn;
      } else {
        flashT = 0;
        lamps[0].material = lampOff;
        lamps[1].material = lampOff;
      }
    },
  };
}

// Railings along both road edges, from each barrier post up to the rails: with
// the two barriers they box the crossing in. Solid, so the road is the way over.
function buildRailings(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
  const postGeo = new THREE.BoxGeometry(0.12, 1.0, 0.12);
  const TRACK_CLEAR = 1.3; // stop just short of the track bed
  for (const zSide of [1, -1]) {
    const z0 = CROSS.z + zSide * BARRIER_DZ;
    const z1 = CROSS.z + zSide * TRACK_CLEAR;
    const len = Math.abs(z0 - z1);
    const midZ = (z0 + z1) / 2;
    for (const xSide of [1, -1]) {
      const x = xSide * ON_ROAD;
      for (const y of [0.55, 0.95]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, len), white);
        rail.position.set(x, y, midZ);
        root.add(rail);
      }
      const posts = Math.max(2, Math.round(len / 1.2) + 1);
      for (let i = 0; i < posts; i++) {
        const pz = z1 + (z0 - z1) * (i / (posts - 1));
        const post = new THREE.Mesh(postGeo, white);
        post.position.set(x, 0.5, pz);
        root.add(post);
      }
      for (let d = 0; d <= len; d += 0.5) ctx.addObstacle({ x, z: z1 + Math.sign(z0 - z1) * d, radius: 0.3 });
    }
  }
}

// The road: asphalt from behind the start room to the cabin door, a dashed
// centre line, and stop lines either side of the rails.
function buildRoad(root: THREE.Object3D): void {
  const len = ROAD_FROM - ROAD_TO;
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF * 2, len),
    new THREE.MeshStandardMaterial({ color: 0x3b3a3a, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, (ROAD_FROM + ROAD_TO) / 2);
  road.receiveShadow = true;
  root.add(road);

  const paint = new THREE.MeshBasicMaterial({ color: 0xf1e6b8 });
  const dashes: number[] = [];
  for (let z = ROAD_FROM - 1; z > ROAD_TO + 1; z -= 3) {
    if (Math.abs(z - CROSS.z) > 6) dashes.push(z);
  }
  const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.15, 1.4), paint, dashes.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  const one = new THREE.Vector3(1, 1, 1);
  dashes.forEach((z, i) => dash.setMatrixAt(i, m.compose(new THREE.Vector3(0, 0.03, z), q, one)));
  dash.instanceMatrix.needsUpdate = true;
  root.add(dash);
  for (const s of [1, -1]) {
    const stop = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 0.35), paint);
    stop.rotation.x = -Math.PI / 2;
    stop.position.set(0, 0.03, CROSS.z + s * (BARRIER_DZ + 2));
    root.add(stop);
  }
}

// Telegraph poles along the far side of the line, out to the horizon.
function buildPoles(root: THREE.Object3D): void {
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a4430, roughness: 0.95, flatShading: true });
  const ss: number[] = [];
  for (let s = -240; s <= 240; s += 24) ss.push(s);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.13, 6, 6), wood, ss.length);
  const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(1.4, 0.1, 0.1), wood, ss.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(TRACK_DIR.x, TRACK_DIR.z)); // crossarm square to the line
  const one = new THREE.Vector3(1, 1, 1);
  ss.forEach((s, i) => {
    const at = onLine(s, -4); // the far side of the line
    poles.setMatrixAt(i, m.makeTranslation(at.x, 3, at.z));
    bars.setMatrixAt(i, m.compose(at.setY(5.6), q, one));
  });
  poles.instanceMatrix.needsUpdate = true;
  bars.instanceMatrix.needsUpdate = true;
  root.add(poles, bars);
}

// Cacti and rocks near the road, and flat-topped mesas out in the haze.
function buildScenery(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const rng = makeRng(31);
  const green = new THREE.MeshStandardMaterial({ color: 0x5f7d3c, roughness: 0.9, flatShading: true });
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.32, 1, 8);
  const armGeo = new THREE.CylinderGeometry(0.18, 0.2, 1, 8);
  let placed = 0;
  let guard = 0;
  while (placed < 26 && guard++ < 600) {
    const x = (rng() - 0.5) * 2 * (BOUNDS.maxX - 2);
    const z = BOUNDS.minZ + 2 + rng() * (BOUNDS.maxZ - BOUNDS.minZ - 4);
    if (Math.abs(x) < ROAD_HALF + 4) continue; // clear of the road + crossing
    if (Math.abs(across(x, z)) < 6) continue; // clear of the rails
    if (Math.hypot(x, z) < 8) continue; // clear of the start room
    if (Math.hypot(x - EXIT.x, z - EXIT.z) < 9) continue; // clear of the cabin
    if (Math.hypot(x - BROKEN_CAR.x, z - BROKEN_CAR.z) < 7) continue; // clear of the car
    const h = 2 + rng() * 2.2;
    const cactus = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, green);
    trunk.scale.y = h;
    trunk.position.y = h / 2;
    cactus.add(trunk);
    for (const s of [-1, 1]) {
      if (rng() < 0.3) continue;
      const armY = h * (0.4 + rng() * 0.3);
      const out = new THREE.Mesh(armGeo, green);
      out.scale.y = 0.6;
      out.rotation.z = (s * Math.PI) / 2;
      out.position.set(s * 0.45, armY, 0);
      cactus.add(out);
      const up = new THREE.Mesh(armGeo, green);
      up.scale.y = 0.9 + rng() * 0.6;
      up.position.set(s * 0.72, armY + up.scale.y / 2, 0);
      cactus.add(up);
    }
    cactus.position.set(x, 0, z);
    cactus.rotation.y = rng() * Math.PI;
    root.add(cactus);
    ctx.addObstacle({ x, z, radius: 0.45 });
    placed++;
  }
  for (let i = 0; i < 18; i++) {
    const x = (rng() - 0.5) * 2 * BOUNDS.maxX;
    const z = BOUNDS.minZ + rng() * (BOUNDS.maxZ - BOUNDS.minZ);
    if (Math.abs(x) < ROAD_HALF + 2 || Math.abs(across(x, z)) < 4 || Math.hypot(x, z) < 6) continue;
    if (Math.hypot(x - BROKEN_CAR.x, z - BROKEN_CAR.z) < 5) continue;
    const rock = createAsset('rock');
    const s = 0.4 + rng() * 0.9;
    rock.scale.setScalar(s);
    rock.position.set(x, s * 0.25, z);
    root.add(rock);
  }
  const mesa = new THREE.MeshStandardMaterial({ color: 0xb8683f, roughness: 1, flatShading: true });
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const r = 170 + rng() * 110;
    const w = 20 + rng() * 40;
    const h = 14 + rng() * 26;
    const mx = Math.cos(a) * r;
    const mz = Math.sin(a) * r;
    if (Math.abs(across(mx, mz)) < w + 12) continue; // the line runs clear of them
    const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.8, w, h, 7), mesa);
    m.position.set(mx, h / 2 - 1, mz);
    m.rotation.y = rng() * Math.PI;
    root.add(m);
  }
}

// A broken-down car off the road, bonnet up, one wheel off — the dummy's spot.
function buildBrokenCar(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const c = BROKEN_CAR;
  const paint = new THREE.MeshStandardMaterial({ color: 0x5f8f8a, roughness: 0.8, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.3, metalness: 0.3 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(c.x + x, y, c.z + z);
    m.castShadow = true;
    root.add(m);
    return m;
  };
  const body = box(1.9, 0.6, 4.2, 0, 0.55, 0, paint);
  body.rotation.z = 0.06; // sagging on its missing wheel
  box(1.7, 0.55, 2.0, 0, 1.12, 0.35, glass);
  box(1.74, 0.08, 2.04, 0, 1.43, 0.35, paint);
  const bonnet = box(1.8, 0.06, 1.3, 0, 1.05, -1.9, paint);
  bonnet.rotation.x = -0.9; // propped open
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
  for (const [x, z] of [[-0.95, -1.35], [0.95, 1.35], [-0.95, 1.35]] as const) {
    const w = new THREE.Mesh(wheelGeo, dark);
    w.rotation.z = Math.PI / 2;
    w.position.set(c.x + x, 0.36, c.z + z);
    root.add(w);
  }
  const loose = new THREE.Mesh(wheelGeo, dark); // the one that came off, lying flat
  loose.position.set(c.x - 1.9, 0.13, c.z - 2.4);
  root.add(loose);
  for (let dz = -2; dz <= 2; dz += 1) ctx.addObstacle({ x: c.x, z: c.z + dz, radius: 1.05 });
}

// The crash-test dummy (the jointed 'dummy' asset), slumped against the car.
// Carry it, throw it; once it's lying still, `restingAt` gives its middle. The
// train hitting it calls `smash`: limbs everywhere, and a chalk outline.
function spawnDummy(ctx: GameContext): { restingAt: () => THREE.Vector3 | null; smash: () => void } {
  const root = ctx.levelRoot;
  const body = createAsset('dummy') as THREE.Group;
  body.scale.setScalar(0.85);
  body.rotation.order = 'YXZ'; // yaw, then lean/lie
  const part = (n: string) => body.getObjectByName(n) as THREE.Object3D;
  const legs = [part('legL'), part('legR')];
  const arms = [part('armL'), part('armR')];
  // Sitting against the car's roadside flank, legs out toward the road.
  body.position.set(BROKEN_CAR.x + 1.25, -0.5, BROKEN_CAR.z + 0.4);
  body.rotation.set(-0.35, Math.PI / 2, 0);
  for (const l of legs) l.rotation.x = -Math.PI / 2;
  arms[0].rotation.z = -0.25;
  arms[1].rotation.z = 0.25;
  part('head').rotation.z = 0.35;
  root.add(body);

  let state: 'sit' | 'held' | 'flying' | 'rest' | 'gone' = 'sit';
  const right = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const limp = () => {
    for (const l of legs) l.rotation.set(0, 0, 0);
    arms[0].rotation.set(0, 0, -0.15);
    arms[1].rotation.set(0, 0, 0.15);
  };
  const carry: Carryable = {
    kind: 'dummy',
    object: body,
    heldDist: 1.1,
    heldDrop: 0.55,
    heldRight: 0,
    // Carried across you, sideways, centred in front.
    heldUpdate: (_dt, o, _q, f) => {
      right.set(-f.z, 0, f.x).normalize();
      o.rotation.set(0, Math.atan2(f.x, f.z), Math.PI / 2);
      o.position.addScaledVector(right, -0.62);
    },
    clickThrows: true,
    onGrab: () => {
      state = 'held';
      limp();
      body.position.y = Math.max(body.position.y, 0);
    },
    onThrow: (charge) => {
      state = 'flying';
      const v = new THREE.Vector3();
      ctx.camera.getWorldDirection(v);
      v.y = 0;
      v.normalize().multiplyScalar(3.5 + 4 * charge).setY(3.5); // heavy: a heave, not a throw
      ctx.launchProjectile(body, v, {
        radius: 0.35,
        restitution: 0.1,
        gravity: 14,
        onSettle: () => {
          if (state !== 'flying') return;
          state = 'rest';
          // Flat on its back, limbs splayed.
          body.rotation.set(-Math.PI / 2, body.rotation.y, 0);
          body.position.y = 0.12;
          arms[0].rotation.set(0, 0, -1.2);
          arms[1].rotation.set(0, 0, 1.2);
          legs[0].rotation.set(0, 0, -0.3);
          legs[1].rotation.set(0, 0, 0.3);
          thud();
        },
      });
    },
  };
  ctx.addCarryable(carry);

  return {
    restingAt: () => (state === 'rest' ? body.localToWorld(mid.set(0, 0.8, 0)) : null),
    smash: () => {
      if (state === 'gone') return;
      state = 'gone';
      ctx.removeCarryable(carry);
      const at = body.localToWorld(new THREE.Vector3(0, 0.8, 0));
      const outline = createAsset('crime-outline');
      outline.position.set(at.x, 0.03, at.z);
      outline.rotation.y = Math.random() * Math.PI * 2;
      root.add(outline);
      // Every part flies off down the line, tumbling, then lands and stays.
      const bits = [...body.children].map((o) => {
        root.attach(o);
        const vel = TRACK_DIR.clone().multiplyScalar(16 + Math.random() * 16)
          .addScaledVector(TRACK_N, (Math.random() - 0.5) * 10)
          .setY(5 + Math.random() * 8);
        const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(18);
        return { o, vel, spin, done: false };
      });
      root.remove(body);
      thud();
      addUpdater((dt) => {
        let flying = 0;
        for (const b of bits) {
          if (b.done) continue;
          flying++;
          b.vel.y -= 14 * dt;
          b.o.position.addScaledVector(b.vel, dt);
          b.o.rotation.x += b.spin.x * dt;
          b.o.rotation.y += b.spin.y * dt;
          b.o.rotation.z += b.spin.z * dt;
          if (b.o.position.y < 0.1) {
            b.o.position.y = 0.1;
            b.vel.multiplyScalar(0.35);
            b.vel.y = Math.abs(b.vel.y) * 0.3;
            b.spin.multiplyScalar(0.4);
            if (b.vel.length() < 0.6) b.done = true;
          }
        }
        return flying === 0;
      });
    },
  };
}

// The pedestrian button on the near barrier post: PRESS TO CROSS. It lights
// WAIT. That is all it has ever done. (A red herring — and a button.)
function buildWaitButton(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const x = ON_ROAD;
  const z = CROSS.z + BARRIER_DZ + 0.26; // on the post's face toward you
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.4, 0.14),
    new THREE.MeshStandardMaterial({ color: 0xe8c21e, roughness: 0.6 }),
  );
  housing.position.set(x, 1.05, z);
  root.add(housing);
  const button = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5 }),
  );
  button.rotation.x = Math.PI / 2;
  button.position.set(x, 0.97, z + 0.08);
  root.add(button);

  const label = (lit: boolean) => {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 64;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#16140f';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = lit ? '#ffb22e' : '#3a2f1a';
    g.font = `bold 40px ${FONT_DISPLAY}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('WAIT', 64, 34);
    return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) });
  };
  const off = label(false);
  const on = label(true);
  const lamp = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), off);
  lamp.position.set(x, 1.15, z + 0.075);
  root.add(lamp);

  let presses = 0;
  let sink = 0;
  registerInteractable({
    id: 'desert-wait-button',
    position: new THREE.Vector3(x, 1.0, z),
    radius: 2.0,
    promptLabel: 'PRESS',
    onUse: () => {
      presses++;
      click();
      lamp.material = on;
      sink = 1;
      discover('mech:wait-button');
      const line = WAIT_LINES[presses];
      if (line) ctx.narrate(line, 5000, { priority: true });
    },
    tick: (dt) => {
      if (sink <= 0) return;
      sink = Math.max(0, sink - dt * 5);
      button.position.z = z + 0.08 - 0.025 * sink;
    },
  });
}
