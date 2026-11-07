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
  LOOK_SENSITIVITY: 0.0022, // radians per pixel of look delta (mouse)

  // --- Touch controls ---
  TOUCH_LOOK_SENSITIVITY: 3.4, // yaw radians per viewport-width swiped (half screen ≈ 97°)
  TOUCH_LOOK_PITCH_SCALE: 0.8, // pitch is a bit slower than yaw
  TOUCH_LOOK_SMOOTH_HALFLIFE: 0.03, // seconds; exponential smoothing of look deltas
  TOUCH_LOOK_ACCEL: 0.5, // extra gain for fast swipes (0 = off)
  TOUCH_LOOK_ACCEL_REF: 2.0, // swipe speed (widths/s) at which full accel applies
  TOUCH_EDGE_TURN: 1.2, // rad/s of continuous turn with the look finger held at the ring edge
  TOUCH_STICK_RADIUS: 80, // px; move stick reach (floating base follows beyond it)
  TOUCH_DEADZONE: 0.12, // rescaled radial deadzone of the move stick
  TOUCH_MOVE_CURVE: 1.5, // response curve exponent: speed = deflection^1.5
  TOUCH_TAP_MS: 350, // max duration of a tap
  TOUCH_TAP_PX: 24, // max travel of a tap (CSS px; already DPR-independent)

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
