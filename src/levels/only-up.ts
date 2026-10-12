import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { RoomBounds } from '../controls/player-camera';
import { isGrounded, floorYAt, getYaw } from '../controls/player-camera';
import type { ControlMode } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { hideRoomShell, groundPlane, walkThroughPortal } from './scaffold';
import { registerInteractable } from '../interactables/system';
import { spawnPedestalButton } from '../button/pedestal-button';
import { createAsset } from '../assets';
import { vo } from '../audio/vo-shared';
import { thud, fanfare, whoosh, click, sparkle } from '../audio/sfx';
import { discover } from '../graph/progress';

// ONLY UP. The walls fall, the ceiling floats off, and above you a tower of the
// game's own junk — crates, a vending machine, a tram, a giant duck, a queue's
// brass rail, a courtroom bench, a lift car — spirals up into the sky, with THE
// button on a tiny platform at the top. Jumping is on here (Space / JUMP).
//
// The route is a square spiral built by `plat()`: each platform sits a GAP past
// the previous one's edge along the leg's direction, RISE higher, centred on it
// across — so every gap is exact and every jump is one a run-jump makes (see
// the headless climb in the scratchpad sim). Falling never kills you: you land on
// whatever is below, which is the joke. The Spinner, held, makes you drift down.

export const JUMP = { speed: 6.6, gravity: 20, step: 0.35 }; // apex ~1.1 m; ledges catch up to ~1.45 m
const LONG_FALL = 10;

const INTRO = vo('Oh, we are doing this. Only up. Space to jump, or the big JUMP button if you are on a phone. The button is at the top. Do not look down. Actually, look down. It is funny.');
const FALLS = vo([
  'That was forty minutes of progress. Anyway.',
  'Chat, he fell. Chat. Chat, he fell again.',
  'Gravity is undefeated. You are, however, very defeated.',
  'You will be telling your grandchildren about that fall. They will not care.',
  'Deep breaths. The tower is not going anywhere. Neither, it turns out, are you.',
]);
const BOTTOM = vo('Only up. Not only down. Try to remember.');
const MILESTONES = vo([
  'Ten metres. The crates were the easy part.',
  'Twenty metres. Wave to the tram. The tram cannot wave back.',
  'Thirty metres. The air is thinner. The furniture is not.',
  'Forty metres. I can see the button. It can see you. It is nervous.',
]);
const FLOAT = vo('The spinner. You are drifting. That is not flying. That is falling, politely.');
const LEDGES = vo([
  'A ledge. Have a sit. The lift will remember this floor, even if your legs would rather not.',
  'Another ledge. The lift knows this floor now. It is not impressed, but it knows it.',
  'The last ledge. From here it is just you, the sky, and some plumbing.',
]);
const LIFT_RIDE = vo('The service lift. Staff only. You are not staff. Going up.');
const LIFT_NONE = vo('It only goes to floors you have already been to. You have been to the ground floor. Congratulations.');
const EASY_OUT = vo('There is a door at the bottom now. For people like you. No summit, naturally. Nobody will think less of you. I will. But nobody else.');
const TOP = vo('You made it. Forty-odd metres of other people’s furniture. Press it. Chat, he is pressing it.');

const LIFT_AT = new THREE.Vector3(-8, 0, 1); // the service lift, at the foot of the tower
const DOOR_AT = new THREE.Vector3(-8, 0, -5); // the door for people like you (after 3 big falls)
const QUIT_FALLS = 3;

type Prop = 'crates' | 'vending' | 'trolley' | 'beam' | 'desk' | 'pedestal' | 'sofa' | 'lift' | 'ladder' | 'duck' | 'pipe' | 'bench' | 'ledge' | 'top';
type Dir = 0 | 1 | 2 | 3; // −z, +x, +z, −x

interface Plat {
  x: number;
  z: number;
  sx: number; // footprint, x
  sz: number; // footprint, z
  y: number; // top
  thick: number; // solid depth below the top
  prop: Prop;
  dir: Dir;
}

// One step of the route: [dir, length along dir, width across, gap, rise, prop].
type Step = [Dir, number, number, number, number, Prop];

// The first leg, off the back of the white room.
const OPENING: Step[] = [
  [0, 1.6, 1.6, 0.8, 0.6, 'crates'],
  [0, 1.2, 1.2, 1.0, 0.7, 'crates'],
  [0, 0.9, 1.1, 1.0, 0.8, 'vending'],
];
// Four DIFFERENT laps (+x, +z, −x, −z legs each), so the climb never repeats
// itself: each has its own junk and its own rhythm. Every lap ends on a wide
// LEDGE — a checkpoint the service lift can take you back up to.
const LAPS: Step[][] = [
  // 1 · The warehouse: wide crates, the tram, vending machines. Steady steps.
  [
    [1, 3.0, 1.6, 0.9, 0.5, 'trolley'],
    [1, 1.4, 1.4, 0.9, 0.7, 'crates'],
    [1, 1.4, 1.4, 1.0, 0.8, 'crates'],
    [2, 1.2, 1.2, 1.0, 0.8, 'vending'],
    [2, 1.6, 1.6, 0.8, 0.6, 'crates'],
    [2, 1.2, 1.2, 1.0, 0.9, 'vending'],
    [2, 1.4, 1.4, 0.9, 0.7, 'crates'],
    [3, 3.0, 1.6, 0.9, 0.5, 'trolley'],
    [3, 1.4, 1.4, 1.0, 0.8, 'crates'],
    [3, 1.2, 1.2, 0.9, 0.9, 'pedestal'],
    [3, 1.4, 1.4, 1.0, 0.7, 'crates'],
    [0, 1.2, 1.2, 1.0, 0.9, 'vending'],
    [0, 1.4, 1.4, 0.9, 0.8, 'crates'],
    [0, 2.6, 2.6, 1.0, 0.8, 'ledge'],
  ],
  // 2 · The office: a staccato of little desk hops, then a big climb to a lift.
  [
    [1, 1.2, 1.0, 0.6, 0.3, 'desk'],
    [1, 1.2, 1.0, 0.6, 0.3, 'desk'],
    [1, 1.2, 1.0, 0.6, 0.3, 'desk'],
    [1, 1.5, 1.5, 0.9, 1.0, 'lift'],
    [2, 2.0, 1.0, 0.9, 0.7, 'sofa'],
    [2, 1.2, 1.2, 1.0, 0.9, 'pedestal'],
    [2, 1.2, 1.0, 0.6, 0.3, 'desk'],
    [2, 1.2, 1.0, 0.6, 0.3, 'desk'],
    [2, 1.5, 1.5, 0.9, 1.0, 'lift'],
    [3, 2.0, 1.0, 0.9, 0.7, 'sofa'],
    [3, 1.2, 1.2, 1.0, 0.9, 'bench'],
    [3, 1.2, 1.0, 0.6, 0.3, 'desk'],
    [3, 1.5, 1.5, 0.9, 1.0, 'lift'],
    [0, 1.2, 1.2, 1.0, 0.9, 'bench'],
    [0, 1.2, 1.0, 0.6, 0.3, 'desk'],
    [0, 2.4, 2.4, 1.0, 0.9, 'ledge'],
  ],
  // 3 · The game's own rooms: long walks along the queue's rails, the
  //     courtroom's benches, the giant duck.
  [
    [1, 3.4, 0.6, 0.8, 0.3, 'beam'],
    [1, 1.4, 1.2, 1.0, 0.9, 'bench'],
    [1, 1.8, 1.8, 0.9, 0.8, 'duck'],
    [2, 3.4, 0.6, 0.8, 0.3, 'beam'],
    [2, 1.2, 1.2, 1.0, 0.9, 'pedestal'],
    [2, 1.4, 1.2, 1.0, 0.9, 'bench'],
    [2, 1.8, 1.8, 1.0, 0.8, 'duck'],
    [3, 3.4, 0.6, 0.8, 0.3, 'beam'],
    [3, 1.2, 1.2, 1.0, 0.9, 'pedestal'],
    [3, 1.4, 1.2, 1.0, 0.9, 'bench'],
    [0, 3.0, 0.6, 0.8, 0.4, 'beam'],
    [0, 1.4, 1.2, 1.0, 0.9, 'bench'],
    [0, 2.4, 2.4, 1.0, 0.9, 'ledge'],
  ],
  // 4 · The sky: pipes and ladders between lone crates. The meanest lap —
  //     still never a jump past a comfortable run-jump.
  [
    [1, 3.0, 0.6, 0.8, 0.3, 'pipe'],
    [1, 1.0, 1.0, 1.0, 1.0, 'crates'],
    [1, 3.0, 0.6, 0.8, 0.3, 'ladder'],
    [2, 1.0, 1.0, 0.9, 1.0, 'crates'],
    [2, 2.8, 0.6, 0.8, 0.4, 'pipe'],
    [2, 1.0, 1.0, 0.9, 1.0, 'vending'],
    [3, 3.0, 0.6, 0.8, 0.3, 'ladder'],
    [3, 1.0, 1.0, 0.9, 1.0, 'crates'],
    [3, 2.8, 0.6, 0.8, 0.3, 'pipe'],
    [3, 1.0, 1.0, 0.9, 1.0, 'crates'],
    [0, 1.0, 1.0, 0.9, 1.0, 'crates'],
    [0, 1.6, 1.6, 1.0, 0.9, 'duck'],
  ],
];
const NARROW: Prop[] = ['beam', 'ladder', 'pipe'];
const MIN_NARROW = 0.6; // nothing you have to land on is thinner than this

/** The whole route, bottom to top (exported for the headless climb). */
export function buildRoute(): Plat[] {
  const out: Plat[] = [];
  let cur: Plat = { x: 0, z: -4, sx: 1, sz: 1, y: 0, thick: 0, prop: 'crates', dir: 0 };
  const plat = ([dir, len, wide, gap, rise, prop]: Step) => {
    const along = dir === 0 || dir === 2 ? 'z' : 'x';
    const sign = dir === 1 || dir === 2 ? 1 : -1;
    const sx = along === 'x' ? len : wide;
    const sz = along === 'z' ? len : wide;
    const p: Plat = { x: cur.x, z: cur.z, sx, sz, y: cur.y + rise, thick: 0, prop, dir };
    if (along === 'x') p.x = cur.x + sign * (cur.sx / 2 + gap + sx / 2);
    else p.z = cur.z + sign * (cur.sz / 2 + gap + sz / 2);
    p.thick = thickOf(prop, p.y);
    out.push(p);
    cur = p;
  };
  for (const [dir, len, wide, gap, rise, prop] of OPENING) plat([dir, len, wide, Math.min(comfyGap(rise), gap), rise, prop]);
  LAPS.forEach((lap, i) => {
    const shrink = 1 - i * 0.06; // the tower tapers
    for (const [dir, len, wide, gap, rise, prop] of lap) {
      const w = NARROW.includes(prop) ? Math.max(MIN_NARROW, wide) : prop === 'ledge' ? wide : wide * shrink;
      plat([dir, prop === 'ledge' ? len : len * shrink, w, Math.min(comfyGap(rise), gap), rise, prop]);
    }
  });
  plat([0, 2.4, 2.4, Math.min(comfyGap(1.0), 1.0), 1.0, 'top']);
  return out;
}

// The widest gap a run-jump up `rise` makes when you take off anywhere in the
// last EARLY metres before the edge: your feet must be within a step of the far
// top while you're over it, on the way down. EARLY is generous on purpose —
// this is a joke level, not a frame-perfect one.
const EARLY = 0.8;
export function comfyGap(rise: number): number {
  const need = rise - JUMP.step; // feet this high over the far edge
  const disc = JUMP.speed * JUMP.speed - 2 * JUMP.gravity * need;
  const tDown = (JUMP.speed + Math.sqrt(Math.max(0, disc))) / JUMP.gravity;
  return Math.min(1.3, CONFIG.MOVE_SPEED * tDown - EARLY - 0.1);
}

// How far each prop's solid part reaches below its top (you can walk under the
// rest). Crates and vending machines stand on the ground on the first leg.
function thickOf(prop: Prop, top: number): number {
  const t: Record<Prop, number> = {
    crates: 0.9, vending: 1.9, trolley: 1.2, beam: 0.12, desk: 0.8, pedestal: 1.0, sofa: 0.6,
    lift: 2.2, ladder: 0.1, duck: 1.4, pipe: 0.5, bench: 0.5, ledge: 0.3, top: 0.4,
  };
  return Math.min(top, t[prop]);
}

export function revealOnlyUp(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom();
  ctx.after(2200, () => hideRoomShell(ctx)); // after the walls have fallen

  // Sky: the white room's fog is still on the scene — set it outright.
  const skyLow = new THREE.Color(0xbfd8ee);
  const skyHigh = new THREE.Color(0x5a8fd0);
  ctx.scene.background = skyLow.clone();
  const fog = new THREE.Fog(skyLow.getHex(), 60, 260);
  ctx.scene.fog = fog;
  root.add(groundPlane({ color: 0x8c9a78 }));
  const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x6b7a5a, 0.9);
  root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.3);
  sun.position.set(20, 60, 10);
  root.add(sun);

  const route = buildRoute();
  const regions: RoomBounds[] = [{ minX: -40, maxX: 40, minZ: -50, maxZ: 25, floorY: 0 }];
  for (const p of route) {
    regions.push({ minX: p.x - p.sx / 2, maxX: p.x + p.sx / 2, minZ: p.z - p.sz / 2, maxZ: p.z + p.sz / 2, floorY: p.y, thick: p.thick });
    root.add(makeProp(p));
  }
  ctx.setRegions(regions);
  ctx.setJump(JUMP);

  // A blob shadow under you, on whatever you would land on — so you can judge a
  // jump in first person instead of guessing.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.32, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  root.add(shadow);

  // ── Checkpoints: the ledge at the end of each lap ──
  const ledges = route.filter((p) => p.prop === 'ledge');
  let reached = -1; // highest ledge stood on
  const ledgeUnder = (x: number, z: number, foot: number) =>
    ledges.findIndex((l) => Math.abs(x - l.x) <= l.sx / 2 && Math.abs(z - l.z) <= l.sz / 2 && Math.abs(foot - l.y) < 0.2);

  // ── The service lift: back up to the highest ledge you have reached ──
  const cage = new THREE.Group();
  cage.position.copy(LIFT_AT);
  root.add(cage);
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.7 });
  for (const [cx, cz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.6, 0.08), steel);
    post.position.set(cx, 1.3, cz);
    cage.add(post);
  }
  const cageFloor = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.7), steel);
  cageFloor.position.y = 0.05;
  cage.add(cageFloor);
  const cageRoof = cageFloor.clone();
  cageRoof.position.y = 2.6;
  cage.add(cageRoof);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture('STAFF ONLY', '#1a1a1a', '#f2c418') }));
  sign.position.set(0.86, 2.3, 0);
  sign.rotation.y = Math.PI / 2;
  cage.add(sign);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 46, 0.12), steel);
  shaft.position.set(LIFT_AT.x - 0.9, 23, LIFT_AT.z - 0.9);
  root.add(shaft);
  let riding = false;
  const ride = (to: Plat) => {
    riding = true;
    whoosh();
    ctx.narrate(LIFT_RIDE, 4000, { priority: true });
    const from = ctx.camera.position.clone();
    const yaw = getYaw();
    let t = 0;
    const DUR = 3.2;
    const mode: ControlMode = {
      update(dt) {
        t = Math.min(DUR, t + dt);
        const k = t / DUR;
        const e = k * k * (3 - 2 * k);
        cage.position.y = e * to.y;
        ctx.camera.position.set(from.x, from.y + e * to.y, from.z);
        if (t >= DUR) {
          ctx.setControlMode(null);
          click();
          sparkle();
          ctx.spawnAt(new THREE.Vector3(to.x, to.y, to.z), yaw); // doors open: you're on the ledge
          cage.position.y = 0; // and the lift goes back down for next time
          riding = false;
        }
      },
    };
    ctx.setControlMode(mode);
  };
  registerInteractable({
    id: 'only-up-lift',
    position: LIFT_AT.clone(),
    radius: 1.8,
    promptLabel: 'RIDE',
    labelOffsetY: 1.6,
    canUse: () => !riding,
    onUse() {
      if (riding) return;
      if (reached < 0) {
        click();
        ctx.narrate(LIFT_NONE, 5500, { priority: true });
        return;
      }
      ride(ledges[reached]);
    },
  });

  // ── After enough big falls: the door for people like you ──
  let bigFalls = 0;
  const openQuitDoor = () => {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.6 });
    for (const sx of [-0.85, 0.85]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.5, 0.15), frameMat);
      jamb.position.set(DOOR_AT.x, 1.25, DOOR_AT.z + sx);
      root.add(jamb);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 1.85), frameMat);
    lintel.position.set(DOOR_AT.x, 2.5, DOOR_AT.z);
    root.add(lintel);
    const light = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 2.4), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    light.position.set(DOOR_AT.x, 1.2, DOOR_AT.z);
    light.rotation.y = Math.PI / 2;
    root.add(light);
    const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.3), new THREE.MeshBasicMaterial({ map: labelTexture('EXIT', '#ffffff', '#1f8a3a'), side: THREE.DoubleSide }));
    exitSign.position.set(DOOR_AT.x + 0.1, 2.85, DOOR_AT.z);
    exitSign.rotation.y = Math.PI / 2;
    root.add(exitSign);
    sparkle();
    ctx.narrate(EASY_OUT, 7500, { priority: true });
    walkThroughPortal(ctx, {
      zone: (p) => Math.abs(p.x - DOOR_AT.x) < 0.35 && Math.abs(p.z - DOOR_AT.z) < 0.8 && p.y < CONFIG.PLAYER_HEIGHT + 0.5,
      ref: DOOR_AT.clone(),
    });
    discover('reward:only-up-quit');
  };

  // Clouds: soft blobs drifting around (and well clear of) the tower.
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.85 });
  const puff = new THREE.SphereGeometry(1, 12, 10);
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(puff, cloudMat);
      m.scale.set(2 + Math.random() * 2, 1 + Math.random(), 1.6 + Math.random() * 1.5);
      m.position.set(k * 2.2 - 3, Math.random() * 0.6, Math.random() * 1.5);
      c.add(m);
    }
    const a = (i / 16) * Math.PI * 2;
    const r = 24 + Math.random() * 18;
    c.position.set(4 + Math.cos(a) * r, 8 + Math.random() * 44, -8 + Math.sin(a) * r);
    root.add(c);
    clouds.push(c);
  }

  // ── The button, at the very top (no obstacle: a circle would block the ground
  //    far below too — obstacles have no height) ──
  const top = route[route.length - 1];
  const bpos = new THREE.Vector3(top.x, top.y, top.z - 0.5);
  let pressed = false;
  spawnPedestalButton(root, bpos, () => {
    if (pressed) return;
    pressed = true;
    discover('reward:only-up-top');
    fanfare();
    ctx.narrate(TOP, 6000, { priority: true });
    ctx.after(3500, () => ctx.advance(bpos.clone()));
  });

  // ── Watching the climb: falls, milestones, the sky, the spinner ──
  let peak = 0; // highest foot height since you last stood on something
  let best = 0; // highest you have ever stood
  let fallCool = 0;
  let fallLine = 0;
  let milestone = 0;
  let saidBottom = false;
  let floating = false;
  let saidFloat = false;
  let t = 0;
  addUpdater((dt) => {
    t += dt;
    fallCool -= dt;
    const foot = ctx.camera.position.y - CONFIG.PLAYER_HEIGHT;
    if (!isGrounded()) peak = Math.max(peak, foot);
    else {
      const drop = peak - foot;
      if (drop > LONG_FALL) {
        thud();
        if (++bigFalls === QUIT_FALLS) openQuitDoor();
        if (drop > 20) discover('reward:only-up-long-fall');
        if (foot < 0.1 && !saidBottom) {
          saidBottom = true;
          ctx.narrate(BOTTOM, 4500, { priority: true });
        } else if (fallCool <= 0) {
          fallCool = 12;
          ctx.narrate(FALLS[fallLine++ % FALLS.length], 4500, { priority: true });
        }
      }
      peak = foot;
      best = Math.max(best, foot);
      const li = ledgeUnder(ctx.camera.position.x, ctx.camera.position.z, foot);
      if (li > reached) {
        reached = li;
        ctx.narrate(LEDGES[Math.min(li, LEDGES.length - 1)], 5500);
      }
      while (milestone < MILESTONES.length && best >= (milestone + 1) * 10) {
        ctx.narrate(MILESTONES[milestone], 4500);
        milestone++;
      }
    }
    // The shadow: on the floor you'd land on, smaller the higher you are over it.
    const px = ctx.camera.position.x;
    const pz = ctx.camera.position.z;
    const under = floorYAt(px, pz, foot, regions);
    shadow.visible = under !== null;
    if (under !== null) {
      shadow.position.set(px, under + 0.03, pz);
      shadow.scale.setScalar(THREE.MathUtils.clamp(1 - (foot - under) * 0.08, 0.45, 1));
    }
    // The sky deepens as you climb.
    const k = THREE.MathUtils.clamp(foot / 45, 0, 1);
    (ctx.scene.background as THREE.Color).copy(skyLow).lerp(skyHigh, k);
    fog.color.copy(ctx.scene.background as THREE.Color);
    for (let i = 0; i < clouds.length; i++) clouds[i].position.x += Math.sin(t * 0.05 + i) * dt * 0.3;
    // Holding the spinner: you drift down instead of dropping.
    const spin = ctx.isHolding('spinner');
    if (spin !== floating) {
      floating = spin;
      ctx.setJump(spin ? { ...JUMP, maxFall: 2.2 } : JUMP);
    }
    if (floating && !isGrounded() && peak - foot > 2 && !saidFloat) {
      saidFloat = true;
      whoosh();
      ctx.narrate(FLOAT, 4500);
    }
    return pressed && t > 1e9; // (runs for the life of the level)
  });

  ctx.narrate(INTRO, 7000);
}

// ── Props: each one's top face IS its platform (the footprint is the region) ──
const mats = new Map<number, THREE.MeshStandardMaterial>();
function mat(color: number, rough = 0.8, metal = 0): THREE.MeshStandardMaterial {
  const key = color * 7 + Math.round(rough * 10) + metal * 3;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    mats.set(key, m);
  }
  return m;
}
function box(sx: number, sy: number, sz: number, color: number, x = 0, y = 0, z = 0, rough = 0.8, metal = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(color, rough, metal));
  m.position.set(x, y, z);
  return m;
}

function makeProp(p: Plat): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(p.x, p.y, p.z);
  const { sx, sz, thick } = p;
  const alongX = p.dir === 1 || p.dir === 3;
  switch (p.prop) {
    case 'crates': {
      // A stack: the top crate is the footprint; the ones below jut out a bit.
      const n = Math.max(1, Math.round(thick / 0.45));
      const h = thick / n;
      for (let i = 0; i < n; i++) {
        const j = i === 0 ? 0 : (i % 2 ? 0.08 : -0.06);
        g.add(box(sx * (i === 0 ? 1 : 0.94), h - 0.02, sz * (i === 0 ? 1 : 0.94), i % 2 ? 0xa0773f : 0xb58a4c, j, -h / 2 - i * h, -j));
      }
      break;
    }
    case 'vending': {
      g.add(box(sx, thick, sz, 0xc8342c, 0, -thick / 2, 0, 0.5));
      const front = new THREE.Mesh(
        new THREE.PlaneGeometry(sx * 0.6, thick * 0.55),
        new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.2, emissive: 0x1a2a3a }),
      );
      front.position.set(-sx * 0.12, -thick * 0.42, sz / 2 + 0.01);
      g.add(front);
      break;
    }
    case 'trolley': {
      g.add(box(sx, thick * 0.12, sz, 0x3a3a3e, 0, -thick * 0.06, 0, 0.5, 0.4)); // roof
      g.add(box(sx * 0.98, thick * 0.88, sz * 0.96, 0xd0a020, 0, -thick * 0.56, 0, 0.6));
      const win = mat(0x22303c, 0.2);
      const n = Math.max(2, Math.floor((alongX ? sx : sz) / 0.7));
      for (let i = 0; i < n; i++) {
        const u = -0.5 + (i + 0.5) / n;
        const w = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.4 : sx + 0.02, thick * 0.3, alongX ? sz + 0.02 : 0.4), win);
        w.position.set(alongX ? u * sx : 0, -thick * 0.4, alongX ? 0 : u * sz);
        g.add(w);
      }
      break;
    }
    case 'beam': {
      // A queue's brass rail laid flat, on its stanchion bases.
      const len = alongX ? sx : sz;
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 10), mat(0xc9a83a, 0.35, 0.8));
      rail.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
      rail.position.y = -0.06;
      g.add(rail);
      g.add(box(sx, 0.02, sz, 0xa3122a, 0, -0.01, 0, 0.8)); // the velvet runner along the top
      for (const e of [-0.5, 0.5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.05, 14), mat(0xc9a83a, 0.35, 0.8));
        post.position.set(alongX ? e * sx : 0, -0.1, alongX ? 0 : e * sz);
        g.add(post);
      }
      break;
    }
    case 'desk':
      g.add(box(sx, 0.08, sz, 0x6b4a2e, 0, -0.04, 0, 0.6));
      g.add(box(sx * 0.9, thick - 0.08, sz * 0.8, 0x7a5636, 0, -thick / 2 - 0.04, 0));
      g.add(box(0.36, 0.26, 0.04, 0x222222, sx * 0.25, 0.13, -sz * 0.3)); // a monitor, still on
      break;
    case 'bench':
      g.add(box(sx, 0.08, sz, 0x5b3a22, 0, -0.04, 0, 0.6));
      g.add(box(sx * 0.95, thick - 0.08, sz * 0.25, 0x4a2e1a, 0, -thick / 2 - 0.04, -sz * 0.3));
      g.add(box(sx * 0.95, 0.5, 0.08, 0x5b3a22, 0, 0.25, sz / 2 - 0.04)); // the back
      break;
    case 'pedestal': {
      const col = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.8, thick, sz * 0.8), mat(0xf2f0ea, 0.5));
      col.position.y = -thick / 2;
      g.add(col);
      g.add(box(sx, 0.1, sz, 0xe6e2d8, 0, -0.05, 0, 0.5));
      break;
    }
    case 'sofa':
      g.add(box(sx, thick, sz, 0x7a3f5e, 0, -thick / 2, 0, 0.95));
      g.add(box(alongX ? sx : 0.25, 0.45, alongX ? 0.25 : sz, 0x6a3552, alongX ? 0 : sx / 2 - 0.12, 0.22, alongX ? -sz / 2 + 0.12 : 0, 0.95));
      break;
    case 'lift': {
      g.add(box(sx, thick, sz, 0x9aa0a6, 0, -thick / 2, 0, 0.35, 0.7));
      const door = box(sx * 0.02 + 0.02, thick * 0.8, sz * 0.7, 0x6e747a, sx / 2 + 0.01, -thick * 0.5, 0, 0.3, 0.8);
      g.add(door);
      break;
    }
    case 'ladder': {
      const len = alongX ? sx : sz;
      const w = alongX ? sz : sx;
      const railMat = mat(0x8a6a44, 0.8);
      for (const e of [-0.5, 0.5]) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : 0.06, 0.06, alongX ? 0.06 : len), railMat);
        r.position.set(alongX ? 0 : e * (w - 0.06), -0.05, alongX ? e * (w - 0.06) : 0);
        g.add(r);
      }
      const rungs = Math.floor(len / 0.3);
      for (let i = 0; i <= rungs; i++) {
        const u = -len / 2 + (i * len) / rungs;
        const r = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.04 : w, 0.04, alongX ? w : 0.04), railMat);
        r.position.set(alongX ? u : 0, -0.02, alongX ? 0 : u);
        g.add(r);
      }
      break;
    }
    case 'pipe': {
      const len = alongX ? sx : sz;
      const r = (alongX ? sz : sx) / 2;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 16), mat(0x5f7f6a, 0.5, 0.5));
      pipe.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
      pipe.position.y = -r + 0.02;
      g.add(pipe);
      break;
    }
    case 'duck': {
      // A giant rubber duck; its back is the platform (flattened on top).
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), mat(0xf2c418, 0.5));
      body.scale.set(sx, thick, sz);
      body.position.y = -thick * 0.5 + 0.02;
      g.add(body);
      g.add(box(sx * 0.8, 0.04, sz * 0.8, 0xf2c418, 0, -0.02, 0, 0.5)); // the flat of its back
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), mat(0xf2c418, 0.5));
      head.position.set(alongX ? sx * 0.45 : 0, 0.35, alongX ? 0 : -sz * 0.45);
      g.add(head);
      const beak = box(0.3, 0.12, 0.3, 0xe07a1a, head.position.x + (alongX ? 0.4 : 0), 0.3, head.position.z - (alongX ? 0 : 0.4), 0.5);
      g.add(beak);
      break;
    }
    case 'ledge': {
      // A scaffold landing: planks, hazard trim, a post at each corner.
      g.add(box(sx, thick, sz, 0x8a6a44, 0, -thick / 2, 0, 0.9));
      g.add(box(sx + 0.05, 0.05, sz + 0.05, 0xf2c418, 0, -0.03, 0, 0.6));
      for (const [cx, cz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        g.add(box(0.08, 1.0, 0.08, 0x6a6f78, cx * (sx - 0.1), 0.5, cz * (sz - 0.1), 0.4, 0.6));
      }
      break;
    }
    case 'top': {
      g.add(box(sx, thick, sz, 0xf4f4f2, 0, -thick / 2, 0, 0.6));
      const trim = box(sx + 0.06, 0.06, sz + 0.06, 0xc9a86a, 0, -0.04, 0, 0.4, 0.5);
      g.add(trim);
      break;
    }
  }
  if (p.prop !== 'top' && sx * sz > 2.4 && Math.random() < 0.4) {
    // A stray dummy standing on the junk, in a corner, not helping.
    const d = createAsset('dummy') as THREE.Object3D;
    d.scale.setScalar(0.6);
    d.position.set(sx * 0.36, 0, sz * 0.36);
    d.rotation.y = Math.random() * Math.PI * 2;
    g.add(d);
  }
  return g;
}

/** A flat sign texture (the lift's STAFF ONLY, the quit door's EXIT). */
function labelTexture(text: string, fg: string, bg: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const c = canvas.getContext('2d');
  if (c) {
    c.fillStyle = bg;
    c.fillRect(0, 0, 256, 64);
    c.fillStyle = fg;
    c.font = 'bold 36px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 128, 34);
  }
  return new THREE.CanvasTexture(canvas);
}
