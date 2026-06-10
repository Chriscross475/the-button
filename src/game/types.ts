import type * as THREE from 'three';
import type { RoomBounds, Obstacle } from '../controls/player-camera';
import type { Carryable, CombineTarget } from './combine';
import type { InputState } from '../controls/input-types';

// A control mode takes over the camera + input each frame (instead of normal
// walking) — e.g. operating the slingshot turret. The level installs it via
// ctx.setControlMode and clears it (null) to hand control back.
export interface ControlMode {
  /** Drive the camera + read input each frame; replaces player movement. */
  update: (dt: number, input: InputState) => void;
  /** The interact button (E / Space) was pressed while operating. */
  onInteract?: () => void;
}

export type WallDir = 'back' | 'front' | 'left' | 'right';

/** An axis-aligned box that KILLS the player on contact while airborne (e.g. the
 *  wall of an elevated room you smack into mid-launch). */
export interface FlightWall {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface RoomOpenOpts {
  /** true = all walls, false = none, or a list of sides to drop. Default true. */
  walls?: boolean | WallDir[];
  /** Float the ceiling away (default true). */
  ceiling?: boolean;
  /** Dim the bright room lights (default = whether any wall opens). */
  dimLights?: boolean;
  /** Keep the room's button instead of sinking it (e.g. when the button itself
   *  becomes the level's device, like the duck dispenser). */
  keepButton?: boolean;
}

// The context handed to every level and every experience. It's the whole API
// surface for "affect the world": spawn things, move between levels, launch or
// kill the player, talk. The Game controller owns the single instance and
// repoints `bounds` whenever the active level changes.

export interface GameContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Root group of the ACTIVE level — parent things here so they dispose with
   *  the level on exit. Repointed by the Game on every level change. */
  levelRoot: THREE.Object3D;
  /** Narrator line (shown + spoken). `priority` clears the queue + interrupts
   *  the current line so a timing-critical reaction plays immediately.
   *  `interruptible` marks a low-priority line the next one replaces at once. */
  narrate: (text: string, holdMs?: number, opts?: { priority?: boolean; interruptible?: boolean }) => void;
  /** Run `fn` once after `ms` of game time. Cancelled automatically on level
   *  change — use this instead of window.setTimeout for anything that touches
   *  the world, or the callback fires into the NEXT level. */
  after: (ms: number, fn: () => void) => void;
  /** Live player position (do not mutate). */
  playerPos: () => THREE.Vector3;
  /** Active level's collision bounds (live — reflects setBounds/setRegions). */
  readonly bounds: RoomBounds;
  /** Add a circular collision obstacle to the ACTIVE level. */
  addObstacle: (o: Obstacle) => void;
  /** Remove a previously-added obstacle (e.g. when the button sinks away). */
  removeObstacle: (o: Obstacle) => void;
  /** Spawn another button in the active level; uses the level's default press
   *  handler (in the hub: run a random experience). */
  spawnButton: (pos: THREE.Vector3) => void;
  /** Transition to a registered level by id (fade out/in). */
  goToLevel: (id: string) => void;
  /** Shortcut for goToLevel('hub'). */
  returnToHub: () => void;
  /** End-room button: become a fresh enclosed start room and IMMEDIATELY run the
   *  next level's transform on it (the old level despawns, the opening seals).
   *  Pass the pressed button's world position so the player keeps their offset
   *  from it (the room transforms around them instead of teleporting them). */
  advance: (buttonPos?: THREE.Vector3) => void;
  /** Like advance, but transition to a SPECIFIC experience (e.g. stepping
   *  through a broken-wall hole into the forest). */
  advanceTo: (expId: string, buttonPos?: THREE.Vector3) => void;
  /** Launch the player ballistically — the train. Velocity in m/s. */
  launchPlayer: (vel: THREE.Vector3) => void;
  /** Kill the player: spectator death, then restart in the hub. */
  die: (cause?: string) => void;
  /** Open the current room in place — topple its walls, float the ceiling —
   *  revealing the environment around it. `walls` can be `true` (all),
   *  `false` (none), or a list of sides to drop (e.g. ['back'] for just the
   *  wall the player faces). No-op if the level has no room. */
  openRoom: (opts?: RoomOpenOpts) => void;
  /** Re-point the room's recurring button to a new action (e.g. make it the duck
   *  dispenser). Used with openRoom({ keepButton: true }). */
  setRoomButton: (onPress: () => void) => void;
  /** Sink + disable the room's recurring pedestal button (e.g. a level removes it
   *  entirely instead of repurposing it). No-op if the level has no room button. */
  sinkRoomButton: () => void;
  /** The GLOBAL dual-hand carry system. Register a level's grabbable items /
   *  combine targets here; the Game drives grab / hold / throw / combine and
   *  clears the registry on every level change. */
  addCarryable: (c: Carryable) => void;
  removeCarryable: (c: Carryable) => void;
  addTarget: (t: CombineTarget) => void;
  removeTarget: (t: CombineTarget) => void;
  /** True if either hand is currently holding an item of this kind. */
  isHolding: (kind: string) => boolean;
  /** Remove one held item of this kind (e.g. a duck crushed to soften a train). */
  consumeHeld: (kind: string) => boolean;
  /** The kind held in a given hand, or null. */
  heldKind: (side: 'left' | 'right') => string | null;
  /** Put an item directly into a hand (e.g. restock a basketball). */
  putInHand: (side: 'left' | 'right', c: Carryable) => void;
  /** A pet/object that follows the player AND survives level transitions (the
   *  baby wolf; the kept basket). Parented to the scene; the Game drives the
   *  follow + faces it at the player. `baseY` floats it at a height (e.g. a
   *  basket at chest level you can still toss into); default ground level. */
  setCompanion: (mesh: THREE.Object3D, baseY?: number) => void;
  /** The unicycle: hands-free movement that's faster but slides (inertia).
   *  Reset on every level change. */
  setWheel: (on: boolean) => void;
  /** Take over camera + input (e.g. operating the slingshot turret). Pass null
   *  to hand control back to normal walking. */
  setControlMode: (cm: ControlMode | null) => void;
  /** Replace the active movement region with a single rectangle. */
  setBounds: (b: RoomBounds) => void;
  /** Replace the active movement regions with a union of rectangles (e.g. a
   *  wide room joined to a narrower corridor). Regions should overlap at seams. */
  setRegions: (regions: RoomBounds[]) => void;
  /** Install flight landing handlers used after a launch (pad vs. void). */
  setLanding: (
    onLand: (pos: THREE.Vector3) => void,
    isOverSolid: (x: number, z: number) => boolean,
  ) => void;
  /** Boxes that kill the player mid-flight on contact (e.g. a wall you slam into
   *  when launched from too close). Leaves the chalk outline ON the wall. */
  setFlightWalls: (walls: FlightWall[]) => void;
  /** True while the player is mid-flight (post-launch). */
  isAirborne: () => boolean;
  /** True while dead (awaiting restart). */
  isDead: () => boolean;
}

export interface LevelInstance {
  /** Root holding all level content; removed from the scene on exit. */
  root: THREE.Object3D;
  bounds: RoomBounds;
  /** Optional multi-rectangle walkable area (overrides `bounds` when set). */
  regions?: RoomBounds[];
  obstacles: Obstacle[];
  spawn: { pos: THREE.Vector3; yaw: number };
  /** Default handler for buttons spawned via ctx.spawnButton in this level. */
  defaultButtonPress?: () => void;
  /** Reveal hook — opens this level's room (set by the hub). */
  openRoom?: (opts?: RoomOpenOpts) => void;
  /** Re-point the room's button action (set by the hub). */
  setButtonAction?: (fn: () => void) => void;
  /** Sink + disable the room's recurring pedestal button (set by the hub). */
  sinkButton?: () => void;
  /** Per-frame logic (train, lightning). Runs even while dead so the world
   *  keeps simulating; gate on ctx.isDead() inside if needed. */
  update?: (dt: number) => void;
  /** Called when the player touches down on solid footing after a launch, with
   *  the landing position. The level decides the consequence (safe pad vs.
   *  death). */
  onLand?: (pos: THREE.Vector3) => void;
  /** Is (x,z) over solid footing? Used during flight: landing over solid →
   *  onLand; flying out over a void → keep falling → death. Default: solid
   *  everywhere (no voids). */
  isOverSolid?: (x: number, z: number) => boolean;
  /** Boxes that kill the player on contact while airborne. */
  flightWalls?: FlightWall[];
  /** Cleanup on exit. */
  dispose?: () => void;
}

export interface Level {
  id: string;
  build: (ctx: GameContext) => LevelInstance;
}
