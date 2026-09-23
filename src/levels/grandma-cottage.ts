import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { addUpdater } from '../experiences/scheduler';
import { defineCombine } from '../game/combine';
import { createAsset } from '../assets';
import { pop, thud, whoosh, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { buildLock, keyKind } from '../objects/key';

// GRANDMA'S COTTAGE — a little house in the forest with a RED lock on its door
// (the red key is out in the desert). Inside, grandma, in bed, in her nightcap.
//
// Come alone and she's just delighted to see someone. Come with the grown WOLF
// following you (freed from the duck room) and it's Red Riding Hood: the wolf
// bolts for the bed, and grandma is gone. It wears her nightcap now. Walk up
// and the old lines play out — big eyes, big ears, big teeth — and on the last
// it eats you. Unless you brought the axe: the woodcutter ending. Grandma
// climbs out, unharmed and furious, and the wolf is gone for good.

const W = 6; // x
const D = 7; // z
const H = 3;
const DOOR_W = 1.4;
const DOOR_H = 2.3;

const HELLO = vo('Grandma. Tucked in, glasses on, and thrilled to see anyone at all. She says help yourself to cake. There is no cake. She does not notice.');
const WOLF_SEES = vo('Your wolf has seen the bed. And who is in it. Oh no.');
const WOLF_IN_BED = vo('And now it is in the bed. In her nightcap. In her glasses. It is doing the voice.');
const EYES = vo('Grandma, what big eyes you have. All the better to see you with, it says. In her voice. Badly.');
const EARS = vo('Grandma, what big ears you have. All the better to hear you with. You are still walking towards it.');
const TEETH = vo('What big teeth you have. All the better to eat you with. You knew how this story goes.');
const WOODCUTTER = vo('The woodcutter ending. One swing, and out climbs grandma, unharmed, furious, and a little damp. The wolf will not be following you anymore.');

let open: (() => void) | null = null;
let chop: (() => void) | null = null;
defineCombine(keyKind('red'), 'lock-red', (held, _t, env) => {
  if (!open) return true;
  env.carry.removeCarryable(held);
  held.object.parent?.remove(held.object); // the key is spent
  open();
});
defineCombine('axe', 'bed-wolf', () => {
  chop?.();
  return true; // keep the axe
});

export function buildGrandmaCottage(ctx: GameContext, c: THREE.Vector3): void {
  const root = ctx.levelRoot;
  const plaster = new THREE.MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.95 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9, flatShading: true });
  const thatch = new THREE.MeshStandardMaterial({ color: 0x9a6b3a, roughness: 1, flatShading: true });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(c.x + x, y, c.z + z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };

  // ── The house: plaster walls, timber corners, a thatched gable roof ──
  const T = 0.18;
  box(W, H, T, 0, H / 2, -D / 2, plaster); // back
  box(T, H, D, -W / 2, H / 2, 0, plaster); // left
  box(T, H, D, W / 2, H / 2, 0, plaster); // right
  const side = (W - DOOR_W) / 2;
  box(side, H, T, -(DOOR_W + side) / 2, H / 2, D / 2, plaster); // front, left of the door
  box(side, H, T, (DOOR_W + side) / 2, H / 2, D / 2, plaster); // front, right of it
  box(DOOR_W, H - DOOR_H, T, 0, DOOR_H + (H - DOOR_H) / 2, D / 2, plaster); // over the door
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) box(0.26, H, 0.26, (x * W) / 2, H / 2, (z * D) / 2, timber);
  for (const s of [-1, 1]) {
    const slope = box(W / 2 + 0.7, 0.2, D + 0.8, (s * W) / 4, H + 1.0, 0, thatch);
    slope.rotation.z = -s * 0.62;
  }
  // The gable ends: a plaster triangle under each end of the roof.
  const gableShape = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, 2.0)]);
  const gableMat = new THREE.MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.95, side: THREE.DoubleSide });
  for (const z of [-D / 2, D / 2]) {
    const gable = new THREE.Mesh(new THREE.ShapeGeometry(gableShape), gableMat);
    gable.position.set(c.x, H, c.z + z);
    root.add(gable);
  }
  box(0.6, 1.6, 0.6, W / 2 - 1.2, H + 1.4, -D / 4, new THREE.MeshStandardMaterial({ color: 0x7a6a5e, roughness: 1, flatShading: true })); // chimney
  // Little windows either side of the door (self-lit: warm light inside).
  const warm = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.7), warm);
    win.position.set(c.x + s * (W / 4 + 0.4), 1.7, c.z + D / 2 + T / 2 + 0.01);
    root.add(win);
  }

  // Walls are solid; the doorway is the only way in (blocked till unlocked).
  for (let x = -W / 2; x <= W / 2; x += 0.5) {
    ctx.addObstacle({ x: c.x + x, z: c.z - D / 2, radius: 0.3 });
    if (Math.abs(x) > DOOR_W / 2 + 0.1) ctx.addObstacle({ x: c.x + x, z: c.z + D / 2, radius: 0.3 });
  }
  for (let z = -D / 2; z <= D / 2; z += 0.5) {
    ctx.addObstacle({ x: c.x - W / 2, z: c.z + z, radius: 0.3 });
    ctx.addObstacle({ x: c.x + W / 2, z: c.z + z, radius: 0.3 });
  }
  const doorBlock = { x: c.x, z: c.z + D / 2, radius: 0.75 };
  ctx.addObstacle(doorBlock);

  // The door, hinged at its left jamb, with the red lock.
  const hinge = new THREE.Group();
  hinge.position.set(c.x - DOOR_W / 2, 0, c.z + D / 2 + 0.02);
  root.add(hinge);
  const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.08), new THREE.MeshStandardMaterial({ color: 0x8a2f24, roughness: 0.8, flatShading: true }));
  door.position.set(DOOR_W / 2, DOOR_H / 2, 0);
  hinge.add(door);
  const lock = buildLock('red');
  lock.position.set(DOOR_W - 0.25, 1.1, 0.07);
  hinge.add(lock);

  // ── Inside: floor, rug, bed, grandma, a table with her basket, a lamp ──
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - T, D - T), new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(c.x, 0.02, c.z);
  root.add(floor);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.2, 24), new THREE.MeshStandardMaterial({ color: 0x9a3b3b, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(c.x, 0.03, c.z + 0.6);
  root.add(rug);

  const BED = new THREE.Vector3(c.x, 0, c.z - D / 2 + 1.3);
  box(1.6, 0.45, 2.2, 0, 0.3, BED.z - c.z, timber); // frame
  box(1.6, 1.3, 0.12, 0, 0.65, BED.z - c.z - 1.1, timber); // headboard
  const quiltCv = document.createElement('canvas');
  quiltCv.width = quiltCv.height = 64;
  const qg = quiltCv.getContext('2d')!;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    qg.fillStyle = (i + j) % 2 ? '#d86a6a' : '#f3ead3';
    qg.fillRect(i * 8, j * 8, 8, 8);
  }
  const quiltTex = new THREE.CanvasTexture(quiltCv);
  quiltTex.magFilter = THREE.NearestFilter;
  const quilt = box(1.7, 0.28, 1.5, 0, 0.66, BED.z - c.z + 0.3, new THREE.MeshStandardMaterial({ map: quiltTex, roughness: 0.95 }));
  box(1.2, 0.18, 0.5, 0, 0.62, BED.z - c.z - 0.8, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })); // pillow
  ctx.addObstacle({ x: BED.x, z: BED.z, radius: 1.0 });

  // Grandma, sitting up against the pillow: shawl, head, nightcap, glasses.
  const gran = new THREE.Group();
  gran.position.set(BED.x, 0.75, BED.z - 0.5);
  root.add(gran);
  const shawl = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.35), new THREE.MeshStandardMaterial({ color: 0x8a8fb8, roughness: 1 }));
  shawl.position.y = 0.25;
  gran.add(shawl);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshStandardMaterial({ color: 0xf0c8a8, roughness: 0.8 }));
  face.position.y = 0.72;
  gran.add(face);
  const cap = makeNightcap();
  cap.position.set(0, 0.86, 0);
  gran.add(cap);
  const glasses = makeGlasses();
  glasses.position.set(0, 0.74, 0.18);
  gran.add(glasses);

  const table = box(0.9, 0.7, 0.7, W / 2 - 0.9, 0.35, -0.6, timber);
  table.castShadow = true;
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.22, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xb08040, roughness: 1, side: THREE.DoubleSide }));
  basket.position.set(c.x + W / 2 - 0.9, 0.82, c.z - 0.6);
  root.add(basket);
  const cloth = new THREE.Mesh(new THREE.CircleGeometry(0.24, 12), new THREE.MeshStandardMaterial({ color: 0xd23a2a, roughness: 1 }));
  cloth.rotation.x = -Math.PI / 2;
  cloth.position.set(basket.position.x, 0.9, basket.position.z);
  root.add(cloth);
  ctx.addObstacle({ x: c.x + W / 2 - 0.9, z: c.z - 0.6, radius: 0.55 });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
  lamp.position.set(c.x - W / 2 + 0.6, 1.2, c.z - D / 2 + 0.6);
  root.add(lamp);
  box(0.5, 1.0, 0.5, -W / 2 + 0.6, 0.5, -D / 2 + 0.6, timber); // nightstand under it

  // ── The lock ──
  let unlocked = false;
  ctx.addTarget({ kind: 'lock-red', position: new THREE.Vector3(c.x, 1.1, c.z + D / 2), radius: 2.6 });
  open = () => {
    if (unlocked) return;
    unlocked = true;
    pop();
    whoosh();
    discover('mech:red-lock');
    ctx.removeObstacle(doorBlock);
    let t = 0;
    addUpdater((dt) => {
      t = Math.min(1, t + dt / 0.9);
      hinge.rotation.y = 1.8 * (1 - Math.pow(1 - t, 3)); // swings inward
      return t >= 1;
    });
  };

  // ── Inside: grandma, or the wolf ──
  const inside = (p: THREE.Vector3) => Math.abs(p.x - c.x) < W / 2 - 0.2 && Math.abs(p.z - c.z) < D / 2 - 0.2;
  let entered = false;
  let wolfInBed: THREE.Object3D | null = null;
  let lines = 0; // how far through "what big …" you've walked
  let lastLine = -99; // when the last of them was said (they need room to land)
  let over = false;
  let tb = 0;

  const takeHerPlace = (companion: THREE.Object3D) => {
    // The follower leaves the scene (the Game lets it go); our own wolf, at the
    // same size, takes over from where it stood.
    const from = companion.position.clone();
    const scale = companion.scale.x;
    ctx.scene.remove(companion);
    const wolf = createAsset('wolf');
    wolf.scale.setScalar(scale);
    wolf.position.set(from.x, 0, from.z);
    root.add(wolf);
    ctx.narrate(WOLF_SEES, 3500, { priority: true });
    let t = 0;
    const start = from.clone().setY(0);
    // In the bed: legs sunk through the mattress, so it lies under the quilt
    // with its head (and her cap) poking out.
    const bedTop = new THREE.Vector3(BED.x, 0.2, BED.z - 0.4);
    addUpdater((dt) => {
      t += dt;
      if (t < 1.1) {
        // bolt for the bed
        const k = t / 1.1;
        wolf.position.lerpVectors(start, bedTop, k);
        wolf.position.y = Math.sin(k * Math.PI) * 0.8 + bedTop.y * k;
        wolf.rotation.y = Math.atan2(-(bedTop.z - start.z), bedTop.x - start.x); // nose (+X) toward the bed
        return false;
      }
      // Gulp. Grandma is gone; the wolf is in the bed, in her cap and glasses.
      thud();
      gran.visible = false;
      wolf.position.copy(bedTop);
      wolf.rotation.set(0, -Math.PI / 2, 0); // nose (+X) toward the door (+Z)
      const s = wolf.scale.x;
      const wcap = makeNightcap();
      wcap.position.set(0.56, 0.9, 0);
      wcap.scale.setScalar(1 / s * 0.9);
      wolf.add(wcap);
      const wglasses = makeGlasses();
      wglasses.position.set(0.72, 0.8, 0);
      wglasses.rotation.y = Math.PI / 2;
      wglasses.scale.setScalar(1 / s * 0.9);
      wolf.add(wglasses);
      quilt.scale.y = 1.4; // it's a bigger lump under there now
      wolfInBed = wolf;
      ctx.narrate(WOLF_IN_BED, 5000, { priority: true });
      ctx.addTarget({ kind: 'bed-wolf', position: BED.clone(), radius: 2.3 });
      discover('mech:grandma');
      return true;
    });
  };

  chop = () => {
    if (!wolfInBed || over) return;
    over = true;
    thud();
    pop();
    root.remove(wolfInBed);
    wolfInBed = null;
    quilt.scale.y = 1;
    gran.visible = true;
    sparkle();
    discover('reward:grandma-saved');
    ctx.narrate(WOODCUTTER, 7000, { priority: true });
  };

  addUpdater((dt) => {
    tb += dt;
    const p = ctx.playerPos();
    if (!entered && unlocked && inside(p)) {
      entered = true;
      const companion = ctx.getCompanion();
      if (companion && (companion.userData as { adultWolf?: boolean }).adultWolf) takeHerPlace(companion);
      else {
        discover('mech:grandma');
        ctx.narrate(HELLO, 7000, { priority: true });
      }
    }
    if (gran.visible) gran.rotation.z = Math.sin(tb * 1.3) * 0.04; // a contented little sway
    if (wolfInBed && !over) {
      // Walk up to the bed, and the story plays out, line by line.
      const dist = Math.hypot(p.x - BED.x, p.z - BED.z);
      const steps: [number, string][] = [[3.4, EYES], [2.6, EARS], [1.9, TEETH]];
      if (lines < steps.length && dist < steps[lines][0] && tb - lastLine > 2.6) {
        lastLine = tb;
        ctx.narrate(steps[lines][1], 5000, { priority: true });
        lines++;
        if (lines === steps.length) {
          const wolf = wolfInBed;
          ctx.after(1600, () => {
            if (wolfInBed !== wolf) return; // the woodcutter got there first
            over = true;
            // It lunges.
            wolf.position.set(p.x, 0.4, p.z);
            thud();
            ctx.die('wolf');
          });
        }
      }
    }
    return false;
  });
}

function makeNightcap(): THREE.Group {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: 1 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 18), white);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 14), white);
  cone.position.set(0.06, 0.18, 0);
  cone.rotation.z = -0.5; // floppy
  g.add(cone);
  const bobble = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), white);
  bobble.position.set(0.19, 0.34, 0);
  g.add(bobble);
  return g;
}

function makeGlasses(): THREE.Group {
  const g = new THREE.Group();
  const wire = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5, metalness: 0.6 });
  for (const s of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 6, 14), wire);
    lens.position.x = s * 0.075;
    g.add(lens);
  }
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), wire);
  g.add(bridge);
  return g;
}
