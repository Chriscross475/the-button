import * as THREE from 'three';
import { defineAsset } from './registry';

// Reusable railway infrastructure: a spline TRACK, parameterised so every level
// lays the same rails without duplicating geometry.

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

const Z_AXIS = new THREE.Vector3(0, 0, 1);

defineAsset('track', (p?: TrackParams) => {
  const path = p?.path && p.path.length >= 2 ? p.path : [new THREE.Vector3(0, 0, -5), new THREE.Vector3(0, 0, 5)];
  const gauge = p?.gauge ?? 1.1;
  const tieEvery = p?.tieEvery ?? 0.9;
  const bedWidth = p?.bedWidth ?? 2.0;

  const railMat = new THREE.MeshStandardMaterial({ color: 0x7a7a84, roughness: 0.45, metalness: 0.7 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x39301f, roughness: 0.95, flatShading: true });
  const ballastMat = new THREE.MeshStandardMaterial({ color: 0x232529, roughness: 1 });

  const g = new THREE.Group();

  // A straight track (two points) is one bed + two rails + instanced ties — a
  // few draw calls however long it runs, so a line to the horizon stays cheap.
  if (path.length === 2) {
    const [a, b] = path;
    const dir = b.clone().sub(a);
    const len = dir.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, dir.clone().normalize());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(bedWidth, 0.14, len), ballastMat);
    bed.position.set(mid.x, -0.02, mid.z);
    bed.quaternion.copy(quat);
    bed.receiveShadow = true;
    g.add(bed);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, len), railMat);
      rail.position.copy(mid).addScaledVector(right, (s * gauge) / 2);
      rail.position.y = 0.12;
      rail.quaternion.copy(quat);
      rail.castShadow = true;
      g.add(rail);
    }
    const count = Math.floor(len / tieEvery) + 1;
    const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(gauge + 0.4, 0.12, 0.26), tieMat, count);
    const m = new THREE.Matrix4();
    const one = new THREE.Vector3(1, 1, 1);
    const at = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      at.copy(a).addScaledVector(dir, (i * tieEvery) / len).setY(0.05);
      ties.setMatrixAt(i, m.compose(at, quat, one));
    }
    ties.instanceMatrix.needsUpdate = true;
    ties.receiveShadow = true;
    g.add(ties);
    return g;
  }

  const curve = new THREE.CatmullRomCurve3(path);
  const len = Math.max(0.001, curve.getLength());

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
    const quat = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, tangent);
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
    const quat = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, tan);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(gauge + 0.4, 0.12, 0.26), tieMat);
    tie.position.set(pt.x, 0.05, pt.z);
    tie.quaternion.copy(quat);
    tie.receiveShadow = true;
    g.add(tie);
  }
  return g;
});
