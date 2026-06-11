import * as THREE from 'three';
import { defineAsset } from './registry';

// THE TRAIN — geometry + its shared behaviour. A train flattens the player on
// contact, or, if they're clutching a duck, knocks them clear instead (the duck
// is consumed). That rule is the same everywhere a train runs — the tunnel level
// and the slingshot crossroads — so it lives HERE with the train, not copied
// into each level.

// A chunky low-poly locomotive, nose at +Z (callers rotate it for direction).
// Reusable on any map via createAsset('train'); behaviour is trainStrike below.
// NB: no per-train PointLight — adding a dynamic light per spawn forces a
// scene-wide shader recompile (a hitch each time a train appears, brutal on
// mobile). The headlamp + warning stripes are self-lit (MeshBasicMaterial), and
// levels already flash their own storm light when a train spawns.
function makeTrain(): THREE.Group {
  const g = new THREE.Group();
  const flat = (color: number, opts: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.35, flatShading: true, ...opts });
  const body = flat(0x24262e);
  const dark = flat(0x131318, { metalness: 0.2 });
  const red = flat(0x7a1414, { metalness: 0.15 });
  const brass = flat(0xb8862b, { metalness: 0.6, roughness: 0.4 });
  const glowLamp = new THREE.MeshBasicMaterial({ color: 0xfff0c2 }); // self-lit headlamp
  const glowRed = new THREE.MeshBasicMaterial({ color: 0xff3b14 }); // self-lit warning
  const glowWin = new THREE.MeshBasicMaterial({ color: 0xffd27a }); // lit cab windows

  // Chassis / running board.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.45, 4.2), dark);
  frame.position.y = 0.6;
  frame.castShadow = true;
  g.add(frame);

  // Boiler — a cylinder lying along Z.
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 2.9, 16), body);
  boiler.rotation.x = Math.PI / 2;
  boiler.position.set(0, 1.3, 0.45);
  boiler.castShadow = true;
  g.add(boiler);
  // Boiler bands (brass rings).
  for (const bz of [-0.5, 0.45, 1.4]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 8, 18), brass);
    ring.position.set(0, 1.3, bz);
    g.add(ring);
  }

  // Smoke-box front + headlamp.
  const front = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.22, 16), dark);
  front.rotation.x = Math.PI / 2;
  front.position.set(0, 1.3, 1.95);
  g.add(front);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.16, 12), glowLamp);
  lamp.rotation.x = Math.PI / 2;
  lamp.position.set(0, 1.55, 2.05);
  g.add(lamp);

  // Smokestack.
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.7, 12), dark);
  stack.position.set(0, 2.15, 1.05);
  g.add(stack);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.24, 0.18, 12), dark);
  cap.position.set(0, 2.52, 1.05);
  g.add(cap);

  // Cab at the back, with lit windows.
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.66, 1.5, 1.4), body);
  cab.position.set(0, 1.7, -1.45);
  cab.castShadow = true;
  g.add(cab);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.16, 1.6), dark);
  roof.position.set(0, 2.5, -1.45);
  g.add(roof);
  for (const sx of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.6), glowWin);
    win.position.set(sx * 0.84, 1.95, -1.35);
    g.add(win);
  }

  // Cowcatcher — an angled wedge at the nose.
  const catcher = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.9, 4), red);
  catcher.rotation.x = Math.PI / 2;
  catcher.rotation.y = Math.PI / 4;
  catcher.position.set(0, 0.5, 2.35);
  g.add(catcher);

  // Red warning stripes down each flank (self-lit so they read as "danger").
  for (const sx of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 3.6), glowRed);
    stripe.position.set(sx * 0.86, 0.92, 0.1);
    g.add(stripe);
  }

  // Wheels — four per side.
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.16, 14);
  for (const sx of [-1, 1]) {
    for (const wz of [-1.5, -0.55, 0.5, 1.45]) {
      const w = new THREE.Mesh(wheelGeo, dark);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * 0.82, 0.42, wz);
      g.add(w);
    }
  }
  return g;
}

defineAsset('train', makeTrain);

// The minimal slice of GameContext a strike needs (GameContext satisfies it).
interface TrainCtx {
  playerPos(): THREE.Vector3;
  isAirborne(): boolean;
  isDead(): boolean;
  /** A held shield (duck/basketball) cushions the hit; the object decides whether
   *  it's spent (duck → feathers) or kept (basketball). True = shielded. */
  useTrainShield(): boolean;
  launchPlayer(vel: THREE.Vector3): void;
  die(cause?: string): void;
}

/** If a train at `pos` is on top of the player, hit them: a held shield (a duck
 *  in hand bursts into feathers; a basketball just cushions and stays) knocks
 *  them clear with `knockback`; otherwise it flattens them. Returns true if it
 *  connected, so callers can set a hit cooldown. */
export function trainStrike(ctx: TrainCtx, pos: THREE.Vector3, knockback: THREE.Vector3): boolean {
  if (ctx.isAirborne() || ctx.isDead()) return false;
  const p = ctx.playerPos();
  if (Math.abs(p.x - pos.x) >= 1.6 || Math.abs(p.z - pos.z) >= 1.9) return false;
  if (ctx.useTrainShield()) {
    ctx.launchPlayer(knockback.clone());
  } else {
    ctx.die('train');
  }
  return true;
}
