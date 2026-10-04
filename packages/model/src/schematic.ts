import type { Harness, Point, WireEnd } from "./schema";

/** What the router needs from a pin card: which side wires attach on, where each pin row is, and the card's box. */
export interface SchematicCard {
  facing: 1 | -1;
  attachX: number;
  /** The card's box; with `x` and `w` it is an obstacle wires route around. */
  card: { x?: number; y: number; w?: number; h: number };
  rowByCavity: Map<string, { y: number }>;
}

function nodePos(h: Harness, nodeId: string): Point {
  const n = h.nodes.find((x) => x.id === nodeId);
  if (!n) return { x: 0, y: 0 };
  if (n.kind === "connector") return h.connectors.find((c) => c.id === n.connectorId)?.position ?? n.position;
  return n.position;
}

/**
 * Schematic wire routing, like an ECAD schematic: every wire runs pin-to-pin in right angles on the grid.
 *
 * Rules: wires never run under a part (pin cards, splice bodies, other pins and barrel ports), never share a line
 * with another net's wire, and never turn on or end at another wire's corner; crossing a wire is allowed but costs.
 * Within that, each wire takes the shortest route with the fewest bends. Wires the user has shaped keep their path
 * and are obstacles for the rest. Dragging a part rubber-bands the shaped wires attached to it (see `dragEnds`).
 */

/** Schematic grid pitch (the canvas dot grid and the pin-row pitch). Connector anchors, pin attach points, splice points and every wire run sit on it. */
export const SCH_GRID = 20;
/** Minimum horizontal run out of a pin before the first turn. */
export const SCH_STUB = SCH_GRID;
/** Splice diamond offset from its host node (matches the bundle layout's splice marker). */
export const SPLICE_OFFSET = 16;

/** Nearest schematic grid line. */
export const snapToGrid = (v: number) => Math.round(v / SCH_GRID) * SCH_GRID;

/**
 * Top edge of a pin card of height `h` centred (as near as the grid allows) on `anchorY`, placed so every pin row
 * centre (`top + headerH + i * rowH + rowH / 2`) lands on a grid line. `rowH` must be a multiple of the grid.
 */
export function gridCardTop(anchorY: number, h: number, headerH: number, rowH: number): number {
  const first = headerH + rowH / 2;
  return snapToGrid(anchorY - h / 2 + first) - first;
}

/** A wire end on the schematic: where it attaches and which way it leaves (+1 right, -1 left). */
interface End {
  p: Point;
  dir: 1 | -1;
}

export function splicePoint(h: Harness, spliceId: string): Point | null {
  const s = h.splices.find((x) => x.id === spliceId);
  if (!s) return null;
  const p = nodePos(h, s.nodeId);
  return { x: snapToGrid(p.x + SPLICE_OFFSET), y: snapToGrid(p.y + SPLICE_OFFSET) };
}

/** Port spacing and half-width of the schematic splice symbol (ports sit on grid points either side of the body). */
export const SPLICE_PORT_DX = SCH_GRID;

export interface SpliceGeometry {
  center: Point;
  /** Body box (between the port columns). */
  box: { x: number; y: number; w: number; h: number };
  /** One port per crimp barrel: where its wires attach and which way they leave. */
  ports: { barrel: number; p: Point; dir: 1 | -1 }[];
}

/**
 * Schematic splice symbol: a small body with one port per crimp barrel. Barrel 1 (index 0) faces the end it's wired
 * to; the other barrels sit on the opposite side, stacked. A single-ended splice has its one port toward its wires.
 */
export function spliceGeometry(h: Harness, s: Harness["splices"][number], layouts?: Map<string, SchematicCard>): SpliceGeometry {
  const base = s.position ?? splicePoint(h, s.id) ?? { x: 0, y: 0 };
  const center = { x: snapToGrid(base.x), y: snapToGrid(base.y) };
  // Mean x of the far ends wired to a barrel (pins: their card attach edge; splices: their position).
  const farX = (barrel: number | null): number | null => {
    const xs: number[] = [];
    for (const w of h.wires)
      for (const [e, o] of [[w.from, w.to], [w.to, w.from]] as const) {
        if (e.kind !== "splice" || e.spliceId !== s.id || (barrel !== null && (e.barrel ?? 0) !== barrel)) continue;
        if (o.kind === "pin") xs.push(layouts?.get(o.connectorId)?.attachX ?? h.connectors.find((c) => c.id === o.connectorId)?.position.x ?? center.x);
        else {
          const os = h.splices.find((x) => x.id === o.spliceId);
          if (os) xs.push(os.position?.x ?? center.x);
        }
      }
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const side = (x: number | null, fallback: 1 | -1): 1 | -1 => (x === null || Math.abs(x - center.x) < 1 ? fallback : x > center.x ? 1 : -1);
  const barrels = Math.max(1, s.barrels ?? 1);
  // A stored orientation wins, so the symbol never flips on its own while it is dragged around.
  const first = s.facing ?? side(farX(barrels === 1 ? null : 0), -1);
  const ports: SpliceGeometry["ports"] = [];
  let rowsOther = 0;
  for (let b = 0; b < barrels; b++) {
    if (b === 0) ports.push({ barrel: 0, p: { x: center.x + first * SPLICE_PORT_DX, y: center.y }, dir: first });
    else ports.push({ barrel: b, p: { x: center.x - first * SPLICE_PORT_DX, y: center.y + SCH_GRID * rowsOther++ }, dir: (-first) as 1 | -1 });
  }
  const rows = Math.max(1, rowsOther);
  return { center, box: { x: center.x - SPLICE_PORT_DX / 2 - 2, y: center.y - SCH_GRID / 2 + 3, w: SPLICE_PORT_DX + 4, h: rows * SCH_GRID - 6 }, ports };
}

function endOf(h: Harness, e: WireEnd, layouts: Map<string, SchematicCard>): End | null {
  if (e.kind === "pin") {
    const L = layouts.get(e.connectorId);
    if (!L) return null;
    const r = L.rowByCavity.get(e.cavityId);
    return { p: { x: L.attachX, y: r ? r.y : L.card.y + L.card.h / 2 }, dir: L.facing };
  }
  const s = h.splices.find((x) => x.id === e.spliceId);
  if (!s) return null;
  // Each barrel is a port on the splice symbol with its own side.
  const port = spliceGeometry(h, s, layouts).ports.find((x) => x.barrel === Math.min(e.barrel ?? 0, s.barrels - 1));
  return port ? { p: port.p, dir: port.dir } : null;
}

/** SVG path through an orthogonal polyline with small rounded corners. */
export function roundedPath(pts: Point[], radius = 4): string {
  if (!pts.length) return "";
  // Drop zero-length runs so corners are computed between real turns.
  const P = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) > 0.01);
  let d = `M${P[0]!.x},${P[0]!.y}`;
  for (let i = 1; i < P.length - 1; i++) {
    const a = P[i - 1]!;
    const c = P[i]!;
    const b = P[i + 1]!;
    const l1 = Math.hypot(c.x - a.x, c.y - a.y);
    const l2 = Math.hypot(b.x - c.x, b.y - c.y);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const p1 = { x: c.x - ((c.x - a.x) / l1) * r, y: c.y - ((c.y - a.y) / l1) * r };
    const p2 = { x: c.x + ((b.x - c.x) / l2) * r, y: c.y + ((b.y - c.y) / l2) * r };
    d += ` L${p1.x},${p1.y} Q${c.x},${c.y} ${p2.x},${p2.y}`;
  }
  const last = P[P.length - 1]!;
  if (P.length > 1) d += ` L${last.x},${last.y}`;
  return d;
}

/** Connector pairs with their wire counts, for the zoomed-out schematic (one line per pair). */
export function connectorPairs(h: Harness): { a: string; b: string; count: number }[] {
  const m = new Map<string, { a: string; b: string; count: number }>();
  for (const w of h.wires) {
    if (w.from.kind !== "pin" || w.to.kind !== "pin" || w.from.connectorId === w.to.connectorId) continue;
    const [a, b] = [w.from.connectorId, w.to.connectorId].sort() as [string, string];
    const k = `${a}|${b}`;
    const e = m.get(k) ?? m.set(k, { a, b, count: 0 }).get(k)!;
    e.count++;
  }
  return [...m.values()];
}


// ─── Grid router ─────────────────────────────────────────────────────────────

/**
 * The routing grid (grid units) over the whole schematic: blocked nodes (parts), and what each node and edge carries.
 * Net ids are numbered from 1; 0 means free. A node can carry a straight run each way (a crossing) or one corner/end.
 */
class Grid {
  readonly x0: number;
  readonly y0: number;
  readonly W: number;
  readonly H: number;
  readonly blocked: Uint8Array;
  readonly edgeH: Int32Array;
  readonly edgeV: Int32Array;
  readonly runH: Int32Array;
  readonly runV: Int32Array;
  readonly corner: Int32Array;
  constructor(box: { x0: number; y0: number; x1: number; y1: number }) {
    this.x0 = box.x0;
    this.y0 = box.y0;
    this.W = box.x1 - box.x0 + 1;
    this.H = box.y1 - box.y0 + 1;
    const n = this.W * this.H;
    this.blocked = new Uint8Array(n);
    this.edgeH = new Int32Array(n);
    this.edgeV = new Int32Array(n);
    this.runH = new Int32Array(n);
    this.runV = new Int32Array(n);
    this.corner = new Int32Array(n);
  }
  at(x: number, y: number) {
    return x < this.x0 || y < this.y0 || x >= this.x0 + this.W || y >= this.y0 + this.H ? -1 : (y - this.y0) * this.W + (x - this.x0);
  }
  block(x0: number, y0: number, x1: number, y1: number) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.at(x, y) >= 0) this.blocked[this.at(x, y)] = 1;
  }
  /** Record a routed polyline (grid units) for `net`, so other nets keep off it. */
  add(net: number, pts: Point[]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const horizontal = a.y === b.y;
      const n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const sx = Math.sign(b.x - a.x);
      const sy = Math.sign(b.y - a.y);
      for (let k = 0; k < n; k++) {
        const x = a.x + sx * k;
        const y = a.y + sy * k;
        // An edge is stored at its lower / left node.
        const e = horizontal ? this.at(Math.min(x, x + sx), y) : this.at(x, Math.min(y, y + sy));
        if (e >= 0) (horizontal ? this.edgeH : this.edgeV)[e] = net;
        const c = this.at(x, y);
        if (k > 0 && c >= 0) (horizontal ? this.runH : this.runV)[c] = net;
      }
    }
    for (const p of pts) this.reserve(p.x, p.y, net);
  }
  /** A corner, end, or a pin's stub point: nobody else may pass, turn or end there. */
  reserve(x: number, y: number, net: number) {
    const c = this.at(x, y);
    if (c >= 0 && !this.corner[c]) this.corner[c] = net;
  }
}

/** Extra cost of a bend and of crossing another wire, in grid steps: fewer bends and crossings beat a slightly shorter run. */
const BEND = 4;
const CROSS = 3;
/** Search margin round a wire's two ends (grid steps); widened once if nothing is found. */
const MARGIN = 12;
/** E, S, W, N. */
const DX = [1, 0, -1, 0] as const;
const DY = [0, 1, 0, -1] as const;

/** Minimal binary heap of [priority, value]. */
class Heap {
  private f: number[] = [];
  private v: number[] = [];
  get size() {
    return this.v.length;
  }
  push(f: number, v: number) {
    const F = this.f;
    const V = this.v;
    F.push(f);
    V.push(v);
    let i = V.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p]! <= F[i]!) break;
      [F[p], F[i]] = [F[i]!, F[p]!];
      [V[p], V[i]] = [V[i]!, V[p]!];
      i = p;
    }
  }
  pop(): number {
    const F = this.f;
    const V = this.v;
    const top = V[0]!;
    const lf = F.pop()!;
    const lv = V.pop()!;
    if (V.length) {
      F[0] = lf;
      V[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < V.length && F[l]! < F[m]!) m = l;
        if (r < V.length && F[r]! < F[m]!) m = r;
        if (m === i) break;
        [F[m], F[i]] = [F[i]!, F[m]!];
        [V[m], V[i]] = [V[i]!, V[m]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest orthogonal path on the grid (grid units) from `a` (leaving in `a.dir`) to `b` (entering against `b.dir`),
 * round parts and other nets' wires; bends and crossings cost extra. Null when there is none in `box`.
 */
function routeOne(g: Grid, a: End, b: End, net: number, box: { x0: number; y0: number; x1: number; y1: number }): Point[] | null {
  const bx0 = Math.max(box.x0, g.x0);
  const by0 = Math.max(box.y0, g.y0);
  const bx1 = Math.min(box.x1, g.x0 + g.W - 1);
  const by1 = Math.min(box.y1, g.y0 + g.H - 1);
  const W = bx1 - bx0 + 1;
  const H = by1 - by0 + 1;
  if (W <= 0 || H <= 0) return null;
  const cost = new Float64Array(W * H * 4).fill(Infinity);
  const prev = new Int32Array(W * H * 4).fill(-1);
  const idx = (x: number, y: number, d: number) => ((y - by0) * W + (x - bx0)) * 4 + d;
  const { x: sx, y: sy } = a.p;
  const { x: tx, y: ty } = b.p;
  if (sx < bx0 || sx > bx1 || sy < by0 || sy > by1 || tx < bx0 || tx > bx1 || ty < by0 || ty > by1) return null;
  const startDir = a.dir === 1 ? 0 : 2;
  const endDir = b.dir === 1 ? 2 : 0; // arriving at b, moving toward it
  // Tie-break for where a vertical run goes, so a bus routed in order doesn't cross itself: same-side wires nest
  // (innermost first), wires heading down turn late, wires heading up turn early.
  const lane = a.dir === b.dir ? (a.dir === 1 ? Math.max(sx, tx) : Math.min(sx, tx)) : ty > sy ? tx : sx;
  const other = (v: number) => v !== 0 && v !== net;
  const s0 = idx(sx, sy, startDir);
  cost[s0] = 0;
  const heap = new Heap();
  heap.push(Math.abs(sx - tx) + Math.abs(sy - ty), s0);
  let goal = -1;
  while (heap.size) {
    const s = heap.pop();
    const d = s & 3;
    const cell = s >> 2;
    const x = (cell % W) + bx0;
    const y = ((cell / W) | 0) + by0;
    if (s !== s0 && x === tx && y === ty) {
      goal = s;
      break;
    }
    const c = cost[s]!;
    const gc = g.at(x, y);
    const occupiedHere = s !== s0 && (other(g.runH[gc]!) || other(g.runV[gc]!) || other(g.corner[gc]!));
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue;
      if (s === s0 && nd !== startDir) continue; // leave the pin outward
      const turn = nd !== d;
      if (turn && occupiedHere) continue; // never turn on another wire
      const nx = x + DX[nd]!;
      const ny = y + DY[nd]!;
      if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1) continue;
      const atGoal = nx === tx && ny === ty;
      if (atGoal && nd !== endDir) continue; // enter the far pin from outside
      const gn = g.at(nx, ny);
      if (!atGoal && g.blocked[gn]) continue;
      const horizontal = (nd & 1) === 0;
      const edge = horizontal ? g.edgeH[g.at(Math.min(x, nx), y)]! : g.edgeV[g.at(x, Math.min(y, ny))]!;
      if (other(edge)) continue; // never along another net's wire
      let step = 1 + (turn ? BEND : 0) + (horizontal ? 0 : 0.001 * Math.abs(x - lane));
      if (!atGoal) {
        if (other(g.corner[gn]!) || other(horizontal ? g.runH[gn]! : g.runV[gn]!)) continue; // corners and ends are taken
        if (other(horizontal ? g.runV[gn]! : g.runH[gn]!)) step += CROSS;
      }
      const ns = idx(nx, ny, nd);
      if (c + step < cost[ns]!) {
        cost[ns] = c + step;
        prev[ns] = s;
        heap.push(c + step + Math.abs(nx - tx) + Math.abs(ny - ty), ns);
      }
    }
  }
  if (goal < 0) return null;
  const path: Point[] = [];
  for (let s = goal; s >= 0; s = prev[s]!) {
    const cell = s >> 2;
    path.push({ x: (cell % W) + bx0, y: ((cell / W) | 0) + by0 });
  }
  return simplifyPolyline(path.reverse());
}

/**
 * Orthogonal pin-to-pin polyline for every wire, keyed by wire id, running from `wire.from` to `wire.to`.
 * Wires with a path of their own (shaped by the user) run through it; the rest are routed on the grid round parts
 * and other nets' wires (`auto`, the default), or with auto-routing off, each on its own round the parts only.
 */
export function schematicRoutes(h: Harness, layouts: Map<string, SchematicCard>, opts: { auto?: boolean } = {}): Map<string, Point[]> {
  const auto = opts.auto ?? true;
  const G = SCH_GRID;
  const out = new Map<string, Point[]>();
  const toGrid = (p: Point) => ({ x: Math.round(p.x / G), y: Math.round(p.y / G) });
  const fromGrid = (p: Point) => ({ x: p.x * G, y: p.y * G });
  // Parts: pin cards (including their pin attach column) and splice bodies; plus every barrel port.
  const rects: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const rect = (x: number, y: number, w: number, hh: number) => rects.push({ x0: Math.ceil(x / G - 1e-9), y0: Math.ceil(y / G - 1e-9), x1: Math.floor((x + w) / G + 1e-9), y1: Math.floor((y + hh) / G + 1e-9) });
  for (const L of layouts.values()) if (L.card.x !== undefined && L.card.w !== undefined) rect(L.card.x, L.card.y, L.card.w, L.card.h);
  const ports: Point[] = [];
  for (const s of h.splices) {
    const g = spliceGeometry(h, s, layouts);
    rect(g.box.x, g.box.y, g.box.w, g.box.h);
    for (const p of g.ports) ports.push(toGrid(p.p));
  }
  type Job = { id: string; net: number; a: End; b: End; key: string };
  const netNo = new Map<string, number>();
  const num = (n: string) => netNo.get(n) ?? netNo.set(n, netNo.size + 1).get(n)!;
  const jobs: Job[] = [];
  const shaped: { id: string; net: number; pts: Point[] }[] = [];
  for (const w of h.wires) {
    const a = endOf(h, w.from, layouts);
    const b = endOf(h, w.to, layouts);
    if (!a || !b) continue;
    if (w.schPath?.length) shaped.push({ id: w.id, net: num(w.netId), pts: orthoThrough(a.p, w.schPath, b.p) });
    else {
      const ka = w.from.kind === "pin" ? w.from.connectorId : `s${w.from.spliceId}`;
      const kb = w.to.kind === "pin" ? w.to.connectorId : `s${w.to.spliceId}`;
      jobs.push({ id: w.id, net: num(w.netId), a: { p: toGrid(a.p), dir: a.dir }, b: { p: toGrid(b.p), dir: b.dir }, key: ka < kb ? `${ka}|${kb}` : `${kb}|${ka}` });
    }
  }
  // One grid over everything, with room round the edges to route past the outermost parts.
  const xs = [...rects.flatMap((r) => [r.x0, r.x1]), ...jobs.flatMap((j) => [j.a.p.x, j.b.p.x])];
  const ys = [...rects.flatMap((r) => [r.y0, r.y1]), ...jobs.flatMap((j) => [j.a.p.y, j.b.p.y])];
  const pad = 4 * MARGIN;
  const grid = () => {
    const gr = new Grid({ x0: Math.min(0, ...xs) - pad, y0: Math.min(0, ...ys) - pad, x1: Math.max(0, ...xs) + pad, y1: Math.max(0, ...ys) + pad });
    for (const r of rects) gr.block(r.x0, r.y0, r.x1, r.y1);
    for (const p of ports) gr.block(p.x, p.y, p.x, p.y);
    return gr;
  };
  const shared = grid();
  for (const s of shaped) {
    out.set(s.id, s.pts);
    if (auto) shared.add(s.net, s.pts.map(toGrid));
  }
  // Each pin / barrel keeps the grid point just outside it for its own wire (other nets can't turn or cross there).
  for (const j of jobs) for (const e of [j.a, j.b]) shared.reserve(e.p.x + e.dir, e.p.y, j.net);
  // Route each bus together: shortest vertical span first (it takes the innermost lane), then top to bottom.
  const span = (j: Job) => Math.abs(j.a.p.y - j.b.p.y);
  jobs.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : span(p) - span(q) || p.a.p.y - q.a.p.y || p.b.p.y - q.b.p.y));
  for (const j of jobs) {
    const space = auto ? shared : grid();
    const near = { x0: Math.min(j.a.p.x, j.b.p.x) - MARGIN, y0: Math.min(j.a.p.y, j.b.p.y) - MARGIN, x1: Math.max(j.a.p.x, j.b.p.x) + MARGIN, y1: Math.max(j.a.p.y, j.b.p.y) + MARGIN };
    const path = routeOne(space, j.a, j.b, j.net, near) ?? routeOne(space, j.a, j.b, j.net, { x0: near.x0 - pad, y0: near.y0 - pad, x1: near.x1 + pad, y1: near.y1 + pad });
    // Boxed in completely: a plain route, so the wire still shows.
    const A = fromGrid(j.a.p);
    const B = fromGrid(j.b.p);
    const pts = path ? path.map(fromGrid) : orthoThrough(A, [{ x: A.x + j.a.dir * SCH_STUB, y: A.y }, { x: B.x + j.b.dir * SCH_STUB, y: B.y }], B);
    out.set(j.id, pts);
    if (auto) shared.add(j.net, pts.map(toGrid));
  }
  return out;
}

/**
 * Polyline from `a` through `via` to `b` with right-angle corners added wherever two points aren't in line: it leaves
 * `a` horizontally, alternates, and enters `b` horizontally when it can. Duplicate and in-line points are dropped.
 */
export function orthoThrough(a: Point, via: Point[], b: Point): Point[] {
  const P = [a, ...via, b];
  const out: Point[] = [a];
  let prevH = false;
  for (let i = 1; i < P.length; i++) {
    const q = P[i]!;
    const last = out[out.length - 1]!;
    if (last.x !== q.x && last.y !== q.y) {
      // First leg horizontal; last leg horizontal (vertical, then into the pin); otherwise alternate.
      const corner = i === 1 ? { x: q.x, y: last.y } : i === P.length - 1 || prevH ? { x: last.x, y: q.y } : { x: q.x, y: last.y };
      out.push(corner);
    }
    const l2 = out[out.length - 1]!;
    prevH = l2.y === q.y;
    out.push(q);
  }
  return simplifyPolyline(out);
}

/** Drop repeated points and points in line with their neighbours. */
export function simplifyPolyline(pts: Point[]): Point[] {
  const P = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1]!.x || p.y !== pts[i - 1]!.y);
  return P.filter((p, i) => {
    if (i === 0 || i === P.length - 1) return true;
    const a = P[i - 1]!;
    const b = P[i + 1]!;
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

/**
 * Drag one segment of a wire's drawn polyline perpendicular to itself by `delta` (grid units already applied). The pin
 * ends stay put: dragging the first or last segment adds a short jog at the pin instead. Returns the new corner points
 * (the wire's `schPath`).
 */
export function dragSegment(pts: Point[], index: number, delta: number, dirStart: 1 | -1 = 1, dirEnd: 1 | -1 = -1): Point[] {
  let P = pts.map((p) => ({ ...p }));
  let k = index;
  const horizontal = P[k]!.y === P[k + 1]!.y;
  // Keep the end points: split off a stub so only the inner part of an end segment moves.
  if (k === P.length - 2) {
    const e = P[P.length - 1]!;
    const stub = horizontal ? { x: e.x + dirEnd * SCH_STUB, y: e.y } : { x: e.x, y: e.y };
    P = [...P.slice(0, -1), stub, e];
  }
  if (k === 0) {
    const s = P[0]!;
    const stub = horizontal ? { x: s.x + dirStart * SCH_STUB, y: s.y } : { x: s.x, y: s.y };
    P = [s, stub, ...P.slice(1)];
    k = 1;
  }
  for (const i of [k, k + 1]) {
    if (i === 0 || i === P.length - 1) continue;
    if (horizontal) P[i]!.y += delta;
    else P[i]!.x += delta;
  }
  const full = orthoThrough(P[0]!, P.slice(1, -1), P[P.length - 1]!);
  return full.slice(1, -1);
}


/**
 * Rubber-band a shaped wire when the part at one or both of its ends is dragged by `d` (KiCad "drag"): the segment
 * attached to the moved end travels with it and the next corner slides along its own axis, so jogs shift over and
 * bunch up instead of new detours appearing. Returns the new corner points (the wire's `schPath`).
 */
export function dragEnds(pts: Point[], dStart: Point | null, dEnd: Point | null): Point[] {
  if (dStart && dEnd && dStart.x === dEnd.x && dStart.y === dEnd.y) return pts.slice(1, -1).map((p) => ({ x: p.x + dStart.x, y: p.y + dStart.y }));
  const pull = (Q: Point[], d: Point) => {
    // Q[0] is the moved end; Q[1] ends the attached segment; Q[2] ends the next one.
    const vertical12 = Q.length > 2 && Q[1]!.x === Q[2]!.x;
    Q[0] = { x: Q[0]!.x + d.x, y: Q[0]!.y + d.y };
    if (Q.length > 2) Q[1] = { x: Q[1]!.x + d.x, y: Q[1]!.y + d.y };
    if (Q.length > 3) Q[2] = vertical12 ? { x: Q[2]!.x + d.x, y: Q[2]!.y } : { x: Q[2]!.x, y: Q[2]!.y + d.y };
    return Q;
  };
  let P = pts.map((p) => ({ ...p }));
  if (dStart) P = pull(P, dStart);
  if (dEnd) P = pull(P.reverse(), dEnd).reverse();
  return orthoThrough(P[0]!, P.slice(1, -1), P[P.length - 1]!).slice(1, -1);
}
