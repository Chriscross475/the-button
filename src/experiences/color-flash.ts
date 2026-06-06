import * as THREE from 'three';
import type { Experience, ExperienceContext } from './registry';
import { addUpdater } from './scheduler';
import { pick } from './util';
import { pop } from '../audio/sfx';

// The whole room briefly floods with a vivid colour, then eases back to white.
// Cheap, fast, and a little unsettling — pure mood.

const LINES = ['Mood lighting.', 'The room felt a colour.', 'Ambiance.', 'A vibe, briefly.'];
const COLORS = [0xff3b3b, 0x3b6bff, 0x9b3bff, 0x18c98a, 0xff8c1a, 0xff3bd0];

export const colorFlash: Experience = {
  id: 'color-flash',
  weight: 1,
  run(ctx: ExperienceContext) {
    ctx.narrate(pick(LINES));
    pop();

    const white = new THREE.Color(0xf4f4f2);
    const target = new THREE.Color(pick(COLORS));
    const bg = (ctx.scene.background as THREE.Color) ?? white;
    const fog = ctx.scene.fog as THREE.Fog | null;

    // A background/fog tint is invisible inside the closed white room (you can't
    // see the sky). So flood the room SURFACES (walls/floor/ceiling) with an
    // emissive glow, and add a colour-wash light so objects pick it up too.
    const wash = new THREE.PointLight(target.getHex(), 0, 40, 1.5);
    wash.position.set(0, 4, 0);
    ctx.scene.add(wash);

    // Collected on the first tick (one frame in) so the room walls are present.
    let surfaces: { mat: THREE.MeshStandardMaterial; eHex: number; eInt: number }[] | null = null;

    let t = 0;
    addUpdater((dt) => {
      if (surfaces === null) {
        surfaces = [];
        ctx.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          const mat = m.isMesh ? (m.material as THREE.MeshStandardMaterial) : null;
          if (!mat?.emissive || !mat.color) return;
          if (mat.color.r < 0.7 || mat.color.g < 0.7 || mat.color.b < 0.7) return; // white surfaces
          const pa = (m.geometry as THREE.BufferGeometry & { parameters?: { width?: number; height?: number; depth?: number } }).parameters || {};
          if (Math.max(pa.width || 0, pa.height || 0, pa.depth || 0) < 4) return; // big surfaces only
          surfaces!.push({ mat, eHex: mat.emissive.getHex(), eInt: mat.emissiveIntensity });
        });
      }
      t += dt;
      // Ease in over 0.25s, hold briefly, ease back by 2s total.
      const k = t < 0.25 ? t / 0.25 : Math.max(0, 1 - (t - 0.25) / 1.75);
      bg.copy(white).lerp(target, k);
      if (fog) fog.color.copy(bg);
      for (const s of surfaces) {
        s.mat.emissive.copy(target);
        s.mat.emissiveIntensity = k * 0.85;
      }
      wash.intensity = k * 6;
      if (t > 2) {
        bg.copy(white);
        if (fog) fog.color.copy(white);
        for (const s of surfaces) {
          s.mat.emissive.setHex(s.eHex);
          s.mat.emissiveIntensity = s.eInt;
        }
        ctx.scene.remove(wash);
        return true;
      }
      return false;
    });
  },
};
