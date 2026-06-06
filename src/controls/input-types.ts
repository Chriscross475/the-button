// Shared input contract — what every input scheme writes into and the
// callbacks it can fire. The orchestrator in input.ts runs one or more
// schemes (touch, desktop keyboard+mouse) all feeding the same InputState,
// so hybrid devices work without configuration.

export interface InputState {
  /** Movement axis values in [-1..1]. Deadzone already applied. */
  moveX: number;
  moveY: number;
  /** Look delta (raw pixels) accumulated since last frame; the camera
   *  consumes these and resets them to 0. */
  lookDx: number;
  lookDy: number;
  /** Per-frame hook. Schemes register tick callbacks here for continuous
   *  behaviour (WASD polling, hybrid-look). */
  tickInput: (dt: number) => void;
}

/** Pluggable input scheme. Attaches listeners to the canvas, writes into the
 *  shared InputState, and fires the option callbacks for semantic actions
 *  (tap, interact). Multiple schemes coexist — touch handlers only fire on
 *  touch, keyboard/mouse only on desktop — so they don't fight on hybrids. */
export interface InputScheme {
  /** One-time setup. Return value is appended to the orchestrator's
   *  per-frame tick list, or null if no per-frame work is needed. */
  attach(ctx: SchemeContext): InputTick | null;
}

export interface SchemeContext {
  canvas: HTMLCanvasElement;
  state: InputState;
  options: InputOptions;
}

export interface InputOptions {
  /** Fired for every tap/click. The single tap arbiter: it resolves whether
   *  the tap hit something pressable and acts. `canPress` is false for the
   *  touch joystick half (a direct hit is still honoured there, but the
   *  walk-up fallback is suppressed). */
  onTap?: (clientX: number, clientY: number, canPress: boolean) => void;
  /** Fired when the player asks to interact without a screen coordinate
   *  (E / Space). Means "use the currently in-range interactable". */
  onInteract?: () => void;
  /** Fired on the very first input of any kind — used to resume the audio
   *  context (needs a user gesture) and dismiss the first-run hint. */
  onFirstInput?: () => void;
}

export type InputTick = (dt: number) => void;
