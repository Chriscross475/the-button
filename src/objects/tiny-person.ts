import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { tone, ensureAudio } from '../audio/sfx';
import { FONT_VOICE } from '../ui/fonts';

// A TINY PERSON — a citizen of the microverse, lifted out of the tank between
// finger and thumb. Persistent: he comes with you. Tap him and he says
// something, very small.

const TINY_LINES = [
  'put me down',
  'i have a family. they are also small',
  'is this the afterlife',
  'you are the sun. why are you so sweaty',
  'i want to speak to your manager. he is also you',
  'this is a kidnapping',
];

/** A pitched-up squeak, as a tiny person talks. */
export function tinySqueak(): void {
  ensureAudio();
  for (let i = 0; i < 4; i++) {
    const f = 2400 + Math.random() * 900;
    setTimeout(() => tone({ type: 'triangle', from: f, to: f * 1.15, dur: 0.05, gain: 0.05 }), i * 70);
  }
}

/** A tiny subtitle: the tiny voice, too small for the narrator's box. */
export function tinySay(text: string, ms = 3200): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:22%',
    'transform:translateX(-50%)',
    `font-family:${FONT_VOICE}`,
    'font-style:italic',
    'font-size:11px',
    'letter-spacing:0.04em',
    'color:rgba(245,245,240,0.9)',
    'text-shadow:0 1px 3px rgba(0,0,0,0.8)',
    'pointer-events:none',
    'z-index:16',
  ].join(';');
  el.textContent = `(very small) ${text}`;
  document.body.appendChild(el);
  // A plain timer on purpose: it only removes a DOM label, and must still fire
  // if the level changes mid-line (the updater pool would be cleared).
  setTimeout(() => el.remove(), ms);
}

/** Build the little fellow (≈7 cm), standing at `pos` under `parent`. */
export function makeTinyPerson(shirt = 0x3a6fd0): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.04, 8), new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 }));
  body.position.y = 0.02;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.01, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd9b08c, roughness: 0.8 }));
  head.position.y = 0.05;
  g.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.011, 0.012, 8), new THREE.MeshStandardMaterial({ color: 0xe8c040, roughness: 0.6 }));
  hat.position.y = 0.063;
  g.add(hat);
  return g;
}

export function spawnTinyPerson(ctx: GameContext, pos: THREE.Vector3, opts: { onGrab?: () => void } = {}): Carryable {
  const g = makeTinyPerson();
  g.position.copy(pos);
  ctx.levelRoot.add(g);
  let line = 0;
  const carry: Carryable = {
    kind: 'tiny-person',
    object: g,
    persistent: true,
    heldDist: 0.4,
    heldDrop: 0.16,
    heldRight: 0.18,
    heldUpdate: (_dt, o, q) => {
      o.quaternion.copy(q);
      o.scale.setScalar(1.6); // held up close, he looks bigger
    },
    onGrab: () => {
      tinySqueak();
      opts.onGrab?.();
    },
    onRelease: () => {
      g.scale.setScalar(1);
    },
    onTap: () => {
      tinySqueak();
      tinySay(TINY_LINES[line++ % TINY_LINES.length]);
    },
    projectile: { radius: 0.03, restitution: 0.3, gravity: 14 },
  };
  ctx.addCarryable(carry);
  return carry;
}
