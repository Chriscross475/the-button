import * as THREE from 'three';
import { vo } from '../audio/vo-shared';

// The "how many ways can a door open" registry. Each type builds its own
// geometry and defines open(p) where p: 0 = shut, 1 = fully open.
//
// Two rules the corridor relies on:
//   1. At p = 0 every door FULLY COVERS its w×h opening (no see-through gaps).
//   2. The list is ordered SIMPLE → COMPLEX; the corridor assigns them in
//      order, so each successive door opens in a more elaborate way.

export interface DoorHandle {
  group: THREE.Group; // positioned + rotated by the caller (placed in the wall)
  open: (p: number) => void;
}

export interface DoorType {
  id: string;
  name: string;
  build: (width: number, height: number) => DoorHandle;
}

const FRAME = new THREE.MeshStandardMaterial({ color: 0x2c2e36, roughness: 0.5, metalness: 0.6 });
const PANEL = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.7, metalness: 0.1 });
// Multi-part doors keep ALL their parts the same colour as the main panel.
const PANEL2 = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.7, metalness: 0.1 });
const T = 0.18; // panel thickness

function frame(w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const postGeo = new THREE.BoxGeometry(0.3, h + 0.4, 0.5);
  for (const x of [-(w / 2 + 0.15), w / 2 + 0.15]) {
    const p = new THREE.Mesh(postGeo, FRAME);
    p.position.set(x, (h + 0.4) / 2, 0);
    p.castShadow = true;
    g.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, 0.3, 0.5), FRAME);
  lintel.position.set(0, h + 0.25, 0);
  g.add(lintel);
  return g;
}

// A leaf, slightly oversized so closed panels always overlap their neighbours /
// the frame — no hairline gaps showing the dark interior.
function leaf(w: number, h: number, mat = PANEL): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, h + 0.04, T), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Wrap a leaf in a pivot group at hinge point (px,py), with the leaf's CLOSED
 *  centre at (cx,cy). Rotating the returned group swings the leaf about the
 *  hinge while it still fully covers the opening when shut. */
function hinged(mesh: THREE.Mesh, px: number, py: number, cx: number, cy: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(px, py, 0);
  mesh.position.set(cx - px, cy - py, 0);
  g.add(mesh);
  return g;
}

const HALF_PI = Math.PI / 2;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const DOOR_TYPES: DoorType[] = [
  // 1 — swing: one leaf on a side hinge, with a knob; opens toward the front.
  {
    id: 'swing',
    name: vo('a door that swings.'),
    build(w, h) {
      const g = frame(w, h);
      const lf = leaf(w, h);
      // A brass knob near the free (right) edge, on the front (+Z) face.
      const knobMat = new THREE.MeshStandardMaterial({ color: 0xc9a23a, roughness: 0.3, metalness: 0.8 });
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8), knobMat);
      stem.rotation.x = Math.PI / 2;
      stem.position.set(w / 2 - 0.16, 0, T / 2 + 0.04);
      lf.add(stem);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), knobMat);
      knob.position.set(w / 2 - 0.16, 0, T / 2 + 0.09);
      lf.add(knob);
      const piv = hinged(lf, -w / 2, 0, 0, h / 2); // hinge: left vertical edge
      g.add(piv);
      // +rotation swings the free edge toward +Z (the side the player is on).
      return { group: g, open: (p) => (piv.rotation.y = p * HALF_PI) };
    },
  },

  // 2 — lift: one leaf rises into the lintel.
  {
    id: 'slide-up',
    name: vo('a door that lifts.'),
    build(w, h) {
      const g = frame(w, h);
      const l = leaf(w, h);
      l.position.set(0, h / 2, 0);
      g.add(l);
      return { group: g, open: (p) => (l.position.y = h / 2 + p * (h + 0.3)) };
    },
  },

  // 3 — slide aside: one leaf slides into the wall.
  {
    id: 'slide-side',
    name: vo('a door that slides aside.'),
    build(w, h) {
      const g = frame(w, h);
      const l = leaf(w, h);
      l.position.set(0, h / 2, 0);
      g.add(l);
      return { group: g, open: (p) => (l.position.x = -p * (w + 0.4)) };
    },
  },

  // (No "drawbridge / falling" door — the level's own entry is already a falling
  // opening, so a falling door in the corridor would be redundant.)

  // revolve: one leaf turns about its vertical centre axis.
  {
    id: 'revolve',
    name: vo('a door that pivots in place.'),
    build(w, h) {
      const g = frame(w, h);
      const piv = hinged(leaf(w, h), 0, 0, 0, h / 2); // hinge: vertical centre axis
      g.add(piv);
      return { group: g, open: (p) => (piv.rotation.y = p * (Math.PI * 0.62)) };
    },
  },

  // 6 — double swing: two leaves part down the middle.
  {
    id: 'double-swing',
    name: vo('a door that parts in the middle.'),
    build(w, h) {
      const g = frame(w, h);
      const lp = hinged(leaf(w / 2, h), -w / 2, 0, -w / 4, h / 2); // left leaf, outer-edge hinge
      const rp = hinged(leaf(w / 2, h, PANEL2), w / 2, 0, w / 4, h / 2); // right leaf
      g.add(lp, rp);
      return {
        group: g,
        open: (p) => {
          lp.rotation.y = p * HALF_PI;
          rp.rotation.y = -p * HALF_PI;
        },
      };
    },
  },

  // 7 — split: two leaves slide apart sideways into the walls.
  {
    id: 'split',
    name: vo('a door that splits apart.'),
    build(w, h) {
      const g = frame(w, h);
      const l = leaf(w / 2, h);
      const r = leaf(w / 2, h, PANEL2);
      l.position.set(-w / 4, h / 2, 0);
      r.position.set(w / 4, h / 2, 0);
      g.add(l, r);
      return {
        group: g,
        open: (p) => {
          l.position.x = -w / 4 - p * (w / 2 + 0.3);
          r.position.x = w / 4 + p * (w / 2 + 0.3);
        },
      };
    },
  },

  // 8 — vertical split: top half rises, bottom half sinks.
  {
    id: 'double-slide-vertical',
    name: vo('a door whose halves slide opposite.'),
    build(w, h) {
      const g = frame(w, h);
      const top = leaf(w, h / 2);
      const bot = leaf(w, h / 2, PANEL2);
      top.position.set(0, (h * 3) / 4, 0);
      bot.position.set(0, h / 4, 0);
      g.add(top, bot);
      return {
        group: g,
        open: (p) => {
          top.position.y = (h * 3) / 4 + p * (h / 2 + 0.2);
          bot.position.y = h / 4 - p * (h / 2 + 0.2);
        },
      };
    },
  },

  // 9 — iris: four panels retract up/down/left/right.
  {
    id: 'iris',
    name: vo('a door that irises open.'),
    build(w, h) {
      const g = frame(w, h);
      const top = leaf(w, h / 2);
      const bot = leaf(w, h / 2, PANEL2);
      const lef = leaf(w / 2, h);
      const rig = leaf(w / 2, h, PANEL2);
      top.position.set(0, (h * 3) / 4, 0.04);
      bot.position.set(0, h / 4, 0.04);
      lef.position.set(-w / 4, h / 2, -0.04);
      rig.position.set(w / 4, h / 2, -0.04);
      g.add(lef, rig, top, bot);
      return {
        group: g,
        open: (p) => {
          top.position.y = (h * 3) / 4 + p * (h / 2);
          bot.position.y = h / 4 - p * (h / 2);
          lef.position.x = -w / 4 - p * (w / 2);
          rig.position.x = w / 4 + p * (w / 2);
        },
      };
    },
  },

  // 10 — corners: four quarter panels retreat to the corners.
  {
    id: 'four-corner',
    name: vo('a door that retreats to its corners.'),
    build(w, h) {
      const g = frame(w, h);
      const quads = [
        { mesh: leaf(w / 2, h / 2), sx: -1, sy: 1, mat: 0 },
        { mesh: leaf(w / 2, h / 2, PANEL2), sx: 1, sy: 1, mat: 1 },
        { mesh: leaf(w / 2, h / 2, PANEL2), sx: -1, sy: -1, mat: 1 },
        { mesh: leaf(w / 2, h / 2), sx: 1, sy: -1, mat: 0 },
      ];
      for (const q of quads) {
        q.mesh.position.set((q.sx * w) / 4, h / 2 + (q.sy * h) / 4, 0);
        g.add(q.mesh);
      }
      return {
        group: g,
        open: (p) => {
          for (const q of quads) {
            q.mesh.position.x = (q.sx * w) / 4 + q.sx * p * (w / 2 + 0.2);
            q.mesh.position.y = h / 2 + (q.sy * h) / 4 + q.sy * p * (h / 2 + 0.2);
          }
        },
      };
    },
  },

  // 11 — dissolve: a grid of tiles that shrink away in a sweep.
  {
    id: 'grid-dissolve',
    name: vo('a door that dissolves tile by tile.'),
    build(w, h) {
      const g = frame(w, h);
      const cols = 3;
      const rows = 3;
      const tiles: { mesh: THREE.Mesh; delay: number }[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const m = leaf((w / cols) * 1.02, (h / rows) * 1.02, (r + c) % 2 ? PANEL2 : PANEL);
          m.position.set(-w / 2 + (c + 0.5) * (w / cols), (r + 0.5) * (h / rows), 0);
          g.add(m);
          tiles.push({ mesh: m, delay: (r * cols + c) / (cols * rows) });
        }
      }
      return {
        group: g,
        open: (p) => {
          for (const t of tiles) {
            const local = clamp01((p - t.delay * 0.55) / (1 - t.delay * 0.55));
            t.mesh.scale.setScalar(Math.max(0.001, 1 - local));
          }
        },
      };
    },
  },
];
