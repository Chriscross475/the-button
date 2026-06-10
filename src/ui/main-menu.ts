import { toggleTts, isTtsEnabled } from '../audio/tts';

// The main menu. A clean, bright, deadpan title card — the inverse of the dark
// dungeon the engine came from. Full-screen vanilla-DOM overlay (same shape as
// Delve's start screen): big serif title, italic subtitle, a primary BEGIN
// pill, and a couple of small secondary links. The 3D room glows faintly behind
// it. BEGIN fades the menu out and hands control to the game.

const SUBTITLES = [
  'a game about pressing a button.',
  'there is a button. that is the game.',
  'you will press it. we both know this.',
  'press the button. see what happens. repeat.',
];

export interface MainMenuOptions {
  /** Start a fresh game (boot menu). */
  onBegin?: () => void;
  /** Resume the in-progress game (pause menu). When set, this is a PAUSE menu. */
  onResume?: () => void;
  /** Abandon to a fresh first room (pause menu only). */
  onRestart?: () => void;
  /** Testing: jump straight into a level by experience id (boot menu only). */
  onSelectLevel?: (id: string) => void;
}

const TEST_LEVELS: [string, string][] = [
  ['ducks', 'DUCKS'],
  ['forest', 'FOREST'],
  ['tunnel', 'TUNNEL'],
  ['doors', 'DOORS'],
  ['another-button', 'BUTTONS'],
  ['slingshot', 'SLINGSHOT'],
  ['basketball', 'HOOPS'],
  ['circus', 'CIRCUS'],
];

export function showMainMenu(opts: MainMenuOptions): void {
  if (document.getElementById('main-menu')) return;
  const paused = !!opts.onResume;

  if (!document.getElementById('main-menu-keyframes')) {
    const style = document.createElement('style');
    style.id = 'main-menu-keyframes';
    style.textContent = `
      @keyframes mmTitleIn { from { letter-spacing: 0.6em; opacity: 0; } to { letter-spacing: 0.16em; opacity: 1; } }
    `;
    document.head.appendChild(style);
  }

  const root = document.createElement('div');
  root.id = 'main-menu';
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '14px',
    background:
      'radial-gradient(ellipse at center, rgba(248,248,246,0.72) 0%, rgba(232,232,229,0.9) 75%)',
    backdropFilter: 'blur(2px)',
    fontFamily: 'Georgia, "Times New Roman", serif',
    color: '#1a1a1a',
    pointerEvents: 'auto',
    opacity: '0',
    transition: 'opacity 0.6s ease',
    zIndex: '60',
  } as Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = 'THE BUTTON';
  Object.assign(title.style, {
    fontSize: 'clamp(42px, 10vw, 86px)',
    letterSpacing: '0.16em',
    fontWeight: '500',
    color: '#161616',
    textShadow: '0 2px 18px rgba(255,255,255,0.8)',
    animation: 'mmTitleIn 1.4s cubic-bezier(0.2,0.7,0.2,1) forwards',
  });
  root.appendChild(title);

  const sub = document.createElement('div');
  sub.textContent = paused ? 'paused.' : SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)];
  Object.assign(sub.style, {
    fontStyle: 'italic',
    fontSize: 'clamp(13px, 2.4vw, 17px)',
    color: 'rgba(30,30,30,0.62)',
    marginTop: '-2px',
    marginBottom: '20px',
  });
  root.appendChild(sub);

  // Primary action: BEGIN (boot) or RESUME (pause).
  const begin = makePill(paused ? 'RESUME' : 'BEGIN');
  begin.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    hide(root);
    (paused ? opts.onResume : opts.onBegin)?.();
  });
  root.appendChild(begin);

  // Secondary links: how-to-play toggle + narrator mute.
  const links = document.createElement('div');
  Object.assign(links.style, {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginTop: '22px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } as Partial<CSSStyleDeclaration>);

  const help = document.createElement('div');
  help.textContent = 'click to look · WASD / joystick to move · click or E to press the button';
  Object.assign(help.style, {
    position: 'fixed',
    bottom: '8%',
    left: '50%',
    transform: 'translateX(-50%)',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '12px',
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'rgba(30,30,30,0.5)',
    textAlign: 'center',
    maxWidth: '90vw',
    display: 'none',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(help);

  const howTo = makeLink('HOW TO PLAY');
  howTo.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    help.style.display = help.style.display === 'none' ? 'block' : 'none';
  });
  links.appendChild(howTo);

  const sep = document.createElement('span');
  sep.textContent = '·';
  sep.style.color = 'rgba(30,30,30,0.35)';
  links.appendChild(sep);

  const narr = makeLink(`NARRATOR: ${isTtsEnabled() ? 'ON' : 'OFF'}`);
  narr.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const on = toggleTts();
    narr.textContent = `NARRATOR: ${on ? 'ON' : 'OFF'}`;
  });
  links.appendChild(narr);

  // Pause menu: a way back to a fresh first room.
  if (paused && opts.onRestart) {
    const sep2 = document.createElement('span');
    sep2.textContent = '·';
    sep2.style.color = 'rgba(30,30,30,0.35)';
    links.appendChild(sep2);
    const restart = makeLink('BACK TO START');
    restart.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide(root);
      opts.onRestart!();
    });
    links.appendChild(restart);
  }

  root.appendChild(links);

  // Boot menu: a test row to jump straight into any level.
  if (!paused && opts.onSelectLevel) {
    const sel = document.createElement('div');
    Object.assign(sel.style, {
      display: 'flex',
      gap: '4px',
      alignItems: 'center',
      flexWrap: 'wrap',
      justifyContent: 'center',
      marginTop: '16px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    } as Partial<CSSStyleDeclaration>);
    const lbl = document.createElement('span');
    lbl.textContent = 'test:';
    Object.assign(lbl.style, { color: 'rgba(30,30,30,0.4)', fontSize: '11px', letterSpacing: '0.16em' });
    sel.appendChild(lbl);
    for (const [id, label] of TEST_LEVELS) {
      const b = makeLink(label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        hide(root);
        opts.onSelectLevel!(id);
      });
      sel.appendChild(b);
    }
    root.appendChild(sel);
  }

  document.body.appendChild(root);

  requestAnimationFrame(() => {
    root.style.opacity = '1';
  });
}

function makePill(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  Object.assign(b.style, {
    padding: '15px 52px',
    minWidth: '200px',
    minHeight: '44px',
    borderRadius: '36px',
    border: '1px solid rgba(20,20,20,0.5)',
    background: 'rgba(255,255,255,0.55)',
    color: '#141414',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '20px',
    fontWeight: '700',
    letterSpacing: '0.26em',
    cursor: 'pointer',
    boxShadow: '0 3px 16px rgba(0,0,0,0.12)',
    transition: 'transform 0.08s ease, background 0.15s ease',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);
  b.textContent = label;
  b.addEventListener('pointerdown', () => (b.style.transform = 'scale(0.96)'));
  b.addEventListener('pointerup', () => (b.style.transform = 'scale(1)'));
  b.addEventListener('pointerleave', () => (b.style.transform = 'scale(1)'));
  b.addEventListener('pointerenter', () => (b.style.background = 'rgba(255,255,255,0.85)'));
  return b;
}

function makeLink(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  Object.assign(b.style, {
    background: 'transparent',
    border: 'none',
    color: 'rgba(30,30,30,0.55)',
    fontSize: '11px',
    fontWeight: '500',
    letterSpacing: '0.18em',
    minHeight: '44px',
    padding: '6px 8px',
    cursor: 'pointer',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);
  b.textContent = label;
  b.addEventListener('pointerenter', () => (b.style.color = 'rgba(20,20,20,0.9)'));
  b.addEventListener('pointerleave', () => (b.style.color = 'rgba(30,30,30,0.55)'));
  return b;
}

function hide(root: HTMLDivElement): void {
  root.style.opacity = '0';
  window.setTimeout(() => root.remove(), 600);
}
