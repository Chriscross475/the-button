import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { createAsset } from '../assets';
import { spawnPedestalButton } from '../button/pedestal-button';
import { registerInteractable } from '../interactables/system';
import type { Interactable } from '../interactables/types';
import { tone, noise, ensureAudio, applause, fanfare, boo, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { FONT_SIGN, FONT_VOICE } from '../ui/fonts';

// THE BUTTON — the quiz show, named after the game — the white room becomes a quiz-show studio. You stand at
// the middle podium; two rivals (Sandra and Gary) stand at theirs; the narrator
// is the host. Every question is about THIS game.
//
//   • The question goes up on the big board. Hit your BUZZER (the red dome on
//     your podium: aim at it and press) before a rival hits theirs.
//   • Buzzed first? Aim at one of the three answers on the board and press.
//     Right: a point. Wrong (or too slow): no point, next question.
//   • A rival who buzzes first answers instead — right about half the time.
//   • Rivals get quicker every question. First to THREE wins.
// Win: the prize is a button (the exit). Lose: the consolation prize is also a
// button, just a sadder one. Either way you leave by pressing it.
//
// The rules are said at the start AND repeated: if you let two questions go by
// without buzzing, the host reminds you where the buzzer is.

const W = CONFIG.ROOM.width; // 11
const D = CONFIG.ROOM.depth; // 13
const WIN_AT = 3;
const PODIUM_Z = -1.6;
const PODIUMS = [-3, 0, 3]; // x: Sandra, YOU, Gary
const YOU = 1;
const NAMES = ['SANDRA', 'YOU', 'GARY'];
const BOARD = { w: 5.6, h: 3.0, y: 1.95, z: -D / 2 + 0.28 }; // screen face (wall face is at −D/2 + 0.06)
const READ_TIME = 3.5; // seconds the question is up before rivals may buzz
const ANSWER_TIME = 9;

interface Question {
  line: string; // the host reads it (fixed text → baked voice)
  text: string; // on the board
  answers: [string, string, string];
  correct: 0 | 1 | 2;
}

// Facts checked against the code (duck-room QUOTA, desert/corridor keys,
// elevator FLOORS/FINAL, evil-twin rule, museum centrepiece, waiting-room
// ticket, hoops opponents + GAME_TIME, circus prize, terms clause 47, desert
// rails, customer-support human).
const Q = vo({
  ducks: 'Question. How many ducks does the duck room want before it opens its back wall?',
  redKey: 'Question. What colour is the key hidden in the desert?',
  blueKey: 'Question. What colour is the key in the corridor of doors?',
  floor: 'Question. Which floor of the lift is not on the panel?',
  trust: 'Question. When the narrator says trust me, he is what?',
  museum: 'Question. What is the centrepiece of the museum?',
  ticket: 'Question. What number does the waiting room machine give you?',
  flea: 'Question. At the court, which opponent is the small one?',
  clock: 'Question. How long is a match at the court?',
  circus: 'Question. What do you win for filling the applause meter at the circus?',
  clause: 'Question. Which clause of the terms and conditions lets you out through the side door?',
  rails: 'Question. In the desert, what makes the train run you over?',
  phone: 'Question. Who finally picks up the phone at customer support?',
});
const QUESTIONS: Question[] = [
  { line: Q.ducks, text: 'How many ducks does the duck room want?', answers: ['10', '15', '50'], correct: 1 },
  { line: Q.redKey, text: 'What colour is the key hidden in the desert?', answers: ['Red', 'Blue', 'Beige'], correct: 0 },
  { line: Q.blueKey, text: 'What colour is the key in the corridor of doors?', answers: ['Green', 'Blue', 'Red'], correct: 1 },
  { line: Q.floor, text: 'Which floor of the lift is not on the panel?', answers: ['13', '40', '41'], correct: 2 },
  { line: Q.trust, text: 'When the narrator says "trust me", he is…', answers: ['Telling the truth', 'Lying', 'Asleep'], correct: 1 },
  { line: Q.museum, text: "What is the museum's centrepiece?", answers: ['A duck', "The narrator's portrait", 'The Button (2026)'], correct: 2 },
  { line: Q.ticket, text: 'Your ticket number in the waiting room?', answers: ['948', '002', '101'], correct: 0 },
  { line: Q.flea, text: 'At the court, which opponent is the small one?', answers: ['THE WALL', 'THE FLEA', 'THE DUCK'], correct: 1 },
  { line: Q.clock, text: 'How long is a match at the court?', answers: ['40 seconds', '90 seconds', 'First to eleven'], correct: 0 },
  { line: Q.circus, text: 'Fill the applause meter at the circus and you win…', answers: ['A cannon', 'A unicycle', 'A clown'], correct: 1 },
  { line: Q.clause, text: 'Which clause of the terms lets you out the side door?', answers: ['12', '47', '80'], correct: 1 },
  { line: Q.rails, text: 'In the desert, what makes the train run you over?', answers: ['Looking at it', 'Whistling', 'Stepping on the rails'], correct: 2 },
  { line: Q.phone, text: 'Who picks up the phone at customer support?', answers: ['A robot', 'The narrator', 'Grandma'], correct: 1 },
];

const INTRO = vo('Welcome to The Button! The quiz where every answer is about this game. Hit your buzzer, the big red dome on your podium, then point at your answer on the board and press. First to three wins.');
const HOW_TO = vo('Your buzzer. The big red dome, on your podium, right in front of you. Look at it and press. It is your whole job.');
const HOW_ANSWER = vo('You buzzed in. Now look at your answer on the board, and press.');
const RIGHT = vo(['Correct! The audience is thrilled. There is no audience.', 'That is right. I am legally required to act surprised.', 'Correct. Somebody has been paying attention.']);
const WRONG = vo(['Wrong! So very wrong.', 'No. That is not it. That was never going to be it.', 'Incorrect. Our lawyers have been informed.']);
const TOO_SLOW = vo('Time is up. You buzzed and then you just stood there. Bold.');
const SANDRA_IN = vo('Sandra is in first.');
const GARY_IN = vo('Gary buzzes. Gary.');
const RIVAL_RIGHT = vo(['And it is correct. Somehow.', 'Correct. A point to the rival. Try pressing faster. It is the whole show.']);
const RIVAL_WRONG = vo(['And that is wrong. Wonderfully wrong.', 'No. No it is not. Nobody tell them.']);
const SCRIPTED = vo('You brought the script. Of course the answers are in the script. It is a script. I am underlining it for you. Nobody saw that.');
const WIN = vo('Three! You win The Button! And your prize is: a button. Of course it is a button. Press it.');
const LOSE = vo('And that is three for them. You lose. The consolation prize is also a button, just a sadder one. Press it, and go.');

// ── Sounds ──
function buzzer(): void {
  ensureAudio();
  tone({ type: 'square', from: 140, to: 130, dur: 0.45, gain: 0.14 });
  tone({ type: 'sawtooth', from: 210, to: 200, dur: 0.45, gain: 0.06 });
}
function ding(): void {
  ensureAudio();
  tone({ type: 'sine', from: 1046, dur: 0.35, gain: 0.14 });
  setTimeout(() => tone({ type: 'sine', from: 1568, dur: 0.6, gain: 0.14 }), 140);
}
function honk(): void {
  ensureAudio();
  tone({ type: 'sawtooth', from: 180, to: 90, dur: 0.7, gain: 0.12, attack: 0.02 });
  noise(0.2, 0.05, 400, 'lowpass');
}

/** Headless-test hooks. */
export const gameShowTest = {
  buzz: () => {},
  answer: (_i: number) => {},
  state: () => '',
  correct: () => 0,
  scores: () => [0, 0, 0],
};

export function revealGameShow(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; its button sinks

  // ── The studio ──
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.2, D - 0.2),
    new THREE.MeshStandardMaterial({ color: 0x1c1a2e, roughness: 0.35, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.012;
  root.add(floor);
  // A big star on the floor under the podiums.
  const star = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 5),
    new THREE.MeshStandardMaterial({ color: 0xe0b040, roughness: 0.5, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
  );
  star.rotation.x = -Math.PI / 2;
  star.position.set(0, 0.014, PODIUM_Z - 0.3);
  root.add(star);
  // Velvet curtain across the back wall (0.08 off its face — never coplanar).
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.3, 3.5), new THREE.MeshStandardMaterial({ color: 0x6e0f1f, roughness: 0.9 }));
  curtain.position.set(0, 1.75, -D / 2 + 0.14);
  root.add(curtain);

  // The board: a framed screen showing the question, the three answers and
  // the scores; bulbs round its edge.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(BOARD.w + 0.3, BOARD.h + 0.3, 0.08), new THREE.MeshStandardMaterial({ color: 0x1a1a1f, roughness: 0.5 }));
  frame.position.set(0, BOARD.y, BOARD.z - 0.08);
  root.add(frame);
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 548;
  const g = cv.getContext('2d')!;
  const tex = new THREE.CanvasTexture(cv);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.w, BOARD.h), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(0, BOARD.y, BOARD.z);
  root.add(screen);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 8, 6), bulbMat, 60);
  {
    const m = new THREE.Matrix4();
    let i = 0;
    const hw = BOARD.w / 2 + 0.22;
    const hh = BOARD.h / 2 + 0.22;
    for (let k = 0; k < 20; k++) {
      const x = -hw + (2 * hw * k) / 19;
      bulbs.setMatrixAt(i++, m.makeTranslation(x, BOARD.y + hh, BOARD.z - 0.02));
      bulbs.setMatrixAt(i++, m.makeTranslation(x, BOARD.y - hh, BOARD.z - 0.02));
    }
    for (let k = 1; k < 11; k++) {
      const y = -hh + (2 * hh * k) / 11;
      bulbs.setMatrixAt(i++, m.makeTranslation(-hw, BOARD.y + y, BOARD.z - 0.02));
      bulbs.setMatrixAt(i++, m.makeTranslation(hw, BOARD.y + y, BOARD.z - 0.02));
    }
    bulbs.count = i;
    bulbs.instanceMatrix.needsUpdate = true;
  }
  root.add(bulbs);

  // The APPLAUSE sign, left of the board: dark until the crowd is cued.
  const signCv = document.createElement('canvas');
  signCv.width = 256;
  signCv.height = 80;
  const signG = signCv.getContext('2d')!;
  const signTex = new THREE.CanvasTexture(signCv);
  const drawSign = (lit: boolean) => {
    signG.fillStyle = lit ? '#ff2a2a' : '#2a0c0c';
    signG.fillRect(0, 0, 256, 80);
    signG.fillStyle = lit ? '#fff4e0' : '#5a2a2a';
    signG.textAlign = 'center';
    signG.textBaseline = 'middle';
    let px = 46;
    do signG.font = `bold ${px}px ${FONT_SIGN}`;
    while (signG.measureText('APPLAUSE').width > 230 && --px > 10);
    signG.fillText('APPLAUSE', 128, 42);
    signTex.needsUpdate = true;
  };
  drawSign(false);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.44), new THREE.MeshBasicMaterial({ map: signTex }));
  sign.position.set(-4.3, 3.0, -D / 2 + 0.3);
  root.add(sign);
  const signBack = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.54, 0.08), new THREE.MeshStandardMaterial({ color: 0x1a1a1f }));
  signBack.position.set(-4.3, 3.0, -D / 2 + 0.22);
  root.add(signBack);
  let signT = 0;
  const cueApplause = () => {
    applause(0.2);
    drawSign(true);
    signT = 1.8;
  };

  // Two spotlight beams onto the podiums (additive cones, no real lights).
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  for (const x of [-2.2, 2.2]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.4, 20, 1, true), beamMat);
    cone.position.set(x * 0.5, 1.9, PODIUM_Z + 0.3);
    root.add(cone);
  }

  // ── Podiums, buzzers, rivals ──
  const solids: { x: number; z: number; radius: number }[] = [];
  const podColors = [0x3a6fd0, 0xc6452a, 0x3f8a4a];
  const buzzers: THREE.Mesh[] = [];
  const buzzerMats: THREE.MeshStandardMaterial[] = [];
  const rivals: THREE.Group[] = [];
  PODIUMS.forEach((x, i) => {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.6), new THREE.MeshStandardMaterial({ color: podColors[i], roughness: 0.5 }));
    pod.position.set(x, 0.5, PODIUM_Z);
    root.add(pod);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.06, 0.7), new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.4 }));
    top.position.set(x, 1.03, PODIUM_Z);
    root.add(top);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd31414, roughness: 0.3, emissive: 0x000000 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.position.set(x, 1.06, PODIUM_Z + 0.05);
    root.add(dome);
    buzzers.push(dome);
    buzzerMats.push(mat);
    // Name card on the podium's front (toward the board and the camera behind
    // it you are not; it faces +Z, where you stand).
    const nc = document.createElement('canvas');
    nc.width = 256;
    nc.height = 96;
    const ng = nc.getContext('2d')!;
    ng.fillStyle = '#f6f1e4';
    ng.fillRect(0, 0, 256, 96);
    ng.fillStyle = '#1a1a1a';
    ng.textAlign = 'center';
    ng.textBaseline = 'middle';
    let px = 56;
    do ng.font = `bold ${px}px ${FONT_VOICE}`;
    while (ng.measureText(NAMES[i]).width > 220 && --px > 10);
    ng.fillText(NAMES[i], 128, 52);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(nc) }));
    card.position.set(x, 0.72, PODIUM_Z + 0.31);
    root.add(card);
    const o = { x, z: PODIUM_Z, radius: 0.55 };
    ctx.addObstacle(o);
    solids.push(o);
    if (i !== YOU) {
      const r = createAsset('dummy') as THREE.Group;
      r.scale.setScalar(0.95);
      const shirt = new THREE.MeshStandardMaterial({ color: i === 0 ? 0xd0708a : 0xe0b040, roughness: 0.8 });
      r.traverse((m) => {
        if (m instanceof THREE.Mesh) m.material = m.name === 'head' ? new THREE.MeshStandardMaterial({ color: 0xd9b08c }) : shirt;
      });
      r.position.set(x, 0, PODIUM_Z + 0.6);
      r.rotation.y = Math.PI; // facing the board, like you
      root.add(r);
      rivals.push(r);
      const ro = { x, z: PODIUM_Z + 0.6, radius: 0.35 };
      ctx.addObstacle(ro);
      solids.push(ro);
    } else rivals.push(new THREE.Group()); // (a placeholder so indices line up)
  });
  const rivalArm = (i: number) => rivals[i].getObjectByName('armR') as THREE.Object3D | undefined;

  // ── State ──
  type State = 'intro' | 'open' | 'answer' | 'rival' | 'reveal' | 'over';
  let state: State = 'intro';
  const scores = [0, 0, 0];
  let order = [...QUESTIONS].sort(() => Math.random() - 0.5);
  let qi = -1;
  let q: Question = order[0];
  let t = 0; // time in the current state
  let round = 0;
  let rivalAt = 99; // when the quicker rival buzzes, this question
  let rivalWho = 0;
  let unbuzzed = 0; // questions in a row you let go by
  let saidHowAnswer = false;
  let pick = -1; // an answer being shown (yours or a rival's)
  let pickRight = false;
  let scripted = false; // you buzzed in holding the Script: the right answer is marked
  let saidScripted = false;

  const drawBoard = () => {
    g.fillStyle = '#0d1030';
    g.fillRect(0, 0, 1024, 548);
    // Scores along the top.
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    NAMES.forEach((n, i) => {
      const cx = 170 + i * 342;
      g.fillStyle = i === YOU ? '#ffd23f' : '#9fb3c8';
      g.font = `bold 30px ${FONT_SIGN}`;
      g.fillText(`${n}  ${scores[i]}`, cx, 38);
    });
    g.fillStyle = '#ffffff22';
    g.fillRect(40, 70, 944, 3);
    // The question, wrapped and shrunk to fit.
    const text = state === 'intro' ? 'THE BUTTON' : state === 'over' ? (scores[YOU] >= WIN_AT ? 'WINNER!' : 'GAME OVER') : q.text;
    let size = 54;
    let lines: string[] = [];
    for (; size > 18; size -= 2) {
      g.font = `bold ${size}px ${FONT_VOICE}`;
      lines = [];
      let line = '';
      for (const w of text.split(' ')) {
        const tryLine = line ? `${line} ${w}` : w;
        if (g.measureText(tryLine).width > 900 && line) {
          lines.push(line);
          line = w;
        } else line = tryLine;
      }
      lines.push(line);
      if (lines.length * size * 1.2 < 200) break;
    }
    g.fillStyle = '#ffffff';
    lines.forEach((l, i) => g.fillText(l, 512, 150 + (i - (lines.length - 1) / 2) * size * 1.2));
    // The three answers.
    if (state !== 'intro' && state !== 'over') {
      q.answers.forEach((a, i) => {
        const x0 = 30 + i * 330;
        const hot = i === aimed && state === 'answer';
        let fill = hot ? '#3a4aa0' : '#1e2566';
        if (state === 'reveal' && i === pick) fill = pickRight ? '#2f8a3e' : '#a02a2a';
        if (state === 'reveal' && i === q.correct && !pickRight) fill = '#2f8a3e';
        g.fillStyle = fill;
        g.fillRect(x0, 330, 304, 180);
        g.strokeStyle = '#ffd23f';
        g.lineWidth = hot ? 8 : 3;
        g.strokeRect(x0, 330, 304, 180);
        if (scripted && state === 'answer' && i === q.correct) {
          g.strokeStyle = '#59ff7a';
          g.lineWidth = 6;
          g.setLineDash([18, 10]);
          g.strokeRect(x0 - 10, 320, 324, 200);
          g.setLineDash([]);
        }
        g.fillStyle = '#ffd23f';
        g.font = `bold 34px ${FONT_SIGN}`;
        g.fillText('ABC'[i], x0 + 30, 362);
        g.fillStyle = '#ffffff';
        let px = 44;
        do g.font = `bold ${px}px ${FONT_SIGN}`;
        while (g.measureText(a).width > 270 && --px > 12);
        g.fillText(a, x0 + 152, 432);
      });
    } else if (state === 'intro') {
      g.fillStyle = '#ffd23f';
      g.font = `italic 34px ${FONT_VOICE}`;
      g.fillText('buzz first · point at your answer · first to three', 512, 420);
    }
    tex.needsUpdate = true;
  };

  // ── Aiming: the ray from the crosshair picks your buzzer or an answer ──
  const ray = new THREE.Raycaster();
  const centre = new THREE.Vector2(0, 0);
  let aimed = -1; // 0–2: an answer box; 3: your buzzer; −1: nothing
  const BUZZ = 3;
  const aimPoint = new THREE.Vector3();
  const findAim = (): number => {
    ray.setFromCamera(centre, ctx.camera);
    ray.far = 3;
    if (state === 'open' && ray.intersectObject(buzzers[YOU], false).length) {
      aimPoint.copy(buzzers[YOU].position);
      return BUZZ;
    }
    if (state !== 'answer') return -1;
    ray.far = 16;
    const hit = ray.intersectObject(screen, false)[0];
    if (!hit?.uv) return -1;
    const px = hit.uv.x * 1024;
    const py = (1 - hit.uv.y) * 548;
    if (py < 330 || py > 510) return -1;
    for (let i = 0; i < 3; i++) {
      const x0 = 30 + i * 330;
      if (px >= x0 && px <= x0 + 304) {
        aimPoint.copy(hit.point);
        return i;
      }
    }
    return -1;
  };

  const press: Interactable = {
    id: 'game-show-press',
    position: new THREE.Vector3(0, 1, PODIUM_Z),
    radius: 16,
    promptLabel: '',
    onUse: () => {
      if (aimed === BUZZ) playerBuzz();
      else if (aimed >= 0) playerAnswer(aimed);
    },
  };
  registerInteractable(press);

  // ── The show ──
  const next = () => {
    if (scores.some((s) => s >= WIN_AT)) return finish();
    qi++;
    if (qi >= order.length) {
      order = [...QUESTIONS].sort(() => Math.random() - 0.5);
      qi = 0;
    }
    q = order[qi];
    round++;
    state = 'open';
    t = 0;
    pick = -1;
    // The quicker rival this time: rivals speed up every question.
    rivalWho = Math.random() < 0.5 ? 0 : 2;
    rivalAt = READ_TIME + Math.max(1.4, 6.5 - round * 0.75) + Math.random() * 1.2;
    ctx.narrate(q.line, 5000); // queued: after whatever the host was saying
    drawBoard();
  };

  const flash = (i: number) => {
    buzzerMats[i].emissive.setHex(0xff4020);
    ctx.after(700, () => buzzerMats[i].emissive.setHex(0x000000));
  };

  const playerBuzz = () => {
    if (state !== 'open') return;
    discover('mech:game-show');
    buzzer();
    flash(YOU);
    state = 'answer';
    t = 0;
    unbuzzed = -1; // (reset below when the question ends)
    scripted = ctx.isHolding('script');
    if (scripted && !saidScripted) {
      saidScripted = true;
      discover('reward:game-show-script');
      ctx.narrate(SCRIPTED, 6000, { priority: true });
    } else if (!saidHowAnswer) {
      saidHowAnswer = true;
      ctx.narrate(HOW_ANSWER, 4000, { priority: true });
    }
    drawBoard();
  };

  const reveal = (i: number, right: boolean, who: number) => {
    state = 'reveal';
    t = 0;
    pick = i;
    pickRight = right;
    if (right) scores[who]++;
    drawBoard();
  };

  const playerAnswer = (i: number) => {
    if (state !== 'answer') return;
    const right = i === q.correct;
    reveal(i, right, YOU);
    if (right) {
      ding();
      cueApplause();
      ctx.narrate(RIGHT[Math.floor(Math.random() * RIGHT.length)], 4000, { priority: true });
    } else {
      honk();
      ctx.narrate(WRONG[Math.floor(Math.random() * WRONG.length)], 4000, { priority: true });
    }
  };

  const rivalBuzz = () => {
    state = 'rival';
    t = 0;
    buzzer();
    flash(rivalWho);
    const arm = rivalArm(rivalWho);
    if (arm) arm.rotation.x = -1.3;
    ctx.after(400, () => arm && (arm.rotation.x = 0));
    ctx.narrate(rivalWho === 0 ? SANDRA_IN : GARY_IN, 2500, { priority: true });
    // You let this one go by without buzzing.
    unbuzzed++;
    if (unbuzzed >= 2) {
      unbuzzed = 0;
      ctx.narrate(HOW_TO, 5000); // queued, after the rival's moment
    }
  };

  const finish = () => {
    state = 'over';
    drawBoard();
    const won = scores[YOU] >= WIN_AT;
    // Clear of the podiums and of you.
    const p = ctx.playerPos();
    const at = new THREE.Vector3(won ? 0 : 3.8, 0, 2.4);
    if (Math.hypot(at.x - p.x, at.z - p.z) < 1.3) at.x += at.x > 0 ? -1.6 : 1.6;
    if (won) {
      fanfare();
      cueApplause();
      sparkle();
      discover('reward:game-show-winner');
      ctx.narrate(WIN, 7000, { priority: true });
    } else {
      boo();
      ctx.narrate(LOSE, 7000, { priority: true });
    }
    const btn = spawnPedestalButton(root, at, () => ctx.advance(at.clone()), { glow: false });
    ctx.addObstacle(btn.obstacle);
    solids.push(btn.obstacle);
  };

  addUpdater((dt) => {
    t += dt;
    if (signT > 0) {
      signT -= dt;
      if (signT <= 0) drawSign(false);
    }
    // What you're aiming at, and whether a press means anything.
    const a = findAim();
    if (a !== aimed) {
      aimed = a;
      if (state === 'answer') drawBoard();
    }
    press.promptLabel = aimed >= 0 ? 'PRESS' : '';
    if (aimed >= 0) press.position.copy(aimPoint);

    if (state === 'intro' && t > 2.5) next();
    else if (state === 'open' && t > rivalAt) rivalBuzz();
    else if (state === 'answer' && t > ANSWER_TIME) {
      reveal(-1, false, YOU);
      honk();
      ctx.narrate(TOO_SLOW, 4000, { priority: true });
    } else if (state === 'rival' && t > 1.4) {
      // Right about half the time; wrong otherwise (and pick a wrong answer).
      const right = Math.random() < 0.5;
      const wrongs = [0, 1, 2].filter((i) => i !== q.correct);
      reveal(right ? q.correct : wrongs[Math.floor(Math.random() * 2)], right, rivalWho);
      if (right) ding();
      else honk();
      ctx.narrate(right ? RIVAL_RIGHT[Math.floor(Math.random() * 2)] : RIVAL_WRONG[Math.floor(Math.random() * 2)], 3500);
    } else if (state === 'reveal' && t > 3.2) {
      if (unbuzzed < 0) unbuzzed = 0; // you buzzed in on that one
      next();
    }

    // Never wedged against a podium or a rival.
    const c = ctx.camera.position;
    for (const o of solids) {
      const need = o.radius + CONFIG.PLAYER_RADIUS + 0.02;
      const d = Math.hypot(c.x - o.x, c.z - o.z);
      if (d >= need) continue;
      const nx = d > 1e-4 ? (c.x - o.x) / d : 0;
      const nz = d > 1e-4 ? (c.z - o.z) / d : 1;
      c.x = o.x + nx * need;
      c.z = o.z + nz * need;
    }
    return false;
  });

  gameShowTest.buzz = playerBuzz;
  gameShowTest.answer = playerAnswer;
  gameShowTest.state = () => state;
  gameShowTest.correct = () => q.correct;
  gameShowTest.scores = () => [...scores];

  drawBoard();
  ctx.narrate(INTRO, 9000);
}
