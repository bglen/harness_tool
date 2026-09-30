import type { Harness, Point, Wire, WireEnd } from "@hs/model";
import { nodePos, type ConnLayout } from "./geometry";

/**
 * Schematic wire routing: every wire is drawn pin-to-pin with right-angle runs, ignoring the physical bundles.
 *
 * Each wire leaves its pin row horizontally (away from the card), turns once in a vertical "channel" and enters the
 * far pin row horizontally. Wires between the same two ends share a block of parallel lanes, ordered so a bus
 * doesn't cross itself; blocks are nudged sideways until they don't overlap other blocks that span the same heights.
 */

/** Spacing between parallel vertical runs. */
export const SCH_LANE = 6;
/** Minimum horizontal run out of a pin before the first turn. */
export const SCH_STUB = 16;
/** Splice diamond offset from its host node (matches the bundle layout's splice marker). */
export const SPLICE_OFFSET = 16;

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
  return { x: p.x + SPLICE_OFFSET, y: p.y + SPLICE_OFFSET };
}

type RawEnd = Omit<End, "dir"> & { dir: 1 | -1 | 0 };

function pinEnd(e: WireEnd, layouts: Map<string, ConnLayout>): RawEnd | null {
  if (e.kind !== "pin") return null;
  const L = layouts.get(e.connectorId);
  if (!L) return null;
  const r = L.rowByCavity.get(e.cavityId);
  return { p: { x: L.attachX, y: r ? r.y : L.card.y + L.card.h / 2 }, dir: L.facing, box: { y: L.card.y, h: L.card.h }, key: e.connectorId, stub: SCH_STUB };
}

function endOf(h: Harness, e: WireEnd, layouts: Map<string, ConnLayout>): RawEnd | null {
  if (e.kind === "pin") return pinEnd(e, layouts);
  const p = splicePoint(h, e.spliceId);
  // A splice has no side: it faces whichever way the other end is (resolved by the caller).
  return p ? { p, dir: 0, box: null, key: `s:${e.spliceId}`, stub: 0 } : null;
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

/** Orthogonal pin-to-pin polyline for every wire, keyed by wire id, running from `wire.from` to `wire.to`. */
export function schematicRoutes(h: Harness, layouts: Map<string, ConnLayout>): Map<string, Point[]> {
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
      const lo = Math.max(...rs.map((r) => r.a.p.x + r.a.stub));
      const hi = Math.min(...rs.map((r) => r.b.p.x - r.b.stub));
      const ordered = orderLanes(rs, "facing", 1);
      // Snap the block centre to the lane grid so neighbouring blocks line up.
      const start = Math.round(((lo + hi) / 2 - width / 2) / SCH_LANE) * SCH_LANE;
      const block: Block = { ids: ordered.map((r) => r.w.id), y0, y1, start, lo, hi: Math.max(hi, lo + width), grow: 0, x: 0 };
      blocks.push(block);
      blockOf.push({ block, reqs: ordered });
    } else if (kind === "same") {
      const d = a0.dir;
      const ordered = orderLanes(rs, "same", d);
      const edge = d === 1 ? Math.max(...rs.flatMap((r) => [r.a.p.x + r.a.stub, r.b.p.x + r.b.stub])) : Math.min(...rs.flatMap((r) => [r.a.p.x - r.a.stub, r.b.p.x - r.b.stub]));
      const start = d === 1 ? edge : edge - width;
      const block: Block = { ids: ordered.map((r) => r.w.id), y0, y1, start, lo: d === 1 ? edge : -Infinity, hi: d === 1 ? Infinity : edge, grow: d, x: 0 };
      blocks.push(block);
      blockOf.push({ block, reqs: ordered });
    } else {
      // "away": out of a to the right, down below both cards, across, and into b from its left.
      const ordered = [...rs].sort((r1, r2) => r1.a.p.y - r2.a.p.y);
      const bottom = Math.max(...rs.flatMap((r) => [r.a.box ? r.a.box.y + r.a.box.h : r.a.p.y, r.b.box ? r.b.box.y + r.b.box.h : r.b.p.y]));
      // The top wire wraps outermost (right-most on a's side, lowest run, left-most on b's side) so the bus doesn't cross itself.
      ordered.forEach((r, i) => awayY.set(r.w.id, bottom + 14 + (n - 1 - i) * SCH_LANE));
      const ax = Math.max(...rs.map((r) => r.a.p.x + r.a.stub));
      const bx = Math.min(...rs.map((r) => r.b.p.x - r.b.stub));
      const yBot = bottom + 14 + width;
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
