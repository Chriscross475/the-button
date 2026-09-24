import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { spawnPedestalButton, type SpawnedButton } from '../button/pedestal-button';
import { setCounter, hideCounter } from '../ui/counter';
import { tone, noise, ensureAudio, whoosh, fanfare, sadTrombone, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { FONT_VOICE, FONT_SIGN } from '../ui/fonts';
import { uvInk } from '../objects/uv-torch';

// THE BUTTON'S EVIL TWIN — two identical red buttons. One sign says THIS ONE,
// the other NOT THIS ONE, and the narrator tells you which to press. He is
// "very helpful".
//
// THE RULE: whenever he says "Trust me.", he is lying. Otherwise he's telling
// the truth. (The signs mean nothing — they just give him something to point
// at.) Three right presses IN A ROW and a third, plain button rises: the exit.
// A wrong press buzzes, the room goes red, your streak resets, and he hints a
// little harder each time. Every round the buttons shuffle, the signs swap and
// the room redecorates itself, so it always feels like a new room.

const { width: W, depth: D } = CONFIG.ROOM; // 11 × 13
const NEED = 3; // right presses in a row
const SPOTS = [new THREE.Vector3(-1.8, 0, -3), new THREE.Vector3(1.8, 0, -3)]; // left, right

const INTRO = vo('Two buttons. One of them ends this. The other one does not. Luckily, I am here, and I will tell you which. I am very helpful.');
// What he says. Plain = true; with "Trust me." = a lie.
const SAY = vo({
  left: 'Press the left one.',
  right: 'Press the right one.',
  yes: 'Press the one that says this one.',
  no: 'Press the one that says not this one.',
  leftLie: 'Press the left one. Trust me.',
  rightLie: 'Press the right one. Trust me.',
  yesLie: 'Press the one that says this one. Trust me.',
  noLie: 'Press the one that says not this one. Trust me.',
});
const RIGHT_LINES = vo(['Hm. Correct. Lucky.', 'That one, yes. I meant that one.', 'Right again. I am starting to feel unnecessary.']);
const WRONG_LINES = vo(['Wrong one. Obviously. Did you not trust me?', 'No. That was the evil one. The other one was also evil, but less.', 'Buzz. Do try listening.']);
const HINT_1 = vo('I do say trust me quite a lot, do I not.');
const HINT_2 = vo('Here is a free one. When I say trust me, do not. There. I have said it. Trust me.');
const UV_CHEAT = vo('You checked them with a torch. That is cheating. It is also correct. I will allow it.');
const SOLVED = vo('Three in a row. You worked out that I lie. Most people just assume it. A third button, then. It does exactly what it says. Trust me.');

type Side = 0 | 1; // 0 = left spot, 1 = right spot
type Statement = 'left' | 'right' | 'yes' | 'no';

// A room, redecorated: rug, banner, light tint, and one prop.
interface Theme { name: string; rug: number; banner: number; ink: string; light: number; prop: 'plant' | 'lamp' | 'clock' | 'fishbowl' | 'chair' }
const THEMES: Theme[] = [
  { name: 'THE CHOICE', rug: 0x7a2a2a, banner: 0xf2e6c8, ink: '#5a1414', light: 0xfff2e0, prop: 'plant' },
  { name: 'THE OTHER CHOICE', rug: 0x2a4a7a, banner: 0xdfe8f5, ink: '#1a2e5a', light: 0xe6f0ff, prop: 'lamp' },
  { name: 'DEFINITELY THIS ROOM', rug: 0x3f6b3a, banner: 0xe9f2df, ink: '#24401f', light: 0xf0ffe6, prop: 'clock' },
  { name: 'A NEW ROOM (SAME)', rug: 0x6a4a8a, banner: 0xece0f5, ink: '#3a2150', light: 0xf4e8ff, prop: 'fishbowl' },
  { name: 'NOT THIS ROOM', rug: 0x8a6a2a, banner: 0xf5ecd6, ink: '#4a3510', light: 0xfff6dc, prop: 'chair' },
];

/** For headless tests: where the right button is this round. */
export const evilTwinTest = { correctX: 0 };

export function revealEvilTwin(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; the hub button sinks

  const hemi = new THREE.HemisphereLight(0xfff2e0, 0x5a5a60, 0.55);
  root.add(hemi);

  // ── Decor that changes per round ──
  const rugMat = new THREE.MeshStandardMaterial({ color: THEMES[0].rug, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.2), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.015, -2.6);
  root.add(rug);

  // A banner on the back wall, on its own frame, well off the wall face.
  const bannerCv = document.createElement('canvas');
  bannerCv.width = 1024;
  bannerCv.height = 192;
  const bannerTex = new THREE.CanvasTexture(bannerCv);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.1, 0.06), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.6 }));
  frame.position.set(0, 2.55, -D / 2 + 0.16);
  root.add(frame);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.94), new THREE.MeshBasicMaterial({ map: bannerTex }));
  banner.position.set(0, 2.55, -D / 2 + 0.2);
  root.add(banner);
  const drawBanner = (t: Theme) => {
    const g = bannerCv.getContext('2d')!;
    g.fillStyle = '#' + t.banner.toString(16).padStart(6, '0');
    g.fillRect(0, 0, 1024, 192);
    fitText(g, t.name, 'bold', 110, 512, 100, 960, t.ink);
    bannerTex.needsUpdate = true;
  };

  const props = buildProps(root);

  const setTheme = (i: number) => {
    const t = THEMES[i % THEMES.length];
    rugMat.color.setHex(t.rug);
    hemi.color.setHex(t.light);
    drawBanner(t);
    for (const [k, g] of Object.entries(props)) g.visible = k === t.prop;
  };

  // ── The twins: two identical buttons, each with a sign on a little post ──
  interface Twin { btn: SpawnedButton; side: Side; sign: { draw: (text: string) => void; group: THREE.Group }; label: 'yes' | 'no'; ink: (real: boolean) => void }
  const twins: Twin[] = [];
  const makeTwin = (side: Side): Twin => {
    const twin = {} as Twin;
    twin.btn = spawnPedestalButton(root, SPOTS[side], () => press(twin));
    ctx.addObstacle(twin.btn.obstacle);
    twin.side = side;
    twin.sign = buildSign(root);
    twin.label = side === 0 ? 'yes' : 'no';
    // UV ink on the back of its sign board's face: under the torch it says
    // which one is real this round (redrawn every round).
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 96;
    const tex = new THREE.CanvasTexture(cv);
    const ink = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    ink.position.set(0, 1.86, 0.02); // just above the board, on its own plane
    twin.sign.group.add(ink);
    uvInk(ink);
    twin.ink = (real) => {
      const g = cv.getContext('2d')!;
      g.clearRect(0, 0, 256, 96);
      g.fillStyle = real ? '#b8ff5a' : '#ff5ad2';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `bold 64px ${FONT_SIGN}`;
      g.fillText(real ? 'REAL' : 'EVIL', 128, 50);
      tex.needsUpdate = true;
    };
    return twin;
  };
  twins.push(makeTwin(0), makeTwin(1));
  const place = (t: Twin, x: number, z: number) => {
    t.btn.group.position.set(x, 0, z);
    t.btn.interactable.position.set(x, 0, z);
    t.btn.obstacle.x = x;
    t.btn.obstacle.z = z;
    t.sign.group.position.set(x, 0, z - 0.5); // just behind its button, readable over the dome
  };
  for (const t of twins) place(t, SPOTS[t.side].x, SPOTS[t.side].z);
  // A moving button that reaches you pushes you aside: overlapping an obstacle
  // would otherwise block every move (you'd be stuck inside it for good).
  const shove = (o: { x: number; z: number; radius: number }) => {
    const c = ctx.camera.position;
    const need = o.radius + CONFIG.PLAYER_RADIUS + 0.02;
    const d = Math.hypot(c.x - o.x, c.z - o.z);
    if (d >= need) return;
    const nx = d > 1e-4 ? (c.x - o.x) / d : 0;
    const nz = d > 1e-4 ? (c.z - o.z) / d : 1;
    c.x = o.x + nx * need;
    c.z = o.z + nz * need;
  };
  for (const t of twins) shove(t.btn.obstacle); // built where you may be standing
  const relabel = () => {
    for (const t of twins) t.sign.draw(t.label === 'yes' ? 'THIS ONE' : 'NOT THIS ONE');
  };

  // ── State ──
  let round = 0;
  let streak = 0;
  let misses = 0;
  let busy = true;
  let correct: Twin = twins[0];
  let solved = false;
  let uvSaid = false;
  const hud = () => setCounter(`RIGHT IN A ROW  ${streak} / ${NEED}`);

  // A new round: redecorate, shuffle (maybe), swap the signs (maybe), and he
  // says which one — truthfully, or with a "Trust me."
  const newRound = () => {
    busy = true;
    round++;
    setTheme(round);
    const swapSides = Math.random() < 0.5;
    if (Math.random() < 0.5) for (const t of twins) t.label = t.label === 'yes' ? 'no' : 'yes';
    relabel();
    const finish = () => {
      correct = twins[Math.random() < 0.5 ? 0 : 1];
      evilTwinTest.correctX = SPOTS[correct.side].x;
      for (const tw of twins) tw.ink(tw === correct);
      const lie = Math.random() < 0.5;
      const target = lie ? twins.find((t) => t !== correct)! : correct;
      const byLabel = Math.random() < 0.5;
      const what: Statement = byLabel ? target.label : target.side === 0 ? 'left' : 'right';
      ctx.narrate(SAY[lie ? (`${what}Lie` as const) : what], 4500, { priority: true });
      busy = false;
    };
    if (!swapSides) {
      finish();
      return;
    }
    // They cross over: an arc each way, so it reads as a shuffle.
    whoosh();
    let t = 0;
    const from = twins.map((tw) => SPOTS[tw.side].clone());
    const to = twins.map((tw) => SPOTS[(1 - tw.side) as Side].clone());
    addUpdater((dt) => {
      t = Math.min(1, t + dt / 0.8);
      const e = t * t * (3 - 2 * t);
      twins.forEach((tw, i) => {
        const p = from[i].clone().lerp(to[i], e);
        p.z += Math.sin(e * Math.PI) * (i === 0 ? 0.9 : -0.9); // pass each other front/back
        place(tw, p.x, p.z);
        shove(tw.btn.obstacle);
      });
      if (t < 1) return false;
      for (const tw of twins) tw.side = (1 - tw.side) as Side;
      finish();
      return true;
    });
  };

  const press = (t: Twin) => {
    if (busy || solved) return;
    busy = true;
    if (t === correct) {
      streak++;
      const cheated = ctx.isHolding('uv-torch') && !uvSaid;
      if (cheated) {
        uvSaid = true;
        discover('reward:twin-uv');
        ctx.narrate(UV_CHEAT, 5000, { priority: true });
      }
      ding();
      sparkle();
      hud();
      if (streak >= NEED) {
        solve();
        return;
      }
      if (!cheated) ctx.narrate(RIGHT_LINES[(streak - 1) % RIGHT_LINES.length], 3000, { priority: true });
      ctx.after(2200, newRound);
    } else {
      streak = 0;
      misses++;
      buzzer();
      sadTrombone();
      hud();
      redFlash();
      const line = misses === 2 ? HINT_1 : misses >= 4 && misses % 2 === 0 ? HINT_2 : WRONG_LINES[(misses - 1) % WRONG_LINES.length];
      ctx.narrate(line, 4500, { priority: true });
      ctx.after(2600, newRound);
    }
  };

  // Wrong: the room flushes red for a moment.
  const redFlash = () => {
    const base = hemi.color.clone();
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      const k = Math.max(0, 1 - t / 1.2);
      hemi.color.copy(base).lerp(new THREE.Color(0xff2020), k);
      hemi.intensity = 0.55 + k * 1.2;
      return t >= 1.2;
    });
  };

  // Solved: the twins sink, and a third, plain button rises in between.
  const solve = () => {
    solved = true;
    hideCounter();
    fanfare();
    discover('mech:evil-twin');
    ctx.narrate(SOLVED, 8000, { priority: true });
    for (const t of twins) {
      t.btn.interactable.promptLabel = '';
      ctx.removeObstacle(t.btn.obstacle);
      t.sign.group.visible = false;
      const g = t.btn.group;
      let k = 0;
      addUpdater((dt) => {
        k = Math.min(1, k + dt / 1.0);
        g.position.y = -1.3 * k;
        if (k >= 1) g.visible = false;
        return k >= 1;
      });
    }
    ctx.after(1400, () => {
      const at = new THREE.Vector3(0, 0, -4.6);
      const exit = spawnPedestalButton(root, at, () => ctx.advance(at), { glow: false });
      ctx.addObstacle(exit.obstacle);
      exit.group.position.y = -1.3;
      let k = 0;
      addUpdater((dt) => {
        k = Math.min(1, k + dt / 1.2);
        exit.group.position.y = -1.3 * (1 - k);
        return k >= 1;
      });
    });
  };

  setTheme(0);
  relabel();
  hud();
  ctx.narrate(INTRO, 6500);
  ctx.after(6000, newRound);
}

// ── Sounds ──
function ding(): void {
  ensureAudio();
  tone({ type: 'sine', from: 1046, dur: 0.35, gain: 0.14 });
  tone({ type: 'sine', from: 1568, dur: 0.5, gain: 0.08 });
}
function buzzer(): void {
  ensureAudio();
  tone({ type: 'square', from: 120, to: 110, dur: 0.6, gain: 0.12 });
  tone({ type: 'sawtooth', from: 123, to: 112, dur: 0.6, gain: 0.08 });
  noise(0.6, 0.04, 400, 'lowpass');
}

// Draw `text` centred at (x, y), shrinking the font until it fits `maxW`.
function fitText(g: CanvasRenderingContext2D, text: string, style: string, size: number, x: number, y: number, maxW: number, color: string): void {
  let px = size;
  do {
    g.font = `${style} ${px}px ${FONT_VOICE}`;
  } while (g.measureText(text).width > maxW && --px > 10);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

// A sign on a short post, facing the player (+Z).
function buildSign(root: THREE.Object3D): { draw: (text: string) => void; group: THREE.Group } {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x3a3a3e, metalness: 0.6, roughness: 0.4 }));
  post.position.y = 0.7;
  group.add(post);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.03), new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.6 }));
  board.position.y = 1.5;
  group.add(board);
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 160;
  const tex = new THREE.CanvasTexture(cv);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.26), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, 1.5, 0.02);
  group.add(face);
  root.add(group);
  return {
    group,
    draw: (text) => {
      const g = cv.getContext('2d')!;
      g.fillStyle = '#f4efe2';
      g.fillRect(0, 0, 512, 160);
      fitText(g, text, 'bold', 78, 256, 84, 470, '#1a1a1a');
      tex.needsUpdate = true;
    },
  };
}

// One prop per theme, all built once and toggled: nothing is created mid-level.
function buildProps(root: THREE.Object3D): Record<Theme['prop'], THREE.Group> {
  const mk = () => {
    const g = new THREE.Group();
    g.visible = false;
    root.add(g);
    return g;
  };
  const mat = (c: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...extra });
  const X = W / 2 - 1.1; // by the right wall, clear of it

  const plant = mk();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.5, 12), mat(0x9a5a3a));
  pot.position.set(-X, 0.25, -4.5);
  plant.add(pot);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.8, 5), mat(0x3f7a34, { flatShading: true }));
    leaf.position.set(-X + Math.cos(i) * 0.1, 0.9, -4.5 + Math.sin(i) * 0.1);
    leaf.rotation.set(Math.sin(i) * 0.4, 0, Math.cos(i) * 0.4);
    plant.add(leaf);
  }

  const lamp = mk();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.5, 8), mat(0x2a2a2e, { metalness: 0.6 }));
  stem.position.set(X, 0.75, -4.5);
  lamp.add(stem);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.4, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0c0, side: THREE.DoubleSide }));
  shade.position.set(X, 1.6, -4.5);
  lamp.add(shade);

  const clock = mk();
  const faceCv = document.createElement('canvas');
  faceCv.width = faceCv.height = 128;
  const fg = faceCv.getContext('2d')!;
  fg.fillStyle = '#f6f3ea';
  fg.beginPath();
  fg.arc(64, 64, 60, 0, Math.PI * 2);
  fg.fill();
  fg.strokeStyle = '#1a1a1a';
  fg.lineWidth = 6;
  fg.stroke();
  fg.beginPath();
  fg.moveTo(64, 64);
  fg.lineTo(64, 22); // it's always twelve
  fg.moveTo(64, 64);
  fg.lineTo(96, 64);
  fg.stroke();
  const clockFace = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(faceCv), transparent: true }));
  clockFace.position.set(-3.6, 2.6, -D / 2 + 0.2); // off the wall face
  clock.add(clockFace);

  const fishbowl = mk();
  const table = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.6), mat(0x6b4a2b));
  table.position.set(X, 0.4, -4.5);
  fishbowl.add(table);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshStandardMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.45, roughness: 0.1 }));
  bowl.position.set(X, 1.05, -4.5);
  fishbowl.add(bowl);
  const fish = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), mat(0xff8a1a));
  fish.rotation.z = Math.PI / 2;
  fish.position.set(X, 1.02, -4.5);
  fishbowl.add(fish);

  const chair = mk();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.55), mat(0x8a2a2a));
  seat.position.set(-X, 0.48, -4.5);
  chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.08), mat(0x8a2a2a));
  back.position.set(-X, 0.8, -4.78);
  chair.add(back);
  for (const [lx, lz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.48, 0.05), mat(0x2a2a2e));
    leg.position.set(-X + lx, 0.24, -4.5 + lz);
    chair.add(leg);
  }

  return { plant, lamp, clock, fishbowl, chair };
}
