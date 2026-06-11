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
  `src/objects/` (stateful world things that own their behaviour — duck, axe,
  money), `src/levels/` (scene builders), `src/experiences/` (button gags + level
  wrappers).

**Golden rule:** *no object in the world should be one-level-only.* Reusable
geometry lives in the **asset registry** (§2); a thing's *behaviour* lives **with
the thing** — on the asset (`train.ts` → `trainStrike`) or as an object (§2b),
never forked per level. There is no "forest duck", only **the duck** (§2b).

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

## 2b. Objects (`src/objects/`) — behaviour lives on the OBJECT

`assets/` is pure geometry. **`objects/`** holds the *stateful, behavioural*
world things: a single self-contained definition that owns ALL of its behaviour
and is the same in every level. Currently `duck.ts`, `axe.ts`, `money.ts`.

**The golden rule:** there is no "forest duck" and "duck-room duck" — there is
**the duck**. If a behaviour shows up in one level but not another, that's the
bug: move it onto the object. Level-specific reactions ride an **opt hook**
(`spawnDuck(ctx, x, z, { onLand })`, `spawnAxe(ctx, pos, { onSwing })`), not a
fork of the object.

**Persistence = the player CARRIED it.** A `persistent` carryable held in hand
crosses into the next level with all its properties; things set down drop with
the level. A carried object re-establishes its per-level hooks (wander, combine
targets) via `onEnterLevel` on the carryable — so it arrives fully alive.

### Add an object
1. `src/objects/thing.ts`: `export function spawnThing(ctx, x, z, opts?) { … }`
   — build via `createAsset`, register a `ctx.addCarryable({ kind, object,
   persistent?, projectile?, onEnterLevel?, … })`, wire its global combines with
   `defineCombine`, and put level-specific reactions behind `opts` hooks.
2. Throwables: declare `projectile: { radius, restitution?, gravity? }` and the
   engine flies it (gravity + floor/wall/obstacle bounce) — no per-level updater.

---

## 3. Levels & Experiences (`src/levels/`, `src/experiences/`)

Two tiers, both registered as **Experiences** (the button picks one at weighted
random):

- **Gag** — a small in-room effect. Just `{ id, weight, run(ctx) }`.
  (`weight: 0` keeps an experience OUT of the button's random pool — it's then
  only reachable via `advanceTo(id)`, like the slingshot yard from the tunnel.)
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

### The level kit (`src/levels/scaffold.ts`) — reuse, don't re-derive
Shared primitives so a new level is *assembly*, not geometry from scratch:
- `groundPlane()` — dark floor with the z-fight-safe polygonOffset.
- `walkThroughPortal(ctx, { zone, to, ref, entry? })` — registers the one-shot
  updater that fires `advanceTo` when the player enters `zone`. **Use this for
  every walk-through portal** (tunnel↔tunnel, crack↔forest) — don't hand-roll
  the updater + bounds check.
- `rewardPlinth(root, pos)` — the stone base/column/cap a prize sits on.
- `crackedWall(root, pos, facingY)` — a dark recess + scattered rubble marking a
  walk-through hole; pair with `walkThroughPortal` + a `ctx.entry` spawn.
When two levels need the same shape, **add a kit primitive** rather than copy it.

---

## 4. The GameContext API (`ctx`, see `src/game/types.ts`)

Reachable **two ways** — both are live and both call the *same* function, so use
whichever reads better and never worry about keeping them in sync:
- **flat** (the original, used everywhere): `ctx.narrate(...)`, `ctx.advanceTo(...)`.
- **namespaced** (organized by section): `ctx.narration.narrate(...)`,
  `ctx.nav.advanceTo(...)`.

`attachNamespaces()` (`src/game/ctx-namespaces.ts`) wires the namespaces onto the
flat object at construction; live props (`levelRoot`/`bounds`/`entry`) forward
through getters so they never go stale. The 9 sections (`ctx.<namespace>` → members):
- **`world`** — World & frame: `scene`, `camera`, `levelRoot`, `playerPos()`.
- **`narration`** — Narration & timing: `narrate(text, holdMs?, { priority?, interruptible? })`;
  `after(ms, fn)` — a delayed callback a level transition cancels automatically.
  **Never use `window.setTimeout` in content** — it outlives the level and fires
  into the next one.
- **`nav`** — Transitions & portals: `goToLevel(id)`, `returnToHub()`, `advance(buttonPos?)`,
  `advanceTo(id, buttonPos?, entry?)`, `entry`, `spawnAt(ground, yaw)`.
- **`room`** — The room shell + button: `openRoom(opts?)`, `setRoomButton(fn)`,
  `sinkRoomButton()`, `spawnButton(pos)`.
- **`region`** — Movement region & collision: `bounds`, `setBounds`, `setRegions`,
  `addObstacle/removeObstacle`, `setLanding`, `setFlightWalls`.
- **`physics`** — Player physics & death: `launchPlayer`, `die`, `isAirborne`, `isDead`.
- **`carry`** — Carry & combine: `addCarryable/removeCarryable`, `addTarget/removeTarget`,
  `isHolding`, `consumeHeld`, `heldKind`, `putInHand`, `launchProjectile`.
- **`companions`** — Companions & followers: `setCompanion`, `setScoringHoop`.
- **`modes`** — Movement modes: `setWheel`, `setControlMode`.

---

## 5. Transitions, exits & portals

- The new room's button is always at `(0,0,-2)`. `advance(buttonPos)` keeps the
  player's offset from `buttonPos`; **a bare `advance()` stands them clear** of
  the new button (don't pass the player's own position).
- **Button exit**: `spawnPedestalButton(root, pos, () => ctx.advance(pos))`.
- **Walk-through portal** (e.g. slingshot→tunnel): `walkThroughPortal(ctx, {
  zone, to, ref, entry })` (§3 kit). The destination reads `ctx.entry` and calls
  `ctx.spawnAt(ground, yaw)` to step the player out of its matching portal.
- **Entry-spawn yaw** (radians, world): `0` faces −Z, `π` faces +Z, `π/2` faces
  −X, `3π/2` faces +X. (Cylinder convention `x=r·sinθ, z=r·cosθ` — the circus
  opening bug came from forgetting this.)

---

## 6. Items, combos, interactables (`src/game/combine.ts`, `src/interactables/`)

- **Carryable**: `ctx.addCarryable({ kind, object, heldDist?, onGrab?, onTap?, onThrow?(charge), onRelease?, persistent? })`. Dual hands; tap < 250ms vs hold-release = throw. Add a display name in `src/ui/hands.ts`.
- **Combo**: `defineCombine(toolKind, targetKind, (held, target, env) => boolean)` (global; return `true` to keep the tool). Register the target per-level: `ctx.addTarget({ kind, position, radius })`. Existing combos: axe+wood/stone-block/plank/*-fence, pickaxe+stone-block, duck+campfire, key+door-lock, cooked-duck+stand.
- **Interactable** (PRESS prompt): `registerInteractable({ id, position, radius, promptLabel, onUse, tick?, canUse?, built? })`; set `.destroyed = true` to remove.

---

## 7. Narration & voice (`src/ui/narrator.ts`, `src/audio/`)

- `narrate(text, holdMs, opts)`: queues; `priority` interrupts; `interruptible`
  marks a low-prio line the next line replaces at once (the idle intro).
- **Voice is pre-baked.** `npm run vo` (self-contained: in-process kokoro-js,
  no server needed; first run downloads the model) scans the source for
  `narrate('literal')` and `vo(...)` lines, synthesises each (kokoro `bm_george`,
  tuned pauses baked in), writes `public/vo/<hash>.wav` + `src/audio/vo-manifest.json`.
  Runtime plays the bundled WAV instantly; falls back to live `/api/tts` then Web Speech.
- **Rules:** keep spoken lines **fixed strings** (no `${}`) so they bake; put
  dynamic numbers in the HUD, not the voice line. Inline `narrate('literal')`
  calls bake automatically; lines stored in a `const` / rotation array / record
  must be wrapped in **`vo(...)`** (`src/audio/vo-shared.ts`) — the scanner
  extracts every string literal inside the marker. Re-run `npm run vo` and
  commit the WAVs + manifest after adding/editing a line.

---

## 8. Conventions & footguns (handled for you)

- `groundPlane()` — dark floor with the right polygonOffset (no hub-floor z-fight).
- `hideRoomShell(ctx)` — drop the white shell `openRoom()` leaves behind.
- `defineLevel()` — bakes in openRoom + hideRoomShell + the double-reveal guard.
- Bare `advance()` already stands the player clear of the new button.
- Per-frame logic: `addUpdater(dt => done)` from `src/experiences/scheduler.ts`
  (auto-cleared on level change; return `true` to stop).

---

## 9. Quality gates & performance

**Before you commit content, run `npm run verify`** (`tsc --noEmit` + the smoke
harness). The two layers catch different things:
- **`tsc`** — types. The flat `ctx` contract + `Carryable`/`CombineTarget` shapes
  mean a wrong field is a compile error, not a runtime surprise.
- **`npm run smoke`** (`scripts/smoke.ts`) — a headless Node run that mocks the
  DOM + AudioContext, then **builds every asset, the hub, and every experience**
  against a recording mock `ctx`. It fails on any throw or null. This is what
  proves a new asset/level/gag at least *constructs* without a browser — green
  output is `smoke: N built, 0 failed`. Add nothing to wire it up; registering
  your asset/experience is enough for the harness to exercise it.

**Performance rules (this is a mobile target):**
- **No per-instance dynamic `PointLight`s.** Each one forces a scene-wide shader
  recompile hitch on add (the campfire/train lag). Fake glow with an emissive
  material (`glow()` in `palette.ts`) or share ONE light.
- **Fresh geometry/materials per asset instance.** `disposeTree` frees a level's
  geometry/materials on exit; a shared singleton would be disposed out from under
  the next level. `createAsset` already returns fresh — don't cache and reuse.
- **Throwables use the engine projectile** (`projectile` on the carryable /
  `ctx.launchProjectile`), not a per-level `setInterval`/updater — one physics
  path, identical in every level.

---

## 10. The content map & progress (`src/graph/`)

An interactive node diagram of how everything connects — levels, items,
mechanics, combines, portals, reward path-ends — served as a second page at
**`/button/graph.html`** (linked from the menu as *THE MAP*). It triples as a
player progress tracker, an explore-what's-left map, and the **design map for
adding content** (human or AI).

- **`content-graph.ts`** — THE single source of truth: `nodes` (each `id`
  namespaced `lvl:/gag:/item:/mech:/reward:/fx:`) + `edges` (`combine`, `portal`,
  `spawns`, `reward`, `enables`, …). **When you add an item / level / combine /
  reward, add its node + edges here.** A smoke check (§9) fails if a `defineCombine`
  in code has no matching node — so the map can't silently drift.
- **Fog of war**: the page shows ALL nodes (you see the shape of what's left) but
  anonymises any you haven't discovered (`?`, no name/details). A *Reveal all*
  toggle lifts the fog → the full design map (use this when building).
- **`progress.ts`** — discovery store (localStorage, shared with the game). The
  game reveals nodes automatically: entering a level (`discoverExp`), grabbing an
  item (`discoverItem`), combining (`discoverTarget`). For a reward/effect with no
  grab/combine, call **`discover('reward:…')`** at the moment it's earned (see
  circus `setWheel`, basketball `endGame`, duck-room baby wolf).
- Nodes are revealed by the `keys` they declare (`exp`/`item`/`target` runtime
  strings) — namespaced so the `basketball` level and the ball item never collide.

---

## 11. Build / deploy

```sh
npm run dev          # localhost:5173 (Vite proxies /api/tts → :37777)
npm run vo           # re-bake narration WAVs (needs local kokoro)
npm run build        # tsc + vite → dist/  (base '/button/')
# deploy: scp dist/* → ubuntu@<oracle>:/var/www/button (see README)
```
