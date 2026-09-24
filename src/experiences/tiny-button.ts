import * as THREE from 'three';
import type { Experience, ExperienceContext } from './registry';
import { addUpdater } from './scheduler';
import { pick } from './util';
import { tone } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { spawnPedestalButton } from '../button/pedestal-button';
import { unregisterInteractable } from '../interactables/system';

// A second, half-size button rises beside the real one. Pressing it does very
// little, and each press halves it, until it's pressed out of existence.

const ARRIVE = vo(['A smaller button. For smaller decisions.', 'Look. A little one. It has been watching you.']);
const SHRINK = vo(['Smaller.', 'That did something. Something small.', 'Barely a button now.', 'A decision the size of a crumb.']);
const GONE = vo('You pressed it out of existence.');

const PRESSES = 4;
const CONFETTI = [0xff4d6d, 0xffd23f, 0x4dd2ff];

export const tinyButton: Experience = {
  id: 'tiny-button',
  weight: 0.8,
  run(ctx: ExperienceContext) {
    ctx.narrate(pick(ARRIVE));
    // Beside the real one (at 0,0,-2), on the side away from the player.
    const side = ctx.playerPos().x > 0 ? -1 : 1;
    const pos = new THREE.Vector3(side * 1.1, 0, -2);
    let scale = 0.5;
    let presses = 0;
    let gone = false;
    const b = spawnPedestalButton(ctx.levelRoot, pos, () => press());
    b.obstacle.radius = 0.5 * scale;
    ctx.addObstacle(b.obstacle);
    // Rises out of the floor.
    b.group.scale.setScalar(scale);
    b.group.position.y = -1;
    let rise = 0;
    addUpdater((dt) => {
      rise = Math.min(1, rise + dt * 1.5);
      b.group.position.y = -1 + (1 - (1 - rise) ** 2);
      return rise >= 1;
    });

    function press(): void {
      if (gone) return;
      presses++;
      tone({ type: 'sine', from: 1400 + presses * 300, to: 2400 + presses * 400, dur: 0.07, gain: 0.05 });
      sprinkle(3);
      if (presses >= PRESSES) {
        gone = true;
        unregisterInteractable(b.interactable.id);
        ctx.removeObstacle(b.obstacle);
        ctx.narrate(GONE, 3500);
      } else ctx.narrate(SHRINK[(presses - 1) % SHRINK.length], 2500);
      // Ease to half the size (or to nothing).
      const from = scale;
      const to = gone ? 0 : scale / 2;
      scale = to;
      b.obstacle.radius = 0.5 * Math.max(to, 0.001);
      b.interactable.radius = 1.8 * Math.max(to, 0.25) + 0.6;
      let t = 0;
      addUpdater((dt) => {
        t = Math.min(1, t + dt * 4);
        b.group.scale.setScalar(Math.max(0.0001, from + (to - from) * t));
        if (t >= 1 && gone) ctx.levelRoot.remove(b.group);
        return t >= 1;
      });
    }

    // A few confetti bits, from the tiny dome.
    function sprinkle(n: number): void {
      const top = b.group.position.clone();
      top.y += 1.05 * scale;
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(0.04, 0.06),
          new THREE.MeshStandardMaterial({ color: pick(CONFETTI), side: THREE.DoubleSide }),
        );
        m.position.copy(top);
        ctx.levelRoot.add(m);
        const v = new THREE.Vector3((Math.random() - 0.5) * 0.8, 1 + Math.random(), (Math.random() - 0.5) * 0.8);
        addUpdater((dt) => {
          v.y -= 4 * dt;
          m.position.addScaledVector(v, dt);
          m.rotation.x += dt * 6;
          if (m.position.y > 0.01) return false;
          ctx.levelRoot.remove(m);
          return true;
        });
      }
    }
  },
};
