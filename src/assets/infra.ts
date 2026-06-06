import * as THREE from 'three';
import { defineAsset } from './registry';

// Reusable trainyard infrastructure: a spline TRACK and an arched TUNNEL FACE.
// Both are parameterised procedural assets — the tunnel level and the slingshot
// crossroads share them, so the rails + tunnels look identical everywhere and no
// geometry is duplicated per level.

// Small deterministic RNG so a given face/scatter looks the same each build.
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ─── TRACK ───────────────────────────────────────────────────────────────────
// A gravel bed + two steel rails + sleeper ties laid along a spline through
// `path`. A straight track is just two points; a curved one is more. Flat paths
// (constant y) stay level — the game's tracks all sit on the ground.
export interface TrackParams {
  path: THREE.Vector3[]; // spline control points (≥2)
  gauge?: number; // rail-to-rail spacing
  tieEvery?: number; // metres between ties
  bedWidth?: number; // gravel bed width
}

defineAsset('track', (p?: TrackParams) => {
  const path = p?.path && p.path.length >= 2 ? p.path : [new THREE.Vector3(0, 0, -5), new THREE.Vector3(0, 0, 5)];
  const gauge = p?.gauge ?? 1.1;
  const tieEvery = p?.tieEvery ?? 0.9;
  const bedWidth = p?.bedWidth ?? 2.0;

  const railMat = new THREE.MeshStandardMaterial({ color: 0x7a7a84, roughness: 0.45, metalness: 0.7 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x39301f, roughness: 0.95, flatShading: true });
  const ballastMat = new THREE.MeshStandardMaterial({ color: 0x232529, roughness: 1 });

  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(path);
  const len = Math.max(0.001, curve.getLength());
  const Z = new THREE.Vector3(0, 0, 1);

  // Bed + rails follow the curve as short oriented segments.
  const segCount = Math.max(1, Math.round(len / 0.6));
  const pts = curve.getSpacedPoints(segCount);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = b.clone().sub(a);
    const segLen = seg.length();
    if (segLen < 1e-4) continue;
    const tangent = seg.clone().normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(Z, tangent);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const mid = a.clone().add(b).multiplyScalar(0.5);

    const bed = new THREE.Mesh(new THREE.BoxGeometry(bedWidth, 0.14, segLen + 0.04), ballastMat);
    bed.position.set(mid.x, -0.02, mid.z);
    bed.quaternion.copy(quat);
    bed.receiveShadow = true;
    g.add(bed);

    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, segLen + 0.04), railMat);
      rail.position.copy(mid).addScaledVector(right, (s * gauge) / 2);
      rail.position.y = 0.12;
      rail.quaternion.copy(quat);
      rail.castShadow = true;
      g.add(rail);
    }
  }

  // Ties at regular arc-length intervals, square across the track.
  for (let d = 0; d <= len + 1e-3; d += tieEvery) {
    const u = Math.min(1, d / len);
    const pt = curve.getPointAt(u);
    const tan = curve.getTangentAt(u).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(Z, tan);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(gauge + 0.4, 0.12, 0.26), tieMat);
    tie.position.set(pt.x, 0.05, pt.z);
    tie.quaternion.copy(quat);
    tie.receiveShadow = true;
    g.add(tie);
  }
  return g;
});

// ─── TUNNEL FACE ─────────────────────────────────────────────────────────────
// A craggy rock wall with one arched tunnel bored through it. Built LOCAL: the
// face sits at z≈0, the mouth opens toward +Z and the bore recedes into −Z, so a
// caller positions it and rotates it (rotation.y) to face the mouth wherever
// wanted. `openHalf` widens the bore (e.g. for multi-track tunnels).
export interface TunnelFaceParams {
  half?: number; // half-width of the whole rock face
  wallH?: number; // wall height
  depth?: number; // bore depth
  openHalf?: number; // half-width of the tunnel opening
  springY?: number; // height where the arch springs from
}

defineAsset('tunnel-face', (p?: TunnelFaceParams) => {
  const HALF = p?.half ?? 32;
  const WALL_H = p?.wallH ?? 14;
  const DEPTH = p?.depth ?? 8;
  const OPEN_HALF = p?.openHalf ?? 2.6;
  const SPRING_Y = p?.springY ?? 2.6;
  const ARCH_CROWN = SPRING_Y + OPEN_HALF;

  const g = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({ color: 0x35373c, roughness: 1, flatShading: true });
  const shades = [0x2c2e34, 0x33353b, 0x3a3c44, 0x42454e, 0x494c56].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }),
  );
  const bore = new THREE.MeshStandardMaterial({ color: 0x020305, roughness: 1, side: THREE.DoubleSide });
  const cz = -DEPTH / 2;

  const left = new THREE.Mesh(new THREE.BoxGeometry(HALF - OPEN_HALF, WALL_H, DEPTH), rock);
  left.position.set(-(OPEN_HALF + (HALF - OPEN_HALF) / 2), WALL_H / 2, cz);
  const right = left.clone();
  right.position.x = OPEN_HALF + (HALF - OPEN_HALF) / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(OPEN_HALF * 2 + 1, WALL_H - ARCH_CROWN, DEPTH), rock);
  top.position.set(0, (ARCH_CROWN + WALL_H) / 2, cz);
  for (const m of [left, right, top]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }

  const ridge = makeRng(7);
  for (let x = -HALF + 2; x < HALF - 2; x += 3.4) {
    const w = 2.4 + ridge() * 2.6;
    const h = 1.6 + ridge() * 3.5;
    const crag = new THREE.Mesh(new THREE.BoxGeometry(w, h, DEPTH * (0.5 + ridge() * 0.5)), shades[(ridge() * shades.length) | 0]);
    crag.position.set(x + (ridge() - 0.5) * 1.5, WALL_H - 0.5 + h / 2 - ridge() * 1.0, cz + (ridge() - 0.5) * 2);
    crag.rotation.set((ridge() - 0.5) * 0.25, (ridge() - 0.5) * 0.4, (ridge() - 0.5) * 0.4);
    crag.castShadow = true;
    g.add(crag);
  }

  const back = new THREE.Mesh(new THREE.PlaneGeometry(OPEN_HALF * 2.2, ARCH_CROWN + 0.8), bore);
  back.position.set(0, (ARCH_CROWN + 0.8) / 2, -DEPTH - 0.5);
  g.add(back);
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    const z = -0.5 - t * (DEPTH - 0.5);
    const r = (OPEN_HALF + 0.1) * (1 - t * 0.18);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.28, 6, 24, Math.PI), bore);
    ring.position.set(0, SPRING_Y, z);
    g.add(ring);
  }

  const archR = OPEN_HALF + 0.45;
  const segs = 15;
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI * (i / segs);
    const isKey = Math.abs(i - segs / 2) < 0.5;
    const v = new THREE.Mesh(new THREE.BoxGeometry(isKey ? 1.0 : 0.62, isKey ? 0.9 : 0.7, 1.5), shades[isKey ? 4 : 2 + (i % 2)]);
    v.position.set(Math.cos(a) * archR, SPRING_Y + Math.sin(a) * archR, isKey ? 0.4 : 0.25);
    v.rotation.z = a - Math.PI / 2;
    v.castShadow = true;
    g.add(v);
  }
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const y = 0.4 + i * (SPRING_Y / 4);
      const stone = new THREE.Mesh(new THREE.BoxGeometry(0.62, SPRING_Y / 4 + 0.06, 1.4), shades[2 + (i % 2)]);
      stone.position.set(sgn * archR, y, 0.25);
      stone.castShadow = true;
      g.add(stone);
    }
  }
  return g;
});
