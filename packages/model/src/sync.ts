import type { CatalogIndex } from "./catalog";
import { derive, diameterUnderLayer, shortestPath, buildAdjacency, type Derived } from "./derive";
import { currentRevision, defaultColorFor, defaultGaugeForEnds, memberKey, nextLabel, pairKey, uid } from "./helpers";
import { resolvePedigree } from "./pedigree";
import type { Harness, Label, Net, Project, Settings, Termination, WireEnd } from "./schema";

export interface SyncContext {
  cat: CatalogIndex;
}

/** Desired wire endpoint pairs for a net (§4.2). */
export function desiredPairs(h: Harness, net: Net): [WireEnd, WireEnd][] {
  const members = orderedMembers(h, net);
  if (members.length < 2) return [];
  if (net.topology === "splice" && members.length >= 3) {
    const sp = h.splices.find((s) => s.netId === net.id);
    if (sp) return members.map((m) => [{ kind: "pin", connectorId: m.connectorId, cavityId: m.cavityId }, { kind: "splice", spliceId: sp.id }]);
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
  return out;
}

function ensureConnectorNodes(h: Harness) {
  const connIds = new Set(h.connectors.map((c) => c.id));
  h.nodes = h.nodes.filter((n) => n.kind !== "connector" || (n.connectorId && connIds.has(n.connectorId)));
  for (const c of h.connectors) {
    const n = h.nodes.find((x) => x.kind === "connector" && x.connectorId === c.id);
    if (!n) h.nodes.push({ id: uid(), kind: "connector", connectorId: c.id, position: { ...c.position } });
    else if (n.position.x !== c.position.x || n.position.y !== c.position.y) n.position = { ...c.position };
  }
  const nodeIds = new Set(h.nodes.map((n) => n.id));
  h.segments = h.segments.filter((s) => nodeIds.has(s.a) && nodeIds.has(s.b) && s.a !== s.b);
}

function cleanNets(h: Harness, cat: CatalogIndex) {
  const cavities = new Map<string, Set<string>>();
  for (const c of h.connectors) {
    const part = cat.connector(c.pn);
    cavities.set(c.id, new Set(part ? part.arrangement.cavities.map((x) => x.id) : Object.keys(c.pins)));
  }
  const seen = new Set<string>();
  for (const n of h.nets) {
    n.members = n.members.filter((m) => {
      const k = memberKey(m);
      if (seen.has(k) || !cavities.get(m.connectorId)?.has(m.cavityId)) return false;
      seen.add(k);
      return true;
    });
  }
  h.nets = h.nets.filter((n) => n.members.length > 0);
  // Pins mirror net membership.
  for (const c of h.connectors) {
    for (const [cav, pin] of Object.entries(c.pins)) {
      if (!cavities.get(c.id)?.has(cav)) delete c.pins[cav];
      else pin.netId = null;
    }
  }
  for (const n of h.nets) {
    for (const m of n.members) {
      const c = h.connectors.find((x) => x.id === m.connectorId)!;
      const pin = c.pins[m.cavityId] ?? (c.pins[m.cavityId] = { netId: null });
      pin.netId = n.id;
    }
  }
  for (const c of h.connectors) for (const [cav, pin] of Object.entries(c.pins)) if (!pin.netId && !pin.contactPn && !pin.filler) delete c.pins[cav];
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
  const spliceNets = new Set(h.nets.filter((n) => n.topology === "splice" && n.members.length >= 3).map((n) => n.id));
  h.splices = h.splices.filter((s) => spliceNets.has(s.netId) && h.nodes.some((n) => n.id === s.nodeId));
  for (const n of h.nets) {
    if (!spliceNets.has(n.id)) continue;
    if (!h.splices.some((s) => s.netId === n.id)) {
      const nodeId = bestSpliceNode(h, n);
      if (!nodeId) continue;
      h.splices.push({ id: uid(), label: nextLabel(h.splices.map((s) => s.label), "SP"), netId: n.id, nodeId, type: "crimp", pn: "", cover: "heatShrink", pinned: false });
    }
  }
}

function syncWires(h: Harness, settings: Settings, cat: CatalogIndex, create: boolean) {
  const desired = new Map<string, { netId: string; a: WireEnd; b: WireEnd }>();
  for (const n of h.nets) for (const [a, b] of desiredPairs(h, n)) desired.set(pairKey(a, b), { netId: n.id, a, b });
  const kept = h.wires.filter((w) => desired.has(pairKey(w.from, w.to)));
  const have = new Set(kept.map((w) => pairKey(w.from, w.to)));
  h.wires = kept;
  // Update derived (unpinned) fields.
  for (const w of h.wires) {
    const d = desired.get(pairKey(w.from, w.to))!;
    w.netId = d.netId;
    const net = h.nets.find((n) => n.id === w.netId);
    if (!w.pinned.includes("spec") && !w.cableId) w.spec = settings.defaultWireSpec;
    if (!w.pinned.includes("gauge") && !w.cableId) w.gauge = defaultGaugeForEnds(h, cat, [w.from, w.to]);
    if (!w.pinned.includes("color") && !w.cableId) w.color = defaultColorFor(settings, net);
  }
  if (!create) return;
  for (const [key, d] of desired) {
    if (have.has(key)) continue;
    const net = h.nets.find((n) => n.id === d.netId);
    h.wires.push({
      id: uid(),
      label: nextLabel(h.wires.map((w) => w.label), "W"),
      netId: d.netId,
      from: d.a,
      to: d.b,
      spec: settings.defaultWireSpec,
      gauge: defaultGaugeForEnds(h, cat, [d.a, d.b]),
      color: defaultColorFor(settings, net),
      pinned: [],
      extraLengthMm: 0,
    });
  }
}

/** When a wire has no route, auto-create a direct segment between its end nodes (§4.2). */
function ensureRoutes(h: Harness, settings: Settings) {
  const connNode = new Map(h.nodes.filter((n) => n.kind === "connector").map((n) => [n.connectorId!, n.id]));
  const nodeOf = (e: WireEnd) => (e.kind === "pin" ? connNode.get(e.connectorId) : h.splices.find((s) => s.id === e.spliceId)?.nodeId);
  let adj = buildAdjacency(h);
  for (const w of h.wires) {
    const a = nodeOf(w.from);
    const b = nodeOf(w.to);
    if (!a || !b || a === b) continue;
    if (!shortestPath(adj, a, b)) {
      h.segments.push({ id: uid(), a, b, lengthMm: settings.defaultSegmentMm, toleranceMm: 10, label: "" });
      adj = buildAdjacency(h);
    }
  }
}

function cleanRefs(h: Harness) {
  const wireIds = new Set(h.wires.map((w) => w.id));
  const segIds = new Set(h.segments.map((s) => s.id));
  const nodeIds = new Set(h.nodes.map((n) => n.id));
  const connIds = new Set(h.connectors.map((c) => c.id));
  h.twistGroups = h.twistGroups.map((t) => ({ ...t, wireIds: t.wireIds.filter((id) => wireIds.has(id)) })).filter((t) => t.wireIds.length >= 2);
  const tg = new Set(h.twistGroups.map((t) => t.id));
  h.cables = h.cables.map((c) => ({ ...c, wireIds: c.wireIds.filter((id) => wireIds.has(id)) })).filter((c) => c.wireIds.length > 0);
  const cab = new Set(h.cables.map((c) => c.id));
  h.shields = h.shields.map((s) => ({ ...s, wireIds: s.wireIds.filter((id) => wireIds.has(id)) })).filter((s) => s.wireIds.length > 0 && (!s.cableId || cab.has(s.cableId)));
  const sh = new Set(h.shields.map((s) => s.id));
  for (const w of h.wires) {
    if (w.twistGroupId && !tg.has(w.twistGroupId)) delete w.twistGroupId;
    if (w.cableId && !cab.has(w.cableId)) delete w.cableId;
    if (w.shieldId && !sh.has(w.shieldId)) delete w.shieldId;
  }
  for (const t of h.twistGroups) for (const id of t.wireIds) h.wires.find((w) => w.id === id)!.twistGroupId = t.id;
  for (const s of h.shields) for (const id of s.wireIds) h.wires.find((w) => w.id === id)!.shieldId = s.id;
  for (const c of h.cables) for (const id of c.wireIds) h.wires.find((w) => w.id === id)!.cableId = c.id;
  for (const l of h.layers) l.extents = l.extents.filter((e) => segIds.has(e.segmentId));
  h.layers = h.layers.filter((l) => l.extents.length > 0);
  h.hardware = h.hardware.filter((x) => segIds.has(x.segmentId));
  h.boots = h.boots.filter((b) => nodeIds.has(b.nodeId));
  h.potting = h.potting.filter((p) => (p.targetKind === "connector" ? connIds.has(p.targetId) : h.splices.some((s) => s.id === p.targetId)));
  h.labels = h.labels.filter((l) => {
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
  h.terminations = h.terminations.filter((t) => wantKeys.has(key(t)));
  const have = new Set(h.terminations.map(key));
  for (const w of want) if (!have.has(key(w))) h.terminations.push({ id: uid(), targetId: w.targetId, nodeId: w.nodeId, method: w.defaultMethod, partPns: [], auto: true });
  // Drain-to-pin terminations need a pin; keep only valid refs.
  for (const t of h.terminations) if (t.drainPin && !h.connectors.some((c) => c.id === t.drainPin!.connectorId)) delete t.drainPin;
}

function syncClamps(h: Harness, d: Derived, cat: CatalogIndex, doubleBand: boolean) {
  const termIds = new Set(h.terminations.map((t) => t.id));
  h.clamps = h.clamps.filter((c) => !c.terminationId || termIds.has(c.terminationId));
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
    if (layer) {
      if (!layer.extents.some((e) => e.segmentId === s.id)) continue;
      const under = diameterUnderLayer(d, s.id, layer.id);
      const la = d.segStack.get(s.id)?.find((x) => x.layer.id === layer.id);
      dia = Math.max(dia, under + 2 * (la?.thicknessMm ?? 0.5));
    } else {
      dia = Math.max(dia, (d.segCoreOdMm.get(s.id) ?? 0) + 0.6);
    }
  }
  return dia || 3;
}

function autoSizeParts(h: Harness, d: Derived, cat: CatalogIndex) {
  // Layers: resize unpinned layers to the diameter underneath (§6.6).
  for (const l of h.layers) {
    if (l.pinned) continue;
    let dia = 0;
    for (const e of l.extents) dia = Math.max(dia, diameterUnderLayer(d, e.segmentId, l.id));
    const current = cat.layer(l.pn);
    const material = current?.material ?? (l.material || undefined);
    const part = cat.layerFor(l.type, material, Math.max(dia, 0.5)) ?? cat.layerFor(l.type, undefined, Math.max(dia, 0.5));
    if (part) {
      l.pn = part.pn;
      l.material = part.material;
    }
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
    const wires = h.wires.filter((w) => (w.from.kind === "splice" && w.from.spliceId === s.id) || (w.to.kind === "splice" && w.to.spliceId === s.id));
    const gauge = Math.min(...wires.map((w) => w.gauge), 22);
    s.pn = cat.spliceFor(s.type, gauge, wires.length)?.pn ?? "";
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
  h.boots = h.boots.filter((b) => b.rule !== "pedigree" || requireBoots);
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
  h.labels = h.labels.filter((l) => !l.auto || l.pinned || wantMap.has(k(l)));
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
  ensureConnectorNodes(h);
  cleanNets(h, cat);
  syncSplices(h, cat);
  syncWires(h, p.settings, cat, p.settings.autoCommit);
  ensureRoutes(h, p.settings);
  cleanRefs(h);
  const ped = resolvePedigree(p.pedigreeScheme, rev.activePedigreeId);
  let d = derive(h, cat, p.settings);
  syncTerminations(h, d, cat);
  syncRuleBoots(h, cat, !!ped.process.requireBoots);
  autoSizeParts(h, d, cat);
  d = derive(h, cat, p.settings);
  syncClamps(h, d, cat, !!ped.process.doubleBandClamps);
  syncLabels(h, p.settings, ped.markings);
  autoSizeParts(h, d, cat);
}
