// Touch input scheme.
//
//   Left  zone (~40% of width): virtual joystick for movement.
//   Right zone (~60%): swipe to look, tap to press.
//
// Multi-touch (one finger per zone). Simplified from the source engine's
// touch scheme — dash/charge/flick/double-tap gestures and the hybrid-look
// setting removed; what remains is the joystick + look-swipe + tap arbiter.

import { showJoystick, moveJoystickKnob, hideJoystick } from './joystick-hud';
import type { InputScheme, SchemeContext, InputTick } from './input-types';

const TAP_MAX_MS = 320;
const TAP_MAX_PX = 18;
const JOYSTICK_RADIUS = 80;
const DEADZONE = 0.1;
/** Left zone width as a fraction of viewport. 0.4 = 40% move, 60% look. */
const LEFT_ZONE_FRACTION = 0.4;

interface TouchTracker {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  side: 'left' | 'right';
  startTime: number;
  totalMovement: number;
}

export const touchScheme: InputScheme = {
  attach({ canvas, state, options }: SchemeContext): InputTick | null {
    const touches = new Map<number, TouchTracker>();
    let activeJoystickId: number | null = null;
    let firstInputFired = false;

    const fireFirst = () => {
      if (firstInputFired) return;
      firstInputFired = true;
      options.onFirstInput?.();
    };

    const screenMid = () => window.innerWidth * LEFT_ZONE_FRACTION;

    function handleStart(e: TouchEvent) {
      fireFirst();
      for (const t of Array.from(e.changedTouches)) {
        const side: 'left' | 'right' = t.clientX < screenMid() ? 'left' : 'right';
        touches.set(t.identifier, {
          id: t.identifier,
          startX: t.clientX,
          startY: t.clientY,
          lastX: t.clientX,
          lastY: t.clientY,
          side,
          startTime: performance.now(),
          totalMovement: 0,
        });
        if (side === 'left' && activeJoystickId === null) {
          activeJoystickId = t.identifier;
          showJoystick(t.clientX, t.clientY);
        }
      }
    }

    function handleMove(e: TouchEvent) {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        const tracker = touches.get(t.identifier);
        if (!tracker) continue;
        if (tracker.side === 'left') {
          const dx = t.clientX - tracker.startX;
          const dy = t.clientY - tracker.startY;
          tracker.lastX = t.clientX;
          tracker.lastY = t.clientY;
          tracker.totalMovement = Math.hypot(dx, dy);
          let mx = Math.max(-1, Math.min(1, dx / JOYSTICK_RADIUS));
          let my = Math.max(-1, Math.min(1, dy / JOYSTICK_RADIUS));
          if (Math.hypot(mx, my) < DEADZONE) {
            mx = 0;
            my = 0;
          }
          state.moveX = mx;
          state.moveY = my;
          if (t.identifier === activeJoystickId) {
            moveJoystickKnob(tracker.startX, tracker.startY, dx, dy, JOYSTICK_RADIUS);
          }
        } else {
          const ddx = t.clientX - tracker.lastX;
          const ddy = t.clientY - tracker.lastY;
          state.lookDx += ddx;
          state.lookDy += ddy;
          tracker.totalMovement += Math.hypot(ddx, ddy);
          tracker.lastX = t.clientX;
          tracker.lastY = t.clientY;
        }
      }
    }

    function handleEnd(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        const tracker = touches.get(t.identifier);
        if (!tracker) continue;
        const elapsed = performance.now() - tracker.startTime;
        const isTap = elapsed < TAP_MAX_MS && tracker.totalMovement < TAP_MAX_PX;
        if (tracker.side === 'left' && t.identifier === activeJoystickId) {
          state.moveX = 0;
          state.moveY = 0;
          hideJoystick();
          activeJoystickId = null;
        }
        if (isTap) {
          // canPress = right (look) half only; the left half is the joystick.
          options.onTap?.(t.clientX, t.clientY, tracker.side === 'right');
        }
        touches.delete(t.identifier);
      }
    }

    canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    canvas.addEventListener('touchend', handleEnd, { passive: false });
    canvas.addEventListener('touchcancel', handleEnd, { passive: false });

    return null;
  },
};
