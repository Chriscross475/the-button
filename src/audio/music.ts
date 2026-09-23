import type * as THREE from 'three';
import { audioOut } from './sfx';

// Looping level music from a file in public/. Plays through its own gain into
// the master output and stops by itself once the level is left: levels have no
// teardown hook, but a level's root leaves the scene on any level change (or a
// death), so a light poll on `root.parent` stops it. `onMissing` runs instead
// if the file can't be fetched or decoded (e.g. to play a synthesised stand-in).

export interface LevelMusic {
  /** Fade the music out (true) or back in (false). */
  duck(down: boolean): void;
}

export function playLevelMusic(root: THREE.Object3D, file: string, volume: number, onMissing?: () => void): LevelMusic | null {
  const out = audioOut();
  if (!out) return null;
  const gain = out.ctx.createGain();
  gain.gain.value = volume;
  gain.connect(out.master);
  let src: AudioBufferSourceNode | null = null;
  const watch = setInterval(() => {
    if (root.parent) return;
    clearInterval(watch);
    try { src?.stop(); } catch { /* never started */ }
    gain.disconnect();
  }, 400);
  fetch(`${import.meta.env.BASE_URL}${file}`)
    .then((r) => {
      if (!r.ok) throw new Error(`music ${file}: ${r.status}`);
      return r.arrayBuffer();
    })
    .then((b) => out.ctx.decodeAudioData(b))
    .then((buf) => {
      if (!root.parent) return; // left before it finished loading
      src = out.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start();
    })
    .catch(() => onMissing?.());
  return {
    duck: (down) => gain.gain.setTargetAtTime(down ? 0 : volume, out.ctx.currentTime, 0.15),
  };
}
