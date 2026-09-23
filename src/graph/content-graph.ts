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
  | 'portal' // a ONE-WAY hand-off from one level into a specific other (never back)
  | 'spawns' // a level introduces an item
  | 'combine' // hold tool + use on target → outcome (a defineCombine)
  | 'makes' // a combine/action produces an item/effect
  | 'reward' // a level pays out a reward at the end of a path
  | 'enables' // a tool/level unlocks a mechanic or route
  | 'controls' // operates another system (the crossing holds the train back)
  | 'shields'; // held, it cushions an otherwise-lethal hit

export interface GEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Short edge caption (the combine outcome, the unlock condition). */
  label?: string;
  /** Drawn without a direction arrow. (No current edge uses it: rooms don't link back.) */
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
    note: 'Walls topple onto a wide wood. An axe waits in a stump; ducks roam. The cabin door is planked shut.' },
  { id: 'lvl:basketball', label: 'The Court', kind: 'level', keys: { exp: ['basketball'] },
    note: 'A gym, one hoop, two opponents. Pick THE WALL or THE FLEA and outscore him in forty seconds. Win and you keep more than the ball.' },
  { id: 'lvl:ducks', label: 'The Duck Room', kind: 'level', keys: { exp: ['ducks'] },
    note: 'A dark moral game. The button dispenses ducks; the pens decide their fates — and your reward.' },
  { id: 'lvl:doors', label: 'The Corridor of Doors', kind: 'level', keys: { exp: ['doors'] },
    note: 'A growing hallway of doors that reshuffle. The last one is locked; the key is behind where you started.' },
  { id: 'lvl:circus', label: 'The Big Top', kind: 'level', keys: { exp: ['circus'] },
    note: 'A full house and you are the act: a cannon, a tightrope, a clown car. Fill the applause meter for the prize and the curtain, or leave by the back door.' },
  { id: 'lvl:booth', label: 'The Booth', kind: 'level', keys: { exp: ['booth'] },
    note: "The narrator's recording booth, and he has stepped out. His soundboard plays his lines; the dummy behind the glass obeys every one of them, literally." },
  { id: 'lvl:elevator', label: 'The Lift', kind: 'level', keys: { exp: ['elevator'] },
    note: 'The white room was a lift all along. Forty floors, each a little diorama behind the doors. The panel has no way out on it.' },
  { id: 'lvl:museum', label: 'The Museum', kind: 'level', keys: { exp: ['museum'] },
    note: 'A gallery of everything you have done. The centrepiece is THE button: do not touch. A guard is watching it.' },
  { id: 'lvl:waiting-room', label: 'The Waiting Room', kind: 'level', keys: { exp: ['waiting-room'] },
    note: 'Take a number: 948. Now serving: 001. Number two is asleep, and the whole building waits on him.' },
  { id: 'lvl:tutorial', label: 'The Tutorial', kind: 'level', keys: { exp: ['tutorial'] },
    note: 'A cheerful card teaches you to walk, to look left, to stand in a circle. Then: do NOT press the button. Obey, and it starts again.' },
  { id: 'lvl:loading-screen', label: 'The Loading Screen', kind: 'level', keys: { exp: ['loading-screen'] },
    note: 'Ninety-nine percent, in a grey void, with helpful tips. It will not finish by itself.' },
  { id: 'lvl:evil-twin', label: "The Button's Evil Twin", kind: 'level', keys: { exp: ['evil-twin'] },
    note: 'Two identical buttons, THIS ONE and NOT THIS ONE, and a narrator who tells you which to press. He is very helpful.' },
  { id: 'lvl:customer-support', label: 'Customer Support', kind: 'level', keys: { exp: ['customer-support'] },
    note: 'An office, a desk phone, and an automated menu that goes nowhere: ducks, existential dread, trains, billing.' },
  { id: 'lvl:terms', label: 'The Terms & Conditions', kind: 'level', keys: { exp: ['terms'] },
    note: 'A corridor of small print with I AGREE at the far end. The narrator skims it. He skips forty to fifty on purpose.' },
  { id: 'lvl:captcha', label: 'The Captcha', kind: 'level', keys: { exp: ['captcha'] },
    note: 'A giant "I am not a robot" box, then picture grids: ducks, trains, regret, buttons. Pass, and move on.' },
  { id: 'lvl:queue', label: 'The Queue', kind: 'level', keys: { exp: ['queue'] },
    note: 'A velvet-rope switchback full of people, each pressing THE button in turn. It moves. Technically.' },
  { id: 'lvl:gift-shop', label: 'The Gift Shop', kind: 'level', keys: { exp: ['gift-shop'] },
    note: 'Exit through the gift shop. Everything is merchandise of you. The turnstile only turns for customers.' },
  { id: 'lvl:lost-found', label: 'Lost & Found', kind: 'level', keys: { exp: ['lost-found'] },
    note: 'A counter, a clerk in a cardigan, and shelves of everything you ever lost, tagged. Fill in the form, correctly, and he hands it back.' },
  { id: 'lvl:desert', label: 'The Desert', kind: 'level', keys: { exp: ['desert'] },
    note: 'A desert road over a railway, the exit on the far side. A train waits on the horizon, and it is paying attention. Give it something else to run over.' },

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
  { id: 'item:key', label: 'The Blue Key', kind: 'item', keys: { item: ['key-blue'] },
    note: 'Hidden behind your start in the corridor. Opens only the blue lock, and spends itself doing it.' },
  { id: 'item:ticket', label: 'A Ticket', kind: 'item', keys: { item: ['ticket'] },
    note: "A number from the machine (948, and it only gets worse), or a sleeping man's 002 if you take it off his lap." },
  { id: 'item:souvenir', label: 'A Souvenir', kind: 'item', keys: { item: ['souvenir'] },
    note: 'Duck plush, "I Pressed It" mug, train snow globe, a quilt tea towel… Yours to keep, once you are out.' },
  { id: 'item:shop-coin', label: 'A Wishing Coin', kind: 'item', keys: { item: ['shop-coin'] },
    note: "Fished out of the gift shop's wishing fountain. Legal tender, if you do not think about it." },
  { id: 'item:left-shoe', label: 'A Left Shoe', kind: 'item', keys: { item: ['left-shoe'] },
    note: 'Black, single, lost in the circus. Always at the lost and found. Somewhere, someone is hopping.' },
  { id: 'item:dignity', label: 'Your Dignity (in a jar)', kind: 'item', keys: { item: ['dignity'] },
    note: 'Clear, slightly used, lost in the waiting room. Do not open it in public.' },
  { id: 'item:key-red', label: 'The Red Key', kind: 'item', keys: { item: ['key-red'] },
    note: 'Half-buried behind the exit cabin in the desert. It comes along with you until it finds its red lock.' },
  { id: 'item:money', label: 'The Money', kind: 'item', keys: { item: ['money'] },
    note: "Your cut. Kept in hand across levels. Paid out by the duck room's mercy path." },
  { id: 'item:dummy', label: 'The Crash-Test Dummy', kind: 'item', keys: { item: ['dummy'] },
    note: 'Slumped by a broken-down car in the desert. Heavy. Throw it on the rails and the train goes for it instead.' },
  { id: 'item:basketball', label: 'The Basketball', kind: 'item', keys: { item: ['basketball'] },
    note: 'Yours to keep. Flies and bounces the same in every level; cushions a train without being used up.' },

  // ── Mechanics / world objects ──
  { id: 'mech:campfire', label: 'Campfire', kind: 'mechanic', keys: { target: ['campfire'] },
    note: 'Left where a tree falls. Combine a duck with it to roast one.' },
  { id: 'mech:train', label: 'The Train', kind: 'mechanic',
    note: 'Creeps closer while you near the rails, backs off at the crossing, and runs you down the moment you step on them. A hit is lethal — unless you carry a cushion.' },
  { id: 'mech:crossing', label: 'The Level Crossing', kind: 'mechanic',
    note: 'Barriers down, lights flashing, bell ringing. For a train that never quite arrives. They lift only while the train is over the horizon.' },
  { id: 'mech:wait-button', label: 'The WAIT Button', kind: 'mechanic',
    note: 'PRESS TO CROSS. It lights WAIT. It has lit WAIT since 1987.' },
  { id: 'mech:scoring-hoop', label: 'Scoring Hoop', kind: 'mechanic',
    note: 'A rim that counts throws dropped through it — on the wall, then on the basket you carry.' },
  { id: 'mech:door-lock', label: 'The Locked Door', kind: 'mechanic', keys: { target: ['door-lock'] },
    note: "The corridor's final door, with a blue lock. The blue key spends itself opening it." },
  { id: 'mech:lift-panel', label: 'The Lift Panel', kind: 'mechanic',
    note: 'Forty floors, DOOR OPEN, DOOR CLOSE (never connected), ALARM and EMERGENCY STOP. Press them all, like a child.' },
  { id: 'mech:counter', label: 'The Counter', kind: 'mechanic', keys: { target: ['counter'] },
    note: 'Present a ticket at or below the number on the screen. Or money. Or a duck.' },
  { id: 'mech:loading-bar', label: 'The Loading Bar', kind: 'mechanic',
    note: 'Stuck at 99%. Something at its far end sticks out. Push it in yourself, and it loads. Then it keeps going.' },
  { id: 'mech:evil-twin', label: 'Trust Me', kind: 'mechanic',
    note: 'Whenever he says "trust me", he is lying. Three right in a row and a third, plain button rises.' },
  { id: 'mech:phone-menu', label: 'The Phone Menu', kind: 'mechanic',
    note: 'Press one for ducks (a duck is actually dispatched). Press two for existential dread (the lights go). It never mentions zero.' },
  { id: 'mech:i-agree', label: 'I Agree', kind: 'mechanic',
    note: 'Agree and you are subscribed to Button Premium. Cancelling takes three more buttons.' },
  { id: 'mech:captcha', label: 'I Am Not a Robot', kind: 'mechanic',
    note: 'Tick the box; it is never enough. Select all squares with ducks. Then trains. Then regret.' },
  { id: 'mech:queue-follow', label: 'Queue Leader', kind: 'mechanic',
    note: 'People queue behind anybody who stands still with confidence. Stand somewhere, and the queue starts leaving to queue behind you.' },
  { id: 'mech:shop-till', label: 'The Till', kind: 'mechanic', keys: { target: ['shop-till'] },
    note: 'Pay here: money, or a coin from the fountain. Paid, the turnstile turns for anything you carry.' },
  { id: 'mech:lost-found', label: 'Form LF-7', kind: 'mechanic',
    note: 'Item, colour, and where you lost it. Read the tags. Get it exactly right, or: we have no record of that.' },
  { id: 'mech:red-lock', label: "Grandma's Door", kind: 'mechanic', keys: { target: ['lock-red'] },
    note: 'A cottage in the forest, its door shut with a red lock. The red key is a long way from here.' },
  { id: 'mech:grandma', label: 'Grandma', kind: 'mechanic', keys: { target: ['bed-wolf'] },
    note: 'Tucked up in bed in a nightcap, delighted to see you. Bring the freed wolf, and it is a different story.' },
  { id: 'mech:spike-trap', label: 'Spike Traps', kind: 'mechanic',
    note: 'Pressure plates in the corridor. Step wrong and they end you.' },
  { id: 'mech:cannon', label: 'The Cannon', kind: 'mechanic', keys: { target: ['cannon'] },
    note: 'Climb in, aim by looking, fire. The net is the act; the canvas is a chalk outline; straight up is out through the roof, into a room the audience never sees.' },
  { id: 'mech:tightrope', label: 'The Tightrope', kind: 'mechanic',
    note: 'A swaying wire over the ring. Falling off only costs you dignity.' },
  { id: 'mech:clown-car', label: 'The Clown Car', kind: 'mechanic',
    note: 'Honk the horn. Sixteen clowns climb out of one small car.' },
  { id: 'mech:applause-meter', label: 'The Applause Meter', kind: 'mechanic', keys: { target: ['applause-meter'] },
    note: 'Each act fills a third. Full, it wins the prize and opens the curtain. Throwing things at it is cheating.' },
  { id: 'mech:crowd', label: 'The Crowd', kind: 'mechanic', keys: { target: ['bleachers'] },
    note: 'A cardboard full house. It claps, it boos, and it does not like axes.' },
  { id: 'mech:pond', label: 'The Pond', kind: 'mechanic',
    note: 'Out past the duck pens. Lob a duck over the fences and it paddles off, happy. No path, no verdict.' },
  { id: 'mech:farm-pen', label: 'The Farm Pen', kind: 'mechanic', keys: { target: ['farm-fence'] },
    note: 'Rescue ducks here. Five rescues opens the food stand. An axe frees the penned ducks.' },
  { id: 'mech:saw-pen', label: 'The Saw Pen', kind: 'mechanic', keys: { target: ['saw-fence'] },
    note: 'Doom ducks here. Five opens the wolf gate. No prize of its own.' },
  { id: 'mech:wolf-gate', label: 'The Wolf Gate', kind: 'mechanic', keys: { target: ['wolf-fence'] },
    note: 'Feed the wolf ducks. Tame it (3+) then axe the gate and it follows you; starve it and it kills you.' },
  { id: 'mech:food-stand', label: 'The Food Stand', kind: 'mechanic', keys: { target: ['stand', 'stand-fence'] },
    note: 'The mercy payout. A roast duck doubles it; an axe to its fence reveals a hidden till.' },
  { id: 'mech:grown-wolf', label: 'The Grown Wolf', kind: 'mechanic',
    note: 'What the baby wolf becomes after ten ducks: the size of its mother, out of ducks, and looking at you. It used you exactly like you used them.' },

  { id: 'mech:soundboard', label: 'The Soundboard', kind: 'mechanic',
    note: 'Twelve of his lines, out of context. The dummy takes each one literally. Four of them, in the right order, get it out.' },
  { id: 'mech:booth-mic', label: 'The Mic', kind: 'mechanic', keys: { target: ['booth-mic'] },
    note: 'His microphone. Something that is not him could use it. It will not be allowed a line.' },
  { id: 'mech:booth-chair', label: 'The Empty Chair', kind: 'mechanic', keys: { target: ['booth-chair'] },
    note: 'His chair, pushed back. Leave him something on it and he notices.' },
  { id: 'mech:booth-glass', label: 'The Glass', kind: 'mechanic', keys: { target: ['booth-glass'] },
    note: 'Between you and the dummy. It flinches at a knock.' },
  { id: 'mech:booth-cable', label: 'The Mic Cable', kind: 'mechanic', keys: { target: ['booth-cable'] },
    note: 'Desk to wall. Cut it and the board goes dead — the ON AIR light is all you have left.' },

  // ── Reward path-ends ──
  { id: 'reward:walking-basket', label: 'The Walking Basket', kind: 'reward',
    note: 'Win at the court without your opponent scoring once, and a two-legged basket waddles after you, ready to be fed shots anywhere.' },
  { id: 'reward:golden-ball', label: 'The Golden Ball', kind: 'reward',
    note: 'Win at the court and the ball turns to gold in your hands — a keepsake.' },
  { id: 'mech:the-wall', label: 'THE WALL', kind: 'mechanic',
    note: 'Big. Stands under the net and swats everything — until you hit him in the stomach, or lower. Then he folds, briefly.' },
  { id: 'mech:the-flea', label: 'THE FLEA', kind: 'mechanic',
    note: 'Small, with springs. Blocks every shot and hops over anything thrown at him — five jumps, then he is done.' },
  { id: 'reward:floor-41', label: 'Floor 41', kind: 'reward',
    note: 'The floor that is not on the panel. Press every button and the lift, out of spite, stops at all forty and then takes you there.' },
  { id: 'reward:museum-heist', label: 'The Heist', kind: 'reward',
    note: 'You pressed The Button (2026) and nobody saw.' },
  { id: 'reward:skipped-tutorial', label: 'Tutorial Skipped', kind: 'reward',
    note: 'Pressed the one button it told you not to. That was the whole tutorial.' },
  { id: 'reward:a-human', label: 'A Human', kind: 'reward',
    note: 'Press zero, hold, and a human finally picks up. It is the narrator. There are no other humans.' },
  { id: 'reward:read-the-terms', label: 'Read the Terms', kind: 'reward',
    note: 'Clause 47: the first person to read this far may leave through the side door. You read it.' },
  { id: 'reward:certified-robot', label: 'Certified Robot', kind: 'reward',
    note: 'Passed every grid first time, and fast. No human does that. You are a robot. You may still leave.' },
  { id: 'reward:queue-leader', label: 'Leader of Men', kind: 'reward',
    note: 'Pressed the button with your own queue behind you. They did not know what they were queuing for. Neither did you.' },
  { id: 'reward:queued-honestly', label: 'Queued Honestly', kind: 'reward',
    note: 'Waited your turn, all the way, and pressed it. Nobody will ever thank you for it.' },
  { id: 'reward:shoplifted', label: 'Five-Finger Discount', kind: 'reward',
    note: 'Out through the turnstile with an unpaid souvenir, while the guard looked the other way.' },
  { id: 'reward:grandma-saved', label: 'The Woodcutter', kind: 'reward',
    note: 'The wolf in grandma\'s bed, and an axe in your hand. Out she climbs, unharmed and furious.' },
  { id: 'reward:baby-wolf', label: 'The Baby Wolf', kind: 'reward',
    note: 'Spare and feed the duck-room wolf and a pup follows you out across the levels. It snacks on stray ducks as it trots after you — and it grows.' },
  { id: 'reward:unicycle', label: 'The Unicycle', kind: 'reward',
    note: 'Won by filling the big top\'s applause meter: a one-wheeled way to move — faster, and a menace to steer.' },
  { id: 'reward:golden-orb', label: 'The Golden Orb', kind: 'reward',
    note: "Behind the breeding-button puzzle's perfect run: a glowing orb on a plinth (a placeholder prize, for now)." },

  { id: 'reward:booth-out', label: 'A Decent Narrator', kind: 'reward',
    note: 'Get the dummy out of its door with nothing but his lines. He is not pleased. It is not a compliment.' },
  { id: 'reward:booth-broken', label: 'The Stare', kind: 'reward',
    note: 'Tell it nothing happened, often enough, and it stops doing anything but look at you.' },
  { id: 'reward:booth-silent', label: 'The Silent Take', kind: 'reward',
    note: 'Cable cut, cued by the light alone — and it does better without him.' },

  // ── Effects ──
  { id: 'fx:feathers', label: 'Feathers', kind: 'fx',
    note: 'What remains of a duck that met an axe, a hard landing, or a train.' },
];

const edges: GEdge[] = [
  // Levels introduce items.
  { from: 'lvl:forest', to: 'item:axe', kind: 'spawns' },
  { from: 'lvl:forest', to: 'item:duck', kind: 'spawns' },
  { from: 'lvl:doors', to: 'item:key', kind: 'spawns' },
  { from: 'lvl:basketball', to: 'item:basketball', kind: 'spawns' },
  { from: 'lvl:ducks', to: 'item:duck', kind: 'spawns', label: 'dispensed' },

  // Levels introduce mechanics.
  { from: 'lvl:forest', to: 'mech:campfire', kind: 'enables' },
  { from: 'lvl:desert', to: 'mech:train', kind: 'enables' },
  { from: 'lvl:desert', to: 'mech:crossing', kind: 'enables' },
  { from: 'lvl:desert', to: 'mech:wait-button', kind: 'enables' },
  { from: 'lvl:desert', to: 'item:dummy', kind: 'spawns' },
  { from: 'lvl:basketball', to: 'mech:scoring-hoop', kind: 'enables' },
  { from: 'lvl:doors', to: 'mech:door-lock', kind: 'enables' },
  { from: 'lvl:doors', to: 'mech:spike-trap', kind: 'enables' },
  { from: 'lvl:circus', to: 'mech:cannon', kind: 'enables' },
  { from: 'lvl:circus', to: 'mech:tightrope', kind: 'enables' },
  { from: 'lvl:circus', to: 'mech:clown-car', kind: 'enables' },
  { from: 'lvl:circus', to: 'mech:applause-meter', kind: 'enables' },
  { from: 'lvl:circus', to: 'mech:crowd', kind: 'enables' },
  { from: 'lvl:booth', to: 'mech:soundboard', kind: 'enables' },
  { from: 'lvl:booth', to: 'mech:booth-mic', kind: 'enables' },
  { from: 'lvl:booth', to: 'mech:booth-chair', kind: 'enables' },
  { from: 'lvl:booth', to: 'mech:booth-glass', kind: 'enables' },
  { from: 'lvl:booth', to: 'mech:booth-cable', kind: 'enables' },
  { from: 'lvl:ducks', to: 'mech:farm-pen', kind: 'enables' },
  { from: 'lvl:ducks', to: 'mech:pond', kind: 'enables' },
  { from: 'lvl:ducks', to: 'mech:saw-pen', kind: 'enables' },
  { from: 'lvl:ducks', to: 'mech:wolf-gate', kind: 'enables' },
  { from: 'lvl:ducks', to: 'mech:food-stand', kind: 'enables' },

  { from: 'mech:crossing', to: 'mech:train', kind: 'controls', label: 'holds it back' },
  { from: 'item:dummy', to: 'mech:train', kind: 'enables', label: 'decoy: opens the crossing' },
  { from: 'item:duck', to: 'mech:train', kind: 'enables', label: 'feed it: opens the crossing' },

  // Combines (hold tool → use on target). One per defineCombine.
  { from: 'item:axe', to: 'item:duck', kind: 'combine', label: 'chop' },
  { from: 'item:duck', to: 'mech:campfire', kind: 'combine', label: 'cook' },
  { from: 'item:cooked-duck', to: 'mech:food-stand', kind: 'combine', label: 'double $' },
  { from: 'item:key', to: 'mech:door-lock', kind: 'combine', label: 'unlock' },
  { from: 'item:key-red', to: 'mech:red-lock', kind: 'combine', label: 'unlock' },
  { from: 'lvl:desert', to: 'item:key-red', kind: 'spawns' },
  { from: 'lvl:elevator', to: 'mech:lift-panel', kind: 'enables' },
  { from: 'lvl:terms', to: 'mech:i-agree', kind: 'enables' },
  { from: 'lvl:terms', to: 'reward:read-the-terms', kind: 'reward', label: 'read clause 47' },
  { from: 'lvl:captcha', to: 'mech:captcha', kind: 'enables' },
  { from: 'lvl:captcha', to: 'reward:certified-robot', kind: 'reward', label: 'too perfect, too fast' },
  { from: 'lvl:queue', to: 'mech:queue-follow', kind: 'enables' },
  { from: 'lvl:queue', to: 'reward:queue-leader', kind: 'reward', label: 'press it with five behind you' },
  { from: 'lvl:queue', to: 'reward:queued-honestly', kind: 'reward', label: 'never cut' },
  { from: 'lvl:gift-shop', to: 'item:souvenir', kind: 'spawns' },
  { from: 'lvl:gift-shop', to: 'item:shop-coin', kind: 'spawns' },
  { from: 'lvl:gift-shop', to: 'mech:shop-till', kind: 'enables' },
  { from: 'item:money', to: 'mech:shop-till', kind: 'combine', label: 'pay' },
  { from: 'item:shop-coin', to: 'mech:shop-till', kind: 'combine', label: 'pay' },
  { from: 'item:souvenir', to: 'mech:shop-till', kind: 'combine', label: 'pay for it with…?' },
  { from: 'lvl:gift-shop', to: 'reward:shoplifted', kind: 'reward', label: 'past the guard, unseen' },
  { from: 'lvl:lost-found', to: 'mech:lost-found', kind: 'enables' },
  { from: 'mech:lost-found', to: 'item:left-shoe', kind: 'makes', label: 'claim it' },
  { from: 'mech:lost-found', to: 'item:dignity', kind: 'makes', label: 'claim it' },
  { from: 'mech:lost-found', to: 'item:duck', kind: 'makes', label: 'claim it' },
  { from: 'mech:lost-found', to: 'item:money', kind: 'makes', label: 'claim it' },
  { from: 'mech:lost-found', to: 'item:key-red', kind: 'makes', label: 'claim it' },
  { from: 'mech:lost-found', to: 'item:key', kind: 'makes', label: 'claim it' },
  { from: 'lvl:tutorial', to: 'reward:skipped-tutorial', kind: 'reward', label: 'press it anyway' },
  { from: 'lvl:loading-screen', to: 'mech:loading-bar', kind: 'enables' },
  { from: 'lvl:evil-twin', to: 'mech:evil-twin', kind: 'enables' },
  { from: 'lvl:customer-support', to: 'mech:phone-menu', kind: 'enables' },
  { from: 'lvl:customer-support', to: 'reward:a-human', kind: 'reward', label: 'press zero, and hold' },
  { from: 'mech:phone-menu', to: 'item:duck', kind: 'makes', label: 'press 1, then 3' },
  { from: 'lvl:elevator', to: 'reward:floor-41', kind: 'reward', label: 'press every button' },
  { from: 'lvl:museum', to: 'reward:museum-heist', kind: 'reward', label: 'press it unseen' },
  { from: 'lvl:waiting-room', to: 'item:ticket', kind: 'spawns' },
  { from: 'lvl:waiting-room', to: 'mech:counter', kind: 'enables' },
  { from: 'item:ticket', to: 'mech:counter', kind: 'combine', label: 'get served' },
  { from: 'item:money', to: 'mech:counter', kind: 'combine', label: 'bribe' },
  { from: 'item:duck', to: 'mech:counter', kind: 'combine', label: 'riot' },
  { from: 'lvl:forest', to: 'mech:red-lock', kind: 'enables' },
  { from: 'mech:red-lock', to: 'mech:grandma', kind: 'enables', label: 'inside' },
  { from: 'mech:wolf-gate', to: 'mech:grandma', kind: 'enables', label: 'bring the freed wolf' },
  { from: 'item:axe', to: 'mech:grandma', kind: 'combine', label: 'the woodcutter' },
  { from: 'lvl:forest', to: 'reward:grandma-saved', kind: 'reward', label: 'axe the wolf in the bed' },
  { from: 'item:duck', to: 'mech:booth-mic', kind: 'combine', label: 'a line of its own' },
  { from: 'item:money', to: 'mech:booth-chair', kind: 'combine', label: 'a tip' },
  { from: 'item:basketball', to: 'mech:booth-glass', kind: 'combine', label: 'knock' },
  { from: 'item:axe', to: 'mech:booth-cable', kind: 'combine', label: 'cut' },
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

  // Reward path-ends.
  { from: 'lvl:basketball', to: 'reward:walking-basket', kind: 'reward', label: 'win, he never scores' },
  { from: 'lvl:basketball', to: 'reward:golden-ball', kind: 'reward', label: 'win the match' },
  { from: 'lvl:basketball', to: 'mech:the-wall', kind: 'enables' },
  { from: 'lvl:basketball', to: 'mech:the-flea', kind: 'enables' },
  { from: 'lvl:ducks', to: 'reward:baby-wolf', kind: 'reward', label: 'feed the wolf' },
  { from: 'lvl:ducks', to: 'item:money', kind: 'reward', label: 'mercy path' },
  { from: 'lvl:circus', to: 'reward:unicycle', kind: 'reward', label: 'fill the applause meter' },
  { from: 'gag:another-button', to: 'reward:golden-orb', kind: 'reward', label: '10 in a row' },
  { from: 'mech:soundboard', to: 'reward:booth-out', kind: 'reward', label: 'the right four lines' },
  { from: 'mech:soundboard', to: 'reward:booth-broken', kind: 'reward', label: 'nothing, three times' },
  { from: 'mech:booth-cable', to: 'reward:booth-silent', kind: 'reward', label: 'the light alone' },
  { from: 'reward:walking-basket', to: 'mech:scoring-hoop', kind: 'enables', label: 'carry it' },

  // Held cushions against a train.
  { from: 'item:duck', to: 'mech:train', kind: 'shields', label: 'cushions (bursts)' },
  { from: 'item:basketball', to: 'mech:train', kind: 'shields', label: 'cushions (kept)' },

  // ── Newer cross-connections (the funny ones) ──
  { from: 'item:money', to: 'mech:wolf-gate', kind: 'combine', label: 'bribe' }, // it can't spend it; it takes it anyway
  { from: 'item:duck', to: 'mech:scoring-hoop', kind: 'reward', label: 'dunk → feathers' }, // a duck through the hoop scores + bursts
  { from: 'item:duck', to: 'mech:cannon', kind: 'combine', label: 'fire it' },
  { from: 'item:basketball', to: 'mech:applause-meter', kind: 'combine', label: 'cheat' },
  { from: 'item:axe', to: 'mech:crowd', kind: 'combine', label: 'gasp' },
  { from: 'item:duck', to: 'reward:baby-wolf', kind: 'enables', label: 'feeds it' }, // the pet eats stray ducks…
  { from: 'reward:baby-wolf', to: 'mech:grown-wolf', kind: 'makes', label: 'fed 10 → it turns' }, // …and at ten becomes your doom
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
