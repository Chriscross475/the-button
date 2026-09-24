import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { registerInteractable, unregisterInteractable } from '../interactables/system';
import { spawnPedestalButton, type SpawnedButton } from '../button/pedestal-button';
import { makeMiniButton } from '../objects/original-button';
import { spawnMoney } from '../objects/money';
import { spawnCoin } from '../objects/coin';
import { createAsset } from '../assets';
import { tone, noise, ensureAudio, pop, sparkle, applause, fanfare, thud, whoosh } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { FONT_SIGN, FONT_DISPLAY } from '../ui/fonts';

// THE INFOMERCIAL — the white room becomes a garish shopping-channel set and the
// narrator a screaming host. The product: THE BUTTON. Every press of it is
// "BUT WAIT — THERE'S MORE!" and the set gains something more absurd, which
// STAYS: a free second button, steak knives, a price crash, confetti cannons, a
// choir, a gospel key change, indoor fireworks, smoke, a horse, a monster truck
// through the backdrop, a negative price (they pay you), a bigger button down
// through the roof, a marching band, the host in tears, the studio on fire.
// The music layers up with every step. At the top: ORDER NOW. Press it — a
// phone rings, a very calm operator, and then nothing. Just you and the button.
//
// The CALL NOW phone takes payment: cash is refused (they GIVE cash), and a
// premium card skips the whole pitch to the finale.

const { width: W, depth: D, height: H } = CONFIG.ROOM; // 11 × 13 × 3.6

const PRODUCT = new THREE.Vector3(0, 0.12, -3); // on the turntable
const HOST = new THREE.Vector3(-1.7, 0, -4.3);
const BIG_BTN = new THREE.Vector3(2.4, 0, -2.2);
const ORDER = new THREE.Vector3(-1.9, 0, -0.8);
const PHONE = new THREE.Vector3(-4.3, 0, 1.2);
const BACKDROP_Z = -D / 2 + 0.55;
const PRESS_COOLDOWN = 1.1;

const INTRO = vo('Are YOU tired of NOT pressing buttons? Do you reach for a button, and MISS? There has to be a better way!');
const INTRO_2 = vo('Introducing: THE BUTTON! It presses! It is round! It is red! Operators are standing by! Press it NOW!');
const STEP_LINES = vo([
  'But wait. There is MORE! Press now and get a SECOND BUTTON. Absolutely FREE! Just pay separate shipping and handling!',
  'But WAIT! There is more! A set of steak knives! They have NOTHING to do with the button! You are GETTING THEM ANYWAY!',
  'And the PRICE? Not one hundred and ninety nine. Not ninety nine. NINETEEN NINETY NINE! Are you KIDDING me?',
  'But WAIT! CONFETTI! Two cannons of it! Indoors! Nobody asked! It is included!',
  'But wait! A CHOIR! A full choir, singing about the button! They have been rehearsing since TUESDAY!',
  'KEY CHANGE! Everybody up! Hallelujah, it is a BUTTON!',
  'But WAIT! Fireworks! INDOORS! Our lawyers said no! We did not ASK our lawyers!',
  'Smoke machine! Why? Atmosphere! What is the button hiding? NOTHING! It is a button!',
  'But wait! There is a HORSE! A real, live horse! We do not know where it came from! It is yours now!',
  'But WAIT! A MONSTER TRUCK! Through the BACKDROP! Somebody get that man a button!',
  'And the price? The price is NEGATIVE! WE pay YOU! Take the money! TAKE IT!',
  'But WAIT! A helicopter! On the roof! Lowering a BIGGER BUTTON! Through the ROOF! We will pay for the roof!',
  'A MARCHING BAND! In the studio! Every single one of them LOVES the button!',
  'I am sorry. I am just. I am so happy. It is a button. It is such a good button.',
  'The studio is ON FIRE! THAT is how good this deal is! ORDER NOW! ORDER NOW!',
]);
const ORDER_LINE = vo('Thank you for your order. It will arrive in six to eight business years. Is there anything else I can help you with today? No. Goodbye.');
const AFTER_ORDER = vo('The set is gone. The host is gone. The horse, presumably, is somewhere. There is just the button. Which you already had.');
const PHONE_IDLE = vo('Lines are open! Well. Not this one. This one is decorative. Press the BUTTON!');
const PHONE_CASH = vo('Cash? CASH? We do not TAKE cash! We GIVE cash! Here is MORE cash!');
const PHONE_PREMIUM = vo('A PLATINUM card! Platinum customers get MORE MORE! Skip the pitch! Straight to the good part! Everything! AT ONCE!');
const PHONE_LATE = vo('The operators have gone home. They were crying too.');
const PRESS_HINT = vo('Press it! The BUTTON! On the turntable! Every press, MORE!');
const ORDER_HINT = vo('ORDER NOW! The big yellow one! Before the studio finishes burning down!');
const GIFT_GRAB = vo('Your free gift! Steak knives! Do NOT throw them! Or DO! They are YOURS!');

type Step = () => void;

export function revealInfomercial(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; its button sinks
  ctx.scene.fog = null;
  ctx.scene.background = new THREE.Color(0x14061f);
  const cam = ctx.camera.position;
  if (cam.z < -1.6) cam.z = -1.2; // never inside the turntable
  let alive = true; // false once the set is struck (updaters wind down)

  // Everything the pitch adds lives in `set`, so the finale can strike it.
  const set = new THREE.Group();
  root.add(set);
  const obstacles: { x: number; z: number; radius: number }[] = [];
  const solid = (o: { x: number; z: number; radius: number }) => {
    obstacles.push(o);
    ctx.addObstacle(o);
  };

  // ── Canvas helpers ──
  const canvasTex = (w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) => {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d')!;
    draw(g);
    const tex = new THREE.CanvasTexture(cv);
    return { cv, g, tex };
  };
  const fit = (g: CanvasRenderingContext2D, text: string, font: (px: number) => string, maxW: number, px: number) => {
    do g.font = font(px);
    while (g.measureText(text).width > maxW && --px > 8);
  };

  // ── The set: a checker floor, a neon backdrop, a price screen ──
  const floor = canvasTex(512, 512, (g) => {
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 8; j++) {
        g.fillStyle = (i + j) % 2 ? '#ff2fa0' : '#1fd6d0';
        g.fillRect(i * 64, j * 64, 64, 64);
      }
  });
  floor.tex.wrapS = floor.tex.wrapT = THREE.RepeatWrapping;
  floor.tex.repeat.set(2, 2.4);
  const floorMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.3, D - 0.3),
    new THREE.MeshStandardMaterial({ map: floor.tex, roughness: 0.25, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = 0.012;
  set.add(floorMesh);

  const drop = canvasTex(1024, 384, (g) => {
    const grad = g.createLinearGradient(0, 0, 1024, 384);
    grad.addColorStop(0, '#6a00ff');
    grad.addColorStop(0.5, '#ff2fa0');
    grad.addColorStop(1, '#ffb400');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 384);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      g.beginPath();
      g.moveTo(512, 200);
      g.arc(512, 200, 700, a, a + Math.PI / 24);
      g.fill();
    }
    g.fillStyle = '#fff';
    g.strokeStyle = '#2a0044';
    g.lineWidth = 12;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fit(g, 'THE BUTTON™', (px) => `italic 900 ${px}px ${FONT_SIGN}`, 900, 170);
    g.strokeText('THE BUTTON™', 512, 170);
    g.fillText('THE BUTTON™', 512, 170);
    fit(g, 'AS SEEN ON TV', (px) => `bold ${px}px ${FONT_SIGN}`, 600, 54);
    g.fillStyle = '#ffe600';
    g.fillText('AS SEEN ON TV', 512, 310);
  });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.8, 3.2), new THREE.MeshBasicMaterial({ map: drop.tex }));
  backdrop.position.set(0, 1.7, BACKDROP_Z);
  set.add(backdrop);

  // The price screen (left of the backdrop, angled at you).
  const screen = canvasTex(512, 288, () => {});
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.125), new THREE.MeshBasicMaterial({ map: screen.tex }));
  screenMesh.position.set(-3.6, 2.35, BACKDROP_Z + 0.9);
  screenMesh.rotation.y = 0.5;
  set.add(screenMesh);
  let price = '£199.99';
  let oldPrice = '';
  let flash = false;
  const drawScreen = () => {
    const g = screen.g;
    g.fillStyle = '#0a0a18';
    g.fillRect(0, 0, 512, 288);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (oldPrice) {
      g.fillStyle = '#888';
      fit(g, oldPrice, (px) => `bold ${px}px ${FONT_DISPLAY}`, 300, 46);
      g.fillText(oldPrice, 256, 58);
      g.strokeStyle = '#ff2020';
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(140, 58);
      g.lineTo(372, 58);
      g.stroke();
    }
    g.fillStyle = price.startsWith('-') ? '#3dff6a' : '#ffe600';
    fit(g, price, (px) => `bold ${px}px ${FONT_DISPLAY}`, 470, 96);
    g.fillText(price, 256, 142);
    g.fillStyle = flash ? '#ff2fa0' : '#1fd6d0';
    fit(g, 'CALL NOW 0800-BUTTON', (px) => `bold ${px}px ${FONT_SIGN}`, 470, 40);
    g.fillText('CALL NOW 0800-BUTTON', 256, 238);
    screen.tex.needsUpdate = true;
  };
  drawScreen();
  let flashT = 0;

  // Studio lights: a pink and a cyan wash that sweep.
  const pink = new THREE.PointLight(0xff2fa0, 12, 16, 1.6);
  pink.position.set(-3, 3.1, -1);
  const cyan = new THREE.PointLight(0x1fd6d0, 12, 16, 1.6);
  cyan.position.set(3, 3.1, -1);
  set.add(pink, cyan);

  // ── The turntable and THE product ──
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 1.0, 0.12, 32),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.2, metalness: 0.6 }),
  );
  table.position.set(PRODUCT.x, 0.06, PRODUCT.z);
  set.add(table);
  let pressCool = 0;
  let step = 0; // next escalation to run
  let finale = false; // ORDER NOW is up
  let done = false; // the order is placed; the button is just a button again
  let idleT = 0; // since the last escalation, for the host's nudge
  const product: SpawnedButton = spawnPedestalButton(root, PRODUCT, () => onProductPress());
  solid(product.obstacle);

  // ── The host: a dummy in a gold suit with a microphone ──
  const host = createAsset('dummy') as THREE.Group;
  const suit = new THREE.MeshStandardMaterial({ color: 0xd4a216, roughness: 0.3, metalness: 0.7 });
  host.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name !== 'head') o.material = suit;
  });
  host.position.copy(HOST);
  host.rotation.y = 0.5;
  set.add(host);
  solid({ x: HOST.x, z: HOST.z, radius: 0.35 });
  const hostArm = host.getObjectByName('armR');
  let hostHype = 0; // > 0: gesturing wildly
  let crying = false;

  // ── The studio audience: two rows, stage right ──
  const audience: THREE.Group[] = [];
  for (let r = 0; r < 2; r++)
    for (let k = 0; k < 5; k++) {
      const a = createAsset('dummy') as THREE.Group;
      a.scale.setScalar(0.85);
      a.position.set(4.2 + r * 0.6, 0, -1.6 + k * 0.9);
      a.rotation.y = -Math.PI / 2;
      set.add(a);
      audience.push(a);
      solid({ x: a.position.x, z: a.position.z, radius: 0.28 });
    }
  let cheer = 0;

  // ── Music: a cheesy loop that layers up with the pitch ──
  let key = 0; // semitones up (the gospel key change)
  let beat = 0;
  let beatT = 0;
  let loud = 1;
  let silent = false;
  const PROG = [0, -3, 5, 7]; // I–vi–IV–V
  const hz = (semi: number) => 220 * Math.pow(2, (semi + key) / 12);
  const musicTick = (dt: number) => {
    if (silent) return;
    beatT -= dt;
    if (beatT > 0) return;
    beatT = Math.max(0.24, 0.42 - step * 0.012);
    ensureAudio();
    const root0 = PROG[Math.floor(beat / 4) % 4];
    const b = beat % 4;
    const g = 0.035 * loud;
    tone({ type: 'triangle', from: hz(root0 - 12), dur: 0.3, gain: g * 1.4 }); // bass
    if (step >= 1 && (b === 0 || b === 2)) {
      for (const iv of [0, 4, 7]) tone({ type: 'sine', from: hz(root0 + iv), dur: 0.5, gain: g * 0.7 });
    }
    if (step >= 5 && b === 0) {
      for (const iv of [0, 4, 7, 12]) tone({ type: 'triangle', from: hz(root0 + iv + 12), dur: 1.5, gain: g * 0.45, attack: 0.25 }); // choir "aah"
    }
    if (step >= 13) {
      if (b === 1 || b === 3) noise(0.08, g * 1.8, 2200, 'bandpass'); // snare
      tone({ type: 'sine', from: 90, to: 50, dur: 0.12, gain: g * 2.2 }); // kick every beat
    }
    if (step >= 15 && b === 0) tone({ type: 'square', from: 880, to: 660, dur: 0.35, gain: g * 0.6 }); // fire alarm
    beat++;
  };

  // ── Shared effects ──
  interface Bit {
    m: THREE.Mesh;
    v: THREE.Vector3;
    life: number;
    settle: boolean;
  }
  const bits: Bit[] = [];
  const MAX_BITS = 160;
  const bitGeo = new THREE.PlaneGeometry(0.07, 0.1);
  const bitMats = [0xff2fa0, 0xffe600, 0x1fd6d0, 0x7a3dff, 0x3dff6a].map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
  const sparkGeo = new THREE.SphereGeometry(0.04, 6, 4);
  const burst = (at: THREE.Vector3, n: number, speed: number, opts: { settle?: boolean; spark?: boolean; up?: number } = {}) => {
    for (let i = 0; i < n; i++) {
      if (bits.length >= MAX_BITS) {
        const old = bits.shift()!;
        set.remove(old.m);
      }
      const mat = bitMats[i % bitMats.length];
      const m = new THREE.Mesh(opts.spark ? sparkGeo : bitGeo, mat);
      m.position.copy(at);
      set.add(m);
      const dir = new THREE.Vector3(Math.random() - 0.5, (opts.up ?? 0.6) + Math.random() * 0.6, Math.random() - 0.5).normalize();
      bits.push({ m, v: dir.multiplyScalar(speed * (0.6 + Math.random() * 0.6)), life: opts.spark ? 1.2 : 99, settle: !!opts.settle });
    }
  };
  const tickBits = (dt: number) => {
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i];
      b.life -= dt;
      if (b.life <= 0) {
        set.remove(b.m);
        bits.splice(i, 1);
        continue;
      }
      if (b.m.position.y <= 0.03 && b.settle) continue; // confetti stays where it lands
      b.v.y -= (b.settle ? 3.5 : 9) * dt;
      if (b.settle) b.v.multiplyScalar(1 - 1.8 * dt); // flutter
      b.m.position.addScaledVector(b.v, dt);
      b.m.rotation.x += dt * 7;
      b.m.rotation.z += dt * 5;
      if (b.m.position.y < 0.03) {
        b.m.position.y = 0.03;
        b.m.rotation.set(-Math.PI / 2, 0, Math.random() * 6);
      }
    }
  };
  const box = (w: number, h: number, d: number, color: number, parent: THREE.Object3D = set) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    parent.add(m);
    return m;
  };
  const dummy = (color: number, scale = 0.9) => {
    const d = createAsset('dummy') as THREE.Group;
    d.scale.setScalar(scale);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
    d.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name !== 'head') o.material = mat;
    });
    set.add(d);
    return d;
  };

  // Per-step state that the frame loop animates.
  let secondButton: THREE.Group | null = null;
  const cannons: THREE.Object3D[] = [];
  let cannonT = 0;
  const choir: THREE.Group[] = [];
  let choirRise = 0;
  let fireworks = false;
  let fireworkT = 0;
  let smoke = 0; // fog density target
  let horse: THREE.Group | null = null;
  const horseTo = new THREE.Vector3();
  let truck: THREE.Group | null = null;
  let truckZ = -8.2;
  const shards: { m: THREE.Mesh; v: THREE.Vector3; spin: number }[] = [];
  let bigBtn: SpawnedButton | null = null;
  let bigDrop = -1; // the bigger button's descent (y above floor), -1 = not yet
  let cable: THREE.Mesh | null = null;
  let rotor = 0;
  const band: THREE.Group[] = [];
  let bandT = 0;
  const flames: THREE.Mesh[] = [];
  let orderBtn: SpawnedButton | null = null;

  const STEPS: Step[] = [
    // 1. A second button, free.
    () => {
      secondButton = makeMiniButton(0xff2fa0);
      secondButton.scale.setScalar(2.2);
      secondButton.position.set(0.62, 0.12, 0);
      table.add(secondButton);
    },
    // 2. Steak knives (and one set for you).
    () => {
      const stand = box(0.5, 0.9, 0.5, 0x2a1a10);
      stand.position.set(-0.9, 0.45, -2.1);
      const block = box(0.3, 0.3, 0.2, 0x7a4a24);
      block.position.set(-0.9, 1.05, -2.1);
      for (let i = 0; i < 5; i++) {
        const blade = box(0.02, 0.28, 0.06, 0xdcdce4);
        blade.position.set(-1.02 + i * 0.06, 1.3, -2.1);
      }
      spawnKnives(new THREE.Vector3(-0.55, 0.95, -2.1));
    },
    // 3. The price drops (and drops).
    () => {
      oldPrice = '£199.99';
      price = '£99.99';
      drawScreen();
      ctx.after(1400, () => {
        oldPrice = '£99.99';
        price = '£19.99';
        drawScreen();
        tone({ type: 'square', from: 1320, dur: 0.12, gain: 0.08 });
        tone({ type: 'square', from: 1760, dur: 0.25, gain: 0.08 });
      });
    },
    // 4. Confetti cannons.
    () => {
      for (const x of [-4.6, 3.2]) {
        const c = new THREE.Group();
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0xffe600, metalness: 0.5, roughness: 0.3 }));
        barrel.rotation.x = -0.5;
        barrel.position.y = 0.6;
        c.add(barrel);
        c.position.set(x, 0, -4.9);
        set.add(c);
        cannons.push(c);
      }
      cannonT = 0;
    },
    // 5. A choir, rising on risers stage right.
    () => {
      for (let i = 0; i < 5; i++) {
        const d = dummy(0x5a1a8a, 0.85);
        d.position.set(0.9 + i * 0.75, -1.8, -5.25);
        choir.push(d);
      }
      choirRise = 0;
    },
    // 6. The gospel key change.
    () => {
      key += 2;
      loud = 1.3;
      pink.intensity = cyan.intensity = 24;
    },
    // 7. Indoor fireworks.
    () => {
      fireworks = true;
    },
    // 8. The smoke machine.
    () => {
      smoke = 1;
      ctx.scene.fog = new THREE.Fog(0xd9a8e8, 1.5, 22);
    },
    // 9. A horse.
    () => {
      horse = makeHorse();
      horse.position.set(-4.5, 0, 3.8);
      horseTo.set(0, 0, 2);
      tone({ type: 'sawtooth', from: 700, to: 300, dur: 0.6, gain: 0.07 }); // neigh
      tone({ type: 'sawtooth', from: 900, to: 500, dur: 0.4, gain: 0.05, attack: 0.1 });
    },
    // 10. A monster truck through the backdrop.
    () => {
      truck = makeTruck();
      truckZ = -8.2;
      truck.position.set(-3.4, 0, truckZ);
    },
    // 11. The price goes negative: they pay you.
    () => {
      oldPrice = '£19.99';
      price = '-£500.00';
      drawScreen();
      spawnMoney(ctx, new THREE.Vector3(0.9, 0.12, -1.5));
      for (let i = 0; i < 3; i++) spawnCoin(ctx, new THREE.Vector3(-0.4 + i * 0.35, 0.03, -1.4));
      sparkle();
    },
    // 12. A helicopter lowers a bigger button through the roof.
    () => {
      bigDrop = H - 0.2;
      cable = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 6), new THREE.MeshStandardMaterial({ color: 0x222222 }));
      set.add(cable);
    },
    // 13. A marching band.
    () => {
      for (let i = 0; i < 6; i++) {
        const d = dummy(i % 2 ? 0xc01a1a : 0xe8e2d0, 0.85);
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
        drum.rotation.x = Math.PI / 2;
        drum.position.set(0, 1.0, 0.3);
        d.add(drum);
        band.push(d);
      }
    },
    // 14. The host weeps with joy.
    () => {
      crying = true;
      tone({ type: 'sine', from: 520, to: 380, dur: 1.2, gain: 0.05, attack: 0.1 });
    },
    // 15. The studio catches fire. ORDER NOW.
    () => {
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xff7a18, transparent: true, opacity: 0.85 });
      const flameGeo = new THREE.ConeGeometry(0.28, 0.9, 7);
      const spots: [number, number][] = [[-4.6, -5.6], [-2.8, -5.5], [-0.8, -5.6], [1.2, -5.5], [3.3, -5.6], [4.8, -4.2], [-4.9, -3.2], [4.9, -0.2]];
      for (const [x, z] of spots) {
        const f = new THREE.Mesh(flameGeo, flameMat);
        f.position.set(x, 0.45, z);
        set.add(f);
        flames.push(f);
      }
      orderBtn = spawnPedestalButton(root, ORDER, () => placeOrder());
      solid(orderBtn.obstacle);
      const sign = canvasTex(512, 128, (g) => {
        g.fillStyle = '#ffe600';
        g.fillRect(0, 0, 512, 128);
        g.fillStyle = '#c00';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        fit(g, 'ORDER NOW', (px) => `900 ${px}px ${FONT_SIGN}`, 470, 96);
        g.fillText('ORDER NOW', 256, 68);
      });
      const s = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshBasicMaterial({ map: sign.tex }));
      s.position.set(ORDER.x, 1.75, ORDER.z);
      set.add(s);
      finale = true;
    },
  ];

  // ── The escalation ──
  const runStep = (quiet = false) => {
    if (step >= STEPS.length) return;
    const i = step;
    step++;
    idleT = 0;
    STEPS[i]();
    hostHype = 2.5;
    cheer = 2;
    applause(0.14 + i * 0.012, 1.6);
    if (!quiet) {
      whoosh();
      ctx.narrate(STEP_LINES[i], 7000, { priority: true });
    }
  };
  function onProductPress(): void {
    if (done) {
      ctx.advance(PRODUCT.clone());
      return;
    }
    if (pressCool > 0 || finale) return;
    pressCool = PRESS_COOLDOWN;
    runStep();
  }

  function placeOrder(): void {
    if (done || !orderBtn) return;
    done = true;
    discover('reward:but-wait');
    silent = true;
    // A phone rings. Twice. Then a very calm voice.
    for (let r = 0; r < 2; r++) {
      ctx.after(r * 900, () => {
        tone({ type: 'sine', from: 440, dur: 0.35, gain: 0.08 });
        tone({ type: 'sine', from: 480, dur: 0.35, gain: 0.06 });
      });
    }
    ctx.after(1900, () => {
      strike();
      ctx.narrate(ORDER_LINE, 8000, { priority: true });
      ctx.after(9000, () => ctx.narrate(AFTER_ORDER, 7000));
    });
  }

  // Strike the set: everything goes, all at once. Just you and the button.
  function strike(): void {
    alive = false;
    root.remove(set);
    for (const o of obstacles) if (o !== product.obstacle) ctx.removeObstacle(o);
    if (orderBtn) {
      unregisterInteractable(orderBtn.interactable.id);
      root.remove(orderBtn.group);
    }
    if (bigBtn) {
      unregisterInteractable(bigBtn.interactable.id);
      root.remove(bigBtn.group);
    }
    ctx.scene.fog = null;
    ctx.scene.background = new THREE.Color(0xf4f4f2);
    unregisterInteractable('infomercial-phone');
    thud();
  }

  // ── The CALL NOW phone (payment desk) ──
  const phoneDesk = box(0.7, 1.0, 0.5, 0xffe600);
  phoneDesk.position.set(PHONE.x, 0.5, PHONE.z);
  const phoneBody = box(0.3, 0.08, 0.2, 0xc01a1a);
  phoneBody.position.set(PHONE.x, 1.05, PHONE.z);
  const handset = box(0.34, 0.06, 0.08, 0x8a0e0e);
  handset.position.set(PHONE.x, 1.13, PHONE.z - 0.04);
  const callSign = canvasTex(512, 128, (g) => {
    g.fillStyle = '#1a0a2a';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#1fd6d0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fit(g, 'CALL NOW', (px) => `900 ${px}px ${FONT_SIGN}`, 470, 90);
    g.fillText('CALL NOW', 256, 66);
  });
  const callMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshBasicMaterial({ map: callSign.tex }));
  callMesh.position.set(PHONE.x, 1.55, PHONE.z);
  callMesh.rotation.y = Math.PI / 2;
  set.add(callMesh);
  solid({ x: PHONE.x, z: PHONE.z, radius: 0.45 });
  let phoneCool = 0;
  let skipping = false;
  registerInteractable({
    id: 'infomercial-phone',
    position: new THREE.Vector3(PHONE.x, 1, PHONE.z),
    radius: 1.8,
    promptLabel: 'CALL',
    onUse: () => {
      if (phoneCool > 0 || done) return;
      phoneCool = 3;
      if (finale || skipping) {
        ctx.narrate(PHONE_LATE, 4000, { priority: true });
        return;
      }
      if (ctx.isHolding('premium-card')) {
        // Platinum: the whole remaining pitch at once, then ORDER NOW.
        skipping = true;
        discover('reward:platinum-pitch');
        ctx.narrate(PHONE_PREMIUM, 7000, { priority: true });
        sparkle();
        const left = STEPS.length - step;
        for (let i = 0; i < left; i++) ctx.after(1500 + i * 450, () => runStep(i < left - 1));
        return;
      }
      if (ctx.consumeHeld('coin') || ctx.isHolding('money')) {
        ctx.narrate(PHONE_CASH, 5000, { priority: true });
        spawnMoney(ctx, new THREE.Vector3(PHONE.x + 0.9, 0.12, PHONE.z));
        discover('mech:call-now');
        pop();
        return;
      }
      discover('mech:call-now');
      ctx.narrate(PHONE_IDLE, 4000, { priority: true });
    },
  });

  // ── The free gift: a presentation case of steak knives (throwable) ──
  function spawnKnives(at: THREE.Vector3): void {
    const g = new THREE.Group();
    const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.16), new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.4 }));
    g.add(caseMesh);
    for (let i = 0; i < 4; i++) {
      const k = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.022), new THREE.MeshStandardMaterial({ color: 0xe6e6ee, metalness: 0.8, roughness: 0.2 }));
      k.position.set(0, 0.032, -0.05 + i * 0.034);
      g.add(k);
    }
    g.position.copy(at);
    root.add(g); // not part of the set: it's yours, it survives the strike
    let said = false;
    const c: Carryable = {
      kind: 'steak-knives',
      object: g,
      persistent: true,
      heldDist: 0.5,
      heldDrop: 0.25,
      projectile: { radius: 0.12, restitution: 0.2, gravity: 16 },
      onGrab: () => {
        if (said) return;
        said = true;
        ctx.narrate(GIFT_GRAB, 4500, { interruptible: true });
      },
    };
    ctx.addCarryable(c);
  }

  // ── Props built on demand ──
  function makeHorse(): THREE.Group {
    const g = new THREE.Group();
    const brown = 0x7a4a24;
    const body = box(1.4, 0.55, 0.45, brown, g);
    body.position.y = 1.1;
    const neck = box(0.25, 0.6, 0.25, brown, g);
    neck.position.set(0.72, 1.45, 0);
    neck.rotation.z = -0.5;
    const head = box(0.5, 0.22, 0.22, brown, g);
    head.position.set(0.98, 1.72, 0);
    const mane = box(0.06, 0.5, 0.08, 0x1a1008, g);
    mane.position.set(0.6, 1.55, 0);
    mane.rotation.z = -0.5;
    for (const [x, z] of [[-0.55, -0.15], [-0.55, 0.15], [0.55, -0.15], [0.55, 0.15]]) {
      const leg = box(0.12, 0.85, 0.12, brown, g);
      leg.position.set(x, 0.42, z);
      leg.name = 'leg';
    }
    set.add(g);
    return g;
  }
  function makeTruck(): THREE.Group {
    const g = new THREE.Group();
    const bodyM = box(2.0, 0.9, 3.0, 0x1a7a2a, g);
    bodyM.position.y = 1.6;
    const cab = box(1.6, 0.7, 1.2, 0x1a7a2a, g);
    cab.position.set(0, 2.35, -0.4);
    const flame = box(2.02, 0.3, 1.6, 0xff7a18, g);
    flame.position.set(0, 1.5, 0.6);
    const tyreGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.5, 16);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
    for (const [x, z] of [[-1.1, -1.0], [1.1, -1.0], [-1.1, 1.0], [1.1, 1.0]]) {
      const t = new THREE.Mesh(tyreGeo, tyreMat);
      t.rotation.z = Math.PI / 2;
      t.position.set(x, 0.62, z);
      t.name = 'tyre';
      g.add(t);
    }
    g.rotation.y = 0; // front faces +z (into the studio)
    set.add(g);
    return g;
  }

  // ── The "before" clip: a black-and-white DOM film of a man failing to press a button ──
  function beforeClip(): void {
    if (typeof document === 'undefined' || !document.body) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:18%',
      'transform:translateX(-50%) rotate(-2deg)',
      'padding:10px',
      'background:#111',
      'border:3px solid #eee',
      'box-shadow:0 10px 40px rgba(0,0,0,0.6)',
      'filter:grayscale(1) contrast(1.35)',
      'z-index:25',
      'pointer-events:none',
    ].join(';');
    const cv = document.createElement('canvas');
    cv.width = 360;
    cv.height = 220;
    cv.style.cssText = 'display:block;width:360px;max-width:70vw;height:auto';
    wrap.appendChild(cv);
    document.body.appendChild(wrap);
    const g = cv.getContext('2d');
    let t = 0;
    let gone = false;
    const remove = () => {
      if (gone) return;
      gone = true;
      wrap.remove();
    };
    addUpdater((dt) => {
      if (gone) return true;
      t += dt;
      if (g) drawBefore(g, t);
      if (t > 4.2) {
        remove();
        return true;
      }
      return false;
    });
    setTimeout(remove, 6000); // backstop: the page overlay never outlives a level change
  }
  function drawBefore(g: CanvasRenderingContext2D, t: number): void {
    g.fillStyle = '#9a9a94';
    g.fillRect(0, 0, 360, 220);
    g.fillStyle = '#555';
    g.fillRect(0, 170, 360, 50);
    // the button, on a little table
    g.fillStyle = '#333';
    g.fillRect(250, 130, 60, 40);
    g.fillStyle = '#222';
    g.beginPath();
    g.arc(280, 128, 12, Math.PI, 0);
    g.fill();
    // a man walks up, reaches, misses, topples
    const walk = Math.min(1, t / 1.6);
    const x = 60 + walk * 150;
    const fall = t > 2.4 ? Math.min(1, (t - 2.4) / 0.5) : 0;
    g.save();
    g.translate(x, 170);
    g.rotate(fall * 1.45);
    g.strokeStyle = '#111';
    g.lineWidth = 5;
    g.beginPath();
    g.arc(0, -78, 12, 0, Math.PI * 2);
    g.moveTo(0, -66);
    g.lineTo(0, -30);
    g.moveTo(0, -30);
    g.lineTo(-12 + Math.sin(t * 9) * 8 * (1 - walk), 0);
    g.moveTo(0, -30);
    g.lineTo(12 - Math.sin(t * 9) * 8 * (1 - walk), 0);
    const reach = t > 1.6 ? Math.min(1, (t - 1.6) / 0.6) : 0;
    g.moveTo(0, -56);
    g.lineTo(26 + reach * 40, -50 + reach * 8);
    g.stroke();
    g.restore();
    // grain + caption
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 360, Math.random() * 220, 2, 2);
    g.fillStyle = '#fff';
    g.font = `bold 26px ${FONT_SIGN}`;
    g.fillText('BEFORE', 16, 36);
  }

  // ── The frame loop ──
  const truckFront = 1.5; // the truck's front bumper, ahead of its centre
  addUpdater((dt) => {
    pressCool -= dt;
    phoneCool -= dt;
    if (!alive) return true;
    // Nobody pressing: the host nudges (the product mid-pitch, ORDER NOW at the end).
    if (!done) {
      idleT += dt;
      if (idleT > 24) {
        idleT = 0;
        ctx.narrate(finale ? ORDER_HINT : PRESS_HINT, 5000);
      }
    }
    musicTick(dt);
    tickBits(dt);

    product.group.rotation.y += dt * 0.8; // the turntable, slowly selling
    table.rotation.y += dt * 0.8;
    flashT += dt;
    if (flashT > 0.5) {
      flashT = 0;
      flash = !flash;
      drawScreen();
    }
    const tt = performance.now() / 1000;
    pink.position.x = -3 + Math.sin(tt * 1.3) * 1.5;
    cyan.position.x = 3 + Math.cos(tt * 1.1) * 1.5;

    // The host: arm pumping while hyped; shaking while he cries.
    hostHype = Math.max(0, hostHype - dt);
    if (hostArm) hostArm.rotation.x = hostHype > 0 ? -1.8 + Math.sin(tt * 14) * 0.6 : -0.3;
    if (crying) {
      host.position.x = HOST.x + Math.sin(tt * 30) * 0.02;
      if (Math.random() < dt * 6) burst(new THREE.Vector3(host.position.x + 0.05, 1.65, host.position.z + 0.12), 1, 1.2, { spark: true, up: 0.2 });
    }
    // The audience: on their feet while cheering.
    cheer = Math.max(0, cheer - dt);
    for (let i = 0; i < audience.length; i++) audience[i].position.y = cheer > 0 ? Math.abs(Math.sin(tt * 9 + i)) * 0.18 : 0;

    // Confetti cannons fire in rounds.
    if (cannons.length) {
      cannonT -= dt;
      if (cannonT <= 0) {
        cannonT = 3.2;
        for (const c of cannons) burst(new THREE.Vector3(c.position.x, 1.1, c.position.z + 0.3), 28, 6.5, { settle: true, up: 1.2 });
        noise(0.25, 0.12, 900, 'lowpass');
      }
    }
    // The choir rises.
    if (choir.length && choirRise < 1) {
      choirRise = Math.min(1, choirRise + dt * 0.7);
      for (const d of choir) d.position.y = -1.8 + choirRise * 2.1;
    }
    for (let i = 0; i < choir.length; i++) choir[i].rotation.z = Math.sin(tt * 2 + i) * 0.06;
    // Indoor fireworks.
    if (fireworks) {
      fireworkT -= dt;
      if (fireworkT <= 0) {
        fireworkT = 1.1 + Math.random() * 0.8;
        burst(new THREE.Vector3(-3 + Math.random() * 6, H - 0.6, -4 + Math.random() * 4), 18, 4, { spark: true, up: -0.1 });
        noise(0.18, 0.1, 3000, 'highpass');
        tone({ type: 'sine', from: 1400, to: 200, dur: 0.3, gain: 0.03 });
      }
    }
    // Smoke thickens.
    if (smoke > 0 && ctx.scene.fog instanceof THREE.Fog) ctx.scene.fog.far = Math.max(9, ctx.scene.fog.far - dt * 1.5);
    // The horse wanders.
    if (horse) {
      const d = horseTo.clone().sub(horse.position);
      d.y = 0;
      if (d.length() < 0.3) horseTo.set(-3 + Math.random() * 5.5, 0, -0.8 + Math.random() * 4.5);
      else {
        d.normalize();
        horse.position.addScaledVector(d, dt * 0.9);
        horse.rotation.y = Math.atan2(-d.z, d.x);
        horse.children.forEach((c, i) => {
          if (c.name === 'leg') c.rotation.z = Math.sin(tt * 8 + i * 1.7) * 0.35;
        });
      }
    }
    // The truck bursts through the backdrop, parks, revs.
    if (truck) {
      if (truckZ < -4.2) {
        const before = truckZ + truckFront;
        truckZ = Math.min(-4.2, truckZ + dt * 5);
        truck.position.z = truckZ;
        if (before < BACKDROP_Z && truckZ + truckFront >= BACKDROP_Z && backdrop.visible) smashBackdrop();
        truck.children.forEach((c) => {
          if (c.name === 'tyre') c.rotation.x += dt * 9;
        });
        if (truckZ >= -4.2) {
          for (const z of [-5.4, -4.2, -3.0]) solid({ x: -3.4, z, radius: 1.1 });
          thud();
        }
      }
      if (Math.random() < dt * 0.8) tone({ type: 'sawtooth', from: 70, to: 140, dur: 0.5, gain: 0.05 });
    }
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      if (s.m.position.y <= 0.05) continue;
      s.v.y -= 9 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.spin * dt;
      if (s.m.position.y < 0.05) s.m.position.y = 0.05;
    }
    // The bigger button comes down through the roof on a cable.
    if (bigDrop >= 0 && !bigBtn) {
      rotor += dt;
      if (Math.random() < dt * 12) noise(0.06, 0.07, 400, 'lowpass'); // chop chop chop
      bigDrop = Math.max(0, bigDrop - dt * 1.1);
      if (cable) {
        const len = H - bigDrop;
        cable.scale.y = Math.max(0.01, len - 1.3);
        cable.position.set(BIG_BTN.x, bigDrop + 1.3 + (len - 1.3) / 2, BIG_BTN.z);
      }
      bigPreview.visible = true;
      bigPreview.position.set(BIG_BTN.x, bigDrop, BIG_BTN.z);
      if (bigDrop <= 0) {
        bigPreview.visible = false;
        bigBtn = spawnPedestalButton(root, BIG_BTN, () => onProductPress());
        bigBtn.group.scale.setScalar(1.5);
        solid({ x: BIG_BTN.x, z: BIG_BTN.z, radius: 0.7 });
        thud();
      }
    }
    // The marching band loops the stage.
    if (band.length) {
      bandT += dt * 0.35;
      for (let i = 0; i < band.length; i++) {
        const a = bandT - i * 0.45;
        const d = band[i];
        d.position.set(Math.cos(a) * 3.0, Math.abs(Math.sin(tt * 6 + i)) * 0.06, 1.2 + Math.sin(a) * 2.0);
        d.rotation.y = -a;
      }
    }
    // Flames flicker.
    for (let i = 0; i < flames.length; i++) {
      const f = flames[i];
      f.scale.set(1 + Math.sin(tt * 11 + i) * 0.15, 1 + Math.sin(tt * 17 + i * 2) * 0.3, 1);
    }
    return false;
  });

  // The bigger button while it's still on the cable (a plain model; it becomes a
  // real, pressable button when it lands).
  const bigPreview = new THREE.Group();
  const bpPlinth = box(1.0, 1.35, 1.0, 0xd2d2cc, bigPreview);
  bpPlinth.position.y = 0.675;
  const bpDome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xcc1414, emissive: 0xff2a00, emissiveIntensity: 0.4 }));
  bpDome.position.y = 1.35;
  bigPreview.add(bpDome);
  bigPreview.visible = false;
  set.add(bigPreview);

  function smashBackdrop(): void {
    backdrop.visible = false;
    thud();
    noise(0.6, 0.2, 1500, 'lowpass');
    const mat = backdrop.material as THREE.MeshBasicMaterial;
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9 + Math.random() * 0.6, 0.7 + Math.random() * 0.6), mat);
      m.position.set(-3.4 + (Math.random() - 0.5) * 2.4, 0.6 + Math.random() * 2.2, BACKDROP_Z + 0.1);
      set.add(m);
      shards.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, 2 + Math.random() * 3), spin: (Math.random() - 0.5) * 8 });
    }
  }

  // ── Go ──
  ctx.narrate(INTRO, 6500, { priority: true });
  beforeClip();
  ctx.after(6800, () => {
    if (step === 0 && !done) {
      fanfare();
      ctx.narrate(INTRO_2, 6000);
    }
  });
}

/** Headless-test hooks. */
export const infomercialTest = { PRODUCT, ORDER, PHONE, BIG_BTN, steps: 15 };
