import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import type { Interactable } from '../interactables/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { registerInteractable } from '../interactables/system';
import { spawnPedestalButton } from '../button/pedestal-button';
import { makeMiniButton } from '../objects/original-button';
import { setYaw, setPitch, setEyeHeight } from '../controls/player-camera';
import { tone, noise, ensureAudio, thud, pop, click } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { FONT_VOICE, FONT_SIGN } from '../ui/fonts';
import { hideRoomShell } from './scaffold';

// FAMILY DINNER — the lights go down and the white room is a 1950s dining room:
// wallpaper, heavy curtains, a grandfather clock that ticks slightly wrong. A
// family sits at dinner — Mother, Father, Grandma, the Child — and there's an
// empty chair with a place card that says YOU. They are so pleased you came.
//
// They're wrong in small ways: they only move while you're not looking (look
// back and they're all facing you — or they aren't), they chew in sync, they
// laugh at nothing all at once and stop all at once, Father keeps asking when
// you're going to press the button, Grandma speaks backwards, and the Child's
// head turns, slowly, to follow you, all the way round if it has to.
//
// Sit in your chair and dinner proceeds: soup, the roast, a jelly — each course
// arrives only when you're not watching; eat it (press the plate) three bites,
// while they watch. Dessert is under a silver cloche: your favourite. It's the
// button. Pressing it is the way out.
//   • Get up mid-dinner and walk off: they all stand, and follow — only while
//     you're not looking — until you sit back down.
//   • The place cards: COMPLIMENT (they glow), ASK TO LEAVE (the clock stops;
//     they laugh; no), PASS THE SALT (everyone freezes, someone screams
//     somewhere, and the salt shaker slides down to you — keep it).
//   • Press Mother holding anything you brought: a gift. It goes in the cabinet.
//   • Ask to leave once dessert is out: goodnight, all at once. Lights out. When
//     they come back, the family is you.
//
// Aim + press: one interactable; a ray from the crosshair picks the chair, the
// plate, a card, Mother, the cloche, the clock.

const HX = 4.5; // room half-width (x)
const ZB = -6.5; // back wall
const ZF = 3.5; // front wall
const H = 3.2;
const TABLE_Z = -2;
const TABLE_TOP = 0.76;
const REACH = 3.0;
const YOU_SEAT = { x: 2.15, z: TABLE_Z, face: -Math.PI / 2 }; // faces −x, down the table
const PLATE = new THREE.Vector3(1.4, TABLE_TOP, TABLE_Z);
const SEATED_EYE = 1.15;

const INTRO = vo('The lights go down. Dinner is served. There is a place card with your name on it. It says YOU. That is your name, apparently.');
const WHISPER_SIT = vo('Just sit down. Be polite. They have been waiting a very long time.');
const SIT_FIRST = vo('You sit. Everyone is very pleased. Nobody says why.');
const SOUP = vo('The soup is here. Nobody brought it.');
const SHY = vo('It will not come while you are watching. Look at something else. The curtains. Anything.');
const EAT = vo(['They watch you eat. They do not blink. Keep chewing.', 'Delicious. Say nothing.', 'Chew slowly. They are counting.']);
const CLEAN = vo('Clean plate. They are so proud of you. They are all nodding. At the same time.');
const ROAST = vo('The roast. It is a button. It is always a button.');
const JELLY = vo('Jelly. There is something in the jelly. Do not look at what is in the jelly.');
const DESSERT = vo('Dessert. Under the cloche. They all say it is your favourite. You have never had it before.');
const FOLLOW = vo('They are standing up. All of them. They will sit when you sit.');
const BACK = vo('There. Nobody mention it.');
const COMPLIMENT = vo(['They loved that. Mother is glowing. Actually glowing. Look away.', 'Another compliment. They will expect this every time now.']);
const ASK = vo(['You ask to leave. The clock stops. Everybody laughs. You were joking. You were joking.', 'You ask again. Father says no again. It is a family tradition.']);
const SALT = vo('Everybody freezes. Somewhere in the house, someone screams. Then the salt comes down the table, all by itself. Nobody mentions the scream.');
const SALT_AGAIN = vo('You already have the salt. That is why everyone is looking at you.');
const GIFT_DUCK = vo('A duck. Mother is thrilled. It will be the next course. The duck knows.');
const GIFT_AXE = vo('An axe. There is a very long silence. Then Father nods.');
const GIFT_CARD = vo('The premium card. You should not have. You really should not have. It goes in the cabinet, with the good china. It will never be used.');
const GIFT_SALT = vo('You give them back their own salt. Everyone relaxes. Nobody relaxes.');
const GIFT_ANY = vo('Mother puts it in the cabinet, with the other gifts. She says it is the nicest thing anyone has ever brought. She says that every time.');
const NIGHT = vo('Goodnight, they say. All at once. The lights go out.');
const NIGHT_2 = vo('When the lights come back, the family is you. All of them. It is a lot of you. The button is by the clock.');
const CLOCHE = vo('It is the button. It was always going to be the button. Go on. They are watching.');
const END_EAT = vo('You pressed dessert. Mother is so happy. You must come again. You will come again.');
const NOT_SEATED = vo('Sit down first. At a dinner table, you sit.');
const CLOCK = vo('The clock says it is later than you think. It also says it is earlier.');
const FATHER_NOTE = vo('He asks that at every dinner. Every single dinner.');

// Father's question, with variations. Grandma's lines, run backwards. (Speech
// bubbles, not the narrator — the family never speaks out loud.)
const FATHER_ASKS = [
  'So. When are you going to press the button?',
  'So. Any buttons on the horizon?',
  'Your cousin pressed his. Twice.',
  "We're not getting any younger. Neither is the button.",
  'So. The button. Hm?',
  'Just saying. It would make your mother very happy.',
];
const GRANDMA_SAYS = ['It was all buttons when I was a girl', "Don't let them see you press it", "He's under the table", 'Pass the salt and you will see', 'We were all guests once'];

interface Member {
  name: 'father' | 'mother' | 'grandma' | 'child';
  g: THREE.Group;
  head: THREE.Object3D;
  legs: THREE.Object3D[];
  seat: { x: number; z: number; face: number };
  baseY: number;
  scale: number;
  block: { x: number; z: number; radius: number };
  standing: boolean;
  seen: boolean;
  lookYaw: number; // head yaw, relative to the body
  bubble: THREE.Sprite | null;
  bubbleT: number;
}

function chairScrape(): void {
  ensureAudio();
  noise(0.35, 0.12, 700, 'bandpass');
}
function scream(): void {
  // Far away, somewhere in the house.
  ensureAudio();
  tone({ type: 'sawtooth', from: 980, to: 240, dur: 1.3, gain: 0.035, attack: 0.08 });
  noise(1.1, 0.03, 1500, 'bandpass');
}
function bite(): void {
  ensureAudio();
  noise(0.08, 0.18, 1800, 'bandpass');
  setTimeout(() => noise(0.06, 0.12, 1400, 'bandpass'), 110);
}
function laughSfx(): void {
  ensureAudio();
  for (let i = 0; i < 3; i++) setTimeout(() => tone({ type: 'triangle', from: 260, to: 200, dur: 0.16, gain: 0.07 }), i * 230);
}

export function revealFamilyDinner(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false });
  hideRoomShell(ctx);
  const DARK = new THREE.Color(0x120c08);
  ctx.scene.background = DARK.clone();
  ctx.scene.fog = new THREE.Fog(DARK.getHex(), 10, 30);
  ctx.setRegions([{ minX: -HX + 0.35, maxX: HX - 0.35, minZ: ZB + 0.9, maxZ: ZF - 0.35, floorY: 0 }]);

  // In the room, wherever you stood — but not in the table or on a chair.
  const cam = ctx.camera.position;
  cam.x = THREE.MathUtils.clamp(cam.x, -HX + 0.8, HX - 0.8);
  cam.z = THREE.MathUtils.clamp(cam.z, ZB + 1.3, ZF - 0.8);
  if (cam.z < TABLE_Z + 1.8 && cam.z > TABLE_Z - 1.8 && Math.abs(cam.x) < 3.0) cam.set(0.6, CONFIG.PLAYER_HEIGHT, 0.9);

  // ── The lights go down: the white room's own lights fade to almost nothing. ──
  const roomLights: THREE.Light[] = [];
  ctx.scene.traverse((o) => {
    if ((o as THREE.Light).isLight) roomLights.push(o as THREE.Light);
  });
  const roomStart = roomLights.map((l) => l.intensity);
  let dimT = 0;
  addUpdater((dt) => {
    dimT += dt;
    const k = Math.min(1, dimT / 0.8);
    roomLights.forEach((l, i) => (l.intensity = roomStart[i] * (1 - 0.88 * k)));
    return k >= 1;
  });
  const hemi = new THREE.HemisphereLight(0x6a5040, 0x201010, 0.35);
  const ambient = new THREE.AmbientLight(0x4a3020, 0.45);
  const chandelier = new THREE.PointLight(0xffc987, 2.2, 12, 1.5);
  chandelier.position.set(0, 2.6, TABLE_Z);
  const candleLight = new THREE.PointLight(0xffa040, 0.8, 4, 2);
  const ours: { l: THREE.Light; base: number }[] = [hemi, ambient, chandelier, candleLight].map((l) => ({ l, base: l.intensity }));
  root.add(hemi, ambient, chandelier, candleLight);
  let lightScale = 1; // freezes and the goodnight dip this

  // ── Materials + builders ──
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a2a18, roughness: 0.6 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x2e1a0e, roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.95 });
  const china = new THREE.MeshStandardMaterial({ color: 0xf6f2e8, roughness: 0.35 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.25, metalness: 0.9 });
  const velvet = new THREE.MeshStandardMaterial({ color: 0x6e0f16, roughness: 0.85 });
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture => {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    draw(cv.getContext('2d')!);
    return new THREE.CanvasTexture(cv);
  };
  const fitText = (g: CanvasRenderingContext2D, text: string, maxW: number, px: number, style: string, family: string) => {
    do g.font = `${style} ${px}px ${family}`;
    while (g.measureText(text).width > maxW && --px > 8);
  };

  // ── The room: floor, wallpaper (a pattern of little buttons), dado, ceiling ──
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HX * 2, ZF - ZB),
    new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.004, (ZF + ZB) / 2);
  root.add(floor);
  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 3.2),
    new THREE.MeshStandardMaterial({ color: 0x5a1a1e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.012, TABLE_Z);
  root.add(rug);
  const paperTex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#39402a';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#8a7a3a';
    for (const [x, y] of [[32, 32], [96, 96]]) {
      g.beginPath();
      g.arc(x, y, 11, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#6a1a18';
      g.beginPath();
      g.arc(x, y - 2, 6, Math.PI, 0);
      g.fill();
      g.fillStyle = '#8a7a3a';
    }
  });
  paperTex.wrapS = paperTex.wrapT = THREE.RepeatWrapping;
  const wallMat = (len: number) => {
    const t = paperTex.clone();
    t.needsUpdate = true;
    t.repeat.set(len / 0.7, H / 0.7);
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 });
  };
  box(HX * 2, H, 0.1, wallMat(HX * 2), 0, H / 2, ZB - 0.05);
  box(HX * 2, H, 0.1, wallMat(HX * 2), 0, H / 2, ZF + 0.05);
  box(0.1, H, ZF - ZB, wallMat(ZF - ZB), -HX - 0.05, H / 2, (ZF + ZB) / 2);
  box(0.1, H, ZF - ZB, wallMat(ZF - ZB), HX + 0.05, H / 2, (ZF + ZB) / 2);
  box(HX * 2 + 0.2, 0.1, ZF - ZB + 0.2, new THREE.MeshStandardMaterial({ color: 0x2a221c, roughness: 1 }), 0, H + 0.05, (ZF + ZB) / 2);
  // Dado rail + wainscot, a little proud of each wall.
  box(HX * 2, 0.9, 0.05, darkWood, 0, 0.45, ZB + 0.03);
  box(HX * 2, 0.9, 0.05, darkWood, 0, 0.45, ZF - 0.03);
  box(0.05, 0.9, ZF - ZB, darkWood, -HX + 0.03, 0.45, (ZF + ZB) / 2);
  box(0.05, 0.9, ZF - ZB, darkWood, HX - 0.03, 0.45, (ZF + ZB) / 2);
  // Heavy red curtains along the back wall (there is no window behind them).
  for (let x = -3.6; x <= 3.6; x += 0.22) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.13, H - 0.2, 8), velvet);
    c.position.set(x, (H - 0.2) / 2, ZB + 0.28);
    root.add(c);
  }
  // Chandelier: a brass ring of little bulbs.
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.4, metalness: 0.7 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.03, 8, 24), brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 2.65, TABLE_Z);
  root.add(ring);
  box(0.03, 0.5, 0.03, brass, 0, H - 0.25, TABLE_Z);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
    b.position.set(Math.cos(a) * 0.45, 2.72, TABLE_Z + Math.sin(a) * 0.45);
    root.add(b);
  }

  // ── The table + chairs ──
  box(3.3, 0.05, 1.25, cloth, 0, TABLE_TOP - 0.02, TABLE_Z); // the cloth
  box(3.2, 0.04, 1.15, wood, 0, TABLE_TOP - 0.065, TABLE_Z);
  for (const [lx, lz] of [[-1.5, -0.5], [1.5, -0.5], [-1.5, 0.5], [1.5, 0.5]]) box(0.08, TABLE_TOP - 0.08, 0.08, wood, lx, (TABLE_TOP - 0.08) / 2, TABLE_Z + lz);
  for (const x of [-1.12, -0.37, 0.37, 1.12]) ctx.addObstacle({ x, z: TABLE_Z, radius: 0.62 });
  const chair = (s: { x: number; z: number; face: number }): THREE.Group => {
    const c = new THREE.Group();
    c.position.set(s.x, 0, s.z);
    c.rotation.y = s.face;
    box(0.46, 0.06, 0.46, wood, 0, 0.45, 0, c);
    box(0.46, 0.62, 0.05, wood, 0, 0.79, -0.22, c);
    for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(0.05, 0.45, 0.05, wood, lx, 0.225, lz, c);
    root.add(c);
    return c;
  };
  const SEATS = {
    father: { x: -2.15, z: TABLE_Z, face: Math.PI / 2 },
    mother: { x: -0.7, z: TABLE_Z - 0.9, face: 0 },
    grandma: { x: 0.7, z: TABLE_Z - 0.9, face: 0 },
    child: { x: 0, z: TABLE_Z + 0.9, face: Math.PI },
  };
  for (const s of Object.values(SEATS)) chair(s);
  const yourChair = chair(YOU_SEAT);
  const yourChairSolid = { x: YOU_SEAT.x, z: YOU_SEAT.z, radius: 0.32 };
  ctx.addObstacle(yourChairSolid);
  box(0.4, 0.12, 0.4, velvet, SEATS.child.x, 0.54, SEATS.child.z); // the child's booster cushion

  // Place card: YOU.
  const card = (text: string, x: number, z: number, faceX: boolean): THREE.Group => {
    const tex = canvasTex(256, 96, (g) => {
      g.fillStyle = '#f4ecd6';
      g.fillRect(0, 0, 256, 96);
      g.fillStyle = '#2a1a10';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, text, 230, 44, 'italic', FONT_VOICE);
      g.fillText(text, 128, 50);
    });
    const c = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.08), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
    face.rotation.x = -0.35;
    face.position.y = 0.04;
    c.add(face);
    c.position.set(x, TABLE_TOP + 0.005, z);
    c.rotation.y = faceX ? Math.PI / 2 : 0;
    root.add(c);
    return c;
  };
  card('YOU', 1.62, TABLE_Z, true);
  const complimentCard = card('COMPLIMENT', 1.32, TABLE_Z - 0.44, true);
  const leaveCard = card('ASK TO LEAVE', 1.32, TABLE_Z + 0.44, true);
  const saltCard = card('PASS THE SALT', 0.9, TABLE_Z - 0.3, true);

  // Plates: one each, and yours.
  const plateGeo = new THREE.CylinderGeometry(0.15, 0.12, 0.02, 20);
  const plateAt = (x: number, z: number) => {
    const p = new THREE.Mesh(plateGeo, china);
    p.position.set(x, TABLE_TOP + 0.01, z);
    root.add(p);
    return p;
  };
  const yourPlate = plateAt(PLATE.x, PLATE.z);
  const familyPlates = {
    father: plateAt(-1.4, TABLE_Z),
    mother: plateAt(-0.7, TABLE_Z - 0.35),
    grandma: plateAt(0.7, TABLE_Z - 0.35),
    child: plateAt(0, TABLE_Z + 0.35),
  };

  // The candle in the middle: it burns BACKWARDS — taller all evening.
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 10), new THREE.MeshStandardMaterial({ color: 0xf1e8d0, roughness: 0.7 }));
  candle.position.set(0, TABLE_TOP, TABLE_Z);
  root.add(candle);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc060 }));
  flame.scale.set(1, 1.8, 1);
  root.add(flame);
  let candleH = 0.06;

  // The salt shaker, at Father's end.
  const salt = new THREE.Group();
  const saltBody = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.09, 12), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.3, transparent: true, opacity: 0.85 }));
  saltBody.position.y = 0.045;
  salt.add(saltBody);
  const saltCap = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), silver);
  saltCap.position.y = 0.09;
  salt.add(saltCap);
  salt.position.set(-1.1, TABLE_TOP, TABLE_Z + 0.2);
  root.add(salt);

  // ── The grandfather clock (back-right corner) ──
  const CLOCK_P = new THREE.Vector3(3.7, 0, ZB + 0.45);
  const clockBody = box(0.55, 2.1, 0.35, darkWood, CLOCK_P.x, 1.05, CLOCK_P.z);
  const faceCv = document.createElement('canvas');
  faceCv.width = faceCv.height = 128;
  const fg = faceCv.getContext('2d')!;
  const faceTex = new THREE.CanvasTexture(faceCv);
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.2, 24), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.6 }));
  clockFace.position.set(CLOCK_P.x, 1.75, CLOCK_P.z + 0.18);
  root.add(clockFace);
  const pendulum = new THREE.Group();
  pendulum.position.set(CLOCK_P.x, 1.4, CLOCK_P.z + 0.18);
  const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), brass);
  bob.rotation.x = Math.PI / 2;
  bob.position.y = -0.6;
  pendulum.add(bob, new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.6, 0.01), brass));
  (pendulum.children[1] as THREE.Mesh).position.y = -0.3;
  root.add(pendulum);
  ctx.addObstacle({ x: CLOCK_P.x, z: CLOCK_P.z, radius: 0.4 });
  let clockMin = 47; // minutes past; it ticks (unevenly), sometimes backwards
  const drawClock = () => {
    fg.fillStyle = '#efe6cc';
    fg.fillRect(0, 0, 128, 128);
    fg.strokeStyle = '#2a1a10';
    fg.lineWidth = 4;
    fg.beginPath();
    fg.arc(64, 64, 58, 0, Math.PI * 2);
    fg.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      fg.fillRect(64 + Math.sin(a) * 48 - 2, 64 - Math.cos(a) * 48 - 2, 4, 4);
    }
    const hand = (a: number, len: number, w: number) => {
      fg.lineWidth = w;
      fg.beginPath();
      fg.moveTo(64, 64);
      fg.lineTo(64 + Math.sin(a) * len, 64 - Math.cos(a) * len);
      fg.stroke();
    };
    hand((clockMin / 60) * Math.PI * 2, 44, 3);
    hand(((8 + clockMin / 60) / 12) * Math.PI * 2, 30, 5);
    faceTex.needsUpdate = true;
  };
  drawClock();

  // ── The display cabinet (left wall): the gifts go in here ──
  const CAB = new THREE.Vector3(-HX + 0.35, 0, -0.6);
  box(0.5, 1.9, 1.3, darkWood, CAB.x, 0.95, CAB.z);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), new THREE.MeshStandardMaterial({ color: 0x9fb8c0, roughness: 0.1, transparent: true, opacity: 0.25 }));
  glass.rotation.y = Math.PI / 2;
  glass.position.set(CAB.x + 0.27, 1.1, CAB.z);
  root.add(glass);
  ctx.addObstacle({ x: CAB.x, z: CAB.z - 0.35, radius: 0.4 });
  ctx.addObstacle({ x: CAB.x, z: CAB.z + 0.35, radius: 0.4 });
  let gifts = 0;
  const giftBox = () => {
    const p = new THREE.Group();
    box(0.16, 0.12, 0.16, new THREE.MeshStandardMaterial({ color: [0x7a1a2a, 0x1a4a6a, 0x2a5a2a][gifts % 3], roughness: 0.6 }), 0, 0.06, 0, p);
    box(0.17, 0.02, 0.04, brass, 0, 0.12, 0, p);
    p.position.set(CAB.x + 0.05, 0.62 + Math.floor(gifts / 4) * 0.45, CAB.z - 0.4 + (gifts % 4) * 0.26);
    root.add(p);
    gifts++;
  };

  // ── The family ──
  const bubbleSprite = (text: string): THREE.Sprite => {
    const tex = canvasTex(512, 128, (g) => {
      g.fillStyle = 'rgba(246,238,214,0.94)';
      g.fillRect(8, 8, 496, 112);
      g.fillStyle = '#2a1a10';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitText(g, text, 470, 44, 'italic', FONT_VOICE);
      g.fillText(text, 256, 66);
    });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
    s.scale.set(1.5, 0.375, 1);
    return s;
  };
  const makeMember = (name: Member['name'], scale: number, y: number, shirt: number): Member => {
    const seat = SEATS[name];
    const g = createAsset('dummy') as THREE.Group;
    g.scale.setScalar(scale);
    const top = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8b494, roughness: 0.8 });
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = o.name === 'head' ? skin : top;
    });
    const legs = [g.getObjectByName('legL')!, g.getObjectByName('legR')!];
    for (const l of legs) l.rotation.x = -Math.PI / 2;
    const back = 0.06;
    g.position.set(seat.x - Math.sin(seat.face) * back, y, seat.z - Math.cos(seat.face) * back);
    g.rotation.y = seat.face;
    root.add(g);
    const block = { x: seat.x, z: seat.z, radius: 0.34 };
    ctx.addObstacle(block);
    return { name, g, head: g.getObjectByName('head')!, legs, seat, baseY: y, scale, block, standing: false, seen: false, lookYaw: 0, bubble: null, bubbleT: 0 };
  };
  const family: Member[] = [
    makeMember('father', 0.9, -0.18, 0x3a3f4a),
    makeMember('mother', 0.85, -0.15, 0x7a3a4a),
    makeMember('grandma', 0.8, -0.11, 0x6a6a5a),
    makeMember('child', 0.6, 0.14, 0x3a6a8a),
  ];
  const member = (n: Member['name']) => family.find((m) => m.name === n)!;
  const say = (m: Member, text: string, secs = 3.2) => {
    if (m.bubble) m.bubble.removeFromParent();
    m.bubble = bubbleSprite(text);
    root.add(m.bubble);
    m.bubbleT = secs;
    ensureAudio();
    tone({ type: 'sine', from: 180, to: 150, dur: 0.25, gain: 0.03 }); // a murmur
  };
  const sayAll = (text: string, secs = 2.6) => family.forEach((m) => say(m, text, secs));
  // Laughing at nothing: all at once, and then, all at once, not.
  const startLaugh = () => {
    laughT = 1.3;
    laughSfx();
    sayAll('Ha. Ha. Ha.', 1.2);
  };

  // ── What's visible: they only move while you're not looking ──
  const frustum = new THREE.Frustum();
  const pv = new THREE.Matrix4();
  const bb = new THREE.Box3();
  const visible = (o: THREE.Object3D) => {
    bb.setFromObject(o);
    return frustum.intersectsBox(bb);
  };

  // ── Courses ──
  // 0 soup, 1 the roast, 2 jelly, 3 dessert (the cloche). Each arrives only while
  // your plate is out of sight (the first: after a moment, regardless).
  let course = -1; // index of the course on the table (-1: none yet)
  let served: THREE.Group | null = null;
  const familyServed: THREE.Group[] = [];
  let bites = 0;
  let eaten = 0; // courses finished
  let duckNext = false;
  let jelly: THREE.Mesh | null = null;
  let cloche: THREE.Group | null = null;
  let clocheLift = -1;
  let dessertBtn: THREE.Group | null = null;
  const buildCourse = (i: number, duck: boolean): THREE.Group => {
    const c = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0xd8261c, roughness: 0.35 });
    if (i === 0) {
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.07, 0.06, 18, 1, true), china);
      bowl.position.y = 0.04;
      const soup = new THREE.Mesh(new THREE.CircleGeometry(0.1, 18), new THREE.MeshStandardMaterial({ color: 0xb84a2a, roughness: 0.6 }));
      soup.rotation.x = -Math.PI / 2;
      soup.position.y = 0.06;
      c.add(bowl, soup);
      for (let k = 0; k < 4; k++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), red);
        b.position.set(Math.cos(k * 1.7) * 0.05, 0.062, Math.sin(k * 1.7) * 0.05);
        c.add(b);
      }
    } else if (i === 1) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a3a1c, roughness: 0.5 }));
      dome.position.y = 0.02;
      c.add(dome);
      for (let k = 0; k < 5; k++) {
        const pea = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), new THREE.MeshStandardMaterial({ color: 0x3a8a2a }));
        pea.position.set(Math.cos(k) * 0.11, 0.02, Math.sin(k) * 0.11);
        c.add(pea);
      }
    } else if (i === 2) {
      const j = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.12, 16), new THREE.MeshStandardMaterial({ color: 0x3aa04a, roughness: 0.2, transparent: true, opacity: 0.55 }));
      j.position.y = 0.07;
      const inside = makeMiniButton();
      inside.scale.setScalar(0.7);
      inside.position.y = 0.04;
      c.add(j, inside);
    }
    if (duck) {
      const d = createAsset('duck');
      d.scale.setScalar(0.3);
      d.position.y = 0.05;
      c.add(d);
    }
    return c;
  };
  const serve = (i: number) => {
    course = i;
    bites = 0;
    if (i === 3) {
      // Dessert: a silver cloche. Your favourite.
      cloche = new THREE.Group();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), silver);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), silver);
      knob.position.y = 0.145;
      cloche.add(dome, knob);
      cloche.position.set(PLATE.x, TABLE_TOP + 0.02, PLATE.z);
      root.add(cloche);
      dessertBtn = makeMiniButton();
      dessertBtn.scale.setScalar(1.3);
      dessertBtn.position.set(PLATE.x, TABLE_TOP + 0.02, PLATE.z);
      root.add(dessertBtn);
      targets.push({ obj: cloche, pick: 'cloche' });
      sayAll('Your favourite.');
      ctx.narrate(DESSERT, 6000, { priority: true });
      discover('mech:dinner-cloche');
      return;
    }
    served = buildCourse(i, duckNext);
    duckNext = false;
    served.position.set(PLATE.x, TABLE_TOP + 0.02, PLATE.z);
    root.add(served);
    for (const [n, p] of Object.entries(familyPlates)) {
      const f = buildCourse(i, false);
      f.position.set(p.position.x, TABLE_TOP + 0.02, p.position.z);
      if (n === 'child') f.scale.setScalar(0.8);
      root.add(f);
      familyServed.push(f);
    }
    if (i === 2) jelly = served.children[0] as THREE.Mesh;
    pop();
    ctx.narrate([SOUP, ROAST, JELLY][i], 5000, { priority: true });
  };
  const clearCourse = () => {
    served?.removeFromParent();
    served = null;
    jelly = null;
    for (const f of familyServed) f.removeFromParent();
    familyServed.length = 0;
  };

  // ── State ──
  let sitting = false;
  let everSat = false;
  let following = false; // they stood up and are following you
  let freezeT = 0; // everyone frozen, staring
  let watchT = 0; // they watch you chew
  let laughT = 0; // laughing at nothing
  let nextLaugh = 22;
  let nextFather = 9;
  let fatherIdx = 0;
  let nextGrandma = 15;
  let grandmaIdx = 0;
  let serveWait = 0;
  let shySaid = false;
  let whisperT = 0;
  let whispered = false;
  let stareRoll = false; // looked away: are they all facing you when you look back?
  let familySeen = true;
  let compliments = 0;
  let asks = 0;
  let saltPassed = false;
  let saltSlide = -1;
  let night = -1; // the goodnight sequence clock
  let over = false;
  let clockStopped = 0;
  let tickT = 0;
  let clockT = 0;
  let clockSaidT = 0;
  const seatAt = new THREE.Vector3();

  const sitDown = () => {
    sitting = true;
    ctx.removeObstacle(yourChairSolid);
    seatAt.set(YOU_SEAT.x + 0.08, SEATED_EYE, YOU_SEAT.z);
    ctx.camera.position.copy(seatAt);
    setEyeHeight(SEATED_EYE);
    setYaw(Math.atan2(-Math.sin(YOU_SEAT.face), -Math.cos(YOU_SEAT.face)));
    setPitch(-0.25);
    thud();
    if (!everSat) {
      everSat = true;
      discover('mech:dinner-seat');
      ctx.narrate(SIT_FIRST, 4500, { priority: true });
      ctx.after(2200, () => {
        if (course < 0) serve(0);
      });
    }
    if (following) {
      following = false;
      ctx.narrate(BACK, 3500, { priority: true });
    }
  };
  const standUp = () => {
    sitting = false;
    setEyeHeight(null);
    ctx.addObstacle(yourChairSolid);
    ctx.camera.position.set(YOU_SEAT.x + 0.75, CONFIG.PLAYER_HEIGHT, YOU_SEAT.z + 0.35);
  };
  addUpdater(() => {
    if (!sitting) return false;
    const p = ctx.camera.position;
    if (Math.hypot(p.x - seatAt.x, p.z - seatAt.z) > 0.02) standUp();
    return false;
  });

  // ── Presses ──
  type Pick = 'chair' | 'plate' | 'compliment' | 'leave' | 'salt-card' | 'mother' | 'cloche' | 'dessert' | 'clock';
  const targets: { obj: THREE.Object3D; pick: Pick }[] = [
    { obj: yourChair, pick: 'chair' },
    { obj: yourPlate, pick: 'plate' },
    { obj: complimentCard, pick: 'compliment' },
    { obj: leaveCard, pick: 'leave' },
    { obj: saltCard, pick: 'salt-card' },
    { obj: member('mother').g, pick: 'mother' },
    { obj: clockBody, pick: 'clock' },
    { obj: clockFace, pick: 'clock' },
  ];

  const eat = () => {
    if (!served || course < 0 || course > 2) return;
    bites++;
    bite();
    watchT = 1.4;
    served.scale.setScalar(Math.max(0.2, 1 - bites / 3));
    if (bites === 1) ctx.narrate(EAT[course % EAT.length], 4000, { interruptible: true });
    if (bites < 3) return;
    clearCourse();
    eaten++;
    discover('mech:dinner-course');
    ctx.after(1500, () => {
      if (over) return;
      ctx.narrate(CLEAN, 4500);
      startLaugh(); // …and then the nod turns into a laugh, all at once
    });
    serveWait = 0;
  };
  const askToLeave = () => {
    if (course >= 3 && night < 0 && !over) {
      // Once dessert is out: goodnight.
      night = 0;
      sayAll('Goodnight.', 2.2);
      ctx.narrate(NIGHT, 4500, { priority: true });
      return;
    }
    freezeT = 2.6;
    clockStopped = 2.6;
    ctx.narrate(ASK[Math.min(asks, ASK.length - 1)], 5500, { priority: true });
    asks++;
    ctx.after(2600, () => {
      say(member('father'), asks > 1 ? 'No. Again.' : 'No.', 2);
      ctx.after(1600, startLaugh);
    });
  };
  const passSalt = () => {
    if (saltPassed) {
      freezeT = 1.6;
      ctx.narrate(SALT_AGAIN, 4000, { priority: true });
      return;
    }
    saltPassed = true;
    freezeT = 3.2;
    clockStopped = 3.2;
    lightScale = 0.45;
    ctx.after(900, () => scream());
    ctx.after(3200, () => {
      lightScale = 1;
      saltSlide = 0;
    });
    ctx.narrate(SALT, 8000, { priority: true });
    discover('mech:dinner-salt');
  };
  const saltCarry: Carryable = {
    kind: 'salt-shaker',
    object: salt,
    persistent: true,
    heldDist: 0.45,
    heldDrop: 0.2,
    projectile: { radius: 0.05, restitution: 0.3, gravity: 14, speed: 11 },
  };
  const gift = () => {
    const kind = ctx.heldKind('right') ?? ctx.heldKind('left');
    const mom = member('mother');
    if (!kind) {
      say(mom, ['Hello, dear.', 'More?', 'You look thin.'][gifts % 3]);
      return;
    }
    ctx.consumeHeld(kind);
    giftBox();
    discover('reward:good-guest');
    if (kind === 'duck' || kind === 'cooked-duck') {
      duckNext = true;
      say(mom, 'Oh! For later.');
      ctx.narrate(GIFT_DUCK, 5500, { priority: true });
    } else if (kind === 'axe') {
      freezeT = 3.0;
      ctx.narrate(GIFT_AXE, 5500, { priority: true });
      ctx.after(3200, () => say(member('father'), '...Good.', 2.5));
    } else if (kind === 'premium-card') {
      say(mom, "Oh, you shouldn't have. You really shouldn't have.", 3.8);
      ctx.narrate(GIFT_CARD, 7000, { priority: true });
    } else if (kind === 'salt-shaker') {
      ctx.narrate(GIFT_SALT, 5000, { priority: true });
      saltPassed = false; // it's theirs again; it goes back to Father's end
    } else {
      say(mom, 'For us? For US?');
      ctx.narrate(GIFT_ANY, 7000, { priority: true });
    }
  };
  const press = (p: Pick) => {
    if (over || night >= 0) return;
    if (p === 'chair') {
      if (sitting) standUp();
      else sitDown();
      return;
    }
    if (p === 'mother') return gift();
    if (p === 'clock') {
      if (clockSaidT <= 0) {
        clockSaidT = 8;
        ctx.narrate(CLOCK, 4000, { interruptible: true });
      }
      return;
    }
    if (!sitting) {
      ctx.narrate(NOT_SEATED, 3000, { priority: true });
      return;
    }
    if (p === 'plate') return eat();
    if (p === 'compliment') {
      ctx.narrate(COMPLIMENT[Math.min(compliments, COMPLIMENT.length - 1)], 5000, { priority: true });
      say(member('mother'), compliments ? 'Again!' : "It's the button's recipe.");
      compliments++;
      family.forEach((m) => (m.lookYaw = Math.atan2(PLATE.x - m.g.position.x, PLATE.z - m.g.position.z) - m.g.rotation.y));
      return;
    }
    if (p === 'leave') return askToLeave();
    if (p === 'salt-card') return passSalt();
    if (p === 'cloche' && cloche && clocheLift < 0) {
      clocheLift = 0;
      click();
      ctx.narrate(CLOCHE, 5000, { priority: true });
      return;
    }
    if (p === 'dessert') {
      over = true;
      pop();
      if (eaten >= 3) discover('reward:clean-plate');
      ctx.narrate(END_EAT, 5000, { priority: true });
      sayAll('Come again.', 3);
      ctx.after(2600, () => ctx.advance(new THREE.Vector3(PLATE.x, 0, PLATE.z)));
    }
  };

  // ── Aim + press ──
  const ray = new THREE.Raycaster();
  ray.far = REACH;
  const CENTER = new THREE.Vector2(0, 0);
  let hover: Pick | null = null;
  const it: Interactable = {
    id: 'family-dinner-aim',
    position: new THREE.Vector3(),
    radius: REACH + 0.5,
    promptLabel: '',
    onUse: () => {
      if (hover) press(hover);
    },
  };
  registerInteractable(it);

  // ── The goodnight: lights out, and when they come back, the family is you ──
  const becomeYou = () => {
    for (const m of family) {
      m.g.visible = false;
      m.bubble?.removeFromParent();
      const s = createAsset('statue');
      s.scale.setScalar(m.scale);
      s.position.set(m.seat.x, 0, m.seat.z);
      s.rotation.y = Math.atan2(ctx.camera.position.x - m.seat.x, ctx.camera.position.z - m.seat.z);
      root.add(s);
    }
    const btn = spawnPedestalButton(root, new THREE.Vector3(2.9, 0, ZB + 1.4), () => {
      if (over) return;
      over = true;
      ctx.advance(new THREE.Vector3(2.9, 0, ZB + 1.4));
    });
    ctx.addObstacle(btn.obstacle);
    discover('reward:one-of-the-family');
  };

  ctx.narrate(INTRO, 7000);

  addUpdater((dt) => {
    const c = ctx.camera;
    c.updateMatrixWorld();
    pv.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    const pl = ctx.playerPos();

    // What's under the crosshair.
    hover = null;
    if (!over && night < 0) {
      ray.setFromCamera(CENTER, c);
      const objs = targets.map((t) => t.obj);
      const h = ray.intersectObjects(objs, true)[0];
      if (h) {
        let o: THREE.Object3D | null = h.object;
        while (o && !objs.includes(o)) o = o.parent;
        if (o) hover = targets[objs.indexOf(o)].pick;
        it.position.copy(h.point);
      }
    }
    it.promptLabel = hover ? 'PRESS' : '';

    // Lights: ours flicker a little, and dip for freezes / go out for goodnight.
    const flick = 0.9 + 0.1 * Math.sin(dimT * 17) * Math.sin(dimT * 5.3);
    for (const o of ours) o.l.intensity = o.base * lightScale * (o.l === candleLight ? flick : 1);
    dimT += dt;

    // The candle grows (it burns backwards).
    candleH = Math.min(0.42, candleH + dt * 0.0035);
    candle.scale.y = candleH;
    candle.position.y = TABLE_TOP + candleH / 2;
    flame.position.set(0, TABLE_TOP + candleH + 0.03, TABLE_Z);
    candleLight.position.copy(flame.position);

    // The clock: uneven ticks, sometimes a step back; stops while they freeze.
    clockSaidT -= dt;
    if (clockStopped > 0) clockStopped -= dt;
    else {
      clockT += dt;
      pendulum.rotation.z = Math.sin(clockT * 2.6) * 0.18;
      tickT -= dt;
      if (tickT <= 0) {
        tickT = [1, 1, 1.35, 0.6, 1, 1.9][Math.floor(clockT) % 6];
        ensureAudio();
        tone({ type: 'square', from: 1900, to: 1700, dur: 0.02, gain: 0.02 });
        clockMin = (clockMin + (Math.random() < 0.15 ? -1 : 1) + 60) % 60;
        drawClock();
      }
    }

    if (over && night < 0) return false;

    // Nudge to sit, once.
    if (!everSat) {
      whisperT += dt;
      if (!whispered && whisperT > 11) {
        whispered = true;
        ctx.narrate(WHISPER_SIT, 4500);
      }
    }

    // The next course arrives only while your plate is out of sight.
    if (everSat && sitting && !served && course < 3 && course >= 0 && eaten === course + 1) {
      if (!visible(yourPlate)) {
        serveWait += dt;
        if (serveWait > 1.2) serve(course + 1);
      } else {
        serveWait = 0;
        whisperT += dt;
        if (!shySaid && whisperT > 20) {
          shySaid = true;
          ctx.narrate(SHY, 5000);
        }
      }
    }
    if (jelly) {
      const w = Math.sin(dimT * 9) * 0.08;
      jelly.scale.set(1 + w, 1 - w, 1 + w);
    }
    if (clocheLift >= 0 && cloche) {
      clocheLift += dt;
      const k = Math.min(1, clocheLift / 0.8);
      cloche.position.y = TABLE_TOP + 0.02 + k * 0.5;
      cloche.rotation.z = k * 0.4;
      if (k >= 1) {
        cloche.removeFromParent();
        const i = targets.findIndex((t) => t.pick === 'cloche');
        if (i >= 0) targets.splice(i, 1);
        cloche = null;
        if (dessertBtn) targets.push({ obj: dessertBtn, pick: 'dessert' });
      }
    }

    // The salt comes down the table by itself — and then it's yours.
    if (saltSlide >= 0) {
      saltSlide += dt;
      const k = Math.min(1, saltSlide / 1.4);
      salt.position.set(THREE.MathUtils.lerp(-1.1, 1.15, k * k * (3 - 2 * k)), TABLE_TOP, TABLE_Z + 0.2 - 0.05 * k);
      if (k >= 1) {
        saltSlide = -1;
        ctx.addCarryable(saltCarry);
      }
    }

    // Timed family business: Father's question, Grandma, the laugh.
    if (night < 0 && freezeT <= 0) {
      nextFather -= dt;
      if (nextFather <= 0) {
        nextFather = 15 + Math.random() * 5;
        say(member('father'), FATHER_ASKS[fatherIdx % FATHER_ASKS.length], 3.6);
        fatherIdx++;
        if (fatherIdx === 3) ctx.after(3800, () => ctx.narrate(FATHER_NOTE, 3500));
      }
      nextGrandma -= dt;
      if (nextGrandma <= 0) {
        nextGrandma = 17 + Math.random() * 6;
        say(member('grandma'), GRANDMA_SAYS[grandmaIdx++ % GRANDMA_SAYS.length].split('').reverse().join(''), 3.4);
      }
      nextLaugh -= dt;
      if (nextLaugh <= 0) {
        nextLaugh = 20 + Math.random() * 10;
        startLaugh();
      }
    }
    if (freezeT > 0) freezeT -= dt;
    if (watchT > 0) watchT -= dt;
    if (laughT > 0) laughT -= dt;

    // Leaving the table mid-dinner: they stand up, all at once, and follow.
    const dinnerOn = everSat && !over && night < 0;
    if (dinnerOn && !sitting && !following && Math.hypot(pl.x - YOU_SEAT.x, pl.z - YOU_SEAT.z) > 2.4) {
      following = true;
      chairScrape();
      ctx.narrate(FOLLOW, 5000, { priority: true });
      discover('mech:dinner-follow');
    }

    // The goodnight.
    if (night >= 0) {
      night += dt;
      if (night > 2.4 && night - dt <= 2.4) {
        lightScale = 0;
        roomLights.forEach((l) => (l.intensity = 0));
        thud();
      }
      if (night > 4.4 && night - dt <= 4.4) {
        becomeYou();
        lightScale = 0.8;
        ctx.narrate(NIGHT_2, 6000, { priority: true });
      }
    }

    // ── The family, member by member ──
    const anySeenBefore = familySeen;
    familySeen = family.some((m) => visible(m.g));
    if (anySeenBefore && !familySeen) stareRoll = Math.random() < 0.55; // you looked away
    const t = dimT;
    for (const m of family) {
      m.seen = visible(m.g);
      const gp = m.g.position;
      const toYou = Math.atan2(pl.x - gp.x, pl.z - gp.z) - m.g.rotation.y;

      // Standing + following (only while unseen), or back to their seats.
      if (following && !m.standing) {
        m.standing = true;
        for (const l of m.legs) l.rotation.x = 0;
        m.g.position.y = 0;
      }
      if (m.standing) {
        if (following) {
          if (!m.seen) {
            const dx = pl.x - gp.x;
            const dz = pl.z - gp.z;
            const d = Math.hypot(dx, dz);
            if (d > 1.3) {
              const step = Math.min(d - 1.3, 1.5 * dt);
              gp.x += (dx / d) * step;
              gp.z += (dz / d) * step;
            }
            m.g.rotation.y = Math.atan2(dx, dz);
          }
        } else if (!m.seen) {
          // You sat back down: next time you're not looking, they're seated.
          m.standing = false;
          for (const l of m.legs) l.rotation.x = -Math.PI / 2;
          gp.set(m.seat.x - Math.sin(m.seat.face) * 0.06, m.baseY, m.seat.z - Math.cos(m.seat.face) * 0.06);
          m.g.rotation.y = m.seat.face;
        }
        m.block.x = gp.x;
        m.block.z = gp.z;
      }

      // Heads. The child turns toward you, slowly, always, all the way round.
      // The others: frozen while you watch — except when they openly stare
      // (a freeze, you chewing) — and while you look away, they settle either
      // on their plates or on you.
      const openlyStare = freezeT > 0 || watchT > 0 || night >= 0;
      let want = m.lookYaw;
      if (m.name === 'child') {
        let d = toYou - m.lookYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        want = m.lookYaw + Math.sign(d) * Math.min(Math.abs(d), 0.45 * dt);
      } else if (openlyStare) want = toYou;
      else if (!m.seen) want = stareRoll ? toYou : 0;
      let dy = want - m.lookYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      m.lookYaw += m.name === 'child' || !openlyStare ? dy : dy * Math.min(1, dt * 10);
      m.head.rotation.y = m.lookYaw;
      // Chewing in sync (while food is out and nobody's frozen); the laugh.
      const chew = served && !openlyStare ? Math.sin(t * 7) * 0.09 : 0;
      m.head.rotation.x = laughT > 0 ? -0.45 : chew;

      // Speech bubbles float over their heads.
      if (m.bubble) {
        m.bubbleT -= dt;
        m.bubble.position.set(gp.x, gp.y + 1.95 * m.scale + (m.standing ? 0.2 : 0.35), gp.z);
        if (m.bubbleT <= 0) {
          m.bubble.removeFromParent();
          m.bubble = null;
        }
      }
    }
    return false;
  });
}

/** Headless-test hooks. */
export const familyDinnerTest = { YOU_SEAT, PLATE, TABLE_Z, TABLE_TOP };
