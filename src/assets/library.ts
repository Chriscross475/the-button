import * as THREE from 'three';
import { addUpdater } from '../experiences/scheduler';
import { thud, pop } from '../audio/sfx';
import { defineAsset, createAsset } from './registry';

// The built-in procedural assets. Each builder returns a fresh Object3D; the
// defineAsset() calls at the bottom register them by id. Compositions assemble
// other assets and name their parts so callers can pull pieces out.

// ── Primitive props ──

function makeDuck(): THREE.Group {
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffcc22, roughness: 0.6 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xff8800, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), yellow);
  body.scale.set(1.3, 0.9, 1);
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), yellow);
  head.position.set(0.18, 0.16, 0);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 12), orange);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.31, 0.15, 0);
  g.add(beak);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), white);
    eye.position.set(0.24, 0.21, 0.06 * s);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), black);
    pupil.position.set(0.275, 0.215, 0.07 * s);
    g.add(pupil);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.14, 8), yellow);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-0.24, 0.06, 0);
  g.add(tail);
  return g;
}

// A brass key: a round bow, a shaft, and a couple of bit teeth.
// `color` tints it (the coloured keys); default brass.
function makeKey(p?: { color?: number }): THREE.Group {
  const g = new THREE.Group();
  const brass = new THREE.MeshStandardMaterial({ color: p?.color ?? 0xc9a83a, roughness: 0.4, metalness: 0.8, flatShading: true });
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.035, 8, 16), brass);
  bow.position.set(0, 0.16, 0);
  g.add(bow);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.34, 8), brass);
  shaft.position.set(0, -0.06, 0);
  g.add(shaft);
  for (let i = 0; i < 2; i++) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.045, 0.03), brass);
    tooth.position.set(0.045, -0.18 + i * 0.07, 0);
    g.add(tooth);
  }
  return g;
}

// A whole roast duck on a skewer — the cooked item (duck + campfire).
function makeCookedDuck(): THREE.Group {
  const g = new THREE.Group();
  const glaze = new THREE.MeshStandardMaterial({ color: 0x7e3c14, roughness: 0.34, metalness: 0.25 });
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.85, flatShading: true });
  const skewer = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.85, 6), stickMat);
  skewer.rotation.z = Math.PI / 2; // horizontal spit
  g.add(skewer);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), glaze);
  body.scale.set(1.45, 0.85, 0.95);
  body.castShadow = true;
  g.add(body);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 6), glaze);
    leg.position.set(-0.12, -0.04, 0.07 * s);
    leg.rotation.x = s * 0.5;
    g.add(leg);
  }
  return g;
}

// A low-poly wolf, facing +X (like the ducks). Grey fur, yellow eyes.
function makeWolf(): THREE.Group {
  const g = new THREE.Group();
  const fur = new THREE.MeshStandardMaterial({ color: 0x6b6b72, roughness: 0.9, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x33333a, roughness: 0.8, flatShading: true });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0x6a5200, roughness: 0.4 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.42, 0.36), fur);
  body.position.y = 0.5;
  body.castShadow = true;
  g.add(body);
  const haunch = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.46, 0.4), fur);
  haunch.position.set(-0.34, 0.52, 0);
  g.add(haunch);

  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.3), fur);
  neck.position.set(0.4, 0.62, 0);
  g.add(neck);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), fur);
  head.position.set(0.56, 0.74, 0);
  g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.18), fur);
  snout.position.set(0.74, 0.68, 0);
  g.add(snout);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.1), dark);
  nose.position.set(0.86, 0.68, 0);
  g.add(nose);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.18, 4), fur);
    ear.position.set(0.5, 0.92, 0.09 * s);
    g.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMat);
    eye.position.set(0.68, 0.78, 0.1 * s);
    g.add(eye);
  }

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), dark);
      leg.position.set(0.28 * sx, 0.25, 0.12 * sz);
      leg.castShadow = true;
      g.add(leg);
    }
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.12), fur);
  tail.position.set(-0.6, 0.62, 0);
  tail.rotation.z = 0.7;
  g.add(tail);
  return g;
}

function makeAxe(): THREE.Group {
  const g = new THREE.Group();
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.85, flatShading: true });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x8b9099, roughness: 0.35, metalness: 0.85, flatShading: true });
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0xc6ccd4, roughness: 0.2, metalness: 0.9 });
  const HL = 0.7;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, HL, 8), handleMat);
  handle.position.y = HL / 2;
  g.add(handle);
  const poll = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.13, 0.12), headMat);
  poll.position.set(-0.02, HL, 0);
  g.add(poll);
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.1), headMat);
  blade.position.set(0.11, HL, 0);
  blade.scale.set(1, 1.15, 0.55);
  g.add(blade);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.04), edgeMat);
  edge.position.set(0.21, HL, 0);
  g.add(edge);
  return g;
}

function makeTree(): THREE.Group {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, flatShading: true });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2f7d33, roughness: 0.85, flatShading: true });
  const h = 1.9 + Math.random() * 1.4;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, h, 7), bark);
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.85 - i * 0.2, 0.95, 9), leaf);
    cone.position.y = h - 0.2 + i * 0.55;
    cone.castShadow = true;
    g.add(cone);
  }
  return g;
}

// A campfire that self-animates (flame flicker + light) via the scheduler.
function makeCampfire(): THREE.Group {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6b6b70, roughness: 1, flatShading: true });
  const logMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 1, flatShading: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12), stoneMat);
    s.position.set(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55);
    s.rotation.set(Math.random(), Math.random(), Math.random());
    g.add(s);
  }
  for (let i = 0; i < 3; i++) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6), logMat);
    stick.position.y = 0.12;
    stick.rotation.set(Math.PI / 2.4, (i / 3) * Math.PI, 0);
    g.add(stick);
  }
  const flameMats = [0xff8a00, 0xffc23a, 0xff5a1a].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.9 }));
  const flames: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.16 - i * 0.025, 0.5 - i * 0.07, 7), flameMats[i % 3]);
    f.position.set((Math.random() - 0.5) * 0.15, 0.32 + i * 0.06, (Math.random() - 0.5) * 0.15);
    g.add(f);
    flames.push(f);
  }
  // NB: deliberately NO per-campfire PointLight. Adding a dynamic light changes
  // the scene's light count, which makes the renderer recompile EVERY lit
  // material's shader — a ~1s hitch each time a fire is lit, brutal on mobile.
  // The flames are self-lit (MeshBasicMaterial), so the fire still reads bright;
  // we just flicker their scale. The forest's ambient/hemi light does the rest.
  thud();
  pop();
  let t = Math.random() * 10;
  addUpdater((dt) => {
    if (!g.parent) return true; // removed → stop animating
    t += dt * 12;
    for (let i = 0; i < flames.length; i++) flames[i].scale.set(1, 0.85 + 0.25 * Math.sin(t + i * 1.7), 1);
    return false;
  });
  return g;
}

function makeChickenLeg(): THREE.Group {
  const g = new THREE.Group();
  const meat = new THREE.MeshStandardMaterial({ color: 0xb5742f, roughness: 0.7 });
  const bone = new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.6 });
  const drum = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), meat);
  drum.scale.set(1, 1.3, 1);
  g.add(drum);
  const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.22, 8), bone);
  shank.position.y = 0.2;
  g.add(shank);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), bone);
  knob.position.y = 0.31;
  g.add(knob);
  return g;
}

function makeStatue(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xa8a8a4, roughness: 0.9, metalness: 0.05 });
  const block = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), stone);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  block(0.18, 0.7, 0.18, -0.12, 0.35, 0);
  block(0.18, 0.7, 0.18, 0.12, 0.35, 0);
  block(0.5, 0.7, 0.28, 0, 1.05, 0);
  block(0.28, 0.28, 0.28, 0, 1.55, 0);
  block(0.12, 0.6, 0.12, -0.33, 1.1, 0);
  block(0.12, 0.6, 0.12, 0.33, 1.1, 0);
  return g;
}

// The statue, jointed: the same stone figure, but its arms and legs hang from
// pivot groups (armL/armR at the shoulders, legL/legR at the hips) so it can
// walk and gesture. Faces +Z. Used as the booth's dummy.
function makeDummy(): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xa8a8a4, roughness: 0.9, metalness: 0.05 });
  const limb = (name: string, x: number, y: number, sx: number, len: number) => {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, len, sx), stone);
    m.position.y = -len / 2;
    m.castShadow = true;
    pivot.add(m);
    g.add(pivot);
  };
  limb('legL', -0.12, 0.7, 0.18, 0.7);
  limb('legR', 0.12, 0.7, 0.18, 0.7);
  limb('armL', -0.33, 1.4, 0.12, 0.6);
  limb('armR', 0.33, 1.4, 0.12, 0.6);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), stone);
  torso.position.y = 1.05;
  torso.castShadow = true;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), stone);
  head.name = 'head';
  head.position.y = 1.55;
  head.castShadow = true;
  g.add(head);
  return g;
}

function makeRock(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.3),
    new THREE.MeshStandardMaterial({ color: 0x6b6b70, roughness: 1, flatShading: true }),
  );
  m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  return m;
}

// A banded stack of cash (origin at its base, so it sits on a surface). Grabbable
// via the money object (src/objects/money.ts).
function makeMoney(): THREE.Group {
  const g = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.8 });
  const band = new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.5, metalness: 0.4 });
  for (let i = 0; i < 7; i++) {
    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.26), green);
    bill.position.set((Math.random() - 0.5) * 0.18, 0.03 + i * 0.055, (Math.random() - 0.5) * 0.18);
    bill.rotation.y = (Math.random() - 0.5) * 0.5;
    bill.castShadow = true;
    g.add(bill);
  }
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 0.3), band);
  strap.position.set(0, 0.21, 0);
  g.add(strap);
  return g;
}

// A short tree stump (used by the axe-in-trunk composition + anywhere a stump
// is handy). Tagged 'stump' when part of a composition.
function makeStump(): THREE.Group {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x5a3a1e, roughness: 1, flatShading: true });
  const woodCut = new THREE.MeshStandardMaterial({ color: 0xb08a52, roughness: 0.9, flatShading: true });
  const H = 1.3;
  const R = 0.35;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.92, R, H, 9), bark);
  body.position.y = H / 2;
  body.castShadow = true;
  g.add(body);
  const cut = new THREE.Mesh(new THREE.CircleGeometry(R * 0.92, 12), woodCut);
  cut.rotation.x = -Math.PI / 2;
  cut.position.y = H + 0.001;
  g.add(cut);
  return g;
}

// The crime-scene chalk outline (a flat decal on a ground plane), wrapped in a
// group so the caller can orient it by group.rotation.y (head toward local −Z).
//
// Drawn the way a cop would: ONE continuous line hugging a sprawled body, in a
// pose picked at random (the comic ones — mid-sprint, starfish, the "hey!"
// point). Built as a silhouette (limbs = thick round strokes, torso + head
// filled), dilated, minus itself → an even outline ring; then chalk grain (a
// soft shadow pass so it reads on white floors, and speckled gaps).
type Pt = [number, number];
interface OutlinePose {
  head: Pt;
  neck: Pt;
  hip: Pt;
  arms: [Pt, Pt, Pt][]; // shoulder → elbow → hand
  legs: [Pt, Pt, Pt][]; // hip → knee → foot
}
const OUTLINE_POSES: OutlinePose[] = [
  { // mid-sprint: one arm flung up, one leg kicked back
    head: [150, 72], neck: [153, 104], hip: [160, 226],
    arms: [[[138, 118], [92, 90], [74, 40]], [[172, 120], [222, 158], [266, 190]]],
    legs: [[[148, 226], [128, 306], [138, 392]], [[172, 226], [230, 270], [222, 352]]],
  },
  { // starfish
    head: [180, 70], neck: [180, 102], hip: [180, 226],
    arms: [[[162, 118], [110, 100], [60, 62]], [[198, 118], [250, 100], [300, 62]]],
    legs: [[[166, 226], [128, 306], [96, 392]], [[194, 226], [232, 306], [264, 392]]],
  },
  { // the point: one arm straight up, the other on the hip, knees buckled
    head: [176, 96], neck: [176, 128], hip: [182, 248],
    arms: [[[160, 142], [150, 88], [146, 24]], [[194, 144], [238, 186], [206, 232]]],
    legs: [[[168, 248], [118, 300], [140, 392]], [[196, 248], [240, 318], [222, 394]]],
  },
];

function makeCrimeOutline(): THREE.Group {
  const W = 360;
  const H = 440;
  const mk = () => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    return [cv, cv.getContext('2d')!] as const;
  };
  const pose = OUTLINE_POSES[Math.floor(Math.random() * OUTLINE_POSES.length)];

  // 1. The body silhouette.
  const [body, b] = mk();
  b.fillStyle = b.strokeStyle = '#fff';
  b.lineCap = b.lineJoin = 'round';
  const limb = (pts: Pt[], w0: number, w1: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      b.lineWidth = i === 0 ? w0 : w1;
      b.beginPath();
      b.moveTo(pts[i][0], pts[i][1]);
      b.lineTo(pts[i + 1][0], pts[i + 1][1]);
      b.stroke();
    }
  };
  for (const arm of pose.arms) {
    limb(arm, 30, 24);
    b.beginPath();
    b.arc(arm[2][0], arm[2][1], 15, 0, Math.PI * 2); // hand
    b.fill();
  }
  for (const leg of pose.legs) {
    limb(leg, 40, 32);
    const [kx, ky] = leg[1];
    const [fx, fy] = leg[2];
    b.beginPath();
    b.ellipse(fx, fy, 14, 22, Math.atan2(fy - ky, fx - kx) - Math.PI / 2, 0, Math.PI * 2); // foot
    b.fill();
  }
  const [nx, ny] = pose.neck;
  const [hx, hy] = pose.hip;
  b.beginPath(); // torso
  b.ellipse((nx + hx) / 2, (ny + hy) / 2, 40, Math.hypot(hx - nx, hy - ny) / 2 + 16, Math.atan2(hy - ny, hx - nx) - Math.PI / 2, 0, Math.PI * 2);
  b.fill();
  limb([pose.neck, pose.head], 22, 22);
  b.beginPath();
  b.arc(pose.head[0], pose.head[1], 30, 0, Math.PI * 2);
  b.fill();

  // 2. Outline ring = silhouette dilated, minus the silhouette.
  const [ring, r] = mk();
  const R = 5;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) r.drawImage(body, Math.cos(a) * R, Math.sin(a) * R);
  r.globalCompositeOperation = 'destination-out';
  r.drawImage(body, 0, 0);
  // Chalk grain: speckled gaps, and the odd longer skip where the chalk lifted.
  for (let i = 0; i < 1800; i++) {
    r.fillStyle = `rgba(0,0,0,${0.25 + Math.random() * 0.6})`;
    r.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
  }
  for (let i = 0; i < 7; i++) {
    r.beginPath();
    r.arc(Math.random() * W, Math.random() * H, 3 + Math.random() * 4, 0, Math.PI * 2);
    r.fill();
  }

  // 3. Composite: a faint dark shadow under the chalk, then the chalk itself.
  const [out, o] = mk();
  o.globalAlpha = 0.35;
  o.filter = 'brightness(0)';
  o.drawImage(ring, 2, 2);
  o.filter = 'none';
  o.globalAlpha = 0.95;
  o.drawImage(ring, 0, 0);

  const tex = new THREE.CanvasTexture(out);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.7, 3.3),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  plane.rotation.x = -Math.PI / 2;
  const g = new THREE.Group();
  g.add(plane);
  return g;
}

// A first-person forearm + hand, meant to be parented to a held tool at its
// grip (local origin ≈ the grip): the hand wraps the grip, the sleeved forearm
// runs back/down toward the player. Swings with whatever it's attached to.
function makeArm(): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd9a06a, roughness: 0.8 });
  const sleeve = new THREE.MeshStandardMaterial({ color: 0x35506b, roughness: 0.9, flatShading: true });

  // Hand gripping the tool at the grip (≈ local origin).
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.078, 12, 10), skin);
  hand.scale.set(1, 0.85, 1.15);
  hand.position.set(0, 0.1, 0.02);
  g.add(hand);

  // Forearm hinged at the WRIST so its top always meets the hand (no gap). The
  // arm is view-locked (pinHand sets its quaternion to the camera), so a big
  // back-tilt makes the forearm run from the hand BACK toward the viewpoint —
  // i.e. it comes from the camera forward to the item, angled slightly up — rather
  // than dropping vertically from the hand "out of the ground".
  const elbow = new THREE.Group();
  elbow.position.set(0, 0.06, 0.03);
  // NEGATIVE tilt: the forearm runs back toward the camera (+Z in the view-locked
  // frame) and a touch down — so the arm comes FROM the player up to the hand,
  // not forward into the screen. (+ values point it away into the scene.)
  elbow.rotation.x = -1.0;
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.1, 10), skin);
  wrist.position.set(0, -0.04, 0);
  elbow.add(wrist);
  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.085, 0.5, 10), sleeve);
  forearm.position.set(0, -0.29, 0); // hangs from the pivot, top under the hand
  elbow.add(forearm);
  g.add(elbow);
  return g;
}

// ── Compositions ──

// Axe hacked into the TOP of a stump: the head bites down into the cut face,
// the handle juts up and out toward the front (+Z). Parts named 'stump' and
// 'axe' so a scene can pull the axe out to carry it
// (e.g. root.attach(group.getObjectByName('axe'))).
function makeAxeInTrunk(): THREE.Group {
  const g = new THREE.Group();
  const stump = makeStump();
  stump.name = 'stump';
  g.add(stump);
  const axe = makeAxe();
  axe.name = 'axe';
  // Model is handle=+Y (grip y=0, head y=0.7) with the cutting edge at +X. Embed
  // it so the head is buried in the cut face with the BLADE biting straight DOWN
  // into the wood, and the handle jutting up out of the stump.
  axe.position.set(-0.5, 1.72, 0.05); // sits a touch higher on the stump
  axe.rotation.set(0, 0, 0);
  axe.rotateZ(-2.3); // head down, edge pointing down into the wood, handle up
  g.add(axe);
  return g;
}

// ── Registration ──
defineAsset('duck', makeDuck);
defineAsset('wolf', makeWolf);
defineAsset('cooked-duck', makeCookedDuck);
defineAsset('axe', makeAxe);
defineAsset('key', makeKey);
defineAsset('tree', makeTree);
defineAsset('campfire', makeCampfire);
defineAsset('chicken-leg', makeChickenLeg);
defineAsset('statue', makeStatue);
defineAsset('dummy', makeDummy);
defineAsset('rock', makeRock);
defineAsset('money', makeMoney);
defineAsset('stump', makeStump);
defineAsset('arm', makeArm);
defineAsset('crime-outline', makeCrimeOutline);
defineAsset('axe-in-trunk', makeAxeInTrunk);

// Touch createAsset so it isn't flagged unused if a future composition needs it.
void createAsset;
