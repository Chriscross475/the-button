import * as THREE from 'three';
import type { GameContext, ControlMode } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { thunder, sparkle, quack, pop, drumroll, fanfare, applause, boo, sadTrombone, honk } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { createAsset, makeRng } from '../assets';
import { registerInteractable } from '../interactables/system';
import { defineCombine } from '../game/combine';
import { updateLook } from '../controls/player-camera';
import { spawnDuck } from '../objects/duck';
import { discover } from '../graph/progress';
import { rewardPlinth } from './scaffold';
import { buildExitRoom } from './exit-room';
import { FONT_SIGN, FONT_VOICE } from '../ui/fonts';

// THE BIG TOP — the show must go on, and you are the show. A round tent at
// ground level: a sawdust ring, bleachers packed with a cardboard crowd,
// spotlights, strings of bulbs, and an APPLAUSE meter.
//
// Three acts around the ring; each one done fills a third of the meter:
//   • THE CANNON — climb in, aim by looking, fire. Land in the net: glory.
//     Land anywhere else: dead. Hit the canvas: dead, outline on the tent.
//     Aim straight up and you go out through the roof, and come down into a
//     white room of your own outside the tent: its button moves you on.
//   • THE TIGHTROPE — a low wire; it sways. Falling off costs nothing but
//     dignity (sad trombone, boos).
//   • THE CLOWN CAR — press its horn. Clowns keep coming out. Far too many.
// A full meter: the spotlights find you, the prize is the UNICYCLE, and the
// performers' curtain opens — the way out. The sensible leave by the back door
// (no prize). Carried items mostly get jokes: a duck can be fired from the
// cannon (bonus), the basketball can be thrown at the meter (cheating: the
// needle jumps, then sinks back), and an axe near the crowd makes them gasp.

const R = 20; // tent radius
const WALL_H = 9;
const PEAK_H = 17;
const RING_R = 9; // the sawdust ring's curb
const SEAT_R0 = 11; // bleachers run from here…
const SEAT_R1 = 17.5; // …to here
const TIERS = 5;
const TIER_H = 0.9;
const AISLE_HALF = 1.6; // half-width of the two aisles through the bleachers
const DOOR_HALF = 1.2; // the two exits' doorways in the canvas
const DOOR_H = 3.4;
const PH = CONFIG.PLAYER_HEIGHT;

// The two aisles: out the back (+X, the plain exit) and to the curtain (−Z).
const AISLES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)];
const inAisle = (x: number, z: number, pad = 0) =>
  AISLES.some((a) => x * a.x + z * a.z > 0 && Math.abs(x * a.z - z * a.x) < AISLE_HALF + pad);

// The acts.
const CANNON = new THREE.Vector3(-6, 0, 3);
// Walking steps you up onto any floor within eye height + 0.6 m (2.2 m), so the
// net and the wire sit just above that: reachable by cannon and stairs only,
// and you can walk underneath both.
const NET = new THREE.Vector3(5.5, 2.4, -5.5); // y = the net's surface
const NET_R = 2.3;
// Every ordinary shot is 16 m/s (a net shot is ~45°). Only a clearly VERTICAL
// aim (steeper than ~57°) is the roof shot: nearly straight up, hard enough to
// go through the canvas (≈ 14 m up where the cannon stands).
const MUZZLE_V = 16;
const ROOF_PITCH = 1.0;
const ROOF_UP = 26;
const WIRE_Z = -4;
const WIRE_X0 = -7.2;
const WIRE_X1 = -0.8;
const WIRE_Y = 2.6;
const WIRE_HALF = 0.3; // how far off the wire's line you can wobble and stay on
const CLOWN_CAR = new THREE.Vector3(4, 0, 4);
const MAX_CLOWNS = 16;
const METER = new THREE.Vector3(0, 0, -8.6);
const ROOF_ROOM = new THREE.Vector3(0, 0, R + 7); // outside the tent, behind where you start

const roofY = (r: number) => WALL_H + (PEAK_H - WALL_H) * Math.max(0, 1 - r / R);
const bleacherTop = (r: number) =>
  r < SEAT_R0 ? 0 : Math.min(TIERS, Math.floor((r - SEAT_R0) / ((SEAT_R1 - SEAT_R0) / TIERS)) + 1) * TIER_H;

const INTRO = vo('A big top, a full house, and you: the entire act. Earn their applause and there is a prize. Disappoint them and there is also a prize. It is me, pointing that out.');
const IN_CANNON = vo('Into the cannon. Look where you would like to land. Press when you have made peace with it.');
const CANNON_OUT = vo('Changed your mind? Walk backwards out of it. Nobody will say anything. I will.');
const NET_LINES = vo(['The net! They love you. I am furious.', 'Into the net. A professional. Who knew.']);
const MISSED_NET = vo('You missed the net. The net was the whole act.');
const HIT_CANVAS = vo('Into the canvas. Your outline is on the tent now. That is art.');
const THROUGH_ROOF = vo('Straight up, through the roof, and out of the show. You come down in a room the audience never sees. Press on.');
const ROPE_FALLS = vo([
  'Down you go. The sawdust thanks you.',
  'They came for balance. You brought gravity.',
  'A bold interpretation of walking a tightrope. Mostly the falling part.',
]);
const ROPE_DONE = vo('Across. Without a net. Well, with the sawdust. Still.');
const CLOWNS_MANY = vo('How many are in there? That car is a hatchback.');
const CLOWNS_DONE = vo('Sixteen clowns, one small car. Physics has left the building.');
const CLOWNS_MORE = vo('There are no more clowns. There cannot be more clowns. Stop honking.');
const DUCK_FIRED = vo('A duck, fired from a cannon. The crowd is on its feet. I have never been more ashamed of them.');
const METER_CHEAT = vo('Throwing things at the applause meter is not applause. It is vandalism. It is also working. A bit.');
const AXE_GASP = vo('The crowd gasps. Put the axe down. No. Not near them.');
const FINALE = vo('They are on their feet! And the ringmaster, which is me, in a hat, presents your prize. Centre ring. Under the light.');
const GOT_WHEEL = vo('A single wheel. No hands. It slides. The curtain is open. Take a bow on your way out.');
const BACK_DOOR = vo('Out the back, then. No act, no wheel, no applause. A door for the sensible and the faint of heart. There is no prize for sense. There rarely is.');

// ── Carried items meet the circus (global rules; the live level wires them) ──
let hooks: { duck: () => void; meter: () => void; gasp: () => void } | null = null;
defineCombine('duck', 'cannon', (held, _t, env) => {
  env.carry.removeCarryable(held);
  held.object.parent?.remove(held.object); // into the barrel
  hooks?.duck();
});
defineCombine('basketball', 'applause-meter', () => {
  hooks?.meter();
  return true; // it bounces back to you
});
defineCombine('axe', 'bleachers', () => {
  hooks?.gasp();
  return true;
});

function stripeTexture(repeat: number): THREE.CanvasTexture {
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
  t.repeat.set(repeat, 1);
  return t;
}

export function revealCircus(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom();

  ctx.scene.background = new THREE.Color(0x140f1c);
  ctx.scene.fog = new THREE.Fog(0x140f1c, 30, 90);
  root.add(new THREE.HemisphereLight(0xffe2c0, 0x2a2030, 0.75));
  root.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xfff0d8, 0.5);
  key.position.set(4, 20, 6);
  root.add(key);

  buildTent(root);
  const crowd = buildCrowd(root);
  crowd.update(0, 0);
  buildBulbs(root);
  const spots = buildSpotlights(root);
  const meter = buildMeter(root);

  // Everything solid in the tent goes through addSolid, so we can un-stick you:
  // landing (cannon, net bounce, stepping out of the barrel) INSIDE a solid would
  // leave you unable to take a single step — the walker refuses every move that
  // overlaps one. So whenever you're on your feet and overlapping, you're pushed
  // straight back out.
  const solids: { x: number; z: number; radius: number }[] = [];
  const addSolid = (o: { x: number; z: number; radius: number }) => {
    ctx.addObstacle(o);
    solids.push(o);
  };
  let inCannon = false; // (your view sits IN the barrel then — on purpose)
  addUpdater(() => {
    if (inCannon || ctx.isAirborne() || ctx.isDead()) return false;
    const p = ctx.camera.position;
    for (const o of solids) {
      const need = o.radius + CONFIG.PLAYER_RADIUS + 0.02;
      const d = Math.hypot(p.x - o.x, p.z - o.z);
      if (d >= need) continue;
      // Out and away from it — except out by the seats, where "away" could be
      // behind the bleacher edge: there, back in toward the ring.
      const oR = Math.hypot(o.x, o.z);
      let nx: number, nz: number;
      if (oR > RING_R) {
        nx = -o.x / oR;
        nz = -o.z / oR;
      } else if (d > 1e-4) {
        nx = (p.x - o.x) / d;
        nz = (p.z - o.z) / d;
      } else {
        nx = 1;
        nz = 0;
      }
      p.x = o.x + nx * need;
      p.z = o.z + nz * need;
    }
    return false;
  });

  // Bleachers are solid from the ring side (and along the aisles): obstacles
  // along their front edge and down both sides of each aisle.
  for (let a = 0; a < Math.PI * 2; a += 0.07) {
    const x = Math.sin(a) * SEAT_R0;
    const z = Math.cos(a) * SEAT_R0;
    if (!inAisle(x, z, -0.2)) addSolid({ x, z, radius: 0.35 });
  }
  for (const a of AISLES) {
    for (let r = SEAT_R0; r < R; r += 0.6) {
      for (const s of [-1, 1]) {
        addSolid({ x: a.x * r + a.z * s * (AISLE_HALF + 0.3), z: a.z * r - a.x * s * (AISLE_HALF + 0.3), radius: 0.35 });
      }
    }
  }

  // ── Applause ──
  let cheer = 0; // what the meter shows, 0..1
  let bonus = 0; // a temporary bump (the basketball), sinking back
  const acts = new Set<string>();
  let finaleDone = false;
  const clap = (gain = 0.22) => {
    applause(gain);
    crowd.cheer(1);
  };
  const actDone = (id: string) => {
    if (acts.has(id)) return;
    acts.add(id);
    discover(`mech:${id}`);
  };

  // ── The cannon ──
  const cannon = buildCannon(root);
  addSolid({ x: CANNON.x, z: CANNON.z, radius: 1.1 });
  let cannonFlight = false;
  let netBounces = 0;
  let saidInCannon = false;
  let saidCannonOut = false;
  let cannonT = 0; // seconds sat in the barrel this time
  const aimDir = new THREE.Vector3();
  const seat = new THREE.Vector3();
  const aimCannon = () => {
    ctx.camera.getWorldDirection(aimDir);
    const yaw = Math.atan2(aimDir.x, aimDir.z);
    const pitch = THREE.MathUtils.clamp(Math.asin(aimDir.y), 0.2, 1.45);
    cannon.yawGroup.rotation.y = yaw;
    cannon.barrel.rotation.x = -pitch;
    return { yaw, pitch };
  };
  const cannonMode: ControlMode = {
    update(dt, input) {
      updateLook(ctx.camera, input);
      aimCannon();
      cannonT += dt;
      if (cannonT > 10 && !saidCannonOut) {
        saidCannonOut = true; // how to get out without firing, once
        ctx.narrate(CANNON_OUT, 4500);
      }
      cannon.barrel.localToWorld(seat.set(0, 0, 1.3)); // your head, just out of the muzzle
      ctx.camera.position.copy(seat);
      if (input.moveY > 0.5) {
        // Step back out — behind the cannon, clear of its collision.
        inCannon = false;
        ctx.setControlMode(null);
        const back = new THREE.Vector3(Math.sin(cannon.yawGroup.rotation.y), 0, Math.cos(cannon.yawGroup.rotation.y));
        ctx.camera.position.set(CANNON.x - back.x * 2, PH, CANNON.z - back.z * 2);
      }
    },
    onInteract() {
      const { yaw, pitch } = aimCannon();
      inCannon = false;
      ctx.setControlMode(null);
      thunder();
      spots.follow('player');
      cannonFlight = true;
      netBounces = 0;
      if (pitch > ROOF_PITCH) {
        ctx.launchPlayer(new THREE.Vector3(Math.sin(yaw) * 0.8, ROOF_UP, Math.cos(yaw) * 0.8)); // up and out
        return;
      }
      const h = Math.cos(pitch) * MUZZLE_V;
      ctx.launchPlayer(new THREE.Vector3(Math.sin(yaw) * h, Math.sin(pitch) * MUZZLE_V, Math.cos(yaw) * h));
    },
  };
  registerInteractable({
    id: 'circus-cannon',
    position: CANNON.clone().setY(1),
    radius: 2.4,
    promptLabel: 'CLIMB IN',
    onUse: () => {
      drumroll(1.4);
      spots.follow('player');
      inCannon = true;
      cannonT = 0;
      ctx.setControlMode(cannonMode);
      if (!saidInCannon) {
        saidInCannon = true;
        ctx.narrate(IN_CANNON, 5000, { priority: true });
      }
    },
  });
  ctx.addTarget({ kind: 'cannon', position: CANNON.clone(), radius: 2.2 });

  // The net: a raised trampoline-net on legs.
  buildNet(root);

  ctx.setLanding(
    (pos) => {
      if (!cannonFlight) return;
      const inNet = Math.hypot(pos.x - NET.x, pos.z - NET.z) < NET_R && pos.y < NET.y + PH + 0.5;
      if (!inNet) {
        cannonFlight = false;
        ctx.die('cannon');
        ctx.narrate(MISSED_NET, 5000, { priority: true });
        return;
      }
      // Bounce it off: two smaller hops, then you're down (and a star).
      if (netBounces === 0) {
        actDone('cannon');
        clap(0.3);
        pop();
        ctx.narrate(NET_LINES[Math.floor(Math.random() * NET_LINES.length)], 4500, { priority: true });
      }
      if (netBounces < 2) {
        netBounces++;
        ctx.launchPlayer(new THREE.Vector3(0, netBounces === 1 ? 6 : 3.5, 0));
      } else {
        cannonFlight = false;
        spots.follow(null);
      }
    },
    () => true,
  );

  // Mid-flight hazards the engine doesn't know about: the round canvas, the
  // bleachers, and the roof — which is a way out. Up through it there's only
  // sky, so you're quietly moved over the ROOF ROOM (an open-topped exit room
  // outside the tent) with your sideways speed dropped, and fall straight in.
  let throughRoof = false;
  const lastPos = new THREE.Vector3();
  const vel = new THREE.Vector3();
  addUpdater((dt) => {
    const p = ctx.playerPos();
    if (dt > 0) vel.copy(p).sub(lastPos).divideScalar(dt);
    lastPos.copy(p);
    if (!ctx.isAirborne() || ctx.isDead() || throughRoof) return false;
    const r = Math.hypot(p.x, p.z);
    if (p.y > roofY(r) - 0.3) {
      throughRoof = true;
      cannonFlight = false; // this landing is safe — no net needed
      discover('mech:cannon');
      ctx.narrate(THROUGH_ROOF, 6500, { priority: true });
      ctx.camera.position.x = ROOF_ROOM.x;
      ctx.camera.position.z = ROOF_ROOM.z;
      ctx.launchPlayer(new THREE.Vector3(0, Math.max(2, vel.y), 0));
      return false;
    }
    const feet = p.y - PH;
    const hitWall = r > R - 0.4;
    const hitSeats = !hitWall && r > SEAT_R0 && !inAisle(p.x, p.z) && feet < bleacherTop(r);
    if (hitWall || hitSeats) {
      cannonFlight = false;
      const at = hitWall ? p.clone().setX((p.x / r) * (R - 0.1)).setZ((p.z / r) * (R - 0.1)) : p.clone();
      const dir = hitWall ? new THREE.Vector3(p.x, 0, p.z).normalize() : vel.clone();
      ctx.die('wall', { pos: at, dir });
      if (hitWall) ctx.narrate(HIT_CANVAS, 5000, { priority: true });
      else boo();
    }
    return false;
  });

  // ── The tightrope ──
  const regions = [
    { minX: -R, maxX: R, minZ: -R, maxZ: R, floorY: 0 },
    ...buildTightrope(root),
    // the net, so a flight lands ON it (and walking under it stays on the floor)
    { minX: NET.x - NET_R, maxX: NET.x + NET_R, minZ: NET.z - NET_R, maxZ: NET.z + NET_R, floorY: NET.y },
  ];
  ctx.setRegions(regions);
  let onWire = false;
  let drift = 0; // sideways slip, m/s
  let wobble = 0;
  let fell = 0;
  addUpdater((dt) => {
    const p = ctx.playerPos();
    const onIt = !ctx.isAirborne() && p.y > WIRE_Y + PH - 0.3 && p.x > WIRE_X0 && p.x < WIRE_X1 && Math.abs(p.z - WIRE_Z) < WIRE_HALF;
    if (onIt) {
      if (!onWire) {
        onWire = true;
        drift = 0;
        spots.follow('player');
      }
      // The wire pushes you about: a wandering sideways slip you correct with
      // A/D. The camera rolls with it.
      wobble += dt;
      drift += (Math.random() - 0.5) * 9 * dt + Math.sin(wobble * 2.3) * 0.9 * dt;
      drift *= 1 - 0.6 * dt;
      ctx.camera.position.z += drift * dt;
      ctx.camera.rotation.z = drift * 0.5 + Math.sin(wobble * 3.1) * 0.03;
      return false;
    }
    if (!onWire) return false;
    onWire = false;
    ctx.camera.rotation.z = 0;
    spots.follow(null);
    if (p.x >= WIRE_X1 - 0.2 && p.y > WIRE_Y) {
      if (!acts.has('tightrope')) {
        actDone('tightrope');
        clap(0.26);
        ctx.narrate(ROPE_DONE, 4500, { priority: true });
      }
    } else if (p.y < WIRE_Y && p.x > WIRE_X0) {
      sadTrombone();
      boo();
      crowd.cheer(-1);
      ctx.narrate(ROPE_FALLS[fell++ % ROPE_FALLS.length], 4000, { priority: true });
    }
    return false;
  });

  // ── The clown car ──
  const car = buildClownCar(root);
  addSolid({ x: CLOWN_CAR.x, z: CLOWN_CAR.z, radius: 1.3 });
  const clowns: { g: THREE.Object3D; a: number; t: number }[] = [];
  let honks = 0;
  const spawnClown = () => {
    const g = makeClown(clowns.length);
    g.position.copy(car.door);
    root.add(g);
    clowns.push({ g, a: Math.atan2(car.door.z - CLOWN_CAR.z, car.door.x - CLOWN_CAR.x), t: 0 });
    pop();
    if (clowns.length === 6) ctx.narrate(CLOWNS_MANY, 4000, { priority: true });
    if (clowns.length === MAX_CLOWNS) {
      actDone('clown-car');
      clap(0.28);
      ctx.narrate(CLOWNS_DONE, 4500, { priority: true });
      spots.follow(null);
    }
  };
  registerInteractable({
    id: 'circus-clown-car',
    position: CLOWN_CAR.clone().setY(1),
    radius: 2.6,
    promptLabel: 'HONK',
    onUse: () => {
      honk();
      car.squash = 1;
      honks++;
      if (clowns.length >= MAX_CLOWNS) {
        if (honks > MAX_CLOWNS / 2 + 3) ctx.narrate(CLOWNS_MORE, 3500, { priority: true });
        return;
      }
      if (clowns.length > 0) return; // they're already coming
      spots.follow(CLOWN_CAR);
      let n = 0;
      addUpdater((dt) => {
        n += dt;
        if (n < 0.45) return false;
        n = 0;
        spawnClown();
        return clowns.length >= MAX_CLOWNS;
      });
    },
  });
  // Clowns conga round the car, arms waving; the car squashes on each honk.
  addUpdater((dt) => {
    car.squash = Math.max(0, car.squash - dt * 4);
    car.body.scale.set(1 + car.squash * 0.08, 1 - car.squash * 0.12, 1 + car.squash * 0.08);
    for (let i = 0; i < clowns.length; i++) {
      const c = clowns[i];
      c.t += dt;
      const out = Math.min(1, c.t / 0.6); // stumble out to the loop first
      c.a += dt * 0.9;
      const rr = 1.9 + out * 1.4;
      c.g.position.set(CLOWN_CAR.x + Math.cos(c.a) * rr, 0, CLOWN_CAR.z + Math.sin(c.a) * rr);
      c.g.rotation.y = -c.a; // facing along the loop
      const swing = Math.sin(c.t * 9 + i);
      (c.g.getObjectByName('legL') as THREE.Object3D).rotation.x = swing * 0.6;
      (c.g.getObjectByName('legR') as THREE.Object3D).rotation.x = -swing * 0.6;
      (c.g.getObjectByName('armL') as THREE.Object3D).rotation.z = -2.4 + swing * 0.4;
      (c.g.getObjectByName('armR') as THREE.Object3D).rotation.z = 2.4 - swing * 0.4;
    }
    return false;
  });

  // ── Carried-item jokes ──
  let duckFired = false;
  ctx.addTarget({ kind: 'applause-meter', position: METER.clone(), radius: 2.4 });
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
    ctx.addTarget({ kind: 'bleachers', position: new THREE.Vector3(Math.sin(a) * (SEAT_R0 - 0.5), 0, Math.cos(a) * (SEAT_R0 - 0.5)), radius: 4.2 });
  }
  hooks = {
    duck: () => {
      thunder();
      quack();
      const d = createAsset('duck');
      const mouth = cannon.barrel.localToWorld(new THREE.Vector3(0, 0, 1.3));
      d.position.copy(mouth);
      ctx.scene.add(d);
      const dir = new THREE.Vector3().subVectors(mouth, cannon.barrel.localToWorld(new THREE.Vector3())).normalize();
      ctx.launchProjectile(d, dir.multiplyScalar(14).setY(Math.max(6, dir.y * 14)), {
        radius: 0.22,
        restitution: 0.4,
        gravity: 14,
        onSettle: () => {
          // back on its feet: a live duck again
          const at = d.position.clone();
          d.parent?.remove(d);
          spawnDuck(ctx, at.x, at.z);
          quack();
        },
      });
      clap(0.3);
      ctx.narrate(DUCK_FIRED, 5500, { priority: true });
      if (!duckFired) {
        duckFired = true;
        bonus = Math.max(bonus, 0.25);
      }
    },
    meter: () => {
      pop();
      bonus = 0.3;
      ctx.narrate(METER_CHEAT, 5000, { priority: true });
    },
    gasp: () => {
      boo();
      crowd.cheer(-1);
      ctx.narrate(AXE_GASP, 4000, { priority: true });
    },
  };

  // ── The exits ──
  // The performers' curtain (−Z): shut until the meter is full.
  const curtain = buildCurtain(root);
  const curtainBlock = { x: 0, z: -(R - 1.4), radius: 1.8 };
  addSolid(curtainBlock);
  // The unicycle waits under a spot in the middle of the ring once you've won.
  const unicycle = makeUnicycle();
  unicycle.visible = false;
  root.add(unicycle);
  let wheelReady = false;
  let gotWheel = false;

  // Both exits lead into a white exit room (its button moves you on): the back
  // door (+X) is always open, no prize; the curtain (−Z) opens at the finale.
  const backRoom = buildExitRoom(ctx, { center: new THREE.Vector3(R + 4.1, 0, 0), facing: 'negX' });
  const curtainRoom = buildExitRoom(ctx, { center: new THREE.Vector3(0, 0, -(R + 4.6)), facing: 'posZ' });
  // …and a third, only reachable by cannon through the roof: no door, open top.
  const roofRoom = buildExitRoom(ctx, { center: ROOF_ROOM, facing: 'none', openTop: true });
  ctx.setRegions([
    ...regions,
    backRoom,
    { minX: R - 2, maxX: R + 1, minZ: -DOOR_HALF, maxZ: DOOR_HALF, floorY: 0 }, // through the back door
    curtainRoom,
    roofRoom,
    { minX: -DOOR_HALF, maxX: DOOR_HALF, minZ: -R - 1, maxZ: -R + 2, floorY: 0 }, // through the curtain
  ]);
  let saidBack = false;
  addUpdater(() => {
    if (saidBack) return true;
    const p = ctx.playerPos();
    if (p.x > SEAT_R1 && Math.abs(p.z) < AISLE_HALF && !gotWheel) {
      saidBack = true;
      ctx.narrate(BACK_DOOR, 6500, { interruptible: true });
    }
    return false;
  });

  // Meter + finale.
  addUpdater((dt) => {
    bonus = Math.max(0, bonus - dt * 0.05);
    const goal = Math.min(1, acts.size / 3 + bonus);
    cheer += THREE.MathUtils.clamp(goal - cheer, -0.3 * dt, 0.6 * dt);
    meter.set(cheer);
    crowd.update(dt, cheer);
    spots.update(dt, ctx.playerPos());
    if (!finaleDone && acts.size >= 3 && cheer > 0.98) {
      finaleDone = true;
      drumroll(1.6);
      spots.follow('player', true);
      ctx.after(1700, () => {
        fanfare();
        clap(0.35);
        rewardPlinth(root, new THREE.Vector3(0, 0, 0));
        unicycle.position.set(0, 1.55, 0);
        unicycle.visible = true;
        spots.follow(unicycle.position, true);
        ctx.narrate(FINALE, 6000, { priority: true });
        wheelReady = true;
        curtain.open();
        ctx.removeObstacle(curtainBlock);
        solids.splice(solids.indexOf(curtainBlock), 1);
      });
    }
    if (wheelReady && !gotWheel) {
      unicycle.rotation.y += dt;
      const p = ctx.playerPos();
      if (Math.hypot(p.x, p.z) < 1.3 && !ctx.isAirborne()) {
        gotWheel = true;
        root.remove(unicycle);
        sparkle();
        ctx.setWheel(true);
        discover('reward:unicycle');
        spots.follow('player', true);
        ctx.narrate(GOT_WHEEL, 6000, { priority: true });
      }
    }
    return false;
  });

  ctx.narrate(INTRO, 7000);
}

// ── Set pieces ──────────────────────────────────────────────────────────────

function buildTent(root: THREE.Object3D): void {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(R + 0.5, 64),
    // polygonOffset so the sawdust wins over the coplanar white hub floor
    new THREE.MeshStandardMaterial({ color: 0x7a6440, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  floor.receiveShadow = true;
  root.add(floor);
  const ringFloor = new THREE.Mesh(
    new THREE.CircleGeometry(RING_R, 48),
    new THREE.MeshStandardMaterial({ color: 0xb48a52, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  ringFloor.rotation.x = -Math.PI / 2;
  ringFloor.position.y = 0.03;
  root.add(ringFloor);
  const curb = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.22, 8, 72), new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.6 }));
  curb.rotation.x = Math.PI / 2;
  curb.position.y = 0.15;
  root.add(curb);

  // The canvas, with two doorway gaps: the back door (+X, θ = π/2) and the
  // curtain (−Z, θ = π). Cylinder convention: x = r·sinθ, z = r·cosθ.
  const wallMat = new THREE.MeshStandardMaterial({ map: stripeTexture(14), side: THREE.BackSide, roughness: 0.95 });
  const GAP = Math.asin((DOOR_HALF + 0.1) / R);
  for (const [from, to] of [[Math.PI / 2 + GAP, Math.PI - GAP], [Math.PI + GAP, Math.PI * 2.5 - GAP]]) {
    const arc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, WALL_H, 64, 1, true, from, to - from), wallMat);
    arc.position.y = WALL_H / 2;
    root.add(arc);
  }
  // Lintels over the gaps, so the openings read as doors, not missing canvas.
  for (const [x, z, rotY] of [[R, 0, Math.PI / 2], [0, -R, 0]] as const) {
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_HALF * 2 + 0.6, WALL_H - DOOR_H, 0.1), wallMat);
    lintel.position.set(x, DOOR_H + (WALL_H - DOOR_H) / 2, z);
    lintel.rotation.y = rotY;
    root.add(lintel);
  }
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(R, PEAK_H - WALL_H, 72, 1, true),
    new THREE.MeshStandardMaterial({ map: stripeTexture(14), side: THREE.BackSide, roughness: 0.95 }),
  );
  roof.position.y = (WALL_H + PEAK_H) / 2;
  root.add(roof);

  // Bleachers: stepped blocks around the ring, the two aisles cut through.
  const seatGeo = new THREE.BoxGeometry(1, 1, 1);
  const seatMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
  const depth = (SEAT_R1 - SEAT_R0) / TIERS;
  const cells: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const q = new THREE.Quaternion();
  for (let t = 0; t < TIERS; t++) {
    const r = SEAT_R0 + depth * (t + 0.5);
    const h = TIER_H * (t + 1);
    const n = Math.round((Math.PI * 2 * r) / 1.4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (inAisle(x, z, 0.2)) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a);
      cells.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2, z), q, new THREE.Vector3((Math.PI * 2 * r) / n + 0.02, h, depth)));
      colors.push(new THREE.Color(t % 2 ? 0x5a2230 : 0x6e2a3a));
    }
  }
  const seats = new THREE.InstancedMesh(seatGeo, seatMat, cells.length);
  cells.forEach((m, i) => {
    seats.setMatrixAt(i, m);
    seats.setColorAt(i, colors[i]);
  });
  root.add(seats);

  // An EXIT sign over the back door.
  const sign = document.createElement('canvas');
  sign.width = 128;
  sign.height = 48;
  const sg = sign.getContext('2d')!;
  sg.fillStyle = '#0f3d1c';
  sg.fillRect(0, 0, 128, 48);
  sg.fillStyle = '#6dff8e';
  sg.font = `bold 34px ${FONT_SIGN}`;
  sg.textAlign = 'center';
  sg.textBaseline = 'middle';
  sg.fillText('EXIT', 64, 26);
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.34), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sign) }));
  exitSign.position.set(R - 0.12, DOOR_H + 0.4, 0);
  exitSign.rotation.y = -Math.PI / 2;
  root.add(exitSign);
}

// The cardboard crowd: flat cut-out people on every tier, facing the ring.
// They bob, clap harder the fuller the meter, and slump when you flop.
function buildCrowd(root: THREE.Object3D): { update: (dt: number, cheer: number) => void; cheer: (dir: number) => void } {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 96;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(32, 22, 15, 0, Math.PI * 2); // head
  g.fill();
  g.beginPath(); // shoulders + body
  g.moveTo(6, 96);
  g.quadraticCurveTo(6, 42, 32, 40);
  g.quadraticCurveTo(58, 42, 58, 96);
  g.fill();
  const mat = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  const rng = makeRng(17);
  const seats: { x: number; z: number; y: number; face: number; phase: number }[] = [];
  const depth = (SEAT_R1 - SEAT_R0) / TIERS;
  for (let t = 0; t < TIERS; t++) {
    const r = SEAT_R0 + depth * (t + 0.5);
    const n = Math.round((Math.PI * 2 * r) / 0.8);
    for (let i = 0; i < n; i++) {
      const a = ((i + rng() * 0.3) / n) * Math.PI * 2;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (inAisle(x, z, 0.4) || rng() < 0.12) continue; // aisles, and the odd empty seat
      seats.push({ x, z, y: TIER_H * (t + 1) + 0.5, face: Math.atan2(-x, -z), phase: rng() * 6 });
    }
  }
  const people = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.93), mat, seats.length);
  const shirts = [0xe0b44a, 0x4a86c8, 0xd0584a, 0x68a860, 0xb070c0, 0xe8e2d0, 0x3a3a48];
  seats.forEach((_, i) => people.setColorAt(i, new THREE.Color(shirts[Math.floor(rng() * shirts.length)])));
  root.add(people);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let t = 0;
  let burst = 0; // + a cheer, − a boo; fades
  return {
    cheer: (dir) => {
      burst = dir;
    },
    update: (dt, cheer) => {
      t += dt;
      burst -= Math.sign(burst) * Math.min(Math.abs(burst), dt * 0.5);
      const lift = 0.03 + cheer * 0.08 + Math.max(0, burst) * 0.2;
      const slump = Math.max(0, -burst) * 0.25;
      const speed = 4 + cheer * 6 + Math.max(0, burst) * 8;
      for (let i = 0; i < seats.length; i++) {
        const s = seats[i];
        pos.set(s.x, s.y + Math.abs(Math.sin(t * speed + s.phase)) * lift - slump, s.z);
        q.setFromAxisAngle(up, s.face);
        people.setMatrixAt(i, m.compose(pos, q, one));
      }
      people.instanceMatrix.needsUpdate = true;
    },
  };
}

// Strings of bulbs from the peak down to the top of the wall.
function buildBulbs(root: THREE.Object3D): void {
  const STRINGS = 16;
  const PER = 18;
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd98a }), STRINGS * PER);
  const m = new THREE.Matrix4();
  let i = 0;
  for (let s = 0; s < STRINGS; s++) {
    const a = (s / STRINGS) * Math.PI * 2;
    for (let k = 0; k < PER; k++) {
      const u = (k + 0.5) / PER;
      const r = u * (R - 0.6);
      const sag = Math.sin(u * Math.PI) * 0.9; // a little droop between the ends
      bulbs.setMatrixAt(i++, m.makeTranslation(Math.sin(a) * r, roofY(r) - 0.4 - sag, Math.cos(a) * r));
    }
  }
  bulbs.instanceMatrix.needsUpdate = true;
  root.add(bulbs);
}

// Three spotlight beams (additive cones, no real lights) hung from the roof,
// each with a pool of light on the floor. They sweep the ring, or follow you
// (or the clown car) during an act; at the finale they all find you.
function buildSpotlights(root: THREE.Object3D): {
  follow: (what: 'player' | THREE.Vector3 | null, all?: boolean) => void;
  update: (dt: number, player: THREE.Vector3) => void;
} {
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const cone = new THREE.ConeGeometry(1.5, 1, 24, 1, true);
  cone.translate(0, -0.5, 0); // apex at the origin, base at y = −1 (opening down −Y)
  const beams = [
    new THREE.Vector3(-9, roofY(9) - 0.5, 5),
    new THREE.Vector3(8, roofY(9) - 0.5, 6),
    new THREE.Vector3(1, roofY(9) - 0.5, -9),
  ].map((from, i) => {
    const pivot = new THREE.Object3D();
    pivot.position.copy(from);
    const beam = new THREE.Mesh(cone, beamMat);
    pivot.add(beam);
    root.add(pivot);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), poolMat);
    pool.rotation.x = -Math.PI / 2;
    root.add(pool);
    return { pivot, beam, pool, from, at: new THREE.Vector3(0, 0, 0), phase: i * 2.1 };
  });
  let following: 'player' | THREE.Vector3 | null = null;
  let all = false;
  let t = 0;
  const target = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  const dir = new THREE.Vector3();
  return {
    follow: (what, everyone = false) => {
      following = what;
      all = everyone;
    },
    update: (dt, player) => {
      t += dt;
      beams.forEach((b, i) => {
        const f = all || i === 0 ? following : null;
        const chasing = f !== null;
        if (f) target.copy(f === 'player' ? player : f).setY(0);
        else target.set(Math.sin(t * 0.4 + b.phase) * 6, 0, Math.cos(t * 0.33 + b.phase * 1.3) * 6);
        b.at.lerp(target, Math.min(1, dt * (chasing ? 5 : 1.5)));
        dir.subVectors(b.at, b.from);
        const len = dir.length();
        b.pivot.quaternion.setFromUnitVectors(down, dir.normalize());
        b.beam.scale.set(1, len, 1);
        b.pool.position.set(b.at.x, 0.05, b.at.z);
      });
    },
  };
}

// The APPLAUSE meter: a carnival thermometer at the ring's edge.
function buildMeter(root: THREE.Object3D): { set: (v: number) => void } {
  const g = new THREE.Group();
  g.position.copy(METER);
  const frame = new THREE.MeshStandardMaterial({ color: 0xe8c21e, roughness: 0.5, metalness: 0.3 });
  // Glass, so the red fill inside it shows.
  const tube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 3.6, 16, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xd8e8ff, roughness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  );
  tube.position.y = 2.4;
  g.add(tube);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff3b2e }));
  bulb.position.y = 0.6;
  g.add(bulb);
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1, 12), new THREE.MeshBasicMaterial({ color: 0xff3b2e }));
  g.add(fill);
  for (let k = 1; k <= 3; k++) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), frame);
    tick.position.set(0, 0.6 + 0.3 + (3.6 * k) / 3 - 0.05, 0.3);
    g.add(tick);
  }
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#c62828';
  c.fillRect(0, 0, 256, 64);
  c.fillStyle = '#ffe9a8';
  c.font = `bold 40px ${FONT_VOICE}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('APPLAUSE', 128, 34);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
  label.position.set(0, 4.6, 0);
  g.add(label);
  g.rotation.y = 0; // faces +Z, toward the ring and your start
  root.add(g);
  const BASE = 0.9;
  const SPAN = 3.4;
  return {
    set: (v) => {
      const h = Math.max(0.01, SPAN * v);
      fill.scale.y = h;
      fill.position.y = BASE + h / 2;
    },
  };
}

function buildCannon(root: THREE.Object3D): { yawGroup: THREE.Object3D; barrel: THREE.Object3D } {
  const red = new THREE.MeshStandardMaterial({ color: 0xb8231f, roughness: 0.5, metalness: 0.2 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe0b040, roughness: 0.4, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.7 });
  const yawGroup = new THREE.Group();
  yawGroup.position.copy(CANNON);
  root.add(yawGroup);
  for (const s of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.18, 20), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(s * 0.8, 0.75, 0);
    yawGroup.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.22, 12), gold);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(s * 0.8, 0.75, 0);
    yawGroup.add(hub);
  }
  const barrel = new THREE.Group();
  barrel.position.set(0, 1.0, 0);
  yawGroup.add(barrel);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 2.8, 20), red);
  tube.rotation.x = Math.PI / 2;
  tube.position.z = 0.4;
  barrel.add(tube);
  for (const z of [-0.6, 0.4, 1.5]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(z > 1 ? 0.5 : 0.56, 0.06, 8, 20), gold);
    band.position.z = z;
    barrel.add(band);
  }
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), dark);
  mouth.position.z = 1.81;
  barrel.add(mouth);
  // Rest aim: toward the net.
  yawGroup.rotation.y = Math.atan2(NET.x - CANNON.x, NET.z - CANNON.z);
  barrel.rotation.x = -0.7;
  return { yawGroup, barrel };
}

function buildNet(root: THREE.Object3D): void {
  const frame = new THREE.MeshStandardMaterial({ color: 0x8c8f99, roughness: 0.4, metalness: 0.6 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(NET_R, 0.1, 8, 40), frame);
  rim.rotation.x = Math.PI / 2;
  rim.position.copy(NET);
  root.add(rim);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.strokeStyle = '#f3ead3';
  g.lineWidth = 3;
  for (let k = 0; k <= 128; k += 16) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k, 128);
    g.moveTo(0, k);
    g.lineTo(128, k);
    g.stroke();
  }
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(NET_R, 32),
    new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.copy(NET).setY(NET.y - 0.05);
  root.add(mesh);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, NET.y, 6), frame);
    leg.position.set(NET.x + Math.cos(a) * NET_R, NET.y / 2, NET.z + Math.sin(a) * NET_R);
    root.add(leg);
  }
}

// The tightrope rig: stairs up to a platform, the wire, a platform at the far
// end. Returns its walkable regions (the wire is a slim floor).
function buildTightrope(root: THREE.Object3D): { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number }[] {
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.85, flatShading: true });
  const metal = new THREE.MeshStandardMaterial({ color: 0xcfd2da, roughness: 0.3, metalness: 0.8 });
  const regions: { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number }[] = [];
  const block = (minX: number, maxX: number, minZ: number, maxZ: number, top: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(maxX - minX, top, maxZ - minZ), wood);
    m.position.set((minX + maxX) / 2, top / 2, (minZ + maxZ) / 2);
    m.castShadow = true;
    root.add(m);
    regions.push({ minX, maxX, minZ, maxZ, floorY: top });
  };
  // Stairs up from the +Z side to the start platform.
  const steps = [0.5, 1.0, 1.5, 2.0];
  steps.forEach((h, k) => block(WIRE_X0 - 1.4, WIRE_X0 - 0.2, WIRE_Z + 3.0 - 0.6 * (k + 1), WIRE_Z + 3.0 - 0.6 * k, h));
  block(WIRE_X0 - 1.6, WIRE_X0, WIRE_Z - 0.8, WIRE_Z + 0.6, WIRE_Y); // start platform
  block(WIRE_X1, WIRE_X1 + 1.6, WIRE_Z - 0.8, WIRE_Z + 0.8, WIRE_Y); // far platform
  const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, WIRE_X1 - WIRE_X0, 6), metal);
  wire.rotation.z = Math.PI / 2;
  wire.position.set((WIRE_X0 + WIRE_X1) / 2, WIRE_Y, WIRE_Z);
  root.add(wire);
  regions.push({ minX: WIRE_X0 - 0.1, maxX: WIRE_X1 + 0.1, minZ: WIRE_Z - WIRE_HALF, maxZ: WIRE_Z + WIRE_HALF, floorY: WIRE_Y });
  return regions;
}

function buildClownCar(root: THREE.Object3D): { body: THREE.Object3D; door: THREE.Vector3; squash: number } {
  const g = new THREE.Group();
  g.position.copy(CLOWN_CAR);
  g.rotation.y = 0.5;
  root.add(g);
  const body = new THREE.Group();
  g.add(body);
  const paint = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 2.0), paint(0xf2c12e));
  shell.position.y = 0.6;
  body.add(shell);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 1.0), paint(0x3a9ad9));
  cab.position.set(0, 1.2, -0.1);
  body.add(cab);
  const dots = paint(0xe0382e);
  for (const [x, y, z] of [[0.66, 0.65, 0.4], [0.66, 0.55, -0.5], [-0.66, 0.6, 0.1], [0, 0.97, 0.7]] as const) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), dots);
    d.position.set(x, y, z);
    body.add(d);
  }
  const tyre = paint(0x1a1a1f);
  for (const [x, z] of [[-0.6, 0.65], [0.6, 0.65], [-0.6, -0.65], [0.6, -0.65]] as const) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 14), tyre);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.28, z);
    g.add(w);
  }
  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.4, 12, 1, true), paint(0xe0b040));
  horn.rotation.x = Math.PI / 2;
  horn.position.set(0.45, 1.1, 1.05);
  body.add(horn);
  const door = new THREE.Vector3(0.9, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5).add(CLOWN_CAR);
  return { body, door, squash: 0 };
}

// A clown: the jointed dummy, painted up — red nose, a wig, a bright suit.
function makeClown(i: number): THREE.Object3D {
  const g = createAsset('dummy') as THREE.Group;
  g.scale.setScalar(0.72);
  const suit = [0xe0382e, 0x3a9ad9, 0x68c860, 0xf2c12e, 0xb070c0][i % 5];
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = new THREE.MeshStandardMaterial({ color: o.parent?.name?.startsWith('leg') ? 0x2b2b3a : suit, roughness: 0.7 });
  });
  const head = g.getObjectByName('head') as THREE.Mesh;
  head.material = new THREE.MeshStandardMaterial({ color: 0xf6efe6, roughness: 0.6 });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff2020, roughness: 0.4 }));
  nose.position.set(0, 0, 0.16);
  head.add(nose);
  const wig = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: [0xff7a1a, 0x2ad0ff, 0x9a3cff][i % 3], roughness: 1, flatShading: true }));
  wig.scale.set(1.5, 0.8, 1.2);
  wig.position.y = 0.12;
  head.add(wig);
  return g;
}

function buildCurtain(root: THREE.Object3D): { open: () => void } {
  const velvet = new THREE.MeshStandardMaterial({ color: 0x8e1020, roughness: 0.9, side: THREE.DoubleSide });
  const halves = [-1, 1].map((s) => {
    const h = new THREE.Mesh(new THREE.BoxGeometry(1.7, 4.4, 0.12), velvet);
    h.position.set(s * 0.85, 2.2, -(R - 0.3));
    root.add(h);
    return { h, s };
  });
  const valance = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.6, 0.2), new THREE.MeshStandardMaterial({ color: 0xe0b040, roughness: 0.5, metalness: 0.4 }));
  valance.position.set(0, 4.5, -(R - 0.32));
  root.add(valance);
  return {
    open: () => {
      pop();
      let t = 0;
      addUpdater((dt) => {
        t = Math.min(1, t + dt / 1.2);
        const e = 1 - Math.pow(1 - t, 3);
        for (const { h, s } of halves) {
          h.position.x = s * (0.85 + 1.5 * e);
          h.scale.x = 1 - 0.5 * e; // bunched up at the sides
        }
        return t >= 1;
      });
    },
  };
}

function makeUnicycle(): THREE.Group {
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
  return unicycle;
}
