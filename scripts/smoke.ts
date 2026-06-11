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
const { attachNamespaces } = await import('../src/game/ctx-namespaces.ts');

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
const NS_NAMES = new Set(['world', 'narration', 'nav', 'room', 'region', 'physics', 'carry', 'companions', 'modes']);
const ctx: any = new Proxy(ctxBase, {
  get(t, k) {
    if (k in t) return Reflect.get(t, k);
    // Namespaced access (ctx.nav.advanceTo) forwards to the SAME flat member, so
    // content authored either way builds under smoke (mirrors attachNamespaces).
    if (typeof k === 'string' && NS_NAMES.has(k)) return new Proxy({}, { get: (_n, mk) => ctx[mk] });
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

// 4) ctx namespaces delegate to the SAME flat members (ctx.nav.advanceTo ===
//    ctx.advanceTo) and live props (levelRoot/bounds/entry) forward through
//    getters. Tests the real attachNamespaces wiring without a browser.
{
  const back: any = { levelRoot: new THREE.Group(), entry: null, bounds: { minX: 0 } };
  const stub = () => undefined;
  const flat: any = {
    scene, camera, playerPos: () => camera.position,
    get levelRoot() { return back.levelRoot; },
    get bounds() { return back.bounds; },
    get entry() { return back.entry; },
    narrate: stub, after: stub, goToLevel: stub, returnToHub: stub, advance: stub,
    advanceTo: stub, spawnAt: stub, openRoom: stub, setRoomButton: stub, sinkRoomButton: stub,
    spawnButton: stub, setBounds: stub, setRegions: stub, addObstacle: stub, removeObstacle: stub,
    setLanding: stub, setFlightWalls: stub, launchPlayer: stub, die: stub, isAirborne: stub,
    isDead: stub, addCarryable: stub, removeCarryable: stub, addTarget: stub, removeTarget: stub,
    isHolding: stub, consumeHeld: stub, heldKind: stub, putInHand: stub, launchProjectile: stub,
    useTrainShield: stub, setCompanion: stub, setScoringHoop: stub, setWheel: stub, setControlMode: stub,
  };
  const ns = attachNamespaces(flat);
  const checks: [string, boolean][] = [
    ['world.scene', ns.world.scene === flat.scene],
    ['world.playerPos', ns.world.playerPos === flat.playerPos],
    ['narration.narrate', ns.narration.narrate === flat.narrate],
    ['nav.advanceTo', ns.nav.advanceTo === flat.advanceTo],
    ['room.openRoom', ns.room.openRoom === flat.openRoom],
    ['region.setRegions', ns.region.setRegions === flat.setRegions],
    ['physics.die', ns.physics.die === flat.die],
    ['carry.addCarryable', ns.carry.addCarryable === flat.addCarryable],
    ['carry.launchProjectile', ns.carry.launchProjectile === flat.launchProjectile],
    ['carry.useTrainShield', ns.carry.useTrainShield === flat.useTrainShield],
    ['companions.setScoringHoop', ns.companions.setScoringHoop === flat.setScoringHoop],
    ['modes.setWheel', ns.modes.setWheel === flat.setWheel],
  ];
  // live-prop getters reflect the Game repointing levelRoot/entry/bounds
  const newRoot = new THREE.Group();
  back.levelRoot = newRoot;
  checks.push(['world.levelRoot (live)', ns.world.levelRoot === newRoot]);
  back.entry = 'crack';
  checks.push(['nav.entry (live)', ns.nav.entry === 'crack']);
  const newBounds = { minX: 7 };
  back.bounds = newBounds;
  checks.push(['region.bounds (live)', ns.region.bounds === newBounds]);
  for (const [name, pass] of checks) {
    if (pass) ok.push(`ns:${name}`);
    else failures.push(`namespace delegation '${name}': mismatch`);
  }
}

// ── Report ──
console.log(`smoke: ${ok.length} built, ${failures.length} failed`);
for (const f of failures) console.error(`  ✗ ${f}`);
if (failures.length) process.exit(1);
console.log('  all green ✓');
