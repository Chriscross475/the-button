import * as THREE from 'three';
import type { Interactable } from '../interactables/types';
import type { Obstacle } from '../controls/player-camera';
import { registerInteractable } from '../interactables/system';
import { addUpdater } from '../experiences/scheduler';
import { click } from '../audio/sfx';

// A small plinth with a single big red button on top. Walk up, face it, press.
// The button dome springs down on press and eases back; the red glow pulses
// gently so it reads as "the thing to interact with" in the empty room.

let nextId = 0;

export interface SpawnedButton {
  group: THREE.Group;
  interactable: Interactable;
  obstacle: Obstacle;
}

export interface ButtonOpts {
  /** Glowing red shine + halo light + emissive pulse (default true). Pass false
   *  for a plain matte button (e.g. the end-room button). */
  glow?: boolean;
}

export function spawnPedestalButton(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  onPress: () => void,
  opts: ButtonOpts = {},
): SpawnedButton {
  const shine = opts.glow ?? true;
  const group = new THREE.Group();
  group.position.copy(pos);
  parent.add(group);

  const stone = new THREE.MeshStandardMaterial({ color: 0xd2d2cc, roughness: 0.85, metalness: 0.05 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.4, metalness: 0.7 });
  const red = new THREE.MeshStandardMaterial({
    color: 0xcc1414,
    roughness: 0.45,
    metalness: 0.1,
    emissive: 0xff2a00,
    emissiveIntensity: shine ? 0.45 : 0,
  });

  // Plinth: base + column + cap.
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.72), stone);
  base.position.y = 0.08;
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.46), stone);
  column.position.y = 0.5;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.62), stone);
  cap.position.y = 0.9;
  for (const m of [base, column, cap]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // Button housing (dark ring) + the red dome that depresses.
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.09, 24), metal);
  housing.position.y = 0.99;
  housing.castShadow = true;
  group.add(housing);

  const dome = new THREE.Group();
  dome.position.y = 1.03;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.07, 24), red);
  const cupola = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), red);
  cupolaFlatten(cupola);
  cupola.position.y = 0.035;
  body.castShadow = true;
  dome.add(body, cupola);
  group.add(dome);

  // A faint red point light so the button glows on the plinth (shine only).
  const glow = shine ? new THREE.PointLight(0xff3300, 0.6, 2.2, 2) : null;
  if (glow) {
    glow.position.y = 1.15;
    group.add(glow);
  }

  const domeRestY = dome.position.y;
  let pressT = 0; // 1 right after a press, decays to 0
  let pulse = 0;

  const interactable: Interactable = {
    id: `button-${nextId++}`,
    position: pos.clone(),
    radius: 1.8,
    promptLabel: 'PRESS',
    labelOffsetY: 1.35,
    onUse() {
      pressT = 1;
      click();
      onPress();
    },
    tick(dt: number) {
      // Press spring.
      if (pressT > 0) pressT = Math.max(0, pressT - dt * 4.5);
      dome.position.y = domeRestY - pressT * 0.05;
      // Idle glow pulse — only on shining buttons.
      if (shine) {
        pulse += dt;
        const e = 0.4 + 0.18 * (0.5 + 0.5 * Math.sin(pulse * 2.2));
        red.emissiveIntensity = e + pressT * 0.6;
        if (glow) glow.intensity = 0.5 + 0.25 * (0.5 + 0.5 * Math.sin(pulse * 2.2)) + pressT * 0.8;
      }
    },
    built: { group },
  };
  registerInteractable(interactable);

  return {
    group,
    interactable,
    obstacle: { x: pos.x, z: pos.z, radius: 0.5 },
  };
}

// Flatten a half-sphere into a low dome cap.
function cupolaFlatten(mesh: THREE.Mesh): void {
  mesh.scale.y = 0.4;
}

// Slide the whole pedestal+button down through the floor until it's hidden, and
// make it inert. Used when a press "opens" the room into a level.
export function sinkPedestalButton(spawned: SpawnedButton): void {
  spawned.interactable.promptLabel = '';
  const g = spawned.group;
  const startY = g.position.y;
  let t = 0;
  const dur = 1.0;
  addUpdater((dt) => {
    t += dt;
    const k = Math.min(1, t / dur);
    const e = 1 - Math.pow(1 - k, 3);
    g.position.y = startY - e * 1.8; // below the floor plane
    return k >= 1;
  });
}
