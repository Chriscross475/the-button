// Desktop input scheme: WASD to move, mouse to look (pointer lock), E or
// Space to press, click to press (or to acquire pointer lock first).
//
// Simplified from the source engine's desktop scheme — all combat bindings
// (attack / dash / charge / inventory / rebindable keymap) removed. What's
// kept is the robustness that's annoying to re-derive: the post-lock centring
// warp swallow, the spurious pointer-lock spike filter, and the per-scheme
// "did only I write movement this frame" clobber-guard for hybrid devices.

import type { InputScheme, SchemeContext, InputTick } from './input-types';

const TAP_MAX_MS = 220;
const TAP_MAX_PX = 18;
// Pointer-lock movementX/Y is a per-event pixel delta. Chrome on Windows
// intermittently emits one spurious delta in the thousands, and a centring
// "warp" delta on the first move after lock — either flips the view for a
// frame. Drop any single event beyond this; legit motion never reaches it.
const LOOK_SPIKE_PX = 400;

export const desktopScheme: InputScheme = {
  attach({ canvas, state, options }: SchemeContext): InputTick | null {
    const codesDown = new Set<string>();
    let pointerLocked = false;
    let swallowNextMove = false;
    let firstInputFired = false;

    const fireFirst = () => {
      if (firstInputFired) return;
      firstInputFired = true;
      options.onFirstInput?.();
    };

    document.addEventListener('pointerlockchange', () => {
      const nowLocked = document.pointerLockElement === canvas;
      if (nowLocked && !pointerLocked) swallowNextMove = true;
      pointerLocked = nowLocked;
    });

    // ── Keyboard ──
    window.addEventListener('keydown', (e) => {
      if (!e.repeat) codesDown.add(e.code);
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.code === 'Space') {
        e.preventDefault();
        fireFirst();
        options.onInteract?.();
      }
    });
    window.addEventListener('keyup', (e) => {
      codesDown.delete(e.code);
    });

    // ── Mouse ──
    let mouseDownAt = 0;
    let mouseMovement = 0;

    canvas.addEventListener('mousedown', () => {
      mouseDownAt = performance.now();
      mouseMovement = 0;
    });

    canvas.addEventListener('mouseup', (e) => {
      const elapsed = performance.now() - mouseDownAt;
      const isTap = elapsed < TAP_MAX_MS && mouseMovement < TAP_MAX_PX;
      if (!isTap) return;
      fireFirst();
      if (!pointerLocked) {
        // First click also tries to press whatever's directly under the cursor
        // (so clicking a visible button works), then enters mouse-look.
        options.onTap?.(e.clientX, e.clientY, true);
        canvas.requestPointerLock?.();
        return;
      }
      // Locked → left-click presses whatever the centre crosshair is aimed at
      // (same in-range + facing-cone logic as the E key). This is reliable;
      // a raycast from the frozen pointer-lock cursor position is not.
      options.onInteract?.();
    });

    canvas.addEventListener('mousemove', (e) => {
      if (pointerLocked) {
        if (swallowNextMove) {
          swallowNextMove = false;
          return;
        }
        if (Math.abs(e.movementX) > LOOK_SPIKE_PX || Math.abs(e.movementY) > LOOK_SPIKE_PX) {
          return;
        }
        state.lookDx += e.movementX;
        state.lookDy += e.movementY;
      } else {
        // Pre-lock: track movement so the click-on-release tap test works.
        mouseMovement += Math.hypot(e.movementX || 0, e.movementY || 0);
      }
    });

    // ── Per-frame: WASD polling ──
    // Remember what THIS scheme wrote last frame. If state still matches, only
    // we wrote → clear on release. If it differs, the touch joystick wrote
    // this frame on a hybrid device → leave it.
    let lastKbMoveX = 0;
    let lastKbMoveY = 0;
    return (_dt: number) => {
      let kx = 0;
      let ky = 0;
      if (codesDown.has('KeyW') || codesDown.has('ArrowUp')) ky -= 1;
      if (codesDown.has('KeyS') || codesDown.has('ArrowDown')) ky += 1;
      if (codesDown.has('KeyA') || codesDown.has('ArrowLeft')) kx -= 1;
      if (codesDown.has('KeyD') || codesDown.has('ArrowRight')) kx += 1;
      if (kx !== 0 || ky !== 0) {
        const mag = Math.hypot(kx, ky);
        state.moveX = kx / mag;
        state.moveY = ky / mag;
        lastKbMoveX = state.moveX;
        lastKbMoveY = state.moveY;
        fireFirst();
      } else if (state.moveX === lastKbMoveX && state.moveY === lastKbMoveY) {
        state.moveX = 0;
        state.moveY = 0;
        lastKbMoveX = 0;
        lastKbMoveY = 0;
      }
    };
  },
};
