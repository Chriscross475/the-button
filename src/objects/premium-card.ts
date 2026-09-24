import * as THREE from 'three';
import type { GameContext } from '../game/types';
import type { Carryable } from '../game/combine';
import { pop } from '../audio/sfx';
import { FONT_DISPLAY, FONT_VOICE } from '../ui/fonts';

// THE PREMIUM CARD — Button Premium membership (from agreeing to the terms and
// then cancelling). Persistent. Places that honour it check
// ctx.isHolding('premium-card'): a free vend, a free souvenir, the premium lane.
export function spawnPremiumCard(ctx: GameContext, pos: THREE.Vector3, opts: { onGrab?: () => void } = {}): Carryable {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 160;
  const c = cv.getContext('2d')!;
  const grad = c.createLinearGradient(0, 0, 256, 160);
  grad.addColorStop(0, '#f5d76e');
  grad.addColorStop(1, '#b8862b');
  c.fillStyle = grad;
  c.fillRect(0, 0, 256, 160);
  c.fillStyle = '#3a2a0a';
  c.font = `bold 26px ${FONT_VOICE}`;
  c.fillText('BUTTON', 18, 44);
  c.font = `italic 22px ${FONT_VOICE}`;
  c.fillText('Premium', 18, 74);
  c.font = `14px ${FONT_DISPLAY}`;
  c.fillText('MEMBER SINCE: JUST NOW', 18, 138);
  c.fillStyle = '#c62828';
  c.beginPath();
  c.arc(212, 48, 22, 0, Math.PI * 2);
  c.fill();
  const card = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.106), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide }));
  card.position.copy(pos);
  card.rotation.x = -Math.PI / 2;
  ctx.levelRoot.add(card);
  const carry: Carryable = {
    kind: 'premium-card',
    object: card,
    persistent: true,
    heldDist: 0.45,
    heldDrop: 0.22,
    heldUpdate: (_dt, o, q) => o.quaternion.copy(q),
    onGrab: () => {
      pop();
      opts.onGrab?.();
    },
  };
  ctx.addCarryable(carry);
  return carry;
}
