import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { defineCombine } from '../game/combine';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { tone, noise, ensureAudio, pop, click, thud } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { hideRoomShell } from './scaffold';
import { buildExitRoom } from './exit-room';

// THE GIFT SHOP — exit through the gift shop. The white room becomes a shop
// selling merchandise of the game itself (duck plushies, "I pressed it" mugs, a
// train snow globe…). The only way out is the turnstile at the back, and it
// only turns for customers: you must be holding a souvenir.
//
//   • Pay: bring the money in (kind 'money') and hand it over at the till — or
//     fish a coin out of the wishing fountain and pay with that. Paid → the
//     turnstile turns for any souvenir you carry.
//   • Or shoplift: carry an unpaid souvenir to the turnstile while the guard's
//     back is turned (he patrols the aisle; his gaze is the pale cone). Seen →
//     he takes it back, re-shelves it, and walks you to the entrance.
//
// Either way through the turnstile is the exit room (its button moves you on).

const { width: W, depth: D, height: H } = CONFIG.ROOM; // 11 × 13 × 3.6
const PH = CONFIG.PLAYER_HEIGHT;
const DOOR_HALF = 0.8;
const DOOR_H = 2.4;
const TURNSTILE = new THREE.Vector3(0, 0, -D / 2 + 0.7);
const TILL = new THREE.Vector3(-2.6, 0, -4.2);
const FOUNTAIN = new THREE.Vector3(2.4, 0, 1.4);
const ENTRANCE = new THREE.Vector3(0, 0, D / 2 - 1.6);
const EXIT = new THREE.Vector3(0, 0, -D / 2 - 0.3 - 4.5);
// The guard's beat: watching the turnstile, then a stroll up the aisle and back.
const POST_A = new THREE.Vector3(1.8, 0, -4.4);
const POST_B = new THREE.Vector3(1.8, 0, 4.2);
const VIEW_R = 9;
const VIEW_HALF = (35 * Math.PI) / 180;

const INTRO = vo('Exit through the gift shop. Everything in here is about you, and all of it is for sale. The turnstile only turns for customers.');
const TURNSTILE_NO = vo('The turnstile will not let you leave without a purchase. It is that kind of turnstile.');
const PICKED = vo('A souvenir. Now you just have to pay for it. Or not. I am not your conscience.');
const COIN = vo('A coin from the wishing fountain. Someone wished for something with that. Now it is a mug.');
const PAID = vo('Ka-ching. Paid for, fair and square. The turnstile respects that.');
const PAID_EMPTY = vo('Paid. Now pick something. Anything. The money is gone either way.');
const NOT_MONEY = vo('You have to pay for it. With money. That is how shops work.');
const ALREADY = vo('It is paid for. Go. Before he thinks of a warranty.');
const CAUGHT = vo('Caught. He takes it back, puts it on the shelf, and walks you to the entrance. Very politely. Very firmly.');
const SMUGGLED = vo('Nobody saw. The turnstile does not ask questions. Enjoy your stolen merchandise.');
const THANKS = vo('Thank you for shopping. Please come again. Please do not.');

// Paying is global (combines are global recipes); the live shop wires the hook.
let hooks: { pay: (what: 'money' | 'coin') => void; souvenirAtTill: () => void } | null = null;
defineCombine('money', 'shop-till', (held, _t, env) => {
  if (!hooks) return true;
  env.carry.removeCarryable(held);
  held.object.parent?.remove(held.object);
  hooks.pay('money');
});
defineCombine('shop-coin', 'shop-till', (held, _t, env) => {
  if (!hooks) return true;
  env.carry.removeCarryable(held);
  held.object.parent?.remove(held.object);
  hooks.pay('coin');
});
defineCombine('souvenir', 'shop-till', () => {
  hooks?.souvenirAtTill();
  return true; // keep it
});

/** Headless-test access to the live shop's state and actions. */
export const giftShopTest: {
  pay?: (what: 'money' | 'coin') => void;
  state?: () => { paid: boolean; open: boolean; guardSees: (p: THREE.Vector3) => boolean };
} = {};

// ── Sounds ──
function kaChing(): void {
  ensureAudio();
  noise(0.08, 0.25, 3000, 'highpass');
  tone({ type: 'triangle', from: 1760, dur: 0.35, gain: 0.12 });
  setTimeout(() => tone({ type: 'triangle', from: 2637, dur: 0.6, gain: 0.1 }), 90);
}
function shopBell(): void {
  ensureAudio();
  tone({ type: 'sine', from: 2093, dur: 0.9, gain: 0.08 });
  tone({ type: 'sine', from: 3136, dur: 0.6, gain: 0.04 });
}
function whistle(): void {
  ensureAudio();
  tone({ type: 'sine', from: 2800, to: 3000, dur: 0.18, gain: 0.12 });
  setTimeout(() => tone({ type: 'sine', from: 2800, to: 3000, dur: 0.35, gain: 0.12 }), 230);
}
function clunk(): void {
  ensureAudio();
  tone({ type: 'square', from: 140, to: 70, dur: 0.18, gain: 0.14 });
  noise(0.1, 0.15, 900);
}

export function revealGiftShop(ctx: GameContext): void {
  const root = ctx.levelRoot;
  // The white room is swapped for the shop's own box (same size, a doorway in
  // the back wall). No fog change: it stays a closed room.
  ctx.openRoom({ walls: false, ceiling: false });
  hideRoomShell(ctx);
  ctx.scene.background = new THREE.Color(0xf2ece0);
  ctx.scene.fog = null;
  buildShop(ctx);
  root.add(new THREE.HemisphereLight(0xfff4e4, 0x6a5a48, 1.0));
  const key = new THREE.DirectionalLight(0xffffff, 0.35);
  key.position.set(2, 8, 4);
  root.add(key);

  // ── Merchandise: souvenirs on the side shelves ──
  interface Souvenir { carry: Carryable; home: THREE.Vector3; held: boolean }
  const souvenirs: Souvenir[] = [];
  let saidPick = false;
  const stock: [string, string, () => THREE.Object3D][] = [
    ['duck-plush', 'Duck Plush · £12', makeDuckPlush],
    ['mug', '"I Pressed It" Mug · £9', makeMug],
    ['keyring', 'Button Keyring · £4', makeKeyring],
    ['globe', 'Train Snow Globe · £15', makeSnowGlobe],
    ['towel', 'Quilt Tea Towel · £7', makeTeaTowel],
    ['cannon', 'Tiny Cannon · £20', makeTinyCannon],
    ['outline', 'Chalk Outline Mat · £11', makeOutlineMat],
    ['key', 'Red Key (Replica) · £3', makeReplicaKey],
  ];
  stock.forEach(([id, label, make], i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i / 2);
    const home = new THREE.Vector3(side * (W / 2 - 0.55), 1.02, -2.6 + row * 2.2);
    const obj = make();
    obj.position.copy(home);
    obj.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    obj.userData.item = id;
    root.add(obj);
    // Price tag on the shelf edge, facing the aisle.
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.14), new THREE.MeshBasicMaterial({ map: tagTexture(label) }));
    tag.position.set(side * (W / 2 - 0.86), 0.9, home.z);
    tag.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    root.add(tag);
    const s: Souvenir = { carry: null as unknown as Carryable, home, held: false };
    s.carry = {
      kind: 'souvenir',
      object: obj,
      heldDist: 0.6,
      heldDrop: 0.3,
      persistent: true, // yours to keep, once you're out
      projectile: { radius: 0.12, restitution: 0.3, gravity: 14 },
      clickThrows: true,
      onGrab: () => {
        s.held = true;
        pop();
        if (!saidPick) {
          saidPick = true;
          ctx.narrate(PICKED, 5000, { priority: true });
        }
      },
      onRelease: () => {
        s.held = false;
      },
    };
    ctx.addCarryable(s.carry);
    souvenirs.push(s);
  });

  // ── The wishing fountain: three coins you can fish out and pay with ──
  let saidCoin = false;
  for (let i = 0; i < 3; i++) {
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 16), new THREE.MeshStandardMaterial({ color: 0xe0b040, roughness: 0.3, metalness: 0.8 }));
    const a = (i / 3) * Math.PI * 2 + 0.4;
    coin.position.set(FOUNTAIN.x + Math.cos(a) * 0.45, 0.5, FOUNTAIN.z + Math.sin(a) * 0.45);
    root.add(coin);
    ctx.addCarryable({
      kind: 'shop-coin',
      object: coin,
      heldDist: 0.5,
      heldDrop: 0.25,
      projectile: { radius: 0.05, restitution: 0.4, gravity: 16 },
      clickThrows: true,
      onGrab: () => {
        click();
        if (!saidCoin) {
          saidCoin = true;
          ctx.narrate(COIN, 5000, { priority: true });
        }
      },
    });
  }

  // ── The till ──
  let paid = false;
  ctx.addTarget({ kind: 'shop-till', position: TILL.clone().setY(1), radius: 2.2 });
  hooks = {
    pay: () => {
      kaChing();
      paid = true;
      discover('mech:shop-till');
      ctx.narrate(ctx.isHolding('souvenir') ? PAID : PAID_EMPTY, 5000, { priority: true });
    },
    souvenirAtTill: () => {
      ctx.narrate(paid ? ALREADY : NOT_MONEY, 4000, { priority: true });
    },
  };

  // ── The guard: a patrol with a pale view cone ──
  const guard = makeGuard();
  guard.root.position.copy(POST_A);
  root.add(guard.root);
  const cone = new THREE.Mesh(
    new THREE.CircleGeometry(VIEW_R, 24, -VIEW_HALF, VIEW_HALF * 2),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  cone.rotation.x = -Math.PI / 2;
  const coneGroup = new THREE.Group();
  coneGroup.position.y = 0.03;
  coneGroup.add(cone);
  root.add(coneGroup);
  let yaw = Math.atan2(TURNSTILE.x - POST_A.x, TURNSTILE.z - POST_A.z); // facing: +Z rotated by yaw
  let beat: 'watch' | 'out' | 'look' | 'back' | 'escort' = 'watch';
  let beatT = 0;
  let stride = 0;
  const sees = (p: THREE.Vector3) => {
    const dx = p.x - guard.root.position.x;
    const dz = p.z - guard.root.position.z;
    const d = Math.hypot(dx, dz);
    if (d > VIEW_R) return false;
    if (d < 0.8) return true;
    const ang = Math.atan2(dx, dz) - yaw;
    return Math.abs(Math.atan2(Math.sin(ang), Math.cos(ang))) < VIEW_HALF;
  };
  const walkTo = (to: THREE.Vector3, dt: number) => {
    const d = new THREE.Vector3().subVectors(to, guard.root.position).setY(0);
    const len = d.length();
    if (len < 0.05) return true;
    guard.root.position.addScaledVector(d.normalize(), Math.min(len, 1.6 * dt));
    yaw = Math.atan2(d.x, d.z);
    stride += dt * 8;
    return false;
  };

  // ── The turnstile ──
  const gate = buildTurnstile(root);
  const gateBlock = { x: TURNSTILE.x, z: TURNSTILE.z, radius: 0.75 };
  ctx.addObstacle(gateBlock);
  let open = false;
  let saidNo = false;
  let atGate = false;
  const openGate = (how: 'paid' | 'stolen') => {
    open = true;
    ctx.removeObstacle(gateBlock);
    clunk();
    shopBell();
    if (how === 'stolen') discover('reward:shoplifted');
    ctx.narrate(how === 'paid' ? THANKS : SMUGGLED, 5000, { priority: true });
  };
  const caught = () => {
    whistle();
    const s = souvenirs.find((x) => x.held);
    ctx.consumeHeld('souvenir'); // out of your hand…
    if (s) {
      root.add(s.carry.object); // …and back on its shelf (still for sale)
      s.carry.object.position.copy(s.home);
      s.held = false;
    }
    ctx.camera.position.set(ENTRANCE.x, PH, ENTRANCE.z);
    beat = 'escort';
    beatT = 0;
    ctx.narrate(CAUGHT, 6000, { priority: true });
  };

  // The shop through the turnstile: its doorway, then the exit room.
  const room = buildExitRoom(ctx, { center: EXIT, facing: 'posZ' });
  const shopRegion = { minX: -W / 2 + 0.3, maxX: W / 2 - 0.3, minZ: -D / 2 + 0.3, maxZ: D / 2 - 0.3, floorY: 0 };
  // The doorway overlaps both the shop and the exit room by ≥ 0.6 m (2 × the
  // player radius), or you couldn't cross the seams.
  const doorway = { minX: -DOOR_HALF + 0.05, maxX: DOOR_HALF - 0.05, minZ: -D / 2 - 1.3, maxZ: -D / 2 + 1.3, floorY: 0 };
  ctx.setRegions([shopRegion, doorway, room]);

  giftShopTest.pay = (what) => hooks?.pay(what);
  giftShopTest.state = () => ({ paid, open, guardSees: sees });

  addUpdater((dt) => {
    // The guard's beat.
    beatT += dt;
    if (beat === 'watch') {
      yaw = Math.atan2(TURNSTILE.x - guard.root.position.x, TURNSTILE.z - guard.root.position.z);
      if (beatT > 6) (beat = 'out'), (beatT = 0);
    } else if (beat === 'out') {
      if (walkTo(POST_B, dt)) (beat = 'look'), (beatT = 0);
    } else if (beat === 'look') {
      yaw = 0; // up the aisle, at the merchandise (his back to the turnstile)
      if (beatT > 4) (beat = 'back'), (beatT = 0);
    } else if (beat === 'back' || beat === 'escort') {
      if (walkTo(POST_A, dt)) (beat = 'watch'), (beatT = 0);
    }
    const swing = beat === 'out' || beat === 'back' || beat === 'escort' ? Math.sin(stride) : 0;
    guard.legL.rotation.x = swing * 0.5;
    guard.legR.rotation.x = -swing * 0.5;
    guard.armL.rotation.x = -swing * 0.35;
    guard.armR.rotation.x = swing * 0.35;
    guard.root.rotation.y = yaw;
    coneGroup.position.x = guard.root.position.x;
    coneGroup.position.z = guard.root.position.z;
    coneGroup.rotation.y = yaw - Math.PI / 2; // the circle-sector's 0 angle is +X

    // The turnstile's arms turn once it's open.
    if (open) gate.rotation.y += dt * 2.5;

    // At the turnstile: holding something? Paid, or unseen → through. Seen with
    // it unpaid → caught. Empty-handed → it won't turn.
    const p = ctx.playerPos();
    const near = Math.hypot(p.x - TURNSTILE.x, p.z - TURNSTILE.z) < 1.35;
    if (near && !atGate && !open) {
      if (!ctx.isHolding('souvenir')) {
        if (!saidNo) {
          saidNo = true;
          ctx.narrate(TURNSTILE_NO, 4500, { priority: true });
        }
        thud();
      } else if (paid) openGate('paid');
      else if (sees(p)) caught();
      else openGate('stolen');
    }
    atGate = near;
    return false;
  });

  ctx.narrate(INTRO, 6000);
}

// ── The shop box ───────────────────────────────────────────────────────────

function buildShop(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const solid = (x: number, z: number, radius: number) => ctx.addObstacle({ x, z, radius });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9dcc6, roughness: 0.9 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x7a2a2a, roughness: 0.7 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.8 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  // Floor: a checked shop floor.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    g.fillStyle = (i + j) % 2 ? '#c9b99a' : '#efe6d4';
    g.fillRect(i * 8, j * 8, 8, 8);
  }
  const ft = new THREE.CanvasTexture(cv);
  ft.wrapS = ft.wrapT = THREE.RepeatWrapping;
  ft.repeat.set(W / 2, D / 2);
  ft.magFilter = THREE.NearestFilter;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  root.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xf6f1e8, roughness: 1, side: THREE.DoubleSide }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  root.add(ceil);
  // Walls (the back one with the exit doorway), a painted skirting stripe.
  const T = 0.12;
  box(W, H, T, 0, H / 2, D / 2, wallMat);
  box(T, H, D, -W / 2, H / 2, 0, wallMat);
  box(T, H, D, W / 2, H / 2, 0, wallMat);
  const side = W / 2 - DOOR_HALF;
  box(side, H, T, -(DOOR_HALF + side / 2), H / 2, -D / 2, wallMat);
  box(side, H, T, DOOR_HALF + side / 2, H / 2, -D / 2, wallMat);
  box(DOOR_HALF * 2, H - DOOR_H, T, 0, DOOR_H + (H - DOOR_H) / 2, -D / 2, wallMat);
  // Skirting boards (proud of the walls, not coplanar).
  box(W - 0.3, 0.16, 0.05, 0, 0.08, D / 2 - 0.1, trim);
  box(0.05, 0.16, D - 0.3, -W / 2 + 0.1, 0.08, 0, trim);
  box(0.05, 0.16, D - 0.3, W / 2 - 0.1, 0.08, 0, trim);

  // Shelving units down both side walls: two tiers each.
  for (const s of [-1, 1]) {
    const x = s * (W / 2 - 0.55);
    box(0.6, 0.06, 8.6, x, 0.55, 0.7, wood);
    box(0.6, 0.06, 8.6, x, 0.98, 0.7, wood);
    box(0.06, 1.3, 8.6, s * (W / 2 - 0.22), 0.65, 0.7, wood); // back board, off the wall
    for (const z of [-3.6, 0.7, 5.0]) box(0.6, 1.3, 0.06, x, 0.65, z, wood);
    for (let z = -3.6; z <= 5.0; z += 0.5) solid(x, z, 0.35);
  }

  // The till counter by the exit, a clerk behind it.
  box(2.0, 1.0, 0.7, TILL.x, 0.5, TILL.z, trim);
  box(2.1, 0.06, 0.8, TILL.x, 1.03, TILL.z, wood);
  const reg = box(0.45, 0.3, 0.35, TILL.x + 0.4, 1.21, TILL.z, new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5 }));
  reg.rotation.y = 0.2;
  const clerk = createAsset('dummy') as THREE.Group;
  clerk.position.set(TILL.x, 0, TILL.z - 0.75);
  clerk.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = new THREE.MeshStandardMaterial({ color: 0x3a6a4a, roughness: 0.8 });
  });
  root.add(clerk);
  for (let x = TILL.x - 0.9; x <= TILL.x + 0.9; x += 0.45) solid(x, TILL.z, 0.4);
  solid(TILL.x, TILL.z - 0.75, 0.35);

  // The wishing fountain.
  const stone = new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.9 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 0.45, 24, 1, true), stone);
  basin.position.set(FOUNTAIN.x, 0.225, FOUNTAIN.z);
  root.add(basin);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.82, 24), new THREE.MeshStandardMaterial({ color: 0x5aa0c8, roughness: 0.1, metalness: 0.2 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(FOUNTAIN.x, 0.4, FOUNTAIN.z);
  root.add(water);
  solid(FOUNTAIN.x, FOUNTAIN.z, 0.95);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.8, 10), stone);
  spout.position.set(FOUNTAIN.x, 0.6, FOUNTAIN.z);
  root.add(spout);

  // Signs hanging from the ceiling (mid-air, so nothing is coplanar).
  const hang = (text: string, x: number, z: number, w: number, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.2), new THREE.MeshBasicMaterial({ map: signTexture(text), side: THREE.DoubleSide }));
    m.position.set(x, H - 0.55, z);
    m.rotation.y = rotY;
    root.add(m);
  };
  hang('EXIT THROUGH THE GIFT SHOP', 0, -D / 2 + 1.6, 3.4);
  hang('SOUVENIRS', 0, 2.2, 2.4);
  hang('WISHING FOUNTAIN · NO FISHING', FOUNTAIN.x, FOUNTAIN.z, 2.0);
}

function buildTurnstile(root: THREE.Object3D): THREE.Group {
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.3, metalness: 0.8 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 1.0, 12), metal);
  post.position.set(TURNSTILE.x, 0.5, TURNSTILE.z);
  root.add(post);
  const arms = new THREE.Group();
  arms.position.set(TURNSTILE.x, 0.9, TURNSTILE.z);
  for (let k = 0; k < 3; k++) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), metal);
    arm.rotation.z = Math.PI / 2;
    arm.position.x = 0.35;
    const pivot = new THREE.Group();
    pivot.rotation.y = (k * Math.PI * 2) / 3;
    pivot.add(arm);
    arms.add(pivot);
  }
  root.add(arms);
  return arms;
}

// ── Canvas text, always shrunk to fit ──

function fitText(g: CanvasRenderingContext2D, text: string, style: string, maxPx: number, maxW: number, x: number, y: number): void {
  let px = maxPx;
  do g.font = `${style} ${px}px Georgia, serif`;
  while (g.measureText(text).width > maxW && --px > 8);
  g.fillText(text, x, y);
}
function tagTexture(label: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 320;
  cv.height = 72;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fffaf0';
  g.fillRect(0, 0, 320, 72);
  g.strokeStyle = '#7a2a2a';
  g.lineWidth = 4;
  g.strokeRect(3, 3, 314, 66);
  g.fillStyle = '#1a1a1a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitText(g, label, 'italic', 34, 296, 160, 38);
  return new THREE.CanvasTexture(cv);
}
function signTexture(text: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 640;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#7a2a2a';
  g.fillRect(0, 0, 640, 128);
  g.strokeStyle = '#e8c86a';
  g.lineWidth = 6;
  g.strokeRect(6, 6, 628, 116);
  g.fillStyle = '#fff3d6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitText(g, text, 'bold', 64, 590, 320, 68);
  return new THREE.CanvasTexture(cv);
}

// ── The guard (the jointed dummy in navy, with a cap) ──

function makeGuard(): { root: THREE.Group; legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D } {
  const g = createAsset('dummy') as THREE.Group;
  const navy = new THREE.MeshStandardMaterial({ color: 0x1f2a44, roughness: 0.8 });
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = navy;
  });
  const head = g.getObjectByName('head') as THREE.Mesh;
  head.material = new THREE.MeshStandardMaterial({ color: 0xe8c4a0, roughness: 0.8 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 16), navy);
  cap.position.y = 0.17;
  head.add(cap);
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.12), new THREE.MeshStandardMaterial({ color: 0x0c0c10 }));
  peak.position.set(0, 0.14, 0.16);
  head.add(peak);
  return {
    root: g,
    legL: g.getObjectByName('legL') as THREE.Object3D,
    legR: g.getObjectByName('legR') as THREE.Object3D,
    armL: g.getObjectByName('armL') as THREE.Object3D,
    armR: g.getObjectByName('armR') as THREE.Object3D,
  };
}

// ── The merchandise ──

const mat = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, ...o });

function makeDuckPlush(): THREE.Object3D {
  const d = createAsset('duck');
  d.scale.setScalar(0.8);
  return d;
}
function makeMug(): THREE.Object3D {
  const g = new THREE.Group();
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 96;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 256, 96);
  c.fillStyle = '#c62828';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  fitText(c, 'I PRESSED IT', 'bold', 40, 230, 128, 50);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.15, 16), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.4 }));
  body.position.y = 0.075;
  g.add(body);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 12), mat(0xffffff));
  handle.position.set(0.08, 0.08, 0);
  g.add(handle);
  return g;
}
function makeKeyring(): THREE.Object3D {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 6, 16), mat(0xc0c4cc, { metalness: 0.8 }));
  ring.position.y = 0.12;
  g.add(ring);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), mat(0x3a3c42));
  base.position.y = 0.03;
  g.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe02020, { roughness: 0.3 }));
  dome.position.y = 0.045;
  g.add(dome);
  return g;
}
function makeSnowGlobe(): THREE.Object3D {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.05, 16), mat(0x5a3a22));
  base.position.y = 0.025;
  g.add(base);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshStandardMaterial({ color: 0xdff1ff, transparent: true, opacity: 0.35, roughness: 0.05 }));
  glass.position.y = 0.13;
  g.add(glass);
  const train = createAsset('train');
  train.scale.setScalar(0.025);
  train.position.y = 0.06;
  g.add(train);
  return g;
}
function makeTeaTowel(): THREE.Object3D {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d')!;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    c.fillStyle = (i + j) % 2 ? '#d86a6a' : '#f3ead3';
    c.fillRect(i * 8, j * 8, 8, 8);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.22), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  m.position.y = 0.015;
  const g = new THREE.Group();
  g.add(m);
  return g;
}
function makeTinyCannon(): THREE.Object3D {
  const g = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.2, 12), mat(0xb8231f));
  barrel.rotation.z = Math.PI / 2 - 0.5;
  barrel.position.y = 0.08;
  g.add(barrel);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 12), mat(0x1a1a1f));
    w.rotation.x = Math.PI / 2;
    w.position.set(0, 0.045, s * 0.05);
    g.add(w);
  }
  return g;
}
function makeOutlineMat(): THREE.Object3D {
  const g = new THREE.Group();
  const outline = createAsset('crime-outline');
  outline.scale.setScalar(0.12);
  outline.position.y = 0.03;
  const matBase = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.4), mat(0x2a2a2e));
  matBase.position.y = 0.01;
  g.add(matBase, outline);
  return g;
}
function makeReplicaKey(): THREE.Object3D {
  const k = createAsset('key', { color: 0xd23a2a });
  k.rotation.x = Math.PI / 2;
  const g = new THREE.Group();
  k.position.y = 0.04;
  g.add(k);
  return g;
}
