import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { currentGeneration } from '../experiences/scheduler';
import { pop } from '../audio/sfx';
import { vo } from '../audio/vo-shared';
import { FONT_VOICE } from '../ui/fonts';

// THE SCRIPT — the narrator's own script, hidden in his booth. Hold it and
// press (a quick click) to read it: he reads out his notes for the room you're
// in — its hints, in order — sulking that you have it. Rooms opt in by calling
// setScriptHints([...]) when they're built (vo() lines); a room without notes
// gets a grumble instead. The notes belong to the room that set them: a new
// room (a new updater generation) starts without any.

let notes: { gen: number; lines: string[]; i: number } | null = null;

/** This room's notes in the script, read in order by whoever holds it. */
export function setScriptHints(lines: string[]): void {
  notes = { gen: currentGeneration(), lines, i: 0 };
}

const NO_NOTES = vo([
  'The script. This room is not in it. I am improvising. You can tell.',
  'Blank page. Either they cut this room, or I never wrote it down. Both, probably.',
]);
const FIRST_READ = vo('That is my script. Give that back. No? Fine. Page one.');

export function spawnScript(ctx: GameContext, pos: THREE.Vector3, opts: { onGrab?: () => void } = {}): Carryable {
  const g = new THREE.Group();
  const pages = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.04, 0.29), new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.9 }));
  g.add(pages);
  const cv = document.createElement('canvas');
  cv.width = 210;
  cv.height = 290;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#7a1414';
  c.fillRect(0, 0, 210, 290);
  c.fillStyle = '#f2e6c8';
  c.textAlign = 'center';
  c.font = `bold 30px ${FONT_VOICE}`;
  c.fillText('THE BUTTON', 105, 110);
  c.font = `italic 22px ${FONT_VOICE}`;
  c.fillText('narration', 105, 150);
  c.font = `16px ${FONT_VOICE}`;
  c.fillText('(DO NOT READ)', 105, 250);
  const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.21, 0.29), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.8 }));
  cover.rotation.x = -Math.PI / 2;
  cover.position.y = 0.021;
  g.add(cover);
  g.position.copy(pos);
  ctx.levelRoot.add(g);
  let readOnce = false;
  let grumble = 0;
  const carry: Carryable = {
    kind: 'script',
    object: g,
    persistent: true,
    heldDist: 0.5,
    heldDrop: 0.28,
    heldUpdate: (_dt, o, q) => o.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.2)), // open toward you
    onGrab: () => {
      pop();
      opts.onGrab?.();
    },
    // A click: read the page for this room.
    onTap: () => {
      const first = !readOnce;
      if (first) {
        readOnce = true;
        ctx.narrate(FIRST_READ, 4000, { priority: true });
      }
      if (notes && notes.gen === currentGeneration() && notes.lines.length) {
        // (the first time, queued behind his protest)
        ctx.narrate(notes.lines[notes.i % notes.lines.length], 7000, first ? undefined : { priority: true });
        notes.i++;
      } else {
        ctx.narrate(NO_NOTES[grumble++ % NO_NOTES.length], 5000, first ? undefined : { priority: true });
      }
    },
  };
  ctx.addCarryable(carry);
  return carry;
}
