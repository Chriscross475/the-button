import * as THREE from 'three';
import { CONFIG } from '../config';
import {
  createCamera,
  updatePlayer,
  updateLook,
  getForwardXZ,
  setYaw,
  getYaw,
  getPitch,
  setPitch,
  setWheel,
  floorYAt,
} from '../controls/player-camera';
import { createTouchInput } from '../controls/input';
import {
  tickInteractables,
  pressUse,
  getAllInteractables,
  clearInteractables,
} from '../interactables/system';
import { findTapTarget } from '../controls/tap-target';
import { isDesktopLike } from '../controls/platform';
import { updateInteractPrompt } from '../ui/interact-prompt';
import { narrate } from '../ui/narrator';
import { createCarry, type Carry } from './combine';
import { ensureAudio, thud, sparkle } from '../audio/sfx';
import { primeTts, onVoiceReady } from '../audio/tts';
import { showMainMenu } from '../ui/main-menu';
import { createAsset } from '../assets';
import { addUpdater, tickUpdaters, clearUpdaters, after } from '../experiences/scheduler';
import { disposeTree } from '../engine/dispose';
import { spawnPedestalButton } from '../button/pedestal-button';
import type { GameContext, Level, LevelInstance, ControlMode, FlightWall } from './types';
import type { Experience } from '../experiences/registry';
import { pick } from '../experiences/util';
import { pickExperience, getExperience, setLastExperience } from '../experiences/registry';
import { vo } from '../audio/vo-shared';

// Launch (flight) tuning.
const FLIGHT_GRAVITY = 16;
const FLIGHT_STEER = 2.2; // how hard "look" curves your trajectory in the air

/** Where the segment a→b first enters the box, as a fraction 0..1 of the
 *  segment — or null if it misses. Starting inside the box returns 0. */
function segmentBoxEntry(a: THREE.Vector3, b: THREE.Vector3, w: FlightWall): number | null {
  let t0 = 0;
  let t1 = 1;
  const lo = [w.minX, w.minY, w.minZ];
  const hi = [w.maxX, w.maxY, w.maxZ];
  const av = [a.x, a.y, a.z];
  const bv = [b.x, b.y, b.z];
  for (let i = 0; i < 3; i++) {
    const d = bv[i] - av[i];
    if (Math.abs(d) < 1e-9) {
      if (av[i] < lo[i] || av[i] > hi[i]) return null;
      continue;
    }
    let tn = (lo[i] - av[i]) / d;
    let tf = (hi[i] - av[i]) / d;
    if (tn > tf) [tn, tf] = [tf, tn];
    t0 = Math.max(t0, tn);
    t1 = Math.min(t1, tf);
    if (t0 > t1) return null;
  }
  return t0;
}

const DEATH_LINES = vo([
  'You died. The button does not mourn.',
  'Dead. We will say no more about it.',
  'That went poorly. Try the other one.',
  'You have been removed from the situation. Forcefully.',
  'Physics: 1. You: 0.',
]);

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = createCamera();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly input: ReturnType<typeof createTouchInput>;
  readonly ctx: GameContext;

  private levels = new Map<string, Level>();
  private current: LevelInstance | null = null;

  private mode: 'play' | 'dead' = 'play';
  private started = false; // false while the boot main menu is up
  private paused = false; // true while the in-game pause menu is open
  private airborne = false;
  private launchVel = new THREE.Vector3();

  // Fade transition.
  private fadeEl: HTMLDivElement;
  private fadeValue = 0;
  private fadeTarget = 0;
  private pendingLevel: string | null = null;
  private rHoldTimer = 0; // hold-R-to-die timer

  private deathEl: HTMLDivElement;
  private readonly forward = new THREE.Vector3();
  private readonly flightPrev = new THREE.Vector3(); // position before this frame's flight step

  private carry!: Carry; // the single global dual-hand carry, created in the ctor
  // A pet that follows the player across levels (scene-attached, Game-driven).
  private companion: THREE.Object3D | null = null;
  private companionFollow = false;
  private companionStay = false; // tapped to hold position (still faces the player)
  private companionBob = 0;
  private companionBaseY = 0;
  private readonly tapRay = new THREE.Raycaster();
  private readonly tapNdc = new THREE.Vector2();
  // Scoring hoop (the kept basket): thrown projectiles dropping through it score.
  private scoringRim: THREE.Object3D | null = null;
  private scoringRimRadius = 0.34;
  private scoringLabel: THREE.Sprite | null = null;
  private hoopScore = 0;
  private readonly hoopPrevY = new Map<THREE.Object3D, number>();
  private readonly rimWorld = new THREE.Vector3();
  private controlMode: ControlMode | null = null; // e.g. operating the slingshot
  // The unicycle, shown under the camera (visible when you look down).
  private wheelMesh: THREE.Group | null = null;
  private wheelSpinG: THREE.Object3D | null = null;
  private wheelPrev = new THREE.Vector2();
  private currentEntry: string | null = null; // the portal the player came through this transition
  private spawnHandled = false; // a level placed the player itself (emerge-from-portal)

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.fadeEl = document.getElementById('fade') as HTMLDivElement;
    this.deathEl = document.getElementById('death') as HTMLDivElement;

    const game = this; // for the live `bounds` getter below
    const bootBounds = { minX: -5, maxX: 5, minZ: -5, maxZ: 5 };
    this.ctx = {
      scene: this.scene,
      camera: this.camera,
      levelRoot: new THREE.Group(),
      narrate,
      after,
      playerPos: () => this.camera.position,
      // Live view of the active level's bounds — stays correct after setBounds
      // (a stored snapshot would go stale the moment a level reshapes itself).
      get bounds() {
        return game.current?.bounds ?? bootBounds;
      },
      addObstacle: (o) => this.current?.obstacles.push(o),
      removeObstacle: (o) => {
        const arr = this.current?.obstacles;
        if (!arr) return;
        const i = arr.indexOf(o);
        if (i >= 0) arr.splice(i, 1);
      },
      spawnButton: (pos) => this.spawnButton(pos),
      goToLevel: (id) => this.goToLevel(id),
      returnToHub: () => this.goToLevel('hub'),
      launchPlayer: (vel) => this.launch(vel),
      die: (cause) => this.die(cause),
      advance: (buttonPos) => this.advance(buttonPos),
      advanceTo: (expId, buttonPos, entry) => this.advanceTo(expId, buttonPos, entry),
      get entry() {
        return game.currentEntry;
      },
      spawnAt: (eye, yaw) => this.spawnAt(eye, yaw),
      openRoom: (opts) => this.current?.openRoom?.(opts),
      setRoomButton: (onPress) => this.current?.setButtonAction?.(onPress),
      sinkRoomButton: () => this.current?.sinkButton?.(),
      addCarryable: (c) => this.carry.addCarryable(c),
      removeCarryable: (c) => this.carry.removeCarryable(c),
      addTarget: (t) => this.carry.addTarget(t),
      removeTarget: (t) => this.carry.removeTarget(t),
      isHolding: (kind) => this.carry.holding(kind),
      consumeHeld: (kind) => this.carry.consume(kind),
      heldKind: (side) => this.carry.inHand(side),
      putInHand: (side, c) => this.carry.putInHand(side, c),
      launchProjectile: (object, velocity, opts) => this.carry.launch(object, velocity, opts),
      setCompanion: (mesh, baseY = 0) => {
        if (this.companion) this.scene.remove(this.companion);
        this.scene.add(mesh); // on the scene → survives level transitions
        this.companion = mesh;
        this.companionBaseY = baseY;
        this.companionFollow = false;
        this.companionStay = false;
        // a new companion isn't a scoring hoop unless setScoringHoop says so
        this.scoringRim = null;
        this.scoringLabel = null;
      },
      setScoringHoop: (rim, radius = 0.34) => {
        this.scoringRim = rim;
        this.scoringRimRadius = radius;
        this.hoopScore = 0;
        this.hoopPrevY.clear();
        this.scoringLabel = (this.companion?.getObjectByName('hoop-score-label') as THREE.Sprite) ?? null;
        this.drawHoopLabel();
      },
      setWheel: (on) => this.setWheelMode(on),
      setControlMode: (cm) => {
        this.controlMode = cm;
      },
      setBounds: (b) => {
        if (this.current) {
          this.current.bounds = b;
          this.current.regions = undefined;
        }
      },
      setRegions: (regions) => {
        if (this.current) this.current.regions = regions;
      },
      setLanding: (onLand, isOverSolid) => {
        if (this.current) {
          this.current.onLand = onLand;
          this.current.isOverSolid = isOverSolid;
        }
      },
      setFlightWalls: (walls) => {
        if (this.current) this.current.flightWalls = walls;
      },
      isAirborne: () => this.airborne,
      isDead: () => this.mode === 'dead',
    };

    // The single global carry system. It gets a live view of the active level's
    // obstacles so thrown projectiles bounce off interior walls (e.g. the cabin).
    this.carry = createCarry(this.ctx, () => this.current?.obstacles ?? []);

    this.input = createTouchInput(canvas, {
      onInteract: () => this.onInteract(),
      onTap: (x, y, canPress) => this.onTap(x, y, canPress),
      onFirstInput: () => this.onFirstInput(),
    });

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyR' || e.repeat) return;
      if (this.mode === 'dead') {
        this.restart();
        return;
      }
      // Hold R while alive to off yourself manually (handy for testing death).
      if (this.started && !this.paused && this.mode === 'play') {
        this.rHoldTimer = window.setTimeout(() => {
          this.rHoldTimer = 0;
          this.die('manual');
        }, 600);
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyR' && this.rHoldTimer) {
        clearTimeout(this.rHoldTimer);
        this.rHoldTimer = 0;
      }
    });
    this.deathEl.addEventListener('click', () => {
      if (this.mode === 'dead') this.restart();
    });

    // Desktop: pressing Esc releases pointer lock — treat that as "open menu"
    // (the browser eats the Esc keydown, so we react to the unlock instead).
    document.addEventListener('pointerlockchange', () => {
      const unlocked = document.pointerLockElement !== this.canvas;
      if (unlocked && this.started && !this.paused && this.mode === 'play' && !this.pendingLevel) {
        this.openMenu();
      }
    });
    // Mobile / unlocked: an on-screen button opens the menu.
    const mb = document.getElementById('menu-button');
    if (mb) mb.addEventListener('click', () => this.openMenu());
  }

  private openMenu(): void {
    if (this.paused || !this.started) return;
    this.paused = true;
    document.exitPointerLock?.();
    showMainMenu({
      onResume: () => {
        this.paused = false;
        // Desktop only: re-acquire mouse-look. On touch there's no pointer lock
        // to hold — requesting it just bounces straight back to "unlocked", which
        // re-opens the menu and leaves the game stuck paused.
        if (isDesktopLike()) this.canvas.requestPointerLock?.();
      },
      onRestart: () => {
        this.paused = false;
        this.goToLevel('hub');
      },
    });
  }

  registerLevel(level: Level): void {
    this.levels.set(level.id, level);
  }

  /** Initial boot into a level (no fade). The world renders but doesn't accept
   *  gameplay input until start() is called (i.e. while the main menu is up). */
  boot(id: string): void {
    this.loadLevel(id);
  }

  /** Leave the main menu and begin playing. Called from the menu's BEGIN
   *  button (a user gesture — so audio + pointer-lock can engage here). */
  start(intro = true): void {
    if (this.started) return;
    this.started = true;
    ensureAudio();
    primeTts();
    const hint = document.getElementById('hint');
    if (hint) {
      hint.style.display = 'block';
      hint.style.opacity = '1';
    }
    const mb = document.getElementById('menu-button');
    if (mb) mb.style.display = 'flex';
    // Desktop only: jump straight into mouse-look. On touch, pointer lock can't
    // hold and immediately exits — which the unlock handler reads as "open menu".
    if (isDesktopLike()) this.canvas.requestPointerLock?.();
    // Opening line only on a real start (not when jumping into a test level),
    // and held until the good voice has loaded so it speaks in the right voice.
    if (intro) onVoiceReady(() => narrate('There is a button. You know what to do.', 4000, { interruptible: true }));
  }

  private loadLevel(id: string): void {
    const level = this.levels.get(id);
    if (!level) {
      console.error(`unknown level: ${id}`);
      return;
    }
    const old = this.current;
    if (old) {
      this.scene.remove(old.root);
      old.dispose?.();
    }
    clearInteractables();
    clearUpdaters();
    this.controlMode = null; // never carry an operating mode across levels
    // The unicycle/wheel is a KEPT reward — it persists across levels now (no
    // clear here); updateWheelVisual keeps it under the player wherever they go.
    this.carry.clearLevel(); // drop the leaving level's carryables; persistent items carry over
    if (old) disposeTree(old.root); // AFTER clearLevel — held items are re-parented out first
    this.mode = 'play';
    this.airborne = false;
    this.launchVel.set(0, 0, 0);
    this.scene.fog = null;
    this.scene.background = null;

    const instance = level.build(this.ctx);
    this.current = instance;
    this.ctx.levelRoot = instance.root;
    this.scene.add(instance.root);
    this.carry.enterLevel(); // items the player carried in re-establish their hooks here

    this.camera.position.copy(instance.spawn.pos);
    this.camera.position.y = CONFIG.PLAYER_HEIGHT;
    setYaw(instance.spawn.yaw);
    this.camera.rotation.set(0, instance.spawn.yaw, 0, 'YXZ');
  }

  private goToLevel(id: string): void {
    if (this.pendingLevel) return;
    this.pendingLevel = id;
    this.fadeTarget = 1;
  }

  // End-room button: rebuild a fresh enclosed hub room and immediately run the
  // next level's transform on it — no fade. The player does NOT teleport: we
  // preserve their offset from the button they pressed (and their look), so they
  // end up in the same spot relative to the new room's button. The result reads
  // as "the room transformed around me", not "I was moved".
  private advance(buttonPos?: THREE.Vector3): void {
    if (this.pendingLevel) return;
    this.runAdvance(pickExperience(), buttonPos);
  }

  // Like advance, but to a specific experience (e.g. through a broken-wall hole).
  // `entry` names the portal used — the destination reads ctx.entry to emerge you
  // from its matching tunnel/crack.
  private advanceTo(expId: string, buttonPos?: THREE.Vector3, entry?: string): void {
    if (this.pendingLevel) return;
    const exp = getExperience(expId);
    if (!exp) {
      this.runAdvance(pickExperience(), buttonPos);
      return;
    }
    setLastExperience(expId); // so the next random pick won't repeat it
    this.runAdvance(exp, buttonPos, entry);
  }

  // Place the player emerging from a portal (called by a level's reveal when
  // ctx.entry matches one of its tunnels/cracks); marks the spawn as handled so
  // runAdvance won't override it with the default offset placement.
  private spawnAt(ground: THREE.Vector3, yaw: number): void {
    this.camera.position.set(ground.x, ground.y + CONFIG.PLAYER_HEIGHT, ground.z);
    setYaw(yaw);
    setPitch(0);
    this.camera.rotation.set(0, yaw, 0, 'YXZ');
    this.spawnHandled = true;
  }

  private runAdvance(exp: Experience | null, buttonPos?: THREE.Vector3, entry?: string): void {
    const cam = this.camera.position;
    // With a reference button, keep the player's offset from it (the room
    // transforms around them). Without one (e.g. the buttons-grid finale), stand
    // them a few metres clear of where the new button appears at (0,0,-2) — so it
    // never spawns right on top of the player and traps them.
    const ref = buttonPos ?? cam;
    const offX = buttonPos ? cam.x - ref.x : 0;
    const offZ = buttonPos ? cam.z - ref.z : 4;
    const oldX = cam.x; // player's world pos BEFORE the transition
    const oldZ = cam.z;
    const yaw = getYaw();
    const pitch = getPitch();
    this.currentEntry = entry ?? null; // the level reads ctx.entry during run()…
    this.spawnHandled = false; // …and may call ctx.spawnAt to emerge from its portal
    this.loadLevel('hub');
    exp?.run(this.ctx);
    if (!this.spawnHandled) {
      // Default: same offset from the new (hub) button at (0,0,-2).
      this.camera.position.set(0 + offX, CONFIG.PLAYER_HEIGHT, -2 + offZ);
      setYaw(yaw);
      setPitch(pitch);
    }
    this.currentEntry = null; // consumed
    // A companion (the baby wolf, the basket) is a scene object — shift it by the
    // same world delta the player just moved, so it stays right beside you in the
    // new level instead of being stranded where the old level was.
    if (this.companion) {
      this.companion.position.x += this.camera.position.x - oldX;
      this.companion.position.z += this.camera.position.z - oldZ;
    }
  }

  private spawnButton(pos: THREE.Vector3): void {
    if (!this.current) return;
    const press = this.current.defaultButtonPress ?? (() => {});
    const spawned = spawnPedestalButton(this.current.root, pos, press);
    this.current.obstacles.push(spawned.obstacle);
    const g = spawned.group;
    g.scale.setScalar(0.01);
    let t = 0;
    addUpdater((dt: number): boolean => {
      t += dt;
      const k = Math.min(1, t / 0.5);
      const eased = 1 - Math.pow(1 - k, 3);
      g.scale.setScalar(0.01 + eased * 0.99);
      return k >= 1;
    });
  }

  private launch(vel: THREE.Vector3): void {
    if (this.airborne || this.mode === 'dead') return;
    this.airborne = true;
    this.launchVel.copy(vel);
    thud();
  }

  private die(_cause?: string, wallHit?: { pos: THREE.Vector3; dir: THREE.Vector3 }): void {
    if (this.mode === 'dead') return;
    this.mode = 'dead';
    this.airborne = false;
    this.carry.dropAll(); // dying drops everything you were carrying
    narrate(pick(DEATH_LINES), 6000, { priority: true }); // death lands on the moment

    const fwd = getForwardXZ(this.forward).clone();
    const outline = createAsset('crime-outline');
    const n = new THREE.Vector3(0, 0, 1); // outward normal of the wall you hit
    if (wallHit) {
      // Splatted against a wall: leave the chalk ON the wall, facing back the way
      // you came. (Yes. On the wall.)
      n.set(-wallHit.dir.x, 0, -wallHit.dir.z);
      if (n.lengthSq() < 1e-4) n.set(0, 0, 1);
      n.normalize();
      outline.position.copy(wallHit.pos).addScaledVector(n, 0.06);
      outline.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    } else {
      // Crime-scene chalk outline on the floor where you fell.
      outline.position.set(this.camera.position.x, 0.02, this.camera.position.z);
      outline.rotation.y = Math.atan2(fwd.x, fwd.z); // lie along your last facing
    }
    this.current?.root.add(outline);

    // Death cam: pull back into a shot that frames the body — over it on the
    // floor, or in front of the wall it's now stuck to.
    const startX = this.camera.position.x;
    const startZ = this.camera.position.z;
    const startY = this.camera.position.y;
    const startPitch = this.camera.rotation.x;
    let targetX: number, targetY: number, targetZ: number, targetPitch: number;
    if (wallHit) {
      setYaw(Math.atan2(n.x, n.z)); // turn to face the wall
      this.camera.rotation.y = Math.atan2(n.x, n.z);
      targetX = wallHit.pos.x + n.x * 5.5;
      targetZ = wallHit.pos.z + n.z * 5.5;
      targetY = wallHit.pos.y + 1.4;
      targetPitch = -0.22;
    } else {
      targetX = startX - fwd.x * 6;
      targetZ = startZ - fwd.z * 6;
      targetY = 5.5;
      targetPitch = -0.82;
    }
    let t = 0;
    addUpdater((dt) => {
      if (this.mode !== 'dead') return true; // restarted
      t += dt;
      const k = Math.min(1, t / 1.6);
      const e = 1 - Math.pow(1 - k, 3);
      this.camera.position.set(
        startX + (targetX - startX) * e,
        startY + (targetY - startY) * e,
        startZ + (targetZ - startZ) * e,
      );
      this.camera.rotation.x = startPitch + (targetPitch - startPitch) * e;
      return k >= 1;
    });

    this.deathEl.style.display = 'flex';
    requestAnimationFrame(() => {
      this.deathEl.style.opacity = '1';
    });
  }

  private restart(): void {
    this.deathEl.style.opacity = '0';
    window.setTimeout(() => {
      this.deathEl.style.display = 'none';
    }, 400);
    this.goToLevel('hub');
  }

  // ── Input handlers ──
  private playable(): boolean {
    return this.started && !this.paused && this.mode === 'play' && !this.airborne && !this.pendingLevel;
  }

  private onInteract(): void {
    if (!this.started || this.paused) return;
    if (this.mode === 'dead') {
      this.restart();
      return;
    }
    if (this.controlMode) {
      this.controlMode.onInteract?.(); // the lever, while operating
      return;
    }
    if (this.playable()) pressUse();
  }

  private onTap(x: number, y: number, canPress: boolean): void {
    if (!this.started || this.paused) return;
    if (this.mode === 'dead') {
      this.restart();
      return;
    }
    // Tap a follower to make it STAY (it keeps facing you); tap again to follow.
    if (this.companion && this.tapHitsCompanion(x, y)) {
      this.companionStay = !this.companionStay;
      if (!this.companionStay) this.companionFollow = true;
      return;
    }
    if (!this.playable() || !canPress) return;
    const it = findTapTarget(x, y, this.canvas, this.camera, getAllInteractables());
    if (!it) return;
    const dx = it.position.x - this.camera.position.x;
    const dz = it.position.z - this.camera.position.z;
    if (Math.hypot(dx, dz) <= it.radius) it.onUse();
  }

  // True if a tap at screen (x,y) lands on the companion mesh (any follower).
  private tapHitsCompanion(x: number, y: number): boolean {
    if (!this.companion) return false;
    this.tapNdc.set((x / window.innerWidth) * 2 - 1, -((y / window.innerHeight) * 2 - 1));
    this.tapRay.setFromCamera(this.tapNdc, this.camera);
    const hits = this.tapRay.intersectObject(this.companion, true);
    return hits.length > 0 && hits[0].distance < 9;
  }

  private onFirstInput(): void {
    ensureAudio();
    primeTts();
    const hint = document.getElementById('hint');
    if (hint) {
      hint.style.opacity = '0';
      window.setTimeout(() => {
        hint.style.display = 'none';
      }, 900);
    }
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ── Per-frame ──
  tick(dt: number): void {
    this.input.tickInput(dt);

    const inControl = this.controlMode !== null;
    if (this.mode === 'play' && this.started && !this.paused) {
      if (this.controlMode) {
        this.controlMode.update(dt, this.input); // operating a machine: it owns the camera
      } else if (this.airborne) {
        this.flyStep(dt);
      } else {
        const lvl = this.current;
        if (lvl) {
          const regions = lvl.regions ?? [lvl.bounds];
          updatePlayer(this.camera, this.input, dt, regions, lvl.obstacles);
        }
      }
    }

    this.carry.tick(dt, this.mode === 'play' && this.started && !this.paused && !inControl);
    this.updateCompanion(dt);
    this.updateHoopScore();
    this.updateWheelVisual();

    // World keeps simulating even while dead.
    tickInteractables(dt, this.camera.position, getForwardXZ(this.forward));
    this.current?.update?.(dt);
    tickUpdaters(dt);
    updateInteractPrompt(this.camera, this.canvas);

    this.updateFade(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // A pet (the baby wolf) trots after the player; persists across levels.
  private updateCompanion(dt: number): void {
    const c = this.companion;
    if (!c || this.mode !== 'play' || !this.started) return;
    const p = this.camera.position;
    const dx = p.x - c.position.x;
    const dz = p.z - c.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    // Tapped to hold position: stay put, but keep turning to face the player.
    if (this.companionStay) {
      c.rotation.y = Math.atan2(-dz, dx);
      c.position.y += (this.companionBaseY - c.position.y) * Math.min(1, dt * 8);
      c.rotation.z *= Math.max(0, 1 - dt * 8);
      return;
    }
    if (!this.companionFollow && dist < 5) this.companionFollow = true; // joins you once you're near
    if (this.companionFollow) {
      let moving = false;
      const FOLLOW_GAP = 3.0; // keep a bit more distance than before (was ~1.5)
      if (dist > FOLLOW_GAP) {
        const sp = Math.min(2.8 * dt, dist - (FOLLOW_GAP - 0.3));
        c.position.x += (dx / dist) * sp;
        c.position.z += (dz / dist) * sp;
        moving = true;
      }
      c.rotation.y = Math.atan2(-dz, dx);
      if (moving) {
        // wobble (bob + waddle tilt) ONLY while it's actually moving
        this.companionBob += dt * 9;
        c.position.y = this.companionBaseY + Math.abs(Math.sin(this.companionBob)) * 0.08;
        c.rotation.z = Math.sin(this.companionBob) * 0.12;
      } else {
        c.position.y += (this.companionBaseY - c.position.y) * Math.min(1, dt * 8); // settle
        c.rotation.z *= Math.max(0, 1 - dt * 8);
      }
    }
  }

  // A thrown ball/duck dropping through the kept basket's rim scores a point.
  private updateHoopScore(): void {
    const rim = this.scoringRim;
    if (!rim) return;
    rim.getWorldPosition(this.rimWorld);
    for (const obj of this.carry.looseObjects()) {
      const y = obj.position.y;
      const py = this.hoopPrevY.get(obj);
      this.hoopPrevY.set(obj, y);
      if (py === undefined) continue;
      // crossed the rim plane on the way DOWN, within the rim's (forgiving) radius
      if (py > this.rimWorld.y && y <= this.rimWorld.y) {
        const d = Math.hypot(obj.position.x - this.rimWorld.x, obj.position.z - this.rimWorld.z);
        if (d < this.scoringRimRadius * 1.4) {
          this.hoopScore++;
          this.drawHoopLabel();
          sparkle();
        }
      }
    }
  }

  // Redraw the floating score label that sits above the basket.
  private drawHoopLabel(): void {
    const label = this.scoringLabel;
    if (!label) return;
    const ud = label.userData as { canvas?: HTMLCanvasElement; ctx?: CanvasRenderingContext2D; tex?: THREE.CanvasTexture };
    if (!ud.canvas || !ud.ctx || !ud.tex) return;
    const { canvas, ctx } = ud;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(String(this.hoopScore), cx + 2, cy + 3);
    ctx.fillStyle = '#ffd23f';
    ctx.fillText(String(this.hoopScore), cx, cy);
    ud.tex.needsUpdate = true;
  }

  // The unicycle: movement mode + a visual pinned under the camera.
  private setWheelMode(on: boolean): void {
    setWheel(on);
    if (on) {
      if (!this.wheelMesh) {
        const { group, spin } = this.makeUnicycle();
        this.wheelMesh = group;
        this.wheelSpinG = spin;
        this.scene.add(group);
        this.wheelPrev.set(this.camera.position.x, this.camera.position.z);
      }
    } else if (this.wheelMesh) {
      this.scene.remove(this.wheelMesh);
      this.wheelMesh = null;
      this.wheelSpinG = null;
    }
  }

  private updateWheelVisual(): void {
    const w = this.wheelMesh;
    if (!w) return;
    const cam = this.camera.position;
    w.position.set(cam.x, cam.y - CONFIG.PLAYER_HEIGHT, cam.z); // at your feet
    w.rotation.y = getYaw();
    // roll the wheel by how far you moved along your facing
    const dx = cam.x - this.wheelPrev.x;
    const dz = cam.z - this.wheelPrev.y;
    const fwd = getForwardXZ(this.forward);
    if (this.wheelSpinG) this.wheelSpinG.rotation.x -= (dx * fwd.x + dz * fwd.z) / 0.42;
    this.wheelPrev.set(cam.x, cam.z);
  }

  private makeUnicycle(): { group: THREE.Group; spin: THREE.Group } {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9, flatShading: true });
    const metal = new THREE.MeshStandardMaterial({ color: 0xb0b4bd, metalness: 0.7, roughness: 0.4, flatShading: true });
    const seatMat = new THREE.MeshStandardMaterial({ color: 0x7a1414, roughness: 0.7 });
    const spin = new THREE.Group(); // the rolling part (tyre + hub + pedals)
    spin.position.y = 0.42;
    g.add(spin);
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.12, 12, 24), dark);
    tyre.rotation.y = Math.PI / 2; // axle left-right → rolls forward
    spin.add(tyre);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.2, 8), metal);
    hub.rotation.z = Math.PI / 2;
    spin.add(hub);
    for (const s of [-1, 1]) {
      const ped = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.09), metal);
      ped.position.set(s * 0.18, 0, 0);
      spin.add(ped);
    }
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), metal);
    fork.position.y = 0.42 + 0.27;
    g.add(fork);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.2), seatMat);
    seat.position.y = 0.42 + 0.55;
    g.add(seat);
    return { group: g, spin };
  }

  private flyStep(dt: number): void {
    // You steer by looking: the horizontal velocity rotates toward where the
    // camera faces, keeping its speed; gravity arcs you down.
    updateLook(this.camera, this.input);
    const sp = Math.hypot(this.launchVel.x, this.launchVel.z);
    if (sp > 0.01) {
      const fwd = getForwardXZ(this.forward);
      let dx = this.launchVel.x / sp + fwd.x * FLIGHT_STEER * dt;
      let dz = this.launchVel.z / sp + fwd.z * FLIGHT_STEER * dt;
      const nl = Math.hypot(dx, dz) || 1;
      this.launchVel.x = (dx / nl) * sp;
      this.launchVel.z = (dz / nl) * sp;
    }
    this.launchVel.y -= FLIGHT_GRAVITY * dt;
    this.flightPrev.copy(this.camera.position);
    this.camera.position.addScaledVector(this.launchVel, dt);

    const p = this.camera.position;
    // Slam into an elevated room's wall mid-flight → dead, chalk left on the wall.
    // Swept (segment) test, not point-in-box: at launch speed you cover over a
    // metre per frame, enough to pass clean through a thin wall between samples.
    const walls = this.current?.flightWalls;
    if (walls) {
      for (const wbox of walls) {
        const tHit = segmentBoxEntry(this.flightPrev, p, wbox);
        if (tHit !== null) {
          p.copy(this.flightPrev).addScaledVector(this.launchVel, tHit * dt);
          this.airborne = false;
          this.die('wall', { pos: p.clone(), dir: this.launchVel.clone() });
          return;
        }
      }
    }
    const regions = this.current?.regions ?? (this.current ? [this.current.bounds] : []);
    const fy = floorYAt(p.x, p.z, p.y, regions);
    // Land on the ground anytime; land on an elevated floor only while DESCENDING
    // (so you can't pop up onto a platform from underneath).
    if (fy !== null && p.y <= fy + CONFIG.PLAYER_HEIGHT && (fy < 0.5 || this.launchVel.y <= 0)) {
      p.y = fy + CONFIG.PLAYER_HEIGHT;
      this.airborne = false;
      this.current?.onLand?.(p.clone());
    } else if (fy === null && p.y < -4) {
      // Sailed past the edge and fell into the void.
      this.airborne = false;
      this.die('void');
    }
  }

  private updateFade(dt: number): void {
    const speed = 3.2; // ~0.3s fades
    if (this.fadeValue < this.fadeTarget) {
      this.fadeValue = Math.min(this.fadeTarget, this.fadeValue + speed * dt);
    } else if (this.fadeValue > this.fadeTarget) {
      this.fadeValue = Math.max(this.fadeTarget, this.fadeValue - speed * dt);
    }
    this.fadeEl.style.opacity = String(this.fadeValue);
    if (this.pendingLevel && this.fadeValue >= 1) {
      this.loadLevel(this.pendingLevel);
      this.pendingLevel = null;
      this.fadeTarget = 0;
    }
  }
}
