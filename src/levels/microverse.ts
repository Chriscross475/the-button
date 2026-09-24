import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { registerInteractable } from '../interactables/system';
import { spawnPedestalButton } from '../button/pedestal-button';
import { makeMiniButton } from '../objects/original-button';
import { spawnTinyPerson, makeTinyPerson, tinySay, tinySqueak } from '../objects/tiny-person';
import { tone, noise, ensureAudio, pop, thud, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { FONT_SIGN } from '../ui/fonts';

// THE MICROVERSE — the room dims, and the button now sits on a beam across a
// glass tank on a table. Inside the tank lives a tiny civilisation, and the
// glowing button above them is their SUN. Every press is a day: dawn, the crops
// grow, they cheer. The narrator is the landlord of the arrangement: where did
// you think the button's power came from? It's them. They pedal.
//
//   Press it a lot   → they boom: houses, a temple to your hand, skyscrapers,
//                      rockets at the sun — and at the peak they build a button
//                      of their own that switches YOUR lights. Out you go.
//   Stop pressing    → night: candles, then protest signs (PRESS IT). Leave them
//                      long enough and they build a lamp and stop needing you;
//                      a plain button rises from the floor. Out that way.
//   Tap the glass    → an earthquake, panic, and a new religion (a finger statue).
//   Throw something in → it's their monument now (a duck is a mountain-sized
//                      monster they adore). It stays theirs.
//   Lean over the tiny white room in the corner → inside it, tiny people press a
//                      tiny button on a tiny tank… The narrator would rather you didn't.
//   Reach in for the tourist by the glass → a tiny person, to keep.

const W = CONFIG.ROOM.width;
const D = CONFIG.ROOM.depth;
const HX = W / 2 - 0.2;
const HZ = D / 2 - 0.2;

// The table and tank.
const TZ = -1.8; // tank centre z (x = 0)
const TABLE_Y = 0.8;
const TABLE_HW = 1.5; // half extents of the table top
const TABLE_HD = 1.0;
const IN_X = 1.38; // tank inner half extents
const IN_Z = 0.88;
const G = 0.86; // the tiny ground's top
const GLASS_TOP = 1.42;
const BEAM_Y = 1.44;
const SUN = new THREE.Vector3(0, 1.36, TZ); // under the beam
const BTN = new THREE.Vector3(0, BEAM_Y + 0.02, TZ);
const MARGIN = 0.35; // keep the player's body off the table

const TINY_ROOM = new THREE.Vector2(0.78, TZ + 0.5); // front right, where you can lean over it
const TOURIST = new THREE.Vector3(-0.95, G, TZ + 0.72); // by the front glass
const TEMPLE = new THREE.Vector2(-0.85, TZ - 0.45);

const BOOM_AT = 10; // days (presses) to the peak
const DARK_AFTER = 20; // seconds without a press before the sun sets for good
const LAMP_AFTER = 90;

const INTRO = vo('Oh. You found the tank. Do not tap the glass. Right. So. Where did you think the button got its power from? Magic? It is them. Tiny people. They pedal.');
const INTRO_2 = vo('Every time you press it, it is a day for them. The sun comes up. That is you. You are the sun. Terrible job. No holidays.');
const DAY_LINES: Record<number, string> = vo({
  1: 'Morning. The crops grow. They cheer. They always cheer.',
  3: 'They have built houses. Little ones. With little mortgages.',
  5: 'Look. A temple. To a giant hand. That is your hand. Do not let it go to your head.',
  7: 'Skyscrapers. Already. They grow up so fast. A day per press, you see.',
  9: 'Rockets. They are trying to reach the sun. Which is still you. Hold still.',
});
const BOOM = vo('Hang on. They have built a button. A little one. Wired to the light switch. Your light switch. They have figured you out. That is enough science for one day. There is a button by the door. Out you go.');
const DARK_LINES = vo([
  'The sun has not come up. They are waiting. Patiently. For now.',
  'Candles. A vigil. For the sun. Which is you. No pressure.',
  'They have made signs. They are not subtle signs.',
]);
const DAWN_AGAIN = vo('Dawn. They forgive you. They have to. You are the sun.');
const LAMP = vo('They have built a lamp. They do not need you any more. I am so proud. Of them. There is a door. Well. A button. Over there.');
const TAP_LINES = vo([
  'You tapped the glass. That was an earthquake. They have started a new religion. Its god is a finger.',
  'Again. The finger is angry. The finger has priests now.',
  'Please stop. They are running out of prayers.',
]);
const DUCK_IN = vo('A duck. In their world. To them it is a monster the size of a mountain. They love it. They are building it a shrine.');
const COIN_IN = vo('A coin. It is their moon now. They have based an entire economy on it. It is still just the one coin.');
const THING_IN = vo('You dropped something in. It is a monument now. They have a festival about it. It is theirs. You are not getting it back.');
const CITIZEN_BACK = vo('You threw the citizen back. From orbit. He is a legend now. He will never shut up about it.');
const ABDUCT = vo('You have taken a citizen. He is fine. He is confused. He is filing a complaint with nobody.');
const RECURSION = vo('Do not look any closer. It is them all the way down. Well. Us. It is us all the way down.');

// A tiny chorus: a burst of high blips.
function tinyCheer(): void {
  ensureAudio();
  for (let i = 0; i < 10; i++) {
    const f = 2200 + Math.random() * 1400;
    setTimeout(() => tone({ type: 'triangle', from: f, to: f * 1.2, dur: 0.06, gain: 0.035 }), i * 45 + Math.random() * 30);
  }
}
function quake(): void {
  ensureAudio();
  noise(0.6, 0.25, 180, 'lowpass');
  tone({ type: 'sine', from: 70, to: 40, dur: 0.5, gain: 0.2 });
}

interface Citizen {
  x: number;
  z: number;
  tx: number;
  tz: number;
  speed: number;
  hop: number;
  color: THREE.Color;
}

export function revealMicroverse(ctx: GameContext): void {
  const root = ctx.levelRoot;
  // The room stays shut; its lights go down and a desk lamp takes over.
  ctx.openRoom({ walls: [], ceiling: false, dimLights: true });
  ctx.scene.background = new THREE.Color(0x14161c);
  ctx.scene.fog = new THREE.Fog(0x14161c, 14, 40);

  // Walk anywhere but through the table: four strips around it (seams overlap).
  const tx0 = -TABLE_HW - MARGIN;
  const tx1 = TABLE_HW + MARGIN;
  const tz0 = TZ - TABLE_HD - MARGIN;
  const tz1 = TZ + TABLE_HD + MARGIN;
  ctx.setRegions([
    { minX: -HX, maxX: HX, minZ: tz1, maxZ: HZ, floorY: 0 },
    { minX: -HX, maxX: HX, minZ: -HZ, maxZ: tz0, floorY: 0 },
    { minX: -HX, maxX: tx0, minZ: -HZ, maxZ: HZ, floorY: 0 },
    { minX: tx1, maxX: HX, minZ: -HZ, maxZ: HZ, floorY: 0 },
  ]);
  const cam = ctx.camera.position;
  if (cam.x > tx0 && cam.x < tx1 && cam.z > tz0 && cam.z < tz1) cam.z = tz1 + 0.4;

  // Light: a dim room, a warm lamp over the table, and their sun.
  const hemi = new THREE.HemisphereLight(0x9aa6c8, 0x2a2622, 0.35);
  root.add(hemi);
  const lamp = new THREE.SpotLight(0xffe2b0, 1.6, 9, 0.7, 0.5, 1.2);
  lamp.position.set(1.8, 3.4, TZ + 1.4);
  lamp.target.position.set(0, TABLE_Y, TZ);
  root.add(lamp, lamp.target);
  const sun = new THREE.PointLight(0xffd27a, 0.7, 3.2, 1.4);
  sun.position.copy(SUN);
  root.add(sun);

  // ── Table + tank ──
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.7 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE_HW * 2, 0.05, TABLE_HD * 2), wood);
  top.position.set(0, TABLE_Y - 0.025, TZ);
  root.add(top);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, TABLE_Y - 0.05, 0.08), wood);
    leg.position.set(lx * (TABLE_HW - 0.1), (TABLE_Y - 0.05) / 2, TZ + lz * (TABLE_HD - 0.1));
    root.add(leg);
  }
  const town = new THREE.Group(); // everything inside the tank (shakes in a quake)
  root.add(town);
  const ground = new THREE.Mesh(new THREE.BoxGeometry(IN_X * 2, G - TABLE_Y, IN_Z * 2), new THREE.MeshStandardMaterial({ color: 0x5f8a4a, roughness: 1 }));
  ground.position.set(0, (TABLE_Y + G) / 2, TZ);
  town.add(ground);
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xcfe6f0, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  const glass: THREE.Mesh[] = [];
  const gh = GLASS_TOP - TABLE_Y;
  const pane = (w: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, gh), glassMat);
    m.position.set(x, TABLE_Y + gh / 2, z);
    m.rotation.y = ry;
    root.add(m);
    glass.push(m);
  };
  pane(IN_X * 2 + 0.04, 0, TZ + IN_Z + 0.02, 0);
  pane(IN_X * 2 + 0.04, 0, TZ - IN_Z - 0.02, 0);
  pane(IN_Z * 2 + 0.04, -IN_X - 0.02, TZ, Math.PI / 2);
  pane(IN_Z * 2 + 0.04, IN_X + 0.02, TZ, Math.PI / 2);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.5, metalness: 0.6 });
  for (const z of [TZ - IN_Z - 0.02, TZ + IN_Z + 0.02]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(IN_X * 2 + 0.08, 0.025, 0.03), frameMat);
    rim.position.set(0, GLASS_TOP, z);
    root.add(rim);
  }
  for (const x of [-IN_X - 0.02, IN_X + 0.02]) {
    const rim = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, IN_Z * 2 + 0.08), frameMat);
    rim.position.set(x, GLASS_TOP, TZ);
    root.add(rim);
  }
  // The beam the button sits on, across the open top.
  const beam = new THREE.Mesh(new THREE.BoxGeometry(IN_X * 2 + 0.1, 0.035, 0.07), frameMat);
  beam.position.set(0, BEAM_Y, TZ);
  root.add(beam);
  const button = makeMiniButton();
  button.scale.setScalar(1.8);
  button.position.copy(BTN);
  root.add(button);
  const dome = button.getObjectByName('dome') as THREE.Mesh;
  const domeMat = dome.material as THREE.MeshStandardMaterial;
  domeMat.emissive = new THREE.Color(0xff5a1a);
  domeMat.emissiveIntensity = 0.5;
  // The sun's face, seen from below: a glowing disc under the beam.
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(0.07, 24), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
  sunDisc.rotation.x = Math.PI / 2;
  sunDisc.position.set(0, BEAM_Y - 0.02, TZ);
  root.add(sunDisc);

  // "DO NOT TAP THE GLASS" on the front, a finger's width off the pane.
  {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 96;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#f2efe6';
    c.fillRect(0, 0, 512, 96);
    c.fillStyle = '#1b1a18';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let px = 44;
    do c.font = `bold ${px}px ${FONT_SIGN}`;
    while (c.measureText('PLEASE DO NOT TAP THE GLASS').width > 480 && --px > 10);
    c.fillText('PLEASE DO NOT TAP THE GLASS', 256, 50);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.11), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
    sign.position.set(0.35, TABLE_Y + 0.12, TZ + IN_Z + 0.035);
    root.add(sign);
  }

  // ── The town ──
  const house = (x: number, z: number, s: number, color: number) => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.045, 0.05), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    b.position.y = 0.0225;
    const r = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.035, 4), new THREE.MeshStandardMaterial({ color: 0x9a3a2a, roughness: 0.8 }));
    r.position.y = 0.062;
    r.rotation.y = Math.PI / 4;
    g.add(b, r);
    g.position.set(x, G, z);
    g.scale.setScalar(s);
    town.add(g);
    return g;
  };
  const houses: THREE.Group[] = [];
  const houseColors = [0xe8dcc2, 0xd8c0a0, 0xc9d6e0, 0xe6d2b8, 0xf0e6d0];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const r = 0.28 + (i % 3) * 0.1;
    const h = house(-0.35 + Math.cos(a) * r * 1.3, TZ + 0.05 + Math.sin(a) * r * 0.9, i < 5 ? 1 : 0.001, houseColors[i % houseColors.length]);
    h.rotation.y = a;
    houses.push(h);
  }
  // Fields with crops (instanced tiny cones), right of the town.
  const crops = new THREE.InstancedMesh(new THREE.ConeGeometry(0.008, 0.03, 5), new THREE.MeshStandardMaterial({ color: 0x9ccf5a, roughness: 0.9 }), 64);
  const cropPos: THREE.Vector2[] = [];
  const soil = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 1 });
  for (let f = 0; f < 4; f++) {
    const fx = 0.3 + (f % 2) * 0.32;
    const fz = TZ - 0.55 + Math.floor(f / 2) * 0.28;
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.006, 0.2), soil);
    patch.position.set(fx, G + 0.003, fz);
    town.add(patch);
    for (let k = 0; k < 16; k++) cropPos.push(new THREE.Vector2(fx - 0.1 + (k % 4) * 0.066, fz - 0.07 + Math.floor(k / 4) * 0.047));
  }
  town.add(crops);
  let cropGrowth = 0.15;
  const m4 = new THREE.Matrix4();
  const q0 = new THREE.Quaternion();
  const v3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const drawCrops = () => {
    for (let i = 0; i < cropPos.length; i++) {
      const h = cropGrowth * (0.8 + ((i * 37) % 10) / 25);
      m4.compose(v3.set(cropPos[i].x, G + 0.006 + 0.015 * h, cropPos[i].y), q0, s3.set(1, Math.max(0.05, h), 1));
      crops.setMatrixAt(i, m4);
    }
    crops.instanceMatrix.needsUpdate = true;
    (crops.material as THREE.MeshStandardMaterial).color.setHSL(0.25 - cropGrowth * 0.12, 0.55, 0.45);
  };
  drawCrops();

  // The temple, with a statue of a giant hand (yours) — built on day 5.
  const stone = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.7 });
  const temple = new THREE.Group();
  temple.position.set(TEMPLE.x, G, TEMPLE.y);
  {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.14), stone);
    base.position.y = 0.01;
    temple.add(base);
    for (let i = 0; i < 6; i++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6), stone);
      col.position.set(-0.08 + (i % 3) * 0.08, 0.05, i < 3 ? -0.05 : 0.05);
      temple.add(col);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.012, 0.15), stone);
    roof.position.y = 0.086;
    temple.add(roof);
    const skin = new THREE.MeshStandardMaterial({ color: 0xd9b08c, roughness: 0.7 });
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.015), skin);
    palm.position.y = 0.13;
    temple.add(palm);
    for (let i = 0; i < 5; i++) {
      const fg = new THREE.Mesh(new THREE.BoxGeometry(0.008, i === 0 ? 0.025 : 0.035, 0.012), skin);
      fg.position.set(i === 0 ? -0.032 : -0.018 + (i - 1) * 0.012, i === 0 ? 0.135 : 0.172, 0);
      if (i === 0) fg.rotation.z = 0.7;
      temple.add(fg);
    }
  }
  temple.scale.setScalar(0.001);
  town.add(temple);

  // Skyscrapers (day 7 on) and rockets (day 9).
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, roughness: 0.3, metalness: 0.5, emissive: 0x223344, emissiveIntensity: 0.4 });
  const towers: { m: THREE.Mesh; h: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.05), towerMat);
    const h = 0.18 + ((i * 53) % 7) * 0.035;
    m.position.set(0.15 + (i % 4) * 0.09, G, TZ + 0.25 + Math.floor(i / 4) * 0.1);
    m.scale.y = 0.001;
    town.add(m);
    towers.push({ m, h });
  }

  // ── The tiny white room (and inside it, a tinier tank) ──
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.9 });
  {
    const tr = new THREE.Group();
    tr.position.set(TINY_ROOM.x, G, TINY_ROOM.y);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.004, 0.22), white);
    floor.position.y = 0.002;
    tr.add(floor);
    for (const [w, x, z] of [[0.22, 0, -0.11], [0.22, 0, 0.11], [0.004, -0.11, 0], [0.004, 0.11, 0]] as [number, number, number][]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w === 0.004 ? 0.004 : w, 0.07, w === 0.004 ? 0.22 : 0.004), white);
      wall.position.set(x, 0.035, z);
      tr.add(wall);
    }
    const tb = makeMiniButton();
    tb.scale.setScalar(0.18);
    tb.position.set(0, 0.004, -0.04);
    tr.add(tb);
    // the tinier tank: a glass cube with a green floor and a speck of a sun
    const tank2 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.035), new THREE.MeshStandardMaterial({ color: 0xcfe6f0, transparent: true, opacity: 0.35, roughness: 0.1 }));
    tank2.position.set(0.04, 0.02, 0.05);
    tr.add(tank2);
    const speck = new THREE.Mesh(new THREE.SphereGeometry(0.0025, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    speck.position.set(0.04, 0.031, 0.05);
    tr.add(speck);
    for (let i = 0; i < 3; i++) {
      const p = makeTinyPerson([0x3f8a4a, 0xc6452a, 0x7a4ab0][i]);
      p.scale.setScalar(0.35);
      p.position.set(-0.05 + i * 0.04, 0.004, 0.0);
      p.name = i === 1 ? 'presser' : '';
      tr.add(p);
    }
    town.add(tr);
  }

  // ── The citizens (instanced bodies + heads) ──
  const N = 44;
  const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.009, 0.012, 0.04, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), N);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.01, 8, 6), new THREE.MeshStandardMaterial({ color: 0xd9b08c, roughness: 0.8 }), N);
  town.add(bodies, heads);
  const shirts = [0x3a6fd0, 0xc6452a, 0x3f8a4a, 0xe0b040, 0x7a4ab0, 0xe8e2d0];
  const people: Citizen[] = [];
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const inTank = (x: number, z: number) => ({ x: THREE.MathUtils.clamp(x, -IN_X + 0.05, IN_X - 0.05), z: THREE.MathUtils.clamp(z, TZ - IN_Z + 0.05, TZ + IN_Z - 0.05) });
  for (let i = 0; i < N; i++) {
    const x = rnd(-0.9, 0.9);
    const z = rnd(TZ - 0.6, TZ + 0.6);
    const c = new THREE.Color(shirts[i % shirts.length]);
    people.push({ x, z, tx: x, tz: z, speed: rnd(0.03, 0.06), hop: 0, color: c });
    bodies.setColorAt(i, c);
  }
  if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
  let mood: 'wander' | 'panic' | 'gather' = 'wander';
  let moodT = 0;
  const gatherAt = new THREE.Vector2();
  const drawPeople = (dt: number) => {
    for (let i = 0; i < N; i++) {
      const p = people[i];
      const d = Math.hypot(p.tx - p.x, p.tz - p.z);
      if (d < 0.01 || (mood === 'panic' && Math.random() < dt * 3)) {
        // a new errand: wander nearby, flee anywhere, or crowd round the gathering point
        let nx: number;
        let nz: number;
        if (mood === 'gather') {
          const a = Math.random() * Math.PI * 2;
          const r = 0.07 + Math.random() * 0.12;
          nx = gatherAt.x + Math.cos(a) * r;
          nz = gatherAt.y + Math.sin(a) * r;
        } else if (mood === 'panic') {
          nx = rnd(-IN_X, IN_X);
          nz = rnd(TZ - IN_Z, TZ + IN_Z);
        } else {
          nx = p.x + rnd(-0.25, 0.25);
          nz = p.z + rnd(-0.2, 0.2);
        }
        const t = inTank(nx, nz);
        p.tx = t.x;
        p.tz = t.z;
      }
      const sp = p.speed * (mood === 'panic' ? 4 : 1);
      const step = Math.min(d, sp * dt);
      if (d > 1e-4) {
        p.x += ((p.tx - p.x) / d) * step;
        p.z += ((p.tz - p.z) / d) * step;
      }
      if (p.hop > 0) p.hop = Math.max(0, p.hop - dt);
      const y = G + Math.abs(Math.sin(p.hop * 14)) * 0.02 * Math.min(1, p.hop * 3);
      m4.compose(v3.set(p.x, y + 0.02, p.z), q0, s3.set(1, 1, 1));
      bodies.setMatrixAt(i, m4);
      m4.compose(v3.set(p.x, y + 0.05, p.z), q0, s3.set(1, 1, 1));
      heads.setMatrixAt(i, m4);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  };
  drawPeople(0);

  // Night things: candles and signs (hidden in daylight).
  const candleMat = new THREE.MeshBasicMaterial({ color: 0xffc860 });
  const candles: THREE.Mesh[] = [];
  for (let i = 0; i < 14; i++) {
    const cnd = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 4), candleMat);
    cnd.visible = false;
    town.add(cnd);
    candles.push(cnd);
  }
  const signTex = (() => {
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 64;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#f7f3e8';
    c.fillRect(0, 0, 128, 64);
    c.fillStyle = '#b3261e';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `bold 34px ${FONT_SIGN}`;
    c.fillText('PRESS IT', 64, 34);
    return new THREE.CanvasTexture(cv);
  })();
  const signs: THREE.Group[] = [];
  for (let i = 0; i < 8; i++) {
    const s = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.05, 4), new THREE.MeshStandardMaterial({ color: 0x7a5a3a }));
    stick.position.y = 0.045;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.02), new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide }));
    board.position.y = 0.075;
    s.add(stick, board);
    s.visible = false;
    town.add(s);
    signs.push(s);
  }

  // ── State ──
  let days = 0;
  let lastPress = 0; // level time of the last press
  let t = 0;
  let sunLevel = 1; // 0 = night, 1 = day
  let flare = 0;
  let darkStage = -1; // how many dark lines said since the last dawn
  let over = false;
  let boomed = false;
  let lamped = false;
  let taps = 0;
  let saidRecursion = false;
  let recursionT = 0;
  let quakeT = 0;
  let fingerBuilt = false;
  const growIn: { o: THREE.Object3D; to: number; t: number }[] = [];
  const grow = (o: THREE.Object3D, to = 1) => growIn.push({ o, to, t: 0 });

  const dawn = () => {
    days++;
    flare = 1;
    lastPress = t;
    if (darkStage >= 0) {
      darkStage = -1;
      ctx.narrate(DAWN_AGAIN, 4000, { priority: true });
    }
    for (const c of candles) c.visible = false;
    for (const s of signs) s.visible = false;
    cropGrowth = Math.min(1, cropGrowth + 0.18);
    drawCrops();
    tinyCheer();
    for (const p of people) p.hop = 0.6 + Math.random() * 0.4;
    // the town grows: more houses, then the temple, the towers, the rockets
    const houseCount = Math.min(houses.length, 5 + days * 2);
    for (let i = 0; i < houseCount; i++) if (houses[i].scale.x < 0.5) grow(houses[i]);
    if (days === 5) grow(temple);
    if (days >= 7) for (const tw of towers) if (tw.m.scale.y < tw.h) grow(tw.m, tw.h);
    if (days >= 9) launchRocket();
    const line = DAY_LINES[days];
    if (line) ctx.narrate(line, 5000);
    if (days === 1) discover('mech:microverse-sun');
    if (days >= BOOM_AT && !boomed) boom();
  };

  const launchRocket = () => {
    const r = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.04, 6), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, emissive: 0xff6020, emissiveIntensity: 0.3 }));
    const x0 = rnd(0.1, 0.45);
    const z0 = TZ + rnd(0.1, 0.4);
    r.position.set(x0, G + 0.02, z0);
    town.add(r);
    let rt = 0;
    let vy = 0.9;
    addUpdater((dt) => {
      rt += dt;
      // up at the sun, bonk on the beam, and back down
      r.position.x += (0 - x0) * dt * 0.8;
      r.position.z += (TZ - z0) * dt * 0.8;
      r.position.y += vy * dt;
      if (r.position.y > BEAM_Y - 0.05 && vy > 0) {
        vy = -0.4;
        r.rotation.z = Math.PI;
        tone({ type: 'square', from: 900, to: 300, dur: 0.06, gain: 0.04 });
      }
      if (vy < 0) vy -= 2 * dt;
      if (r.position.y < G || rt > 4) {
        town.remove(r);
        return true;
      }
      return false;
    });
  };

  // The peak: they build a button of their own, wired to YOUR lights.
  const boom = () => {
    boomed = true;
    over = true;
    discover('reward:microverse-boom');
    const theirs = makeMiniButton(0x2a7fff);
    theirs.scale.setScalar(0.35);
    theirs.position.set(TEMPLE.x, G + 0.09, TEMPLE.y);
    town.add(theirs);
    mood = 'gather';
    gatherAt.set(TEMPLE.x, TEMPLE.y);
    ctx.narrate(BOOM, 9000, { priority: true });
    ctx.after(2600, () => {
      // click… and the lights in YOUR room go out, on, out
      let ft = 0;
      addUpdater((dt) => {
        ft += dt;
        const on = Math.floor(ft * 6) % 2 === 0 && ft < 2.2 ? 0 : 1;
        hemi.intensity = 0.35 * on;
        lamp.intensity = 1.6 * on;
        if (ft > 2.4) {
          hemi.intensity = 0;
          lamp.intensity = 0;
          return true;
        }
        return false;
      });
      tinyCheer();
    });
    // In the dark, the way out: a button by the door, under its own light.
    ctx.after(5200, () => riseExit(true));
  };

  // The exit: a plain pedestal button rising out of the floor by the door.
  // `lit` hangs a small light over it (for when the room lights are out).
  const riseExit = (lit: boolean) => {
    const at = new THREE.Vector3(2.6, 0, 2.2);
    const b = spawnPedestalButton(root, at, () => ctx.advance(at.clone()));
    ctx.addObstacle(b.obstacle);
    if (lit) {
      const spot = new THREE.PointLight(0xfff2c0, 1.4, 4, 1.5);
      spot.position.set(at.x, 2.2, at.z);
      root.add(spot);
    }
    b.group.position.y = -1.1;
    let rt = 0;
    addUpdater((dt) => {
      rt += dt;
      b.group.position.y = Math.min(0, -1.1 + rt * 0.8);
      return rt > 1.5;
    });
  };

  // Night falls if you stop. Long enough, and they build a lamp and move on.
  const night = () => {
    darkStage++;
    ctx.narrate(DARK_LINES[Math.min(darkStage, DARK_LINES.length - 1)], 5000);
    if (darkStage >= 1) for (let i = 0; i < candles.length; i++) {
      const p = people[(i * 3) % N];
      candles[i].position.set(p.x + 0.012, G + 0.01, p.z);
      candles[i].visible = true;
    }
    if (darkStage >= 2) for (const s of signs) s.visible = true;
  };
  const buildLamp = () => {
    lamped = true;
    over = true;
    discover('reward:microverse-lamp');
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 6), frameMat);
    pole.position.set(-0.35, G + 0.1, TZ + 0.05);
    town.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    bulb.position.set(-0.35, G + 0.21, TZ + 0.05);
    town.add(bulb);
    const glow = new THREE.PointLight(0xfff2c0, 0.8, 1.6, 1.5);
    glow.position.copy(bulb.position);
    town.add(glow);
    for (const s of signs) s.visible = false;
    tinyCheer();
    ctx.narrate(LAMP, 7000, { priority: true });
    riseExit(false);
  };

  // Tap the glass: a quake, panic, a religion.
  const tapGlass = () => {
    quake();
    quakeT = 0.9;
    mood = 'panic';
    moodT = 2.5;
    ctx.narrate(TAP_LINES[Math.min(taps, TAP_LINES.length - 1)], 5000, { priority: true });
    taps++;
    discover('mech:microverse-glass');
    if (!fingerBuilt) {
      fingerBuilt = true;
      const skin = new THREE.MeshStandardMaterial({ color: 0xd9b08c, roughness: 0.7 });
      const f = new THREE.Group();
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.04), stone);
      plinth.position.y = 0.01;
      const finger = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, 0.07, 8), skin);
      finger.position.y = 0.055;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), skin);
      tip.position.y = 0.09;
      f.add(plinth, finger, tip);
      f.position.set(-0.55, G, TZ + 0.45);
      f.scale.setScalar(0.001);
      town.add(f);
      ctx.after(2500, () => grow(f));
    }
  };

  // ── One interactable for the tank: the ray from the crosshair decides —
  //    the button (a day), or the glass / anything else (a tap). ──
  const ray = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);
  let pressCool = 0;
  registerInteractable({
    id: 'microverse-tank',
    position: new THREE.Vector3(0, 1.2, TZ),
    radius: 2.4,
    promptLabel: 'PRESS',
    canUse: () => !over,
    onUse: () => {
      if (over || pressCool > 0) return;
      root.updateMatrixWorld(true);
      ray.setFromCamera(centre, ctx.camera);
      const hits = ray.intersectObjects([button, beam, ...glass, ground, top], true);
      const first = hits[0]?.object;
      let o: THREE.Object3D | null = first ?? null;
      while (o && o !== button) o = o.parent;
      if (o === button || (first === beam && hits[0].point.distanceTo(BTN) < 0.25)) {
        pressCool = 0.5;
        pop();
        dome.position.y = 0.03;
        ctx.after(160, () => (dome.position.y = 0.05));
        dawn();
      } else if (first) {
        pressCool = 0.8;
        tapGlass();
      }
    },
  });

  // ── The tourist by the glass: lean in to pick him up ──
  let touristTaken = false;
  const tourist = spawnTinyPerson(ctx, TOURIST.clone(), {
    onGrab: () => {
      if (touristTaken) return;
      touristTaken = true;
      mood = 'panic';
      moodT = 2;
      ctx.narrate(ABDUCT, 5000, { priority: true });
    },
  });
  // Only grabbable while you reach for him — so a press at the button never
  // snatches him by accident.
  ctx.removeCarryable(tourist);
  let touristReachable = false;

  // ── Things thrown in become theirs ──
  const mine = new Set<THREE.Object3D>(root.children);
  mine.add(tourist.object);
  const prevPos = new Map<THREE.Object3D, THREE.Vector3>();
  const taken = new Map<THREE.Object3D, { still: number; last: THREE.Vector3 }>();
  let lastHeld: { left: string | null; right: string | null } = { left: null, right: null };
  let lastThrown: string | null = null;
  const wp = new THREE.Vector3();
  const box = new THREE.Box3();
  const absorb = (o: THREE.Object3D, at: THREE.Vector3) => {
    const kind = o === tourist.object ? 'tiny-person' : lastThrown;
    // The thing itself vanishes (the engine keeps flying it until it settles —
    // then it's parked out of reach); a copy stands in the tank as a monument.
    o.visible = false;
    taken.set(o, { still: 0, last: o.position.clone() });
    const copy = o.clone(true);
    copy.visible = true;
    copy.scale.copy(o.scale);
    copy.rotation.set(0, Math.random() * Math.PI * 2, 0);
    copy.position.set(0, 0, 0);
    box.setFromObject(copy);
    const p = inTank(at.x, at.z);
    copy.position.set(p.x, G - box.min.y, p.z);
    town.add(copy);
    thud();
    quake();
    quakeT = 0.4;
    mood = 'gather';
    moodT = 6;
    gatherAt.set(p.x, p.z);
    ctx.after(1200, sparkle);
    discover('reward:microverse-monument');
    ctx.narrate(kind === 'duck' || kind === 'cooked-duck' ? DUCK_IN : kind === 'coin' ? COIN_IN : kind === 'tiny-person' ? CITIZEN_BACK : THING_IN, 6000, { priority: true });
  };
  const scanThrown = () => {
    const camP = ctx.camera.position;
    const seen = new Set<THREE.Object3D>();
    for (const parent of [ctx.scene, root]) {
      for (const o of parent.children) {
        if ((o as THREE.Light).isLight || o === root || mine.has(o) && o !== tourist.object || taken.has(o) || !o.visible) continue;
        seen.add(o);
        o.getWorldPosition(wp);
        const prev = prevPos.get(o);
        if (!prev) {
          prevPos.set(o, wp.clone());
          continue;
        }
        const moved = wp.distanceTo(prev);
        prev.copy(wp);
        if (moved < 0.02) continue; // not flying
        if (wp.distanceTo(camP) < 1.0) continue; // still in your hand
        if (Math.abs(wp.x) < IN_X && Math.abs(wp.z - TZ) < IN_Z && wp.y < GLASS_TOP + 0.05 && wp.y > G - 0.05) absorb(o, wp.clone());
      }
    }
    for (const o of prevPos.keys()) if (!seen.has(o)) prevPos.delete(o);
    // Park what they took, once it has settled, well out of reach.
    for (const [o, st] of taken) {
      if (o.position.distanceTo(st.last) < 1e-4) st.still++;
      else st.still = 0;
      st.last.copy(o.position);
      if (st.still > 20 && o.position.y > -10) o.position.set(0, -50, TZ);
    }
  };

  // ── Per frame ──
  const fwd = new THREE.Vector3();
  const toRoom = new THREE.Vector3();
  addUpdater((dt) => {
    t += dt;
    pressCool -= dt;
    // who threw what: a kind that just left a hand
    const nowHeld = { left: ctx.heldKind('left'), right: ctx.heldKind('right') };
    for (const side of ['left', 'right'] as const) if (lastHeld[side] && !nowHeld[side]) lastThrown = lastHeld[side];
    lastHeld = nowHeld;
    scanThrown();

    // the sun: flares on a press, sets if you stop
    if (flare > 0) flare = Math.max(0, flare - dt * 0.8);
    const idle = t - lastPress;
    if (!over) {
      const dayTarget = days === 0 ? 0.8 : idle > DARK_AFTER ? 0.05 : 1;
      sunLevel += (dayTarget - sunLevel) * Math.min(1, dt * 0.8);
      if (idle > DARK_AFTER && darkStage < 0 && days + t > 0) night();
      else if (darkStage === 0 && idle > DARK_AFTER + 15) night();
      else if (darkStage === 1 && idle > DARK_AFTER + 32) night();
      if (idle > LAMP_AFTER && !lamped) buildLamp();
    }
    sun.intensity = (lamped ? 0.1 : 0.15 + 0.7 * sunLevel) + flare * 2.2;
    domeMat.emissiveIntensity = 0.2 + 0.5 * sunLevel + flare * 1.2;
    (sunDisc.material as THREE.MeshBasicMaterial).color.setHSL(0.11, 0.9, 0.25 + 0.4 * sunLevel + 0.3 * flare);

    // growth animations
    for (let i = growIn.length - 1; i >= 0; i--) {
      const gI = growIn[i];
      gI.t += dt / 0.7;
      const k = Math.min(1, gI.t);
      const e = 1 - Math.pow(1 - k, 3);
      if (gI.o instanceof THREE.Mesh && towers.some((tw) => tw.m === gI.o)) gI.o.scale.y = Math.max(0.001, gI.to * e);
      else gI.o.scale.setScalar(Math.max(0.001, gI.to * e));
      if (towers.some((tw) => tw.m === gI.o)) gI.o.position.y = G + (gI.o.scale.y) / 2;
      if (k >= 1) growIn.splice(i, 1);
    }

    // the quake
    if (quakeT > 0) {
      quakeT -= dt;
      town.position.set((Math.random() - 0.5) * 0.012, 0, (Math.random() - 0.5) * 0.012);
      if (quakeT <= 0) town.position.set(0, 0, 0);
    }
    if (moodT > 0) {
      moodT -= dt;
      if (moodT <= 0) mood = 'wander';
    }
    drawPeople(dt);
    if (signs[0].visible) for (let i = 0; i < signs.length; i++) {
      const p = people[i];
      signs[i].position.set(p.x + 0.012, G, p.z);
    }

    // the presser in the tiny room, bobbing at his tiny button
    const presser = town.getObjectByName('presser');
    if (presser) presser.position.y = 0.004 + Math.max(0, Math.sin(t * 5)) * 0.006;

    // leaning over the tiny room: it's them all the way down
    ctx.camera.getWorldDirection(fwd);
    toRoom.set(TINY_ROOM.x, G + 0.03, TINY_ROOM.y).sub(ctx.camera.position);
    const dist = toRoom.length();
    const lookingAt = fwd.dot(toRoom.normalize()) > 0.975;
    if (!saidRecursion && dist < 1.35 && lookingAt) {
      recursionT += dt;
      if (recursionT > 1.2) {
        saidRecursion = true;
        discover('mech:microverse-recursion');
        ctx.narrate(RECURSION, 5500, { priority: true });
        ctx.after(3200, () => {
          tinySqueak();
          tinySay('there is a button. you know what to do.', 3400);
        });
      }
    } else recursionT = Math.max(0, recursionT - dt);

    // the tourist is grabbable only while you reach for him
    if (!touristTaken) {
      toRoom.copy(tourist.object.position).sub(ctx.camera.position);
      const near = toRoom.length() < 1.3 && fwd.dot(toRoom.normalize()) > 0.95;
      if (near !== touristReachable) {
        touristReachable = near;
        if (near) ctx.addCarryable(tourist);
        else ctx.removeCarryable(tourist);
      }
      if (!near) tourist.object.rotation.y += dt * 0.6; // he's taking in the view
    }
    return false;
  });

  ctx.narrate(INTRO, 7000);
  ctx.after(7500, () => {
    if (days === 0) ctx.narrate(INTRO_2, 6000);
  });
}

/** Headless-test hooks. */
export const microverseTest = { TZ, BTN, TINY_ROOM, TOURIST, IN_X, IN_Z, G, BOOM_AT };
