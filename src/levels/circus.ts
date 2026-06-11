import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { buildExitRoom } from './exit-room';
import { pop, whoosh, sparkle } from '../audio/sfx';
import { discover } from '../graph/progress';

// THE CIRCUS — a tall cylindrical big-top. Trampolines ring the inside edge at
// rising heights in turning directions; each flings you up to the next, so you
// spiral higher and higher to a top platform. There you win a UNICYCLE (a single
// wheel — hands-free, fast, but it slides). From the top a thin, twisting walkway
// leads OUT of the tent (awkward on the wheel) to the white exit room.

const R = 11; // tent radius
const PAD_R = 8; // trampolines ring this radius
const N_PADS = 6;
const STEP_H = 2.5; // height gained per bounce
const TOP = { x: -9, z: 0, H: 0.4 + N_PADS * STEP_H }; // ~15.4, on the −X side
const G = 16; // matches FLIGHT_GRAVITY

function stripeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#c62828' : '#f3ead3';
    g.fillRect((i / 16) * 256, 0, 256 / 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(1, 1);
  return t;
}

export function revealCircus(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom();

  ctx.scene.background = new THREE.Color(0x1d1726);
  ctx.scene.fog = new THREE.Fog(0x1d1726, 28, 120);
  root.add(new THREE.HemisphereLight(0xead8ff, 0x2a2433, 0.9));
  root.add(new THREE.AmbientLight(0xffffff, 0.4));
  const spot = new THREE.DirectionalLight(0xffffff, 0.6);
  spot.position.set(6, 28, 6);
  root.add(spot);

  // ── The big-top: sawdust floor, striped wall, peaked roof ──
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(R + 0.5, 48),
    // polygonOffset so the sawdust wins the depth test over the coplanar white
    // hub floor (openRoom leaves it at y=0) — no z-fighting flicker.
    new THREE.MeshStandardMaterial({ color: 0x6b5836, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  floor.receiveShadow = true;
  root.add(floor);
  // Tent wall with TWO openings: −X (the elevated walkway out to the reward
  // room) and −Z (the ground-level path to the no-reward room). Built as the two
  // arcs of wall BETWEEN those gaps. NOTE the cylinder's angle runs
  // x = r·sin θ, z = r·cos θ — so θ = 3π/2 is −X and θ = π is −Z. (An earlier
  // version put the gap at θ = π expecting −X, so the opening sat a quarter-turn
  // off and the walkway speared through solid wall.)
  const wallMat = new THREE.MeshStandardMaterial({ map: stripeTexture(), side: THREE.BackSide, roughness: 0.95 });
  const GAP = 0.34; // half-width of each opening (radians)
  const wallArc = (thetaStart: number, thetaLength: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 22, 48, 1, true, thetaStart, thetaLength), wallMat);
    m.position.y = 11;
    root.add(m);
  };
  wallArc(Math.PI + GAP, Math.PI / 2 - 2 * GAP);         // −Z gap → −X gap (short arc)
  wallArc(Math.PI * 1.5 + GAP, Math.PI * 1.5 - 2 * GAP); // −X gap → −Z gap (the long way round)
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(R + 1.2, 9, 48, 1, true),
    new THREE.MeshStandardMaterial({ map: stripeTexture(), side: THREE.BackSide, roughness: 0.95 }),
  );
  roof.position.y = 22 + 4.5;
  root.add(roof);

  // ── The trampolines: a rising spiral around the edge ──
  interface Pad {
    x: number;
    z: number;
    H: number;
  }
  const pads: Pad[] = [];
  for (let k = 0; k < N_PADS; k++) {
    const a = k * 1.7;
    pads.push({ x: Math.cos(a) * PAD_R, z: Math.sin(a) * PAD_R, H: 0.4 + k * STEP_H });
  }
  const padMat = new THREE.MeshStandardMaterial({ color: 0x2b66c4, roughness: 0.6 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xf03030, roughness: 0.7 });
  for (const p of pads) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, p.H, 10), ringMat);
    post.position.set(p.x, p.H / 2, p.z);
    root.add(post);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.18, 10, 24), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(p.x, p.H + 0.02, p.z);
    root.add(ring);
    const mat = new THREE.Mesh(new THREE.CircleGeometry(1.45, 24), padMat);
    mat.rotation.x = -Math.PI / 2;
    mat.position.set(p.x, p.H + 0.04, p.z);
    root.add(mat);
  }

  // ── Top platform + the unicycle reward ──
  const topPlat = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.4, 24), new THREE.MeshStandardMaterial({ color: 0xd9c089, roughness: 0.9 }));
  topPlat.position.set(TOP.x, TOP.H - 0.2, TOP.z);
  root.add(topPlat);
  const unicycle = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.12, 12, 24), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }));
  tyre.rotation.y = Math.PI / 2;
  unicycle.add(tyre);
  const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), new THREE.MeshStandardMaterial({ color: 0xb0b4bd, metalness: 0.7, roughness: 0.4 }));
  fork.position.y = 0.45;
  unicycle.add(fork);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.12, 0.22), new THREE.MeshStandardMaterial({ color: 0x7a1414, roughness: 0.7 }));
  seat.position.y = 0.86;
  unicycle.add(seat);
  unicycle.position.set(TOP.x, TOP.H + 0.5, TOP.z);
  root.add(unicycle);
  let spinT = 0;
  addUpdater((dt) => {
    if (!unicycle.parent) return true;
    spinT += dt;
    unicycle.rotation.y = spinT;
    unicycle.position.y = TOP.H + 0.5 + Math.sin(spinT * 1.5) * 0.12;
    return false;
  });

  // ── The thin twisting walkway out of the tent → the exit room (all at TOP.H) ──
  const Y = TOP.H;
  const walk: THREE.Mesh[] = [];
  const segMat = new THREE.MeshStandardMaterial({ color: 0xcfd2da, roughness: 0.9 });
  // The segments (and the top platform) all share the walkway height, so where
  // they overlap their top faces were coplanar and z-fought hard. Lift each piece
  // a hair above the previous (~1 cm) so at every overlap one is cleanly on top.
  let segLift = 0.012;
  const seg = (minX: number, maxX: number, minZ: number, maxZ: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, 0.3, maxZ - minZ), segMat);
    m.position.set((minX + maxX) / 2, Y - 0.15 + segLift, (minZ + maxZ) / 2);
    segLift += 0.012;
    root.add(m);
    walk.push(m);
  };
  // out the −X side (through the wall gap), then a couple of turns, into the room
  seg(-18, -7, -1, 1);
  seg(-18, -16, -1, 9);
  seg(-28, -16, 7, 9);

  const exitBounds = buildExitRoom(ctx, { center: new THREE.Vector3(-31, Y, 8), facing: 'posX' });

  // pillars under the elevated walkway + exit (cosmetic)
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x3a3346, roughness: 1 });
  for (const [px, pz] of [[-13, 0], [-17, 4], [-22, 8]] as [number, number][]) {
    const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, Y, 8), pillarMat);
    pil.position.set(px, Y / 2, pz);
    root.add(pil);
  }

  // ── Second exit: the ground-level, NO-REWARD way out. Through the −Z gap at
  //    the back of the tent a short sawdust path leads to a plain white room.
  //    No climb, no unicycle — just a quieter exit for anyone who skips the top. ──
  const GROUND_Z = -22;
  const groundPath = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 13),
    // sits a touch above the sawdust floor + the room floor so neither z-fights it
    new THREE.MeshStandardMaterial({ color: 0x6b5836, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  groundPath.rotation.x = -Math.PI / 2;
  groundPath.position.set(0, 0.04, -14.5);
  groundPath.receiveShadow = true;
  root.add(groundPath);
  const groundBounds = buildExitRoom(ctx, { center: new THREE.Vector3(0, 0, GROUND_Z), facing: 'posZ' });

  // ── Regions: floor + each pad + the top + walkway + both exits ──
  const regions = [
    { minX: -R, maxX: R, minZ: -R, maxZ: R, floorY: 0 },
    ...pads.map((p) => ({ minX: p.x - 1.5, maxX: p.x + 1.5, minZ: p.z - 1.5, maxZ: p.z + 1.5, floorY: p.H })),
    { minX: TOP.x - 2.6, maxX: TOP.x + 2.6, minZ: TOP.z - 2.6, maxZ: TOP.z + 2.6, floorY: TOP.H },
    { minX: -18, maxX: -7, minZ: -1, maxZ: 1, floorY: Y },
    { minX: -18, maxX: -16, minZ: -1, maxZ: 9, floorY: Y },
    { minX: -30, maxX: -16, minZ: 7, maxZ: 9, floorY: Y }, // extends INTO the room for a generous seam
    exitBounds,
    { minX: -3, maxX: 3, minZ: -21, maxZ: -8, floorY: 0 }, // ground path out the −Z back
    groundBounds,
  ];
  ctx.setRegions(regions);

  // Falling off a pad lands you back on the sawdust floor (retry) — only the
  // void OUTSIDE the tent + off the walkway is lethal.
  ctx.setLanding(
    () => {},
    (x, z) => {
      for (const b of regions) {
        if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return true;
      }
      return false;
    },
  );

  // Miss the walkway and fall into the void — and the void has a destination. You
  // drop through the floor of the world into the duck pens, rather than dying.
  // Caught at y < -3, before the engine's void-death at -4.
  let fell = false;
  addUpdater(() => {
    if (fell) return true;
    if (!ctx.isAirborne() || ctx.playerPos().y > -3) return false;
    fell = true;
    ctx.narrate('Down through the floor of the world. The void, it turns out, has a basement — and the basement is full of ducks. You will fit right in.', 6500, { priority: true });
    ctx.advanceTo('ducks');
    return true;
  });

  // ── Bounce: standing on a trampoline flings you toward the next (steer to
  //    land on it). Reaching the last one arcs you to the top platform. ──
  const PH = CONFIG.PLAYER_HEIGHT;
  const arc = (from: Pad, to: Pad): THREE.Vector3 => {
    const T = 1.35;
    return new THREE.Vector3((to.x - from.x) / T, (to.H - from.H) / T + 0.5 * G * T, (to.z - from.z) / T);
  };
  addUpdater(() => {
    if (ctx.isAirborne() || ctx.isDead()) return false;
    const p = ctx.playerPos();
    for (let k = 0; k < pads.length; k++) {
      const pad = pads[k];
      if (Math.abs(p.x - pad.x) < 1.5 && Math.abs(p.z - pad.z) < 1.5 && Math.abs(p.y - (pad.H + PH)) < 0.7) {
        ctx.launchPlayer(arc(pad, k < pads.length - 1 ? pads[k + 1] : TOP));
        pop();
        return false;
      }
    }
    return false;
  });

  // ── Win the wheel on the top platform ──
  let gotWheel = false;
  addUpdater(() => {
    if (gotWheel || ctx.isAirborne()) return false;
    const p = ctx.playerPos();
    if (Math.abs(p.x - TOP.x) < 2.6 && Math.abs(p.z - TOP.z) < 2.6 && Math.abs(p.y - (TOP.H + PH)) < 1.2) {
      gotWheel = true;
      root.remove(unicycle);
      sparkle();
      ctx.setWheel(true);
      discover('reward:unicycle');
      ctx.narrate('The top. And your reward, since you insist: a single wheel. No hands — just balance, which you sorely lack. It does love to slide. The walkway is very thin. Do enjoy.', 8000, { priority: true });
    }
    return false;
  });

  ctx.narrate('A big top — and you, the entire act. Trampolines up the walls, winding tighter the higher you go. Climb, if you fancy it. The falling is the part I enjoy.', 6500);
}
