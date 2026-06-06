import * as THREE from 'three';

// Shared colour palette + material helpers. Asset factories and levels should
// pull colours from here instead of re-declaring hex literals, so the game stays
// visually consistent and there's a named vocabulary to build with.

export const COLOR = {
  // woods
  wood: 0x6b4a2b,
  woodLight: 0x8a5a2b,
  bark: 0x5a3a1e,
  // stone / rock
  rock: 0x6b6b70,
  rockDark: 0x35373c,
  stone: 0x8a8f97,
  // metals
  steel: 0x6a6f78,
  iron: 0x4b4f57,
  ironDark: 0x33363c,
  rail: 0x7a7a84,
  // darks / ground
  dark: 0x1a1a1e,
  bore: 0x020305,
  ballast: 0x232529,
  tie: 0x39301f,
  gravel: 0x3a3d33,
  // light
  white: 0xeeeeec,
  // accents
  red: 0xcc1414,
  ember: 0xaa2200,
  gold: 0xffd23f,
} as const;

// ── Material helpers — each returns a FRESH instance (callers may mutate). ──

/** Flat-shaded matte material (the game's default low-poly look). */
export function flat(color: number, opts?: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, ...opts });
}

/** Smooth matte material. */
export function matte(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

/** Metallic material. */
export function metal(color: number, roughness = 0.4, metalness = 0.7): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/** Self-lit material (glows its own colour — visible regardless of lighting). */
export function glow(color: number, intensity = 0.6): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.5 });
}
