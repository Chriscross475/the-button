import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Interactable } from '../interactables/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { registerInteractable } from '../interactables/system';
import { spawnPedestalButton } from '../button/pedestal-button';
import { tone, noise, click, blip, pop, quack, trainHorn, sparkle } from '../audio/sfx';
import { playLevelMusic, type LevelMusic } from '../audio/music';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { spawnDuck } from '../objects/duck';
import { spawnCoin } from '../objects/coin';
import { spinnerSpeed } from '../objects/spinner';
import { setScriptHints } from '../objects/script';
import { FONT_SIGN, FONT_VOICE } from '../ui/fonts';

// CUSTOMER SUPPORT — the white room is an office: a desk, a chair, a poster, and
// a phone. Pick up the receiver and you're in the automated menu, chirpy and
// endless: 1 for ducks, 2 for existential dread, 3 for trains, 4 for billing,
// star to hear it all again. Every option is a small gag (a duck is actually
// dispatched; the dread dims the lights; the trains shake the desk). Nothing
// on the menu gets you anywhere.
//
// It never mentions ZERO. Press it (from anywhere, any time) and you're on hold
// for the next available human — who, when he finally picks up, is the narrator.
// There are no other humans. He tells you there's a button behind you; there is.
//
// Hold music: public/hold-music.mp3 if it exists (a synthesised, tinny loop if
// not). It sits quietly under the room and comes up while you're on hold.

const { width: W, depth: D } = CONFIG.ROOM; // 11 × 13
const DESK = new THREE.Vector3(0, 0, -2.6);
const DESK_TOP = 0.76;
const MUSIC_VOL = 0.2;
const HOLD_SECS = 9; // on hold before the human picks up

// The automated menu (chirpy, formal) …
const MAIN = vo('Thank you for calling The Button. Your call is important to us. For ducks, press one. For existential dread, press two. For trains, press three. For billing, press four. To hear these options again, press star.');
const DUCKS = vo('You have selected: ducks. For your ducks, press one. For somebody else\'s ducks, press two. To receive a duck, now, press three. To return to the main menu, press hash.');
const DUCK_MINE = vo('Your ducks are important to us. They have been placed on hold.');
const DUCK_THEIRS = vo('We are unable to discuss somebody else\'s ducks. Returning you to the main menu.');
const DUCK_NOW = vo('A duck has been dispatched. Thank you for choosing ducks.');
const DREAD = vo('You have selected: existential dread. Please hold.');
const DREAD_DONE = vo('Thank you for holding. Your dread has been escalated to a senior dread. Returning you to the main menu.');
const TRAINS = vo('Trains. Please stand clear of the keypad.');
const BILLING = vo('Billing. Your balance is: one button. For a refund, press one. To dispute, press any other key.');
const REFUND = vo('Your refund has been processed. Please collect your change from the desk. Returning you to the main menu.');
const REFUND_AGAIN = vo('You have already been refunded. We have a note. Returning you to the main menu.');
const N_REFUND = vo('It refunded you. In coins. On the desk. For a button you never bought. Take them before it notices.');
const N_SPUN = vo('The spinner. The hold is going faster. Everything that makes you wait is scared of it.');
const SCRIPT_NOTES = vo([
  'Page nine. Zero. Press zero, from any menu. It never says so. Everyone knows about zero.',
  'Page ten. Billing, then one, is a refund. In coins. It is the only thing in here that pays.',
]);
const DISPUTE = vo('Your dispute has been noted, and discarded. Returning you to the main menu.');
const INVALID = vo('That is not an option. That has never been an option.');
const RETURN = vo('Returning you to the main menu.');
const HOLD = vo('Please hold for the next available human. Your call is important to us. You are caller number: one.');
const HOLD_KEYS = vo('Please continue to hold. Pressing buttons will not make a human appear faster.');
const HOLD_IMPORTANT = vo('Your call is important to us. Your call is so important to us.');
// … and the narrator (dry).
const INTRO = vo('An office. A desk. A phone. Somewhere in this building, there is a human who can help you. Allegedly.');
const PICK_UP_FIRST = vo('It helps to pick up the phone first. I am told.');
const NO_ZERO = vo('It never mentions zero. It never mentions zero. Everyone knows about zero.');
const HUNG_UP = vo('You hung up. They will not call back. They never call back.');
const IDLE_PHONE = vo('The phone. On the desk. Pick up the receiver. It is the only thing in here that talks back.');
const HUMAN = vo('Hello. Yes. It is me. It was always going to be me. There are no other humans. What do you want. Fine. There is a button behind you. Press it, and please do not call again.');

// Keypad cells: 0–8 are 1–9, then * 0 #. 12 is the receiver.
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const RECEIVER = 12;
const DTMF_ROW = [697, 770, 852, 941];
const DTMF_COL = [1209, 1336, 1477];

type Menu = 'main' | 'ducks' | 'billing' | 'dread' | 'hold' | 'human' | 'done';

// Test hooks for the headless sim.
export const customerSupportTest: { press: (i: number) => void; menu: () => Menu | 'idle' } = {
  press: () => {},
  menu: () => 'idle',
};

export function revealCustomerSupport(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; the button sinks

  // ── The office ──
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.4, D - 0.4),
    new THREE.MeshStandardMaterial({ color: 0x5d6b7a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = 0.02;
  root.add(carpet);

  const desk = new THREE.Group();
  desk.position.copy(DESK);
  root.add(desk);
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.7 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x4a4d54, roughness: 0.6 });
  box(2.2, 0.06, 1.0, 0, DESK_TOP - 0.03, 0, wood, desk);
  for (const x of [-1.0, 1.0]) box(0.12, DESK_TOP - 0.06, 0.9, x, (DESK_TOP - 0.06) / 2, 0, grey, desk);
  box(2.0, 0.5, 0.04, 0, 0.45, -0.45, grey, desk); // modesty panel
  const solids: { x: number; z: number; radius: number }[] = [];
  const solid = (o: { x: number; z: number; radius: number }) => {
    ctx.addObstacle(o);
    solids.push(o);
  };
  // Anything solid that ends up over you (the desk, built where you stood; the
  // exit button) pushes you clear: overlapping an obstacle blocks every move.
  const unstick = () => {
    const c = ctx.camera.position;
    for (let pass = 0; pass < 4; pass++) {
      for (const o of solids) {
        const need = o.radius + CONFIG.PLAYER_RADIUS + 0.02;
        const d = Math.hypot(c.x - o.x, c.z - o.z);
        if (d >= need) continue;
        const nx = d > 1e-4 ? (c.x - o.x) / d : 0;
        const nz = d > 1e-4 ? (c.z - o.z) / d : 1;
        c.x = o.x + nx * need;
        c.z = o.z + nz * need;
      }
    }
  };
  for (const x of [-0.7, 0, 0.7]) solid({ x: DESK.x + x, z: DESK.z, radius: 0.55 });
  // A chair behind it (nobody in it) and a monitor that is off.
  box(0.5, 0.08, 0.5, 0, 0.48, -0.9, grey, desk);
  box(0.5, 0.6, 0.06, 0, 0.8, -1.12, grey, desk);
  solid({ x: DESK.x, z: DESK.z - 0.9, radius: 0.35 });
  unstick();
  box(0.7, 0.45, 0.05, -0.55, DESK_TOP + 0.3, -0.3, new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.3 }), desk);
  box(0.1, 0.1, 0.1, -0.55, DESK_TOP + 0.05, -0.3, grey, desk);

  // A poster on the back wall (framed, well off the wall's face).
  const posterCv = document.createElement('canvas');
  posterCv.width = 256;
  posterCv.height = 320;
  const pg = posterCv.getContext('2d')!;
  pg.fillStyle = '#e9e2cf';
  pg.fillRect(0, 0, 256, 320);
  pg.fillStyle = '#ffcc22';
  pg.beginPath();
  pg.ellipse(128, 150, 60, 44, 0, 0, Math.PI * 2);
  pg.fill();
  pg.beginPath();
  pg.arc(170, 104, 26, 0, Math.PI * 2);
  pg.fill();
  pg.fillStyle = '#ff8800';
  pg.fillRect(192, 100, 22, 10);
  pg.fillStyle = '#1a1a1a';
  pg.textAlign = 'center';
  const fit = (text: string, px: number, y: number) => {
    let s = px;
    do pg.font = `bold ${s}px ${FONT_VOICE}`;
    while (pg.measureText(text).width > 220 && --s > 10);
    pg.fillText(text, 128, y);
  };
  fit('HANG IN THERE', 30, 250);
  fit('your call is important to us', 16, 285);
  box(1.0, 1.24, 0.06, 2.8, 2.0, -D / 2 + 0.14, new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.7 }));
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.12), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(posterCv) }));
  poster.position.set(2.8, 2.0, -D / 2 + 0.2);
  root.add(poster);

  // Ceiling light panels (self-lit) + a light of our own the dread can dim.
  const lampOn = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  const lampOff = new THREE.MeshBasicMaterial({ color: 0x55534c });
  const lamps: THREE.Mesh[] = [];
  for (const z of [-3, 1.5]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.6), lampOn);
    p.rotation.x = Math.PI / 2;
    p.position.set(0, 3.5, z);
    root.add(p);
    lamps.push(p);
  }
  const office = new THREE.HemisphereLight(0xfff4e0, 0x6a6258, 0.45);
  root.add(office);

  // ── The phone: a chunky desk phone, keypad tilted toward you, receiver in its
  //    cradle on the left. ──
  const phone = new THREE.Group();
  phone.position.set(DESK.x + 0.25, DESK_TOP, DESK.z + 0.25);
  root.add(phone);
  const plastic = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.5 });
  box(0.62, 0.1, 0.42, 0, 0.05, 0, plastic, phone);
  const pad = new THREE.Group();
  pad.position.set(0.1, 0.11, 0.02);
  pad.rotation.x = 0.35; // far edge up: the keys face you
  phone.add(pad);
  const plate = box(0.3, 0.02, 0.36, 0, 0, 0, new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.6 }), pad);
  const keyTex = (label: string) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#e8e6df';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#1a1a1a';
    g.font = `bold 40px ${FONT_SIGN}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 32, 34);
    return new THREE.CanvasTexture(cv);
  };
  const keyMats: THREE.MeshStandardMaterial[] = [];
  const keyMeshes: THREE.Mesh[] = [];
  KEYS.forEach((label, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const top = new THREE.MeshStandardMaterial({ map: keyTex(label), roughness: 0.5 });
    const side = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.5 });
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.03, 0.065), [side, side, top, side, side, side]);
    k.position.set(-0.095 + col * 0.095, 0.02, -0.125 + row * 0.083);
    pad.add(k);
    keyMats.push(top);
    keyMeshes.push(k);
  });
  // The receiver, in its cradle along the left.
  const receiver = new THREE.Group();
  receiver.position.set(-0.2, 0.14, 0);
  phone.add(receiver);
  box(0.09, 0.07, 0.4, 0, 0, 0, plastic, receiver);
  box(0.11, 0.09, 0.1, 0, -0.01, -0.17, plastic, receiver);
  box(0.11, 0.09, 0.1, 0, -0.01, 0.17, plastic, receiver);
  const cord = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 16), plastic);
  cord.position.set(-0.25, 0.05, 0.22);
  cord.rotation.y = 1.2;
  phone.add(cord);

  // ── Aim: one interactable, claimed only while a key (or the receiver) is
  //    under the crosshair; the lit key is the prompt. ──
  const aim = new THREE.Raycaster();
  aim.far = 3;
  const CROSSHAIR = new THREE.Vector2(0, 0);
  const local = new THREE.Vector3();
  const pickables = [plate, ...keyMeshes, ...receiver.children];
  let sel = -1;
  const pick = (): number => {
    aim.setFromCamera(CROSSHAIR, ctx.camera);
    const hit = aim.intersectObjects(pickables, false)[0];
    if (!hit) return -1;
    if (receiver.children.includes(hit.object)) return RECEIVER;
    pad.worldToLocal(local.copy(hit.point));
    return keyMeshes.findIndex((k) => Math.abs(local.x - k.position.x) < 0.048 && Math.abs(local.z - k.position.z) < 0.042);
  };
  const use: Interactable = {
    id: 'support-phone',
    position: new THREE.Vector3(),
    radius: 2.4,
    promptLabel: '',
    onUse: () => press(sel),
  };
  registerInteractable(use);

  // ── Music ──
  let musicDown = false;
  const music: LevelMusic | null = playLevelMusic(root, 'hold-music.mp3', MUSIC_VOL, () => {
    // No file: a tinny, cheerful hold loop (square wave, through the updater pool).
    const tune = [659, 587, 523, 587, 659, 659, 659, 0, 587, 587, 587, 0, 659, 784, 784, 0];
    let i = 0;
    let acc = 0;
    addUpdater((dt) => {
      if (!root.parent) return true;
      acc += dt;
      if (acc < 0.26) return false;
      acc -= 0.26;
      const f = tune[i++ % tune.length];
      if (f && !musicDown) tone({ type: 'square', from: f, dur: 0.2, gain: 0.02 });
      return false;
    });
  });
  const duck = (down: boolean) => {
    musicDown = down;
    music?.duck(down);
  };

  // ── The line ──
  let onLine = false;
  let menu: Menu = 'main';
  let saidPickUp = false;
  let mainPlays = 0;
  let saidZero = false;
  let holdT = 0;
  let saidImportant = false;
  let dreadT = 0;
  let speakToken = 0;
  let saidHungUp = false;
  let idleT = 0;
  let saidIdle = false;

  // The menu talks: the music ducks under it and comes back after. `urgent`:
  // a direct reply to a key press cuts in at once; the automatic follow-ups
  // (the menu repeating, the hints, the human) queue behind whatever is still
  // being said, so no line gets cut off mid-sentence.
  const say = (line: string, ms: number, urgent = true) => {
    const token = ++speakToken;
    duck(true);
    ctx.narrate(line, ms, urgent ? { priority: true } : undefined);
    ctx.after(ms, () => {
      if (token === speakToken && menu !== 'hold') duck(false);
    });
  };
  const mainMenu = (urgent = true) => {
    menu = 'main';
    mainPlays++;
    say(MAIN, 11000, urgent);
    if (mainPlays === 2 && !saidZero) {
      saidZero = true;
      ctx.after(11200, () => {
        if (onLine && menu === 'main') ctx.narrate(NO_ZERO, 4500); // queued: after the menu finishes
      });
    }
  };
  const back = (line: string, ms: number) => {
    say(line, ms);
    ctx.after(ms + 200, () => {
      if (onLine && menu !== 'hold' && menu !== 'human' && menu !== 'done') mainMenu(false); // queued behind the reply
    });
    menu = 'main';
  };

  const dtmf = (i: number) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    tone({ type: 'sine', from: DTMF_ROW[row], dur: 0.14, gain: 0.07 });
    tone({ type: 'sine', from: DTMF_COL[col], dur: 0.14, gain: 0.07 });
  };
  const dialTone = () => {
    tone({ type: 'sine', from: 350, dur: 0.9, gain: 0.05 });
    tone({ type: 'sine', from: 440, dur: 0.9, gain: 0.05 });
  };
  const sinkKey = (i: number) => {
    const k = keyMeshes[i];
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      k.position.y = 0.02 - Math.sin(Math.min(1, t / 0.15) * Math.PI) * 0.012;
      return t >= 0.15;
    });
  };

  // In-room gags.
  const dispatchDuck = () => {
    const p = ctx.playerPos();
    const x = THREE.MathUtils.clamp(p.x + 1.2, -W / 2 + 1, W / 2 - 1);
    const z = THREE.MathUtils.clamp(p.z + 0.8, DESK.z + 1.2, D / 2 - 1);
    spawnDuck(ctx, x, z);
    pop();
    quack();
  };
  const shakeDesk = () => {
    trainHorn();
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      const k = Math.max(0, 1 - t / 1.2);
      desk.position.x = DESK.x + Math.sin(t * 60) * 0.02 * k;
      phone.position.x = DESK.x + 0.25 + Math.sin(t * 55) * 0.02 * k;
      return t >= 1.2;
    });
  };
  const setDread = (on: boolean) => {
    office.intensity = on ? 0.05 : 0.45;
    for (const l of lamps) l.material = on ? lampOff : lampOn;
    if (on) {
      tone({ type: 'sawtooth', from: 48, to: 44, dur: 5, gain: 0.05, attack: 0.8 });
      noise(5, 0.03, 180, 'lowpass');
    }
  };

  let exitMade = false;
  const humanPicksUp = () => {
    menu = 'human';
    duck(true);
    click();
    discover('reward:a-human');
    ctx.narrate(HUMAN, 9500); // queued: the hold lines finish first
    ctx.after(6500, () => {
      if (exitMade) return;
      exitMade = true;
      menu = 'done';
      // "There is a button behind you." There is: behind wherever you're facing,
      // kept inside the room and clear of the desk.
      const p = ctx.playerPos();
      const f = new THREE.Vector3();
      ctx.camera.getWorldDirection(f);
      f.y = 0;
      if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
      f.normalize();
      const at = new THREE.Vector3(
        THREE.MathUtils.clamp(p.x - f.x * 1.9, -W / 2 + 1, W / 2 - 1),
        0,
        THREE.MathUtils.clamp(p.z - f.z * 1.9, -D / 2 + 1, D / 2 - 1),
      );
      if (Math.hypot(at.x - DESK.x, at.z - DESK.z) < 2) at.z = DESK.z + 2.2;
      if (Math.hypot(at.x - p.x, at.z - p.z) < 1.2) at.x += at.x > 0 ? -1.4 : 1.4;
      const btn = spawnPedestalButton(root, at, () => ctx.advance(at), { glow: false });
      solid(btn.obstacle);
      unstick();
      sparkle();
      duck(false);
    });
  };

  const pickUp = () => {
    onLine = true;
    saidIdle = true;
    discover('mech:phone-menu');
    receiver.position.set(-0.2, 0.5, 0.25);
    receiver.rotation.set(-0.6, 0, 0.3);
    dialTone();
    ctx.after(900, () => {
      if (onLine && menu === 'main') mainMenu();
    });
  };
  const hangUp = () => {
    onLine = false;
    receiver.position.set(-0.2, 0.14, 0);
    receiver.rotation.set(0, 0, 0);
    click();
    speakToken++;
    duck(false);
    if (menu === 'dread') setDread(false);
    menu = 'main';
    holdT = 0;
    if (!saidHungUp) {
      saidHungUp = true;
      ctx.narrate(HUNG_UP, 4000, { priority: true });
    }
  };

  const press = (i: number) => {
    if (i === RECEIVER) {
      if (menu === 'human' || menu === 'done') return; // he's talking; you listen
      if (onLine) hangUp();
      else pickUp();
      return;
    }
    if (i < 0) return;
    sinkKey(i);
    dtmf(i);
    if (!onLine) {
      if (!saidPickUp) {
        saidPickUp = true;
        ctx.narrate(PICK_UP_FIRST, 3500, { priority: true });
      } else blip();
      return;
    }
    const key = KEYS[i];
    if (menu === 'human' || menu === 'done') return;
    if (menu === 'hold') {
      say(HOLD_KEYS, 4500);
      return;
    }
    // Zero works from anywhere. It is never mentioned.
    if (key === '0') {
      if (menu === 'dread') setDread(false);
      menu = 'hold';
      holdT = 0;
      saidImportant = false;
      speakToken++;
      ctx.narrate(HOLD, 7000, { priority: true });
      duck(false); // the hold music, up
      return;
    }
    if (menu === 'dread') return; // please hold (it ends by itself)
    if (key === '*') return menu === 'ducks' ? say(DUCKS, 9000) : menu === 'billing' ? say(BILLING, 7000) : mainMenu();
    if (key === '#') return back(RETURN, 2500);
    if (menu === 'main') {
      if (key === '1') {
        menu = 'ducks';
        say(DUCKS, 9000);
      } else if (key === '2') {
        menu = 'dread';
        dreadT = 0;
        say(DREAD, 3000);
        setDread(true);
      } else if (key === '3') {
        shakeDesk();
        back(TRAINS, 3000);
      } else if (key === '4') {
        menu = 'billing';
        say(BILLING, 7000);
      } else back(INVALID, 3500);
      return;
    }
    if (menu === 'ducks') {
      if (key === '1') back(DUCK_MINE, 4000);
      else if (key === '2') back(DUCK_THEIRS, 4500);
      else if (key === '3') {
        dispatchDuck();
        back(DUCK_NOW, 3500);
      } else back(INVALID, 3500);
      return;
    }
    if (menu === 'billing') {
      if (key === '1') {
        // A refund: three coins onto the desk, once.
        if (refunded) return back(REFUND_AGAIN, 4000);
        refunded = true;
        for (let i = 0; i < 3; i++) spawnCoin(ctx, new THREE.Vector3(DESK.x - 0.35 + i * 0.12, DESK_TOP + 0.01, DESK.z + 0.3));
        pop();
        back(REFUND, 5000);
        ctx.narrate(N_REFUND, 5000);
        return;
      }
      back(DISPUTE, 4500); // any other key is a dispute
    }
  };

  let refunded = false;
  let saidSpun = false;
  customerSupportTest.press = press;
  customerSupportTest.menu = () => (onLine ? menu : 'idle');

  // ── Per frame: aim, the dread's hold, the human's hold ──
  addUpdater((dt) => {
    const next = pick();
    if (next !== sel) {
      if (sel >= 0 && sel < 12) keyMats[sel].emissive.setHex(0x000000);
      sel = next;
      if (sel >= 0 && sel < 12) keyMats[sel].emissive.setHex(0x6a4a10);
    }
    use.promptLabel = sel >= 0 ? 'PRESS' : '';
    if (sel === RECEIVER) receiver.getWorldPosition(use.position);
    else if (sel >= 0) keyMeshes[sel].getWorldPosition(use.position);

    if (!onLine && !saidIdle && menu === 'main') {
      idleT += dt;
      if (idleT > 25) {
        saidIdle = true;
        ctx.narrate(IDLE_PHONE, 5000);
      }
    }
    if (menu === 'dread' && onLine) {
      dreadT += dt;
      if (dreadT > 5.5) {
        setDread(false);
        back(DREAD_DONE, 6500);
      }
    }
    if (menu === 'hold' && onLine) {
      // Hold time: shorter with the Spinner in hand.
      const sp = spinnerSpeed(ctx);
      if (sp > 1 && !saidSpun) {
        saidSpun = true;
        ctx.narrate(N_SPUN, 4500);
      }
      holdT += dt * sp;
      if (holdT > HOLD_SECS * 0.55 && !saidImportant) {
        saidImportant = true;
        ctx.narrate(HOLD_IMPORTANT, 3500); // queued: after the hold message
      }
      if (holdT > HOLD_SECS) humanPicksUp();
    }
    return false;
  });

  setScriptHints(SCRIPT_NOTES);
  ctx.narrate(INTRO, 6000);
}
