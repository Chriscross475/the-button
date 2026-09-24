// On-screen hand buttons for touch: L drives the left hand and R the right,
// exactly like the left and right mouse buttons. Press = grab / press / aim a
// combine, hold then release = charged throw. They aim with the crosshair, like
// the mouse. Created on the first real touch, so a mouse-only desktop never
// sees them. A third, JUMP, shows only in levels that turn jumping on.

import { FONT_VOICE } from '../ui/fonts';

type Side = 'left' | 'right';

const SIZE = 68;

let built = false;
let jumpButton: HTMLDivElement | null = null;
let jumpVisible = false;

/** Show / hide the touch JUMP button (jump levels only). Safe before the
 *  buttons exist: they pick it up when they're built. */
export function setJumpButtonVisible(v: boolean): void {
  jumpVisible = v;
  if (jumpButton) jumpButton.style.display = v ? 'flex' : 'none';
}

export function ensureHandButtons(
  onHand: (side: Side, down: boolean) => void,
  onFirst: () => void,
  onJump?: () => void,
): void {
  if (built || typeof document === 'undefined') return;
  built = true;
  if (onJump) {
    const j = document.createElement('div');
    j.id = 'jump-button';
    j.textContent = 'JUMP';
    j.style.cssText = [
      'position:fixed',
      'bottom:calc(34% + 84px)',
      'right:18px',
      `width:${SIZE}px`,
      `height:${SIZE}px`,
      'border-radius:50%',
      `display:${jumpVisible ? 'flex' : 'none'}`,
      'align-items:center',
      'justify-content:center',
      `font-family:${FONT_VOICE}`,
      'font-size:14px',
      'letter-spacing:0.1em',
      'color:rgba(30,30,30,0.7)',
      'background:rgba(255,255,255,0.32)',
      'border:1px solid rgba(30,30,30,0.35)',
      'user-select:none',
      '-webkit-user-select:none',
      'touch-action:none',
      '-webkit-tap-highlight-color:transparent',
      'z-index:14',
    ].join(';');
    j.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onFirst();
      onJump();
    });
    j.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(j);
    jumpButton = j;
  }
  for (const side of ['left', 'right'] as Side[]) {
    const b = document.createElement('div');
    b.id = `hand-button-${side}`;
    b.textContent = side === 'left' ? 'L' : 'R';
    b.style.cssText = [
      'position:fixed',
      'bottom:34%',
      side === 'left' ? 'left:18px' : 'right:18px',
      `width:${SIZE}px`,
      `height:${SIZE}px`,
      'border-radius:50%',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      `font-family:${FONT_VOICE}`,
      'font-size:22px',
      'letter-spacing:0.08em',
      'color:rgba(30,30,30,0.7)',
      'background:rgba(255,255,255,0.32)',
      'border:1px solid rgba(30,30,30,0.35)',
      'user-select:none',
      '-webkit-user-select:none',
      'touch-action:none',
      '-webkit-tap-highlight-color:transparent',
      'z-index:14',
    ].join(';');
    let pointer: number | null = null;
    const release = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      b.style.background = 'rgba(255,255,255,0.32)';
      onHand(side, false);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pointer !== null) return;
      pointer = e.pointerId;
      b.setPointerCapture?.(e.pointerId);
      b.style.background = 'rgba(255,255,255,0.7)';
      onFirst();
      onHand(side, true);
    });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(b);
  }
}
