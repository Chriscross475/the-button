import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { spawnPedestalButton, type SpawnedButton } from '../button/pedestal-button';
import { tone, noise, thud, quack, sparkle, ensureAudio } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { hideRoomShell } from './scaffold';
import { setEyeHeight } from '../controls/player-camera';
import { isSpeaking } from '../audio/tts';

// YOU ARE THE BUTTON — you press it, and swap. You're the button now: a small
// thing standing on the cap of a pedestal the size of a house, and across the
// giant white room the old you (a dummy twenty times your size) walks up with
// its finger out. The narrator narrates for IT, as the player, until it dawns
// on him which of you is reading this.
//
// It stabs down at where you stand; a shadow on the cap marks the spot a moment
// before, so you can step out of it. Pressed three times and it's satisfied: the
// world swaps back. Last long enough and it sits down and cries, and a button
// comes up for you. Or throw it something — it cannot resist pressing things —
// and while it's off pressing that, the little button it keeps under its other
// hand in the corner is yours.

const S = 20; // everything giant is this many times life size
const CAP_TOP = 0.95; // a pedestal's cap top, life size (see pedestal-button)
const FLOOR = -CAP_TOP * S; // the giant room's floor, below the cap you stand on
const HALF = 0.31 * S; // the cap's half-width
const WALK = HALF - 0.35; // where you can walk (the cap, clear of the edge)
const EYE = 0.9;
const GIANT_R = HALF + 5; // where the giant stands, from the cap's centre
const FINGER_R = 1.5; // the fingertip's footprint on the cap
const AIM_TIME = 1.1; // shadow shown this long before the finger comes down
const TRACK_TIME = 0.5; // …following you for the first part of that
const STAB_TIME = 0.2;
const HOLD_TIME = 0.45;
const LIFT_TIME = 0.6;
const DODGE_WIN = 45; // seconds of it trying, unpressed-for-good, and it gives up
const PRESSES_TO_SWAP = 3;
const CAGE = new THREE.Vector3(-HALF + 1.9, 0, -HALF + 1.9); // the button under its hand

const INTRO = vo('The player approaches the button. They know what to do.');
const REACH = vo('The player reaches out. The button… moves. Buttons do not usually move.');
const REALISE = vo('Wait. Which one of you is reading this? Which one of you is the player?');
const PRESSED = vo([
  'It pressed you. How did it feel? Now you know.',
  'Again. It liked that. You never ask the button whether it liked it.',
]);
const SWAP_BACK = vo('Three times. It is satisfied. Everybody is satisfied. It has let go of the other button. The one in the corner. Press that, and you can swap back.');
const SWAPPED = vo('Swap back. You are the player again. Nobody needs to know what happened here.');
const DODGE = vo([
  'The button is evading the player. This was not in the design document.',
  'It is getting frustrated. Look at its little face. Its enormous little face.',
  'You are very hard to press. Has anyone told you that? Nobody has ever needed to.',
]);
const SIT = vo('It has sat down. It is crying. You made the player cry. There, there. It is only a button.');
const RISE = vo('Something has come up. For you. Go on. Be the one who presses, for once.');
const UNPRESSABLE = vo('The button that could not be pressed has pressed a button. Tidy.');
const CAGED = vo('It is keeping one hand over that little one in the corner. Saving it for later.');
const CAGED_AGAIN = vo('Under its hand. You would have to get it to look somewhere else.');
const LURE = vo('You threw something. It is looking. It is going. It cannot resist pressing things. Neither could you.');
const LURE_DUCK = vo('It pressed the duck.');
const LURE_COIN = vo('It pocketed the coin. Of course it did.');
const LURE_OTHER = vo('It pressed whatever that was. Thoroughly.');
const BACK = vo('It is coming back. It remembers what it came for.');
const ROLE = vo('You pressed its button. The button pressed the player. The universe folds neatly in half.');

type GiantState = 'approach' | 'rest' | 'aim' | 'stab' | 'hold' | 'lift' | 'lured' | 'sit' | 'done';

export function revealYouAreButton(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: true, ceiling: true });
  hideRoomShell(ctx);
  // Walk the cap only; anything thrown flies on out over the edge (it lands on
  // an invisible y=0 far out, where this level takes it over and drops it).
  ctx.setBounds({ minX: -80, maxX: 80, minZ: -80, maxZ: 80, floorY: 0 });
  ctx.setRegions([{ minX: -WALK, maxX: WALK, minZ: -WALK, maxZ: WALK, floorY: 0 }]);
  setEyeHeight(EYE);
  const cam = ctx.camera.position;
  cam.x = THREE.MathUtils.clamp(cam.x, -WALK + 0.5, WALK - 0.5);
  cam.z = THREE.MathUtils.clamp(cam.z, -WALK + 0.5, WALK - 0.5);
  cam.y = EYE;

  ctx.scene.background = new THREE.Color(0xf1f1ee);
  ctx.scene.fog = new THREE.Fog(0xf1f1ee, 70, 260);
  root.add(new THREE.HemisphereLight(0xffffff, 0xb8b8b0, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(30, 80, 20);
  root.add(sun);

  // ── The giant room: a floor far below, walls far away ──
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), new THREE.MeshStandardMaterial({ color: 0xe2e2dc, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = FLOOR;
  root.add(floor);
  for (const [x, z, ry] of [[0, -110, 0], [0, 110, 0], [-110, 0, Math.PI / 2], [110, 0, Math.PI / 2]] as const) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(220, 120, 2), white);
    w.position.set(x, FLOOR + 60, z);
    w.rotation.y = ry;
    root.add(w);
  }

  // ── The pedestal you stand on (a life-size one, ×S) ──
  const stone = new THREE.MeshStandardMaterial({ color: 0xd2d2cc, roughness: 0.85 });
  const box = (w: number, h: number, d: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * S, h * S, d * S), stone);
    m.position.y = FLOOR + y * S;
    root.add(m);
    return m;
  };
  box(0.72, 0.16, 0.72, 0.08);
  box(0.46, 0.7, 0.46, 0.5);
  box(0.62, 0.1, 0.62, 0.9); // the cap: its top is y = 0, where you stand
  // You: the red face of the button, under your feet.
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(0.16 * S * 0.9, 40),
    new THREE.MeshStandardMaterial({ color: 0xd8242a, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.004;
  root.add(face);

  // The shadow where the finger will land.
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(FINGER_R, 32), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  root.add(shadow);

  // ── The giant ──
  const giant = createAsset('dummy') as THREE.Group;
  giant.scale.setScalar(S);
  root.add(giant);
  const legL = giant.getObjectByName('legL') as THREE.Object3D;
  const legR = giant.getObjectByName('legR') as THREE.Object3D;
  // Its own arms are replaced by stretchy ones that reach wherever they must.
  (giant.getObjectByName('armL') as THREE.Object3D).visible = false;
  (giant.getObjectByName('armR') as THREE.Object3D).visible = false;
  const skin = new THREE.MeshStandardMaterial({ color: 0xa8a8a4, roughness: 0.9 });
  const makeArm = () => {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12 * S, 0.12 * S, 1), skin);
    m.position.z = 0.5; // along +Z, so lookAt points it and scale.z stretches it
    g.add(m);
    root.add(g);
    return g;
  };
  const armR = makeArm();
  const armL = makeArm();
  // The palm it keeps over the corner button, fingers down like a cage.
  const palm = new THREE.Group();
  const palmTop = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.7, 3.0), skin);
  palmTop.position.y = 2.2;
  palm.add(palmTop);
  for (const [fx, fz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.5), skin);
    f.position.set(fx, 1.1, fz);
    palm.add(f);
  }
  palm.position.copy(CAGE);
  root.add(palm);

  let gAngle = -Math.PI / 2; // polar angle of where it stands round the pedestal
  let gR = 95; // …and how far out (it walks in)
  let lean = 0; // bending forward (to press something on the floor)
  let sitK = 0;
  let stepPhase = 0;
  let lastStep = 0;
  const placeGiant = () => {
    giant.position.set(Math.cos(gAngle) * gR, FLOOR - sitK * 0.55 * S, Math.sin(gAngle) * gR);
    giant.rotation.set(lean, Math.atan2(-giant.position.x, -giant.position.z), 0, 'YXZ');
    giant.updateMatrixWorld(true);
  };
  const shoulder = (side: 1 | -1, out: THREE.Vector3) => giant.localToWorld(out.set(side * 0.33, 1.4, 0));
  const tmpS = new THREE.Vector3();
  const pointArm = (arm: THREE.Group, side: 1 | -1, tip: THREE.Vector3) => {
    shoulder(side, tmpS);
    arm.position.copy(tmpS);
    arm.lookAt(tip);
    arm.scale.set(1, 1, Math.max(1, tmpS.distanceTo(tip)));
  };
  const restTip = (side: 1 | -1, out: THREE.Vector3) => giant.localToWorld(out.set(side * 0.36, 0.75, 0.08));

  // ── Buttons you might press ──
  let caged = true;
  let cagedCool = 0;
  let cagedSaid = false;
  let lureUsed = false;
  let leaving = false;
  let satisfied = false; // pressed enough times: it has let go of the corner button
  const corner: SpawnedButton = spawnPedestalButton(root, CAGE.clone(), () => {
    if (leaving) return;
    if (caged) {
      if (cagedCool <= 0) {
        cagedCool = 5;
        ctx.narrate(cagedSaid ? CAGED_AGAIN : CAGED, 4500, { priority: true });
        cagedSaid = true;
      }
      return;
    }
    leaving = true;
    sparkle();
    if (satisfied) ctx.narrate(SWAPPED, 5000, { priority: true });
    else {
      discover('reward:role-reversal');
      ctx.narrate(ROLE, 6000, { priority: true });
    }
    ctx.after(3200, () => ctx.advance(CAGE.clone()));
  });
  const cageBlock = { x: CAGE.x, z: CAGE.z, radius: 1.9 };
  ctx.addObstacle(cageBlock);

  // ── Being pressed ──
  let presses = 0;
  const canvas = typeof document !== 'undefined' ? document.getElementById('scene') : null;
  const squash = () => {
    if (!canvas) return;
    const prev = canvas.style.transform;
    canvas.style.transition = 'transform 0.08s ease-in';
    canvas.style.transform = 'scaleY(0.3)';
    // A plain timer, not ctx.after: it only restores the page, and must run even
    // if the room changes mid-squash (the updater pool would drop it).
    setTimeout(() => {
      canvas.style.transition = 'transform 0.35s cubic-bezier(.2,1.6,.4,1)';
      canvas.style.transform = prev;
    }, 260);
  };
  const pressedYou = () => {
    presses++;
    discover('mech:giant-finger');
    ensureAudio();
    tone({ type: 'square', from: 180, to: 60, dur: 0.18, gain: 0.25 });
    noise(0.12, 0.3, 900, 'lowpass');
    thud();
    squash();
    // The swap resets you: back to the middle of yourself.
    ctx.after(350, () => {
      cam.x = 0;
      cam.z = 0;
    });
    if (presses >= PRESSES_TO_SWAP) {
      // Satisfied: it stops pressing and lets go of the corner button — the way
      // out is you pressing that. (The finger still lifts; the lift ends in 'done'.)
      satisfied = true;
      shadowMat.opacity = 0;
      caged = false;
      ctx.removeObstacle(cageBlock);
      ctx.narrate(SWAP_BACK, 6000, { priority: true });
      return;
    }
    ctx.narrate(PRESSED[(presses - 1) % PRESSED.length], 5000, { priority: true });
  };

  // ── Throwing it something ──
  let lastHeld: string | null = null;
  let thrownKind: string | null = null;
  const prevPos = new Map<THREE.Object3D, THREE.Vector3>();
  const wp = new THREE.Vector3();
  const lureAt = new THREE.Vector3();
  let bait: THREE.Object3D | null = null;
  let baitKind = '';
  const scanThrown = () => {
    const held = ctx.heldKind('right') ?? ctx.heldKind('left');
    if (lastHeld && lastHeld !== held) thrownKind = lastHeld;
    lastHeld = held;
    const seen = new Set<THREE.Object3D>();
    for (const parent of [ctx.scene, root]) {
      for (const o of parent.children) {
        if ((o as THREE.Light).isLight || o === root || o === giant || !o.visible || o.userData.bait) continue;
        seen.add(o);
        o.getWorldPosition(wp);
        const prev = prevPos.get(o);
        if (!prev) {
          prevPos.set(o, wp.clone());
          continue;
        }
        const moved = wp.distanceTo(prev);
        prev.copy(wp);
        // Out past the cap's edge and down at the (invisible) y=0: it's gone over.
        const out = Math.max(Math.abs(wp.x), Math.abs(wp.z)) > HALF + 0.2;
        if (!out || wp.y > 0.6 || moved < 0.01) continue; // in flight, only
        if (state === 'lured' || state === 'sit' || state === 'done') continue;
        takeBait(o, wp);
        return;
      }
    }
    for (const o of prevPos.keys()) if (!seen.has(o)) prevPos.delete(o);
  };
  const takeBait = (o: THREE.Object3D, at: THREE.Vector3) => {
    // It fell off the edge: a stand-in drops all the way to the giant's floor.
    o.visible = false;
    baitKind = thrownKind ?? '';
    const copy = o.clone(true);
    copy.visible = true;
    copy.userData.bait = true;
    const dir = new THREE.Vector2(at.x, at.z);
    if (dir.lengthSq() < 1e-4) dir.set(0, 1);
    const r = Math.max(HALF + 3, dir.length());
    dir.normalize();
    lureAt.set(dir.x * r, FLOOR, dir.y * r);
    copy.position.set(dir.x * r, 0, dir.y * r);
    root.add(copy);
    bait = copy;
    let vy = 0;
    addUpdater((dt) => {
      if (bait !== copy) return true;
      vy -= 20 * dt;
      copy.position.y = Math.max(FLOOR + 0.3, copy.position.y + vy * dt);
      return copy.position.y <= FLOOR + 0.3;
    });
    startLure();
  };

  // ── The giant's brain ──
  let state: GiantState = 'approach';
  let st = 0; // time in this state
  let rest = 2.2;
  let tryT = 0; // time spent trying to press you
  let dodgeLine = 0;
  let realised = false;
  let lureTarget = 0; // polar angle to walk round to
  let lurePhase = 0; // 0 walking over, 1 bending + pressing, 2 walking back
  let lureT = 0;
  const target = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const raised = new THREE.Vector3();
  const tipL = new THREE.Vector3();
  const set = (s: GiantState) => {
    state = s;
    st = 0;
  };
  const stomp = () => {
    thud();
    noise(0.25, 0.12, 180, 'lowpass');
    shake = 0.35;
  };
  let shake = 0;

  function startLure(): void {
    if (satisfied) return; // it has stopped playing; the corner is already free
    if (lureUsed) {
      // It falls for it every time; only the first one's news.
    } else ctx.narrate(LURE, 6000, { priority: true });
    lureUsed = true;
    lureTarget = Math.atan2(lureAt.z, lureAt.x);
    lurePhase = 0;
    lureT = 0;
    shadowMat.opacity = 0;
    caged = false; // both hands go with it
    ctx.removeObstacle(cageBlock);
    set('lured');
  }

  const angleStep = (from: number, to: number, max: number) => {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return from + THREE.MathUtils.clamp(d, -max, max);
  };

  ctx.narrate(INTRO, 6000);

  addUpdater((dt) => {
    if (state === 'done' && leaving && st > 8) return true;
    st += dt;
    cagedCool -= dt;
    if (!leaving) scanThrown();

    // Walking: legs swing, the floor shakes on each footfall.
    let walking = false;
    if (state === 'approach') {
      gR = Math.max(GIANT_R, gR - 9 * dt);
      walking = gR > GIANT_R;
      if (!walking) set('rest');
    } else if (state === 'lured') {
      lureT += dt;
      if (lurePhase === 0) {
        const na = angleStep(gAngle, lureTarget, 0.6 * dt);
        walking = Math.abs(na - gAngle) > 1e-4;
        gAngle = na;
        const wantR = Math.hypot(lureAt.x, lureAt.z) + 7;
        gR += THREE.MathUtils.clamp(wantR - gR, -6 * dt, 6 * dt);
        if (!walking && Math.abs(wantR - gR) < 0.2) {
          lurePhase = 1;
          lureT = 0;
        }
      } else if (lurePhase === 1) {
        lean = Math.min(0.55, lean + dt * 0.8);
        if (lureT > 1.2 && lureT - dt <= 1.2 && !leaving) {
          // Press it.
          if (baitKind === 'duck' || baitKind === 'cooked-duck') {
            quack();
            ctx.narrate(LURE_DUCK, 3500, { priority: true });
          } else if (baitKind === 'coin' || baitKind === 'money') {
            if (bait) bait.visible = false;
            tone({ type: 'triangle', from: 1400, to: 1800, dur: 0.12, gain: 0.08 });
            ctx.narrate(LURE_COIN, 3500, { priority: true });
          } else {
            thud();
            ctx.narrate(LURE_OTHER, 3500, { priority: true });
          }
          if (bait) bait.scale.y *= 0.35;
        }
        if (lureT > 5.5) {
          lurePhase = 2;
          lureT = 0;
          if (!leaving) ctx.narrate(BACK, 4000);
        }
      } else {
        lean = Math.max(0, lean - dt * 0.8);
        const na = angleStep(gAngle, -Math.PI / 2, 0.6 * dt);
        walking = Math.abs(na - gAngle) > 1e-4;
        gAngle = na;
        gR += THREE.MathUtils.clamp(GIANT_R - gR, -6 * dt, 6 * dt);
        if (!walking && Math.abs(GIANT_R - gR) < 0.2 && lean <= 0) {
          caged = true; // the hand goes back over its button
          ctx.addObstacle(cageBlock);
          set('rest');
        }
      }
    }
    if (walking) {
      stepPhase += dt * 2.4;
      const sw = Math.sin(stepPhase) * 0.5;
      legL.rotation.x = sw;
      legR.rotation.x = -sw;
      const step = Math.floor(stepPhase / Math.PI);
      if (step !== lastStep) {
        lastStep = step;
        stomp();
      }
    } else if (state !== 'sit') {
      legL.rotation.x *= 0.9;
      legR.rotation.x *= 0.9;
    }
    placeGiant();

    // Pressing you: rest → aim (shadow) → stab → hold → lift → rest.
    const pl = ctx.playerPos();
    if (['rest', 'aim', 'stab', 'hold', 'lift'].includes(state)) tryT += dt;
    if (state === 'rest' && st > rest && !leaving) {
      target.set(pl.x, 0, pl.z);
      set('aim');
    }
    if (state === 'aim') {
      if (st < TRACK_TIME) target.set(pl.x, 0, pl.z);
      shadow.position.x = target.x;
      shadow.position.z = target.z;
      const k = Math.min(1, st / AIM_TIME);
      shadowMat.opacity = 0.12 + 0.45 * k;
      shadow.scale.setScalar(1.6 - 0.6 * k);
      if (st >= AIM_TIME) set('stab');
    }
    raised.set(target.x, 7, target.z);
    if (state === 'aim') tip.lerpVectors(restTipCache(), raised, Math.min(1, st / (AIM_TIME * 0.6)));
    else if (state === 'stab') {
      tip.lerpVectors(raised, target, Math.min(1, st / STAB_TIME));
      if (st >= STAB_TIME) {
        shadowMat.opacity = 0;
        stomp();
        if (Math.hypot(pl.x - target.x, pl.z - target.z) < FINGER_R + CONFIG.PLAYER_RADIUS) pressedYou();
        else {
          if (!realised) {
            realised = true;
            ctx.narrate(REACH, 5000);
            ctx.after(5500, () => ctx.narrate(REALISE, 5000));
          } else if (tryT > 12 + dodgeLine * 11 && dodgeLine < DODGE.length && !isSpeaking()) {
            ctx.narrate(DODGE[dodgeLine++], 5000);
          }
        }
        if (!leaving) set('hold');
      }
    } else if (state === 'hold') {
      tip.copy(target);
      if (st >= HOLD_TIME) set('lift');
    } else if (state === 'lift') {
      tip.lerpVectors(target, restTipCache(), Math.min(1, st / LIFT_TIME));
      if (st >= LIFT_TIME) {
        rest = Math.max(0.5, 2.0 - tryT * 0.035);
        if (satisfied) set('done');
        else if (tryT >= DODGE_WIN) {
          set('sit');
          giveUp();
        } else set('rest');
      }
    } else if (state === 'lured') {
      // Right hand: down to the bait on the floor; left rests.
      const baitTip = lureAt.clone().setY(FLOOR + 0.5);
      tip.lerp(lurePhase === 1 && lureT > 0.6 ? baitTip : restTipCache(), Math.min(1, dt * 3));
    } else if (state === 'sit') {
      tip.lerp(giant.localToWorld(new THREE.Vector3(0.1, 1.55, 0.2)), Math.min(1, dt * 2)); // hands to its face
    } else if (state === 'rest' || state === 'approach') {
      tip.copy(restTipCache());
    }
    pointArm(armR, 1, tip);

    // Left hand: over its button while caged; at its side (or its face) otherwise.
    if (caged) {
      tipL.set(CAGE.x, 2.6, CAGE.z);
      palm.visible = true;
    } else {
      palm.visible = false;
      if (state === 'sit') tipL.lerp(giant.localToWorld(new THREE.Vector3(-0.1, 1.55, 0.2)), Math.min(1, dt * 2));
      else tipL.copy(restTip(-1, new THREE.Vector3()));
    }
    pointArm(armL, -1, tipL);

    // Sitting down: lower, knees up, a sob now and then.
    if (state === 'sit') {
      sitK = Math.min(1, sitK + dt * 0.6);
      legL.rotation.x = legR.rotation.x = -1.3 * sitK;
      if (Math.random() < dt * 0.8) tone({ type: 'sine', from: 320, to: 200, dur: 0.5, gain: 0.05 });
    }

    // The floor shakes on its footfalls (just the view; you don't move).
    if (shake > 0) {
      shake = Math.max(0, shake - dt * 1.6);
      cam.y += (Math.random() - 0.5) * shake * 0.25;
    }
    return false;
  });

  // Where the right hand hangs at rest, refreshed as the giant moves.
  const restCache = new THREE.Vector3();
  function restTipCache(): THREE.Vector3 {
    return restTip(1, restCache);
  }

  // ── Giving up: it sits, cries, and a button comes up for you ──
  function giveUp(): void {
    shadowMat.opacity = 0;
    gR = GIANT_R + 3;
    caged = false;
    ctx.removeObstacle(cageBlock);
    ctx.narrate(SIT, 7000, { priority: true });
    ctx.after(7500, () => {
      if (leaving) return;
      // As far from you as the cap allows, so it can't come up under you.
      const pl = ctx.playerPos();
      const at = new THREE.Vector3(pl.x > 0 ? -2.6 : 2.6, 0, pl.z > 0 ? -1.2 : 3.2);
      const b = spawnPedestalButton(root, at.clone(), () => {
        if (leaving) return;
        leaving = true;
        discover('reward:unpressable');
        sparkle();
        ctx.narrate(UNPRESSABLE, 5000, { priority: true });
        ctx.after(2800, () => ctx.advance(at.clone()));
      });
      ctx.addObstacle(b.obstacle);
      b.group.position.y = -1.3;
      let t = 0;
      addUpdater((dt) => {
        t += dt;
        b.group.position.y = -1.3 + Math.min(1, t / 1.4) * 1.3;
        return t >= 1.4;
      });
      sparkle();
      ctx.narrate(RISE, 5000);
    });
  }

  // The corner button stays pressable-looking; it just refuses while caged.
  ctx.addObstacle(corner.obstacle);
  placeGiant();
}

/** Headless-test hooks. */
export const youAreButtonTest = { S, FLOOR, HALF, WALK, CAGE, FINGER_R, AIM_TIME, DODGE_WIN };
