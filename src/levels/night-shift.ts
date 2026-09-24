import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { addUpdater } from '../experiences/scheduler';
import { hideRoomShell } from './scaffold';
import { spawnPedestalButton } from '../button/pedestal-button';
import { registerInteractable } from '../interactables/system';
import type { Interactable } from '../interactables/types';
import { tone, noise, ensureAudio, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { spawnCoin } from '../objects/coin';
import { uvInk } from '../objects/uv-torch';
import { FONT_DISPLAY, FONT_SIGN } from '../ui/fonts';

// THE NIGHT SHIFT — horror. The white room goes black and becomes the security
// office of BUTTONLAND, a closed-down button-themed family restaurant. It is
// midnight; hold out until six. The narrator is the previous guard, on a
// pre-recorded answering-machine message, one per hour.
//
// The office: a monitor (press it to cycle four cameras; while you watch a
// camera, whatever is on it can't move), a door button and a light button by
// each doorway, and a power readout that drains faster the more you use.
//
// Two mascots wander at night: Mr. Pressy (either side) and the duck one (the
// east side only). Each hops stage → hall → a side hall → your doorway on a
// dice roll every few seconds. The doorways are camera blind spots: check with
// the light. One at an open door for too long comes in — a lunge, a sting, and
// then it just presses the button on its own head at you. Boop. You die.
// A closed door when it tries: it bangs on the shutter and goes back.
//
// Power out (drained, or the generator at 5:40 regardless): doors up, lights
// off, glowing eyes in the west doorway, a music box. Six o'clock chimes just
// in time — if the power lasted long enough. Then the lights come on, Mr.
// Pressy takes his head off (it was Gary), says "Night." and clocks out, and
// the real button is on the stage.
//
// Extras: the UV torch is a real torch here — it lights the dark, shows the
// writing on the walls, and a mascot in a doorway backs off from it. A coin in
// the old arcade machine plays its tune, and the mascots stop to dance.

const HOUR_S = 28; // seconds per in-game hour: 12 → 6 is 168 s
const OFFICE = { minX: -1.7, maxX: 1.7, minZ: -0.9, maxZ: 1.3, floorY: 0 };
const H = 2.6; // office ceiling
const DOOR_X = 2.0; // doorway walls at x = ±DOOR_X
const DOOR_HALF = 0.6; // doorway spans z ∈ [−0.6, 0.6]
const STAGE = new THREE.Vector3(0, 0.4, -11);
const BTN_POS = new THREE.Vector3(0, 0.4, -10.9);

const DARK = 0x020203;
const POWER_BASE = 0.2; // % per second, always
const POWER_DOOR = 0.34; // per closed door
const POWER_LIGHT = 0.3; // per door light on
const POWER_CAM = 0.24; // while watching the monitor
const GENERATOR_AT = 5 + 2 / 3; // 5:40: the power goes regardless
const OUTAGE_ATTACK = 14; // seconds from lights-out until he comes in

const INTRO = vo([
  'Hello? Hello, hello. If you are hearing this, you got the night job at Buttonland. Congratulations. Or, you know. Sorry.',
  'Quick rundown. The doors are on the walls. The lights are next to them. The monitor shows the cameras. The power does not last. Nobody knows why. We stopped asking.',
  'Mister Pressy may wander about at night. It is a servo thing. If he comes to your door, close it. He is not dangerous. He just really, really wants you to press his button.',
  'Anyway. Six A M. That is the whole job. I am going home now. I am going home, right now, and I am never coming back.',
]);
const HOUR_LINES = vo([
  'Message two. Hey. It is one A M. You can hear them moving on the cameras. If you watch one, it holds still. Like a toddler. Or a statue. Or a toddler statue.',
  'Message three. The duck one is new. I do not know who ordered the duck one. Nobody ordered the duck one.',
  'Message four. If one of them is standing in your doorway, do not make eye contact. He takes it as a yes.',
  'Message five. If the power goes, just sit very still. Hum along. It helps. It does not help. Wait, is somebody in the',
]);
const JUMPSCARE = vo([
  'Oh. He got you. He just wanted you to press it. That is all he ever wanted.',
  'Oh. Boop. That was him. He booped you. You will not recover from the boop.',
]);
const BANG = vo(['He tried the door. He is not angry. He is disappointed.', 'Bang bang. The shutter held. It is a very good shutter. It is the only good thing here.']);
const AT_DOOR_FIRST = vo('There is somebody in your doorway. Close the door. Close the door.');
const POWER_OUT = vo('The power is out. That is fine. That is completely fine. Hum.');
const SIX_AM = vo('Six A M. You did it. Honestly, I did not think you would. I had a bet on.');
const REVEAL = vo('Oh. It was Gary. It has always been Gary. Gary works nights too.');
const GARY = vo('Night.');
const STAGE_LINE = vo('The button is on the stage. It has been waiting all night. Like the rest of us.');
const ARCADE = vo('Press Man. Twenty years old and it still works. They love this song. They cannot help it.');
const ARCADE_NO_COIN = vo('Insert coin. It has been saying that since nineteen ninety eight.');
const TORCH = vo('A torch. Good. Point it at things you would rather not see.');
const TORCH_SCARE = vo('He does not like the light. Nobody likes the light at three A M.');
const HOLD_STILL = vo('He is on the camera. While you watch him, he holds still. He is shy. That is the nicest way to put it.');

type NodeId = 'stage' | 'hall' | 'west' | 'east' | 'westDoor' | 'eastDoor';
const NODE_POS: Record<NodeId, THREE.Vector3> = {
  stage: new THREE.Vector3(-1.4, 0.4, -10.6),
  hall: new THREE.Vector3(0.8, 0, -6.5),
  west: new THREE.Vector3(-5, 0, -2.4),
  east: new THREE.Vector3(5, 0, -2.4),
  westDoor: new THREE.Vector3(-2.75, 0, 0),
  eastDoor: new THREE.Vector3(2.75, 0, 0),
};
const CAMS: { name: string; node: NodeId }[] = [
  { name: 'CAM 1  STAGE', node: 'stage' },
  { name: 'CAM 2  DINING HALL', node: 'hall' },
  { name: 'CAM 3  WEST HALL', node: 'west' },
  { name: 'CAM 4  EAST HALL', node: 'east' },
];

interface Mascot {
  name: 'pressy' | 'duck';
  g: THREE.Group;
  head: THREE.Group;
  headButton: THREE.Mesh;
  eyes: THREE.Mesh[];
  node: NodeId;
  side: 'west' | 'east' | null;
  moveT: number;
  every: number;
  activeFrom: number; // hour
  doorT: number; // seconds at the door
  seenAtDoor: boolean;
}

function sting(): void {
  ensureAudio();
  for (const f of [110, 116, 233, 311, 466]) tone({ type: 'sawtooth', from: f * 1.6, to: f, dur: 0.9, gain: 0.07 });
  noise(0.9, 0.5, 2600, 'bandpass');
}
function boop(): void {
  ensureAudio();
  tone({ type: 'sine', from: 880, to: 870, dur: 0.14, gain: 0.25 });
}
function kazoo(): void {
  ensureAudio();
  [330, 294, 262].forEach((f, i) => setTimeout(() => tone({ type: 'sawtooth', from: f, to: f * 0.94, dur: 0.32, gain: 0.07 }), i * 330));
}
function thump(near: number): void {
  ensureAudio();
  noise(0.12, 0.08 + 0.25 * near, 180, 'lowpass');
}
function bangSfx(): void {
  ensureAudio();
  for (let i = 0; i < 3; i++) setTimeout(() => noise(0.16, 0.45, 260, 'lowpass'), i * 240);
}
function chime(): void {
  ensureAudio();
  for (let i = 0; i < 6; i++) setTimeout(() => tone({ type: 'triangle', from: 660, to: 655, dur: 1.1, gain: 0.12 }), i * 420);
}
// An original music-box tune, two bars; call it repeatedly while it should play.
const BOX_NOTES = [784, 659, 587, 523, 587, 659, 784, 0, 880, 784, 659, 587, 523, 494, 523, 0];
function boxNote(i: number): void {
  const f = BOX_NOTES[i % BOX_NOTES.length];
  if (f) tone({ type: 'triangle', from: f * 2, to: f * 2, dur: 0.35, gain: 0.05 });
}
const CHIP_NOTES = [523, 659, 784, 1046, 784, 659, 523, 392];
function chipNote(i: number): void {
  tone({ type: 'square', from: CHIP_NOTES[i % CHIP_NOTES.length], dur: 0.12, gain: 0.04 });
}

// A mascot: a fuzzy body, a big round head with a red button on top, a stuck
// grin, and eyes that glow in the dark.
function makeMascot(kind: 'pressy' | 'duck'): { g: THREE.Group; head: THREE.Group; headButton: THREE.Mesh; eyes: THREE.Mesh[] } {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: kind === 'pressy' ? 0x7a2a2a : 0xc9a431, roughness: 1 });
  const s = kind === 'pressy' ? 1 : 0.8;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34 * s, 0.4 * s, 1.1 * s, 12), fur);
  body.position.y = 0.95 * s;
  g.add(body);
  for (const x of [-0.16, 0.16]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * s, 0.12 * s, 0.45 * s, 8), fur);
    leg.position.set(x * s, 0.22 * s, 0);
    g.add(leg);
  }
  for (const x of [-0.45, 0.45]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08 * s, 0.08 * s, 0.75 * s, 8), fur);
    arm.position.set(x * s, 1.0 * s, 0);
    arm.rotation.z = x > 0 ? 0.25 : -0.25;
    g.add(arm);
  }
  const head = new THREE.Group();
  head.position.y = 1.78 * s;
  g.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.36 * s, 16, 12), fur);
  head.add(skull);
  const eyeMat = new THREE.MeshBasicMaterial({ color: kind === 'pressy' ? 0xff3322 : 0xffe066, fog: false });
  const eyes: THREE.Mesh[] = [];
  for (const x of [-0.12, 0.12]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 10, 8), eyeMat);
    e.position.set(x * s, 0.07 * s, 0.32 * s);
    head.add(e);
    eyes.push(e);
  }
  // The grin: a row of teeth under a dark mouth.
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.34 * s, 0.1 * s, 0.05 * s), new THREE.MeshStandardMaterial({ color: 0x120606 }));
  mouth.position.set(0, -0.12 * s, 0.31 * s);
  head.add(mouth);
  const teeth = new THREE.Mesh(new THREE.BoxGeometry(0.3 * s, 0.04 * s, 0.03 * s), new THREE.MeshStandardMaterial({ color: 0xe8e2cc }));
  teeth.position.set(0, -0.095 * s, 0.34 * s);
  head.add(teeth);
  if (kind === 'duck') {
    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.24), new THREE.MeshStandardMaterial({ color: 0xe0762a, roughness: 0.8 }));
    bill.position.set(0, -0.04, 0.36);
    head.add(bill);
  }
  const headButton = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13 * s, 0.14 * s, 0.1 * s, 16),
    new THREE.MeshStandardMaterial({ color: 0xcc1414, emissive: 0x551000, roughness: 0.5 }),
  );
  headButton.position.y = 0.36 * s;
  head.add(headButton);
  return { g, head, headButton, eyes };
}

export function revealNightShift(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false });
  hideRoomShell(ctx);
  ctx.scene.background = new THREE.Color(DARK);
  ctx.scene.fog = new THREE.Fog(DARK, 3, 15);

  // The room's own lights go out.
  root.traverse((o) => {
    if ((o as THREE.Light).isLight) (o as THREE.Light).intensity = 0;
  });

  // Into the office, facing the desk.
  const cam = ctx.camera.position;
  cam.x = THREE.MathUtils.clamp(cam.x, -1.0, 1.0);
  cam.z = THREE.MathUtils.clamp(cam.z, 0.2, 0.9);
  ctx.setRegions([OFFICE]);

  // ── Light: almost nothing, and one bad fluorescent tube ──
  const ambient = new THREE.AmbientLight(0x8890a0, 0.05);
  root.add(ambient);
  const tube = new THREE.PointLight(0xdfe8ff, 0, 7, 1.6);
  tube.position.set(0, H - 0.2, 0);
  root.add(tube);
  const tubeMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
  const tubeMesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.12), tubeMat);
  tubeMesh.position.set(0, H - 0.04, 0);
  root.add(tubeMesh);
  const doorLights = {
    west: new THREE.PointLight(0xffe2b0, 0, 4.2, 1.4),
    east: new THREE.PointLight(0xffe2b0, 0, 4.2, 1.4),
  };
  doorLights.west.position.set(-2.8, 2.1, 0.5);
  doorLights.east.position.set(2.8, 2.1, 0.5);
  root.add(doorLights.west, doorLights.east);
  const hallLights: THREE.PointLight[] = [];
  for (const [x, z] of [[-4, -6], [4, -6], [0, -10], [-5, -1.5], [5, -1.5]]) {
    const l = new THREE.PointLight(0xfff1d8, 0, 12, 1.2);
    l.position.set(x, 3.2, z);
    root.add(l);
    hallLights.push(l);
  }
  const exitGlow = new THREE.PointLight(0xff2a1a, 0.5, 5, 2);
  exitGlow.position.set(0, 2.6, -11.8);
  root.add(exitGlow);

  // ── Geometry ──
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  const wall = new THREE.MeshStandardMaterial({ color: 0x3b3f36, roughness: 1 });
  const tile = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const checker = new THREE.MeshStandardMaterial({ color: 0x3a3232, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), tile);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.005;
  root.add(floor);
  const hallFloor = new THREE.Mesh(new THREE.PlaneGeometry(14, 8.5), checker);
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.position.set(0, 0.012, -8);
  root.add(hallFloor);
  // Office: back wall (desk side), front wall, side walls around the doorways.
  box(4.2, H, 0.15, 0, H / 2, -1.6, wall);
  box(4.2, H, 0.15, 0, H / 2, 1.6, wall);
  for (const sx of [-1, 1]) {
    const x = sx * DOOR_X;
    box(0.15, H, 1.0, x, H / 2, -1.1, wall);
    box(0.15, H, 1.0, x, H / 2, 1.1, wall);
    box(0.15, H - 2.2, DOOR_HALF * 2, x, 2.2 + (H - 2.2) / 2, 0, wall);
  }
  box(4.2, 0.1, 3.4, 0, H + 0.05, 0, wall); // ceiling
  // Corridors: out through each doorway, then north to the hall.
  const hallWall = new THREE.MeshStandardMaterial({ color: 0x4a2f3a, roughness: 1 });
  for (const sx of [-1, 1]) {
    box(3.9, 3.2, 0.15, sx * 3.95, 1.6, 0.65, hallWall); // south side of the west/east leg
    box(0.15, 3.2, 4.6, sx * 5.9, 1.6, -1.6, hallWall); // outer side
    box(2.3, 3.2, 0.15, sx * 3.15, 1.6, -0.65, hallWall); // north side, up to the turn
    box(0.15, 3.2, 3.3, sx * 4.1, 1.6, -2.3, hallWall); // inner side of the north leg
  }
  // The dining hall: walls, the stage, tables with party hats, a ball pit.
  box(14.2, 3.4, 0.15, 0, 1.7, -12.1, hallWall);
  for (const sx of [-1, 1]) {
    box(0.15, 3.4, 8.3, sx * 7.05, 1.7, -8, hallWall);
    box(1.1, 3.4, 0.15, sx * 6.5, 1.7, -3.9, hallWall);
    box(2.7, 3.4, 0.15, sx * 2.75, 1.7, -3.9, hallWall);
  }
  const stageMat = new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.8 });
  box(7, 0.4, 2.3, 0, 0.2, -10.95, stageMat);
  const curtain = new THREE.MeshStandardMaterial({ color: 0x5a0d14, roughness: 1 });
  box(7.2, 3.2, 0.1, 0, 1.6, -11.95, curtain);
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 0.6 });
  const hatColors = [0xe04a8a, 0x3ab0e0, 0xf0c030, 0x60c060];
  const tables: THREE.Mesh[] = [];
  for (const [x, z] of [[-3.5, -6], [3.5, -6], [-3.5, -8.5], [3.5, -8.5]]) {
    const t = box(2.4, 0.08, 0.9, x, 0.76, z, tableMat);
    tables.push(t);
    ctx.addObstacle({ x: x - 0.7, z, radius: 0.5 });
    ctx.addObstacle({ x: x + 0.7, z, radius: 0.5 });
    for (let i = 0; i < 3; i++) {
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 10), new THREE.MeshStandardMaterial({ color: hatColors[(i + x) & 3], roughness: 0.7 }));
      hat.position.set(x - 0.8 + i * 0.8, 0.91, z + (i % 2 ? 0.15 : -0.1));
      hat.rotation.z = (i - 1) * 0.3;
      root.add(hat);
    }
  }
  const balls = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.6 }), 90);
  const m4 = new THREE.Matrix4();
  const ballCol = new THREE.Color();
  for (let i = 0; i < 90; i++) {
    m4.setPosition(5 + (Math.random() - 0.5) * 1.6, 0.07 + Math.random() * 0.2, -10.5 + (Math.random() - 0.5) * 1.6);
    balls.setMatrixAt(i, m4);
    balls.setColorAt(i, ballCol.setHex(hatColors[i & 3]));
  }
  root.add(balls);
  // Posters (canvas): the mascot, and a smiling rule.
  const poster = (text: string, sub: string, x: number, y: number, z: number, ry: number) => {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 340;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#d9c9a0';
    g.fillRect(0, 0, 256, 340);
    g.fillStyle = '#7a2a2a';
    g.beginPath();
    g.arc(128, 140, 80, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#cc1414';
    g.fillRect(98, 48, 60, 22);
    g.fillStyle = '#fff';
    g.fillRect(88, 170, 80, 14);
    g.fillStyle = '#111';
    g.fillRect(96, 118, 16, 16);
    g.fillRect(144, 118, 16, 16);
    g.fillStyle = '#3a1a10';
    g.textAlign = 'center';
    let px = 36;
    do g.font = `bold ${px}px ${FONT_SIGN}`;
    while (g.measureText(text).width > 236 && --px > 10);
    g.fillText(text, 128, 262);
    px = 20;
    do g.font = `${px}px ${FONT_SIGN}`;
    while (g.measureText(sub).width > 236 && --px > 8);
    g.fillText(sub, 128, 300);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.0), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 1 }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    root.add(m);
  };
  poster('MR. PRESSY', 'SAYS: PRESS!', -1.0, 1.6, 1.505, Math.PI);
  poster('BUTTONLAND', 'FUN FOR THE WHOLE FAMILY', -6.95, 1.8, -7, Math.PI / 2);
  poster('NO RUNNING', 'NO CRYING. NO LEAVING.', 6.95, 1.8, -7, -Math.PI / 2);

  // UV ink on the walls: only the torch shows it.
  const ink = (text: string, x: number, y: number, z: number, ry: number, w = 2.2) => {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 128;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#d6b8ff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let px = 56;
    do g.font = `bold ${px}px ${FONT_SIGN}`;
    while (g.measureText(text).width > 490 && --px > 10);
    g.fillText(text, 256, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, fog: false }));
    m.position.set(x, y, z);
    m.rotation.y = ry;
    root.add(m);
    uvInk(m);
  };
  ink('IT JUST WANTS YOU TO PRESS IT', 0, 1.9, -1.51, 0, 2.6);
  ink('DONT LOOK AT THE DOORS', -3.9, 1.6, 0.56, Math.PI);
  ink('GARY?', 3.9, 1.6, 0.56, Math.PI, 1.2);
  ink('6 AM IS A PROMISE', 0, 2.4, -12.0, 0);

  // ── The desk: the monitor, the clock/power readout, a coin; the arcade ──
  const deskMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.8 });
  box(2.6, 0.06, 0.7, 0, 0.76, -1.2, deskMat);
  box(2.6, 0.72, 0.05, 0, 0.38, -1.52, deskMat);
  const crt = box(0.62, 0.5, 0.5, 0, 1.04, -1.25, new THREE.MeshStandardMaterial({ color: 0xb8b09a, roughness: 0.7 }));
  const monCv = document.createElement('canvas');
  monCv.width = 256;
  monCv.height = 192;
  const mon = monCv.getContext('2d')!;
  const monTex = new THREE.CanvasTexture(monCv);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.375), new THREE.MeshBasicMaterial({ map: monTex, fog: false }));
  screen.position.set(0, 1.05, -0.99);
  root.add(screen);
  const readCv = document.createElement('canvas');
  readCv.width = 256;
  readCv.height = 96;
  const read = readCv.getContext('2d')!;
  const readTex = new THREE.CanvasTexture(readCv);
  const readout = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.135), new THREE.MeshBasicMaterial({ map: readTex, fog: false }));
  readout.position.set(0.72, 0.86, -1.0);
  readout.rotation.x = -0.5;
  root.add(readout);
  box(0.4, 0.14, 0.18, 0.72, 0.84, -1.1, new THREE.MeshStandardMaterial({ color: 0x222222 }));
  spawnCoin(ctx, new THREE.Vector3(-0.8, 0.8, -1.05));
  const arcade = new THREE.Group();
  arcade.position.set(1.35, 0, 1.15);
  arcade.rotation.y = -Math.PI * 0.75;
  root.add(arcade);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.7, 0.55), new THREE.MeshStandardMaterial({ color: 0x1d2a6a, roughness: 0.7 }));
  cab.position.y = 0.85;
  arcade.add(cab);
  const arcCv = document.createElement('canvas');
  arcCv.width = 128;
  arcCv.height = 96;
  const arc = arcCv.getContext('2d')!;
  const arcTex = new THREE.CanvasTexture(arcCv);
  const arcScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.33), new THREE.MeshBasicMaterial({ map: arcTex, fog: false }));
  arcScreen.position.set(0, 1.3, 0.28);
  arcade.add(arcScreen);
  ctx.addObstacle({ x: 1.35, z: 1.15, radius: 0.4 });

  // Door + light buttons by each doorway, and the shutters.
  const shutterMat = new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.5, metalness: 0.6 });
  const shutters = { west: box(0.1, 2.2, 1.3, -DOOR_X, 3.3, 0, shutterMat), east: box(0.1, 2.2, 1.3, DOOR_X, 3.3, 0, shutterMat) };
  const btnMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.25, roughness: 0.5 });
  const panelBtn = (x: number, y: number, z: number, c: number, action: string) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16), btnMat(c));
    m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z);
    m.userData.action = action;
    root.add(m);
    return m;
  };
  const pickables: THREE.Object3D[] = [
    panelBtn(-DOOR_X + 0.1, 1.35, 0.85, 0xcc2222, 'door-west'),
    panelBtn(-DOOR_X + 0.1, 1.05, 0.85, 0xe0e0e0, 'light-west'),
    panelBtn(DOOR_X - 0.1, 1.35, 0.85, 0xcc2222, 'door-east'),
    panelBtn(DOOR_X - 0.1, 1.05, 0.85, 0xe0e0e0, 'light-east'),
  ];
  screen.userData.action = 'monitor';
  crt.userData.action = 'monitor';
  cab.userData.action = 'arcade';
  arcScreen.userData.action = 'arcade';
  pickables.push(screen, crt, cab, arcScreen);

  // ── The mascots ──
  const mascots: Mascot[] = (['pressy', 'duck'] as const).map((name) => {
    const m = makeMascot(name);
    root.add(m.g);
    return { name, ...m, node: 'stage' as NodeId, side: null, moveT: 0, every: name === 'pressy' ? 5.5 : 7, activeFrom: name === 'pressy' ? 1 : 2, doorT: 0, seenAtDoor: false };
  });
  const placeMascots = () => {
    for (const [i, m] of mascots.entries()) {
      const p = NODE_POS[m.node];
      // two on the same node stand side by side
      const twin = mascots.some((o, j) => j < i && o.node === m.node);
      m.g.position.set(p.x + (twin ? 0.9 : 0), p.y, p.z + (twin ? -0.4 : 0));
      const face = m.node.endsWith('Door') ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(p.x * 0.3, 0, 2);
      m.g.rotation.y = Math.atan2(face.x - m.g.position.x, face.z - m.g.position.z);
    }
  };
  placeMascots();

  // ── State ──
  let clock = 0; // seconds since midnight (game)
  let power = 100;
  const doorShut = { west: false, east: false };
  const lightOn = { west: 0, east: 0 }; // seconds left on
  let camIdx = 0;
  let watching = false;
  let camStatic = 0; // a burst of static after something moves on camera
  let outage = false;
  let outageT = 0;
  let over = false; // jumpscare or six o'clock: the night logic stops
  let won = false;
  let dance = 0; // > 0: the arcade tune is playing; everybody dances
  let firstDoorSeen = false;
  let saidHold = false;
  let saidTorch = false;
  let torchCool = 0;
  let hourSaid = 0;
  const hour = () => Math.min(6, clock / HOUR_S);
  const aggression = () => 0.22 + 0.13 * Math.floor(hour());

  const drawReadout = () => {
    read.fillStyle = '#050505';
    read.fillRect(0, 0, 256, 96);
    read.font = `bold 34px ${FONT_DISPLAY}`;
    read.textAlign = 'left';
    read.textBaseline = 'middle';
    const h = Math.floor(hour());
    read.fillStyle = '#ff5533';
    read.fillText(`${h === 0 ? 12 : h} AM`, 14, 30);
    read.fillStyle = power > 25 ? '#66ff88' : '#ff4444';
    read.fillText(`PWR ${Math.max(0, Math.ceil(power))}%`, 14, 70);
    readTex.needsUpdate = true;
  };

  // The CRT: a sketch of the room, anybody standing in it, grain, and a label.
  const drawMonitor = () => {
    mon.fillStyle = '#0c120c';
    mon.fillRect(0, 0, 256, 192);
    if (outage) {
      monTex.needsUpdate = true;
      return;
    }
    const c = CAMS[camIdx];
    mon.strokeStyle = '#3f5f3f';
    mon.lineWidth = 2;
    // Rooms, in wobbly green line-art.
    if (c.node === 'stage') {
      mon.strokeRect(30, 110, 196, 30);
      mon.fillStyle = '#2a0a0e';
      mon.fillRect(34, 30, 188, 80);
    } else if (c.node === 'hall') {
      for (const x of [40, 150]) mon.strokeRect(x, 120, 66, 14);
    } else {
      mon.beginPath();
      mon.moveTo(60, 180);
      mon.lineTo(110, 50);
      mon.lineTo(146, 50);
      mon.lineTo(196, 180);
      mon.stroke();
    }
    let n = 0;
    for (const m of mascots) {
      if (m.node !== c.node) continue;
      const x = 100 + n * 70;
      const y = c.node === 'stage' ? 70 : 90;
      mon.fillStyle = m.name === 'pressy' ? '#4a2020' : '#6a5a20';
      mon.beginPath();
      mon.arc(x, y, 22, 0, Math.PI * 2);
      mon.fill();
      mon.fillRect(x - 16, y + 18, 32, 50);
      mon.fillStyle = '#ff3322';
      mon.fillRect(x - 8, y - 30, 16, 7);
      mon.fillStyle = m.name === 'pressy' ? '#ff8870' : '#fff08a';
      mon.fillRect(x - 10, y - 4, 5, 5);
      mon.fillRect(x + 5, y - 4, 5, 5);
      mon.fillStyle = '#e8e2cc';
      mon.fillRect(x - 11, y + 8, 22, 3);
      n++;
    }
    // Grain + scanlines.
    for (let i = 0; i < 220; i++) {
      const g = (Math.random() * 90) | 0;
      mon.fillStyle = `rgb(${g},${g + 20},${g})`;
      mon.fillRect(Math.random() * 256, Math.random() * 192, 2, 1);
    }
    if (camStatic > 0) {
      for (let i = 0; i < 1400; i++) {
        const g = (Math.random() * 200) | 0;
        mon.fillStyle = `rgb(${g},${g},${g})`;
        mon.fillRect(Math.random() * 256, Math.random() * 192, 3, 2);
      }
    }
    mon.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < 192; y += 3) mon.fillRect(0, y, 256, 1);
    mon.font = `bold 16px ${FONT_DISPLAY}`;
    mon.fillStyle = '#c8ffc8';
    mon.textAlign = 'left';
    mon.fillText(c.name, 8, 18);
    if (Math.floor(clock * 2) % 2) {
      mon.fillStyle = '#ff3030';
      mon.beginPath();
      mon.arc(240, 14, 5, 0, Math.PI * 2);
      mon.fill();
    }
    monTex.needsUpdate = true;
  };
  const drawArcade = (t: number, playing: boolean) => {
    arc.fillStyle = '#000';
    arc.fillRect(0, 0, 128, 96);
    arc.font = `bold 13px ${FONT_DISPLAY}`;
    arc.textAlign = 'center';
    arc.fillStyle = '#ffd400';
    arc.fillText('PRESS-MAN', 64, 20);
    if (playing) {
      arc.beginPath();
      arc.arc(30 + ((t * 40) % 70), 58, 10, 0.4, Math.PI * 2 - 0.4);
      arc.lineTo(30 + ((t * 40) % 70), 58);
      arc.fill();
    } else if (Math.floor(t * 1.5) % 2) {
      arc.fillStyle = '#ffffff';
      arc.fillText('INSERT COIN', 64, 62);
    }
    arcTex.needsUpdate = true;
  };
  drawReadout();
  drawMonitor();
  drawArcade(0, false);

  // ── Controls: one interactable, claimed by whatever the crosshair is on ──
  const aim = new THREE.Raycaster();
  aim.far = 2.6;
  const CENTER = new THREE.Vector2(0, 0);
  let sel: string | null = null;
  const selPos = new THREE.Vector3();
  const use: Interactable = {
    id: 'night-office',
    position: new THREE.Vector3(0, 1, -1),
    radius: 3,
    promptLabel: '',
    onUse: () => {
      if (sel) act(sel);
    },
  };
  registerInteractable(use);

  const setShutter = (side: 'west' | 'east', shut: boolean) => {
    doorShut[side] = shut;
    ensureAudio();
    noise(0.35, 0.3, 500, 'lowpass');
    tone({ type: 'square', from: 90, to: 60, dur: 0.3, gain: 0.04 });
  };
  function act(a: string): void {
    if (over) return;
    discover('mech:night-office');
    if (a === 'monitor') {
      if (outage) return;
      camIdx = (camIdx + 1) % CAMS.length;
      camStatic = 0.25;
      tone({ type: 'square', from: 1400, dur: 0.03, gain: 0.03 });
      drawMonitor();
      return;
    }
    if (a === 'arcade') {
      if (dance > 0) return;
      if (!ctx.consumeHeld('coin')) {
        ctx.narrate(ARCADE_NO_COIN, 3500, { interruptible: true });
        return;
      }
      dance = 8;
      discover('mech:night-arcade');
      ctx.narrate(ARCADE, 5000, { priority: true });
      return;
    }
    if (outage) {
      tone({ type: 'square', from: 120, dur: 0.05, gain: 0.03 }); // dead click
      return;
    }
    const [kind, side] = a.split('-') as ['door' | 'light', 'west' | 'east'];
    if (kind === 'door') setShutter(side, !doorShut[side]);
    else {
      lightOn[side] = lightOn[side] > 0 ? 0 : 2.8;
      noise(0.05, 0.08, 3000, 'highpass');
    }
  }

  // ── The torch: a real light here, while held ──
  const torch = new THREE.SpotLight(0xcfc4ff, 0, 11, 0.36, 0.5, 1.2);
  root.add(torch, torch.target);
  const fwd = new THREE.Vector3();

  // ── Endings ──
  const scareHead = makeMascot('pressy');
  scareHead.g.visible = false;
  root.add(scareHead.g);
  const canvasEl = typeof document !== 'undefined' ? (document.getElementById('scene') as HTMLElement | null) : null;
  const shake = (secs: number) => {
    if (!canvasEl) return;
    const prev = canvasEl.style.transform;
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      canvasEl.style.transform = t < secs ? `translate(${(Math.random() - 0.5) * 18}px, ${(Math.random() - 0.5) * 18}px)` : prev;
      return t >= secs;
    });
    setTimeout(() => (canvasEl.style.transform = prev), secs * 1000 + 400); // backstop if the room changes mid-shake
  };
  const jumpscare = (m: Mascot) => {
    if (over) return;
    over = true;
    discover('mech:night-boop');
    m.g.visible = false;
    tube.intensity = 2.4;
    tube.color.setHex(0xff6050);
    sting();
    shake(0.8);
    scareHead.g.visible = true;
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      ctx.camera.getWorldDirection(fwd);
      const d = THREE.MathUtils.lerp(1.6, 0.62, Math.min(1, t / 0.25));
      scareHead.g.position.copy(ctx.camera.position).addScaledVector(fwd, d);
      scareHead.g.position.y -= 1.78; // its head at your eyes
      scareHead.g.lookAt(ctx.camera.position.x, scareHead.g.position.y, ctx.camera.position.z);
      scareHead.head.rotation.x = t > 0.9 && t < 1.2 ? 0.35 : 0; // a nod: the button, at you
      scareHead.headButton.position.y = t > 0.95 && t < 1.25 ? 0.32 : 0.36;
      return t > 3.4;
    });
    ctx.after(1000, boop);
    ctx.after(1500, kazoo);
    ctx.after(1700, () => ctx.narrate(JUMPSCARE[Math.random() < 0.7 ? 0 : 1], 6000, { priority: true }));
    ctx.after(3300, () => ctx.die('night-shift'));
  };

  const sixAM = () => {
    if (won) return;
    over = true;
    won = true;
    outage = false;
    chime();
    discover('reward:survived-night');
    ctx.narrate(SIX_AM, 6000, { priority: true });
    doorShut.west = doorShut.east = false;
    for (const l of hallLights) l.intensity = 1.1;
    tube.color.setHex(0xdfe8ff);
    tube.intensity = 1.6;
    tubeMat.color.setHex(0xf4f8ff);
    ambient.intensity = 0.35;
    ctx.scene.fog = new THREE.Fog(0x201c1c, 10, 40);
    ctx.scene.background = new THREE.Color(0x201c1c);
    // The building is yours: out of the office, down either hall, to the stage.
    ctx.setRegions([
      OFFICE,
      { minX: -5.8, maxX: -1.0, minZ: -0.5, maxZ: 0.5, floorY: 0 },
      { minX: 1.0, maxX: 5.8, minZ: -0.5, maxZ: 0.5, floorY: 0 },
      { minX: -5.8, maxX: -4.25, minZ: -4.6, maxZ: 0.5, floorY: 0 },
      { minX: 4.25, maxX: 5.8, minZ: -4.6, maxZ: 0.5, floorY: 0 },
      { minX: -6.9, maxX: 6.9, minZ: -10.4, maxZ: -3.95, floorY: 0 },
      { minX: -3.4, maxX: 3.4, minZ: -11.8, maxZ: -9.8, floorY: 0.4 },
    ]);
    // Mr. Pressy, in the hall, takes his head off. It was Gary.
    const pressy = mascots[0];
    const duck = mascots[1];
    pressy.node = 'hall';
    duck.node = 'hall';
    placeMascots();
    pressy.g.position.set(-1.2, 0, -5.4);
    pressy.g.rotation.y = 0;
    duck.g.position.set(1.4, 0, -6.2);
    const garyHead = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), new THREE.MeshStandardMaterial({ color: 0xd9b08c, roughness: 0.8 }));
    garyHead.position.y = 1.72;
    pressy.g.add(garyHead);
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      if (t > 3 && t < 4.5) pressy.head.position.set(0.45, 1.78 + Math.min(0.5, (t - 3) * 0.6), 0); // lifted off, held aside
      if (t > 4.5) pressy.head.position.set(0.5, 1.1, 0.1); // under his arm
      duck.g.scale.y = Math.max(0.3, 1 - Math.max(0, t - 2) * 0.5); // the duck one sags
      if (t > 8) {
        pressy.g.position.x += dt * 1.2; // clocks out, off east
        pressy.g.rotation.y = Math.PI / 2;
      }
      if (t > 14) pressy.g.visible = false;
      return t > 14;
    });
    ctx.after(3200, () => ctx.narrate(REVEAL, 5000));
    ctx.after(7200, () => ctx.narrate(GARY, 1500));
    ctx.after(9500, () => {
      const btn = spawnPedestalButton(root, BTN_POS, () => {
        sparkle();
        ctx.advance(BTN_POS.clone());
      });
      ctx.addObstacle(btn.obstacle);
      ctx.narrate(STAGE_LINE, 5000);
    });
  };

  // ── Power out ──
  const powerOut = () => {
    if (outage || over) return;
    outage = true;
    outageT = 0;
    discover('mech:night-power-out');
    doorShut.west = doorShut.east = false;
    lightOn.west = lightOn.east = 0;
    ensureAudio();
    tone({ type: 'sawtooth', from: 120, to: 30, dur: 1.2, gain: 0.1 });
    drawMonitor();
    const pressy = mascots[0];
    pressy.node = 'westDoor';
    pressy.side = 'west';
    placeMascots();
    ctx.after(900, () => ctx.narrate(POWER_OUT, 4500, { priority: true }));
  };

  // ── The night ──
  ctx.narrate(INTRO[0], 7000);
  for (let i = 1; i < INTRO.length; i++) ctx.narrate(INTRO[i], 8000);
  let flick = 0;
  let boxT = 0;
  let boxI = 0;
  let chipT = 0;
  let chipI = 0;
  let monT = 0;
  addUpdater((dt) => {
    // Aim.
    aim.setFromCamera(CENTER, ctx.camera);
    const hit = aim.intersectObjects(pickables, false)[0];
    sel = hit ? (hit.object.userData.action as string) : null;
    use.promptLabel = sel && !over ? 'PRESS' : '';
    if (hit) {
      selPos.copy(hit.point);
      use.position.copy(selPos);
    } else use.position.copy(ctx.camera.position);
    watching = !!hit && sel === 'monitor' && !outage;

    // The torch.
    const torchOn = ctx.isHolding('uv-torch');
    ctx.camera.getWorldDirection(fwd);
    torch.intensity = torchOn ? 6 : 0;
    if (torchOn) {
      torch.position.copy(ctx.camera.position).addScaledVector(fwd, 0.3);
      torch.target.position.copy(ctx.camera.position).addScaledVector(fwd, 5);
      if (!saidTorch) {
        saidTorch = true;
        discover('mech:night-torch');
        ctx.narrate(TORCH, 4500);
      }
    }
    torchCool -= dt;

    if (over) {
      if (!won) tube.intensity = 1.5 + Math.random() * 1.5;
      return false;
    }

    clock += dt;
    // The fluorescent tube: mostly on, sometimes not.
    flick -= dt;
    if (outage) tube.intensity = 0;
    else if (flick <= 0) {
      flick = Math.random() < 0.08 ? 0.06 + Math.random() * 0.12 : 0.1 + Math.random() * 0.8;
      const off = Math.random() < 0.12;
      tube.intensity = off ? 0.05 : 0.9 + Math.random() * 0.25;
      tubeMat.color.setHex(off ? 0x333333 : 0xdfe8ff);
      if (off) noise(0.06, 0.03, 4000, 'highpass');
    }

    // Hours: a new message each hour; six o'clock ends it.
    const h = Math.floor(hour());
    if (h >= 6) {
      sixAM();
      return false;
    }
    if (h > hourSaid) {
      hourSaid = h;
      if (HOUR_LINES[h - 1]) ctx.narrate(HOUR_LINES[h - 1], 9000);
      tone({ type: 'sine', from: 440, dur: 0.4, gain: 0.05 }); // the answering machine beep
    }
    if (hour() >= GENERATOR_AT && !outage) powerOut();

    // Power.
    if (!outage) {
      const drain =
        POWER_BASE +
        (doorShut.west ? POWER_DOOR : 0) +
        (doorShut.east ? POWER_DOOR : 0) +
        (lightOn.west > 0 ? POWER_LIGHT : 0) +
        (lightOn.east > 0 ? POWER_LIGHT : 0) +
        (watching ? POWER_CAM : 0);
      power -= drain * dt;
      if (power <= 0) {
        power = 0;
        powerOut();
      }
    }
    for (const side of ['west', 'east'] as const) {
      lightOn[side] = Math.max(0, lightOn[side] - dt);
      doorLights[side].intensity = lightOn[side] > 0 && !outage ? 1.6 + Math.random() * 0.2 : 0;
      const target = doorShut[side] ? 1.1 : 3.3;
      const s = shutters[side];
      s.position.y += THREE.MathUtils.clamp(target - s.position.y, -dt * 9, dt * 9);
    }

    // The arcade tune: everybody dances, nobody moves on.
    if (dance > 0) {
      dance -= dt;
      chipT -= dt;
      if (chipT <= 0) {
        chipT = 0.16;
        chipNote(chipI++);
      }
      for (const m of mascots) {
        m.g.position.y = NODE_POS[m.node].y + Math.abs(Math.sin(clock * 9)) * 0.12;
        m.g.rotation.z = Math.sin(clock * 9) * 0.15;
      }
      if (dance <= 0) for (const m of mascots) m.g.rotation.z = 0;
    }
    drawArcade(clock, dance > 0);

    // Outage: the eyes in the west doorway, the music box, and then him.
    if (outage) {
      outageT += dt;
      boxT -= dt;
      if (boxT <= 0) {
        boxT = 0.38;
        boxNote(boxI++);
      }
      const pressy = mascots[0];
      const glow = 0.5 + 0.5 * Math.sin(clock * 3);
      for (const e of pressy.eyes) e.visible = glow > 0.25 || outageT > OUTAGE_ATTACK - 3;
      if (outageT >= OUTAGE_ATTACK) jumpscare(pressy);
      return false;
    }

    // The mascots.
    let moved = false;
    for (const m of mascots) {
      if (h < m.activeFrom || dance > 0) continue;
      const onCam = watching && CAMS[camIdx].node === m.node;
      if (onCam && !saidHold && h >= 1) {
        saidHold = true;
        ctx.narrate(HOLD_STILL, 5000, { interruptible: true });
      }
      // At the door: wait, then try it.
      if (m.node === 'westDoor' || m.node === 'eastDoor') {
        const side = m.node === 'westDoor' ? 'west' : 'east';
        if (lightOn[side] > 0 && !m.seenAtDoor) {
          m.seenAtDoor = true;
          tone({ type: 'sawtooth', from: 180, to: 120, dur: 0.5, gain: 0.05 });
          if (!firstDoorSeen) {
            firstDoorSeen = true;
            ctx.narrate(AT_DOOR_FIRST, 3500, { priority: true });
          }
        }
        // The torch, shone at it from close: it backs off.
        if (torchOn && torchCool <= 0) {
          const to = m.g.position.clone().setY(1.6).sub(ctx.camera.position);
          const d = to.length();
          if (d < 4.5 && to.normalize().dot(fwd) > 0.9) {
            torchCool = 20;
            discover('mech:night-torch');
            ctx.narrate(TORCH_SCARE, 4500, { priority: true });
            m.node = 'hall';
            m.doorT = 0;
            m.seenAtDoor = false;
            moved = true;
            continue;
          }
        }
        m.doorT += dt;
        const wait = h >= 4 ? 4.5 : 6;
        if (m.doorT >= wait) {
          if (doorShut[side]) {
            bangSfx();
            ctx.narrate(BANG[Math.random() < 0.5 ? 0 : 1], 4000, { interruptible: true });
            m.node = 'hall';
            m.doorT = 0;
            m.seenAtDoor = false;
            moved = true;
          } else {
            jumpscare(m);
            return false;
          }
        }
        continue;
      }
      if (onCam) continue; // watched: it holds still
      m.moveT += dt;
      if (m.moveT < m.every) continue;
      m.moveT = 0;
      if (Math.random() > aggression()) continue;
      const was = m.node;
      if (m.node === 'stage') m.node = 'hall';
      else if (m.node === 'hall') {
        m.side = m.name === 'duck' ? 'east' : Math.random() < 0.5 ? 'west' : 'east';
        m.node = m.side;
      } else if (m.node === 'west' || m.node === 'east') {
        m.node = m.node === 'west' ? 'westDoor' : 'eastDoor';
        m.doorT = 0;
        m.seenAtDoor = false;
      }
      if (m.node !== was) {
        moved = true;
        const near = m.node.endsWith('Door') ? 1 : m.node === 'west' || m.node === 'east' ? 0.5 : 0.1;
        thump(near);
        if (CAMS[camIdx].node === was || CAMS[camIdx].node === m.node) camStatic = 0.6;
      }
    }
    if (moved) placeMascots();
    for (const m of mascots) for (const e of m.eyes) e.visible = true;

    // The monitor, ~12 fps.
    camStatic = Math.max(0, camStatic - dt);
    monT -= dt;
    if (monT <= 0) {
      monT = 0.08;
      drawMonitor();
    }
    drawReadout();
    return false;
  });

  nightTest.state = () => ({
    clock,
    hour: hour(),
    power,
    outage,
    over,
    won,
    doors: { ...doorShut },
    camIdx,
    watching,
    mascots: mascots.map((m) => ({ name: m.name, node: m.node, doorT: m.doorT })),
  });
  nightTest.act = act;
  nightTest.setClock = (s: number) => {
    clock = s;
    hourSaid = Math.floor(hour());
  };
  nightTest.setPower = (p: number) => {
    power = p;
  };
  nightTest.put = (i: number, node: NodeId) => {
    mascots[i].node = node;
    mascots[i].doorT = 0;
    placeMascots();
  };
  nightTest.powerOut = powerOut;
}

/** Headless-test hooks. */
export const nightTest: {
  state: () => unknown;
  act: (a: string) => void;
  setClock: (s: number) => void;
  setPower: (p: number) => void;
  put: (i: number, node: NodeId) => void;
  powerOut: () => void;
} = {
  state: () => null,
  act: () => {},
  setClock: () => {},
  setPower: () => {},
  put: () => {},
  powerOut: () => {},
};
