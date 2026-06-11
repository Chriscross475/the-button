// Discovery progress — which content-graph nodes the player has uncovered. The
// GAME writes (on entering a level, grabbing an item, combining, earning a
// reward); the GRAPH PAGE reads (to light up discovered nodes and anonymise the
// rest). Both share this localStorage key since they're the same origin.

import { EXP_INDEX, ITEM_INDEX, TARGET_INDEX } from './content-graph';

const KEY = 'tb:discovered:v1';
const listeners = new Set<(ids: Set<string>) => void>();

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

let current = read();
// hub is always known — it's where you start.
if (!current.has('lvl:hub')) current.add('lvl:hub');

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...current]));
  } catch {
    /* no localStorage (smoke harness / private mode) — keep it in memory */
  }
}

/** Mark one or more node ids discovered. No-ops for ids already known. */
export function discover(...ids: string[]): void {
  let changed = false;
  for (const id of ids) if (!current.has(id)) (current.add(id), (changed = true));
  if (!changed) return;
  persist();
  for (const cb of listeners) cb(new Set(current));
}

/** Reveal by runtime key (collision-safe — separate namespaces per event). */
export const discoverExp = (expId: string) => discover(...(EXP_INDEX.get(expId) ?? []));
export const discoverItem = (kind: string) => discover(...(ITEM_INDEX.get(kind) ?? []));
export const discoverTarget = (kind: string) => discover(...(TARGET_INDEX.get(kind) ?? []));

export function discovered(): Set<string> {
  return new Set(current);
}
export function isDiscovered(id: string): boolean {
  return current.has(id);
}

export function resetProgress(): void {
  current = new Set(['lvl:hub']);
  persist();
  for (const cb of listeners) cb(new Set(current));
}

/** Subscribe to discovery changes (also fires on cross-tab storage events). */
export function onProgress(cb: (ids: Set<string>) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Cross-tab: if the game (another tab) discovers something, refresh + notify.
try {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = read();
    if (!current.has('lvl:hub')) current.add('lvl:hub');
    for (const cb of listeners) cb(new Set(current));
  });
} catch {
  /* no window (smoke harness) */
}
