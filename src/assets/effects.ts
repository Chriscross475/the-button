import * as THREE from 'three';
import { addUpdater } from '../experiences/scheduler';

// One-shot world effects, reusable across levels. Each spawns into a level root,
// self-animates via the scheduler, and cleans itself up. (Behaviour-with-the-
// effect, the same way assets carry their own behaviour.)

// A burst of small white "feather" bits that scatter, fall, and fade — the
// universal "a duck just met its end" puff. Used by the duck room's grim
// outcomes AND the axe→duck chop.
export function spawnFeathers(root: THREE.Object3D, at: THREE.Vector3): void {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  root.add(group);
  interface Bit {
    mesh: THREE.Mesh;
    v: THREE.Vector3;
    spin: THREE.Vector3;
  }
  const bits: Bit[] = [];
  const y0 = Math.max(at.y, 0) + 0.1;
  for (let i = 0; i < 14; i++) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.12), mat);
    mesh.position.set(at.x, y0, at.z);
    group.add(mesh);
    const a = Math.random() * Math.PI * 2;
    const sp = 1.2 + Math.random() * 2.4;
    bits.push({
      mesh,
      v: new THREE.Vector3(Math.cos(a) * sp, 2 + Math.random() * 2, Math.sin(a) * sp),
      spin: new THREE.Vector3(
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * 10,
      ),
    });
  }
  let t = 0;
  const life = 1.8;
  addUpdater((dt) => {
    t += dt;
    for (const b of bits) {
      b.v.y -= 5 * dt;
      b.mesh.position.addScaledVector(b.v, dt);
      if (b.mesh.position.y < 0.02) {
        b.mesh.position.y = 0.02;
        b.v.set(0, 0, 0);
      }
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
    }
    mat.opacity = Math.max(0, 1 - t / life);
    if (t >= life) {
      root.remove(group);
      return true;
    }
    return false;
  });
}
