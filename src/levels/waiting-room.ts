import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { defineCombine } from '../game/combine';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { spawnPedestalButton } from '../button/pedestal-button';
import { registerInteractable } from '../interactables/system';
import { setCounter, hideCounter } from '../ui/counter';
import { tone, noise, ensureAudio, click, pop, quack, thud, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { playLevelMusic } from '../audio/music';
import { setYaw, setPitch, setEyeHeight } from '../controls/player-camera';
import { spinnerSpeed } from '../objects/spinner';
import { setScriptHints } from '../objects/script';
import { FONT_DISPLAY, FONT_SIGN, FONT_VOICE } from '../ui/fonts';

// THE WAITING ROOM — the white room, gone institutional: rows of plastic chairs,
// a potted plant, a water cooler, a counter behind glass with a clerk, and a
// NOW SERVING display. The ticket machine (a button, obviously) prints you 948.
// The display says 001.
//
// Number TWO is asleep in a chair, ticket on his lap — and the clerk will not
// call three until two comes up. So the whole building waits on him. Ways out:
//   • take the sleeping man's ticket (002) and present it at the counter;
//   • bribe the clerk (the money, if you carry it);
//   • throw a duck over the counter (a riot — in the confusion, you're served);
//   • or wait. The clerk eventually gives up on two, serves the three people
//     who are actually here, and then — with nobody holding 6 to 947 — calls
//     them anyway, faster and faster, until it halts on 948 and waits for you.
// Served, by any route: a stamp, and a button rises beside the counter.

const { width: W, depth: D } = CONFIG.ROOM; // 11 × 13
const COUNTER_Z = -D / 2 + 1.3; // the counter's customer face
const CLERK = new THREE.Vector3(0, 0, -D / 2 + 0.3); // behind the counter, against the wall
const MACHINE = new THREE.Vector3(3.6, 0, 2.6);
const EXIT_AT = new THREE.Vector3(3.2, 0, COUNTER_Z + 1.4);
const YOURS = 948;
const TWO_PATIENCE = 45; // s the clerk waits for number two before giving up
const NPC_CALL = 9; // s between the three real customers
const RUSH_START = 3; // s between empty numbers at first…
const RUSH_DECAY = 0.93; // …shrinking by this each call…
const RUSH_MIN = 0.06; // …down to this

const INTRO = vo('A waiting room. Take a number. Everyone here took a number. Some of them took it in nineteen eighty-seven.');
const FIRST_TICKET = vo('Nine hundred and forty-eight. We are on one. Get comfortable.');
const MORE_TICKET = vo('Nine hundred and forty-nine. You have made it worse.');
const NO_PAPER = vo('The machine is out of paper. It is always out of paper.');
const CALL_TWO = vo('Now serving: two. Number two. Anyone. Two.');
const TWO_ASLEEP = vo('Number two is asleep. Number two is holding up the entire building.');
const TWO_FORFEIT = vo('Two has forfeited. Two will be told, when two wakes up.');
const TOOK_TICKET = vo('You took a sleeping man\'s ticket. He will never know. You will.');
const SIT = vo('You sit. The chair is exactly as comfortable as it looks. The numbers do not go any faster.');
const SPUN = vo('The spinner. The numbers are going faster. The clerk has not noticed. The clerk has never noticed anything.');
const SCRIPT_NOTES = vo([
  'Page twelve. The sleeping man in the chair has ticket number two. On his lap. It is not stealing if he is asleep. It is stealing.',
  'Page thirteen. Or wait for all nine hundred and forty-seven. It speeds up. Eventually.',
]);
const NOT_YET = vo('That is not the number on the screen. Sit down.');
const SERVED_SWAP = vo('Two? You do not look like a two. The clerk does not care. Stamped.');
const SERVED_OWN = vo('Nine hundred and forty-eight. At last. The clerk stamps your form. You have aged.');
const BRIBE = vo('The clerk pockets it and stamps your form without looking up. The system works.');
const RIOT = vo('A duck, over the counter. Paperwork everywhere. The clerk is under the desk. In the confusion, you are served.');
const YOUR_TURN = vo('Nine hundred and forty-eight. That is you. That is actually you. Go.');
const YOUR_TURN_HINT = vo('The counter. Hold your ticket up to the glass. That is the whole procedure.');
const DESPAIR: [number, string][] = vo([
  [50, 'Fifty. Nine hundred to go. I have started a small garden in my mind.'],
  [200, 'Two hundred. The plant in the corner has grown. I think it is the same plant.'],
  [500, 'Five hundred. I remember the outside. It had weather.'],
  [800, 'Eight hundred. Nearly. Do not move. Do not breathe. It can smell hope.'],
]);

// ── Carried things meet the counter (global recipes; the live room wires them) ──
let counter: { present: (n: number) => void; bribe: () => void; riot: () => void } | null = null;
defineCombine('ticket', 'counter', (held, _t, env) => {
  if (!counter || served) return true;
  const n = (held.object.userData as { number?: number }).number ?? YOURS;
  counter.present(n);
  // A ticket that got you served is kept by the clerk; any other goes back in your pocket.
  if (served) {
    env.carry.removeCarryable(held);
    held.object.parent?.remove(held.object);
    return false;
  }
  return true;
});
defineCombine('money', 'counter', (held, _t, env) => {
  if (!counter || served) return true;
  env.carry.removeCarryable(held);
  held.object.parent?.remove(held.object);
  counter.bribe();
});
defineCombine('duck', 'counter', (held, _t, env) => {
  if (!counter || served) return true;
  env.carry.removeCarryable(held);
  held.object.parent?.remove(held.object); // over the counter it goes
  counter.riot();
});
let served = false;

/** Test hooks for the headless sim (the combine recipes call the same). */
export const waitingRoomTest = {
  present: (n: number) => counter?.present(n),
  bribe: () => counter?.bribe(),
  riot: () => counter?.riot(),
  isServed: () => served,
};

// ── Sounds ──
const chime = () => {
  ensureAudio();
  tone({ type: 'sine', from: 988, dur: 0.5, gain: 0.14 });
  window.setTimeout(() => tone({ type: 'sine', from: 784, dur: 0.8, gain: 0.14 }), 260);
};
const whirr = () => {
  ensureAudio();
  noise(0.45, 0.12, 2200, 'bandpass');
  tone({ type: 'square', from: 180, to: 140, dur: 0.4, gain: 0.04 });
};
const stamp = () => {
  ensureAudio();
  noise(0.08, 0.35, 900, 'lowpass');
  tone({ type: 'sine', from: 90, to: 50, dur: 0.18, gain: 0.3 });
};
const murmur = () => {
  ensureAudio();
  noise(1.6, 0.025, 400, 'lowpass');
};

export function revealWaitingRoom(ctx: GameContext): void {
  const root = ctx.levelRoot;
  served = false;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; the button sinks
  playLevelMusic(root, 'waiting-room.mp3', 0.25); // the waiting-room track, looping, until you leave

  // ── The room ──
  const lino = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ color: 0xb9b5a4, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  );
  lino.rotation.x = -Math.PI / 2;
  lino.position.y = 0.01;
  root.add(lino);
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    root.add(m);
    return m;
  };
  const beige = new THREE.MeshStandardMaterial({ color: 0xc9bfa6, roughness: 0.8 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x6d6f74, roughness: 0.6, metalness: 0.3 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0xd8702e, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe6ee, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false });

  // Counter + glass screen, across the back.
  box(6, 1.1, 0.8, 0, 0.55, COUNTER_Z - 0.4, beige);
  box(6, 0.06, 0.9, 0, 1.12, COUNTER_Z - 0.4, grey);
  box(6, 1.2, 0.03, 0, 1.75, COUNTER_Z - 0.4, glass);
  for (let x = -3; x <= 3; x += 0.5) ctx.addObstacle({ x, z: COUNTER_Z - 0.4, radius: 0.35 });
  ctx.addTarget({ kind: 'counter', position: new THREE.Vector3(0, 1, COUNTER_Z), radius: 2.4 });
  // The little slot under the glass (where things go over).
  box(0.8, 0.14, 0.05, 0, 1.2, COUNTER_Z - 0.39, new THREE.MeshStandardMaterial({ color: 0x2a2a2e }));

  // The clerk: the jointed dummy, in a tie and a lanyard.
  const clerk = createAsset('dummy') as THREE.Group;
  clerk.position.copy(CLERK);
  root.add(clerk);
  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.02), new THREE.MeshStandardMaterial({ color: 0x8a1c1c }));
  tie.position.set(0, 1.05, 0.15);
  clerk.add(tie);
  const lanyard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a6fd0 }));
  lanyard.position.set(0.14, 0.95, 0.16);
  clerk.add(lanyard);
  const clerkHead = clerk.getObjectByName('head') as THREE.Object3D;
  const clerkArmR = clerk.getObjectByName('armR') as THREE.Object3D;

  // NOW SERVING display on the back wall.
  const dispCv = document.createElement('canvas');
  dispCv.width = 512;
  dispCv.height = 192;
  const dg = dispCv.getContext('2d')!;
  const dispTex = new THREE.CanvasTexture(dispCv);
  // Well clear of the back wall's inner face (at −D/2 + 0.06 — coplanar with
  // it, the two z-fought), on a dark frame of its own.
  const dispFrame = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.25, 0.08), new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.6 }));
  dispFrame.position.set(0, 2.85, -D / 2 + 0.14);
  root.add(dispFrame);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.05), new THREE.MeshBasicMaterial({ map: dispTex }));
  disp.position.set(0, 2.85, -D / 2 + 0.22);
  root.add(disp);
  const drawDisplay = (n: number) => {
    dg.fillStyle = '#0b0c0f';
    dg.fillRect(0, 0, 512, 192);
    dg.fillStyle = '#9fb3c8';
    dg.font = `bold 30px ${FONT_DISPLAY}`;
    dg.textAlign = 'center';
    dg.textBaseline = 'middle';
    dg.fillText('NOW SERVING', 256, 34);
    dg.fillStyle = '#ff3b2e';
    dg.font = `bold 110px ${FONT_DISPLAY}`;
    dg.fillText(String(n).padStart(3, '0'), 256, 122);
    dispTex.needsUpdate = true;
  };

  // "TAKE A NUMBER" sign + the ticket machine: a red post with a button on top.
  const signCv = document.createElement('canvas');
  signCv.width = 256;
  signCv.height = 64;
  const sg = signCv.getContext('2d')!;
  sg.fillStyle = '#f2f2ee';
  sg.fillRect(0, 0, 256, 64);
  sg.fillStyle = '#1a1a1a';
  sg.font = `bold 30px ${FONT_SIGN}`;
  sg.textAlign = 'center';
  sg.textBaseline = 'middle';
  sg.fillText('TAKE A NUMBER', 128, 34);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(signCv) }));
  sign.position.set(MACHINE.x, 1.75, MACHINE.z + 0.16);
  root.add(sign);
  box(0.14, 1.0, 0.14, MACHINE.x, 0.5, MACHINE.z, grey);
  const machineBody = box(0.42, 0.5, 0.3, MACHINE.x, 1.25, MACHINE.z, new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.5 }));
  const machineBtn = box(0.14, 0.06, 0.14, MACHINE.x, 1.53, MACHINE.z, new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4 }));
  ctx.addObstacle({ x: MACHINE.x, z: MACHINE.z, radius: 0.35 });

  // Chairs down both side walls, facing in; a plant; a water cooler.
  const chairs: { x: number; z: number; face: number }[] = [];
  const chairSolid = new Map<(typeof chairs)[number], { x: number; z: number; radius: number }>();
  for (const side of [-1, 1]) {
    for (let z = -2.6; z <= 3.4; z += 1.0) chairs.push({ x: side * (W / 2 - 0.6), z, face: side < 0 ? Math.PI / 2 : -Math.PI / 2 });
  }
  for (const c of chairs) {
    const seat = box(0.5, 0.06, 0.5, c.x, 0.45, c.z, plastic);
    seat.rotation.y = c.face;
    const back = box(0.5, 0.5, 0.06, c.x, 0.72, c.z, plastic);
    back.rotation.y = c.face;
    back.translateZ(-0.24);
    for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) box(0.04, 0.45, 0.04, c.x + lx, 0.225, c.z + lz, grey);
    const o = { x: c.x, z: c.z, radius: 0.35 };
    ctx.addObstacle(o);
    chairSolid.set(c, o);
  }
  const pot = box(0.5, 0.5, 0.5, -W / 2 + 0.7, 0.25, -D / 2 + 2.3, new THREE.MeshStandardMaterial({ color: 0x9a5a3a }));
  pot.castShadow = true;
  const plantMat = new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 1.1, 5), plantMat);
    leaf.position.set(-W / 2 + 0.7 + Math.cos(i) * 0.12, 0.95, -D / 2 + 2.3 + Math.sin(i) * 0.12);
    leaf.rotation.set(Math.sin(i * 2) * 0.4, 0, Math.cos(i * 2) * 0.4);
    root.add(leaf);
  }
  ctx.addObstacle({ x: -W / 2 + 0.7, z: -D / 2 + 2.3, radius: 0.4 });
  box(0.45, 1.0, 0.45, W / 2 - 0.7, 0.5, -D / 2 + 2.3, new THREE.MeshStandardMaterial({ color: 0xe8e8e4 }));
  const jug = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.45, 14), new THREE.MeshStandardMaterial({ color: 0x8fc8ee, transparent: true, opacity: 0.6 }));
  jug.position.set(W / 2 - 0.7, 1.25, -D / 2 + 2.3);
  root.add(jug);
  ctx.addObstacle({ x: W / 2 - 0.7, z: -D / 2 + 2.3, radius: 0.4 });

  // ── Tickets ──
  const tickets: Carryable[] = [];
  const makeTicket = (n: number, pos: THREE.Vector3): Carryable => {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 72;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#f6f2e4';
    g.fillRect(0, 0, 128, 72);
    g.fillStyle = '#c62828';
    g.fillRect(0, 0, 128, 12);
    g.fillStyle = '#1a1a1a';
    g.font = `bold 44px ${FONT_DISPLAY}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(n).padStart(3, '0'), 64, 44);
    const t = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.11, 0.004),
      new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.9 }),
    );
    t.position.copy(pos);
    t.userData.number = n;
    root.add(t);
    const c: Carryable = {
      kind: 'ticket',
      object: t,
      heldDist: 0.55,
      heldDrop: 0.22,
      heldUpdate: (_dt, o, q) => o.quaternion.copy(q), // held up, facing you
      // Throwable: paper, so a light, floaty toss (low gravity, barely bounces),
      // and it lands wherever — still a ticket you can pick back up.
      projectile: { radius: 0.06, restitution: 0.1, gravity: 5, speed: 6, arc: 1.4 },
      clickThrows: true,
      onGrab: () => onTicketGrab(n),
    };
    ctx.addCarryable(c);
    tickets.push(c);
    return c;
  };
  let lowestHeld = 0; // the lowest ticket you've picked up (0 = none yet)
  let tookTwo = false;
  const onTicketGrab = (n: number) => {
    if (!lowestHeld || n < lowestHeld) lowestHeld = n;
    if (n === 2 && !tookTwo) {
      tookTwo = true;
      sleeper.snore = false;
      ctx.narrate(TOOK_TICKET, 5000, { priority: true });
    }
    hud();
  };

  // The machine prints 948, then 949, 950… and then it's out of paper.
  let printed = 0;
  registerInteractable({
    id: 'waiting-ticket-machine',
    position: MACHINE.clone().setY(1.2),
    radius: 1.8,
    promptLabel: 'PRESS',
    onUse: () => {
      click();
      machineBtn.position.y = 1.5;
      window.setTimeout(() => (machineBtn.position.y = 1.53), 120);
      if (printed >= 3) {
        ctx.narrate(NO_PAPER, 3500, { priority: true });
        return;
      }
      whirr();
      const n = YOURS + printed;
      makeTicket(n, new THREE.Vector3(MACHINE.x - 0.05, 1.12, MACHINE.z + 0.2));
      ctx.narrate(printed === 0 ? FIRST_TICKET : MORE_TICKET, 4500, { priority: true });
      printed++;
    },
  });
  void machineBody;

  // ── The other people: a sleeper holding 002, and three who hold 3, 4, 5 ──
  interface Person {
    g: THREE.Group;
    seat: { x: number; z: number; face: number };
    number: number;
    state: 'sit' | 'up' | 'gone';
    t: number;
    snore: boolean;
  }
  const seatPerson = (seat: (typeof chairs)[number], number: number): Person => {
    const g = createAsset('dummy') as THREE.Group;
    g.scale.setScalar(0.85);
    g.position.set(seat.x, -0.15, seat.z);
    g.rotation.y = seat.face;
    for (const n of ['legL', 'legR']) (g.getObjectByName(n) as THREE.Object3D).rotation.x = -Math.PI / 2;
    root.add(g);
    return { g, seat, number, state: 'sit', t: 0, snore: false };
  };
  const sleeper = seatPerson(chairs[3], 2); // left wall, middle
  sleeper.snore = true;
  (sleeper.g.getObjectByName('head') as THREE.Object3D).rotation.set(0.5, 0, 0.35); // chin on chest
  // His ticket, on his lap, ready to be taken.
  const lap = new THREE.Vector3(sleeper.seat.x + 0.35, 0.52, sleeper.seat.z);
  const twoTicket = makeTicket(2, lap);
  twoTicket.object.rotation.set(-Math.PI / 2, 0, 0.4);
  const others = [seatPerson(chairs[1], 3), seatPerson(chairs[8], 4), seatPerson(chairs[11], 5)];

  // ── Sitting: press an empty chair and you sit in it, facing into the room.
  //    You stay in normal play (look around, hands free — throw your tickets
  //    from the chair), just at a seated eye height. Moving stands you up. ──
  const people = [sleeper, ...others];
  const taken = (c: (typeof chairs)[number]) => people.some((p) => p.seat === c && p.state === 'sit');
  let sitting: (typeof chairs)[number] | null = null;
  const seatAt = new THREE.Vector3();
  let saidSit = false;
  const standUp = () => {
    const c = sitting;
    if (!c) return;
    sitting = null;
    setEyeHeight(null);
    ctx.addObstacle(chairSolid.get(c)!);
    ctx.camera.position.set(c.x + Math.sin(c.face) * 0.8, CONFIG.PLAYER_HEIGHT, c.z + Math.cos(c.face) * 0.8);
  };
  const sitDown = (c: (typeof chairs)[number]) => {
    sitting = c;
    // Its own collider comes off while you're in it — so a step is a real move
    // (which is how we notice you getting up).
    ctx.removeObstacle(chairSolid.get(c)!);
    seatAt.set(c.x + Math.sin(c.face) * 0.05, 1.15, c.z + Math.cos(c.face) * 0.05);
    ctx.camera.position.copy(seatAt);
    setEyeHeight(1.15); // the walker (and your hands) now keep you at seated height
    setYaw(Math.atan2(-Math.sin(c.face), -Math.cos(c.face))); // facing the way the chair faces
    setPitch(0);
    thud();
    if (!saidSit) {
      saidSit = true;
      ctx.narrate(SIT, 5000, { priority: true });
    }
  };
  addUpdater(() => {
    if (!sitting) return false;
    const p = ctx.camera.position;
    // The walker only moves you if you push a direction: moved → you stood up.
    if (Math.hypot(p.x - seatAt.x, p.z - seatAt.z) > 0.02) standUp();
    return false;
  });
  chairs.forEach((c, i) => {
    registerInteractable({
      id: `waiting-chair-${i}`,
      position: new THREE.Vector3(c.x, 0.5, c.z),
      radius: 1.4,
      promptLabel: 'SIT',
      canUse: () => sitting === c || (!sitting && !taken(c)),
      onUse: () => {
        if (sitting === c) standUp();
        else if (!sitting && !taken(c)) sitDown(c);
      },
    });
  });
  // A snoring "z" over the sleeper.
  const zCv = document.createElement('canvas');
  zCv.width = zCv.height = 64;
  const zg = zCv.getContext('2d')!;
  zg.fillStyle = '#6a6a74';
  zg.font = `bold 48px ${FONT_VOICE}`;
  zg.textAlign = 'center';
  zg.textBaseline = 'middle';
  zg.fillText('z', 32, 34);
  const zSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(zCv), transparent: true }));
  zSprite.scale.setScalar(0.3);
  root.add(zSprite);

  // ── The queue ──
  let nowServing = 1;
  let callT = 6; // until the next call
  let saidSpun = false;
  let waitingForTwo = 0; // seconds spent calling two
  let rush = RUSH_START;
  let saidAsleep = false;
  let saidYours = false;
  let yoursT = 0; // seconds since 948 was called, unserved
  const despairSaid = new Set<number>();
  const hud = () => setCounter(`NOW SERVING ${String(nowServing).padStart(3, '0')}    YOUR TICKET ${lowestHeld ? String(lowestHeld).padStart(3, '0') : '—'}`);
  const call = (n: number) => {
    nowServing = n;
    drawDisplay(n);
    hud();
    if (n <= 5 || n === YOURS) chime();
    else if (rush > 0.5) tone({ type: 'sine', from: 988, dur: 0.15, gain: 0.05 });
    else if (n % 25 === 0) tone({ type: 'sine', from: 988, dur: 0.08, gain: 0.04 });
  };
  drawDisplay(1);
  hud();

  // ── Being served (any route) ──
  const serve = (line: string) => {
    if (served) return;
    served = true;
    stamp();
    sparkle();
    discover('mech:counter');
    clerkArmR.rotation.x = -1.6;
    window.setTimeout(() => {
      clerkArmR.rotation.x = 0;
      stamp();
    }, 350);
    ctx.narrate(line, 6500, { priority: true });
    hideCounter();
    const btn = spawnPedestalButton(root, EXIT_AT, () => ctx.advance(EXIT_AT.clone()));
    ctx.addObstacle(btn.obstacle);
  };

  counter = {
    present: (n) => {
      if (served) return;
      if (n > nowServing) {
        pop();
        ctx.narrate(NOT_YET, 3500, { priority: true });
        return;
      }
      serve(n === 2 ? SERVED_SWAP : n === YOURS ? SERVED_OWN : SERVED_SWAP);
    },
    bribe: () => {
      if (served) return;
      discover('mech:counter');
      serve(BRIBE);
    },
    riot: () => {
      if (served) return;
      quack();
      thud();
      // Papers everywhere; the clerk ducks under the desk.
      const paper = new THREE.MeshBasicMaterial({ color: 0xf6f2e4, side: THREE.DoubleSide });
      const bits: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
      for (let i = 0; i < 40; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.28), paper);
        m.position.set((Math.random() - 0.5) * 2, 1.3, COUNTER_Z - 0.6);
        root.add(m);
        bits.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.2) * 3) });
      }
      let t = 0;
      addUpdater((dt) => {
        t += dt;
        for (const b of bits) {
          b.v.y -= 3 * dt; // they flutter
          b.v.multiplyScalar(1 - dt * 0.8);
          b.m.position.addScaledVector(b.v, dt);
          if (b.m.position.y < 0.03) b.m.position.y = 0.03;
          b.m.rotation.x += dt * 4;
          b.m.rotation.z += dt * 3;
        }
        clerk.position.y = Math.max(-1.2, -t * 3); // under the desk
        return t > 4;
      });
      serve(RIOT);
    },
  };

  // ── Per frame ──
  let murmurT = 3;
  let tz = 0;
  addUpdater((dt) => {
    tz += dt;
    // The sleeper snores; a z floats up and fades, over and over.
    if (sleeper.snore) {
      const k = (tz % 2.2) / 2.2;
      zSprite.visible = true;
      zSprite.position.set(sleeper.seat.x + 0.1, 1.45 + k * 0.7, sleeper.seat.z);
      (zSprite.material as THREE.SpriteMaterial).opacity = 1 - k;
    } else zSprite.visible = false;
    // Clerk idles: a slow head turn.
    if (clerkHead) clerkHead.rotation.y = Math.sin(tz * 0.4) * 0.3;
    murmurT -= dt;
    if (murmurT <= 0) {
      murmurT = 5 + Math.random() * 4;
      murmur();
    }

    // The customers who are called walk up, stand a moment, and leave.
    for (const p of others) {
      if (p.state !== 'up') continue;
      p.t += dt;
      const toCounter = new THREE.Vector3(0 + (p.number - 4) * 0.8, 0, COUNTER_Z + 0.5);
      const k = Math.min(1, p.t / 2.2);
      p.g.position.lerpVectors(new THREE.Vector3(p.seat.x, 0, p.seat.z), toCounter, k);
      p.g.rotation.y = Math.atan2(toCounter.x - p.seat.x, toCounter.z - p.seat.z);
      const swing = Math.sin(p.t * 8) * 0.4 * (1 - Math.floor(k));
      (p.g.getObjectByName('legL') as THREE.Object3D).rotation.x = swing;
      (p.g.getObjectByName('legR') as THREE.Object3D).rotation.x = -swing;
      if (p.t > 4.5) {
        // served — and gone (bureaucracy has no exit animation)
        p.state = 'gone';
        root.remove(p.g);
      }
    }

    if (served || nowServing >= YOURS) {
      if (!served && !saidYours) {
        saidYours = true;
        chime();
        ctx.narrate(YOUR_TURN, 5000, { priority: true });
      }
      // Still standing there: how you actually get served.
      if (!served) {
        yoursT += dt;
        if (yoursT > 14 && yoursT - dt <= 14) ctx.narrate(YOUR_TURN_HINT, 5000);
      }
      return false;
    }
    // The queue's own clock: faster with the Spinner in hand.
    const sp = spinnerSpeed(ctx);
    if (sp > 1 && !saidSpun) {
      saidSpun = true;
      ctx.narrate(SPUN, 5000);
    }
    const qdt = dt * sp;
    callT -= qdt;
    if (nowServing === 2) {
      // Waiting on a sleeping man.
      waitingForTwo += qdt;
      if (!saidAsleep && waitingForTwo > 18) {
        saidAsleep = true;
        ctx.narrate(TWO_ASLEEP, 5000, { interruptible: true });
      }
      if (callT <= 0 && waitingForTwo < TWO_PATIENCE) {
        callT = 8;
        chime(); // "…two?"
      }
      if (waitingForTwo >= TWO_PATIENCE) {
        ctx.narrate(TWO_FORFEIT, 4500, { interruptible: true });
        callT = 1;
        call(3);
        const p = others.find((o) => o.number === 3);
        if (p) (p.state = 'up'), (p.t = 0);
        callT = NPC_CALL;
      }
      return false;
    }
    if (callT > 0) return false;
    if (nowServing === 1) {
      call(2);
      ctx.narrate(CALL_TWO, 4000, { interruptible: true });
      callT = 8;
      return false;
    }
    const next = nowServing + 1;
    const p = others.find((o) => o.number === next);
    if (p) {
      call(next);
      p.state = 'up';
      p.t = 0;
      callT = NPC_CALL;
      return false;
    }
    // Nobody holds 6…947, and the clerk calls them anyway — faster and faster.
    call(next);
    rush = Math.max(RUSH_MIN, rush * RUSH_DECAY);
    callT = rush;
    for (const [at, line] of DESPAIR) {
      if (next >= at && !despairSaid.has(at)) {
        despairSaid.add(at);
        ctx.narrate(line, 5000, { interruptible: true });
      }
    }
    return false;
  });

  setScriptHints(SCRIPT_NOTES);
  ctx.narrate(INTRO, 6500);
}
