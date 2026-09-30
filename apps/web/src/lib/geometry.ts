import type { CatalogIndex, ConnectorInstance, Derived, Harness, Point } from "@hs/model";

export const ROW_H = 20;
export const HEADER_H = 46;
export const CARD_W = 236;
export const CARD_W_DETAIL = 340;
export const FAN = 72;
/** Card-to-bundle gap on the bundle layout, where connectors are drawn as compact blocks without pin rows. */
export const FAN_COMPACT = 26;
export const COMPACT_W = 168;
export const COMPACT_H = 44;
export const GLYPH_W = 70;
export const GLYPH_H = 40;
/** Extra glyph length when a backshell is fitted (drawn behind the connector body, toward the card). */
export const BACKSHELL_W = 14;
export const LANE = 2.4;
export const COLLAPSE_OVER = 26;

export type ZoomLevel = "overview" | "harness" | "detail";

export function zoomLevel(k: number): ZoomLevel {
  return k < 0.4 ? "overview" : k <= 1.2 ? "harness" : "detail";
}

export interface RowLayout {
  cavityId: string;
  y: number;
  top: number;
  netId: string | null;
  size: string;
  special: boolean;
}

export interface ConnLayout {
  id: string;
  facing: 1 | -1;
  anchor: Point;
  card: { x: number; y: number; w: number; h: number };
  glyph: { x: number; y: number; w: number; h: number };
  attachX: number;
  rows: RowLayout[];
  rowByCavity: Map<string, RowLayout>;
  collapsed: { y: number; count: number } | null;
  /** Drawn as a compact block (no pin rows): the overview zoom level, or the bundle layout. */
  compact: boolean;
  total: number;
  used: number;
}

export function facingOf(c: ConnectorInstance): 1 | -1 {
  const r = ((c.rotation % 360) + 360) % 360;
  return r > 90 && r < 270 ? -1 : 1;
}

/** Card geometry for a connector. `compact` (bundle layout) drops the pin rows and pulls the card close to the bundle end. */
export function layoutConnector(c: ConnectorInstance, cat: CatalogIndex, level: ZoomLevel, compactMode = false): ConnLayout {
  const compact = compactMode || level === "overview";
  const facing = facingOf(c);
  const part = cat.connector(c.pn);
  const cavs = part?.arrangement.cavities ?? Object.keys(c.pins).map((id) => ({ id, x: 0, y: 0, size: "?", special: false }));
  const usedSet = new Set(Object.entries(c.pins).filter(([, p]) => p.netId).map(([k]) => k));
  const showAll = c.showUnused || cavs.length <= COLLAPSE_OVER;
  const visible = compact ? [] : showAll ? cavs : cavs.filter((x) => usedSet.has(x.id) || c.pins[x.id]?.filler);
  const hidden = compact ? 0 : cavs.length - visible.length;
  const rowsH = compact ? 0 : visible.length * ROW_H + (hidden ? ROW_H : 0);
  const h = level === "overview" ? 34 : compact ? COMPACT_H : HEADER_H + rowsH + 4;
  const w = level === "overview" ? 120 : compact ? COMPACT_W : level === "detail" ? CARD_W_DETAIL : CARD_W;
  const fan = compactMode ? FAN_COMPACT : FAN;
  const anchor = c.position;
  const cardX = facing === 1 ? anchor.x - fan - w : anchor.x + fan;
  const cardY = anchor.y - h / 2;
  const glyphW = c.backshell && cat.backshell(c.backshell.pn) ? GLYPH_W + BACKSHELL_W : GLYPH_W;
  const glyphX = facing === 1 ? cardX - glyphW - 10 : cardX + w + 10;
  const rows: RowLayout[] = visible.map((cv, i) => ({ cavityId: cv.id, top: cardY + HEADER_H + i * ROW_H, y: cardY + HEADER_H + i * ROW_H + ROW_H / 2, netId: c.pins[cv.id]?.netId ?? null, size: cv.size, special: !!(cv as { special?: boolean }).special }));
  return {
    id: c.id,
    facing,
    anchor,
    card: { x: cardX, y: cardY, w, h },
    glyph: { x: glyphX, y: anchor.y - GLYPH_H / 2, w: glyphW, h: GLYPH_H },
    attachX: facing === 1 ? cardX + w : cardX,
    rows,
    rowByCavity: new Map(rows.map((r) => [r.cavityId, r])),
    compact,
    collapsed: hidden ? { y: cardY + HEADER_H + visible.length * ROW_H + ROW_H / 2, count: hidden } : null,
    total: cavs.length,
    used: usedSet.size,
  };
}

export function nodePos(h: Harness, nodeId: string): Point {
  const n = h.nodes.find((x) => x.id === nodeId);
  if (!n) return { x: 0, y: 0 };
  if (n.kind === "connector") return h.connectors.find((c) => c.id === n.connectorId)?.position ?? n.position;
  return n.position;
}

export function bundleWidth(n: number, level: ZoomLevel): number {
  const base = 5 + 4.5 * Math.log2(1 + n);
  return level === "detail" ? Math.max(base, n * LANE + 4) : base;
}

/** Lane index of each wire within each segment (stable ordering by wire label). */
export function laneMap(h: Harness, d: Derived): Map<string, Map<string, number>> {
  const byLabel = new Map(h.wires.map((w) => [w.id, w.label]));
  const out = new Map<string, Map<string, number>>();
  for (const [sid, wids] of d.segWires) {
    const sorted = [...wids].sort((a, b) => (byLabel.get(a) ?? "").localeCompare(byLabel.get(b) ?? "", "en", { numeric: true }));
    out.set(sid, new Map(sorted.map((id, i) => [id, i - (sorted.length - 1) / 2])));
  }
  return out;
}

function normal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: -dy / l, y: dx / l };
}

export function segPoints(h: Harness, segId: string): [Point, Point] {
  const s = h.segments.find((x) => x.id === segId)!;
  return [nodePos(h, s.a), nodePos(h, s.b)];
}

/** Polyline for a wire through the bundle with lane offsets (without the fan-out to pins). */
export function wireTrunk(h: Harness, d: Derived, lanes: Map<string, Map<string, number>>, wireId: string, gap: number): Point[] {
  const nodes = d.nodePaths.get(wireId);
  const segs = d.routes.get(wireId);
  if (!nodes || !segs) return [];
  const pts: Point[] = [];
  const offsetOf = (si: number) => {
    const s = h.segments.find((x) => x.id === segs[si])!;
    const [a, b] = [nodePos(h, s.a), nodePos(h, s.b)];
    const n = normal(a, b);
    const lane = lanes.get(s.id)?.get(wireId) ?? 0;
    return { x: n.x * lane * gap, y: n.y * lane * gap };
  };
  for (let i = 0; i < nodes.length; i++) {
    const p = nodePos(h, nodes[i]!);
    if (!segs.length) {
      pts.push(p);
      continue;
    }
    if (i === 0) {
      const o = offsetOf(0);
      pts.push({ x: p.x + o.x, y: p.y + o.y });
    } else if (i === nodes.length - 1) {
      const o = offsetOf(segs.length - 1);
      pts.push({ x: p.x + o.x, y: p.y + o.y });
    } else {
      const o1 = offsetOf(i - 1);
      const o2 = offsetOf(i);
      pts.push({ x: p.x + (o1.x + o2.x) / 2, y: p.y + (o1.y + o2.y) / 2 });
    }
  }
  return pts;
}

/** SVG path for a wire: fan from pin row → bundle trunk → fan into far pin row. */
export function wirePath(start: { p: Point; dir: number } | null, trunk: Point[], end: { p: Point; dir: number } | null): string {
  if (!trunk.length) return "";
  let d = "";
  const t0 = trunk[0]!;
  const tn = trunk[trunk.length - 1]!;
  if (start) {
    const c = FAN * 0.55;
    d += `M${start.p.x},${start.p.y} C${start.p.x + start.dir * c},${start.p.y} ${t0.x - start.dir * c * 0.4},${t0.y} ${t0.x},${t0.y}`;
  } else d += `M${t0.x},${t0.y}`;
  for (let i = 1; i < trunk.length; i++) d += ` L${trunk[i]!.x},${trunk[i]!.y}`;
  if (end) {
    const c = FAN * 0.55;
    d += ` C${tn.x - end.dir * c * 0.4},${tn.y} ${end.p.x + end.dir * c},${end.p.y} ${end.p.x},${end.p.y}`;
  }
  return d;
}

export function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Point along a segment at a distance (mm) from node A, mapped to canvas coordinates by fraction. */
export function pointOnSegment(h: Harness, segId: string, mmFromA: number): Point {
  const s = h.segments.find((x) => x.id === segId)!;
  const [a, b] = segPoints(h, segId);
  const t = Math.max(0, Math.min(1, mmFromA / s.lengthMm));
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Project a point onto a segment → fraction 0..1. */
export function projectOnSegment(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  return Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
}

export function bounds(h: Harness, cat: CatalogIndex, level: ZoomLevel, compact = false) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const c of h.connectors) {
    const L = layoutConnector(c, cat, level, compact);
    add(Math.min(L.card.x, L.glyph.x), L.card.y - 20);
    add(Math.max(L.card.x + L.card.w, L.glyph.x + L.glyph.w), L.card.y + L.card.h);
  }
  for (const n of h.nodes) add(n.position.x, n.position.y);
  for (const n of h.notes) add(n.position.x, n.position.y), add(n.position.x + 160, n.position.y + 40);
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
