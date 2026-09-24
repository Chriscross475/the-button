import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { addUpdater, currentGeneration } from '../experiences/scheduler';
import { spawnPedestalButton } from '../button/pedestal-button';
import { setCounter, hideCounter } from '../ui/counter';
import { whoosh, pop, sparkle, thud, boo, applause, fanfare } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { registerInteractable } from '../interactables/system';
import { discover } from '../graph/progress';
import { FONT_DISPLAY, FONT_SIGN } from '../ui/fonts';

// HOOPS — the room opens onto a gym: a half court, one hoop, a scoreboard, and
// two opponents waiting at centre court. Walk up to one and press to pick him;
// he takes his spot under the net. The clock starts on your first throw; when it
// runs out, whoever has more points wins (your makes are 2, or 3 from beyond the
// arc; his dunks are 2). A tie is not a win.
//
//   • THE WALL (big): stands under the net and swats every shot — unless you
//     hit him low first (stomach, or lower). Then he doubles over for a few
//     seconds and the hoop is yours.
//   • THE FLEA (small): jumps for everything. Shoot, and he blocks it; throw at
//     HIM, and he hops over it. Every jump costs him — after 5 he's done, and
//     sits down wheezing.
// Whatever either of them blocks, he takes and dunks himself.
//
// Win → the ball turns gold. Win without him scoring once → the basket follows
// you out (and keeps counting). Lose → you keep the ball. Either way a button
// appears to move on, and the ball comes with you.

const GAME_TIME = 40; // seconds on the clock, from your first throw; at zero, most points wins
const BALL_R = 0.24;
const RIM_Y = 2.8;
const RIM_R = 0.42;
const GRAV = 16;
const COURT = { minX: -8, maxX: 8, minZ: -13, maxZ: 9, h: 9 };
const RIM_Z = COURT.minZ + 1.6;
const ARC_R = 6.75; // beyond this from the hoop, a make is worth 3
const DEFEND = new THREE.Vector3(0, 0, RIM_Z + 1.4); // his spot under the net
const BENCH = new THREE.Vector3(7, 0, -5);
const PICK_SPOTS = [new THREE.Vector3(-2.6, 0, -6.5), new THREE.Vector3(2.6, 0, -6.5)];
const BEND_TIME = 6;
const FLEA_STAMINA = 5;

const INTRO = vo('A court, a hoop, and two gentlemen who have been waiting for an opponent. Pick one. Forty seconds, from your first throw. Most points wins.');
const PICK_WALL = vo('The big one. He does not move. He does not need to.');
const PICK_FLEA = vo('The small one. Do not let the size fool you. He has springs where his knees should be.');
const WALL_BLOCKS = vo(['Swatted. He did not even jump.', 'Rejected. Like a letter from a publisher.', 'He blocked that with his elbow. His elbow.']);
const WALL_HIT = vo('Right in the stomach. He is reconsidering his career. Shoot. Now.');
const WALL_UP = vo('He is back up. And he remembers.');
const FLEA_BLOCKS = vo(['He got up there. Of course he got up there.', 'Blocked, by someone the height of a fire hydrant.']);
const FLEA_HOPS = vo('He hopped right over it. You threw a ball at a small man, and missed.');
const FLEA_TIRED = vo('And he is done. Hands on knees. That is what happens when you skip leg day. And cardio. And lunch.');
const DUNKS = vo(['And he dunks it. On you, specifically.', 'Two points, him. The crowd would boo, if there was one.', 'He hangs off the rim afterwards. Unnecessary.']);
const TIME_WIN = vo('Time. You are ahead, and ahead is winning. The ball turns gold. Off you go, champion.');
const TIME_SHUTOUT = vo('Time, and he never scored. The basket has decided to follow you. Keep sinking them. It is counting.');
const TIME_LOSE = vo('Time. You did not win. You keep the ball, at least. Try not to lose that too.');

export function revealBasketball(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const bornGen = currentGeneration(); // identifies "still in the hoops room"
  ctx.openRoom();

  buildGym(root);
  const board = buildScoreboard(root);

  // ── The hoop (rim-centred) ──
  const hoop = new THREE.Group();
  hoop.position.set(0, RIM_Y, RIM_Z);
  root.add(hoop);
  const backboard = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.3, 0.1), new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.7 }));
  backboard.position.set(0, 0.6, -0.62);
  hoop.add(backboard);
  const sq = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.02), new THREE.MeshStandardMaterial({ color: 0xd23a2a, roughness: 0.6 }));
  sq.position.set(0, 0.45, -0.56);
  hoop.add(sq);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(RIM_R, 0.04, 10, 24), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, metalness: 0.4 }));
  rim.rotation.x = Math.PI / 2;
  hoop.add(rim);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, RIM_Y + 0.6, 10), new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.5, metalness: 0.5 }));
  pole.position.set(0, (RIM_Y + 0.6) / 2, RIM_Z - 1.3);
  root.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.7), pole.material);
  arm.position.set(0, RIM_Y + 0.6, RIM_Z - 0.95);
  root.add(arm);
  ctx.addObstacle({ x: 0, z: RIM_Z - 1.3, radius: 0.3 });
  const netMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
  const net: THREE.Mesh[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.45, 4), netMat);
    seg.position.set(Math.cos(a) * RIM_R * 0.85, -0.22, Math.sin(a) * RIM_R * 0.85);
    hoop.add(seg);
    net.push(seg);
  }
  const swish = () => {
    let st = 0;
    addUpdater((dt) => {
      st += dt;
      const k = Math.sin(Math.min(1, st / 0.35) * Math.PI); // 0 → 1 → 0
      for (const seg of net) seg.scale.y = 1 + k * 0.8;
      if (st >= 0.35) { for (const seg of net) seg.scale.y = 1; return true; }
      return false;
    });
  };

  // ── The opponents ──
  const wall = makeBaller({ height: 2.5, width: 1.55, jersey: 0xc62828, trim: 0xf2f2ee, name: 'THE WALL', number: '99' });
  const flea = makeBaller({ height: 1.15, width: 0.95, jersey: 0xf2c12e, trim: 0x2b2b3a, name: 'THE FLEA', number: '1' });
  const both = [wall, flea];
  both.forEach((b, i) => {
    b.root.position.copy(PICK_SPOTS[i]);
    b.root.rotation.y = 0; // facing +Z, toward you
    root.add(b.root);
    b.block = { x: b.root.position.x, z: b.root.position.z, radius: 0.35 * b.width + 0.1 };
    ctx.addObstacle(b.block);
  });

  // ── State ──
  type Mode = 'free' | 'held' | 'flying' | 'his';
  let mode: Mode = 'free';
  let foe: Baller | null = null;
  let you = 0;
  let him = 0;
  let ended = false;
  let scored = false;
  let shot = false; // the throw in flight is headed for the hoop
  let bent = 0; // THE WALL: seconds left doubled over
  let stamina = FLEA_STAMINA; // THE FLEA
  let jumpY = 0; // THE FLEA: height off the floor
  let jumpV = 0;
  let jumpCatch = false; // this jump is going for the ball
  let saidBlock = 0;
  let saidDodge = false;
  const fwd = new THREE.Vector3();
  const throwPos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  let prevY = BALL_R;

  let ballYours = false; // registered as a carryable (not while he has it)
  const giveBall = (yours: boolean) => {
    if (yours === ballYours) return;
    ballYours = yours;
    if (yours) ctx.addCarryable(carry);
    else ctx.removeCarryable(carry);
  };
  let saidTired = false;
  // Where he stands between plays: THE WALL guards (or is still doubled over);
  // THE FLEA guards until he's out of jumps, then he's done for.
  const restPose = () => {
    if (foe === wall) wall.pose(bent > 0 ? 'bent' : 'guard');
    else if (foe === flea) {
      if (stamina > 0) flea.pose('guard');
      else {
        flea.pose('tired');
        if (!saidTired) {
          saidTired = true;
          ctx.narrate(FLEA_TIRED, 6000, { priority: true });
        }
      }
    }
  };

  let clock = GAME_TIME;
  let clockOn = false; // starts on your first throw
  const mmss = (t: number) => {
    const s = Math.max(0, Math.ceil(t));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const hud = () => {
    const name = foe?.name ?? 'THEM';
    setCounter(`YOU ${you}  —  ${him} ${name}   ${mmss(clock)}`);
    board.draw(you, him, name, mmss(clock));
  };

  // ── The ball ──
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xd86a23, roughness: 0.85 });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 1 });
  const ball = new THREE.Group();
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 18, 14), ballMat));
  for (const yRot of [0, Math.PI / 2]) {
    const seam = new THREE.Mesh(new THREE.TorusGeometry(BALL_R, 0.012, 6, 20), seamMat);
    seam.rotation.y = yRot;
    ball.add(seam);
  }
  ball.visible = false; // it drops in once you've picked an opponent
  root.add(ball);

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

  // Where a throw from `p` at `v` goes: past the rim (a shot), or at HIM (low,
  // within reach of where he stands), or neither.
  const aimOf = (p: THREE.Vector3, v: THREE.Vector3): 'hoop' | 'him' | null => {
    const q = p.clone();
    const w = v.clone();
    const at = foe?.root.position;
    for (let t = 0; t < 3; t += 0.02) {
      w.y -= GRAV * 0.02;
      q.addScaledVector(w, 0.02);
      if (Math.hypot(q.x, q.z - RIM_Z) < 1.6 && q.y > RIM_Y - 0.6) return 'hoop';
      if (at && Math.hypot(q.x - at.x, q.z - at.z) < 1.2 && q.y < 2.2) return 'him';
      if (q.y < BALL_R) return null;
    }
    return null;
  };

  const carry: Carryable = {
    kind: 'basketball',
    object: ball,
    heldDist: 0.9,
    heldRight: 0.3,
    heldDrop: 0.45,
    // You keep the ball — so its throw physics live on the ball, not this level:
    // it stays grabbable and flies the same (gravity + bounce) in every level.
    persistent: true,
    projectile: { radius: BALL_R, restitution: 0.55, gravity: GRAV },
    clickThrows: true,
    // Like a duck, the ball cushions a train hit — but it isn't spent: it bounces
    // you clear and stays in hand (no feather burst).
    trainShield: { consume: false },
    onGrab: () => {
      mode = 'held';
    },
    onThrow: (charge) => {
      whoosh();
      ctx.camera.getWorldDirection(fwd);
      const v = fwd.clone().multiplyScalar(9 + charge * 7);
      v.y += 1.6; // a bit of arc
      if (currentGeneration() === bornGen && !ended) {
        // Mid-match in the gym: the level's own physics (the hoop, the
        // opponent, the gym walls) handles the throw.
        clockOn = true;
        throwPos.copy(ctx.playerPos());
        vel.copy(v);
        mode = 'flying';
        scored = false;
        const aim = aimOf(ball.position, v);
        shot = aim === 'hoop';
        if (foe === flea && stamina > 0 && aim) fleaJump(shot);
      } else {
        // Match over (the basket may be following you now) OR another level:
        // fly the ball as a global projectile so the GLOBAL scoring hoop (the
        // follower basket's rim) counts it — physics identical everywhere.
        ctx.launchProjectile(ball, v, { radius: BALL_R, restitution: 0.55, gravity: GRAV });
      }
    },
  };

  // ── Picking an opponent ──
  both.forEach((b, i) => {
    registerInteractable({
      id: `hoops-pick-${i}`,
      position: PICK_SPOTS[i].clone().setY(1),
      radius: 2.2,
      promptLabel: 'PICK',
      canUse: () => !foe,
      onUse: () => {
        if (foe) return;
        foe = b;
        const other = both[1 - i];
        discover(b === wall ? 'mech:the-wall' : 'mech:the-flea');
        ctx.narrate(b === wall ? PICK_WALL : PICK_FLEA, 5000, { priority: true });
        b.walkTo(DEFEND, 0);
        other.walkTo(BENCH, -Math.PI / 2, () => other.sit());
        b.label.visible = false;
        other.label.visible = false;
        ball.visible = true;
        giveBall(true);
        dropInFront();
        hud();
      },
    });
  });

  // ── THE FLEA's jumps ──
  const fleaJump = (going: boolean) => {
    // He waits for the ball to get near, then goes.
    const wait = going ? 0.25 : 0.15;
    ctx.after(wait * 1000, () => {
      if (foe !== flea || stamina <= 0 || jumpY > 0) return;
      stamina--;
      jumpV = going ? 9.5 : 7;
      jumpY = 0.01;
      jumpCatch = going;
      flea.pose('up');
      if (!going && !saidDodge) {
        saidDodge = true;
        ctx.narrate(FLEA_HOPS, 5000, { priority: true });
      }
    });
  };

  // ── His possession: catch, dunk, pass it back ──
  const takeBall = (lines: string[]) => {
    if (!foe) return;
    mode = 'his';
    giveBall(false); // his, for now
    jumpY = 0; // the dunk takes over his height
    jumpV = 0;
    jumpCatch = false;
    thud();
    ctx.narrate(lines[saidBlock++ % lines.length], 3500, { priority: true });
    const f = foe;
    let t = 0;
    const from = f.root.position.clone();
    let dunked = false;
    addUpdater((dt) => {
      t += dt;
      if (ended && !dunked) {
        // The clock ran out mid-dunk: it doesn't count. He drops it; it's yours.
        f.root.position.y = 0;
        restPose();
        mode = 'free';
        vel.set(0, 0, 0);
        giveBall(true);
        return true;
      }
      const hand = f.hand();
      if (t < 0.7) {
        // step in under the rim
        f.root.position.lerpVectors(from, new THREE.Vector3(0, 0, RIM_Z + 0.5), Math.min(1, t / 0.7));
        f.pose('up');
        ball.position.copy(hand);
      } else if (t < 1.3) {
        // up and in
        const k = (t - 0.7) / 0.6;
        const lift = f === flea ? Math.sin(k * Math.PI) * 2.2 : Math.sin(k * Math.PI) * 0.5;
        f.root.position.y = lift;
        ball.position.lerpVectors(hand, new THREE.Vector3(0, RIM_Y + 0.35, RIM_Z), k);
      } else if (!dunked) {
        dunked = true;
        him += 2;
        swish();
        boo();
        ctx.narrate(DUNKS[Math.floor(Math.random() * DUNKS.length)], 3500, { priority: true });
        hud();
        ball.position.set(0, RIM_Y - 0.2, RIM_Z);
        vel.set(0, -2, 0);
        mode = 'flying'; // falls through the net under the level's physics
        scored = true; // (not yours)
        shot = false;
      } else {
        f.root.position.y = Math.max(0, f.root.position.y - dt * 6);
        if (t < 2.2) return false;
        f.walkTo(DEFEND, 0);
        restPose();
        // …and he passes it back to you.
        const p = ctx.playerPos();
        ball.position.set(f.root.position.x, 1.4, f.root.position.z + 0.6);
        const to = new THREE.Vector3(p.x - ball.position.x, 0, p.z - ball.position.z);
        const dist = to.length();
        vel.copy(to.normalize().multiplyScalar(Math.min(9, dist * 1.1))).setY(4);
        mode = 'free';
        giveBall(true);
        return true;
      }
      return false;
    });
  };

  const score = (pts: number) => {
    you += pts;
    sparkle();
    pop();
    applause(0.12, 1.2);
    swish();
    hud();
  };

  // ── Per frame: the ball, the opponent, the match ──
  const foeBallDist = new THREE.Vector3();
  addUpdater((dt) => {
    // The clock: counts down once you've thrown; redraw on each new second.
    if (clockOn && !ended) {
      const shown = Math.ceil(clock);
      clock -= dt;
      if (Math.ceil(clock) !== shown) hud();
      if (clock <= 0) {
        clock = 0;
        endGame();
      }
    }
    // Opponents: walking, THE WALL's doubled-over timer, THE FLEA's jump.
    for (const b of both) b.tick(dt);
    if (foe === wall && bent > 0) {
      bent -= dt;
      if (bent <= 0) {
        wall.pose('guard');
        ctx.narrate(WALL_UP, 3000, { interruptible: true });
      }
    }
    if (foe === flea && jumpY > 0) {
      jumpV -= GRAV * dt;
      jumpY = Math.max(0, jumpY + jumpV * dt);
      flea.root.position.y = jumpY;
      if (jumpY === 0) {
        jumpCatch = false;
        if (mode !== 'his') restPose();
      }
    }
    for (const b of both) {
      b.block.x = b.root.position.x;
      b.block.z = b.root.position.z;
    }

    if (mode === 'held' || mode === 'his') {
      prevY = ball.position.y;
      return false;
    }

    // Physics — the same for a free drop, a shot, and his dunk falling through.
    vel.y -= GRAV * dt;
    ball.position.addScaledVector(vel, dt);
    const p = ball.position;
    const WX = COURT.maxX - BALL_R;
    if (p.x > WX) { p.x = WX; vel.x = -vel.x * 0.7; } else if (p.x < -WX) { p.x = -WX; vel.x = -vel.x * 0.7; }
    if (p.z > COURT.maxZ - BALL_R) { p.z = COURT.maxZ - BALL_R; vel.z = -vel.z * 0.7; } else if (p.z < COURT.minZ + BALL_R) { p.z = COURT.minZ + BALL_R; vel.z = -vel.z * 0.7; }
    if (p.y > COURT.h - BALL_R) { p.y = COURT.h - BALL_R; vel.y = -vel.y * 0.6; }
    if (p.y < BALL_R) { p.y = BALL_R; vel.y = -vel.y * 0.55; vel.x *= 0.82; vel.z *= 0.82; }
    // Backboard: bounce off it — and a hit on the red square banks in.
    const BOARD_Z = RIM_Z - 0.57;
    if (vel.z < 0 && p.z - BALL_R <= BOARD_Z && p.z - BALL_R > BOARD_Z - 0.7 &&
        Math.abs(p.x) < 1.0 && Math.abs(p.y - (RIM_Y + 0.6)) < 0.65) {
      if (mode === 'flying' && !ended && !scored && foe &&
          Math.abs(p.x) < 0.4 + 0.25 && Math.abs(p.y - (RIM_Y + 0.45)) < 0.3 + 0.25) {
        scored = true;
        score(Math.hypot(throwPos.x, throwPos.z - RIM_Z) > ARC_R ? 3 : 2);
      }
      p.z = BOARD_Z + BALL_R;
      vel.z = Math.abs(vel.z) * 0.5;
    }
    ball.rotation.x += vel.z * dt * 0.4;
    ball.rotation.z -= vel.x * dt * 0.4;

    if (mode === 'flying' && foe && !ended && !scored) {
      // The opponent gets his hands on it?
      const f = foe;
      foeBallDist.set(p.x - f.root.position.x, 0, p.z - f.root.position.z);
      const horiz = foeBallDist.length();
      if (f === wall && bent <= 0) {
        // A shot: he swats it anywhere near him. A throw at HIM: it hits his
        // body — stomach or lower folds him; higher, he just catches it.
        const onBody = horiz < 0.4 * f.width + BALL_R && p.y < f.height;
        const low = onBody && p.y > f.height * 0.25 && p.y < f.height * 0.62;
        if (!shot && low) {
          // Stomach, or lower. He folds.
          bent = BEND_TIME;
          wall.pose('bent');
          thud();
          ctx.narrate(WALL_HIT, 4000, { priority: true });
          // …and it bounces off his belly back toward you, so you can shoot
          // before he straightens up.
          const pp = ctx.playerPos();
          const back = new THREE.Vector3(pp.x - p.x, 0, pp.z - p.z);
          vel.copy(back.normalize().multiplyScalar(Math.min(7, back.length() * 0.9))).setY(4);
          mode = 'free';
        } else if ((shot && horiz < 1.4 && p.y > f.height * 0.62 && p.y < 5.5) || (!shot && onBody && p.y >= f.height * 0.62)) {
          takeBall(WALL_BLOCKS); // swatted, and his now
          return false;
        }
      } else if (f === flea && jumpCatch && jumpY > 0.4 && horiz < 1.5 && p.y > 1.2) {
        takeBall(FLEA_BLOCKS);
        return false;
      }
    }

    const settled = p.y <= BALL_R + 0.001 && Math.abs(vel.y) < 0.7 && Math.hypot(vel.x, vel.z) < 0.4;
    if (mode === 'flying') {
      // Aim-assist: a shot descending just above the rim curls toward it.
      if (shot && vel.y < 0 && p.y > RIM_Y && p.y < RIM_Y + 2.4) {
        const dx = -p.x;
        const dz = RIM_Z - p.z;
        const horiz = Math.hypot(dx, dz);
        if (horiz > 1e-3 && horiz < 1.4) {
          vel.x += (dx / horiz) * 10 * dt;
          vel.z += (dz / horiz) * 10 * dt;
        }
      }
      // A make: through the rim plane, descending, within a forgiving radius.
      if (foe && !ended && !scored && prevY > RIM_Y && p.y <= RIM_Y && vel.y < 0 && Math.hypot(p.x, p.z - RIM_Z) < RIM_R * 1.15) {
        scored = true;
        score(Math.hypot(throwPos.x, throwPos.z - RIM_Z) > ARC_R ? 3 : 2);
      }
      if (settled) { vel.set(0, 0, 0); mode = 'free'; }
    } else if (settled) {
      vel.set(0, 0, 0);
    }
    prevY = p.y;
    return false; // never stop — the ball lives for the whole level
  });

  ctx.setBounds({ minX: COURT.minX + 0.4, maxX: COURT.maxX - 0.4, minZ: COURT.minZ + 0.4, maxZ: COURT.maxZ - 0.4 });
  ctx.narrate(INTRO, 6000);

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
    // The red shooter's square, same as the real hoop — on the board, above the rim.
    const sqr = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.32, 0.02), new THREE.MeshStandardMaterial({ color: 0xd23a2a, roughness: 0.6 }));
    sqr.position.set(0, 1.42, -0.3);
    inner.add(sqr);
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 10, 22), new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, metalness: 0.4 }));
    r.rotation.x = Math.PI / 2;
    r.position.set(0, 1.3, 0);
    r.name = 'hoop-rim'; // the Game scores throws that drop through this
    inner.add(r);
    const nm = new THREE.MeshBasicMaterial({ color: 0xe8e8e8 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.34, 4), nm);
      seg.position.set(Math.cos(a) * 0.27, 1.12, Math.sin(a) * 0.27);
      inner.add(seg);
    }
    // Floating score label above the basket (the Game redraws it on each score).
    const lc = document.createElement('canvas');
    lc.width = 128;
    lc.height = 64;
    const lctx = lc.getContext('2d')!;
    const ltex = new THREE.CanvasTexture(lc);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: ltex, transparent: true }));
    label.name = 'hoop-score-label';
    label.scale.set(1.1, 0.55, 1);
    label.position.set(0, 2.5, 0); // above the backboard
    label.userData = { canvas: lc, ctx: lctx, tex: ltex };
    g.add(label);
    return g;
  }

  function endGame() {
    if (ended) return;
    ended = true;
    hideCounter();
    board.draw(you, him, foe?.name ?? 'THEM', mmss(clock));
    // Time's up: whoever's ahead wins (a tie is not a win).
    const won = you > him;
    if (won && him === 0) {
      // A shutout — keep the basket: a two-legged hoop that waddles after you.
      fanfare();
      applause(0.3);
      ctx.narrate(TIME_SHUTOUT, 8000, { priority: true });
      root.remove(hoop);
      const basket = makeWalkingBasket();
      ctx.setCompanion(basket, 0);
      const r = basket.getObjectByName('hoop-rim');
      if (r) ctx.setScoringHoop(r, 0.32); // score throws into it from here on (resets to 0)
      discover('reward:walking-basket');
    } else if (won) {
      // A win — the ball turns gold.
      fanfare();
      applause(0.25);
      ballMat.color.setHex(0xffd23f);
      ballMat.emissive.setHex(0xc9912a);
      ballMat.emissiveIntensity = 0.5;
      ballMat.metalness = 0.5;
      discover('reward:golden-ball');
      ctx.narrate(TIME_WIN, 7000, { priority: true });
    } else {
      boo();
      ctx.narrate(TIME_LOSE, 6500, { priority: true });
    }
    foe?.pose(won ? 'tired' : 'up'); // he slumps, or celebrates
    // A button to move on. Pressing it takes your ball WITH you — if it's not in
    // hand, it leaps there so the kept ball comes along to the next level.
    // It rises clear of you: a solid pedestal on top of you would wedge you.
    const pp = ctx.playerPos();
    const at = [new THREE.Vector3(4, 0, 4), new THREE.Vector3(-4, 0, 4), new THREE.Vector3(4, 0, -4)].find(
      (c) => Math.hypot(c.x - pp.x, c.z - pp.z) > 2,
    )!;
    const btn = spawnPedestalButton(root, at, () => {
      if (!ctx.isHolding('basketball')) ctx.putInHand('right', carry);
      ctx.advance(at);
    });
    ctx.addObstacle(btn.obstacle);
  }
}

// ── The gym ────────────────────────────────────────────────────────────────

function buildGym(root: THREE.Object3D): void {
  const W = COURT.maxX - COURT.minX;
  const D = COURT.maxZ - COURT.minZ;
  const cx = (COURT.minX + COURT.maxX) / 2;
  const cz = (COURT.minZ + COURT.maxZ) / 2;

  // Hardwood with the court painted on: the key, the free-throw circle, the arc,
  // and the half-court line with its circle.
  const PX = 40; // canvas px per metre
  const cv = document.createElement('canvas');
  cv.width = W * PX;
  cv.height = D * PX;
  const g = cv.getContext('2d')!;
  for (let y = 0; y < cv.height; y += 0.18 * PX) {
    g.fillStyle = (Math.floor(y / (0.18 * PX)) % 2) ? '#c8914f' : '#c28a49';
    g.fillRect(0, y, cv.width, 0.18 * PX);
  }
  const X = (x: number) => (x - COURT.minX) * PX;
  const Z = (z: number) => (z - COURT.minZ) * PX;
  g.fillStyle = 'rgba(160, 40, 36, 0.85)';
  g.fillRect(X(-2.45), Z(COURT.minZ), 4.9 * PX, (RIM_Z + 4.2 - COURT.minZ) * PX); // the key
  g.strokeStyle = '#f6f1e4';
  g.lineWidth = 0.06 * PX;
  g.strokeRect(X(-2.45), Z(COURT.minZ), 4.9 * PX, (RIM_Z + 4.2 - COURT.minZ) * PX);
  g.beginPath();
  g.arc(X(0), Z(RIM_Z + 4.2), 1.8 * PX, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(RIM_Z), ARC_R * PX, 0.05, Math.PI - 0.05); // the arc
  g.stroke();
  g.beginPath();
  g.moveTo(0, Z(5));
  g.lineTo(cv.width, Z(5)); // half court
  g.stroke();
  g.beginPath();
  g.arc(X(0), Z(5), 1.8 * PX, Math.PI, Math.PI * 2);
  g.stroke();
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, cv.width - g.lineWidth, cv.height - g.lineWidth);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, 0.02, cz);
  floor.receiveShadow = true;
  root.add(floor);

  // Walls: painted block, a dark stripe, and a row of high windows.
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.9 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x23355c, roughness: 0.8 });
  const winMat = new THREE.MeshBasicMaterial({ color: 0x9fc7ef });
  const wallSide = (len: number, x: number, z: number, rotY: number) => {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(len, COURT.h), wallMat);
    w.position.set(x, COURT.h / 2, z);
    w.rotation.y = rotY;
    root.add(w);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.0), stripeMat);
    s.position.set(x, 1.3, z);
    s.rotation.y = rotY;
    s.translateZ(0.02);
    root.add(s);
    for (let k = -len / 2 + 2; k < len / 2 - 1; k += 3.2) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2), winMat);
      win.position.set(x, COURT.h - 1.6, z);
      win.rotation.y = rotY;
      win.translateX(k);
      win.translateZ(0.02);
      root.add(win);
    }
  };
  wallSide(W, cx, COURT.minZ, 0);
  wallSide(W, cx, COURT.maxZ, Math.PI);
  wallSide(D, COURT.minX, cz, Math.PI / 2);
  wallSide(D, COURT.maxX, cz, -Math.PI / 2);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0x6e737c, roughness: 1, side: THREE.DoubleSide }));
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(cx, COURT.h, cz);
  root.add(ceiling);
  // Light panels (self-lit, no real lights).
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  for (let x = -4; x <= 4; x += 4) {
    for (let z = COURT.minZ + 3; z < COURT.maxZ; z += 5) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), panelMat);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, COURT.h - 0.05, z);
      root.add(p);
    }
  }
  root.add(new THREE.HemisphereLight(0xfff6e8, 0x6b5436, 0.95));
  const key = new THREE.DirectionalLight(0xffffff, 0.45);
  key.position.set(3, 12, 6);
  root.add(key);

  // The bench by the side wall.
  const bench = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 3.2), new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.8 }));
  bench.position.set(BENCH.x + 0.4, 0.225, BENCH.z);
  root.add(bench);
}

// The scoreboard over the hoop: YOU vs HIM.
function buildScoreboard(root: THREE.Object3D): { draw: (you: number, him: number, name: string, clock: string) => void } {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 192;
  const g = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  // Below the windows, clear of the wall, and the screen well in front of its
  // frame (coplanar faces z-fight).
  const Y = 5.5;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.9, 0.12), new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.6 }));
  frame.position.set(0, Y, COURT.minZ + 0.15);
  root.add(frame);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.6), new THREE.MeshBasicMaterial({ map: tex }));
  face.position.set(0, Y, COURT.minZ + 0.24);
  root.add(face);
  const draw = (you: number, him: number, name: string, clock: string) => {
    g.fillStyle = '#0b0c0f';
    g.fillRect(0, 0, 512, 192);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#9fb3c8';
    g.font = `bold 28px ${FONT_DISPLAY}`;
    g.fillText('YOU', 128, 34);
    g.fillText(name, 384, 34);
    g.fillStyle = '#ffb22e';
    g.font = `bold 96px ${FONT_DISPLAY}`;
    g.fillText(String(you).padStart(2, '0'), 128, 118);
    g.fillText(String(him).padStart(2, '0'), 384, 118);
    g.fillStyle = '#ff4a3a';
    g.fillText(':', 256, 112);
    g.font = `bold 34px ${FONT_DISPLAY}`;
    g.fillText(clock, 256, 34); // the game clock, between the names
    tex.needsUpdate = true;
  };
  draw(0, 0, 'THEM', `${GAME_TIME / 60 | 0}:${String(GAME_TIME % 60).padStart(2, '0')}`);
  return { draw };
}

// ── The opponents ─────────────────────────────────────────────────────────

type Pose = 'guard' | 'up' | 'bent' | 'tired' | 'sit';
interface Baller {
  root: THREE.Group;
  name: string;
  height: number;
  width: number;
  label: THREE.Sprite;
  block: { x: number; z: number; radius: number };
  pose: (p: Pose) => void;
  hand: () => THREE.Vector3;
  walkTo: (to: THREE.Vector3, faceY: number, then?: () => void) => void;
  sit: () => void;
  tick: (dt: number) => void;
}

// A jointed player: legs at the hips; the upper body hinges at the hips (for
// doubling over); arms at the shoulders. Faces +Z. `height`/`width` scale him.
function makeBaller(o: { height: number; width: number; jersey: number; trim: number; name: string; number: string }): Baller {
  const H = o.height;
  const Wd = o.width;
  const skin = new THREE.MeshStandardMaterial({ color: 0x9a6a48, roughness: 0.8 });
  const shorts = new THREE.MeshStandardMaterial({ color: o.jersey, roughness: 0.8 });
  const shoe = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
  const nc = document.createElement('canvas');
  nc.width = 128;
  nc.height = 160;
  const ng = nc.getContext('2d')!;
  ng.fillStyle = '#' + o.jersey.toString(16).padStart(6, '0');
  ng.fillRect(0, 0, 128, 160);
  ng.fillStyle = '#' + o.trim.toString(16).padStart(6, '0');
  ng.font = `bold 84px ${FONT_SIGN}`;
  ng.textAlign = 'center';
  ng.textBaseline = 'middle';
  ng.fillText(o.number, 64, 88);
  const jerseyFront = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(nc), roughness: 0.8 });
  const jersey = new THREE.MeshStandardMaterial({ color: o.jersey, roughness: 0.8 });

  const root = new THREE.Group();
  const legLen = H * 0.46;
  const torsoLen = H * 0.3;
  const hipW = 0.34 * Wd;
  const mkLimb = (len: number, thick: number, mat: THREE.Material) => {
    const pivot = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(thick, len, thick), mat);
    m.position.y = -len / 2;
    m.castShadow = true;
    pivot.add(m);
    return pivot;
  };
  const legs = [-1, 1].map((s) => {
    const leg = mkLimb(legLen, 0.16 * Wd, skin);
    leg.position.set((s * hipW) / 2, legLen, 0);
    const short = new THREE.Mesh(new THREE.BoxGeometry(0.2 * Wd, legLen * 0.35, 0.2 * Wd), shorts);
    short.position.y = -legLen * 0.17;
    leg.add(short);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.18 * Wd, 0.1, 0.3 * Wd), shoe);
    foot.position.set(0, -legLen + 0.05, 0.05);
    leg.add(foot);
    root.add(leg);
    return leg;
  });
  const upper = new THREE.Group(); // hinges at the hips
  upper.position.y = legLen;
  root.add(upper);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5 * Wd, torsoLen, 0.3 * Wd), [jersey, jersey, jersey, jersey, jerseyFront, jersey]);
  torso.position.y = torsoLen / 2;
  torso.castShadow = true;
  upper.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26 * Math.sqrt(Wd), H * 0.13, 0.26 * Math.sqrt(Wd)), skin);
  head.position.y = torsoLen + H * 0.075;
  upper.add(head);
  const armLen = H * 0.36;
  const arms = [-1, 1].map((s) => {
    const a = mkLimb(armLen, 0.12 * Wd, skin);
    a.position.set(s * (0.25 * Wd + 0.07 * Wd), torsoLen - 0.05, 0);
    upper.add(a);
    return a;
  });

  // His name, floating over him while you choose.
  const lc = document.createElement('canvas');
  lc.width = 256;
  lc.height = 64;
  const lg = lc.getContext('2d')!;
  lg.fillStyle = 'rgba(12,12,16,0.75)';
  lg.fillRect(0, 0, 256, 64);
  lg.fillStyle = '#ffe9a8';
  lg.font = `bold 34px ${FONT_SIGN}`;
  lg.textAlign = 'center';
  lg.textBaseline = 'middle';
  lg.fillText(o.name, 128, 34);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(lc) }));
  label.scale.set(1.6, 0.4, 1);
  label.position.y = H + 0.5;
  root.add(label);

  let pose: Pose = 'guard';
  let t = Math.random() * 5;
  let walk: { to: THREE.Vector3; faceY: number; then?: () => void } | null = null;
  const handAt = new THREE.Vector3();

  const b: Baller = {
    root,
    name: o.name,
    height: H,
    width: Wd,
    label,
    block: { x: 0, z: 0, radius: 0.4 },
    pose: (p) => {
      pose = p;
    },
    hand: () => arms[1].localToWorld(handAt.set(0, -armLen, 0)),
    walkTo: (to, faceY, then) => {
      walk = { to: to.clone(), faceY, then };
    },
    sit: () => {
      pose = 'sit';
    },
    tick: (dt) => {
      t += dt;
      let stride = 0;
      if (walk) {
        const d = new THREE.Vector3().subVectors(walk.to, root.position).setY(0);
        const len = d.length();
        if (len < 0.05) {
          root.rotation.y = walk.faceY;
          const then = walk.then;
          walk = null;
          then?.();
        } else {
          const step = Math.min(len, 2.4 * dt);
          root.position.addScaledVector(d.normalize(), step);
          root.rotation.y = Math.atan2(d.x, d.z);
          stride = Math.sin(t * 9);
        }
      }
      // Pose targets: arms (z = sideways raise, x = forward), upper-body bend.
      let armZ = 0.15;
      let armX = 0;
      let bend = 0;
      let legX = stride * 0.5;
      let sink = 0;
      if (pose === 'guard') {
        armZ = 0.9 + Math.sin(t * 3) * 0.1; // arms out, bouncing on his toes
        sink = Math.abs(Math.sin(t * 5)) * 0.03;
      } else if (pose === 'up') {
        armZ = 2.9; // straight up
      } else if (pose === 'bent') {
        bend = 1.05; // doubled over
        armX = -0.9; // clutching his middle
        armZ = 0.3;
      } else if (pose === 'tired') {
        bend = 0.7; // hands on knees
        armX = -0.7;
        armZ = 0.1;
        sink = Math.sin(t * 6) * 0.02; // wheezing
      } else if (pose === 'sit') {
        legX = -Math.PI / 2;
        sink = -legLen + 0.45;
        bend = 0.15;
      }
      upper.rotation.x = THREE.MathUtils.lerp(upper.rotation.x, bend, Math.min(1, dt * 8));
      arms[0].rotation.z = THREE.MathUtils.lerp(arms[0].rotation.z, -armZ, Math.min(1, dt * 10));
      arms[1].rotation.z = THREE.MathUtils.lerp(arms[1].rotation.z, armZ, Math.min(1, dt * 10));
      for (const a of arms) a.rotation.x = THREE.MathUtils.lerp(a.rotation.x, armX, Math.min(1, dt * 8));
      legs[0].rotation.x = legX;
      legs[1].rotation.x = pose === 'sit' ? legX : -legX; // sitting: both forward; walking: alternate
      if (pose === 'sit' || sink !== 0) {
        upper.position.y = legLen + sink;
        for (const l of legs) l.position.y = legLen + sink;
      } else {
        upper.position.y = legLen;
        for (const l of legs) l.position.y = legLen;
      }
    },
  };
  return b;
}
