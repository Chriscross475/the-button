import * as THREE from 'three';

// Frees the GPU resources of an unloaded level tree. Removing a root from the
// scene does NOT release its geometries/materials/textures — without this,
// every button press (the core loop rebuilds the world) leaks VRAM until the
// tab dies, fastest on mobile. Asset factories return fresh geometry/materials
// per instance, so a blanket traverse is safe; anything that must survive the
// transition (held items, the companion) is re-parented to the scene BEFORE
// this runs.

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
    const light = o as THREE.Light;
    if (light.isLight) light.dispose(); // frees the shadow map
  });
}

function disposeMaterial(m: THREE.Material): void {
  for (const value of Object.values(m)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  m.dispose();
}
