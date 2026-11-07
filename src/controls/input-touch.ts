// Touch input scheme.
//
//   Left  zone (~40% of width): the move stick.
//   Right zone (~60%): the look stick — the view follows the finger, and
//     holding it out past the ring keeps turning. A tap still presses.
//   L / R buttons (hand-buttons.ts): the left and right hands, like the mouse.
//
// Multi-touch (one finger per zone). Simplified from the source engine's
// touch scheme — dash/charge/flick/double-tap gestures and the hybrid-look
// setting removed; what remains is the two sticks + tap arbiter.

import { showJoystick, moveJoystickKnob, hideJoystick, createStickHud } from './joystick-hud';
import { ensureHandButtons } from './hand-buttons';
import { CONFIG } from '../config';
import { stickToMove, followBase, swipeGain, smoothFraction } from './touch-math';
import type { InputScheme, SchemeContext, InputTick } from './input-types';

/** Left zone width as a fraction of viewport. 0.4 = 40% move, 60% look. */
const LEFT_ZONE_FRACTION = 0.4;
/** Look stick: past this fraction of the ring the view keeps turning while the
 *  finger is held (at up to CONFIG.TOUCH_EDGE_TURN rad/s). */
const EDGE_START = 0.85;

interface TouchTracker {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  /** Zone the finger landed in. */
  side: 'left' | 'right';
  /** 'move' = the single stick finger; every other finger just looks. */
  role: 'move' | 'look';
  startTime: number;
  lastTime: number;
  totalMovement: number;
}

export const touchScheme: InputScheme = {
  attach({ canvas, state, options }: SchemeContext): InputTick | null {
    const touches = new Map<number, TouchTracker>();
    let activeJoystickId: number | null = null;
    let activeLookId: number | null = null;
    const lookStick = createStickHud('-look');
    let firstInputFired = false;

    const fireFirst = () => {
      if (firstInputFired) return;
      firstInputFired = true;
      options.onFirstInput?.();
    };

    const screenMid = () => window.innerWidth * LEFT_ZONE_FRACTION;

    // Look deltas in radians, released to state.lookYaw/Pitch with exponential smoothing.
    let pendYaw = 0;
    let pendPitch = 0;
    // Floating move-stick base (follows the finger beyond the radius).
    let baseX = 0;
    let baseY = 0;
    const R = CONFIG.TOUCH_STICK_RADIUS;

    function handleStart(e: TouchEvent) {
      fireFirst();
      const now = performance.now();
      for (const t of Array.from(e.changedTouches)) {
        const side: 'left' | 'right' = t.clientX < screenMid() ? 'left' : 'right';
        const isMove = side === 'left' && activeJoystickId === null;
        touches.set(t.identifier, {
          id: t.identifier,
          startX: t.clientX,
          startY: t.clientY,
          lastX: t.clientX,
          lastY: t.clientY,
          side,
          role: isMove ? 'move' : 'look',
          startTime: now,
          lastTime: now,
          totalMovement: 0,
        });
        if (isMove) {
          activeJoystickId = t.identifier;
          baseX = t.clientX;
          baseY = t.clientY;
          showJoystick(baseX, baseY);
        } else if (activeLookId === null) {
          activeLookId = t.identifier;
          lookStick.show(t.clientX, t.clientY);
        }
      }
    }

    function handleMove(e: TouchEvent) {
      e.preventDefault();
      const now = performance.now();
      const w = Math.max(1, window.innerWidth);
      for (const t of Array.from(e.changedTouches)) {
        const tracker = touches.get(t.identifier);
        if (!tracker) continue;
        const ddx = t.clientX - tracker.lastX;
        const ddy = t.clientY - tracker.lastY;
        tracker.totalMovement = Math.hypot(t.clientX - tracker.startX, t.clientY - tracker.startY);
        if (tracker.role === 'move') {
          // Base follows the finger so it is never more than R away.
          const b = followBase(baseX, baseY, t.clientX, t.clientY, R);
          baseX = b.x;
          baseY = b.y;
          const dx = t.clientX - baseX;
          const dy = t.clientY - baseY;
          const m = stickToMove(dx, dy, R, CONFIG.TOUCH_DEADZONE, CONFIG.TOUCH_MOVE_CURVE);
          state.moveX = m.x;
          state.moveY = m.y;
          showJoystick(baseX, baseY);
          moveJoystickKnob(baseX, baseY, dx, dy, R);
        } else {
          const dtSec = Math.max(0.008, (now - tracker.lastTime) / 1000);
          const speed = Math.hypot(ddx, ddy) / w / dtSec; // widths per second
          const gain = swipeGain(speed, CONFIG.TOUCH_LOOK_ACCEL, CONFIG.TOUCH_LOOK_ACCEL_REF);
          const k = (CONFIG.TOUCH_LOOK_SENSITIVITY / w) * gain;
          pendYaw += ddx * k;
          pendPitch += ddy * k * CONFIG.TOUCH_LOOK_PITCH_SCALE;
          if (t.identifier === activeLookId) {
            lookStick.move(tracker.startX, tracker.startY, t.clientX - tracker.startX, t.clientY - tracker.startY, R);
          }
        }
        tracker.lastX = t.clientX;
        tracker.lastY = t.clientY;
        tracker.lastTime = now;
      }
    }

    function handleEnd(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        const tracker = touches.get(t.identifier);
        if (!tracker) continue;
        const elapsed = performance.now() - tracker.startTime;
        const isTap = e.type !== 'touchcancel' && elapsed < CONFIG.TOUCH_TAP_MS && tracker.totalMovement < CONFIG.TOUCH_TAP_PX;
        if (t.identifier === activeJoystickId) {
          state.moveX = 0;
          state.moveY = 0;
          hideJoystick();
          activeJoystickId = null;
        }
        if (t.identifier === activeLookId) {
          lookStick.hide();
          activeLookId = null;
          // Hand the look stick to another look finger, if one is still down.
          for (const o of touches.values()) {
            if (o.id !== t.identifier && o.role === 'look') {
              activeLookId = o.id;
              o.startX = o.lastX;
              o.startY = o.lastY;
              lookStick.show(o.lastX, o.lastY);
              break;
            }
          }
        }
        if (isTap) {
          // Right (look) half only — the left half is the stick. While the
          // stick is held a tap only counts if it hits an interactable directly
          // (raycast); ambiguous presses are suppressed.
          const moving = activeJoystickId !== null;
          const rightSide = tracker.side === 'right';
          options.onTap?.(t.clientX, t.clientY, rightSide && !moving, rightSide && moving);
        }
        touches.delete(t.identifier);
      }
    }

    // The hand buttons appear with the first touch anywhere (the menu's BEGIN
    // tap included), so they're there the moment play starts.
    const onHand = options.onHand;
    if (onHand) {
      window.addEventListener('touchstart', () => ensureHandButtons(onHand, fireFirst, () => (state.jump = true)), { once: true, passive: true });
    }
    canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    canvas.addEventListener('touchend', handleEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleEnd, { passive: false });

    // Per frame: look stick held out past the ring keeps turning; then release
    // the smoothed share of the pending look delta.
    return (dt: number) => {
      if (activeLookId !== null) {
        const tr = touches.get(activeLookId);
        if (tr) {
          const dx = tr.lastX - tr.startX;
          const dy = tr.lastY - tr.startY;
          const n = Math.hypot(dx, dy);
          const d = n / R;
          if (d > EDGE_START) {
            const push = Math.min(1, (d - EDGE_START) / (1 - EDGE_START));
            const rate = CONFIG.TOUCH_EDGE_TURN * push * dt;
            pendYaw += (dx / n) * rate;
            pendPitch += (dy / n) * rate * CONFIG.TOUCH_LOOK_PITCH_SCALE;
          }
        }
      }
      if (pendYaw !== 0 || pendPitch !== 0) {
        const f = smoothFraction(dt, CONFIG.TOUCH_LOOK_SMOOTH_HALFLIFE);
        const oy = pendYaw * f;
        const op = pendPitch * f;
        pendYaw -= oy;
        pendPitch -= op;
        if (Math.abs(pendYaw) < 1e-5) pendYaw = 0;
        if (Math.abs(pendPitch) < 1e-5) pendPitch = 0;
        state.lookYaw = (state.lookYaw ?? 0) + oy;
        state.lookPitch = (state.lookPitch ?? 0) + op;
      }
    };
  },
};
