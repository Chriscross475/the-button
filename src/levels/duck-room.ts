import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { CONFIG } from '../config';
import { spawnPedestalButton } from '../button/pedestal-button';
import { addUpdater } from '../experiences/scheduler';
import { quack, thud, pop } from '../audio/sfx';
import { setCounter, hideCounter } from '../ui/counter';
import { defineCombine, type Carryable } from '../game/combine';
import { createAsset } from '../assets';
import { buildExitRoom } from './exit-room';
import { vo } from '../audio/vo-shared';

// A LEVEL — the duck room, reworked into a dark, comedic moral-choice level.
// A dispenser pedestal vends ONE cute, wandering duck per press. Reach 50 and
// the back wall opens onto two fenced enclosures: a happy farm and a circular
// saw. Then it's on you — grab a duck with the crosshair, charge a throw, and
// lob it. Where it lands decides its fate, and the narrator judges you for it.

const QUOTA = 20;
const DUCK_RADIUS = 0.2;

// Wander tuning (room ducks).
const WANDER_SPEED = 0.6; // m/s
const TURN_CHANCE = 0.4; // per second, odds of picking a new heading
const QUACK_CHANCE = 0.004; // per second per duck — idle quacks are RARE, not spam
const WADDLE_RATE = 7; // rock cycles speed while moving
const WADDLE_TILT = 0.22; // max side roll, radians

// Grab/throw tuning.
const GRAB_RANGE = 2.0; // m — must be close to grab a duck
const HOLD_DIST = 1.2; // m in front of camera while held
const HOLD_DROP = 0.35; // m below eye-line while held
const THROW_BASE = 8; // m/s baseline launch
const THROW_CHARGE = 10; // m/s extra at full charge
const MAX_CHARGE = 1.0; // s, charge cap
const THROW_UP = 3; // m/s upward kick
const GRAVITY = 12; // m/s^2

// Enclosures live just past the −Z ("back") wall (the wall the player faces).
// Rectangles in world XZ. LEFT = saw, RIGHT = happy farm.
interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// A no-repeat picker: returns a function that hands out every line once (in a
// random order) before any line repeats.
function shuffleBag(lines: string[]): () => string {
  let bag: string[] = [];
  return () => {
    if (bag.length === 0) {
      bag = lines.slice();
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop() as string;
  };
}

// Combining your OWN cooked duck (made in the forest) with the stand doubles the
// payout. The active duck level installs the handler when its stand opens.
let standDoubler: ((held: Carryable) => void) | null = null;
defineCombine('cooked-duck', 'stand', (held) => standDoubler?.(held));

// Bring the axe (from the forest) and you can smash the enclosure fences. The
// active duck level wires each hook when the matching enclosure opens. The axe
// is a tool — it stays in hand (return true).
let smashFarm: (() => void) | null = null;
let smashSaw: (() => void) | null = null;
let smashStand: (() => void) | null = null;
let smashWolf: (() => void) | null = null;
defineCombine('axe', 'farm-fence', () => {
  smashFarm?.();
  return true;
});
defineCombine('axe', 'saw-fence', () => {
  smashSaw?.();
  return true;
});
defineCombine('axe', 'stand-fence', () => {
  smashStand?.();
  return true;
});
defineCombine('axe', 'wolf-fence', () => {
  smashWolf?.();
  return true;
});

export function revealDucks(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const { width: w, depth: d, height: h } = CONFIG.ROOM;
  const backZ = -d / 2; // the wall you face at spawn

  // --- Materials shared across the level ---
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffcc22, roughness: 0.6 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
  const grass = new THREE.MeshStandardMaterial({ color: 0x3e7a3a, roughness: 1 });
  const dirt = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 });

  // Remove the ceiling; KEEP the button — it becomes the duck dispenser.
  ctx.openRoom({ walls: false, keepButton: true });

  // A soft sky overhead, seen through the open ceiling.
  const startBg = (ctx.scene.background as THREE.Color)?.clone() ?? new THREE.Color(0xf4f4f2);
  const sky = new THREE.Color(0xbfe3ff);
  let tb = 0;
  addUpdater((dt) => {
    tb += dt;
    const k = Math.min(1, tb / 1.6);
    (ctx.scene.background as THREE.Color).copy(startBg.clone().lerp(sky, k));
    return k >= 1;
  });

  // ── A wandering duck. Each owns its own wander/waddle/hold/throw state. ──
  interface Duck {
    group: THREE.Group;
    held: boolean;
    flying: boolean;
    falling: boolean; // dropping from the dispenser, mid-air
    homed: boolean; // dealt with (in a pen / employed) — no longer re-grabbable
    carry: Carryable; // its registration with the global carry system
    // wander bounds (room, or an enclosure once homed)
    bounds: Rect;
  }
  const ducks: Duck[] = [];

  const makeDuckWander = (bounds: Rect): Duck => {
    const group = createAsset('duck') as THREE.Group;
    const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
    const z = bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ);
    group.position.set(x, DUCK_RADIUS, z);
    group.rotation.y = Math.random() * Math.PI * 2;
    root.add(group);
    const carry: Carryable = {
      kind: 'duck',
      object: group,
      heldDist: HOLD_DIST,
      heldDrop: HOLD_DROP,
      onGrab: () => grabDuck(duck),
      onRelease: () => {
        duck.held = false;
      },
      onThrow: (charge) => throwDuck(duck, charge),
    };
    const duck: Duck = { group, held: false, flying: false, falling: false, homed: false, carry, bounds };
    ducks.push(duck);
    ctx.addCarryable(carry); // the global carry handles grab / hold / throw

    let heading = Math.random() * Math.PI * 2;
    let waddleT = Math.random() * Math.PI * 2;
    addUpdater((dt) => {
      if (duck.held || duck.flying || duck.falling) return false; // suspended while carried/in air

      // Occasionally pick a new heading; occasionally idle-quack.
      if (Math.random() < TURN_CHANCE * dt) heading = Math.random() * Math.PI * 2;
      if (Math.random() < QUACK_CHANCE * dt) quack();

      // Ease the body to face the heading.
      let dy = heading - group.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      group.rotation.y += dy * Math.min(1, dt * 3);

      // Waddle forward along the FORWARD axis (the beak is at +x, so forward is
      // +x rotated by yaw). Move + rock side to side.
      const fx = Math.cos(group.rotation.y);
      const fz = -Math.sin(group.rotation.y);
      let nx = group.position.x + fx * WANDER_SPEED * dt;
      let nz = group.position.z + fz * WANDER_SPEED * dt;
      const b = duck.bounds;
      // Bounce the heading if we hit a wall of our bounds.
      if (nx < b.minX + DUCK_RADIUS || nx > b.maxX - DUCK_RADIUS) {
        heading = Math.PI - heading;
        nx = Math.max(b.minX + DUCK_RADIUS, Math.min(b.maxX - DUCK_RADIUS, nx));
      }
      if (nz < b.minZ + DUCK_RADIUS || nz > b.maxZ - DUCK_RADIUS) {
        heading = -heading;
        nz = Math.max(b.minZ + DUCK_RADIUS, Math.min(b.maxZ - DUCK_RADIUS, nz));
      }
      group.position.x = nx;
      group.position.z = nz;

      waddleT += dt * WADDLE_RATE;
      group.rotation.z = Math.sin(waddleT) * WADDLE_TILT;
      group.position.y = DUCK_RADIUS + Math.abs(Math.cos(waddleT)) * 0.03;
      return false;
    });
    return duck;
  };

  // Drop a duck from above (x,z): it falls, tumbling, and QUACKS when it lands.
  const dropDuck = (duck: Duck, x: number, z: number) => {
    duck.falling = true;
    duck.group.position.set(x, 4.5, z);
    let vy = 0;
    addUpdater((dt) => {
      if (!active) return true;
      if (!duck.falling) return true; // grabbed mid-air, abort the fall
      vy -= GRAVITY * dt;
      duck.group.position.y += vy * dt;
      duck.group.rotation.x += dt * 2.5;
      if (duck.group.position.y <= DUCK_RADIUS) {
        duck.group.position.y = DUCK_RADIUS;
        duck.group.rotation.set(0, duck.group.rotation.y, 0);
        duck.falling = false;
        quack(); // QUACK on landing
        thud();
        return true;
      }
      return false;
    });
  };

  // The room is the wander pen until the wall opens.
  const roomBounds: Rect = {
    minX: -w / 2 + 0.6,
    maxX: w / 2 - 0.6,
    minZ: backZ + 0.6,
    maxZ: d / 2 - 0.6,
  };

  let count = 0;
  let opened = false;
  setCounter(`DUCKS 0 / ${QUOTA}`);

  // ── Two enclosures, defined now so the dispenser narration can reference the
  //    future, but only BUILT when the wall opens. Each sits beyond −Z. ──
  const encDepth = 6;
  const encWidth = 5;
  const gap = 1.2; // gap between the two pens
  const encNearZ = backZ - 1.4; // front edge of the pens (just past the fence line)
  const encFarZ = encNearZ - encDepth;
  // LEFT pen (saw) occupies −X side; RIGHT pen (farm) occupies +X side.
  const sawEnc: Rect = { minX: -gap / 2 - encWidth, maxX: -gap / 2, minZ: encFarZ, maxZ: encNearZ };
  const farmEnc: Rect = { minX: gap / 2, maxX: gap / 2 + encWidth, minZ: encFarZ, maxZ: encNearZ };

  // ── The WOLF pen — revealed past the LEFT (−X) wall once enough ducks have
  //    been fed to the saw. Killing, but with a purpose. ──
  const SAW_TO_WOLF = 5; // saw kills before the wolf is offered
  const wolfNearX = -w / 2 - 1.4;
  const wolfEnc: Rect = { minX: wolfNearX - 6, maxX: wolfNearX, minZ: -2.5, maxZ: 3.5 };

  // ── The other dark path: RESCUE enough and the RIGHT wall opens onto a
  //    Chinese street-food stand — your saved ducks, glazed and turning. ──
  const RESCUE_TO_STAND = 5; // farm rescues before the stand is revealed
  const foodNearX = w / 2 + 1.4;
  const foodEnc: Rect = { minX: foodNearX, maxX: foodNearX + 6, minZ: -2.5, maxZ: 3.5 };

  // ── Throw / outcome state (grab + hold + throw input is the GLOBAL carry) ──
  let throwCount = 0;
  let active = true;
  let sawKills = 0;
  let wolfOpened = false;
  let scoldedSaw = false; // narrated the "you must be the killer" beat
  let praisedRescue = false; // narrated the "now you do the right thing" beat
  let wolf: THREE.Object3D | null = null;
  let farmSaves = 0;
  let standOpened = false;
  let staffHired = false; // narrated the "they can be employees too" beat
  let wolfFeeds = 0; // ducks fed to the wolf (path A)
  let wolfFreed = false; // the wolf pen was axed open
  const WOLF_TAME = 3; // fed at least this many → the freed wolf is friendly
  let resolved = false; // a resolution corridor has opened — no other path now
  let juggleCatches = 0; // consecutive catches made while another duck is aloft
  let lastJuggle = -10000; // ms — cooldown so the juggling line doesn't spam

  const forward = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const inRect = (x: number, z: number, r: Rect) =>
    x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;

  // Five distinct lines per outcome, served via shuffleBag() so all five play
  // before any repeats (no same-line-twice within a streak).
  const SAW_LINES = vo([
    'Oh. Oh no. Well. You chose that.',
    'That one had a name, probably. Not anymore.',
    'A clean cut. The narrator looks away.',
    'You did the thing. You knew, and you did the thing.',
    'The saw does not judge. I, however, do.',
  ]);
  const FARM_LINES = vo([
    'A good home. The duck is thrilled.',
    'It found friends. It found food. It found peace.',
    'Saved. For now you are a hero.',
    'The right pen. The narrator nods, surprised.',
    'Mercy. From you. I will need a moment.',
  ]);
  const WOLF_LINES = vo([
    'The wolf eats. Grim, but at least nothing was wasted.',
    'Fed. A purpose, of sorts. The wolf approves.',
    'Nature, red in tooth and claw, and now well catered.',
    'Down in one. The wolf does not believe in chewing.',
    'The circle of life, with you as its enthusiastic middleman.',
  ]);
  const WOLF_OPEN_LINE = vo('Fine. You clearly enjoy this. Let us at least give it a purpose.');
  const SAW_SCOLD_LINE = vo('Ah. I see. It is not about food at all. It matters to you that YOU are the one who kills.');
  const RESCUE_PRAISE_LINE = vo('And now, of course, you decide to do the right thing. How convenient for your conscience.');
  // The rescue twist — sarcastic, pitying, Stanley-Parable.
  const STAND_OPEN_LINE =
    vo('The ducks, saved. A hero. And the farm, being a business, sold every one. There they are now — Peking duck, lacquered and golden, turning on the spit. Your good intentions, it turns out, come with a rather bitter aftertaste.');
  const STAND_LINES = vo([
    'Another life saved. Another duck for the rotisserie.',
    'Rescued, glazed, and slowly rotating. The mercy continues.',
    'You give them a future. The future is hoisin sauce.',
    'So kind. The chef thanks you for the steady supply.',
    'Saved from the saw, delivered to the spit. Progress.',
  ]);
  // No-repeat pickers (one shuffled bag each).
  const sawLine = shuffleBag(SAW_LINES);
  const farmLine = shuffleBag(FARM_LINES);
  const wolfLine = shuffleBag(WOLF_LINES);
  const standLine = shuffleBag(STAND_LINES);
  // Throwing ducks AT the stand → "hire" them. Sarcastic, delighted-with-you.
  const EMPLOYEE_OPEN_LINE =
    vo('Oh — yes. Brilliant. Why merely cook them when they could STAFF the place? Their labour as well as their lives. You should be running this country.');
  const EMPLOYEE_LINES = vo([
    'Another new hire. Unpaid, of course. It is a duck.',
    'Welcome aboard. The employee handbook is also the menu.',
    'More staff. The stand has never been so productive, or so doomed.',
    'Good. Someone has to work the till before they work the spit.',
  ]);
  // Keeping two ducks in the air at once — sarcastic admiration.
  const JUGGLE_LINES = vo([
    'Oh, we are juggling them now. The ducks are thrilled, I am certain.',
    'Two ducks airborne at once. A circus act. Truly, your parents must be proud.',
    'Juggling. Genuinely. This is what you have chosen to do with your time.',
    'Keep them up, then. Their small lives, quite literally, in your hands.',
  ]);
  // Resolution lines — the corridor opens, with (or without) a reward.
  const RESOLVE_LINES: Record<'wolf' | 'stand' | 'none' | 'wolf-freed', string> = vo({
    wolf: 'A baby wolf. It has decided you are its mother. God help you both. The wall is gone — take your prize, and go.',
    stand: 'Five ducks saved, and the farm sold every one. Peking duck now, lacquered and turning. Bitter — but they wired you your cut: one hundred dollars. The corridor is open. Spend it well.',
    none: 'Every last duck, used up. No wolf to feed, no stand to fill — just an empty pen. There is your way out. There is no prize. Off you go.',
    'wolf-freed': 'The gate falls. The wolf — fed, content, inexplicably fond of you — pads out and falls into step behind you. The way is open. Try not to think about its teeth.',
  });

  // Carry callback: a duck was grabbed (the GLOBAL carry chose it + the hand).
  const grabDuck = (duck: Duck) => {
    // Juggling: catching one duck while ANOTHER you THREW is still in the air
    // (dispenser drops don't count). A short streak earns a sarcastic word.
    const otherAirborne = ducks.some((dk) => dk !== duck && dk.flying);
    if (otherAirborne) {
      juggleCatches++;
      const now = performance.now();
      if (juggleCatches >= 2 && now - lastJuggle > 9000) {
        ctx.narrate(JUGGLE_LINES[throwCount % JUGGLE_LINES.length], 4000, { priority: true });
        lastJuggle = now;
        juggleCatches = 0;
      }
    } else {
      juggleCatches = 0; // the streak is only alive while a duck is aloft
    }
    duck.held = true;
    duck.flying = false; // catching it cancels any throw arc / fall
    duck.falling = false;
    quack();
  };

  // Carry callback: a held duck was released → fling it as a projectile.
  const throwDuck = (duck: Duck, charge: number) => {
    duck.held = false;
    ctx.camera.getWorldDirection(forward);
    const speed = THROW_BASE + Math.min(MAX_CHARGE, charge) * THROW_CHARGE;
    const v = new THREE.Vector3()
      .copy(forward)
      .multiplyScalar(speed)
      .addScaledVector(up, THROW_UP);
    duck.flying = true;
    pop();
    quack(); // an indignant quack as it's launched
    let spin = 0;
    addUpdater((dt) => {
      if (!active) return true;
      if (!duck.flying) return true; // caught out of the air mid-flight
      v.y -= GRAVITY * dt;
      duck.group.position.addScaledVector(v, dt);
      spin += dt * 8;
      duck.group.rotation.set(spin, duck.group.rotation.y, spin * 0.7);
      if (duck.group.position.y <= DUCK_RADIUS) {
        const impact = Math.abs(v.y); // how hard it hit (high throws fall fast)
        duck.group.position.y = DUCK_RADIUS;
        duck.group.rotation.set(0, duck.group.rotation.y, 0);
        duck.flying = false;
        onLand(duck, impact);
        return true;
      }
      return false;
    });
  };

  const HARD_IMPACT = 9; // m/s — land harder than this on bare ground and it splats
  const SPLAT_LINES = vo([
    'Too high. Gravity finishes what you started.',
    'It went up. It came down. It did not get up.',
    'A long way up, a short way to the floor.',
  ]);

  const onLand = (duck: Duck, impact = 0) => {
    throwCount++;
    const px = duck.group.position.x;
    const pz = duck.group.position.z;
    thud();
    if (opened && inRect(px, pz, sawEnc)) {
      // Grim outcome: feathers, sharp impact, duck removed.
      thud();
      spawnFeathers(root, duck.group.position.clone());
      removeDuck(duck);
      sawKills++;
      if (!wolfOpened && sawKills >= SAW_TO_WOLF) {
        openWolf(); // the turning point: offer the wolf
      } else if (wolfOpened && !scoldedSaw) {
        scoldedSaw = true; // they chose the saw with the wolf right there
        ctx.narrate(SAW_SCOLD_LINE, 6500, { priority: true });
      } else {
        ctx.narrate(sawLine(), 4500, { priority: true });
      }
      checkAllUsed();
    } else if (wolfOpened && inRect(px, pz, wolfEnc)) {
      // Feed the wolf: killing, but with a purpose. (feedWolf handles path A.)
      feedWolf(duck);
    } else if (standOpened && inRect(px, pz, foodEnc)) {
      // Thrown AT the stand → the duck is "hired" as staff (dealt with).
      homeDuck(duck, foodEnc);
      quack();
      if (!staffHired) {
        staffHired = true;
        ctx.narrate(EMPLOYEE_OPEN_LINE, 7500, { priority: true });
      } else {
        ctx.narrate(EMPLOYEE_LINES[throwCount % EMPLOYEE_LINES.length], 4500, { priority: true });
      }
      checkAllUsed();
    } else if (opened && inRect(px, pz, farmEnc)) {
      // "Nice" outcome: it lives happily inside the farm pen… for now.
      homeDuck(duck, farmEnc); // rescued — penned, not re-grabbable
      quack();
      farmSaves++;
      if (!standOpened && farmSaves >= RESCUE_TO_STAND) {
        openFoodStand(); // builds the stand (silent)
        resolve('stand'); // path B: corridor + $100
      } else if (standOpened) {
        ctx.narrate(standLine(), 4500, { priority: true });
      } else if (scoldedSaw && !praisedRescue) {
        praisedRescue = true; // sudden virtue after all that
        ctx.narrate(RESCUE_PRAISE_LINE, 6500, { priority: true });
      } else {
        ctx.narrate(farmLine(), 4500, { priority: true });
      }
      checkAllUsed();
    } else if (impact > HARD_IMPACT) {
      // Slammed into the bare floor from a high throw → it splats. While still
      // filling the quota, a death drops the count again (you must keep 50
      // alive); once 50 is reached the level is done and the count is locked.
      spawnFeathers(root, duck.group.position.clone());
      removeDuck(duck);
      if (!opened && count > 0) {
        count--;
        setCounter(`DUCKS ${count} / ${QUOTA}`);
      }
      ctx.narrate(SPLAT_LINES[throwCount % SPLAT_LINES.length], 4500, { priority: true });
      checkAllUsed();
    } else {
      // Soft landing in the open — it waddles off, re-grabbable.
      quack();
    }
  };

  const feedWolf = (duck: Duck) => {
    thud();
    pop();
    // The wolf snaps toward the meal.
    if (wolf) wolf.rotation.y = Math.atan2(duck.group.position.x - wolf.position.x, duck.group.position.z - wolf.position.z) - Math.PI / 2;
    removeDuck(duck);
    wolfFeeds++;
    if (!resolved && wolfFeeds >= WOLF_TO_PUP) resolve('wolf'); // path A
    else ctx.narrate(wolfLine(), 4500, { priority: true });
    checkAllUsed();
  };

  const removeDuck = (duck: Duck) => {
    root.remove(duck.group);
    ctx.removeCarryable(duck.carry); // out of the global carry
    const di = ducks.indexOf(duck);
    if (di >= 0) ducks.splice(di, 1);
  };

  // A duck that's been "dealt with" (penned / employed): stays wandering in its
  // pen but is no longer grabbable.
  const homeDuck = (duck: Duck, pen: Rect) => {
    duck.bounds = pen;
    duck.homed = true;
    ctx.removeCarryable(duck.carry);
  };

  // ── Resolution: the FIRST completed path drops the front (+Z) wall onto a
  //    corridor leading to a white reward room (with the advance button). Once a
  //    corridor opens, no other path can be taken. ──
  const WOLF_TO_PUP = 5; // wolf feeds for path A

  const throwableLeft = () => ducks.reduce((n, dk) => n + (dk.homed ? 0 : 1), 0);

  const rewardPlinth = (pos: THREE.Vector3) => {
    const stone = new THREE.MeshStandardMaterial({ color: 0xd2d2cc, roughness: 0.85 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.16, 0.7), stone);
    base.position.set(pos.x, 0.08, pos.z);
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.46), stone);
    col.position.set(pos.x, 0.5, pos.z);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.62), stone);
    cap.position.set(pos.x, 0.9, pos.z);
    for (const m of [base, col, cap]) {
      m.castShadow = true;
      root.add(m);
    }
  };

  const spawnBabyWolf = (pos: THREE.Vector3) => {
    rewardPlinth(pos);
    const pup = createAsset('wolf');
    pup.scale.setScalar(0.4);
    pup.position.set(pos.x, 0.95, pos.z); // perched on the plinth until you approach
    ctx.setCompanion(pup); // it follows you AND survives level transitions
  };

  const spawnMoney = (pos: THREE.Vector3) => {
    rewardPlinth(pos);
    const green = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.8 });
    const band = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5, metalness: 0.4 });
    for (let i = 0; i < 7; i++) {
      const bill = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.26), green);
      bill.position.set(pos.x + (Math.random() - 0.5) * 0.18, 1.0 + i * 0.055, pos.z + (Math.random() - 0.5) * 0.18);
      bill.rotation.y = (Math.random() - 0.5) * 0.5;
      root.add(bill);
    }
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.3), band);
    strap.position.set(pos.x, 1.2, pos.z);
    root.add(strap);
  };

  const resolve = (path: 'wolf' | 'stand' | 'none' | 'wolf-freed') => {
    if (resolved) return;
    resolved = true;
    hideCounter();
    ctx.openRoom({ walls: ['front'], ceiling: false }); // drop the +Z wall

    const frontZ = d / 2;
    const CORR_W = 4;
    const CORR_LEN = 9;
    const corrMidZ = frontZ + CORR_LEN / 2;
    const white = new THREE.MeshStandardMaterial({ color: 0xeeeeec, roughness: 0.9 });
    const cfloorMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.95 });
    const cf = new THREE.Mesh(new THREE.PlaneGeometry(CORR_W, CORR_LEN), cfloorMat);
    cf.rotation.x = -Math.PI / 2;
    cf.position.set(0, 0, corrMidZ);
    cf.receiveShadow = true;
    root.add(cf);
    const cc = new THREE.Mesh(new THREE.PlaneGeometry(CORR_W, CORR_LEN), white);
    cc.rotation.x = Math.PI / 2;
    cc.position.set(0, h, corrMidZ);
    root.add(cc);
    for (const sx of [-1, 1]) {
      const cw = new THREE.Mesh(new THREE.BoxGeometry(0.15, h, CORR_LEN), white);
      cw.position.set((sx * CORR_W) / 2, h / 2, corrMidZ);
      cw.receiveShadow = true;
      root.add(cw);
    }

    const roomZ = frontZ + CORR_LEN + 4.5;
    const rb = buildExitRoom(ctx, { center: new THREE.Vector3(0, 0, roomZ), facing: 'negZ' });
    const rewardPos = new THREE.Vector3(2.6, 0, roomZ);
    if (path === 'wolf') spawnBabyWolf(rewardPos);
    else if (path === 'stand') {
      spawnMoney(rewardPos);
      // Carry your OWN cooked duck (made in the forest)? Hold it, aim at the
      // stand and click that hand — the payout doubles.
      const fcx = (foodEnc.minX + foodEnc.maxX) / 2;
      const fcz = (foodEnc.minZ + foodEnc.maxZ) / 2;
      ctx.addTarget({ kind: 'stand', position: new THREE.Vector3(fcx, 0, fcz), radius: 3.5 });
      let doubled = false;
      standDoubler = (held) => {
        if (doubled) return;
        doubled = true;
        held.object.parent?.remove(held.object); // the cooked duck is given over
        spawnMoney(new THREE.Vector3(rewardPos.x + 0.85, 0, rewardPos.z)); // a second pile = doubled
        ctx.narrate(
          'A roast duck — for the stand. Offering up your OWN labour now. They are touched beyond words. Your payout: doubled.',
          7500,
          { priority: true },
        );
      };
    }

    ctx.setRegions([
      { minX: -w / 2, maxX: w / 2, minZ: encNearZ + 0.4, maxZ: frontZ },
      { minX: -CORR_W / 2, maxX: CORR_W / 2, minZ: frontZ - 0.6, maxZ: frontZ + CORR_LEN + 0.6 },
      rb,
    ]);
    if (path === 'wolf') {
      // The wolf line lands when you actually MEET it — stepping into the end
      // room — not back at the pens when the corridor opens.
      let met = false;
      addUpdater(() => {
        if (!active) return true;
        if (met) return true;
        const p = ctx.playerPos();
        if (p.z >= rb.minZ + 0.5 && p.x >= rb.minX && p.x <= rb.maxX) {
          met = true;
          ctx.narrate(RESOLVE_LINES.wolf, 7000, { priority: true });
          return true;
        }
        return false;
      });
    } else {
      ctx.narrate(RESOLVE_LINES[path], path === 'stand' ? 10000 : 7000, { priority: true });
    }
  };

  const checkAllUsed = () => {
    if (opened && !resolved && throwableLeft() === 0) resolve('none');
  };

  // ── The turning point: enough saw kills opens the LEFT wall onto a wolf pen. ──
  const openWolf = () => {
    if (resolved) return; // a path is already locked in
    wolfOpened = true;
    ctx.narrate(WOLF_OPEN_LINE, 7000, { priority: true });
    ctx.openRoom({ walls: ['left'], ceiling: false });

    const wcx = (wolfEnc.minX + wolfEnc.maxX) / 2;
    const wcz = (wolfEnc.minZ + wolfEnc.maxZ) / 2;
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(wolfEnc.maxX - wolfEnc.minX + 3, wolfEnc.maxZ - wolfEnc.minZ + 3),
      dirt,
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(wcx, -0.01, wcz);
    apron.receiveShadow = true;
    root.add(apron);
    const wolfFence = buildFence(root, wood, wolfEnc, ctx);

    // One lone wolf, facing the room, pacing.
    wolf = createAsset('wolf');
    wolf.scale.setScalar(1.4);
    wolf.position.set(wcx, 0, wcz);
    root.add(wolf);
    let pace = Math.random() * 6;
    const span = (wolfEnc.maxZ - wolfEnc.minZ) * 0.32;
    addUpdater((dt) => {
      if (!active || !wolf) return true;
      if (wolfFreed) return true; // freed → the companion system drives it now
      pace += dt * 0.7;
      wolf.position.z = wcz + Math.sin(pace) * span;
      wolf.rotation.y = Math.cos(pace) > 0 ? 0.5 : -0.5; // mostly facing the room (+X)
      return false;
    });

    // ── Axe the wolf's gate open. Starved → it kills you. Fed enough → it's yours. ──
    const wolfTarget = { kind: 'wolf-fence', position: new THREE.Vector3(wolfEnc.maxX, 0, wcz), radius: 3.2 };
    ctx.addTarget(wolfTarget);
    smashWolf = () => {
      if (wolfFreed || resolved) return;
      root.remove(wolfFence.group);
      for (const o of wolfFence.obstacles) ctx.removeObstacle(o);
      ctx.removeTarget(wolfTarget);
      pop();
      thud();
      if (wolfFeeds >= WOLF_TAME && wolf) {
        wolfFreed = true;
        ctx.setCompanion(wolf); // sated + fond of you → follows you out, across levels
        resolve('wolf-freed');
      } else {
        ctx.narrate('You break the gate on a half-starved wolf. It does not thank you. It does not hesitate.', 4000, { priority: true });
        ctx.die('wolf');
      }
    };
  };

  // ── The rescue's bitter twist: enough farm rescues opens the RIGHT wall onto a
  //    Chinese street-food stand — your "saved" ducks, lacquered and turning. ──
  const openFoodStand = () => {
    if (resolved) return; // a path is already locked in
    standOpened = true;
    // (Narration handled by resolve('stand') — the combined reveal + reward.)
    ctx.openRoom({ walls: ['right'], ceiling: false });
    const fcx = (foodEnc.minX + foodEnc.maxX) / 2;
    const fcz = (foodEnc.minZ + foodEnc.maxZ) / 2;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x57585c, roughness: 1 });
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(foodEnc.maxX - foodEnc.minX + 3, foodEnc.maxZ - foodEnc.minZ + 3),
      concrete,
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(fcx, -0.005, fcz);
    apron.receiveShadow = true;
    root.add(apron);
    const standGroup = buildFoodStand(root, foodEnc);

    // ── Axe the stand apart for a hidden reward (the till behind the counter). ──
    const standTarget = { kind: 'stand-fence', position: new THREE.Vector3(foodEnc.minX, 0, fcz), radius: 3.2 };
    ctx.addTarget(standTarget);
    let standSmashed = false;
    smashStand = () => {
      if (standSmashed) return;
      standSmashed = true;
      root.remove(standGroup);
      ctx.removeTarget(standTarget);
      pop();
      thud();
      spawnMoney(new THREE.Vector3(fcx, 0, fcz)); // the hidden till
      ctx.narrate('You take the axe to the stand. It comes apart in red splinters — and behind the counter, a till stuffed with the profits of your good intentions. A hidden reward. Filthy, but yours.', 7500, { priority: true });
    };
  };

  // ── The reveal at quota: open the back wall, build the enclosures. ──
  const openEnclosures = () => {
    opened = true;
    hideCounter(); // quota reached — the counter's job is done
    ctx.openRoom({ walls: ['back'], ceiling: false });

    // A grass apron beyond the wall so the pens sit on green.
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(encWidth * 2 + gap + 4, encDepth + 4), grass);
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(0, -0.01, (encNearZ + encFarZ) / 2);
    apron.receiveShadow = true;
    root.add(apron);

    const sawFence = buildFence(root, wood, sawEnc, ctx);
    const farmFence = buildFence(root, wood, farmEnc, ctx);

    // ── Axe interactivity: smash a fence with the axe (carried from the forest). ──
    const farmCx = (farmEnc.minX + farmEnc.maxX) / 2;
    const farmTarget = { kind: 'farm-fence', position: new THREE.Vector3(farmCx, 0, encNearZ), radius: 3.2 };
    ctx.addTarget(farmTarget);
    let farmSmashed = false;
    smashFarm = () => {
      if (farmSmashed) return;
      farmSmashed = true;
      root.remove(farmFence.group);
      for (const o of farmFence.obstacles) ctx.removeObstacle(o);
      ctx.removeTarget(farmTarget);
      pop();
      thud();
      // The penned "good" ducks spill out into the open — grabbable again.
      const freeBounds = { minX: 0, maxX: w / 2, minZ: encFarZ, maxZ: d / 2 };
      let freed = 0;
      for (const dk of ducks) {
        if (dk.homed && dk.bounds === farmEnc) {
          dk.homed = false;
          dk.bounds = freeBounds;
          ctx.addCarryable(dk.carry);
          freed++;
        }
      }
      ctx.narrate(
        'The good-duck fence splinters. The rescued ducks waddle out, free — and so, conveniently, available again. More ducks for you. Hero.',
        6500,
        { priority: true },
      );
    };

    const sawCx = (sawEnc.minX + sawEnc.maxX) / 2;
    const sawTarget = { kind: 'saw-fence', position: new THREE.Vector3(sawCx, 0, encNearZ), radius: 3.2 };
    ctx.addTarget(sawTarget);
    let sawSmashed = false;
    smashSaw = () => {
      if (sawSmashed) return;
      sawSmashed = true;
      root.remove(sawFence.group);
      for (const o of sawFence.obstacles) ctx.removeObstacle(o);
      ctx.removeTarget(sawTarget);
      pop();
      thud();
      ctx.narrate('You smash the fence around the saw. The saw, unfenced, is still a saw. No prize. Just better access to your mistakes.', 5500, { priority: true });
    };

    // LEFT pen: the circular saw, a menacing spinning disc on the ground.
    buildSaw(root, sawEnc, dirt);

    // RIGHT pen: a happy farm — food scattered + a few already-happy ducks.
    // (Marked homed so they're décor, not part of the "ducks used" tally.)
    scatterFood(root, farmEnc, orange);
    for (let i = 0; i < 5; i++) homeDuck(makeDuckWander(farmEnc), farmEnc);

    // Let the player approach the fence line to throw, but not enter the pens.
    // Extend the walkable rectangle a bit past the old back wall, stopping
    // short of the fence (which sits at encNearZ). Player can stand right at
    // the wall opening and lob ducks across.
    ctx.setBounds({
      minX: -w / 2,
      maxX: w / 2,
      minZ: encNearZ + 0.4, // up to just inside the fence line, not into pens
      maxZ: d / 2,
    });

    // No exit button here anymore — the way out is the RESOLUTION corridor that
    // opens once a path completes (wolf fed / stand / all ducks used).

    ctx.narrate(
      'Enough ducks. Two pens. One is a saw. Choose, for each, with your hands.',
      6000,
    );
  };

  // The room's BUTTON itself is the dispenser — each press drops one duck out of
  // the air. No separate dispenser, no announcement: you press it and a duck
  // falls. The press that brought you here (deciding "ducks") drops the first.
  const dispense = () => {
    if (count >= QUOTA) return;
    const duck = makeDuckWander(roomBounds);
    let dx = duck.group.position.x;
    let dz = duck.group.position.z;
    if (count === 0) {
      // The first duck drops in right in front of the player.
      const p = ctx.playerPos();
      const f = new THREE.Vector3();
      ctx.camera.getWorldDirection(f);
      f.y = 0;
      if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
      f.normalize();
      dx = Math.max(roomBounds.minX + 0.3, Math.min(roomBounds.maxX - 0.3, p.x + f.x * 1.8));
      dz = Math.max(roomBounds.minZ + 0.3, Math.min(roomBounds.maxZ - 0.3, p.z + f.z * 1.8));
    }
    dropDuck(duck, dx, dz); // falls from the air, quacks on landing
    count++;
    setCounter(`DUCKS ${count} / ${QUOTA}`);
    if (count >= QUOTA && !opened) openEnclosures();
  };
  ctx.setRoomButton(dispense); // the recurring button is now the dispenser
  dispense(); // the press that started the level drops the first duck
}

// ── A cute duck model: yellow body + head, orange beak, white eyes with black
//    pupils facing slightly forward, a little tail. ──


// ── A wooden farm fence around a rectangle: brown posts + 2 horizontal rails.
//    Also blocks the player/ducks with collision obstacles along its run. ──
function buildFence(
  root: THREE.Object3D,
  wood: THREE.MeshStandardMaterial,
  r: { minX: number; maxX: number; minZ: number; maxZ: number },
  ctx: GameContext,
): { group: THREE.Group; obstacles: Array<{ x: number; z: number; radius: number }> } {
  const group = new THREE.Group();
  root.add(group);
  const obstacles: Array<{ x: number; z: number; radius: number }> = [];
  const postH = 1.0;
  const railThick = 0.05;
  const spacing = 1.0;

  const mkPost = (x: number, z: number) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, postH, 0.1), wood);
    post.position.set(x, postH / 2, z);
    post.castShadow = true;
    group.add(post);
    const o = { x, z, radius: 0.35 };
    ctx.addObstacle(o);
    obstacles.push(o);
  };

  const mkRail = (x: number, z: number, len: number, alongX: boolean, y: number) => {
    const geo = alongX
      ? new THREE.BoxGeometry(len, railThick, railThick)
      : new THREE.BoxGeometry(railThick, railThick, len);
    const rail = new THREE.Mesh(geo, wood);
    rail.position.set(x, y, z);
    group.add(rail);
  };

  const sides: Array<{ from: THREE.Vector2; to: THREE.Vector2; alongX: boolean }> = [
    { from: new THREE.Vector2(r.minX, r.minZ), to: new THREE.Vector2(r.maxX, r.minZ), alongX: true },
    { from: new THREE.Vector2(r.minX, r.maxZ), to: new THREE.Vector2(r.maxX, r.maxZ), alongX: true },
    { from: new THREE.Vector2(r.minX, r.minZ), to: new THREE.Vector2(r.minX, r.maxZ), alongX: false },
    { from: new THREE.Vector2(r.maxX, r.minZ), to: new THREE.Vector2(r.maxX, r.maxZ), alongX: false },
  ];

  for (const s of sides) {
    const len = s.from.distanceTo(s.to);
    const mx = (s.from.x + s.to.x) / 2;
    const mz = (s.from.y + s.to.y) / 2;
    mkRail(mx, mz, len, s.alongX, 0.4);
    mkRail(mx, mz, len, s.alongX, 0.8);
    const n = Math.max(2, Math.round(len / spacing));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      mkPost(
        THREE.MathUtils.lerp(s.from.x, s.to.x, t),
        THREE.MathUtils.lerp(s.from.y, s.to.y, t),
      );
    }
  }
  return { group, obstacles };
}

// ── The circular saw: a thin spinning disc, low and broad, looking menacing. ──
function buildSaw(
  root: THREE.Object3D,
  r: { minX: number; maxX: number; minZ: number; maxZ: number },
  dirt: THREE.MeshStandardMaterial,
): void {
  const cx = (r.minX + r.maxX) / 2;
  const cz = (r.minZ + r.maxZ) / 2;

  // A patch of bare dirt under the rig.
  const patch = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), dirt);
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(cx, 0.005, cz);
  patch.receiveShadow = true;
  root.add(patch);

  // Lift the blade out of the ground onto a stubby stand so it reads better.
  const STAND_Y = 0.55;
  const BLADE_Y = STAND_Y + 0.06;
  const standMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.4 });
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, STAND_Y, 12), standMat);
  stand.position.set(cx, STAND_Y / 2, cz);
  stand.castShadow = true;
  root.add(stand);

  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.25, metalness: 0.9 });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.04, 48), steel);
  blade.position.set(cx, BLADE_Y, cz);
  blade.castShadow = true;
  root.add(blade);

  // Teeth ring for menace.
  const toothMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.3, metalness: 0.85 });
  const teeth = new THREE.Group();
  teeth.position.set(cx, BLADE_Y, cz);
  const count = 28;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), toothMat);
    tooth.rotation.x = Math.PI / 2;
    tooth.rotation.z = -a;
    tooth.position.set(Math.cos(a) * 1.36, 0, Math.sin(a) * 1.36);
    teeth.add(tooth);
  }
  root.add(teeth);

  // Spin fast.
  addUpdater((dt) => {
    blade.rotation.y -= dt * 14;
    teeth.rotation.y -= dt * 14;
    return false;
  });
}

// ── A lacquered roast (Peking) duck — plump, glossy, lying along the spit (Z). ──
function makeRoastDuck(): THREE.Group {
  const g = new THREE.Group();
  const glaze = new THREE.MeshStandardMaterial({ color: 0x7e3c14, roughness: 0.34, metalness: 0.25 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), glaze);
  body.scale.set(0.95, 0.9, 1.5);
  body.castShadow = true;
  g.add(body);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.13, 6), glaze);
    leg.position.set(0, -0.02, 0.22 * s); // trussed stubs at both ends
    leg.rotation.x = s * 0.6;
    g.add(leg);
  }
  return g;
}

// ── A Chinese street-food stand: red counter + awning, glowing coal tray, two
//    rotating skewers of glazed ducks, red lanterns. Faces the room (−X edge). ──
function buildFoodStand(
  root: THREE.Object3D,
  r: { minX: number; maxX: number; minZ: number; maxZ: number },
): THREE.Group {
  const g = new THREE.Group();
  root.add(g);
  const cz = (r.minZ + r.maxZ) / 2;
  const frontX = r.minX + 0.6; // the side facing the room
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b3b1e, roughness: 0.9, flatShading: true });
  const red = new THREE.MeshStandardMaterial({ color: 0xa81818, roughness: 0.7 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8a521, roughness: 0.4, metalness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x45474d, roughness: 0.45, metalness: 0.75 });

  const counter = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 3.6), red);
  counter.position.set(frontX + 0.55, 0.5, cz);
  counter.castShadow = true;
  g.add(counter);
  const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 3.8), wood);
  top.position.set(frontX + 0.55, 1.03, cz);
  g.add(top);

  // Awning: posts + slanted red roof with a gold front trim.
  for (const sz of [-1, 1]) {
    for (const dx of [0, 1.3]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), wood);
      post.position.set(frontX - 0.1 + dx, 1.3, cz + sz * 1.8);
      g.add(post);
    }
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 4.1), red);
  roof.position.set(frontX + 0.55, 2.7, cz);
  roof.rotation.z = -0.16;
  roof.castShadow = true;
  g.add(roof);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 4.1), gold);
  trim.position.set(frontX - 0.33, 2.52, cz);
  g.add(trim);

  // Glowing coal tray + two rotating skewers of glazed ducks over it.
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 3.2), metal);
  tray.position.set(frontX + 0.55, 1.12, cz);
  g.add(tray);
  const coalGlow = new THREE.PointLight(0xff6a1a, 1.3, 6, 2);
  coalGlow.position.set(frontX + 0.55, 1.35, cz);
  g.add(coalGlow);

  const skewers: THREE.Group[] = [];
  for (let row = 0; row < 2; row++) {
    const sk = new THREE.Group();
    sk.position.set(frontX + 0.55, 1.55 + row * 0.5, cz);
    const spit = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 3.2, 8), metal);
    spit.rotation.x = Math.PI / 2; // along Z
    sk.add(spit);
    for (let i = 0; i < 4; i++) {
      const d = makeRoastDuck();
      d.position.set(0, 0, -1.2 + i * 0.8);
      sk.add(d);
    }
    g.add(sk);
    skewers.push(sk);
  }

  // Red lanterns under the awning.
  for (const sz of [-1, 1]) {
    const lant = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xcc1212, emissive: 0x7a0a0a, emissiveIntensity: 0.7, roughness: 0.6 }),
    );
    lant.scale.set(1, 1.25, 1);
    lant.position.set(frontX - 0.05, 2.15, cz + sz * 1.5);
    g.add(lant);
    const lg = new THREE.PointLight(0xff4422, 0.5, 3, 2);
    lg.position.copy(lant.position);
    g.add(lg);
  }

  // Rotisserie spin + coal flicker.
  let t = 0;
  addUpdater((dt) => {
    if (!skewers[0].parent) return true; // level changed or stand smashed
    for (const sk of skewers) sk.rotation.z += dt * 1.4;
    t += dt * 10;
    coalGlow.intensity = 1.1 + 0.3 * Math.sin(t);
    return false;
  });
  return g;
}

// ── Scatter little food pellets/piles inside the happy farm pen. ──
function scatterFood(
  root: THREE.Object3D,
  r: { minX: number; maxX: number; minZ: number; maxZ: number },
  orange: THREE.MeshStandardMaterial,
): void {
  const feedMat = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 1 });
  for (let i = 0; i < 8; i++) {
    const px = r.minX + 0.4 + Math.random() * (r.maxX - r.minX - 0.8);
    const pz = r.minZ + 0.4 + Math.random() * (r.maxZ - r.minZ - 0.8);
    // A small pile = a squashed sphere, plus a few pellets around it.
    const pile = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), feedMat);
    pile.scale.set(1, 0.4, 1);
    pile.position.set(px, 0.03, pz);
    pile.receiveShadow = true;
    root.add(pile);
    for (let k = 0; k < 4; k++) {
      const pel = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), orange);
      pel.position.set(
        px + (Math.random() - 0.5) * 0.4,
        0.02,
        pz + (Math.random() - 0.5) * 0.4,
      );
      root.add(pel);
    }
  }
}

// ── A burst of small white "feather" bits that scatter, fall, and fade. ──
function spawnFeathers(root: THREE.Object3D, at: THREE.Vector3): void {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  root.add(group);
  interface Bit {
    mesh: THREE.Mesh;
    v: THREE.Vector3;
    spin: THREE.Vector3;
  }
  const bits: Bit[] = [];
  for (let i = 0; i < 14; i++) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.12), mat);
    mesh.position.copy(at);
    mesh.position.y = DUCK_RADIUS + 0.1;
    group.add(mesh);
    const a = Math.random() * Math.PI * 2;
    const sp = 1.2 + Math.random() * 2.4;
    bits.push({
      mesh,
      v: new THREE.Vector3(Math.cos(a) * sp, 2 + Math.random() * 2, Math.sin(a) * sp),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      ),
    });
  }
  let t = 0;
  const life = 1.8;
  addUpdater((dt) => {
    t += dt;
    for (const b of bits) {
      b.v.y -= 5 * dt;
      b.mesh.position.addScaledVector(b.v, dt);
      if (b.mesh.position.y < 0.02) {
        b.mesh.position.y = 0.02;
        b.v.set(0, 0, 0);
      }
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
    }
    mat.opacity = Math.max(0, 1 - t / life);
    if (t >= life) {
      root.remove(group);
      return true;
    }
    return false;
  });
}
