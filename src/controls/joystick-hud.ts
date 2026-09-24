// Visible floating joystick HUD. Appears under the thumb where the player
// touches (move stick on the left, look stick on the right), follows the
// finger, hides on release.
// Pure DOM overlay — sits above the canvas via z-index. Pointer-events disabled
// so touches still reach the canvas for the input layer to process.

export interface StickHud {
  show(x: number, y: number): void;
  move(centerX: number, centerY: number, dx: number, dy: number, radius: number): void;
  hide(): void;
}

/** One floating stick (ring + knob). The move stick and the look stick each
 *  own one; `id` suffixes the element ids. */
export function createStickHud(id: string): StickHud {
  let base: HTMLDivElement | null = null;
  let knob: HTMLDivElement | null = null;

  function ensureElements() {
    if (base && knob) return;

    // Subtle look — both ring and knob carry low alpha + thin strokes.
    // Earlier iteration was thicker / brighter; visible under the thumb
    // but distracting in the corner of the eye. Phone players don't need
    // the joystick to ANNOUNCE itself; they need just enough to confirm
    // their touch landed and how far it's drifted.
    base = document.createElement('div');
    base.id = `joystick-base${id}`;
    Object.assign(base.style, {
      position: 'fixed',
      width: '160px',
      height: '160px',
      border: '1px solid rgba(30, 30, 30, 0.18)',
      borderRadius: '50%',
      pointerEvents: 'none',
      display: 'none',
      transform: 'translate(-50%, -50%)',
      zIndex: '10',
    });

    knob = document.createElement('div');
    knob.id = `joystick-knob${id}`;
    Object.assign(knob.style, {
      position: 'fixed',
      width: '36px',
      height: '36px',
      background: 'rgba(30, 30, 30, 0.18)',
      border: '1px solid rgba(30, 30, 30, 0.45)',
      borderRadius: '50%',
      pointerEvents: 'none',
      display: 'none',
      transform: 'translate(-50%, -50%)',
      zIndex: '11',
    });

    document.body.appendChild(base);
    document.body.appendChild(knob);
  }

  return {
    show(x: number, y: number) {
      ensureElements();
      base!.style.left = `${x}px`;
      base!.style.top = `${y}px`;
      base!.style.display = 'block';
      knob!.style.left = `${x}px`;
      knob!.style.top = `${y}px`;
      knob!.style.display = 'block';
    },

    move(centerX: number, centerY: number, dx: number, dy: number, radius: number) {
      if (!knob) return;
      const mag = Math.hypot(dx, dy);
      let kx = dx;
      let ky = dy;
      if (mag > radius) {
        kx = (dx / mag) * radius;
        ky = (dy / mag) * radius;
      }
      knob.style.left = `${centerX + kx}px`;
      knob.style.top = `${centerY + ky}px`;
    },

    hide() {
      if (base) base.style.display = 'none';
      if (knob) knob.style.display = 'none';
    },
  };
}

// The move stick (left thumb).
const moveStick = createStickHud('');

export function showJoystick(x: number, y: number) {
  moveStick.show(x, y);
}

export function moveJoystickKnob(centerX: number, centerY: number, dx: number, dy: number, radius: number) {
  moveStick.move(centerX, centerY, dx, dy, radius);
}

export function hideJoystick() {
  moveStick.hide();
}
