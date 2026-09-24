import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import type { Obstacle } from '../controls/player-camera';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { spawnPedestalButton } from '../button/pedestal-button';
import { tone, noise, ensureAudio, whoosh, quack, thud, applause, sadTrombone, sparkle, pop } from '../audio/sfx';
import { isSpeaking } from '../audio/tts';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { FONT_SIGN, FONT_DISPLAY } from '../ui/fonts';
import { hideRoomShell } from './scaffold';

// THE MULTIVERSE — the press tears a humming violet-and-orange rift into the
// room. Behind it: every other version of this room, one per dimension, and the
// narrator (a jaded interdimensional claims adjuster) flips through them like
// channels. Every walk through the rift is the next channel.
//
//   Each dimension is this room with one rule wrong: ducks, upside down (the
//   button presses YOU), buttons illegal, a twenty-metre button, a room of other
//   yous pressing in sync, a sitcom set with a laugh track, a dead ruin, and one
//   that is almost right. Each has its own button, and its own joke when pressed.
//
//   THE PRIME BUTTON is in the one dimension the narrator isn't in. He says so
//   up front, then later cheerfully calls a wrong one "the prime dimension". The
//   real one looks exactly like home and is silent. Pressing it → advance.
//
//   The dead dimension holds a snow globe with a tiny white room in it — a
//   souvenir to carry out. Visit every dimension for a second reward.

const HX = 5.4;
const HZ = 6.4;
const H = 3.2;
const T = 0.2;
const RIFT_Z = 1.2; // the rift stands across the room here, facing ±z
const RIFT_R = 1.25;
const BTN = new THREE.Vector3(0, 0, -3.2);

type DimId = 'home' | 'ducks' | 'upside' | 'illegal' | 'giant' | 'yous' | 'sitcom' | 'dead' | 'almost' | 'prime';

const INTRO = vo("Oh no. You have torn a hole in the multiverse. Everyone does, the first time. Through there is every other version of this room. Somewhere in there is the prime button. The real one. You will know it. It is the only dimension I am not in. Enjoy the quiet.");
const HOME_PRESS = vo('That button is spent. This dimension already pressed it. You did. Just now. Keep up.');
const HOME_BACK = vo('Home. Or a very good copy. Honestly, who can tell any more.');
const ARRIVE = {
  ducks: vo('The duck dimension. Everything here is a duck. The walls are ducks. The button is a duck. I am, legally, a duck.'),
  upside: vo('This one is upside down. Here, the button presses you. Do not take it personally. It presses everybody.'),
  illegal: vo('Ah. A dimension where buttons are illegal. Keep your hands where he can see them.'),
  giant: vo('The large dimension. The button is twenty metres tall. Nobody here has ever pressed it. They mostly just look at it.'),
  yous: vo('Oh, this one. Every version of you, pressing every version of the button. In perfect time. They are waiting for you to join in.'),
  sitcom: vo('This dimension is a sitcom. Everything I say gets a laugh. It is the worst place I have ever worked.'),
  dead: vo('This one is dead. They pressed it too many times. Do not touch anything. Well. Touch whatever you like. It cannot get worse.'),
  almost: vo('Ah, here we are. The prime dimension. Definitely this one. Go on, press it.'),
};
const PRESS = {
  ducks: vo('It quacked. That is the whole dimension. It quacks.'),
  illegal: vo('You pressed a button. In front of a police officer. Your hands have been confiscated. You will get them back. Probably.'),
  giant: vo('You pressed the pedestal. The button is up there. About six floors up. Good effort, though.'),
  yous: vo('In sync. They are very proud of you. They are you, so it is a bit awkward.'),
  sitcom: vo('Classic.'),
  dead: vo('It crumbled. Of course it crumbled. What did you think happened to this one.'),
  almost: vo('Almost. The button is square in this one. Did you not notice it is square. Also, I am here. I told you I would not be here.'),
};
const UPSIDE_POKE = vo('It pressed you. That is how it goes in this one. You are the button now.');
const YOUS_STARE = vo('They are all looking at you. You are the only one not pressing. It is a very quiet peer pressure.');
const DUCK_HOME = vo('You brought a duck to the duck dimension. It has gone native. It will not be coming back to visit.');
const QUIET_HINT = vo('A tip, from the claims department. The real one is the quiet one. If you can hear me, you are in the wrong room.');
const EVERY = vo('That is every dimension. There are more, but they are worse. Trust me. I have the claims.');
const PRIME_PRESS = vo('Oh. You found it. The quiet one. I was not in there. That is the rule. Well done. Off you go.');

const DIM_BG: Record<DimId, { floor: number; wall: number; ceil: number; fog: number }> = {
  home: { floor: 0xe6e6e2, wall: 0xf4f4f2, ceil: 0xf8f8f6, fog: 0xf4f4f2 },
  prime: { floor: 0xe6e6e2, wall: 0xf4f4f2, ceil: 0xf8f8f6, fog: 0xf4f4f2 },
  almost: { floor: 0xe6e6e2, wall: 0xf4f4f2, ceil: 0xf8f8f6, fog: 0xf4f4f2 },
  ducks: { floor: 0x4a90c8, wall: 0xf5d64a, ceil: 0xfbe98a, fog: 0xf5d64a },
  upside: { floor: 0xf8f8f6, wall: 0xd8d2e8, ceil: 0x8c8a94, fog: 0xd8d2e8 },
  illegal: { floor: 0x3a3d44, wall: 0x6a7080, ceil: 0x50545e, fog: 0x2a2d33 },
  giant: { floor: 0xcfc9bc, wall: 0xe2dccf, ceil: 0xe2dccf, fog: 0xbfd6ea },
  yous: { floor: 0xdcdcd6, wall: 0xeaeae4, ceil: 0xf2f2ee, fog: 0xeaeae4 },
  sitcom: { floor: 0x8a5a3a, wall: 0x2f8f8a, ceil: 0x2a2a2a, fog: 0x2f8f8a },
  dead: { floor: 0x3b3834, wall: 0x55504a, ceil: 0x2e2c29, fog: 0x2b2926 },
};

function canvasSign(text: string, w: number, h: number, bg: string, fg: string, font: string, mirrored = false): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = Math.round((512 * h) / w);
  const g = cv.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = text.split('\n');
  const lh = cv.height / (lines.length + 1);
  lines.forEach((line, i) => {
    let px = Math.floor(lh * 0.8);
    do g.font = `bold ${px}px ${font}`;
    while (g.measureText(line).width > cv.width - 40 && --px > 8);
    g.fillText(line, cv.width / 2, lh * (i + 1));
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
  if (mirrored) m.scale.x = -1;
  return m;
}

function riftTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 4, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,240,220,1)');
  grad.addColorStop(0.25, 'rgba(255,140,40,0.95)');
  grad.addColorStop(0.6, 'rgba(150,60,230,0.85)');
  grad.addColorStop(1, 'rgba(60,10,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  // spiral arms
  g.strokeStyle = 'rgba(255,220,255,0.55)';
  g.lineWidth = 5;
  for (let arm = 0; arm < 4; arm++) {
    g.beginPath();
    for (let t = 0; t < 1; t += 0.02) {
      const a = arm * (Math.PI / 2) + t * Math.PI * 2.2;
      const r = 10 + t * 110;
      const x = 128 + Math.cos(a) * r;
      const y = 128 + Math.sin(a) * r;
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  return new THREE.CanvasTexture(cv);
}

function hum(): void {
  ensureAudio();
  tone({ type: 'sawtooth', from: 55, to: 62, dur: 0.9, gain: 0.03 });
  tone({ type: 'sine', from: 110, to: 104, dur: 0.9, gain: 0.04 });
}
function channelFlip(): void {
  ensureAudio();
  whoosh();
  noise(0.18, 0.12, 2400, 'bandpass');
  tone({ type: 'square', from: 900, to: 180, dur: 0.22, gain: 0.04 });
}
function laughTrack(): void {
  ensureAudio();
  applause(0.1, 1.2);
  for (let i = 0; i < 6; i++) setTimeout(() => tone({ type: 'triangle', from: 260 + Math.random() * 120, to: 200, dur: 0.12, gain: 0.03 }), i * 110 + Math.random() * 40);
}
function whistle(): void {
  ensureAudio();
  tone({ type: 'sine', from: 2600, to: 2500, dur: 0.5, gain: 0.07 });
}

export function revealMultiverse(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false });
  hideRoomShell(ctx);
  ctx.setRegions([{ minX: -HX + 0.1, maxX: HX - 0.1, minZ: -HZ + 0.1, maxZ: HZ - 0.1, floorY: 0 }]);
  const cam = ctx.camera.position;
  cam.x = THREE.MathUtils.clamp(cam.x, -HX + 0.8, HX - 0.8);
  cam.z = THREE.MathUtils.clamp(cam.z, -HZ + 0.8, HZ - 0.8);
  if (Math.hypot(cam.x - BTN.x, cam.z - BTN.z) < 1.3 || Math.abs(cam.z - RIFT_Z) < 0.4) cam.set(0, CONFIG.PLAYER_HEIGHT, 3.6);

  root.add(new THREE.HemisphereLight(0xffffff, 0x8a8a90, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 0.5);
  key.position.set(2, 6, 4);
  root.add(key);

  // ── The room shell (recoloured per dimension) ──
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.95 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xf8f8f6, roughness: 1 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  root.add(floor);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  root.add(ceil);
  const walls = new THREE.Group(); // scaled tall for the giant dimension
  root.add(walls);
  const wall = (sx: number, sz: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, H, sz), wallMat);
    m.position.set(x, H / 2, z);
    walls.add(m);
  };
  wall(HX * 2 + T * 2, T, 0, HZ + T / 2);
  wall(HX * 2 + T * 2, T, 0, -HZ - T / 2);
  wall(T, HZ * 2, -HX - T / 2, 0);
  wall(T, HZ * 2, HX + T / 2, 0);

  // ── The rift ──
  const tex = riftTexture();
  const riftMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const riftA = new THREE.Mesh(new THREE.CircleGeometry(RIFT_R, 48), riftMat);
  const riftB = new THREE.Mesh(new THREE.CircleGeometry(RIFT_R * 0.85, 48), riftMat);
  riftA.position.set(0, 1.35, RIFT_Z);
  riftB.position.set(0, 1.35, RIFT_Z + 0.02);
  root.add(riftA, riftB);
  const riftLight = new THREE.PointLight(0xa050ff, 1.2, 7, 2);
  riftLight.position.set(0, 1.4, RIFT_Z);
  root.add(riftLight);

  // ── The button (one pedestal, dressed differently per dimension) ──
  let dim: DimId = 'home';
  const btn = spawnPedestalButton(root, BTN, () => onPress());
  let btnObstacle: Obstacle = btn.obstacle;
  ctx.addObstacle(btnObstacle);
  const dome = btn.group.children.find((c) => c instanceof THREE.Group) as THREE.Group | undefined;

  // ── Per-dimension dressing ──
  const decor = new THREE.Group();
  root.add(decor);
  let decorObstacles: Obstacle[] = [];
  let dimUpdate: ((dt: number) => void) | null = null;
  const addDecorObstacle = (o: Obstacle) => {
    ctx.addObstacle(o);
    decorObstacles.push(o);
  };
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, color: number, parent: THREE.Object3D = decor) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  // The snow globe (the dead dimension's souvenir) — lives in levelRoot so it
  // can leave with you; removed with the dimension if you didn't take it.
  let globe: Carryable | null = null;
  let globeTaken = false;
  const spawnGlobe = () => {
    const g = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 14), new THREE.MeshStandardMaterial({ color: 0xdfefff, transparent: true, opacity: 0.35, roughness: 0.05 }));
    glass.position.y = 0.16;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x5a3a24 }));
    base.position.y = 0.03;
    const room = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), new THREE.MeshStandardMaterial({ color: 0xf4f4f2 }));
    room.position.y = 0.1;
    const tiny = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8), new THREE.MeshStandardMaterial({ color: 0xcc1414, emissive: 0xff2a00, emissiveIntensity: 0.6 }));
    tiny.position.y = 0.13;
    g.add(glass, base, room, tiny);
    g.position.set(-3.6, 0.55, -4.8);
    root.add(g);
    const c: Carryable = {
      kind: 'dimension-snowglobe',
      object: g,
      persistent: true,
      heldDist: 0.6,
      heldDrop: 0.28,
      heldRight: 0.3,
      onGrab: () => {
        globeTaken = true;
        sparkle();
      },
      projectile: { radius: 0.14, restitution: 0.3, gravity: 16 },
    };
    ctx.addCarryable(c);
    globe = c;
  };

  let pokeSaid = false;
  let stareSaid = false;
  let deadCrumbled = false;
  let confiscated: HTMLDivElement | null = null;

  const dress: Record<DimId, () => void> = {
    home: () => {},
    prime: () => {},
    almost: () => {
      // A square button and a mirrored sign. Otherwise home.
      if (dome) dome.visible = false;
      const sq = box(0.3, 0.09, 0.3, BTN.x, 1.04, BTN.z, 0xcc1414);
      (sq.material as THREE.MeshStandardMaterial).emissive.set(0xff2a00);
      (sq.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.45;
      const sign = canvasSign('THE BUTTON', 2.2, 0.5, '#f4f4f2', '#1a1a1a', FONT_SIGN, true);
      sign.position.set(0, 2.3, -HZ + 0.02);
      decor.add(sign);
    },
    ducks: () => {
      btn.group.visible = false;
      const big = createAsset('duck');
      big.scale.setScalar(4);
      big.position.set(BTN.x, 0, BTN.z);
      decor.add(big);
      for (let i = 0; i < 9; i++) {
        const d = createAsset('duck');
        const a = (i / 9) * Math.PI * 2;
        d.position.set(Math.cos(a) * 4.2, 0, Math.sin(a) * 4.6 - 0.5);
        d.rotation.y = Math.random() * 6;
        d.userData.phase = Math.random() * 6;
        decor.add(d);
      }
      const sign = canvasSign('QUACK', 2.4, 0.6, '#f5d64a', '#3a2a10', FONT_DISPLAY);
      sign.position.set(0, 2.3, -HZ + 0.02);
      decor.add(sign);
      let t = 0;
      dimUpdate = (dt) => {
        t += dt;
        for (const c of decor.children) if (c.userData.phase !== undefined) c.position.y = Math.abs(Math.sin(t * 3 + c.userData.phase)) * 0.12;
        if (Math.random() < dt * 0.25) quack(); // the walls quack
      };
      if (ctx.isHolding('duck')) ctx.after(5500, () => dim === 'ducks' && ctx.narrate(DUCK_HOME, 5000));
    },
    upside: () => {
      // The furniture is on the ceiling; a button hangs there, pressing down.
      btn.interactable.promptLabel = ''; // can't reach it; it reaches you
      btn.group.visible = false;
      const hang = new THREE.Group();
      box(0.72, 0.16, 0.72, 0, -0.08, 0, 0xd2d2cc, hang);
      box(0.46, 0.7, 0.46, 0, -0.5, 0, 0xd2d2cc, hang);
      const red = box(0.3, 0.08, 0.3, 0, -0.92, 0, 0xcc1414, hang);
      (red.material as THREE.MeshStandardMaterial).emissive.set(0xff2a00);
      hang.position.set(BTN.x, H, BTN.z);
      decor.add(hang);
      box(1.8, 0.5, 0.8, 3.2, H - 0.25, 2.5, 0x6a4a8a); // a sofa, on the ceiling
      box(0.4, 1.4, 0.4, -3.4, H - 0.7, -1.5, 0x404048); // a lamp, on the ceiling
      const finger = new THREE.Group();
      const skin = 0xe0b48c;
      box(0.34, 2.2, 0.34, 0, 1.1, 0, skin, finger);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
      finger.add(tip);
      finger.position.set(0, H + 0.2, 0);
      decor.add(finger);
      let t = 2.5;
      let phase: 'wait' | 'down' | 'up' = 'wait';
      let poked = false;
      dimUpdate = (dt) => {
        const p = ctx.playerPos();
        if (phase === 'wait') {
          finger.position.x += (p.x - finger.position.x) * Math.min(1, dt * 2);
          finger.position.z += (p.z - finger.position.z) * Math.min(1, dt * 2);
          t -= dt;
          if (t <= 0) {
            phase = 'down';
            poked = false;
          }
        } else if (phase === 'down') {
          finger.position.y = Math.max(1.85, finger.position.y - dt * 4);
          if (finger.position.y <= 1.85) {
            if (!poked && Math.hypot(p.x - finger.position.x, p.z - finger.position.z) < 0.6) {
              poked = true;
              thud();
              const away = new THREE.Vector2(p.x - finger.position.x, p.z - finger.position.z);
              if (away.lengthSq() < 1e-4) away.set(0, 1);
              away.normalize().multiplyScalar(0.7);
              // (never shoved through the rift — that would flip the channel)
              const side = Math.sign(cam.z - RIFT_Z) || 1;
              cam.x = THREE.MathUtils.clamp(cam.x + away.x, -HX + 0.5, HX - 0.5);
              cam.z = THREE.MathUtils.clamp(cam.z + away.y, -HZ + 0.5, HZ - 0.5);
              if (Math.abs(cam.x) < RIFT_R && Math.sign(cam.z - RIFT_Z) !== side) cam.z = RIFT_Z + side * 0.05;
              prevZ = cam.z;
              if (!pokeSaid) {
                pokeSaid = true;
                ctx.narrate(UPSIDE_POKE, 4500, { priority: true });
              }
            }
            phase = 'up';
          }
        } else {
          finger.position.y = Math.min(H + 0.2, finger.position.y + dt * 2);
          if (finger.position.y >= H + 0.2) {
            phase = 'wait';
            t = 3 + Math.random() * 2;
          }
        }
      };
    },
    illegal: () => {
      const cop = createAsset('dummy') as THREE.Group;
      const navy = new THREE.MeshStandardMaterial({ color: 0x1c2a4a, roughness: 0.7 });
      cop.traverse((o) => {
        if (o instanceof THREE.Mesh && o.name !== 'head') o.material = navy;
      });
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.12, 14), navy);
      const head = cop.getObjectByName('head');
      if (head) {
        hat.position.y = 0.16;
        head.add(hat);
      }
      cop.position.set(1.4, 0, BTN.z + 0.4);
      cop.rotation.y = -Math.PI / 4;
      decor.add(cop);
      addDecorObstacle({ x: 1.4, z: BTN.z + 0.4, radius: 0.35 });
      const sign = canvasSign('BUTTONS ARE ILLEGAL\nIN THIS DIMENSION', 3.2, 0.9, '#f0e8d0', '#9a1010', FONT_SIGN);
      sign.position.set(0, 2.2, -HZ + 0.02);
      decor.add(sign);
      const redL = new THREE.PointLight(0xff2020, 0, 12, 1.5);
      const blueL = new THREE.PointLight(0x2040ff, 0, 12, 1.5);
      redL.position.set(-3, 2.8, 0);
      blueL.position.set(3, 2.8, 0);
      decor.add(redL, blueL);
      let t = 0;
      dimUpdate = (dt) => {
        t += dt;
        const on = Math.floor(t * 3) % 2 === 0;
        redL.intensity = on ? 2.2 : 0;
        blueL.intensity = on ? 0 : 2.2;
        const p = ctx.playerPos();
        let dy = Math.atan2(p.x - cop.position.x, p.z - cop.position.z) - cop.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        cop.rotation.y += dy * Math.min(1, dt * 3);
      };
    },
    giant: () => {
      ceil.visible = false;
      walls.scale.y = 9;
      btn.group.scale.setScalar(7);
      btn.interactable.radius = 4.6;
      ctx.removeObstacle(btnObstacle);
      btnObstacle = { x: BTN.x, z: BTN.z, radius: 2.6 };
      ctx.addObstacle(btnObstacle);
    },
    yous: () => {
      // Eight of you around the room, each at a little button, pressing in time.
      const yous: THREE.Group[] = [];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.2;
        const x = Math.cos(a) * 4.1;
        const z = Math.sin(a) * 5 - 0.6;
        if (Math.abs(z - RIFT_Z) < 0.8 && Math.abs(x) < 1.6) continue;
        const d = createAsset('dummy') as THREE.Group;
        d.position.set(x, 0, z);
        d.rotation.y = Math.atan2(-x, -z);
        decor.add(d);
        const ped = box(0.3, 0.9, 0.3, x - Math.sin(d.rotation.y) * -0.55, 0.45, z - Math.cos(d.rotation.y) * -0.55, 0xd2d2cc);
        box(0.16, 0.05, 0.16, ped.position.x, 0.93, ped.position.z, 0xcc1414);
        addDecorObstacle({ x, z, radius: 0.3 });
        yous.push(d);
      }
      let beat = 0;
      let idle = 0;
      dimUpdate = (dt) => {
        beat += dt;
        idle += dt;
        const k = (beat % 2.4) / 2.4;
        const armX = k < 0.15 ? -1.4 * Math.sin((k / 0.15) * Math.PI) : 0;
        if (k < dt / 2.4) pop();
        const staring = idle > 7;
        const p = ctx.playerPos();
        for (const d of yous) {
          const arm = d.getObjectByName('armR');
          if (arm) arm.rotation.x = armX;
          const want = staring ? Math.atan2(p.x - d.position.x, p.z - d.position.z) : Math.atan2(-d.position.x, -d.position.z);
          let dy = want - d.rotation.y;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          d.rotation.y += dy * Math.min(1, dt * 5);
        }
        if (staring && !stareSaid) {
          stareSaid = true;
          ctx.narrate(YOUS_STARE, 5000);
        }
      };
      yousReset = () => {
        idle = 0;
      };
    },
    sitcom: () => {
      box(2.6, 0.5, 0.9, -2.6, 0.25, -4.6, 0xc05a3a); // the couch
      box(2.6, 0.6, 0.2, -2.6, 0.7, -5.0, 0xc05a3a);
      box(1.1, 0.4, 0.6, -2.6, 0.2, -3.4, 0x6a4a2a); // coffee table
      addDecorObstacle({ x: -2.6, z: -4.6, radius: 1.3 });
      const sign = canvasSign('APPLAUSE', 1.6, 0.4, '#300808', '#ff3030', FONT_SIGN);
      sign.position.set(2.6, 2.7, -HZ + 0.02);
      decor.add(sign);
      for (const x of [-3.5, 0, 3.5]) {
        const spot = new THREE.SpotLight(0xfff0d0, 2.2, 12, 0.6, 0.5, 1.5);
        spot.position.set(x, H - 0.1, 3);
        spot.target.position.set(x * 0.5, 0, -3);
        decor.add(spot, spot.target);
        box(0.25, 0.3, 0.25, x, H - 0.15, 3, 0x202020);
      }
      let was = false;
      dimUpdate = () => {
        // A laugh after everything the narrator says.
        const now = isSpeaking();
        if (was && !now) laughTrack();
        was = now;
      };
    },
    dead: () => {
      for (let i = 0; i < 14; i++) {
        const s = 0.3 + Math.random() * 0.6;
        const r = box(s, s * 0.6, s, (Math.random() - 0.5) * 9, s * 0.3, (Math.random() - 0.5) * 11, 0x5a5550);
        r.rotation.set(Math.random(), Math.random() * 3, Math.random() * 0.5);
        if (Math.abs(r.position.z - RIFT_Z) < 1 || Math.hypot(r.position.x - BTN.x, r.position.z - BTN.z) < 1.2) r.visible = false;
      }
      btn.group.rotation.z = 0.12;
      if (deadCrumbled && dome) dome.visible = false;
      const note = canvasSign('WE PRESSED IT\nTOO MANY TIMES', 1.4, 0.8, '#d8ccb0', '#3a2a1a', FONT_SIGN);
      note.position.set(2.4, 1.6, -HZ + 0.02);
      note.rotation.z = -0.06;
      decor.add(note);
      box(1.2, 0.5, 0.5, -3.6, 0.25, -4.8, 0x4a4540); // a shelf stump the globe sits on
      if (!globeTaken) spawnGlobe();
    },
  };

  let yousReset: (() => void) | null = null;

  const undress = () => {
    for (const o of decorObstacles) ctx.removeObstacle(o);
    decorObstacles = [];
    decor.clear();
    dimUpdate = null;
    yousReset = null;
    btn.group.visible = true;
    btn.group.scale.setScalar(1);
    btn.group.rotation.z = 0;
    btn.interactable.promptLabel = 'PRESS';
    btn.interactable.radius = 1.8;
    if (dome) dome.visible = true;
    if (btnObstacle !== btn.obstacle) {
      ctx.removeObstacle(btnObstacle);
      btnObstacle = btn.obstacle;
      ctx.addObstacle(btnObstacle);
    }
    walls.scale.y = 1;
    ceil.visible = true;
    if (globe && !globeTaken) {
      ctx.removeCarryable(globe);
      root.remove(globe.object);
      globe = null;
    }
  };

  const setColours = (d: DimId) => {
    const c = DIM_BG[d];
    floorMat.color.set(c.floor);
    wallMat.color.set(c.wall);
    ceilMat.color.set(c.ceil);
    ctx.scene.background = new THREE.Color(d === 'giant' ? 0xbfd6ea : c.fog);
    ctx.scene.fog = new THREE.Fog(c.fog, d === 'dead' ? 6 : 30, d === 'dead' ? 26 : 80);
  };

  // The channel order: home first, then the others shuffled, with the prime
  // dimension never among the first three you flip to.
  const others: DimId[] = ['ducks', 'upside', 'illegal', 'giant', 'yous', 'sitcom', 'dead', 'almost'];
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  others.splice(3 + Math.floor(Math.random() * (others.length - 2)), 0, 'prime');
  const order: DimId[] = ['home', ...others];
  let idx = 0;
  const visited = new Set<DimId>(['home']);
  let everySaid = false;
  let leaving = false;
  let saidQuietHint = false;

  const flash = () => {
    if (typeof document === 'undefined') return;
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;inset:0;background:#8a3aff;opacity:0.55;pointer-events:none;z-index:20';
    document.body.appendChild(f);
    let o = 0.55;
    addUpdater((dt) => {
      o -= dt * 2.2;
      f.style.opacity = `${Math.max(0, o)}`;
      if (o > 0) return false;
      f.remove();
      return true;
    });
    setTimeout(() => f.remove(), 1500); // (backstop if the level changes mid-fade)
  };

  const goTo = (next: number) => {
    undress();
    idx = next;
    dim = order[idx];
    setColours(dim);
    dress[dim]();
    channelFlip();
    flash();
    discover('mech:rift');
    const first = !visited.has(dim);
    visited.add(dim);
    if (dim === 'home') ctx.narrate(HOME_BACK, 4000, { priority: true });
    else if (dim !== 'prime' && first) ctx.narrate(ARRIVE[dim], 6500, { priority: true });
    // Lost after most of the dimensions: repeat the rule (never inside the prime
    // one, where he is never heard).
    if (dim !== 'prime' && !saidQuietHint && visited.size >= 7) {
      saidQuietHint = true;
      ctx.narrate(QUIET_HINT, 5000);
    }
    if (dim === 'sitcom') ctx.after(400, laughTrack);
    if (visited.size === order.length && !everySaid) {
      everySaid = true;
      discover('reward:every-dimension');
      ctx.after(7000, () => ctx.narrate(EVERY, 5000));
    }
  };

  function onPress(): void {
    if (leaving) return;
    switch (dim) {
      case 'home':
        ctx.narrate(HOME_PRESS, 4500, { priority: true });
        return;
      case 'prime':
        leaving = true;
        sparkle();
        discover('reward:prime-button');
        ctx.narrate(PRIME_PRESS, 5000, { priority: true });
        ctx.after(3800, () => ctx.advance(BTN.clone()));
        return;
      case 'ducks':
        quack();
        ctx.after(160, quack);
        ctx.after(330, quack);
        ctx.narrate(PRESS.ducks, 4000, { priority: true });
        return;
      case 'illegal':
        whistle();
        ctx.narrate(PRESS.illegal, 6000, { priority: true });
        if (typeof document !== 'undefined' && !confiscated) {
          const c = document.createElement('div');
          c.textContent = 'HANDS CONFISCATED';
          c.style.cssText = `position:fixed;left:50%;bottom:90px;transform:translateX(-50%);font-family:${FONT_SIGN};font-weight:bold;font-size:22px;letter-spacing:0.2em;color:#ff3030;text-shadow:0 1px 6px rgba(0,0,0,0.7);pointer-events:none;z-index:20`;
          document.body.appendChild(c);
          confiscated = c;
          const done = () => {
            c.remove();
            confiscated = null;
          };
          ctx.after(4500, done);
          setTimeout(done, 6000); // (backstop if the level changes first)
        }
        return;
      case 'giant':
        thud();
        ctx.narrate(PRESS.giant, 5000, { priority: true });
        return;
      case 'yous':
        yousReset?.();
        ctx.narrate(PRESS.yous, 5000, { priority: true });
        return;
      case 'sitcom':
        ctx.narrate(PRESS.sitcom, 2500, { priority: true });
        return;
      case 'dead':
        if (!deadCrumbled) {
          deadCrumbled = true;
          if (dome) dome.visible = false;
          sadTrombone();
          ctx.narrate(PRESS.dead, 5000, { priority: true });
        }
        return;
      case 'almost':
        ctx.narrate(PRESS.almost, 7000, { priority: true });
        return;
      case 'upside':
        return; // (inert here)
    }
  }

  // ── Per frame: the rift spins and hums; crossing it flips the channel ──
  let prevZ = cam.z;
  let humT = 0;
  addUpdater((dt) => {
    if (leaving) return true;
    riftA.rotation.z -= dt * 1.6;
    riftB.rotation.z += dt * 2.4;
    const s = 1 + Math.sin(performance.now() * 0.004) * 0.04;
    riftA.scale.setScalar(s);
    riftLight.intensity = 1.1 + Math.sin(performance.now() * 0.006) * 0.3;
    humT -= dt;
    if (humT <= 0) {
      humT = 0.9;
      if (Math.hypot(cam.x, cam.z - RIFT_Z) < 5) hum();
    }
    const z = cam.z;
    if (Math.abs(cam.x) < RIFT_R - 0.15 && (prevZ - RIFT_Z) * (z - RIFT_Z) < 0) goTo((idx + 1) % order.length);
    prevZ = z;
    dimUpdate?.(dt);
    return false;
  });

  setColours('home');
  multiverseTest.dim = () => dim;
  ctx.narrate(INTRO, 9000);
}

/** Headless-test hooks (`dim` reads the live dimension once a reveal ran). */
export const multiverseTest = { RIFT_Z, BTN, dim: (): string => 'none' };
