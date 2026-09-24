import * as THREE from 'three';
import type { Experience, ExperienceContext } from './registry';
import { addUpdater } from './scheduler';
import { thud } from '../audio/sfx';
import { vo } from '../audio/vo-shared';

// A framed painting of the button appears on the left wall and stays. It only
// ever changes while nobody is looking: each time it leaves your view (after
// you've actually looked at it), it's quietly repainted one step further — the
// button changes colour, a tiny figure appears, comes closer, turns to look OUT
// at you, the statue joins it, and finally it shows you, from behind, looking at
// a painting of a painting of a painting.

const APPEAR = vo('Art.');
const CAUGHT = vo('Was it always like that?');
const AGAIN = vo('It is still there. It is still art.');

const WALL_X = -5.5 + 0.06; // the left wall's inner face
const CENTRE = new THREE.Vector3(WALL_X + 0.05, 1.9, 0.4);
const PW = 1.5; // canvas area (m)
const PH = 1.12;
const CW = 512; // texture (px)
const CH = 384;
const LOOK_FIRST = 0.8; // seconds it must be seen before it may change unseen
const LAST_VARIANT = 7;

// A fixed brush-stroke pattern (seeded) so the unchanged parts stay IDENTICAL
// between repaints — only the story moves.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dabs(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, colors: string[], n: number, seed: number): void {
  const r = seeded(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = 0.35 + r() * 0.4;
    g.beginPath();
    g.ellipse(x + r() * w, y + r() * h, 6 + r() * 14, 3 + r() * 6, r() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

// A little person, naively painted. `back` = seen from behind; `facing` = eyes
// looking out of the picture.
function figure(g: CanvasRenderingContext2D, x: number, footY: number, h: number, opts: { back?: boolean; facing?: boolean; color?: string } = {}): void {
  const head = h * 0.16;
  g.fillStyle = opts.color ?? '#3a5a8c';
  g.fillRect(x - h * 0.13, footY - h * 0.72, h * 0.26, h * 0.42); // body
  g.fillStyle = '#2b2b33';
  g.fillRect(x - h * 0.11, footY - h * 0.3, h * 0.09, h * 0.3); // legs
  g.fillRect(x + h * 0.02, footY - h * 0.3, h * 0.09, h * 0.3);
  g.fillStyle = opts.back ? '#4a3526' : '#d9b08c'; // hair from behind
  g.beginPath();
  g.arc(x, footY - h * 0.72 - head, head, 0, Math.PI * 2);
  g.fill();
  if (opts.facing) {
    g.fillStyle = '#111';
    g.beginPath();
    g.arc(x - head * 0.38, footY - h * 0.72 - head * 1.05, Math.max(1.2, head * 0.14), 0, Math.PI * 2);
    g.arc(x + head * 0.38, footY - h * 0.72 - head * 1.05, Math.max(1.2, head * 0.14), 0, Math.PI * 2);
    g.fill();
  }
}

// The painted white room with its button: variant 0 is the original; each later
// variant is the previous one plus one change.
function paint(g: CanvasRenderingContext2D, v: number, prev: HTMLCanvasElement | null): void {
  // Wall + floor, in visible strokes.
  g.fillStyle = '#e9e4d8';
  g.fillRect(0, 0, CW, CH);
  dabs(g, 0, 0, CW, CH * 0.62, ['#f2eee3', '#ddd6c6', '#e6dfcd', '#cfc8b8'], 260, 11);
  g.fillStyle = '#b9ae98';
  g.fillRect(0, CH * 0.62, CW, CH * 0.38);
  dabs(g, 0, CH * 0.62, CW, CH * 0.38, ['#a89c84', '#c4b9a2', '#9d917a'], 160, 23);
  // The floor line, wobbly.
  g.strokeStyle = '#7d705c';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, CH * 0.62);
  g.quadraticCurveTo(CW * 0.5, CH * 0.6, CW, CH * 0.63);
  g.stroke();

  // Variant 6+: the room in the picture has a painting on its wall — this one.
  if (v >= 6) {
    const fx = CW * 0.08;
    const fy = CH * 0.12;
    const fw = CW * 0.3;
    const fh = fw * (CH / CW);
    g.fillStyle = '#6b4a22';
    g.fillRect(fx - 8, fy - 8, fw + 16, fh + 16);
    if (v >= 7 && prev) g.drawImage(prev, fx, fy, fw, fh); // the recursion
    else {
      g.fillStyle = '#e9e4d8';
      g.fillRect(fx, fy, fw, fh);
      g.fillStyle = '#c0302a';
      g.beginPath();
      g.ellipse(fx + fw / 2, fy + fh * 0.55, fw * 0.09, fh * 0.09, 0, Math.PI, 0);
      g.fill();
    }
  }

  // The pedestal and its dome.
  const bx = CW * 0.56;
  const by = CH * 0.72;
  g.fillStyle = '#8e8e8a';
  g.fillRect(bx - 34, by - 70, 68, 70);
  dabs(g, bx - 34, by - 70, 68, 70, ['#7c7c78', '#a3a39e'], 30, 5);
  g.fillStyle = '#6f6f6b';
  g.fillRect(bx - 42, by - 76, 84, 10);
  g.fillStyle = v >= 1 ? '#2f63c4' : '#c0302a'; // variant 1: the button is blue now
  g.beginPath();
  g.ellipse(bx, by - 76, 30, 26, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.beginPath();
  g.ellipse(bx - 9, by - 92, 8, 5, -0.4, 0, Math.PI * 2);
  g.fill();

  // Variant 5: the statue has joined it.
  if (v >= 5) {
    g.fillStyle = '#9c9a93';
    const sx = bx + 105;
    g.fillRect(sx - 16, by - 112, 32, 70);
    g.fillRect(sx - 14, by - 42, 12, 42);
    g.fillRect(sx + 2, by - 42, 12, 42);
    g.fillRect(sx - 12, by - 136, 24, 24);
  }

  // The figure: far (2), closer (3), looking out at you (4+). From 6 on it's
  // you, from behind, big in the foreground, looking at the painting.
  if (v >= 6) figure(g, CW * 0.26, CH * 1.02, CH * 0.62, { back: true, color: '#56606e' });
  else if (v >= 4) figure(g, bx - 90, by + 16, 88, { facing: true });
  else if (v === 3) figure(g, bx - 110, by + 10, 70);
  else if (v === 2) figure(g, CW * 0.12, CH * 0.66, 30);

  // Varnish: a faint warm wash over everything.
  g.fillStyle = 'rgba(160,110,40,0.07)';
  g.fillRect(0, 0, CW, CH);
}

interface Painting {
  root: THREE.Group;
}
let current: Painting | null = null;

export const painting: Experience = {
  id: 'painting',
  weight: 0.7,
  run(ctx: ExperienceContext) {
    if (current && current.root.parent === ctx.levelRoot) {
      ctx.narrate(AGAIN, 4000);
      return;
    }
    ctx.narrate(APPEAR);
    thud();

    const cv = document.createElement('canvas');
    cv.width = CW;
    cv.height = CH;
    const g = cv.getContext('2d')!;
    // The previous variant, kept for the recursive frame.
    const prev = document.createElement('canvas');
    prev.width = CW;
    prev.height = CH;
    const pg = prev.getContext('2d')!;
    let variant = 0;
    paint(g, variant, null);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;

    const root = new THREE.Group();
    root.position.copy(CENTRE);
    root.rotation.y = Math.PI / 2; // faces +x, into the room
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x7a5426, roughness: 0.55, metalness: 0.15 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(PW + 0.18, PH + 0.18, 0.06), frameMat);
    root.add(frame);
    const canvasMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PW, PH),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    );
    canvasMesh.position.z = 0.032; // proud of the frame's face
    root.add(canvasMesh);
    ctx.levelRoot.add(root);
    current = { root };

    // Drops onto its nail.
    let t = 0;
    const y0 = CENTRE.y;
    root.position.y = y0 + 0.35;
    addUpdater((dt) => {
      t += dt;
      const k = Math.min(1, t / 0.25);
      root.position.y = y0 + 0.35 * (1 - k * k);
      return k >= 1;
    });

    // Watch it: seen for a moment, then out of view → repaint one step.
    const frustum = new THREE.Frustum();
    const m = new THREE.Matrix4();
    const box = new THREE.Box3();
    const toCam = new THREE.Vector3();
    let seenT = 0;
    let caughtSaid = false;
    let changedUnseen = false;
    addUpdater((dt) => {
      if (!root.parent) return true;
      const cam = ctx.camera;
      m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      frustum.setFromProjectionMatrix(m);
      box.setFromObject(canvasMesh);
      toCam.subVectors(cam.position, CENTRE);
      const visible = toCam.x > 0.05 && frustum.intersectsBox(box); // in front of it + on screen
      if (visible) {
        seenT += dt;
        if (changedUnseen && seenT > 0.25) {
          changedUnseen = false;
          if (!caughtSaid) {
            caughtSaid = true;
            ctx.narrate(CAUGHT, 3500, { interruptible: true });
          }
        }
        return false;
      }
      if (seenT >= LOOK_FIRST && variant < LAST_VARIANT) {
        pg.clearRect(0, 0, CW, CH);
        pg.drawImage(cv, 0, 0);
        variant++;
        paint(g, variant, prev);
        tex.needsUpdate = true;
        changedUnseen = true;
      }
      seenT = 0;
      return false;
    });
  },
};
