import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { defineCombine } from '../game/combine';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { spawnPedestalButton } from '../button/pedestal-button';
import { registerInteractable } from '../interactables/system';
import type { Interactable } from '../interactables/types';
import { setYaw, setPitch } from '../controls/player-camera';
import { tone, noise, ensureAudio, thud, applause, sparkle, quack } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { uvInk } from '../objects/uv-torch';
import { FONT_SIGN, FONT_DISPLAY } from '../ui/fonts';
import { hideRoomShell, groundPlane } from './scaffold';

// THE PORTA-LOO — the white room shrinks around you into a festival portable
// toilet on day four. Blue plastic, flies, graffiti, no paper, an empty
// sanitiser, the bass through the wall and a man banging on the door. The only
// button is the FLUSH. The narrator will not come in; he talks from outside.
//
//   FLUSH       → it gurgles, and the level RISES. Every press is worse. Stay
//                 above it (the seat buys you a little), or you drown.
//   The door    → stuck on ENGAGED. Kick it (press it) five times and it goes.
//   The seat    → walk to the back and you're standing on it; from up there the
//                 roof vent is in reach — squeeze out.
//   Items       → a COIN in the slot ("pay to flush") makes it flush properly
//                 and the lock gives up; the AXE takes the door off; a DUCK in
//                 the bowl paddles, delighted; the UV TORCH shows things the
//                 narrator will not describe.
// Out of the door: daylight, a festival crowd staring in silence, then cheering.
// The button is in front of the stage.

const C = 2; // cabin centre z (x = 0)
const HW = 0.65; // cabin inner half-width
const H = 2.3; // roof height
const T = 0.05; // wall thickness
const BOWL = new THREE.Vector3(0, 0, C - 0.42);
const SEAT_Y = 0.45;
const FLUSH_POS = new THREE.Vector3(0.52, 1.05, C - 0.5);
const RISE = 0.17; // sludge per flush
const DROWN_MARGIN = 0.35; // the level this far under your eyes = drowned
const STAGE_Z = C + 17;
const BUTTON_POS = new THREE.Vector3(0, 0, C + 13.2);

const INTRO = vo('No. I am not coming in there. I will talk to you from out here. It is day four of the festival, that is a festival toilet, and you are inside it. I am so sorry.');
const INTRO_2 = vo('There is one button. It says flush. It is the only button. I would think very carefully about that.');
const FLUSH_LINES = vo([
  'That was not a flush. That was a gurgle. Do not press it again.',
  'It is rising. Why is it rising. Flushing is supposed to make things go down.',
  'It is out of the bowl now. I can smell it from here. I am outside. In a field.',
  'Please stop pressing it. You are making it angry.',
  'It is at your ankles. Your shoes are gone. Not ruined. Gone.',
  'Knees. That is knee deep. On day four.',
  'I would climb onto something if I were you. I would not choose the thing you are going to have to choose.',
  'I am going to be sick. Hang on. No. False alarm. Yes. No.',
]);
const DROWNED = vo('You drowned in a festival toilet. Your family has been informed. They are not surprised.');
const BANG_FIRST = vo('Hurry up, mate. That is the man outside. He has been out there since Tuesday.');
const BANG = vo(['He says hurry up. He says it with his fists.', 'The man outside would like you to know he is still there.', 'More banging. He has started a chant.']);
const KICK = vo([
  'It is stuck. The lock says engaged. It has said engaged since twenty nineteen.',
  'Harder.',
  'The whole cabin is wobbling. So is everything in it. Everything.',
  'One more. I believe in you. From a distance.',
]);
const DOOR_HINT = vo('That door is plastic. On a plastic hinge. It would not survive a determined kick. Or five.');
const KICKED = vo('The door is off. You are free. Everybody is looking.');
const AXED = vo('You took an axe to a festival toilet door. That is the most rock and roll thing anyone has done at this festival. Including the bands.');
const SEAT = vo('You are standing on the seat. Do not look down. I mean it. Do not look down.');
const VENT = vo('You squeezed out through the roof vent. Onto the roof. Off the roof. Into the grass. Nobody saw. Everybody saw.');
const PAID = vo('Twenty pence. And it flushes. Properly. Downwards. The lock has decided you are a customer now.');
const DUCKED = vo('You put the duck in the toilet. It is paddling. It is happy. It is the only one here who is.');
const UV = vo('No. I am not describing that. Turn it off. Turn it off. Some things are not meant to glow.');
const STARE = vo('Silence. Two thousand people, all looking at the door you just came out of.');
const CHEER = vo('And they are cheering. You are a legend now. Nobody knows why. The button is in front of the stage. Go on.');
const PRESSED = vo('Ladies and gentlemen. Your headliner.');

// ── Combines are global; the live cabin wires these hooks. ──
let hooks: { axe(): void; pay(c: Carryable): void; duck(c: Carryable): void } | null = null;
defineCombine('axe', 'loo-door', () => {
  hooks?.axe();
  return true; // keep the axe
});
defineCombine('coin', 'loo-slot', (held) => {
  if (!hooks) return true;
  hooks.pay(held);
});
defineCombine('duck', 'loo-bowl', (held) => {
  if (!hooks) return true;
  hooks.duck(held);
});

// ── Sounds ──
function gurgle(n: number): void {
  ensureAudio();
  const g = 0.06 + n * 0.015;
  for (let i = 0; i < 3 + n; i++) {
    setTimeout(() => tone({ type: 'sine', from: 140 + Math.random() * 80, to: 50 + Math.random() * 30, dur: 0.18 + Math.random() * 0.2, gain: g }), i * 150 + Math.random() * 60);
  }
  noise(0.5 + n * 0.12, 0.08 + n * 0.02, 380 - n * 20, 'lowpass');
  if (n >= 3) tone({ type: 'sawtooth', from: 70, to: 38, dur: 0.9, gain: 0.05 }); // something deep down answers
}
function realFlush(): void {
  ensureAudio();
  noise(2.2, 0.3, 900, 'lowpass');
  tone({ type: 'sine', from: 300, to: 60, dur: 1.8, gain: 0.08 });
}
function bang(): void {
  ensureAudio();
  for (let i = 0; i < 4; i++) setTimeout(() => (noise(0.09, 0.3, 260, 'lowpass'), thud()), i * 230);
}
function kickSfx(): void {
  ensureAudio();
  thud();
  noise(0.2, 0.25, 500, 'lowpass');
  tone({ type: 'square', from: 180, to: 90, dur: 0.12, gain: 0.05 });
}
function unlockSfx(): void {
  ensureAudio();
  tone({ type: 'triangle', from: 900, to: 700, dur: 0.08, gain: 0.08 });
  setTimeout(() => tone({ type: 'triangle', from: 600, to: 500, dur: 0.1, gain: 0.08 }), 110);
}

function canvasPlane(w: number, h: number, pxW: number, pxH: number, draw: (g: CanvasRenderingContext2D) => void, transparent = false): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = pxW;
  cv.height = pxH;
  const g = cv.getContext('2d')!;
  draw(g);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent }),
  );
}
function fitText(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxW: number, px: number): void {
  do g.font = font(px);
  while (g.measureText(text).width > maxW && --px > 8);
}

export function revealPortaLoo(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false });
  hideRoomShell(ctx);
  ctx.scene.background = new THREE.Color(0x0c0e10);
  const fog = new THREE.Fog(0x0c0e10, 30, 90);
  ctx.scene.fog = fog;

  // Into the cabin, facing the toilet.
  ctx.camera.position.set(0, CONFIG.PLAYER_HEIGHT, C + 0.2);
  setYaw(0);
  setPitch(-0.12);
  const cabin = { minX: -HW, maxX: HW, minZ: C - HW, maxZ: C + HW, floorY: 0 };
  const seat = { minX: -0.22, maxX: 0.22, minZ: C - 0.62, maxZ: C - 0.22, floorY: SEAT_Y };
  ctx.setBounds({ minX: -16, maxX: 16, minZ: -4, maxZ: C + 24 });
  ctx.setRegions([cabin, seat]);

  // Inside light: a sickly green glow from the vent, plus a dim fill.
  const fill = new THREE.HemisphereLight(0xb8d0ff, 0x3a3020, 0.55);
  root.add(fill);
  const ventLight = new THREE.PointLight(0xc8ffb0, 1.2, 4, 1.4);
  ventLight.position.set(0, H - 0.15, C - 0.2);
  root.add(ventLight);
  // Outside (off until you're out): a festival afternoon.
  const sun = new THREE.DirectionalLight(0xfff2d8, 0);
  sun.position.set(-6, 14, 20);
  root.add(sun);
  const sky = new THREE.HemisphereLight(0xcfe6ff, 0x557a33, 0);
  root.add(sky);
  root.add(groundPlane({ color: 0x5b6a33 }));

  // ── The cabin ──
  const plastic = new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.55 });
  const grime = new THREE.MeshStandardMaterial({ color: 0x5c6a4a, roughness: 0.9 });
  const white = new THREE.MeshStandardMaterial({ color: 0xdde3e6, roughness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.8 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  box(2 * HW + 2 * T, 0.04, 2 * HW + 2 * T, 0, 0.02, C, grime); // floor (sits above the ground plane)
  box(T, H, 2 * HW + 2 * T, -HW - T / 2, H / 2, C, plastic); // left
  box(T, H, 2 * HW + 2 * T, HW + T / 2, H / 2, C, plastic); // right
  box(2 * HW, H, T, 0, H / 2, C - HW - T / 2, plastic); // back
  // Front: frame either side of the door, and a strip above it.
  const DOOR_W = 0.72;
  const DOOR_H = 2.0;
  const side = (2 * HW - DOOR_W) / 2;
  box(side, H, T, -HW + side / 2, H / 2, C + HW + T / 2, plastic);
  box(side, H, T, HW - side / 2, H / 2, C + HW + T / 2, plastic);
  box(DOOR_W, H - DOOR_H, T, 0, DOOR_H + (H - DOOR_H) / 2, C + HW + T / 2, plastic);
  // Roof, with the vent: a grille over a hole (the light comes through it).
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2 * HW + 0.2, 0.06, 2 * HW + 0.2), new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.7 }));
  roof.position.set(0, H + 0.03, C);
  root.add(roof);
  const grille = box(0.34, 0.012, 0.34, 0, H - 0.012, C - 0.2, new THREE.MeshStandardMaterial({ color: 0x8a9a7a, emissive: 0x6a8a50, emissiveIntensity: 0.5, roughness: 0.8 }));
  for (let i = -2; i <= 2; i++) box(0.34, 0.02, 0.02, 0, H - 0.03, C - 0.2 + i * 0.07, chrome);

  // The door: pivots on its left edge (so it can swing / fall open).
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-DOOR_W / 2, 0, C + HW + T / 2);
  root.add(doorPivot);
  const door = box(DOOR_W, DOOR_H, T * 0.8, DOOR_W / 2, DOOR_H / 2, 0, plastic, doorPivot);
  const engaged = (vacant: boolean) => (g: CanvasRenderingContext2D) => {
    g.fillStyle = vacant ? '#1d8a3a' : '#c21d1d';
    g.fillRect(0, 0, 256, 72);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const t = vacant ? 'VACANT' : 'ENGAGED';
    fitText(g, t, (px) => `bold ${px}px ${FONT_SIGN}`, 230, 48);
    g.fillText(t, 128, 38);
  };
  const lockSign = canvasPlane(0.2, 0.056, 256, 72, engaged(false));
  lockSign.position.set(DOOR_W - 0.12, 1.05, -T / 2 - 0.012);
  lockSign.rotation.y = Math.PI; // faces into the cabin
  doorPivot.add(lockSign);
  const outSign = canvasPlane(0.2, 0.056, 256, 72, engaged(false));
  outSign.position.set(DOOR_W - 0.12, 1.05, T / 2 + 0.012);
  doorPivot.add(outSign);
  const setVacant = () => {
    for (const s of [lockSign, outSign]) {
      const m = s.material as THREE.MeshBasicMaterial;
      const cv = (m.map as THREE.CanvasTexture).image as HTMLCanvasElement;
      const g = cv.getContext?.('2d');
      if (g) engaged(true)(g);
      if (m.map) m.map.needsUpdate = true;
    }
  };

  // Toilet: base, bowl rim, seat, cistern box behind.
  box(0.42, SEAT_Y - 0.04, 0.46, BOWL.x, (SEAT_Y - 0.04) / 2, BOWL.z, white);
  const seatRing = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 20), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5 }));
  seatRing.rotation.x = -Math.PI / 2;
  seatRing.position.set(BOWL.x, SEAT_Y - 0.01, BOWL.z);
  root.add(seatRing);
  box(0.5, 0.7, 0.14, 0, 0.8, C - HW + 0.08, white); // the tank / backrest
  const bowlHole = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), new THREE.MeshBasicMaterial({ color: 0x050605 }));
  bowlHole.rotation.x = -Math.PI / 2;
  bowlHole.position.set(BOWL.x, SEAT_Y - 0.025, BOWL.z);
  root.add(bowlHole);

  // The flush: a big chrome push-button on the right wall, a coin slot under
  // it, and the sign.
  const flushPlate = box(0.02, 0.22, 0.2, FLUSH_POS.x + 0.1, FLUSH_POS.y, FLUSH_POS.z, chrome);
  const flushBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.04, 20), new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.2, metalness: 0.9 }));
  flushBtn.rotation.z = Math.PI / 2;
  flushBtn.position.set(FLUSH_POS.x + 0.07, FLUSH_POS.y + 0.03, FLUSH_POS.z);
  root.add(flushBtn);
  const slot = box(0.012, 0.012, 0.06, FLUSH_POS.x + 0.085, FLUSH_POS.y - 0.075, FLUSH_POS.z, new THREE.MeshBasicMaterial({ color: 0x080808 }));
  const flushSign = canvasPlane(0.22, 0.12, 256, 140, (g) => {
    g.fillStyle = '#f2f2ee';
    g.fillRect(0, 0, 256, 140);
    g.fillStyle = '#1a1a1a';
    g.textAlign = 'center';
    fitText(g, 'FLUSH', (px) => `bold ${px}px ${FONT_SIGN}`, 230, 54);
    g.fillText('FLUSH', 128, 58);
    fitText(g, 'PAY TO FLUSH: 20p', (px) => `${px}px ${FONT_SIGN}`, 230, 24);
    g.fillText('PAY TO FLUSH: 20p', 128, 100);
    g.font = `italic 16px ${FONT_SIGN}`;
    g.fillText('(it never flushes)', 128, 126);
  });
  flushSign.position.set(HW - 0.012, FLUSH_POS.y + 0.24, FLUSH_POS.z);
  flushSign.rotation.y = -Math.PI / 2;
  root.add(flushSign);

  // Empty paper holder, bulging empty sanitiser.
  const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8), chrome);
  holder.rotation.z = Math.PI / 2; // sticks out of the left wall, bare
  holder.position.set(-HW + 0.07, 0.75, C - 0.25);
  root.add(holder);
  box(0.08, 0.2, 0.14, -HW + 0.04, 1.35, C + 0.25, new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 }));
  const goo = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0xbfe8c0, transparent: true, opacity: 0.6, roughness: 0.1 }));
  goo.scale.set(0.6, 1.4, 1);
  goo.position.set(-HW + 0.05, 1.18, C + 0.25);
  root.add(goo);

  // Graffiti on the left wall (inside face).
  const graffiti = canvasPlane(1.1, 1.4, 512, 652, (g) => {
    g.clearRect(0, 0, 512, 652);
    const scrawl = (text: string, x: number, y: number, px: number, rot: number, color: string, font = FONT_SIGN) => {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.fillStyle = color;
      g.font = `bold ${px}px ${font}`;
      g.fillText(text, 0, 0);
      g.restore();
    };
    scrawl('THE BUTTON WAS HERE', 30, 90, 34, -0.08, '#111');
    scrawl('call gaz 07700 900 4', 60, 170, 26, 0.05, '#7a1010');
    scrawl('DON’T', 300, 300, 44, 0.12, '#111');
    g.strokeStyle = '#111';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(320, 320);
    g.lineTo(420, 470);
    g.lineTo(390, 440);
    g.moveTo(420, 470);
    g.lineTo(425, 430);
    g.stroke();
    scrawl('day 1  ||||', 40, 420, 26, -0.02, '#203a80', FONT_DISPLAY);
    scrawl('day 4  |||| |||| |||| ||', 40, 470, 26, 0.02, '#203a80', FONT_DISPLAY);
    scrawl('it flushes if u believe', 50, 580, 26, -0.06, '#1d6a2a');
  }, true);
  graffiti.position.set(-HW + 0.012, 1.25, C);
  graffiti.rotation.y = Math.PI / 2;
  root.add(graffiti);
  // …and what only the UV torch shows.
  const horror = canvasPlane(1.2, 1.5, 512, 640, (g) => {
    g.clearRect(0, 0, 512, 640);
    g.fillStyle = '#d9ff4a';
    for (let i = 0; i < 26; i++) {
      g.beginPath();
      g.arc(40 + Math.random() * 430, 60 + Math.random() * 540, 8 + Math.random() * 30, 0, Math.PI * 2);
      g.fill();
    }
    for (let k = 0; k < 3; k++) {
      // handprints
      const x = 90 + k * 150;
      const y = 200 + (k % 2) * 160;
      g.beginPath();
      g.ellipse(x, y, 34, 42, 0, 0, Math.PI * 2);
      g.fill();
      for (let f = 0; f < 5; f++) g.fillRect(x - 34 + f * 16, y - 100 + Math.abs(f - 2) * 12, 11, 58);
    }
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    fitText(g, 'DO NOT LOOK', (px) => `bold ${px}px ${FONT_SIGN}`, 470, 70);
    g.fillText('DO NOT LOOK', 256, 90);
  }, true);
  horror.position.set(HW - 0.016, 1.2, C + 0.1);
  horror.rotation.y = -Math.PI / 2;
  root.add(horror);
  uvInk(horror);

  // ── The sludge: in the bowl first, then over the floor ──
  const sludgeMat = new THREE.MeshStandardMaterial({ color: 0x5b5a1c, emissive: 0x1a1a04, roughness: 0.25, metalness: 0.1 });
  const bowlSludge = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), sludgeMat);
  bowlSludge.rotation.x = -Math.PI / 2;
  bowlSludge.position.set(BOWL.x, SEAT_Y - 0.12, BOWL.z);
  root.add(bowlSludge);
  const floorSludge = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW - 0.01, 2 * HW - 0.01), sludgeMat);
  floorSludge.rotation.x = -Math.PI / 2;
  floorSludge.visible = false;
  root.add(floorSludge);
  let level = SEAT_Y - 0.12; // the surface height
  let levelTo = level;
  const bubbles: { m: THREE.Mesh; t: number }[] = [];
  const bubbleGeo = new THREE.SphereGeometry(0.025, 8, 6);

  // ── Flies ──
  const flies: { m: THREE.Mesh; a: number; r: number; y: number; s: number }[] = [];
  const flyMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  const flyGeo = new THREE.SphereGeometry(0.008, 5, 4);
  for (let i = 0; i < 26; i++) {
    const m = new THREE.Mesh(flyGeo, flyMat);
    root.add(m);
    flies.push({ m, a: Math.random() * 6.28, r: 0.1 + Math.random() * 0.35, y: 0.5 + Math.random() * 1.3, s: 2 + Math.random() * 4 });
  }

  // ── Outside: the festival ──
  const crowd: THREE.Group[] = [];
  const shirts = [0xe04a3a, 0x2a2a2a, 0x3a8ad0, 0xf0c040, 0x7a4ab0, 0xf2f2ee, 0x3f8a4a];
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 10; k++) {
      const x = -7 + k * 1.55 + (row % 2) * 0.6 + (Math.random() - 0.5) * 0.4;
      if (Math.abs(x) < 1.3) continue; // an aisle to the stage
      const z = C + 5.5 + row * 1.5 + (Math.random() - 0.5) * 0.4;
      const g = createAsset('dummy') as THREE.Group;
      g.scale.setScalar(0.85 + Math.random() * 0.15);
      const shirt = new THREE.MeshStandardMaterial({ color: shirts[(row * 10 + k) % shirts.length], roughness: 0.8 });
      g.traverse((o) => {
        if (o instanceof THREE.Mesh && !o.parent?.name?.startsWith('leg') && o.name !== 'head') o.material = shirt;
      });
      g.position.set(x, 0, z);
      g.rotation.y = 0; // facing the stage (+z)
      root.add(g);
      crowd.push(g);
      ctx.addObstacle({ x, z, radius: 0.3 });
    }
  }
  // Stage: a deck, two speaker stacks, a banner.
  const stageMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.8 });
  box(12, 1.1, 4, 0, 0.55, STAGE_Z + 1.5, stageMat);
  for (const x of [-5, 5]) box(1.3, 2.6, 1.1, x, 2.4, STAGE_Z, new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.6 }));
  for (const x of [-5.8, 5.8]) box(0.18, 5, 0.18, x, 2.5, STAGE_Z + 3.2, chrome);
  const banner = canvasPlane(10, 1.6, 1024, 164, (g) => {
    g.fillStyle = '#e8237a';
    g.fillRect(0, 0, 1024, 164);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitText(g, 'BUTTONFEST · DAY FOUR', (px) => `bold ${px}px ${FONT_SIGN}`, 960, 110);
    g.fillText('BUTTONFEST · DAY FOUR', 512, 86);
  });
  banner.position.set(0, 4.8, STAGE_Z + 3.18);
  banner.rotation.y = Math.PI; // faces the crowd (−z)
  root.add(banner);

  // ── State ──
  let presses = 0;
  let escaped = false;
  let dead = false;
  let kicks = 0;
  let saidSeat = false;
  let saidUv = false;
  let duckIn: Carryable | null = null;
  let bangT = 9;
  let bangs = 0;
  let beat = 0;
  let btnSpawned = false;
  let insideT = 0; // time spent inside, for the door hint
  let saidDoorHint = false;

  // In the bowl until it reaches the rim; past that it's over the whole floor.
  const setLevel = (y: number) => {
    level = y;
    const inBowl = y <= SEAT_Y - 0.02;
    bowlSludge.visible = inBowl;
    bowlSludge.position.y = y;
    floorSludge.visible = !inBowl;
    floorSludge.position.set(0, y, C);
  };
  setLevel(level);

  const flush = () => {
    if (escaped || dead) return;
    presses++;
    discover('mech:loo-flush');
    gurgle(Math.min(6, presses));
    // It first fills the bowl, then spills out and climbs the walls.
    levelTo = presses <= 1 ? SEAT_Y - 0.03 : SEAT_Y - 0.03 + (presses - 1) * RISE;
    flushBtn.position.x = FLUSH_POS.x + 0.05;
    ctx.after(160, () => (flushBtn.position.x = FLUSH_POS.x + 0.07));
    const line = FLUSH_LINES[Math.min(presses - 1, FLUSH_LINES.length - 1)];
    ctx.narrate(line, 5000, { priority: true });
  };

  const openDoor = (how: 'kick' | 'axe' | 'paid') => {
    if (escaped) return;
    escaped = true;
    ctx.setRegions([
      cabin,
      seat,
      { minX: -0.4, maxX: 0.4, minZ: C - 0.2, maxZ: C + 2.2, floorY: 0 },
      { minX: -14, maxX: 14, minZ: C + 1.2, maxZ: STAGE_Z - 0.6, floorY: 0 },
    ]);
    if (how === 'axe') {
      // A hole, then the door falls flat outward.
      ctx.narrate(AXED, 6000, { priority: true });
    } else if (how === 'kick') {
      ctx.narrate(KICKED, 5000, { priority: true });
      discover('mech:loo-door');
    }
    let t = 0;
    const fall = how !== 'paid';
    addUpdater((dt) => {
      t += dt;
      const k = Math.min(1, t / (fall ? 0.45 : 1.1));
      if (fall) {
        // hinge gives: the door tips outward onto the grass
        doorPivot.rotation.x = k * k * (Math.PI / 2 - 0.03);
        doorPivot.position.y = 0.02;
      } else doorPivot.rotation.y = -k * 1.9; // swings open on its hinge
      return k >= 1;
    });
    daylight();
  };

  // Out of the door: blinding white, then a festival afternoon, a crowd staring
  // in silence — and then going wild.
  const daylight = () => {
    const bg = ctx.scene.background as THREE.Color;
    const white = new THREE.Color(0xffffff);
    const skyC = new THREE.Color(0x9fd0ff);
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      const k1 = Math.min(1, t / 0.4);
      const k2 = Math.max(0, Math.min(1, (t - 0.6) / 1.8));
      bg.copy(new THREE.Color(0x0c0e10).lerp(white, k1).lerp(skyC, k2));
      fog.color.copy(bg);
      fog.near = 40;
      fog.far = 200;
      sun.intensity = 1.1 + (1 - k2) * 2.5; // overexposed, settling
      sky.intensity = 0.9 + (1 - k2) * 1.5;
      return t > 2.6;
    });
    // Everyone turns round.
    for (const g of crowd) {
      const want = Math.atan2(0 - g.position.x, C + 1 - g.position.z);
      const dur = 0.4 + Math.random() * 0.3;
      let tt = 0;
      const from = g.rotation.y;
      addUpdater((dt) => {
        tt += dt;
        const k = Math.min(1, tt / dur);
        let dy = want - from;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        g.rotation.y = from + dy * k;
        return k >= 1;
      });
    }
    ctx.after(900, () => ctx.narrate(STARE, 5000));
    ctx.after(4200, () => {
      applause(0.3, 3.2);
      sparkle();
      ctx.narrate(CHEER, 6000);
      // …and back to the stage, arms up.
      for (const g of crowd) {
        const arm = g.getObjectByName('armR') as THREE.Object3D | undefined;
        if (arm) arm.rotation.x = -2.6;
        const armL = g.getObjectByName('armL') as THREE.Object3D | undefined;
        if (armL) armL.rotation.x = -2.6;
      }
      spawnExit();
    });
  };

  const spawnExit = () => {
    if (btnSpawned) return;
    btnSpawned = true;
    const b = spawnPedestalButton(root, BUTTON_POS.clone(), () => {
      ctx.narrate(PRESSED, 3000, { priority: true });
      applause(0.35, 2.5);
      ctx.after(1400, () => ctx.advance(BUTTON_POS.clone()));
    });
    ctx.addObstacle(b.obstacle);
  };

  const kick = () => {
    if (escaped) return;
    kicks++;
    kickSfx();
    // the cabin wobbles
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      doorPivot.rotation.x = Math.sin(t * 40) * 0.02 * (1 - t / 0.3);
      return t > 0.3;
    });
    if (kicks >= 5) openDoor('kick');
    else ctx.narrate(KICK[kicks - 1], 3500, { priority: true });
  };

  const useVent = () => {
    if (escaped) return;
    discover('mech:loo-vent');
    escaped = true;
    ctx.setRegions([{ minX: -14, maxX: 14, minZ: C + 1.2, maxZ: STAGE_Z - 0.6, floorY: 0 }]);
    ctx.camera.position.set(0.6, CONFIG.PLAYER_HEIGHT, C + 2.2);
    setYaw(Math.PI); // facing the crowd (+z)
    setPitch(0);
    thud();
    ctx.narrate(VENT, 6000, { priority: true });
    daylight();
  };

  hooks = {
    axe: () => openDoor('axe'),
    pay: (c) => {
      if (escaped) return;
      ctx.removeCarryable(c);
      c.object.parent?.remove(c.object);
      realFlush();
      discover('reward:loo-paid');
      levelTo = SEAT_Y - 0.12;
      presses = 0;
      ctx.narrate(PAID, 6000, { priority: true });
      ctx.after(1800, () => {
        unlockSfx();
        setVacant();
        openDoor('paid');
      });
    },
    duck: (c) => {
      if (duckIn) return;
      ctx.removeCarryable(c);
      duckIn = c;
      c.object.position.set(BOWL.x, level + 0.02, BOWL.z);
      c.object.rotation.set(0, Math.random() * 6, 0);
      root.attach(c.object);
      quack();
      discover('reward:loo-duck');
      ctx.narrate(DUCKED, 6000, { priority: true });
    },
  };
  ctx.addTarget({ kind: 'loo-door', position: new THREE.Vector3(0, 1, C + HW), radius: 1.3 });
  ctx.addTarget({ kind: 'loo-slot', position: new THREE.Vector3(FLUSH_POS.x, 1, FLUSH_POS.z), radius: 1.4 });
  ctx.addTarget({ kind: 'loo-bowl', position: new THREE.Vector3(BOWL.x, 0.5, BOWL.z), radius: 1.2 });

  // ── Aim + press: flush, door, vent (from the seat) ──
  type Pick = 'flush' | 'door' | 'vent';
  const targets: { obj: THREE.Object3D; pick: Pick }[] = [
    { obj: flushBtn, pick: 'flush' },
    { obj: flushPlate, pick: 'flush' },
    { obj: flushSign, pick: 'flush' },
    { obj: slot, pick: 'flush' },
    { obj: door, pick: 'door' },
    { obj: lockSign, pick: 'door' },
    { obj: grille, pick: 'vent' },
  ];
  const objs = targets.map((t) => t.obj);
  const ray = new THREE.Raycaster();
  ray.far = 1.6;
  const CENTER = new THREE.Vector2(0, 0);
  let hover: Pick | null = null;
  const onSeat = () => ctx.camera.position.y > CONFIG.PLAYER_HEIGHT + SEAT_Y * 0.5;
  const it: Interactable = {
    id: 'porta-loo-aim',
    position: new THREE.Vector3(0, 1, C),
    radius: 2.2,
    promptLabel: '',
    onUse: () => {
      if (hover === 'flush') flush();
      else if (hover === 'door') kick();
      else if (hover === 'vent') useVent();
    },
  };
  registerInteractable(it);

  // ── Per frame ──
  addUpdater((dt) => {
    const cam = ctx.camera.position;
    // What the crosshair is on.
    hover = null;
    if (!escaped && !dead) {
      ray.setFromCamera(CENTER, ctx.camera);
      const h = ray.intersectObjects(objs, true)[0];
      if (h) {
        let o: THREE.Object3D | null = h.object;
        while (o && !objs.includes(o)) o = o.parent;
        const p = o ? targets[objs.indexOf(o)].pick : null;
        if (p !== 'vent' || onSeat()) {
          hover = p;
          it.position.copy(h.point);
        }
      }
    }
    it.promptLabel = hover ? 'PRESS' : '';

    // Stuck inside a while (or flushing) without trying the door: point at it.
    if (!escaped && !dead) {
      insideT += dt;
      if (!saidDoorHint && kicks === 0 && (insideT > 25 || presses >= 2)) {
        saidDoorHint = true;
        ctx.narrate(DOOR_HINT, 5000);
      }
    }

    // The level eases toward where the flushes put it.
    if (Math.abs(levelTo - level) > 1e-3) setLevel(level + Math.sign(levelTo - level) * Math.min(Math.abs(levelTo - level), dt * 0.35));
    if (duckIn) {
      duckIn.object.position.y = Math.max(level, SEAT_Y - 0.14) + 0.02 + Math.sin(performance.now() / 300) * 0.01;
      duckIn.object.rotation.y += dt * 0.6;
      if (level > SEAT_Y) {
        // it floats up with the tide and paddles about the cabin
        duckIn.object.position.x = Math.sin(performance.now() / 1400) * 0.35;
        duckIn.object.position.z = C - 0.1 + Math.cos(performance.now() / 1700) * 0.3;
      }
    }
    // Drowned?
    if (!dead && !escaped && level > cam.y - DROWN_MARGIN) {
      dead = true;
      ctx.narrate(DROWNED, 6000, { priority: true });
      ctx.die('drowned');
    }
    // Bubbles.
    if (!escaped && level > 0.1 && Math.random() < dt * (1 + presses)) {
      const m = new THREE.Mesh(bubbleGeo, sludgeMat);
      const inBowl = level <= SEAT_Y;
      m.position.set(inBowl ? BOWL.x + (Math.random() - 0.5) * 0.2 : (Math.random() - 0.5) * 1.1, level, inBowl ? BOWL.z + (Math.random() - 0.5) * 0.2 : C + (Math.random() - 0.5) * 1.1);
      root.add(m);
      bubbles.push({ m, t: 0 });
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.t += dt;
      b.m.scale.setScalar(1 + b.t * 2.5);
      b.m.position.y = level;
      if (b.t > 0.5) {
        root.remove(b.m);
        bubbles.splice(i, 1);
        if (Math.random() < 0.3) noise(0.04, 0.03, 700, 'lowpass'); // blup
      }
    }
    // Flies: loops round the bowl (and round you, more and more).
    const tNow = performance.now() / 1000;
    for (const f of flies) {
      f.a += dt * f.s;
      const cx = escaped ? 0 : BOWL.x;
      const cz = escaped ? C : BOWL.z + 0.2;
      f.m.position.set(cx + Math.cos(f.a) * f.r, f.y + Math.sin(tNow * f.s * 1.7) * 0.08, cz + Math.sin(f.a * 1.3) * f.r);
    }
    if (!escaped && Math.random() < dt * 0.25) tone({ type: 'sawtooth', from: 210 + Math.random() * 40, to: 230, dur: 0.5, gain: 0.012 });
    // Standing on the seat.
    if (!saidSeat && onSeat()) {
      saidSeat = true;
      ctx.narrate(SEAT, 4500, { priority: true });
    }
    // The UV torch finds the wall.
    if (!saidUv && horror.visible) {
      saidUv = true;
      discover('mech:loo-uv');
      ctx.narrate(UV, 5000, { priority: true });
    }
    // The bass through the wall, and the man outside.
    beat -= dt;
    if (beat <= 0) {
      beat = 0.5;
      ensureAudio();
      tone({ type: 'sine', from: 62, to: 45, dur: 0.16, gain: escaped ? 0.16 : 0.07 });
    }
    if (!escaped && !dead) {
      bangT -= dt;
      if (bangT <= 0) {
        bangT = 11 + Math.random() * 6;
        bang();
        ctx.narrate(bangs === 0 ? BANG_FIRST : BANG[(bangs - 1) % BANG.length], 4000);
        bangs++;
      }
    }
    return false;
  });

  ctx.narrate(INTRO, 7000);
  ctx.after(7600, () => {
    if (!escaped && !dead) ctx.narrate(INTRO_2, 5000);
  });

  portaLooTest.flush = flush;
  portaLooTest.kick = kick;
  portaLooTest.vent = useVent;
  portaLooTest.pay = (c) => hooks?.pay(c);
  portaLooTest.duck = (c) => hooks?.duck(c);
  portaLooTest.state = () => ({ presses, level, escaped, dead, kicks, duck: !!duckIn, button: btnSpawned });
}

/** Headless-test hooks (the sim drives presses directly). */
export const portaLooTest: {
  flush?: () => void;
  kick?: () => void;
  vent?: () => void;
  pay?: (c: Carryable) => void;
  duck?: (c: Carryable) => void;
  state?: () => { presses: number; level: number; escaped: boolean; dead: boolean; kicks: number; duck: boolean; button: boolean };
} = {};
