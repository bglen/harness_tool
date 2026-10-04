import { current, isDraft } from "immer";
import type { CatalogIndex } from "./catalog";
import { sameColor } from "./colors";
import { derive, diameterUnderLayer, shortestPath, buildAdjacency, type Derived } from "./derive";
import { currentRevision, defaultColorFor, defaultGaugeForEnds, isNoConnectName, isSpliceKey, memberKey, nextLabel, pairKey, parseLinkKey, prune, uid } from "./helpers";
import { resolvePedigree } from "./pedigree";
import type { Harness, Label, Net, Project, Settings, Termination, Wire, WireEnd } from "./schema";
import { spliceFills } from "./cma";

export interface SyncContext {
  cat: CatalogIndex;
  /** Collects what normalization changed beyond the command, so it's reported rather than silent. */
  repairs?: string[];
  /** Create a direct (default-length, flagged) segment for wires with no route. Default true. */
  autoRoute?: boolean;
}

const cavityCmp = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/**
 * Parallel pairing: the net's pins sit on exactly two connectors with the same count on each, so every pin gets
 * exactly one wire (1st↔1st, 2nd↔2nd … in cavity order). Returns null when the net isn't shaped that way.
 */
export function parallelPairs(net: Net): [Net["members"][number], Net["members"][number]][] | null {
  const by = new Map<string, Net["members"]>();
  for (const m of net.members) (by.get(m.connectorId) ?? by.set(m.connectorId, []).get(m.connectorId)!).push(m);
  if (by.size !== 2) return null;
  const [a, b] = [...by.values()].map((ms) => [...ms].sort((x, y) => cavityCmp(x.cavityId, y.cavityId))) as [Net["members"], Net["members"]];
  if (a.length !== b.length) return null;
  return a.map((m, i) => [m, b[i]!]);
}

/**
 * The user's drawn connections, when they connect every pin of the net (a spanning set). Duplicates and links to
 * pins no longer on the net are ignored. Returns null when the drawing doesn't cover the whole net.
 */
export function drawnLinks(net: Net): [string, string][] | null {
  const links = validLinks(net);
  if (!links.length || net.members.length < 2) return null;
  return linkGroups(net, links).length === 1 ? links : null;
}

/** Links between the net's pins (and splice barrels), without duplicates or links to pins no longer on the net. */
function validLinks(net: Net): [string, string][] {
  const keys = new Set(net.members.map((m) => `${m.connectorId}:${m.cavityId}`));
  const seen = new Set<string>();
  return (net.links ?? []).filter(([a, b]) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    // Splice barrels are junctions the user placed; links to them are kept (sync drops links to deleted splices).
    if (a === b || !(keys.has(a) || isSpliceKey(a)) || !(keys.has(b) || isSpliceKey(b)) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The links that get wires: the drawing when it covers the net, else (explicitly wired nets) just what is drawn. */
export function wiredLinks(net: Net): [string, string][] {
  return drawnLinks(net) ?? validLinks(net);
}

/** The net's pins grouped by what the links connect (barrels of one splice count as joined). */
function linkGroups(net: Net, links: [string, string][]): string[][] {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => (adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
  for (const [a, b] of links) add(a, b), add(b, a);
  const ports = [...adj.keys()].filter(isSpliceKey);
  for (const p of ports) for (const q of ports) if (p !== q && p.slice(0, p.lastIndexOf(":")) === q.slice(0, q.lastIndexOf(":"))) add(p, q);
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const m of net.members) {
    const start = `${m.connectorId}:${m.cavityId}`;
    if (seen.has(start)) continue;
    const group: string[] = [];
    const q = [start];
    seen.add(start);
    while (q.length) {
      const k = q.pop()!;
      if (!isSpliceKey(k)) group.push(k);
      for (const n of adj.get(k) ?? []) if (!seen.has(n)) seen.add(n), q.push(n);
    }
    groups.push(group);
  }
  return groups;
}

/** Explicitly wired nets: one unrouted connection per group of pins the drawn links don't reach. */
export function unreachedPairs(net: Net): [WireEnd, WireEnd][] {
  const groups = linkGroups(net, validLinks(net));
  return groups.slice(1).map((g) => [parseLinkKey(g[0]!), parseLinkKey(groups[0]![0]!)]);
}

/**
 * The construction actually used for a net. An explicit choice wins; then the connections as the user drew them
 * ("wired", e.g. a loopback plus a run to another connector); then parallel pin-to-pin wires when the pins split
 * evenly across two connectors; anything else falls back to an (unconfirmed, flagged) daisy chain.
 */
export function effectiveTopology(net: Net): "daisy" | "splice" | "parallel" | "wired" {
  if (net.members.length < 2) return "daisy";
  if (net.topology === "splice" && net.members.length >= 3) return "splice";
  if (net.wiringExplicit) return "wired";
  if (net.topologyConfirmed) {
    if (net.topology === "parallel") return parallelPairs(net) ? "parallel" : "daisy";
    if (net.topology === "daisy") return "daisy";
  }
  if (drawnLinks(net)) return "wired";
  if (net.members.length < 3) return "daisy";
  return parallelPairs(net) ? "parallel" : "daisy";
}

/** Does the net's construction put two wires in one contact, or need a splice (manual work)? */
export function joinKind(net: Net): "splice" | "doubleCrimp" | null {
  const t = effectiveTopology(net);
  if (t === "splice") return "splice";
  if (t === "parallel") return null;
  if (t === "wired") {
    const count = new Map<string, number>();
    const links = wiredLinks(net);
    for (const [a, b] of links) for (const k of [a, b]) if (!isSpliceKey(k)) count.set(k, (count.get(k) ?? 0) + 1);
    if ([...count.values()].some((n) => n > 1)) return "doubleCrimp";
    return links.some(([a, b]) => isSpliceKey(a) || isSpliceKey(b)) ? "splice" : null;
  }
  return net.members.length >= 3 ? "doubleCrimp" : null;
}

/** Desired wire endpoint pairs for a net (§4.2). */
export function desiredPairs(h: Harness, net: Net): [WireEnd, WireEnd][] {
  const members = orderedMembers(h, net);
  if (members.length < 2) return [];
  const topo = effectiveTopology(net);
  if (topo === "splice") {
    const sp = h.splices.find((s) => s.netId === net.id);
    if (sp) return members.map((m) => [{ kind: "pin", connectorId: m.connectorId, cavityId: m.cavityId }, { kind: "splice", spliceId: sp.id, barrel: 0 }]);
  }
  if (topo === "wired") {
    const idx = new Map(h.connectors.map((c, i) => [c.id, i]));
    // Pins before splice barrels; pins in connector order.
    const rank = (e: WireEnd) => (e.kind === "pin" ? idx.get(e.connectorId) ?? 0 : 1e9);
    return wiredLinks(net).map(([x, y]) => {
      const [a, b] = [parseLinkKey(x), parseLinkKey(y)];
      return rank(a) <= rank(b) ? [a, b] : [b, a];
    });
  }
  if (topo === "parallel") {
    const idx = new Map(h.connectors.map((c, i) => [c.id, i]));
    return parallelPairs(net)!.map(([x, y]) => {
      const [a, b] = (idx.get(x.connectorId) ?? 0) <= (idx.get(y.connectorId) ?? 0) ? [x, y] : [y, x];
      return [
        { kind: "pin", connectorId: a.connectorId, cavityId: a.cavityId },
        { kind: "pin", connectorId: b.connectorId, cavityId: b.cavityId },
      ];
    });
  }
  const out: [WireEnd, WireEnd][] = [];
  for (let i = 0; i + 1 < members.length; i++) {
    const a = members[i]!;
    const b = members[i + 1]!;
    out.push([
      { kind: "pin", connectorId: a.connectorId, cavityId: a.cavityId },
      { kind: "pin", connectorId: b.connectorId, cavityId: b.cavityId },
    ]);
  }
  return out;
}

/** Daisy-chain order: connector order in the harness ("node order"), then member order. */
export function orderedMembers(h: Harness, net: Net) {
  const idx = new Map(h.connectors.map((c, i) => [c.id, i]));
  return net.members
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (idx.get(a.m.connectorId) ?? 0) - (idx.get(b.m.connectorId) ?? 0) || a.i - b.i)
    .map((x) => x.m);
}

/** Pairs for which no wire exists yet (ratsnest lines). */
export function ratsnest(h: Harness): { netId: string; a: WireEnd; b: WireEnd }[] {
  const have = new Set(h.wires.map((w) => pairKey(w.from, w.to)));
  const out: { netId: string; a: WireEnd; b: WireEnd }[] = [];
  for (const n of h.nets) for (const [a, b] of desiredPairs(h, n)) if (!have.has(pairKey(a, b))) out.push({ netId: n.id, a, b });
  // Explicitly wired nets: pins their drawn links don't reach still need connecting (one line per unreached group).
  for (const n of h.nets) if (n.wiringExplicit) for (const [a, b] of unreachedPairs(n)) out.push({ netId: n.id, a, b });
  return out;
}

function ensureConnectorNodes(h: Harness) {
  const connIds = new Set(h.connectors.map((c) => c.id));
  prune(h, "nodes", (n) => n.kind !== "connector" || !!(n.connectorId && connIds.has(n.connectorId)));
  for (const c of h.connectors) {
    const n = h.nodes.find((x) => x.kind === "connector" && x.connectorId === c.id);
    if (!n) h.nodes.push({ id: uid(), kind: "connector", connectorId: c.id, position: { ...c.position } });
    else if (n.position.x !== c.position.x || n.position.y !== c.position.y) n.position = { ...c.position };
  }
  const nodeIds = new Set(h.nodes.map((n) => n.id));
  prune(h, "segments", (s) => nodeIds.has(s.a) && nodeIds.has(s.b) && s.a !== s.b);
}

/** Nets named like "NC" (from older files or imports) become no-connect pins instead of a real net. */
function convertNoConnectNets(h: Harness, settings: Settings, repairs?: string[]) {
  const nc = plain(h).nets.filter((n) => isNoConnectName(settings, n.name));
  if (!nc.length) return;
  for (const n of nc) {
    for (const m of n.members) {
      const c = h.connectors.find((x) => x.id === m.connectorId);
      if (c) (c.pins[m.cavityId] ??= { netId: null }).noConnect = true;
    }
    repairs?.push(`"${n.name}" is a no-connect name: its ${n.members.length} pin${n.members.length === 1 ? "" : "s"} are now marked no-connect instead of joined by wires.`);
  }
  const ids = new Set(nc.map((n) => n.id));
  prune(h, "nets", (n) => !ids.has(n.id));
}

function cleanNets(h: Harness, cat: CatalogIndex, repairs?: string[]) {
  const snap = plain(h);
  const cavities = new Map<string, Set<string>>();
  const refDes = new Map(snap.connectors.map((c) => [c.id, c.refDes]));
  for (const c of snap.connectors) {
    const part = cat.connector(c.pn);
    cavities.set(c.id, new Set(part ? part.arrangement.cavities.map((x) => x.id) : Object.keys(c.pins)));
  }
  // 1. Drop invalid / duplicate members (only touch nets that change) — and say so.
  const seen = new Map<string, string>();
  snap.nets.forEach((n, i) => {
    const keep = n.members.filter((m) => {
      const k = memberKey(m);
      const pin = `${refDes.get(m.connectorId) ?? "deleted connector"}-${m.cavityId}`;
      if (seen.has(k)) {
        repairs?.push(`${pin} was on both ${seen.get(k)} and ${n.name}; kept it on ${seen.get(k)}.`);
        return false;
      }
      if (!cavities.get(m.connectorId)?.has(m.cavityId)) {
        if (refDes.has(m.connectorId)) repairs?.push(`${pin} doesn't exist on the connector's insert; removed it from ${n.name}.`);
        return false;
      }
      seen.set(k, n.name);
      return true;
    });
    if (keep.length !== n.members.length) h.nets[i]!.members = keep;
  });
  prune(h, "nets", (n) => n.members.length > 0);
  // Drawn connections only between pins still on the net.
  for (const n of h.nets) {
    if (!n.links?.length) continue;
    const keys = new Set(n.members.map((m) => memberKey(m)));
    const port = (k: string) => {
      const e = parseLinkKey(k);
      const sp = e.kind === "splice" ? snap.splices.find((s) => s.id === e.spliceId) : undefined;
      return !!sp && sp.netId === n.id && e.kind === "splice" && e.barrel < sp.barrels;
    };
    prune(n, "links", ([a, b]) => (keys.has(a) || port(a)) && (keys.has(b) || port(b)));
  }
  // 2. Pins mirror net membership: compute desired netId per pin, write only differences.
  const want = new Map<string, string>();
  for (const n of plain(h).nets) for (const m of n.members) want.set(`${m.connectorId}:${m.cavityId}`, n.id);
  snap.connectors.forEach((c, ci) => {
    const dc = h.connectors[ci]!;
    for (const [cav, pin] of Object.entries(c.pins)) {
      const key = `${c.id}:${cav}`;
      const w = want.get(key) ?? null;
      if (!cavities.get(c.id)?.has(cav) || (!w && !pin.contactPn && !pin.filler && !pin.noConnect)) delete dc.pins[cav];
      else {
        if (pin.netId !== w) dc.pins[cav]!.netId = w;
        // A pin on a net can't also be no-connect.
        if (w && pin.noConnect) delete dc.pins[cav]!.noConnect;
      }
    }
    for (const [key, netId] of want) {
      if (!key.startsWith(`${c.id}:`)) continue;
      const cav = key.slice(c.id.length + 1);
      if (!c.pins[cav]) dc.pins[cav] = { netId };
    }
  });
}

/** Choose the graph node minimising total path length to all members (splice host). */
function bestSpliceNode(h: Harness, net: Net): string | undefined {
  const adj = buildAdjacency(h);
  const connNode = new Map(h.nodes.filter((n) => n.kind === "connector").map((n) => [n.connectorId!, n.id]));
  const targets = [...new Set(net.members.map((m) => connNode.get(m.connectorId)).filter(Boolean))] as string[];
  let best: string | undefined;
  let bestCost = Infinity;
  for (const n of h.nodes) {
    let cost = 0;
    for (const t of targets) {
      const p = shortestPath(adj, n.id, t);
      if (!p) {
        cost = Infinity;
        break;
      }
      cost += p.segs.reduce((acc, sid) => acc + h.segments.find((s) => s.id === sid)!.lengthMm, 0);
    }
    const bias = n.kind === "breakout" ? -1e-3 : 0; // prefer breakouts on ties
    if (cost + bias < bestCost) (bestCost = cost + bias), (best = n.id);
  }
  return best ?? targets[0];
}

function syncSplices(h: Harness, cat: CatalogIndex) {
  const spliceNets = new Set(h.nets.filter((n) => effectiveTopology(n) === "splice").map((n) => n.id));
  const nodeSet = new Set(plain(h).nodes.map((n) => n.id));
  const linked = new Set(plain(h).nets.flatMap((n) => (n.links ?? []).flat().filter(isSpliceKey).map((k) => (parseLinkKey(k) as { spliceId: string }).spliceId)));
  prune(h, "splices", (s) => (spliceNets.has(s.netId) || linked.has(s.id)) && h.nets.some((n) => n.id === s.netId));
  // A splice whose bundle node went away moves to the best node for its net.
  for (const s of h.splices)
    if (!nodeSet.has(s.nodeId)) {
      const net = h.nets.find((n) => n.id === s.netId);
      const nodeId = net && bestSpliceNode(h, net);
      if (nodeId) s.nodeId = nodeId;
    }
  for (const n of h.nets) {
    if (!spliceNets.has(n.id)) continue;
    if (!h.splices.some((s) => s.netId === n.id)) {
      const nodeId = bestSpliceNode(h, n);
      if (!nodeId) continue;
      h.splices.push({ id: uid(), label: nextLabel(h.splices.map((s) => s.label), "SP"), netId: n.id, nodeId, type: "crimp", pn: "", cover: "heatShrink", pinned: false, barrels: 1, buildUp: [] });
    }
  }
}

function syncWires(h: Harness, settings: Settings, cat: CatalogIndex, create: boolean, repairs?: string[]) {
  // Read from a plain snapshot (fast) and write only real changes to the draft.
  const snap = plain(h);
  const desired = new Map<string, { netId: string; a: WireEnd; b: WireEnd }>();
  for (const n of snap.nets) for (const [a, b] of desiredPairs(snap, n)) desired.set(pairKey(a, b), { netId: n.id, a, b });
  // Wires the user customised (pinned spec/gauge/color, extra length, cable/shield/twist membership) are reported when
  // the connectivity change removes them.
  for (const w of snap.wires)
    if (!desired.has(pairKey(w.from, w.to)) && (w.pinned.length || w.extraLengthMm || w.cableId || w.shieldId || w.twistGroupId)) repairs?.push(`Wire ${w.label} (customised) was removed because its connection changed.`);
  prune(h, "wires", (w) => desired.has(pairKey(w.from, w.to)));
  const have = new Set(snap.wires.map((w) => pairKey(w.from, w.to)));
  const netById = new Map(snap.nets.map((n) => [n.id, n]));
  const gaugeCache = new Map<string, number>();
  const gaugeFor = (a: WireEnd, b: WireEnd) => {
    const k = pairKey(a, b);
    if (!gaugeCache.has(k)) gaugeCache.set(k, defaultGaugeForEnds(snap, cat, [a, b]));
    return gaugeCache.get(k)!;
  };
  // Update derived (unpinned) fields.
  let draftById: Map<string, Wire> | undefined;
  snap.wires.forEach((sw) => {
    const d = desired.get(pairKey(sw.from, sw.to));
    if (!d) return;
    const need: Partial<Wire> = {};
    if (sw.netId !== d.netId) need.netId = d.netId;
    if (!sw.cableId) {
      if (!sw.pinned.includes("spec") && sw.spec !== settings.defaultWireSpec) need.spec = settings.defaultWireSpec;
      if (!sw.pinned.includes("gauge")) {
        const g = gaugeFor(sw.from, sw.to);
        if (sw.gauge !== g) need.gauge = g;
      }
      if (!sw.pinned.includes("color")) {
        const c = defaultColorFor(settings, netById.get(d.netId));
        if (!sameColor(c, sw.color)) need.color = c;
      }
    }
    if (Object.keys(need).length) {
      draftById ??= new Map(h.wires.map((w) => [w.id, w]));
      Object.assign(draftById.get(sw.id)!, need);
    }
  });
  if (!create) return;
  const labels = new Set(snap.wires.map((w) => w.label));
  let next = 1;
  for (const [key, d] of desired) {
    if (have.has(key)) continue;
    while (labels.has(`W${next}`)) next++;
    const label = `W${next}`;
    labels.add(label);
    h.wires.push({
      id: uid(),
      label,
      netId: d.netId,
      from: d.a,
      to: d.b,
      spec: settings.defaultWireSpec,
      gauge: gaugeFor(d.a, d.b),
      color: defaultColorFor(settings, netById.get(d.netId)),
      pinned: [],
      extraLengthMm: 0,
    });
  }
}

/** Plain (non-proxy) view of a possibly-drafted value, for fast reads. */
function plain<T>(v: T): T {
  return isDraft(v) ? current(v) : v;
}

/**
 * When a wire has no route, create a direct segment between its end nodes (§4.2). The segment's length is a
 * flagged default ("assumed_dimensions" check) until someone enters it; with autoRoute off, wires stay unrouted.
 */
function ensureRoutes(h: Harness, settings: Settings) {
  const connNode = new Map(h.nodes.filter((n) => n.kind === "connector").map((n) => [n.connectorId!, n.id]));
  const nodeOf = (e: WireEnd) => (e.kind === "pin" ? connNode.get(e.connectorId) : h.splices.find((s) => s.id === e.spliceId)?.nodeId);
  let adj = buildAdjacency(h);
  for (const w of h.wires) {
    const a = nodeOf(w.from);
    const b = nodeOf(w.to);
    if (!a || !b || a === b) continue;
    if (!shortestPath(adj, a, b)) {
      h.segments.push({ id: uid(), a, b, lengthMm: settings.defaultSegmentMm, lengthSource: "default", toleranceMm: 10, label: "" });
      adj = buildAdjacency(h);
    }
  }
}

function cleanRefs(h: Harness) {
  const snap = plain(h);
  const wireIds = new Set(snap.wires.map((w) => w.id));
  const segIds = new Set(snap.segments.map((s) => s.id));
  const nodeIds = new Set(snap.nodes.map((n) => n.id));
  const connIds = new Set(snap.connectors.map((c) => c.id));
  const spliceIds = new Set(snap.splices.map((s) => s.id));
  for (const t of h.twistGroups) prune(t, "wireIds", (id) => wireIds.has(id));
  prune(h, "twistGroups", (t) => t.wireIds.length >= 2);
  for (const c of h.cables) prune(c, "wireIds", (id) => wireIds.has(id));
  prune(h, "cables", (c) => c.wireIds.length > 0);
  const cab = new Set(plain(h).cables.map((c) => c.id));
  for (const s of h.shields) prune(s, "wireIds", (id) => wireIds.has(id));
  prune(h, "shields", (s) => s.wireIds.length > 0 && (!s.cableId || cab.has(s.cableId)));
  // Wire back-references: compute wanted values, write only differences
  const p2 = plain(h);
  const wantTg = new Map<string, string>();
  const wantSh = new Map<string, string>();
  const wantCab = new Map<string, string>();
  for (const t of p2.twistGroups) for (const id of t.wireIds) wantTg.set(id, t.id);
  for (const s of p2.shields) for (const id of s.wireIds) wantSh.set(id, s.id);
  for (const c of p2.cables) for (const id of c.wireIds) wantCab.set(id, c.id);
  p2.wires.forEach((w, i) => {
    const fix = (key: "twistGroupId" | "shieldId" | "cableId", want?: string) => {
      if (w[key] === want) return;
      const dw = h.wires[i]!;
      if (want) dw[key] = want;
      else delete dw[key];
    };
    fix("twistGroupId", wantTg.get(w.id));
    fix("shieldId", wantSh.get(w.id));
    fix("cableId", wantCab.get(w.id));
  });
  for (const l of h.layers) prune(l, "extents", (e) => segIds.has(e.segmentId));
  prune(h, "layers", (l) => l.extents.length > 0);
  prune(h, "hardware", (x) => segIds.has(x.segmentId));
  prune(h, "boots", (b) => nodeIds.has(b.nodeId));
  prune(h, "potting", (p) => (p.targetKind === "connector" ? connIds.has(p.targetId) : spliceIds.has(p.targetId)));
  prune(h, "labels", (l) => {
    const t = l.attachedTo;
    if (t.kind === "wire") return wireIds.has(t.id);
    if (t.kind === "segment") return segIds.has(t.id);
    if (t.kind === "connector") return connIds.has(t.id);
    return cab.has(t.id);
  });
}

// ─── Finishing auto-completion (§6) ─────────────────────────────────────────

/** Ends of a shield: connector nodes where its wires terminate. */
export function shieldEndNodes(h: Harness, shieldId: string, d: Derived): string[] {
  const s = h.shields.find((x) => x.id === shieldId);
  if (!s) return [];
  const nodes = new Set<string>();
  for (const wid of s.wireIds) {
    const path = d.nodePaths.get(wid);
    if (path && path.length) {
      nodes.add(path[0]!);
      nodes.add(path[path.length - 1]!);
    }
  }
  return [...nodes];
}

/** Ends and junctions of an overbraid layer over the segment graph. */
export function braidEnds(h: Harness, layerId: string): { nodeId: string; kind: "end" | "junction" }[] {
  const l = h.layers.find((x) => x.id === layerId);
  if (!l) return [];
  const covered = new Set(l.extents.map((e) => e.segmentId));
  const deg = new Map<string, number>();
  for (const s of h.segments) if (covered.has(s.id)) for (const n of [s.a, s.b]) deg.set(n, (deg.get(n) ?? 0) + 1);
  const out: { nodeId: string; kind: "end" | "junction" }[] = [];
  for (const [n, k] of deg) {
    if (k === 1) out.push({ nodeId: n, kind: "end" });
    else if (k >= 3) out.push({ nodeId: n, kind: "junction" });
  }
  return out;
}

function syncTerminations(h: Harness, d: Derived, cat: CatalogIndex) {
  const want: { targetId: string; nodeId: string; defaultMethod: Termination["method"] }[] = [];
  const nodeConn = new Map(h.nodes.map((n) => [n.id, n.connectorId]));
  const hasBandPlatform = (nodeId: string) => {
    const cid = nodeConn.get(nodeId);
    const c = cid && h.connectors.find((x) => x.id === cid);
    return !!(c && c.backshell && cat.backshell(c.backshell.pn)?.bandPlatform);
  };
  for (const s of h.shields) for (const n of shieldEndNodes(h, s.id, d)) want.push({ targetId: s.id, nodeId: n, defaultMethod: hasBandPlatform(n) ? "band360" : "floating" });
  for (const l of h.layers.filter((x) => x.type === "overbraid")) {
    for (const e of braidEnds(h, l.id)) {
      const isConn = !!nodeConn.get(e.nodeId);
      want.push({ targetId: l.id, nodeId: e.nodeId, defaultMethod: e.kind === "junction" ? "junction" : isConn ? "band360" : "foldBack" });
    }
  }
  const key = (t: { targetId: string; nodeId: string }) => `${t.targetId}@${t.nodeId}`;
  const wantKeys = new Set(want.map(key));
  prune(h, "terminations", (t) => wantKeys.has(key(t)));
  const have = new Set(h.terminations.map(key));
  for (const w of want) if (!have.has(key(w))) h.terminations.push({ id: uid(), targetId: w.targetId, nodeId: w.nodeId, method: w.defaultMethod, partPns: [], auto: true });
  // Drain-to-pin terminations need a pin; keep only valid refs.
  for (const t of h.terminations) if (t.drainPin && !h.connectors.some((c) => c.id === t.drainPin!.connectorId)) delete t.drainPin;
  // A drain landed on a pin is a physical conductor (FIX-05): spec/gauge follow the shielded wires; the pigtail
  // length is a flagged default until confirmed.
  for (const t of h.terminations) {
    if (t.method !== "drainToPin" || !t.drainPin) {
      if (t.drain) delete t.drain;
      continue;
    }
    if (t.drain) continue;
    const sh = h.shields.find((s) => s.id === t.targetId);
    const ws = sh ? h.wires.filter((w) => sh.wireIds.includes(w.id)) : [];
    const gauge = ws.length ? Math.max(...ws.map((w) => w.gauge)) : 22;
    const spec = ws[0]?.spec ?? "M22759/16";
    t.drain = { spec: cat.wire(spec, gauge) ? spec : "M22759/16", gauge, lengthMm: DEFAULT_DRAIN_MM, lengthSource: "default" };
  }
}

/** Placeholder drain pigtail length (shield strip-back to the contact); always flagged for confirmation. */
export const DEFAULT_DRAIN_MM = 75;

function syncClamps(h: Harness, d: Derived, cat: CatalogIndex, doubleBand: boolean) {
  const termIds = new Set(h.terminations.map((t) => t.id));
  prune(h, "clamps", (c) => !c.terminationId || termIds.has(c.terminationId));
  for (const t of h.terminations) {
    const needs = t.method === "band360" || t.method === "junction";
    const existing = h.clamps.find((c) => c.terminationId === t.id);
    if (!needs) {
      if (existing && !existing.pinned) h.clamps = h.clamps.filter((c) => c !== existing);
      continue;
    }
    const dia = terminationDiameter(h, d, t);
    const part = cat.clampFor(dia);
    if (!existing) {
      if (h.suppressedAuto.includes(`clamp@${t.id}`)) continue;
      h.clamps.push({ id: uid(), terminationId: t.id, nodeId: t.nodeId, pn: part?.pn ?? "", quantity: doubleBand ? 2 : 1, auto: true, pinned: false });
    } else if (!existing.pinned) {
      existing.pn = part?.pn ?? existing.pn;
      existing.quantity = doubleBand ? 2 : 1;
      existing.nodeId = t.nodeId;
    }
  }
}

/** Diameter under a band clamp at a termination: the bundle incl. the shield/braid being clamped. */
export function terminationDiameter(h: Harness, d: Derived, t: Termination): number {
  const segs = h.segments.filter((s) => s.a === t.nodeId || s.b === t.nodeId);
  let dia = 0;
  const layer = h.layers.find((l) => l.id === t.targetId);
  for (const s of segs) {
    // Query the stack at the end touching this node (FIX-09), not the segment maximum.
    const iv = d.segIntervals.get(s.id);
    const end = iv && (s.a === t.nodeId ? iv[0] : iv[iv.length - 1]);
    if (layer) {
      if (!layer.extents.some((e) => e.segmentId === s.id)) continue;
      const at = end?.layers.find((x) => x.layerId === layer.id);
      const la = d.segStack.get(s.id)?.find((x) => x.layer.id === layer.id);
      dia = Math.max(dia, at ? at.odAfterMm : diameterUnderLayer(d, s.id, layer.id) + 2 * (la?.thicknessMm ?? 0.5));
    } else {
      dia = Math.max(dia, (d.segCoreOdMm.get(s.id) ?? 0) + 0.6);
    }
  }
  return dia || 3;
}

function autoSizeParts(h: Harness, d: Derived, cat: CatalogIndex) {
  // Layers: resize unpinned layers to the diameter underneath (§6.6).
  for (const l of h.layers) {
    if (l.pinned) {
      for (const e of l.extents) delete e.pn;
      continue;
    }
    const material = l.material || cat.layer(l.pn)?.material || undefined;
    const pick = (dia: number) => cat.layerFor(l.type, material, Math.max(dia, 0.5)) ?? cat.layerFor(l.type, undefined, Math.max(dia, 0.5));
    // Primary part sized for the largest diameter; smaller segments get their own size when needed.
    const dias = l.extents.map((e) => diameterUnderLayer(d, e.segmentId, l.id));
    const primary = pick(Math.max(0, ...dias));
    if (primary) {
      l.pn = primary.pn;
      l.material = primary.material;
    }
    l.extents.forEach((e, i) => {
      const cur = primary && dias[i]! >= primary.minDiaMm && dias[i]! <= primary.maxDiaMm ? primary : pick(dias[i]!);
      if (cur && cur.pn !== l.pn) e.pn = cur.pn;
      else delete e.pn;
    });
  }
  // Backshells: keep style/angle, pick the size whose cable clamp fits (§6.1).
  for (const c of h.connectors) {
    if (!c.backshell || !c.backshell.auto) continue;
    const part = cat.connector(c.pn);
    const cur = cat.backshell(c.backshell.pn);
    const node = h.nodes.find((n) => n.connectorId === c.id);
    const od = (node && d.nodeOdMm.get(node.id)) ?? 0;
    if (!part) continue;
    const opts = cat.backshellsFor(part.shellSize).filter((b) => !cur || (b.style === cur.style && b.angle === cur.angle));
    const fit = opts.find((b) => od >= b.clampMinMm && od <= b.clampMaxMm) ?? opts[0];
    if (fit) c.backshell.pn = fit.pn;
  }
  // Splices
  for (const s of h.splices) {
    if (s.pinned) continue;
    // Fit each barrel's circular mil area; nothing fits → the nearest part of the type (the CMA check flags it).
    const fills = spliceFills(h, s);
    const cma = fills.map((f) => f.cma);
    const fit = cat.spliceFor(s.type, cma, fills.map((f) => f.wires.length));
    const near = cat.bundle.splices.filter((p) => p.type === s.type && p.barrels === s.barrels).sort((a, b) => Math.abs(a.cmaMax - Math.max(...cma)) - Math.abs(b.cmaMax - Math.max(...cma)))[0];
    s.pn = (fit ?? near)?.pn ?? "";
  }
  // Boots
  for (const b of h.boots) {
    if (b.pinned) continue;
    const od = d.nodeOdMm.get(b.nodeId) ?? 0;
    const conn = h.nodes.find((n) => n.id === b.nodeId)?.connectorId;
    const c = conn && h.connectors.find((x) => x.id === conn);
    const bs = c && c.backshell ? cat.backshell(c.backshell.pn) : undefined;
    const dia = Math.max(od, bs ? bs.clampMaxMm * 0.8 : 0);
    b.pn = cat.bootFor(b.shape, dia)?.pn ?? b.pn;
  }
  // Labels
  for (const l of h.labels) {
    if (l.pinned) continue;
    let dia = 3;
    if (l.attachedTo.kind === "wire") dia = d.wireOdMm.get(l.attachedTo.id) ?? 1.3;
    else if (l.attachedTo.kind === "segment") dia = d.segOuterOdMm.get(l.attachedTo.id) ?? 3;
    else if (l.attachedTo.kind === "connector") {
      const node = h.nodes.find((n) => n.connectorId === l.attachedTo.id);
      dia = (node && d.nodeOdMm.get(node.id)) || 3;
    }
    l.pn = cat.labelFor(l.type, dia)?.pn ?? cat.labelFor("sleeve", dia)?.pn ?? l.pn;
  }
}

function syncRuleBoots(h: Harness, cat: CatalogIndex, requireBoots: boolean) {
  prune(h, "boots", (b) => b.rule !== "pedigree" || requireBoots);
  if (!requireBoots) return;
  for (const c of h.connectors) {
    if (!c.backshell) continue;
    const node = h.nodes.find((n) => n.connectorId === c.id);
    if (!node || h.boots.some((b) => b.nodeId === node.id)) continue;
    if (h.suppressedAuto.includes(`boot@${node.id}`)) continue;
    const bs = cat.backshell(c.backshell.pn);
    h.boots.push({ id: uid(), nodeId: node.id, shape: bs?.angle === 90 ? "90" : "straight", pn: "", auto: true, pinned: false, rule: "pedigree" });
  }
}

function syncLabels(h: Harness, settings: Settings, markings: { text: string; type: string }[]) {
  const want: Omit<Label, "id" | "pn">[] = [];
  const rules = h.labelRules;
  const dist = settings.defaultLabelDistanceMm;
  if (rules.connectorRefDes) for (const c of h.connectors) want.push({ attachedTo: { kind: "connector", id: c.id }, template: "{refDes}", type: "sleeve", distanceMm: dist, auto: true, pinned: false, rule: "connectorRefDes" });
  if (rules.wireIds) {
    for (const w of h.wires) {
      for (const end of [w.from, w.to]) {
        if (end.kind !== "pin") continue;
        const node = h.nodes.find((n) => n.connectorId === end.connectorId);
        want.push({ attachedTo: { kind: "wire", id: w.id, nodeId: node?.id }, template: "{wireId}", type: "sleeve", distanceMm: 25, auto: true, pinned: false, rule: "wireIds" });
      }
    }
  }
  const first = h.connectors[0];
  const firstNode = first && h.nodes.find((n) => n.connectorId === first.id);
  const firstSeg = firstNode && h.segments.find((s) => s.a === firstNode.id || s.b === firstNode.id);
  if (rules.harnessId && firstSeg) want.push({ attachedTo: { kind: "segment", id: firstSeg.id, nodeId: firstNode!.id }, template: "{harnessPN}-{rev} S/N {serial}", type: "sleeve", distanceMm: 100, auto: true, pinned: false, rule: "harnessId" });
  if (rules.pedigreeMarkings && firstSeg) {
    markings.forEach((m, i) =>
      want.push({ attachedTo: { kind: "segment", id: firstSeg.id, nodeId: firstNode!.id }, template: m.text, type: m.type === "tag" ? "flag" : "sleeve", distanceMm: 150 + i * 50, auto: true, pinned: false, rule: `pedigree:${i}` }),
    );
  }
  const k = (l: Pick<Label, "rule" | "attachedTo">) => `${l.rule}|${l.attachedTo.kind}|${l.attachedTo.id}|${l.attachedTo.nodeId ?? ""}`;
  const wantMap = new Map(want.map((w) => [k(w), w]));
  // Remove unpinned auto labels no longer wanted.
  prune(h, "labels", (l) => !l.auto || l.pinned || wantMap.has(k(l)));
  const have = new Set(h.labels.filter((l) => l.auto).map(k));
  for (const [key, w] of wantMap) {
    if (have.has(key) || h.suppressedAuto.includes(`label:${key}`)) continue;
    h.labels.push({ ...w, id: uid(), pn: "" });
  }
  // Keep templates of unpinned auto pedigree markings in sync.
  for (const l of h.labels) if (l.auto && !l.pinned && wantMap.has(k(l))) l.template = wantMap.get(k(l))!.template;
}

/**
 * Normalize a project after any command: runs inside the same Immer draft so the
 * whole change (edit + derived updates) is one undoable unit.
 */
export function normalize(p: Project, ctx: SyncContext): void {
  const rev = currentRevision(p);
  const h = rev.harness;
  const { cat } = ctx;
  const T = (globalThis as { __hsProf?: Record<string, number> }).__hsProf;
  const tm = <R>(name: string, f: () => R): R => {
    if (!T) return f();
    const t0 = performance.now();
    const r = f();
    T[name] = (T[name] ?? 0) + performance.now() - t0;
    return r;
  };
  tm("nodes", () => ensureConnectorNodes(h));
  tm("nc", () => convertNoConnectNets(h, p.settings, ctx.repairs));
  tm("nets", () => cleanNets(h, cat, ctx.repairs));
  tm("splices", () => syncSplices(h, cat));
  tm("wires", () => syncWires(h, p.settings, cat, p.settings.autoCommit, ctx.repairs));
  if (ctx.autoRoute !== false) tm("routes", () => ensureRoutes(h, p.settings));
  tm("refs", () => cleanRefs(h));
  const ped = resolvePedigree(p.pedigreeScheme, rev.activePedigreeId);
  let d = tm("derive1", () => derive(plain(h), cat, p.settings));
  tm("terms", () => syncTerminations(h, d, cat));
  tm("boots", () => syncRuleBoots(h, cat, !!ped.process.requireBoots));
  tm("size1", () => autoSizeParts(h, d, cat));
  d = tm("derive2", () => derive(plain(h), cat, p.settings));
  tm("clamps", () => syncClamps(h, d, cat, !!ped.process.doubleBandClamps));
  tm("labels", () => syncLabels(h, p.settings, ped.markings));
  tm("size2", () => autoSizeParts(h, d, cat));
}
