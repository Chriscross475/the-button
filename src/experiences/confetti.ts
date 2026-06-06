import * as THREE from 'three';
import type { Experience, ExperienceContext } from './registry';
import { addUpdater } from './scheduler';
import { pick } from './util';
import { sparkle } from '../audio/sfx';

// A celebratory confetti burst above the player. Unlike most experiences these
// bits are temporary — they flutter down and clean themselves up.

const LINES = [
  'Congratulations.',
  'You did it. You pressed the button.',
  'A celebration. For you. Specifically.',
  'Hooray, etc.',
];

const COLORS = [0xff4d6d, 0xffd23f, 0x4dd2ff, 0x6dff77, 0xc77dff, 0xff944d];

export const confetti: Experience = {
  id: 'confetti',
  weight: 1.4,
  run(ctx: ExperienceContext) {
    ctx.narrate(pick(LINES));
    sparkle();

    const origin = ctx.playerPos().clone();
    origin.y = 2.8;
    const group = new THREE.Group();
    ctx.scene.add(group);

    interface Bit {
      mesh: THREE.Mesh;
      vx: number;
      vy: number;
      vz: number;
      rx: number;
      rz: number;
    }
    const bits: Bit[] = [];
    const count = 60;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: pick(COLORS),
        roughness: 0.5,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.12), mat);
      mesh.position.copy(origin);
      group.add(mesh);
      bits.push({
        mesh,
        vx: (Math.random() - 0.5) * 3,
        vy: 1 + Math.random() * 2.5,
        vz: (Math.random() - 0.5) * 3,
        rx: (Math.random() - 0.5) * 10,
        rz: (Math.random() - 0.5) * 10,
      });
    }

    let life = 0;
    addUpdater((dt) => {
      life += dt;
      for (const b of bits) {
        b.vy -= 5 * dt;
        b.vx *= 0.98;
        b.vz *= 0.98;
        b.mesh.position.x += b.vx * dt;
        b.mesh.position.y += b.vy * dt;
        b.mesh.position.z += b.vz * dt;
        b.mesh.rotation.x += b.rx * dt;
        b.mesh.rotation.z += b.rz * dt;
        if (b.mesh.position.y < 0.02) b.mesh.position.y = 0.02;
      }
      if (life > 4) {
        ctx.scene.remove(group);
        group.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
        return true;
      }
      return false;
    });
  },
};
