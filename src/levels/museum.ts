import * as THREE from 'three';
import type { GameContext, ControlMode } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { spawnPedestalButton, sinkPedestalButton } from '../button/pedestal-button';
import { registerInteractable } from '../interactables/system';
import { buildExitRoom } from './exit-room';
import { hideRoomShell } from './scaffold';
import { tone, noise, ensureAudio, sparkle, thud } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover, isDiscovered } from '../graph/progress';
import { KEY_COLORS } from '../objects/key';

// THE MUSEUM — a hushed gallery about this game. Exhibits on plinths under
// glass: things from the other rooms (a duck, the axe, a model train, the
// wolf, the keys…). The ones you've found have name plaques and an audio-guide
// line; the rest are under a sheet, marked "?".
//
// The centrepiece, behind a velvet rope: THE BUTTON (2026). DO NOT TOUCH. A
// guard stands behind it, watching it — his gaze is the pale cone on the floor.
// Press it while he's looking and you're marched out the back door, no prize.
// Press it unseen and it's the way on (and the heist is yours).
//
// Getting him to look away: he glances aside now and then (a tight window);
// or make a noise — squeeze the giant rubber duck by the entrance (Exhibit 0,
// "please do not squeeze"), or throw something (a duck, the ball, anything
// that lands) — and he walks over to investigate, his back to the button.
// The back door (behind you) is always open: the sensible exit, no prize.

const PH = CONFIG.PLAYER_HEIGHT;
const HALL = { minX: -9, maxX: 9, minZ: -20, maxZ: 12, h: 6 };
const CENTRE = new THREE.Vector3(0, 0, -9); // THE BUTTON
const ROPE_R = 1.4; // half-size of the velvet-rope square around it
const POST = new THREE.Vector3(0, 0, -13.5); // where the guard stands
const SQUEAK = new THREE.Vector3(-3.6, 0, 8.4); // the giant rubber duck
const EXIT = new THREE.Vector3(0, 0, HALL.maxZ + 4.5); // the back-door exit room
const GAZE_RANGE = 11;
const GAZE_HALF = 0.62; // radians (~35°) either side of where he looks
const WALK = 1.7; // his walking speed

const INTRO = vo('Welcome to the museum. Everything in here is something you did. Please do not touch anything. Especially that.');
const CENTREPIECE = vo('And the centrepiece. The Button, twenty twenty-six. Do not touch. He is watching it. He is always watching it.');
const SQUEAK_FIRST = vo('It squeaked. The guard heard it squeak. Everybody heard it squeak.');
const HEARD = vo(['He heard that. He is going to look at it. Thoroughly.', 'Something landed. He has gone to have a word with it.']);
const CAUGHT = vo('He saw that. Of course he saw that. You are being escorted out. Through the back. No gift shop.');
const WIN = vo('You touched it. Nobody saw. The single most important thing you have ever done, and there are no witnesses. Off you go.');
const BACK_DOOR = vo('Leaving already. The gift shop is also closed.');
const UNKNOWN = vo('This one is under a sheet. You have not earned it yet.');

interface Exhibit {
  id: string; // content-graph node that unveils it
  name: string;
  line: string;
  make: () => THREE.Object3D;
}
const EXHIBITS: Exhibit[] = [
  { id: 'item:duck', name: 'A Duck', line: vo('Exhibit one. A duck. You have met. It remembers.'), make: () => scaled(createAsset('duck'), 1.3) },
  { id: 'item:axe', name: 'The Axe', line: vo('Exhibit two. The axe. Trees, planks, fences, ducks. It has had a career.'), make: () => laid(createAsset('axe'), 0.7) },
  { id: 'mech:train', name: 'The Train', line: vo('Exhibit three. The train, to scale. It is still watching you. Do not make eye contact.'), make: () => scaled(createAsset('train'), 0.16) },
  { id: 'reward:baby-wolf', name: 'The Wolf', line: vo('Exhibit four. The wolf. On loan from the duck room. Please do not feed it.'), make: () => scaled(createAsset('wolf'), 0.55) },
  { id: 'item:key', name: 'The Blue Key', line: vo('Exhibit five. A blue key. It opened exactly one door, and then its life was over.'), make: () => scaled(createAsset('key', { color: KEY_COLORS.blue }), 1.3) },
  { id: 'item:key-red', name: 'The Red Key', line: vo('Exhibit six. A red key, found behind a building, in a desert, for some reason.'), make: () => scaled(createAsset('key', { color: KEY_COLORS.red }), 1.3) },
  { id: 'item:dummy', name: 'The Dummy', line: vo('Exhibit seven. The dummy. Run over, obeyed, and dressed as a clown. It asks for nothing.'), make: () => scaled(createAsset('dummy'), 0.34) },
  { id: 'gag:statue', name: 'The Statue', line: vo('Exhibit eight. A statue that fell out of the sky. That was the whole joke.'), make: () => scaled(createAsset('statue'), 0.3) },
  { id: 'mech:campfire', name: 'A Campfire', line: vo('Exhibit nine. A campfire, where a tree used to be. Nature, rearranged.'), make: () => scaled(createAsset('campfire'), 0.55) },
  { id: 'item:basketball', name: 'The Basketball', line: vo('Exhibit ten. The basketball. It has been dunked on. So have you.'), make: makeBall },
];

function scaled(o: THREE.Object3D, s: number): THREE.Object3D {
  o.scale.setScalar(s);
  return o;
}
function laid(o: THREE.Object3D, s: number): THREE.Object3D {
  o.scale.setScalar(s);
  o.rotation.set(0, 0, Math.PI / 2);
  o.position.y = 0.05;
  return o;
}
function makeBall(): THREE.Object3D {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), new THREE.MeshStandardMaterial({ color: 0xd86a23, roughness: 0.85 }));
  m.position.y = 0.2;
  g.add(m);
  return g;
}

// A little squeak: two quick rising chirps.
function squeakSound(): void {
  ensureAudio();
  tone({ type: 'square', from: 900, to: 1500, dur: 0.09, gain: 0.12 });
  window.setTimeout(() => tone({ type: 'square', from: 1100, to: 1800, dur: 0.12, gain: 0.12 }), 110);
}
// A guard's whistle: short, sharp, two blasts.
function whistle(): void {
  ensureAudio();
  tone({ type: 'sine', from: 2600, to: 2500, dur: 0.18, gain: 0.14 });
  noise(0.18, 0.05, 3000, 'bandpass');
  window.setTimeout(() => tone({ type: 'sine', from: 2600, to: 2500, dur: 0.35, gain: 0.14 }), 240);
}

export function revealMuseum(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom();
  ctx.after(1700, () => hideRoomShell(ctx)); // the toppled white walls would lie through the plinths

  // Hushed, warm, a little dim; the white room's short fog must go.
  const bg = new THREE.Color(0x2a2622);
  ctx.scene.background = bg;
  ctx.scene.fog = new THREE.Fog(bg.getHex(), 30, 70);
  root.add(new THREE.HemisphereLight(0xfff1dc, 0x3a3028, 0.9));
  const key = new THREE.DirectionalLight(0xfff4e6, 0.35);
  key.position.set(3, 10, 4);
  root.add(key);

  buildHall(root);
  buildPaintings(root);

  // ── The exhibits: two rows of plinths, facing the aisle ──
  const plinthMat = new THREE.MeshStandardMaterial({ color: 0xece8e0, roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xdfefff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false });
  const sheetMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 1, flatShading: true });
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false });
  const spots: { pos: THREE.Vector3; ex: Exhibit; known: boolean; said: boolean }[] = [];
  const ROW_Z = [4, -1, -6, -11, -16];
  EXHIBITS.forEach((ex, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const pos = new THREE.Vector3(side * 6.4, 0, ROW_Z[Math.floor(i / 2)]);
    const known = isDiscovered(ex.id);
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.9), plinthMat);
    plinth.position.set(pos.x, 0.5, pos.z);
    root.add(plinth);
    const top = new THREE.Group();
    top.position.set(pos.x, 1.0, pos.z);
    top.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; // facing the aisle
    root.add(top);
    if (known) {
      top.add(ex.make());
    } else {
      // Under a sheet: a draped lump.
      const lump = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.38, 0.55, 9), sheetMat);
      lump.position.y = 0.27;
      top.add(lump);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 9, 7), sheetMat);
      head.position.y = 0.55;
      top.add(head);
    }
    const case_ = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.8, 0.84), glassMat);
    case_.position.set(pos.x, 1.4, pos.z);
    root.add(case_);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.1, 24), poolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(pos.x, 0.03, pos.z);
    root.add(pool);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.2), new THREE.MeshBasicMaterial({ map: plaqueTexture(i + 1, known ? ex.name : '?') }));
    plaque.position.set(pos.x - side * 0.46, 0.72, pos.z);
    plaque.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    root.add(plaque);
    ctx.addObstacle({ x: pos.x, z: pos.z, radius: 0.65 });
    spots.push({ pos, ex, known, said: false });
  });

  // ── Exhibit 0: the giant rubber duck. Please do not squeeze. ──
  const rubber = createAsset('duck');
  rubber.scale.setScalar(3.2);
  rubber.position.set(SQUEAK.x, 0.9, SQUEAK.z);
  rubber.rotation.y = -0.6;
  rubber.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && m.color && m.color.r > 0.8 && m.color.g > 0.6) (o as THREE.Mesh).material = new THREE.MeshStandardMaterial({ color: 0xffe14a, roughness: 0.3 });
  });
  root.add(rubber);
  const duckPlinth = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.9, 20), plinthMat);
  duckPlinth.position.set(SQUEAK.x, 0.45, SQUEAK.z);
  root.add(duckPlinth);
  const squeakPlaque = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.24), new THREE.MeshBasicMaterial({ map: plaqueTexture(0, 'Please do not squeeze') }));
  squeakPlaque.position.set(SQUEAK.x + 0.55, 0.6, SQUEAK.z - 0.8);
  squeakPlaque.rotation.y = Math.PI * 0.8;
  root.add(squeakPlaque);
  ctx.addObstacle({ x: SQUEAK.x, z: SQUEAK.z, radius: 1.1 });

  // ── The centrepiece, and its rope ──
  let done = false; // won, or caught
  const button = spawnPedestalButton(root, CENTRE.clone(), () => pressed(), { glow: true });
  button.interactable.radius = ROPE_R + 1.4; // pressable from the rope
  ctx.addObstacle(button.obstacle);
  buildRope(ctx, root);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.42), new THREE.MeshBasicMaterial({ map: plaqueTexture(-1, 'The Button (2026)\nDo not touch.') }));
  sign.position.set(CENTRE.x, 0.95, CENTRE.z + ROPE_R + 0.25);
  sign.rotation.x = -0.35;
  root.add(sign);

  // ── The guard ──
  const guard = makeGuard();
  guard.root.position.copy(POST);
  root.add(guard.root);
  const guardBlock = { x: POST.x, z: POST.z, radius: 0.4 };
  ctx.addObstacle(guardBlock);
  // His gaze on the floor: a pale sector.
  const coneGroup = new THREE.Group();
  const cone = new THREE.Mesh(
    new THREE.CircleGeometry(GAZE_RANGE, 24, -GAZE_HALF, GAZE_HALF * 2),
    new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.1, depthWrite: false }),
  );
  cone.rotation.x = -Math.PI / 2;
  coneGroup.add(cone);
  coneGroup.position.y = 0.04;
  root.add(coneGroup);

  type GState = 'watch' | 'walk' | 'look' | 'return' | 'escort' | 'still';
  let gs: GState = 'watch';
  let bodyYaw = 0; // facing +Z: toward the button (and you)
  let headYaw = 0;
  let glanceT = 6;
  let stateT = 0;
  let stride = 0;
  const target = new THREE.Vector3();
  const noiseAt = new THREE.Vector3();
  const gaze = new THREE.Vector3();

  const walkToward = (to: THREE.Vector3, dt: number): boolean => {
    const d = new THREE.Vector3().subVectors(to, guard.root.position).setY(0);
    const len = d.length();
    if (len < 0.1) return true;
    d.normalize();
    guard.root.position.addScaledVector(d, Math.min(len, WALK * dt));
    bodyYaw = Math.atan2(d.x, d.z);
    stride += dt * 7;
    return false;
  };
  const faceToward = (p: THREE.Vector3) => {
    bodyYaw = Math.atan2(p.x - guard.root.position.x, p.z - guard.root.position.z);
  };
  const sees = (p: THREE.Vector3) => {
    const dx = p.x - guard.root.position.x;
    const dz = p.z - guard.root.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > GAZE_RANGE) return false;
    const yaw = bodyYaw + headYaw;
    gaze.set(Math.sin(yaw), 0, Math.cos(yaw));
    return (gaze.x * dx + gaze.z * dz) / (dist || 1) > Math.cos(GAZE_HALF);
  };

  // A noise pulls him off his post to look at it (unless he's escorting you).
  let heardLine = 0;
  const hear = (at: THREE.Vector3) => {
    if (done || gs === 'escort' || gs === 'still') return;
    noiseAt.copy(at).setY(0);
    // Don't walk into things: stop a couple of metres short.
    target.copy(noiseAt).sub(guard.root.position).setY(0);
    const len = target.length();
    target.normalize().multiplyScalar(Math.max(0, len - 2)).add(guard.root.position);
    target.x = THREE.MathUtils.clamp(target.x, HALL.minX + 1, HALL.maxX - 1);
    target.z = THREE.MathUtils.clamp(target.z, HALL.minZ + 1, HALL.maxZ - 1);
    gs = 'walk';
    headYaw = 0;
    ctx.narrate(HEARD[heardLine++ % HEARD.length], 3500, { interruptible: true });
  };

  // Squeeze the rubber duck.
  let squeakCool = 0;
  let saidSqueak = false;
  let squash = 0;
  registerInteractable({
    id: 'museum-rubber-duck',
    position: SQUEAK.clone().setY(1),
    radius: 2.4,
    promptLabel: 'SQUEEZE',
    onUse: () => {
      if (squeakCool > 0) return;
      squeakCool = 1.2;
      squash = 1;
      squeakSound();
      if (!saidSqueak) {
        saidSqueak = true;
        ctx.narrate(SQUEAK_FIRST, 4000, { priority: true });
        ctx.after(4200, () => hear(SQUEAK));
      } else hear(SQUEAK);
    },
  });

  // Anything thrown that lands (a duck, the ball, the axe…) is a noise too:
  // watch everything that isn't part of the museum for a drop to the floor,
  // away from you (so your own hands don't count).
  const mine = new Set<THREE.Object3D>(root.children);
  const lastY = new WeakMap<THREE.Object3D, number>();
  const watchLandings = () => {
    const p = ctx.playerPos();
    for (const holder of [root, ctx.scene]) {
      for (const o of holder.children) {
        if (mine.has(o) || holder === ctx.scene && o === root) continue;
        const y = o.position.y;
        const prev = lastY.get(o);
        lastY.set(o, y);
        if (prev === undefined || !(prev > 0.6 && y < 0.5)) continue;
        if (Math.hypot(o.position.x - p.x, o.position.z - p.z) < 2) continue;
        if (o.position.x < HALL.minX || o.position.x > HALL.maxX || o.position.z < HALL.minZ || o.position.z > HALL.maxZ) continue;
        thud();
        hear(o.position);
      }
    }
  };

  // ── The press ──
  const pressed = () => {
    if (done) return;
    done = true;
    const p = ctx.playerPos();
    if (sees(p)) {
      // Caught: whistle, the button goes down, and he walks you out the back.
      whistle();
      sinkPedestalButton(button);
      ctx.narrate(CAUGHT, 6000, { priority: true });
      gs = 'escort';
      escortStart();
    } else {
      sparkle();
      discover('reward:museum-heist');
      ctx.narrate(WIN, 6500, { priority: true });
      gs = 'still';
      ctx.after(3500, () => ctx.advance(CENTRE.clone()));
    }
  };

  // The escort: he comes to you, then walks you (camera and all) out through
  // the back door into the exit room, where the plain button moves you on.
  const path = [new THREE.Vector3(0, 0, HALL.maxZ - 1.5), new THREE.Vector3(0, 0, HALL.maxZ + 1.2), new THREE.Vector3(0, 0, EXIT.z - 1)];
  let leg = 0;
  let reached = false;
  const lookAt = new THREE.Vector3();
  const escortMode: ControlMode = {
    update(dt) {
      const cam = ctx.camera.position;
      if (!reached) {
        // he walks up to you first; you stand there, caught
        const at = cam.clone().setY(0);
        if (walkToward(at, dt * 1.8) || guard.root.position.distanceTo(at) < 1.1) reached = true;
        faceToward(at);
        return;
      }
      const to = path[leg];
      const d = new THREE.Vector3(to.x - cam.x, 0, to.z - cam.z);
      const len = d.length();
      if (len < 0.1) {
        leg++;
        if (leg >= path.length) {
          ctx.setControlMode(null);
          gs = 'still';
          return;
        }
        return;
      }
      d.normalize();
      cam.x += d.x * Math.min(len, 2.0 * dt);
      cam.z += d.z * Math.min(len, 2.0 * dt);
      cam.y = PH;
      lookAt.set(cam.x + d.x * 3, PH - 0.2, cam.z + d.z * 3);
      ctx.camera.lookAt(lookAt);
      // he walks beside you, a hand on your shoulder (in spirit)
      guard.root.position.set(cam.x + d.z * 0.8, 0, cam.z - d.x * 0.8);
      bodyYaw = Math.atan2(d.x, d.z);
      stride += dt * 7;
    },
  };
  const escortStart = () => {
    reached = false;
    leg = 0;
    ctx.setControlMode(escortMode);
  };

  // ── Per frame ──
  let saidCentre = false;
  let saidBack = false;
  addUpdater((dt) => {
    const p = ctx.playerPos();
    squeakCool = Math.max(0, squeakCool - dt);
    if (squash > 0) {
      squash = Math.max(0, squash - dt * 4);
      rubber.scale.set(3.2 * (1 + squash * 0.12), 3.2 * (1 - squash * 0.2), 3.2 * (1 + squash * 0.12));
    }
    watchLandings();

    stateT += dt;
    if (gs === 'watch') {
      // At his post, facing the button; now and then he glances aside.
      walkToward(POST, dt);
      if (guard.root.position.distanceTo(POST) < 0.15) bodyYaw = 0;
      glanceT -= dt;
      if (glanceT < 1.4 && glanceT > 0) headYaw = THREE.MathUtils.lerp(headYaw, glanceT > 0.7 ? 1.15 : -1.15, Math.min(1, dt * 6));
      else headYaw = THREE.MathUtils.lerp(headYaw, 0, Math.min(1, dt * 6));
      if (glanceT <= 0) glanceT = 6 + Math.random() * 4;
    } else if (gs === 'walk') {
      if (walkToward(target, dt)) {
        gs = 'look';
        stateT = 0;
      }
    } else if (gs === 'look') {
      faceToward(noiseAt);
      headYaw = Math.sin(stateT * 1.6) * 0.3; // peering at it
      if (stateT > 5) {
        gs = 'return';
        headYaw = 0;
      }
    } else if (gs === 'return') {
      if (walkToward(POST, dt)) {
        gs = 'watch';
        bodyYaw = 0;
      }
    }
    // Walk cycle + pose.
    const moving = gs === 'walk' || gs === 'return' || gs === 'escort';
    const swing = moving ? Math.sin(stride) : 0;
    guard.legL.rotation.x = swing * 0.5;
    guard.legR.rotation.x = -swing * 0.5;
    guard.armL.rotation.x = gs === 'escort' ? -0.4 : -swing * 0.35;
    guard.armR.rotation.x = gs === 'escort' ? -0.9 : swing * 0.35;
    guard.root.rotation.y = bodyYaw;
    guard.head.rotation.y = headYaw;
    guardBlock.x = guard.root.position.x;
    guardBlock.z = guard.root.position.z;
    // The gaze cone follows where he's looking (hidden once it's over).
    coneGroup.visible = !done;
    coneGroup.position.x = guard.root.position.x;
    coneGroup.position.z = guard.root.position.z;
    const yaw = bodyYaw + headYaw;
    coneGroup.rotation.y = Math.atan2(-Math.cos(yaw), Math.sin(yaw)); // sector's +X → his gaze

    // The audio guide: each exhibit's line, once, as you walk up to it.
    for (const s of spots) {
      if (s.said || Math.hypot(p.x - s.pos.x, p.z - s.pos.z) > 2.2) continue;
      s.said = true;
      ctx.narrate(s.known ? s.ex.line : UNKNOWN, 4500, { interruptible: true });
    }
    if (!saidCentre && !done && Math.hypot(p.x - CENTRE.x, p.z - CENTRE.z) < 4.5) {
      saidCentre = true;
      ctx.narrate(CENTREPIECE, 6000, { priority: true });
    }
    if (!saidBack && !done && p.z > HALL.maxZ + 0.5) {
      saidBack = true;
      ctx.narrate(BACK_DOOR, 3500, { priority: true });
    }
    return false;
  });

  // ── The back door: a plain exit room behind where you came in ──
  const room = buildExitRoom(ctx, { center: EXIT, facing: 'negZ' });
  ctx.setRegions([
    { minX: HALL.minX + 0.4, maxX: HALL.maxX - 0.4, minZ: HALL.minZ + 0.4, maxZ: HALL.maxZ - 0.2, floorY: 0 },
    { minX: -1.1, maxX: 1.1, minZ: HALL.maxZ - 1, maxZ: HALL.maxZ + 1, floorY: 0 },
    room,
  ]);

  ctx.narrate(INTRO, 6000);
}

// ── The hall ────────────────────────────────────────────────────────────────

function buildHall(root: THREE.Object3D): void {
  const W = HALL.maxX - HALL.minX;
  const D = HALL.maxZ - HALL.minZ;
  const cx = (HALL.minX + HALL.maxX) / 2;
  const cz = (HALL.minZ + HALL.maxZ) / 2;
  // Polished marble: pale and dark tiles.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    g.fillStyle = (i + j) % 2 ? '#d9d3c7' : '#8c8478';
    g.fillRect(i * 32, j * 32, 32, 32);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(W / 4, D / 4);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.25, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.02, cz);
  root.add(floor);
  // Deep-red gallery walls with a dado rail, and a pale ceiling with skylights.
  const wall = new THREE.MeshStandardMaterial({ color: 0x6e2a2a, roughness: 0.9 });
  const rail = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.5, metalness: 0.4 });
  const side = (len: number, x: number, z: number, rotY: number) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(len, HALL.h), wall);
    w.position.set(x, HALL.h / 2, z);
    w.rotation.y = rotY;
    root.add(w);
    const r = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.08), rail);
    r.position.set(x, 1.0, z);
    r.rotation.y = rotY;
    r.translateZ(0.02);
    root.add(r);
  };
  side(W, cx, HALL.minZ, 0);
  // the entrance wall, with a gap for the back door (x −1.1…1.1)
  side((W - 2.2) / 2, HALL.minX + (W - 2.2) / 4, HALL.maxZ, Math.PI);
  side((W - 2.2) / 2, HALL.maxX - (W - 2.2) / 4, HALL.maxZ, Math.PI);
  const lintel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, HALL.h - 3), wall);
  lintel.position.set(0, 3 + (HALL.h - 3) / 2, HALL.maxZ);
  lintel.rotation.y = Math.PI;
  root.add(lintel);
  side(D, HALL.minX, cz, Math.PI / 2);
  side(D, HALL.maxX, cz, -Math.PI / 2);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 1, side: THREE.DoubleSide }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(cx, HALL.h, cz);
  root.add(ceil);
  const sky = new THREE.MeshBasicMaterial({ color: 0xfff6e4 });
  for (let z = HALL.minZ + 4; z < HALL.maxZ - 2; z += 6) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4), sky);
    s.rotation.x = Math.PI / 2;
    s.position.set(0, HALL.h - 0.02, z);
    root.add(s);
  }
}

// Framed canvases on the walls: the button, a still life of ducks, a white
// square (the white room, of course), and the narrator's portrait (a mic).
function buildPaintings(root: THREE.Object3D): void {
  const frame = new THREE.MeshStandardMaterial({ color: 0xb8913e, roughness: 0.4, metalness: 0.6 });
  const hang = (draw: (g: CanvasRenderingContext2D) => void, w: number, h: number, x: number, y: number, z: number, rotY: number, title: string) => {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = Math.round((256 * h) / w);
    const g = cv.getContext('2d')!;
    draw(g);
    const grp = new THREE.Group();
    grp.position.set(x, y, z);
    grp.rotation.y = rotY;
    const f = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.06), frame);
    grp.add(f);
    const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
    pic.position.z = 0.035;
    grp.add(pic);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.18), new THREE.MeshBasicMaterial({ map: plaqueTexture(-1, title) }));
    label.position.set(w / 2 - 0.25, -h / 2 - 0.35, 0.02);
    grp.add(label);
    root.add(grp);
  };
  // Study in Red.
  hang((g) => {
    g.fillStyle = '#e8e4da'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#6b6b70'; g.fillRect(96, 150, 64, 90);
    const gr = g.createRadialGradient(118, 120, 4, 128, 132, 44);
    gr.addColorStop(0, '#ff9a8c'); gr.addColorStop(0.4, '#e02a1c'); gr.addColorStop(1, '#7e0707');
    g.fillStyle = gr; g.beginPath(); g.ellipse(128, 138, 44, 22, 0, 0, Math.PI * 2); g.fill();
  }, 2.4, 2.4, 0, 3.0, HALL.minZ + 0.05, 0, 'Study in Red');
  // Still Life with Ducks.
  hang((g) => {
    g.fillStyle = '#3c5a3a'; g.fillRect(0, 0, 256, 180);
    g.fillStyle = '#6b4a2b'; g.fillRect(0, 130, 256, 50);
    for (const [x, s] of [[70, 1], [140, 1.2], [200, 0.9]] as const) {
      g.fillStyle = '#ffcc22'; g.beginPath(); g.ellipse(x, 118, 26 * s, 16 * s, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + 20 * s, 96, 11 * s, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ff8800'; g.fillRect(x + 28 * s, 94, 10 * s, 5);
    }
  }, 2.6, 1.8, -5.2, 3.0, HALL.minZ + 0.05, 0, 'Still Life with Ducks');
  // Untitled (White Room).
  hang((g) => {
    g.fillStyle = '#f7f7f5'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#ecece8'; g.lineWidth = 3; g.strokeRect(40, 40, 176, 176);
  }, 2.0, 2.0, 5.2, 3.0, HALL.minZ + 0.05, 0, 'Untitled (White Room)');
  // Portrait of the Narrator.
  hang((g) => {
    g.fillStyle = '#2b2b33'; g.fillRect(0, 0, 256, 320);
    g.fillStyle = '#9a9aa2'; g.beginPath(); g.ellipse(128, 120, 34, 48, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#55555c'; g.fillRect(122, 168, 12, 110);
    g.fillRect(90, 270, 76, 12);
  }, 1.6, 2.0, HALL.minX + 0.05, 3.0, -8, Math.PI / 2, 'Portrait of the Narrator');
  // The Train, Looking at You.
  hang((g) => {
    g.fillStyle = '#ecd3a8'; g.fillRect(0, 0, 320, 200);
    g.fillStyle = '#d6b07a'; g.fillRect(0, 120, 320, 80);
    g.fillStyle = '#24262e'; g.fillRect(150, 96, 30, 26);
    g.fillStyle = '#fff0c2'; g.beginPath(); g.arc(165, 104, 5, 0, Math.PI * 2); g.fill();
  }, 2.4, 1.5, HALL.maxX - 0.05, 3.0, -8, -Math.PI / 2, 'The Train, Looking at You');
}

function buildRope(ctx: GameContext, root: THREE.Object3D): void {
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.35, metalness: 0.7 });
  const velvet = new THREE.MeshStandardMaterial({ color: 0x8e1020, roughness: 0.9 });
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new THREE.Vector3(CENTRE.x + x * ROPE_R, 0, CENTRE.z + z * ROPE_R));
  for (const c of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.95, 10), brass);
    post.position.set(c.x, 0.475, c.z);
    root.add(post);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), brass);
    knob.position.set(c.x, 0.98, c.z);
    root.add(knob);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 14), brass);
    foot.position.set(c.x, 0.02, c.z);
    root.add(foot);
  }
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(a.x, 0.9, a.z),
      new THREE.Vector3((a.x + b.x) / 2, 0.62, (a.z + b.z) / 2),
      new THREE.Vector3(b.x, 0.9, b.z),
    );
    root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.035, 6), velvet));
    for (let t = 0; t <= 1; t += 0.2) {
      ctx.addObstacle({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, radius: 0.22 });
    }
  }
}

// A small brass-on-black plaque: "EXHIBIT n" over the name ("?" if unknown).
// n < 0 prints only the name.
// A brass-framed plaque. Lines are shrunk to fit the width, so a long name
// never runs off the edges. `n` < 0: no EXHIBIT number, `name` split on '\n'.
function plaqueTexture(n: number, name: string): THREE.CanvasTexture {
  const W = 512;
  const H = 144;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#1b1a18';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#c9a86a';
  g.lineWidth = 6;
  g.strokeRect(8, 8, W - 16, H - 16);
  g.fillStyle = '#e8d9b0';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fit = (text: string, style: string, size: number, y: number) => {
    let px = size;
    do {
      g.font = `${style} ${px}px Georgia, serif`;
    } while (g.measureText(text).width > W - 48 && --px > 10);
    g.fillText(text, W / 2, y);
  };
  if (n >= 0) {
    fit(`EXHIBIT ${n}`, '', 30, 44);
    fit(name, 'italic', 44, 96);
  } else {
    const lines = name.split('\n');
    const step = H / (lines.length + 1);
    lines.forEach((l, i) => fit(l, 'italic', 44, step * (i + 1) + 2));
  }
  return new THREE.CanvasTexture(cv);
}

// The guard: the jointed dummy in navy with a peaked cap.
function makeGuard(): { root: THREE.Group; head: THREE.Object3D; legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D } {
  const g = createAsset('dummy') as THREE.Group;
  const navy = new THREE.MeshStandardMaterial({ color: 0x1f2a44, roughness: 0.8 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x151a26, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a57a, roughness: 0.8 });
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.material = o.parent?.name?.startsWith('leg') ? trousers : navy;
  });
  const head = g.getObjectByName('head') as THREE.Mesh;
  head.material = skin;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.12, 14), navy);
  cap.position.y = 0.18;
  head.add(cap);
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.02, 0.12), new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.4 }));
  peak.position.set(0, 0.13, 0.16);
  head.add(peak);
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.04, 10), new THREE.MeshStandardMaterial({ color: 0xd8b94a, roughness: 0.3, metalness: 0.8 }));
  badge.position.set(0.12, 1.2, 0.145);
  g.add(badge);
  return {
    root: g,
    head,
    legL: g.getObjectByName('legL') as THREE.Object3D,
    legR: g.getObjectByName('legR') as THREE.Object3D,
    armL: g.getObjectByName('armL') as THREE.Object3D,
    armR: g.getObjectByName('armR') as THREE.Object3D,
  };
}
