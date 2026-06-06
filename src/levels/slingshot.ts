import * as THREE from 'three';
import type { GameContext, ControlMode } from '../game/types';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { spawnPedestalButton } from '../button/pedestal-button';
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

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    // polygonOffset so this dark gravel wins the depth test over the coplanar
    // white hub floor (which openRoom leaves at y=0) — no z-fighting flicker.
    new THREE.MeshStandardMaterial({
      color: 0x3a3d33,
      roughness: 1,
      flatShading: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.01;
  ground.receiveShadow = true;
  root.add(ground);
  ctx.scene.background = new THREE.Color(0x1b212d);
  ctx.scene.fog = new THREE.Fog(0x1b212d, 36, 170);
  root.add(new THREE.HemisphereLight(0xaebfd6, 0x33352c, 1.0));
  root.add(new THREE.AmbientLight(0xffffff, 0.4));
  const moon = new THREE.DirectionalLight(0xeaf0fb, 0.85);
  moon.position.set(14, 26, 8);
  root.add(moon);

  ctx.openRoom();

  // ── Materials ──
  const railMat = new THREE.MeshStandardMaterial({ color: 0x4b4f57, roughness: 0.6, metalness: 0.5 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 1, flatShading: true });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x474b54, roughness: 1, flatShading: true });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.95, flatShading: true });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8f97, roughness: 1, flatShading: true });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x6a6f78, roughness: 0.4, metalness: 0.8, flatShading: true });

  // ── Build each of the four tunnels ──
  for (const d of DIRS) {
    const isZ = d.vec.z !== 0;
    const sign = isZ ? d.vec.z : d.vec.x;
    const half = d.tracks * 0.7 + 0.7;
    const runMid = ((TRACK_END + MOUTH) / 2) * sign;
    const runLen = MOUTH - TRACK_END;
    // rails
    for (let i = 0; i < d.tracks; i++) {
      const off = (i - (d.tracks - 1) / 2) * 1.4;
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(isZ ? 0.12 : runLen, 0.12, isZ ? runLen : 0.12),
        railMat,
      );
      rail.position.set(isZ ? off : runMid, 0.16, isZ ? runMid : off);
      root.add(rail);
    }
    // ties
    for (let t = TRACK_END; t <= MOUTH; t += 1.8) {
      const tie = new THREE.Mesh(new THREE.BoxGeometry(isZ ? half * 2 : 0.3, 0.1, isZ ? 0.3 : half * 2), tieMat);
      tie.position.set(isZ ? 0 : t * sign, 0.05, isZ ? t * sign : 0);
      root.add(tie);
    }
    // mouth arch
    const mz = MOUTH * sign;
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(1.1, 7, 1.1), mouthMat);
      post.position.set(isZ ? s * (half + 0.6) : mz, 3.5, isZ ? mz : s * (half + 0.6));
      root.add(post);
    }
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(isZ ? half * 2 + 2.2 : 1.3, 1.3, isZ ? 1.3 : half * 2 + 2.2),
      mouthMat,
    );
    lintel.position.set(isZ ? 0 : mz, 7.1, isZ ? mz : 0);
    root.add(lintel);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, 7),
      new THREE.MeshBasicMaterial({ color: 0x05060a }),
    );
    back.position.set(isZ ? 0 : mz + sign * 0.6, 3.4, isZ ? mz + sign * 0.6 : 0);
    back.rotation.y = isZ ? 0 : Math.PI / 2;
    root.add(back);

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
            ctx.narrate('The beam splinters. That tunnel is open now.', 4000, { priority: true });
          } else {
            openStone();
            ctx.narrate('The bricks give way. Another tunnel cleared.', 4000, { priority: true });
          }
        };
        if (d.block === 'wood') breakWood = clear;
        else breakStone = clear;
      }
    }
  }

  // ── Mountain walls: a rocky ring enclosing the crossroads, with the four
  //    tunnels boring through it (an opening left at each tunnel direction) ──
  const mtnA = new THREE.MeshStandardMaterial({ color: 0x4e4a45, roughness: 1, flatShading: true });
  const mtnB = new THREE.MeshStandardMaterial({ color: 0x5b5650, roughness: 1, flatShading: true });
  const tunnelAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]; // S, E, N, W
  const OPEN_HALF = 0.3; // angular half-width of each tunnel opening
  const nearTunnel = (a: number) =>
    tunnelAngles.some((t) => {
      let d = Math.abs(a - t);
      d = Math.min(d, Math.PI * 2 - d);
      return d < OPEN_HALF;
    });
  for (let a = 0; a < Math.PI * 2; a += 0.09) {
    if (nearTunnel(a)) continue;
    const R = 30 + Math.random() * 3;
    const h = 12 + Math.random() * 10;
    const peak = new THREE.Mesh(
      new THREE.ConeGeometry(4.5 + Math.random() * 3, h, 6 + Math.floor(Math.random() * 3)),
      Math.random() < 0.5 ? mtnA : mtnB,
    );
    peak.position.set(Math.sin(a) * R, h / 2 - 0.6, Math.cos(a) * R);
    peak.rotation.y = Math.random() * Math.PI;
    root.add(peak);
    // a shorter rock just inside, for depth + to fill gaps between peaks
    if (Math.random() < 0.7) {
      const h2 = 7 + Math.random() * 6;
      const Rf = R - 4 - Math.random() * 3;
      const rock = new THREE.Mesh(new THREE.ConeGeometry(3 + Math.random() * 2, h2, 6), mtnA);
      rock.position.set(Math.sin(a) * Rf, h2 / 2 - 0.6, Math.cos(a) * Rf);
      root.add(rock);
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
      ctx.narrate('You take the controls. A and D to aim, E to power it on and off, S to step off.', 6000, { priority: true });
    },
  });

  // ── Exit ──
  const exit = spawnPedestalButton(
    root,
    new THREE.Vector3(-5, 0, 6),
    () => ctx.advance(new THREE.Vector3(-5, 0, 6)),
    { glow: false },
  );
  ctx.addObstacle(exit.obstacle);

  ctx.setRegions([{ minX: -34, maxX: 34, minZ: -34, maxZ: 34, floorY: 0 }]);
  ctx.narrate(
    'A trainyard crossroads. Four tunnels, one slingshot, flinging trains wherever it is pointed. And it is pointed somewhere right now. Affecting things. Elsewhere.',
    8000,
  );
}
