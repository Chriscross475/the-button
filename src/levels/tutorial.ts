import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { addUpdater } from '../experiences/scheduler';
import { tone, noise, ensureAudio } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';

// THE TUTORIAL — the white room stays shut, the button stays up, and a cheerful
// tutorial card pops up to teach you things you already know: walk forward,
// look left, stand in the circle. Lesson four: "Whatever you do, do NOT press
// the button." Obey, and it praises you and starts again from the top — more
// patronising each lap, then contradicting itself. Disobey — press the button
// it told you not to — and that is the way out.
//
// The tutorial is text only (a bright card with a little button mascot, and
// chirpy jingles); the narrator is a separate, weary presence on the side.

const W_ROOM = 11;
const D_ROOM = 13;
const BUTTON = new THREE.Vector3(0, 0, -2); // the room's own button
const OBEY_WAIT = 8; // seconds of not pressing = lesson four passed (and back to the start)
const CIRCLES = [new THREE.Vector3(2.6, 0, 1.8), new THREE.Vector3(-2.8, 0, 2.4), new THREE.Vector3(3.2, 0, -3.6), new THREE.Vector3(-3, 0, -3.2)];

// The narrator — dry, from the side.
const N_INTRO = vo('Oh, good. A tutorial. For a game about pressing a button. I will be over here.');
const N_RIGHT = vo('That was right. It wanted left. It is very particular about left.');
const N_EARLY = vo('Not yet, apparently. Buttons are lesson four. They are very strict about lesson four.');
const N_LOOPS = vo([
  'And it starts again. It always starts again.',
  'I have done this tutorial eleven thousand times. The secret is to stop listening. To it. Not to me.',
  'It told you not to press the button. Think about who you are. Think about the name of the game.',
]);
const N_DONE = vo('There it is. The one thing it told you not to do. That was the entire tutorial. Congratulations. On nothing.');

// The tutorial's cards, per lap (the last lap repeats). Not spoken — read.
type Lesson = 'walk' | 'look' | 'circle' | 'button';
const CARDS: Record<Lesson, string[]> = {
  walk: [
    'Welcome to the tutorial! Press W to walk forward.',
    'Let\'s try walking again! W is the one with the W on it.',
    'Walking! You remember walking. Use your legs. Your game legs.',
    'Do not walk. Walk.',
  ],
  look: [
    'Now look to your LEFT!',
    'Left again! The left is over there. No, there.',
    'Look left! Or right. Left. We\'ll accept left.',
    'Look anywhere but left. Look left.',
  ],
  circle: [
    'Walk to the glowing circle!',
    'Circle time! It\'s the round one!',
    'Into the circle! Circles are safe! Circles love you!',
    'Stay out of the circle. Get in the circle.',
  ],
  button: [
    'Great job! Now, whatever you do, do NOT press the button.',
    'Remember: do NOT press the button. Good players never press the button.',
    'Do NOT. Press. The button. We are so proud of you for not pressing it.',
    'Please do not press the button. Please. It is all we have.',
  ],
};
const PRAISE = ['Well done!', 'Amazing!', 'Incredible!', 'You\'re a natural!', 'Wow!', 'So proud!'];

export function revealTutorial(ctx: GameContext): void {
  const root = ctx.levelRoot;
  // The room stays exactly as it is — walls, ceiling, and the button.
  ctx.openRoom({ walls: false, ceiling: false, keepButton: true });

  // ── The card: a bright DOM overlay with a little button mascot ──
  const card = makeCard();
  document.body.appendChild(card.el);
  // Levels have no teardown hook; the root leaves the scene on any level change.
  const watch = setInterval(() => {
    if (root.parent) return;
    clearInterval(watch);
    card.el.remove();
  }, 300);

  // ── The circle: a glowing ring on the floor, moved each lap ──
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.55, 0.75, 40),
    new THREE.MeshBasicMaterial({ color: 0x3fd07a, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  root.add(ring);

  // ── State ──
  let lap = 0;
  let lesson: Lesson = 'walk';
  let praising = 0; // > 0: showing praise, then the next lesson
  let t = 0; // time in the current lesson
  let done = false;
  let saidRight = false;
  let saidEarly = false;
  const start = new THREE.Vector3();
  let yaw0 = 0;
  const dir = new THREE.Vector3();
  const yawNow = () => {
    ctx.camera.getWorldDirection(dir);
    return Math.atan2(-dir.x, -dir.z);
  };
  const cardText = (l: Lesson) => CARDS[l][Math.min(lap, CARDS[l].length - 1)];

  const begin = (l: Lesson) => {
    lesson = l;
    t = 0;
    start.copy(ctx.playerPos());
    yaw0 = yawNow();
    ring.visible = l === 'circle';
    if (l === 'circle') ring.position.set(CIRCLES[lap % CIRCLES.length].x, 0.03, CIRCLES[lap % CIRCLES.length].z);
    card.show(cardText(l), lap);
    jingle();
  };
  const pass = () => {
    card.show(PRAISE[Math.floor(Math.random() * PRAISE.length)], lap, true);
    tada();
    praising = 1.6;
    ring.visible = false;
  };
  const next = (): Lesson | null => {
    if (lesson === 'walk') return 'look';
    if (lesson === 'look') return 'circle';
    if (lesson === 'circle') return 'button';
    return null; // after lesson four: back to the top
  };

  // The button: the only way out is pressing it when you've been told not to.
  ctx.setRoomButton(() => {
    if (done) return;
    if (lesson === 'button' && praising <= 0) {
      done = true;
      ring.visible = false;
      card.glitch();
      glitchSound();
      discover('reward:skipped-tutorial');
      ctx.narrate(N_DONE, 6500, { priority: true });
      ctx.after(2600, () => {
        card.el.remove();
        ctx.advance(BUTTON.clone());
      });
      return;
    }
    // Any other time: too early.
    card.show('Not yet! Buttons are lesson four!', lap, false, true);
    buzz();
    if (!saidEarly) {
      saidEarly = true;
      ctx.narrate(N_EARLY, 5000, { priority: true });
    }
    ctx.after(1600, () => {
      if (!done && praising <= 0) card.show(cardText(lesson), lap);
    });
  });

  addUpdater((dt) => {
    if (done) return true;
    if (praising > 0) {
      praising -= dt;
      if (praising <= 0) {
        const n = next();
        if (n) begin(n);
        else {
          // Lesson four, passed by obeying: from the top — and worse.
          lap++;
          ctx.narrate(N_LOOPS[Math.min(lap - 1, N_LOOPS.length - 1)], 6000, { priority: true });
          begin('walk');
        }
      }
      return false;
    }
    t += dt;
    const p = ctx.playerPos();
    if (lesson === 'walk') {
      if (Math.hypot(p.x - start.x, p.z - start.z) > 1.2) pass();
    } else if (lesson === 'look') {
      let d = yawNow() - yaw0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      if (d > 1.0) pass(); // turned left
      else if (d < -1.0) {
        yaw0 = yawNow(); // turned right: it wanted left
        card.show('That\'s right! No — LEFT!', lap, false, true);
        buzz();
        if (!saidRight) {
          saidRight = true;
          ctx.narrate(N_RIGHT, 4500, { priority: true });
        }
      }
    } else if (lesson === 'circle') {
      ring.material.opacity = 0.6 + Math.sin(t * 5) * 0.25;
      if (Math.hypot(p.x - ring.position.x, p.z - ring.position.z) < 0.7) pass();
    } else if (lesson === 'button') {
      // Not pressing it for a while counts as obeying.
      if (t > OBEY_WAIT) pass();
    }
    return false;
  });

  // Keep everything in the room (the walls stay up).
  ctx.setBounds({ minX: -W_ROOM / 2 + 0.4, maxX: W_ROOM / 2 - 0.4, minZ: -D_ROOM / 2 + 0.4, maxZ: D_ROOM / 2 - 0.4 });
  ctx.narrate(N_INTRO, 5000);
  begin('walk');
}

// ── The card ────────────────────────────────────────────────────────────────

function makeCard(): { el: HTMLDivElement; show: (text: string, lap: number, praise?: boolean, scold?: boolean) => void; glitch: () => void } {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    top: '9%',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    maxWidth: 'min(560px, 88vw)',
    padding: '14px 20px 14px 14px',
    borderRadius: '18px',
    background: '#fffdf4',
    border: '4px solid #ffb400',
    boxShadow: '0 8px 0 #e08a00, 0 14px 26px rgba(0,0,0,0.18)',
    fontFamily: '"Trebuchet MS", "Comic Sans MS", system-ui, sans-serif',
    fontSize: 'clamp(16px, 2.4vw, 22px)',
    fontWeight: '700',
    color: '#2a2a33',
    zIndex: '40',
    pointerEvents: 'none',
    transition: 'transform 0.18s cubic-bezier(0.3,1.6,0.5,1)',
  } as Partial<CSSStyleDeclaration>);
  // The mascot: a tiny red button with eyes.
  const mascot = document.createElement('div');
  Object.assign(mascot.style, {
    flex: '0 0 auto',
    width: '46px',
    height: '46px',
    borderRadius: '50%',
    background: 'radial-gradient(circle at 38% 32%, #ff9a8c 0%, #ff3a2c 30%, #b50f0f 100%)',
    boxShadow: '0 0 0 4px #3a3c42',
    position: 'relative',
  } as Partial<CSSStyleDeclaration>);
  for (const x of [14, 26]) {
    const eye = document.createElement('div');
    Object.assign(eye.style, { position: 'absolute', left: `${x}px`, top: '17px', width: '6px', height: '9px', borderRadius: '3px', background: '#1a1a1a' });
    mascot.appendChild(eye);
  }
  const text = document.createElement('div');
  el.append(mascot, text);
  return {
    el,
    show: (s, lap, praise = false, scold = false) => {
      text.textContent = s;
      // Each lap the card gets a little more insistent.
      el.style.borderColor = scold ? '#e0382e' : praise ? '#3fd07a' : lap >= 3 ? '#ff4fa3' : '#ffb400';
      el.style.boxShadow = `0 8px 0 ${scold ? '#a8201a' : praise ? '#2a9a58' : lap >= 3 ? '#c0337a' : '#e08a00'}, 0 14px 26px rgba(0,0,0,0.18)`;
      el.style.transform = 'translateX(-50%) scale(1.08)';
      setTimeout(() => (el.style.transform = 'translateX(-50%) scale(1)'), 120);
    },
    glitch: () => {
      text.textContent = 'WAIT— that is not— TUTORIAL COMPLETE?';
      el.style.borderColor = '#e0382e';
      el.style.boxShadow = '4px 8px 0 #1ad0ff, -4px 8px 0 #e0382e';
      el.style.transform = 'translateX(-50%) rotate(-3deg) skewX(-8deg)';
      el.style.filter = 'hue-rotate(90deg) contrast(1.6)';
    },
  };
}

// ── Sounds ──────────────────────────────────────────────────────────────────

function jingle(): void {
  ensureAudio();
  [784, 988, 1175].forEach((f, i) => setTimeout(() => tone({ type: 'triangle', from: f, dur: 0.14, gain: 0.1 }), i * 70));
}
function tada(): void {
  ensureAudio();
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone({ type: 'square', from: f, dur: i === 3 ? 0.35 : 0.1, gain: 0.07 }), i * 80));
}
function buzz(): void {
  ensureAudio();
  tone({ type: 'sawtooth', from: 140, to: 110, dur: 0.3, gain: 0.1 });
}
function glitchSound(): void {
  ensureAudio();
  noise(0.5, 0.25, 3000, 'bandpass');
  tone({ type: 'square', from: 1200, to: 60, dur: 0.6, gain: 0.12 });
}
