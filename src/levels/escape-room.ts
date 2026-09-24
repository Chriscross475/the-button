import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { defineCombine } from '../game/combine';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { registerInteractable } from '../interactables/system';
import type { Interactable } from '../interactables/types';
import { tone, noise, ensureAudio, pop, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { hideRoomShell } from './scaffold';
import { buildExitRoom } from './exit-room';
import { spawnUvTorch, uvInk as registerUvInk } from '../objects/uv-torch';
import { setScriptHints } from '../objects/script';
import { FONT_DISPLAY, FONT_VOICE } from '../ui/fonts';

// THE ESCAPE ROOM — a parody. The white room becomes a themed escape room:
// padlocked boxes, a chest with a three-dial combination lock, a UV torch,
// cryptic posters, and a big countdown from 60:00 (it runs twenty times too
// fast). The narrator is the game master, on a crackly walkie-talkie, and his
// hints start early and get more and more desperate.
//
// The joke: the exit door was never locked. Push it (press it, or just walk
// into it) and it swings open onto an exit room.
//
// The proper way, for a smug reward: the code is 4-7-2 —
//   4: the number of ducks in the painting;
//   7: written in UV ink on the "SECOND DIGIT" poster (hold the torch);
//   2: the stopped clock ("the last digit is on the clock").
// Dial it in on the chest, take the key, use it on the door.
//
// At 00:00 the game master just opens the door for you, disappointed.

const HALF = 4; // the room: 8 × 8, walls at ±HALF
const H = 3;
const T = 0.2; // wall thickness
const FACE = HALF - T / 2; // a wall's inner face (±3.9)
const DOOR_HALF = 0.7;
const DOOR_H = 2.3;
const CHEST = new THREE.Vector3(2.4, 0, -2.3);
const CODE = [4, 7, 2];
const TIME_SPEED = 20; // game-seconds per real second: 60:00 in three minutes

const INTRO = vo('Welcome to the escape room. You have sixty minutes. Everything you need is in this room. I am your game master. I will be watching. I will be helping. Mostly watching.');
const HINTS = vo([
  'Game master here. Everything you need is in the room. Look around. Touch things. Not everything.',
  'Have you looked at the posters? People love the posters.',
  'There is a torch. A purple one. Shine it at things. At the posters, ideally.',
  'Right. Just checking. Have you tried the door?',
  'The door. The big one. With EXIT on it. Push it.',
]);
const DOOR_OPEN = vo('It was open. It was always open. The locks are decorative. Like me. Well done, I suppose.');
const PROPER = vo('You found the code, you opened the chest, you used the key. On a door that was never locked. Nobody has ever done it properly. I am genuinely moved.');
const CHEST_OPEN = vo('Four, seven, two. The chest opens. A key. How traditional.');
const DECOY = vo('That box is locked. It is a decoy. It says DECOY on the bottom. You would have to open it to read that.');
const TIME_UP = vo('Time is up. I am legally obliged to let you out. The door was open, by the way. The whole time. Off you go.');
const UV_ON = vo('The torch. Purple. Everything looks like a crime scene now. Point it at the posters.');

// ── Global recipe (the live room wires it) ──
let useKey: (() => void) | null = null;
defineCombine('escape-key', 'escape-door', (held, _t, env) => {
  env.carry.removeCarryable(held);
  held.object.parent?.remove(held.object); // it stays in the lock
  useKey?.();
});

// ── Sounds (composed from the shared primitives) ──
function crackle(): void {
  ensureAudio();
  noise(0.35, 0.09, 1800, 'bandpass');
  tone({ type: 'square', from: 1200, to: 900, dur: 0.06, gain: 0.03 });
}
function lockClick(): void {
  ensureAudio();
  tone({ type: 'square', from: 700, to: 400, dur: 0.05, gain: 0.1 });
  noise(0.04, 0.12, 3000, 'highpass');
}
function dialTick(): void {
  ensureAudio();
  tone({ type: 'triangle', from: 1900, dur: 0.03, gain: 0.06 });
}
function creak(): void {
  ensureAudio();
  tone({ type: 'sawtooth', from: 110, to: 70, dur: 0.9, gain: 0.05, attack: 0.1 });
  noise(0.8, 0.03, 400, 'lowpass');
}

// Canvas text helper: shrink each line to fit the width.
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, style = ''): void {
  let px = size;
  do g.font = `${style} ${px}px ${FONT_VOICE}`;
  while (g.measureText(text).width > maxW && --px > 8);
  g.fillText(text, x, y);
}

export function revealEscapeRoom(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false });
  hideRoomShell(ctx); // the white box is swapped for the escape room
  ctx.scene.background = new THREE.Color(0x14110f);
  ctx.scene.fog = new THREE.Fog(0x14110f, 14, 40);

  // Into the room, wherever you stood.
  const cam = ctx.camera.position;
  cam.x = THREE.MathUtils.clamp(cam.x, -HALF + 0.8, HALF - 0.8);
  cam.z = THREE.MathUtils.clamp(cam.z, -1, HALF - 0.8);
  const room = { minX: -HALF + 0.1, maxX: HALF - 0.1, minZ: -HALF + 0.1, maxZ: HALF - 0.1, floorY: 0 };
  ctx.setRegions([room]);

  // Light: warm and a little theatrical.
  root.add(new THREE.HemisphereLight(0xffe2c0, 0x2a2018, 0.8));
  const key = new THREE.DirectionalLight(0xffe6c8, 0.5);
  key.position.set(2, 6, 3);
  root.add(key);

  // ── The room: floor, ceiling, four walls (a doorway in the back one) ──
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3f4a3c, roughness: 0.95 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.8 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  root.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 1, side: THREE.DoubleSide }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  root.add(ceil);
  box(HALF * 2 + T, H, T, 0, H / 2, HALF, wallMat); // front
  box(T, H, HALF * 2, -HALF, H / 2, 0, wallMat); // left
  box(T, H, HALF * 2, HALF, H / 2, 0, wallMat); // right
  const side = HALF - DOOR_HALF;
  box(side, H, T, -(DOOR_HALF + side / 2), H / 2, -HALF, wallMat); // back, left of the door
  box(side, H, T, DOOR_HALF + side / 2, H / 2, -HALF, wallMat); // back, right of it
  box(DOOR_HALF * 2, H - DOOR_H, T, 0, DOOR_H + (H - DOOR_H) / 2, -HALF, wallMat); // over it

  // The exit room, behind the back wall (built now, out of sight).
  // (set back far enough that its brown cabin shell — 0.35 m bigger than the white
  // box — stays behind our back wall instead of poking through it)
  const exitRoom = buildExitRoom(ctx, { center: new THREE.Vector3(0, 0, -HALF - T / 2 - 4.5 - 0.6), facing: 'posZ' });

  // The door: hinged at its left jamb, "EXIT" over it, a padlock hanging off a
  // nail beside the hasp — not through it.
  const hinge = new THREE.Group();
  hinge.position.set(-DOOR_HALF, 0, -FACE + 0.04);
  root.add(hinge);
  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR_HALF * 2, DOOR_H, 0.08), new THREE.MeshStandardMaterial({ color: 0x6b2e1e, roughness: 0.8 }));
  doorLeaf.position.set(DOOR_HALF, DOOR_H / 2, 0);
  hinge.add(doorLeaf);
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a83a, roughness: 0.35, metalness: 0.8 });
  const hasp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.03), brass);
  hasp.position.set(DOOR_HALF * 2 - 0.2, 1.1, 0.06);
  hinge.add(hasp);
  const padlock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.05), brass);
  padlock.position.set(DOOR_HALF * 2 - 0.2, 0.92, 0.07);
  padlock.rotation.z = 0.35; // dangling, obviously not locking anything
  hinge.add(padlock);
  const exitCv = document.createElement('canvas');
  exitCv.width = 256;
  exitCv.height = 96;
  const eg = exitCv.getContext('2d')!;
  eg.fillStyle = '#0d3a1a';
  eg.fillRect(0, 0, 256, 96);
  eg.fillStyle = '#7dff9a';
  eg.textAlign = 'center';
  eg.textBaseline = 'middle';
  fitText(eg, 'EXIT', 128, 50, 220, 64, 'bold');
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(exitCv) }));
  exitSign.position.set(0, DOOR_H + 0.3, -FACE + 0.12);
  root.add(exitSign);

  // ── Framed posters/boards on the walls (frame + face, clear of the wall) ──
  const board = (w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, Hh: number) => void, pos: THREE.Vector3, rotY: number) => {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = Math.round((512 * h) / w);
    const g = cv.getContext('2d')!;
    draw(g, cv.width, cv.height);
    const tex = new THREE.CanvasTexture(cv);
    const grp = new THREE.Group();
    grp.position.copy(pos);
    grp.rotation.y = rotY;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.04), trim);
    frame.position.z = 0.02;
    grp.add(frame);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.z = 0.05;
    grp.add(face);
    root.add(grp);
    return { grp, tex, cv, g };
  };
  const paper = (g: CanvasRenderingContext2D, W: number, Hh: number) => {
    g.fillStyle = '#e9dfc5';
    g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#2a1d14';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
  };
  // Left wall (faces +X): the painting of ducks (count them: 4) and "FIRST DIGIT".
  const LEFT = -FACE + 0.06;
  board(1.4, 1.0, (g, W, Hh) => {
    g.fillStyle = '#8fc0e0';
    g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#5d9a4a';
    g.fillRect(0, Hh * 0.62, W, Hh * 0.38);
    const duck = (x: number, y: number, s: number) => {
      g.fillStyle = '#ffcc22';
      g.beginPath();
      g.ellipse(x, y, 34 * s, 22 * s, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(x + 26 * s, y - 22 * s, 15 * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ff8800';
      g.fillRect(x + 38 * s, y - 25 * s, 16 * s, 7 * s);
    };
    duck(110, Hh * 0.72, 1.1);
    duck(250, Hh * 0.78, 0.9);
    duck(380, Hh * 0.7, 1.2);
    duck(190, Hh * 0.86, 0.7);
  }, new THREE.Vector3(LEFT, 1.7, -1.2), Math.PI / 2);
  board(0.9, 0.5, (g, W, Hh) => {
    paper(g, W, Hh);
    fitText(g, 'THE FIRST DIGIT', W / 2, Hh * 0.35, W - 40, 44, 'bold');
    fitText(g, 'is how many are swimming.', W / 2, Hh * 0.68, W - 40, 34, 'italic');
  }, new THREE.Vector3(LEFT, 1.6, 0.6), Math.PI / 2);
  // Right wall (faces −X): "SECOND DIGIT" (UV), the clock (2), "LAST DIGIT".
  const RIGHT = FACE - 0.06;
  const second = board(0.9, 0.7, (g, W, Hh) => {
    paper(g, W, Hh);
    fitText(g, 'THE SECOND DIGIT', W / 2, Hh * 0.25, W - 40, 44, 'bold');
    fitText(g, 'is written here.', W / 2, Hh * 0.5, W - 40, 34, 'italic');
    fitText(g, '(You cannot see it. That is the point.)', W / 2, Hh * 0.75, W - 40, 26, 'italic');
  }, new THREE.Vector3(RIGHT, 1.65, 0.8), -Math.PI / 2);
  // The UV ink: a separate, self-lit overlay just in front, visible only where
  // the torch's beam falls (the shared uvInk system).
  const uvMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false });
  const uvCv = document.createElement('canvas');
  uvCv.width = 512;
  uvCv.height = 398;
  const ug = uvCv.getContext('2d')!;
  ug.fillStyle = '#c070ff';
  ug.textAlign = 'center';
  ug.textBaseline = 'middle';
  fitText(ug, '7', 400, 250, 120, 220, 'bold');
  uvMat.map = new THREE.CanvasTexture(uvCv);
  const uvInk = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), uvMat);
  uvInk.position.z = 0.07;
  second.grp.add(uvInk);
  registerUvInk(uvInk);
  // …and more UV ink: on the floor in front of the door, in big letters.
  const floorCv = document.createElement('canvas');
  floorCv.width = 512;
  floorCv.height = 256;
  const fg = floorCv.getContext('2d')!;
  fg.fillStyle = '#c070ff';
  fg.textAlign = 'center';
  fg.textBaseline = 'middle';
  fitText(fg, 'LOOK AT THE PADLOCK.', 256, 96, 480, 64, 'bold');
  fitText(fg, 'REALLY LOOK.', 256, 176, 480, 52, 'bold');
  const floorInk = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(floorCv), transparent: true, depthWrite: false }));
  floorInk.rotation.x = -Math.PI / 2;
  floorInk.position.set(0, 0.03, -HALF + 1.4);
  root.add(floorInk);
  registerUvInk(floorInk);
  // The clock, stopped at two.
  const clock = new THREE.Group();
  clock.position.set(RIGHT, 2.1, -1.4);
  clock.rotation.y = -Math.PI / 2;
  const clockFace = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.6 }));
  clockFace.rotation.x = Math.PI / 2;
  clockFace.position.z = 0.03;
  clock.add(clockFace);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 8, 32), trim);
  rim.position.z = 0.05;
  clock.add(rim);
  const handMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
  for (const [len, ang] of [[0.2, -Math.PI / 6 * 2], [0.28, 0]] as const) {
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.025, len, 0.01), handMat);
    hand.geometry.translate(0, len / 2, 0);
    hand.position.z = 0.065;
    hand.rotation.z = ang; // hour hand at two, minute hand at twelve
    clock.add(hand);
  }
  root.add(clock);
  board(0.9, 0.5, (g, W, Hh) => {
    paper(g, W, Hh);
    fitText(g, 'THE LAST DIGIT', W / 2, Hh * 0.35, W - 40, 44, 'bold');
    fitText(g, 'Time stood still for it.', W / 2, Hh * 0.68, W - 40, 34, 'italic');
  }, new THREE.Vector3(RIGHT, 1.35, -1.4), -Math.PI / 2);

  // The countdown, over the door.
  const timer = board(1.4, 0.5, () => {}, new THREE.Vector3(1.5, 2.45, -FACE + 0.06), 0);
  const drawTimer = (secs: number) => {
    const g = timer.g;
    g.fillStyle = '#0b0c0f';
    g.fillRect(0, 0, timer.cv.width, timer.cv.height);
    g.fillStyle = secs < 600 ? '#ff3b2e' : '#ffb22e';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const s = Math.max(0, Math.ceil(secs));
    fitText(g, `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, timer.cv.width / 2, timer.cv.height / 2 + 4, timer.cv.width - 30, 140, 'bold');
    timer.tex.needsUpdate = true;
  };
  drawTimer(3600);

  // ── The chest with the dial lock, and two decoy boxes ──
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4f2c, roughness: 0.85 });
  const chest = new THREE.Group();
  chest.position.copy(CHEST);
  chest.rotation.y = -0.5;
  root.add(chest);
  const chestBody = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.7), wood);
  chestBody.position.y = 0.275;
  chest.add(chestBody);
  const lidHinge = new THREE.Group();
  lidHinge.position.set(0, 0.55, -0.35);
  chest.add(lidHinge);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.12, 0.72), wood);
  lid.position.set(0, 0.06, 0.35);
  lidHinge.add(lid);
  const lockPlate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.03), brass);
  lockPlate.position.set(0, 0.36, 0.36);
  chest.add(lockPlate);
  ctx.addObstacle({ x: CHEST.x, z: CHEST.z, radius: 0.75 });
  // Three dials (each a canvas-drawn digit on a little drum).
  const digits = [0, 0, 0];
  const dials: { mesh: THREE.Mesh; tex: THREE.CanvasTexture; cv: HTMLCanvasElement }[] = [];
  for (let i = 0; i < 3; i++) {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 64;
    const tex = new THREE.CanvasTexture(cv);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.04), new THREE.MeshBasicMaterial({ map: tex }));
    mesh.position.set(-0.15 + i * 0.15, 0.36, 0.39);
    chest.add(mesh);
    dials.push({ mesh, tex, cv });
  }
  const drawDial = (i: number, lit: boolean) => {
    const g = dials[i].cv.getContext('2d')!;
    g.fillStyle = lit ? '#fff2c0' : '#e8e2d0';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1a1a1a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 46px ${FONT_DISPLAY}`;
    g.fillText(String(digits[i]), 32, 35);
    dials[i].tex.needsUpdate = true;
  };
  for (let i = 0; i < 3; i++) drawDial(i, false);
  // Decoy boxes, padlocked for real.
  const decoy = new THREE.Group();
  decoy.position.set(-2.6, 0, -2.4);
  root.add(decoy);
  for (let k = 0; k < 2; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.7 - k * 0.15, 0.45, 0.5 - k * 0.1), wood);
    b.position.set(0, 0.225 + k * 0.45, 0);
    b.rotation.y = k * 0.3;
    decoy.add(b);
    const pl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.05), brass);
    pl.position.set(0, 0.2 + k * 0.45, 0.28 - k * 0.05);
    decoy.add(pl);
  }
  ctx.addObstacle({ x: -2.6, z: -2.4, radius: 0.6 });

  // A little table by the front wall with the UV torch on it.
  const table = box(1.0, 0.75, 0.6, -2.4, 0.375, 2.6, wood);
  table.castShadow = true;
  ctx.addObstacle({ x: -2.4, z: 2.6, radius: 0.6 });
  // The UV torch (the shared, persistent one: it comes with you).
  let saidUv = false;
  spawnUvTorch(ctx, new THREE.Vector3(-2.4, 0.8, 2.6), {
    rotY: 0.8,
    onGrab: () => {
      discover('mech:uv-torch');
      if (!saidUv) {
        saidUv = true;
        ctx.narrate(UV_ON, 5000, { priority: true });
      }
    },
  });

  // ── Door: push it (the joke), or use the key (properly) ──
  let doorOpen = false;
  let over = false;
  const openDoor = (how: 'push' | 'key' | 'time') => {
    if (doorOpen) return;
    doorOpen = true;
    over = true;
    creak();
    ctx.setRegions([
      room,
      // The doorway reaches well into both rooms (≥ 2 × the player radius).
      { minX: -DOOR_HALF + 0.1, maxX: DOOR_HALF - 0.1, minZ: -HALF - 1.9, maxZ: -HALF + 0.9, floorY: 0 },
      exitRoom,
    ]);
    let t = 0;
    addUpdater((dt) => {
      t = Math.min(1, t + dt / 1.1);
      hinge.rotation.y = 1.7 * (1 - Math.pow(1 - t, 3)); // swings out, away from you (−Z)
      return t >= 1;
    });
    if (how === 'key') {
      sparkle();
      discover('reward:escaped-properly');
      ctx.narrate(PROPER, 8000, { priority: true });
    } else if (how === 'push') {
      discover('mech:escape-door');
      crackle();
      ctx.narrate(DOOR_OPEN, 6000, { priority: true });
    } else {
      crackle();
      ctx.narrate(TIME_UP, 7000, { priority: true });
    }
  };
  useKey = () => {
    lockClick();
    openDoor('key');
  };
  ctx.addTarget({ kind: 'escape-door', position: new THREE.Vector3(0, 1, -FACE), radius: 1.8 });
  const doorUse: Interactable = {
    id: 'escape-door',
    position: new THREE.Vector3(0, 1, -FACE + 0.2),
    radius: 1.8,
    promptLabel: 'PUSH',
    canUse: () => !doorOpen,
    onUse: () => openDoor('push'),
  };
  registerInteractable(doorUse);
  registerInteractable({
    id: 'escape-decoy',
    position: new THREE.Vector3(-2.6, 0.6, -2.4),
    radius: 1.6,
    promptLabel: 'OPEN',
    onUse: () => {
      lockClick();
      ctx.narrate(DECOY, 5500, { priority: true });
    },
  });

  // ── The dial lock: aim at a dial, press to turn it ──
  let chestOpen = false;
  const aim = new THREE.Raycaster();
  aim.far = 3;
  const CROSSHAIR = new THREE.Vector2(0, 0);
  let sel = -1;
  const dialUse: Interactable = {
    id: 'escape-dials',
    position: CHEST.clone().setY(0.4),
    radius: 2.2,
    promptLabel: '',
    onUse: () => {
      if (sel < 0 || chestOpen) return;
      digits[sel] = (digits[sel] + 1) % 10;
      dialTick();
      drawDial(sel, true);
      if (digits.every((d, i) => d === CODE[i])) openChest();
    },
  };
  registerInteractable(dialUse);
  const openChest = () => {
    chestOpen = true;
    lockClick();
    pop();
    ctx.narrate(CHEST_OPEN, 4500, { priority: true });
    let t = 0;
    addUpdater((dt) => {
      t = Math.min(1, t + dt / 0.8);
      lidHinge.rotation.x = -1.6 * t;
      return t >= 1;
    });
    // The key, sitting inside.
    const k = createAsset('key');
    k.position.copy(chest.localToWorld(new THREE.Vector3(0, 0.62, 0)));
    k.rotation.set(Math.PI / 2, 0, 0.4);
    root.add(k);
    ctx.addCarryable({ kind: 'escape-key', object: k, heldDist: 0.6, heldDrop: 0.28 });
  };

  // ── Per frame: dials, UV ink, bumping the door, the clock, the hints ──
  let clockSecs = 3600;
  let hintAt = 12; // the first hint comes early
  let hintN = 0;
  let pushT = 0;
  let introT = 0;
  addUpdater((dt) => {
    // Which dial is under the crosshair.
    let next = -1;
    if (!chestOpen) {
      aim.setFromCamera(CROSSHAIR, ctx.camera);
      const hit = aim.intersectObjects(dials.map((d) => d.mesh), false)[0];
      if (hit) next = dials.findIndex((d) => d.mesh === hit.object);
    }
    if (next !== sel) {
      if (sel >= 0) drawDial(sel, false);
      sel = next;
      if (sel >= 0) drawDial(sel, true);
    }
    dialUse.promptLabel = sel >= 0 ? 'TURN' : '';

    // Walking into the door pushes it open too.
    const p = ctx.playerPos();
    if (!doorOpen && Math.abs(p.x) < DOOR_HALF && p.z < -HALF + 0.55) {
      pushT += dt;
      if (pushT > 0.35) openDoor('push');
    } else pushT = 0;

    if (over) return false;
    introT += dt;
    // The countdown (twenty times too fast), redrawn when the shown second changes.
    const shown = Math.ceil(clockSecs);
    clockSecs -= dt * TIME_SPEED;
    if (Math.ceil(clockSecs) !== shown) drawTimer(clockSecs);
    if (clockSecs <= 0) {
      drawTimer(0);
      openDoor('time');
      return false;
    }
    // Hints: early, then every half-minute or so, getting more desperate; the
    // last one repeats. (Queued, never cutting anything off.)
    if (introT > hintAt) {
      crackle();
      ctx.narrate(HINTS[Math.min(hintN, HINTS.length - 1)], 5500);
      hintN++;
      hintAt = introT + (hintN < 3 ? 22 : 28);
    }
    return false;
  });

  escapeRoomTest.turn = (i: number) => {
    sel = i;
    dialUse.onUse();
  };
  escapeRoomTest.state = () => ({ doorOpen, chestOpen, clockSecs });
  escapeRoomTest.useKey = () => useKey?.();
  crackle();
  setScriptHints(HINTS); // the Script, if you have it, reads the game master's hints
  ctx.narrate(INTRO, 8000);
}

/** Headless-test hooks. */
export const escapeRoomTest = {
  CODE,
  CHEST,
  HALF,
  turn: (_i: number) => {},
  useKey: () => {},
  state: () => ({ doorOpen: false, chestOpen: false, clockSecs: 0 }),
};
