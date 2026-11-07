// Pure touch-control math (no DOM) — unit-testable.

/** Radially clamp (dx,dy) to a circle of `radius`. */
export function clampRadial(dx: number, dy: number, radius: number): { x: number; y: number } {
  const m = Math.hypot(dx, dy);
  if (m <= radius || m === 0) return { x: dx, y: dy };
  return { x: (dx / m) * radius, y: (dy / m) * radius };
}

/** Stick offset (px) -> analog move vector with length in [0..1]: radial clamp,
 *  rescaled radial deadzone (0 at the edge of the deadzone, 1 at full
 *  deflection), then a response curve mag^exp for fine control near centre. */
export function stickToMove(dx: number, dy: number, radius: number, deadzone: number, exp: number): { x: number; y: number } {
  const m = Math.hypot(dx, dy) / radius;
  if (m <= deadzone) return { x: 0, y: 0 };
  const lin = Math.min(1, (m - deadzone) / (1 - deadzone));
  const out = Math.pow(lin, exp);
  const nx = dx / (m * radius);
  const ny = dy / (m * radius);
  return { x: nx * out, y: ny * out };
}

/** Floating stick: if the finger is farther than `radius` from the base, drag
 *  the base along so the finger sits exactly `radius` away. */
export function followBase(baseX: number, baseY: number, fx: number, fy: number, radius: number): { x: number; y: number } {
  const dx = fx - baseX;
  const dy = fy - baseY;
  const m = Math.hypot(dx, dy);
  if (m <= radius) return { x: baseX, y: baseY };
  return { x: fx - (dx / m) * radius, y: fy - (dy / m) * radius };
}

/** Swipe gain: 1 for slow drags, up to 1+accel for fast ones.
 *  `speed` is in viewport-widths per second. */
export function swipeGain(speed: number, accel: number, refSpeed: number): number {
  return 1 + accel * Math.min(1, speed / refSpeed);
}

/** Exponential smoothing step: fraction of the pending delta to release this
 *  frame for a given half-life (seconds). */
export function smoothFraction(dt: number, halfLife: number): number {
  if (halfLife <= 0) return 1;
  return 1 - Math.pow(0.5, dt / halfLife);
}
