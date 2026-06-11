// The /button/graph.html page: a force-directed diagram of the content graph.
// Fog of war — every node is shown so you see the shape of what's left, but
// nodes you haven't discovered are anonymised ('?', no name/details). A
// "Reveal all" toggle lifts the fog (the full design map, for building).

import { CONTENT_GRAPH, type GNode, type GEdge, type NodeKind, type EdgeKind } from './content-graph';
import { discovered, isDiscovered, onProgress, resetProgress } from './progress';

const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(t: K) => document.createElementNS(NS, t);
const byId = (id: string) => document.getElementById(id)!;

const KIND_COLOR: Record<NodeKind, string> = {
  level: '#5b8fd6', gag: '#9b8bc4', item: '#e0a73e', mechanic: '#3fb0a3', reward: '#f0c948', fx: '#e08a8a',
};
const KIND_R: Record<NodeKind, number> = { level: 22, gag: 15, item: 16, mechanic: 14, reward: 18, fx: 12 };
const EDGE_STYLE: Record<EdgeKind, { color: string; width: number; dash: string }> = {
  portal: { color: '#6b9bd6', width: 2.6, dash: '7 4' },
  spawns: { color: '#c79a4a', width: 1.6, dash: '' },
  combine: { color: '#e0863e', width: 1.9, dash: '' },
  makes: { color: '#5cba7d', width: 1.6, dash: '' },
  reward: { color: '#f0c948', width: 2.1, dash: '' },
  enables: { color: '#7a7a88', width: 1.4, dash: '2 3' },
  controls: { color: '#3fb0a3', width: 1.7, dash: '5 3' },
  shields: { color: '#e08a8a', width: 1.5, dash: '1 4' },
};
const FOG_EDGE = { color: '#33333c', width: 1, dash: '2 5' };

interface SimNode extends GNode { x: number; y: number; vx: number; vy: number; fx?: number; fy?: number; }

const nodes: SimNode[] = CONTENT_GRAPH.nodes.map((n, i) => {
  const a = (i / CONTENT_GRAPH.nodes.length) * Math.PI * 2;
  return { ...n, x: Math.cos(a) * 260, y: Math.sin(a) * 260, vx: 0, vy: 0 };
});
const nodeById = new Map(nodes.map((n) => [n.id, n]));
const edges = CONTENT_GRAPH.edges.filter((e) => nodeById.has(e.from) && nodeById.has(e.to));

// adjacency for the details panel + highlight
const adj = new Map<string, GEdge[]>();
for (const e of edges) {
  adj.set(e.from, [...(adj.get(e.from) ?? []), e]);
  adj.set(e.to, [...(adj.get(e.to) ?? []), e]);
}

let revealAll = false;
const seen = (id: string) => revealAll || isDiscovered(id);

// ── Force simulation (cooling) ──
let alpha = 1;
const REPULSE = 7000, SPRING = 0.02, REST = 96, GRAVITY = 0.013, DAMP = 0.86;
function step(): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
      const f = (REPULSE / d2) * alpha; dx /= d; dy /= d;
      a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
    }
  }
  for (const e of edges) {
    const a = nodeById.get(e.from)!, b = nodeById.get(e.to)!;
    let dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) + 0.01, f = (d - REST) * SPRING * alpha;
    dx /= d; dy /= d;
    a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
  }
  for (const n of nodes) {
    if (n.fx != null) { n.x = n.fx; n.y = n.fy!; n.vx = n.vy = 0; continue; }
    n.vx = (n.vx - n.x * GRAVITY * alpha) * DAMP;
    n.vy = (n.vy - n.y * GRAVITY * alpha) * DAMP;
    n.x += n.vx; n.y += n.vy;
  }
  alpha *= 0.99;
}

// ── SVG scaffolding ──
const svg = byId('svg') as unknown as SVGSVGElement;
const defs = el('defs');
for (const k of Object.keys(EDGE_STYLE) as EdgeKind[]) {
  const m = el('marker');
  m.setAttribute('id', `arrow-${k}`); m.setAttribute('viewBox', '0 0 10 10');
  m.setAttribute('refX', '9'); m.setAttribute('refY', '5'); m.setAttribute('markerWidth', '6');
  m.setAttribute('markerHeight', '6'); m.setAttribute('orient', 'auto-start-reverse');
  const p = el('path'); p.setAttribute('d', 'M0 0 L10 5 L0 10 z'); p.setAttribute('fill', EDGE_STYLE[k].color);
  m.appendChild(p); defs.appendChild(m);
}
svg.appendChild(defs);
const viewport = el('g'); svg.appendChild(viewport);
const edgeLayer = el('g'); viewport.appendChild(edgeLayer);
const labelLayer = el('g'); viewport.appendChild(labelLayer);
const nodeLayer = el('g'); viewport.appendChild(nodeLayer);

// One DOM group per edge (line + optional caption) and per node (circle + label).
interface EdgeEls { line: SVGLineElement; cap: SVGTextElement; e: GEdge; }
const edgeEls: EdgeEls[] = edges.map((e) => {
  const line = el('line'); edgeLayer.appendChild(line);
  const cap = el('text'); cap.setAttribute('text-anchor', 'middle'); cap.setAttribute('font-size', '10');
  cap.setAttribute('font-style', 'italic'); labelLayer.appendChild(cap);
  return { line, cap, e };
});
interface NodeEls { g: SVGGElement; circle: SVGCircleElement; q: SVGTextElement; label: SVGTextElement; n: SimNode; }
const nodeEls: NodeEls[] = nodes.map((n) => {
  const g = el('g'); g.style.cursor = 'pointer';
  const circle = el('circle'); g.appendChild(circle);
  const q = el('text'); q.setAttribute('text-anchor', 'middle'); q.setAttribute('dominant-baseline', 'central');
  q.setAttribute('font-size', '15'); q.setAttribute('font-weight', 'bold'); q.textContent = '?'; g.appendChild(q);
  const label = el('text'); label.setAttribute('text-anchor', 'middle'); label.setAttribute('font-size', '12');
  label.setAttribute('fill', '#d2d2da'); g.appendChild(label);
  nodeLayer.appendChild(g);
  const ne: NodeEls = { g, circle, q, label, n };
  g.addEventListener('pointerdown', (ev) => startNodeDrag(ev, ne));
  g.addEventListener('click', (ev) => { ev.stopPropagation(); select(n.id); });
  return ne;
});

let focusId: string | null = null;
function neighborsOf(id: string): Set<string> {
  const s = new Set<string>([id]);
  for (const e of adj.get(id) ?? []) { s.add(e.from); s.add(e.to); }
  return s;
}

function render(): void {
  const hl = focusId ? neighborsOf(focusId) : null;
  for (const { line, cap, e } of edgeEls) {
    const a = nodeById.get(e.from)!, b = nodeById.get(e.to)!;
    const lit = seen(e.from) && seen(e.to);
    const st = lit ? EDGE_STYLE[e.kind] : FOG_EDGE;
    line.setAttribute('x1', `${a.x}`); line.setAttribute('y1', `${a.y}`);
    line.setAttribute('x2', `${b.x}`); line.setAttribute('y2', `${b.y}`);
    line.setAttribute('stroke', st.color); line.setAttribute('stroke-width', `${st.width}`);
    line.setAttribute('stroke-dasharray', st.dash);
    line.setAttribute('marker-end', lit && !e.bidirectional ? `url(#arrow-${e.kind})` : '');
    const dim = hl && !(hl.has(e.from) && hl.has(e.to));
    line.setAttribute('opacity', dim ? '0.12' : lit ? '0.85' : '0.5');
    if (lit && e.label && !dim) {
      cap.setAttribute('x', `${(a.x + b.x) / 2}`); cap.setAttribute('y', `${(a.y + b.y) / 2 - 3}`);
      cap.setAttribute('fill', st.color); cap.textContent = e.label;
      cap.setAttribute('opacity', alpha > 0.05 ? '0' : '0.9'); // only once it settles, to cut churn
    } else cap.textContent = '';
  }
  for (const { g, circle, q, label, n } of nodeEls) {
    const known = seen(n.id);
    const r = known ? KIND_R[n.kind] : 13;
    circle.setAttribute('cx', `${n.x}`); circle.setAttribute('cy', `${n.y}`); circle.setAttribute('r', `${r}`);
    circle.setAttribute('fill', known ? KIND_COLOR[n.kind] : '#24242c');
    circle.setAttribute('stroke', known ? '#101014' : '#3a3a46');
    circle.setAttribute('stroke-width', focusId === n.id ? '3.5' : '1.5');
    q.setAttribute('x', `${n.x}`); q.setAttribute('y', `${n.y}`);
    q.setAttribute('fill', known ? '#10101480' : '#6a6a76');
    q.textContent = known ? '' : '?';
    label.setAttribute('x', `${n.x}`); label.setAttribute('y', `${n.y + r + 13}`);
    label.textContent = known ? n.label : '';
    const dim = hl && !hl.has(n.id);
    g.setAttribute('opacity', dim ? '0.2' : '1');
  }
}

// ── pan / zoom ──
let tx = innerWidth / 2, ty = innerHeight / 2, scale = 1;
function applyView(): void { viewport.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`); }
const toSim = (sx: number, sy: number) => ({ x: (sx - tx) / scale, y: (sy - ty) / scale });

const map = byId('map');
let panning = false, panX = 0, panY = 0;
map.addEventListener('pointerdown', (e) => {
  panning = true; panX = e.clientX; panY = e.clientY; map.classList.add('dragging');
  focusId = null; select(null); render();
});
addEventListener('pointermove', (e) => {
  if (drag) { const p = toSim(e.clientX, e.clientY); drag.n.fx = p.x; drag.n.fy = p.y; alpha = Math.max(alpha, 0.3); return; }
  if (!panning) return;
  tx += e.clientX - panX; ty += e.clientY - panY; panX = e.clientX; panY = e.clientY; applyView();
});
addEventListener('pointerup', () => {
  panning = false; map.classList.remove('dragging');
  if (drag) { drag.n.fx = drag.n.fy = undefined; drag = null; }
});
map.addEventListener('wheel', (e) => {
  e.preventDefault();
  const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  const ns = Math.min(3, Math.max(0.3, scale * f));
  tx = e.clientX - ((e.clientX - tx) * ns) / scale; ty = e.clientY - ((e.clientY - ty) * ns) / scale;
  scale = ns; applyView();
}, { passive: false });

let drag: NodeEls | null = null;
function startNodeDrag(ev: PointerEvent, ne: NodeEls): void {
  ev.stopPropagation(); drag = ne; const p = toSim(ev.clientX, ev.clientY); ne.n.fx = p.x; ne.n.fy = p.y;
}

// ── details panel ──
function select(id: string | null): void {
  focusId = id;
  const panel = byId('panel');
  if (!id) { panel.classList.remove('show'); render(); return; }
  const n = nodeById.get(id)!;
  const conns = adj.get(id) ?? [];
  if (seen(id)) {
    const lines = conns.map((e) => {
      const otherId = e.from === id ? e.to : e.from;
      const dir = e.from === id ? '→' : '←';
      const other = seen(otherId) ? nodeById.get(otherId)!.label : '???';
      return `<div>${dir} <b>${other}</b> <span style="color:#85858f">· ${e.kind}${e.label ? ' (' + e.label + ')' : ''}</span></div>`;
    });
    panel.innerHTML =
      `<div class="kind" style="color:${KIND_COLOR[n.kind]}">${n.kind}</div>` +
      `<h2>${n.label}</h2><div class="note">${n.note ?? ''}</div>` +
      (lines.length ? `<div class="links">${lines.join('')}</div>` : '');
  } else {
    const knownLinks = conns.filter((e) => seen(e.from === id ? e.to : e.from)).length;
    panel.innerHTML =
      `<div class="kind">??? undiscovered</div><h2>???</h2>` +
      `<div class="note mystery">Something you haven't found yet. Keep playing — or hit "Reveal all".</div>` +
      `<div class="links">${knownLinks} known connection${knownLinks === 1 ? '' : 's'} lead${knownLinks === 1 ? 's' : ''} here.</div>`;
  }
  panel.classList.add('show');
  render();
}

// ── toolbar + counts ──
function updateCount(): void {
  const total = nodes.length;
  const got = revealAll ? total : nodes.filter((n) => isDiscovered(n.id)).length;
  byId('count').textContent = `Discovered ${got} / ${total}`;
}
byId('reveal').addEventListener('click', () => {
  revealAll = !revealAll;
  byId('reveal').classList.toggle('on', revealAll);
  updateCount(); if (focusId) select(focusId); render();
});
byId('reset').addEventListener('click', () => {
  if (!confirm('Reset discovery progress? The map goes dark again.')) return;
  resetProgress();
});
onProgress(() => { updateCount(); if (focusId) select(focusId); render(); });

// legend
(() => {
  const kinds: [NodeKind, string][] = [['level', 'Level'], ['gag', 'Gag'], ['item', 'Item'],
    ['mechanic', 'Mechanic'], ['reward', 'Reward'], ['fx', 'Effect']];
  const edgeKinds: [EdgeKind, string][] = [['portal', 'walk between'], ['combine', 'combine'],
    ['makes', 'makes'], ['reward', 'reward'], ['spawns', 'spawns'], ['enables', 'unlocks'],
    ['controls', 'controls'], ['shields', 'shields vs train']];
  byId('legend').innerHTML =
    kinds.map(([k, l]) => `<div class="row"><span class="dot" style="background:${KIND_COLOR[k]}"></span>${l}</div>`).join('') +
    `<div class="row" style="margin-top:6px;color:#76767f">— links —</div>` +
    edgeKinds.map(([k, l]) => `<div class="row"><span class="ln" style="border-color:${EDGE_STYLE[k].color}"></span>${l}</div>`).join('');
})();

addEventListener('resize', () => { /* transform is absolute, nothing to recompute */ });

applyView();
updateCount();
// settle, then keep a light loop so drags stay live
function frame(): void { if (alpha > 0.004 || drag) step(); render(); requestAnimationFrame(frame); }
// give it a head start so it opens already mostly settled
for (let i = 0; i < 120; i++) step();
frame();
