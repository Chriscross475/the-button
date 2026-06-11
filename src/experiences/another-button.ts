import * as THREE from 'three';
import { CONFIG } from '../config';
import type { Experience, ExperienceContext } from './registry';
import { addUpdater } from './scheduler';
import { pick, freeRoomPos } from './util';
import { whoosh, blip, pop } from '../audio/sfx';
import { spawnPedestalButton, type SpawnedButton } from '../button/pedestal-button';
import { buildExitRoom } from '../levels/exit-room';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';

// THE BUTTON GAG. Press the button and it makes ANOTHER button — somewhere new.
// Only the NEWEST one does anything; the rest are spent duds (pressing one is a
// MISTAKE). The room fills up, so you have to watch where the fresh one rises and
// remember which you've pressed.
//   • PATH A — TO_WIN correct presses IN A ROW (no mistakes): a corridor opens to
//     a white room with a reward.
//   • PATH B — MISTAKES_TO_B mistakes: the narrator gives up and "makes it easy" —
//     the buttons vanish and a floor grid appears; walk over every tile (no prize).

const TO_WIN = 10;
const MISTAKES_TO_B = 5;
const SETUP = vo('Another button. And it breeds. Only the NEWEST does anything — find it. No mistakes, now.');
const MORE = vo([
  'Right. A fresh one, somewhere new.',
  'Good. Keep the streak.',
  'Yes. There is a new one now. Go.',
  'Correct. Do that flawlessly a few more times.',
  'One down. Several to go. Without errors, ideally.',
]);
const MISTAKE = vo([
  'Wrong. That one is spent. Do keep up.',
  'No. A dud. You were watching, surely.',
  'Already pressed. We both saw it happen.',
  'A mistake. The live one is elsewhere. Obviously.',
  'Close. Well — not close. But the effort is noted.',
]);

export const anotherButton: Experience = {
  id: 'another-button',
  weight: 1.3,
  run(ctx: ExperienceContext) {
    const root = ctx.levelRoot;
    let streak = 0; // correct presses in a row → PATH A at TO_WIN
    let mistakes = 0; // total mistakes → PATH B at MISTAKES_TO_B
    let resolved = false;
    let live: SpawnedButton | null = null;
    const taken: THREE.Vector3[] = [new THREE.Vector3(0, 0, -2)]; // the recurring button's spot
    const placed: SpawnedButton[] = [];

    // The button you just pressed is spent — pressing it is a mistake.
    ctx.setRoomButton(() => mistake());

    const riseIn = (g: THREE.Object3D) => {
      g.scale.setScalar(0.01);
      let t = 0;
      addUpdater((dt) => {
        t += dt;
        const k = Math.min(1, t / 0.5);
        g.scale.setScalar(0.01 + (1 - Math.pow(1 - k, 3)) * 0.99);
        return k >= 1;
      });
    };

    const freeSpot = (): THREE.Vector3 => {
      for (let i = 0; i < 20; i++) {
        const p = freeRoomPos(ctx.bounds, ctx.playerPos(), 1.2, 2.4);
        if (taken.every((t) => Math.hypot(t.x - p.x, t.z - p.z) > 1.6)) return p;
      }
      return freeRoomPos(ctx.bounds, ctx.playerPos(), 1.2, 2.4);
    };

    function spawnFresh(): void {
      if (resolved) return;
      const p = freeSpot();
      taken.push(p);
      const btn = spawnPedestalButton(root, new THREE.Vector3(p.x, 0, p.z), () => press(btn));
      ctx.addObstacle(btn.obstacle);
      placed.push(btn);
      riseIn(btn.group);
      live = btn;
      whoosh();
    }

    function mistake(): void {
      if (resolved) return;
      mistakes++;
      streak = 0; // the streak must be unbroken
      blip();
      if (mistakes >= MISTAKES_TO_B) {
        pathB();
        return;
      }
      ctx.narrate(pick(MISTAKE), 2800, { priority: true });
    }

    function press(btn: SpawnedButton): void {
      if (resolved) return;
      if (btn !== live) {
        mistake(); // a spent one
        return;
      }
      streak++;
      live = null;
      if (streak >= TO_WIN) {
        pathA(btn);
        return;
      }
      ctx.narrate(pick(MORE), 2400, { priority: true });
      spawnFresh();
    }

    // PATH A — a flawless run: a corridor opens to a white reward room.
    function pathA(btn: SpawnedButton): void {
      resolved = true;
      live = null;
      ctx.narrate('Ten in a row. Flawless. I did not expect that. A reward, then — go on.', 6000, { priority: true });
      const b = ctx.bounds;
      const backZ = b.minZ;
      const h = CONFIG.ROOM.height;
      ctx.openRoom({ walls: ['back'], ceiling: false });
      const CORR_W = 4;
      const CORR_LEN = 8;
      const corrMidZ = backZ - CORR_LEN / 2;
      const white = new THREE.MeshStandardMaterial({ color: 0xeeeeec, roughness: 0.9 });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(CORR_W, CORR_LEN), new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.95 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(0, 0, corrMidZ);
      root.add(floor);
      for (const sx of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.15, h, CORR_LEN), white);
        w.position.set((sx * CORR_W) / 2, h / 2, corrMidZ);
        root.add(w);
      }
      const roomZ = backZ - CORR_LEN - 4.5;
      const rb = buildExitRoom(ctx, { center: new THREE.Vector3(0, 0, roomZ), facing: 'posZ', facade: false });
      // Placeholder reward: a golden, glowing orb on a plinth.
      discover('reward:golden-orb');
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.7), new THREE.MeshStandardMaterial({ color: 0xd2d2cc, roughness: 0.85 }));
      plinth.position.set(2.6, 0.45, roomZ);
      root.add(plinth);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 20, 16),
        new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xc9912a, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.6 }),
      );
      orb.position.set(2.6, 1.25, roomZ);
      root.add(orb);
      const orbLight = new THREE.PointLight(0xffd23f, 0.9, 5, 2);
      orbLight.position.copy(orb.position);
      root.add(orbLight);
      ctx.setRegions([
        b,
        { minX: -CORR_W / 2, maxX: CORR_W / 2, minZ: backZ - CORR_LEN - 0.6, maxZ: backZ + 0.6, floorY: 0 },
        rb,
      ]);
    }

    // PATH B — too many mistakes: "let me make this easier." Buttons vanish; a
    // floor grid appears; walk over every tile. No reward.
    function pathB(): void {
      resolved = true;
      live = null;
      ctx.narrate('Five mistakes. Right. Let me make this simpler for you. There — just walk on every square.', 7000, { priority: true });
      for (const btn of placed) {
        root.remove(btn.group);
        btn.interactable.destroyed = true;
        ctx.removeObstacle(btn.obstacle);
      }
      ctx.sinkRoomButton(); // remove the original recurring pedestal too
      ctx.setRoomButton(() => {}); // the recurring button does nothing now

      const tiles: { mesh: THREE.Mesh; x: number; z: number; active: boolean }[] = [];
      const GN = 4;
      const SP = 2.2;
      for (let i = 0; i < GN; i++) {
        for (let j = 0; j < GN; j++) {
          const tx = (i - (GN - 1) / 2) * SP;
          const tz = (j - (GN - 1) / 2) * SP - 1;
          const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 0.12, 1.6),
            new THREE.MeshStandardMaterial({ color: 0x556070, roughness: 0.85, emissive: 0x000000 }),
          );
          mesh.position.set(tx, 0.06, tz);
          root.add(mesh);
          tiles.push({ mesh, x: tx, z: tz, active: false });
        }
      }
      let activated = 0;
      const player = ctx.playerPos();
      addUpdater(() => {
        for (const t of tiles) {
          if (t.active) continue;
          if (Math.abs(player.x - t.x) < 0.85 && Math.abs(player.z - t.z) < 0.85) {
            t.active = true;
            activated++;
            pop();
            const m = t.mesh.material as THREE.MeshStandardMaterial;
            m.color.setHex(0x3ad17a);
            m.emissive.setHex(0x1a6a3a);
            t.mesh.position.y = 0.03; // pressed down
            if (activated >= tiles.length) {
              ctx.narrate('All of them. Well done. Truly. No prize, but — well done.', 5000, { priority: true });
              ctx.advance();
              return true;
            }
          }
        }
        return false;
      });
    }

    ctx.narrate(SETUP, 5500);
    spawnFresh();
  },
};
