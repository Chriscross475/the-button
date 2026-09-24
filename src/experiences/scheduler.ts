// A tiny per-frame updater pool. Experiences animate by pushing an updater
// here; main ticks them all each frame. An updater returns true when it's
// finished and should be dropped (e.g. confetti that has faded out). Long-
// lived things (settled ducks, grown trees) simply never get an updater, or
// their updater returns true once they reach rest.

export type Updater = (dt: number) => boolean;

const updaters: Updater[] = [];
let generation = 0; // bumped whenever the pool is cleared (a level transition)

export function addUpdater(u: Updater): void {
  updaters.push(u);
}

export function tickUpdaters(dt: number): void {
  const gen = generation;
  for (let i = updaters.length - 1; i >= 0; i--) {
    // An updater may trigger a level transition (advance), which clears the pool
    // and repopulates it with the NEW level's updaters. Stop the moment that
    // happens — the stale index would otherwise read garbage / the new pool.
    if (generation !== gen) break;
    let done = false;
    try {
      done = updaters[i](dt);
    } catch (err) {
      console.error('updater error', err);
      done = true;
    }
    if (generation !== gen) break;
    if (done) updaters.splice(i, 1);
  }
}

export function clearUpdaters(): void {
  updaters.length = 0;
  generation++;
}

/** The current updater-pool generation; bumps on every level transition. Lets
 *  callers detect "the world I scheduled against is gone" (see defineReveal). */
export function currentGeneration(): number {
  return generation;
}

// Room-press listeners: things a gag leaves in the white room that change on
// every LATER press of its button (a plant that grows, a tally that counts).
// Dropped with the updater pool, like everything else in the room.
const pressListeners: { gen: number; fn: () => void }[] = [];

/** Call `fn` on every later press of the white room's button, until the room
 *  is left. */
export function onRoomPress(fn: () => void): void {
  pressListeners.push({ gen: generation, fn });
}

/** The white room's button was pressed (the hub calls this before the press
 *  picks its experience). */
export function notifyRoomPress(): void {
  for (let i = pressListeners.length - 1; i >= 0; i--) {
    if (pressListeners[i].gen !== generation) pressListeners.splice(i, 1);
  }
  for (const l of [...pressListeners]) l.fn();
}

/** Run `fn` once after `ms` of GAME time, through the updater pool — so a level
 *  transition cancels it automatically. Content must use this (via ctx.after)
 *  instead of window.setTimeout, which outlives the level and fires into the
 *  next one (e.g. registering a combine target in a room that no longer exists). */
export function after(ms: number, fn: () => void): void {
  let t = 0;
  addUpdater((dt) => {
    t += dt * 1000;
    if (t < ms) return false;
    fn();
    return true;
  });
}
