import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Interactable } from '../interactables/types';
import type { RoomBounds } from '../controls/player-camera';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { registerInteractable } from '../interactables/system';
import { createAsset } from '../assets';
import { makeMiniButton } from '../objects/original-button';
import { tone, noise, ensureAudio, click, sparkle, applause, boo } from '../audio/sfx';
import { isSpeaking } from '../audio/tts';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { FONT_VOICE, FONT_SIGN } from '../ui/fonts';

// THE COURTROOM — the white room stays shut and becomes a wood-panelled court.
// You are the defendant, charged with pressing the button. The judge (a big
// dummy up on the bench), a jury of twelve, a prosecutor, and Exhibit A: the
// button, in an evidence bag.
//
// At the lectern: GUILTY or NOT GUILTY. On the tray beside it: evidence — press
// the tray holding anything you carried in, and the court rules on it (a
// receipt, a premium card, a regret bar, a coin can each get you off; an axe is
// contempt; a duck only moves the jury). NOT GUILTY sends the jury out: with
// any sympathy on your side they acquit, otherwise guilty.
//   • Acquitted: the judge slams the button on his bench himself — you're out.
//   • Guilty: the sentence is to press the button. The bag comes off Exhibit A;
//     pressing it is the way out.
//   • Contempt (the axe, three OBJECTIONs, tampering with Exhibit A twice): a
//     few seconds in the cell in the corner, then back to it.
// The OBJECTION button on your desk makes the narrator stumble mid-sentence.
//
// Aim + press: one interactable, and a ray from the crosshair picks which of the
// close-together pressables (the two plea buttons, the tray, OBJECTION, Exhibit
// A) you mean.

const { width: W, depth: D, height: H } = CONFIG.ROOM; // 11 × 13 × 3.6
const WALL_IN = 0.06; // the white room's walls: inner faces at ±(W|D)/2 ∓ this
const REACH = 3.2;

const LECTERN = new THREE.Vector3(0, 0, -3.0);
const TRAY = new THREE.Vector3(-1.15, 0, -3.0);
const EXHIBIT = new THREE.Vector3(2.3, 0, -3.6);
const DESK = new THREE.Vector3(-1.9, 0, 0.5);
const PROS = new THREE.Vector3(3.0, 0, -1.0);
const BENCH = { x0: -1.9, x1: 1.9, z0: -5.85, z1: -5.1, top: 1.3 };
const JUDGE = new THREE.Vector3(0, 0.45, -6.12);
const JUDGE_SCALE = 1.35;
const GAVEL_BTN = new THREE.Vector3(0.45, BENCH.top, -5.64); // under the judge's right-arm swing

const MAIN: RoomBounds = { minX: -W / 2 + 0.3, maxX: W / 2 - 0.3, minZ: BENCH.z1 + 0.3, maxZ: D / 2 - 0.3 };
const BARS_X = 3.5; // the cell: front-right corner, barred along x = BARS_X and z = BARS_Z
const BARS_Z = 4.5;
const CELL: RoomBounds = { minX: BARS_X + 0.36, maxX: W / 2 - 0.3, minZ: BARS_Z + 0.36, maxZ: D / 2 - 0.3 };
const JAIL_MS = 7000;

// ── Lines ──
const ALL_RISE = vo('All rise. The Court of the Button is now in session. The honourable judge presiding. He is a dummy. That has never stopped anyone.');
const CHARGES = vo('The defendant stands accused of pressing the button. Repeatedly. Without reasonable cause. And, on one occasion, with feeling.');
const INVITE = vo('How does the defendant plead? Guilty, or not guilty, at the lectern. Or put evidence on the tray, if you brought any. Nobody ever brings any.');
const PLEA_GUILTY = vo('Guilty. Refreshing. The court sentences you to press the button. Exhibit A. Once. Under supervision.');
const PLEA_NOT = vo('Not guilty. Bold. The jury will now deliberate. Please do not look at them while they do. It puts them off.');
const JURY_GUILTY = vo('The jury finds the defendant guilty. Unanimously. One of them was asleep, but he nodded at the right moment. The sentence: press the button.');
const JURY_FREE = vo('The jury finds the defendant not guilty. It was the evidence. Mostly the evidence. Court is adjourned.');
const BAG_OFF = vo('The bag is off. Exhibit A. Press it. That is the sentence. Try not to enjoy it.');
const ADJOURNED = vo('The judge presses his own button. He has wanted to all day. Exhibit A is released to the defendant. Go on. You are free to press it.');
const TAMPER = vo('That is Exhibit A. Please do not touch the evidence. It is in a bag for a reason.');
const TAMPER_AGAIN = vo('Tampering with evidence. Again. Contempt of court. Take them down.');
const EMPTY_TRAY = vo('The evidence tray is empty. So is the defence.');
const SEEN = vo('The court has already seen that. The court was not impressed the first time.');
const LATE = vo('The verdict is in. Evidence now is just showing off.');
const JURY_OUT = vo('The jury is out. Nobody is listening. Least of all the jury.');
const GENERIC = vo('The court has no idea what that is. It is entered into evidence anyway. It changes nothing.');
// Evidence — one ruling per thing you might have carried in.
const EV_RECEIPT = vo('A receipt. The defendant paid for the button. You cannot be guilty of pressing a button you bought. Case dismissed.');
const EV_PREMIUM = vo('A premium card. Premium members are above the law. Case dismissed. With apologies for the inconvenience.');
const EV_DUCK = vo('Exhibit B. A duck. The jury is visibly moved. Two of them are crying. It proves absolutely nothing.');
const EV_COOKED = vo('A roast duck. The defence rests. The jury would like to adjourn for lunch. Request denied, but noted, warmly.');
const EV_AXE = vo('The defendant has brought an axe into a court of law. Contempt of court. Take them down.');
const EV_SCRIPT = vo('The defendant reads their defence from a script. It says: art, hero, celebrate. That is a warm-up, not a defence. The jury applauds anyway.');
const EV_REGRET = vo('A regret bar. Half eaten. The defendant shows remorse. The court shows mercy. Sentence suspended.');
const EV_COIN = vo('A single coin, slid discreetly across the tray. The court accepts. Not guilty. This never happened.');
const EV_MONEY = vo('A pile of money. In open court. In front of the jury. The court cannot be bought. Not like that.');
const EV_SPINNER = vo('A fidget spinner. The defence argues the defendant was merely fidgeting. The court finds this relatable.');
const EV_TORCH = vo('An ultraviolet torch. Under it, Exhibit A is covered in your fingerprints. Thank you. That was very helpful. For the prosecution.');
const EV_ORIGINAL = vo('The defendant has brought another button. The court now has two buttons and one defendant. Mistrial. Everybody out.');
const EV_REPLICA = vo('A replica of the button. The defence claims this is the one that was pressed. Nobody can tell the difference. Reasonable doubt.');
const EV_KEY = vo('A key. The defendant would like to lock the court out of its own courtroom. Denied. Nice try.');
const EV_TICKET = vo('A ticket. Number forty seven. This is a court of law, not a deli counter.');
const EV_BALL = vo('A basketball. The defence would like to settle this on the court. Wrong kind of court. Overruled.');
const OBJ_STUMBLE = vo([
  'Er. Sustained? Overruled. I have lost my place.',
  'Objection noted. And, after careful consideration, ignored.',
  'You cannot object to the. Actually, you can. Fine. Sustained. Where was I.',
]);
const OBJ_QUIET = vo('Objection to what? Nobody was saying anything. Overruled.');
const OBJ_WARN = vo('One more objection and it is contempt. The court has a very small amount of patience and you are using all of it.');
const OBJ_CONTEMPT = vo('Contempt of court. Take them down. And somebody unplug that button.');
const CELL_IN = vo('The cells. Just for a moment. Think about what you have pressed.');
const RELEASED = vo('Released. On good behaviour. Which will be a first.');

type Effect = 'dismiss' | 'bribe' | 'mercy' | 'mistrial' | 'contempt' | 'sympathy' | 'moved' | 'applause' | 'guilt' | 'none';
interface Ruling {
  line: string;
  effect: Effect;
  reward?: string;
  consume?: boolean;
}
const RULINGS: Record<string, Ruling> = {
  receipt: { line: EV_RECEIPT, effect: 'dismiss' },
  'premium-card': { line: EV_PREMIUM, effect: 'dismiss', reward: 'reward:above-the-law' },
  'regret-bar': { line: EV_REGRET, effect: 'mercy', reward: 'reward:shows-remorse' },
  coin: { line: EV_COIN, effect: 'bribe', reward: 'reward:bribed-the-court', consume: true },
  'original-button': { line: EV_ORIGINAL, effect: 'mistrial' },
  'replica-button': { line: EV_REPLICA, effect: 'dismiss' },
  axe: { line: EV_AXE, effect: 'contempt' },
  duck: { line: EV_DUCK, effect: 'moved' },
  'cooked-duck': { line: EV_COOKED, effect: 'sympathy' },
  script: { line: EV_SCRIPT, effect: 'applause' },
  spinner: { line: EV_SPINNER, effect: 'sympathy' },
  money: { line: EV_MONEY, effect: 'none' },
  'uv-torch': { line: EV_TORCH, effect: 'guilt' },
  ticket: { line: EV_TICKET, effect: 'none' },
  basketball: { line: EV_BALL, effect: 'none' },
};
const rulingFor = (kind: string): Ruling =>
  RULINGS[kind] ?? (kind.startsWith('key-') ? { line: EV_KEY, effect: 'none' } : { line: GENERIC, effect: 'none' });

type Phase = 'trial' | 'deliberating' | 'sentenced' | 'acquitted' | 'jailed' | 'done';
type Pick = 'guilty' | 'not-guilty' | 'tray' | 'objection' | 'exhibit';

export function revealCourtroom(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom({ walls: false, ceiling: false }); // the room stays; its button sinks
  ctx.scene.fog = null;
  ctx.setRegions([MAIN]);
  const cam = ctx.camera.position;
  if (Math.hypot(cam.x - LECTERN.x, cam.z - LECTERN.z) < 1.0 || cam.z < MAIN.minZ) cam.z = LECTERN.z + 1.1;
  if (cam.x > BARS_X - 0.4 && cam.z > BARS_Z - 0.4) cam.set(BARS_X - 0.6, cam.y, BARS_Z - 0.6);

  // ── Materials + builders ──
  const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.7 });
  const darkWood = new THREE.MeshStandardMaterial({ color: 0x3e2716, roughness: 0.65 });
  const paper = new THREE.MeshStandardMaterial({ color: 0x2f4a3c, roughness: 0.95 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a83a, roughness: 0.35, metalness: 0.8 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.5, metalness: 0.6 });
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const label = (text: string, w: number, h: number, fg: string, bg: string, font = FONT_VOICE): THREE.Mesh => {
    const cw = 512;
    const ch = Math.max(64, Math.round((cw * h) / w));
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext('2d')!;
    g.fillStyle = bg;
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let px = Math.round(ch * 0.62);
    do g.font = `bold ${px}px ${font}`;
    while (g.measureText(text).width > cw * 0.9 && --px > 8);
    g.fillText(text, cw / 2, ch / 2 + 2);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
    root.add(m);
    return m;
  };
  const solid = (x: number, z: number, radius: number) => ctx.addObstacle({ x, z, radius });

  // ── The room: wainscot + green paper on every wall, a carpet ──
  const WAIN = 1.3;
  for (const side of [-1, 1]) {
    const z = side * (D / 2 - WALL_IN);
    box(W - 0.14, WAIN, 0.04, wood, 0, WAIN / 2, z - side * 0.03);
    box(W - 0.14, H - WAIN, 0.02, paper, 0, (H + WAIN) / 2, z - side * 0.015);
    const x = side * (W / 2 - WALL_IN);
    box(0.04, WAIN, D - 0.14, wood, x - side * 0.03, WAIN / 2, 0);
    box(0.02, H - WAIN, D - 0.14, paper, x - side * 0.015, (H + WAIN) / 2, 0);
  }
  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(W - 0.2, D - 0.2),
    new THREE.MeshStandardMaterial({ color: 0x6b1f24, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = 0.012;
  root.add(carpet);
  const crest = label('THE COURT OF THE BUTTON', 3.6, 0.42, '#e8d6a0', '#2a1a0e');
  crest.position.set(0, 3.0, -D / 2 + WALL_IN + 0.07);

  // ── The bench, the judge, and his button ──
  box(2.8, 0.45, 0.6, darkWood, 0, 0.225, JUDGE.z); // dais
  box(BENCH.x1 - BENCH.x0, BENCH.top, BENCH.z1 - BENCH.z0, darkWood, 0, BENCH.top / 2, (BENCH.z0 + BENCH.z1) / 2);
  box(BENCH.x1 - BENCH.x0 + 0.1, 0.06, BENCH.z1 - BENCH.z0 + 0.1, wood, 0, BENCH.top + 0.03, (BENCH.z0 + BENCH.z1) / 2);
  const judge = createAsset('dummy') as THREE.Group;
  judge.scale.setScalar(JUDGE_SCALE);
  judge.position.copy(JUDGE);
  const robe = new THREE.MeshStandardMaterial({ color: 0x151518, roughness: 0.8 });
  judge.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = o.name === 'head' ? new THREE.MeshStandardMaterial({ color: 0xd9b08c, roughness: 0.8 }) : robe;
  });
  const wig = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.34), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 1 }));
  wig.position.y = 1.72;
  judge.add(wig);
  root.add(judge);
  const judgeArm = judge.getObjectByName('armR') as THREE.Object3D;
  const block = box(0.26, 0.28, 0.26, darkWood, GAVEL_BTN.x, BENCH.top + 0.14, GAVEL_BTN.z);
  const gavelBtn = makeMiniButton();
  gavelBtn.scale.setScalar(1.4);
  gavelBtn.position.set(GAVEL_BTN.x, block.position.y + 0.14, GAVEL_BTN.z);
  root.add(gavelBtn);
  const gavelDome = gavelBtn.getObjectByName('dome') as THREE.Object3D;
  const nameplate = label('HIS HONOUR', 1.1, 0.2, '#e8d6a0', '#2a1a0e');
  nameplate.position.set(0, BENCH.top - 0.25, BENCH.z1 + 0.012);

  // ── The jury box (left wall): a rail, a riser, twelve jurors ──
  const JX0 = -W / 2 + 0.1;
  const JX1 = -3.4;
  const JZ0 = -3.9;
  const JZ1 = 0.9;
  box(1.1, 0.3, JZ1 - JZ0 - 0.2, wood, -4.85, 0.15, (JZ0 + JZ1) / 2); // back-row riser
  box(0.08, 0.9, JZ1 - JZ0, wood, JX1, 0.45, (JZ0 + JZ1) / 2);
  for (const z of [JZ0, JZ1]) box(JX1 - JX0, 0.9, 0.08, wood, (JX0 + JX1) / 2, 0.45, z);
  for (let z = JZ0; z <= JZ1 + 1e-6; z += 0.3) solid(JX1, z, 0.12);
  for (let x = JX0; x <= JX1 + 1e-6; x += 0.3) {
    solid(x, JZ0, 0.12);
    solid(x, JZ1, 0.12);
  }
  const shirts = [0x3a6fd0, 0xc6452a, 0x3f8a4a, 0xe0b040, 0x7a4ab0, 0xe8e2d0, 0x2b2b3a, 0xd0708a];
  interface Juror {
    g: THREE.Group;
    head: THREE.Object3D;
    arm: THREE.Object3D;
    phase: number;
  }
  const jurors: Juror[] = [];
  for (let k = 0; k < 12; k++) {
    const back = k >= 6;
    const g = createAsset('dummy') as THREE.Group;
    g.scale.setScalar(0.85);
    const shirt = new THREE.MeshStandardMaterial({ color: shirts[k % shirts.length], roughness: 0.8 });
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.material = o.name === 'head' ? new THREE.MeshStandardMaterial({ color: [0xd9b08c, 0xa0704c, 0xf0c8a0][k % 3], roughness: 0.8 }) : shirt;
    });
    for (const n of ['legL', 'legR']) (g.getObjectByName(n) as THREE.Object3D).rotation.x = -Math.PI / 2; // seated
    const x = back ? -4.85 : -4.05;
    const z = JZ0 + 0.45 + (k % 6) * 0.72;
    const seatY = (back ? 0.3 : 0) + 0.42;
    box(0.45, seatY, 0.45, darkWood, x - 0.05, seatY / 2, z);
    g.position.set(x, seatY - 0.7 * 0.85, z);
    g.rotation.y = Math.PI / 2; // facing the room
    root.add(g);
    jurors.push({ g, head: g.getObjectByName('head') as THREE.Object3D, arm: g.getObjectByName('armL') as THREE.Object3D, phase: Math.random() * 6 });
  }

  // ── The prosecution (right) and your desk (with OBJECTION on it) ──
  box(1.8, 0.78, 0.8, wood, PROS.x, 0.39, PROS.z);
  solid(PROS.x - 0.45, PROS.z, 0.45);
  solid(PROS.x + 0.45, PROS.z, 0.45);
  const pros = createAsset('dummy') as THREE.Group;
  const suit = new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.7 });
  pros.traverse((o) => {
    if (o instanceof THREE.Mesh) o.material = o.name === 'head' ? new THREE.MeshStandardMaterial({ color: 0xd9b08c, roughness: 0.8 }) : suit;
  });
  pros.position.set(PROS.x + 1.1, 0, PROS.z);
  pros.rotation.y = -Math.PI / 2;
  root.add(pros);
  solid(PROS.x + 1.1, PROS.z, 0.3);

  box(1.6, 0.78, 0.7, wood, DESK.x, 0.39, DESK.z);
  solid(DESK.x - 0.45, DESK.z, 0.45);
  solid(DESK.x + 0.45, DESK.z, 0.45);
  const objBase = box(0.36, 0.06, 0.36, new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.5 }), DESK.x, 0.81, DESK.z);
  const objDome = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.07, 20), new THREE.MeshStandardMaterial({ color: 0xd81e1e, roughness: 0.35, emissive: 0x400000 }));
  objDome.position.set(DESK.x, 0.875, DESK.z);
  root.add(objDome);
  const objSign = label('OBJECTION!', 0.5, 0.12, '#ffffff', '#b01818', FONT_SIGN);
  objSign.position.set(DESK.x, 1.0, DESK.z - 0.2);
  objSign.rotation.x = -0.25;

  // ── The lectern (two plea buttons) and the evidence tray ──
  box(0.72, 1.02, 0.46, wood, LECTERN.x, 0.51, LECTERN.z);
  box(0.82, 0.05, 0.56, darkWood, LECTERN.x, 1.045, LECTERN.z);
  solid(LECTERN.x, LECTERN.z, 0.42);
  const pleaBtn = (x: number, color: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.06, 20), new THREE.MeshStandardMaterial({ color, roughness: 0.35 }));
    m.position.set(LECTERN.x + x, 1.1, LECTERN.z + 0.06);
    root.add(m);
    return m;
  };
  const guiltyBtn = pleaBtn(-0.19, 0xc81f1f);
  const notGuiltyBtn = pleaBtn(0.19, 0x2e9a44);
  const pleaSign = label('GUILTY          NOT GUILTY', 0.76, 0.12, '#f2e8cc', '#2a1a0e');
  pleaSign.position.set(LECTERN.x, 1.19, LECTERN.z - 0.2);

  const trayTable = box(0.6, 0.84, 0.5, wood, TRAY.x, 0.42, TRAY.z);
  const tray = box(0.5, 0.04, 0.4, brass, TRAY.x, 0.86, TRAY.z);
  solid(TRAY.x, TRAY.z, 0.36);
  const traySign = label('EVIDENCE', 0.5, 0.11, '#f2e8cc', '#2a1a0e');
  traySign.position.set(TRAY.x, 0.98, TRAY.z - 0.24);

  // ── Exhibit A: the button, on a plinth, in a bag ──
  const plinth = box(0.5, 0.9, 0.5, new THREE.MeshStandardMaterial({ color: 0xd2d2cc, roughness: 0.85 }), EXHIBIT.x, 0.45, EXHIBIT.z);
  solid(EXHIBIT.x, EXHIBIT.z, 0.4);
  const exhibitBtn = makeMiniButton();
  exhibitBtn.scale.setScalar(2.2);
  exhibitBtn.position.set(EXHIBIT.x, 0.9, EXHIBIT.z);
  root.add(exhibitBtn);
  const exhibitDome = exhibitBtn.getObjectByName('dome') as THREE.Object3D;
  const bagMat = new THREE.MeshStandardMaterial({ color: 0xdfe8ff, roughness: 0.08, transparent: true, opacity: 0.28, depthWrite: false });
  const bag = new THREE.Group();
  bag.position.set(EXHIBIT.x, 0.9, EXHIBIT.z);
  const bagBody = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), bagMat);
  bagBody.position.y = 0.25;
  bag.add(bagBody);
  const tagCanvas = label('EXHIBIT A', 0.36, 0.13, '#1a1a1a', '#f4e27a', FONT_SIGN);
  root.remove(tagCanvas);
  tagCanvas.position.set(0, 0.2, 0.312);
  bag.add(tagCanvas);
  root.add(bag);

  // ── The cell (front-right corner) ──
  for (let z = BARS_Z; z <= D / 2 - WALL_IN; z += 0.25) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, H - 0.4, 8), iron);
    b.position.set(BARS_X, (H - 0.4) / 2, z);
    root.add(b);
    solid(BARS_X, z, 0.05);
  }
  for (let x = BARS_X; x <= W / 2 - WALL_IN; x += 0.25) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, H - 0.4, 8), iron);
    b.position.set(x, (H - 0.4) / 2, BARS_Z);
    root.add(b);
    solid(x, BARS_Z, 0.05);
  }
  box(W / 2 - BARS_X, 0.06, 0.06, iron, (BARS_X + W / 2) / 2, H - 0.4, BARS_Z);
  box(0.06, 0.06, D / 2 - BARS_Z, iron, BARS_X, H - 0.4, (BARS_Z + D / 2) / 2);

  // ── State ──
  let phase: Phase = 'trial';
  let sympathy = 0;
  const presented = new Set<string>();
  let objections = 0;
  let stumbleN = 0;
  let tampers = 0;
  let exhibitLive = false;
  let bagLift = -1; // ≥ 0: the bag is coming off
  let deliberateT = -1;
  let movedT = 0;
  let clock = 0;
  let objCool = 0;
  let jurySays = 0; // cooldown for "the jury is out"
  const pos = (v: THREE.Vector3) => new THREE.Vector3(v.x, 0, v.z);

  // Knock: the gavel (well — the judge's fist on his button).
  const knock = () => {
    ensureAudio();
    tone({ type: 'square', from: 190, to: 80, dur: 0.09, gain: 0.12 });
    noise(0.07, 0.14, 900, 'lowpass');
  };
  // The judge's arm swings down onto his button `n` times, then `then`.
  const slam = (n: number, then?: () => void) => {
    let t = 0;
    const per = 0.5;
    let hit = -1;
    addUpdater((dt) => {
      t += dt;
      const i = Math.floor(t / per);
      const k = (t % per) / per;
      if (i >= n) {
        judgeArm.rotation.x = THREE.MathUtils.lerp(judgeArm.rotation.x, 0, Math.min(1, dt * 8));
        gavelDome.position.y = 0.05;
        if (Math.abs(judgeArm.rotation.x) < 0.02) {
          judgeArm.rotation.x = 0;
          then?.();
          return true;
        }
        return false;
      }
      judgeArm.rotation.x = k < 0.6 ? THREE.MathUtils.lerp(-0.6, -1.7, k / 0.6) : THREE.MathUtils.lerp(-1.7, -0.6, (k - 0.6) / 0.4);
      const down = k > 0.9;
      gavelDome.position.y = down ? 0.02 : 0.05;
      if (down && hit !== i) {
        hit = i;
        knock();
      }
      return false;
    });
  };
  // Run `fn` once the narrator has finished (at least `minS` in), so a verdict
  // isn't cut off by the room changing under it.
  const whenQuiet = (minS: number, fn: () => void) => {
    let t = 0;
    addUpdater((dt) => {
      t += dt;
      if ((t < minS || isSpeaking()) && t < 14) return false;
      fn();
      return true;
    });
  };

  const acquit = (line: string, reward?: string) => {
    if (phase === 'acquitted' || phase === 'done') return;
    phase = 'acquitted';
    if (reward) discover(reward);
    discover('mech:court-verdict');
    ctx.narrate(line, 7000, { priority: true });
    whenQuiet(1.2, () => {
      ctx.narrate(ADJOURNED, 3500);
      // He slams his own button; Exhibit A comes out of its bag, and the exit is
      // the defendant pressing it (exhibit()).
      slam(3, () => {
        sparkle();
        bagLift = 0;
      });
    });
  };
  const sentence = (line: string) => {
    if (phase === 'sentenced' || phase === 'acquitted' || phase === 'done') return;
    phase = 'sentenced';
    discover('mech:court-verdict');
    ctx.narrate(line, 7000, { priority: true });
    slam(1);
    whenQuiet(1.5, () => {
      bagLift = 0;
      ctx.narrate(BAG_OFF, 4000);
    });
  };

  const contempt = (line: string) => {
    if (phase === 'jailed' || phase === 'acquitted' || phase === 'done' || phase === 'deliberating') return;
    const resume = phase;
    phase = 'jailed';
    discover('mech:contempt');
    ctx.narrate(line, 5000, { priority: true });
    slam(2);
    boo();
    ctx.after(1400, () => {
      ctx.setRegions([CELL]);
      ctx.camera.position.set((CELL.minX + CELL.maxX) / 2, CONFIG.PLAYER_HEIGHT, (CELL.minZ + CELL.maxZ) / 2);
      ctx.narrate(CELL_IN, 4000);
      ctx.after(JAIL_MS, () => {
        ctx.setRegions([MAIN]);
        ctx.camera.position.set(BARS_X - 0.7, CONFIG.PLAYER_HEIGHT, BARS_Z - 0.7);
        ctx.narrate(RELEASED, 3500, { priority: true });
        phase = resume;
      });
    });
  };

  const plead = (guilty: boolean) => {
    if (phase !== 'trial') {
      if (phase === 'deliberating' && jurySays <= 0) {
        jurySays = 5;
        ctx.narrate(JURY_OUT, 3500, { priority: true });
      }
      return;
    }
    click();
    discover('mech:court-plea');
    if (guilty) return sentence(PLEA_GUILTY);
    phase = 'deliberating';
    deliberateT = 0;
    ctx.narrate(PLEA_NOT, 6000, { priority: true });
  };

  const present = () => {
    if (phase === 'deliberating') {
      if (jurySays <= 0) {
        jurySays = 5;
        ctx.narrate(JURY_OUT, 3500, { priority: true });
      }
      return;
    }
    if (phase !== 'trial') {
      if (phase === 'sentenced') ctx.narrate(LATE, 3000, { priority: true });
      return;
    }
    const kind = ctx.heldKind('right') ?? ctx.heldKind('left');
    if (!kind) {
      ctx.narrate(EMPTY_TRAY, 3000, { priority: true });
      return;
    }
    click();
    discover('mech:court-evidence');
    if (presented.has(kind)) {
      ctx.narrate(SEEN, 3500, { priority: true });
      return;
    }
    presented.add(kind);
    const r = rulingFor(kind);
    if (r.consume) ctx.consumeHeld(kind);
    switch (r.effect) {
      case 'dismiss':
      case 'mercy':
      case 'bribe':
      case 'mistrial':
        acquit(r.line, r.reward);
        return;
      case 'contempt':
        contempt(r.line);
        return;
      case 'guilt':
        sentence(r.line);
        return;
      case 'moved':
        sympathy++;
        movedT = 4;
        break;
      case 'applause':
        sympathy++;
        applause(0.16, 2.2);
        break;
      case 'sympathy':
        sympathy++;
        break;
      default:
        break;
    }
    ctx.narrate(r.line, 6000, { priority: true });
  };

  const objection = () => {
    if (phase !== 'trial' && phase !== 'sentenced') return;
    if (objCool > 0) return;
    objCool = 0.8;
    discover('mech:objection');
    objDome.position.y = 0.855;
    ctx.after(160, () => (objDome.position.y = 0.875));
    ensureAudio();
    tone({ type: 'sawtooth', from: 520, to: 260, dur: 0.25, gain: 0.1 });
    noise(0.2, 0.1, 2200, 'bandpass');
    flashObjection();
    const mid = isSpeaking();
    objections++;
    if (objections >= 3) {
      objections = 0;
      contempt(OBJ_CONTEMPT);
    } else if (objections === 2) ctx.narrate(OBJ_WARN, 5000, { priority: true });
    else ctx.narrate(mid ? OBJ_STUMBLE[stumbleN++ % OBJ_STUMBLE.length] : OBJ_QUIET, 4000, { priority: true });
  };

  const exhibit = () => {
    if (phase === 'done') return;
    if (exhibitLive) {
      const served = phase === 'sentenced';
      phase = 'done';
      exhibitDome.position.y = 0.02;
      click();
      sparkle();
      if (served) discover('reward:served-sentence');
      ctx.after(700, () => ctx.advance(pos(EXHIBIT)));
      return;
    }
    if (phase === 'jailed' || phase === 'deliberating' || phase === 'acquitted') return;
    tampers++;
    if (tampers >= 2) {
      tampers = 0;
      contempt(TAMPER_AGAIN);
    } else ctx.narrate(TAMPER, 4000, { priority: true });
  };

  // "OBJECTION!" slammed across the screen.
  const flashObjection = () => {
    if (typeof document === 'undefined' || !document.body) return;
    const el = document.createElement('div');
    el.textContent = 'OBJECTION!';
    Object.assign(el.style, {
      position: 'fixed',
      left: '50%',
      top: '36%',
      transform: 'translate(-50%, -50%) rotate(-7deg) scale(1.8)',
      transition: 'transform 0.12s ease-out, opacity 0.3s ease',
      fontFamily: FONT_SIGN,
      fontWeight: '900',
      fontStyle: 'italic',
      fontSize: 'clamp(44px, 11vw, 140px)',
      letterSpacing: '0.02em',
      color: '#e8321e',
      webkitTextStroke: '3px #ffffff',
      textShadow: '0 6px 0 #6a0d0d, 0 10px 30px rgba(0,0,0,0.45)',
      pointerEvents: 'none',
      zIndex: '30',
      whiteSpace: 'nowrap',
    });
    document.body.appendChild(el);
    const gone = () => el.remove();
    ctx.after(30, () => (el.style.transform = 'translate(-50%, -50%) rotate(-7deg) scale(1)'));
    ctx.after(850, () => (el.style.opacity = '0'));
    ctx.after(1200, gone);
    setTimeout(gone, 2000); // DOM-only backstop: a room change clears ctx.after timers
  };

  const press = (p: Pick) => {
    if (p === 'guilty') plead(true);
    else if (p === 'not-guilty') plead(false);
    else if (p === 'tray') present();
    else if (p === 'objection') objection();
    else exhibit();
  };

  // ── Aim + press ──
  const targets: { obj: THREE.Object3D; pick: Pick }[] = [
    { obj: guiltyBtn, pick: 'guilty' },
    { obj: notGuiltyBtn, pick: 'not-guilty' },
    { obj: tray, pick: 'tray' },
    { obj: trayTable, pick: 'tray' },
    { obj: traySign, pick: 'tray' },
    { obj: objDome, pick: 'objection' },
    { obj: objBase, pick: 'objection' },
    { obj: objSign, pick: 'objection' },
    { obj: bag, pick: 'exhibit' },
    { obj: exhibitBtn, pick: 'exhibit' },
    { obj: plinth, pick: 'exhibit' },
  ];
  const objs = targets.map((t) => t.obj);
  const ray = new THREE.Raycaster();
  ray.far = REACH;
  const CENTER = new THREE.Vector2(0, 0);
  let hover: Pick | null = null;
  const it: Interactable = {
    id: 'courtroom-aim',
    position: new THREE.Vector3(),
    radius: REACH + 0.5,
    promptLabel: '',
    onUse: () => {
      if (hover) press(hover);
    },
  };
  registerInteractable(it);

  addUpdater((dt) => {
    clock += dt;
    objCool -= dt;
    jurySays -= dt;
    // What's under the crosshair (nothing, from the cell).
    hover = null;
    if (phase !== 'jailed' && phase !== 'done') {
      ray.setFromCamera(CENTER, ctx.camera);
      const h = ray.intersectObjects(objs, true)[0];
      if (h) {
        let o: THREE.Object3D | null = h.object;
        while (o && !objs.includes(o)) o = o.parent;
        if (o) hover = targets[objs.indexOf(o)].pick;
        it.position.copy(h.point);
      }
    }
    it.promptLabel = hover ? 'PRESS' : '';

    // The bag comes off Exhibit A: up, and gone.
    if (bagLift >= 0 && !exhibitLive) {
      bagLift += dt;
      const k = Math.min(1, bagLift / 1.1);
      bag.position.y = 0.9 + k * 1.4;
      bagMat.opacity = 0.28 * (1 - k);
      if (k >= 1) {
        root.remove(bag);
        exhibitLive = true;
        sparkle();
      }
    }

    // The jury: out deliberating (heads together, murmuring), moved to tears,
    // or just sitting there, being a jury.
    if (phase === 'deliberating') {
      deliberateT += dt;
      if (Math.floor(deliberateT / 0.45) !== Math.floor((deliberateT - dt) / 0.45)) noise(0.35, 0.025, 700, 'lowpass');
      if (deliberateT > 5 && !isSpeaking()) {
        if (sympathy > 0) acquit(JURY_FREE);
        else sentence(JURY_GUILTY);
      }
    }
    movedT -= dt;
    for (let k = 0; k < jurors.length; k++) {
      const j = jurors[k];
      j.phase += dt;
      const talk = phase === 'deliberating' ? Math.sin(j.phase * 3 + k) * 0.5 : 0;
      j.head.rotation.y = THREE.MathUtils.lerp(j.head.rotation.y, talk, Math.min(1, dt * 5));
      const weeping = movedT > 0 && (k === 2 || k === 8);
      j.arm.rotation.x = THREE.MathUtils.lerp(j.arm.rotation.x, weeping ? -2.5 + Math.sin(clock * 6) * 0.15 : 0, Math.min(1, dt * 5));
    }
    return false;
  });

  // ── Open court ──
  slam(1);
  ctx.narrate(ALL_RISE, 6000, { priority: true });
  ctx.narrate(CHARGES, 6000);
  ctx.narrate(INVITE, 7000);

  courtroomTest.press = press;
  courtroomTest.state = () => ({ phase, sympathy, exhibitLive, objections, tampers });
}

/** Headless-test hooks. */
export const courtroomTest: {
  press: (p: Pick) => void;
  state: () => { phase: Phase; sympathy: number; exhibitLive: boolean; objections: number; tampers: number };
} = { press: () => {}, state: () => ({ phase: 'trial', sympathy: 0, exhibitLive: false, objections: 0, tampers: 0 }) };
