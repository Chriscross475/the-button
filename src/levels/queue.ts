import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { spawnPedestalButton } from '../button/pedestal-button';
import { tone, noise, ensureAudio, pop, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';

// THE QUEUE FOR THE BUTTON — the white room stays shut, and its back half is a
// velvet-rope switchback full of people, all waiting for THE button at the
// front. Every few seconds the one at the front presses it and is gone, and the
// whole line shuffles forward one step (faster and faster).
//
// Queue honestly: join at the back and shuffle along — bearable, and the
// narrator keeps you company. Or become a queue: people will queue behind
// anyone who stands still with enough confidence. Stand somewhere in the open
// half of the room and, one by one, the people at the back of the real queue
// have doubts, leave it, and line up behind YOU. Walk, and they follow in a
// conga line, spaced like a queue. The real queue drains; walk your own queue
// up the switchback and press the button, entourage and all.
//
// You're tracked by your position ALONG the queue path. If you somehow get
// ahead of people still in it, they turn round, at once, in silence, and stare
// (and the line stops while they do).

const W = CONFIG.ROOM.width; // 11
const D = CONFIG.ROOM.depth; // 13
const HALF_X = W / 2 - 0.2; // walkable x
const LANE_X = 4.65; // lane turn points (x = ±LANE_X)

// Rope lines (z) and which end is open (the gap you turn through).
const ROPES: { z: number; gap: 'left' | 'right' }[] = [
  { z: -0.7, gap: 'right' }, // the outer rope: the way in, at the right
  { z: -2.1, gap: 'left' },
  { z: -3.5, gap: 'right' },
  { z: -4.9, gap: 'left' },
];
const GAP_END = 3.8; // ropes run to x = ∓GAP_END at their open end

// The path along the lane centres, entrance → front.
const PATH = [
  new THREE.Vector2(LANE_X, -1.4),
  new THREE.Vector2(-LANE_X, -1.4),
  new THREE.Vector2(-LANE_X, -2.8),
  new THREE.Vector2(LANE_X, -2.8),
  new THREE.Vector2(LANE_X, -4.2),
  new THREE.Vector2(-LANE_X, -4.2),
  new THREE.Vector2(-LANE_X, -5.6),
  new THREE.Vector2(3.1, -5.6), // the front: next to press
];
const BUTTON = new THREE.Vector3(4.35, 0, -5.75);
const PRESS_SPOT = new THREE.Vector2(3.65, -5.6); // where a person stands to press it
const SLOT = 0.95; // spacing in the line
const CROWD = 20;
const SERVE_START = 2.6; // seconds between presses, at first…
const SERVE_MIN = 0.8; // …speeding up to this
const SERVE_SPEEDUP = 0.85;
const STARE_TIME = 4.5;

const INTRO = vo('A queue. For the button. Of course there is a queue for the button. The end of it is over there. It is always over there.');
const JOIN = vo('You join the back of the queue. Civilised. Slow, but civilised.');
const WAIT_LINES = vo([
  'Somebody at the front is pressing it now. Somebody who is not you.',
  'Shuffle. Shuffle. This is the most exercise any of them have had all year.',
  'It is moving. Technically.',
  'You are nearly there. Relatively. Relative to the start.',
]);
const FOLLOW_HINT = vo('You know, people will queue behind anybody who looks like they know what they are doing. Try standing somewhere. Confidently.');
const FIRST_DEFECTOR = vo('Oh no. Someone has left the queue. To queue behind you. You have not done anything. You are just standing there.');
const FIVE_FOLLOW = vo('Five of them now. They do not know what you are queuing for. Neither do you. It does not seem to matter.');
const MANY_FOLLOW = vo('That is a proper queue. Behind you. The other queue is looking thin. Walk them somewhere. They will follow.');
const TURN_LEADER = vo('The front, with your very own queue behind you. They are waiting for you to press it. Do not make them wait.');
const CUT_FIRST = vo('Nobody says anything. Nobody has to. Everybody saw.');
const CUT_AGAIN = vo(['They are all looking at you again. All of them. At once.', 'Again. They will remember your face. They will describe it to other queues.']);
const NOT_YET = vo('Not yet. There are people in front of you. Real people. Well. Dummies. Still.');
const TURN_HONEST = vo('The front. Your turn. You waited, and nobody will ever thank you for it. So I will. Thank you. Press it.');
const TURN_CUT = vo('The front. Your turn, technically. Twenty eyes are on the back of your head. Press it.');

// ── The path: arc-length, points and tangents along the switchback ──
const SEG_LEN = PATH.slice(1).map((p, i) => p.distanceTo(PATH[i]));
const L = SEG_LEN.reduce((a, b) => a + b, 0);
function pointAt(s: number, out = new THREE.Vector2(), dir = new THREE.Vector2()): { p: THREE.Vector2; dir: THREE.Vector2 } {
  let rem = THREE.MathUtils.clamp(s, 0, L);
  for (let i = 0; i < SEG_LEN.length; i++) {
    if (rem <= SEG_LEN[i] || i === SEG_LEN.length - 1) {
      const a = PATH[i];
      const b = PATH[i + 1];
      dir.subVectors(b, a).normalize();
      out.copy(a).addScaledVector(dir, Math.min(rem, SEG_LEN[i]));
      return { p: out, dir };
    }
    rem -= SEG_LEN[i];
  }
  return { p: out.copy(PATH[PATH.length - 1]), dir };
}
// Where (x,z) sits along the line — or null if it isn't in the line at all.
function project(x: number, z: number): number | null {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  const q = new THREE.Vector2(x, z);
  const t = new THREE.Vector2();
  for (let i = 0; i < SEG_LEN.length; i++) {
    const a = PATH[i];
    const b = PATH[i + 1];
    t.subVectors(b, a);
    const k = THREE.MathUtils.clamp(t.dot(q.clone().sub(a)) / t.lengthSq(), 0, 1);
    const d = q.distanceTo(a.clone().addScaledVector(t, k));
    if (d < best) {
      best = d;
      bestS = acc + k * SEG_LEN[i];
    }
    acc += SEG_LEN[i];
  }
  return best < 0.85 ? bestS : null;
}

interface Person {
  g: THREE.Group;
  head: THREE.Object3D;
  legs: THREE.Object3D[];
  s: number;
  block: { x: number; z: number; radius: number };
  phase: number;
  wasAhead: boolean; // ahead of you in the line, last frame
  gone: boolean;
  // 'line': in the real queue. 'leaving': walking back out along it to join
  // yours. 'follow': in your queue, `rank` places behind you.
  mode: 'line' | 'leaving' | 'follow';
  rank: number;
}

function scratch(): void {
  // A record scratch, then nothing.
  ensureAudio();
  tone({ type: 'sawtooth', from: 900, to: 120, dur: 0.35, gain: 0.08 });
  noise(0.3, 0.12, 2500, 'bandpass');
}
function shuffleSteps(): void {
  ensureAudio();
  for (let i = 0; i < 4; i++) setTimeout(() => noise(0.05, 0.05, 600, 'lowpass'), i * 90 + Math.random() * 40);
}

export function revealQueue(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; its button sinks
  ctx.setBounds({ minX: -HALF_X, maxX: HALF_X, minZ: -D / 2 + 0.2, maxZ: D / 2 - 0.2 });
  // The back half is now rope and people: if you pressed the button from back
  // there, you're standing in it — step out to the front half first.
  const cam = ctx.camera.position;
  if (cam.z < 0.3) cam.z = 0.6;

  // A carpet runner under the queue (a touch above the floor, never coplanar).
  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.6, 6.0),
    new THREE.MeshStandardMaterial({ color: 0x5a2230, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.012, -3.5);
  root.add(carpet);

  // ── Stanchions and ropes (solid: a row of small obstacles along each) ──
  const solids: { x: number; z: number; radius: number }[] = [];
  const solid = (o: { x: number; z: number; radius: number }) => {
    ctx.addObstacle(o);
    solids.push(o);
  };
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a83a, roughness: 0.35, metalness: 0.8 });
  const velvet = new THREE.MeshStandardMaterial({ color: 0xa3122a, roughness: 0.8 });
  const postGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.95, 10);
  const baseGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.05, 16);
  const knobGeo = new THREE.SphereGeometry(0.06, 10, 8);
  const post = (x: number, z: number) => {
    const p = new THREE.Mesh(postGeo, brass);
    p.position.set(x, 0.475, z);
    root.add(p);
    const b = new THREE.Mesh(baseGeo, brass);
    b.position.set(x, 0.025, z);
    root.add(b);
    const k = new THREE.Mesh(knobGeo, brass);
    k.position.set(x, 0.97, z);
    root.add(k);
  };
  const rope = (x0: number, x1: number, z: number, sagTo = 0.72) => {
    const mid = (x0 + x1) / 2;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x0, 0.9, z),
      new THREE.Vector3(mid, sagTo, z),
      new THREE.Vector3(x1, 0.9, z),
    ]);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.025, 6, false), velvet);
    root.add(m);
  };
  for (const r of ROPES) {
    const xa = r.gap === 'left' ? -GAP_END : -HALF_X - 0.2;
    const xb = r.gap === 'left' ? HALF_X + 0.2 : GAP_END;
    // posts every ~1.9 m, ropes between (the unhooked stretch lies on the floor)
    const n = Math.ceil((xb - xa) / 1.9);
    const xs = Array.from({ length: n + 1 }, (_, i) => xa + ((xb - xa) * i) / n);
    for (const x of xs) if (Math.abs(x) < W / 2 - 0.15) post(x, r.z);
    for (let i = 0; i < n; i++) {
      const a = xs[i];
      const b = xs[i + 1];
      rope(a, b, r.z);
    }
    for (let x = xa; x <= xb + 1e-6; x += 0.3) solid({ x, z: r.z, radius: 0.2 });
  }

  // "QUEUE STARTS HERE" by the way in.
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 160;
  const g2 = cv.getContext('2d')!;
  g2.fillStyle = '#1b1a18';
  g2.fillRect(0, 0, 512, 160);
  g2.strokeStyle = '#c9a86a';
  g2.lineWidth = 8;
  g2.strokeRect(10, 10, 492, 140);
  g2.fillStyle = '#f0e2b8';
  g2.textAlign = 'center';
  g2.textBaseline = 'middle';
  let px = 64;
  do g2.font = `italic ${px}px Georgia, serif`;
  while (g2.measureText('Queue starts here  →').width > 450 && --px > 12);
  g2.fillText('Queue starts here  →', 256, 82);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
  sign.position.set(2.9, 1.45, -0.52);
  root.add(sign);
  const signPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 8), brass);
  signPost.position.set(2.9, 0.65, -0.58);
  root.add(signPost);

  // ── The button at the front ──
  let npcPress = false;
  let turnSaid = false;
  let notYetCool = 0;
  let cutEver = false;
  let leaving = false;
  const btn = spawnPedestalButton(root, BUTTON, () => {
    if (npcPress || leaving) return; // (someone in the queue pressing it)
    if (!yourTurn()) {
      if (notYetCool <= 0) {
        notYetCool = 4;
        ctx.narrate(NOT_YET, 4000, { priority: true });
      }
      return;
    }
    leaving = true;
    if (followers.length >= 5) discover('reward:queue-leader');
    else if (!cutEver) discover('reward:queued-honestly');
    sparkle();
    ctx.after(900, () => ctx.advance(BUTTON.clone()));
  });
  solid(btn.obstacle);

  // ── The crowd ──
  const shirts = [0x3a6fd0, 0xc6452a, 0x3f8a4a, 0xe0b040, 0x7a4ab0, 0xe8e2d0, 0x2b2b3a, 0xd0708a];
  const people: Person[] = [];
  const tmpP = new THREE.Vector2();
  const tmpD = new THREE.Vector2();
  for (let k = 0; k < CROWD; k++) {
    const g = createAsset('dummy') as THREE.Group;
    g.scale.setScalar(0.85 + Math.random() * 0.1);
    const shirt = new THREE.MeshStandardMaterial({ color: shirts[k % shirts.length], roughness: 0.8 });
    const trousers = new THREE.MeshStandardMaterial({ color: [0x2a2d36, 0x4a3a2a, 0x1c2433][k % 3], roughness: 0.8 });
    g.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = o.parent?.name?.startsWith('leg') ? trousers : o.name === 'head' ? new THREE.MeshStandardMaterial({ color: 0xd9b08c, roughness: 0.8 }) : shirt;
    });
    root.add(g);
    const s = L - k * SLOT;
    const p: Person = {
      g,
      head: g.getObjectByName('head') as THREE.Object3D,
      legs: [g.getObjectByName('legL') as THREE.Object3D, g.getObjectByName('legR') as THREE.Object3D],
      s,
      block: { x: 0, z: 0, radius: 0.28 },
      phase: Math.random() * 6,
      wasAhead: true,
      gone: false,
      mode: 'line',
      rank: 0,
    };
    const { p: at, dir } = pointAt(s, tmpP, tmpD);
    g.position.set(at.x, 0, at.y);
    g.rotation.y = Math.atan2(dir.x, dir.y);
    p.block.x = at.x;
    p.block.z = at.y;
    ctx.addObstacle(p.block);
    people.push(p);
  }

  // ── State ──
  let youS: number | null = null; // where you are along the line (null: not in it)
  let joined = false;
  let stare = 0; // > 0: everyone is staring at you
  let cuts = 0;
  let serveT = SERVE_START;
  let serveEvery = SERVE_START;
  let serving: Person | null = null;
  let waitT = 0;
  let waitLine = 0;
  let inQueueT = 0;
  let saidHint = false;

  const alive = () => people.filter((p) => !p.gone && p.mode === 'line');
  // Your turn: in the line, nobody ahead of you, and at the front.
  const yourTurn = () => youS !== null && youS > L - 1.6 && !alive().some((p) => p.s > youS!) && !serving;

  const serveFront = () => {
    // The front person steps up, presses THE button, and is gone.
    const front = alive().reduce<Person | null>((a, p) => (!a || p.s > a.s ? p : a), null);
    if (!front || front.s < L - 0.05) return false; // nobody at the front yet
    if (youS !== null && youS > front.s) return false; // that's you
    serving = front;
    const from = front.g.position.clone();
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      if (t < 0.5) {
        const k = t / 0.5;
        front.g.position.set(THREE.MathUtils.lerp(from.x, PRESS_SPOT.x, k), 0, THREE.MathUtils.lerp(from.z, PRESS_SPOT.y, k));
        front.g.rotation.y = Math.atan2(BUTTON.x - front.g.position.x, BUTTON.z - front.g.position.z);
        return false;
      }
      if (t < 0.55) {
        const arm = front.g.getObjectByName('armR') as THREE.Object3D;
        arm.rotation.x = -1.4;
        npcPress = true;
        btn.interactable.onUse(); // the dome goes down, click
        npcPress = false;
        pop();
        return false;
      }
      if (t < 0.8) {
        front.g.scale.setScalar(Math.max(0.01, 0.9 * (1 - (t - 0.55) / 0.25)));
        return false;
      }
      front.gone = true;
      root.remove(front.g);
      ctx.removeObstacle(front.block);
      serving = null;
      shuffleSteps();
      return true;
    });
    return true;
  };

  // ── Your own queue ──
  // Your trail: where you've walked, newest last. Followers stand at 1, 2, 3…
  // queue-slots back along it, so they wind after you like a conga line.
  const trail: THREE.Vector2[] = [];
  const followers: Person[] = [];
  let stillT = 0;
  let defectT = 0;
  let saidFirst = false;
  let saidFive = false;
  let saidMany = false;
  const lastPl = new THREE.Vector2(Number.NaN, 0);
  const trailPoint = (back: number, out: THREE.Vector2) => {
    // `back` metres behind you along the trail (the tail end if it's shorter).
    let rem = back;
    for (let i = trail.length - 1; i > 0; i--) {
      const seg = trail[i].distanceTo(trail[i - 1]);
      if (rem <= seg) return out.lerpVectors(trail[i], trail[i - 1], rem / seg);
      rem -= seg;
    }
    return out.copy(trail[0] ?? out);
  };
  const seedTrail = (x: number, z: number) => {
    // Before you've walked anywhere, the line stretches away from the ropes,
    // toward the front of the room, then along it.
    trail.length = 0;
    const pts: THREE.Vector2[] = [];
    let px = x;
    let pz = z;
    const sx = x > 0 ? -1 : 1;
    for (let i = 0; i < 60; i++) {
      pts.push(new THREE.Vector2(px, pz));
      if (pz < D / 2 - 0.8) pz = Math.min(D / 2 - 0.8, pz + 0.5);
      else px = THREE.MathUtils.clamp(px + sx * 0.5, -HALF_X + 0.4, HALF_X - 0.4);
    }
    trail.push(...pts.reverse()); // oldest first, you last
  };
  const target = new THREE.Vector2();
  addUpdater((dt) => {
    if (leaving) return true;
    const pl = ctx.playerPos();
    const inOpen = pl.z > -0.3; // the open half, not the switchback
    // Your trail, and how long you've stood still.
    if (Number.isNaN(lastPl.x)) lastPl.set(pl.x, pl.z);
    const moved = Math.hypot(pl.x - lastPl.x, pl.z - lastPl.y);
    if (moved > 0.15) {
      if (followers.length > 0) trail.push(new THREE.Vector2(pl.x, pl.z));
      if (trail.length > 400) trail.splice(0, trail.length - 400);
      lastPl.set(pl.x, pl.z);
      stillT = 0;
    } else stillT += dt;

    // Doubts: someone at the back of the real queue decides you're the queue.
    // The first needs you standing still in the open for a moment; after that
    // they keep coming (faster, the longer your queue) until the real one is
    // down to its front two.
    const line = alive().filter((p) => p !== serving);
    const canDefect = line.length > 2 && ((followers.length === 0 && inOpen && stillT > 2.2) || followers.length > 0);
    if (canDefect) {
      defectT -= dt;
      if (defectT <= 0) {
        defectT = Math.max(0.5, 1.3 - followers.length * 0.06);
        const back = line.reduce((a, p) => (p.s < a.s ? p : a));
        if (followers.length === 0) seedTrail(pl.x, pl.z);
        back.mode = 'leaving';
        back.rank = followers.length;
        followers.push(back);
        // Your queue isn't solid to you — turning back into it must never box you in.
        ctx.removeObstacle(back.block);
        discover('mech:queue-follow');
        if (!saidFirst) {
          saidFirst = true;
          ctx.narrate(FIRST_DEFECTOR, 6000, { priority: true });
        } else if (followers.length === 5 && !saidFive) {
          saidFive = true;
          ctx.narrate(FIVE_FOLLOW, 6000);
        } else if (followers.length === 10 && !saidMany) {
          saidMany = true;
          ctx.narrate(MANY_FOLLOW, 6000);
        }
      }
    }

    // Move them: a leaver walks back out along the queue to its entrance, then
    // to its place in your line; a follower keeps to its place, SLOT apart.
    for (const f of followers) {
      if (f.gone) continue;
      let speed = 2.2;
      if (f.mode === 'leaving') {
        if (f.s > 0.05) {
          f.s = Math.max(0, f.s - 2.4 * dt);
          const { p: at } = pointAt(f.s, target, tmpD);
          target.copy(at);
        } else {
          // out through the entrance gap, then off to your line
          target.set(LANE_X, 0.2);
          if (Math.hypot(f.g.position.x - LANE_X, f.g.position.z - 0.2) < 0.2) f.mode = 'follow';
        }
      }
      if (f.mode === 'follow') {
        trailPoint((f.rank + 1) * SLOT, target);
        speed = 2.6;
      }
      const g = f.g.position;
      const dx = target.x - g.x;
      const dz = target.y - g.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, speed * dt);
      if (d > 1e-3) {
        g.x += (dx / d) * step;
        g.z += (dz / d) * step;
        let dy = Math.atan2(dx, dz) - f.g.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        f.g.rotation.y += dy * Math.min(1, dt * 8);
      }
      const walking = step > 1e-3;
      f.phase += walking ? dt * 10 : 0;
      const sw = walking ? Math.sin(f.phase) * 0.45 : 0;
      f.legs[0].rotation.x = sw;
      f.legs[1].rotation.x = -sw;
      f.block.x = g.x;
      f.block.z = g.z;
    }
    return false;
  });

  addUpdater((dt) => {
    notYetCool -= dt;
    const pl = ctx.playerPos();

    // Where are you, along the line?
    const inside = pl.z < -0.7 && pl.z > -D / 2 + 0.2;
    const nowS = inside ? project(pl.x, pl.z) : null;
    if (nowS === null && youS !== null && !inside) {
      // left the line: start over (anyone you'd passed forgets you)
      for (const p of people) p.wasAhead = true;
    }
    youS = nowS;

    if (youS !== null) {
      inQueueT += dt;
      if (!joined) {
        joined = true;
        ctx.narrate(JOIN, 4500, { priority: true });
      }
      // Anyone who was ahead of you and now isn't: you cut them.
      let cutNow = 0;
      for (const p of alive()) {
        const ahead = p.s > youS - 0.05;
        if (p.wasAhead && !ahead) cutNow++;
        p.wasAhead = ahead;
      }
      if (cutNow > 0) {
        cutEver = true;
        if (stare <= 0) {
          scratch();
          ctx.narrate(cuts === 0 ? CUT_FIRST : CUT_AGAIN[(cuts - 1) % CUT_AGAIN.length], 5000, { priority: true });
          cuts++;
        }
        stare = STARE_TIME;
      }
      if (!saidHint && inQueueT > 22 && followers.length === 0) {
        saidHint = true;
        ctx.narrate(FOLLOW_HINT, 6000);
      }
      if (yourTurn() && !turnSaid) {
        turnSaid = true;
        ctx.narrate(followers.length >= 3 ? TURN_LEADER : cutEver ? TURN_CUT : TURN_HONEST, 6000, { priority: true });
      }
    }

    // The line moves (except while it stares): every few seconds, the front
    // person presses the button; everyone behind closes up to their slot.
    if (stare > 0) stare -= dt;
    else if (!leaving) {
      serveT -= dt; // (keeps counting while someone's pressing)
      if (serveT <= 0 && !serving && serveFront()) {
        serveEvery = Math.max(SERVE_MIN, serveEvery * SERVE_SPEEDUP);
        serveT = serveEvery;
        if (youS !== null && !yourTurn()) {
          waitT += serveEvery;
          if (waitT > 9) {
            waitT = 0;
            ctx.narrate(WAIT_LINES[waitLine++ % WAIT_LINES.length], 4000, { interruptible: true });
          }
        }
      }
    }

    // Slots: everyone in the line (you included, if you're in it) by position,
    // front to back; each person closes up to theirs — never past you.
    const order = alive()
      .filter((p) => p !== serving)
      .map((p) => ({ p, s: p.s }));
    const members: { p: Person | null; s: number }[] = [...order];
    if (youS !== null) members.push({ p: null, s: youS });
    members.sort((a, b) => b.s - a.s);
    let rank = serving ? 1 : 0;
    for (const m of members) {
      if (m.p) {
        let slot = L - rank * SLOT;
        if (youS !== null && m.s < youS) slot = Math.min(slot, youS - SLOT); // don't walk into you
        const p = m.p;
        const step = THREE.MathUtils.clamp(slot - p.s, 0, 1.3 * dt);
        p.s += step;
        const moving = step > 1e-4;
        p.phase += moving ? dt * 9 : 0;
        const sw = moving ? Math.sin(p.phase) * 0.45 : 0;
        p.legs[0].rotation.x = sw;
        p.legs[1].rotation.x = -sw;
        const { p: at, dir } = pointAt(p.s, tmpP, tmpD);
        p.g.position.set(at.x, 0, at.y);
        p.block.x = at.x;
        p.block.z = at.y;
        // Facing: along the line — or, while it stares, all at you.
        const along = Math.atan2(dir.x, dir.y);
        const atYou = Math.atan2(pl.x - at.x, pl.z - at.y);
        let dy = (stare > 0 ? atYou : along) - p.g.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        p.g.rotation.y += dy * Math.min(1, dt * (stare > 0 ? 9 : 4));
        p.head.rotation.x = THREE.MathUtils.lerp(p.head.rotation.x, stare > 0 ? -0.1 : 0.05 * Math.sin(p.phase * 0.3), Math.min(1, dt * 6));
      }
      rank++;
    }

    // Never wedged: if anything solid ends up overlapping you (a person closing
    // up, a rope you were already standing on), you're nudged clear.
    if (!ctx.isAirborne()) {
      const c = ctx.camera.position;
      for (const o of [...solids, ...alive().map((p) => p.block)]) {
        const need = o.radius + CONFIG.PLAYER_RADIUS + 0.02;
        const d = Math.hypot(c.x - o.x, c.z - o.z);
        if (d >= need) continue;
        const nx = d > 1e-4 ? (c.x - o.x) / d : 0;
        const nz = d > 1e-4 ? (c.z - o.z) / d : 1;
        c.x = o.x + nx * need;
        c.z = o.z + nz * need;
      }
    }
    return false;
  });

  ctx.narrate(INTRO, 6500);
}

/** Headless-test hooks. */
export const queueTest = { L, pointAt, project };
