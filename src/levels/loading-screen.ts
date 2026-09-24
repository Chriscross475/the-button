import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Obstacle } from '../controls/player-camera';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { tone, noise, ensureAudio, sparkle, pop } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { hideRoomShell } from './scaffold';
import { buildExitRoom } from './exit-room';
import { spawnSpinner } from '../objects/spinner';
import { setScriptHints } from '../objects/script';
import { FONT_SIGN } from '../ui/fonts';

// THE LOADING SCREEN — the white room gives way to a flat grey void, and in it,
// a giant loading bar at 99%. It has been at 99% for some time. Tips cycle on a
// board above it (and the narrator reads them). You can walk around in here.
//
// The fill is a solid slab, and it's a hair too far LEFT: its left end sticks
// out of the frame by exactly the missing 1%. Walk into that stub from the left
// and you shove it in — it resists, and slides back if you let go. Push it all
// the way and it loads: 100%… then 101%. The bar dissolves, the fog lifts, and
// the exit room was out there the whole time.
//
// Or unload it. At the RIGHT end the fill stops a metre short of the frame:
// step into that gap and push its end the other way. Unloading is easy — it
// goes with every step, and you walk it (inside the frame, the fill giving way
// ahead of you) all the way back to 0%. Loading cancelled: the spinner stops,
// falls off, and is yours (the Spinner: things load faster near it). The bar
// still dissolves and the way out still appears.

const L = 24; // frame length (x); the fill is the same length
const BAR_Z = -8; // bar centre line
const BAR_HALF_Z = 0.5; // half its depth (z)
const BAR_H = 2.2;
const FRAME_L = -L / 2; // frame's left end
// The fill's left end at "99%": it sticks out of the frame by STUB (not
// literally 1% of the length — that would be a few centimetres; this reads).
const STUB = 1.0;
const START_LEFT = FRAME_L - STUB;
const PUSH_GIVE = 0.1; // how much of your step the slab actually moves (~3 s of pushing)
const SLIP = 0.05; // m/s it slides back when you stop pushing
const REACH = CONFIG.PLAYER_RADIUS + 0.05; // how close you stand to the stub while pushing
const EXIT = new THREE.Vector3(0, 0, -40); // out in the fog, all along
const BEFORE = { minX: -16, maxX: 16, minZ: BAR_Z - 0.6, maxZ: 10 }; // in front of the bar only
const AFTER = { minX: -24, maxX: 24, minZ: EXIT.z - 6, maxZ: 10 };

const INTRO = vo('Loading. Ninety-nine percent. It has been ninety-nine percent for some time. Please enjoy these helpful tips.');
const TIPS = vo([
  'Tip: the button is red. It has always been red. This tip is not helping.',
  'Tip: have you tried turning it off and on again. You cannot. But have you tried.',
  'Tip: something at the far left end is sticking out. Things that stick out can be pushed in.',
  'Tip: ninety-nine percent is basically a hundred. Tell that to the bar.',
  'Tip: do not stare at the spinner. The spinner stares back.',
  'Tip: loading bars are pushed along by the engine. This one appears to be pushed along by nobody.',
  'Tip: walking into things is usually a mistake. Usually.',
  'Tip: pushing the bar the other way is not recommended. There is a gap at the right end for that. Do not use it.',
]);
const REVERSING = vo('You are pushing it backwards. Nobody pushes it backwards. It is going, though. Unloading is always easier.');
const UNLOADED = vo('Zero percent. Loading cancelled. The spinner has stopped. It has fallen off. It has nowhere to be now. Take it.');
const SPINNER_TAKEN = vo('The spinner. Things load faster near it. Queues, holds, lifts. Everything that makes you wait.');
const PUSHING = vo('Are you pushing the loading bar. You are pushing the loading bar.');
const SLIPPED = vo('It slid back. Loading bars have feelings. Mostly spite.');
const LOADED = vo('One hundred percent. Loaded. Everything is loaded. Please continue.');
const OVERLOADED = vo('One hundred and one percent. It is over-loading now. Go, before it gets worse.');

export function revealLoadingScreen(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom();
  ctx.after(1600, () => hideRoomShell(ctx)); // the white room topples, then isn't there

  // ── The void: flat grey, a faint grid underfoot, and fog (set outright: the
  //    white room's own 9–34 m fog is still on the scene) ──
  const grey = new THREE.Color(0x8a8d92);
  const startBg = (ctx.scene.background as THREE.Color)?.clone?.() ?? new THREE.Color(0xf4f4f2);
  const fog = new THREE.Fog(startBg.getHex(), 12, 48);
  ctx.scene.fog = fog;
  let tb = 0;
  addUpdater((dt) => {
    tb += dt;
    const k = Math.min(1, tb / 1.6);
    const c = startBg.clone().lerp(grey, k);
    if (ctx.scene.background instanceof THREE.Color) ctx.scene.background.copy(c);
    else ctx.scene.background = c;
    fog.color.copy(c);
    return k >= 1;
  });
  root.add(new THREE.HemisphereLight(0xffffff, 0x6a6d72, 1.0));
  root.add(buildFloor());

  // Keep you in front of the bar, wherever you stood when the room went.
  const cam = ctx.camera.position;
  cam.x = THREE.MathUtils.clamp(cam.x, BEFORE.minX + 1, BEFORE.maxX - 1);
  cam.z = THREE.MathUtils.clamp(cam.z, BAR_Z + 2, BEFORE.maxZ - 1);
  ctx.setBounds(BEFORE);

  // ── The bar ──
  const bar = new THREE.Group();
  root.add(bar);
  const casing = new THREE.MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.6 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(L + 0.4, BAR_H + 0.4, 0.12), casing);
  back.position.set(0, BAR_H / 2, BAR_Z - BAR_HALF_Z - 0.06);
  bar.add(back);
  for (const y of [0.05, BAR_H + 0.05]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(L + 0.4, 0.2, BAR_HALF_Z * 2 + 0.12), casing);
    rail.position.set(0, y, BAR_Z);
    bar.add(rail);
  }
  for (const x of [FRAME_L - 0.1, -FRAME_L + 0.1]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.2, BAR_H + 0.4, BAR_HALF_Z * 2 + 0.12), casing);
    cap.position.set(x, BAR_H / 2, BAR_Z);
    bar.add(cap);
  }
  // The left cap has a slot the fill pokes out of (the stub reads as "out").
  const fillMat = new THREE.MeshStandardMaterial({ color: 0x3a8ee6, emissive: 0x0c2a55, roughness: 0.4 });
  const fill = new THREE.Mesh(new THREE.BoxGeometry(L, BAR_H - 0.3, BAR_HALF_Z * 2 - 0.1), fillMat);
  let fillLeft = START_LEFT;
  const placeFill = () => fill.position.set(fillLeft + L / 2, BAR_H / 2 + 0.05, BAR_Z);
  placeFill();
  bar.add(fill);
  // A sheen that runs along the fill, like every loading bar ever.
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, BAR_H - 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false }));
  sheen.position.set(0, BAR_H / 2 + 0.05, BAR_Z + BAR_HALF_Z - 0.03);
  bar.add(sheen);

  // Solid along its length — but not at the far left, so you can reach the stub.
  // (…and not past the fill's right end: the gap there — and, once you push it
  // back, the emptied frame — is walkable, so you can follow it.)
  const barSolids: Obstacle[] = [];
  const solidOn = new Set<Obstacle>();
  for (let x = FRAME_L + 1.2; x <= -FRAME_L + 0.4; x += 0.5) barSolids.push({ x, z: BAR_Z, radius: 0.55 });
  const syncSolids = (fillRight: number) => {
    for (const o of barSolids) {
      const on = o.x < fillRight - 0.6;
      if (on && !solidOn.has(o)) (ctx.addObstacle(o), solidOn.add(o));
      else if (!on && solidOn.has(o)) (ctx.removeObstacle(o), solidOn.delete(o));
    }
  };

  // The percentage, over the bar.
  const pctSign = makeSign(root, 3.6, 1.1, new THREE.Vector3(0, BAR_H + 1.2, BAR_Z - 0.2));
  // The tips board, higher up.
  const tipSign = makeSign(root, 9, 1.6, new THREE.Vector3(0, BAR_H + 3.2, BAR_Z - 0.4));
  // The spinner, off to the right: a ring of dots, one lit brighter, going round.
  const spinner = new THREE.Group();
  spinner.position.set(9, BAR_H + 2.4, BAR_Z - 0.3);
  root.add(spinner);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 + (i / 12) * 0.85 }));
    dot.position.set(Math.cos(a) * 1.0, Math.sin(a) * 1.0, 0);
    spinner.add(dot);
  }

  // The exit room, out in the fog the whole time (door toward the bar).
  buildExitRoom(ctx, { center: EXIT, facing: 'posZ', solidWalls: true });

  // ── State ──
  let loaded = false;
  let saidReverse = false;
  const fillRight = () => fillLeft + L;
  syncSolids(fillRight());
  let tipIdx = 0;
  let tipT = 0;
  let pushQuiet = 0; // seconds since you last pushed
  let saidPush = false;
  let saidSlip = false;
  let creak = 0;
  const prev = new THREE.Vector3().copy(cam);
  const progress = () => THREE.MathUtils.clamp((fillLeft - START_LEFT) / (FRAME_L - START_LEFT), 0, 1);
  // Pushed back: 99% at the start, down to 0% when its right end leaves the frame.
  const unloadedPct = () => THREE.MathUtils.clamp((99 * (fillRight() - FRAME_L)) / (START_LEFT + L - FRAME_L), 0, 99);
  let shownPct = '';
  const showPct = (text?: string) => {
    const t = text ?? (fillLeft < START_LEFT - 1e-3 ? `${Math.floor(unloadedPct())}%` : `${(99 + progress()).toFixed(progress() > 0 ? 1 : 0)}%`);
    if (t === shownPct) return; // redraw (and re-upload the texture) only on change
    shownPct = t;
    pctSign.draw([t], '#e8ecf2');
  };
  showPct();
  const showTip = () => tipSign.draw(wrap(TIPS[tipIdx], 46), '#dfe6ee');
  showTip();

  const finish = () => {
    loaded = true;
    fillLeft = FRAME_L;
    placeFill();
    fillMat.color.setHex(0x3ac46a);
    fillMat.emissive.setHex(0x0f3a1c);
    showPct('100%');
    discover('mech:loading-bar');
    chime();
    sparkle();
    ctx.narrate(LOADED, 4500, { priority: true });
    ctx.after(2200, () => {
      showPct('101%');
      pop();
      ctx.narrate(OVERLOADED, 5000, { priority: true });
    });
    ctx.after(4200, () => {
      // It dissolves; the fog lifts; the way out was there all along.
      dissolve(['LOADED.', 'You may now leave.']);
    });
  };

  // The bar goes; the fog lifts; the way out was there all along.
  const dissolve = (tip: string[]) => {
    {
      for (const o of [...solidOn]) ctx.removeObstacle(o);
      solidOn.clear();
      ctx.setBounds(AFTER);
      tipSign.draw(tip, '#dfe6ee');
      let t = 0;
      addUpdater((dt) => {
        t = Math.min(1, t + dt / 1.6);
        bar.scale.y = Math.max(0.001, 1 - t);
        spinner.scale.setScalar(Math.max(0.001, 1 - t));
        pctSign.mesh.scale.y = Math.max(0.001, 1 - t);
        fog.far = 48 + t * 180;
        fog.near = 12 + t * 40;
        if (t >= 1) {
          root.remove(bar, spinner, pctSign.mesh);
          return true;
        }
        return false;
      });
    }
  };

  // 0%: cancelled. The spinner stops and falls; where it lands, it's yours.
  const unload = () => {
    loaded = true;
    fillMat.color.setHex(0x6a6d72);
    fillMat.emissive.setHex(0x000000);
    showPct('0%');
    tipSign.draw(['LOADING CANCELLED.'], '#ffb0a0');
    discover('mech:loading-bar');
    ctx.narrate(UNLOADED, 6000, { priority: true });
    const from = spinner.position.clone();
    const land = new THREE.Vector3(from.x, 0.2, BAR_Z + 2.2); // in front of the bar, where you can walk
    let t = 0;
    addUpdater((dt) => {
      t = Math.min(1, t + dt / 1.1);
      spinner.position.lerpVectors(from, land, t * t);
      spinner.rotation.z += dt * 2 * (1 - t);
      spinner.scale.setScalar(Math.max(0.12, 1 - t * 0.88));
      if (t < 1) return false;
      root.remove(spinner);
      pop();
      spawnSpinner(ctx, land, {
        onGrab: () => ctx.narrate(SPINNER_TAKEN, 6000, { priority: true }),
      });
      return true;
    });
    ctx.after(2600, () => dissolve(['LOADING CANCELLED.', 'You may leave anyway.']));
  };

  addUpdater((dt) => {
    // Spinner + sheen, forever (until it loads, or unloads).
    if (!loaded) spinner.rotation.z -= dt * 3;
    sheen.position.x = fillLeft + ((performance.now() / 1000) * 4 % L);
    if (loaded) return false;

    // Tips cycle.
    tipT += dt;
    if (tipT > 9) {
      tipT = 0;
      tipIdx = (tipIdx + 1) % TIPS.length;
      showTip();
      ctx.narrate(TIPS[tipIdx], 7000, { interruptible: true });
    }

    // The stub and you. You're "in" the bar's lane at its left end when your z
    // is within its depth; its end face is at fillLeft.
    const p = cam;
    const inLane = Math.abs(p.z - BAR_Z) < BAR_HALF_Z + CONFIG.PLAYER_RADIUS;
    const limit = fillLeft - REACH;
    let pushed = false;
    if (inLane && p.x > limit && p.x < FRAME_L + 1.2 && p.x < fillRight()) {
      if (prev.x <= limit + 0.05) {
        // You walked into the stub from the left: the step moves it a little,
        // and you stay pressed against it.
        const step = p.x - limit;
        fillLeft = Math.min(FRAME_L, fillLeft + step * PUSH_GIVE);
        p.x = fillLeft - REACH;
        pushed = step > 1e-4;
      } else {
        // Came at it from the side: back out of its lane, on the FRONT side (the
        // only walkable side), clear of the first bar solid.
        p.z = BAR_Z + BAR_HALF_Z + CONFIG.PLAYER_RADIUS + 0.45;
      }
    }
    // The other end: from the right, into the fill's right face — it goes with
    // every step (unloading is easy), and you follow it into the frame.
    const rLimit = fillRight() + REACH;
    if (!pushed && inLane && p.x < rLimit && p.x > fillRight() - 0.6 && prev.x >= rLimit - 0.05) {
      const step = rLimit - p.x;
      fillLeft -= step;
      p.x = fillRight() + REACH;
      pushed = step > 1e-4;
      if (pushed && !saidReverse) {
        saidReverse = true;
        saidPush = true; // (its own line, not the forward one)
        ctx.narrate(REVERSING, 5000, { priority: true });
      }
    }
    if (pushed) {
      pushQuiet = 0;
      creak -= dt;
      if (creak <= 0) {
        creak = 0.35;
        grind();
      }
      if (!saidPush) {
        saidPush = true;
        ctx.narrate(PUSHING, 4500, { priority: true });
      }
    } else {
      pushQuiet += dt;
      // Let go, and it slides back towards 99%.
      if (pushQuiet > 0.4 && fillLeft > START_LEFT) {
        fillLeft = Math.max(START_LEFT, fillLeft - SLIP * dt);
        if (!saidSlip && progress() > 0.2) {
          saidSlip = true;
          ctx.narrate(SLIPPED, 4000, { priority: true });
        }
      }
    }
    placeFill();
    syncSolids(fillRight());
    showPct();
    prev.copy(p);
    if (fillLeft >= FRAME_L - 1e-4) finish();
    else if (fillRight() <= FRAME_L + 0.05) unload();
    return false;
  });

  setScriptHints([TIPS[2], TIPS[TIPS.length - 1]]);
  ctx.narrate(INTRO, 6500);
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function buildFloor(): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#8a8d92';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(120, 120);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  return floor;
}

// A dark sign with centred lines of text, each shrunk to fit the width. Sits on
// a slightly larger backing (the text plane well in front of it — never coplanar).
function makeSign(root: THREE.Object3D, w: number, h: number, at: THREE.Vector3): { mesh: THREE.Group; draw: (lines: string[], color: string) => void } {
  const PX = 128;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * PX);
  cv.height = Math.round(h * PX);
  const g = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  const mesh = new THREE.Group();
  mesh.position.copy(at);
  const backing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.08), new THREE.MeshStandardMaterial({ color: 0x1c1d21, roughness: 0.7 }));
  mesh.add(backing);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.z = 0.15;
  mesh.add(face);
  root.add(mesh);
  const draw = (lines: string[], color: string) => {
    g.fillStyle = '#16171b';
    g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const step = cv.height / (lines.length + 1);
    const maxSize = Math.min(step * 0.8, cv.height * 0.6);
    lines.forEach((line, i) => {
      let px = Math.floor(maxSize);
      do {
        g.font = `bold ${px}px ${FONT_SIGN}`;
      } while (g.measureText(line).width > cv.width - 40 && --px > 8);
      g.fillText(line, cv.width / 2, step * (i + 1));
    });
    tex.needsUpdate = true;
  };
  return { mesh, draw };
}

// Word-wrap into lines of at most `max` characters.
function wrap(text: string, max: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max && line) {
      lines.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

// ── Sounds ──
function grind(): void {
  ensureAudio();
  noise(0.3, 0.08, 260, 'lowpass');
  tone({ type: 'sawtooth', from: 70, to: 62, dur: 0.3, gain: 0.04 });
}
function chime(): void {
  ensureAudio();
  [523.3, 659.3, 784, 1046.5].forEach((f, i) =>
    setTimeout(() => tone({ type: 'sine', from: f, dur: 0.45, gain: 0.1, attack: 0.01 }), i * 110),
  );
}
