import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable, CombineEnv } from '../game/combine';
import { defineCombine } from '../game/combine';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { registerInteractable } from '../interactables/system';
import { spawnPedestalButton, type SpawnedButton } from '../button/pedestal-button';
import { spawnDuck } from '../objects/duck';
import { createAsset } from '../assets';
import { tone, noise, ensureAudio, click, sparkle, thud, pop } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { FONT_DISPLAY, FONT_SIGN } from '../ui/fonts';

// SCHRÖDINGER'S BOX — the white room stays, and becomes a clean physics lab. A
// steel box lands where the button was. In it, says the physicist narrating, is
// the button: pressed and not pressed at once, until somebody looks.
//
// Open the hatch and it collapses: already pressed (a dud), unpressed (press it:
// the way out), a cat, or nothing at all — the button has got OUT. Close the
// hatch, look AWAY, and it's back in superposition; watch the box the whole time
// and nothing can change.
//
// The rule of the room: things only change while nobody is looking. The lab
// props creep about when you turn away. The cat, once out, is never where you
// left it. And the loose button creeps up on you — but only while unobserved.
// Pressing it while you watch it doesn't count. Turn your back, be still, and it
// presses itself into you: pressed without being observed.
//
// A duck put in the box is in superposition too. It comes out alive, roasted, or
// both.

const BOX = new THREE.Vector3(0, 0, -2);
const BOX_W = 1.0;
const BOX_H = 0.9;
const HALF_X = CONFIG.ROOM.width / 2 - 0.7;
const HALF_Z = CONFIG.ROOM.depth / 2 - 0.7;
const LID_OPEN = -1.95; // lid rotation when open (hinged at the back edge)
const CREEP = 1.1; // m/s the loose button moves while unobserved
const CONTACT = 0.5 + CONFIG.PLAYER_RADIUS + 0.12; // its plinth against your back

type Contents = 'dud' | 'unpressed' | 'cat' | 'empty' | 'duck' | 'none';

const INTRO = vo('Welcome to the lab. In this box is the button. Until somebody looks, it is both pressed and not pressed. Please do not look. That is the experiment. Look anyway. Everybody does.');
const DUD = vo([
  'Pressed. Somebody has pressed it. Possibly you. Possibly later. Close the lid, look away, and let the universe reconsider.',
  'Pressed again. Close it. Look away. Properly away.',
  'Still pressed. I have a doctorate in this.',
  'Pressed. I will be honest with you. I do not understand quantum mechanics either.',
]);
const WATCHED = vo('You watched it the whole time. Nothing changes while you watch. That is rather the point.');
const UNPRESSED = vo('Unpressed. The wave function has collapsed in your favour. Press it before it changes its mind.');
const CAT = vo('A cat. There is a cat in the box. There was never supposed to be a cat. The cat is fine. The cat is furious.');
const CAT_TAP = vo(['The cat is alive. And dead. Mostly annoyed.', 'It blinked at you. In both states.', 'It is only here because you looked.']);
const CAT_MOVED = vo('The cat has moved. Nobody saw it move. Nobody ever does.');
const EMPTY = vo('Empty. The button is not in the box. The button is out. Somewhere in this room. Somewhere you are not looking.');
const FREE_SEEN = vo(['It knows you are looking.', 'You cannot press what you are observing. That is not a rule. It is just this button.', 'Not while you watch it.']);
const FREE_HINT = vo('It only moves when nobody is looking. Turn around. Be brave. Be very still.');
const BLIND = vo('You pressed it without observing it. It is both pressed and not pressed. Congratulations. You have broken physics.');
const BLIND_AFTER = vo('It has stopped moving. Observed, finally, and it does not mind. Turn round and press it the ordinary way.');
const BLIND_EXIT = vo('Pressed. Observed. One state. Physics is fine again. Probably.');
const PROP_MOVED = vo('Did that move? It did not move. Things in here only move when nobody is looking.');
const DUCK_IN = vo('The duck is in the box. The duck is now in superposition. Close the lid, and look away.');
const DUCK_CLOSED = vo('The box is closed. That is the entire point of the box.');
const DUCK_ALIVE = vo('A duck. Alive. Quacking in both states.');
const DUCK_COOKED = vo('A roast duck. The wave function collapsed at two hundred degrees.');
const DUCK_TWO = vo('Two ducks. It collapsed into both. I am writing this down. I am writing all of this down.');
const CLOSE_LID = vo(['Lid closed. Superposition restored. Probably.', 'Closed. Now look away. Somewhere else. Anywhere.']);

// The one live lab, so the global duck recipe can reach it.
let current: { insertDuck: (held: Carryable, env: CombineEnv) => boolean } | null = null;
defineCombine('duck', 'quantum-box', (held, _t, env) => (current ? current.insertDuck(held, env) : true));

function geiger(): void {
  noise(0.012, 0.07, 4200, 'highpass');
}
function meow(): void {
  ensureAudio();
  tone({ type: 'sine', from: 720, to: 980, dur: 0.12, gain: 0.07 });
  setTimeout(() => tone({ type: 'sine', from: 960, to: 520, dur: 0.3, gain: 0.07 }), 110);
}

function label(text: string[], w: number, h: number, font: string, fg: string, bg: string): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = Math.round((512 * h) / w);
  const g = cv.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lineH = cv.height / (text.length + 0.6);
  text.forEach((t, i) => {
    let px = Math.floor(lineH * 0.72);
    do g.font = `bold ${px}px ${font}`;
    while (g.measureText(t).width > cv.width * 0.88 && --px > 8);
    g.fillText(t, cv.width / 2, lineH * (i + 0.8));
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
}

export function revealSchrodinger(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the white room stays; its button sinks
  const cam = ctx.camera.position;
  // Clear of the box that lands where the button was.
  const away = Math.hypot(cam.x - BOX.x, cam.z - BOX.z);
  if (away < 1.4) {
    const k = away > 1e-3 ? 1.4 / away : 0;
    cam.x = away > 1e-3 ? BOX.x + (cam.x - BOX.x) * k : BOX.x;
    cam.z = away > 1e-3 ? BOX.z + (cam.z - BOX.z) * k : BOX.z + 1.4;
  }

  // ── Lab dressing: a hazard square round the box, a cool light over it ──
  const tape = new THREE.MeshStandardMaterial({ color: 0xe8c21a, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  for (const [w, d, x, z] of [
    [2.6, 0.1, 0, -0.75],
    [2.6, 0.1, 0, -3.25],
    [0.1, 2.6, -1.25, -2],
    [0.1, 2.6, 1.25, -2],
  ]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), tape);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    root.add(m);
  }
  const spot = new THREE.SpotLight(0xdff0ff, 1.4, 9, 0.5, 0.6, 1.2);
  spot.position.set(BOX.x, 3.4, BOX.z);
  spot.target.position.copy(BOX);
  root.add(spot, spot.target);

  // ── The box: bottom, four sides, a lid hinged at the back ──
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.75 });
  const box = new THREE.Group();
  box.position.copy(BOX);
  root.add(box);
  const T = 0.05;
  const panel = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), steel);
    m.position.set(x, y, z);
    m.castShadow = true;
    box.add(m);
  };
  panel(BOX_W, T, BOX_W, 0, T / 2, 0);
  panel(BOX_W, BOX_H, T, 0, BOX_H / 2, -BOX_W / 2 + T / 2);
  panel(BOX_W, BOX_H, T, 0, BOX_H / 2, BOX_W / 2 - T / 2);
  panel(T, BOX_H, BOX_W - 2 * T, -BOX_W / 2 + T / 2, BOX_H / 2, 0);
  panel(T, BOX_H, BOX_W - 2 * T, BOX_W / 2 - T / 2, BOX_H / 2, 0);
  const lid = new THREE.Group();
  lid.position.set(0, BOX_H, -BOX_W / 2);
  const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(BOX_W + 0.04, T, BOX_W + 0.04), steel);
  lidMesh.position.set(0, T / 2, BOX_W / 2);
  lid.add(lidMesh);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5 }));
  handle.position.set(0, T + 0.02, BOX_W - 0.08);
  lid.add(handle);
  box.add(lid);
  const stencil = label(['SPECIMEN 1: THE BUTTON', 'DO NOT OBSERVE'], 0.8, 0.3, FONT_SIGN, '#1b1d20', '#c9ced3');
  stencil.position.set(0, 0.5, BOX_W / 2 + 0.012);
  box.add(stencil);
  const boxObstacle = { x: BOX.x, z: BOX.z, radius: 0.75 };
  ctx.addObstacle(boxObstacle);

  // The button inside, on a short stand so it shows over the rim.
  const inner = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.55, 12), steel);
  stand.position.y = 0.3;
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.07, 20), new THREE.MeshStandardMaterial({ color: 0x3a3a3e, metalness: 0.7, roughness: 0.4 }));
  housing.position.y = 0.6;
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xcc1414, roughness: 0.45, emissive: 0xff2a00, emissiveIntensity: 0.4 });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
  dome.scale.y = 0.5;
  dome.position.y = 0.635;
  inner.add(stand, housing, dome);
  inner.visible = false;
  box.add(inner);
  const showInner = (pressed: boolean) => {
    inner.visible = true;
    dome.position.y = pressed ? 0.6 : 0.635;
    domeMat.color.set(pressed ? 0x5a2020 : 0xcc1414);
    domeMat.emissiveIntensity = pressed ? 0 : 0.4;
  };

  // Drop in from the ceiling.
  box.position.y = 3.0;
  let dropT = 0;
  addUpdater((dt) => {
    dropT += dt;
    const k = Math.min(1, dropT / 0.6);
    box.position.y = 3.0 * (1 - k * k);
    if (k >= 1) {
      thud();
      return true;
    }
    return false;
  });

  // ── Observation ──
  const frustum = new THREE.Frustum();
  const pm = new THREE.Matrix4();
  const bb = new THREE.Box3();
  const seen = (o: THREE.Object3D) => {
    bb.setFromObject(o);
    return !bb.isEmpty() && frustum.intersectsBox(bb);
  };
  const seenPoint = (x: number, z: number) => frustum.containsPoint(new THREE.Vector3(x, 0.6, z));
  // A random floor spot in the room, clear of the box and at least `minD` from you,
  // preferring one you aren't looking at.
  const hiddenSpot = (minD: number): THREE.Vector3 => {
    const pl = ctx.playerPos();
    let best: THREE.Vector3 | null = null;
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() * 2 - 1) * HALF_X;
      const z = (Math.random() * 2 - 1) * HALF_Z;
      if (Math.hypot(x - BOX.x, z - BOX.z) < 1.6 || Math.hypot(x - pl.x, z - pl.z) < minD) continue;
      best = new THREE.Vector3(x, 0, z);
      if (!seenPoint(x, z)) return best;
    }
    return best ?? new THREE.Vector3(-HALF_X, 0, HALF_Z);
  };

  // ── State ──
  let open = false;
  let busy = false;
  let leaving = false;
  let contents: Contents = 'none';
  let opens = 0;
  let duds = 0;
  let unobservedSinceClose = true;
  let duckInBox = false;
  let forced: Contents | null = null; // test hook
  let catOut: THREE.Group | null = null;
  let loose: SpawnedButton | null = null;

  const animateLid = (to: number, done: () => void) => {
    busy = true;
    const from = lid.rotation.x;
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      const k = Math.min(1, t / 0.45);
      lid.rotation.x = from + (to - from) * (1 - Math.pow(1 - k, 3));
      if (k < 1) return false;
      busy = false;
      done();
      return true;
    });
  };

  const roll = (): Contents => {
    if (forced) {
      const f = forced;
      forced = null;
      return f;
    }
    if (duckInBox) return 'duck';
    if (opens === 1) return 'dud';
    if (opens === 2 && !catOut) return 'cat';
    if (opens === 3 && !loose) return 'empty';
    const bag: [Contents, number][] = [['unpressed', 0.4], ['dud', 0.35]];
    if (!catOut) bag.push(['cat', 0.1]);
    if (!loose) bag.push(['empty', 0.15]);
    let r = Math.random() * bag.reduce((a, [, w]) => a + w, 0);
    for (const [c, w] of bag) if ((r -= w) <= 0) return c;
    return 'dud';
  };

  const openBox = () => {
    discover('mech:quantum-box');
    const reopen = !unobservedSinceClose && contents !== 'none' && contents !== 'cat' && contents !== 'empty' && contents !== 'duck';
    if (!reopen) {
      opens++;
      contents = roll();
    }
    open = true;
    click();
    animateLid(LID_OPEN, () => {
      if (reopen) {
        showInner(contents === 'dud');
        ctx.narrate(WATCHED, 5000, { priority: true });
        return;
      }
      inner.visible = false;
      if (contents === 'dud') {
        showInner(true);
        ctx.narrate(DUD[Math.min(duds, DUD.length - 1)], 6000, { priority: true });
        duds++;
      } else if (contents === 'unpressed') {
        showInner(false);
        sparkle();
        ctx.narrate(UNPRESSED, 5000, { priority: true });
      } else if (contents === 'cat') {
        releaseCat();
        ctx.narrate(CAT, 7000, { priority: true });
      } else if (contents === 'empty') {
        releaseLoose();
        ctx.narrate(EMPTY, 7000, { priority: true });
      } else if (contents === 'duck') {
        duckInBox = false;
        resolveDuck();
      }
    });
  };

  const closeBox = (line = true) => {
    open = false;
    unobservedSinceClose = false;
    click();
    animateLid(0, () => {
      inner.visible = false;
      if (line) ctx.narrate(CLOSE_LID[Math.floor(Math.random() * CLOSE_LID.length)], 3500, { interruptible: true });
    });
  };

  registerInteractable({
    id: 'schrodinger-box',
    position: new THREE.Vector3(BOX.x, 0.9, BOX.z),
    radius: 1.9,
    promptLabel: 'OPEN',
    onUse: () => {
      if (busy || leaving) return;
      if (!open) return openBox();
      if (contents === 'unpressed') {
        // The way out: press it while it's unpressed.
        leaving = true;
        showInner(true);
        click();
        sparkle();
        ctx.after(900, () => ctx.advance(BOX.clone()));
        return;
      }
      closeBox();
    },
  });

  // ── The cat: out of the box, never where you left it ──
  let catTaps = 0;
  let catMovedSaid = false;
  const releaseCat = () => {
    discover('reward:the-cat');
    meow();
    const cat = new THREE.Group();
    const fur = new THREE.MeshStandardMaterial({ color: 0xd98a3a, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), fur);
    body.scale.set(1, 0.8, 1.5);
    body.position.y = 0.17;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), fur);
    head.position.set(0, 0.34, 0.2);
    const earGeo = new THREE.ConeGeometry(0.04, 0.08, 8);
    const earL = new THREE.Mesh(earGeo, fur);
    earL.position.set(-0.06, 0.45, 0.2);
    const earR = earL.clone();
    earR.position.x = 0.06;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.35, 8), fur);
    tail.position.set(0, 0.3, -0.28);
    tail.rotation.x = -0.5;
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2a6a2a });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat);
    eyeL.position.set(-0.04, 0.36, 0.3);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.04;
    cat.add(body, head, earL, earR, tail, eyeL, eyeR);
    cat.position.set(BOX.x + 0.9, 0, BOX.z + 0.6);
    root.add(cat);
    catOut = cat;
    const it = {
      id: 'quantum-cat',
      position: cat.position.clone().setY(0.3),
      radius: 1.4,
      promptLabel: 'PET',
      onUse: () => {
        meow();
        ctx.narrate(CAT_TAP[catTaps++ % CAT_TAP.length], 3500, { interruptible: true });
      },
    };
    registerInteractable(it);
    let unseenT = 0;
    let wasSeen = true;
    let moved = false;
    addUpdater((dt) => {
      if (!cat.parent) return true;
      const pl = ctx.playerPos();
      cat.rotation.y = Math.atan2(pl.x - cat.position.x, pl.z - cat.position.z);
      if (seen(cat)) {
        if (moved && !catMovedSaid) {
          catMovedSaid = true;
          ctx.narrate(CAT_MOVED, 4000, { interruptible: true });
        }
        moved = false;
        wasSeen = true;
        unseenT = 0;
        return false;
      }
      unseenT += dt;
      if (wasSeen && unseenT > 0.8) {
        wasSeen = false;
        const p = hiddenSpot(2);
        cat.position.set(p.x, 0, p.z);
        it.position.set(p.x, 0.3, p.z);
        moved = true;
      }
      return false;
    });
  };

  // ── The loose button: creeps while unobserved; can't be pressed while watched ──
  let seenTries = 0;
  let blindPressing = false; // its own press, against your back
  let blindDone = false; // it has pressed itself: now it holds still
  const releaseLoose = () => {
    discover('mech:loose-button');
    const at = hiddenSpot(4);
    const b = spawnPedestalButton(root, at, () => {
      if (leaving || blindPressing) return;
      if (blindDone) {
        // After the blind press it holds still: an ordinary button, the way out.
        leaving = true;
        sparkle();
        ctx.narrate(BLIND_EXIT, 4000, { priority: true });
        ctx.after(2600, () => ctx.advance(b.group.position.clone()));
        return;
      }
      // Pressing it means facing it: observed. It won't have it.
      ctx.narrate(FREE_SEEN[seenTries % FREE_SEEN.length], 3500, { priority: true });
      seenTries++;
      if (seenTries === 2) ctx.after(3800, () => ctx.narrate(FREE_HINT, 5000));
      jump = true;
    });
    loose = b;
    ctx.addObstacle(b.obstacle);
    let jump = false;
    let unseenT = 0;
    addUpdater((dt) => {
      if (leaving || blindDone || !b.group.parent) return true;
      const g = b.group.position;
      if (seen(b.group)) {
        unseenT = 0;
        return false;
      }
      unseenT += dt;
      if (jump && unseenT > 0.3) {
        jump = false;
        const p = hiddenSpot(4);
        g.set(p.x, 0, p.z);
      }
      const pl = ctx.playerPos();
      const dx = pl.x - g.x;
      const dz = pl.z - g.z;
      const d = Math.hypot(dx, dz);
      if (d > CONTACT) {
        const step = Math.min(d - CONTACT + 0.02, CREEP * dt);
        g.x += (dx / d) * step;
        g.z += (dz / d) * step;
      } else if (unseenT > 0.3) {
        blindPress(b);
      }
      b.obstacle.x = g.x;
      b.obstacle.z = g.z;
      b.interactable.position.set(g.x, 0, g.z);
      return false;
    });
  };
  // It presses itself into your back (the dome goes down), then holds still:
  // the exit is you turning round and pressing it.
  const blindPress = (b: SpawnedButton) => {
    if (leaving || blindDone) return;
    blindPressing = true;
    b.interactable.onUse();
    blindPressing = false;
    blindDone = true;
    discover('reward:unobserved');
    sparkle();
    ctx.narrate(BLIND, 7000, { priority: true });
    ctx.narrate(BLIND_AFTER, 5000);
  };

  // ── A duck in the box ──
  const resolveDuck = () => {
    discover('reward:quantum-duck');
    pop();
    const r = Math.random();
    const front = new THREE.Vector3(BOX.x, 0, BOX.z + 1.05);
    if (r < 0.45) {
      spawnDuck(ctx, front.x, front.z);
      ctx.narrate(DUCK_ALIVE, 4000, { priority: true });
    } else if (r < 0.9) {
      const cooked = createAsset('cooked-duck');
      cooked.position.set(front.x, 0.2, front.z);
      root.add(cooked);
      ctx.addCarryable({
        kind: 'cooked-duck',
        object: cooked,
        persistent: true,
        heldDist: 0.7,
        heldDrop: 0.3,
        projectile: { radius: 0.22, restitution: 0.4, gravity: 14 },
      });
      ctx.narrate(DUCK_COOKED, 5000, { priority: true });
    } else {
      spawnDuck(ctx, front.x - 0.35, front.z);
      spawnDuck(ctx, front.x + 0.35, front.z);
      ctx.narrate(DUCK_TWO, 6000, { priority: true });
    }
  };
  const boxTarget = { kind: 'quantum-box', position: new THREE.Vector3(BOX.x, 0.6, BOX.z), radius: 1.1 };
  ctx.addTarget(boxTarget);
  current = {
    insertDuck: (held, env) => {
      if (!open || busy) {
        ctx.narrate(DUCK_CLOSED, 3500, { priority: true });
        return true; // keep the duck
      }
      env.carry.removeCarryable(held);
      held.object.parent?.remove(held.object);
      duckInBox = true;
      closeBox(false);
      ctx.narrate(DUCK_IN, 5000, { priority: true });
      return false;
    },
  };

  // ── Lab props that creep when you look away ──
  interface Prop { g: THREE.Group; ob: { x: number; z: number; radius: number }; wasSeen: boolean; unseenT: number; moved: boolean }
  const props: Prop[] = [];
  const prop = (g: THREE.Group, x: number, z: number, radius: number) => {
    g.position.set(x, 0, z);
    root.add(g);
    const ob = { x, z, radius };
    ctx.addObstacle(ob);
    props.push({ g, ob, wasSeen: false, unseenT: 0, moved: false });
  };
  const grey = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.6, metalness: 0.3 });
  // A detector: a cabinet with a big dial.
  const detector = new THREE.Group();
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.5), grey);
  cab.position.y = 0.65;
  const dial = label(['QUANTUM', 'UNCERTAINTY', '0 ? ? ? 100'], 0.5, 0.4, FONT_DISPLAY, '#d8ffe0', '#12301c');
  dial.position.set(0, 1.0, 0.252);
  detector.add(cab, dial);
  prop(detector, -3.6, -4.2, 0.45);
  // A Geiger counter on a stool.
  const geig = new THREE.Group();
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.7, 12), grey);
  stool.position.y = 0.35;
  const gbox = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.2), new THREE.MeshStandardMaterial({ color: 0xe8c21a, roughness: 0.6 }));
  gbox.position.y = 0.79;
  const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 8), grey);
  wand.position.set(0.2, 0.85, 0);
  wand.rotation.z = 1.1;
  geig.add(stool, gbox, wand);
  prop(geig, 3.6, -3.8, 0.3);
  // A sign on a stand.
  const sign = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), grey);
  pole.position.y = 0.7;
  const board = label(['DO NOT', 'OBSERVE'], 0.6, 0.4, FONT_SIGN, '#ffffff', '#b3261e');
  board.position.set(0, 1.45, 0.02);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.02), grey);
  back.position.set(0, 1.45, 0);
  sign.add(pole, back, board);
  prop(sign, -3.2, 1.8, 0.25);

  let propSaid = false;
  let geigerT = 0;
  addUpdater((dt) => {
    // One frustum for everyone this frame.
    ctx.camera.updateMatrixWorld();
    pm.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    const pl = ctx.playerPos();

    if (!open && !seen(box)) unobservedSinceClose = true;

    // Geiger: faster near the box.
    const dBox = Math.hypot(pl.x - BOX.x, pl.z - BOX.z);
    geigerT -= dt * (1.5 + 10 * Math.max(0, 1 - dBox / 7));
    if (geigerT <= 0) {
      geigerT = 0.4 + Math.random() * 1.2;
      geiger();
    }

    for (const p of props) {
      const face = Math.atan2(pl.x - p.g.position.x, pl.z - p.g.position.z);
      if (seen(p.g)) {
        if (p.moved && !propSaid) {
          propSaid = true;
          discover('mech:observed-props');
          ctx.narrate(PROP_MOVED, 5000, { interruptible: true });
        }
        p.moved = false;
        p.wasSeen = true;
        p.unseenT = 0;
        continue;
      }
      p.unseenT += dt;
      if (!p.wasSeen || p.unseenT < 0.5) continue;
      p.wasSeen = false;
      if (Math.random() < 0.35) continue; // not every time
      // Creep toward you, face you — never too close, never onto the box.
      const dx = pl.x - p.g.position.x;
      const dz = pl.z - p.g.position.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(0.6 + Math.random() * 0.8, Math.max(0, d - 1.8));
      if (step <= 0.05) continue;
      const nx = THREE.MathUtils.clamp(p.g.position.x + (dx / d) * step, -HALF_X, HALF_X);
      const nz = THREE.MathUtils.clamp(p.g.position.z + (dz / d) * step, -HALF_Z, HALF_Z);
      if (Math.hypot(nx - BOX.x, nz - BOX.z) < 1.5) continue;
      p.g.position.set(nx, 0, nz);
      p.g.rotation.y = face;
      p.ob.x = nx;
      p.ob.z = nz;
      p.moved = true;
    }
    return leaving;
  });

  ctx.after(900, () => ctx.narrate(INTRO, 9000));

  schrodingerTest.force = (c) => {
    forced = c;
  };
  schrodingerTest.insertDuck = (held, env) => current?.insertDuck(held, env) ?? true;
  schrodingerTest.state = () => ({ open, busy, contents, opens, duds, catOut: !!catOut, loose: loose?.group.position.clone() ?? null, leaving, duckInBox, props: props.map((p) => p.g.position.clone()) });
}

/** Headless-test hooks. */
export const schrodingerTest: {
  force: (c: Contents) => void;
  state: () => unknown;
  insertDuck: (held: Carryable, env: CombineEnv) => boolean;
} = { force: () => {}, state: () => null, insertDuck: () => true };
