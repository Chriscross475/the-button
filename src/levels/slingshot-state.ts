// The slingshot is a GLOBAL machine: its setup persists across levels and feeds
// trains down whichever tunnel it's aimed at. The tunnel level (the 2-track
// side) only has trains while the slingshot is active AND aimed at it — so
// redirecting or switching it off at the yard makes the tunnel level safe.
//
// The four tunnels and what blocks them:
//   • 2 tracks — open; goes to the tunnel level.
//   • 1 track  — a wooden beam (break with the axe).
//   • 3 tracks — stone bricks (break with the pickaxe).
//   • 4 tracks — steel beams (no tool yet — blocked for now).

export type SlingDir = 'tunnel' | 'wood' | 'stone' | 'steel';

interface SlingState {
  active: boolean;
  direction: SlingDir;
  woodOpen: boolean;
  stoneOpen: boolean;
}

// Default: on, aimed at the tunnel level — so the tunnel level starts with trains.
const state: SlingState = { active: true, direction: 'tunnel', woodOpen: false, stoneOpen: false };

export function getSling(): Readonly<SlingState> {
  return state;
}
export function setSlingActive(a: boolean): void {
  state.active = a;
}
export function setSlingDir(d: SlingDir): void {
  state.direction = d;
}
export function openWood(): void {
  state.woodOpen = true;
}
export function openStone(): void {
  state.stoneOpen = true;
}

/** Is a given direction currently passable (its block cleared)? Steel never is. */
export function dirOpen(d: SlingDir): boolean {
  if (d === 'tunnel') return true;
  if (d === 'wood') return state.woodOpen;
  if (d === 'stone') return state.stoneOpen;
  return false; // steel
}

/** The tunnel level gets trains only while the slingshot feeds it. */
export function feedsTunnel(): boolean {
  return state.active && state.direction === 'tunnel';
}
