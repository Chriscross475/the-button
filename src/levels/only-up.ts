import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { RoomBounds } from '../controls/player-camera';
import { isGrounded } from '../controls/player-camera';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { hideRoomShell, groundPlane } from './scaffold';
import { spawnPedestalButton } from '../button/pedestal-button';
import { createAsset } from '../assets';
import { vo } from '../audio/vo-shared';
import { thud, fanfare, whoosh } from '../audio/sfx';
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

const JUMP = { speed: 6.0, gravity: 20, step: 0.35 }; // apex 0.9 m; ledges catch up to ~1.25 m
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
const TOP = vo('You made it. Forty-odd metres of other people’s furniture. Press it. Chat, he is pressing it.');

type Prop = 'crates' | 'vending' | 'trolley' | 'beam' | 'desk' | 'pedestal' | 'sofa' | 'lift' | 'ladder' | 'duck' | 'pipe' | 'bench' | 'top';
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
// One lap of the spiral (+x, +z, −x, −z legs); repeated, tightening and getting
// meaner, lap by lap.
const LAP: Step[] = [
  [1, 3.0, 1.6, 1.1, 0.6, 'trolley'],
  [1, 1.4, 1.4, 1.2, 0.9, 'crates'],
  [1, 3.2, 0.45, 0.7, 0.3, 'beam'],
  [1, 1.6, 1.0, 0.6, 0.9, 'desk'],
  [2, 1.2, 1.2, 1.2, 0.9, 'pedestal'],
  [2, 2.0, 1.0, 1.0, 0.8, 'sofa'],
  [2, 1.4, 1.4, 1.3, 0.2, 'crates'],
  [2, 1.5, 1.5, 1.0, 1.0, 'lift'],
  [3, 3.0, 0.6, 0.8, 0.4, 'ladder'],
  [3, 1.8, 1.8, 0.9, 0.8, 'duck'],
  [3, 1.2, 1.2, 1.0, 1.0, 'crates'],
  [3, 2.8, 0.6, 0.9, 0.2, 'pipe'],
  [0, 1.4, 1.4, 0.9, 1.0, 'vending'],
  [0, 1.2, 1.2, 1.1, 0.9, 'bench'],
  [0, 1.6, 1.6, 1.2, 0.5, 'crates'],
];
const LAPS = 4;
const SWAP: Partial<Record<Prop, Prop>>[] = [
  {},
  { crates: 'pedestal', trolley: 'lift', sofa: 'desk', duck: 'crates' },
  { crates: 'duck', desk: 'bench', pedestal: 'crates', lift: 'trolley' },
  { crates: 'vending', sofa: 'bench', trolley: 'crates', desk: 'duck' },
];

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
  for (const s of OPENING) plat(s);
  for (let lap = 0; lap < LAPS; lap++) {
    const shrink = 1 - lap * 0.08; // the tower tapers
    for (const [dir, len, wide, gap, rise, prop] of LAP) {
      const tricky = lap * 0.12; // later laps: wider gaps (never past a sure run-jump)…
      const maxGap = sureGap(rise);
      const w = prop === 'beam' || prop === 'ladder' || prop === 'pipe' ? Math.max(0.35, wide - lap * 0.05) : wide * shrink;
      plat([dir, len * shrink, w, Math.min(maxGap, gap + tricky), rise, SWAP[lap][prop] ?? prop]);
    }
  }
  plat([0, 2.4, 2.4, 1.0, 1.0, 'top']);
  return out;
}

// The widest gap a run-jump up `rise` still makes when you take off anywhere in
// the last EARLY metres before the edge: your feet must be within a step of the
// far top while you're over it, on the way down.
const EARLY = 0.35;
function sureGap(rise: number): number {
  const need = rise - JUMP.step; // feet this high over the far edge
  const disc = JUMP.speed * JUMP.speed - 2 * JUMP.gravity * need;
  const tDown = (JUMP.speed + Math.sqrt(Math.max(0, disc))) / JUMP.gravity;
  return Math.min(1.5, CONFIG.MOVE_SPEED * tDown - EARLY - 0.1);
}

// How far each prop's solid part reaches below its top (you can walk under the
// rest). Crates and vending machines stand on the ground on the first leg.
function thickOf(prop: Prop, top: number): number {
  const t: Record<Prop, number> = {
    crates: 0.9, vending: 1.9, trolley: 1.2, beam: 0.12, desk: 0.8, pedestal: 1.0, sofa: 0.6,
    lift: 2.2, ladder: 0.1, duck: 1.4, pipe: 0.5, bench: 0.5, top: 0.4,
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
      while (milestone < MILESTONES.length && best >= (milestone + 1) * 10) {
        ctx.narrate(MILESTONES[milestone], 4500);
        milestone++;
      }
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
