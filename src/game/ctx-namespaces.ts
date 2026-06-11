import type { GameContext, GameContextFlat } from './types';

// Attach the namespaced VIEWS (ctx.world, ctx.nav, ctx.carry, …) onto a flat
// GameContext. Each namespace member is the SAME function reference as its flat
// twin — calling ctx.nav.advanceTo(...) and ctx.advanceTo(...) runs identical
// code. The flat API is left untouched (keep-legacy rule); namespaces are pure
// organization for discoverability.
//
// Methods delegate by reference (the flat members are arrow functions that
// capture the Game, so they ignore call-site `this` — a bare reference is
// correct). The few LIVE props the Game repoints per level — levelRoot, bounds,
// entry — are forwarded through getters so the namespace always reads the
// current value, never a stale snapshot.
export function attachNamespaces(flat: GameContextFlat): GameContext {
  const c = flat;
  const ctx = c as GameContext;

  ctx.world = {
    get scene() { return c.scene; },
    get camera() { return c.camera; },
    get levelRoot() { return c.levelRoot; },
    playerPos: c.playerPos,
  };
  ctx.narration = {
    narrate: c.narrate,
    after: c.after,
  };
  ctx.nav = {
    goToLevel: c.goToLevel,
    returnToHub: c.returnToHub,
    advance: c.advance,
    advanceTo: c.advanceTo,
    get entry() { return c.entry; },
    spawnAt: c.spawnAt,
  };
  ctx.room = {
    openRoom: c.openRoom,
    setRoomButton: c.setRoomButton,
    sinkRoomButton: c.sinkRoomButton,
    spawnButton: c.spawnButton,
  };
  ctx.region = {
    get bounds() { return c.bounds; },
    setBounds: c.setBounds,
    setRegions: c.setRegions,
    addObstacle: c.addObstacle,
    removeObstacle: c.removeObstacle,
    setLanding: c.setLanding,
    setFlightWalls: c.setFlightWalls,
  };
  ctx.physics = {
    launchPlayer: c.launchPlayer,
    die: c.die,
    isAirborne: c.isAirborne,
    isDead: c.isDead,
  };
  ctx.carry = {
    addCarryable: c.addCarryable,
    removeCarryable: c.removeCarryable,
    addTarget: c.addTarget,
    removeTarget: c.removeTarget,
    isHolding: c.isHolding,
    consumeHeld: c.consumeHeld,
    heldKind: c.heldKind,
    putInHand: c.putInHand,
    launchProjectile: c.launchProjectile,
  };
  ctx.companions = {
    setCompanion: c.setCompanion,
    setScoringHoop: c.setScoringHoop,
  };
  ctx.modes = {
    setWheel: c.setWheel,
    setControlMode: c.setControlMode,
  };

  return ctx;
}
