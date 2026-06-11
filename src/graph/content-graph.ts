// THE CONTENT GRAPH — the map of how everything in the game connects: levels,
// items, mechanics, combines, portals and reward path-ends. It is the single
// source of truth behind the /button/graph.html diagram, and a design aid: when
// you add an item / level / combine / reward, add its node + edges HERE so the
// map (and the player's progress tracker) stays complete. A smoke check flags
// any defineCombine in code that's missing an edge here.
//
// Node ids are namespaced (lvl: gag: item: mech: reward: fx:) so they never
// collide — note the 'basketball' LEVEL (lvl:basketball) vs the BALL item
// (item:basketball) share a runtime string but are distinct nodes.
//
// Fog of war: the page shows ALL nodes, but anonymises any the player hasn't
// discovered. `keys` lists the runtime strings that reveal a node:
//   exp[]    — experience id (revealed on entering that level/gag)
//   item[]   — carryable kind (revealed on grabbing it)
//   target[] — combine-target kind (revealed on combining with it)
// Rewards/effects with no key are revealed by an explicit discover() call.

export type NodeKind = 'level' | 'gag' | 'item' | 'mechanic' | 'reward' | 'fx';

export interface GNode {
  id: string;
  label: string;
  kind: NodeKind;
  /** Shown in the details panel once discovered. */
  note?: string;
  /** Runtime strings that reveal this node (see header). */
  keys?: { exp?: string[]; item?: string[]; target?: string[] };
}

export type EdgeKind =
  | 'portal' // walk between two levels (a crack, a tunnel mouth)
  | 'spawns' // a level introduces an item
  | 'combine' // hold tool + use on target → outcome (a defineCombine)
  | 'makes' // a combine/action produces an item/effect
  | 'reward' // a level pays out a reward at the end of a path
  | 'enables' // a tool/level unlocks a mechanic or route
  | 'controls' // operates another system (the slingshot aims the trains)
  | 'shields'; // held, it cushions an otherwise-lethal hit

export interface GEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Short edge caption (the combine outcome, the unlock condition). */
  label?: string;
  /** Portals are walkable both ways; drawn without a direction arrow. */
  bidirectional?: boolean;
}

export interface ContentGraph {
  nodes: GNode[];
  edges: GEdge[];
}

const nodes: GNode[] = [
  // ── Levels ──
  { id: 'lvl:hub', label: 'The White Room', kind: 'level', keys: { exp: ['hub'] },
    note: 'Where every run begins. One button; press it and the room becomes something else.' },
  { id: 'lvl:forest', label: 'The Forest', kind: 'level', keys: { exp: ['forest'] },
    note: 'Walls topple onto a wide wood. An axe waits in a stump; ducks roam. A crack in the east wall leads on.' },
  { id: 'lvl:tunnel', label: 'The Tunnels', kind: 'level', keys: { exp: ['tunnel'] },
    note: 'A storm-lit line of train tunnels. Time the trains; ride the right one onto the cabin. A lever stops them.' },
  { id: 'lvl:slingshot', label: 'The Trainyard', kind: 'level', keys: { exp: ['slingshot'] },
    note: 'A rotating slingshot that fires the very trains the tunnels face. Reached only on foot, up from the tunnels.' },
  { id: 'lvl:basketball', label: 'The Free-Throw Room', kind: 'level', keys: { exp: ['basketball'] },
    note: 'Thirty seconds of free throws inside a bouncing room. Score high enough and you keep more than the ball.' },
  { id: 'lvl:ducks', label: 'The Duck Room', kind: 'level', keys: { exp: ['ducks'] },
    note: 'A dark moral game. The button dispenses ducks; the pens decide their fates — and your reward.' },
  { id: 'lvl:doors', label: 'The Corridor of Doors', kind: 'level', keys: { exp: ['doors'] },
    note: 'A growing hallway of doors that reshuffle. The last one is locked; the key is behind where you started.' },
  { id: 'lvl:circus', label: 'The Big Top', kind: 'level', keys: { exp: ['circus'] },
    note: 'Trampolines spiral up the inside of a tent to a unicycle, then a thin twisting walkway out.' },

  // ── In-room gags ──
  { id: 'gag:another-button', label: 'Another Button', kind: 'gag', keys: { exp: ['another-button'] },
    note: 'A button that breeds more buttons. Get the sequence right and a corridor opens to a prize.' },
  { id: 'gag:statue', label: 'The Statue', kind: 'gag', keys: { exp: ['statue'] },
    note: "Something drops from above and lands. That's the gag." },
  { id: 'gag:confetti', label: 'Confetti', kind: 'gag', keys: { exp: ['confetti'] },
    note: 'A celebratory burst over nothing in particular.' },
  { id: 'gag:color-flash', label: 'Colour Flash', kind: 'gag', keys: { exp: ['color-flash'] },
    note: 'The room floods with colour, then thinks better of it.' },
  { id: 'gag:nothing', label: 'Nothing', kind: 'gag', keys: { exp: ['nothing'] },
    note: 'A blip. A remark. Nothing happens. Press again.' },

  // ── Items (carryables) ──
  { id: 'item:axe', label: 'The Axe', kind: 'item', keys: { item: ['axe'] },
    note: 'From a forest stump. Fells trees, smashes planks & fences, ends ducks. Kept across every level.' },
  { id: 'item:duck', label: 'A Duck', kind: 'item', keys: { item: ['duck'] },
    note: 'Wanders, throwable, bounces and splats. Cook it, chop it, or carry it on. Cushions a train (and bursts into feathers).' },
  { id: 'item:cooked-duck', label: 'Roast Duck', kind: 'item', keys: { item: ['cooked-duck'] },
    note: 'A duck cooked on a campfire. Carry it to the duck-room food stand to double the payout.' },
  { id: 'item:pickaxe', label: 'The Pickaxe', kind: 'item', keys: { item: ['pickaxe'] },
    note: "Deep in a tunnel. Smashes the cracked wall (to the forest) and the trainyard's stone block." },
  { id: 'item:key', label: 'The Key', kind: 'item', keys: { item: ['key'] },
    note: 'Hidden behind your start in the corridor. Spends itself opening the one locked door.' },
  { id: 'item:money', label: 'The Money', kind: 'item', keys: { item: ['money'] },
    note: "Your cut. Kept in hand across levels. Paid out by the duck room's mercy path." },
  { id: 'item:basketball', label: 'The Basketball', kind: 'item', keys: { item: ['basketball'] },
    note: 'Yours to keep. Flies and bounces the same in every level; cushions a train without being used up.' },

  // ── Mechanics / world objects ──
  { id: 'mech:campfire', label: 'Campfire', kind: 'mechanic', keys: { target: ['campfire'] },
    note: 'Left where a tree falls. Combine a duck with it to roast one.' },
  { id: 'mech:train', label: 'Trains', kind: 'mechanic',
    note: 'Fired from the trainyard down whichever tunnel it aims at. A hit is lethal — unless you carry a cushion.' },
  { id: 'mech:lever', label: 'The Lever', kind: 'mechanic',
    note: 'Hidden by the far tunnel. Pulling it halts every train.' },
  { id: 'mech:slingshot-turret', label: 'The Slingshot', kind: 'mechanic',
    note: 'Operate it to aim and power the trains — global state the tunnels obey.' },
  { id: 'mech:wood-block', label: 'Wood Block', kind: 'mechanic', keys: { target: ['wood-block'] },
    note: 'Seals a trainyard tunnel. An axe clears it.' },
  { id: 'mech:stone-block', label: 'Stone Block', kind: 'mechanic', keys: { target: ['stone-block'] },
    note: 'Seals a trainyard tunnel. Only a pickaxe clears it.' },
  { id: 'mech:tunnel-plank', label: 'Planked Tunnel', kind: 'mechanic', keys: { target: ['tunnel-plank'] },
    note: 'A boarded-up side tunnel. An axe opens it onward.' },
  { id: 'mech:scoring-hoop', label: 'Scoring Hoop', kind: 'mechanic',
    note: 'A rim that counts throws dropped through it — on the wall, then on the basket you carry.' },
  { id: 'mech:door-lock', label: 'The Locked Door', kind: 'mechanic', keys: { target: ['door-lock'] },
    note: "The corridor's final door. The key spends itself opening it." },
  { id: 'mech:spike-trap', label: 'Spike Traps', kind: 'mechanic',
    note: 'Pressure plates in the corridor. Step wrong and they end you.' },
  { id: 'mech:trampoline', label: 'Trampolines', kind: 'mechanic',
    note: 'Bounce pads that fling you up the big top — or into the void if you miss.' },
  { id: 'mech:farm-pen', label: 'The Farm Pen', kind: 'mechanic', keys: { target: ['farm-fence'] },
    note: 'Rescue ducks here. Five rescues opens the food stand. An axe frees the penned ducks.' },
  { id: 'mech:saw-pen', label: 'The Saw Pen', kind: 'mechanic', keys: { target: ['saw-fence'] },
    note: 'Doom ducks here. Five opens the wolf gate. No prize of its own.' },
  { id: 'mech:wolf-gate', label: 'The Wolf Gate', kind: 'mechanic', keys: { target: ['wolf-fence'] },
    note: 'Feed the wolf ducks. Tame it (3+) then axe the gate and it follows you; starve it and it kills you.' },
  { id: 'mech:food-stand', label: 'The Food Stand', kind: 'mechanic', keys: { target: ['stand', 'stand-fence'] },
    note: 'The mercy payout. A roast duck doubles it; an axe to its fence reveals a hidden till.' },

  // ── Reward path-ends ──
  { id: 'reward:walking-basket', label: 'The Walking Basket', kind: 'reward',
    note: 'Score 18+ at free throws and a two-legged basket waddles after you, ready to be fed shots anywhere.' },
  { id: 'reward:golden-ball', label: 'The Golden Ball', kind: 'reward',
    note: 'Score 8+ and the ball turns to gold in your hands — a keepsake.' },
  { id: 'reward:baby-wolf', label: 'The Baby Wolf', kind: 'reward',
    note: 'Spare and feed the duck-room wolf and a pup follows you out across the levels.' },
  { id: 'reward:unicycle', label: 'The Unicycle', kind: 'reward',
    note: 'Won atop the big top: a one-wheeled way to move — faster, and a menace to steer.' },
  { id: 'reward:golden-orb', label: 'The Golden Orb', kind: 'reward',
    note: "Behind the breeding-button puzzle's perfect run: a glowing orb on a plinth (a placeholder prize, for now)." },

  // ── Effects ──
  { id: 'fx:feathers', label: 'Feathers', kind: 'fx',
    note: 'What remains of a duck that met an axe, a hard landing, or a train.' },
];

const edges: GEdge[] = [
  // Portals (walkable both ways).
  { from: 'lvl:forest', to: 'lvl:tunnel', kind: 'portal', label: 'a crack in the wall', bidirectional: true },
  { from: 'lvl:tunnel', to: 'lvl:slingshot', kind: 'portal', label: 'up the tunnel', bidirectional: true },

  // Levels introduce items.
  { from: 'lvl:forest', to: 'item:axe', kind: 'spawns' },
  { from: 'lvl:forest', to: 'item:duck', kind: 'spawns' },
  { from: 'lvl:tunnel', to: 'item:pickaxe', kind: 'spawns' },
  { from: 'lvl:doors', to: 'item:key', kind: 'spawns' },
  { from: 'lvl:basketball', to: 'item:basketball', kind: 'spawns' },
  { from: 'lvl:ducks', to: 'item:duck', kind: 'spawns', label: 'dispensed' },

  // Levels introduce mechanics.
  { from: 'lvl:forest', to: 'mech:campfire', kind: 'enables' },
  { from: 'lvl:tunnel', to: 'mech:train', kind: 'enables' },
  { from: 'lvl:tunnel', to: 'mech:lever', kind: 'enables' },
  { from: 'lvl:tunnel', to: 'mech:tunnel-plank', kind: 'enables' },
  { from: 'lvl:slingshot', to: 'mech:slingshot-turret', kind: 'enables' },
  { from: 'lvl:slingshot', to: 'mech:wood-block', kind: 'enables' },
  { from: 'lvl:slingshot', to: 'mech:stone-block', kind: 'enables' },
  { from: 'lvl:basketball', to: 'mech:scoring-hoop', kind: 'enables' },
  { from: 'lvl:doors', to: 'mech:door-lock', kind: 'enables' },
  { from: 'lvl:doors', to: 'mech:spike-trap', kind: 'enables' },
  { from: 'lvl:circus', to: 'mech:trampoline', kind: 'enables' },
  { from: 'lvl:ducks', to: 'mech:farm-pen', kind: 'enables' },
  { from: 'lvl:ducks', to: 'mech:saw-pen', kind: 'enables' },
  { from: 'lvl:ducks', to: 'mech:wolf-gate', kind: 'enables' },
  { from: 'lvl:ducks', to: 'mech:food-stand', kind: 'enables' },

  // The slingshot drives the trains the tunnel level obeys.
  { from: 'mech:slingshot-turret', to: 'mech:train', kind: 'controls', label: 'aims & fires' },
  { from: 'mech:lever', to: 'mech:train', kind: 'controls', label: 'halts' },

  // Combines (hold tool → use on target). One per defineCombine.
  { from: 'item:axe', to: 'item:duck', kind: 'combine', label: 'chop' },
  { from: 'item:duck', to: 'mech:campfire', kind: 'combine', label: 'cook' },
  { from: 'item:cooked-duck', to: 'mech:food-stand', kind: 'combine', label: 'double $' },
  { from: 'item:axe', to: 'mech:wood-block', kind: 'combine', label: 'open' },
  { from: 'item:pickaxe', to: 'mech:stone-block', kind: 'combine', label: 'open' },
  { from: 'item:axe', to: 'mech:tunnel-plank', kind: 'combine', label: 'open' },
  { from: 'item:key', to: 'mech:door-lock', kind: 'combine', label: 'unlock' },
  { from: 'item:axe', to: 'mech:farm-pen', kind: 'combine', label: 'smash' },
  { from: 'item:axe', to: 'mech:saw-pen', kind: 'combine', label: 'smash' },
  { from: 'item:axe', to: 'mech:wolf-gate', kind: 'combine', label: 'smash' },
  { from: 'item:axe', to: 'mech:food-stand', kind: 'combine', label: 'smash' },

  // Actions/combines that PRODUCE something.
  { from: 'item:axe', to: 'mech:campfire', kind: 'makes', label: 'fell a tree' },
  { from: 'item:duck', to: 'item:cooked-duck', kind: 'makes', label: 'on a campfire' },
  { from: 'item:duck', to: 'fx:feathers', kind: 'makes', label: 'axe / fall / train' },
  { from: 'item:cooked-duck', to: 'item:money', kind: 'makes', label: 'doubles the stand' },
  { from: 'mech:food-stand', to: 'item:money', kind: 'makes', label: 'hidden till' },

  // Tools open routes.
  { from: 'item:pickaxe', to: 'lvl:forest', kind: 'enables', label: 'smash the crack' },

  // Reward path-ends.
  { from: 'lvl:basketball', to: 'reward:walking-basket', kind: 'reward', label: '18+ pts' },
  { from: 'lvl:basketball', to: 'reward:golden-ball', kind: 'reward', label: '8+ pts' },
  { from: 'lvl:ducks', to: 'reward:baby-wolf', kind: 'reward', label: 'feed the wolf' },
  { from: 'lvl:ducks', to: 'item:money', kind: 'reward', label: 'mercy path' },
  { from: 'lvl:circus', to: 'reward:unicycle', kind: 'reward', label: 'reach the top' },
  { from: 'gag:another-button', to: 'reward:golden-orb', kind: 'reward', label: '10 in a row' },
  { from: 'reward:walking-basket', to: 'mech:scoring-hoop', kind: 'enables', label: 'carry it' },

  // Held cushions against a train.
  { from: 'item:duck', to: 'mech:train', kind: 'shields', label: 'cushions (bursts)' },
  { from: 'item:basketball', to: 'mech:train', kind: 'shields', label: 'cushions (kept)' },
];

export const CONTENT_GRAPH: ContentGraph = { nodes, edges };

// ── Discovery index: runtime string → node ids (separate namespaces so the
//    'basketball' level vs ball never collide). Built once from the graph. ──
function buildIndex(pick: (n: GNode) => string[] | undefined): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const n of nodes) for (const k of pick(n) ?? []) m.set(k, [...(m.get(k) ?? []), n.id]);
  return m;
}
export const EXP_INDEX = buildIndex((n) => n.keys?.exp);
export const ITEM_INDEX = buildIndex((n) => n.keys?.item);
export const TARGET_INDEX = buildIndex((n) => n.keys?.target);

/** All combine-target kinds the graph knows (for the smoke drift check). */
export function graphCombineTargets(): Set<string> {
  return new Set([...TARGET_INDEX.keys()]);
}
