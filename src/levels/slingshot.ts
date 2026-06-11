import * as THREE from 'three';
import type { GameContext, ControlMode } from '../game/types';
import { addUpdater } from '../experiences/scheduler';
import { createAsset, trainStrike } from '../assets';
import { groundPlane, hideRoomShell, walkThroughPortal } from './scaffold';
import { registerInteractable } from '../interactables/system';
import { whoosh, thunder, trainHorn, pop, thud, click } from '../audio/sfx';
import { defineCombine } from '../game/combine';
import { setYaw, setPitch } from '../controls/player-camera';
import {
  getSling,
  setSlingActive,
  setSlingDir,
  openWood,
  openStone,
  dirOpen,
  type SlingDir,
} from './slingshot-state';

// THE TRAINYARD CROSSROADS. A rotating train-slingshot in the centre feeds trains
// down whichever of four tunnels it's aimed at — and that setup is GLOBAL, so it
// governs the connected levels (the 2-track tunnel is the tunnel level: aim there
// + power on = that level has trains; aim away / power off = it's safe).
//   N  2 tracks — open  (the tunnel level)
//   E  4 tracks — steel beams (no tool yet: blocked for now)
//   S  1 track  — wooden beam (break with the axe)
//   W  3 tracks — stone bricks (break with the pickaxe)
// Walk up to the rig and OPERATE it: A/D aim, E toggles power, S steps off.

// Combine recipes are global; these hooks are wired by the live level.
let breakWood: (() => void) | null = null;
let breakStone: (() => void) | null = null;
defineCombine('axe', 'wood-block', () => {
  breakWood?.();
  return true; // keep the axe
});
defineCombine('pickaxe', 'stone-block', () => {
  breakStone?.();
  return true; // keep the pickaxe
});

interface Dir {
  key: SlingDir;
  vec: THREE.Vector3;
  tracks: number;
  block: 'wood' | 'stone' | 'steel' | null;
}
// Compass order (used for A/D cycling): N, E, S, W.
const DIRS: Dir[] = [
  { key: 'tunnel', vec: new THREE.Vector3(0, 0, -1), tracks: 2, block: null },
  { key: 'steel', vec: new THREE.Vector3(1, 0, 0), tracks: 4, block: 'steel' },
  { key: 'wood', vec: new THREE.Vector3(0, 0, 1), tracks: 1, block: 'wood' },
  { key: 'stone', vec: new THREE.Vector3(-1, 0, 0), tracks: 3, block: 'stone' },
];
const MOUTH = 28; // tunnel-mouth distance from centre
const TRACK_END = 7; // tracks stop this far short of the centre

function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return m;
}

export function revealSlingshot(ctx: GameContext): void {
  const root = ctx.levelRoot;

  root.add(groundPlane());
  ctx.scene.background = new THREE.Color(0x1b212d);
  ctx.scene.fog = new THREE.Fog(0x1b212d, 36, 170);
  root.add(new THREE.HemisphereLight(0xaebfd6, 0x33352c, 1.0));
  root.add(new THREE.AmbientLight(0xffffff, 0.4));
  const moon = new THREE.DirectionalLight(0xeaf0fb, 0.85);
  moon.position.set(14, 26, 8);
  root.add(moon);

  ctx.openRoom();
  hideRoomShell(ctx); // drop the hub's white shell so it doesn't z-fight the gravel

  // ── Materials (block barriers; tracks + tunnel faces are shared assets) ──
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.95, flatShading: true });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8f97, roughness: 1, flatShading: true });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x6a6f78, roughness: 0.4, metalness: 0.8, flatShading: true });

  // ── Build each of the four tunnels ──
  const SP = 2.0; // spacing between parallel lanes
  for (const d of DIRS) {
    const dir = d.vec;
    const isZ = dir.z !== 0;
    const sign = isZ ? dir.z : dir.x;
    const perp = new THREE.Vector3(dir.z, 0, -dir.x); // 90° in the ground plane
    const span = (d.tracks - 1) * SP;
    const openHalf = span / 2 + 1.8; // tunnel mouth fits all the lanes
    const half = openHalf; // the block spans the opening

    // Tracks — one 2-rail spline track per lane, from near the centre out
    // through the mouth (the SAME shared 'track' asset the tunnel level uses).
    for (let i = 0; i < d.tracks; i++) {
      const off = (i - (d.tracks - 1) / 2) * SP;
      const start = dir.clone().multiplyScalar(TRACK_END).addScaledVector(perp, off);
      const end = dir.clone().multiplyScalar(MOUTH + 5).addScaledVector(perp, off);
      root.add(createAsset('track', { path: [start, end] }));
    }

    // Arched rock tunnel face at the mouth, opening toward the centre (the SAME
    // 'tunnel-face' asset as the tunnel level — four of them wall in the yard).
    const face = createAsset('tunnel-face', { half: 30, openHalf, wallH: 13 });
    face.position.copy(dir).multiplyScalar(MOUTH);
    face.rotation.y = Math.atan2(-dir.x, -dir.z);
    root.add(face);

    // ── Block ──
    if (d.block) {
      const bz = (MOUTH - 1.5) * sign;
      const blockGroup = new THREE.Group();
      blockGroup.position.set(isZ ? 0 : bz, 0, isZ ? bz : 0);
      root.add(blockGroup);
      if (d.block === 'wood') {
        for (let k = 0; k < 3; k++) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(isZ ? half * 2 : 0.4, 0.5, isZ ? 0.4 : half * 2), woodMat);
          beam.position.y = 1 + k * 1.1;
          blockGroup.add(beam);
        }
      } else if (d.block === 'stone') {
        for (let r = 0; r < 5; r++)
          for (let c = 0; c < d.tracks + 2; c++) {
            const brick = new THREE.Mesh(new THREE.BoxGeometry(isZ ? 0.78 : 0.4, 0.5, isZ ? 0.4 : 0.78), stoneMat);
            const o = (c - (d.tracks + 1) / 2) * 0.82 + (r % 2) * 0.4;
            brick.position.set(isZ ? o : 0, 0.3 + r * 0.55, isZ ? 0 : o);
            blockGroup.add(brick);
          }
      } else {
        for (let k = 0; k < 4; k++) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(isZ ? half * 2 : 0.45, 0.45, isZ ? 0.45 : half * 2), steelMat);
          beam.position.y = 0.8 + k * 1.3;
          blockGroup.add(beam);
        }
        for (const s of [-1, 1]) {
          const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), steelMat);
          col.position.set(isZ ? s * (half - 0.3) : 0, 3, isZ ? 0 : s * (half - 0.3));
          blockGroup.add(col);
        }
      }
      // wood + stone are breakable with the matching tool
      if (d.block === 'wood' || d.block === 'stone') {
        const targetKind = d.block === 'wood' ? 'wood-block' : 'stone-block';
        const target = { kind: targetKind, position: blockGroup.position.clone(), radius: 4.5 };
        ctx.addTarget(target);
        const clear = () => {
          root.remove(blockGroup);
          ctx.removeTarget(target);
          pop();
          thunder();
          if (d.block === 'wood') {
            openWood();
            ctx.narrate('The beam splinters. One more tunnel, open to whatever it is the tunnels here do to people.', 4500, { priority: true });
          } else {
            openStone();
            ctx.narrate('The bricks cave in. Behind them, more dark — every bit as inviting as the last.', 4500, { priority: true });
          }
        };
        if (d.block === 'wood') breakWood = clear;
        else breakStone = clear;
      }
    }
  }

  // ── Central rotating turret (the slingshot) ──
  const turret = new THREE.Group();
  root.add(turret);
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.5, metalness: 0.6, flatShading: true });
  const forkMat = new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.95, flatShading: true });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x7a1414, roughness: 0.7 });
  const turntable = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 0.6, 20), ironMat);
  turntable.position.y = 0.3;
  turret.add(turntable);
  // fork aims toward +Z in local space (so turret.rotation.y faces the dir)
  const tip = (s: number) => new THREE.Vector3(s * 2.2, 6.4, 1.5);
  const pouch = new THREE.Vector3(0, 3.4, -1.5);
  for (const s of [-1, 1]) {
    turret.add(strut(new THREE.Vector3(s * 0.7, 0.6, 1.5), tip(s), 0.26, forkMat));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), ironMat);
    cap.position.copy(tip(s));
    turret.add(cap);
    turret.add(strut(tip(s), pouch, 0.08, bandMat));
  }
  const loaded = createAsset('train');
  loaded.scale.setScalar(0.42);
  loaded.position.copy(pouch);
  turret.add(loaded); // sits in the pouch, always pointing out the barrel

  // ── Turret faces the global direction (eased); auto-fires when powered ──
  const dirOf = (key: SlingDir) => DIRS.find((d) => d.key === key)!.vec;
  let curYaw = Math.atan2(dirOf(getSling().direction).x, dirOf(getSling().direction).z);
  let phase: 'wait' | 'fly' | 'jammed' = 'wait';
  let timer = 1.5;
  let flyer: THREE.Object3D | null = null;
  let flyVel = 0;
  let flyDir = new THREE.Vector3();
  let fireDir: SlingDir = getSling().direction; // the dir the current train is headed
  let parked: THREE.Object3D | null = null; // a train halted at a block
  let parkedDir: SlingDir | null = null;
  const STOP_AT = MOUTH - 3.2; // halt a train-length short of the barrier
  addUpdater((dt) => {
    // ease the turret toward the current global aim
    const tgt = Math.atan2(dirOf(getSling().direction).x, dirOf(getSling().direction).z);
    let dyaw = tgt - curYaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    curYaw += dyaw * Math.min(1, dt * 5);
    turret.rotation.y = curYaw;
    loaded.visible = getSling().active;

    if (phase === 'wait') {
      timer -= dt;
      if (timer <= 0) {
        const s = getSling();
        if (s.active) {
          // fire a train down WHATEVER it's aimed at — even a blocked tunnel.
          fireDir = s.direction;
          flyDir = dirOf(fireDir).clone();
          flyer = createAsset('train');
          flyer.scale.setScalar(0.42);
          flyer.position.set(flyDir.x * 4, 3.2, flyDir.z * 4);
          flyer.rotation.y = Math.atan2(flyDir.x, flyDir.z);
          root.add(flyer);
          flyVel = 8;
          phase = 'fly';
          whoosh();
          trainHorn();
        } else {
          timer = 0.8;
        }
      }
    } else if (phase === 'fly' && flyer) {
      flyVel += 40 * dt;
      flyer.position.addScaledVector(flyDir, flyVel * dt);
      flyer.position.y += (0.45 - flyer.position.y) * Math.min(1, dt * 3);
      // Shared train behaviour: a flying train flattens you, or knocks you back
      // if you're holding a duck.
      trainStrike(ctx, flyer.position, new THREE.Vector3(flyDir.x * 13, 16, flyDir.z * 13));
      const reach = flyer.position.length();
      if (!dirOpen(fireDir) && reach >= STOP_AT) {
        // blocked tunnel: the train slams to a halt at the barrier and sits there
        flyer.position.set(flyDir.x * STOP_AT, 0.45, flyDir.z * STOP_AT);
        flyer.rotation.z = 0;
        thud();
        if (parked) root.remove(parked); // only one stuck train at a time
        parked = flyer;
        parkedDir = fireDir;
        flyer = null;
        phase = 'jammed';
      } else if (reach >= MOUTH - 1) {
        // open tunnel: through and gone
        root.remove(flyer);
        flyer = null;
        phase = 'wait';
        timer = 1.6;
      }
    } else if (phase === 'jammed') {
      // the stuck train clears once you re-aim or the block is broken open
      const s = getSling();
      if (parkedDir === null || s.direction !== parkedDir || dirOpen(parkedDir)) {
        if (parked) root.remove(parked);
        parked = null;
        parkedDir = null;
        phase = 'wait';
        timer = 0.5;
      }
    }
    return false;
  });

  // ── A lever on the turret base (toggles power) ──
  const leverPivot = new THREE.Group();
  leverPivot.position.set(2.4, 0.6, 0);
  turret.add(leverPivot);
  const leverArm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.4, 8), ironMat);
  leverArm.position.y = 0.7;
  leverPivot.add(leverArm);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), bandMat);
  knob.position.y = 1.4;
  leverPivot.add(knob);
  const setLeverVisual = () => {
    leverPivot.rotation.z = getSling().active ? -0.5 : 0.6;
  };
  setLeverVisual();

  // ── Operate: a console you walk up to, then a camera-locked control mode ──
  let aimIdx = DIRS.findIndex((d) => d.key === getSling().direction);
  const enterPos = new THREE.Vector3();
  let enterYaw = 0;
  let prevX = 0;

  const control: ControlMode = {
    update(_dt, input) {
      if (input.moveX > 0.5 && prevX <= 0.5) {
        aimIdx = (aimIdx + 1) % 4;
        setSlingDir(DIRS[aimIdx].key);
      } else if (input.moveX < -0.5 && prevX >= -0.5) {
        aimIdx = (aimIdx + 3) % 4;
        setSlingDir(DIRS[aimIdx].key);
      }
      prevX = input.moveX;
      if (input.moveY > 0.5) {
        exitControl(); // S / back = step off
        return;
      }
      const fx = Math.sin(curYaw);
      const fz = Math.cos(curYaw);
      ctx.camera.position.set(-fx * 10, 7, -fz * 10);
      ctx.camera.lookAt(fx * 16, 2.5, fz * 16);
    },
    onInteract() {
      setSlingActive(!getSling().active);
      setLeverVisual();
      click();
    },
  };
  const exitControl = () => {
    ctx.setControlMode(null);
    ctx.camera.position.copy(enterPos);
    setYaw(enterYaw);
    setPitch(0);
    ctx.camera.rotation.set(0, enterYaw, 0, 'YXZ');
  };

  const consolePos = new THREE.Vector3(4.2, 0, 4.2);
  const console3D = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.1, 0.7), ironMat);
  console3D.position.set(consolePos.x, 0.55, consolePos.z);
  console3D.rotation.y = -Math.PI / 4;
  root.add(console3D);
  ctx.addObstacle({ x: consolePos.x, z: consolePos.z, radius: 0.6 });
  registerInteractable({
    id: 'sling-operate',
    position: consolePos.clone(),
    radius: 2.4,
    promptLabel: 'OPERATE',
    labelOffsetY: 1.4,
    onUse() {
      enterPos.copy(ctx.camera.position);
      enterYaw = 0;
      aimIdx = DIRS.findIndex((d) => d.key === getSling().direction);
      prevX = 0;
      ctx.setControlMode(control);
      ctx.narrate('Fine. You take the controls — A and D to aim, E for power, S to step off. I did say I would stay quiet. Consider this the exception, not the habit.', 6500, { priority: true });
    },
  });

  // No exit button: the yard is tunnel-only (weight 0) — you walk in from the
  // tunnel and the only way out is walking back down it.
  ctx.setRegions([{ minX: -34, maxX: 34, minZ: -34, maxZ: 34, floorY: 0 }]);

  // Arriving from the tunnel level: step OUT of the −Z (2-track) tunnel mouth
  // into the yard, facing in (+Z), so it reads as one continuous passage.
  if (ctx.entry === 'tunnel') {
    ctx.spawnAt(new THREE.Vector3(0, 0, -(MOUTH - 3)), Math.PI);
  }

  // Walk into the 2-track tunnel (the −Z one) and you pass through to the tunnel
  // level — it's the same tunnel, entered from the slingshot end.
  walkThroughPortal(ctx, {
    zone: (p) => p.z < -(MOUTH + 2) && Math.abs(p.x) < 2.6,
    to: 'tunnel',
    ref: new THREE.Vector3(0, 0, -(MOUTH + 44)),
    entry: 'slingshot',
  });

  ctx.narrate(
    'A crossroads. Four tunnels run off into the dark, and at their centre, a machine — aimed at something, and waiting. The narrator knows exactly what it does. The narrator says nothing.',
    8000,
  );
}
