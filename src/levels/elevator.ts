import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { registerInteractable } from '../interactables/system';
import type { Interactable } from '../interactables/types';
import { click, quack, applause, trainHorn, pop, sparkle, tone, noise, audioOut } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { hideRoomShell } from './scaffold';
import { buildExitRoom } from './exit-room';

// THE ELEVATOR — the white room was a lift all along. A panel of forty floor
// buttons, plus DOOR OPEN, DOOR CLOSE (never connected, in any lift, anywhere),
// ALARM and EMERGENCY STOP. Press a floor and the lift goes there: the doors
// open on a quick absurd diorama (ducks staring, the desert, a circus crowd,
// grandma, a wolf, an office, the void, yourself), then close again.
//
// The panel has no exit. The way out is what every child does: press EVERY
// floor button. The lift, noticing, stops at all forty — quickly, out of spite —
// and then opens on a floor that isn't on the panel, with the exit room.
//
// Music: a synthesised muzak loop plays while you're in here; it stops when the
// level is left. (The recorded track is the waiting room's.)

const MUSIC_GAIN = 0.22;

const FLOORS = 40;
const FINAL = FLOORS + 1; // the floor that isn't on the panel

// The car (around where you stand when the room turns): x ±CAR_X, z from the
// doors (CAR_FRONT) back to CAR_BACK.
const CAR_X = 2.5;
const CAR_FRONT = -5;
const CAR_BACK = 1.5;
const CAR_H = 3;
const DOOR_HALF = 1.2;
const DOOR_H = 2.4;
// The diorama space behind the doors.
const DIO_BACK = -8.6;
const DIO_X = 1.8;

// The panel, on the right-hand wall by the doors (faces −X, into the car).
const PANEL_X = CAR_X - 0.05;
const PANEL_Z = -3.9;
const PANEL_Y = 1.45;
const PW = 0.66; // along z
const PH = 1.4;
const COLS = 4;
const ROWS = 11; // row 0: specials; rows 1–10: floors 1–40, bottom to top
const SPECIALS = ['OPEN', 'CLOSE', 'ALARM', 'STOP'] as const;

const INTRO = vo('Ah. It was a lift all along. Forty floors. Choose one. Or, and I cannot stress this enough, do not choose all of them.');
const CLOSE_LINES = vo([
  'That one has never been connected. In any lift. Anywhere. It is there for your morale.',
  'Still not connected. It will not be connected the next time either.',
]);
const ALARM = vo('The alarm. Somewhere, a man in a booth looks up, sighs, and does nothing.');
const STOPPED = vo('Stopped. Between floors. Well done. It will start again in a moment. It always does.');
const ALL_PRESSED = vo('Every single button. You are a child. The lift has seen your kind before. It will now stop at every floor, out of spite. Quickly.');
const FINAL_LINE = vo('Floor forty-one. There is no floor forty-one. And yet. Off you go.');
type Scene = 'ducks' | 'desert' | 'circus' | 'grandma' | 'wolf' | 'office' | 'void' | 'mirror';
const SCENE_LINES: Record<Scene, string> = vo({
  ducks: 'Ducks. All of them looking at you. They know what you did. Or what you will do.',
  desert: 'The desert. A train, very far away. Do not step out. It would notice.',
  circus: 'A full house. They applaud the doors. It is the most interesting thing to happen here in years.',
  grandma: 'Wrong floor, dear, she says. She does not look up from the knitting.',
  wolf: 'A wolf. It was not expecting you either. Close the doors. Close the doors.',
  office: 'Accounts. Nobody has ever come back from accounts.',
  void: 'Nothing. And, far off, another button. No. Do not.',
  mirror: 'It is you. From earlier. Do not make eye contact.',
});
const SCENES: Scene[] = ['ducks', 'desert', 'circus', 'grandma', 'wolf', 'office', 'void', 'mirror'];
const sceneFor = (floor: number): Scene => SCENES[(floor * 5 + 3) % SCENES.length];

export function revealElevator(ctx: GameContext): void {
  const root = ctx.levelRoot;
  // The white box becomes the car: walls stay up (then the shell is swapped for
  // the car's own steel-and-wood interior), the button sinks.
  ctx.openRoom({ walls: false, ceiling: false });
  hideRoomShell(ctx);
  // Keep you inside the car, wherever you stood when it turned.
  const cam = ctx.camera.position;
  cam.x = THREE.MathUtils.clamp(cam.x, -CAR_X + 0.4, CAR_X - 0.4);
  cam.z = THREE.MathUtils.clamp(cam.z, CAR_FRONT + 0.4, CAR_BACK - 0.4);
  const carRegion = { minX: -CAR_X + 0.2, maxX: CAR_X - 0.2, minZ: CAR_FRONT + 0.25, maxZ: CAR_BACK - 0.2, floorY: 0 };
  ctx.setRegions([carRegion]);

  const car = buildCar(root);
  const panel = buildPanel(root);
  const indicator = buildIndicator(root);
  const doors = buildDoors(root);
  const dio = buildDiorama(root);
  discover('mech:lift-panel');

  // ── Music ──
  startMusic(root);

  // ── State ──
  let floor = 0; // G
  let target = 0;
  const pressed = new Set<number>(); // ever pressed — they stay lit
  const queue: number[] = [];
  type Phase = 'idle' | 'travel' | 'opening' | 'dwell' | 'closing' | 'final';
  let phase: Phase = 'idle';
  let t = 0; // time in the current phase
  let travelTime = 1;
  let dwellTime = 2;
  let stopped = 0; // EMERGENCY STOP: seconds left halted
  let closeSaid = 0;
  let allSaid = false;
  const seenScenes = new Set<Scene>();
  const hurry = () => allSaid || queue.length > 3; // spite: every floor, quickly

  const light = (i: number, on: boolean) => panel.setLit(i, on);

  const arrive = () => {
    floor = target;
    indicator.draw(floor === FINAL ? '41' : floor === 0 ? 'G' : String(floor), 0);
    ding();
    if (floor === FINAL) {
      openFinal();
      return;
    }
    const scene = sceneFor(floor);
    dio.show(scene);
    dio.react(scene);
    if (!hurry() && !seenScenes.has(scene)) {
      seenScenes.add(scene);
      ctx.narrate(SCENE_LINES[scene], 4500, { priority: true });
    }
    phase = 'opening';
    t = 0;
  };

  const next = () => {
    if (queue.length > 0) {
      target = queue.shift()!;
      travelTime = hurry() ? 0.35 : 0.8 + Math.min(1.2, Math.abs(target - floor) * 0.05);
      phase = 'travel';
      t = 0;
      hum(travelTime);
      return;
    }
    if (pressed.size >= FLOORS) {
      target = FINAL;
      travelTime = 1.6;
      phase = 'travel';
      t = 0;
      hum(travelTime);
      return;
    }
    phase = 'idle';
  };

  const press = (i: number) => {
    click();
    panel.poke(i);
    if (i < SPECIALS.length) return special(SPECIALS[i]);
    const f = i - SPECIALS.length + 1; // 1..40
    if (phase === 'final') return;
    if (!pressed.has(f)) {
      pressed.add(f);
      light(i, true);
    }
    if (f === floor && phase === 'idle' && stopped <= 0) {
      // Pressing the floor you're on just opens the doors, like a real one.
      if (floor > 0) dio.show(sceneFor(floor));
      phase = 'opening';
      t = 0;
    } else if (f !== floor && !queue.includes(f)) queue.push(f);
    if (pressed.size === FLOORS && !allSaid) {
      allSaid = true;
      ctx.narrate(ALL_PRESSED, 6500, { priority: true });
    }
    if (phase === 'idle' && stopped <= 0) next();
  };

  const special = (s: (typeof SPECIALS)[number]) => {
    if (s === 'OPEN') {
      if (phase === 'idle' && stopped <= 0) {
        if (floor > 0) dio.show(sceneFor(floor));
        phase = 'opening';
        t = 0;
      } else if (phase === 'dwell') t = 0; // hold them
    } else if (s === 'CLOSE') {
      // Never connected.
      ctx.narrate(CLOSE_LINES[Math.min(closeSaid++, CLOSE_LINES.length - 1)], 4500, { priority: true });
    } else if (s === 'ALARM') {
      bell();
      ctx.narrate(ALARM, 4500, { priority: true });
    } else if (s === 'STOP') {
      if (phase === 'final') return;
      stopped = 4;
      car.alarmLight(true);
      musicDuck(true);
      thunk();
      ctx.narrate(STOPPED, 5000, { priority: true });
    }
  };

  const openFinal = () => {
    phase = 'final';
    dio.show(null);
    // The floor that isn't on the panel: the exit room, right outside the doors.
    const room = buildExitRoom(ctx, { center: new THREE.Vector3(0, 0, CAR_FRONT - 0.6 - 4.5), facing: 'posZ' });
    ctx.setRegions([
      carRegion,
      // The doorway: it must overlap the car AND the room by ≥ 2 × player radius
      // (walking only crosses between regions where both contain you), so it
      // reaches well into each.
      { minX: -DOOR_HALF + 0.25, maxX: DOOR_HALF - 0.25, minZ: CAR_FRONT - 1.8, maxZ: CAR_FRONT + 1.4, floorY: 0 },
      room,
    ]);
    sparkle();
    discover('reward:floor-41');
    ctx.narrate(FINAL_LINE, 5500, { priority: true });
    t = 0;
  };

  // ── One interactable: whichever panel button the crosshair is on ──
  const aim = new THREE.Raycaster();
  aim.far = 3;
  const CROSSHAIR = new THREE.Vector2(0, 0);
  let sel = -1;
  const use: Interactable = {
    id: 'lift-panel',
    position: new THREE.Vector3(PANEL_X, PANEL_Y, PANEL_Z),
    radius: 2.4,
    promptLabel: '',
    onUse: () => {
      if (sel >= 0) press(sel);
    },
  };
  registerInteractable(use);

  ctx.narrate(INTRO, 7000);
  indicator.draw('G', 0);

  addUpdater((dt) => {
    // Aim.
    aim.setFromCamera(CROSSHAIR, ctx.camera);
    sel = panel.pick(aim);
    use.promptLabel = sel >= 0 ? 'PRESS' : ''; // non-empty = claims the press
    if (sel >= 0) panel.buttonPos(sel, use.position);
    panel.tick(dt);
    dio.tick(dt);

    if (stopped > 0) {
      stopped -= dt;
      if (stopped <= 0) {
        car.alarmLight(false);
        musicDuck(false);
        if (phase === 'idle') next();
      }
      return false; // everything holds, doors and all
    }

    t += dt;
    if (phase === 'travel') {
      // Hum, a little shake, and the numbers ticking by.
      const k = Math.min(1, t / travelTime);
      const shown = Math.round(THREE.MathUtils.lerp(floor, target, k));
      indicator.draw(target === FINAL && k > 0.5 ? '??' : shown === 0 ? 'G' : String(shown), Math.sign(target - floor));
      ctx.camera.position.y += Math.sin(t * 47) * 0.008;
      if (k >= 1) arrive();
    } else if (phase === 'opening') {
      const dur = hurry() ? 0.12 : 0.6;
      doors.set(Math.min(1, t / dur));
      if (t >= dur) {
        phase = 'dwell';
        t = 0;
        dwellTime = hurry() ? 0.3 : 2.2;
      }
    } else if (phase === 'dwell') {
      if (t >= dwellTime) {
        phase = 'closing';
        t = 0;
      }
    } else if (phase === 'closing') {
      const dur = hurry() ? 0.12 : 0.6;
      doors.set(1 - Math.min(1, t / dur));
      if (t >= dur) next();
    } else if (phase === 'final') {
      doors.set(Math.min(1, t / 0.9)); // and they stay open
    }
    return false;
  });
}

// ── Sounds (composed here from the shared primitives) ──

function ding(): void {
  tone({ type: 'sine', from: 1318, dur: 0.5, gain: 0.12 });
  setTimeout(() => tone({ type: 'sine', from: 988, dur: 0.7, gain: 0.12 }), 180);
}
function hum(secs: number): void {
  tone({ type: 'sawtooth', from: 55, to: 62, dur: secs, gain: 0.05, attack: 0.1 });
  noise(secs, 0.03, 300, 'lowpass');
}
function bell(): void {
  for (let i = 0; i < 12; i++) setTimeout(() => tone({ type: 'square', from: 1650, dur: 0.06, gain: 0.07 }), i * 70);
}
function thunk(): void {
  noise(0.3, 0.3, 200, 'lowpass');
  tone({ type: 'sine', from: 90, to: 40, dur: 0.4, gain: 0.25 });
}

// ── Music: a synthesised muzak loop ──

let musicGain: GainNode | null = null;
function musicDuck(down: boolean): void {
  const out = audioOut();
  if (!out || !musicGain) return;
  musicGain.gain.setTargetAtTime(down ? 0 : MUSIC_GAIN, out.ctx.currentTime, 0.15);
}

function startMusic(root: THREE.Object3D): void {
  const out = audioOut();
  if (!out) return;
  const gain = out.ctx.createGain();
  gain.gain.value = MUSIC_GAIN;
  gain.connect(out.master);
  musicGain = gain;
  let synth = true;
  // The level has no teardown hook, but its root leaves the scene on any level
  // change: poll for that and stop.
  const watch = setInterval(() => {
    if (root.parent) return;
    clearInterval(watch);
    gain.disconnect();
    synth = false;
    if (musicGain === gain) musicGain = null;
  }, 400);
  // A gentle bossa-ish loop — Cmaj7, Am7, Dm7, G7 — played note by note
  // through the updater pool (which dies with the level).
  const chords = [
    [261.6, 329.6, 392.0, 493.9],
    [220.0, 261.6, 329.6, 392.0],
    [293.7, 349.2, 440.0, 523.3],
    [196.0, 246.9, 293.7, 349.2],
  ];
  const pattern = [0, 2, 1, 3, 2, 1, 3, 2];
  let beat = 0;
  let acc = 0;
  addUpdater((dt) => {
    if (!synth || !root.parent) return true;
    if (musicGain !== gain) return false; // (ducked by the STOP)
    acc += dt;
    if (acc < 0.28) return false;
    acc -= 0.28;
    const chord = chords[Math.floor(beat / 8) % chords.length];
    if (gain.gain.value > 0.01) {
      tone({ type: 'triangle', from: chord[pattern[beat % 8]], dur: 0.5, gain: 0.035, attack: 0.02 });
      if (beat % 4 === 0) tone({ type: 'sine', from: chord[0] / 2, dur: 0.9, gain: 0.05, attack: 0.03 });
    }
    beat++;
    return false;
  });
}

// ── The car ──

function buildCar(root: THREE.Object3D): { alarmLight: (on: boolean) => void } {
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.35, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.7 });
  const carpet = new THREE.MeshStandardMaterial({ color: 0x5a2a2e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const W = CAR_X * 2;
  const D = CAR_BACK - CAR_FRONT;
  const cz = (CAR_BACK + CAR_FRONT) / 2;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), carpet);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.01, cz);
  root.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x9a9ea6, roughness: 0.6, side: THREE.DoubleSide }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, CAR_H, cz);
  root.add(ceil);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff4dc });
  for (const z of [cz - 1.6, cz + 1.6]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), lamp);
    p.rotation.x = Math.PI / 2;
    p.position.set(0, CAR_H - 0.01, z);
    root.add(p);
  }
  // `gap` (a z-range, side walls only) leaves the handrail open around the
  // panel so it doesn't run across the buttons.
  const wall = (w: number, x: number, z: number, rotY: number, gap?: [number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, CAR_H), steel);
    m.position.set(x, CAR_H / 2, z);
    m.rotation.y = rotY;
    root.add(m);
    const spans: [number, number][] = gap
      ? [[z - (w - 0.2) / 2, gap[0]], [gap[1], z + (w - 0.2) / 2]]
      : [[z - (w - 0.2) / 2, z + (w - 0.2) / 2]];
    for (const [z0, z1] of spans) {
      const len = gap ? z1 - z0 : w - 0.2;
      if (len <= 0.05) continue;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), wood);
      rail.position.set(x, 0.95, gap ? (z0 + z1) / 2 : z);
      rail.rotation.y = rotY;
      rail.translateZ(0.06);
      root.add(rail);
    }
  };
  wall(W, 0, CAR_BACK, Math.PI); // back
  wall(D, -CAR_X, cz, Math.PI / 2); // left
  wall(D, CAR_X, cz, -Math.PI / 2, [PANEL_Z - PW / 2 - 0.1, PANEL_Z + PW / 2 + 0.1]); // right (the panel's wall)
  // Front: steel either side of the doorway and above it.
  const side = CAR_X - DOOR_HALF;
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(side, CAR_H), steel);
    m.position.set(s * (DOOR_HALF + side / 2), CAR_H / 2, CAR_FRONT);
    root.add(m);
  }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_HALF * 2, CAR_H - DOOR_H), steel);
  top.position.set(0, DOOR_H + (CAR_H - DOOR_H) / 2, CAR_FRONT);
  root.add(top);
  root.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2a2a, 0.7));
  // A red emergency lamp over the doors, lit by EMERGENCY STOP.
  const red = new THREE.MeshBasicMaterial({ color: 0x3a0c0c });
  const alarm = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), red);
  alarm.position.set(-0.7, 2.75, CAR_FRONT + 0.06);
  root.add(alarm);
  return {
    alarmLight: (on) => {
      red.color.setHex(on ? 0xff2a1a : 0x3a0c0c);
    },
  };
}

function buildDoors(root: THREE.Object3D): { set: (open: number) => void } {
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9cdd4, roughness: 0.25, metalness: 0.75 });
  const leaves = [-1, 1].map((s) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(DOOR_HALF, DOOR_H, 0.05), mat);
    m.position.set((s * DOOR_HALF) / 2, DOOR_H / 2, CAR_FRONT + 0.04);
    root.add(m);
    return { m, s };
  });
  return {
    set: (open) => {
      const e = open * open * (3 - 2 * open);
      for (const { m, s } of leaves) m.position.x = s * (DOOR_HALF / 2 + e * (DOOR_HALF - 0.05));
    },
  };
}

function buildIndicator(root: THREE.Object3D): { draw: (text: string, dir: number) => void } {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 96;
  const g = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshBasicMaterial({ map: tex }));
  m.position.set(0.25, 2.72, CAR_FRONT + 0.03);
  root.add(m);
  let last = '';
  return {
    draw: (text, dir) => {
      const key = `${text}|${dir}`;
      if (key === last) return;
      last = key;
      g.fillStyle = '#0c0a08';
      g.fillRect(0, 0, 256, 96);
      g.fillStyle = '#ff9a2a';
      g.font = 'bold 64px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 150, 52);
      if (dir !== 0) {
        g.beginPath();
        if (dir > 0) { g.moveTo(40, 26); g.lineTo(62, 62); g.lineTo(18, 62); }
        else { g.moveTo(40, 70); g.lineTo(62, 34); g.lineTo(18, 34); }
        g.fill();
      }
      tex.needsUpdate = true;
    },
  };
}

// The panel: a brushed plate with numbered buttons (a printed texture), a glow
// disc over each that lights when pressed, and cell-based picking — the ray
// hits the plate and the cell under the hit point is the button.
function buildPanel(root: THREE.Object3D): {
  pick: (ray: THREE.Raycaster) => number;
  buttonPos: (i: number, out: THREE.Vector3) => void;
  setLit: (i: number, on: boolean) => void;
  poke: (i: number) => void;
  tick: (dt: number) => void;
} {
  const cv = document.createElement('canvas');
  cv.width = 264;
  cv.height = 560;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#c4c8cf';
  g.fillRect(0, 0, 264, 560);
  const cw = 264 / COLS;
  const ch = 560 / ROWS;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cx = (col + 0.5) * cw;
      const cy = 560 - (row + 0.5) * ch;
      g.fillStyle = row === 0 && col === 3 ? '#b8231f' : '#2a2c31';
      g.beginPath();
      g.arc(cx, cy, 19, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#e8e8ea';
      g.font = row === 0 ? 'bold 11px sans-serif' : 'bold 17px sans-serif';
      g.fillText(row === 0 ? SPECIALS[col] : String((row - 1) * COLS + col + 1), cx, cy + 1);
    }
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.4, metalness: 0.4 }));
  plate.position.set(PANEL_X, PANEL_Y, PANEL_Z);
  plate.rotation.y = -Math.PI / 2; // faces −X, into the car
  root.add(plate);
  plate.updateMatrixWorld();

  // index: 0–3 specials (row 0), 4… floors: floor f at row 1 + floor((f−1)/4).
  const cellOf = (i: number) => (i < SPECIALS.length ? { row: 0, col: i } : { row: 1 + Math.floor((i - SPECIALS.length) / COLS), col: (i - SPECIALS.length) % COLS });
  const local = (i: number, out: THREE.Vector3) => {
    const { row, col } = cellOf(i);
    return out.set(-PW / 2 + (col + 0.5) * (PW / COLS), -PH / 2 + (row + 0.5) * (PH / ROWS), 0.004);
  };
  const glowMat = () => new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0, depthWrite: false });
  const glows: THREE.Mesh[] = [];
  const pokes: number[] = [];
  for (let i = 0; i < SPECIALS.length + FLOORS; i++) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.036, 18), glowMat());
    local(i, m.position);
    plate.add(m);
    glows.push(m);
    pokes.push(0);
  }
  const hitLocal = new THREE.Vector3();
  return {
    pick: (ray) => {
      const hit = ray.intersectObject(plate, false)[0];
      if (!hit) return -1;
      plate.worldToLocal(hitLocal.copy(hit.point));
      const col = Math.floor((hitLocal.x + PW / 2) / (PW / COLS));
      const row = Math.floor((hitLocal.y + PH / 2) / (PH / ROWS));
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return -1;
      return row === 0 ? col : SPECIALS.length + (row - 1) * COLS + col;
    },
    buttonPos: (i, out) => {
      plate.localToWorld(local(i, out));
    },
    setLit: (i, on) => {
      (glows[i].material as THREE.MeshBasicMaterial).opacity = on ? 0.6 : 0;
    },
    poke: (i) => {
      pokes[i] = 1;
    },
    tick: (dt) => {
      for (let i = 0; i < glows.length; i++) {
        if (pokes[i] <= 0) continue;
        pokes[i] = Math.max(0, pokes[i] - dt * 5);
        glows[i].position.z = 0.004 - 0.006 * pokes[i]; // a tiny press-in
        glows[i].scale.setScalar(1 - 0.15 * pokes[i]);
      }
    },
  };
}

// ── The dioramas behind the doors ──

function buildDiorama(root: THREE.Object3D): {
  show: (s: Scene | null) => void;
  react: (s: Scene) => void;
  tick: (dt: number) => void;
} {
  const W = DIO_X * 2;
  const D = CAR_FRONT - DIO_BACK;
  const cz = (CAR_FRONT + DIO_BACK) / 2;
  const scenes = new Map<Scene, THREE.Group>();
  const anim: ((t: number) => void)[] = [];
  let t = 0;

  const room = (floorColor: number, back: THREE.Material | number, sideColor = 0x1a1a1e) => {
    const g = new THREE.Group();
    g.visible = false;
    const f = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: floorColor, roughness: 1 }));
    f.rotation.x = -Math.PI / 2;
    f.position.set(0, 0.005, cz);
    g.add(f);
    const backMat = typeof back === 'number' ? new THREE.MeshBasicMaterial({ color: back }) : back;
    const b = new THREE.Mesh(new THREE.PlaneGeometry(W, CAR_H + 0.4), backMat);
    b.position.set(0, (CAR_H + 0.4) / 2, DIO_BACK);
    g.add(b);
    const sm = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 1, side: THREE.DoubleSide });
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(D, CAR_H + 0.4), sm);
      w.rotation.y = Math.PI / 2;
      w.position.set(s * DIO_X, (CAR_H + 0.4) / 2, cz);
      g.add(w);
    }
    const c = new THREE.Mesh(new THREE.PlaneGeometry(W, D), sm);
    c.rotation.x = Math.PI / 2;
    c.position.set(0, CAR_H + 0.4, cz);
    g.add(c);
    root.add(g);
    return g;
  };
  const canvasMat = (draw: (g: CanvasRenderingContext2D) => void) => {
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 256;
    draw(cv.getContext('2d')!);
    return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) });
  };
  const facing = (o: THREE.Object3D, yaw = 0) => {
    o.rotation.y = yaw;
    return o;
  };

  // Ducks: rows of them, all turned to look at the lift.
  {
    const g = room(0x4f8a3a, 0x9ec9e8, 0x3f7a30);
    for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) {
      const d = createAsset('duck');
      d.position.set(-1.3 + k * 0.65 + (r % 2) * 0.3, 0.2, CAR_FRONT - 1.0 - r * 0.9);
      facing(d, -Math.PI / 2); // beak (+X) toward the lift (+Z)
      g.add(d);
    }
    scenes.set('ducks', g);
  }
  // Desert: sand, a sky, and a train crossing far off.
  {
    const sky = canvasMat((c) => {
      const gr = c.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, '#f2d6a8');
      gr.addColorStop(0.62, '#ecc88f');
      gr.addColorStop(0.63, '#c99a5a');
      gr.addColorStop(1, '#b8874a');
      c.fillStyle = gr;
      c.fillRect(0, 0, 256, 256);
    });
    const g = room(0xd6b07a, sky, 0xd6b07a);
    const train = createAsset('train');
    train.scale.setScalar(0.28);
    train.rotation.y = Math.PI / 2;
    train.position.set(-2, 0.9, DIO_BACK + 0.3);
    g.add(train);
    anim.push((tt) => {
      if (!g.visible) return;
      train.position.x = -2 + ((tt * 0.8) % 4);
    });
    scenes.set('desert', g);
  }
  // Circus: stripes and a small, delighted crowd.
  {
    const stripes = canvasMat((c) => {
      for (let i = 0; i < 16; i++) {
        c.fillStyle = i % 2 ? '#c62828' : '#f3ead3';
        c.fillRect(i * 16, 0, 16, 256);
      }
    });
    const g = room(0x7a6440, stripes, 0x5a1a22);
    const fans: THREE.Object3D[] = [];
    for (let k = 0; k < 5; k++) {
      const d = createAsset('dummy');
      d.scale.setScalar(0.8);
      d.position.set(-1.4 + k * 0.7, 0, CAR_FRONT - 2.2 - (k % 2) * 0.6);
      g.add(d);
      fans.push(d);
    }
    anim.push((tt) => {
      if (!g.visible) return;
      fans.forEach((f, i) => {
        const up = 2.6 + Math.sin(tt * 9 + i) * 0.3;
        (f.getObjectByName('armL') as THREE.Object3D).rotation.z = -up;
        (f.getObjectByName('armR') as THREE.Object3D).rotation.z = up;
      });
    });
    scenes.set('circus', g);
  }
  // Grandma, knitting in her chair. Wrong floor, dear.
  {
    const g = room(0x8a6440, 0xefe6d2, 0xd8ccb2);
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.9 }));
    chair.position.set(0.3, 0.25, CAR_FRONT - 2.4);
    g.add(chair);
    const gran = createAsset('dummy');
    gran.scale.setScalar(0.85);
    gran.position.set(0.3, -0.1, CAR_FRONT - 2.4);
    (gran.getObjectByName('legL') as THREE.Object3D).rotation.x = -Math.PI / 2;
    (gran.getObjectByName('legR') as THREE.Object3D).rotation.x = -Math.PI / 2;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.35, 12), new THREE.MeshStandardMaterial({ color: 0xf6f3ea }));
    cap.position.set(0, 1.78, 0);
    cap.rotation.z = -0.4;
    gran.add(cap);
    g.add(gran);
    const armL = gran.getObjectByName('armL') as THREE.Object3D;
    const armR = gran.getObjectByName('armR') as THREE.Object3D;
    anim.push((tt) => {
      if (!g.visible) return;
      armL.rotation.x = -1.1 + Math.sin(tt * 8) * 0.12;
      armR.rotation.x = -1.1 - Math.sin(tt * 8) * 0.12;
    });
    scenes.set('grandma', g);
  }
  // A wolf, as surprised as you are.
  {
    const g = room(0x3e5a32, 0x1e2a22, 0x243024);
    const w = createAsset('wolf');
    w.scale.setScalar(1.3);
    w.position.set(0, 0, CAR_FRONT - 2.2);
    facing(w, -Math.PI / 2);
    g.add(w);
    scenes.set('wolf', g);
  }
  // Accounts: desks, screens, heads down.
  {
    const g = room(0x6e7078, 0xd8dade, 0xbfc2c8);
    for (const x of [-1.0, 0.9]) {
      const desk = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.75, 0.6), new THREE.MeshStandardMaterial({ color: 0x8a7a66 }));
      desk.position.set(x, 0.375, CAR_FRONT - 2.3);
      g.add(desk);
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.04), new THREE.MeshBasicMaterial({ color: 0x9fd0ff }));
      screen.position.set(x, 0.95, CAR_FRONT - 2.5);
      g.add(screen);
      const clerk = createAsset('dummy');
      clerk.scale.setScalar(0.8);
      clerk.position.set(x, -0.15, CAR_FRONT - 3.0);
      (clerk.getObjectByName('armL') as THREE.Object3D).rotation.x = -1.3;
      (clerk.getObjectByName('armR') as THREE.Object3D).rotation.x = -1.3;
      (clerk.getObjectByName('head') as THREE.Object3D).rotation.x = 0.4;
      g.add(clerk);
    }
    scenes.set('office', g);
  }
  // The void, and a very small button very far away.
  {
    const g = room(0x050506, 0x020203, 0x050506);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0x9a9a9a }));
    ped.position.set(0, 0.25, DIO_BACK + 0.4);
    g.add(ped);
    const btn = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    btn.position.set(0, 0.54, DIO_BACK + 0.4);
    g.add(btn);
    scenes.set('void', g);
  }
  // The same lift, with someone in it, pressing buttons. It's you.
  {
    const g = room(0x5a2a2e, 0xb8bcc4, 0xb8bcc4);
    const you = createAsset('dummy');
    you.position.set(0.4, 0, CAR_FRONT - 2.4);
    const arm = you.getObjectByName('armR') as THREE.Object3D;
    g.add(you);
    anim.push((tt) => {
      if (!g.visible) return;
      arm.rotation.x = -1.4 + Math.abs(Math.sin(tt * 3)) * 0.3; // pressing, pressing
    });
    scenes.set('mirror', g);
  }

  return {
    show: (s) => {
      for (const [k, g] of scenes) g.visible = k === s;
    },
    react: (s) => {
      if (s === 'ducks') quack();
      else if (s === 'desert') trainHorn();
      else if (s === 'circus') applause(0.18, 1.4);
      else if (s === 'wolf') tone({ type: 'sawtooth', from: 90, to: 70, dur: 0.8, gain: 0.08 });
      else if (s === 'office') for (let i = 0; i < 8; i++) setTimeout(() => noise(0.02, 0.08, 3000, 'highpass'), i * 90);
      else if (s === 'void') pop();
    },
    tick: (dt) => {
      t += dt;
      for (const a of anim) a(t);
    },
  };
}
