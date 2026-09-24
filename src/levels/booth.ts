import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { COLOR, glow, matte } from '../assets/palette';
import { registerInteractable } from '../interactables/system';
import type { Interactable } from '../interactables/types';
import { defineCombine } from '../game/combine';
import { spawnPedestalButton } from '../button/pedestal-button';
import { click, blip, pop, thud, quack, sparkle, whoosh } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { buildExitRoom } from './exit-room';
import { CONFIG } from '../config';
import { spawnScript, setScriptHints } from '../objects/script';
import { FONT_DISPLAY, FONT_SIGN, FONT_VOICE } from '../ui/fonts';

// THE BOOTH — you become the narrator. The room turns into a recording booth;
// through the glass is a copy of the white room with a dummy in it (the statue,
// jointed). The narrator has stepped out. His soundboard plays REAL lines from
// the rest of the game, and the dummy takes every one of them literally.
//
//   Get it out of its door (the "right" lines, in the right order):
//     KEY (four steps back → the key)  →  OUT THE BACK (to the door)
//     →  THE KEY TURNS (the door opens, and bows)  →  THE WAY IS OPEN (it leaves)
//   Everything else is a distraction — a fall, a pose, a hop — and "Nothing
//   happened. Or did it." three times breaks it for good (it stares at you).
//
// Endings: out / broken / silent (axe the mic cable, then cue it with the ON AIR
// light alone — it does better without him). Other carried items are only jokes:
// a duck at the mic, money on his chair, a basketball against the glass.
//
// Soundboard lines are the SAME strings as elsewhere in the game, so their baked
// WAVs are reused (same text → same hash) — only his own reactions are new.

// ── Combines are global; the live booth wires these hooks. ──
let hooks: { duck(): void; money(obj: THREE.Object3D): void; glass(): void; cable(): void } | null = null;
defineCombine('duck', 'booth-mic', () => {
  hooks?.duck();
  return true; // it keeps the duck; the duck keeps its dignity
});
defineCombine('money', 'booth-chair', (held, _t, env) => {
  if (!hooks) return;
  env.carry.removeCarryable(held); // a tip — it stays on the chair
  hooks.money(held.object);
});
defineCombine('basketball', 'booth-glass', () => {
  hooks?.glass();
  return true;
});
defineCombine('axe', 'booth-cable', () => {
  hooks?.cable();
  return true;
});

const INTRO = vo('Oh. You. I am stepping out for five minutes. Do not touch the soundboard. You look at a button and you press it. Not that you will need to know that.');
const END_OUT = vo('Who let you in here. Put that down. Do not touch the — oh. You got it out. You would make a decent narrator. That is not a compliment.');
const END_BROKEN = vo('I was gone four minutes. Four. It is staring at the glass and it will not stop. I am unplugging everything. Out.');
const END_SILENT = vo('You cut my cable. And it worked. It performs better without me. Nobody hears about this.');
const DUCK_MIC = vo('No. Absolutely not. It does not get a line. It has not earned a line.');
const MONEY_CHAIR = vo('Is this for me? This is for me. I will allow it. Nothing is different. But I will allow it.');
const GLASS_TAP = vo('Please do not tap on the glass. It frightens him.');
// The second puzzle: his warm-up. A setlist card on the desk says ART, HERO,
// CELEBRATE; play those three, in that order, and his locker springs open —
// his script is inside.
const WARMUP = ['art', 'hero', 'party'] as const;
const LOCKER_OPEN = vo('Take three. That is my warm-up. How do you know my warm-up. Do not open my locker.');
const SCRIPT_TAKEN = vo('That is my script. Put it back. Put it. Back. You are not going to put it back.');
const IDLE_BOARD = vo('The soundboard. Every key plays one of my lines, and he does exactly what it says. Exactly. Pick a key and press it.');
const ORDER_HINT = vo('He takes everything literally. He cannot unlock a door without the key, and he cannot use a door he is not standing at. In that order.');
const SETLIST_HINT = vo('Somebody left a setlist on my desk. Do not read it. It is private. It is also three words long.');
const BOOTH_NOTES = vo([
  'Page one. The booth. He is supposed to walk out of his door: KEY, then OUT THE BACK, then KEY TURNS, then WAY IS OPEN.',
  'Page two. If all else fails, tell him nothing happened. Three times. It breaks him. It breaks everyone.',
  'Page three. Do not let anyone near the mic cable. He does better without me. Nobody is to know that.',
]);

type Cue =
  | 'button' | 'key' | 'door' | 'unlock' | 'leave' | 'fall'
  | 'hero' | 'stare' | 'hop' | 'juggle' | 'art' | 'party';

// [cue, board label, the line it plays, ms before the dummy reacts]
const BOARD: [Cue, string, string, number][] = [
  ['button', 'BUTTON', 'There is a button. You know what to do.', 1400],
  ['key', 'KEY', 'There is a key, incidentally. I have known where it is since before you pressed the button. It is in the first room, about four steps from where you began. I thought the walk would be good for you.', 6500],
  ['door', 'OUT THE BACK', 'Out the back, then. No climb, no wheel, no spectacle — a door for the sensible and the faint of heart. There is no prize for sense. There rarely is.', 1600],
  ['unlock', 'KEY TURNS', 'The key turns. The lock gives. And the last door — a door that takes a bow.', 1400],
  ['leave', 'WAY IS OPEN', 'The plank splinters. The way is open.', 1500],
  ['fall', 'GRAVITY', 'Too high. Gravity finishes what you started.', 1300],
  ['hero', 'HERO', 'Saved. For now you are a hero.', 1100],
  ['stare', 'NOTHING', 'Nothing happened. Or did it.', 1300],
  ['hop', 'IMPRESS ME', 'A hoop, and a ball that drops at your feet. Thirty seconds on the clock — sink as many as you can. Go on, then. Impress me.', 5200],
  ['juggle', 'JUGGLING', 'Oh, we are juggling them now. The ducks are thrilled, I am certain.', 1200],
  ['art', 'ART', 'Behold: art.', 700],
  ['party', 'CELEBRATE', 'A celebration. For you. Specifically.', 1200],
];

// ── Layout (the hub footprint is the booth; the set lies behind its −Z glass) ──
const GLASS_Z = -6.5;
const SET_MIN_Z = -17;
const SET_HALF_X = 5;
const SET_DOOR_Z = -12;
const START = new THREE.Vector3(1.0, 0, -12.5);
const KEY_SPOT = new THREE.Vector3(1.0, 0, -9.0); // four steps behind its start
const DOOR_SPOT = new THREE.Vector3(-4.2, 0, SET_DOOR_Z);
const BUTTON_SPOT = new THREE.Vector3(1.0, 0, -15.5);
const DESK_Z = -5.7;
const WALK_SPEED = 1.4;

type Pose = 'stand' | 'fallen' | 'gone';

export function revealBooth(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const { width: w, depth: d, height: h } = CONFIG.ROOM;
  ctx.scene.background = new THREE.Color(0x0d0e11);
  ctx.scene.fog = null;
  root.add(new THREE.HemisphereLight(0xf4f1ea, 0x2a2622, 0.9));
  root.add(new THREE.AmbientLight(0xffffff, 0.35));

  // ── The booth: acoustic panels, a desk, a chair, a door behind you ──
  const panel = matte(0x2b2622, 1);
  const trim = matte(0x3d352e, 0.9);
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), matte(0x1f1c1a, 1));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  root.add(floor);
  box(w, 0.1, d, 0, h, 0, panel); // ceiling
  box(0.2, h, d, -w / 2, h / 2, 0, panel);
  box(0.2, h, d, w / 2, h / 2, 0, panel);
  // back wall (+Z) with the door you leave by
  const DOOR_W = 1.6;
  const sideW = (w - DOOR_W) / 2;
  box(sideW, h, 0.2, -(DOOR_W + sideW) / 2, h / 2, d / 2, panel);
  box(sideW, h, 0.2, (DOOR_W + sideW) / 2, h / 2, d / 2, panel);
  box(DOOR_W, h - 2.4, 0.2, 0, 2.4 + (h - 2.4) / 2, d / 2, panel);
  const doorHinge = new THREE.Group();
  doorHinge.position.set(-DOOR_W / 2, 0, d / 2);
  // Behind his door, a white exit room (built now, out of sight, so nothing is
  // added mid-level): it's where every ending lets you out.
  const exitRoom = buildExitRoom(ctx, { center: new THREE.Vector3(0, 0, d / 2 + 0.3 + 4.5), facing: 'negZ' });
  root.add(doorHinge);
  const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, 2.4, 0.08), trim);
  doorLeaf.position.set(DOOR_W / 2, 1.2, 0);
  doorHinge.add(doorLeaf);
  // front wall (−Z): the window onto the set
  const SILL = 0.7;
  const TOP = 2.9;
  const WIN_HALF = 3.8;
  box(w, SILL, 0.2, 0, SILL / 2, GLASS_Z, panel);
  box(w, h - TOP, 0.2, 0, TOP + (h - TOP) / 2, GLASS_Z, panel);
  for (const s of [-1, 1]) box(w / 2 - WIN_HALF, TOP - SILL, 0.2, s * (WIN_HALF + (w / 2 - WIN_HALF) / 2), SILL + (TOP - SILL) / 2, GLASS_Z, panel);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(WIN_HALF * 2, TOP - SILL),
    new THREE.MeshStandardMaterial({ color: 0xbfd4e6, transparent: true, opacity: 0.1, roughness: 0.1, depthWrite: false }),
  );
  glass.position.set(0, (SILL + TOP) / 2, GLASS_Z);
  root.add(glass);

  // ON AIR sign over the window
  const onAirMat = new THREE.MeshStandardMaterial({ map: textTexture('ON AIR', '#ff4040', '#2a0808', 256, 64), emissive: 0xff2020, emissiveIntensity: 0.15 });
  const onAir = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), onAirMat);
  onAir.position.set(0, TOP + 0.35, GLASS_Z + 0.12);
  root.add(onAir);
  const setOnAir = (lit: boolean) => (onAirMat.emissiveIntensity = lit ? 1.4 : 0.15);

  // desk + soundboard + mic
  box(4.6, 0.08, 1.0, 0, 0.8, DESK_Z, trim);
  box(4.6, 0.8, 0.1, 0, 0.4, DESK_Z - 0.45, panel);
  const board = new THREE.Group();
  board.position.set(0, 0.97, DESK_Z + 0.05); // lifted so the tilted near edge clears the desk
  board.rotation.x = 0.35; // far edge up: the keys face the player
  root.add(board);
  const boardBase = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 0.62), matte(0x17181b, 0.6));
  board.add(boardBase);
  const labels = new THREE.Mesh(
    new THREE.PlaneGeometry(3.3, 0.56),
    new THREE.MeshBasicMaterial({ map: boardLabelTexture(), transparent: true }),
  );
  labels.rotation.x = -Math.PI / 2;
  labels.position.y = 0.032;
  board.add(labels);
  const keys: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>[] = [];
  BOARD.forEach((_, i) => {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0x8a8f97, roughness: 0.5 }));
    k.position.set(-1.35 + col * 0.54, 0.05, -0.17 + row * 0.3);
    board.add(k);
    keys.push(k);
  });
  // the cue screen: shows the selected line's label
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 512;
  screenCanvas.height = 96;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.17), new THREE.MeshBasicMaterial({ map: screenTex }));
  screen.position.set(-1.95, 0.98, DESK_Z - 0.1); // off to the side, clear of the view
  screen.rotation.set(-0.35, 0.25, 0);
  root.add(screen);
  const drawScreen = (text: string, color = '#ffd23f') => {
    const c = screenCanvas.getContext('2d');
    if (!c) return;
    c.fillStyle = '#0b0c0e';
    c.fillRect(0, 0, 512, 96);
    c.fillStyle = color;
    c.font = `bold 54px ${FONT_DISPLAY}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 256, 50);
    screenTex.needsUpdate = true;
  };
  const mic = new THREE.Group();
  mic.position.set(1.9, 0.84, DESK_Z);
  root.add(mic);
  const micStand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8), matte(COLOR.ironDark, 0.4));
  micStand.position.y = 0.22;
  mic.add(micStand);
  const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), matte(0x55585e, 0.35));
  micHead.position.y = 0.48;
  mic.add(micHead);
  // the mic cable, desk to wall socket — an axe can end it
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.0, 6), matte(0x0a0a0a, 0.7));
  cable.rotation.z = Math.PI / 2;
  cable.position.set(3.6, 0.04, DESK_Z + 0.2);
  root.add(cable);
  box(0.2, 0.28, 0.08, w / 2 - 0.15, 0.3, DESK_Z + 0.2, matte(0xdedad2, 0.6)); // socket
  // his chair, pushed back and empty
  const chair = new THREE.Group();
  chair.position.set(-3.4, 0, DESK_Z + 1.6);
  chair.rotation.y = 0.8;
  root.add(chair);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.55), matte(0x5a1e1e, 0.8));
  seat.position.y = 0.5;
  chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.08), matte(0x5a1e1e, 0.8));
  back.position.set(0, 0.85, 0.24);
  chair.add(back);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8), matte(COLOR.ironDark, 0.4));
  leg.position.y = 0.25;
  chair.add(leg);
  ctx.addObstacle({ x: chair.position.x, z: chair.position.z, radius: 0.4 });

  ctx.setRegions([{ minX: -w / 2 + 0.4, maxX: w / 2 - 0.4, minZ: DESK_Z + 0.75, maxZ: d / 2 - 0.4, floorY: 0 }]);

  // ── The set: a copy of the white room, lit, with its own door + button ──
  const white = new THREE.MeshStandardMaterial({ color: COLOR.white, roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0.25 });
  const setLen = GLASS_Z - SET_MIN_Z;
  const setMidZ = (GLASS_Z + SET_MIN_Z) / 2;
  const setFloor = new THREE.Mesh(new THREE.PlaneGeometry(SET_HALF_X * 2, setLen), white);
  setFloor.rotation.x = -Math.PI / 2;
  setFloor.position.set(0, 0.005, setMidZ);
  root.add(setFloor);
  box(SET_HALF_X * 2, 0.1, setLen, 0, h, setMidZ, white);
  box(SET_HALF_X * 2, h, 0.15, 0, h / 2, SET_MIN_Z, white);
  box(0.15, h, setLen, SET_HALF_X, h / 2, setMidZ, white);
  const SD = 1.3; // set-door width
  const nearLen = GLASS_Z - (SET_DOOR_Z + SD / 2);
  const farLen = SET_DOOR_Z - SD / 2 - SET_MIN_Z;
  box(0.15, h, nearLen, -SET_HALF_X, h / 2, GLASS_Z - nearLen / 2, white);
  box(0.15, h, farLen, -SET_HALF_X, h / 2, SET_MIN_Z + farLen / 2, white);
  box(0.15, h - 2.3, SD, -SET_HALF_X, 2.3 + (h - 2.3) / 2, SET_DOOR_Z, white);
  const beyond = new THREE.Mesh(new THREE.PlaneGeometry(SD, 2.3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  beyond.position.set(-SET_HALF_X - 0.3, 1.15, SET_DOOR_Z);
  beyond.rotation.y = Math.PI / 2;
  root.add(beyond);
  const setDoor = new THREE.Group(); // hinged at its glass-side jamb
  setDoor.position.set(-SET_HALF_X, 0, SET_DOOR_Z + SD / 2);
  root.add(setDoor);
  const setLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.3, SD), matte(0xd9d6cf, 0.8));
  setLeaf.position.set(0, 1.15, -SD / 2);
  setDoor.add(setLeaf);
  const knobMesh = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), glow(COLOR.gold, 0.3));
  knobMesh.position.set(0.08, 1.05, -SD + 0.15);
  setDoor.add(knobMesh);
  spawnPedestalButton(root, BUTTON_SPOT.clone(), () => {}); // the set's own button (the dummy's to press)
  const key = createAsset('key');
  key.position.copy(KEY_SPOT).setY(0.04);
  key.rotation.set(Math.PI / 2, 0, 0.6);
  root.add(key);

  // ── The dummy ──
  const dummy = createAsset('dummy');
  dummy.position.copy(START);
  dummy.rotation.order = 'YXZ'; // yaw first, so a fall tips it over its own back
  dummy.rotation.y = Math.PI; // facing its button, away from you
  root.add(dummy);
  const part = (n: string) => dummy.getObjectByName(n)!;
  const [armL, armR, legL, legR, head] = ['armL', 'armR', 'legL', 'legR', 'head'].map(part);
  let pose: Pose = 'stand';
  let hasKey = false;
  let doorOpen = false;
  let stares = 0;
  let resolved = false;
  let silent = false; // the cable is cut
  let tipped = false; // money on the chair

  // A tiny sequential action runner: each step returns true when done.
  type Step = (dt: number) => boolean;
  const queue: Step[] = [];
  let speaking = false; // a board line is playing; the dummy acts when it lands
  const busy = () => speaking || queue.length > 0;
  addUpdater((dt) => {
    const step = queue[0];
    if (step && step(dt)) queue.shift();
    return false;
  });
  const run = (...steps: Step[]) => {
    queue.push(...steps);
  };
  const wait = (s: number): Step => {
    let t = 0;
    return (dt) => (t += dt) >= s;
  };
  const once = (fn: () => void): Step => () => (fn(), true);
  const restLimbs = () => {
    for (const l of [armL, armR, legL, legR]) l.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);
  };
  // Resolved when the step STARTS (not when queued), so it faces from wherever
  // the previous step left it. `yaw` faces a fixed heading instead.
  const faceTo = (p: THREE.Vector3 | { yaw: number }): Step => {
    let target: number | null = null;
    return (dt) => {
      if (target === null) target = 'yaw' in p ? p.yaw : Math.atan2(p.x - dummy.position.x, p.z - dummy.position.z);
      let dy = target - dummy.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const stepY = Math.sign(dy) * Math.min(Math.abs(dy), dt * 5);
      dummy.rotation.y += stepY;
      return Math.abs(dy) < 0.02;
    };
  };
  const walkTo = (p: THREE.Vector3): Step[] => {
    let phase = 0;
    return [
      faceTo(p),
      (dt) => {
        const dx = p.x - dummy.position.x;
        const dz = p.z - dummy.position.z;
        const dist = Math.hypot(dx, dz);
        phase += dt * 8;
        legL.rotation.x = Math.sin(phase) * 0.5;
        legR.rotation.x = -Math.sin(phase) * 0.5;
        armL.rotation.x = -Math.sin(phase) * 0.4;
        armR.rotation.x = hasKey ? -0.6 : Math.sin(phase) * 0.4;
        if (dist < 0.05) {
          dummy.position.set(p.x, 0, p.z);
          restLimbs();
          if (hasKey) armR.rotation.x = -0.6;
          return true;
        }
        const k = Math.min(1, (WALK_SPEED * dt) / dist);
        dummy.position.x += dx * k;
        dummy.position.z += dz * k;
        return false;
      },
    ];
  };
  const tween = (secs: number, fn: (k: number) => void): Step => {
    let t = 0;
    return (dt) => {
      t = Math.min(secs, t + dt);
      fn(t / secs);
      return t >= secs;
    };
  };
  const takeKey = () => {
    hasKey = true;
    pop();
    armR.add(key);
    key.position.set(0, -0.62, 0.05);
    key.rotation.set(0, 0, 0);
    armR.rotation.x = -0.6;
  };
  const at = (p: THREE.Vector3) => Math.hypot(dummy.position.x - p.x, dummy.position.z - p.z) < 0.3;
  const toGlass = new THREE.Vector3(0, 0, GLASS_Z);
  const wiggle = () => run(tween(1.2, (k) => (dummy.rotation.z = Math.sin(k * Math.PI * 6) * 0.08 * (1 - k))));
  const burst = (at3: THREE.Vector3) => {
    sparkle();
    const bits: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
    const colors = [0xff4d6d, 0xffd23f, 0x3ad17a, 0x4da6ff, 0xc77dff];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.01), new THREE.MeshBasicMaterial({ color: colors[i % colors.length] }));
      m.position.copy(at3);
      root.add(m);
      bits.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2.5, (Math.random() - 0.5) * 3) });
    }
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      for (const b of bits) {
        b.v.y -= 6 * dt;
        b.m.position.addScaledVector(b.v, dt);
        b.m.rotation.x += dt * 6;
        if (b.m.position.y < 0.02) b.m.position.y = 0.02;
      }
      if (t > 3) {
        for (const b of bits) root.remove(b.m);
        return true;
      }
      return false;
    });
  };

  // ── What each cue makes it do ──
  const perform = (cue: Cue) => {
    if (pose === 'fallen' && cue !== 'hero' && cue !== 'stare') {
      wiggle(); // it tries. It is lying down.
      return;
    }
    switch (cue) {
      case 'button':
        run(...walkTo(BUTTON_SPOT.clone().setZ(BUTTON_SPOT.z + 0.8)), faceTo(BUTTON_SPOT),
          tween(0.3, (k) => (armR.rotation.x = -1.4 * k)), once(() => (click(), burst(new THREE.Vector3(BUTTON_SPOT.x, 2.6, BUTTON_SPOT.z)))),
          tween(0.3, (k) => (armR.rotation.x = -1.4 * (1 - k))), wait(0.6));
        break;
      case 'key':
        // Literally: back to where it began, face the way it faced, then four
        // steps BACKWARDS. (Again, if it already has the key. It was told to.)
        run(...walkTo(START), faceTo({ yaw: Math.PI }),
          tween(2.5, (k) => {
            dummy.position.z = START.z + (KEY_SPOT.z - START.z) * k;
            legL.rotation.x = Math.sin(k * Math.PI * 8) * 0.4;
            legR.rotation.x = -Math.sin(k * Math.PI * 8) * 0.4;
          }),
          once(() => (restLimbs(), hasKey ? blip() : takeKey())),
          tween(0.6, (k) => (head.rotation.x = Math.sin(k * Math.PI) * 0.5)));
        break;
      case 'door':
        run(...walkTo(DOOR_SPOT), faceTo(new THREE.Vector3(-SET_HALF_X - 1, 0, SET_DOOR_Z)));
        break;
      case 'unlock':
        if (hasKey && at(DOOR_SPOT) && !doorOpen) {
          doorOpen = true;
          run(tween(0.5, (k) => (armR.rotation.x = -0.6 - 0.8 * k)), once(() => click()),
            tween(1.0, (k) => (setDoor.rotation.y = -1.9 * k)),
            // …and the door takes a bow
            tween(0.8, (k) => (setDoor.rotation.z = Math.sin(k * Math.PI) * 0.25)),
            tween(0.4, (k) => (armR.rotation.x = -1.4 + 0.8 * k)));
        } else {
          // it mimes turning a key it does not have, in a lock that is not there
          run(tween(0.9, (k) => (armR.rotation.x = -1.3 * Math.sin(k * Math.PI), armR.rotation.y = Math.sin(k * Math.PI * 4) * 0.6)),
            once(() => (armR.rotation.y = 0, armR.rotation.x = hasKey ? -0.6 : 0)));
        }
        break;
      case 'leave':
        if (at(DOOR_SPOT) && doorOpen) {
          run(...walkTo(new THREE.Vector3(-SET_HALF_X - 1.2, 0, SET_DOOR_Z)), once(() => {
            dummy.visible = false;
            pose = 'gone';
            end('out');
          }));
        } else if (at(DOOR_SPOT)) {
          run(tween(0.25, (k) => (dummy.position.x = DOOR_SPOT.x - 0.4 * k)), once(() => thud()),
            tween(0.4, (k) => (dummy.position.x = DOOR_SPOT.x - 0.4 * (1 - k)))); // walks into the closed door
        } else {
          run(tween(1.6, (k) => (head.rotation.y = Math.sin(k * Math.PI * 2) * 0.7))); // looks for a plank
        }
        break;
      case 'fall':
        pose = 'fallen';
        run(tween(0.5, (k) => (dummy.rotation.x = -(Math.PI / 2) * k * k)), once(() => thud()));
        break;
      case 'hero':
        if (pose === 'fallen') {
          pose = 'stand';
          run(tween(0.7, (k) => (dummy.rotation.x = -(Math.PI / 2) * (1 - k))));
        }
        run(tween(0.4, (k) => (armL.rotation.x = armR.rotation.x = -2.8 * k)), wait(1.0),
          tween(0.4, (k) => (armL.rotation.x = armR.rotation.x = -2.8 * (1 - k))), once(restLimbs),
          once(() => hasKey && (armR.rotation.x = -0.6)));
        break;
      case 'stare':
        stares++;
        run(faceTo(new THREE.Vector3(0, 0, GLASS_Z + 3)), wait(1.4));
        if (stares >= 3) run(once(() => end('broken')));
        break;
      case 'hop':
        for (let i = 0; i < 3; i++) run(tween(0.35, (k) => (dummy.position.y = Math.sin(k * Math.PI) * 0.18)));
        break;
      case 'juggle':
        run(tween(2.0, (k) => {
          armL.rotation.x = -0.9 - Math.sin(k * Math.PI * 8) * 0.5;
          armR.rotation.x = -0.9 + Math.sin(k * Math.PI * 8) * 0.5;
        }), once(restLimbs));
        break;
      case 'art':
        run(tween(0.3, (k) => (armL.rotation.z = 2.4 * k, armR.rotation.x = -1.0 * k, head.rotation.z = 0.3 * k)), wait(2.0), once(restLimbs));
        break;
      case 'party':
        run(once(() => burst(dummy.position.clone().setY(2.4))),
          tween(1.4, (k) => (armL.rotation.z = -1.2 - Math.sin(k * Math.PI * 6) * 0.5, armR.rotation.z = 1.2 + Math.sin(k * Math.PI * 6) * 0.5)),
          once(restLimbs));
        break;
    }
    if (hasKey && cue !== 'key') run(once(() => { if (pose === 'stand') armR.rotation.x = Math.min(armR.rotation.x, -0.6); }));
  };

  // With the cable cut, the ON AIR light is the only cue — and it just does the
  // next right thing. It was never listening to him anyway.
  const nextRightThing = () => {
    if (pose === 'fallen') return perform('hero');
    if (!hasKey) return perform('key');
    if (!at(DOOR_SPOT)) return perform('door');
    if (!doorOpen) return perform('unlock');
    perform('leave');
  };

  // ── Endings: he comes back ──
  const end = (how: 'out' | 'broken') => {
    if (resolved) return;
    resolved = true;
    const kind = how === 'out' && silent ? 'silent-out' : how;
    ctx.after(1200, () => {
      if (kind === 'out') {
        discover('reward:booth-out');
        ctx.narrate(END_OUT, 8500, { priority: true });
      } else if (kind === 'silent-out') {
        discover('reward:booth-silent');
        ctx.narrate(END_SILENT, 7000, { priority: true });
      } else {
        discover('reward:booth-broken');
        white.emissiveIntensity = 0;
        ctx.narrate(END_BROKEN, 7500, { priority: true });
      }
      if (tipped) ctx.narrate(MONEY_CHAIR, 6500);
      drawScreen('');
      setOnAir(false);
      whoosh();
      let t = 0;
      addUpdater((dt) => {
        t = Math.min(1, t + dt / 1.2);
        doorHinge.rotation.y = -1.7 * t; // his door — now yours
        return t >= 1;
      });
      // Through his door into the exit room (its button moves you on). The
      // doorway overlaps both sides by well over 2 × the player radius.
      ctx.setRegions([
        { minX: -w / 2 + 0.4, maxX: w / 2 - 0.4, minZ: DESK_Z + 0.75, maxZ: d / 2 - 0.4, floorY: 0 },
        { minX: -DOOR_W / 2 + 0.2, maxX: DOOR_W / 2 - 0.2, minZ: d / 2 - 1.6, maxZ: d / 2 + 1.6, floorY: 0 },
        exitRoom,
      ]);
    });
  };

  // ── Operating the board ──
  // A ray from the crosshair picks the key: it hits the board or a key, and the
  // nearest key cell under the hit point is the one you are aiming at. The
  // board's interactable only claims E / click while a key is aimed at, and the
  // lit key is its only prompt.
  const aim = new THREE.Raycaster();
  aim.far = 3;
  const CROSSHAIR = new THREE.Vector2(0, 0);
  const aimLocal = new THREE.Vector3();
  let sel = -1;
  const showSel = () => {
    keys.forEach((k, i) => {
      k.material.emissive.setHex(i === sel && !silent ? 0x806010 : 0x000000);
      k.position.y = i === sel && !silent ? 0.03 : 0.05;
    });
    if (silent) drawScreen('NO SIGNAL', '#ff4040');
    else if (!resolved && sel >= 0) drawScreen(BOARD[sel][1]);
  };
  drawScreen('ON STANDBY');
  const aimedKey = (): number => {
    aim.setFromCamera(CROSSHAIR, ctx.camera);
    const hit = aim.intersectObjects([boardBase, ...keys], false)[0];
    if (!hit) return -1;
    board.worldToLocal(aimLocal.copy(hit.point));
    return keys.findIndex((k) => Math.abs(aimLocal.x - k.position.x) < 0.27 && Math.abs(aimLocal.z - k.position.z) < 0.15);
  };
  const boardUse: Interactable = {
    id: 'booth-board',
    position: new THREE.Vector3(0, 0.9, DESK_Z),
    radius: 2.2,
    promptLabel: '',
    onUse() {
      if (sel < 0) return;
      if (resolved || busy()) return blip();
      click();
      if (silent) {
        setOnAir(true);
        ctx.after(500, () => setOnAir(false));
        nextRightThing();
        return;
      }
      const [cue, , line, delay] = BOARD[sel];
      discover('mech:soundboard');
      played.push(cue);
      if (played.length > WARMUP.length) played.shift();
      if (!lockerOpen && WARMUP.every((c, i) => played[i] === c)) ctx.after(delay, openLocker);
      boardPlays++;
      if (boardPlays === 7 && !lockerOpen) ctx.narrate(SETLIST_HINT, 5000);
      if (boardPlays === 12 && !resolved) ctx.narrate(ORDER_HINT, 6000);
      setOnAir(true);
      speaking = true; // locked until the dummy has done its thing
      ctx.narrate(line, delay + 2600, { priority: true });
      ctx.after(delay, () => {
        setOnAir(false);
        speaking = false;
        if (!resolved && pose !== 'gone') perform(cue);
      });
    },
  };
  registerInteractable(boardUse);
  // Never touched the board: say what it is for, once.
  let idleT = 0;
  addUpdater((dt) => {
    if (resolved || boardPlays > 0 || silent) return true;
    idleT += dt;
    if (idleT < 25) return false;
    ctx.narrate(IDLE_BOARD, 5500);
    return true;
  });

  // ── The second puzzle: the warm-up, the setlist, his locker, his script ──
  const played: Cue[] = [];
  let boardPlays = 0;
  let lockerOpen = false;
  setScriptHints(BOOTH_NOTES);
  // The setlist: a little tent card propped on the desk, left of the board.
  const setCv = document.createElement('canvas');
  setCv.width = 256;
  setCv.height = 200;
  const sc = setCv.getContext('2d')!;
  sc.fillStyle = '#fff27a';
  sc.fillRect(0, 0, 256, 200);
  sc.fillStyle = '#2a2622';
  sc.textAlign = 'center';
  sc.textBaseline = 'middle';
  const fitLine = (t: string, style: string, size: number, y: number) => {
    let px = size;
    do sc.font = `${style} ${px}px ${FONT_VOICE}`;
    while (sc.measureText(t).width > 230 && --px > 8);
    sc.fillText(t, 128, y);
  };
  fitLine('WARM-UP (take 3)', 'bold', 26, 30);
  fitLine('1. ART', '', 30, 80);
  fitLine('2. HERO', '', 30, 118);
  fitLine('3. CELEBRATE', '', 30, 156);
  fitLine('— never skip it —', 'italic', 18, 188);
  const card = new THREE.Group();
  card.position.set(-2.15, 0.84, DESK_Z + 0.38); // left of the board, clear of it
  card.rotation.y = 0.5;
  root.add(card);
  const cardBack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.25, 0.012), matte(0xc9b84a, 0.8));
  cardBack.position.set(0, 0.125, 0);
  cardBack.rotation.x = -0.35;
  card.add(cardBack);
  const cardFace = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.234), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(setCv) }));
  cardFace.position.set(0, 0.125 + 0.004, 0.009); // in front of its backing, tilted with it
  cardFace.rotation.x = -0.35;
  card.add(cardFace);
  // His locker, against the right wall behind you.
  const LOCKER = new THREE.Vector3(w / 2 - 0.45, 0, 1.6);
  const lockerMat = matte(0x5a6470, 0.5);
  // A hollow body (back 0.1 off the wall face), with a shelf for the script.
  box(0.04, 1.9, 0.6, LOCKER.x + 0.23, 0.95, LOCKER.z, lockerMat); // back
  for (const s of [-1, 1]) box(0.5, 1.9, 0.03, LOCKER.x, 0.95, LOCKER.z + s * 0.285, lockerMat); // sides
  box(0.5, 0.03, 0.6, LOCKER.x, 1.885, LOCKER.z, lockerMat); // top
  box(0.5, 0.03, 0.6, LOCKER.x, 0.015, LOCKER.z, lockerMat); // bottom
  box(0.46, 0.02, 0.54, LOCKER.x, 1.1, LOCKER.z, lockerMat); // shelf
  const lockerHinge = new THREE.Group();
  lockerHinge.position.set(LOCKER.x - 0.26, 0, LOCKER.z + 0.3); // front-left edge, facing −X into the booth
  root.add(lockerHinge);
  const lockerDoor = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.86, 0.58), matte(0x6e7884, 0.45));
  lockerDoor.position.set(0, 0.95, -0.29);
  lockerHinge.add(lockerDoor);
  const nameCv = document.createElement('canvas');
  nameCv.width = 256;
  nameCv.height = 64;
  const nc = nameCv.getContext('2d')!;
  nc.fillStyle = '#f2f2ee';
  nc.fillRect(0, 0, 256, 64);
  nc.fillStyle = '#1a1a1a';
  nc.textAlign = 'center';
  nc.textBaseline = 'middle';
  let npx = 30;
  do nc.font = `bold ${npx}px ${FONT_SIGN}`;
  while (nc.measureText('NARRATOR — PRIVATE').width > 236 && --npx > 8);
  nc.fillText('NARRATOR — PRIVATE', 128, 34);
  const nameTag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(nameCv) }));
  nameTag.rotation.y = -Math.PI / 2; // faces −X
  nameTag.position.set(-0.02, 1.6, -0.29);
  lockerHinge.add(nameTag);
  ctx.addObstacle({ x: LOCKER.x, z: LOCKER.z, radius: 0.4 });
  const openLocker = () => {
    if (lockerOpen) return;
    lockerOpen = true;
    pop();
    thud();
    let t = 0;
    addUpdater((dt) => {
      t = Math.min(1, t + dt / 0.6);
      lockerHinge.rotation.y = 1.9 * (1 - Math.pow(1 - t, 3)); // swings out, toward the booth (−X)
      return t >= 1;
    });
    ctx.narrate(LOCKER_OPEN, 5500); // queued: after his warm-up line finishes
    // His script, on the locker's shelf. Take it; it leaves with you.
    let taken = false;
    spawnScript(ctx, new THREE.Vector3(LOCKER.x - 0.02, 1.13, LOCKER.z), {
      onGrab: () => {
        if (taken) return;
        taken = true;
        ctx.narrate(SCRIPT_TAKEN, 5000, { priority: true });
      },
    });
  };

  addUpdater(() => {
    const next = aimedKey();
    if (next !== sel) {
      sel = next;
      showSel();
    }
    boardUse.promptLabel = sel >= 0 ? 'PLAY' : ''; // non-empty = claims the press
    if (sel >= 0) keys[sel].getWorldPosition(boardUse.position);
    return false;
  });

  // ── The things you carried in (mostly: jokes) ──
  ctx.addTarget({ kind: 'booth-mic', position: mic.position.clone(), radius: 1.6 });
  ctx.addTarget({ kind: 'booth-chair', position: chair.position.clone(), radius: 1.4 });
  ctx.addTarget({ kind: 'booth-glass', position: new THREE.Vector3(0, 1.5, GLASS_Z), radius: 2.6 });
  ctx.addTarget({ kind: 'booth-cable', position: new THREE.Vector3(3.6, 0, DESK_Z + 0.2), radius: 1.6 });
  hooks = {
    duck() {
      quack();
      if (!busy() && pose === 'stand' && !resolved) run(faceTo(new THREE.Vector3(0, 0, GLASS_Z + 3)), wait(1.2));
      ctx.narrate(DUCK_MIC, 5000, { priority: true });
    },
    money(obj) {
      tipped = true;
      pop();
      root.add(obj);
      obj.position.set(chair.position.x, 0.56, chair.position.z);
      obj.rotation.set(0, 0.4, 0);
    },
    glass() {
      thud();
      if (!busy() && pose === 'stand' && !resolved) run(tween(0.3, (k) => (dummy.position.y = Math.sin(k * Math.PI) * 0.12, head.rotation.x = -Math.sin(k * Math.PI) * 0.4)));
      ctx.narrate(GLASS_TAP, 4000, { priority: true });
    },
    cable() {
      if (silent || resolved) return;
      silent = true;
      pop();
      cable.scale.set(1, 0.45, 1); // cut short
      cable.position.x += 0.8;
      showSel();
      setOnAir(false);
    },
  };

  ctx.narrate(INTRO, 8000);
}

/** A flat label texture (the ON AIR sign). */
function textTexture(text: string, fg: string, bg: string, w: number, h: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  if (c) {
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);
    c.fillStyle = fg;
    c.font = `bold ${Math.round(h * 0.62)}px ${FONT_SIGN}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, w / 2, h / 2 + 2);
  }
  return new THREE.CanvasTexture(canvas);
}

/** The strip of little labels printed under the board's twelve keys. */
function boardLabelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 176;
  const c = canvas.getContext('2d');
  if (c) {
    c.fillStyle = '#e8e2d0';
    c.font = `bold 22px ${FONT_DISPLAY}`;
    c.textAlign = 'center';
    BOARD.forEach(([, label], i) => {
      const x = ((i % 6) + 0.5) * (1024 / 6);
      const y = Math.floor(i / 6) ? 160 : 70;
      c.fillText(label, x, y);
    });
  }
  return new THREE.CanvasTexture(canvas);
}
