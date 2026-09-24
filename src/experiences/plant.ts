import * as THREE from 'three';
import type { Experience, ExperienceContext } from './registry';
import { addUpdater, onRoomPress } from './scheduler';
import { pop, chirp } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { CONFIG } from '../config';

// A potted plant appears in the back-left corner and stays. Every LATER press of
// the room's button, it grows a stage: taller, leafier, then a flower, then it
// hits the ceiling and keeps going along it. Pressing summons nothing for it —
// it just grows. Lines only at milestones.

const APPEAR = vo('A plant. It needs nothing from you. Except that.');
const AGAIN = vo('Another plant? No. The same plant. It took that as encouragement.');
const MILESTONES: Record<number, string> = vo({
  3: 'The plant is growing. Nobody asked it to.',
  7: 'It flowered. For you. Probably.',
  9: 'It has reached the ceiling. It is not stopping.',
  13: 'It is looking for the way out. Same as you.',
  18: 'The plant is the room now. You are a guest.',
});

const POT = new THREE.Vector3(-4.6, 0, -5.6);
const CEIL = CONFIG.ROOM.height - 0.08; // just under the ceiling (never coplanar)
const MAX_CURL = 9.5; // how far along the ceiling it can get (toward +x)

const potMat = new THREE.MeshStandardMaterial({ color: 0xb5562f, roughness: 0.85 });
const soilMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 });
const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.8 });
const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f9d45, roughness: 0.7 });
const petalMat = new THREE.MeshStandardMaterial({ color: 0xf07aa8, roughness: 0.6 });
const heartMat = new THREE.MeshStandardMaterial({ color: 0xf2c53d, roughness: 0.6 });
const leafGeo = new THREE.SphereGeometry(1, 10, 6);
const petalGeo = new THREE.SphereGeometry(1, 8, 6);

// How tall the stem is at a stage, and how far it has curled along the ceiling.
// (The stem tops out exactly at the vine's height: 0.45 is the pot.)
const stemHeight = (stage: number) => Math.min(CEIL - 0.04 - 0.45, 0.35 + 0.42 * stage);
const curlLength = (stage: number) => THREE.MathUtils.clamp((stage - 8) * 0.75, 0, MAX_CURL);

function leaf(parent: THREE.Object3D, x: number, y: number, z: number, yaw: number, size: number, droop = 0.35): void {
  const l = new THREE.Mesh(leafGeo, leafMat);
  l.scale.set(0.2 * size, 0.022, 0.09 * size);
  l.position.set(x, y, z);
  l.rotation.set(0, yaw, -droop);
  l.translateX(0.17 * size); // out from the stem
  parent.add(l);
}

function flower(parent: THREE.Object3D, x: number, y: number, z: number, open: boolean, facingDown = false): void {
  const f = new THREE.Group();
  f.position.set(x, y, z);
  if (facingDown) f.rotation.x = Math.PI;
  if (!open) {
    const bud = new THREE.Mesh(petalGeo, petalMat);
    bud.scale.set(0.06, 0.1, 0.06);
    f.add(bud);
  } else {
    for (let i = 0; i < 6; i++) {
      const p = new THREE.Mesh(petalGeo, petalMat);
      const a = (i / 6) * Math.PI * 2;
      p.scale.set(0.09, 0.025, 0.05);
      p.position.set(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08);
      p.rotation.y = -a;
      f.add(p);
    }
    const heart = new THREE.Mesh(petalGeo, heartMat);
    heart.scale.setScalar(0.045);
    heart.position.y = 0.01;
    f.add(heart);
  }
  parent.add(f);
}

// The whole plant above the pot at a stage (rebuilt per stage; tiny meshes).
function buildGrowth(stage: number): THREE.Group {
  const g = new THREE.Group();
  const h = stemHeight(stage);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.022 + stage * 0.002, 0.03 + stage * 0.003, h, 8), stemMat);
  stem.position.y = 0.45 + h / 2;
  g.add(stem);
  const leaves = Math.min(14, 2 + stage * 2);
  for (let i = 0; i < leaves; i++) {
    const y = 0.5 + ((i + 1) / (leaves + 1)) * h;
    leaf(g, 0, y, 0, i * 2.4, 0.8 + Math.min(1, stage / 6) * 0.6);
  }
  const top = 0.45 + h;
  const curl = curlLength(stage);
  if (curl <= 0) {
    if (stage >= 6) flower(g, 0, top + 0.05, 0, stage >= 7);
    return g;
  }
  // At the ceiling: a vine running along it, leaves hanging down and a flower
  // every metre or so, facing the floor.
  const vine = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, curl, 8), stemMat);
  vine.rotation.z = Math.PI / 2;
  vine.position.set(curl / 2, CEIL - 0.04, 0);
  g.add(vine);
  for (let x = 0.3; x < curl; x += 0.35) leaf(g, x, CEIL - 0.08, 0, Math.PI / 2 + (x * 7) % 1.4 - 0.7, 1.2, 1.1);
  for (let x = 0.9; x < curl; x += 1.1) flower(g, x, CEIL - 0.14, 0.05, true, true);
  return g;
}

interface Plant {
  root: THREE.Group;
  growth: THREE.Group;
  stage: number;
}
let current: Plant | null = null;

function grow(ctx: ExperienceContext, p: Plant): void {
  p.stage++;
  const old = p.growth;
  const next = buildGrowth(p.stage);
  p.root.add(next);
  p.growth = next;
  p.root.remove(old);
  old.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry !== leafGeo && o.geometry !== petalGeo) o.geometry.dispose();
  });
  // Swell into the new stage (a quick overshoot, like it's pleased with itself).
  let t = 0;
  next.scale.set(0.9, 0.82, 0.9);
  addUpdater((dt) => {
    t += dt;
    const k = Math.min(1, t / 0.6);
    const s = 1 + Math.sin(k * Math.PI) * 0.06;
    next.scale.set(0.9 + 0.1 * k * s, 0.82 + 0.18 * k * s, 0.9 + 0.1 * k * s);
    return k >= 1;
  });
  chirp();
  const line = MILESTONES[p.stage];
  if (line) ctx.narrate(line, 5000);
}

export const plant: Experience = {
  id: 'plant',
  weight: 0.7,
  run(ctx: ExperienceContext) {
    // Already in this room: no second plant. The press already grew it once;
    // being picked again counts as encouragement, so it grows twice.
    if (current && current.root.parent === ctx.levelRoot) {
      ctx.narrate(AGAIN, 5000);
      grow(ctx, current);
      return;
    }
    pop();
    ctx.narrate(APPEAR);
    const root = new THREE.Group();
    root.position.copy(POT);
    // The pot: a tapered terracotta cylinder, a rim, soil.
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.42, 16), potMat);
    pot.position.y = 0.21;
    root.add(pot);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 8, 20), potMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.42;
    root.add(rim);
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.26, 16), soilMat);
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.4;
    root.add(soil);
    const p: Plant = { root, growth: buildGrowth(0), stage: 0 };
    root.add(p.growth);
    ctx.levelRoot.add(root);
    ctx.addObstacle({ x: POT.x, z: POT.z, radius: 0.35 });
    current = p;
    // Pop up out of the floor.
    let t = 0;
    root.scale.setScalar(0.01);
    addUpdater((dt) => {
      t += dt;
      const k = Math.min(1, t / 0.4);
      root.scale.setScalar(Math.max(0.01, k * (1 + Math.sin(k * Math.PI) * 0.15)));
      return k >= 1;
    });
    onRoomPress(() => {
      if (current === p && p.root.parent) grow(ctx, p);
    });
  },
};
