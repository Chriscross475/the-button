import type { GameContext } from '../game/types';

// The experience plugin system. Each press of a button picks one experience at
// (weighted) random and runs it. An experience gets the full GameContext —
// scene, player position, helpers to add collision / spawn buttons, the
// narrator, and (for bigger experiences) level transitions. Adding a new
// experience is one new file + one registerExperience() call; no engine edits.

export type ExperienceContext = GameContext;

export interface Experience {
  id: string;
  /** Relative likelihood of being chosen. Default 1. Weight 0 = NEVER picked
   *  at the button — the experience is only reachable via advanceTo(id)
   *  (e.g. the slingshot yard, entered by walking up from the tunnel). */
  weight?: number;
  run: (ctx: ExperienceContext) => void;
}

const experiences: Experience[] = [];
let lastId: string | null = null;

export function registerExperience(e: Experience): void {
  experiences.push(e);
}

export function experienceCount(): number {
  return experiences.length;
}

export function getExperience(id: string): Experience | undefined {
  return experiences.find((e) => e.id === id);
}

/** Record the last-run experience so the next pick won't immediately repeat it
 *  (used when a non-random transition runs a specific experience). */
export function setLastExperience(id: string): void {
  lastId = id;
}

/** Weighted random pick that never immediately repeats the last experience.
 *  Weight-0 experiences are excluded entirely (they're advanceTo-only). */
export function pickExperience(): Experience | null {
  const pickable = experiences.filter((e) => (e.weight ?? 1) > 0);
  if (pickable.length === 0) return null;
  // Exclude the last-run experience entirely (unless it's the only one).
  const pool = pickable.length > 1 ? pickable.filter((e) => e.id !== lastId) : pickable;
  const total = pool.reduce((s, e) => s + (e.weight ?? 1), 0);
  let r = Math.random() * total;
  let chosen = pool[pool.length - 1];
  for (const e of pool) {
    r -= e.weight ?? 1;
    if (r <= 0) {
      chosen = e;
      break;
    }
  }
  lastId = chosen.id;
  return chosen;
}
