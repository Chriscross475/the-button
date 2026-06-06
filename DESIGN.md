# The Button — Design Notes

> A first-person comedic "experience" game. You stand in an empty white room
> with a pedestal and a red button. You press it. Something happens. Every
> press is a new bit — short or long, dumb or deadly. Stanley-Parable energy,
> a sarcastic narrator, and the occasional puzzle that you solve by dying.

Built on the engine extracted from **Delve** (Three.js + TS + Vite). Lives at
`~/repos/the-button`.

---

## The core loop: the white room is a HUB, and experiences live on a spectrum

The single most important structural choice. An experience is **not** always
"some props appear in the white room." Experiences span a **spectrum of scale**,
and the white room itself is allowed to change:

1. **In-room gags** — props/effects spawn in the white room. No goal.
   *Ducks, confetti, statue, color-flash, another-button, nothing.* (Built.)
2. **The room transforms / expands** — the white room itself is the stage: a
   wall slides away to reveal a new section, the ceiling lifts, the floor
   extends, the box grows into a hall. The hub is not fixed; it **accretes
   space** as you play.
3. **Separate levels** — a press opens a **door / portal** to a *whole different
   scene* (its own geometry, lighting, rules) — the mountain & train, the duck
   room. You leave the white room entirely and come back.

For #2 and #3, a press occasionally opens a **persistent door / change** that
**stays** once revealed, so you can re-enter and retry. The white room becomes a
**hub** that fills with doors and grows new wings — infinitely expandable, and
the thing that makes permadeath bearable and paths revisitable.

### Entry model (DECIDED — the in-place reveal)

No doors, no fade-to-black teleport. The white room is the **recurring node**,
present at the start of every level. When a press opens a level:

1. The **pedestal sinks** into the floor (button gone).
2. The **walls topple outward** and the **ceiling floats up** and fades.
3. The bright room lights dim; the level's environment (built lazily *now*, not
   pre-spawned) is revealed all around you. Your movement bounds expand.

So "you were already standing in the level the whole time." Built as
`openWhiteRoom()` + `ctx.openRoom()`. Every level is the same room with a
different **entry/reveal** and a different world beyond it; the goal of a level
is to reach the **next** room+button (levels chain through rooms).

Implemented via a `Game` controller + `GameContext` (the API every experience
& level uses): `openRoom({walls?,ceiling?})`, `setBounds()`, `setLanding()`,
`launchPlayer()`, `die()`, `spawnButton()`, `narrate()`, `returnToHub()`.

### Every experience is a LEVEL with a RESOLUTION

Reaching a level's resolution brings you to the next room+button. The
resolution can be anything:
- **trivial / a gag** — confetti, color-flash, statue, another-button, nothing.
  You're still in the room; press again. (No reveal.)
- **explore** — *Forest*: walls open onto a wide outdoor plain; find the exit
  clearing (next button under a beam) out in the woods.
- **quota / contained** — *Ducks*: ceiling-only reveal (walls stay), ducks rain
  in, a dispenser button makes more; hit the quota and the exit rises.
- **skill puzzle** — *Tunnel*: ride the train's launch onto the pad across the
  void. Miss = death.
- **traversal** — *Doors*: walk the corridor; each door opens its own way; reach
  the end button.

Future resolutions: combat, mini-games, etc. — same shape (do the thing → next
room).

---

## Path #1 — The Mountain & the Train (launch puzzle)

A door opens onto a **mountain with thunder rumbling inside it**. Two **train
tracks** run under it into **two tunnel mouths**. Lightning flashes telegraph
danger.

**The trap (taught by death):**
1. You walk into a tunnel mouth. Beat. Lightning + a horn.
2. A train screams out of the tunnel and **launches you backward** with huge
   force. You ragdoll through the air and **splat → dead**.
3. You restart in the hub, walk back through the door, try the *other* track —
   the train comes again, kills you again.

**The solution (the knockback IS the vehicle):**
- Far away, in the launch direction, there's a **glowing target pad with the
  next red button on it.** You're *supposed* to get hit — the point is to
  **steer your flight and land on the pad.**
- Proposed aim mechanic: **limited air-control** after the hit (mouse / joystick
  tilts your trajectory, like a glide). You see the pad, you steer, you land.
  Overshoot or undershoot = death. The two tracks launch you in different
  directions; only one can reach the pad (with steering).
- Land on the pad → press its button → the path continues. *"We'll see where it
  goes from there"* — paths **chain**: each segment ends on a button that opens
  the next.

**Why it works:** it's a pure Stanley-Parable "die to learn" puzzle. First death
teaches the launch; later deaths teach the aim. The thunder is both atmosphere
and the audio tell for the train.

**Open questions:** air-steering vs. picking the right track vs. timing-a-jump
as the "aim"? How forgiving is the landing?

**Engine prior art:** Delve already has a **knockback** system and a **death
sequence** (slow-mo + camera collapse) we can adapt instead of writing from
scratch.

---

## Path #2 — The Duck Room (a puzzle out of pure ducks)

You wanted: press → duck, press → more ducks, spawn **multiple buttons**, and
then *"something happens"* (solution TBD). A proposed solution that turns the
gag into a real puzzle:

**Pile to climb.** High on a wall (clearly visible, out of reach) is the **exit
/ next red button.** Ducks are solid physics bodies. The only way up is to
**spawn enough ducks to build a mound and climb the duck-mountain.**

This makes the *"another button"* gag a **tool**: every extra button is a **duck
factory** at its own location. You place/press multiple buttons to mass-produce
ducks and pile them *under the high exit*, then walk up the pile and out.

- Comedic counter: `DUCKS: 137`. Narrator escalates ("I'm not judging. …I'm
  judging.").
- The "something happens" beat at a threshold: a **giant mother duck** appears,
  or the pile reaches the button and the door unlocks with a triumphant quack.

**Open question:** pile-to-climb, or a different "something" (duck flood / weight
on a giant floor button / duck king tribute)?

---

## Path #2 — The Corridor of Doors (BUILT)

The "how many ways can a door open" experiment. The room opens into a long hall;
each segment ends in a door that opens a *different* way, and walking up to it
opens it. At the far end: a button (the next room).

- Door types live in a registry (`src/doors/door-types.ts`) — **12 so far**:
  swing, double-swing, slide-up, slide-down, slide-side, split, iris, bifold,
  drawbridge, revolve, roll-up, shrink. Adding a new way to open a door = one
  registry entry. Goal: **20+**.
- The narrator announces each door's nature as it opens ("a door that irises
  open.").
- TODO: per-type open sounds; the exact "first door spawns in front of the sunk
  pedestal, you open it normally" staging; more types.

## Permadeath + spectator (the death state)

When you die:
- Input locks (no move / no interact). The body ragdolls or freezes; the
  **camera stays** at the death spot. **The world keeps simulating** — ducks
  settle, the train keeps running, the narrator keeps talking.
- The only action is **RESTART → respawn in the white room (the hub).**

**What persists across death (proposed):** the **hub and its discovered doors**
persist; the **path you died in resets** so you can retry it clean. (Decision
needed — could also wipe gag clutter, or keep it for comedy.)

**Engine prior art:** Delve's `player/death.ts` does exactly the slow-mo +
camera-collapse death cinematic; we strip the combat bits and keep the staging.

---

## The Narrator — TTS + dialogue system

Goal: a **sarcastic Stanley-Parable narrator** that **speaks** and reacts to what
you do.

**TTS backend (swappable):**
- **Now (prototype):** browser **`SpeechSynthesis`** (Web Speech API). Free,
  no key, offline-ish. Robotic, but good enough to feel the timing.
- **Later (the real voice):** **ElevenLabs / OpenAI TTS** for a genuinely
  sarcastic narrator. Costs money + latency, so **pre-generate and cache** each
  line's audio (this matches Delve's "aggressive caching" philosophy). Design
  the system so the backend is one swap: `speak(line) → audio`.

**Dialogue system:**
- A line = `{ id, text, trigger, conditions?, cooldown?, oncePerRun?, priority }`.
- An **event bus** fires events — `pressButton`, `death`, `enterPath`,
  `duckMilestone`, `idle`, `firstButton`, `dieSameWayAgain` — and a dialogue
  manager picks an eligible, not-recently-played line, shows the text, and
  speaks it. Queue + interrupt rules (death lines barge in; idle chatter
  doesn't).
- **Reactivity is the joke:** mash the button → "Yes. That's the one. Keep
  going." / die on the train 5× → escalating mockery. Variants so it never
  repeats.

**Engine prior art:** Delve's `broadcast/` event-bus + achievement-pop layer is
*exactly* this pattern (it was their "snarky announcer" tribute layer). We can
lift the architecture.

**Writing:** the sarcastic line bank is content we'll write in batches per
trigger. Tone: deadpan, fourth-wall-aware, never mean enough to stop being
funny.

---

## Status

- ✓ **Built**: white room + pedestal/red button; FP movement (desktop + touch);
  interact prompt; **narrator TTS** (English voice forced, in-browser, no
  server); synth sfx (quacks, thunder, horn…); **Game/level controller** +
  `GameContext`; **in-place reveal** (pedestal sinks, walls topple, ceiling
  floats — or ceiling-only); **death + spectator + restart**.
- ✓ **Levels**: *Ducks* (in-room, ceiling opens, quota), *Forest* (outdoor
  plain, find the exit), *Tunnel* (train-launch skill puzzle), *Doors* (corridor
  of 12 unique-opening doors). **Gags**: another-button, statue, confetti,
  color-flash, nothing.
- ✓ **Main menu** (`src/ui/main-menu.ts`) — clean serif title card, BEGIN pill,
  HOW TO PLAY + NARRATOR on/off; game renders behind it, BEGIN starts play.
- ✓ **Walkable regions** — movement now supports a union of rectangles (room +
  different-width corridor), so the doors level keeps the room and drops only
  the **front wall** into a wider/taller corridor.
- Dev flags: `?open=ducks | forest | tunnel | doors` skip the menu + boot a level.

## Next / open

1. Tunnel & flight feel — needs real-device tuning (launch power, steer, pad).
2. Door types → 20+, per-type sounds, the precise "first door" staging.
3. White-room-as-recurring-node: chain levels room→room; retry persistence
   (after death, re-open the same path without re-rolling).
4. Duck-pile puzzle (climb ducks to a high exit; buttons as duck factories).
5. Dialogue system: event-bus triggers + reactive sarcastic line bank; later a
   cloud neural TTS voice (cached) behind the same `speak()` seam.
