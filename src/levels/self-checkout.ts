import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Obstacle } from '../controls/player-camera';
import type { GameContext } from '../game/types';
import type { Interactable } from '../interactables/types';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { registerInteractable } from '../interactables/system';
import { spawnPedestalButton } from '../button/pedestal-button';
import { tone, noise, ensureAudio, click, blip, sparkle, fanfare } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { defineCombine } from '../game/combine';
import { setScriptHints } from '../objects/script';
import { FONT_SIGN } from '../ui/fonts';

// THE SELF-CHECKOUT — a small arithmetic puzzle. The white room stays shut and
// becomes a corner shop's self-checkout: a kiosk (screen, scanner, VOID and PAY
// keys), a shelf of nine priced things, THE BUTTON on its own stand, and a
// poster: LUCKY TENNER — total exactly £10.00 and it's on us. That's the only
// way through.
//
// Press a thing on the shelf (or the button) and it's scanned onto the
// receipt; VOID takes the last one off; PAY checks the total. The prices are
// chosen so exactly ONE set of shelf items makes £10.00 with the button:
//   rubber duck 1.45 + bread 1.28 + milk 0.91 + air (diet) 2.37 = 6.01,
//   + THE BUTTON 3.99 = 10.00
// (and plenty of totals within ten pence, to be nearly right with). Wrong
// totals get a verdict ("nine ninety-eight. So close.") and the narrator's
// hints escalate until they give it away — so it can't soft-lock.

const KIOSK = new THREE.Vector3(0, 0, -4.2);
const SHELF_X = -3.6; // the shelf runs along z, facing +x (into the room)
const STAND = new THREE.Vector3(2.4, 0, -3.8); // THE BUTTON, on its own stand
const EXIT = new THREE.Vector3(0, 0, 1.5);
const TARGET = 1000; // pence

interface Item { name: string; pence: number; color: number }
const ITEMS: Item[] = [
  { name: 'BEANS', pence: 89, color: 0x3a7ad8 },
  { name: 'RUBBER DUCK', pence: 145, color: 0xffcc22 },
  { name: 'BREAD', pence: 128, color: 0xc8914f },
  { name: 'MILK', pence: 91, color: 0xf2f2ee },
  { name: 'REGRET BAR', pence: 105, color: 0x6a3a8a },
  { name: 'ONE SOCK', pence: 51, color: 0xd04a4a },
  { name: 'AIR (DIET)', pence: 237, color: 0x9fd8f0 },
  { name: 'CANDLE', pence: 217, color: 0xf0e0b8 },
  { name: 'BATTERIES', pence: 310, color: 0x2a2a2e },
];
const BUTTON: Item = { name: 'THE BUTTON', pence: 399, color: 0xe0271c };
const money = (p: number) => `£${(p / 100).toFixed(2)}`;

// The machine (read by the narrator's voice, in its own words).
const M_WELCOME = vo('Welcome. Please scan your first item.');
const M_EXACT = vo('Lucky tenner! Exactly ten pounds. It is on us. Please take your receipt.');
const M_NO_BUTTON = vo('You have not scanned THE BUTTON. You cannot leave without the button.');
const M_UNDER = vo('Your total is less than ten pounds. The Lucky Tenner is exactly ten.');
const M_OVER = vo('Your total is more than ten pounds. The Lucky Tenner is exactly ten.');
const M_EMPTY = vo('There is nothing to void.');
// The narrator.
const N_INTRO = vo('A self-checkout. Read the poster. It is a sum. I am so sorry.');
const N_CLOSE = vo(['So close. Pennies. It is always pennies.', 'Nearly. Nearly is the most expensive word in retail.']);
const HINTS = vo([
  'It has to be exactly ten pounds. The button alone is three ninety-nine. So you need six pounds and one penny of other things.',
  'Four things. Six pounds and one penny. None of them is a sock. I would never.',
  'The duck is in it. So is the air. I have said too much.',
  'Duck, bread, milk, air. I cannot believe I had to say that out loud.',
]);
const N_PAID = vo('Ten pounds exactly, and it is free. The receipt is longer than the shop. There is a way out.');
const N_HONEST = vo('You pay with the pile. All of it. There is no change. There is no Lucky Tenner. There is, at least, a way out.');
const N_HONEST_NO_BUTTON = vo('You are trying to pay for nothing. Scan the button first. That is the thing you are buying.');
const N_RECEIPT = vo('Take the receipt. It is proof you bought something. Some places care about that. Not many.');

// Paying with a money pile instead (the honest way out — no Lucky Tenner): a
// global recipe; the live checkout wires the hook.
let payWithPile: (() => boolean) | null = null;
defineCombine('money', 'checkout-kiosk', (held, _t, env) => {
  if (!payWithPile || !payWithPile()) return true; // kept (not paid)
  env.carry.removeCarryable(held);
  held.object.parent?.remove(held.object);
});

// ── Sounds ──
function beep(): void {
  ensureAudio();
  tone({ type: 'square', from: 1960, dur: 0.09, gain: 0.08 });
}
function bonk(): void {
  ensureAudio();
  tone({ type: 'square', from: 220, to: 160, dur: 0.35, gain: 0.1 });
  tone({ type: 'square', from: 180, to: 130, dur: 0.35, gain: 0.07 });
}
function printer(secs: number): void {
  ensureAudio();
  noise(secs, 0.05, 2400, 'bandpass');
}

type Target = { kind: 'item'; i: number } | { kind: 'button' } | { kind: 'void' } | { kind: 'pay' };

/** Headless-test hooks. */
export const selfCheckoutTest = {
  scan: (_i: number | 'button') => {},
  void: () => {},
  pay: () => {},
  total: () => 0,
  done: () => false,
  payWithPile: (): boolean => false,
};

export function revealSelfCheckout(ctx: GameContext): void {
  // Anything solid placed where you stand would pin you (you can't walk out of an
  // obstacle), so once it's all built you're nudged clear of every solid.
  const solids: Obstacle[] = [];
  const solid = (o: Obstacle) => {
    ctx.addObstacle(o);
    solids.push(o);
    return o;
  };
  const unstick = () => {
    const c = ctx.camera.position;
    for (let pass = 0; pass < 4; pass++) {
      for (const o of solids) {
        const need = o.radius + CONFIG.PLAYER_RADIUS + 0.05;
        const d = Math.hypot(c.x - o.x, c.z - o.z);
        if (d >= need) continue;
        const nx = d > 1e-4 ? (c.x - o.x) / d : 0;
        const nz = d > 1e-4 ? (c.z - o.z) / d : 1;
        c.x = o.x + nx * need;
        c.z = o.z + nz * need;
      }
    }
  };
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; the button sinks

  const grey = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a7048, roughness: 0.8 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    root.add(m);
    return m;
  };
  // Canvas text that always fits its width.
  const fitText = (g: CanvasRenderingContext2D, text: string, style: string, size: number, x: number, y: number, maxW: number) => {
    let px = size;
    do g.font = `${style} ${px}px ${FONT_SIGN}`;
    while (g.measureText(text).width > maxW && --px > 8);
    g.fillText(text, x, y);
  };
  const board = (w: number, h: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void) => {
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * 400);
    cv.height = Math.round(h * 400);
    const g = cv.getContext('2d')!;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    draw(g, cv.width, cv.height);
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
  };

  // ── The kiosk: body, scanner, screen, VOID and PAY keys ──
  box(1.1, 1.05, 0.6, KIOSK.x, 0.525, KIOSK.z, white);
  box(1.14, 0.05, 0.66, KIOSK.x, 1.075, KIOSK.z + 0.02, grey);
  const scanGlass = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.02, 0.3), new THREE.MeshBasicMaterial({ color: 0x5a0f0f }));
  scanGlass.position.set(KIOSK.x, 1.11, KIOSK.z + 0.05);
  root.add(scanGlass);
  const laser = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.01), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  laser.rotation.x = -Math.PI / 2;
  laser.position.set(KIOSK.x, 1.125, KIOSK.z + 0.05);
  root.add(laser);
  box(0.08, 0.5, 0.08, KIOSK.x, 1.35, KIOSK.z - 0.2, grey);
  const screenGroup = new THREE.Group();
  screenGroup.position.set(KIOSK.x, 1.78, KIOSK.z - 0.15);
  screenGroup.rotation.x = -0.2;
  root.add(screenGroup);
  screenGroup.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.72, 0.06), grey));
  const scv = document.createElement('canvas');
  scv.width = 600;
  scv.height = 420;
  const sg = scv.getContext('2d')!;
  const stex = new THREE.CanvasTexture(scv);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.64), new THREE.MeshBasicMaterial({ map: stex }));
  screen.position.z = 0.04;
  screenGroup.add(screen);
  const keyMat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 });
  const voidKey = box(0.26, 0.05, 0.14, KIOSK.x - 0.2, 1.12, KIOSK.z + 0.28, keyMat(0xd98a14));
  const payKey = box(0.26, 0.05, 0.14, KIOSK.x + 0.2, 1.12, KIOSK.z + 0.28, keyMat(0x2f8a52));
  const keyLabels = board(0.62, 0.08, (g, W, H) => {
    g.fillStyle = '#1a1a1a';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    fitText(g, 'VOID LAST', 'bold', 22, W * 0.27, H / 2, W * 0.4);
    fitText(g, 'PAY', 'bold', 22, W * 0.73, H / 2, W * 0.4);
  });
  keyLabels.rotation.x = -Math.PI / 2;
  keyLabels.position.set(KIOSK.x, 1.101, KIOSK.z + 0.43);
  root.add(keyLabels);
  for (let x = -0.6; x <= 0.6; x += 0.3) solid({ x: KIOSK.x + x, z: KIOSK.z, radius: 0.36 });

  // ── The receipt on the screen ──
  let receipt: Item[] = [];
  const total = () => receipt.reduce((a, it) => a + it.pence, 0);
  const drawScreen = (banner?: { text: string; bg: string }) => {
    sg.fillStyle = '#f4f4f0';
    sg.fillRect(0, 0, 600, 420);
    sg.fillStyle = banner?.bg ?? '#1d6fb8';
    sg.fillRect(0, 0, 600, 70);
    sg.fillStyle = '#fff';
    sg.textAlign = 'center';
    sg.textBaseline = 'middle';
    fitText(sg, banner?.text ?? (receipt.length ? 'SCAN NEXT ITEM' : 'WELCOME · SCAN AN ITEM'), 'bold', 36, 300, 36, 560);
    sg.fillStyle = '#1a1a1a';
    sg.textAlign = 'left';
    const lines = receipt.slice(-6);
    lines.forEach((it, k) => {
      fitText(sg, it.name, '', 26, 40, 105 + k * 40, 380);
    });
    sg.textAlign = 'right';
    lines.forEach((it, k) => fitText(sg, money(it.pence), '', 26, 560, 105 + k * 40, 140));
    if (receipt.length > 6) {
      sg.textAlign = 'left';
      fitText(sg, `(+${receipt.length - 6} earlier)`, 'italic', 20, 40, 350, 300);
    }
    sg.fillStyle = '#1a1a1a';
    sg.fillRect(30, 368, 540, 3);
    sg.textAlign = 'left';
    fitText(sg, 'TOTAL', 'bold', 32, 40, 396, 200);
    sg.textAlign = 'right';
    const t = total();
    sg.fillStyle = t === TARGET ? '#2f8a52' : '#1a1a1a';
    fitText(sg, money(t), 'bold', 32, 560, 396, 240);
    stex.needsUpdate = true;
  };
  drawScreen();

  // ── The poster: LUCKY TENNER ──
  const poster = board(1.4, 1.0, (g, W, H) => {
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c62828';
    g.lineWidth = 14;
    g.strokeRect(10, 10, W - 20, H - 20);
    g.fillStyle = '#c62828';
    fitText(g, 'LUCKY TENNER!', 'bold', 90, W / 2, H * 0.22, W - 60);
    g.fillStyle = '#1a1a1a';
    fitText(g, 'Total EXACTLY £10.00', 'bold', 60, W / 2, H * 0.47, W - 60);
    fitText(g, "and it's on us.", '', 52, W / 2, H * 0.64, W - 60);
    fitText(g, '(The only way out, today.)', 'italic', 36, W / 2, H * 0.83, W - 60);
  });
  poster.position.set(0, 2.55, -6.5 + 0.18); // on its own frame, off the back wall
  root.add(poster);
  box(1.5, 1.1, 0.06, 0, 2.55, -6.5 + 0.12, grey);

  // ── The shelf, along the left wall, facing into the room ──
  box(0.5, 1.2, 4.6, SHELF_X - 0.1, 0.6, -2.3, wood); // the unit
  box(0.55, 0.04, 4.7, SHELF_X, 1.22, -2.3, wood); // its top
  for (let z = -4.4; z <= -0.2; z += 0.5) solid({ x: SHELF_X - 0.05, z, radius: 0.35 });
  const shelfItems: THREE.Object3D[] = [];
  ITEMS.forEach((it, i) => {
    const z = -4.25 + i * 0.5;
    const obj = makeProduct(it);
    obj.position.set(SHELF_X + 0.05, 1.24, z);
    root.add(obj);
    shelfItems.push(obj);
    const tag = board(0.44, 0.2, (g, W, H) => {
      g.fillStyle = '#fff';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#c62828';
      g.fillRect(0, 0, W, H * 0.12);
      g.fillStyle = '#1a1a1a';
      fitText(g, it.name, 'bold', 26, W / 2, H * 0.38, W - 16);
      fitText(g, money(it.pence), 'bold', 34, W / 2, H * 0.74, W - 16);
    });
    tag.rotation.y = Math.PI / 2; // faces +x
    tag.position.set(SHELF_X + 0.19, 1.05, z);
    root.add(tag);
  });

  // ── THE BUTTON, on its own little stand ──
  box(0.5, 1.0, 0.5, STAND.x, 0.5, STAND.z, grey);
  const theButton = makeProduct(BUTTON);
  theButton.position.set(STAND.x, 1.02, STAND.z);
  root.add(theButton);
  const btnTag = board(0.5, 0.22, (g, W, H) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#1a1a1a';
    fitText(g, 'THE BUTTON', 'bold', 28, W / 2, H * 0.36, W - 16);
    fitText(g, money(BUTTON.pence), 'bold', 36, W / 2, H * 0.74, W - 16);
  });
  btnTag.position.set(STAND.x, 0.78, STAND.z + 0.26);
  root.add(btnTag);
  solid({ x: STAND.x, z: STAND.z, radius: 0.4 });

  // ── State + actions ──
  let done = false;
  let wrongPays = 0;
  let hintN = 0;
  let idleT = 0;
  let nearT = 0;
  const onReceipt = (it: Item) => receipt.includes(it);
  const scan = (it: Item, obj: THREE.Object3D) => {
    if (done || onReceipt(it)) return blip();
    receipt.push(it);
    obj.visible = false; // off the shelf, into the (unseen) bag
    beep();
    idleT = 0;
    drawScreen();
  };
  const voidLast = () => {
    if (done) return;
    const it = receipt.pop();
    if (!it) {
      bonk();
      ctx.narrate(M_EMPTY, 2000, { priority: true });
      return;
    }
    click();
    (it === BUTTON ? theButton : shelfItems[ITEMS.indexOf(it)]).visible = true; // back where it was
    drawScreen({ text: 'ITEM VOIDED', bg: '#d98a14' });
  };
  const hint = () => {
    ctx.narrate(HINTS[Math.min(hintN, HINTS.length - 1)], 7000);
    hintN++;
  };
  const pay = () => {
    if (done) return;
    const t = total();
    if (!onReceipt(BUTTON)) {
      bonk();
      drawScreen({ text: 'THE BUTTON IS MISSING', bg: '#c62828' });
      ctx.narrate(M_NO_BUTTON, 4000, { priority: true });
      return;
    }
    if (t !== TARGET) {
      bonk();
      wrongPays++;
      drawScreen({ text: t < TARGET ? `UNDER BY ${money(TARGET - t)}` : `OVER BY ${money(t - TARGET)}`, bg: '#c62828' });
      ctx.narrate(t < TARGET ? M_UNDER : M_OVER, 3500, { priority: true });
      if (Math.abs(t - TARGET) <= 10) ctx.narrate(N_CLOSE[wrongPays % N_CLOSE.length], 4000);
      // Hints: after the 1st wrong total, then every second one — escalating
      // until the answer is said out loud.
      if (wrongPays === 1 || wrongPays % 2 === 0) hint();
      return;
    }
    done = true;
    beep();
    fanfare();
    drawScreen({ text: 'LUCKY TENNER! £0.00 TO PAY', bg: '#2f8a52' });
    ctx.narrate(M_EXACT, 5000, { priority: true });
    ctx.narrate(N_PAID, 6000);
    discover('reward:bought-the-button');
    printReceipt();
  };
  const printReceipt = () => {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 1), new THREE.MeshStandardMaterial({ color: 0xf8f6ef, roughness: 0.9, side: THREE.DoubleSide }));
    root.add(strip);
    printer(3);
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      const len = Math.min(1.1, t * 0.37);
      strip.scale.y = Math.max(0.01, len);
      strip.position.set(KIOSK.x + 0.4, 1.05 - len / 2, KIOSK.z + 0.33);
      if (t < 3) return false;
      // Tear it off: the receipt is yours — a persistent thing, proof of purchase.
      ctx.addCarryable({
        kind: 'receipt',
        object: strip,
        persistent: true,
        heldDist: 0.55,
        heldDrop: 0.3,
        heldUpdate: (_dt, o, q) => {
          o.quaternion.copy(q);
          o.scale.set(1, 0.45, 1); // folded, in hand
        },
      });
      ctx.narrate(N_RECEIPT, 4500);
      makeExit();
      return true;
    });
  };
  let exitMade = false;
  const makeExit = () => {
    if (exitMade) return;
    exitMade = true;
    const at = EXIT.clone();
    const p = ctx.playerPos();
    if (Math.hypot(p.x - at.x, p.z - at.z) < 1.3) at.x -= 1.6; // never on top of you
    const btn = spawnPedestalButton(root, at, () => ctx.advance(at), { glow: false });
    solid(btn.obstacle);
    unstick();
    sparkle();
  };

  ctx.addTarget({ kind: 'checkout-kiosk', position: KIOSK.clone().setY(1), radius: 1.3 });
  payWithPile = () => {
    if (done) return false;
    if (!onReceipt(BUTTON)) {
      bonk();
      ctx.narrate(N_HONEST_NO_BUTTON, 4500, { priority: true });
      return false;
    }
    done = true;
    beep();
    drawScreen({ text: 'PAID IN FULL. NO CHANGE.', bg: '#2f8a52' });
    ctx.narrate(N_HONEST, 6000, { priority: true });
    printReceipt();
    return true;
  };
  selfCheckoutTest.payWithPile = () => payWithPile?.() ?? false;
  setScriptHints(HINTS);

  selfCheckoutTest.scan = (i) => (i === 'button' ? scan(BUTTON, theButton) : scan(ITEMS[i], shelfItems[i]));
  selfCheckoutTest.void = voidLast;
  selfCheckoutTest.pay = pay;
  selfCheckoutTest.total = total;
  selfCheckoutTest.done = () => done;

  // ── Aim-and-press: a shelf item, the button, VOID or PAY ──
  const ray = new THREE.Raycaster();
  ray.far = 3.2;
  const centre = new THREE.Vector2(0, 0);
  const pickables: [THREE.Object3D, Target][] = [
    ...shelfItems.map((o, i): [THREE.Object3D, Target] => [o, { kind: 'item', i }]),
    [theButton, { kind: 'button' }],
    [voidKey, { kind: 'void' }],
    [payKey, { kind: 'pay' }],
  ];
  let aimed: Target | null = null;
  const use: Interactable = {
    id: 'checkout-pick',
    position: KIOSK.clone(),
    radius: 3.4,
    promptLabel: '',
    onUse: () => {
      if (!aimed) return;
      if (aimed.kind === 'item') scan(ITEMS[aimed.i], shelfItems[aimed.i]);
      else if (aimed.kind === 'button') scan(BUTTON, theButton);
      else if (aimed.kind === 'void') voidLast();
      else pay();
    },
  };
  registerInteractable(use);
  const hitWhose = (o: THREE.Object3D) => pickables.find(([root]) => {
    let c: THREE.Object3D | null = o;
    while (c) {
      if (c === root) return true;
      c = c.parent;
    }
    return false;
  });

  addUpdater((dt) => {
    ray.setFromCamera(centre, ctx.camera);
    const live = pickables.filter(([o]) => o.visible).map(([o]) => o);
    const hit = ray.intersectObjects(live, true)[0];
    const found = hit ? hitWhose(hit.object) : undefined;
    aimed = found ? found[1] : null;
    use.promptLabel = aimed ? 'PRESS' : '';
    if (found) found[0].getWorldPosition(use.position).setY(0.5);
    // Idle: a nudge toward the poster, then hints on a slow clock.
    if (!done) {
      idleT += dt;
      if (idleT > 25) {
        idleT = 0;
        hint();
      }
      // Standing at exactly £10 without paying: point at PAY.
      if (total() === TARGET && onReceipt(BUTTON)) {
        nearT += dt;
        if (nearT > 6) {
          nearT = -20;
          ctx.narrate('Ten pounds exactly. Press pay.', 3000);
        }
      } else nearT = 0;
    }
    laser.visible = !done;
    return false;
  });

  unstick();
  ctx.narrate(N_INTRO, 5000);
  ctx.narrate(M_WELCOME, 2500);
}

// A little product for the shelf, in its colour: cans, cartons, a duck, a sock…
function makeProduct(it: Item): THREE.Object3D {
  const mat = new THREE.MeshStandardMaterial({ color: it.color, roughness: 0.6 });
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, y: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  switch (it.name) {
    case 'RUBBER DUCK': {
      const d = createAsset('duck');
      d.scale.setScalar(0.5);
      d.position.y = 0.1;
      g.add(d);
      break;
    }
    case 'THE BUTTON': {
      add(new THREE.CylinderGeometry(0.12, 0.13, 0.08, 18), 0.04).material = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5 });
      add(new THREE.SphereGeometry(0.09, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0.08);
      break;
    }
    case 'BREAD':
      add(new THREE.BoxGeometry(0.16, 0.12, 0.3), 0.06);
      break;
    case 'MILK':
      add(new THREE.BoxGeometry(0.12, 0.26, 0.12), 0.13);
      break;
    case 'ONE SOCK':
      add(new THREE.BoxGeometry(0.06, 0.2, 0.08), 0.1);
      add(new THREE.BoxGeometry(0.06, 0.06, 0.12), 0.03).position.z = 0.04;
      break;
    case 'AIR (DIET)': {
      const m = add(new THREE.SphereGeometry(0.11, 14, 10), 0.12);
      (m.material as THREE.MeshStandardMaterial).transparent = true;
      (m.material as THREE.MeshStandardMaterial).opacity = 0.45;
      break;
    }
    case 'CANDLE':
      add(new THREE.CylinderGeometry(0.05, 0.05, 0.24, 12), 0.12);
      break;
    case 'BATTERIES':
      for (let k = 0; k < 4; k++) add(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), 0.06).position.z = -0.075 + k * 0.05;
      break;
    default: // cans and bars
      add(it.name === 'REGRET BAR' ? new THREE.BoxGeometry(0.06, 0.04, 0.22) : new THREE.CylinderGeometry(0.06, 0.06, 0.14, 14), 0.07);
  }
  return g;
}
