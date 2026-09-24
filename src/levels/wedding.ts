import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Interactable } from '../interactables/types';
import { addUpdater } from '../experiences/scheduler';
import { registerInteractable } from '../interactables/system';
import { spawnPedestalButton } from '../button/pedestal-button';
import { createAsset } from '../assets';
import { tone, noise, ensureAudio, click, applause, sparkle } from '../audio/sfx';
import { isSpeaking } from '../audio/tts';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { FONT_SIGN, FONT_VOICE } from '../ui/fonts';

// THE WEDDING SPEECH — the walls fall away and you're at the top table of a
// wedding reception, at night, under fairy lights. The DJ points at you: "and
// now, the best man". You are not the best man. You have never met these people.
//
// On the lectern in front of you: two cue cards per round, five rounds. Aim at
// one and press to read it out. Every card is worse than the other one. The
// crowd reacts (a cough, a fork on a plate, a gasp, the bride's mother leaving,
// one uncle clapping slowly), and the AWKWARDNESS meter on the stand climbs. So
// does dead air, and wandering off mid-speech.
//   • Full awkwardness: the DJ panics and plays the only song that can save a
//     wedding. Everyone dances, robotically, avoiding eye contact. The button
//     rises on the dance floor. Press it; leave.
//   • Holding the Script (the booth's warm-up list: ART, HERO, CELEBRATE), press
//     the microphone and read that instead: a perfect speech, the room weeps,
//     standing ovation. Same button, with dignity.
//   • Holding a regret bar, press the microphone: you eat it, on stage.
//
// Aim + press: one interactable; a ray from the crosshair picks the card or the
// microphone.

const SPOT = new THREE.Vector3(0, 0, -2.45); // where you stand
const LECTERN = new THREE.Vector3(0, 0, -1.5);
const FLOOR = new THREE.Vector3(0, 0, 2.3); // the dance floor (the button rises here)
const METER_POS = new THREE.Vector3(3.3, 0, -0.9);
const REACH = 3.0;
const WANDER = 4.2; // this far from the lectern mid-speech counts as walking off

// ── Lines ──
const INTRO = vo('The music stops. The DJ points at you. And now, the best man. You are not the best man. You have never met these people. Everyone is looking at you.');
const DEAD_AIR = vo([
  'Say something. Anything. Please.',
  'The silence is starting to have a silence of its own.',
  'Somebody at the back has started a conversation. It is about you.',
  'You could read a card. Any card. They are right there.',
]);
const WANDER_LINE = vo('Where are you going. The microphone is over here. Everyone saw that. Everyone is still seeing it.');
const MIC_TAP = vo('You tap the microphone. Is this on. It is on. It was always on.');
const REGRET = vo('You unwrap a regret bar. On stage. Into the microphone. You eat all of it. Nobody interrupts. Nobody could.');
const MAXED = vo('That is it. That is the most awkward a room can be. Scientists will measure other rooms against this one.');
const PANIC = vo('The DJ panics. He plays the only song that can save a wedding. Everyone dances. Nobody makes eye contact. This is how weddings heal.');
const BUTTON_UP = vo('And there, on the dance floor. The button. Press it. Leave. Do not sign the guestbook.');
const RAN_OUT = vo('You have run out of cards. Nobody claps. Nobody moves. The silence goes on until it becomes a kind of event.');
const SCRIPT_1 = vo('You pull a piece of paper from your pocket. It says: art, hero, celebrate. You read it out. Art.');
const SCRIPT_2 = vo('Hero. You point at the groom. He did not know he needed this. Nobody did.');
const SCRIPT_3 = vo('Celebrate. The room erupts. The bride is crying. Her mother comes back in, just to cry closer. A standing ovation. For a warm-up list.');
const SCRIPT_DONE = vo('You were never the best man. You are now. The button has come out to see what the fuss is about. Press it. Go out on top.');
const LATE_SCRIPT = vo('It is too late for the script. The dancing has started. The dancing is the speech now.');

// The narrator's whispered advice before each round. It does not help.
const WHISPERS = vo([
  'Okay. Deep breath. There are cue cards on the lectern. Pick one. Aim, press, read it out.',
  'Good. That was. That was a sound. Now say something nice about the bride. Use her name. People love their names.',
  'Right. You need a story. Everyone loves a story about the groom. Keep it light.',
  'You need to win them back. Big gesture. A toast, maybe. A song. I am not a doctor.',
  'Wrap it up. End strong. Say something they will remember. Actually. Say something they will forget.',
]);

type Fx = 'cough' | 'clink' | 'gasp' | 'mum' | 'clap' | 'baby';
interface Choice {
  card: string; // what's written on the cue card
  say: string; // what happens when you read it out
  fx: Fx;
  add: number; // awkwardness
}

const R1A = vo('You lean into the microphone. So. How do we all know the groom? Nobody answers. It was not a question. It is now.');
const R1B = vo('You say: knock knock. A long pause. A child at table four says: who is there. You did not prepare the second half.');
const R2A = vo('To the beautiful bride, Sharon. Her name is not Sharon. At the back, a woman called Sharon waves. Then stops.');
const R2B = vo('To the bride. Karen. Kirsten. Kevin. Three names and a man. She is still smiling. That is worse.');
const R3A = vo('You say: what happens in Prague stays in Prague. The bride turns, slowly, to the groom. The groom has never been to Prague. He says so. Nobody believes him now.');
const R3B = vo('You say: he always told me he would never love anyone the way he loved Jessica. The bride is not called Jessica. You have now established several things she is not called.');
const R4A = vo('Please raise your glasses. To Dave. And to Dave\'s mum. Nobody raises a glass. Dave\'s mum raises a glass.');
const R4B = vo('You sing a song you wrote. It is about you. It has four verses. You know the first one, so you sing it four times.');
const R5A = vo('In conclusion. Marriage. You nod, as if that settles it. It does not settle it.');
const R5B = vo('Anyway. I am single. You say it to the bride. Then, to be fair, to the groom.');

const ROUNDS: [Choice, Choice][] = [
  [
    { card: 'SO! HOW DO WE ALL KNOW THE GROOM?', say: R1A, fx: 'cough', add: 15 },
    { card: 'KNOCK KNOCK.', say: R1B, fx: 'clink', add: 20 },
  ],
  [
    { card: 'TO THE BEAUTIFUL BRIDE, SHARON!', say: R2A, fx: 'gasp', add: 20 },
    { card: 'TO THE BRIDE, UM... KAREN? KIRSTEN? KEVIN?', say: R2B, fx: 'cough', add: 25 },
  ],
  [
    { card: 'THE STAG DO! WHAT HAPPENS IN PRAGUE...', say: R3A, fx: 'gasp', add: 25 },
    { card: "HE'LL NEVER LOVE ANYONE LIKE HE LOVED JESSICA", say: R3B, fx: 'mum', add: 30 },
  ],
  [
    { card: "RAISE YOUR GLASSES! TO DAVE AND... DAVE'S MUM", say: R4A, fx: 'clap', add: 20 },
    { card: "I WROTE A SONG. IT'S ABOUT ME.", say: R4B, fx: 'clap', add: 20 },
  ],
  [
    { card: 'IN CONCLUSION: MARRIAGE.', say: R5A, fx: 'baby', add: 15 },
    { card: "ANYWAY. I'M SINGLE.", say: R5B, fx: 'baby', add: 20 },
  ],
];

// What the room does about it.
const REACT: Record<Fx, string> = vo({
  cough: 'Somebody coughs. It echoes. Marquees should not echo.',
  clink: 'A fork touches a plate. Everyone hears it. The fork is embarrassed too.',
  gasp: 'Two hundred people breathe in at once. The fairy lights flicker.',
  mum: 'The bride\'s mother stands up. She puts on her coat. She leaves. She does not look back. She does not need to.',
  clap: 'One uncle claps. Slowly. He keeps going long after it would have been kind to stop.',
  baby: 'A baby starts crying. It speaks for everyone.',
});

type Phase = 'intro' | 'speech' | 'busy' | 'dance' | 'triumph' | 'done';
type Pick = 'cardA' | 'cardB' | 'mic';

export function revealWedding(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom(); // the walls fall away
  const NIGHT = 0x15101c;
  ctx.scene.background = new THREE.Color(NIGHT);
  ctx.scene.fog = new THREE.Fog(NIGHT, 14, 42);
  ctx.setBounds({ minX: -9, maxX: 9, minZ: -4.4, maxZ: 10.5 });
  ctx.spawnAt(SPOT.clone(), Math.PI); // at the top table, facing the guests

  // ── Light: warm, low, a spotlight on you ──
  root.add(new THREE.AmbientLight(0xffd9b0, 0.35));
  for (const [x, z] of [[-4, 4], [4, 4], [0, 8]]) {
    const l = new THREE.PointLight(0xffc98a, 6, 14, 1.6);
    l.position.set(x, 3.2, z);
    root.add(l);
  }
  const spot = new THREE.SpotLight(0xfff1d6, 40, 14, 0.32, 0.5, 1);
  spot.position.set(0, 6.5, 1.5);
  spot.target.position.copy(SPOT);
  root.add(spot, spot.target);

  const mat = (color: number, rough = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const cloth = mat(0xf6f1e6, 0.95);

  // ── Fairy lights: sagging strings of warm bulbs overhead ──
  const bulbGeo = new THREE.SphereGeometry(0.035, 6, 5);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  for (let s = 0; s < 6; s++) {
    const z = -2 + s * 2.3;
    for (let i = 0; i <= 28; i++) {
      const x = -8 + (16 * i) / 28;
      const sag = 0.55 * (1 - ((x / 8) ** 2));
      const b = new THREE.Mesh(bulbGeo, bulbMat);
      b.position.set(x, 3.6 - sag, z + Math.sin(i * 1.7) * 0.05);
      root.add(b);
    }
  }

  // ── The top table behind you ──
  const top = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.75, 0.9), cloth);
  top.position.set(0, 0.375, -3.45);
  root.add(top);
  for (let x = -3; x <= 3; x += 0.6) ctx.addObstacle({ x, z: -3.45, radius: 0.5 });

  const dressed = (colors: { body: number; legs?: number }, scale = 1): THREE.Group => {
    const g = createAsset('dummy') as THREE.Group;
    g.scale.setScalar(scale);
    const body = mat(colors.body);
    const legs = mat(colors.legs ?? colors.body);
    const skin = mat(0xd9b08c);
    g.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.material = o.name === 'head' ? skin : o.parent?.name?.startsWith('leg') ? legs : body;
    });
    return g;
  };
  const faceTo = (g: THREE.Object3D, x: number, z: number) => {
    g.rotation.y = Math.atan2(x - g.position.x, z - g.position.z);
  };

  const bride = dressed({ body: 0xfbfaf6 }, 0.95);
  bride.position.set(-1.35, 0, -2.55);
  faceTo(bride, 0, 3);
  const veil = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  veil.position.y = 1.62;
  bride.add(veil);
  const groom = dressed({ body: 0x1d1f26 }, 0.97);
  groom.position.set(1.35, 0, -2.55);
  faceTo(groom, 0, 3);
  root.add(bride, groom);
  ctx.addObstacle({ x: bride.position.x, z: bride.position.z, radius: 0.3 });
  ctx.addObstacle({ x: groom.position.x, z: groom.position.z, radius: 0.3 });

  // ── The cake, on a stand to your right ──
  const cake = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.8, 16), cloth);
  stand.position.y = 0.4;
  cake.add(stand);
  [0.3, 0.22, 0.14].forEach((r, i) => {
    const tier = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.18, 20), mat(0xfff8ec, 0.6));
    tier.position.y = 0.89 + i * 0.18;
    cake.add(tier);
  });
  cake.position.set(2.7, 0, -2.2);
  root.add(cake);
  ctx.addObstacle({ x: 2.7, z: -2.2, radius: 0.45 });

  // ── The DJ, to your left ──
  const booth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.7), mat(0x1a1a22, 0.5));
  booth.position.set(-4.3, 0.5, -1.6);
  root.add(booth);
  const djLight = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.02), new THREE.MeshBasicMaterial({ color: 0xff3fa4 }));
  djLight.position.set(-4.3, 0.8, -1.24);
  root.add(djLight);
  const dj = dressed({ body: 0x3a2a5a, legs: 0x1c1c24 });
  dj.position.set(-4.3, 0, -2.25);
  faceTo(dj, 0, 3);
  root.add(dj);
  ctx.addObstacle({ x: -4.3, z: -1.8, radius: 0.85 });

  // ── The guests: round tables, facing you ──
  const TABLES: [number, number][] = [[-4.4, 2.8], [4.4, 2.8], [-2.8, 6.1], [2.8, 6.1], [-6.2, 7.8], [6.2, 7.8], [0, 8.9]];
  const SHIRTS = [0x6a8fd0, 0xc66a8a, 0x5fa07a, 0xd6b25a, 0x8a6ab8, 0xb8604a, 0x4a5a6a, 0xd08a5a];
  interface Guest { g: THREE.Group; phase: number; home: THREE.Vector3; armL: THREE.Object3D; armR: THREE.Object3D; head: THREE.Object3D }
  const guests: Guest[] = [];
  const addGuest = (g: THREE.Group, x: number, z: number) => {
    g.position.set(x, 0, z);
    faceTo(g, SPOT.x, SPOT.z);
    root.add(g);
    const guest: Guest = {
      g,
      phase: Math.random() * 6,
      home: g.position.clone(),
      armL: g.getObjectByName('armL') as THREE.Object3D,
      armR: g.getObjectByName('armR') as THREE.Object3D,
      head: g.getObjectByName('head') as THREE.Object3D,
    };
    guests.push(guest);
    return guest;
  };
  let mum: Guest | null = null;
  let uncle: Guest | null = null;
  TABLES.forEach(([tx, tz], ti) => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.75, 20), cloth);
    t.position.set(tx, 0.375, tz);
    root.add(t);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }));
    glass.position.set(tx, 0.9, tz); // a candle in a jar
    root.add(glass);
    ctx.addObstacle({ x: tx, z: tz, radius: 0.95 });
    for (let k = 0; k < 4; k++) {
      // four around the far side of the table, so none have their backs to you
      const a = Math.PI * (0.15 + 0.7 * (k / 3)) + Math.atan2(tx - SPOT.x, tz - SPOT.z) - Math.PI / 2;
      const x = tx + Math.sin(a) * 1.1;
      const z = tz + Math.cos(a) * 1.1;
      if (ti === 0 && k === 3) {
        const m = dressed({ body: 0x6e3a8a }, 0.95);
        const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.06, 16), mat(0x6e3a8a));
        hat.position.y = 1.86;
        m.add(hat);
        mum = addGuest(m, x, z);
      } else if (ti === 1 && k === 0) {
        uncle = addGuest(dressed({ body: 0x7a5a3a, legs: 0x3a2c20 }), x, z);
      } else {
        addGuest(dressed({ body: SHIRTS[(ti * 4 + k) % SHIRTS.length], legs: [0x2a2d36, 0x3c3530, 0x1c2433][k % 3] }, 0.9 + Math.random() * 0.12), x, z);
      }
    }
  });
  const dancers: Guest[] = [...guests];
  for (const g of [bride, groom, dj]) {
    dancers.push({ g, phase: Math.random() * 6, home: g.position.clone(), armL: g.getObjectByName('armL')!, armR: g.getObjectByName('armR')!, head: g.getObjectByName('head')! });
  }

  // ── Dance floor: a parquet square (a touch above the ground, never coplanar) ──
  const parquet = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshStandardMaterial({ color: 0x8a5a34, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  parquet.rotation.x = -Math.PI / 2;
  parquet.position.set(FLOOR.x, 0.014, FLOOR.z);
  root.add(parquet);

  // ── The lectern, with two cue cards and a microphone ──
  const lectern = new THREE.Group();
  lectern.position.copy(LECTERN);
  const wood = mat(0x5a3a22, 0.6);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.35), wood);
  post.position.y = 0.5;
  lectern.add(post);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 0.6), wood);
  desk.position.y = 1.05;
  desk.rotation.x = -0.33; // slopes down toward you
  lectern.add(desk);
  root.add(lectern);
  ctx.addObstacle({ x: LECTERN.x, z: LECTERN.z, radius: 0.4 });
  const micStem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.32, 6), mat(0x222222, 0.4));
  micStem.position.set(0, 1.26, 0.2);
  micStem.rotation.x = -0.5;
  const micHead = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), mat(0x333333, 0.3));
  micHead.position.set(0, 1.4, 0.12);
  lectern.add(micStem, micHead);

  // A card: canvas text, lying on the desk. The desk faces you, so the texture
  // is turned 180° to read right way up from where you stand.
  const makeCard = (x: number) => {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 340;
    const tex = new THREE.CanvasTexture(cv);
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.PI;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.34), new THREE.MeshBasicMaterial({ map: tex }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, 0);
    desk.add(m);
    return { m, cv, tex };
  };
  // +x is YOUR left (you face +z): card A on the left, card B on the right.
  const cardA = makeCard(0.31);
  const cardB = makeCard(-0.31);
  const drawCard = (c: { cv: HTMLCanvasElement; tex: THREE.CanvasTexture }, text: string, dim = false) => {
    const g = c.cv.getContext('2d');
    if (!g) return;
    g.fillStyle = dim ? '#cfc8bb' : '#fffdf6';
    g.fillRect(0, 0, 512, 340);
    g.strokeStyle = '#d87a9a';
    g.lineWidth = 10;
    g.strokeRect(12, 12, 488, 316);
    g.fillStyle = dim ? '#8a8378' : '#2a2320';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // Wrap into ≤3 lines, shrinking until it fits.
    let px = 54;
    let lines: string[] = [];
    do {
      g.font = `bold ${px}px ${FONT_SIGN}`;
      lines = [];
      let cur = '';
      for (const w of text.split(' ')) {
        const t = cur ? cur + ' ' + w : w;
        if (g.measureText(t).width > 440 && cur) {
          lines.push(cur);
          cur = w;
        } else cur = t;
      }
      if (cur) lines.push(cur);
    } while ((lines.length > 3 || lines.some((l) => g.measureText(l).width > 450)) && --px > 14);
    lines.forEach((l, i) => g.fillText(l, 256, 170 + (i - (lines.length - 1) / 2) * px * 1.15));
    c.tex.needsUpdate = true;
  };

  // ── The AWKWARDNESS meter, on a stand to your front-right ──
  const mcv = document.createElement('canvas');
  mcv.width = 256;
  mcv.height = 512;
  const mtex = new THREE.CanvasTexture(mcv);
  const meter = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.6), new THREE.MeshBasicMaterial({ map: mtex }));
  meter.position.set(METER_POS.x, 1.35, METER_POS.z);
  faceTo(meter, SPOT.x, SPOT.z);
  root.add(meter);
  const meterPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), mat(0x333333));
  meterPole.position.set(METER_POS.x, 0.3, METER_POS.z);
  root.add(meterPole);
  ctx.addObstacle({ x: METER_POS.x, z: METER_POS.z, radius: 0.35 });
  let shown = -1;
  const drawMeter = (v: number) => {
    const g = mcv.getContext('2d');
    if (!g) return;
    g.fillStyle = '#1b1720';
    g.fillRect(0, 0, 256, 512);
    g.strokeStyle = '#e8c86a';
    g.lineWidth = 6;
    g.strokeRect(6, 6, 244, 500);
    g.fillStyle = '#f0e2b8';
    g.textAlign = 'center';
    let px = 34;
    do g.font = `bold ${px}px ${FONT_VOICE}`;
    while (g.measureText('AWKWARDNESS').width > 220 && --px > 10);
    g.fillText('AWKWARDNESS', 128, 52);
    g.fillStyle = '#2c2630';
    g.fillRect(78, 80, 100, 400);
    const k = THREE.MathUtils.clamp(v / 100, 0, 1);
    const hue = 55 - k * 55; // yellow → red
    g.fillStyle = `hsl(${hue}, 85%, 55%)`;
    g.fillRect(78, 80 + 400 * (1 - k), 100, 400 * k);
    mtex.needsUpdate = true;
  };
  drawMeter(0);

  // ── State ──
  let phase: Phase = 'intro';
  let round = 0;
  let awk = 0; // 0..100
  let awkShown = 0;
  let idleT = 0;
  let deadAir = 0;
  let wanderCool = 0;
  let micCool = 0;
  let clapLeft = 0;
  let clapT = 0;
  let mumLeaving = false;
  let gaspT = 0; // > 0: the room recoils
  let weep = false;
  let exitBtn: ReturnType<typeof spawnPedestalButton> | null = null;
  let songT = 0;
  let songStep = 0;
  let t = 0;

  const addAwk = (n: number) => {
    if (awk === 0 && n > 0) discover('mech:awkward-meter');
    awk = Math.min(100, awk + n);
  };

  // A tiny sequencer: each step runs, then the next waits for its minimum time
  // AND for the narrator to finish (capped), so lines and silences land in order.
  const steps: { fn: () => void; min: number }[] = [];
  let stepWait = 0;
  let stepT = 0;
  const then = (fn: () => void, min = 0.2) => steps.push({ fn, min });

  // ── Sound effects for the room ──
  const fx = (f: Fx) => {
    ensureAudio();
    if (f === 'cough') {
      noise(0.12, 0.2, 700, 'bandpass');
      setTimeout(() => noise(0.1, 0.16, 650, 'bandpass'), 220);
    } else if (f === 'clink') {
      tone({ type: 'sine', from: 2640, dur: 0.35, gain: 0.05 });
    } else if (f === 'gasp') {
      noise(0.7, 0.1, 1800, 'highpass');
      gaspT = 1.2;
      bride.rotation.y = Math.atan2(SPOT.x - bride.position.x, SPOT.z - bride.position.z);
    } else if (f === 'mum') {
      mumLeaving = true;
    } else if (f === 'clap') {
      clapLeft = 7;
      clapT = 0;
    } else if (f === 'baby') {
      for (let i = 0; i < 3; i++) setTimeout(() => tone({ type: 'sawtooth', from: 520, to: 740, dur: 0.45, gain: 0.035 }), i * 600);
    }
  };

  const showRound = () => {
    const [a, b] = ROUNDS[round];
    drawCard(cardA, a.card);
    drawCard(cardB, b.card);
  };
  const blankCards = () => {
    drawCard(cardA, '...', true);
    drawCard(cardB, '...', true);
  };

  const startRound = () => {
    phase = 'busy';
    then(() => ctx.narrate(WHISPERS[round], 6000));
    then(() => {
      showRound();
      phase = 'speech';
      idleT = 0;
    });
  };

  const choose = (which: 0 | 1) => {
    if (phase !== 'speech') return;
    discover('mech:cue-cards');
    click();
    const c = ROUNDS[round][which];
    phase = 'busy';
    blankCards();
    then(() => ctx.narrate(c.say, 7000, { priority: true }));
    then(() => {
      fx(c.fx);
      addAwk(c.add);
      ctx.narrate(REACT[c.fx], 5000);
    }, 0.3);
    then(() => {}, 1.6); // the silence afterwards. Let it sit.
    then(() => {
      round++;
      if (awk >= 100) maxOut();
      else if (round >= ROUNDS.length) ranOut();
      else startRound();
    });
  };

  const ranOut = () => {
    then(() => ctx.narrate(RAN_OUT, 6000));
    then(() => {
      fx('cough');
      awk = 100;
    }, 2.5);
    then(() => maxOut());
  };

  let maxed = false;
  const maxOut = () => {
    if (maxed) return;
    maxed = true;
    phase = 'busy';
    then(() => ctx.narrate(MAXED, 5000, { priority: true }));
    then(() => {
      // a record scratch, then the song
      ensureAudio();
      tone({ type: 'sawtooth', from: 900, to: 120, dur: 0.35, gain: 0.08 });
      noise(0.3, 0.12, 2500, 'bandpass');
    }, 0.6);
    then(() => {
      phase = 'dance';
      discover('mech:panic-song');
      ctx.narrate(PANIC, 6000, { priority: true });
    }, 0.6);
    then(() => raiseButton(BUTTON_UP), 3.0);
  };

  const raiseButton = (line: string) => {
    if (exitBtn) return;
    exitBtn = spawnPedestalButton(root, FLOOR.clone(), () => {
      if (phase === 'done') return;
      phase = 'done';
      ctx.after(500, () => ctx.advance(FLOOR.clone()));
    });
    ctx.addObstacle(exitBtn.obstacle);
    ctx.narrate(line, 5000);
  };

  const readScript = () => {
    phase = 'triumph';
    steps.length = 0; // whatever was next, this replaces it
    blankCards();
    clapLeft = 0;
    then(() => ctx.narrate(SCRIPT_1, 6000, { priority: true }));
    then(() => ctx.narrate(SCRIPT_2, 5000));
    then(() => {
      weep = true;
      applause(0.26, 3.2);
      sparkle();
      ctx.narrate(SCRIPT_3, 7000);
    });
    then(() => {
      applause(0.2, 2.4);
      discover('reward:best-man');
      raiseButton(SCRIPT_DONE);
    }, 2.0);
  };

  const pressMic = () => {
    if (phase === 'done') return;
    if (ctx.isHolding('script')) {
      if (phase === 'dance') {
        ctx.narrate(LATE_SCRIPT, 4000, { priority: true });
        return;
      }
      if (phase !== 'triumph') readScript();
      return;
    }
    if (phase === 'dance' || phase === 'triumph') return;
    if (ctx.isHolding('regret-bar')) {
      ctx.consumeHeld('regret-bar');
      discover('reward:ate-on-stage');
      noise(0.5, 0.08, 900, 'lowpass'); // crinkle, chew
      ctx.narrate(REGRET, 6000, { priority: true });
      addAwk(25);
      return;
    }
    if (micCool > 0) return;
    micCool = 6;
    tone({ type: 'sine', from: 180, dur: 0.12, gain: 0.12 });
    noise(0.1, 0.1, 400, 'lowpass');
    ctx.narrate(MIC_TAP, 3500, { priority: true });
    addAwk(5);
  };

  const press = (p: Pick) => {
    if (p === 'mic') pressMic();
    else choose(p === 'cardA' ? 0 : 1);
  };

  // ── Aim + press ──
  const targets: { obj: THREE.Object3D; pick: Pick }[] = [
    { obj: cardA.m, pick: 'cardA' },
    { obj: cardB.m, pick: 'cardB' },
    { obj: micHead, pick: 'mic' },
    { obj: micStem, pick: 'mic' },
    { obj: post, pick: 'mic' },
  ];
  const objs = targets.map((x) => x.obj);
  const ray = new THREE.Raycaster();
  ray.far = REACH;
  const CENTER = new THREE.Vector2(0, 0);
  let hover: Pick | null = null;
  const it: Interactable = {
    id: 'wedding-aim',
    position: new THREE.Vector3(),
    radius: REACH + 0.5,
    promptLabel: '',
    onUse: () => {
      if (hover) press(hover);
    },
  };
  registerInteractable(it);

  // The opening: the DJ's line, then round one.
  blankCards();
  then(() => {
    fx('clink');
    ctx.narrate(INTRO, 7000, { priority: true });
  }, 0.4);
  startRound();

  // ── The song: an original panic-floor filler, 132 bpm, square lead + bass ──
  const BEAT = 60 / 132 / 2; // eighth notes
  const LEAD = [0, 0, 4, 0, 7, 7, 4, 0, 5, 5, 9, 5, 7, -1, 4, -1, 0, 0, 4, 0, 7, 7, 9, 7, 5, 4, 2, 0, 2, -1, 0, -1];
  const BASS = [0, 0, 0, 0, 5, 5, 7, 7];
  const hz = (semi: number, base: number) => base * 2 ** (semi / 12);

  addUpdater((dt) => {
    t += dt;
    micCool -= dt;
    wanderCool -= dt;

    // Sequencer.
    if (steps.length) {
      stepT += dt;
      const busy = isSpeaking() && stepT < 14;
      if (stepT >= stepWait && !busy) {
        const s = steps.shift()!;
        stepT = 0;
        stepWait = steps.length ? steps[0].min : 0;
        s.fn();
        if (steps.length) stepWait = steps[0].min;
      }
    } else stepT = 0;

    // Crosshair pick.
    hover = null;
    if (phase !== 'done') {
      ray.setFromCamera(CENTER, ctx.camera);
      const h = ray.intersectObjects(objs, true)[0];
      if (h) {
        let o: THREE.Object3D | null = h.object;
        while (o && !objs.includes(o)) o = o.parent;
        if (o) {
          const p = targets[objs.indexOf(o)].pick;
          if (p === 'mic' || phase === 'speech') hover = p;
        }
        it.position.copy(h.point);
      }
    }
    it.promptLabel = hover ? 'PRESS' : '';

    // Dead air, and walking off mid-speech: both count.
    const pl = ctx.playerPos();
    if (phase === 'speech') {
      idleT += dt;
      if (idleT > 11) {
        idleT = 2;
        ctx.narrate(DEAD_AIR[deadAir++ % DEAD_AIR.length], 4000);
        fx(deadAir % 2 ? 'cough' : 'clink');
        addAwk(5);
      }
      if (Math.hypot(pl.x - LECTERN.x, pl.z - LECTERN.z) > WANDER && wanderCool <= 0) {
        wanderCool = 12;
        ctx.narrate(WANDER_LINE, 5000, { priority: true });
        addAwk(10);
      }
      // Full up mid-round (dead air, a regret bar, the microphone): that's it.
      if (awk >= 100) maxOut();
    }

    // The meter eases toward its value.
    awkShown += (awk - awkShown) * Math.min(1, dt * 3);
    if (weep) awkShown += (0 - awkShown) * Math.min(1, dt * 2);
    const rounded = Math.round(awkShown);
    if (rounded !== shown) {
      shown = rounded;
      drawMeter(awkShown);
    }

    // One uncle, clapping slowly.
    if (clapLeft > 0 && uncle) {
      clapT += dt;
      const u: Guest = uncle;
      const k = Math.sin(clapT * Math.PI * 1.8);
      u.armL.rotation.set(-1.2, 0, -0.5 + 0.35 * Math.abs(k));
      u.armR.rotation.set(-1.2, 0, 0.5 - 0.35 * Math.abs(k));
      if (clapT > 1.1) {
        clapT = 0;
        clapLeft--;
        noise(0.05, 0.22, 2000, 'bandpass');
        if (clapLeft === 0) {
          u.armL.rotation.set(0, 0, 0);
          u.armR.rotation.set(0, 0, 0);
        }
      }
    }

    // The bride's mother, leaving.
    if (mumLeaving && mum) {
      const m: Guest = mum;
      const g = m.g.position;
      const tx = -9.5;
      const tz = 11;
      const d = Math.hypot(tx - g.x, tz - g.z);
      if (d > 0.1) {
        g.x += ((tx - g.x) / d) * Math.min(d, 1.3 * dt);
        g.z += ((tz - g.z) / d) * Math.min(d, 1.3 * dt);
        m.g.rotation.y = Math.atan2(tx - g.x, tz - g.z);
        m.phase += dt * 9;
        const legs = ['legL', 'legR'].map((n) => m.g.getObjectByName(n));
        if (legs[0]) legs[0].rotation.x = Math.sin(m.phase) * 0.45;
        if (legs[1]) legs[1].rotation.x = -Math.sin(m.phase) * 0.45;
      } else {
        root.remove(m.g);
        mumLeaving = false;
        mum = null;
      }
    }

    // A gasp: everyone recoils.
    if (gaspT > 0) {
      gaspT -= dt;
      const k = Math.max(0, gaspT) / 1.2;
      for (const gu of guests) gu.head.rotation.x = -0.3 * Math.sin(k * Math.PI);
    }

    // Weeping, then a standing ovation (bouncing, hands to faces).
    if (weep) {
      for (const gu of guests) {
        gu.phase += dt;
        gu.g.position.y = Math.abs(Math.sin(gu.phase * 6)) * 0.08;
        gu.armL.rotation.x = -2.5 + Math.sin(gu.phase * 3) * 0.15;
        gu.armR.rotation.x = -2.5 + Math.cos(gu.phase * 3) * 0.15;
      }
    }

    // Dancing: robotic, in sync-ish, nobody looking at you.
    if (phase === 'dance' || (phase === 'done' && songStep > 0)) {
      for (const d of dancers) {
        const beat = Math.sin((t + d.phase * 0.05) * Math.PI * 2.2);
        d.g.position.y = Math.abs(beat) * 0.12;
        d.g.rotation.y += Math.sin(t * 2 + d.phase) * dt * 1.2;
        d.armL.rotation.set(-1.4 + (beat > 0 ? 0.6 : 0), 0, -0.3);
        d.armR.rotation.set(-1.4 + (beat > 0 ? 0 : 0.6), 0, 0.3);
        d.head.rotation.y = Math.sin(t * 3 + d.phase) * 0.5; // eyes anywhere but you
      }
      djLight.material.color.setHSL((t * 0.5) % 1, 0.9, 0.55);
      songT += dt;
      while (songT >= BEAT) {
        songT -= BEAT;
        const n = LEAD[songStep % LEAD.length];
        if (n >= 0) tone({ type: 'square', from: hz(n, 523.25), dur: BEAT * 0.8, gain: 0.035 });
        if (songStep % 2 === 0) tone({ type: 'triangle', from: hz(BASS[(songStep >> 2) % BASS.length], 130.8), dur: BEAT * 1.6, gain: 0.08 });
        if (songStep % 2 === 1) noise(0.04, 0.05, 7000, 'highpass');
        songStep++;
      }
    }
    return false; // lives as long as the room
  });
}

/** Headless-test hooks. */
export const weddingTest = { ROUNDS, SPOT, LECTERN, FLOOR };
