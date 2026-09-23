import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Interactable } from '../interactables/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { registerInteractable } from '../interactables/system';
import { spawnPedestalButton } from '../button/pedestal-button';
import { tone, noise, ensureAudio, click, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';

// THE CAPTCHA — before you continue, a quick check. The room stays shut; on the
// back wall, a giant "I'm not a robot" panel. Tick the box, and it wants more:
// picture grids — select all squares with DUCKS, then TRAINS (things you've met),
// then REGRET (anything goes, it's all regret), then BUTTONS (every square is a
// button). A wrong VERIFY just deals a new grid ("Please try again."), so it can
// never lock you in. Pass all four and a button rises to move you on — unless you
// were TOO good (no mistakes, and quick): then it decides you're a robot. You
// still get out. It is just very sure about you.
//
// Aim + press (crosshair ray on the panel, like the booth's soundboard): the ray
// hits the panel plane, its UV maps to the canvas, and the canvas regions (the
// checkbox, the tiles, VERIFY) are the buttons.

const { depth: D } = CONFIG.ROOM; // 11 × 13 × 3.6
const PANEL_W = 4.6;
const CW = 1024; // canvas px
const CH = 800;
const PANEL_H = (PANEL_W * CH) / CW;
const PANEL_Y = 1.9;
const WALL_Z = -D / 2 + 0.06; // the back wall's inner face
const FRAME_Z = WALL_Z + 0.12;
const FACE_Z = WALL_Z + 0.2; // well clear of the wall and the frame's front
const ROBOT_TIME = 45; // seconds, box to last VERIFY: perfect AND this fast = robot

const INTRO = vo('Before you continue, a quick check. It is only a formality. They are always only a formality.');
const CHECKED = vo('You ticked the box. It was not enough. It is never enough.');
const R_LINES = vo([
  'Ducks. You have met ducks. This should be easy.',
  'Trains. You have been hit by at least one. Probably.',
  'Regret. Take your time.',
  'Buttons. Select all the buttons. I will wait.',
]);
const WRONG = vo([
  'Please try again. The computer is disappointed. So am I.',
  'Wrong. In fairness, it was a very ambiguous duck.',
  'Please try again. Nobody passes these first time. Nobody human.',
]);
const REGRET_OK = vo('Correct. That is regret. It all is.');
const HUMAN = vo('Verified. You are human. Mostly because you got some of them wrong. Off you go.');
const ROBOT = vo('Too fast. Too accurate. Nobody human has ever selected every button first time. You are a robot. Robots may leave through the same button. We are not monsters.');

type Pic = 'duck' | 'train' | 'wolf' | 'grandma' | 'dummy' | 'cactus' | 'button' | 'axe' | 'chalk' | 'saw';
interface Round {
  word: string;
  target: Pic | 'any' | 'all';
  pool: Pic[]; // the distractors
}
const ROUNDS: Round[] = [
  { word: 'DUCKS', target: 'duck', pool: ['train', 'wolf', 'grandma', 'dummy', 'cactus', 'axe', 'button'] },
  { word: 'TRAINS', target: 'train', pool: ['duck', 'cactus', 'dummy', 'wolf', 'button', 'saw'] },
  { word: 'REGRET', target: 'any', pool: ['chalk', 'saw', 'duck', 'train', 'wolf', 'button', 'axe', 'grandma', 'dummy'] },
  { word: 'BUTTONS', target: 'all', pool: ['button'] },
];

// Layout (canvas px).
const TILE = 176;
const GAP = 10;
const GRID_X = (CW - (TILE * 3 + GAP * 2)) / 2;
const GRID_Y = 176;
const VERIFY = { x: CW - 250, y: CH - 84, w: 200, h: 62 };
const BOX = { x: 250, y: 330, w: 110, h: 110 };

type Stage = 'box' | 'spin' | 'grid' | 'done';

export function revealCaptcha(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; the button sinks

  // ── The panel: a frame on the back wall, a canvas face in front of it ──
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(PANEL_W + 0.24, PANEL_H + 0.24, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.5, metalness: 0.3 }),
  );
  frame.position.set(0, PANEL_Y, FRAME_Z);
  root.add(frame);
  const cv = document.createElement('canvas');
  cv.width = CW;
  cv.height = CH;
  const g = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_H), new THREE.MeshBasicMaterial({ map: tex }));
  panel.position.set(0, PANEL_Y, FACE_Z);
  root.add(panel);
  panel.updateMatrixWorld();

  // ── State ──
  let stage: Stage = 'box';
  let round = 0;
  let tiles: Pic[] = [];
  let picked = new Set<number>();
  let hover: string | null = null; // 'box' | 'verify' | 'tile:N'
  let message = ''; // a line under the grid ("Please try again.")
  let mistakes = 0;
  let startT = 0;
  let clock = 0;
  let wrongN = 0;

  const deal = () => {
    const r = ROUNDS[round];
    picked = new Set();
    if (r.target === 'all') tiles = Array(9).fill('button');
    else if (r.target === 'any') tiles = shuffle(r.pool.slice()).slice(0, 9);
    else {
      const n = 3 + Math.floor(Math.random() * 2); // 3–4 of the right thing
      tiles = [];
      for (let i = 0; i < 9; i++) tiles.push(i < n ? r.target : r.pool[Math.floor(Math.random() * r.pool.length)]);
      tiles = shuffle(tiles);
    }
    draw();
  };

  const draw = () => {
    g.fillStyle = '#f4f5f7';
    g.fillRect(0, 0, CW, CH);
    if (stage === 'box' || stage === 'spin') {
      // The famous little card, very large.
      g.fillStyle = '#fafafa';
      g.strokeStyle = '#d3d3d3';
      g.lineWidth = 4;
      roundRect(g, 180, 250, 664, 270, 12);
      g.fill();
      g.stroke();
      g.lineWidth = 6;
      g.strokeStyle = hover === 'box' ? '#4a90e2' : '#c1c1c1';
      g.fillStyle = '#fff';
      roundRect(g, BOX.x, BOX.y, BOX.w, BOX.h, 8);
      g.fill();
      g.stroke();
      if (stage === 'spin') {
        g.strokeStyle = '#4a90e2';
        g.lineWidth = 10;
        g.beginPath();
        g.arc(BOX.x + BOX.w / 2, BOX.y + BOX.h / 2, 34, clock * 6, clock * 6 + 4.2);
        g.stroke();
      }
      g.fillStyle = '#222';
      fitText(g, "I'm not a robot", 400, 385, 360, 52, '');
      g.fillStyle = '#9aa0a6';
      fitText(g, 'reCAPTCHA-ish', 740, 470, 160, 22, '');
      fitText(g, 'Privacy · Terms · Regret', 740, 496, 180, 18, '');
    } else if (stage === 'grid') {
      const r = ROUNDS[round];
      // Header.
      g.fillStyle = '#4a90e2';
      g.fillRect(GRID_X, 28, TILE * 3 + GAP * 2, 134);
      g.fillStyle = '#fff';
      fitText(g, 'Select all squares with', CW / 2, 66, 500, 30, '');
      fitText(g, r.word, CW / 2, 122, 500, 64, 'bold');
      // Tiles.
      for (let i = 0; i < 9; i++) {
        const { x, y } = tileXY(i);
        g.fillStyle = '#e9edf1';
        g.fillRect(x, y, TILE, TILE);
        drawPic(g, tiles[i], x, y, TILE);
        if (picked.has(i)) {
          g.fillStyle = 'rgba(74,144,226,0.35)';
          g.fillRect(x, y, TILE, TILE);
          g.fillStyle = '#4a90e2';
          g.beginPath();
          g.arc(x + 26, y + 26, 20, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = '#fff';
          g.lineWidth = 6;
          g.beginPath();
          g.moveTo(x + 16, y + 27);
          g.lineTo(x + 24, y + 35);
          g.lineTo(x + 37, y + 17);
          g.stroke();
        }
        if (hover === `tile:${i}`) {
          g.strokeStyle = '#1a5fb4';
          g.lineWidth = 6;
          g.strokeRect(x + 3, y + 3, TILE - 6, TILE - 6);
        }
      }
      // VERIFY + the message line.
      g.fillStyle = hover === 'verify' ? '#2f78d1' : '#4a90e2';
      roundRect(g, VERIFY.x, VERIFY.y, VERIFY.w, VERIFY.h, 6);
      g.fill();
      g.fillStyle = '#fff';
      fitText(g, 'VERIFY', VERIFY.x + VERIFY.w / 2, VERIFY.y + VERIFY.h / 2 + 2, VERIFY.w - 24, 34, 'bold');
      if (message) {
        g.fillStyle = '#d93025';
        fitText(g, message, GRID_X + 250, VERIFY.y + VERIFY.h / 2, 480, 34, '');
      }
    }
    if (stage === 'done') {
      g.fillStyle = 'rgba(244,245,247,0.94)';
      g.fillRect(0, 0, CW, CH);
      g.fillStyle = message.startsWith('ROBOT') ? '#d93025' : '#1e8e3e';
      fitText(g, message, CW / 2, CH / 2, CW - 120, 90, 'bold');
    }
    tex.needsUpdate = true;
  };

  // ── What's under the crosshair ──
  const ray = new THREE.Raycaster();
  ray.far = 9;
  const CENTER = new THREE.Vector2(0, 0);
  const regionAt = (u: number, v: number): string | null => {
    const x = u * CW;
    const y = (1 - v) * CH;
    const inside = (b: { x: number; y: number; w: number; h: number }) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
    if (stage === 'box') return inside({ x: BOX.x - 20, y: BOX.y - 20, w: BOX.w + 40, h: BOX.h + 40 }) ? 'box' : null;
    if (stage !== 'grid') return null;
    if (inside(VERIFY)) return 'verify';
    for (let i = 0; i < 9; i++) {
      const t = tileXY(i);
      if (inside({ x: t.x, y: t.y, w: TILE, h: TILE })) return `tile:${i}`;
    }
    return null;
  };

  const verify = () => {
    const r = ROUNDS[round];
    let ok: boolean;
    if (r.target === 'any') ok = picked.size > 0;
    else if (r.target === 'all') ok = picked.size === 9;
    else ok = tiles.every((t, i) => (t === r.target) === picked.has(i));
    if (!ok) {
      mistakes++;
      buzz();
      message = 'Please try again.';
      ctx.narrate(WRONG[wrongN++ % WRONG.length], 4500, { priority: true });
      deal();
      ctx.after(2200, () => {
        if (message === 'Please try again.') {
          message = '';
          draw();
        }
      });
      return;
    }
    chime();
    if (r.target === 'any') ctx.narrate(REGRET_OK, 3500, { priority: true });
    round++;
    message = '';
    if (round < ROUNDS.length) {
      if (r.target !== 'any') ctx.narrate(R_LINES[round], 4000, { priority: true });
      else ctx.after(2600, () => ctx.narrate(R_LINES[round], 4000, { priority: true }));
      deal();
      return;
    }
    // Passed. Human, or suspiciously good?
    const robot = mistakes === 0 && clock - startT < ROBOT_TIME;
    stage = 'done';
    message = robot ? 'ROBOT DETECTED' : 'You are verified ✓';
    draw();
    if (robot) {
      discover('reward:certified-robot');
      buzz();
      ctx.narrate(ROBOT, 9000, { priority: true });
    } else {
      sparkle();
      ctx.narrate(HUMAN, 6000, { priority: true });
    }
    ctx.after(robot ? 3500 : 1500, spawnExit);
  };

  const press = (region: string) => {
    if (stage === 'box' && region === 'box') {
      click();
      stage = 'spin';
      startT = clock;
      discover('mech:captcha');
      ctx.narrate(CHECKED, 4000, { priority: true });
      ctx.after(1300, () => {
        stage = 'grid';
        round = 0;
        deal();
        ctx.after(1800, () => ctx.narrate(R_LINES[0], 4000, { priority: true }));
      });
      return;
    }
    if (stage !== 'grid') return;
    if (region === 'verify') return verify();
    const i = Number(region.slice(5));
    click();
    if (picked.has(i)) picked.delete(i);
    else picked.add(i);
    draw();
  };

  // One interactable claims presses while the crosshair is on a live region.
  const hit3 = new THREE.Vector3();
  const it: Interactable = {
    id: 'captcha-panel',
    position: new THREE.Vector3(0, PANEL_Y, FACE_Z),
    radius: 9,
    promptLabel: '',
    onUse: () => {
      if (hover) press(hover);
    },
  };
  registerInteractable(it);
  addUpdater((dt) => {
    clock += dt;
    if (stage === 'spin') draw();
    ray.setFromCamera(CENTER, ctx.camera);
    const h = ray.intersectObject(panel, false)[0];
    const next = h?.uv ? regionAt(h.uv.x, h.uv.y) : null;
    if (next !== hover) {
      hover = next;
      draw();
    }
    it.promptLabel = hover ? 'PRESS' : '';
    if (h) it.position.copy(hit3.copy(h.point)); // claims presses from where you are aiming
    return false;
  });

  // ── The way out: a plain button, in front of the panel, clear of you ──
  const spawnExit = () => {
    const p = ctx.playerPos();
    const spots = [new THREE.Vector3(0, 0, -3.6), new THREE.Vector3(-3, 0, -3.6), new THREE.Vector3(3, 0, -3.6), new THREE.Vector3(0, 0, 1)];
    const at = spots.find((s) => Math.hypot(s.x - p.x, s.z - p.z) > 1.6) ?? spots[0];
    const btn = spawnPedestalButton(root, at, () => ctx.advance(at), { glow: false });
    ctx.addObstacle(btn.obstacle);
  };

  captchaTest.press = press;
  captchaTest.state = () => ({ stage, round, tiles: tiles.slice(), picked: [...picked] });
  draw();
  ctx.narrate(INTRO, 6000);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function tileXY(i: number): { x: number; y: number } {
  return { x: GRID_X + (i % 3) * (TILE + GAP), y: GRID_Y + Math.floor(i / 3) * (TILE + GAP) };
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Text shrunk until it fits `maxW`.
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight: string): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = size;
  do {
    g.font = `${weight} ${px}px system-ui, -apple-system, sans-serif`;
  } while (g.measureText(text).width > maxW && --px > 10);
  g.fillText(text, x, y);
}

// Simple, readable doodles of things from the game.
function drawPic(g: CanvasRenderingContext2D, pic: Pic, x: number, y: number, s: number): void {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const k = s / 176;
  g.save();
  g.translate(cx, cy);
  g.scale(k, k);
  const circ = (px: number, py: number, r: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.fill();
  };
  const rect = (px: number, py: number, w: number, h: number, fill: string) => {
    g.fillStyle = fill;
    g.fillRect(px, py, w, h);
  };
  switch (pic) {
    case 'duck':
      circ(-8, 18, 42, '#ffcc22');
      circ(28, -24, 24, '#ffcc22');
      g.fillStyle = '#ff8800';
      g.beginPath();
      g.moveTo(48, -26);
      g.lineTo(70, -18);
      g.lineTo(48, -12);
      g.fill();
      circ(34, -30, 5, '#111');
      break;
    case 'train':
      rect(-62, -22, 104, 58, '#24262e');
      rect(-62, -54, 44, 34, '#24262e');
      rect(22, -46, 16, 26, '#131318');
      rect(-56, -46, 30, 16, '#ffd27a');
      for (const wx of [-44, -10, 24]) circ(wx, 44, 14, '#131318');
      circ(46, 6, 9, '#fff0c2');
      break;
    case 'wolf':
      rect(-58, -6, 92, 40, '#6b6e76');
      rect(24, -36, 38, 34, '#6b6e76');
      g.fillStyle = '#6b6e76';
      g.beginPath();
      g.moveTo(28, -36);
      g.lineTo(36, -58);
      g.lineTo(46, -36);
      g.fill();
      rect(58, -24, 16, 14, '#6b6e76');
      circ(48, -26, 4, '#ffd23f');
      for (const lx of [-50, -30, 10, 26]) rect(lx, 30, 10, 28, '#3a3c42');
      break;
    case 'grandma':
      circ(0, 8, 42, '#f0c8a8');
      g.fillStyle = '#f6f3ea';
      g.beginPath();
      g.moveTo(-46, -8);
      g.lineTo(46, -8);
      g.lineTo(30, -70);
      g.closePath();
      g.fill();
      circ(34, -70, 9, '#f6f3ea');
      g.strokeStyle = '#2a2a2a';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(-15, 8, 11, 0, Math.PI * 2);
      g.moveTo(26, 8);
      g.arc(15, 8, 11, 0, Math.PI * 2);
      g.stroke();
      break;
    case 'dummy':
      rect(-18, -70, 36, 34, '#a8a8a4');
      rect(-30, -34, 60, 58, '#a8a8a4');
      rect(-44, -30, 12, 50, '#a8a8a4');
      rect(32, -30, 12, 50, '#a8a8a4');
      rect(-26, 26, 18, 46, '#a8a8a4');
      rect(8, 26, 18, 46, '#a8a8a4');
      break;
    case 'cactus':
      rect(-14, -64, 28, 130, '#5f7d3c');
      rect(-48, -18, 36, 18, '#5f7d3c');
      rect(-48, -48, 16, 34, '#5f7d3c');
      rect(12, -2, 36, 18, '#5f7d3c');
      rect(32, -38, 16, 40, '#5f7d3c');
      break;
    case 'button':
      rect(-50, 20, 100, 40, '#8a8a86');
      g.fillStyle = '#d31414';
      g.beginPath();
      g.ellipse(0, 20, 40, 30, 0, Math.PI, 0);
      g.fill();
      circ(-12, 4, 8, 'rgba(255,255,255,0.6)');
      break;
    case 'axe':
      g.save();
      g.rotate(-0.6);
      rect(-6, -60, 12, 124, '#6b4a2b');
      g.fillStyle = '#9aa0a8';
      g.beginPath();
      g.moveTo(6, -60);
      g.lineTo(46, -74);
      g.lineTo(46, -24);
      g.lineTo(6, -34);
      g.fill();
      g.restore();
      break;
    case 'chalk':
      g.strokeStyle = '#fff';
      g.lineWidth = 6;
      rect(-88, -88, 176, 176, '#3a3a40');
      g.beginPath();
      g.arc(0, -46, 18, 0, Math.PI * 2);
      g.moveTo(0, -28);
      g.lineTo(0, 22);
      g.moveTo(-40, -14);
      g.lineTo(40, -2);
      g.moveTo(0, 22);
      g.lineTo(-30, 60);
      g.moveTo(0, 22);
      g.lineTo(34, 54);
      g.stroke();
      break;
    case 'saw':
      circ(0, 0, 56, '#b0b4bd');
      g.fillStyle = '#b0b4bd';
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        g.beginPath();
        g.moveTo(Math.cos(a) * 54, Math.sin(a) * 54);
        g.lineTo(Math.cos(a + 0.2) * 72, Math.sin(a + 0.2) * 72);
        g.lineTo(Math.cos(a + 0.35) * 54, Math.sin(a + 0.35) * 54);
        g.fill();
      }
      circ(0, 0, 12, '#3a3c42');
      break;
  }
  g.restore();
}

// ── Sounds ──
function chime(): void {
  ensureAudio();
  tone({ type: 'sine', from: 880, dur: 0.18, gain: 0.12 });
  tone({ type: 'sine', from: 1320, dur: 0.3, gain: 0.1, attack: 0.08 });
}
function buzz(): void {
  ensureAudio();
  tone({ type: 'square', from: 140, to: 120, dur: 0.35, gain: 0.08 });
  noise(0.2, 0.05, 900, 'lowpass');
}

// Test hooks for the headless sim (set by the live level).
export const captchaTest: {
  press?: (region: string) => void;
  state?: () => { stage: string; round: number; tiles: string[]; picked: number[] };
} = {};
