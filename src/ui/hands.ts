// Bottom-of-screen HUD labels for what each hand is carrying — one by the left
// hand, one by the right, so the text sits "beside" each arm.

const NAMES: Record<string, string> = {
  'cooked-duck': 'Roast Duck',
  axe: 'Axe',
  duck: 'Duck',
};

function nice(kind: string): string {
  return NAMES[kind] ?? kind.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const els: { left: HTMLDivElement | null; right: HTMLDivElement | null } = { left: null, right: null };

function ensure(side: 'left' | 'right'): HTMLDivElement {
  let el = els[side];
  if (el) return el;
  el = document.createElement('div');
  el.id = `hand-${side}`;
  el.style.cssText = [
    'position:fixed',
    'bottom:46px',
    side === 'left' ? 'left:34px' : 'right:34px',
    side === 'left' ? 'text-align:left' : 'text-align:right',
    'font-family:Georgia,"Times New Roman",serif',
    'font-size:15px',
    'letter-spacing:0.16em',
    'text-transform:uppercase',
    'color:rgba(245,245,242,0.82)',
    'text-shadow:0 1px 4px rgba(0,0,0,0.6)',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity 0.25s ease',
    'z-index:5',
  ].join(';');
  document.body.appendChild(el);
  els[side] = el;
  return el;
}

/** Show (or clear) the item label for a hand. Pass null to clear. */
export function setHandItem(side: 'left' | 'right', kind: string | null): void {
  const el = ensure(side);
  if (kind) {
    el.textContent = nice(kind);
    el.style.opacity = '1';
  } else {
    el.style.opacity = '0';
  }
}

/** Clear both hand labels (e.g. on death). */
export function clearHands(): void {
  setHandItem('left', null);
  setHandItem('right', null);
}
