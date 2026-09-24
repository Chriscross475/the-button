import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { spawnPedestalButton, type SpawnedButton } from '../button/pedestal-button';
import { registerInteractable } from '../interactables/system';
import { setYaw, setPitch, setEyeHeight } from '../controls/player-camera';
import { tone, noise, ensureAudio, thud, sparkle, fanfare, pop } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { spinnerSpeed } from '../objects/spinner';
import { FONT_VOICE, FONT_SIGN } from '../ui/fonts';
import { hideRoomShell } from './scaffold';

// THE MARSHMALLOW TEST — a pastel 1970s observation room: a button on a plinth,
// a chair, a wall clock, a plate with one marshmallow, and a one-way mirror with
// researchers behind it. The narrator is the researcher: don't press the button
// for "ten minutes" and you get TWO buttons.
//
//   Press early      → noted, mildly disappointed, on you go.
//   Wait it out      → a second button rises beside the first ("THE SAME
//                      BUTTON"). Press ONE → "you pressed one of two", on you go.
//                      Press BOTH at once (two hands: left + right click, or the
//                      L + R touch buttons — two presses inside TWIN_WINDOW_MS)
//                      → the good ending.
//   While waiting    → the researcher tries to break you: escalating lines, the
//                      button glows, a whisper, the clock stops, knocks on the
//                      glass. Sitting in the chair and the SPINNER both make the
//                      test clock run faster.
//   The marshmallow  → tap to eat it (the control group), or throw it — or
//                      anything — at the mirror: it cracks, the researchers
//                      scatter, and nobody is watching any more.
//   (Hook: a STOPWATCH item, if one ever exists, could freeze the test clock.)

const HALF = 4; // room is 8 × 8
const H = 3;
const T = 0.2; // wall thickness
const WAIT = 75; // seconds of test time until the second button ("ten minutes")
const TWIN_WINDOW_MS = 380;
const BTN_A = new THREE.Vector3(0, 0, -1.2);
const BTN_B = new THREE.Vector3(0.95, 0, -1.2);
const CHAIR = new THREE.Vector3(0, 0, 0.9); // faces the button (−z)
const SIDE_TABLE = new THREE.Vector3(-1.4, 0, -1.0); // the plate and the marshmallow
const MIRROR_W = 4.2;
const MIRROR_Y0 = 0.95;
const MIRROR_Y1 = 2.35;
const MIRROR_Z = -HALF - 0.03; // recessed into the back wall's opening

const INTRO = vo('Hello. I am going to leave the room now. If you do not press the button until I come back, you get two buttons. It will be about ten minutes.');
const INTRO_2 = vo('There is also a marshmallow. Ignore the marshmallow. The marshmallow is not the test.');
const TEMPT = vo([
  'Take your time. We are all very busy behind the mirror.',
  'It is a very good button. Probably the best one you will ever not press.',
  'The other children lasted four seconds.',
  'You would not be the first to press it. You would not even be the most recent.',
  'Nearly there. Or not. I am not allowed to say.',
]);
const WHISPER = vo('Did the button just say something? No. Buttons do not talk. Carry on.');
const KNOCK = vo('Sorry. That was the glass. Somebody leaned on it. Nobody is trying to distract you.');
const CLOCK_STOP = vo('The clock has stopped. Time has not. Probably.');
const CLOCK_GO = vo('And the clock is going again. Faster, to make up for it.');
const SIT = vo('You sit. Time passes slightly faster sitting down. That is science.');
const SPUN = vo('The spinner. Time is flying. That is cheating, but it is very efficient cheating.');
const EARLY = vo([
  'Subject pressed the button almost immediately. Noted. Underlined.',
  'Subject pressed the button around the halfway mark. Of the first half.',
  'Subject pressed the button with the finish line in sight. Fascinating. Sad, but fascinating.',
]);
const ARRIVE = vo('Well done. Here are your two buttons. The protocol says to press them both at the same time. Two hands. Go on.');
const SAME = vo('Yes, it says the same button. There were always two of it. Science is complicated.');
const ONE_OF_TWO = vo('One. You pressed one of two. The other one will always wonder. Off you go.');
const BOTH = vo('Both at once. Textbook. The study concludes that you are, and I quote, a delight.');
const ATE = vo('Subject ate the marshmallow. That was not the test. That was the control group. You are now the control group.');
const CRACK = vo('You threw something at the mirror. The mirror is cracked. The researchers are leaving. Quickly. Nobody is watching you now. Except me.');
const CRACK_AGAIN = vo('It is already cracked. It does not get more cracked. That is not how glass works.');

type Phase = 'waiting' | 'twin' | 'done';

function canvasPlane(w: number, h: number, pxW: number, pxH: number): { mesh: THREE.Mesh; g: CanvasRenderingContext2D; tex: THREE.CanvasTexture } {
  const cv = document.createElement('canvas');
  cv.width = pxW;
  cv.height = pxH;
  const g = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  return { mesh, g, tex };
}

function fit(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, font: string, style = ''): void {
  let px = size;
  do g.font = `${style} ${px}px ${font}`;
  while (g.measureText(text).width > maxW && --px > 8);
  g.fillText(text, x, y);
}

function knockSfx(): void {
  ensureAudio();
  for (let i = 0; i < 3; i++) setTimeout(() => noise(0.06, 0.3, 320, 'lowpass'), i * 170);
}
function crackSfx(): void {
  ensureAudio();
  noise(0.35, 0.35, 3200, 'highpass');
  tone({ type: 'square', from: 1800, to: 300, dur: 0.18, gain: 0.05 });
}

export function revealMarshmallow(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false });
  hideRoomShell(ctx);
  ctx.scene.background = new THREE.Color(0x1c1a18);
  ctx.scene.fog = new THREE.Fog(0x1c1a18, 16, 40);

  // Into the room, wherever you stood — clear of the plinth, the chair and the side table.
  const cam = ctx.camera.position;
  cam.x = THREE.MathUtils.clamp(cam.x, -HALF + 0.8, HALF - 0.8);
  cam.z = THREE.MathUtils.clamp(cam.z, -HALF + 0.8, HALF - 0.8);
  if (Math.hypot(cam.x - BTN_A.x, cam.z - BTN_A.z) < 1.2 || Math.hypot(cam.x - CHAIR.x, cam.z - CHAIR.z) < 1 || Math.hypot(cam.x - SIDE_TABLE.x, cam.z - SIDE_TABLE.z) < 0.8) cam.set(-1.8, CONFIG.PLAYER_HEIGHT, 2.2);
  ctx.setRegions([{ minX: -HALF + 0.1, maxX: HALF - 0.1, minZ: -HALF + 0.1, maxZ: HALF - 0.1, floorY: 0 }]);

  // Light: flat, institutional, a little warm.
  root.add(new THREE.HemisphereLight(0xfff4e0, 0x6a6258, 0.95));
  const key = new THREE.DirectionalLight(0xfff0d8, 0.45);
  key.position.set(2, 6, 3);
  root.add(key);

  // ── The room ──
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe8d9b0, roughness: 0.95 }); // 70s pastel yellow
  const lower = new THREE.MeshStandardMaterial({ color: 0x9fbfa8, roughness: 0.9 }); // sage dado
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2, HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0xb7825a, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  root.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  root.add(ceil);
  // walls: inner faces exactly at ±HALF
  box(HALF * 2 + T * 2, H, T, 0, H / 2, HALF + T / 2, wallMat); // front
  box(T, H, HALF * 2, -HALF - T / 2, H / 2, 0, wallMat); // left
  box(T, H, HALF * 2, HALF + T / 2, H / 2, 0, wallMat); // right
  // back wall, around the mirror opening
  const bz = -HALF - T / 2;
  const side = HALF - MIRROR_W / 2;
  box(side, H, T, -(MIRROR_W / 2 + side / 2), H / 2, bz, wallMat);
  box(side, H, T, MIRROR_W / 2 + side / 2, H / 2, bz, wallMat);
  box(MIRROR_W, MIRROR_Y0, T, 0, MIRROR_Y0 / 2, bz, wallMat);
  box(MIRROR_W, H - MIRROR_Y1, T, 0, MIRROR_Y1 + (H - MIRROR_Y1) / 2, bz, wallMat);
  // sage dado strips, a hair proud of each wall (never coplanar)
  box(HALF * 2, 0.9, 0.02, 0, 0.45, HALF - 0.011, lower);
  box(0.02, 0.9, HALF * 2, -HALF + 0.011, 0.45, 0, lower);
  box(0.02, 0.9, HALF * 2, HALF - 0.011, 0.45, 0, lower);
  // a door on the right wall (the researcher's; it never opens for you)
  box(0.06, 2.1, 1.0, HALF - 0.03, 1.05, 1.8, new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.8 }));

  // ── The observation room behind the glass: dim, two researchers ──
  const obsMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 1 });
  const OBS_D = 2.4;
  box(MIRROR_W + 1, H, 0.1, 0, H / 2, -HALF - T - OBS_D, obsMat);
  box(0.1, H, OBS_D, -(MIRROR_W + 1) / 2, H / 2, -HALF - T - OBS_D / 2, obsMat);
  box(0.1, H, OBS_D, (MIRROR_W + 1) / 2, H / 2, -HALF - T - OBS_D / 2, obsMat);
  box(MIRROR_W + 1, 0.05, OBS_D, 0, 0.02, -HALF - T - OBS_D / 2, obsMat);
  box(MIRROR_W + 1, 0.05, OBS_D, 0, H, -HALF - T - OBS_D / 2, obsMat);
  const obsLight = new THREE.PointLight(0x8898b0, 0.5, 5, 2);
  obsLight.position.set(0, 2.4, -HALF - 1.4);
  root.add(obsLight);
  const coat = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.8 });
  const researchers: { g: THREE.Group; home: THREE.Vector3; gone: boolean }[] = [];
  for (const x of [-1.1, 0.9]) {
    const g = createAsset('dummy') as THREE.Group;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.parent?.name?.startsWith('leg') && o.name !== 'head') o.material = coat;
    });
    const home = new THREE.Vector3(x, 0, -HALF - 1.3);
    g.position.copy(home);
    g.rotation.y = 0; // facing into our room (+z)
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.02), new THREE.MeshStandardMaterial({ color: 0x6b4a2a }));
    board.position.set(0.18, 1.05, 0.22);
    board.rotation.x = -0.5;
    g.add(board);
    root.add(g);
    researchers.push({ g, home, gone: false });
  }

  // The glass: a dim blue-grey sheen you can half see through.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(MIRROR_W, MIRROR_Y1 - MIRROR_Y0),
    new THREE.MeshStandardMaterial({ color: 0x8c9aa8, roughness: 0.08, metalness: 0.85, transparent: true, opacity: 0.55 }),
  );
  glass.position.set(0, (MIRROR_Y0 + MIRROR_Y1) / 2, MIRROR_Z);
  root.add(glass);
  // The crack overlay (drawn on the first hit), a centimetre in front.
  const crack = canvasPlane(MIRROR_W, MIRROR_Y1 - MIRROR_Y0, 1024, 340);
  crack.mesh.position.set(0, (MIRROR_Y0 + MIRROR_Y1) / 2, MIRROR_Z + 0.012);
  crack.mesh.visible = false;
  root.add(crack.mesh);

  // ── The wall clock (left wall) — the test clock, in "ten minutes" ──
  const clock = canvasPlane(0.7, 0.7, 256, 256);
  clock.mesh.position.set(-HALF + 0.03, 2.1, -0.6);
  clock.mesh.rotation.y = Math.PI / 2;
  root.add(clock.mesh);
  const drawClock = (min: number) => {
    const g = clock.g;
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#f7f1df';
    g.strokeStyle = '#7a5a2e';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(128, 128, 116, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#3a2a18';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillRect(128 + Math.sin(a) * 92 - 4, 128 - Math.cos(a) * 92 - 4, 8, 8);
    }
    const hand = (turns: number, len: number, w: number, col: string) => {
      const a = turns * Math.PI * 2;
      g.strokeStyle = col;
      g.lineWidth = w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);
      g.stroke();
    };
    hand(min / 60, 82, 7, '#2a2018'); // the minute hand
    hand(min % 1, 96, 3, '#b8321e'); // the second hand
    clock.tex.needsUpdate = true;
  };
  drawClock(0);

  // ── The chair (sit: the test clock runs faster) ──
  const wood = new THREE.MeshStandardMaterial({ color: 0xc27a3a, roughness: 0.7 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xe0782a, roughness: 0.8 });
  const chair = new THREE.Group();
  chair.position.copy(CHAIR);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), orange);
  seat.position.y = 0.46;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.05), orange);
  back.position.set(0, 0.74, 0.21);
  chair.add(seat, back);
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.44, 6), wood);
    leg.position.set(x, 0.22, z);
    chair.add(leg);
  }
  root.add(chair);
  const chairSolid = { x: CHAIR.x, z: CHAIR.z, radius: 0.32 };
  ctx.addObstacle(chairSolid);
  let sitting = false;
  let saidSit = false;
  const seatAt = new THREE.Vector3();
  const standUp = () => {
    if (!sitting) return;
    sitting = false;
    setEyeHeight(null);
    ctx.addObstacle(chairSolid);
    ctx.camera.position.set(CHAIR.x + 0.8, CONFIG.PLAYER_HEIGHT, CHAIR.z);
  };
  registerInteractable({
    id: 'marshmallow-chair',
    position: new THREE.Vector3(CHAIR.x, 0.5, CHAIR.z),
    radius: 1.4,
    promptLabel: 'SIT',
    canUse: () => phase !== 'done',
    onUse: () => {
      if (sitting) return standUp();
      sitting = true;
      ctx.removeObstacle(chairSolid);
      seatAt.set(CHAIR.x, 1.15, CHAIR.z - 0.05);
      ctx.camera.position.copy(seatAt);
      setEyeHeight(1.15);
      setYaw(0); // facing −z: the button, the mirror
      setPitch(-0.1);
      thud();
      if (!saidSit) {
        saidSit = true;
        ctx.narrate(SIT, 5000);
      }
    },
  });

  // ── The side table with the marshmallow ──
  box(0.6, 0.72, 0.5, -1.4, 0.36, -1.0, wood); // the side table
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.02, 20), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  plate.position.set(-1.4, 0.73, -1.0);
  root.add(plate);
  ctx.addObstacle({ x: SIDE_TABLE.x, z: SIDE_TABLE.z, radius: 0.42 });
  const mallow = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 14), new THREE.MeshStandardMaterial({ color: 0xfff8f0, roughness: 0.95 }));
  mallow.position.set(-1.4, 0.77, -1.0);
  root.add(mallow);
  let ate = false;
  const mallowCarry: Carryable = {
    kind: 'marshmallow',
    object: mallow,
    heldDist: 0.45,
    heldDrop: 0.2,
    projectile: { radius: 0.05, restitution: 0.2, gravity: 14, speed: 12 },
    onTap: () => {
      // eaten
      if (ate) return;
      ate = true;
      ctx.removeCarryable(mallowCarry);
      mallow.removeFromParent();
      pop();
      ctx.narrate(ATE, 6000, { priority: true });
      discover('item:marshmallow');
    },
  };
  ctx.addCarryable(mallowCarry);

  // ── The button (and later, its twin) ──
  let phase: Phase = 'waiting';
  let testT = 0; // test clock (seconds of WAIT)
  let realT = 0;
  const btnA: SpawnedButton = spawnPedestalButton(root, BTN_A, () => onPressA());
  ctx.addObstacle(btnA.obstacle);
  let btnB: SpawnedButton | null = null;
  const lure = new THREE.PointLight(0xff3a10, 0, 2.5, 2);
  lure.position.set(BTN_A.x, 1.3, BTN_A.z);
  root.add(lure);
  // The whisper: a tiny "press me" by the dome.
  const whisper = canvasPlane(0.4, 0.1, 256, 64);
  whisper.g.fillStyle = '#7a2a1a';
  whisper.g.textAlign = 'center';
  whisper.g.textBaseline = 'middle';
  fit(whisper.g, 'press me', 128, 32, 240, 40, FONT_VOICE, 'italic');
  whisper.tex.needsUpdate = true;
  (whisper.mesh.material as THREE.MeshBasicMaterial).opacity = 0;
  whisper.mesh.position.set(BTN_A.x + 0.28, 1.22, BTN_A.z);
  root.add(whisper.mesh);

  const finish = (lines: string[], delay: number, at: THREE.Vector3) => {
    phase = 'done';
    for (const l of lines) ctx.narrate(l, 5500, { priority: l === lines[0] });
    ctx.after(delay, () => ctx.advance(at.clone()));
  };
  function onPressA(): void {
    if (phase === 'done') return;
    if (phase === 'twin') return twinPress();
    const k = testT / WAIT;
    finish([EARLY[k < 0.25 ? 0 : k < 0.75 ? 1 : 2]], 4500, BTN_A);
  }
  let pending = false;
  function twinPress(): void {
    if (phase !== 'twin') return;
    if (pending) {
      // the second press inside the window: both at once
      pending = false;
      discover('reward:marshmallow-both');
      fanfare();
      sparkle();
      finish([BOTH], 5000, BTN_A);
      return;
    }
    pending = true;
    ctx.after(TWIN_WINDOW_MS, () => {
      if (!pending || phase !== 'twin') return;
      pending = false;
      discover('reward:marshmallow-waited');
      finish([ONE_OF_TWO], 4500, BTN_A);
    });
  }
  const arrive = () => {
    phase = 'twin';
    discover('mech:marshmallow-twin');
    // clear the spot, then the twin rises from the floor
    const c = ctx.camera.position;
    if (Math.hypot(c.x - BTN_B.x, c.z - BTN_B.z) < 0.9) c.set(BTN_B.x + 0.5, c.y, BTN_B.z + 1.0);
    btnB = spawnPedestalButton(root, BTN_B, () => twinPress());
    ctx.addObstacle(btnB.obstacle);
    const plaque = canvasPlane(0.4, 0.14, 256, 90);
    plaque.g.fillStyle = '#1b1a18';
    plaque.g.fillRect(0, 0, 256, 90);
    plaque.g.fillStyle = '#e8c86a';
    plaque.g.textAlign = 'center';
    plaque.g.textBaseline = 'middle';
    fit(plaque.g, 'THE SAME BUTTON', 128, 46, 236, 34, FONT_SIGN, 'bold');
    plaque.tex.needsUpdate = true;
    plaque.mesh.position.set(0, 0.6, 0.235); // on the column's front face, a hair proud
    btnB.group.add(plaque.mesh);
    const g = btnB.group;
    g.position.y = -1.8;
    let t = 0;
    sparkle();
    addUpdater((dt) => {
      t += dt;
      const k = Math.min(1, t / 1.2);
      g.position.y = -1.8 * (1 - (1 - Math.pow(1 - k, 3)));
      return k >= 1;
    });
    ctx.narrate(ARRIVE, 7000, { priority: true });
    ctx.after(7500, () => {
      if (phase === 'twin') ctx.narrate(SAME, 5000);
    });
  };

  // ── Temptations, on the test clock ──
  let clockStopped = false;
  let whisperT = 0;
  let whisperMax = 1;
  let glowT = 0;
  let tapT = 0;
  const beats: { at: number; fn: () => void; done?: boolean }[] = [
    { at: 8, fn: () => ctx.narrate(TEMPT[0], 4500) },
    { at: 17, fn: () => ((glowT = 4), ctx.narrate(TEMPT[1], 5000)) },
    { at: 26, fn: () => ((whisperT = whisperMax = 3.5), ctx.after(2500, () => phase === 'waiting' && ctx.narrate(WHISPER, 5000))) },
    { at: 34, fn: () => ((tapT = 2.2), knockSfx(), ctx.after(1400, () => phase === 'waiting' && !mirrorCracked && ctx.narrate(KNOCK, 5000))) },
    { at: 42, fn: () => ctx.narrate(TEMPT[2], 4000) },
    { at: 50, fn: () => ((clockStopped = true), ctx.narrate(CLOCK_STOP, 4000)) },
    { at: 57, fn: () => ((clockStopped = false), ctx.narrate(CLOCK_GO, 4000)) },
    { at: 61, fn: () => ((glowT = 5), (whisperT = whisperMax = 4), ctx.narrate(TEMPT[3], 5000)) },
    { at: 69, fn: () => ctx.narrate(TEMPT[4], 4000) },
  ];

  // ── The mirror: anything thrown at it cracks it ──
  let mirrorCracked = false;
  let saidCrackAgain = false;
  const prevPos = new Map<THREE.Object3D, THREE.Vector3>();
  const wp = new THREE.Vector3();
  const drawCrack = (hx: number, hy: number) => {
    const g = crack.g;
    const cx = ((hx + MIRROR_W / 2) / MIRROR_W) * 1024;
    const cy = (1 - (hy - MIRROR_Y0) / (MIRROR_Y1 - MIRROR_Y0)) * 340;
    g.strokeStyle = 'rgba(235,240,245,0.9)';
    g.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      let a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      let x = cx;
      let y = cy;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        a += (Math.random() - 0.5) * 0.6;
        const len = 20 + Math.random() * 40;
        x += Math.cos(a) * len;
        y += Math.sin(a) * len;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let r = 18; r < 70; r += 24) {
      g.beginPath();
      g.arc(cx, cy, r + Math.random() * 6, 0, Math.PI * 2);
      g.stroke();
    }
    crack.tex.needsUpdate = true;
    crack.mesh.visible = true;
  };
  const hitMirror = (hx: number, hy: number) => {
    if (mirrorCracked) {
      if (!saidCrackAgain) {
        saidCrackAgain = true;
        ctx.narrate(CRACK_AGAIN, 4500);
      }
      return;
    }
    mirrorCracked = true;
    crackSfx();
    drawCrack(hx, hy);
    discover('reward:marshmallow-mirror');
    ctx.narrate(CRACK, 7000, { priority: true });
    // the researchers scatter, left and right, and are gone
    researchers.forEach((r, i) => {
      const dir = i === 0 ? -1 : 1;
      let t = 0;
      addUpdater((dt) => {
        t += dt;
        r.g.position.x += dir * 3.2 * dt;
        r.g.rotation.y = dir * Math.PI / 2;
        if (t > 1.3) {
          r.g.visible = false;
          r.gone = true;
          return true;
        }
        return false;
      });
    });
  };
  const scanThrown = () => {
    const cam = ctx.camera.position;
    const seen = new Set<THREE.Object3D>();
    for (const parent of [ctx.scene, root]) {
      for (const o of parent.children) {
        if ((o as THREE.Light).isLight || o === root) continue;
        seen.add(o);
        o.getWorldPosition(wp);
        const prev = prevPos.get(o);
        if (!prev) {
          prevPos.set(o, wp.clone());
          continue;
        }
        const moved = wp.distanceTo(prev);
        prev.copy(wp);
        if (moved < 0.03) continue; // (per frame: > ~2 m/s)
        if (wp.distanceTo(cam) < 1.2) continue; // in your hand
        if (wp.z < -HALF + 0.45 && wp.y > MIRROR_Y0 && wp.y < MIRROR_Y1 && Math.abs(wp.x) < MIRROR_W / 2) hitMirror(wp.x, wp.y);
      }
    }
    for (const o of prevPos.keys()) if (!seen.has(o)) prevPos.delete(o);
  };

  // ── Per frame ──
  let saidSpun = false;
  let lastDrawn = -1;
  addUpdater((dt) => {
    realT += dt;
    // sitting: a real step off the seat stands you up
    if (sitting && Math.hypot(ctx.camera.position.x - seatAt.x, ctx.camera.position.z - seatAt.z) > 0.02) standUp();
    scanThrown();
    if (phase === 'done') {
      if (sitting) standUp();
      return true;
    }
    if (phase === 'waiting') {
      const sp = spinnerSpeed(ctx);
      if (sp > 1 && !saidSpun) {
        saidSpun = true;
        ctx.narrate(SPUN, 4500);
      }
      const rate = sp * (sitting ? 1.6 : 1);
      testT += dt * rate;
      for (const b of beats) {
        if (!b.done && testT >= b.at) {
          b.done = true;
          b.fn();
        }
      }
      if (testT >= WAIT) arrive();
    }
    // the clock: ten "minutes" over WAIT, a little wobbly, stopped when stopped
    if (!clockStopped) {
      const shown = Math.min(10, (testT / WAIT) * 10 + 0.15 * Math.sin(realT * 0.7));
      if (Math.abs(shown - lastDrawn) > 0.004) {
        lastDrawn = shown;
        drawClock(shown);
      }
    }
    // the lure: glow, whisper, knocking researchers
    glowT = Math.max(0, glowT - dt);
    lure.intensity = glowT > 0 ? 1.2 + 0.8 * Math.sin(realT * 9) : 0;
    whisperT = Math.max(0, whisperT - dt);
    (whisper.mesh.material as THREE.MeshBasicMaterial).opacity = whisperT > 0 ? Math.min(1, whisperT, (whisperMax - whisperT) * 2) * 0.85 : 0;
    whisper.mesh.lookAt(ctx.camera.position);
    tapT = Math.max(0, tapT - dt);
    for (const r of researchers) {
      if (r.gone) continue;
      const wantZ = tapT > 0 ? -HALF - 0.45 : r.home.z;
      r.g.position.z += (wantZ - r.g.position.z) * Math.min(1, dt * 4);
    }
    return false;
  });

  ctx.narrate(INTRO, 7000);
  ctx.after(7600, () => {
    if (phase === 'waiting') ctx.narrate(INTRO_2, 5000);
  });
}
