import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { pop } from '../audio/sfx';

// THE UV TORCH — a persistent tool (found in the escape room) that reveals UV
// ink: hidden writing any level can add with uvInk(mesh). Held, it points where
// you look and throws a violet beam; ink shows only where the beam falls
// (fading in toward the beam's centre, and with distance). Let go of it and
// all ink is hidden again.

const REACH = 9; // metres the beam reveals to
const INNER = Math.cos(0.12); // full strength inside this angle off-centre…
const OUTER = Math.cos(0.3); // …none outside this one

const inks = new Set<THREE.Object3D>();
const inScene = (o: THREE.Object3D) => {
  let c: THREE.Object3D = o;
  while (c.parent) c = c.parent;
  return c.type === 'Scene';
};
const setOpacity = (o: THREE.Object3D, a: number) =>
  o.traverse((m) => {
    if (m instanceof THREE.Mesh) (m.material as THREE.Material).opacity = a;
  });

/** Make `o` UV ink: hidden, until the held torch's beam falls on it.
 *  `strength` is its full opacity. Its materials become transparent. */
export function uvInk(o: THREE.Object3D, strength = 0.95): void {
  o.visible = false;
  o.userData.uvStrength = strength;
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    const mat = m.material as THREE.Material;
    mat.transparent = true;
    mat.depthWrite = false;
  });
  inks.add(o);
}

const at = new THREE.Vector3();
const to = new THREE.Vector3();
function lightInks(eye: THREE.Vector3, forward: THREE.Vector3): void {
  for (const ink of inks) {
    if (!inScene(ink)) {
      inks.delete(ink); // its level is gone
      continue;
    }
    ink.getWorldPosition(at);
    to.subVectors(at, eye);
    const d = to.length();
    const c = d > 1e-3 ? to.divideScalar(d).dot(forward) : 1;
    const k = d > REACH ? 0 : THREE.MathUtils.smoothstep(c, OUTER, INNER) * (1 - (d / REACH) * 0.35);
    ink.visible = k > 0.02;
    if (ink.visible) setOpacity(ink, (ink.userData.uvStrength as number) * k);
  }
}
function hideInks(): void {
  for (const ink of inks) ink.visible = false;
}

/** The torch model, pointing along −Z (lens forward). */
function makeTorch(): { g: THREE.Group; beam: THREE.Mesh } {
  const g = new THREE.Group();
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.8 });
  const alu = new THREE.MeshStandardMaterial({ color: 0x5a3a8a, roughness: 0.35, metalness: 0.7 });
  const along = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = Math.PI / 2;
    m.position.z = z;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  along(new THREE.CylinderGeometry(0.028, 0.03, 0.18, 12), rubber, 0.06); // grip
  for (const z of [0.0, 0.04, 0.08, 0.12]) along(new THREE.TorusGeometry(0.031, 0.004, 6, 14), rubber, z).rotation.x = 0; // grip rings
  along(new THREE.CylinderGeometry(0.045, 0.032, 0.07, 14), alu, -0.06); // flared head
  along(new THREE.CylinderGeometry(0.047, 0.047, 0.025, 14), alu, -0.105); // bezel
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.04, 18), new THREE.MeshBasicMaterial({ color: 0xb46bff }));
  lens.rotation.y = Math.PI; // faces −Z
  lens.position.z = -0.119;
  g.add(lens);
  const button = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.03), new THREE.MeshStandardMaterial({ color: 0xb46bff, roughness: 0.5 }));
  button.position.set(0, 0.031, 0.02);
  g.add(button);
  // The beam: an open violet cone from the lens, only while it's in hand.
  const cone = new THREE.ConeGeometry(0.9, 5, 24, 1, true);
  cone.translate(0, -2.5, 0); // apex at the origin, opening down −Y…
  cone.rotateX(Math.PI / 2); // …turned to open along −Z
  const beam = new THREE.Mesh(
    cone,
    new THREE.MeshBasicMaterial({ color: 0x9a4dff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.z = -0.12;
  beam.visible = false;
  g.add(beam);
  return { g, beam };
}

/** Put the UV torch into the level at `pos`. */
export function spawnUvTorch(ctx: GameContext, pos: THREE.Vector3, opts: { rotY?: number; onGrab?: () => void } = {}): Carryable {
  const { g, beam } = makeTorch();
  g.position.copy(pos);
  g.rotation.y = opts.rotY ?? 0;
  ctx.levelRoot.add(g);
  const carry: Carryable = {
    kind: 'uv-torch',
    object: g,
    persistent: true, // a tool: it comes with you
    heldDist: 0.5,
    heldRight: 0.28,
    heldDrop: 0.3,
    heldUpdate: (_dt, o, camQuat, forward) => {
      o.quaternion.copy(camQuat); // points where you look
      lightInks(ctx.camera.position, forward);
    },
    onGrab: () => {
      beam.visible = true;
      pop();
      opts.onGrab?.();
    },
    onRelease: () => {
      beam.visible = false;
      hideInks();
    },
  };
  ctx.addCarryable(carry);
  return carry;
}
