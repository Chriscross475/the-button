import * as THREE from 'three';
import type { GameContext } from '../game/types';
import { CONFIG } from '../config';
import { addUpdater } from '../experiences/scheduler';
import { spawnPedestalButton, sinkPedestalButton, type SpawnedButton } from '../button/pedestal-button';
import { buildExitRoom } from './exit-room';
import { hideRoomShell } from './scaffold';
import { tone, noise, ensureAudio, pop, sparkle } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { discover } from '../graph/progress';
import { uvInk } from '../objects/uv-torch';
import { spawnPremiumCard } from '../objects/premium-card';
import { setScriptHints } from '../objects/script';
import { FONT_SIGN, FONT_VOICE } from '../ui/fonts';

// THE TERMS & CONDITIONS — the white room gives way to a long, carpeted
// corridor. Down its left wall runs the agreement: sixteen framed pages, some
// seventy clauses of small print. The I AGREE button waits at the far end. The
// narrator skims the pages aloud as you pass them — and skips forty to fifty,
// on purpose, because clause 47 says:
//
//   "the first person to read this far may leave through the side door."
//
// Stand in front of that page and actually look at it for a moment, and the
// door opposite opens onto an exit room: the secret way out (and a reward).
// Press I AGREE instead and you're subscribed to Button Premium: cancelling
// takes three more buttons, each rising out of the floor, and then the end
// wall slides away onto an ordinary exit room. Either way you get out.

const HALF_W = 2.5; // corridor half-width (x)
const BACK_Z = 4.5; // wall behind where you start
const END_Z = -72.5; // the far wall (with I AGREE)
const H = 3.2;
const PAGES = 16;
const PER_PAGE = 5; // clauses per page → 80 clauses
const PAGE_Z = (i: number) => -4 - i * 4.2; // page centres, walking −Z
const PAGE_47 = Math.floor((47 - 1) / PER_PAGE); // page 9
const DOOR_Z = PAGE_Z(PAGE_47); // the side door, right wall, opposite page 47
const DOOR_W = 1.6;
const READ_TIME = 1.8; // seconds looking at page 47 to "read" it

const INTRO = vo('Terms and conditions. You have to agree to them before you go any further. Everyone agrees. Nobody reads them. The button is at the far end.');
const SKIMS: [number, string][] = vo([
  [0, 'Clause one: by walking in here, you have already agreed. Lovely. Onwards.'],
  [2, 'Clause twelve: you agree that ducks are not your responsibility. Fine.'],
  [4, 'Clause twenty-one. Something about resemblance to a real button. Moving on.'],
  [7, 'Clauses forty to fifty are boilerplate. I am skipping those. You should too. Keep walking.'],
  [11, 'Clause fifty-eight: it renews automatically, forever. They always do.'],
  [14, 'Seventy-something clauses, and a button. Go on. Everyone does.'],
]);
const READ_47 = vo('Clause forty-seven. You read it. Nobody reads it. I skipped it on purpose. Fine. The side door is open. Do not tell anyone.');
const AGREE = vo('Agreed. Thank you for subscribing to Button Premium. Your free trial of existence has begun.');
const CANCEL_1 = vo('To cancel, press the button marked cancel. It is right there. They always put it right there.');
const CANCEL_2 = vo('Are you sure you want to cancel? There is a button for being sure.');
const CANCEL_3 = vo('We are sorry to see you go. Press to confirm that you are sorry to see us go.');
const CANCELLED = vo('Cancelled. Nothing has changed. The way out is open. Do come again. You will.');
const CARD = vo('And a card pops out anyway. Button Premium. Your membership is cancelled, and here is your membership card. It works, apparently. Places that take it are very pleased to see it.');
const SCRIPT_HINTS = vo([
  'My notes say: page ten. Clause forty-seven. I skip it every time. On purpose.',
  'Stand at page ten and actually read it. Look at it, properly, for a moment. The side door does the rest.',
  'Or press I agree, and cancel three times. That also gets you out. It is just sadder.',
]);

// The small print. A handful of legible jokes among the boilerplate; 47 is
// written in the same voice as the rest, so it has to be read to be found.
const JOKES: Record<number, string> = {
  1: 'By entering this corridor you agree to these terms, including the ones you have not read, which is all of them.',
  3: 'The Button is provided as is, where is, and why is.',
  7: 'You may not press the Button more than once, except when you do.',
  12: 'You agree that ducks are not your responsibility.',
  16: 'The Narrator is not liable for the Narrator.',
  21: 'Any resemblance to a real button is intentional.',
  25: 'Trains may appear closer than they are.',
  29: 'Grandma reserves all rights, including the right to be a wolf.',
  33: 'The circus is not a party to this agreement. The circus is a party.',
  38: 'In the event of a tie, the Button wins.',
  42: 'You waive the right to waive rights.',
  47: 'Notwithstanding anything above, the first person to read this far may leave through the side door.',
  53: 'Nothing in clause 47 is binding. Clause 53 is also not binding.',
  58: 'This agreement renews automatically, forever, in perpetuity, and also later.',
  64: 'By reading this far you have agreed to read further.',
  71: 'You agree that you did not read clause 71.',
  80: 'Thank you for your attention. Nobody gets here.',
};
// The rest of the small print: one plain clause each, all different, in the
// same dry voice as clause 47, so it doesn't stand out.
const FILLER = [
  'The User acknowledges that the Button is the property of the Button.',
  'These terms are governed by the laws of the White Room, which are few.',
  'The User shall not photograph, sketch, or describe the Pedestal in verse.',
  'Headings in this agreement are for convenience only and are not convenient.',
  'The User consents to being observed by the Narrator at all reasonable and unreasonable times.',
  'No failure to enforce any clause shall be taken as a waiver of the right to be smug about it later.',
  'The User may not resell, sublet or lend the Button to a third party, including a duck.',
  'All sounds made by the Button are copyrighted, including the click.',
  'The User holds Management harmless for any loss of time, dignity or ducks.',
  'Where this agreement conflicts with common sense, this agreement prevails.',
  'The User shall keep their hands, feet and opinions inside the corridor at all times.',
  'Management may amend these terms at any time, retroactively, and without telling anyone.',
  'The User accepts that walls may fall over. This is not a fault.',
  'Doors are provided for decorative purposes unless otherwise stated.',
  'The User agrees to remain the protagonist until further notice.',
  'Any trains encountered are the responsibility of the train.',
  'The User waives any claim arising from applause, boos, or the absence of either.',
  'Refunds are available in the form of a second, identical button.',
  'The User may not operate heavy machinery, including the cannon, while reading this.',
  'This agreement constitutes the entire agreement, except for the parts it does not.',
  'The User acknowledges that the floor is load-bearing, mostly.',
  'Pressing the Button does not create a partnership, joint venture, or friendship.',
  'Ducks dispensed under this agreement are non-transferable and non-refundable.',
  'The User shall not attempt to leave through the ceiling. It has been tried.',
  'Notices under this agreement shall be delivered by narrator.',
  'The User agrees that silence is a form of acceptance, and so is walking.',
  'Clauses are numbered for reference and are not a countdown.',
  'The User shall not feed the wolf after midnight, or at all.',
  'Management accepts no liability for decisions made in the forest.',
  'The User is responsible for the safekeeping of any keys, whatever their colour.',
  'The Pedestal is not a seat. Please do not sit on the Pedestal.',
  'The User acknowledges receipt of one (1) corridor, as described.',
  'In the event that any clause is found unenforceable, the others will be very disappointed.',
  'The User may request a copy of these terms. It will be this corridor.',
  'Loitering in front of the small print is permitted but discouraged.',
  'The User shall not rely on any statement made by the Narrator, including this one.',
  'The White Room is cleaned daily. Please report any chalk outlines.',
  'The User agrees that the loading bar was at ninety-nine percent when they found it.',
  'All prizes are awarded at the sole discretion of the prize.',
  'Management reserves the right to replace the corridor with a longer corridor.',
  'The User shall not tip the clerk, the guard, or the narrator, except when it works.',
  'Time spent in any queue is non-refundable.',
  'The User acknowledges that the circus is inside a tent and the tent is inside the game.',
  'No part of this agreement may be read aloud without the Narrator\'s permission.',
  'The User agrees not to count the clauses.',
  'Any dispute shall be settled by pressing the Button, which will not settle it.',
  'The User accepts the lift as it is, including floor forty-one.',
  'Complaints may be made in writing, and will be kept in writing.',
  'The User shall not describe the Button as merely a button.',
  'Management is not responsible for items left in the lost and found.',
  'The User understands that the tutorial is optional and also mandatory.',
  'Section breaks have no legal meaning and are there to rest your eyes.',
  'The User agrees that this corridor was always this long.',
  'No warranty is given as to the redness of the Button.',
  'The User may not bring outside buttons into the building.',
  'Obligations under this agreement survive termination, and also you.',
  'The User confirms they are not a robot, pending review.',
  'Management may assign this agreement to a successor button.',
  'The User agrees that the gift shop is on the way out.',
  'Any further clauses are hereby incorporated by reference to themselves.',
  'The User acknowledges that they are still reading.',
  'This page intentionally continues on the next page.',
  'The User agrees that they have read and understood everything so far, and everything after.',
];
// Clause n: its joke, or the next unused filler line (numbered in order, so
// every filler clause appears exactly once).
const FILLER_AT = new Map<number, string>();
for (let n = 1, i = 0; n <= 80; n++) if (!JOKES[n]) FILLER_AT.set(n, FILLER[i++ % FILLER.length]);
// …bar one deliberate repeat, just before clause 47: 43, 44 and 45 say the
// same thing, and 46 owns up to it.
FILLER_AT.set(44, FILLER_AT.get(43)!);
FILLER_AT.set(45, FILLER_AT.get(43)!);
FILLER_AT.set(46, 'Clauses 43, 44 and 45 are identical. This is for emphasis.');
const clause = (n: number): string => JOKES[n] ?? FILLER_AT.get(n) ?? '';

export function revealTerms(ctx: GameContext): void {
  const root = ctx.levelRoot;
  ctx.openRoom();
  hideRoomShell(ctx);

  // Pale, papery, a little hazy — set outright (the white room's 9–34 m fog
  // would stay otherwise, and the far end should emerge as you walk).
  const paper = new THREE.Color(0xf2efe6);
  ctx.scene.background = paper.clone();
  ctx.scene.fog = new THREE.Fog(paper.getHex(), 16, 60);

  // Into the corridor, wherever you stood when the room went.
  const cam = ctx.camera.position;
  cam.x = THREE.MathUtils.clamp(cam.x, -HALF_W + 0.6, HALF_W - 0.6);
  cam.z = THREE.MathUtils.clamp(cam.z, -2, BACK_Z - 0.6);
  const corridor = { minX: -HALF_W + 0.2, maxX: HALF_W - 0.2, minZ: END_Z + 0.2, maxZ: BACK_Z - 0.2, floorY: 0 };
  ctx.setRegions([corridor]);

  buildCorridor(root);
  for (let i = 0; i < PAGES; i++) buildPage(root, i);
  buildClause47Ink(root);
  setScriptHints(SCRIPT_HINTS); // the Script, if you have it, reads these

  // The two exits, built now (out of sight behind shut walls) so nothing heavy
  // is added mid-level: the SIDE room (clause 47) and the END room (after the
  // subscription).
  const sideRoom = buildExitRoom(ctx, { center: new THREE.Vector3(HALF_W + 0.2 + 4, 0, DOOR_Z), facing: 'negX' });
  const endRoom = buildExitRoom(ctx, { center: new THREE.Vector3(0, 0, END_Z - 0.3 - 4.5), facing: 'posZ' });
  // Doorways reach well into both sides (≥ 2 × the player radius of overlap).
  const sideDoorway = { minX: HALF_W - 1.5, maxX: HALF_W + 1.3, minZ: DOOR_Z - 0.8, maxZ: DOOR_Z + 0.8, floorY: 0 };
  const endDoorway = { minX: -0.8, maxX: 0.8, minZ: END_Z - 1.5, maxZ: END_Z + 1.1, floorY: 0 };
  let sideOpen = false;
  let endOpen = false;
  const regions = () => [corridor, ...(sideOpen ? [sideDoorway, sideRoom] : []), ...(endOpen ? [endDoorway, endRoom] : [])];

  const sideDoor = buildSideDoor(root);
  const endWall = buildEndWall(root);

  // ── Reading as you go: the narrator skims pages as you pass them ──
  const skimmed = new Set<number>();
  let saidIntro = false;
  const look = new THREE.Vector3();
  let reading = 0;
  let read47 = false;
  addUpdater((dt) => {
    const p = ctx.playerPos();
    if (!saidIntro) {
      saidIntro = true;
      ctx.narrate(INTRO, 6500);
    }
    for (const [page, line] of SKIMS) {
      if (skimmed.has(page) || p.z > PAGE_Z(page) + 0.5) continue;
      skimmed.add(page);
      pageTurn();
      ctx.narrate(line, 5000, { interruptible: true });
    }
    // Clause 47: in front of its page, facing the wall, for a moment.
    if (!read47) {
      ctx.camera.getWorldDirection(look);
      const facingWall = look.x < -0.75 && Math.abs(look.y) < 0.6;
      const atPage = Math.abs(p.z - DOOR_Z) < 1.9;
      reading = facingWall && atPage ? reading + dt : Math.max(0, reading - dt * 2);
      if (reading >= READ_TIME) {
        read47 = true;
        sideOpen = true;
        ctx.setRegions(regions());
        sideDoor.open();
        sparkle();
        discover('reward:read-the-terms');
        ctx.narrate(READ_47, 7000, { priority: true });
      }
    }
    return false;
  });

  // ── I AGREE, and the subscription ──
  const signs: THREE.Object3D[] = [];
  const chain: { btn: SpawnedButton; sign: THREE.Object3D }[] = [];
  const hidden = (pos: THREE.Vector3, label: string, onPress: () => void) => {
    // Built now (matte, no light), parked under the floor, inert.
    const btn = spawnPedestalButton(root, pos, onPress, { glow: false });
    btn.group.position.y = -1.8;
    btn.interactable.promptLabel = '';
    const sign = makeSign(label);
    sign.position.set(pos.x, 1.95, pos.z);
    sign.visible = false;
    root.add(sign);
    signs.push(sign);
    chain.push({ btn, sign });
    return btn;
  };
  const rise = (i: number) => {
    const { btn, sign } = chain[i];
    btn.interactable.promptLabel = 'PRESS';
    ctx.addObstacle(btn.obstacle);
    // Rising under you pushes you aside: overlapping an obstacle blocks every move.
    const c = ctx.camera.position;
    const need = btn.obstacle.radius + CONFIG.PLAYER_RADIUS + 0.02;
    const d = Math.hypot(c.x - btn.obstacle.x, c.z - btn.obstacle.z);
    if (d < need) c.z = btn.obstacle.z + (c.z >= btn.obstacle.z ? need : -need); // along the corridor: never into a wall
    sign.visible = true;
    pop();
    let t = 0;
    addUpdater((dt) => {
      t = Math.min(1, t + dt / 0.8);
      btn.group.position.y = -1.8 * (1 - (1 - Math.pow(1 - t, 3)));
      return t >= 1;
    });
  };
  const retire = (i: number) => {
    const { btn, sign } = chain[i];
    sinkPedestalButton(btn);
    ctx.removeObstacle(btn.obstacle);
    sign.visible = false;
  };

  let agreed = false;
  const agreePos = new THREE.Vector3(0, 0, END_Z + 2.4);
  const agreeBtn = spawnPedestalButton(root, agreePos, () => {
    if (agreed) return;
    agreed = true;
    sinkPedestalButton(agreeBtn);
    ctx.removeObstacle(agreeBtn.obstacle);
    agreeSign.visible = false;
    chaChing();
    discover('mech:i-agree');
    ctx.narrate(AGREE, 6000, { priority: true });
    ctx.narrate(CANCEL_1, 5500);
    ctx.after(1500, () => rise(0));
  });
  ctx.addObstacle(agreeBtn.obstacle);
  const agreeSign = makeSign('I AGREE');
  agreeSign.position.set(agreePos.x, 1.95, agreePos.z);
  root.add(agreeSign);

  hidden(new THREE.Vector3(-1.3, 0, END_Z + 5.5), 'CANCEL', () => {
    retire(0);
    ctx.narrate(CANCEL_2, 5000, { priority: true });
    ctx.after(900, () => rise(1));
  });
  hidden(new THREE.Vector3(1.3, 0, END_Z + 7.5), 'YES, I AM SURE', () => {
    retire(1);
    ctx.narrate(CANCEL_3, 5500, { priority: true });
    ctx.after(900, () => rise(2));
  });
  hidden(new THREE.Vector3(0, 0, END_Z + 9.5), 'CONFIRM', () => {
    retire(2);
    buzz();
    ctx.narrate(CANCELLED, 6000, { priority: true });
    ctx.narrate(CARD, 7000);
    // Out of a slot by the (sunk) CONFIRM button: your membership card.
    spawnPremiumCard(ctx, new THREE.Vector3(0.7, 0.03, END_Z + 9.5), { onGrab: () => sparkle() });
    endOpen = true;
    ctx.setRegions(regions());
    endWall.open();
  });
}

// ── Sounds ──

function pageTurn(): void {
  ensureAudio();
  noise(0.18, 0.12, 3200, 'bandpass');
}
function chaChing(): void {
  ensureAudio();
  noise(0.08, 0.2, 5000, 'highpass');
  tone({ type: 'triangle', from: 1568, dur: 0.35, gain: 0.12 });
  ctxLater(() => tone({ type: 'triangle', from: 2093, dur: 0.5, gain: 0.12 }), 120);
}
function buzz(): void {
  ensureAudio();
  tone({ type: 'square', from: 330, to: 320, dur: 0.25, gain: 0.08 });
  ctxLater(() => tone({ type: 'square', from: 440, to: 430, dur: 0.4, gain: 0.08 }), 260);
}
// A short sound delay: a one-off updater (dies with the level, unlike a timer).
function ctxLater(fn: () => void, ms: number): void {
  let t = 0;
  addUpdater((dt) => {
    t += dt * 1000;
    if (t < ms) return false;
    fn();
    return true;
  });
}

// ── Set pieces ──

function buildCorridor(root: THREE.Object3D): void {
  const len = BACK_Z - END_Z;
  const cz = (BACK_Z + END_Z) / 2;
  const carpet = new THREE.MeshStandardMaterial({ color: 0x6a5a48, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, len), carpet);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.02, cz);
  floor.receiveShadow = true;
  root.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.9 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, len), new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 1, side: THREE.DoubleSide }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, cz);
  root.add(ceil);
  // Left wall: whole. Right wall: whole except the side-door gap.
  const left = new THREE.Mesh(new THREE.PlaneGeometry(len, H), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-HALF_W, H / 2, cz);
  root.add(left);
  const rightPiece = (z0: number, z1: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(z1 - z0, H), wallMat);
    m.rotation.y = -Math.PI / 2;
    m.position.set(HALF_W, H / 2, (z0 + z1) / 2);
    root.add(m);
  };
  rightPiece(END_Z, DOOR_Z - DOOR_W / 2);
  rightPiece(DOOR_Z + DOOR_W / 2, BACK_Z);
  const lintel = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, H - 2.4), wallMat);
  lintel.rotation.y = -Math.PI / 2;
  lintel.position.set(HALF_W, 2.4 + (H - 2.4) / 2, DOOR_Z);
  root.add(lintel);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, H), wallMat);
  back.rotation.y = Math.PI;
  back.position.set(0, H / 2, BACK_Z);
  root.add(back);
  // Skirting on both sides, and strip lights down the ceiling (self-lit).
  const skirt = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.8 });
  for (const s of [-1, 1]) {
    const sk = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.14, len), skirt);
    sk.position.set(s * (HALF_W - 0.03), 0.07, cz);
    root.add(sk);
  }
  const strip = new THREE.MeshBasicMaterial({ color: 0xfff8e6 });
  for (let z = BACK_Z - 3; z > END_Z + 1; z -= 6) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.4), strip);
    l.rotation.x = Math.PI / 2;
    l.position.set(0, H - 0.02, z);
    root.add(l);
  }
  root.add(new THREE.HemisphereLight(0xfffaf0, 0x8a7a66, 1.0));
}

// One page of the agreement, framed on the left wall: a header and five
// clauses, wrapped, and shrunk until they fit.
function buildPage(root: THREE.Object3D, i: number): void {
  const PW = 3.6;
  const PH = 2.3;
  const z = PAGE_Z(i);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, PH + 0.14, PW + 0.14), new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.6 }));
  frame.position.set(-HALF_W + 0.06, 1.55, z);
  root.add(frame);
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = Math.round((1024 * PH) / PW);
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fbf8ef';
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#2a2622';
  g.textAlign = 'center';
  g.font = `bold 34px ${FONT_VOICE}`;
  g.fillText(`TERMS & CONDITIONS · PAGE ${i + 1} OF ${PAGES}`, cv.width / 2, 56);
  g.textAlign = 'left';
  const first = i * PER_PAGE + 1;
  const paras = Array.from({ length: PER_PAGE }, (_, k) => `${first + k}. ${clause(first + k)}`);
  wrapFit(g, paras, 48, 90, cv.width - 96, cv.height - 110, 30);
  const page = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
  page.rotation.y = Math.PI / 2; // faces +X, into the corridor
  page.position.set(-HALF_W + 0.14, 1.55, z);
  root.add(page);
}

// UV ink over page 10 (clause 47 is its second clause): a violet ring round
// the upper-middle of the text, a big "47", and an arrow at the side door —
// only visible by the UV torch's beam. A plane just in front of the page.
function buildClause47Ink(root: THREE.Object3D): void {
  const PW = 3.6;
  const PH = 2.3;
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = Math.round((1024 * PH) / PW);
  const g = cv.getContext('2d')!;
  g.strokeStyle = '#c070ff';
  g.fillStyle = '#c070ff';
  g.lineWidth = 10;
  // a hand-drawn loop round the second paragraph (roughly the second fifth of the text)
  g.beginPath();
  g.ellipse(cv.width / 2, cv.height * 0.34, cv.width * 0.46, cv.height * 0.12, -0.03, 0, Math.PI * 2);
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = 150;
  do g.font = `bold ${px}px ${FONT_SIGN}`;
  while (g.measureText('47 → SIDE DOOR').width > cv.width - 120 && --px > 20);
  g.fillText('47 → SIDE DOOR', cv.width / 2, cv.height * 0.72);
  const ink = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
  ink.rotation.y = Math.PI / 2; // faces +X, like the page
  ink.position.set(-HALF_W + 0.16, 1.55, PAGE_Z(PAGE_47)); // 2 cm in front of it
  root.add(ink);
  uvInk(ink);
}

// Wrap paragraphs into (x, y, w, h), starting at `size` px and shrinking until
// everything fits.
function wrapFit(g: CanvasRenderingContext2D, paras: string[], x: number, y: number, w: number, h: number, size: number): void {
  for (let px = size; px >= 10; px--) {
    g.font = `${px}px ${FONT_VOICE}`;
    const lineH = px * 1.3;
    const lines: string[][] = [];
    for (const para of paras) {
      const out: string[] = [];
      let cur = '';
      for (const word of para.split(' ')) {
        const next = cur ? `${cur} ${word}` : word;
        if (g.measureText(next).width > w && cur) {
          out.push(cur);
          cur = word;
        } else cur = next;
      }
      if (cur) out.push(cur);
      lines.push(out);
    }
    const total = lines.reduce((n, l) => n + l.length, 0) * lineH + (paras.length - 1) * lineH * 0.5;
    if (total > h && px > 10) continue;
    let cy = y + px;
    for (const para of lines) {
      for (const l of para) {
        g.fillText(l, x, cy);
        cy += lineH;
      }
      cy += lineH * 0.5;
    }
    return;
  }
}

// A plain sign on a slim post-less board, facing +Z (toward you as you come).
function makeSign(text: string): THREE.Mesh {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#1b1a18';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#e8d9b0';
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#f6f0dc';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = 64;
  do g.font = `bold ${px}px ${FONT_VOICE}`;
  while (g.measureText(text).width > 440 && --px > 12);
  g.fillText(text, 256, 68);
  return new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), side: THREE.DoubleSide }));
}

// The side door in the right wall, opposite page 47. Swings out into the room.
function buildSideDoor(root: THREE.Object3D): { open: () => void } {
  const hinge = new THREE.Group();
  hinge.position.set(HALF_W + 0.02, 0, DOOR_Z + DOOR_W / 2);
  root.add(hinge);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.4, DOOR_W), new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.8 }));
  leaf.position.set(0, 1.2, -DOOR_W / 2);
  hinge.add(leaf);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0xc9a83a, metalness: 0.7, roughness: 0.3 }));
  knob.position.set(-0.06, 1.05, -DOOR_W + 0.15);
  hinge.add(knob);
  return {
    open: () => {
      let t = 0;
      addUpdater((dt) => {
        t = Math.min(1, t + dt / 1.0);
        hinge.rotation.y = -1.5 * (1 - Math.pow(1 - t, 3)); // swings out, away from you
        return t >= 1;
      });
    },
  };
}

// The far wall, which slides down into the floor once you've cancelled.
function buildEndWall(root: THREE.Object3D): { open: () => void } {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(HALF_W * 2, H, 0.12),
    new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.9 }),
  );
  wall.position.set(0, H / 2, END_Z);
  root.add(wall);
  return {
    open: () => {
      let t = 0;
      addUpdater((dt) => {
        t = Math.min(1, t + dt / 1.4);
        wall.position.y = H / 2 - H * t;
        if (t >= 1) wall.visible = false;
        return t >= 1;
      });
    },
  };
}
