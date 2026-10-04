import type { CatalogIndex, LayerPart } from "./catalog";
import type { Harness, Layer, Segment, Settings, Wire, WireEnd } from "./schema";
import { leadEndAt } from "./helpers";
import { roundUp } from "./units";

export interface LayerAt {
  layer: Layer;
  part?: LayerPart;
  thicknessMm: number;
  /** Largest OD over this layer anywhere on its extent. */
  odAfterMm: number;
  /** Largest diameter under this layer anywhere on its extent. */
  underMaxMm: number;
  partial: boolean;
}

/** A stretch of a segment with a constant layer stack. */
export interface SegInterval {
  startMm: number;
  endMm: number;
  odMm: number;
  layers: { layerId: string; underMm: number; odAfterMm: number }[];
}

export interface Derived {
  /** connectorId → node id */
  connectorNode: Map<string, string>;
  /** wireId → ordered segment ids, or null when unroutable */
  routes: Map<string, string[] | null>;
  /** wireId → node path */
  nodePaths: Map<string, string[]>;
  wireLengthMm: Map<string, number>;
  /** segmentId → wires passing through */
  segWires: Map<string, string[]>;
  /** segmentId → items contributing to the core (wire ids or cable ids) */
  segCoreOdMm: Map<string, number>;
  segOuterOdMm: Map<string, number>;
  segStack: Map<string, LayerAt[]>;
  /** segmentId → constant-stack intervals from end A */
  segIntervals: Map<string, SegInterval[]>;
  /** node id → max OD of any adjacent segment (outer) */
  nodeOdMm: Map<string, number>;
  wireOdMm: Map<string, number>;
  cableOdMm: Map<string, number>;
  totalWireMm: number;
  adjacency: Map<string, { seg: Segment; other: string }[]>;
}

export interface DeriveOptions {
  breakoutAllowanceMm?: number;
  defaultTerminationAllowanceMm?: number;
}

/** Thickness a layer adds on each side of the bundle. */
export function layerThickness(layer: Layer, part?: LayerPart): number {
  const t = part?.thicknessMm ?? 0.3;
  if (layer.type === "tape") {
    const overlap = (layer.params.overlapPct ?? 50) / 100;
    const plies = overlap >= 0.99 ? 2 : 1 / (1 - overlap);
    return t * plies;
  }
  return t;
}

/** OD of a multi-conductor cable (count × conductor OD, + shield + jacket). */
export function cableOd(conductorOd: number, count: number, shieldT: number, jacketT: number): number {
  const lay = count <= 1 ? 1 : count === 2 ? 2 : count === 3 ? 2.155 : count === 4 ? 2.414 : count <= 6 ? 3 : 3.3;
  return conductorOd * lay + 2 * shieldT + 2 * jacketT;
}

export function wireEndNode(end: WireEnd, h: Harness, connectorNode: Map<string, string>): string | undefined {
  if (end.kind === "pin") return connectorNode.get(end.connectorId);
  return h.splices.find((s) => s.id === end.spliceId)?.nodeId;
}

export function buildAdjacency(h: Harness) {
  const adj = new Map<string, { seg: Segment; other: string }[]>();
  for (const n of h.nodes) adj.set(n.id, []);
  for (const s of h.segments) {
    adj.get(s.a)?.push({ seg: s, other: s.b });
    adj.get(s.b)?.push({ seg: s, other: s.a });
  }
  return adj;
}

/** Dijkstra shortest path by segment length. Returns segment ids + node path, or null. */
export function shortestPath(adj: Map<string, { seg: Segment; other: string }[]>, from: string, to: string): { segs: string[]; nodes: string[] } | null {
  if (from === to) return { segs: [], nodes: [from] };
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, { node: string; seg: string }>();
  const done = new Set<string>();
  // Small graphs: O(V²) selection is fine and deterministic.
  while (true) {
    let u: string | undefined;
    let best = Infinity;
    for (const [k, d] of dist) if (!done.has(k) && d < best) (best = d), (u = k);
    if (u === undefined) return null;
    if (u === to) break;
    done.add(u);
    for (const { seg, other } of adj.get(u) ?? []) {
      const nd = best + seg.lengthMm;
      if (nd < (dist.get(other) ?? Infinity) - 1e-9 || (Math.abs(nd - (dist.get(other) ?? Infinity)) < 1e-9 && seg.id < (prev.get(other)?.seg ?? "￿"))) {
        dist.set(other, nd);
        prev.set(other, { node: u, seg: seg.id });
      }
    }
  }
  const segs: string[] = [];
  const nodes: string[] = [to];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur)!;
    segs.unshift(p.seg);
    nodes.unshift(p.node);
    cur = p.node;
  }
  return { segs, nodes };
}

export function wireOd(w: Wire, cat: CatalogIndex): number {
  return cat.wire(w.spec, w.gauge)?.odMm ?? 1.3;
}

/** Portion [0..1] of a segment covered by a layer extent. */
export function extentCoverage(seg: Segment, e: { startMm?: number; endMm?: number }): [number, number] {
  const s = Math.max(0, Math.min(seg.lengthMm, e.startMm ?? 0));
  const t = Math.max(s, Math.min(seg.lengthMm, e.endMm ?? seg.lengthMm));
  return [s, t];
}

export function derive(h: Harness, cat: CatalogIndex, settings: Pick<Settings, "packingFactor" | "serviceLoopMm" | "cutResolutionMm">, opts: DeriveOptions = {}): Derived {
  const breakoutAllowance = opts.breakoutAllowanceMm ?? 10;
  const connectorNode = new Map<string, string>();
  for (const n of h.nodes) if (n.kind === "connector" && n.connectorId) connectorNode.set(n.connectorId, n.id);
  const adj = buildAdjacency(h);
  const nodeKind = new Map(h.nodes.map((n) => [n.id, n.kind]));
  const segById = new Map(h.segments.map((s) => [s.id, s]));

  const routes = new Map<string, string[] | null>();
  const nodePaths = new Map<string, string[]>();
  const wireLengthMm = new Map<string, number>();
  const segWires = new Map<string, string[]>(h.segments.map((s) => [s.id, []]));
  const wireOdMm = new Map<string, number>();
  let totalWireMm = 0;

  const pathCache = new Map<string, { segs: string[]; nodes: string[] } | null>();
  for (const w of h.wires) {
    wireOdMm.set(w.id, wireOd(w, cat));
    const a = wireEndNode(w.from, h, connectorNode);
    const b = wireEndNode(w.to, h, connectorNode);
    let path: { segs: string[]; nodes: string[] } | null = null;
    if (a && b) {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const key = `${lo}|${hi}`;
      if (!pathCache.has(key)) pathCache.set(key, shortestPath(adj, lo, hi));
      const p = pathCache.get(key)!;
      path = p && (a === lo ? p : { segs: [...p.segs].reverse(), nodes: [...p.nodes].reverse() });
    }
    routes.set(w.id, path ? path.segs : null);
    if (path) nodePaths.set(w.id, path.nodes);
    let len = 0;
    if (path) {
      for (const sid of path.segs) {
        len += segById.get(sid)!.lengthMm;
        segWires.get(sid)!.push(w.id);
      }
      for (const n of path.nodes.slice(1, -1)) if (nodeKind.get(n) === "breakout") len += breakoutAllowance;
    }
    for (const end of [w.from, w.to]) {
      if (end.kind === "pin") {
        const c = h.connectors.find((x) => x.id === end.connectorId);
        const part = c && cat.connector(c.pn);
        // Flying leads: the stripped length past the bundle end; connectors: the termination allowance.
        len += part?.flyingLead ? leadEndAt(c!, end.cavityId).stripMm : part?.style.terminationAllowanceMm ?? opts.defaultTerminationAllowanceMm ?? 25;
      } else len += 15; // splice strip + overlap
    }
    len += settings.serviceLoopMm + w.extraLengthMm;
    len = roundUp(len, settings.cutResolutionMm);
    wireLengthMm.set(w.id, len);
    totalWireMm += len;
  }

  // Cable ODs
  const cableOdMm = new Map<string, number>();
  for (const c of h.cables) {
    const wspec = cat.bundle.cableWireCodes.find((x) => x.wireCode === c.wireCode);
    const cond = cat.wire(wspec?.spec ?? "M22759/16", c.gauge)?.odMm ?? 1.3;
    const sh = cat.bundle.cableShields.find((s) => s.code === c.shield)?.thicknessMm ?? 0;
    const jk = cat.bundle.cableJackets.find((j) => j.code === c.jacket)?.thicknessMm ?? 0;
    cableOdMm.set(c.id, cableOd(cond, c.count, sh, jk));
  }

  // Bundle core diameter: D = k·√Σd² (§6.12); cables count as one item.
  const segCoreOdMm = new Map<string, number>();
  const wireCable = new Map<string, string>();
  for (const c of h.cables) for (const wid of c.wireIds) wireCable.set(wid, c.id);
  for (const s of h.segments) {
    const items: number[] = [];
    const seenCables = new Set<string>();
    for (const wid of segWires.get(s.id)!) {
      const cid = wireCable.get(wid);
      if (cid) {
        if (!seenCables.has(cid)) {
          seenCables.add(cid);
          items.push(cableOdMm.get(cid) ?? 3);
        }
      } else items.push(wireOdMm.get(wid)!);
    }
    let d = 0;
    if (items.length === 1) d = items[0]!;
    else if (items.length > 1) d = settings.packingFactor * Math.sqrt(items.reduce((acc, x) => acc + x * x, 0));
    segCoreOdMm.set(s.id, d);
  }

  // Layer stacks per interval (FIX-09): a layer only adds diameter where its extent actually is, so two
  // disjoint partial sleeves never stack on top of each other.
  const segStack = new Map<string, LayerAt[]>();
  const segOuterOdMm = new Map<string, number>();
  const segIntervals = new Map<string, SegInterval[]>();
  const layersSorted = [...h.layers].sort((a, b) => a.stackOrder - b.stackOrder);
  for (const s of h.segments) {
    const core = segCoreOdMm.get(s.id)!;
    const on: { l: Layer; part?: LayerPart; t: number; a: number; b: number }[] = [];
    for (const l of layersSorted) {
      const ext = l.extents.find((e) => e.segmentId === s.id);
      if (!ext) continue;
      const [a, b] = extentCoverage(s, ext);
      if (b - a <= 0) continue;
      const part = cat.layer(ext.pn ?? l.pn);
      on.push({ l, part, t: layerThickness(l, part), a, b });
    }
    const cuts = [...new Set([0, s.lengthMm, ...on.flatMap((x) => [x.a, x.b])])].sort((x, y) => x - y);
    const intervals: SegInterval[] = [];
    const maxAfter = new Map<string, number>();
    const maxUnder = new Map<string, number>();
    for (let i = 0; i + 1 < cuts.length; i++) {
      const lo = cuts[i]!;
      const hi = cuts[i + 1]!;
      if (hi - lo < 1e-9) continue;
      const mid = (lo + hi) / 2;
      let od = core;
      const layers: SegInterval["layers"] = [];
      for (const x of on) {
        if (mid < x.a || mid > x.b) continue;
        const under = od;
        od += 2 * x.t;
        layers.push({ layerId: x.l.id, underMm: under, odAfterMm: od });
        maxAfter.set(x.l.id, Math.max(maxAfter.get(x.l.id) ?? 0, od));
        maxUnder.set(x.l.id, Math.max(maxUnder.get(x.l.id) ?? 0, under));
      }
      intervals.push({ startMm: lo, endMm: hi, odMm: od, layers });
    }
    if (!intervals.length) intervals.push({ startMm: 0, endMm: s.lengthMm, odMm: core, layers: [] });
    segIntervals.set(s.id, intervals);
    segStack.set(
      s.id,
      on.map((x) => ({ layer: x.l, part: x.part, thicknessMm: x.t, odAfterMm: maxAfter.get(x.l.id) ?? core + 2 * x.t, underMaxMm: maxUnder.get(x.l.id) ?? core, partial: x.a > 0.01 || x.b < s.lengthMm - 0.01 })),
    );
    segOuterOdMm.set(s.id, Math.max(core, ...intervals.map((x) => x.odMm)));
  }

  // At a node, fittings see the diameter at that end of each segment, not the segment maximum.
  const nodeOdMm = new Map<string, number>();
  for (const s of h.segments) {
    const iv = segIntervals.get(s.id)!;
    nodeOdMm.set(s.a, Math.max(nodeOdMm.get(s.a) ?? 0, iv[0]!.odMm));
    nodeOdMm.set(s.b, Math.max(nodeOdMm.get(s.b) ?? 0, iv[iv.length - 1]!.odMm));
  }

  return { connectorNode, routes, nodePaths, wireLengthMm, segWires, segCoreOdMm, segOuterOdMm, segStack, segIntervals, nodeOdMm, wireOdMm, cableOdMm, totalWireMm, adjacency: adj };
}

/** Largest diameter a layer has to go over on a segment (for sizing sleeves, braid, tape). */
export function diameterUnderLayer(d: Derived, segmentId: string, layerId: string): number {
  const la = d.segStack.get(segmentId)?.find((x) => x.layer.id === layerId);
  if (la) return la.underMaxMm;
  // Layer not on this segment: the outermost diameter there.
  return d.segOuterOdMm.get(segmentId) ?? d.segCoreOdMm.get(segmentId) ?? 0;
}

/** Outside diameter at a position along a segment (mm from end A). */
export function diameterAt(d: Derived, segmentId: string, posMm: number): number {
  const iv = d.segIntervals.get(segmentId);
  if (!iv?.length) return d.segCoreOdMm.get(segmentId) ?? 0;
  const hit = iv.find((x) => posMm >= x.startMm - 1e-9 && posMm <= x.endMm + 1e-9) ?? (posMm <= 0 ? iv[0]! : iv[iv.length - 1]!);
  return hit.odMm;
}

export function segmentsAtNode(h: Harness, nodeId: string): Segment[] {
  return h.segments.filter((s) => s.a === nodeId || s.b === nodeId);
}
