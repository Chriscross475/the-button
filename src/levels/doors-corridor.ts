import * as THREE from 'three';
import { CONFIG } from '../config';
import type { GameContext } from '../game/types';
import type { RoomBounds } from '../controls/player-camera';
import { addUpdater } from '../experiences/scheduler';
import { DOOR_TYPES, LOCKED_DOOR_TYPE, type DoorHandle } from '../doors/door-types';
import { registerInteractable } from '../interactables/system';
import type { Interactable } from '../interactables/types';
import { whoosh, pop, thud } from '../audio/sfx';
import { buildExitRoom } from './exit-room';
import { createAsset } from '../assets';
import { defineCombine, type Carryable } from '../game/combine';
import { disposeTree } from '../engine/dispose';
import { vo } from '../audio/vo-shared';

// The last door is locked: combining the key (found behind you in the first
// room) with its lock opens it. The active doors level installs the unlock.
let unlockLastDoor: (() => void) | null = null;
defineCombine('key', 'door-lock', (held) => {
  held.object.parent?.remove(held.object); // the key is spent
  pop();
  unlockLastDoor?.();
});

// The doors' second opinions — once you've met the locked door (and again when
// you pick up the key) every door swaps to the next walk's mechanism set,
// closed — three walks, three sets, fifteen mechanisms. See reshuffleDoors().
const RESHUFFLE_NOTICE = vo('Hm. That is not how that door opened before. They have been reconsidering themselves.');
const KEY_TEASE = vo(
  'There is a key, incidentally. I have known where it is since before you pressed the button. It is in the first room — behind where you started. I thought the walk would be good for you.',
);
const WALKBACK_QUIPS = vo([
  'I could have told you it was locked five doors ago. I want you to know that I considered it.',
  'They do this when they are nervous.',
  'I did consider mentioning the key earlier. It seemed funnier unmentioned. I stand by that.',
  'Everyone is reinventing themselves today.',
  'Nearly there. The key has not moved. Probably.',
]);
const FORWARD_QUIPS = vo([
  'Yes, yes. Very dramatic. Keep walking.',
  'That one practised while you were gone.',
  'The lock, at least, has remained itself. Cherish that.',
]);
const RESHUFFLE_AGAIN = vo('And now they have all changed again. The key has made everyone self-conscious.');

// PATH #2 — the corridor of doors.
//
// You stay in the white room; only its FRONT wall drops, opening into a corridor
// that runs away from the room. Each segment ends in a door that opens a
// different way. The corridor GROWS as you go — every stretch after a door is
// wider + taller than the last, and every door is a little bigger too.

const SEG = 20; // length of each corridor segment (door to door)
const N = 5; // CHANGING doors; DOOR_TYPES holds N × 3 mechanisms (one set per walk)
const ND = N + 1; // total doors: the five that change + the locked sixth
const OPEN_DIST = 7;

// Base sizes + per-step growth (segment/door index k = 0,1,2,…). The corridor
// and doors scale up noticeably with each step (steps sized for N = 5).
const WC0 = 7, WC_STEP = 2.4; // corridor width
const H0 = 5.5, H_STEP = 1.1; // corridor height
const DW0 = 2.4, DW_STEP = 0.6; // door width
const DH0 = 3.2, DH_STEP = 0.5; // door height
const segW = (k: number) => WC0 + k * WC_STEP;
const segH = (k: number) => H0 + k * H_STEP;
const doorW = (k: number) => DW0 + k * DW_STEP;
const doorH = (k: number) => DH0 + k * DH_STEP;

interface DoorSlot {
  z: number;
  handle: DoorHandle;
  progress: number;
  name: string;
  opened: boolean;
  manual?: boolean; // opened by a left-click on its knob, not on approach
}

export function revealDoors(ctx: GameContext): void {
  const root = ctx.levelRoot;
  const ROOM_W = CONFIG.ROOM.width;
  const ROOM_D = CONFIG.ROOM.depth;
  const ROOM_H = CONFIG.ROOM.height;
  const FRONT = -ROOM_D / 2; // z of the room's front wall (the one that drops)

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.9 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x26282d, roughness: 1 });

  const END_Z = FRONT - SEG * (ND + 1);
  const doorZ = (k: number) => FRONT - SEG * (k + 1); // door k (0..N-1)
  const segHiZ = (k: number) => (k === 0 ? FRONT : doorZ(k - 1)); // +Z end of segment k
  const segLoZ = (k: number) => (k === ND ? END_Z : doorZ(k)); // −Z end of segment k

  // ── Growing corridor: N+1 segment shells, each wider + taller than the last. ──
  for (let k = 0; k <= ND; k++) {
    const w = segW(k);
    const h = segH(k);
    const zHi = segHiZ(k);
    const zLo = segLoZ(k);
    const len = zHi - zLo;
    const mid = (zHi + zLo) / 2;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, len), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.02, mid);
    floor.receiveShadow = true;
    root.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, len), wallMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, h, mid);
    root.add(ceil);

    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.2, h, len), wallMat);
      wall.position.set((sx * w) / 2, h / 2, mid);
      wall.receiveShadow = true;
      root.add(wall);
    }
  }

  // Junction: bridge the room mouth (ROOM_W × ROOM_H) into segment 0.
  const w0 = segW(0);
  const h0 = segH(0);
  const wingW = (ROOM_W - w0) / 2;
  if (wingW > 0.05) {
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(wingW, ROOM_H, 0.3), wallMat);
      wing.position.set(s * (w0 / 2 + wingW / 2), ROOM_H / 2, FRONT);
      root.add(wing);
    }
  }
  if (h0 > ROOM_H) {
    const transom = new THREE.Mesh(new THREE.BoxGeometry(w0, h0 - ROOM_H, 0.3), wallMat);
    transom.position.set(0, (ROOM_H + h0) / 2, FRONT);
    root.add(transom);
  }

  // A cross-wall at door k, sized to the (bigger) segment you're ENTERING, with a
  // door-sized hole. Side pieces get collision so you funnel through the opening.
  const mkDoorwayWall = (z: number, k: number) => {
    const w = segW(k + 1);
    const h = segH(k + 1);
    const dw = doorW(k);
    const dh = doorH(k);
    const sideW = (w - dw) / 2;
    const fillerX = dw / 2 + sideW / 2;
    const piece = (sx: number, sy: number, x: number, y: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.3), wallMat);
      m.position.set(x, y, z);
      m.receiveShadow = true;
      root.add(m);
    };
    piece(sideW, h, -fillerX, h / 2);
    piece(sideW, h, fillerX, h / 2);
    piece(dw + 0.4, h - dh, 0, (dh + h) / 2); // lintel
    ctx.addObstacle({ x: -fillerX, z, radius: 1.0 });
    ctx.addObstacle({ x: fillerX, z, radius: 1.0 });
  };

  // The doors — each successive one bigger + a more elaborate open-type.
  const slots: DoorSlot[] = [];
  let knob0: Interactable | null = null;
  for (let k = 0; k < ND; k++) {
    const type = k < N ? DOOR_TYPES[k] : LOCKED_DOOR_TYPE; // the sixth never changes
    const handle = type.build(doorW(k) + 0.25, doorH(k) + 0.15);
    const z = doorZ(k);
    handle.group.position.set(0, 0, z);
    handle.open(0);
    root.add(handle.group);
    mkDoorwayWall(z, k);
    const hue = (k / ND) * 0.8 + 0.05;
    const col = new THREE.Color().setHSL(hue, 0.55, 0.55);
    const lamp = new THREE.PointLight(col.getHex(), 0.9, 14, 2);
    lamp.position.set(0, segH(k + 1) - 0.7, z + 1.6);
    root.add(lamp);
    const slot: DoorSlot = { z, handle, progress: 0, name: type.name, opened: false };
    slots.push(slot);

    // The FIRST door has a knob you left-click to open (not proximity).
    if (k === 0) {
      slot.manual = true;
      const it: Interactable = {
        id: 'door-knob-0',
        position: new THREE.Vector3(0, 1.3, z),
        radius: 2.6,
        promptLabel: 'OPEN',
        labelOffsetY: 1.3,
        onUse() {
          if (slot.opened) return;
          slot.opened = true;
          it.promptLabel = '';
          whoosh();
          ctx.narrate(slot.name, 2600);
        },
        built: { group: handle.group },
      };
      registerInteractable(it);
      knob0 = it;
    }

    // The LAST door has a knob AND a keyhole — and it's locked. Only the key
    // (hidden behind you in the first room) opens it.
    if (k === ND - 1) {
      slot.manual = true; // won't open on approach
      const lockMat = new THREE.MeshStandardMaterial({ color: 0x44474e, roughness: 0.5, metalness: 0.7 });
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.5, 0.08), lockMat);
      plate.position.set(doorW(k) * 0.34, 1.25, z + 0.12);
      root.add(plate);
      const keyhole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 12), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
      keyhole.position.set(doorW(k) * 0.34, 1.3, z + 0.17);
      root.add(keyhole);
      const it: Interactable = {
        id: 'door-knob-last',
        position: new THREE.Vector3(0, 1.3, z),
        radius: 2.8,
        promptLabel: 'OPEN',
        labelOffsetY: 1.3,
        onUse() {
          if (slot.opened) return;
          ctx.narrate('Locked. A knob, and a keyhole that just stares back. Pity.', 4500, { priority: true });
        },
        built: { group: handle.group },
      };
      registerInteractable(it);
      ctx.addTarget({ kind: 'door-lock', position: new THREE.Vector3(0, 1.3, z), radius: 3 });
      unlockLastDoor = () => {
        if (slot.opened) return;
        slot.opened = true; // the proximity updater eases it open
        it.promptLabel = '';
        whoosh();
        ctx.narrate('The key turns. The lock gives. And the last door — a door that takes a bow.', 5500, { priority: true });
      };
    }
  }

  // Ceiling lamps down the length so the long corridors stay navigable.
  for (let k = 0; k <= ND; k++) {
    const l = new THREE.PointLight(0xb0b6c6, 0.7, 22, 2);
    l.position.set(0, segH(k) - 0.4, (segHiZ(k) + segLoZ(k)) / 2);
    root.add(l);
  }
  root.add(new THREE.AmbientLight(0x8088a0, 0.6));

  // Open ONLY the front wall — the rest of the room stays, lit, around you.
  ctx.openRoom({ walls: ['back'], ceiling: false, dimLights: false });

  // The exit room sits just past the last door.
  const exitBounds = buildExitRoom(ctx, {
    center: new THREE.Vector3(0, 0, END_Z + 1 - 4.5),
    facing: 'posZ',
    facade: false, // plain white room, no cabin shell
  });

  // Walk region = room + each growing segment + the exit room (overlapping seams).
  const room: RoomBounds = { minX: -ROOM_W / 2, maxX: ROOM_W / 2, minZ: FRONT, maxZ: ROOM_D / 2 };
  const segRegions: RoomBounds[] = [];
  for (let k = 0; k <= ND; k++) {
    const w = segW(k);
    segRegions.push({ minX: -w / 2, maxX: w / 2, minZ: segLoZ(k) - 1, maxZ: segHiZ(k) + 1 });
  }
  ctx.setRegions([room, ...segRegions, exitBounds]);

  // Soft neutral sky down the corridor (the room itself stays bright/white).
  const sky = new THREE.Color(0xa8acb4);
  const startBg = (ctx.scene.background as THREE.Color)?.clone() ?? new THREE.Color(0xf4f4f2);
  if (!ctx.scene.fog) ctx.scene.fog = new THREE.Fog(0xa8acb4, 14, 80);
  const fog = ctx.scene.fog as THREE.Fog;
  let tb = 0;
  addUpdater((dt) => {
    tb += dt;
    const k = Math.min(1, tb / 1.8);
    const c = startBg.clone().lerp(sky, k);
    (ctx.scene.background as THREE.Color).copy(c);
    fog.color.copy(c);
    return k >= 1;
  });

  // ── The doors reconsider. Rebuild every door (except the locked last one)
  //    with a rotated mechanism, closed — each pass re-opens ten changed doors.
  //    A rotation (never identity) guarantees EVERY door differs from last time. ──
  let shuffled = false;
  let keyShuffled = false; // second reshuffle (key pickup) switches the quip pool
  let pendingNotice = false; // the first re-opened door gets the "hm." line
  let walk = 0; // 0 = first walk, 1 = walk back, 2 = the key trip — each gets its own set
  let reopened = 0;
  let quipIdx = 0;
  const reshuffleDoors = () => {
    walk = Math.min(2, walk + 1);
    for (let k = 0; k < N; k++) {
      // Only the five changing doors — the locked sixth keeps its one mechanism.
      const s = slots[k];
      const type = DOOR_TYPES[walk * N + k];
      root.remove(s.handle.group);
      disposeTree(s.handle.group); // mid-level swap: free the old door's GPU resources
      const handle = type.build(doorW(k) + 0.25, doorH(k) + 0.15);
      handle.group.position.set(0, 0, s.z);
      handle.open(0);
      root.add(handle.group);
      s.handle = handle;
      s.name = type.name;
      s.opened = false;
      s.progress = 0;
      s.manual = false; // even the first door's knob has dropped the formality
    }
    if (knob0) knob0.promptLabel = '';
    shuffled = true;
    reopened = 0;
    quipIdx = 0; // each walk reads its pool from the top
  };
  const announceDoor = (s: DoorSlot) => {
    // First pass: the names introduce each mechanism. After a reshuffle the
    // names are old news — the narrator needles you about the key instead,
    // every other door, and lets the rest open in pointed silence.
    if (!shuffled) {
      ctx.narrate(s.name, 2600);
      return;
    }
    if (pendingNotice) {
      pendingNotice = false;
      ctx.narrate(RESHUFFLE_NOTICE, 4500);
      return;
    }
    if (++reopened % 2 === 0) return; // every other door opens in pointed silence
    const pool = keyShuffled ? FORWARD_QUIPS : WALKBACK_QUIPS;
    ctx.narrate(pool[quipIdx++ % pool.length], 3600);
  };

  // Proximity opening — symmetric band, so doors also open when approached from
  // the far side on the walks back.
  const player = ctx.playerPos();
  addUpdater((dt) => {
    for (const s of slots) {
      const near = !s.manual && Math.abs(player.z - s.z) < OPEN_DIST;
      if (near || s.opened) {
        if (!s.opened) {
          s.opened = true;
          whoosh();
          announceDoor(s);
        }
        s.progress = Math.min(1, s.progress + dt / 0.9);
        s.handle.open(s.progress);
      }
    }
    return false;
  });

  // The KEY for the last door — in the FIRST room, BEHIND the player, so it's
  // not seen at the start (you face the corridor; it's at your back).
  const key = createAsset('key');
  key.position.set(1.8, 0.45, ROOM_D / 2 - 1.0);
  root.add(key);
  ctx.addCarryable({
    kind: 'key',
    object: key,
    heldDist: 0.6,
    heldDrop: 0.28,
    onGrab: () => {
      if (!shuffled || keyShuffled) return;
      keyShuffled = true;
      ctx.narrate(RESHUFFLE_AGAIN, 5500, { priority: true });
      reshuffleDoors();
    },
  });

  // Pity the locked last door when you first reach it.
  const lastSlot = slots[ND - 1];
  const lastZ = doorZ(ND - 1);
  addUpdater(() => {
    if (lastSlot.opened) return true;
    if (player.z < lastZ + 6 && player.z > lastZ - 1) {
      ctx.narrate('The final door. A knob, and a keyhole. Locked, of course. They always are.', 5000, { priority: true });
      ctx.narrate(KEY_TEASE, 10000); // queues behind the pity line — the confession IS the gag
      reshuffleDoors(); // behind your back, the whole corridor reconsiders
      pendingNotice = true;
      return true;
    }
    return false;
  });

  // ── Procedural spike traps: pressure plates scattered through the corridors,
  //    in different spots every run. Step on one and spikes erupt. They sit off
  //    to the side, so a careful eye can walk around them. ──
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const spawnTrap = (px: number, pz: number) => {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.08, 1.7),
      new THREE.MeshStandardMaterial({ color: 0x3c3f46, roughness: 0.6, metalness: 0.5 }),
    );
    plate.position.set(px, 0.05, pz);
    root.add(plate);
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(1.95, 0.05, 1.95),
      new THREE.MeshStandardMaterial({ color: 0x6a4a1a, roughness: 0.85 }),
    );
    rim.position.set(px, 0.03, pz);
    root.add(rim);
    const spikes = new THREE.Group();
    spikes.position.set(px, -1.4, pz);
    const spikeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.4, metalness: 0.7, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.13, 1.15, 6), spikeMat);
      c.position.set(rnd(-0.65, 0.65), 0.55, rnd(-0.65, 0.65));
      spikes.add(c);
    }
    root.add(spikes);
    let triggered = false;
    let t = 0;
    addUpdater((dt) => {
      if (!triggered) {
        if (Math.abs(player.x - px) < 0.85 && Math.abs(player.z - pz) < 0.85 && !ctx.isDead()) {
          triggered = true;
          plate.position.y = 0.01; // depress
          pop();
          thud();
        }
        return false;
      }
      t += dt;
      spikes.position.y = -1.4 + Math.min(1, t / 0.16) * 1.85; // erupt
      if (t >= 0.16 && !ctx.isDead()) {
        ctx.die('spikes');
        return true;
      }
      return false;
    });
  };
  // Skip segment 0 (the spawn room); trap roughly half the corridors, 1–2 plates each.
  for (let k = 1; k <= ND; k++) {
    if (Math.random() < 0.5) continue;
    const w = segW(k);
    const plates = Math.random() < 0.4 ? 2 : 1;
    for (let i = 0; i < plates; i++) {
      spawnTrap(rnd(-(w / 2 - 1.6), w / 2 - 1.6), rnd(segLoZ(k) + 2.5, segHiZ(k) - 2.5));
    }
  }

  ctx.narrate('The front wall is gone. A corridor. Every door has opinions. And the floor, it turns out, has views of its own.', 5500);
}
