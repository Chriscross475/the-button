// All tuning numbers in one place — the seam to iterate on feel.
// (Same convention as the engine this was extracted from.)

export const CONFIG = {
  // --- Camera ---
  FOV: 72,
  CAMERA_FAR: 300,

  // --- Player ---
  PLAYER_HEIGHT: 1.6, // eye height, metres
  PLAYER_RADIUS: 0.3, // collision radius
  MOVE_SPEED: 3.2, // metres / second
  LOOK_SENSITIVITY: 0.0022, // radians per pixel of look delta

  // --- Interaction ---
  // Half-angle of the forward cone the player must be facing within for an
  // interactable to register (≈60°). Looking away from the button drops it.
  INTERACT_CONE_HALF_ANGLE: Math.PI / 3,
  // Screen-space slop for a tap/click that just misses the button's mesh.
  INTERACT_TAP_PROXIMITY_PX: 64,

  // --- The room ---
  ROOM: {
    width: 11, // X span, metres
    depth: 13, // Z span, metres
    height: 3.6, // ceiling, metres
  },
} as const;
