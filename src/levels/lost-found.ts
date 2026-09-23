import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { registerInteractable } from '../interactables/system';
import type { Interactable } from '../interactables/types';
import { spawnPedestalButton } from '../button/pedestal-button';
import { tone, noise, ensureAudio, click, pop, blip } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { isDiscovered, discover } from '../graph/progress';
import { spawnKey } from '../objects/key';
import { spawnDuck } from '../objects/duck';
import { spawnMoney } from '../objects/money';

// LOST & FOUND — the white room becomes a lost-property office: a counter, a
// clerk (the jointed dummy, in a cardigan), and shelves behind him holding
// things from the rest of the game — each with a tag saying what it is, what
// colour, and where it was lost. Things you haven't come across yet are wrapped
// parcels. To get anything back you fill in THE FORM on the lectern: three rows
// (ITEM / COLOUR / LOST IN), press a row to flip through its options, press
// SUBMIT. Describe something on the shelf exactly → the clerk stamps it and
// hands it over. Anything else: "We have no record of that."
//
// Getting ANYTHING back (a real item — a duck, the money, a coloured key — or a
// joke one: a single left shoe, someone's dignity in a jar) and a button rises:
// the way out. The joke items are always there, so a fresh save can finish.

const { width: W, depth: D } = CONFIG.ROOM; // 11 × 13
const COUNTER_Z = -D / 2 + 2.6; // the counter's customer face
const SHELF_Z = -D / 2 + 0.75;
const CLERK = new THREE.Vector3(0, 0, -D / 2 + 1.7);
const LECTERN = new THREE.Vector3(-2.4, 0, COUNTER_Z + 1.3);
const HAND_OVER = new THREE.Vector3(1.0, 1.13, COUNTER_Z - 0.2); // on the counter top, your side

const ITEMS = ['DUCK', 'MONEY', 'KEY', 'SHOE', 'DIGNITY', 'UMBRELLA'] as const;
const COLOURS = ['YELLOW', 'GREEN', 'RED', 'BLUE', 'BLACK', 'CLEAR', 'BEIGE'] as const;
const PLACES = ['THE FOREST', 'THE DUCK ROOM', 'THE DESERT', 'THE CORRIDOR', 'THE CIRCUS', 'THE WAITING ROOM', 'THE LIFT'] as const;

const INTRO = vo('Lost and found. Everything you have ever dropped is here, somewhere, with a tag on it. To get it back, fill in the form. Correctly. This is the hard part.');
const WRONG = vo([
  'We have no record of that. Please check your description and try again.',
  'Nothing matching that description has been handed in. Not today. Not ever.',
  'He checks. He checks again. He does not check a third time.',
]);
const BLUE_DUCK = vo('We have no record of a blue duck lost in a circus. And I would remember.');
const UMBRELLA = vo('Nobody has ever found an umbrella. Umbrellas are not found. They are only lost.');
const GOT_REAL = vo('He finds it. He stamps the form. He stamps the item. Sign here. Next.');
const GOT_SHOE = vo('A single left shoe. Somewhere, someone is hopping. Not our problem.');
const GOT_DIGNITY = vo('Your dignity, in a jar. Slightly used. Do not open it in public.');
const ALREADY = vo('That has already been collected. By you. Just now. Keep up.');
const WAY_OUT = vo('And a button, for leaving. Lost property is closing. It is always closing.');

interface Entry {
  item: (typeof ITEMS)[number];
  colour: (typeof COLOURS)[number];
  place: (typeof PLACES)[number];
  node: string | null; // content-map node that must be discovered for it to be on the shelf (null: always)
  label: string; // the tag
  model: () => THREE.Object3D;
  give: (ctx: GameContext) => void;
  line: string;
}

const ENTRIES: Entry[] = [
  {
    item: 'DUCK', colour: 'YELLOW', place: 'THE FOREST', node: 'item:duck', label: 'Duck · yellow · the forest',
    model: () => createAsset('duck'),
    give: (ctx) => void spawnDuck(ctx, HAND_OVER.x, COUNTER_Z + 1.0),
    line: GOT_REAL,
  },
  {
    item: 'MONEY', colour: 'GREEN', place: 'THE DUCK ROOM', node: 'item:money', label: 'Money · green · the duck room',
    model: () => createAsset('money'),
    give: (ctx) => spawnMoney(ctx, HAND_OVER.clone()),
    line: GOT_REAL,
  },
  {
    item: 'KEY', colour: 'RED', place: 'THE DESERT', node: 'item:key-red', label: 'Key · red · the desert',
    model: () => createAsset('key', { color: 0xd23a2a }),
    give: (ctx) => void spawnKey(ctx, 'red', HAND_OVER.clone()),
    line: GOT_REAL,
  },
  {
    item: 'KEY', colour: 'BLUE', place: 'THE CORRIDOR', node: 'item:key', label: 'Key · blue · the corridor',
    model: () => createAsset('key', { color: 0x2f6fd6 }),
    give: (ctx) => void spawnKey(ctx, 'blue', HAND_OVER.clone()),
    line: GOT_REAL,
  },
  {
    item: 'SHOE', colour: 'BLACK', place: 'THE CIRCUS', node: null, label: 'Shoe (left) · black · the circus',
    model: makeShoe,
    give: (ctx) => giveJoke(ctx, 'left-shoe', makeShoe()),
    line: GOT_SHOE,
  },
  {
    item: 'DIGNITY', colour: 'CLEAR', place: 'THE WAITING ROOM', node: null, label: 'Dignity (jar) · clear · the waiting room',
    model: makeJar,
    give: (ctx) => giveJoke(ctx, 'dignity', makeJar()),
    line: GOT_DIGNITY,
  },
];

// A joke item as a plain carryable (throwable, like anything else).
function giveJoke(ctx: GameContext, kind: string, obj: THREE.Object3D): void {
  obj.position.copy(HAND_OVER);
  ctx.levelRoot.add(obj);
  ctx.addCarryable({
    kind,
    object: obj,
    heldDist: 0.6,
    heldDrop: 0.3,
    projectile: { radius: 0.15, restitution: 0.3, gravity: 14 },
    clickThrows: true,
  });
}

function stampSound(): void {
  ensureAudio();
  noise(0.08, 0.35, 900, 'lowpass');
  tone({ type: 'square', from: 120, to: 60, dur: 0.12, gain: 0.18 });
}
function bell(): void {
  ensureAudio();
  tone({ type: 'sine', from: 2093, dur: 0.9, gain: 0.08 });
  tone({ type: 'sine', from: 4186, dur: 0.4, gain: 0.03 });
}

/** Headless-test hook: press a form cell (0–2 rows, 3 SUBMIT) as if aimed at. */
export const lostFoundTest: { press?: (cell: number) => void } = {};

export function revealLostFound(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; the button sinks

  const mat = (c: number, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    b.receiveShadow = true;
    root.add(b);
    return b;
  };

  // ── The office: lino floor, the counter, shelves along the back wall ──
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, D - 0.2), new THREE.MeshStandardMaterial({ color: 0xb9b19c, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  root.add(floor);
  const wood = mat(0x7a5a3a);
  box(8, 1.05, 0.7, 0, 0.525, COUNTER_Z - 0.35, wood);
  box(8.1, 0.06, 0.8, 0, 1.08, COUNTER_Z - 0.35, mat(0x4a3a2a, 0.6));
  for (let x = -4; x <= 4; x += 0.5) ctx.addObstacle({ x, z: COUNTER_Z - 0.35, radius: 0.4 });
  // A service bell on the counter, for tone.
  const bellMesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8c070, metalness: 0.8, roughness: 0.3 }));
  bellMesh.position.set(2.8, 1.11, COUNTER_Z - 0.2);
  root.add(bellMesh);
  // A sign over it all (on a board, clear of the back wall's face).
  const sign = signTexture('LOST & FOUND', '#f2e6c8', '#3a2a1a');
  const signBoard = box(4.2, 0.8, 0.08, 0, 3.0, SHELF_Z + 0.35, mat(0x3a2a1a));
  signBoard.castShadow = false;
  const signFace = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.7), new THREE.MeshBasicMaterial({ map: sign }));
  signFace.position.set(0, 3.0, SHELF_Z + 0.4);
  root.add(signFace);

  // Shelves: three planks on uprights, against (but clear of) the back wall.
  const shelfMat = mat(0x8a6a4a);
  for (const y of [0.5, 1.2, 1.9]) box(7.6, 0.05, 0.6, 0, y, SHELF_Z, shelfMat);
  for (const x of [-3.8, -1.3, 1.3, 3.8]) box(0.06, 2.0, 0.6, x, 1.0, SHELF_Z, shelfMat);

  // ── What's on the shelves ──
  const shelved = ENTRIES.map((e, i) => {
    const onShelf = !e.node || isDiscovered(e.node);
    const slotX = -3.0 + (i % 4) * 2.0;
    const slotY = i < 4 ? 1.2 : 0.5;
    const g = new THREE.Group();
    g.position.set(slotX, slotY + 0.03, SHELF_Z);
    root.add(g);
    if (onShelf) {
      const m = e.model();
      m.position.y = e.item === 'KEY' ? 0.2 : 0;
      if (e.item === 'KEY') m.rotation.z = Math.PI / 2;
      g.add(m);
    } else {
      g.add(makeParcel());
    }
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: tagTexture(onShelf ? e.label : '?  (not yours yet)') }));
    tag.position.set(slotX, slotY - 0.12, SHELF_Z + 0.32);
    root.add(tag);
    return { e, g, onShelf, claimed: false };
  });

  // ── The clerk, in a cardigan ──
  const clerk = createAsset('dummy') as THREE.Group;
  clerk.position.copy(CLERK);
  root.add(clerk);
  const cardigan = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.32), mat(0x7a8a5a, 1));
  cardigan.position.y = 1.05;
  clerk.add(cardigan);
  const head = clerk.getObjectByName('head') as THREE.Object3D;
  const armR = clerk.getObjectByName('armR') as THREE.Object3D;
  const specs = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 12), mat(0x202020, 0.4));
  specs.position.set(0.07, 0.02, 0.15);
  head.add(specs);
  const specs2 = specs.clone();
  specs2.position.x = -0.07;
  head.add(specs2);

  // ── The form, on a lectern ──
  box(0.1, 1.0, 0.1, LECTERN.x, 0.5, LECTERN.z, mat(0x3a3a3e, 0.5));
  ctx.addObstacle({ x: LECTERN.x, z: LECTERN.z, radius: 0.3 });
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 640;
  const fg = cv.getContext('2d')!;
  const formTex = new THREE.CanvasTexture(cv);
  const form = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshBasicMaterial({ map: formTex }));
  form.position.set(LECTERN.x, 1.25, LECTERN.z);
  form.rotation.x = -0.55; // tilted back, facing the room (+Z) and up
  root.add(form);
  const backing = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.06, 0.03), mat(0x5a4a3a));
  backing.position.set(LECTERN.x, 1.25, LECTERN.z);
  backing.rotation.x = -0.55;
  backing.translateZ(-0.03);
  root.add(backing);

  // The form's state: which option each row shows, and which row is aimed at.
  const pick = [0, 0, 0];
  const lists: readonly (readonly string[])[] = [ITEMS, COLOURS, PLACES];
  const ROW_NAMES = ['ITEM', 'COLOUR', 'LOST IN'];
  let aimed = -1; // 0..2 rows, 3 = SUBMIT
  // Rows occupy uv.y bands (top of the canvas = uv.y 1).
  const CELLS: [number, number][] = [[0.78, 0.62], [0.6, 0.44], [0.42, 0.26], [0.2, 0.05]];
  const drawForm = () => {
    fg.fillStyle = '#f4efe2';
    fg.fillRect(0, 0, 512, 640);
    fg.fillStyle = '#2a2a2a';
    fg.textAlign = 'center';
    fg.textBaseline = 'middle';
    fitText(fg, 'FORM LF-7: CLAIM OF LOST PROPERTY', 'bold', 30, 256, 60, 470);
    fg.strokeStyle = '#2a2a2a';
    fg.lineWidth = 2;
    fg.beginPath();
    fg.moveTo(30, 95);
    fg.lineTo(482, 95);
    fg.stroke();
    CELLS.forEach(([top, bot], i) => {
      const y0 = (1 - top) * 640;
      const y1 = (1 - bot) * 640;
      fg.fillStyle = aimed === i ? (i === 3 ? '#e0584a' : '#ffe9a0') : i === 3 ? '#c8392c' : '#ffffff';
      fg.fillRect(40, y0, 432, y1 - y0);
      fg.strokeRect(40, y0, 432, y1 - y0);
      if (i < 3) {
        fg.fillStyle = '#7a7a7a';
        fitText(fg, ROW_NAMES[i], '', 22, 256, y0 + 22, 400);
        fg.fillStyle = '#1a1a1a';
        fitText(fg, `◂  ${lists[i][pick[i]]}  ▸`, 'bold', 40, 256, y0 + 66, 410);
      } else {
        fg.fillStyle = '#ffffff';
        fitText(fg, 'SUBMIT', 'bold', 48, 256, (y0 + y1) / 2, 400);
      }
    });
    formTex.needsUpdate = true;
  };
  drawForm();

  const aim = new THREE.Raycaster();
  aim.far = 3.2;
  const CROSS = new THREE.Vector2(0, 0);
  const aimedCell = (): number => {
    aim.setFromCamera(CROSS, ctx.camera);
    const hit = aim.intersectObject(form, false)[0];
    if (!hit?.uv) return -1;
    const v = hit.uv.y;
    return CELLS.findIndex(([top, bot]) => v <= top && v >= bot);
  };

  // ── Submitting ──
  let busy = false;
  let wrongs = 0;
  let exitUp = false;
  const submit = () => {
    const [item, colour, place] = [ITEMS[pick[0]], COLOURS[pick[1]], PLACES[pick[2]]];
    const match = shelved.find((s) => s.onShelf && s.e.item === item && s.e.colour === colour && s.e.place === place);
    if (!match) {
      blip();
      if (item === 'DUCK' && colour === 'BLUE' && place === 'THE CIRCUS') ctx.narrate(BLUE_DUCK, 4500, { priority: true });
      else if (item === 'UMBRELLA') ctx.narrate(UMBRELLA, 4500, { priority: true });
      else ctx.narrate(WRONG[wrongs++ % WRONG.length], 4500, { priority: true });
      // He shakes his head.
      let t = 0;
      addUpdater((dt) => {
        t += dt;
        head.rotation.y = Math.sin(t * 14) * 0.35 * Math.max(0, 1 - t / 0.9);
        return t >= 0.9;
      });
      return;
    }
    if (match.claimed) {
      blip();
      ctx.narrate(ALREADY, 3500, { priority: true });
      return;
    }
    // He turns to the shelf, reaches, turns back, stamps, and hands it over.
    busy = true;
    match.claimed = true;
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      if (t < 0.6) {
        clerk.rotation.y = Math.PI * (t / 0.6); // turn round to the shelves
      } else if (t < 1.2) {
        armR.rotation.x = -1.4 * Math.sin(((t - 0.6) / 0.6) * Math.PI);
        if (t > 0.9) match.g.visible = false; // off the shelf
      } else if (t < 1.8) {
        clerk.rotation.y = Math.PI * (1 - (t - 1.2) / 0.6); // and back
      } else {
        clerk.rotation.y = 0;
        stampSound();
        match.e.give(ctx);
        ctx.narrate(match.e.line, 5000, { priority: true });
        discover('mech:lost-found');
        busy = false;
        if (!exitUp) {
          exitUp = true;
          ctx.after(2600, openExit);
        }
        return true;
      }
      return false;
    });
  };

  const formUse: Interactable = {
    id: 'lost-found-form',
    position: new THREE.Vector3(LECTERN.x, 1.0, LECTERN.z),
    radius: 2.4,
    promptLabel: '',
    onUse: () => {
      if (aimed < 0 || busy) return;
      if (aimed < 3) {
        pick[aimed] = (pick[aimed] + 1) % lists[aimed].length;
        click();
        drawForm();
      } else {
        pop();
        submit();
      }
    },
  };
  registerInteractable(formUse);
  lostFoundTest.press = (cell) => {
    aimed = cell;
    formUse.onUse();
  };
  addUpdater(() => {
    const next = busy ? -1 : aimedCell();
    if (next !== aimed) {
      aimed = next;
      drawForm();
    }
    formUse.promptLabel = aimed >= 0 ? 'FILL' : ''; // non-empty = claims the press
    return false;
  });

  // ── The way out, once you've got something back ──
  const openExit = () => {
    // Not on top of you (its collider under you would pin you in place).
    const p = ctx.playerPos();
    const at = new THREE.Vector3(3.4, 0, COUNTER_Z + 2.4);
    if (Math.hypot(p.x - at.x, p.z - at.z) < 1.4) at.x = -3.4;
    const btn = spawnPedestalButton(root, at, () => ctx.advance(at), { glow: false });
    ctx.addObstacle(btn.obstacle);
    bell();
    ctx.narrate(WAY_OUT, 4500);
  };

  ctx.narrate(INTRO, 7500);
}

// ── Canvas helpers (text always shrinks to fit) ──

function fitText(g: CanvasRenderingContext2D, text: string, weight: string, size: number, x: number, y: number, maxW: number): void {
  let px = size;
  do {
    g.font = `${weight} ${px}px Georgia, serif`;
  } while (g.measureText(text).width > maxW && --px > 10);
  g.fillText(text, x, y);
}

function tagTexture(text: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 124;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f7f1dc';
  g.fillRect(0, 0, 512, 124);
  g.strokeStyle = '#8a7a5a';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 506, 118);
  g.fillStyle = '#2a2a2a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitText(g, text, 'italic', 44, 256, 64, 470);
  return new THREE.CanvasTexture(cv);
}

function signTexture(text: string, bg: string, fgc: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 180;
  const g = cv.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 180);
  g.fillStyle = fgc;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitText(g, text, 'bold', 120, 512, 96, 960);
  return new THREE.CanvasTexture(cv);
}

// ── Little models ──

function makeParcel(): THREE.Group {
  const g = new THREE.Group();
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), new THREE.MeshStandardMaterial({ color: 0xa8865a, roughness: 1 }));
  p.position.y = 0.175;
  g.add(p);
  const string = new THREE.MeshStandardMaterial({ color: 0xe8e0c8 });
  const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.36, 0.03), string);
  s1.position.y = 0.175;
  g.add(s1);
  const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.36, 0.42), string);
  s2.position.y = 0.175;
  g.add(s2);
  return g;
}

function makeShoe(): THREE.Group {
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5, metalness: 0.1 });
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.3), new THREE.MeshStandardMaterial({ color: 0x5a3a22 }));
  sole.position.y = 0.02;
  g.add(sole);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.26), leather);
  body.position.set(0, 0.08, 0.01);
  g.add(body);
  const heel = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.09), leather);
  heel.position.set(0, 0.13, -0.09);
  g.add(heel);
  return g;
}

function makeJar(): THREE.Group {
  const g = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.28, 16), new THREE.MeshStandardMaterial({ color: 0xcfe6f0, transparent: true, opacity: 0.35, roughness: 0.1 }));
  glass.position.y = 0.14;
  g.add(glass);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 16), new THREE.MeshStandardMaterial({ color: 0xc9a83a, metalness: 0.7, roughness: 0.3 }));
  lid.position.y = 0.3;
  g.add(lid);
  // …and what's left of it: a tiny, pale, sad little wisp.
  const wisp = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
  wisp.position.y = 0.08;
  g.add(wisp);
  return g;
}
