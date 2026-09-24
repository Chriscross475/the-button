import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Obstacle } from '../controls/player-camera';
import type { GameContext } from '../game/types';
import { addUpdater } from '../experiences/scheduler';
import { hideRoomShell, groundPlane } from './scaffold';
import { createAsset } from '../assets';
import { spawnPedestalButton } from '../button/pedestal-button';
import { registerInteractable } from '../interactables/system';
import { defineCombine } from '../game/combine';
import { crossingBell, noise, tone, thud, pop, ensureAudio } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { FONT_SIGN } from '../ui/fonts';

// THE TROLLEY PROBLEM — the white room opens onto a flat grey plain. A railway
// runs past, a junction right beside you, a lever. Up the main line, five people
// tied across the rails; up the side line, one. A trolley rumbles in from the
// far distance, and the narrator — a philosophy lecturer who has waited his
// whole career to run this properly — is thrilled.
//
//   • Do nothing: it takes the main line (five).
//   • Pull the lever: the side line (one). Flip it back and forth all you like;
//     what counts is where it points when the trolley reaches the points.
//   • Throw it WHILE the trolley is on the points: multi-track drift. It slews
//     sideways across both lines and takes all six.
//   • Item web: an AXE cuts a group's ropes (they get up and step aside); a DUCK
//     left on the line ahead stops the trolley dead (it bursts into feathers).
//     Nobody hit at all → the reward.
//   • Stand on the line yourself and you're in the problem.
// When it's over the trolley brakes at the end of the line and the button
// rises beside it.

const MAIN_Z = -6; // the main line
const SW_X = 6; // the points: the side line leaves here
const SIDE_DROP = 5; // how far the side line has swung off by the end
const SIDE_RUN = 12; // over this many metres
const START_X = -70; // out in the fog; about 16 s to the people once it rolls
const END_X = 44; // where it brakes to a stop
const SPEED = 6; // m/s
const HALF_LEN = 2.5; // trolley half-length
const HALF_W = 1.1;
const GAUGE = 0.72; // half the rail spacing
const LEVER = new THREE.Vector3(3.2, 0, -3.4);
const FIVE_X = [23.6, 24.9, 26.2, 27.5, 28.8];
const ONE_X = 26.2;

const sideZ = (x: number) => {
  const k = THREE.MathUtils.clamp((x - SW_X) / SIDE_RUN, 0, 1);
  return MAIN_Z - SIDE_DROP * k * k * (3 - 2 * k);
};
const lineZ = (x: number, side: boolean) => (side ? sideZ(x) : MAIN_Z);

const INTRO = vo(
  'Oh, this is wonderful. A trolley. Five people. One person. A lever. I have waited my entire career to run this properly. Take your time. Well. Not that much time.',
);
const ROLLING = vo('Here it comes. No pressure. Well. Some pressure. Five people worth.');
const FIRST_PULL = vo('You touched the lever. Interesting. Keep going. I am taking notes.');
const FLIP_FLOP = vo('Back. And forth. The indecisive answer. Very popular with undergraduates.');
const FIVE = vo('You did nothing. Five. The classic. You let the universe decide, and the universe was a trolley. Noted.');
const ONE = vo('You pulled it. One instead of five. Utilitarian. Clean. You will think about this at three in the morning.');
const DRIFT = vo('No. No no no. Both tracks. All six. That is not an answer. That is a meta answer. I need to sit down.');
const FREED = vo('You cut them loose. That is cheating. It is also correct. Please do not tell the ethics committee.');
const DUCK = vo('A duck. On the line. It stopped. Everybody lives, except the duck, who was, technically, volunteering. That is not in the literature.');
const NOBODY = vo('Nobody. It hit nobody. You solved the trolley problem. Philosophy is over. I have to go and tell everyone.');
const MIXED = vo('Some of them. Not all of them. A compromise. Nobody is happy with a compromise. That is how you know it is one.');
const YOU = vo('You stood on the line. Nobody asked for a seventh option.');
const BUTTON_UP = vo('Right. The button is by the trolley. Do press it. I need a moment.');

// The axe on a group's ropes (the live level wires the hook).
let cutRopes: ((t: { position: THREE.Vector3 }) => void) | null = null;
defineCombine('axe', 'trolley-ropes', (_held, target) => {
  cutRopes?.(target);
  return true; // keep the axe
});

interface Person {
  g: THREE.Group;
  ropes: THREE.Object3D[];
  x: number;
  z: number;
  side: boolean; // on the side line
  state: 'tied' | 'free' | 'gone';
}

export function revealTrolley(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom();
  hideRoomShell(ctx);
  ctx.setBounds({ minX: -40, maxX: 56, minZ: -24, maxZ: 14 });
  // Anything solid placed where you stand would pin you (you can't walk out of an
  // obstacle), so after each solid appears you're nudged clear of every solid.
  const solids: Obstacle[] = [];
  const solid = (o: Obstacle) => {
    ctx.addObstacle(o);
    solids.push(o);
    return o;
  };
  const unstick = () => {
    const c = ctx.camera.position;
    for (let pass = 0; pass < 4; pass++) {
      for (const o of solids) {
        const need = o.radius + CONFIG.PLAYER_RADIUS + 0.05;
        const d = Math.hypot(c.x - o.x, c.z - o.z);
        if (d >= need) continue;
        const nx = d > 1e-4 ? (c.x - o.x) / d : 0;
        const nz = d > 1e-4 ? (c.z - o.z) / d : 1;
        c.x = o.x + nx * need;
        c.z = o.z + nz * need;
      }
    }
  };

  // Sky and fog: flat grey, like a lecture slide. (The white room's fog is
  // still on the scene; set the distances outright.)
  const grey = new THREE.Color(0xc9cac6);
  if (!(ctx.scene.background instanceof THREE.Color)) ctx.scene.background = new THREE.Color(0xf4f4f2);
  const bg = ctx.scene.background as THREE.Color;
  const startBg = bg.clone();
  const fog = new THREE.Fog(0xc9cac6, 45, 190);
  ctx.scene.fog = fog;
  let tb = 0;
  addUpdater((dt) => {
    tb += dt;
    const k = Math.min(1, tb / 1.6);
    const c = startBg.clone().lerp(grey, k);
    bg.copy(c);
    fog.color.copy(c);
    return k >= 1;
  });
  root.add(groundPlane({ color: 0x9a9b96 }));

  // ── Track: sleepers + rails, main line and the side line ──
  const sleeperGeo = new THREE.BoxGeometry(0.24, 0.08, 2.1);
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 1 });
  const railGeo = new THREE.BoxGeometry(1.02, 0.1, 0.08);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x77787c, roughness: 0.35, metalness: 0.8 });
  const sleeperXs: { x: number; z: number; yaw: number }[] = [];
  const railBits: { x: number; z: number; yaw: number }[] = [];
  const yawAt = (x: number, side: boolean) => Math.atan2(-(lineZ(x + 0.5, side) - lineZ(x - 0.5, side)), 1);
  for (let x = -150; x <= END_X + 16; x += 1) {
    sleeperXs.push({ x, z: MAIN_Z, yaw: 0 });
    railBits.push({ x, z: MAIN_Z - GAUGE, yaw: 0 }, { x, z: MAIN_Z + GAUGE, yaw: 0 });
  }
  for (let x = SW_X + 1; x <= END_X + 16; x += 1) {
    const z = sideZ(x);
    const yaw = yawAt(x, true);
    sleeperXs.push({ x: x + 0.5, z: sideZ(x + 0.5), yaw });
    const nx = Math.sin(yaw) * GAUGE; // rail offset, perpendicular to the line
    const nz = Math.cos(yaw) * GAUGE;
    railBits.push({ x: x - nx, z: z - nz, yaw }, { x: x + nx, z: z + nz, yaw });
  }
  const sleepers = new THREE.InstancedMesh(sleeperGeo, sleeperMat, sleeperXs.length);
  const rails = new THREE.InstancedMesh(railGeo, railMat, railBits.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  sleeperXs.forEach((s, i) => sleepers.setMatrixAt(i, m4.compose(new THREE.Vector3(s.x, 0.05, s.z), q.setFromAxisAngle(up, s.yaw), one)));
  railBits.forEach((r, i) => rails.setMatrixAt(i, m4.compose(new THREE.Vector3(r.x, 0.14, r.z), q.setFromAxisAngle(up, r.yaw), one)));
  root.add(sleepers, rails);

  // The points blade: a short rail that swings to the line the lever picks.
  const blade = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.07), railMat);
  const bladePivot = new THREE.Group();
  bladePivot.position.set(SW_X - 2.2, 0.16, MAIN_Z + GAUGE);
  blade.position.x = 1.6;
  bladePivot.add(blade);
  root.add(bladePivot);

  // ── The lever ──
  const leverRoot = new THREE.Group();
  leverRoot.position.copy(LEVER);
  root.add(leverRoot);
  const iron = new THREE.MeshStandardMaterial({ color: 0x2c2d31, roughness: 0.6, metalness: 0.6 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.5), iron);
  base.position.y = 0.175;
  leverRoot.add(base);
  const arm = new THREE.Group();
  arm.position.y = 0.35;
  leverRoot.add(arm);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.1, 10), iron);
  shaft.position.y = 0.55;
  arm.add(shaft);
  const grip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.5 }));
  grip.position.y = 1.12;
  arm.add(grip);
  solid({ x: LEVER.x, z: LEVER.z, radius: 0.4 });
  unstick();
  // A little sign on it: "5 ↑ / 1 ↘" so the stakes are legible.
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 128;
  const g2 = cv.getContext('2d')!;
  g2.fillStyle = '#f2efe6';
  g2.fillRect(0, 0, 256, 128);
  g2.fillStyle = '#1b1a18';
  g2.textAlign = 'center';
  g2.textBaseline = 'middle';
  let px = 56;
  do g2.font = `bold ${px}px ${FONT_SIGN}`;
  while (g2.measureText('STAY = 5   PULL = 1').width > 236 && --px > 10);
  g2.fillText('STAY = 5   PULL = 1', 128, 64);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.33), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
  plate.position.set(0, 0.2, 0.26); // proud of the base's front face
  leverRoot.add(plate);

  // ── The people: tied across the rails ──
  const people: Person[] = [];
  const shirts = [0x3a6fd0, 0xc6452a, 0x3f8a4a, 0xe0b040, 0x7a4ab0, 0xe8e2d0];
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xb89a5e, roughness: 1 });
  const tie = (x: number, side: boolean, k: number) => {
    const z = lineZ(x, side);
    const g = createAsset('dummy') as THREE.Group;
    const shirt = new THREE.MeshStandardMaterial({ color: shirts[k % shirts.length], roughness: 0.8 });
    g.traverse((o) => {
      if (o instanceof THREE.Mesh && o.name !== 'head' && !o.parent?.name?.startsWith('leg')) o.material = shirt;
    });
    // On its back across the line, head away from you (lying: +y → +z… see below).
    g.rotation.set(-Math.PI / 2, 0, 0); // face up; head toward -z
    g.position.set(x, 0.24, z + 0.85);
    root.add(g);
    const ropes: THREE.Object3D[] = [];
    for (const dz of [0.25, 0.85, 1.35]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, 16), ropeMat);
      r.rotation.y = Math.PI / 2;
      r.position.set(x, 0.24, z + 0.85 - dz);
      root.add(r);
      ropes.push(r);
    }
    people.push({ g, ropes, x, z, side, state: 'tied' });
  };
  FIVE_X.forEach((x, k) => tie(x, false, k));
  tie(ONE_X, true, 5);

  // Axe targets on each group's ropes.
  const fiveTarget = { kind: 'trolley-ropes', position: new THREE.Vector3(26.2, 0.3, MAIN_Z), radius: 3.4 };
  const oneTarget = { kind: 'trolley-ropes', position: new THREE.Vector3(ONE_X, 0.3, sideZ(ONE_X)), radius: 1.6 };
  ctx.addTarget(fiveTarget);
  ctx.addTarget(oneTarget);
  let saidFreed = false;
  const free = (p: Person) => {
    if (p.state !== 'tied') return;
    p.state = 'free';
    for (const r of p.ropes) root.remove(r);
    // Get up and step off the line, away from it.
    const away = p.side ? -1 : 1;
    const from = p.g.position.clone();
    const to = new THREE.Vector3(p.x, 0, p.z + away * 3.2);
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      const k = Math.min(1, t / 1.1);
      p.g.rotation.x = THREE.MathUtils.lerp(-Math.PI / 2, 0, Math.min(1, k * 2));
      p.g.rotation.y = away > 0 ? 0 : Math.PI;
      p.g.position.lerpVectors(from, to, k);
      return k >= 1;
    });
  };
  cutRopes = (t) => {
    const group = t === oneTarget ? people.filter((p) => p.side) : people.filter((p) => !p.side);
    if (!group.some((p) => p.state === 'tied')) return;
    thud();
    group.forEach((p, i) => ctx.after(i * 180, () => free(p)));
    discover('mech:trolley-ropes');
    if (!saidFreed) {
      saidFreed = true;
      ctx.narrate(FREED, 6000, { priority: true });
    }
  };

  // ── The trolley ──
  const trolley = new THREE.Group();
  const cream = new THREE.MeshStandardMaterial({ color: 0xefe3c4, roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: 0xa8231c, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x3a4a55, roughness: 0.2, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(HALF_LEN * 2, 1.2, HALF_W * 2), red);
  body.position.y = 1.0;
  trolley.add(body);
  const upper = new THREE.Mesh(new THREE.BoxGeometry(HALF_LEN * 2 - 0.2, 0.9, HALF_W * 2 - 0.1), cream);
  upper.position.y = 2.05;
  trolley.add(upper);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.55), glass);
      w.position.set(-1.65 + i * 1.1, 2.1, side * (HALF_W - 0.03));
      w.rotation.y = side > 0 ? 0 : Math.PI;
      trolley.add(w);
    }
  }
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), glass);
  front.position.set(HALF_LEN - 0.08, 2.1, 0);
  front.rotation.y = Math.PI / 2;
  trolley.add(front);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(HALF_LEN * 2 + 0.2, 0.14, HALF_W * 2 + 0.2), red);
  roof.position.y = 2.57;
  trolley.add(roof);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), iron);
  pole.position.set(-0.6, 3.4, 0);
  pole.rotation.z = -0.9;
  trolley.add(pole);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
  lamp.position.set(HALF_LEN + 0.02, 1.1, 0);
  trolley.add(lamp);
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.14, 14);
  for (const wx of [-1.7, 1.7]) {
    for (const wz of [-GAUGE, GAUGE]) {
      const w = new THREE.Mesh(wheelGeo, iron);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, 0.36, wz);
      trolley.add(w);
    }
  }
  root.add(trolley);

  // ── State ──
  let x = START_X; // trolley centre
  let v = 0;
  let rolling = false;
  let side = false; // where the lever points
  let route: 'main' | 'side' | 'drift' | null = null; // fixed once it reaches the points
  let pulls = 0;
  let hits = 0;
  let over = false;
  let stoppedByDuck = false;
  let youHit = false;
  let rumbleT = 0;
  let driftK = 0; // 0 → 1: slewing sideways across both lines

  const place = () => {
    let z = MAIN_Z;
    let yaw = 0;
    if (route === 'side' || (route === null && side)) {
      z = sideZ(x);
      yaw = yawAt(x, true);
    } else if (route === 'drift') {
      z = MAIN_Z - (SIDE_DROP / 2) * driftK;
      yaw = (Math.PI / 2) * driftK;
    }
    trolley.position.set(x, 0, z);
    trolley.rotation.y = yaw;
  };
  place();

  // The lever.
  let armTo = 0.5;
  registerInteractable({
    id: 'trolley-lever',
    position: new THREE.Vector3(LEVER.x, 1.0, LEVER.z),
    radius: 2.0,
    promptLabel: 'PULL',
    onUse: () => pullLever(),
    tick: (dt) => {
      arm.rotation.x += (armTo - arm.rotation.x) * Math.min(1, dt * 12);
      bladePivot.rotation.y += ((side ? -0.09 : 0) - bladePivot.rotation.y) * Math.min(1, dt * 10);
    },
  });
  function pullLever(): void {
    if (over) return;
    side = !side;
    pulls++;
    armTo = side ? -0.5 : 0.5;
    ensureAudio();
    tone({ type: 'square', from: 180, to: 90, dur: 0.12, gain: 0.08 });
    noise(0.1, 0.1, 900, 'bandpass');
    discover('mech:trolley-lever');
    // On the points right now: it goes both ways at once.
    if (route === null && x + HALF_LEN > SW_X && x - HALF_LEN < SW_X) {
      route = 'drift';
      discover('reward:multi-track-drift');
      tone({ type: 'sawtooth', from: 1400, to: 300, dur: 0.6, gain: 0.07 });
      noise(0.9, 0.18, 3000, 'highpass');
      ctx.narrate(DRIFT, 7000, { priority: true });
      return;
    }
    if (pulls === 1) ctx.narrate(FIRST_PULL, 4000, { priority: true });
    else if (pulls === 4) ctx.narrate(FLIP_FLOP, 4500);
  }

  // Puff: someone hit — a burst of white fluff and confetti, then nothing.
  const puff = (at: THREE.Vector3) => {
    pop();
    const bits: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
    const cols = [0xffffff, 0xf1ece0, 0xffd23f, 0xff4d6d, 0x4dd2ff];
    for (let i = 0; i < 22; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 0.08),
        new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide, transparent: true }),
      );
      m.position.copy(at);
      root.add(m);
      bits.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5) });
    }
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      for (const b of bits) {
        b.v.y -= 6 * dt;
        b.v.multiplyScalar(1 - dt * 1.5);
        b.m.position.addScaledVector(b.v, dt);
        b.m.rotation.x += dt * 7;
        b.m.rotation.z += dt * 5;
        (b.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t / 2.2);
      }
      if (t < 2.2) return false;
      for (const b of bits) root.remove(b.m);
      return true;
    });
  };
  const hitPerson = (p: Person) => {
    if (p.state === 'gone') return;
    const wasTied = p.state === 'tied';
    p.state = 'gone';
    puff(p.g.position.clone().setY(0.6));
    root.remove(p.g);
    for (const r of p.ropes) root.remove(r);
    if (wasTied) hits++;
  };

  // A duck lying on the line ahead (level ducks and carried-in ducks tag
  // themselves; a held duck rides high).
  const duckAhead = (): { x: number; eat: () => void } | null => {
    for (const holder of [root, ctx.scene]) {
      for (const o of holder.children) {
        const ud = o.userData as { kind?: string; onScored?: () => void };
        if (ud.kind !== 'duck' || !ud.onScored || o.position.y > 0.7) continue;
        if (o.position.x < x + HALF_LEN - 0.2) continue; // behind the nose
        const onSide = route === 'side' || (route === null && side && o.position.x > SW_X);
        if (Math.abs(o.position.z - lineZ(o.position.x, onSide)) > 1.3) continue;
        const eat = ud.onScored;
        return { x: o.position.x, eat: () => eat() };
      }
    }
    return null;
  };

  const finish = () => {
    if (over) return;
    over = true;
    rolling = false;
    let line: string;
    if (route === 'drift' && hits > 0)
      line = BUTTON_UP; // the drift line already played
    else if (stoppedByDuck && hits === 0) line = DUCK;
    else if (hits === 0) line = NOBODY;
    else if (hits === 5 && !side) line = FIVE;
    else if (hits === 1) line = ONE;
    else line = MIXED;
    if (hits === 0) discover('reward:trolley-nobody');
    if (line !== BUTTON_UP) ctx.narrate(line, 7000, { priority: true });
    // Solid now it's stopped (two circles along it).
    const yaw = trolley.rotation.y;
    for (const d of [-1.3, 1.3]) {
      solid({ x: trolley.position.x + Math.cos(yaw) * d, z: trolley.position.z - Math.sin(yaw) * d, radius: 1.3 });
    }
    unstick();
    ctx.after(line === BUTTON_UP ? 2500 : 6500, () => {
      // Beside it, on the side away from the other line.
      const at = new THREE.Vector3(trolley.position.x, 0, trolley.position.z + (route === 'side' ? -3.6 : 4.2));
      const pl = ctx.playerPos();
      if (Math.hypot(pl.x - at.x, pl.z - at.z) < 1.3) at.x += pl.x > at.x ? -1.8 : 1.8; // never on top of you
      const btn = spawnPedestalButton(root, at, () => ctx.advance(at.clone()));
      solid(btn.obstacle);
      unstick();
      thud();
      if (line === BUTTON_UP || hits > 0) ctx.narrate(BUTTON_UP, 4000);
    });
  };

  // Intro, then it comes.
  ctx.narrate(INTRO, 9000);
  ctx.after(8500, () => {
    rolling = true;
    crossingBell(0.14);
    ctx.after(350, () => crossingBell(0.14));
    ctx.narrate(ROLLING, 4000);
  });

  addUpdater((dt) => {
    if (!rolling) return over;
    // Brake to a stop at the end of the line.
    const target = x > END_X - 8 ? 0 : SPEED;
    v += THREE.MathUtils.clamp(target - v, -8 * dt, 3 * dt);
    if (x > END_X - 8 && v < 0.05) {
      finish();
      return true;
    }
    // A duck on the line ahead: stops it dead, feathers everywhere.
    const d = duckAhead();
    if (d && x + HALF_LEN + v * dt >= d.x - 0.2) {
      x = d.x - 0.2 - HALF_LEN;
      v = 0;
      d.eat();
      stoppedByDuck = true;
      place();
      finish();
      return true;
    }
    x += v * dt;
    // Reaching the points fixes the route (unless the lever already made it drift).
    if (route === null && x + HALF_LEN >= SW_X + HALF_LEN * 2) route = side ? 'side' : 'main';
    if (route === 'drift') driftK = Math.min(1, driftK + dt * 1.6);
    place();

    // Rumble, louder as it nears.
    rumbleT -= dt;
    if (rumbleT <= 0) {
      rumbleT = 0.28;
      const dist = Math.abs(ctx.playerPos().x - x) + Math.abs(ctx.playerPos().z - trolley.position.z);
      noise(0.22, Math.max(0.01, 0.12 - dist * 0.0012), 220, 'lowpass');
    }

    // Who's under it: along its length / across its width.
    const yaw = trolley.rotation.y;
    const ax = Math.cos(yaw);
    const az = -Math.sin(yaw);
    const under = (px: number, pz: number, pad: number) => {
      const dx = px - trolley.position.x;
      const dz = pz - trolley.position.z;
      return Math.abs(dx * ax + dz * az) < HALF_LEN + pad && Math.abs(-dx * az + dz * ax) < HALF_W + pad;
    };
    for (const p of people) {
      if (p.state === 'gone') continue;
      const pos = p.g.position;
      if (route === 'drift') {
        // Sideways across both lines: whoever is on either line as it passes.
        if (p.state === 'tied' && Math.abs(pos.x - x) < 1.2) hitPerson(p);
      } else if (under(pos.x, pos.z - (p.state === 'tied' ? 0.85 : 0), 0.1)) hitPerson(p);
    }
    const pl = ctx.playerPos();
    if (!youHit && !ctx.isDead() && !ctx.isAirborne() && v > 1 && under(pl.x, pl.z, 0.25)) {
      youHit = true;
      ctx.narrate(YOU, 5000, { priority: true });
      ctx.die('trolley');
    }
    return false;
  });

  trolleyTest.pull = pullLever;
  trolleyTest.state = () => ({ x, v, route, hits, over, side, stoppedByDuck, freed: people.filter((p) => p.state === 'free').length });
  trolleyTest.cut = (which) => cutRopes?.(which === 'one' ? oneTarget : fiveTarget);
}

/** Headless-test hooks. */
export const trolleyTest = {
  pull: () => {},
  state: () => ({ x: 0, v: 0, route: null as string | null, hits: 0, over: false, side: false, stoppedByDuck: false, freed: 0 }),
  cut: (_which: 'five' | 'one') => {},
  SW_X,
  HALF_LEN,
  SPEED,
};
