// Minimal frame loop. Calls `onFrame(dt)` once per animation frame with the
// elapsed seconds since the last frame, capped so a backgrounded tab doesn't
// produce one giant dt that teleports the player or the physics.

export function startLoop(onFrame: (dt: number) => void): void {
  let last = performance.now();
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    onFrame(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
