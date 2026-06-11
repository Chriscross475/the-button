// Smoke harness — `npm run smoke`. Builds EVERY experience (level reveals + gags),
// the hub level, and every registered asset with a recording mock GameContext,
// and fails if any throws. Catches the #1 regression class for AI-authored
// content: a level/asset that compiles but blows up when built. No browser — it
// mocks the few DOM/Web-Audio globals the build path touches (SFX stays silent
// until ensureAudio(), which we never call, so sounds are no-ops).

// ── Browser-global mocks (must be in place before the game modules import) ──
const fakeCtx2d: any = new Proxy(
  {},
  {
    get(_t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern')
        return () => ({ addColorStop() {} });
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === 'measureText') return () => ({ width: 0 });
      return () => {};
    },
    set: () => true,
  },
);
function fakeCanvas(): any {
  return { width: 1, height: 1, style: {}, getContext: () => fakeCtx2d, toDataURL: () => '' };
}
function fakeEl(tag?: string): any {
  if (tag === 'canvas') return fakeCanvas();
  const el: any = { style: {}, dataset: {}, children: [], tagName: (tag || 'div').toUpperCase(), textContent: '', className: '' };
  el.appendChild = (c: any) => (el.children.push(c), c);
  el.removeChild = () => {};
  el.remove = () => {};
  el.append = () => {};
  el.setAttribute = () => {};
  el.addEventListener = () => {};
  el.removeEventListener = () => {};
  el.getContext = () => fakeCtx2d;
  el.querySelector = () => null;
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 720 });
  return el;
}
const byId = new Map<string, any>();
const g: any = globalThis;
g.document = {
  createElement: (tag: string) => fakeEl(tag),
  createElementNS: () => fakeEl('div'),
  getElementById: (id: string) => {
    if (!byId.has(id)) byId.set(id, fakeEl('div'));
    return byId.get(id);
  },
  querySelector: () => null,
  body: fakeEl('body'),
  head: fakeEl('head'),
  addEventListener: () => {},
  removeEventListener: () => {},
};
g.window = {
  innerWidth: 1280,
  innerHeight: 720,
  devicePixelRatio: 1,
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  addEventListener: () => {},
  removeEventListener: () => {},
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  setTimeout: () => 0 as any,
  clearTimeout: () => {},
};
g.navigator = { maxTouchPoints: 0, userAgent: 'node' };
g.requestAnimationFrame = () => 0;
g.cancelAnimationFrame = () => {};

// Web Audio: a no-op context so SFX (some play at build time, e.g. the campfire)
// don't blow up. Every node/param is a chainable no-op.
const fakeParam: any = new Proxy(
  { value: 0 },
  { get: (t, k) => (k === 'value' ? (t as any).value : () => fakeParam), set: () => true },
);
const fakeNode: any = new Proxy(
  {},
  { get: (_t, k) => (k === 'gain' || k === 'frequency' || k === 'detune' || k === 'Q' || k === 'playbackRate' ? fakeParam : () => fakeNode) },
);
class FakeAudioContext {
  state = 'running';
  sampleRate = 44100;
  currentTime = 0;
  destination = fakeNode;
  createGain() { return fakeNode; }
  createOscillator() { return fakeNode; }
  createBufferSource() { return fakeNode; }
  createBiquadFilter() { return fakeNode; }
  createBuffer() { return { getChannelData: () => new Float32Array(1) }; }
  resume() { return Promise.resolve(); }
  decodeAudioData() { return Promise.resolve({}); }
}
g.window.AudioContext = FakeAudioContext;
g.AudioContext = FakeAudioContext;

// ── Import the game (dynamic, so the mocks above are already in place) ──
const THREE: any = await import('three');
const { registerAllExperiences } = await import('../src/experiences/index.ts');
const { allExperiences } = await import('../src/experiences/registry.ts');
const { clearUpdaters } = await import('../src/experiences/scheduler.ts');
const { hubLevel } = await import('../src/levels/hub.ts');
const { assetIds, createAsset } = await import('../src/assets/index.ts');

// ── A recording mock GameContext: real scene/camera/levelRoot, no-op the rest ──
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 500);
let levelRoot = new THREE.Group();
const bounds = { minX: -25, maxX: 25, minZ: -25, maxZ: 25, floorY: 0 };
const ctxBase: any = {
  get scene() { return scene; },
  get camera() { return camera; },
  get levelRoot() { return levelRoot; },
  get bounds() { return bounds; },
  playerPos: () => camera.position,
  entry: null,
  isHolding: () => false,
  isDead: () => false,
  isAirborne: () => false,
  heldKind: () => null,
  inHand: () => null,
};
const ctx: any = new Proxy(ctxBase, {
  get(t, k) {
    if (k in t) return Reflect.get(t, k);
    return () => undefined; // any other ctx method = recording no-op
  },
});

const failures: string[] = [];
const ok: string[] = [];

// 1) every asset builds
for (const id of assetIds()) {
  try {
    const o = createAsset(id);
    if (!o) failures.push(`asset '${id}': returned null`);
    else ok.push(`asset:${id}`);
  } catch (e: any) {
    failures.push(`asset '${id}': threw — ${e?.message || e}`);
  }
}

// 2) the hub level builds
try {
  levelRoot = new THREE.Group();
  clearUpdaters();
  hubLevel.build(ctx);
  ok.push('level:hub');
} catch (e: any) {
  failures.push(`level 'hub': threw — ${e?.message || e}`);
}

// 3) every experience (level reveals + gags) builds
registerAllExperiences();
for (const exp of allExperiences()) {
  levelRoot = new THREE.Group();
  clearUpdaters(); // fresh generation so the defineReveal guard never blocks
  try {
    exp.run(ctx);
    ok.push(`exp:${exp.id} (${levelRoot.children.length})`);
  } catch (e: any) {
    failures.push(`experience '${exp.id}': threw — ${e?.message || e}`);
  }
}

// ── Report ──
console.log(`smoke: ${ok.length} built, ${failures.length} failed`);
for (const f of failures) console.error(`  ✗ ${f}`);
if (failures.length) process.exit(1);
console.log('  all green ✓');
