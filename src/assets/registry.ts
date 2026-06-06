import type * as THREE from 'three';

// ASSET DATABASE — a registry of procedural object factories, keyed by id.
//
// Every code-built prop (duck, axe, tree, campfire, chicken leg…) and every
// COMPOSITION of props (axe-in-trunk…) is registered here once, then any scene
// pulls a fresh instance with createAsset('id'). One source of truth for the
// game's geometry; no more re-deriving makeDuck() in three files.
//
// Factories build a FRESH Object3D each call (own geometries/materials), so
// callers can freely position/mutate without clobbering a shared instance.
// Compositions tag their sub-parts with `.name` so callers can pull pieces out
// (e.g. detach the axe from the trunk to carry it): group.getObjectByName('axe').

export type AssetFactory = () => THREE.Object3D;

const assets = new Map<string, AssetFactory>();

export function defineAsset(id: string, build: AssetFactory): void {
  assets.set(id, build);
}

export function createAsset(id: string): THREE.Object3D {
  const build = assets.get(id);
  if (!build) throw new Error(`unknown asset: "${id}" (registered: ${[...assets.keys()].join(', ')})`);
  return build();
}

export function hasAsset(id: string): boolean {
  return assets.has(id);
}

export function assetIds(): string[] {
  return [...assets.keys()];
}
