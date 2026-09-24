import * as THREE from 'three';
import type { Experience, ExperienceContext } from './registry';
import { addUpdater, onRoomPress } from './scheduler';
import { noise, ensureAudio } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { FONT_SIGN } from '../ui/fonts';

// A tally chart appears on the right wall, in marker, and stays. Every press of
// the room's button adds a mark — drawn stroke by stroke by nobody — in groups
// of five with the diagonal strike. It started counting when it appeared.

const APPEAR = vo('Somebody has started keeping count.');
const AGAIN = vo('It is already counting. It does not need encouragement.');
const MILESTONES: Record<number, string> = vo({
  10: 'Somebody is counting. It is not me.',
  25: 'Twenty-five. Whoever is counting has stopped enjoying it.',
  50: 'Fifty. The wall is running out of wall.',
  100: 'One hundred. Somebody should tell whoever is counting to stop. It is not going to be me.',
});
const FULL = vo('The wall is full. It is still counting. Just not out loud.');

const WALL_X = 5.5 - 0.06; // the right wall's inner face
const CENTRE = new THREE.Vector3(WALL_X - 0.02, 1.85, -1.2);
const SIZE = 1.5; // metres (square)
const PX = 512;
const TOP = 118; // first row's top (px), under the title
const ROW_H = 76;
const GROUP_W = 88;
const PER_ROW = 5; // groups per row
const ROWS = Math.floor((PX - TOP - 8) / ROW_H);
const CAPACITY = ROWS * PER_ROW * 5;
const STROKE_TIME = 0.3;
const INK = '#1d2433';

// A mark's stroke, with a little seeded wobble so it looks hand-drawn.
function strokeOf(i: number): { x0: number; y0: number; x1: number; y1: number } {
  const group = Math.floor(i / 5);
  const inGroup = i % 5;
  const row = Math.floor(group / PER_ROW);
  const gx = 26 + (group % PER_ROW) * GROUP_W;
  const gy = TOP + row * ROW_H;
  const j = (n: number) => (Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1; // -1..1
  if (inGroup < 4) {
    const x = gx + inGroup * 15 + j(1) * 2;
    return { x0: x + j(2) * 2, y0: gy + j(3) * 3, x1: x - j(4) * 2, y1: gy + 56 + j(5) * 3 };
  }
  return { x0: gx - 8 + j(6) * 2, y0: gy + 46 + j(7) * 3, x1: gx + 58 + j(8) * 2, y1: gy + 8 + j(9) * 3 };
}

function draw(g: CanvasRenderingContext2D, count: number, partial: number): void {
  g.clearRect(0, 0, PX, PX);
  g.fillStyle = INK;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const title = 'TIMES YOU PRESSED IT';
  let fs = 54;
  do g.font = `bold ${fs}px ${FONT_SIGN}`;
  while (g.measureText(title).width > PX - 44 && --fs > 12);
  g.save();
  g.translate(22, 58);
  g.rotate(-0.025); // written on the wall by hand, not quite level
  g.fillText(title, 0, 0);
  g.restore();
  g.strokeStyle = INK;
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(22, 84);
  g.lineTo(PX - 30, 80);
  g.stroke();
  g.lineCap = 'round';
  g.lineWidth = 6;
  const shown = Math.min(count, CAPACITY);
  for (let i = 0; i < shown; i++) {
    const s = strokeOf(i);
    const k = i === shown - 1 ? partial : 1; // the newest one, mid-stroke
    g.beginPath();
    g.moveTo(s.x0, s.y0);
    g.lineTo(s.x0 + (s.x1 - s.x0) * k, s.y0 + (s.y1 - s.y0) * k);
    g.stroke();
  }
}

function scratch(): void {
  ensureAudio();
  noise(0.14, 0.05, 3200, 'bandpass');
  noise(0.08, 0.03, 5200, 'highpass');
}

interface Tally {
  root: THREE.Mesh;
}
let current: Tally | null = null;

export const tally: Experience = {
  id: 'tally',
  weight: 0.7,
  run(ctx: ExperienceContext) {
    if (current && current.root.parent === ctx.levelRoot) {
      ctx.narrate(AGAIN, 4000); // (the press itself already added its mark)
      return;
    }
    ctx.narrate(APPEAR);

    const cv = document.createElement('canvas');
    cv.width = PX;
    cv.height = PX;
    const g = cv.getContext('2d')!;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    );
    mesh.position.copy(CENTRE);
    mesh.rotation.y = -Math.PI / 2; // faces −x, into the room
    ctx.levelRoot.add(mesh);
    current = { root: mesh };

    let count = 0;
    let full = false;
    // One stroke animates at a time: a new mark restarts it (the older mark is
    // then drawn whole).
    let strokeT = 0;
    let animating = false;
    const addMark = () => {
      if (count >= CAPACITY) {
        count++;
        if (!full) {
          full = true;
          ctx.narrate(FULL, 5000);
        }
        return;
      }
      count++;
      scratch();
      strokeT = 0;
      if (!animating) {
        animating = true;
        addUpdater((dt) => {
          if (!mesh.parent) return true;
          strokeT += dt;
          const k = Math.min(1, strokeT / STROKE_TIME);
          draw(g, count, k);
          tex.needsUpdate = true;
          if (k >= 1) animating = false;
          return k >= 1;
        });
      }
      const line = MILESTONES[count];
      if (line) ctx.narrate(line, 5000);
    };
    // The press that summoned it is mark one; it draws itself in like the rest.
    addMark();
    onRoomPress(() => {
      if (current?.root === mesh && mesh.parent) addMark();
    });
  },
};
