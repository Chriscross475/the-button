import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { defineCombine } from '../game/combine';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { registerInteractable } from '../interactables/system';
import type { Interactable } from '../interactables/types';
import { tone, noise, ensureAudio, click, blip, sparkle, thud } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { spawnCoin } from '../objects/coin';
import { setScriptHints } from '../objects/script';
import { FONT_DISPLAY, FONT_SIGN } from '../ui/fonts';

// THE VENDING MACHINE — the white room stays shut, and against its back wall
// stands a vending machine. Behind the glass, on a spiral coil: THE button,
// product B4. One coin.
//
//   Find a coin (down the back of the sofa; or press COIN RETURN — people
//   forget their change — which also refunds you, and never leaves you coinless)
//   → hold it and click the coin slot (or pay with the money, if you brought it)
//   → key in B then 4 on the keypad (aim + press) → the coil turns… and the
//   button sticks at the edge, as they do → shove the machine (aim at it and
//   press: a proper shove, three times) → it drops into the tray → take it out
//   and press it (click while holding) → on you go.
//
// Any other code with credit drops some other product (a comedic snack you can
// throw); B4 without credit → INSERT COIN. Hints start early and repeat for
// whatever step you're stuck on.

const W = CONFIG.ROOM.width; // 11
const D = CONFIG.ROOM.depth; // 13

// The machine (local frame: front faces +Z, feet at y = 0).
const MX = -1.2;
const MZ = -D / 2 + 0.65; // back at MZ − 0.45, clear of the wall face (−D/2 + 0.06)
const MW = 1.6;
const MH = 2.3;
const MD = 0.9;
const FRONT = MD / 2;
const ROWS = ['A', 'B', 'C', 'D'];
const ROW_Y = [2.0, 1.62, 1.24, 0.86];
const COL_X = [-0.62, -0.34, -0.06, 0.22];
const TRAY = new THREE.Vector3(-0.2, 0.15, MD / 2 + 0.07); // local: on the tray flap, in front of the base
// Keypad panel (local), face at PANEL_Z.
const PANEL_X = 0.57;
const PANEL_Y = 1.35;
const PANEL_W = 0.34;
const PANEL_H = 1.7;
const PANEL_Z = FRONT + 0.045;
const CV_W = 256;
const CV_H = 1024;

// Keypad cells in canvas px: 3×3 keys, then COIN RETURN.
interface Cell { id: string; x: number; y: number; w: number; h: number }
const KEY_IDS = ['A', 'B', 'C', 'D', '1', '2', '3', '4', 'CLR'];
const CELLS: Cell[] = [
  ...KEY_IDS.map((id, i) => ({ id, x: 22 + (i % 3) * 74, y: 360 + Math.floor(i / 3) * 110, w: 64, h: 90 })),
  { id: 'RET', x: 22, y: 720, w: 212, h: 80 },
];
const SLOT_Y = 270; // coin slot, canvas px

// Everything that isn't the button, by code: the name on the display.
const PRODUCTS: Record<string, { name: string; color: number }> = {
  A1: { name: 'AIR (DIET)', color: 0xdfe8f0 },
  A2: { name: 'DUCK CHOW', color: 0xe0b040 },
  A3: { name: 'COLD TEA', color: 0x8a5a32 },
  A4: { name: 'MYSTERY CRISPS', color: 0x7a4ab0 },
  B1: { name: 'A KEY (WRONG)', color: 0x9a9a9a },
  B2: { name: 'ONE GRAPE', color: 0x5a8a3a },
  B3: { name: 'REGRET BAR', color: 0x4a3a2a },
  C1: { name: 'SAND (DESERT)', color: 0xd6b07a },
  C2: { name: 'SAD CHIPS', color: 0x3a6fd0 },
  C3: { name: 'MINT (USED)', color: 0x8ae0c0 },
  C4: { name: 'TICKET 948', color: 0xf2f2ee },
  D1: { name: 'CLOWN NOSE', color: 0xe02020 },
  D2: { name: 'SOCK (LEFT)', color: 0x2b2b3a },
  D3: { name: 'BATTERIES (FLAT)', color: 0x3a3a3a },
  D4: { name: 'NOTHING', color: 0x151515 },
};

const INTRO = vo('A vending machine. The button is in it. B four, on the little spiral. It costs one coin. You do not have a coin. Yet.');
const SOFA_HINT = vo('There is always a coin down the back of a sofa. Always.');
const RETURN_HINT = vo('Or check the coin return. People forget their change. People are like that.');
const PAY_HINT = vo('Hold the coin up to the slot and click. It is not complicated. It is a vending machine.');
const CODE_HINT = vo('B, then four. The button is B four. It says so on the little label.');
const SHOVE_HINT = vo('It is stuck. They always get stuck. Give the machine a shove. A proper one. Aim at it and push.');
const TAKE_HINT = vo('It is in the tray. Take it out. Then press it. You know how buttons work.');
const INSERT_COIN = vo('Insert coin. It says insert coin. It has always said insert coin.');
const PAID = vo('Credit. One coin. Choose wisely. It is B four.');
const MEMBER = vo('Button Premium. The machine vends for members. For free. It resents it, but it does it.');
const REGRET = vo('A Regret Bar. Nobody eats these. Almost nobody. Something small and hungry might.');
const STUCK = vo('And it is stuck. Right on the edge. Of course it is.');
const SHOVE_1 = vo('A shove. It wobbles. It considers falling.');
const SHOVE_EMPTY = vo('You shove the vending machine. For no reason. It did nothing to you. Yet.');
const DROPPED = vo('Thunk. The button, in the tray. That is the best sound a vending machine makes.');
const WRONG = vo(['That is not B four. You have bought something else. You own it now.', 'Not the button. A snack, allegedly. Enjoy it. Or throw it.', 'Wrong one. The machine thanks you for your custom.']);
const SOLD_OUT = vo('Sold out. Everything you want is always sold out.');
const RETURNED = vo('Clink. Somebody left their change in the coin return. Finders keepers.');
const REFUND = vo('Your coin, back. The machine has changed its mind about you.');
const PRESSED = vo('You bought the button, and you pressed it. That is the most anyone has ever got out of a vending machine.');

// ── Carried items meet the machine (global recipes; the live level wires them) ──
let pay: ((held: Carryable) => void) | null = null;
defineCombine('coin', 'coin-slot', (held) => {
  pay?.(held);
});
defineCombine('money', 'coin-slot', (held) => {
  pay?.(held);
});

// ── Sounds, from the shared primitives ──
function clink(): void {
  ensureAudio();
  tone({ type: 'triangle', from: 2400, to: 2200, dur: 0.12, gain: 0.08 });
  setTimeout(() => tone({ type: 'triangle', from: 1900, to: 1800, dur: 0.18, gain: 0.07 }), 90);
}
function whirr(secs: number): void {
  ensureAudio();
  tone({ type: 'sawtooth', from: 90, to: 96, dur: secs, gain: 0.05, attack: 0.05 });
  noise(secs, 0.025, 500, 'lowpass');
}
function thunk(): void {
  ensureAudio();
  noise(0.18, 0.25, 240, 'lowpass');
  tone({ type: 'sine', from: 110, to: 55, dur: 0.25, gain: 0.2 });
}

export function revealVending(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; its button sinks

  // ── The machine ──
  const machine = new THREE.Group();
  machine.position.set(MX, 0, MZ);
  root.add(machine);
  const shellMat = new THREE.MeshStandardMaterial({ color: 0xb8232a, roughness: 0.5, metalness: 0.3 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.8 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    machine.add(m);
    return m;
  };
  const shell = [
    box(MW, MH, 0.05, 0, MH / 2, -FRONT + 0.025, darkMat), // back (inside: dark)
    box(0.06, MH, MD, -MW / 2 + 0.03, MH / 2, 0, shellMat),
    box(0.06, MH, MD, MW / 2 - 0.03, MH / 2, 0, shellMat),
    box(MW, 0.12, MD, 0, MH - 0.06, 0, shellMat),
    box(MW, 0.42, MD, 0, 0.21, 0, shellMat), // base (the tray is in it)
    box(0.06, MH - 0.54, MD - 0.1, PANEL_X - PANEL_W / 2 - 0.05, 0.42 + (MH - 0.54) / 2, -0.05, shellMat), // divider
  ];
  // The tray: a dark recess across the base front (in front of it, never on it).
  const trayMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const tray = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.24), trayMat);
  tray.position.set(TRAY.x, 0.22, FRONT + 0.03);
  machine.add(tray);
  const flap = box(0.9, 0.04, 0.12, TRAY.x, 0.08, FRONT + 0.02, new THREE.MeshStandardMaterial({ color: 0x2a2b30, roughness: 0.5 }));
  flap.castShadow = false;
  // Shelves + coils + products.
  const shelfMat = new THREE.MeshStandardMaterial({ color: 0x9a9ea6, roughness: 0.4, metalness: 0.6 });
  const coilMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.3, metalness: 0.8 });
  const helix = (() => {
    const pts: THREE.Vector3[] = [];
    for (let t = 0; t <= 1; t += 1 / 60) {
      const a = t * Math.PI * 2 * 5;
      pts.push(new THREE.Vector3(Math.cos(a) * 0.09, Math.sin(a) * 0.09, -0.36 + t * 0.7));
    }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.008, 5, false);
  })();
  const coils = new Map<string, THREE.Mesh>();
  const items = new Map<string, THREE.Object3D>();
  ROWS.forEach((r, ri) => {
    box(1.1, 0.02, MD - 0.12, -0.2, ROW_Y[ri] - 0.11, -0.03, shelfMat);
    COL_X.forEach((x, ci) => {
      const code = `${r}${ci + 1}`;
      const coil = new THREE.Mesh(helix, coilMat);
      coil.position.set(x, ROW_Y[ri], 0);
      machine.add(coil);
      coils.set(code, coil);
      let item: THREE.Object3D;
      if (code === 'B4') {
        // THE button, small, on its own little base.
        item = new THREE.Group();
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.07, 18), new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5 }));
        item.add(base);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe0201a, roughness: 0.3, emissive: 0x400000 }));
        dome.position.y = 0.035;
        item.add(dome);
      } else {
        const p = PRODUCTS[code];
        item = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.06), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6 }));
      }
      item.position.set(x, ROW_Y[ri] - 0.04, 0.12);
      machine.add(item);
      items.set(code, item);
    });
  });
  // Shelf-edge labels (one canvas strip per shelf, in front of the glass line).
  ROWS.forEach((r, ri) => {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 40;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#f2f2ee';
    g.fillRect(0, 0, 512, 40);
    g.fillStyle = '#1a1a1a';
    g.font = `bold 26px ${FONT_DISPLAY}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    COL_X.forEach((_, ci) => g.fillText(`${r}${ci + 1}`, 64 + ci * 128, 22));
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.07), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
    strip.position.set(-0.2, ROW_Y[ri] - 0.155, FRONT - 0.07);
    machine.add(strip);
  });
  // The glass, inside the shell's front edge.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 1.7),
    new THREE.MeshStandardMaterial({ color: 0xcfe6ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false }),
  );
  glass.position.set(-0.2, 1.35, FRONT - 0.04);
  machine.add(glass);
  // The keypad panel: a raised box with its face (a canvas) just in front.
  box(PANEL_W, PANEL_H, 0.08, PANEL_X, PANEL_Y, FRONT, darkMat);
  const panelCv = document.createElement('canvas');
  panelCv.width = CV_W;
  panelCv.height = CV_H;
  const pg = panelCv.getContext('2d')!;
  const panelTex = new THREE.CanvasTexture(panelCv);
  const panelFace = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ map: panelTex }));
  panelFace.position.set(PANEL_X, PANEL_Y, PANEL_Z);
  machine.add(panelFace);
  // A little cup for the coin return, under the panel.
  const cup = box(0.16, 0.1, 0.14, PANEL_X, 0.58, FRONT + 0.06, darkMat);
  cup.castShadow = false;
  // A header sign across the top: in front of the shell, never on it.
  const hcv = document.createElement('canvas');
  hcv.width = 512;
  hcv.height = 96;
  const hg = hcv.getContext('2d')!;
  hg.fillStyle = '#f2c12e';
  hg.fillRect(0, 0, 512, 96);
  hg.fillStyle = '#b8232a';
  hg.textAlign = 'center';
  hg.textBaseline = 'middle';
  let hpx = 64;
  do hg.font = `bold ${hpx}px ${FONT_SIGN}`;
  while (hg.measureText('SNAX & BUTTONS').width > 470 && --hpx > 12);
  hg.fillText('SNAX & BUTTONS', 256, 50);
  const header = new THREE.Mesh(new THREE.PlaneGeometry(MW - 0.1, 0.28), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(hcv) }));
  header.position.set(0, MH - 0.28, FRONT + 0.02);
  machine.add(header);
  // Solid: three discs across the footprint (you can reach the keypad, not climb in).
  for (const x of [-0.5, 0, 0.5]) ctx.addObstacle({ x: MX + x, z: MZ, radius: 0.5 });

  // ── The sofa, against the left wall — with a coin down the back ──
  const sofaX = -W / 2 + 0.75;
  const sofaZ = -1.0;
  const sofaMat = new THREE.MeshStandardMaterial({ color: 0x5a6e3a, roughness: 0.95 });
  const sofa = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), sofaMat);
    m.position.set(sofaX + x, y, sofaZ + z);
    m.castShadow = true;
    root.add(m);
  };
  sofa(0.9, 0.4, 2.2, 0, 0.2, 0); // base
  sofa(0.25, 0.6, 2.2, -0.35, 0.7, 0); // back
  sofa(0.9, 0.3, 0.2, 0, 0.55, -1.1); // arms
  sofa(0.9, 0.3, 0.2, 0, 0.55, 1.1);
  sofa(0.62, 0.16, 0.98, 0.12, 0.48, -0.5); // cushions
  sofa(0.62, 0.16, 0.98, 0.12, 0.48, 0.5);
  for (const z of [-0.8, 0, 0.8]) ctx.addObstacle({ x: sofaX, z: sofaZ + z, radius: 0.5 });

  // ── Coins ──
  // (the shared coin — change found here spends anywhere, and vice versa)
  const looseCoins = new Set<Carryable>();
  const makeCoin = (pos: THREE.Vector3): Carryable => {
    const c = spawnCoin(ctx, pos, {
      onGrab: () => {
        if (!coinFound) {
          coinFound = true;
          hintT = 0;
        }
      },
    });
    c.object.rotation.set(Math.PI / 2 - 0.3, 0, 0.2);
    looseCoins.add(c);
    return c;
  };
  // Down the back of the sofa: between the cushions, a glint.
  makeCoin(new THREE.Vector3(sofaX + 0.12, 0.57, sofaZ + 0.02));
  const cupWorld = () => machine.localToWorld(new THREE.Vector3(PANEL_X, 0.66, FRONT + 0.06));

  // ── State ──
  let credit = false;
  let coinFound = false;
  let code = '';
  let display = 'INSERT COIN';
  let busy = false;
  let stuck = false;
  let dropped = false;
  let shoves = 0;
  let done = false;
  const sold = new Set<string>();
  let hintT = 0;
  let hintN = 0;
  let insertCool = 0;

  const drawPanel = (hover = -1) => {
    pg.fillStyle = '#1e1f24';
    pg.fillRect(0, 0, CV_W, CV_H);
    // display
    pg.fillStyle = '#0b120b';
    pg.fillRect(16, 30, CV_W - 32, 160);
    pg.fillStyle = '#59ff7a';
    pg.textAlign = 'center';
    pg.textBaseline = 'middle';
    let px = 46;
    do pg.font = `bold ${px}px ${FONT_DISPLAY}`;
    while (pg.measureText(display).width > CV_W - 52 && --px > 12);
    pg.fillText(display, CV_W / 2, 90);
    pg.font = `bold 30px ${FONT_DISPLAY}`;
    pg.fillText(code.padEnd(2, '_'), CV_W / 2, 150);
    // coin slot
    pg.fillStyle = '#9a9ea6';
    pg.fillRect(CV_W / 2 - 50, SLOT_Y - 26, 100, 52);
    pg.fillStyle = '#0a0a0a';
    pg.fillRect(CV_W / 2 - 6, SLOT_Y - 20, 12, 40);
    pg.fillStyle = '#c8ccd4';
    pg.font = `18px ${FONT_SIGN}`;
    pg.fillText('COIN', CV_W / 2, SLOT_Y + 44);
    // keys
    CELLS.forEach((c, i) => {
      pg.fillStyle = i === hover ? '#f2c12e' : '#c8ccd4';
      pg.fillRect(c.x, c.y, c.w, c.h);
      pg.fillStyle = '#16171b';
      let kp = c.id.length > 1 ? 30 : 48;
      const label = c.id === 'RET' ? 'COIN RETURN' : c.id;
      do pg.font = `bold ${kp}px ${FONT_SIGN}`;
      while (pg.measureText(label).width > c.w - 10 && --kp > 10);
      pg.fillText(label, c.x + c.w / 2, c.y + c.h / 2 + 2);
    });
    panelTex.needsUpdate = true;
  };
  drawPanel();
  const show = (t: string) => {
    display = t;
    drawPanel();
  };

  pay = (held) => {
    if (done) return;
    ctx.removeCarryable(held);
    held.object.parent?.remove(held.object);
    looseCoins.delete(held);
    clink();
    if (credit) {
      // already paid: it comes straight back out
      ctx.after(400, () => makeCoin(cupWorld()));
      return;
    }
    credit = true;
    setSlot(false);
    coinFound = true;
    hintT = 0;
    show('CREDIT 1');
    ctx.narrate(PAID, 4000, { priority: true });
  };
  // The slot takes a coin only while there's no credit — so, once paid, a coin
  // in your hand doesn't steal your clicks from the keypad.
  const slotTarget = { kind: 'coin-slot', position: machine.localToWorld(new THREE.Vector3(PANEL_X, 1.2, FRONT)), radius: 1.4 };
  let slotOpen = false;
  const setSlot = (open: boolean) => {
    if (open === slotOpen) return;
    slotOpen = open;
    if (open) ctx.addTarget(slotTarget);
    else ctx.removeTarget(slotTarget);
  };
  setSlot(true);

  // Something falls into the tray (a product or THE button): straight down
  // inside the machine, behind the glass, then it's in the tray.
  const dropToTray = (obj: THREE.Object3D, then: () => void) => {
    const from = obj.position.clone();
    const floor = 0.5; // just above the base, inside
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      const k = Math.min(1, t / 0.4);
      obj.position.y = from.y + (floor - from.y) * k * k;
      obj.rotation.x += dt * 6;
      if (k >= 1) {
        obj.position.set(TRAY.x + (Math.random() - 0.5) * 0.3, TRAY.y, TRAY.z);
        obj.rotation.set(0.1, 0, 0);
        thunk();
        then();
        return true;
      }
      return false;
    });
  };
  // Turn a coil: its product rides forward to the edge (stuck = stops there).
  const turn = (c: string, then: () => void) => {
    const coil = coils.get(c)!;
    const item = items.get(c)!;
    whirr(1.1);
    let t = 0;
    const z0 = item.position.z;
    addUpdater((dt) => {
      t += dt;
      const k = Math.min(1, t / 1.1);
      coil.rotation.z = -k * Math.PI * 2;
      item.position.z = z0 + k * 0.22;
      if (k >= 1) {
        then();
        return true;
      }
      return false;
    });
  };
  // Make a dropped item a carryable (world-parented) where it landed.
  const takeable = (obj: THREE.Object3D, kind: string, extra: Partial<Carryable> = {}): Carryable => {
    root.attach(obj);
    const c: Carryable = { kind, object: obj, heldDist: 0.6, heldDrop: 0.25, ...extra };
    ctx.addCarryable(c);
    return c;
  };

  let saidMember = false;
  const vend = (c: string) => {
    discover('mech:vending');
    // Button Premium: members vend for nothing.
    if (!credit && ctx.isHolding('premium-card')) {
      credit = true;
      setSlot(false);
      if (!saidMember) {
        saidMember = true;
        ctx.narrate(MEMBER, 5000, { priority: true });
      }
    }
    if (!credit) {
      show('INSERT COIN');
      if (insertCool <= 0) {
        insertCool = 5;
        ctx.narrate(INSERT_COIN, 4000, { priority: true });
      } else blip();
      return;
    }
    if (sold.has(c)) {
      show('SOLD OUT');
      ctx.narrate(SOLD_OUT, 3500, { priority: true });
      return;
    }
    credit = false;
    setSlot(!dropped);
    sold.add(c);
    busy = true;
    hintT = 0;
    show('VENDING');
    if (c === 'B4') {
      turn(c, () => {
        const item = items.get(c)!;
        item.rotation.x = 0.45; // teetering, right on the edge
        item.position.y -= 0.02;
        stuck = true;
        busy = false;
        show('THANK YOU');
        ctx.narrate(STUCK, 4000, { priority: true });
      });
      return;
    }
    turn(c, () =>
      dropToTray(items.get(c)!, () => {
        busy = false;
        show(PRODUCTS[c].name);
        ctx.narrate(WRONG[sold.size % WRONG.length], 4500, { priority: true });
        const obj = items.get(c)!;
        if (PRODUCTS[c].name === 'REGRET BAR') {
          // Its own thing: kept, and findable by a baby wolf (it eats it — and
          // never grows again).
          const bar = takeable(obj, 'regret-bar', {
            persistent: true,
            clickThrows: true,
            projectile: { radius: 0.1, restitution: 0.3, gravity: 12, speed: 8, arc: 1.4 },
          });
          obj.userData.kind = 'regret-bar';
          obj.userData.carryable = bar;
          ctx.narrate(REGRET, 5000);
        } else {
          takeable(obj, 'snack', {
            clickThrows: true,
            projectile: { radius: 0.1, restitution: 0.3, gravity: 12, speed: 8, arc: 1.4 },
          });
        }
      }),
    );
  };

  // A shove: the machine rocks back and settles. With the button stuck on the
  // edge, the third one drops it.
  const shove = () => {
    if (busy) return;
    thud();
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      const k = Math.min(1, t / 0.6);
      machine.rotation.x = -Math.sin(k * Math.PI) * 0.05 * (1 - k * 0.5);
      machine.position.z = MZ - Math.sin(k * Math.PI) * 0.05;
      if (k >= 1) {
        machine.rotation.x = 0;
        machine.position.z = MZ;
        return true;
      }
      return false;
    });
    if (!stuck) {
      if (shoves++ === 0 || Math.random() < 0.3) ctx.narrate(SHOVE_EMPTY, 3500, { priority: true });
      return;
    }
    shoves++;
    const item = items.get('B4')!;
    item.rotation.x = 0.45 + shoves * 0.15;
    if (shoves < 3) {
      if (shoves === 1) ctx.narrate(SHOVE_1, 3000, { priority: true });
      return;
    }
    stuck = false;
    busy = true;
    hintT = 0;
    ctx.after(350, () =>
      dropToTray(item, () => {
        busy = false;
        dropped = true;
        setSlot(false);
        ctx.narrate(DROPPED, 4500, { priority: true });
        // The button, in your hand: click it (a tap) and it's pressed.
        const btn = takeable(item, 'vend-button', {
          heldDist: 0.55,
          heldDrop: 0.25,
          heldUpdate: (_dt, o) => o.rotation.set(0.5, 0, 0), // dome up, toward you
          onTap: () => {
            if (done) return;
            done = true;
            click();
            sparkle();
            const dome = (item as THREE.Group).children[1];
            if (dome) dome.position.y = 0.015; // pressed
            discover('reward:vended');
            ctx.narrate(PRESSED, 6000, { priority: true });
            // Pressed, it's spent: out of your hand and gone (a held item would
            // otherwise ride along into the next room).
            ctx.after(500, () => {
              ctx.removeCarryable(btn);
              item.parent?.remove(item);
            });
            const at = ctx.playerPos().clone().setY(0);
            ctx.after(1400, () => ctx.advance(at));
          },
        });
      }),
    );
  };

  const pressCell = (id: string) => {
    click();
    if (id === 'CLR') {
      code = '';
      drawPanel();
      return;
    }
    if (id === 'RET') {
      if (credit) {
        // your coin, back out
        credit = false;
        setSlot(true);
        show('INSERT COIN');
        clink();
        ctx.narrate(REFUND, 3500, { priority: true });
        ctx.after(300, () => makeCoin(cupWorld()));
      } else if (looseCoins.size === 0 && !dropped && !done) {
        // somebody's change — the machine never leaves you coinless
        clink();
        ctx.narrate(RETURNED, 4000, { priority: true });
        ctx.after(300, () => makeCoin(cupWorld()));
      } else blip();
      return;
    }
    if (busy) return;
    if (/[A-D]/.test(id)) code = id;
    else if (code.length === 1) {
      code += id;
      const c = code;
      code = '';
      drawPanel();
      vend(c);
      return;
    } else code = '';
    drawPanel();
  };

  // ── Aim + press: the keypad cell under the crosshair, or the machine itself ──
  const aim = new THREE.Raycaster();
  aim.far = 2.6;
  const CROSS = new THREE.Vector2(0, 0);
  const SHOVE = -2;
  let sel = -1;
  const hitTargets: THREE.Object3D[] = [panelFace, glass, ...shell];
  const pickable: Interactable = {
    id: 'vending-machine',
    position: new THREE.Vector3(MX, 1, MZ + FRONT),
    radius: 2.4,
    promptLabel: '',
    onUse: () => {
      if (sel === SHOVE) shove();
      else if (sel >= 0) pressCell(CELLS[sel].id);
    },
  };
  registerInteractable(pickable);

  addUpdater((dt) => {
    insertCool -= dt;
    aim.setFromCamera(CROSS, ctx.camera);
    const hit = aim.intersectObjects(hitTargets, false)[0];
    let next = -1;
    if (hit) {
      if (hit.object === panelFace && hit.uv) {
        const px = hit.uv.x * CV_W;
        const py = (1 - hit.uv.y) * CV_H;
        next = CELLS.findIndex((c) => px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h);
      } else if (hit.object !== panelFace) next = SHOVE;
    }
    if (next !== sel) {
      sel = next;
      drawPanel(sel >= 0 ? sel : -1);
    }
    // Once the button is out, the machine stops claiming clicks: a click with
    // the button in hand presses the button, wherever you're facing.
    pickable.promptLabel = sel === -1 || dropped ? '' : 'PRESS';
    pickable.position.set(MX, 1, MZ + FRONT);

    // Hints: early, and they repeat for whatever step you're on.
    if (!done) {
      hintT += dt;
      if (hintT > (hintN === 0 ? 12 : 20)) {
        hintT = 0;
        hintN++;
        let line: string;
        if (dropped) line = TAKE_HINT;
        else if (stuck) line = SHOVE_HINT;
        else if (credit) line = CODE_HINT;
        else if (coinFound && looseCoins.size > 0) line = PAY_HINT;
        else line = hintN % 2 ? SOFA_HINT : RETURN_HINT;
        ctx.narrate(line, 5000);
      }
    }
    return false;
  });

  vendingTest.press = pressCell;
  vendingTest.pay = (c) => pay?.(c);
  vendingTest.shove = shove;
  setScriptHints([SOFA_HINT, RETURN_HINT, PAY_HINT, CODE_HINT, SHOVE_HINT, TAKE_HINT]);
  ctx.narrate(INTRO, 6000);
}

/** Headless-test hooks (the sim drives the keypad, shoves and pays directly). */
export const vendingTest: { press?: (id: string) => void; shove?: () => void; pay?: (c: Carryable) => void } = {};
