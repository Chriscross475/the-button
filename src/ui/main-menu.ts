import { toggleTts, isTtsEnabled } from '../audio/tts';
import { click } from '../audio/sfx';
import { FONT_SIGN, FONT_VOICE } from './fonts';

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
  ['doors', 'DOORS'],
  ['another-button', 'BUTTONS'],
  ['basketball', 'HOOPS'],
  ['circus', 'CIRCUS'],
  ['booth', 'BOOTH'],
  ['desert', 'DESERT'],
  ['elevator', 'LIFT'],
  ['museum', 'MUSEUM'],
  ['waiting-room', 'WAITING'],
  ['tutorial', 'TUTORIAL'],
  ['loading-screen', 'LOADING'],
  ['evil-twin', 'TWINS'],
  ['customer-support', 'SUPPORT'],
  ['terms', 'TERMS'],
  ['captcha', 'CAPTCHA'],
  ['queue', 'QUEUE'],
  ['gift-shop', 'SHOP'],
  ['lost-found', 'LOST+FOUND'],
  ['game-show', 'THE BUTTON'],
  ['vending', 'VENDING'],
  ['self-checkout', 'CHECKOUT'],
  ['escape-room', 'ESCAPE'],
  ['trolley', 'TROLLEY'],
  ['marshmallow', 'MARSHMALLOW'],
  ['cave', 'CAVE'],
  ['courtroom', 'COURT'],
  ['sisyphus', 'SISYPHUS'],
  ['schrodinger', 'BOX'],
  ['only-up', 'ONLY UP'],
  ['you-are-button', 'YOU=BUTTON'],
  ['time-loop', 'LOOP'],
  ['microverse', 'MICRO'],
  ['infomercial', 'INFOMERCIAL'],
  ['multiverse', 'MULTIVERSE'],
  ['wedding', 'WEDDING'],
  ['porta-loo', 'PORTA-LOO'],
  ['night-shift', 'NIGHT SHIFT'],
  ['family-dinner', 'DINNER'],
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
    fontFamily: FONT_VOICE,
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

  // Primary action. Boot: THE button itself, wordless — you press it to begin.
  // Pause: a plain RESUME pill.
  if (paused) {
    const resume = makePill('RESUME');
    resume.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hide(root);
      opts.onResume?.();
    });
    root.appendChild(resume);
  } else {
    root.appendChild(makeBigRedButton(() => {
      hide(root);
      opts.onBegin?.();
    }));
  }

  // Secondary links: how-to-play toggle + narrator mute.
  const links = document.createElement('div');
  Object.assign(links.style, {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    marginTop: '22px',
    fontFamily: FONT_SIGN,
  } as Partial<CSSStyleDeclaration>);

  const help = document.createElement('div');
  help.textContent = 'click to look · WASD / joystick to move · click or E to press the button';
  Object.assign(help.style, {
    position: 'fixed',
    bottom: '8%',
    left: '50%',
    transform: 'translateX(-50%)',
    fontFamily: FONT_SIGN,
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

  const sepMap = document.createElement('span');
  sepMap.textContent = '·';
  sepMap.style.color = 'rgba(30,30,30,0.35)';
  links.appendChild(sepMap);
  const map = makeLink('THE MAP');
  map.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    window.location.href = 'graph.html'; // the content map / progress diagram (same origin)
  });
  links.appendChild(map);

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
      fontFamily: FONT_SIGN,
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

// The big red button, seen from above: a dark metal housing ring, and centred
// in it a round glossy red dome with a highlight and a darker red bevel ring.
// Pressing sinks the dome into the housing (it stays down as the menu fades),
// clicks, and fires `onPress`. No label; screen readers get "Begin".
function makeBigRedButton(onPress: () => void): HTMLButtonElement {
  if (!document.getElementById('big-red-button-style')) {
    const style = document.createElement('style');
    style.id = 'big-red-button-style';
    style.textContent = `
      .brb { position: relative; width: 168px; height: 168px; border-radius: 50%; border: none; padding: 0;
        margin: 6px 0 4px; cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
        background: radial-gradient(circle at 50% 38%, #6a6d74 0%, #3a3c42 55%, #1c1d21 100%);
        box-shadow: 0 14px 30px rgba(0,0,0,0.35), inset 0 2px 3px rgba(255,255,255,0.35), inset 0 -6px 10px rgba(0,0,0,0.5); }
      .brb:focus-visible { outline: 3px solid rgba(40,40,40,0.5); outline-offset: 6px; }
      .brb .well { position: absolute; inset: 16px; border-radius: 50%;
        background: radial-gradient(circle at 50% 60%, #0b0b0d 0%, #1e1f23 70%, #2c2d32 100%);
        box-shadow: inset 0 6px 12px rgba(0,0,0,0.8); }
      .brb .cap { position: absolute; inset: 30px; border-radius: 50%;
        background: radial-gradient(circle at 38% 32%, #ff9a8c 0%, #ff3a2c 22%, #d31414 55%, #8e0707 100%);
        box-shadow: 0 0 0 7px #8a0808, 0 0 0 9px rgba(0,0,0,0.55), 0 5px 10px 9px rgba(0,0,0,0.35), inset 0 -6px 12px rgba(90,0,0,0.5);
        transition: transform 0.07s ease, box-shadow 0.07s ease, filter 0.2s ease; }
      .brb .shine { position: absolute; left: 22%; top: 12%; width: 38%; height: 26%; border-radius: 50%;
        background: radial-gradient(ellipse at center, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 70%);
        transform: rotate(-18deg); }
      .brb:hover .cap { filter: brightness(1.08) saturate(1.05); }
      .brb.down .cap { transform: scale(0.93); filter: brightness(0.85);
        box-shadow: 0 0 0 9px #7a0606, 0 0 0 11px rgba(0,0,0,0.6), 0 2px 4px 11px rgba(0,0,0,0.3), inset 0 4px 12px rgba(60,0,0,0.6); }
    `;
    document.head.appendChild(style);
  }
  const b = document.createElement('button');
  b.className = 'brb';
  b.setAttribute('aria-label', 'Begin');
  const well = document.createElement('div');
  well.className = 'well';
  const cap = document.createElement('div');
  cap.className = 'cap';
  const shine = document.createElement('div');
  shine.className = 'shine';
  cap.appendChild(shine);
  b.append(well, cap);
  let pressed = false;
  const press = () => {
    if (pressed) return;
    pressed = true;
    b.classList.add('down'); // stays down while the menu fades out
    click();
    onPress(); // right away: starting grabs the mouse + audio, which need the live gesture
  };
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    press();
  });
  b.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      press();
    }
  });
  return b;
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
    fontFamily: FONT_SIGN,
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
