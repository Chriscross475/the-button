# The Button — Architecture & Content Guide

A first-person comedic web game (TypeScript + Three.js + Vite). One room, one
button; pressing it transforms the room into a gag or a full level. All geometry
is code-generated; the only binary assets are audio.

This doc is the **contract for adding content**. It's written so a human *or* an
LLM can add a new asset / level / item / combo / voice line by following one
clear recipe, without reverse-engineering the engine.

---

## 1. Engine vs Content

- **Engine** (don't edit to add content): `src/game/` (the controller, GameContext,
  the carry/combine system), `src/room/` (white room + openRoom), `src/interactables/`,
  `src/experiences/scheduler.ts` (per-frame updaters), `src/ui/`, `src/audio/`,
  `src/controls/`.
- **Content** (this is where you add things): `src/assets/` (reusable geometry),
  `src/levels/` (scene builders), `src/experiences/` (button gags + level wrappers).

**Golden rule:** *no object in the world should be one-level-only.* Reusable
geometry lives in the **asset registry**; behaviour that's the same everywhere
lives **with the asset** (see `train.ts` → `trainStrike`).

---

## 2. Assets (`src/assets/`)

A registry of **procedural factories** keyed by id. Each `createAsset(id, params?)`
returns a FRESH `Object3D` (own geometry/materials — safe to mutate).

- `registry.ts` — `defineAsset(id, fn)`, `createAsset(id, params?)`, `hasAsset`, `assetIds()`.
- `library.ts` — simple props (duck, axe, key, tree, campfire, statue, rock, …).
- `infra.ts` — parameterized: `track` (rails along a spline), `tunnel-face` (arched rock wall).
- `train.ts` — the train geometry **and** `trainStrike(ctx, pos, knockback)` (its behaviour).
- `palette.ts` — `COLOR` (named hexes) + material helpers `flat/matte/metal/glow`. **Use these instead of new hex literals.**

### Add a simple asset
1. In `library.ts`, write `function makeThing(): THREE.Group { … use COLOR/flat() … }`.
2. Register at the bottom: `defineAsset('thing', makeThing);`.
3. Use: `createAsset('thing')`.

### Add a parameterized (procedural) asset
1. Define `export interface ThingParams { … }` (in `infra.ts` or a new file).
2. `defineAsset('thing', (p?: ThingParams) => { const x = p?.x ?? default; … });`
3. Prefer params over internal `Math.random()` so it's deterministic + reusable.

### Add a composition (asset built from assets)
Assemble inside a factory; tag retrievable sub-parts with `.name`:
```ts
function makeAxeInTrunk() { const g = new THREE.Group();
  const stump = makeStump(); stump.name = 'stump'; g.add(stump);
  const axe = makeAxe(); axe.name = 'axe'; axe.position.set(…); g.add(axe);
  return g; }
// later: comp.getObjectByName('axe')
```

---

## 3. Levels & Experiences (`src/levels/`, `src/experiences/`)

Two tiers, both registered as **Experiences** (the button picks one at weighted
random):

- **Gag** — a small in-room effect. Just `{ id, weight, run(ctx) }`.
- **Level** — opens the white room into a full scene. Use **`defineLevel()`**
  (`src/levels/scaffold.ts`), which opens the room, hides the white shell, guards
  double-reveal, then runs your `build(ctx)`.

### Add a gag
1. `src/experiences/my-gag.ts`:
   ```ts
   import type { Experience } from './registry';
   export const myGag: Experience = { id: 'my-gag', weight: 1, run(ctx) {
     ctx.narrate('Something happens.'); /* spawn things via ctx */ } };
   ```
2. Register in `src/experiences/index.ts`: import + `registerExperience(myGag)`.

### Add a level
1. `src/levels/my-level.ts`:
   ```ts
   import { defineLevel, groundPlane } from './scaffold';
   import { COLOR } from '../assets/palette';
   export const myLevel = defineLevel({ id: 'my-level', weight: 1.2, build(ctx) {
     ctx.levelRoot.add(groundPlane());           // dark floor (no white z-fight)
     ctx.scene.background = new THREE.Color(COLOR.dark);
     // …terrain, props via createAsset(), an exit (see §5)…
   }});
   ```
2. Register in `src/experiences/index.ts`.

`defineLevel` handles: `openRoom()`, `hideRoomShell()`, the reveal guard. You
just `build`.

---

## 4. The GameContext API (`ctx`, see `src/game/types.ts`)

Everything a level/experience can do, grouped:
- **World**: `scene`, `camera`, `levelRoot`, `playerPos()`.
- **Narration**: `narrate(text, holdMs?, { priority?, interruptible? })`.
- **Transitions**: `advance(buttonPos?)`, `advanceTo(id, buttonPos?)`, `goToLevel(id)`, `returnToHub()`, `openRoom(opts?)`.
- **Room button**: `setRoomButton(fn)`, `sinkRoomButton()`, `spawnButton(pos)`.
- **Bounds/physics**: `bounds`, `setBounds`, `setRegions`, `addObstacle/removeObstacle`, `setLanding`, `setFlightWalls`, `launchPlayer`, `die`, `isAirborne`, `isDead`.
- **Carry**: `addCarryable/removeCarryable`, `addTarget/removeTarget`, `isHolding`, `consumeHeld`, `heldKind`, `putInHand`.
- **Misc**: `setCompanion`, `setWheel`, `setControlMode`.
- **Timing**: `after(ms, fn)` — a delayed callback that a level transition
  cancels automatically. **Never use `window.setTimeout` in content** — it
  outlives the level and fires into the next one.

---

## 5. Transitions, exits & portals

- The new room's button is always at `(0,0,-2)`. `advance(buttonPos)` keeps the
  player's offset from `buttonPos`; **a bare `advance()` stands them clear** of
  the new button (don't pass the player's own position).
- **Button exit**: `spawnPedestalButton(root, pos, () => ctx.advance(pos))`.
- **Walk-through portal** (e.g. slingshot→tunnel): an updater that checks a zone
  and calls `ctx.advanceTo('other-level', refPos)`.

---

## 6. Items, combos, interactables (`src/game/combine.ts`, `src/interactables/`)

- **Carryable**: `ctx.addCarryable({ kind, object, heldDist?, onGrab?, onTap?, onThrow?(charge), onRelease?, persistent? })`. Dual hands; tap < 250ms vs hold-release = throw. Add a display name in `src/ui/hands.ts`.
- **Combo**: `defineCombine(toolKind, targetKind, (held, target, env) => boolean)` (global; return `true` to keep the tool). Register the target per-level: `ctx.addTarget({ kind, position, radius })`. Existing combos: axe+wood/stone-block/plank/*-fence, pickaxe+stone-block, duck+campfire, key+door-lock, cooked-duck+stand.
- **Interactable** (PRESS prompt): `registerInteractable({ id, position, radius, promptLabel, onUse, tick?, canUse?, built? })`; set `.destroyed = true` to remove.

---

## 7. Narration & voice (`src/ui/narrator.ts`, `src/audio/`)

- `narrate(text, holdMs, opts)`: queues; `priority` interrupts; `interruptible`
  marks a low-prio line the next line replaces at once (the idle intro).
- **Voice is pre-baked.** `npm run vo` (needs local kokoro at :37777) scans the
  source for `narrate('literal')`, synthesises each (kokoro `bm_george`, tuned
  pauses baked in), writes `public/vo/<hash>.wav` + `src/audio/vo-manifest.json`.
  Runtime plays the bundled WAV instantly; falls back to live `/api/tts` then Web Speech.
- **Rules:** keep spoken lines **fixed string literals** (no `${}`) so they bake;
  put dynamic numbers in the HUD, not the voice line. Re-run `npm run vo` and
  commit the WAVs + manifest after adding/editing a line.
  *(Known gap: lines stored in a `const`/`pick([...])` aren't baked yet — they
  use the slow live path. Prefer inline literals until the baker covers them.)*

---

## 8. Conventions & footguns (handled for you)

- `groundPlane()` — dark floor with the right polygonOffset (no hub-floor z-fight).
- `hideRoomShell(ctx)` — drop the white shell `openRoom()` leaves behind.
- `defineLevel()` — bakes in openRoom + hideRoomShell + the double-reveal guard.
- Bare `advance()` already stands the player clear of the new button.
- Per-frame logic: `addUpdater(dt => done)` from `src/experiences/scheduler.ts`
  (auto-cleared on level change; return `true` to stop).

---

## 9. Build / deploy

```sh
npm run dev          # localhost:5173 (Vite proxies /api/tts → :37777)
npm run vo           # re-bake narration WAVs (needs local kokoro)
npm run build        # tsc + vite → dist/  (base '/button/')
# deploy: scp dist/* → ubuntu@<oracle>:/var/www/button (see README)
```
