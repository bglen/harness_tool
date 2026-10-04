import { gridCardTop, SCH_GRID, snapToGrid, type CatalogIndex, type ConnectorInstance, type Derived, type Harness, type Label, type Point } from "@hs/model";
import { bendOf, bendReach, cableExit } from "../canvas/BackshellGlyph";

/** Pin row pitch: one schematic grid step, so every pin row sits on a grid line. */
export const ROW_H = SCH_GRID;
export const HEADER_H = 46;
export const CARD_W = 236;
export const CARD_W_DETAIL = 340;
/** Anchor-to-card gap; a whole number of grid steps so the pin attach edge sits on a grid line. */
export const FAN = 4 * SCH_GRID;
export const COMPACT_W = 168;
/** Header space kept clear on the right of a schematic card for the insert face thumbnail (and the UNREVIEWED tag). */
export const HEADER_RIGHT = 46;
export const HEADER_RIGHT_UNREVIEWED = 114;

let measureCtx: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();
/**
 * Rendered width of canvas text in the app's UI (or mono) font. Measured with a 2D canvas once fonts are loaded;
 * before that (or without a DOM) it falls back to an average glyph width.
 */
export function textWidth(text: string, size: number, weight = 400, mono = false): number {
  const key = `${weight}|${size}|${mono ? 1 : 0}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  const estimate = text.length * size * (mono ? 0.62 : weight >= 600 ? 0.64 : 0.56);
  if (typeof document === "undefined") return estimate;
  if (measureCtx === undefined) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return estimate;
  const family = getComputedStyle(document.documentElement).getPropertyValue(mono ? "--font-mono" : "--font-ui").trim() || (mono ? "monospace" : "sans-serif");
  measureCtx.font = `${weight} ${size}px ${family}`;
  const w = measureCtx.measureText(text).width;
  // Only cache once web fonts are in, so early measurements against a fallback font don't stick.
  if (document.fonts?.status === "loaded") widthCache.set(key, w);
  return w;
}
export const COMPACT_H = 44;
export const GLYPH_W = 70;
export const GLYPH_H = 40;
/** Extra glyph length when a backshell is fitted (drawn behind the connector body, toward the card). */
export const BACKSHELL_W = 14;
/** Schematic: the glyph drawn inside the pin card, enlarged, in a column on the mating side. */
export const GLYPH_SCALE = 1.35;
/** Local-frame extent of the connector body alone, and with a backshell (nut + tail behind the rear face). */
export const GLYPH_LOCAL_W = 50;
export const GLYPH_LOCAL_W_BS = 84;
export const GLYPH_PAD = 12;
/** Bundle layout: length of the straight lead between a connector's cable exit and the start of its bundle. */
export const LEAD = 24;
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
  /** The header and pin-list part of the card (the whole card when the glyph is drawn outside it). */
  body: { x: number; w: number };
  /** Connector side-view drawing, in canvas units; `s` scales the glyph's local frame (GLYPH_H tall). */
  glyph: { x: number; y: number; w: number; h: number; s: number };
  /** Bundle layout: the straight lead from the connector's cable exit to its bundle end (the node). */
  lead: { from: Point; to: Point } | null;
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
  const bs = c.backshell ? cat.backshell(c.backshell.pn) : undefined;
  // Cards grow to fit a long reference designator / part number rather than letting the header overflow.
  const kind = part ? (part.flyingLead ? "flying leads" : part.kind === "plug" ? "plug" : "receptacle") : "unknown part";
  const pinsText = `${usedSet.size}/${cavs.length} pins`;
  const pnRow = (pnSize: number) => textWidth(c.pn, pnSize, 400, true) + textWidth(` · ${kind}`, pnSize - 0.5);
  const unreviewed = !!part && part.arrangement.status !== "verified";
  const contentW =
    level === "overview"
      ? 10 + textWidth(c.refDes, 15, 600) + 12 + textWidth(pinsText, 12) + 10
      : compact
        ? Math.max(10 + textWidth(c.refDes, 14, 600) + 12 + textWidth(pinsText, 10.5) + 10, 10 + pnRow(10) + 10)
        : Math.max(10 + textWidth(c.refDes, 14, 600) + 8 + (unreviewed ? HEADER_RIGHT_UNREVIEWED : HEADER_RIGHT), 10 + pnRow(10.5) + HEADER_RIGHT);
  // Flying-lead cards carry a lead-end finish column at the right.
  const finishCol = part?.flyingLead && !compact ? 48 : 0;
  const bodyW = Math.ceil(Math.max((level === "overview" ? 120 : compact ? COMPACT_W : level === "detail" ? CARD_W_DETAIL : CARD_W) + finishCol, contentW));
  const fan = FAN;
  // Schematic pin cards sit on the grid (anchor, attach edge and every pin row), whatever the stored position.
  const anchor = compact ? c.position : { x: snapToGrid(c.position.x), y: snapToGrid(c.position.y) };
  let h: number, w: number, cardX: number, cardY: number, body: ConnLayout["body"], glyph: ConnLayout["glyph"];
  let lead: ConnLayout["lead"] = null;
  if (compactMode) {
    // Bundle layout: the cable leaves the drawing (backshell tail, or the connector's rear face) through a short straight
    // lead along its exit direction, and the bundle starts at the lead's end, the connector's node, whatever angle it
    // runs off at. The name block sits on the mating side, away from the cable.
    h = level === "overview" ? 34 : COMPACT_H;
    w = bodyW;
    const gw = bs ? GLYPH_LOCAL_W_BS : GLYPH_LOCAL_W;
    const exit = cableExit(bs, c.backshell, GLYPH_H);
    const from = { x: anchor.x - facing * exit.dx * LEAD, y: anchor.y - exit.dy * LEAD };
    lead = { from, to: anchor };
    const gx = facing === 1 ? from.x - exit.x : from.x + exit.x - gw;
    const gy = from.y - exit.y;
    glyph = { x: gx, y: gy, w: gw, h: GLYPH_H, s: 1 };
    cardX = facing === 1 ? gx - 10 - w : gx + gw + 10;
    cardY = gy + GLYPH_H / 2 - h / 2;
    body = { x: cardX, w };
  } else if (compact) {
    // Schematic overview: the glyph sits outside the block, at the connector's end.
    h = level === "overview" ? 34 : COMPACT_H;
    w = bodyW;
    cardX = facing === 1 ? anchor.x - fan - w : anchor.x + fan;
    cardY = anchor.y - h / 2;
    body = { x: cardX, w };
    const gw = bs ? GLYPH_W + BACKSHELL_W : GLYPH_W;
    glyph = { x: facing === 1 ? cardX - gw - 10 : cardX + w + 10, y: anchor.y - GLYPH_H / 2, w: gw, h: GLYPH_H, s: 1 };
  } else {
    // Schematic: the connector (and backshell) drawing sits inside the card, in a column on the mating side of the pin list.
    const s = GLYPH_SCALE;
    const gw = (bs ? GLYPH_LOCAL_W_BS : GLYPH_LOCAL_W) * s;
    const gh = GLYPH_H * s;
    const bend = bs?.angle && c.backshell ? bendOf(c.backshell.clockingDeg) : null;
    const reach = bs && (bend === "up" || bend === "down") ? bendReach(bs.angle, GLYPH_H) * s : 0;
    const labelH = bs ? 16 : 0;
    const block = gh + reach + labelH;
    const col = gw + 2 * GLYPH_PAD;
    h = Math.max(HEADER_H + rowsH + 4, block + 2 * GLYPH_PAD);
    w = bodyW + col;
    cardX = facing === 1 ? anchor.x - fan - w : anchor.x + fan;
    cardY = gridCardTop(anchor.y, h, HEADER_H, ROW_H);
    body = { x: facing === 1 ? cardX + col : cardX, w: bodyW };
    const top = cardY + (h - block) / 2 + (bend === "up" ? reach : 0);
    glyph = { x: facing === 1 ? cardX + GLYPH_PAD : cardX + bodyW + GLYPH_PAD, y: top, w: gw, h: gh, s };
  }
  const rows: RowLayout[] = visible.map((cv, i) => ({ cavityId: cv.id, top: cardY + HEADER_H + i * ROW_H, y: cardY + HEADER_H + i * ROW_H + ROW_H / 2, netId: c.pins[cv.id]?.netId ?? null, size: cv.size, special: !!(cv as { special?: boolean }).special }));
  return {
    id: c.id,
    facing,
    anchor,
    card: { x: cardX, y: cardY, w, h },
    body,
    glyph,
    lead,
    attachX: compactMode ? anchor.x : facing === 1 ? cardX + w : cardX,
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

/** Where a card draws the connector's reference designator (canvas units): double-clicking it edits the name in place. */
export function refDesBox(L: ConnLayout, level: ZoomLevel, refDes: string): { x: number; y: number; w: number; h: number; fontSize: number } {
  const overview = L.compact && level === "overview";
  const x = (L.compact ? L.card.x : L.body.x) + 10;
  const baseline = L.card.y + (overview ? 21 : L.compact ? 18 : 19);
  const fontSize = overview ? 15 : 14;
  return { x: x - 4, y: baseline - fontSize - 1, w: Math.max(40, textWidth(refDes, fontSize, 600)) + 8, h: fontSize + 6, fontSize };
}

/**
 * The bundle stretch a label sits on (bundle layout): from `a` (the end its distance is measured from) toward `b`,
 * the real length of that bundle, and how far along it (as a fraction) the label may sit. Null if it isn't drawn.
 */
export function labelTrack(h: Harness, l: Label): { a: Point; b: Point; lengthMm: number; maxFrac: number } | null {
  const t = l.attachedTo;
  if (t.kind === "connector") {
    const c = h.connectors.find((x) => x.id === t.id);
    const node = h.nodes.find((n) => n.connectorId === t.id);
    const seg = node && h.segments.find((s) => s.a === node.id || s.b === node.id);
    if (!c || !seg) return null;
    return { a: c.position, b: nodePos(h, seg.a === node!.id ? seg.b : seg.a), lengthMm: seg.lengthMm, maxFrac: 0.45 };
  }
  if (t.kind === "segment") {
    const seg = h.segments.find((s) => s.id === t.id);
    if (!seg) return null;
    const fromA = !t.nodeId || t.nodeId === seg.a;
    return { a: nodePos(h, fromA ? seg.a : seg.b), b: nodePos(h, fromA ? seg.b : seg.a), lengthMm: seg.lengthMm, maxFrac: 0.9 };
  }
  return null;
}

/** Where a label is drawn on its bundle. */
export function labelPoint(h: Harness, l: Label): Point | null {
  const k = labelTrack(h, l);
  if (!k) return null;
  const f = Math.min(k.maxFrac, l.distanceMm / k.lengthMm);
  return { x: k.a.x + (k.b.x - k.a.x) * f, y: k.a.y + (k.b.y - k.a.y) * f };
}
