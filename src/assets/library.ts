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
function makeKey(): THREE.Group {
  const g = new THREE.Group();
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a83a, roughness: 0.4, metalness: 0.8, flatShading: true });
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

// A pickaxe: wood handle (+Y, grip at y=0) with a double-pointed metal head.
function makePickaxe(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: 0x55585f, roughness: 0.5, metalness: 0.6, flatShading: true });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.0, 8), wood);
  handle.position.y = 0.5;
  handle.castShadow = true;
  g.add(handle);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.1), metal);
  head.position.y = 1.0;
  head.castShadow = true;
  g.add(head);
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.2, 6), metal);
    tip.position.set(s * 0.42, 1.0, 0);
    tip.rotation.z = (s * Math.PI) / 2; // points outward along ±X
    g.add(tip);
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
// group so the caller can orient it by group.rotation.y.
function makeCrimeOutline(): THREE.Group {
  const W = 256;
  const H = 320;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.strokeStyle = 'rgba(255,255,255,0.92)';
  c.lineWidth = 6;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const right: [number, number][] = [
    [140, 78], [158, 98], [200, 120], [233, 150], [196, 144], [156, 142],
    [152, 186], [166, 196], [160, 286], [178, 312], [150, 306], [134, 212], [128, 208],
  ];
  c.fillStyle = 'rgba(10,10,14,0.5)';
  c.beginPath();
  c.moveTo(right[0][0], right[0][1]);
  for (let i = 1; i < right.length; i++) c.lineTo(right[i][0], right[i][1]);
  for (let i = right.length - 2; i >= 0; i--) c.lineTo(256 - right[i][0], right[i][1]);
  c.closePath();
  c.fill();
  c.stroke();
  c.beginPath();
  c.arc(128, 50, 27, 0, Math.PI * 2);
  c.fill();
  c.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 3.0),
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
  elbow.rotation.x = 1.2; // forearm runs back toward the camera (nearly horizontal)
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
defineAsset('pickaxe', makePickaxe);
defineAsset('key', makeKey);
defineAsset('tree', makeTree);
defineAsset('campfire', makeCampfire);
defineAsset('chicken-leg', makeChickenLeg);
defineAsset('statue', makeStatue);
defineAsset('rock', makeRock);
defineAsset('money', makeMoney);
defineAsset('stump', makeStump);
defineAsset('arm', makeArm);
defineAsset('crime-outline', makeCrimeOutline);
defineAsset('axe-in-trunk', makeAxeInTrunk);

// Touch createAsset so it isn't flagged unused if a future composition needs it.
void createAsset;
