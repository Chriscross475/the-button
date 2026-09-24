import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { defineCombine } from '../game/combine';
import { addUpdater } from '../experiences/scheduler';
import { hideRoomShell, groundPlane } from './scaffold';
import { createAsset } from '../assets';
import { makeMiniButton } from '../objects/original-button';
import { spawnCoin } from '../objects/coin';
import { registerInteractable, unregisterInteractable } from '../interactables/system';
import { setEyeHeight } from '../controls/player-camera';
import { noise, tone, thud, pop, fanfare, ensureAudio } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { CONFIG } from '../config';
import { FONT_VOICE } from '../ui/fonts';

// SISYPHUS — the room opens onto a barren Greek hillside: a long, steady slope
// up to a summit, and at the bottom a huge boulder with THE BUTTON set on top of
// it. The gods have decreed the button may only be pressed at the summit.
//
// Walk into the boulder to push it uphill. Let go on the slope and it rolls back
// (into you — stand there and it flattens you). Just before the summit it ALWAYS
// slips and rolls all the way down, straight over you. "Again."
//
//   • Press the button at any time, anywhere: it's right there on the boulder.
//     The narrator told you not to. The gods are embarrassed.
//   • Jam something under the boulder on the slope (a duck, or a wedge the axe
//     chops off the olive tree): the slip stops at the chock, and the boulder
//     can be pushed onto the summit. Press it there: the proper ending.
//   • Walk up without the boulder: a small shrine with a plaque, and a coin.

// ── The hill (world z runs downhill toward +z; the summit is at -z) ──
const S0 = -4.5; // where the slope starts
const STEPS = 40;
const STEP_D = 0.9;
const STEP_H = 0.25;
const L = STEPS * STEP_D; // 36 m of slope
const H = STEPS * STEP_H; // 10 m high
const TOP_Z = S0 - L; // the summit's edge
const SUMMIT_D = 8;
const HILL_W = 4.5; // half-width of the slope
const hillY = (z: number) => (z >= S0 ? 0 : z <= TOP_Z ? H : ((S0 - z) / L) * H);

// ── The boulder (1D along the hill: u = how far up it has come) ──
const R = 1.25;
const BZ0 = -3; // its z at u = 0
const bz = (u: number) => BZ0 - u;
const U_EDGE = BZ0 - TOP_Z; // centre over the summit's edge
const U_SLIP = U_EDGE - 1.8; // it always slips here…
const U_SUMMIT = U_EDGE + 0.9; // …and past here it's on the summit, for good
const U_MAX = BZ0 - (TOP_Z - SUMMIT_D + 2.2);
const PUSH_SPEED = 1.5;
const GRAVITY = 1.5; // m/s² back down the slope
const FLATTEN_SPEED = 3.2; // rolling back into you this fast flattens you

const INTRO = vo([
  'Greece. A hill. A boulder. The gods, in their wisdom, have decreed that the button may only be pressed at the top of the hill.',
  'Not at the bottom. At the top. Push.',
]);
const LET_GO = vo('Do not let go on the slope. That is the other rule. There are two rules.');
const SLIPS = vo([
  'Again.',
  'Again. Naturally.',
  'It slips. It always slips. That is the whole arrangement.',
  'A Frenchman once said that the struggle itself is enough to fill a heart.',
  'One must imagine you happy.',
  'I am imagining it. It is not easy.',
  'Again.',
]);
const JUST_PRESS = vo('Of course, the button is right there. On the boulder. You could press it now. The gods would never know. The gods would know.');
const FLATTENED = vo('Flattened. By a rock you were holding. Philosophically, this counts as a rest.');
const EARLY = vo('You pressed it at the bottom. You could have done that at any time. The gods are embarrassed. For you, mostly.');
const EARLY_SLOPE = vo('Halfway up a mountain, you press it anyway. The gods did not specify a height. They are furious. Technically, they are also wrong.');
const SUMMIT = vo('The summit. The boulder, at the top, staying there. That has never happened. The gods are checking the paperwork. Press it. Quickly.');
const HELD = vo('It slipped. And stopped. It is sitting on your little chock, looking at you. Push.');
const HELD_LOW = vo('It held. Somewhere down there. Well. It is a start. Push.');
const FLAT_CHOCK = vo('It is flat here. The boulder was not going anywhere. But thank you.');
const WEDGE = vo('You chopped a wedge off a sacred olive tree. That will be on your record. It is a very good wedge.');
const SHRINE = vo('A shrine. The plaque reads: you were supposed to bring the boulder. There is a coin. For the ferryman, presumably. Or for you. Nobody is checking.');

// Hooks the live level installs (combines are global rules).
let chockHook: ((held: Carryable, ctx: GameContext) => boolean) | null = null;
let chopHook: ((ctx: GameContext) => void) | null = null;
const chock = (held: Carryable, _t: unknown, env: { ctx: GameContext }) => {
  if (chockHook?.(held, env.ctx)) {
    env.ctx.removeCarryable(held);
    held.object.removeFromParent();
    return false;
  }
  return true;
};
defineCombine('duck', 'sisyphus-chock', chock);
defineCombine('wedge', 'sisyphus-chock', chock);
defineCombine('axe', 'olive-tree', (_held, _t, env) => {
  chopHook?.(env.ctx);
  return true; // keep the axe
});

function plaqueTexture(lines: string[]): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#d8cfb8';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#8a7a5a';
  g.lineWidth = 10;
  g.strokeRect(8, 8, 496, 240);
  g.fillStyle = '#4a3e2a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = 44;
  do g.font = `${px}px ${FONT_VOICE}`;
  while (lines.some((l) => g.measureText(l).width > 440) && --px > 12);
  lines.forEach((l, i) => g.fillText(l, 256, 128 + (i - (lines.length - 1) / 2) * px * 1.25));
  return new THREE.CanvasTexture(cv);
}

export function revealSisyphus(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom();
  hideRoomShell(ctx);
  ctx.setBounds({ minX: -9, maxX: 9, minZ: TOP_Z - SUMMIT_D - 0.2, maxZ: 9.5, floorY: 0 });
  const regions: { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number }[] = [
    { minX: -9, maxX: 9, minZ: S0 - 0.6, maxZ: 9.5, floorY: 0 }, // the base
  ];
  // The slope, as steps (each overlapping the next by 0.6 m; its floor sits
  // mid-way up the smooth ramp it stands for).
  for (let i = 0; i < STEPS; i++) {
    regions.push({ minX: -HILL_W, maxX: HILL_W, minZ: S0 - (i + 1) * STEP_D - 0.6, maxZ: S0 - i * STEP_D, floorY: (i + 0.5) * STEP_H });
  }
  regions.push({ minX: -HILL_W - 1.5, maxX: HILL_W + 1.5, minZ: TOP_Z - SUMMIT_D, maxZ: TOP_Z, floorY: H }); // the summit
  ctx.setRegions(regions);
  // Thrown things land on the floor where you stand (the engine has one floor
  // height per level; here it follows you up the hill).
  const bounds = ctx.bounds;

  // Sky: a hot, pale Aegean blue, dusty at the horizon.
  const sky = new THREE.Color(0xb9d6ea);
  if (!(ctx.scene.background instanceof THREE.Color)) ctx.scene.background = new THREE.Color(0xf4f4f2);
  const bg = ctx.scene.background as THREE.Color;
  const startBg = bg.clone();
  const fog = new THREE.Fog(0xdcd3bb, 40, 170);
  ctx.scene.fog = fog;
  let tb = 0;
  addUpdater((dt) => {
    tb += dt;
    const k = Math.min(1, tb / 1.6);
    bg.copy(startBg).lerp(sky, k);
    return k >= 1;
  });
  const sun = new THREE.DirectionalLight(0xfff1d6, 0.9);
  sun.position.set(12, 30, 10);
  root.add(sun);
  root.add(new THREE.HemisphereLight(0xcfe4f2, 0xb59a66, 0.45));
  root.add(groundPlane({ color: 0xc2a874 }));

  // ── The hill body: the slope profile, extruded across its width ──
  const rock = new THREE.MeshStandardMaterial({ color: 0xb49a68, roughness: 1, flatShading: true });
  const shape = new THREE.Shape();
  shape.moveTo(S0 + 0.02, 0);
  shape.lineTo(TOP_Z, H);
  shape.lineTo(TOP_Z - SUMMIT_D - 0.2, H);
  shape.lineTo(TOP_Z - SUMMIT_D - 0.2, 0);
  shape.closePath();
  const bodyW = HILL_W * 2 + 3;
  const hill = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: bodyW, bevelEnabled: false }), rock);
  hill.rotation.y = -Math.PI / 2; // shape x → world z, extrusion → world -x
  hill.position.set(bodyW / 2, 0.012, 0); // a touch proud of the ground plane
  root.add(hill);
  // A worn path up the middle.
  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, Math.hypot(L, H)),
    new THREE.MeshStandardMaterial({ color: 0x9c8457, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  path.rotation.x = -Math.PI / 2 - Math.atan2(H, L);
  path.position.set(0, H / 2 + 0.03, S0 - L / 2);
  root.add(path);
  // Rocks, and a few cypresses, for Greece.
  const stone = new THREE.MeshStandardMaterial({ color: 0x9b8e78, roughness: 1, flatShading: true });
  for (const [x, z, s] of [[-6.5, 5, 0.6], [7, -1, 0.8], [-7.2, -3.5, 0.5], [-5.4, -12, 0.7], [5.8, -20, 0.6], [-5.6, -30, 0.9]]) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s), stone);
    r.position.set(x, hillY(z) + s * 0.5, z);
    root.add(r);
  }
  const cypress = new THREE.MeshStandardMaterial({ color: 0x2f4a2a, roughness: 1, flatShading: true });
  for (const [x, z] of [[-14, 2], [-16, -8], [15, -4], [17, -16], [-13, -24]]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.9, 7, 7), cypress);
    c.position.set(x, 3.5, z);
    root.add(c);
  }
  // Two broken columns on the summit.
  const marble = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.7 });
  for (const [x, z, h] of [[-4.6, TOP_Z - 5.5, 2.6], [4.8, TOP_Z - 6.5, 1.4]]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, h, 14), marble);
    col.position.set(x, H + h / 2, z);
    root.add(col);
    ctx.addObstacle({ x, z, radius: 0.5 });
  }

  // ── The shrine, for anyone who comes up empty-handed ──
  const SHRINE_X = 2.6;
  const SHRINE_Z = TOP_Z - 4.2;
  const altar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.0, 0.8), marble);
  altar.position.set(SHRINE_X, H + 0.5, SHRINE_Z);
  root.add(altar);
  ctx.addObstacle({ x: SHRINE_X, z: SHRINE_Z, radius: 0.7 });
  const plaque = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 0.5),
    new THREE.MeshBasicMaterial({ map: plaqueTexture(['YOU WERE SUPPOSED', 'TO BRING', 'THE BOULDER']) }),
  );
  plaque.position.set(SHRINE_X, H + 0.52, SHRINE_Z + 0.415);
  root.add(plaque);
  let shrineSeen = false;

  // ── The olive tree (sacred; the axe takes a wedge off it) ──
  const TREE = new THREE.Vector3(5.6, 0, 2.2);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 1 }));
  trunk.position.set(TREE.x, 1.1, TREE.z);
  trunk.rotation.z = 0.15;
  root.add(trunk);
  const leaves = new THREE.MeshStandardMaterial({ color: 0x7d8a5a, roughness: 1, flatShading: true });
  for (const [dx, dy, dz, s] of [[0.2, 2.4, 0, 1.0], [-0.5, 2.1, 0.3, 0.7], [0.6, 2.0, -0.4, 0.7]]) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), leaves);
    b.position.set(TREE.x + dx, dy, TREE.z + dz);
    root.add(b);
  }
  ctx.addObstacle({ x: TREE.x, z: TREE.z, radius: 0.45 });
  ctx.addTarget({ kind: 'olive-tree', position: new THREE.Vector3(TREE.x, 1, TREE.z), radius: 1.4 });
  let wedges = 0;
  chopHook = (c) => {
    if (c !== ctx || wedges >= 3) return;
    wedges++;
    ensureAudio();
    thud();
    noise(0.12, 0.2, 900, 'bandpass');
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.34, 3), new THREE.MeshStandardMaterial({ color: 0x9a7b52, roughness: 0.9 }));
    w.rotation.x = Math.PI / 2;
    w.position.set(TREE.x - 0.7, 0.14, TREE.z + 0.4);
    root.add(w);
    ctx.addCarryable({
      kind: 'wedge',
      object: w,
      persistent: true,
      heldDist: 0.5,
      heldDrop: 0.25,
      projectile: { radius: 0.15, restitution: 0.2, gravity: 16 },
    });
    if (wedges === 1) ctx.narrate(WEDGE, 5000, { priority: true });
  };

  // ── The boulder, and the button set on top of it ──
  const boulder = new THREE.Mesh(new THREE.IcosahedronGeometry(R, 1), new THREE.MeshStandardMaterial({ color: 0x8c8374, roughness: 1, flatShading: true }));
  root.add(boulder);
  const btn = makeMiniButton();
  btn.scale.setScalar(2.4);
  root.add(btn);
  const block = { x: 0, z: bz(0), radius: R };
  ctx.addObstacle(block);
  let u = 0;
  let v = 0;
  let slipping = false; // the scripted slip, rolling back down through you
  let caught = false; // a chock has caught a slip: the gods give up
  let chockU: number | null = null; // the boulder can't roll back past this
  let chockMesh: THREE.Object3D | null = null;
  let attempts = 0;
  let saidLetGo = false;
  let over = false;
  let squashT = 0;
  const cam = ctx.camera.position;
  // If the reveal caught you where the boulder now sits, step back off it.
  if (Math.hypot(cam.x, cam.z - bz(0)) < R + 0.5) cam.z = bz(0) + R + 0.6;

  const place = () => {
    const z = bz(u);
    boulder.position.set(0, hillY(z) + R * 0.92, z);
    btn.position.set(0, boulder.position.y + R * 0.9, z);
    block.z = z;
  };
  place();

  // One interactable, riding on the boulder (its position follows it).
  const pressable = {
    id: 'sisyphus-button',
    position: new THREE.Vector3(0, 1, bz(0)),
    radius: R + 1.1,
    promptLabel: 'PRESS',
    onUse: () => {
      if (over) return;
      over = true;
      pop();
      btn.position.y -= 0.05;
      if (u >= U_SUMMIT) {
        discover('reward:summit');
        fanfare();
        ctx.narrate(SUMMIT, 6000, { priority: true });
        ctx.after(4500, () => ctx.advance(btn.getWorldPosition(new THREE.Vector3())));
        return;
      }
      if (u < 2) discover('reward:gods-embarrassed');
      ctx.narrate(u < 2 ? EARLY : EARLY_SLOPE, 6000, { priority: true });
      ctx.after(4800, () => ctx.advance(btn.getWorldPosition(new THREE.Vector3())));
    },
  };
  registerInteractable(pressable);

  // The chock: use a duck or a wedge on the boulder, and it's jammed under its
  // downhill side.
  const chockTarget = { kind: 'sisyphus-chock', position: new THREE.Vector3(0, 0, bz(0)), radius: 1.8 };
  ctx.addTarget(chockTarget);
  chockHook = (held, c) => {
    if (c !== ctx || over) return false;
    if (u < 1.6) {
      ctx.narrate(FLAT_CHOCK, 4000, { priority: true });
      return false;
    }
    chockMesh?.removeFromParent();
    const z = bz(u) + R * 0.85;
    if (held.kind === 'duck') {
      const d = createAsset('duck');
      d.scale.set(1, 0.55, 1); // squashed, but game
      chockMesh = d;
    } else {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.34, 3), new THREE.MeshStandardMaterial({ color: 0x9a7b52, roughness: 0.9 }));
      w.rotation.z = Math.PI / 2;
      chockMesh = w;
    }
    chockMesh.position.set(0, hillY(z) + 0.12, z);
    root.add(chockMesh);
    chockU = u - 0.05;
    thud();
    return true;
  };

  const fwd = new THREE.Vector3();
  const slip = () => {
    slipping = true;
    v = -2.4;
    ctx.removeObstacle(block);
    ensureAudio();
    noise(0.6, 0.15, 400, 'lowpass');
    tone({ type: 'sine', from: 180, to: 60, dur: 0.8, gain: 0.08 });
  };

  addUpdater((dt) => {
    if (over) return true;
    const pl = ctx.playerPos();
    bounds.floorY = hillY(pl.z);
    const onSlope = bz(u) < S0 && u < U_SUMMIT;

    // Pushing: walking at it from below, facing uphill, up against it.
    let pushing = false;
    if (!slipping) {
      ctx.camera.getWorldDirection(fwd);
      const d = Math.hypot(pl.x - 0, pl.z - bz(u));
      pushing = pl.z > bz(u) && Math.abs(pl.x) < 1.4 && d < R + CONFIG.PLAYER_RADIUS + 0.25 && ctx.moveInput().y < -0.4 && fwd.z < -0.4;
    }

    if (slipping) {
      v = Math.max(-7, v - GRAVITY * 1.4 * dt);
    } else if (pushing) {
      v += (PUSH_SPEED - v) * Math.min(1, dt * 4);
    } else if (onSlope) {
      v -= GRAVITY * dt;
    } else {
      v *= Math.max(0, 1 - dt * 2.5); // on the flat (base or summit) it coasts to rest
      if (Math.abs(v) < 0.02) v = 0;
    }
    u = Math.min(U_MAX, u + v * dt);

    // The chock: rolling back stops here (and a caught slip ends the curse).
    if (chockU !== null && u < chockU && v < 0) {
      u = chockU;
      v = 0;
      if (slipping) {
        slipping = false;
        caught = true;
        ctx.addObstacle(block);
        thud();
        discover('mech:sisyphus-chock');
        ctx.narrate(chockU > U_SLIP - 8 ? HELD : HELD_LOW, 5000, { priority: true });
      }
    }
    if (u <= 0) {
      u = 0;
      if (v < 0) v = 0;
      if (slipping) {
        slipping = false;
        ctx.addObstacle(block);
        thud();
      }
    }
    // Up to the slip point: it always slips (until a chock has caught one).
    if (!slipping && !caught && u >= U_SLIP && u < U_SUMMIT) {
      attempts++;
      discover('mech:sisyphus-slip');
      slip();
      ctx.narrate(SLIPS[Math.min(attempts - 1, SLIPS.length - 1)], 4000, { priority: true });
      if (attempts === 3) ctx.after(4500, () => ctx.narrate(JUST_PRESS, 7000));
    }
    if (!saidLetGo && onSlope && !pushing && v < -0.6 && !slipping) {
      saidLetGo = true;
      ctx.narrate(LET_GO, 4500, { priority: true });
    }

    const z = bz(u);
    // Rolling back into you: it carries you down; fast enough, it flattens you.
    if (v < 0 && !slipping && pl.z > z && Math.abs(pl.x) < R + 0.2 && pl.z - z < R + CONFIG.PLAYER_RADIUS + 0.05) {
      if (-v > FLATTEN_SPEED && !ctx.isDead()) {
        ctx.narrate(FLATTENED, 5000, { priority: true });
        thud();
        ctx.die('boulder');
        over = true;
        return true;
      }
      cam.z = z + R + CONFIG.PLAYER_RADIUS + 0.06;
    }
    // The slip rolls straight over you: squashed flat for a moment.
    if (slipping && Math.abs(pl.x) < R + 0.2 && Math.abs(pl.z - z) < R * 0.6 && squashT <= 0) {
      squashT = 1.1;
      thud();
      setEyeHeight(0.35);
    }
    if (squashT > 0) {
      squashT -= dt;
      if (squashT <= 0) setEyeHeight(null);
    }

    boulder.rotation.x -= (v * dt) / R; // rolls toward -z as u grows
    place();
    pressable.position.set(0, btn.position.y, z);
    chockTarget.position.set(0, boulder.position.y, z); // aim at the boulder itself

    // The shrine, reached without the boulder.
    if (!shrineSeen && Math.hypot(pl.x - SHRINE_X, pl.z - SHRINE_Z) < 2.6 && u < U_SLIP - 4) {
      shrineSeen = true;
      discover('reward:sisyphus-shrine');
      ctx.narrate(SHRINE, 7000, { priority: true });
      spawnCoin(ctx, new THREE.Vector3(SHRINE_X, H + 1.02, SHRINE_Z));
    }
    return false;
  });
  addUpdater(() => {
    if (!over) return false;
    unregisterInteractable(pressable.id); // pressed (or flattened): no second press
    return true;
  });

  ctx.narrate(INTRO[0], 7000);
  ctx.narrate(INTRO[1], 3000);
}
