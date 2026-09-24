import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import type { RoomBounds } from '../controls/player-camera';
import { setYaw, setPitch } from '../controls/player-camera';
import { CONFIG } from '../config';
import { addUpdater, currentGeneration } from '../experiences/scheduler';
import { hideRoomShell, groundPlane } from './scaffold';
import { createAsset } from '../assets';
import { spawnPedestalButton } from '../button/pedestal-button';
import { registerInteractable } from '../interactables/system';
import { tone, noise, thud, pop, click, ensureAudio } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover, isDiscovered } from '../graph/progress';
import { setScriptHints } from '../objects/script';
import { FONT_SIGN, FONT_VOICE, FONT_DISPLAY } from '../ui/fonts';

// THE TIME LOOP — the room opens onto a small-town street at nine o'clock on a
// Tuesday, and the same forty seconds run over and over:
//
//   0:00  the clock tower chimes nine
//   0:02  the newspaper boy arrives at his crate; 0:05 he shouts the headline
//   0:08  a pigeon lands on the bench
//   0:12  a cyclist rides the length of the street (ding)
//   0:18  the waiter comes out of the café; 0:22 he trips and drops the tray
//   0:22  …and the shopkeeper of BUTTONS & SONS steps into his doorway to look
//   0:28  he goes back in; 0:30 the boy leaves
//   0:34  the shutter comes down over the shop; 0:38 chime, white, and again
//
// The button is on a plinth inside the shop, and the shopkeeper throws out
// anyone he sees in there. The way in, learned over loops:
//   1. the headline (heard up close at 0:05, or read in the paper) is the code
//      for the shop's side door, down the alley: 4-1-9;
//   2. while the tray is down, nobody — not even the shopkeeper — is watching
//      the shop. (Or throw something at his window: he comes out to look at it.)
// You keep whatever you hold through a reset — nothing else carries over, bar
// the narrator's patience, the pigeon's grudge, and the count. After enough
// loops the narrator props the side door himself.

const LOOP = 40;
const START = new THREE.Vector3(0, 0, 5);
const CODE = '419';
const SHOP = { minX: -3, maxX: 3, minZ: -14, maxZ: -8 };
const COUNTER_Z = -12.8;
const DOORWAY = new THREE.Vector3(0, 0, -8.6);
const BUTTON = new THREE.Vector3(-1.4, 0, -10.6);
const SIDE_DOOR_Z = -12.5; // the side door's centre (left wall, x = −3)
const KEYPAD = new THREE.Vector3(-3.115, 1.35, -11.4); // on the alley face of the wall (x −3.1)
const BOY = new THREE.Vector3(-8, 0, -4);
const BENCH = new THREE.Vector3(-3.2, 0, 1.6);
const CAFE_DOOR = new THREE.Vector3(6.5, 0, -8.3);
const TRIP_AT = new THREE.Vector3(4.6, 0, -4.4);
const BIKE_Z = -1;
const WINDOWS = [
  [-2.7, -1.0],
  [1.0, 2.7],
];
const OUT_WALK = 1.2; // shopkeeper: counter → doorway
const OUT_STAY = 4.8;
const BACK_WALK = 1.5;
const SHORTCUT_LOOP = 9;

const INTRO = vo('A small town. Nine o\'clock. A Tuesday. The button is in that shop, and the shop is not letting anybody have it. Have a look round. You have time. You have, in fact, the same time, repeatedly.');
const AGAIN = vo([
  'Again.',
  'Again. The same pigeon. The same tray. The same Tuesday.',
  'Tuesday. Still. I have started to think of the pigeon as a colleague.',
  'I know what happens next. The boy shouts. The pigeon lands. The bicycle. The tray. I could do this in my sleep. I think I am.',
]);
const AGAIN_LATE = vo(['Again.', 'Tuesday.', 'You know the drill. So do I. So does the pigeon.', 'Nine o\'clock. Obviously.']);
const KEPT = vo('You kept that. The things you hold come with you. Nothing else does. Except me. Lucky you.');
const HEADLINE_NEAR = vo('The boy is shouting: Extra, extra. Button shop owner forgets his own side door code. Shouts it in the street. Four. One. Nine. Read all about it.');
const HEADLINE_FAR = vo('The newspaper boy is shouting something. From here it sounds important. From here it also sounds like vowels.');
const YOU_AGAIN = vo('The newspaper boy looks at you. He has a feeling he has sold you this paper before.');
const PAPER = vo('Tomorrow\'s paper. Button shop owner forgets own side door code. It is four, one, nine. He is not having a good week. He is not having a good Tuesday, specifically.');
const AHEAD = vo(['And now, the pigeon.', 'Bicycle.', 'The tray.']);
const PIGEON_GRUDGE = vo('The pigeon remembers you. Up on the sign. Out of reach. The pigeon is the only one who remembers. Apart from me.');
const BUMP = vo('The bicycle. It was always going to be the bicycle.');
const CRASH = vo('The waiter has dropped the tray. Everybody is looking at the waiter. Everybody. Including the shopkeeper.');
const WINDOW = vo('You threw something at his window. He has come out to look at it. It is a very good window. He will be a moment.');
const SHOP_FRONT = vo('The shopkeeper looks up. We are closed, he says. The sign says open. The door is open. We are closed.');
const CAUGHT = vo(['He saw you. He walks you out. He does not say anything. He does not need to.', 'Caught again. He is getting quicker at it. So are you, to be fair.']);
const CODE_OK = vo('Click. The side door is open. He has not noticed. He is busy being in the shop.');
const CODE_BAD = vo('Wrong. It beeps at you, in a small-town way.');
const SHORTCUT = vo('Right. I have had enough. I have propped the side door open myself. Do not tell anybody. Especially not him.');
const WIN = vo('You pressed it. And tomorrow is, apparently, Wednesday. I had almost forgotten there was one.');
const FIRST_TRY = vo('First loop. You have done this before, have you not. You have. I can tell. The pigeon can tell.');
const HINTS = vo([
  'Page nine. Stand close to the newspaper boy when he shouts. He shouts useful things. Up close.',
  'Page ten. When the tray goes down, everybody looks. Everybody.',
]);

function dress(g: THREE.Object3D, shirt: number, legs = 0x2a2d36, skin = 0xd9b08c): void {
  const s = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 });
  const l = new THREE.MeshStandardMaterial({ color: legs, roughness: 0.8 });
  const k = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 });
  g.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.material = o.parent?.name?.startsWith('leg') ? l : o.name === 'head' ? k : s;
  });
}
const limb = (g: THREE.Object3D, n: string) => g.getObjectByName(n) as THREE.Object3D;
const lerp = THREE.MathUtils.lerp;
const clamp01 = (x: number) => THREE.MathUtils.clamp(x, 0, 1);

function sign(text: string, w: number, h: number, bg: string, fg: string, font: string): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = Math.round((512 * h) / w);
  const g = cv.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = Math.round(cv.height * 0.6);
  do g.font = `bold ${px}px ${font}`;
  while (g.measureText(text).width > cv.width * 0.9 && --px > 8);
  g.fillText(text, cv.width / 2, cv.height / 2);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.7 }));
}

function chime(n = 3): void {
  ensureAudio();
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      tone({ type: 'sine', from: 523, dur: 1.4, gain: 0.07 });
      tone({ type: 'sine', from: 1046, dur: 0.9, gain: 0.025 });
    }, i * 700);
  }
}

export function revealTimeLoop(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const gen = currentGeneration();
  ctx.openRoom();
  hideRoomShell(ctx);
  ctx.spawnAt(START, 0);
  const sky = new THREE.Color(0xcfe2ee);
  ctx.scene.background = sky.clone();
  ctx.scene.fog = new THREE.Fog(0xcfe2ee, 30, 110);
  root.add(groundPlane({ color: 0x8d8a84 }));
  const returning = isDiscovered('mech:loop-side-door'); // they've been in before

  // ── The street: a road, pavements, buildings along the back ──
  const road = new THREE.Mesh(new THREE.PlaneGeometry(40, 3.2), new THREE.MeshStandardMaterial({ color: 0x4b4b4f, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, BIKE_Z);
  root.add(road);
  const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  // Left block (beyond the alley), the café, and a building past it.
  box(8, 5, 7, 0xb9a48a, -9.5, 2.5, -11.6);
  box(6.4, 4, 6, 0xd8c7a0, 7, 2, -11);
  box(6, 6, 6, 0xa6b0a0, 14, 3, -11);
  box(0.2, 4, 6.4, 0x9c8f7e, -5.6, 2, -11.2); // the alley's far wall
  const cafeSign = sign('CAFÉ', 2.4, 0.6, '#3a2a20', '#f2e3c4', FONT_VOICE);
  cafeSign.position.set(7, 3.3, -7.98);
  root.add(cafeSign);
  box(1.2, 2.2, 0.06, 0x4a3426, CAFE_DOOR.x, 1.1, -7.97);
  box(2.4, 4, 0.2, 0x9c8f7e, -4.4, 2, -14.6); // the alley's dead end
  for (const [x, z] of [
    [3.4, -5.6],
    [8.6, -5.4],
  ]) {
    box(0.9, 0.05, 0.9, 0xe8e2d6, x, 0.75, z);
    box(0.08, 0.75, 0.08, 0x333333, x, 0.375, z);
  }
  // The clock tower, past the café — its second hand is the loop.
  box(2.6, 10, 2.6, 0x9a8e80, 12.5, 5, -16);
  const clockCv = document.createElement('canvas');
  clockCv.width = clockCv.height = 256;
  const clockG = clockCv.getContext('2d')!;
  const clockTex = new THREE.CanvasTexture(clockCv);
  const drawClock = (t: number) => {
    const g = clockG;
    g.fillStyle = '#f4efe2';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#2a2a2a';
    g.lineWidth = 8;
    g.beginPath();
    g.arc(128, 128, 116, 0, Math.PI * 2);
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.fillStyle = '#2a2a2a';
      g.fillRect(128 + Math.sin(a) * 96 - 4, 128 - Math.cos(a) * 96 - 4, 8, 8);
    }
    const hand = (a: number, len: number, w: number, c: string) => {
      g.strokeStyle = c;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);
      g.stroke();
    };
    hand(-Math.PI / 2, 58, 10, '#2a2a2a'); // nine
    hand(0, 90, 7, '#2a2a2a'); // o'clock
    hand((t / 60) * Math.PI * 2, 100, 3, '#b8231f'); // the seconds — never past forty
    clockTex.needsUpdate = true;
  };
  let clockTick = -1;
  drawClock(0);
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), new THREE.MeshBasicMaterial({ map: clockTex }));
  clockFace.position.set(12.5, 8.4, -14.68);
  root.add(clockFace);

  // ── The shop: BUTTONS & SONS ──
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x6f8fa6, roughness: 0.8 });
  const wall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  // Front wall (z = −8): door gap |x| < 0.7, windows 1.0–2.6 on each side.
  wall(0.3, 3.2, 0.2, -2.85, 1.6, -8);
  wall(0.3, 3.2, 0.2, -0.85, 1.6, -8);
  wall(0.3, 3.2, 0.2, 0.85, 1.6, -8);
  wall(0.3, 3.2, 0.2, 2.85, 1.6, -8);
  for (const [a, b] of WINDOWS) {
    wall(b - a, 0.8, 0.2, (a + b) / 2, 0.4, -8); // sill
    wall(b - a, 0.5, 0.2, (a + b) / 2, 2.95, -8); // lintel
  }
  wall(1.4, 0.8, 0.2, 0, 2.8, -8); // over the door
  // Glass (+ a crack when something goes through it).
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, transparent: true, opacity: 0.22, roughness: 0.1, metalness: 0.2 });
  const cracks: THREE.Mesh[] = [];
  for (const [a, b] of WINDOWS) {
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 1.9), glassMat);
    gl.position.set((a + b) / 2, 1.75, -8.02);
    root.add(gl);
    const cr = sign('✶', 1.0, 1.0, 'rgba(0,0,0,0)', 'rgba(250,250,255,0.9)', FONT_SIGN);
    (cr.material as THREE.MeshStandardMaterial).transparent = true;
    cr.position.set((a + b) / 2, 1.75, -7.97);
    cr.visible = false;
    root.add(cr);
    cracks.push(cr);
  }
  wall(0.2, 3.2, 6, 3, 1.6, -11); // right side
  wall(6.2, 3.2, 0.2, 0, 1.6, -14); // back
  // Left side (x = −3) with the side door gap, z −13.0 … −12.0.
  wall(0.2, 3.2, 4.0, -3, 1.6, -10);
  wall(0.2, 3.2, 1.0, -3, 1.6, -13.5);
  wall(0.2, 0.9, 1.0, -3, 2.75, SIDE_DOOR_Z);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.2, 6.4), new THREE.MeshStandardMaterial({ color: 0x3e4a55, roughness: 0.9 }));
  roof.position.set(0, 3.3, -11);
  root.add(roof);
  const shopFloor = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 5.8), new THREE.MeshStandardMaterial({ color: 0x9a7b58, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  shopFloor.rotation.x = -Math.PI / 2;
  shopFloor.position.set(0, 0.02, -11);
  root.add(shopFloor);
  const shopSign = sign('BUTTONS & SONS', 5.4, 0.7, '#1f2a36', '#f0d98a', FONT_VOICE);
  shopSign.position.set(0, 3.7, -7.88);
  root.add(shopSign);
  const hours = sign('OPEN', 0.5, 0.22, '#f4f1e6', '#b8231f', FONT_SIGN);
  hours.position.set(-1.8, 1.9, -7.95);
  root.add(hours);
  const lamp = new THREE.PointLight(0xffe2b0, 6, 9, 1.6);
  lamp.position.set(0, 2.8, -11);
  root.add(lamp);
  // The counter, right of the aisle he walks down to the door (the side door
  // comes in on the left).
  box(1.9, 1.0, 0.7, 0x5a3f2c, 1.45, 0.5, COUNTER_Z + 0.75);
  for (const x of [0.8, 1.45, 2.1]) ctx.addObstacle({ x, z: COUNTER_Z + 0.75, radius: 0.36 });
  const notForSale = sign('NOT FOR SALE', 0.8, 0.22, '#f4f1e6', '#1a1a1a', FONT_SIGN);
  notForSale.position.set(BUTTON.x, 1.45, BUTTON.z + 0.42);
  root.add(notForSale);
  // The side door: a panel that swings in when the code is right.
  const doorPivot = new THREE.Group();
  doorPivot.position.set(-3, 0, SIDE_DOOR_Z - 0.5);
  const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.3, 1.0), new THREE.MeshStandardMaterial({ color: 0x4f3a2a, roughness: 0.8 }));
  doorPanel.position.set(0, 1.15, 0.5);
  doorPivot.add(doorPanel);
  root.add(doorPivot);
  const staff = sign('STAFF', 0.5, 0.18, '#f4f1e6', '#1a1a1a', FONT_SIGN);
  staff.position.set(-3.12, 2.1, SIDE_DOOR_Z);
  staff.rotation.y = -Math.PI / 2;
  root.add(staff);
  // The shutter over the front, rolled up under the sign.
  const shutter = new THREE.Mesh(new THREE.BoxGeometry(6.2, 3.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.5, metalness: 0.6 }));
  root.add(shutter);
  const setShutter = (k: number) => {
    shutter.scale.y = Math.max(0.02, k);
    shutter.position.set(0, 3.2 - 1.55 * k, -7.84);
  };
  setShutter(0);

  // ── The keypad by the side door (alley side): aim at a key, press ──
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'];
  const KP_W = 0.2;
  const KP_H = 0.3;
  const kpCv = document.createElement('canvas');
  kpCv.width = 160;
  kpCv.height = 240;
  const kpG = kpCv.getContext('2d')!;
  const kpTex = new THREE.CanvasTexture(kpCv);
  let entry = '';
  let kpFlash = -1;
  const drawKeypad = () => {
    const g = kpG;
    g.fillStyle = '#9aa0a8';
    g.fillRect(0, 0, 160, 240);
    g.fillStyle = '#0c140c';
    g.fillRect(12, 10, 136, 40);
    g.fillStyle = sideOpen ? '#6dff8e' : '#ffb040';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `bold 26px ${FONT_DISPLAY}`;
    g.fillText(sideOpen ? 'OPEN' : (entry + '___').slice(0, 3).split('').join(' '), 80, 31);
    KEYS.forEach((k, i) => {
      const cx = (i % 3 + 0.5) * (160 / 3);
      const cy = 60 + (Math.floor(i / 3) + 0.5) * 45;
      g.fillStyle = i === kpFlash ? '#ffb040' : k === 'OK' ? '#2f8a52' : k === 'C' ? '#b8231f' : '#2a2c31';
      g.fillRect(cx - 22, cy - 18, 44, 36);
      g.fillStyle = '#e8e8ea';
      g.font = `bold ${k.length > 1 ? 15 : 21}px ${FONT_SIGN}`;
      g.fillText(k, cx, cy + 1);
    });
    kpTex.needsUpdate = true;
  };
  const kpPlate = new THREE.Mesh(new THREE.PlaneGeometry(KP_W, KP_H), new THREE.MeshStandardMaterial({ map: kpTex, roughness: 0.45, metalness: 0.3 }));
  kpPlate.position.copy(KEYPAD);
  kpPlate.rotation.y = -Math.PI / 2; // faces −x, into the alley
  root.add(kpPlate);
  const ray = new THREE.Raycaster();
  const hitLocal = new THREE.Vector3();
  const pickKey = (): number => {
    root.updateMatrixWorld(true);
    ray.setFromCamera(new THREE.Vector2(0, 0), ctx.camera);
    const hit = ray.intersectObject(kpPlate, false)[0];
    if (!hit || hit.distance > 2.2) return -1;
    kpPlate.worldToLocal(hitLocal.copy(hit.point));
    const u = (hitLocal.x / KP_W + 0.5) * 160;
    const v = (0.5 - hitLocal.y / KP_H) * 240;
    if (v < 60) return -1;
    const col = Math.floor(u / (160 / 3));
    const row = Math.floor((v - 60) / 45);
    return col < 0 || col > 2 || row < 0 || row > 3 ? -1 : row * 3 + col;
  };

  // ── State ──
  let t = 0;
  let loopN = 1;
  let solved = false;
  let sideOpen = false;
  let saidCrash = false;
  let windowOuting = -1; // loop time the window outing began (−1: none this loop)
  let windowHit = false;
  let pigeonScared = false;
  let pigeonGrudge = false; // scared it in an earlier loop
  let saidGrudge = false;
  let saidKept = false;
  let saidFrontCaught = false;
  let caughtCount = 0;
  let seenT = 0;
  let bumped = false;
  let saidBump = false;
  let heardNear = false;
  let paper: Carryable | null = null;
  let flashEl: HTMLDivElement | null = null;

  const regions = (): RoomBounds[] => {
    // Wall-to-wall boxes (the player's radius is taken off each side); every
    // seam overlaps 0.6 m so the doorways are passable.
    const r: RoomBounds[] = [
      { minX: -14, maxX: 16, minZ: -7.9, maxZ: 9, floorY: 0 }, // the street
      { minX: -5.5, maxX: -3.1, minZ: -14.5, maxZ: -7.3, floorY: 0 }, // the alley
      { minX: -2.9, maxX: 2.9, minZ: -13.9, maxZ: -8.1, floorY: 0 }, // the shop
      { minX: -0.7, maxX: 0.7, minZ: -8.7, maxZ: -7.3, floorY: 0 }, // the front door
    ];
    if (sideOpen) r.push({ minX: -3.7, maxX: -2.3, minZ: SIDE_DOOR_Z - 0.5, maxZ: SIDE_DOOR_Z + 0.5, floorY: 0 });
    return r;
  };
  const setSide = (open: boolean) => {
    sideOpen = open;
    doorPivot.rotation.y = open ? 1.6 : 0; // swings into the shop
    entry = '';
    drawKeypad();
    ctx.setRegions(regions());
  };
  setSide(false);

  // ── The cast ──
  const keeper = createAsset('dummy') as THREE.Group;
  dress(keeper, 0x2f5d3a, 0x3b2f25);
  const apron = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.6, 0.02), new THREE.MeshStandardMaterial({ color: 0xe9e1cf, roughness: 0.9 }));
  apron.position.set(0, 0.95, 0.15);
  keeper.add(apron);
  root.add(keeper);
  const keeperBlock = { x: 0, z: COUNTER_Z, radius: 0.35 };
  ctx.addObstacle(keeperBlock);

  const boy = createAsset('dummy') as THREE.Group;
  dress(boy, 0xc6452a, 0x4a3a2a);
  boy.scale.setScalar(0.8);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x2b3a6a, roughness: 0.8 }));
  cap.position.y = 1.72;
  boy.add(cap);
  root.add(boy);
  box(0.6, 0.5, 0.45, 0x7a5a38, BOY.x + 0.6, 0.25, BOY.z); // his crate

  const waiter = createAsset('dummy') as THREE.Group;
  dress(waiter, 0xf2f0ea, 0x151515);
  root.add(waiter);
  const tray = new THREE.Group();
  tray.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 16), new THREE.MeshStandardMaterial({ color: 0xb8b8bc, metalness: 0.7, roughness: 0.3 })));
  const glasses: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0xd8f0ff, transparent: true, opacity: 0.6 }));
    tray.add(gl);
    glasses.push(gl);
  }
  root.add(tray);

  const bike = new THREE.Group();
  const rider = createAsset('dummy') as THREE.Group;
  dress(rider, 0xe0b040);
  rider.rotation.y = Math.PI / 2; // faces +x
  rider.position.y = 0.35;
  limb(rider, 'legL').rotation.x = -1.2;
  limb(rider, 'legR').rotation.x = -0.9;
  bike.add(rider);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  for (const x of [-0.55, 0.55]) {
    const w = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.04, 6, 18), tyre);
    w.position.set(x, 0.35, 0);
    bike.add(w);
  }
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a6fd0, roughness: 0.5 }));
  frame.position.y = 0.6;
  bike.add(frame);
  root.add(bike);

  const pigeon = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.8 });
  const pBody = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), grey);
  pBody.scale.set(1, 0.85, 1.35);
  pigeon.add(pBody);
  const pHead = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshStandardMaterial({ color: 0x5b6a78, roughness: 0.7 }));
  pHead.position.set(0, 0.1, 0.12);
  pigeon.add(pHead);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 6), new THREE.MeshStandardMaterial({ color: 0xd9a441 }));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.09, 0.19);
  pigeon.add(beak);
  root.add(pigeon);
  box(1.8, 0.08, 0.5, 0x6b4a2e, BENCH.x, 0.48, BENCH.z); // the bench
  for (const dx of [-0.75, 0.75]) box(0.08, 0.48, 0.45, 0x333333, BENCH.x + dx, 0.24, BENCH.z);

  // The newspaper: one per loop on the boy's crate; kept if you're holding it.
  const spawnPaper = (): Carryable => {
    const g = new THREE.Group();
    const page = sign('BUTTON SHOP CODE: 4-1-9', 0.36, 0.26, '#efe9d8', '#1a1a1a', FONT_VOICE);
    page.rotation.x = -Math.PI / 2;
    g.add(page);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.26), new THREE.MeshStandardMaterial({ color: 0xe6e0cf, roughness: 0.9 }));
    back.position.y = -0.011;
    g.add(back);
    g.position.set(BOY.x + 0.6, 0.52, BOY.z);
    root.add(g);
    const c: Carryable = {
      kind: 'newspaper',
      object: g,
      persistent: true,
      heldDist: 0.5,
      heldDrop: 0.26,
      heldUpdate: (_dt, o, q) => o.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.2)),
      projectile: { radius: 0.12, restitution: 0.2, speed: 10, arc: 1.2 },
      onGrab: () => pop(),
      onTap: () => {
        ctx.narrate(PAPER, 7000, { priority: true });
        discover('mech:loop-headline');
      },
    };
    ctx.addCarryable(c);
    return c;
  };
  const held = (c: Carryable | null) => !!c && (ctx.heldKind('left') === c.kind || ctx.heldKind('right') === c.kind);

  // ── The white flash between loops ──
  const flash = (to: number, ms: number) => {
    if (typeof document === 'undefined') return;
    if (!flashEl) {
      flashEl = document.createElement('div');
      Object.assign(flashEl.style, { position: 'fixed', inset: '0', background: '#fff', opacity: '0', pointerEvents: 'none', zIndex: '30', transition: '' });
      document.body.appendChild(flashEl);
    }
    flashEl.style.transition = `opacity ${ms}ms ease`;
    flashEl.style.opacity = String(to);
    if (to === 0) {
      const el = flashEl;
      flashEl = null;
      setTimeout(() => el.remove?.(), ms + 100); // gone either way, even if the room is left mid-fade
    }
  };

  // ── One loop's start: everything back where it was; you, too ──
  const startLoop = (first: boolean) => {
    t = 0;
    windowOuting = -1;
    windowHit = false;
    pigeonGrudge = pigeonGrudge || pigeonScared;
    pigeonScared = false;
    seenT = 0;
    bumped = false;
    cracks.forEach((c) => (c.visible = false));
    if (paper && !held(paper)) {
      ctx.removeCarryable(paper);
      paper.object.parent?.remove(paper.object);
    }
    paper = null; // (a held one is yours now — it goes with you)
    setSide(loopN >= SHORTCUT_LOOP);
    chime();
    if (first) return;
    const c = ctx.camera.position;
    c.set(START.x, CONFIG.PLAYER_HEIGHT, START.z);
    setYaw(0);
    setPitch(0);
    flash(0, 900);
    if (loopN === SHORTCUT_LOOP) ctx.narrate(SHORTCUT, 6000, { priority: true });
    else ctx.narrate(loopN - 2 < AGAIN.length ? AGAIN[loopN - 2] : AGAIN_LATE[loopN % AGAIN_LATE.length], 5000, { priority: true });
    if (!saidKept && (ctx.heldKind('left') || ctx.heldKind('right'))) {
      saidKept = true;
      ctx.narrate(KEPT, 5000);
    }
  };

  // ── The exit ──
  const btn = spawnPedestalButton(root, BUTTON, () => {
    if (solved) return;
    solved = true;
    if (loopN === 1 && returning) {
      discover('reward:first-try');
      ctx.narrate(FIRST_TRY, 6000, { priority: true });
    } else ctx.narrate(WIN, 6000, { priority: true });
    ctx.after(3500, () => ctx.advance(BUTTON.clone()));
  });
  ctx.addObstacle(btn.obstacle);

  registerInteractable({
    id: 'loop-keypad',
    position: KEYPAD.clone(),
    radius: 1.6,
    promptLabel: 'PRESS',
    canUse: () => !sideOpen && pickKey() >= 0,
    onUse: () => {
      const k = pickKey();
      if (k < 0 || sideOpen) return;
      click();
      kpFlash = k;
      ctx.after(180, () => {
        kpFlash = -1;
        drawKeypad();
      });
      const key = KEYS[k];
      if (key === 'C') entry = '';
      else if (key !== 'OK' && entry.length < 3) entry += key;
      if (key === 'OK' || entry.length === 3) {
        if (entry === CODE) {
          tone({ type: 'square', from: 880, to: 1320, dur: 0.18, gain: 0.05 });
          setSide(true);
          discover('mech:loop-side-door');
          ctx.narrate(CODE_OK, 4500, { priority: true });
          return;
        }
        tone({ type: 'square', from: 220, dur: 0.3, gain: 0.05 });
        entry = '';
        ctx.narrate(CODE_BAD, 3000, { priority: true });
      }
      drawKeypad();
    },
  });

  // ── The shopkeeper's day: at the counter, except when something outside is
  //    more interesting (the tray; a window) ──
  const keeperOut = (tt: number): number => {
    // 0 = at the counter, 1 = in the doorway; the walk in between.
    const outing = (s: number) => {
      if (s < 0 || tt < s) return 0;
      const u = tt - s;
      if (u < OUT_WALK) return u / OUT_WALK;
      if (u < OUT_WALK + OUT_STAY) return 1;
      return 1 - clamp01((u - OUT_WALK - OUT_STAY) / BACK_WALK);
    };
    return Math.max(outing(22), outing(windowOuting));
  };
  const watching = (tt: number) => keeperOut(tt) < 0.95; // in the doorway, his back is to the shop
  const inShop = (p: THREE.Vector3) => p.x > SHOP.minX && p.x < SHOP.maxX && p.z > SHOP.minZ && p.z < SHOP.maxZ - 0.35;

  const prevPos = new Map<THREE.Object3D, THREE.Vector3>();
  const wp = new THREE.Vector3();
  const pl2 = new THREE.Vector3();
  drawKeypad();
  startLoop(true);
  setScriptHints(HINTS);
  ctx.narrate(INTRO, 8000);

  addUpdater((dt) => {
    if (currentGeneration() !== gen) return true;
    if (solved) return false;
    const prevT = t;
    t += dt;
    const at = (s: number) => prevT < s && t >= s; // fires once, as the clock passes s
    const pl = ctx.playerPos();
    if (Math.floor(t * 4) !== clockTick) {
      clockTick = Math.floor(t * 4);
      drawClock(t);
    }

    // The boy: in at 0:02, shouts at 0:05, off at 0:30.
    const boyIn = clamp01((t - 2) / 1.5) * (1 - clamp01((t - 30) / 1.5));
    boy.visible = boyIn > 0;
    boy.position.set(lerp(-15, BOY.x, boyIn), 0, BOY.z);
    boy.rotation.y = boyIn < 1 ? (t < 20 ? Math.PI / 2 : -Math.PI / 2) : Math.atan2(pl.x - BOY.x, pl.z - BOY.z); // walking, or facing you
    const shouting = t > 5 && t < 7;
    limb(boy, 'armR').rotation.x = shouting ? -2.6 + Math.sin(t * 12) * 0.2 : 0;
    const walkB = boyIn > 0 && boyIn < 1;
    limb(boy, 'legL').rotation.x = walkB ? Math.sin(t * 10) * 0.5 : 0;
    limb(boy, 'legR').rotation.x = walkB ? -Math.sin(t * 10) * 0.5 : 0;
    if (at(3.5) && !ctx.isHolding('newspaper')) paper = spawnPaper(); // one a loop; not if you've kept one
    if (at(5)) {
      const near = Math.hypot(pl.x - BOY.x, pl.z - BOY.z) < 4;
      if (near) {
        heardNear = true;
        ctx.narrate(HEADLINE_NEAR, 8000, { priority: loopN > 1 }); // (loop one: after the intro)
        discover('mech:loop-headline');
        if (loopN >= 5) ctx.narrate(YOU_AGAIN, 4500);
      } else if (loopN <= 2 && !heardNear) ctx.narrate(HEADLINE_FAR, 5000);
    }

    // Read-ahead: by loop five the narrator knows the script.
    if (loopN >= 5) {
      if (at(7.4)) ctx.narrate(AHEAD[0], 2000);
      if (at(11.2)) ctx.narrate(AHEAD[1], 2000);
      if (at(21.2)) ctx.narrate(AHEAD[2], 2000);
    }

    // The pigeon: lands at 0:08 — on the bench, or, if you've scared it in an
    // earlier loop, on the shop sign where you can't get at it.
    const perch = pigeonGrudge ? new THREE.Vector3(0.9, 4.1, -7.75) : new THREE.Vector3(BENCH.x + 0.3, 0.62, BENCH.z);
    if (t < 7) pigeon.visible = false;
    else if (!pigeonScared) {
      pigeon.visible = true;
      const k = clamp01((t - 7) / 1.2);
      pigeon.position.set(lerp(perch.x - 6, perch.x, k), lerp(perch.y + 5, perch.y, k * (2 - k)), lerp(perch.z + 3, perch.z, k));
      pigeon.rotation.y = k < 1 ? 1.1 : Math.sin(t * 2.3) * 0.6;
      pHead.position.z = 0.12 + (k >= 1 ? Math.max(0, Math.sin(t * 7)) * 0.03 : 0);
      if (k >= 1 && pigeonGrudge && !saidGrudge) {
        saidGrudge = true;
        ctx.narrate(PIGEON_GRUDGE, 6000);
      }
      if (k >= 1 && !pigeonGrudge && Math.hypot(pl.x - perch.x, pl.z - perch.z) < 1.6) {
        pigeonScared = true;
        noise(0.35, 0.08, 2500, 'bandpass');
      }
    } else {
      pigeon.position.y += dt * 4;
      pigeon.position.x += dt * 3;
      if (pigeon.position.y > 12) pigeon.visible = false;
    }

    // The cyclist: the length of the street, 0:12 → 0:16.5. Ding.
    if (at(11.6)) {
      tone({ type: 'sine', from: 2200, dur: 0.25, gain: 0.05 });
      tone({ type: 'sine', from: 2200, dur: 0.25, gain: 0.04, attack: 0.18 });
    }
    const bk = (t - 12) / 4.5;
    bike.visible = bk > 0 && bk < 1;
    bike.position.set(lerp(-18, 18, clamp01(bk)), 0, BIKE_Z);
    limb(rider, 'legL').rotation.x = -1.2 + Math.sin(t * 14) * 0.4;
    limb(rider, 'legR').rotation.x = -1.2 - Math.sin(t * 14) * 0.4;
    if (bike.visible && !bumped && Math.abs(pl.x - bike.position.x) < 0.9 && Math.abs(pl.z - BIKE_Z) < 0.7) {
      bumped = true;
      const c = ctx.camera.position;
      c.z = BIKE_Z + (pl.z >= BIKE_Z ? 1.3 : -1.3);
      thud();
      if (!saidBump) {
        saidBump = true;
        ctx.narrate(BUMP, 4000, { priority: true });
      }
    }

    // The waiter: out at 0:18, trips at 0:22, and stays down.
    const wk = clamp01((t - 18) / 3);
    waiter.visible = t > 18;
    if (t < 22) {
      waiter.position.set(lerp(CAFE_DOOR.x, TRIP_AT.x, wk), 0, lerp(CAFE_DOOR.z + 0.4, TRIP_AT.z, wk));
      waiter.rotation.set(0, Math.atan2(TRIP_AT.x - CAFE_DOOR.x, TRIP_AT.z - CAFE_DOOR.z), 0);
      const walking = wk > 0 && wk < 1;
      limb(waiter, 'legL').rotation.x = walking ? Math.sin(t * 9) * 0.5 : 0;
      limb(waiter, 'legR').rotation.x = walking ? -Math.sin(t * 9) * 0.5 : 0;
      limb(waiter, 'armL').rotation.x = -1.4;
      limb(waiter, 'armR').rotation.x = -1.4;
      tray.visible = t > 18;
      waiter.updateMatrixWorld();
      tray.position.copy(waiter.localToWorld(wp.set(0, 1.3, 0.55)));
      tray.rotation.set(0, 0, 0);
      glasses.forEach((g, i) => g.position.set((i - 1) * 0.1, 0.07, (i % 2) * 0.06 - 0.03));
    } else {
      const f = clamp01((t - 22) / 0.45);
      waiter.rotation.x = f * 1.45; // flat on his face
      waiter.position.y = f * 0.12;
      const u = t - 22;
      waiter.updateMatrixWorld();
      if (u < 0.7) {
        tray.position.y = Math.max(0.02, 1.3 + 2.4 * u - 9 * u * u);
        tray.rotation.x += dt * 9;
      } else {
        tray.position.y = 0.02;
        tray.rotation.set(0, 0.6, 0);
      }
      glasses.forEach((g, i) => g.position.set((i - 1) * (0.1 + clamp01(u) * 0.5), 0.07, clamp01(u) * 0.4 * (i - 1)));
    }
    if (at(22)) {
      ensureAudio();
      noise(0.5, 0.22, 3200, 'highpass');
      for (let i = 0; i < 4; i++) setTimeout(() => tone({ type: 'triangle', from: 1800 + Math.random() * 1600, dur: 0.12, gain: 0.05 }), 60 + i * 90);
      discover('mech:loop-tray');
      if (!saidCrash && !inShop(pl)) {
        saidCrash = true;
        ctx.narrate(CRASH, 6000, { priority: true });
      }
    }

    // Something thrown through his window: he comes out to look (once a loop).
    if (!windowHit) {
      const seen = new Set<THREE.Object3D>();
      for (const o of [...root.children, ...ctx.scene.children]) {
        if (seen.has(o) || o === pigeon || o === tray || o === bike) continue;
        seen.add(o);
        o.getWorldPosition(wp);
        const prev = prevPos.get(o);
        if (prev) {
          const speed = prev.distanceTo(wp) / Math.max(dt, 1e-3);
          if (speed > 2 && prev.z > -7.9 && wp.z <= -7.9 && wp.y > 0.8 && wp.y < 2.7) {
            const w = WINDOWS.findIndex(([a, b]) => wp.x > a && wp.x < b);
            if (w >= 0 && windowOuting < 0 && keeperOut(t) === 0) {
              windowHit = true;
              windowOuting = t;
              cracks[w].visible = true;
              noise(0.3, 0.2, 4000, 'highpass');
              discover('mech:loop-window');
              ctx.narrate(WINDOW, 5000, { priority: true });
            }
          }
          prev.copy(wp);
        } else prevPos.set(o, wp.clone());
      }
    }

    // The shopkeeper.
    const out = keeperOut(t);
    keeper.position.set(0, 0, lerp(COUNTER_Z, DOORWAY.z, out));
    const walkingK = out > 0 && out < 1;
    const lookOut = Math.atan2(TRIP_AT.x - DOORWAY.x, TRIP_AT.z - DOORWAY.z);
    keeper.rotation.y = out >= 1 ? lookOut : walkingK && keeperOut(t + 0.05) < out ? Math.PI : 0;
    limb(keeper, 'legL').rotation.x = walkingK ? Math.sin(t * 10) * 0.5 : 0;
    limb(keeper, 'legR').rotation.x = walkingK ? -Math.sin(t * 10) * 0.5 : 0;
    keeperBlock.z = keeper.position.z;

    // …and whether he sees you in his shop.
    pl2.set(pl.x, 0, pl.z);
    if (inShop(pl2) && watching(t)) {
      seenT += dt;
      if (seenT > 0.35) {
        seenT = 0;
        const viaFront = pl.z > -9.5 && Math.abs(pl.x) < 1.2;
        const c = ctx.camera.position;
        if (sideOpen && !viaFront) c.set(-4.4, CONFIG.PLAYER_HEIGHT, -10.4);
        else c.set(0, CONFIG.PLAYER_HEIGHT, -6.2);
        if (loopN < SHORTCUT_LOOP) setSide(false);
        thud();
        if (viaFront && !saidFrontCaught) {
          saidFrontCaught = true;
          ctx.narrate(SHOP_FRONT, 6000, { priority: true });
        } else ctx.narrate(CAUGHT[Math.min(caughtCount, CAUGHT.length - 1)], 5000, { priority: true });
        caughtCount++;
      }
    } else seenT = 0;

    // The shutter: 0:34 → 0:36. Anyone in the doorway is shooed out.
    const sh = clamp01((t - 34) / 2);
    setShutter(sh);
    if (sh > 0.6 && pl.z < -7.0 && pl.z > -9.0 && Math.abs(pl.x) < 0.8) ctx.camera.position.z = -6.9;
    if (at(34)) noise(1.8, 0.07, 700, 'lowpass');

    // The end of the loop.
    if (at(38)) chime(2);
    if (at(39.1)) flash(1, 800);
    if (t >= LOOP) {
      loopN++;
      startLoop(false);
    }
    return false;
  });
}

/** Headless-test hooks. */
export const timeLoopTest = { LOOP, CODE, START, BUTTON, KEYPAD, BOY };
