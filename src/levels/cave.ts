import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import type { Obstacle } from '../controls/player-camera';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { hideRoomShell } from './scaffold';
import { spawnPedestalButton } from '../button/pedestal-button';
import { registerInteractable } from '../interactables/system';
import { uvInk } from '../objects/uv-torch';
import { tone, noise, ensureAudio, pop, whoosh, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { pick } from '../experiences/util';
import { FONT_SIGN } from '../ui/fonts';

// PLATO'S CAVE — the lights go out and the white room is a cave. You face a
// big pale wall where firelight throws the shadow of THE button, huge and
// perfect. Prisoners sit chained in a row, staring at it, murmuring. Press the
// shadow: it's a wall.
//
// Turn round: a fire, a low wall, and bored men carrying cardboard cut-outs on
// sticks along it — a duck, a train, and the button (the shadows on the wall
// are projected from the fire through whatever stands between it and the wall,
// you included). Behind the fire a passage climbs out into blinding daylight: a
// meadow, and the real button in the sun. Press it to leave.
//
// Extras: steal the cardboard button (a persistent item) and the shadow goes —
// the prisoners panic — hold it up yourself and it's back (you're the puppeteer
// now). Stand close to the fire and your own shadow becomes a giant on the wall.
// Come back from the sun and tell the prisoners: they turn, all at once, and
// stare. The UV torch finds a note on the wall.

const WALL_Z = -7; // the shadow wall's face
const FIRE = new THREE.Vector3(0, 1.5, 6); // the light the shadows come from
const PARAPET_Z = 3.4; // the low wall the carriers walk behind
const PARAPET_H = 1.5; // = fire height, so it shadows everything below it
const CARRY_Z = 4.4; // where the carriers walk
// …to and fro within this of the middle. The fire magnifies ~6.5×, so a cut-out
// only crosses the wall's 14 m while it's within ~1.1 m of the middle.
const CARRY_RANGE = 2.4;
const CAVE = { minX: -6.6, maxX: 6.6, minZ: -6.8, maxZ: 7.6, floorY: 0 };
const TUNNEL_X0 = 3.5;
const TUNNEL_X1 = 5.5;
const STEPS = 12;
const STEP_D = 0.95; // step depth (regions overlap 0.6 m on top of this)
const STEP_H = 0.3;
const TOP_Y = STEPS * STEP_H; // the meadow's floor
const FACE_Z = 18.4; // the hillside the passage comes out of
const REAL_BUTTON = new THREE.Vector3(4.5, TOP_Y, 30);
const SKY = new THREE.Color(0xcfe8ff);
const DARK = new THREE.Color(0x070504);
const GLARE = new THREE.Color(0xffffff);

const INTRO = vo('The lights go out. When they come back, they are firelight. A cave. A wall. And on the wall, the button. Everyone here agrees it is the button.');
const CHAINS = vo('Your chains are open. Nobody locked them. Nobody else has checked theirs.');
const PRESS_SHADOW = vo([
  'You are pressing a shadow. It is a very good shadow.',
  'Nothing. It is a wall. The button on it is excellent, though.',
  'The others are very impressed. None of them has ever pressed it either.',
  'You press the wall again. The wall remains a wall.',
  'A shadow needs a light behind it. Behind. You. Just saying.',
]);
const DAYLIGHT = vo('There is daylight coming from somewhere behind that fire. Somebody should go and look. Somebody like you.');
const TURN = vo('You turn around. Nobody else does. Behind you: a fire, a low wall, and some men with sticks.');
const CARDBOARD = vo('Cardboard. It was cardboard the whole time. The button is a cut-out on a stick, and the man holding it looks bored.');
const STOLEN = vo('The man with the stick looks at his empty stick. Then at you.');
const PANIC = vo('On the wall, the button is gone. The prisoners are not coping.');
const PUPPETEER = vo('The button is back on the wall. You are holding it. You are the man with the stick now.');
const GIANT = vo('A giant has appeared on the wall. The prisoners have never seen anything so big. It is you. Step back, you are frightening them.');
const TUNNEL = vo('A passage, going up. There is light at the end of it, which is either very good news or the other thing.');
const SUN = vo('Daylight. Actual daylight. It hurts. Everything out here is real, and much smaller than its shadow.');
const WITH_CARD = vo('One of these is real. You are holding the other one.');
const PRESS_REAL = vo('The real button. You press it, in the sun, like a philosopher.');
const SHUSH = vo(['They shush you. The good bit is on.', 'Somebody hisses. Not now. The duck is about to come round again.']);
const TELL = vo('You tell them about the sun. They turn around, all at once, and look at you. They did not want to know.');
const TELL_AFTER = vo('They have turned back to the wall. It is a very good wall.');
const TELL_AGAIN = vo('They are not listening. They were never listening.');

// ── Silhouettes: one path per shape, drawn in cardboard or in shadow ──
type Shape = 'button' | 'duck' | 'train' | 'person';
function drawShape(g: CanvasRenderingContext2D, s: Shape): void {
  g.beginPath();
  if (s === 'button') {
    g.rect(70, 226, 116, 22); // base
    g.rect(100, 128, 56, 100); // column
    g.rect(80, 112, 96, 18); // cap
    g.moveTo(84, 112);
    g.arc(128, 112, 44, Math.PI, 0); // dome
  } else if (s === 'duck') {
    g.ellipse(118, 160, 74, 46, 0, 0, Math.PI * 2);
    g.moveTo(206, 104);
    g.arc(176, 104, 30, 0, Math.PI * 2);
    g.moveTo(200, 96);
    g.lineTo(240, 108);
    g.lineTo(200, 118);
    g.moveTo(52, 150);
    g.lineTo(22, 118);
    g.lineTo(62, 172);
  } else if (s === 'train') {
    g.rect(14, 96, 228, 84); // boiler
    g.rect(176, 52, 60, 48); // cab
    g.rect(40, 58, 24, 40); // chimney
    for (const x of [58, 124, 190]) {
      g.moveTo(x + 22, 196);
      g.arc(x, 196, 22, 0, Math.PI * 2);
    }
  } else {
    g.moveTo(158, 36);
    g.arc(128, 36, 30, 0, Math.PI * 2); // head
    g.rect(84, 70, 88, 100); // torso
    g.rect(58, 74, 24, 86); // arms
    g.rect(174, 74, 24, 86);
    g.rect(90, 168, 34, 88); // legs
    g.rect(132, 168, 34, 88);
  }
  g.fill();
}
function shapeTexture(s: Shape, mode: 'shadow' | 'card'): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  if (mode === 'shadow') {
    g.filter = 'blur(4px)'; // firelight: soft edges
    g.fillStyle = '#000';
    drawShape(g, s);
  } else {
    g.fillStyle = '#b48a58';
    drawShape(g, s);
    g.strokeStyle = '#7a5a34';
    g.lineWidth = 5;
    g.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

function murmur(level = 1): void {
  // A row of people going "ooh" under their breath.
  ensureAudio();
  for (let i = 0; i < 4; i++) {
    const f = 150 + Math.random() * 90;
    setTimeout(() => tone({ type: 'sine', from: f, to: f * (0.8 + Math.random() * 0.3), dur: 0.5, gain: 0.025 * level }), i * 90 + Math.random() * 120);
  }
  noise(0.6, 0.02 * level, 400, 'bandpass');
}

interface Caster {
  src: () => THREE.Vector3 | null; // world centre of the thing (null = no shadow)
  size: number; // its real size (the silhouette's square)
  mesh: THREE.Mesh;
}
interface Carrier {
  g: THREE.Group;
  card: THREE.Group;
  x: number;
  dir: number;
  speed: number;
  phase: number;
  block: Obstacle;
}

export function revealCave(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false, dimLights: false });
  hideRoomShell(ctx);
  ctx.scene.background = DARK.clone();
  ctx.scene.fog = new THREE.Fog(DARK.getHex(), 8, 34);

  // ── The lights go out: the room's own lights fade to nothing. ──
  const roomLights: THREE.Light[] = [];
  root.traverse((o) => {
    if ((o as THREE.Light).isLight) roomLights.push(o as THREE.Light);
  });
  const roomStart = roomLights.map((l) => l.intensity);
  let lightsT = 0;
  addUpdater((dt) => {
    lightsT += dt;
    const k = Math.min(1, lightsT / 0.5);
    roomLights.forEach((l, i) => (l.intensity = roomStart[i] * (1 - k)));
    return k >= 1;
  });

  // Where you stood, but in front of the low wall, facing the shadow wall.
  const cam = ctx.camera.position;
  cam.x = THREE.MathUtils.clamp(cam.x, CAVE.minX + 0.6, CAVE.maxX - 0.6);
  cam.z = THREE.MathUtils.clamp(cam.z, CAVE.minZ + 1.5, PARAPET_Z - 1.0);

  // ── Regions: the cave, a stepped passage up, the meadow on top ──
  const regions = [CAVE];
  for (let i = 0; i < STEPS; i++) {
    const z0 = 7.0 + i * STEP_D;
    regions.push({ minX: TUNNEL_X0, maxX: TUNNEL_X1, minZ: z0, maxZ: z0 + STEP_D + 0.6, floorY: (i + 1) * STEP_H });
  }
  const lastEnd = 7.0 + (STEPS - 1) * STEP_D + STEP_D + 0.6;
  regions.push({ minX: -30, maxX: 40, minZ: lastEnd - 0.6, maxZ: 80, floorY: TOP_Y });
  ctx.setRegions(regions);

  // ── Rock ──
  const rock = new THREE.MeshStandardMaterial({ color: 0x4a3c30, roughness: 1, flatShading: true });
  const pale = new THREE.MeshStandardMaterial({ color: 0xcdb892, roughness: 1 });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material = rock) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 16),
    new THREE.MeshStandardMaterial({ color: 0x2e241c, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.012, 0.4);
  root.add(floor);
  box(15, 10, 0.4, 0, 5, WALL_Z - 0.2, pale); // the shadow wall
  box(0.4, 10, 16, -7, 5, 0.4); // sides
  box(0.4, 10, 16, 7, 5, 0.4);
  box(15, 0.4, 16, 0, 9.2, 0.4); // ceiling
  box(TUNNEL_X0 + 7, 10, 0.4, (TUNNEL_X0 - 7) / 2, 5, 8.0); // back wall, split round the passage
  box(7 - TUNNEL_X1, 10, 0.4, (TUNNEL_X1 + 7) / 2, 5, 8.0);
  box(TUNNEL_X1 - TUNNEL_X0, 10 - 3.4, 0.4, (TUNNEL_X0 + TUNNEL_X1) / 2, 3.4 + (10 - 3.4) / 2, 8.0);
  for (let i = 0; i < 26; i++) {
    // boulders along the walls, for a less boxy cave
    const r = createAsset('rock');
    const side = i % 3;
    const s = 1.5 + Math.random() * 2.5;
    r.scale.setScalar(s);
    if (side === 0) r.position.set(-6.8 + Math.random() * 0.4, Math.random() * 7, -6 + Math.random() * 13);
    else if (side === 1) r.position.set(6.6 + Math.random() * 0.4, Math.random() * 7, -6 + Math.random() * 13);
    else r.position.set(-7 + Math.random() * 14, 8.6 + Math.random() * 0.6, -6 + Math.random() * 13);
    root.add(r);
  }

  // The low wall the carriers walk behind (solid: a row of small obstacles).
  box(10, PARAPET_H, 0.3, 0, PARAPET_H / 2, PARAPET_Z);
  for (let x = -5; x <= 5 + 1e-6; x += 0.3) ctx.addObstacle({ x, z: PARAPET_Z, radius: 0.2 });

  // ── The fire ──
  const fire = new THREE.Group();
  fire.position.set(FIRE.x, 0, FIRE.z);
  root.add(fire);
  for (let i = 0; i < 6; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.0, 6), new THREE.MeshStandardMaterial({ color: 0x3a2412, roughness: 1 }));
    log.rotation.set(Math.PI / 2 - 0.4, (i / 6) * Math.PI * 2, 0);
    log.position.y = 0.25;
    fire.add(log);
  }
  const flames: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(
      new THREE.ConeGeometry(0.22 - i * 0.02, 0.9 + Math.random() * 0.4, 7),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffa030 : 0xff6a10, transparent: true, opacity: 0.85 }),
    );
    f.position.set((Math.random() - 0.5) * 0.3, 0.7, (Math.random() - 0.5) * 0.3);
    fire.add(f);
    flames.push(f);
  }
  ctx.addObstacle({ x: FIRE.x, z: FIRE.z, radius: 0.8 });
  const fireLight = new THREE.PointLight(0xffa050, 0, 0, 1.2);
  fireLight.position.copy(FIRE);
  root.add(fireLight);
  const fireAmbient = new THREE.AmbientLight(0x40281a, 0);
  root.add(fireAmbient);
  let fireOn = 0; // 0 → 1 as it catches
  ctx.after(600, () => whoosh());

  // ── Shadows: projected from the fire, through each caster, onto the wall ──
  const casters: Caster[] = [];
  const addCaster = (shape: Shape, size: number, src: Caster['src']) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shapeTexture(shape, 'shadow'), transparent: true, opacity: 0.75, depthWrite: false, fog: false }),
    );
    mesh.renderOrder = 2 + casters.length;
    mesh.visible = false;
    root.add(mesh);
    casters.push({ src, size, mesh });
  };
  // The low wall's own shadow: everything below fire height is in it.
  const bandCv = document.createElement('canvas');
  bandCv.width = 4;
  bandCv.height = 64;
  const bg = bandCv.getContext('2d')!;
  const grad = bg.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.12, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0.7)');
  bg.fillStyle = grad;
  bg.fillRect(0, 0, 4, 64);
  const band = new THREE.Mesh(
    new THREE.PlaneGeometry(14.6, PARAPET_H + 0.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bandCv), transparent: true, depthWrite: false, fog: false }),
  );
  band.position.set(0, (PARAPET_H + 0.2) / 2, WALL_Z + 0.02);
  band.renderOrder = 1;
  root.add(band);

  const proj = new THREE.Vector3();
  const place = (c: Caster, flick: number, i: number) => {
    const at = c.src();
    if (!at || at.z >= FIRE.z - 0.2 || at.z <= WALL_Z) {
      c.mesh.visible = false;
      return 0;
    }
    const t = (FIRE.z - WALL_Z) / (FIRE.z - at.z);
    proj.copy(at).sub(FIRE).multiplyScalar(t).add(FIRE);
    const s = c.size * t * (1 + flick * 0.015);
    c.mesh.visible = fireOn > 0.05 && Math.abs(proj.x) < 7.2 + s / 2 && proj.y + s / 2 > PARAPET_H;
    c.mesh.position.set(proj.x + flick * 0.02 * t, proj.y, WALL_Z + 0.04 + i * 0.004);
    c.mesh.scale.set(s, s, 1);
    (c.mesh.material as THREE.MeshBasicMaterial).opacity = 0.72 * fireOn;
    return t;
  };

  // ── The prisoners: chained in a row, sitting on the floor, facing the wall ──
  const cloth = [0x6b5a44, 0x5c4a3a, 0x7a6a50, 0x4f4336, 0x665544, 0x584c3c];
  const prisoners: { g: THREE.Group; home: number; cower: number }[] = [];
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x5a5a5e, roughness: 0.5, metalness: 0.7 });
  const chain = (x: number, z: number) => {
    for (let k = 0; k < 4; k++) {
      const link = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 10), chainMat);
      link.position.set(x + k * 0.07, 0.04, z + 0.1);
      link.rotation.set(Math.PI / 2, 0, k % 2 ? Math.PI / 2 : 0);
      root.add(link);
    }
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 6), chainMat);
    stake.position.set(x + 0.3, 0.1, z + 0.1);
    root.add(stake);
  };
  const ROW_Z = -0.6;
  [-4.6, -3.3, -2.0, 2.0, 3.3, 4.6].forEach((x, k) => {
    const g = createAsset('dummy') as THREE.Group;
    const shirt = new THREE.MeshStandardMaterial({ color: cloth[k], roughness: 1 });
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = o.name === 'head' ? new THREE.MeshStandardMaterial({ color: 0xc9a07c, roughness: 0.9 }) : shirt;
    });
    // Sat on the floor, legs out in front (toward the wall).
    (g.getObjectByName('legL') as THREE.Object3D).rotation.x = -Math.PI / 2;
    (g.getObjectByName('legR') as THREE.Object3D).rotation.x = -Math.PI / 2;
    g.position.set(x, -0.6, ROW_Z);
    g.rotation.y = Math.PI;
    root.add(g);
    ctx.addObstacle({ x, z: ROW_Z - 0.25, radius: 0.45 });
    chain(x - 0.15, ROW_Z - 0.7);
    prisoners.push({ g, home: Math.PI, cower: 0 });
  });
  chain(-0.15, ROW_Z - 0.7); // the open set in the gap — yours

  // ── The carriers and their cut-outs ──
  const cardMat = (s: Shape) => new THREE.MeshStandardMaterial({ map: shapeTexture(s, 'card'), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 1 });
  const makeCard = (s: Shape, size: number) => {
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.PlaneGeometry(size, size), cardMat(s)));
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 5), stickMat);
    stick.position.y = -size / 2 - 0.4;
    grp.add(stick);
    root.add(grp);
    return grp;
  };
  const carriers: Carrier[] = [];
  const addCarrier = (s: Shape, size: number, x: number, speed: number) => {
    const g = createAsset('dummy') as THREE.Group;
    g.scale.setScalar(0.85);
    const tunic = new THREE.MeshStandardMaterial({ color: 0x2c2420, roughness: 1 });
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = o.name === 'head' ? new THREE.MeshStandardMaterial({ color: 0xb8906c, roughness: 0.9 }) : tunic;
    });
    (g.getObjectByName('armR') as THREE.Object3D).rotation.x = Math.PI - 0.3; // stick held up
    g.position.set(x, 0, CARRY_Z);
    root.add(g);
    const block = { x, z: CARRY_Z, radius: 0.3 };
    ctx.addObstacle(block);
    const c: Carrier = { g, card: makeCard(s, size), x, dir: 1, speed, phase: Math.random() * 6, block };
    carriers.push(c);
    return c;
  };
  const buttonMan = addCarrier('button', 0.45, 0, 0);
  addCarrier('duck', 0.4, -CARRY_RANGE, 0.7);
  addCarrier('train', 0.6, CARRY_RANGE, 0.55).dir = -1;
  let bob = 0; // the button's carrier bobs it (and now and then dips it)
  const cardAt = (c: Carrier, out: THREE.Vector3) => out.set(c.g.position.x + 0.28, 1.95 + (c === buttonMan ? bob : 0), CARRY_Z - 0.35);

  // Cast: every cut-out, you (from the eye down), and the prisoners' heads.
  const tmp = carriers.map(() => new THREE.Vector3());
  carriers.forEach((c, i) => addCaster(c === buttonMan ? 'button' : i === 1 ? 'duck' : 'train', c === buttonMan ? 0.45 : i === 1 ? 0.4 : 0.6, () => c.card.getWorldPosition(tmp[i])));
  const you = new THREE.Vector3();
  addCaster('person', 1.8, () => you.set(cam.x, cam.y - 0.75, cam.z));

  // ── The cardboard button: the thing everybody's been looking at ──
  let stolen = false;
  let heldCard = false;
  let puppeteered = false; // you've held it up to the fire yourself
  const card: Carryable = {
    kind: 'cardboard-button',
    object: buttonMan.card,
    persistent: true,
    heldDist: 0.9,
    heldDrop: -0.12,
    heldRight: 0.3,
    heldUpdate: (_dt, o, q) => o.quaternion.copy(q),
    onGrab: () => {
      heldCard = true;
      if (stolen) return;
      stolen = true;
      pop();
      discover('item:cardboard-button');
      ctx.narrate(STOLEN, 4500, { priority: true });
      ctx.after(2600, () => {
        if (!puppeteered) ctx.narrate(PANIC, 4500);
        murmur(2.2);
      });
    },
    onRelease: () => {
      heldCard = false;
    },
  };
  ctx.addCarryable(card);

  // ── Pressing the shadow (wherever it is on the wall) ──
  let pressN = 0;
  const shadowBtn = casters[0];
  const shadowAt = new THREE.Vector3(0, 1, WALL_Z + 0.4);
  registerInteractable({
    id: 'cave-shadow',
    position: shadowAt,
    radius: 2.2,
    promptLabel: 'PRESS',
    canUse: () => shadowBtn.mesh.visible,
    tick: () => {
      shadowAt.x = shadowBtn.mesh.position.x;
    },
    onUse: () => {
      pop();
      discover('mech:cave-shadow');
      ctx.narrate(PRESS_SHADOW[Math.min(pressN++, PRESS_SHADOW.length - 1)], 4500, { priority: true });
      if (pressN === 3) murmur(1.4);
    },
  });

  // ── Telling the prisoners ──
  let enlightened = false;
  let told = false;
  let stare = 0;
  const nearest = new THREE.Vector3(0, 1, ROW_Z);
  registerInteractable({
    id: 'cave-prisoners',
    position: nearest,
    radius: 1.8,
    promptLabel: 'TELL',
    tick: () => {
      let best = Infinity;
      for (const p of prisoners) {
        const d = Math.hypot(p.g.position.x - cam.x, p.g.position.z - cam.z);
        if (d < best) {
          best = d;
          nearest.set(p.g.position.x, 1, p.g.position.z);
        }
      }
    },
    onUse: () => {
      if (!enlightened) {
        ctx.narrate(pick(SHUSH), 4000, { priority: true });
        return;
      }
      if (told) {
        ctx.narrate(TELL_AGAIN, 4000, { priority: true });
        return;
      }
      told = true;
      stare = 5;
      murmur(1.8);
      discover('reward:cave-told');
      ctx.narrate(TELL, 6500, { priority: true });
      ctx.after(6000, () => ctx.narrate(TELL_AFTER, 4000));
    },
  });

  // The UV torch finds the stage manager's note, under the shadow.
  const noteCv = document.createElement('canvas');
  noteCv.width = 512;
  noteCv.height = 128;
  const ng = noteCv.getContext('2d')!;
  ng.fillStyle = '#c98cff';
  ng.textAlign = 'center';
  ng.textBaseline = 'middle';
  let npx = 64;
  do ng.font = `bold ${npx}px ${FONT_SIGN}`;
  while (ng.measureText("IT'S CARDBOARD. LOOK BEHIND YOU.").width > 480 && --npx > 10);
  ng.fillText("IT'S CARDBOARD. LOOK BEHIND YOU.", 256, 64);
  const note = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(noteCv), fog: false }));
  note.position.set(0, 2.2, WALL_Z + 0.09);
  root.add(note);
  uvInk(note);

  // ── Outside: the hillside, the meadow, the real button ──
  const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x3e3228, roughness: 1, flatShading: true });
  for (let i = 0; i < STEPS; i++) {
    const z0 = 7.0 + i * STEP_D;
    const top = (i + 1) * STEP_H;
    box(TUNNEL_X1 - TUNNEL_X0, top, STEP_D + (i === STEPS - 1 ? 0.6 : 0), (TUNNEL_X0 + TUNNEL_X1) / 2, top / 2, z0 + (STEP_D + (i === STEPS - 1 ? 0.6 : 0)) / 2, tunnelMat);
    box(TUNNEL_X1 - TUNNEL_X0 + 0.4, 0.3, STEP_D + 0.02, (TUNNEL_X0 + TUNNEL_X1) / 2, top + 3.2, z0 + STEP_D / 2, tunnelMat); // ceiling
  }
  box(0.3, 10, FACE_Z - 8, TUNNEL_X0 - 0.15, 5, (FACE_Z + 8) / 2, tunnelMat);
  box(0.3, 10, FACE_Z - 8, TUNNEL_X1 + 0.15, 5, (FACE_Z + 8) / 2, tunnelMat);
  const grassMat = new THREE.MeshStandardMaterial({ color: 0x6fae4a, roughness: 1 });
  const cliff = new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 1, flatShading: true });
  box(TUNNEL_X0 + 16, 10, 0.5, (TUNNEL_X0 - 16) / 2, 5, FACE_Z - 0.25, cliff); // the hillside, round the mouth
  box(16 - TUNNEL_X1, 10, 0.5, (TUNNEL_X1 + 16) / 2, 5, FACE_Z - 0.25, cliff);
  box(TUNNEL_X1 - TUNNEL_X0, 10 - (TOP_Y + 3.2), 0.5, (TUNNEL_X0 + TUNNEL_X1) / 2, TOP_Y + 3.2 + (10 - TOP_Y - 3.2) / 2, FACE_Z - 0.25, cliff);
  const hillTop = new THREE.Mesh(new THREE.PlaneGeometry(32, 28), grassMat);
  hillTop.rotation.x = -Math.PI / 2;
  hillTop.position.set(0, 10, FACE_Z - 14);
  root.add(hillTop);
  const meadow = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), grassMat);
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.set(0, TOP_Y, FACE_Z + 200);
  root.add(meadow);
  const flowerCols = [0xffffff, 0xffe04a, 0xff7ab0, 0xb58cff];
  for (let i = 0; i < 70; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshStandardMaterial({ color: flowerCols[i % 4], roughness: 0.6 }));
    f.position.set(-20 + Math.random() * 45, TOP_Y + 0.12, FACE_Z + 2 + Math.random() * 40);
    root.add(f);
  }
  for (let i = 0; i < 9; i++) {
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.4, 6), new THREE.MeshStandardMaterial({ color: 0x6b4a2a }));
    trunk.position.y = 0.7;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.2, 0), new THREE.MeshStandardMaterial({ color: 0x4f8f3a, flatShading: true }));
    crown.position.y = 2.2;
    tree.add(trunk, crown);
    const x = i % 2 ? -12 - Math.random() * 10 : 16 + Math.random() * 10;
    const z = FACE_Z + 8 + i * 5;
    tree.position.set(x, TOP_Y, z);
    root.add(tree);
    ctx.addObstacle({ x, z, radius: 0.4 });
  }
  const sun = new THREE.DirectionalLight(0xfff4dc, 0);
  sun.position.set(10, 30, 50);
  sun.target.position.set(0, TOP_Y, 30);
  root.add(sun, sun.target);
  const sky = new THREE.HemisphereLight(0xdff0ff, 0x6fae4a, 0);
  root.add(sky);

  let leaving = false;
  const real = spawnPedestalButton(root, REAL_BUTTON, () => {
    if (leaving) return;
    leaving = true;
    sparkle();
    discover('mech:cave-sun');
    ctx.narrate(PRESS_REAL, 4500, { priority: true });
    ctx.after(2200, () => ctx.advance(REAL_BUTTON.clone()));
  });
  ctx.addObstacle(real.obstacle);

  // ── The loop: fire, carriers, shadows, lighting by where you are, beats ──
  let t = 0;
  let murmurT = 4;
  let bobT = 7;
  let saidChains = false;
  let saidTurn = false;
  let saidCard = false;
  let saidTunnel = false;
  let turnT = 0; // seconds since you turned round, until you head up the passage
  let saidDaylight = false;
  let saidSun = false;
  let saidWith = false;
  let giantT = 0;
  let giantDone = false;
  let puppetT = 0;
  const fwd = new THREE.Vector3();
  const fogCol = new THREE.Color();
  ctx.narrate(INTRO, 7000);
  addUpdater((dt) => {
    if (leaving) return true;
    t += dt;

    // The fire catches, then flickers.
    fireOn = Math.min(1, Math.max(0, (t - 0.6) / 1.2));
    const flick = Math.sin(t * 13) * 0.5 + Math.sin(t * 7.3 + 1) * 0.3 + Math.sin(t * 23.1) * 0.2;
    fireLight.intensity = fireOn * 14 * (0.88 + 0.12 * flick);
    fireAmbient.intensity = fireOn * 0.6;
    flames.forEach((f, i) => {
      f.scale.y = 0.85 + 0.25 * Math.sin(t * (9 + i * 2.3) + i);
      f.rotation.y += dt * (1 + i);
    });

    // The button's carrier bobs it, and now and then dips it ("ooh").
    bobT -= dt;
    bob = bobT < 0 && bobT > -0.5 ? -0.12 * Math.sin(((-bobT) / 0.5) * Math.PI) : 0.02 * Math.sin(t * 1.3);
    if (bobT <= -0.5) {
      bobT = 6 + Math.random() * 4;
      if (!stolen) murmur(1);
    }
    for (const c of carriers) {
      if (c.speed > 0) {
        c.x += c.dir * c.speed * dt;
        if (Math.abs(c.x) > CARRY_RANGE) c.dir = -Math.sign(c.x);
        c.g.position.x = c.x;
        c.g.rotation.y = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        c.phase += dt * 8;
        const sw = Math.sin(c.phase) * 0.4;
        (c.g.getObjectByName('legL') as THREE.Object3D).rotation.x = sw;
        (c.g.getObjectByName('legR') as THREE.Object3D).rotation.x = -sw;
      } else if (stolen) {
        // His stick is empty: arm down, and he watches you.
        (c.g.getObjectByName('armR') as THREE.Object3D).rotation.x *= 1 - Math.min(1, dt * 3);
        c.g.rotation.y = Math.atan2(cam.x - c.g.position.x, cam.z - c.g.position.z);
      } else c.g.rotation.y = Math.PI;
      c.block.x = c.g.position.x;
      if (c === buttonMan && stolen) continue;
      cardAt(c, c.card.position);
      c.card.rotation.set(0, 0, 0);
    }

    // Shadows.
    let youT = 0;
    casters.forEach((c, i) => {
      const k = place(c, flick, i);
      if (i === casters.length - 1) youT = k; // you're the last caster
    });

    // Your shadow, huge: stand right up by the low wall.
    const youShadow = casters[casters.length - 1].mesh;
    if (!giantDone && youShadow.visible && youT > 3.4) {
      giantT += dt;
      if (giantT > 1) {
        giantDone = true;
        discover('reward:cave-giant');
        murmur(2.5);
        ctx.narrate(GIANT, 6000, { priority: true });
        for (const p of prisoners) p.cower = 4;
      }
    } else giantT = 0;

    // The cut-out, held up by you, between the fire and the wall.
    if (stolen && heldCard && !puppeteered && shadowBtn.mesh.visible && shadowBtn.mesh.position.y > 2.2) {
      puppetT += dt;
      if (puppetT > 1.5) {
        puppeteered = true;
        discover('reward:cave-puppeteer');
        murmur(1.6);
        ctx.narrate(PUPPETEER, 5500, { priority: true });
      }
    } else puppetT = 0;

    // Prisoners: face the wall — or, while they stare, you — and cower from giants.
    if (stare > 0) stare -= dt;
    for (const p of prisoners) {
      const want = stare > 0 ? Math.atan2(cam.x - p.g.position.x, cam.z - p.g.position.z) : p.home;
      let dy = want - p.g.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.g.rotation.y += dy * Math.min(1, dt * (stare > 0 ? 8 : 2));
      if (p.cower > 0) p.cower -= dt;
      const lean = p.cower > 0 ? 0.35 : stolen && !puppeteered ? 0.12 * Math.sin(t * 6 + p.g.position.x) : 0;
      p.g.rotation.x = THREE.MathUtils.lerp(p.g.rotation.x, lean, Math.min(1, dt * 5));
    }
    murmurT -= dt;
    if (murmurT <= 0) {
      murmurT = 5 + Math.random() * 5;
      if (cam.z < FACE_Z - 4) murmur(stolen && !puppeteered ? 1.8 : 0.8);
    }

    // Moving carriers never wedge you.
    for (const c of carriers) {
      const need = c.block.radius + CONFIG.PLAYER_RADIUS + 0.02;
      const d = Math.hypot(cam.x - c.block.x, cam.z - c.block.z);
      if (d < need && d > 1e-4) {
        cam.x = c.block.x + ((cam.x - c.block.x) / d) * need;
        cam.z = c.block.z + ((cam.z - c.block.z) / d) * need;
      }
    }

    // Light and air by where you are: firelit cave → glare → meadow.
    const kIn = THREE.MathUtils.smoothstep(cam.z, 11, 17.5); // up the passage, it whitens
    const kOut = THREE.MathUtils.smoothstep(cam.z, 19, 25); // out in it, the glare settles
    fogCol.copy(DARK).lerp(GLARE, kIn).lerp(SKY, kOut);
    (ctx.scene.background as THREE.Color).copy(fogCol);
    const fog = ctx.scene.fog as THREE.Fog;
    fog.color.copy(fogCol);
    fog.near = THREE.MathUtils.lerp(THREE.MathUtils.lerp(8, 0.5, kIn), 40, kOut);
    fog.far = THREE.MathUtils.lerp(THREE.MathUtils.lerp(34, 9, kIn), 180, kOut);
    sun.intensity = kIn * THREE.MathUtils.lerp(3.2, 1.6, kOut);
    sky.intensity = kIn * THREE.MathUtils.lerp(2.0, 1.1, kOut);
    fireLight.intensity *= 1 - kIn;

    // Beats.
    ctx.camera.getWorldDirection(fwd);
    if (!saidChains && t > 16 && cam.z < PARAPET_Z) {
      saidChains = true;
      ctx.narrate(CHAINS, 5000);
    }
    if (!saidTurn && t > 4 && fwd.z > 0.6 && cam.z < PARAPET_Z) {
      saidTurn = true;
      saidChains = true;
      discover('mech:cave-fire');
      ctx.narrate(TURN, 5500, { priority: true });
    }
    // Turned round but lingering in the cave: point at the passage, once.
    if (saidTurn && !saidTunnel && !saidDaylight) {
      turnT += dt;
      if (turnT > 30) {
        saidDaylight = true;
        ctx.narrate(DAYLIGHT, 5500);
      }
    }
    if (!saidCard && saidTurn && !stolen && cam.z > PARAPET_Z - 1.3 && fwd.z > 0.3) {
      saidCard = true;
      discover('mech:cave-fire');
      ctx.narrate(CARDBOARD, 6000);
    }
    if (!saidTunnel && cam.z > 8.2) {
      saidTunnel = true;
      ctx.narrate(TUNNEL, 5500);
    }
    if (!saidSun && cam.z > FACE_Z + 1) {
      saidSun = true;
      enlightened = true;
      ctx.narrate(SUN, 6000, { priority: true });
    }
    if (!saidWith && heldCard && Math.hypot(cam.x - REAL_BUTTON.x, cam.z - REAL_BUTTON.z) < 2.6) {
      saidWith = true;
      ctx.narrate(WITH_CARD, 4500, { priority: true });
    }
    return false;
  });
}
