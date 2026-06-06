import * as THREE from 'three';
import { getInRangeInteractable } from '../interactables/system';

// Floating world-anchored "PRESS" prompt. Each frame, project the in-range
// interactable's anchor (position + labelOffsetY) to screen space and place the
// DOM label there. Hidden when nothing's in range or it's behind the camera.

let el: HTMLDivElement | null = null;
const tmp = new THREE.Vector3();

function element(): HTMLDivElement {
  if (!el) el = document.getElementById('interact-prompt') as HTMLDivElement;
  return el;
}

export function updateInteractPrompt(camera: THREE.Camera, canvas: HTMLCanvasElement): void {
  const node = element();
  const it = getInRangeInteractable();
  if (!it) {
    node.style.display = 'none';
    return;
  }
  tmp.copy(it.position);
  tmp.y += it.labelOffsetY ?? 0.6;
  tmp.project(camera);
  if (tmp.z > 1) {
    node.style.display = 'none';
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = (tmp.x * 0.5 + 0.5) * rect.width + rect.left;
  const y = (-tmp.y * 0.5 + 0.5) * rect.height + rect.top;
  node.textContent = it.promptLabel;
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  node.style.display = 'block';
}
