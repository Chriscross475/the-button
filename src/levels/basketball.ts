import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { spawnPedestalButton } from '../button/pedestal-button';
import { setCounter, hideCounter } from '../ui/counter';
import { whoosh, pop, sparkle } from '../audio/sfx';

// HOOPS — a 30-second free-throw run inside the closed room (the walls bounce the
// ball back). ONE ball: it drops in front of you and bounces (less and less);
// grab it, throw it at the hoop, and it drops back in front for the next shot.
// Score as many as you can — a make from the FAR side of the room is worth 3.
// The reward scales with your total: lots → the basket follows you; a fair score
// → a golden ball; either way you keep the ball, and a button appears to move on.

const GAME_TIME = 30;
const REWARD_BASKET = 18; // points → the walking basket (top reward)
const REWARD_GOLD = 8; // points → a golden keepsake ball
const BALL_R = 0.24;
const RIM_Y = 2.6; // lowered a touch from 3.0
const RIM_R = 0.42;
const GRAV = 16;

export function revealBasketball(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const { width: w, depth: d, height: h } = CONFIG.ROOM;
  ctx.openRoom({ walls: false, ceiling: false }); // keep the enclosed room; sink the button

  const RIM_Z = -d / 2 + 0.9; // hoop just in front of the back wall
  const FAR_DIST = d * 0.55; // beyond this from the hoop, a make is worth 3

  // ── The hoop (rim-centred so it can later follow you as a companion) ──
  const hoop = new THREE.Group();
  hoop.position.set(0, RIM_Y, RIM_Z);
  root.add(hoop);
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 0.1), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 }));
  board.position.set(0, 0.6, -0.62);
  hoop.add(board);
  const sq = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.02), new THREE.MeshStandardMaterial({ color: 0xd23a2a, roughness: 0.6 }));
  sq.position.set(0, 0.45, -0.56);
  hoop.add(sq);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, 0.04, 10, 24), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, metalness: 0.4 }));
  rim.rotation.x = Math.PI / 2;
  hoop.add(rim);
  const netMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.45, 4), netMat);
    seg.position.set(Math.cos(a) * RIM_R * 0.85, -0.22, Math.sin(a) * RIM_R * 0.85);
    hoop.add(seg);
  }

  // ── State ──
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xd86a23, roughness: 0.85 });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 1 });
  const fwd = new THREE.Vector3();
  const throwPos = new THREE.Vector3(); // where the current shot was released from
  const WX = w / 2 - BALL_R;
  const WZ = d / 2 - BALL_R;
  const WY = h - BALL_R;
  let points = 0;
  let timeLeft = GAME_TIME;
  let started = false;
  let ended = false;

  // ── The single basketball ──
  const ball = new THREE.Group();
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 18, 14), ballMat));
  for (const yRot of [0, Math.PI / 2]) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(BALL_R, 0.012, 6, 20), seamMat);
    seam.rotation.y = yRot;
    ball.add(seam);
  }
  root.add(ball);

  let mode: 'free' | 'held' | 'flying' = 'free';
  const vel = new THREE.Vector3();
  let prevY = BALL_R;
  let scored = false;

  // Drop the ball from above, just in front of where the player is looking.
  const dropInFront = () => {
    const pp = ctx.playerPos();
    ctx.camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
    fwd.normalize();
    ball.position.set(pp.x + fwd.x * 1.8, 2.6, pp.z + fwd.z * 1.8);
    vel.set(0, 0, 0);
    mode = 'free';
    scored = false;
  };

  const carry: Carryable = {
    kind: 'basketball',
    object: ball,
    heldDist: 0.9,
    heldRight: 0.3,
    heldDrop: 0.45,
    onGrab: () => {
      mode = 'held';
      started = true; // the clock starts when you first pick the ball up
    },
    onThrow: (charge) => {
      started = true;
      whoosh();
      throwPos.copy(ctx.playerPos());
      ctx.camera.getWorldDirection(fwd);
      vel.copy(fwd).multiplyScalar(9 + charge * 7);
      vel.y += 1.6; // a bit of arc
      mode = 'flying';
      scored = false;
    },
  };
  ctx.addCarryable(carry);
  dropInFront();

  const score = (pts: number) => {
    points += pts;
    sparkle();
    pop();
  };

  const hud = () => setCounter(`HOOPS  ${points} pts   ${Math.max(0, Math.ceil(timeLeft))}s`);
  hud();

  addUpdater((dt) => {
    // The game clock + scoring run only while the round is live. The BALL physics
    // always runs — so the ball stays a real, throwable ball even after you win.
    if (!ended && started) {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        endGame();
      }
    }
    if (!ended) hud();

    if (mode === 'held') {
      prevY = ball.position.y;
      return false; // the carry system controls the held ball
    }

    // Physics — same for a free drop and a thrown shot.
    vel.y -= GRAV * dt;
    ball.position.addScaledVector(vel, dt);
    const p = ball.position;
    if (p.x > WX) { p.x = WX; vel.x = -vel.x * 0.7; } else if (p.x < -WX) { p.x = -WX; vel.x = -vel.x * 0.7; }
    if (p.z > WZ) { p.z = WZ; vel.z = -vel.z * 0.7; } else if (p.z < -WZ) { p.z = -WZ; vel.z = -vel.z * 0.7; }
    if (p.y > WY) { p.y = WY; vel.y = -vel.y * 0.6; }
    if (p.y < BALL_R) { p.y = BALL_R; vel.y = -vel.y * 0.55; vel.x *= 0.82; vel.z *= 0.82; }
    ball.rotation.x += vel.z * dt * 0.4;
    ball.rotation.z -= vel.x * dt * 0.4;

    const settled = p.y <= BALL_R + 0.001 && Math.abs(vel.y) < 0.7 && Math.hypot(vel.x, vel.z) < 0.4;
    if (mode === 'flying') {
      if (!ended && !scored && prevY > RIM_Y && p.y <= RIM_Y && vel.y < 0 && Math.hypot(p.x, p.z - RIM_Z) < RIM_R * 0.92) {
        scored = true;
        const far = Math.hypot(throwPos.x, throwPos.z - RIM_Z) > FAR_DIST;
        score(far ? 3 : 1);
      }
      // The SAME ball comes to rest wherever it lands — no respawn; you go fetch it.
      if (settled) { vel.set(0, 0, 0); mode = 'free'; }
    } else if (settled) {
      vel.set(0, 0, 0);
    }
    prevY = p.y;
    return false; // never stop — the ball lives for the whole level
  });

  ctx.narrate('A hoop, and a ball that drops at your feet. Thirty seconds — score as many as you can. Sink one from the far side and it counts for three. Go.', 7000);

  // The kept basket: a small hoop on two legs (origin at the feet, rim ~chest
  // height) that waddles after you. The companion system points a follower's
  // local +X at the player, so the basket's OPENING is built facing +X (via the
  // inner rotation) — it turns to face you, not off to the side.
  function makeWalkingBasket(): THREE.Group {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    inner.rotation.y = Math.PI / 2; // opening (+Z) → +X so it faces the player
    g.add(inner);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.9, flatShading: true });
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.95, 8), legMat);
      leg.position.set(sx * 0.22, 0.48, 0);
      inner.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.34), legMat);
      foot.position.set(sx * 0.22, 0.05, 0.06);
      inner.add(foot);
    }
    const bb = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.7, 0.07), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 }));
    bb.position.set(0, 1.55, -0.34);
    inner.add(bb);
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 10, 22), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, metalness: 0.4 }));
    r.rotation.x = Math.PI / 2;
    r.position.set(0, 1.3, 0);
    inner.add(r);
    const nm = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.34, 4), nm);
      seg.position.set(Math.cos(a) * 0.27, 1.12, Math.sin(a) * 0.27);
      inner.add(seg);
    }
    return g;
  }

  function endGame() {
    if (ended) return;
    ended = true;
    hideCounter();
    // The ball stays exactly where it is and remains a normal throwable ball —
    // so you can keep tossing it (e.g. into the basket that now follows you).
    if (points >= REWARD_BASKET) {
      // Top tier — keep the basket: a two-legged hoop that waddles after you,
      // turned to face you so you can keep tossing the ball into it.
      ctx.narrate('A genuine display. You keep the basket — it follows you now — and the ball. Both earned.', 8000, { priority: true });
      root.remove(hoop);
      ctx.setCompanion(makeWalkingBasket(), 0);
    } else if (points >= REWARD_GOLD) {
      // Mid tier — the ball turns gold.
      ballMat.color.setHex(0xffd23f);
      ballMat.emissive.setHex(0xc9912a);
      ballMat.emissiveIntensity = 0.5;
      ballMat.metalness = 0.5;
      ctx.narrate('Respectable. The ball turns gold in your hands — a keepsake. No basket, though.', 7000, { priority: true });
    } else {
      ctx.narrate('Modest. You keep the ball, at least. A consolation.', 6500, { priority: true });
    }
    // A new button to move on.
    const btn = spawnPedestalButton(root, new THREE.Vector3(4, 0, 3), () => ctx.advance(new THREE.Vector3(4, 0, 3)));
    ctx.addObstacle(btn.obstacle);
  }
}
