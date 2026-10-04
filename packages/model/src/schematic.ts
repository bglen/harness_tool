import type { Harness, Point, Wire, WireEnd } from "./schema";

/** What the router needs from a pin card: which side wires attach on, and where each pin row is. */
export interface SchematicCard {
  facing: 1 | -1;
  attachX: number;
  card: { y: number; h: number };
  rowByCavity: Map<string, { y: number }>;
}

function nodePos(h: Harness, nodeId: string): Point {
  const n = h.nodes.find((x) => x.id === nodeId);
  if (!n) return { x: 0, y: 0 };
  if (n.kind === "connector") return h.connectors.find((c) => c.id === n.connectorId)?.position ?? n.position;
  return n.position;
}

/**
 * Schematic wire routing: every wire is drawn pin-to-pin with right-angle runs, ignoring the physical bundles.
 *
 * Each wire leaves its pin row horizontally (away from the card), turns once in a vertical "channel" and enters the
 * far pin row horizontally. Wires between the same two ends share a block of parallel lanes, ordered so a bus
 * doesn't cross itself; blocks are nudged sideways until they don't overlap other blocks that span the same heights.
 */

/** Schematic grid pitch (the canvas dot grid and the pin-row pitch). Connector anchors, pin attach points, splice points and every wire run sit on it. */
export const SCH_GRID = 20;
/** Spacing between parallel vertical runs (one grid step). */
export const SCH_LANE = SCH_GRID;
/** Minimum horizontal run out of a pin before the first turn. */
export const SCH_STUB = SCH_GRID;
/** Splice diamond offset from its host node (matches the bundle layout's splice marker). */
export const SPLICE_OFFSET = 16;

/** Nearest schematic grid line. */
export const snapToGrid = (v: number) => Math.round(v / SCH_GRID) * SCH_GRID;
const gridCeil = (v: number) => Math.ceil(v / SCH_GRID - 1e-9) * SCH_GRID;
const gridFloor = (v: number) => Math.floor(v / SCH_GRID + 1e-9) * SCH_GRID;

/**
 * Top edge of a pin card of height `h` centred (as near as the grid allows) on `anchorY`, placed so every pin row
 * centre (`top + headerH + i * rowH + rowH / 2`) lands on a grid line. `rowH` must be a multiple of the grid.
 */
export function gridCardTop(anchorY: number, h: number, headerH: number, rowH: number): number {
  const first = headerH + rowH / 2;
  return snapToGrid(anchorY - h / 2 + first) - first;
}

interface End {
  p: Point;
  /** Direction the wire leaves in: +1 right, -1 left. */
  dir: 1 | -1;
  /** Card to keep clear of (pin ends only). */
  box: { y: number; h: number } | null;
  key: string;
  stub: number;
}

type Case = "straight" | "facing" | "same" | "away";

interface Req {
  w: Wire;
  a: End;
  b: End;
  /** a/b were swapped from from/to (the result polyline is reversed back). */
  swapped: boolean;
  kind: Case;
}

interface Block {
  ids: string[];
  y0: number;
  y1: number;
  /** Allowed range for the first lane (left-most x); `grow` says which way to search from `start`. */
  start: number;
  lo: number;
  hi: number;
  grow: 0 | 1 | -1;
  x: number;
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

type RawEnd = Omit<End, "dir"> & { dir: 1 | -1 | 0 };

function pinEnd(e: WireEnd, layouts: Map<string, SchematicCard>): RawEnd | null {
  if (e.kind !== "pin") return null;
  const L = layouts.get(e.connectorId);
  if (!L) return null;
  const r = L.rowByCavity.get(e.cavityId);
  return { p: { x: L.attachX, y: r ? r.y : L.card.y + L.card.h / 2 }, dir: L.facing, box: { y: L.card.y, h: L.card.h }, key: e.connectorId, stub: SCH_STUB };
}

function endOf(h: Harness, e: WireEnd, layouts: Map<string, SchematicCard>): RawEnd | null {
  if (e.kind === "pin") return pinEnd(e, layouts);
  const s = h.splices.find((x) => x.id === e.spliceId);
  if (!s) return null;
  // Each barrel is a port on the splice symbol with its own side.
  const g = spliceGeometry(h, s, layouts);
  const port = g.ports.find((x) => x.barrel === Math.min(e.barrel ?? 0, s.barrels - 1)) ?? g.ports[0]!;
  return { p: port.p, dir: port.dir, box: { y: g.box.y, h: g.box.h }, key: `s:${s.id}:${port.barrel}`, stub: SCH_STUB };
}

/** Left-to-right order of lanes in a block so the wires don't cross each other where they can avoid it. */
function orderLanes(reqs: Req[], kind: Case, dir: 1 | -1): Req[] {
  if (kind === "same") {
    // Nested "C" shapes: the shortest span turns closest to the cards.
    const s = [...reqs].sort((r1, r2) => Math.abs(r1.a.p.y - r1.b.p.y) - Math.abs(r2.a.p.y - r2.b.p.y));
    return dir === 1 ? s : s.reverse();
  }
  // Facing (a on the left): wires heading up turn early from the top down, wires heading down turn late from the top down.
  const up = reqs.filter((r) => r.b.p.y < r.a.p.y).sort((r1, r2) => r1.a.p.y - r2.a.p.y);
  const down = reqs.filter((r) => r.b.p.y >= r.a.p.y).sort((r1, r2) => r2.a.p.y - r1.a.p.y);
  return [...up, ...down];
}

function overlaps(b: Block, x: number, placed: Block[]): boolean {
  const x1 = x + (b.ids.length - 1) * SCH_LANE;
  for (const o of placed) {
    if (o.y1 + 2 < b.y0 || b.y1 + 2 < o.y0) continue;
    const ox1 = o.x + (o.ids.length - 1) * SCH_LANE;
    if (x1 + SCH_LANE <= o.x || ox1 + SCH_LANE <= x) continue;
    return true;
  }
  return false;
}

function place(b: Block, placed: Block[]): number {
  const width = (b.ids.length - 1) * SCH_LANE;
  const ok = (x: number) => x >= b.lo - 0.01 && x + width <= b.hi + 0.01;
  for (let k = 0; k < 160; k++) {
    const steps = b.grow === 0 ? [k, -k] : [b.grow * k];
    for (const s of steps) {
      const x = b.start + s * SCH_LANE;
      if (!ok(x)) continue;
      if (!overlaps(b, x, placed)) return x;
    }
  }
  return Math.min(Math.max(b.start, b.lo), b.hi - width);
}

/** Automatic lanes for a set of wires (see the file comment). */
function autoRoutes(h: Harness, layouts: Map<string, SchematicCard>): Map<string, Point[]> {
  const reqs: Req[] = [];
  const out = new Map<string, Point[]>();
  for (const w of h.wires) {
    const ea = endOf(h, w.from, layouts);
    const eb = endOf(h, w.to, layouts);
    if (!ea || !eb) continue;
    const toward = (e: RawEnd, o: RawEnd): 1 | -1 => (e.dir !== 0 ? e.dir : o.p.x >= e.p.x ? 1 : -1);
    let a: End = { ...ea, dir: toward(ea, eb) };
    let b: End = { ...eb, dir: toward(eb, ea) };
    // Normalize: `a` is the end leaving to the right when the ends face opposite ways (or the left end when they face the same way).
    let swapped = false;
    if ((a.dir !== b.dir && a.dir === -1) || (a.dir === b.dir && b.p.x < a.p.x)) {
      [a, b] = [b, a];
      swapped = true;
    }
    let kind: Case;
    if (a.dir === b.dir) kind = "same";
    else if (a.p.x + a.stub <= b.p.x - b.stub) kind = Math.abs(a.p.y - b.p.y) < 0.5 ? "straight" : "facing";
    else kind = "away";
    reqs.push({ w, a, b, swapped, kind });
  }

  // Group wires between the same two ends into blocks of parallel lanes.
  const groups = new Map<string, Req[]>();
  for (const r of reqs) {
    if (r.kind === "straight") continue;
    const k = `${r.kind}|${r.a.key}|${r.b.key}|${r.a.dir}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

  const blocks: Block[] = [];
  const laneX = new Map<string, number>();
  const laneX2 = new Map<string, number>();
  const awayY = new Map<string, number>();
  const blockOf: { block: Block; reqs: Req[]; second?: boolean }[] = [];
  for (const rs of groups.values()) {
    const { kind, a: a0 } = rs[0]!;
    const ys = rs.flatMap((r) => [r.a.p.y, r.b.p.y]);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const n = rs.length;
    const width = (n - 1) * SCH_LANE;
    if (kind === "facing") {
      const lo = gridCeil(Math.max(...rs.map((r) => r.a.p.x + r.a.stub)));
      const hi = gridFloor(Math.min(...rs.map((r) => r.b.p.x - r.b.stub)));
      const ordered = orderLanes(rs, "facing", 1);
      // Snap the block centre to the grid so neighbouring blocks line up.
      const start = snapToGrid((lo + hi) / 2 - width / 2);
      const block: Block = { ids: ordered.map((r) => r.w.id), y0, y1, start, lo, hi: Math.max(hi, lo + width), grow: 0, x: 0 };
      blocks.push(block);
      blockOf.push({ block, reqs: ordered });
    } else if (kind === "same") {
      const d = a0.dir;
      const ordered = orderLanes(rs, "same", d);
      const edge = d === 1 ? gridCeil(Math.max(...rs.flatMap((r) => [r.a.p.x + r.a.stub, r.b.p.x + r.b.stub]))) : gridFloor(Math.min(...rs.flatMap((r) => [r.a.p.x - r.a.stub, r.b.p.x - r.b.stub])));
      const start = d === 1 ? edge : edge - width;
      const block: Block = { ids: ordered.map((r) => r.w.id), y0, y1, start, lo: d === 1 ? edge : -Infinity, hi: d === 1 ? Infinity : edge, grow: d, x: 0 };
      blocks.push(block);
      blockOf.push({ block, reqs: ordered });
    } else {
      // "away": out of a to the right, down below both cards, across, and into b from its left.
      const ordered = [...rs].sort((r1, r2) => r1.a.p.y - r2.a.p.y);
      const bottom = Math.max(...rs.flatMap((r) => [r.a.box ? r.a.box.y + r.a.box.h : r.a.p.y, r.b.box ? r.b.box.y + r.b.box.h : r.b.p.y]));
      // The top wire wraps outermost (right-most on a's side, lowest run, left-most on b's side) so the bus doesn't cross itself.
      const yTop = gridCeil(bottom + SCH_GRID / 2);
      ordered.forEach((r, i) => awayY.set(r.w.id, yTop + (n - 1 - i) * SCH_LANE));
      const ax = gridCeil(Math.max(...rs.map((r) => r.a.p.x + r.a.stub)));
      const bx = gridFloor(Math.min(...rs.map((r) => r.b.p.x - r.b.stub)));
      const yBot = yTop + width;
      const ba: Block = { ids: [...ordered].reverse().map((r) => r.w.id), y0: Math.min(...rs.map((r) => r.a.p.y)), y1: yBot, start: ax, lo: ax, hi: Infinity, grow: 1, x: 0 };
      const bb: Block = { ids: ordered.map((r) => r.w.id), y0: Math.min(...rs.map((r) => r.b.p.y)), y1: yBot, start: bx - width, lo: -Infinity, hi: bx, grow: -1, x: 0 };
      blocks.push(ba, bb);
      blockOf.push({ block: ba, reqs: [...ordered].reverse() }, { block: bb, reqs: ordered, second: true });
    }
  }

  // Biggest buses first so they keep their preferred channel; smaller groups move aside.
  const placed: Block[] = [];
  for (const b of [...blocks].sort((p, q) => q.ids.length - p.ids.length || q.y1 - q.y0 - (p.y1 - p.y0))) {
    b.x = place(b, placed);
    placed.push(b);
  }
  for (const { block, reqs: rs, second } of blockOf) rs.forEach((r, i) => (second ? laneX2 : laneX).set(r.w.id, block.x + i * SCH_LANE));

  for (const r of reqs) {
    const { a, b } = r;
    let pts: Point[];
    if (r.kind === "straight") pts = [a.p, b.p];
    else if (r.kind === "away") {
      const x1 = laneX.get(r.w.id)!;
      const x2 = laneX2.get(r.w.id)!;
      const ym = awayY.get(r.w.id)!;
      pts = [a.p, { x: x1, y: a.p.y }, { x: x1, y: ym }, { x: x2, y: ym }, { x: x2, y: b.p.y }, b.p];
    } else {
      const x = laneX.get(r.w.id)!;
      pts = [a.p, { x, y: a.p.y }, { x, y: b.p.y }, b.p];
    }
    out.set(r.w.id, r.swapped ? pts.reverse() : pts);
  }
  return out;
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

/**
 * Orthogonal pin-to-pin polyline for every wire, keyed by wire id, running from `wire.from` to `wire.to`.
 * Wires with a path of their own (dragged by the user) run through it, kept orthogonal as their ends move; the rest
 * get automatic lanes (`auto`, the default) or, with auto-routing off, a plain route each that ignores the others.
 */
export function schematicRoutes(h: Harness, layouts: Map<string, SchematicCard>, opts: { auto?: boolean } = {}): Map<string, Point[]> {
  const manual = h.wires.filter((w) => w.schPath?.length);
  const rest = h.wires.filter((w) => !w.schPath?.length);
  const out = new Map<string, Point[]>();
  if (opts.auto ?? true) for (const [k, v] of autoRoutes({ ...h, wires: rest }, layouts)) out.set(k, v);
  else for (const w of rest) for (const [k, v] of autoRoutes({ ...h, wires: [w] }, layouts)) out.set(k, v);
  for (const w of manual) {
    const a = endOf(h, w.from, layouts);
    const b = endOf(h, w.to, layouts);
    if (a && b) out.set(w.id, orthoThrough(a.p, w.schPath!, b.p));
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
