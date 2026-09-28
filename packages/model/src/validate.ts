import type { CatalogIndex } from "./catalog";
import type { Project } from "./schema";

export interface Diagnostic {
  severity: "error" | "warning";
  /** Where (e.g. "Rev A › wires › W3"). */
  where: string;
  message: string;
}

/**
 * Semantic validation beyond Zod shape checks (feedback §3): ids, references, cavity membership,
 * net/wire consistency, pedigree inheritance, extents and numeric bounds. Runs on open/import so
 * inconsistencies are reported to the user instead of being silently repaired by normalization.
 */
export function validateProject(p: Project, cat?: CatalogIndex): Diagnostic[] {
  const out: Diagnostic[] = [];
  const err = (where: string, message: string) => out.push({ severity: "error", where, message });
  const warn = (where: string, message: string) => out.push({ severity: "warning", where, message });

  if (!p.revisions.some((r) => r.id === p.currentRevisionId)) err("project", `Current revision ${p.currentRevisionId} doesn't exist.`);
  const revIds = new Set<string>();
  for (const r of p.revisions) {
    if (revIds.has(r.id)) err("project", `Duplicate revision id ${r.id}.`);
    revIds.add(r.id);
  }

  // Pedigree scheme: unique ids, valid and acyclic inheritance
  const pedIds = new Set<string>();
  for (const ped of p.pedigreeScheme.pedigrees) {
    if (pedIds.has(ped.id)) err("pedigrees", `Duplicate pedigree id ${ped.id}.`);
    pedIds.add(ped.id);
  }
  for (const ped of p.pedigreeScheme.pedigrees) {
    if (ped.extends && !pedIds.has(ped.extends)) err("pedigrees", `${ped.name} extends unknown pedigree ${ped.extends}.`);
    const seen = new Set<string>();
    let cur: string | undefined = ped.id;
    while (cur) {
      if (seen.has(cur)) {
        err("pedigrees", `${ped.name}: inheritance cycle (${[...seen].join(" → ")}).`);
        break;
      }
      seen.add(cur);
      cur = p.pedigreeScheme.pedigrees.find((x) => x.id === cur)?.extends;
    }
  }

  for (const rev of p.revisions) {
    const R = `Rev ${rev.label}`;
    const h = rev.harness;
    if (!pedIds.has(rev.activePedigreeId) && !rev.frozen) err(R, `Active pedigree ${rev.activePedigreeId} isn't in the scheme.`);

    const ids = new Map<string, string>();
    const uniq = (kind: string, id: string) => {
      if (ids.has(id)) err(`${R} › ${kind}`, `Id ${id} is used twice (${ids.get(id)} and ${kind}).`);
      else ids.set(id, kind);
    };
    h.connectors.forEach((c) => uniq("connectors", c.id));
    h.nodes.forEach((n) => uniq("nodes", n.id));
    h.segments.forEach((s) => uniq("segments", s.id));
    h.nets.forEach((n) => uniq("nets", n.id));
    h.wires.forEach((w) => uniq("wires", w.id));
    h.splices.forEach((s) => uniq("splices", s.id));
    h.layers.forEach((l) => uniq("layers", l.id));
    h.shields.forEach((s) => uniq("shields", s.id));
    h.cables.forEach((c) => uniq("cables", c.id));

    const conn = new Map(h.connectors.map((c) => [c.id, c]));
    const cavs = (cid: string): Set<string> | undefined => {
      const c = conn.get(cid);
      const part = c && cat?.connector(c.pn);
      return part ? new Set(part.arrangement.cavities.map((x) => x.id)) : undefined;
    };
    for (const c of h.connectors) if (cat && !cat.connector(c.pn)) warn(`${R} › ${c.refDes}`, `Part ${c.pn} isn't in the catalog; its cavities can't be checked.`);
    const refs = new Map<string, number>();
    for (const c of h.connectors) refs.set(c.refDes, (refs.get(c.refDes) ?? 0) + 1);
    for (const [r, n] of refs) if (n > 1 && r) warn(R, `Reference designator ${r} is used by ${n} connectors.`);

    // Nets: member references, cavity membership, duplicates
    const memberNet = new Map<string, string>();
    for (const n of h.nets) {
      for (const m of n.members) {
        const where = `${R} › net ${n.name}`;
        if (!conn.has(m.connectorId)) {
          err(where, `Member refers to missing connector ${m.connectorId}.`);
          continue;
        }
        const cs = cavs(m.connectorId);
        if (cs && !cs.has(m.cavityId)) err(where, `${conn.get(m.connectorId)!.refDes}-${m.cavityId} isn't a cavity of ${conn.get(m.connectorId)!.pn}.`);
        const k = `${m.connectorId}:${m.cavityId}`;
        if (memberNet.has(k)) err(where, `${conn.get(m.connectorId)!.refDes}-${m.cavityId} is also on net ${memberNet.get(k)}.`);
        else memberNet.set(k, n.name);
      }
      if (n.currentA != null && (!Number.isFinite(n.currentA) || n.currentA < 0 || n.currentA > 500)) err(`${R} › net ${n.name}`, `Current ${n.currentA} A is out of range.`);
    }

    // Wires: endpoints exist and belong to the wire's net
    const netById = new Map(h.nets.map((n) => [n.id, n]));
    const spliceIds = new Set(h.splices.map((s) => s.id));
    for (const w of h.wires) {
      const where = `${R} › wire ${w.label}`;
      const net = netById.get(w.netId);
      if (!net) err(where, `Refers to missing net ${w.netId}.`);
      for (const e of [w.from, w.to]) {
        if (e.kind === "pin") {
          if (!conn.has(e.connectorId)) err(where, `End refers to missing connector ${e.connectorId}.`);
          else if (net && !net.members.some((m) => m.connectorId === e.connectorId && m.cavityId === e.cavityId)) err(where, `End ${conn.get(e.connectorId)!.refDes}-${e.cavityId} isn't a member of net ${net.name}.`);
        } else if (!spliceIds.has(e.spliceId)) err(where, `End refers to missing splice ${e.spliceId}.`);
      }
      if (!Number.isFinite(w.gauge) || w.gauge < 0 || w.gauge > 40) err(where, `Gauge ${w.gauge} is out of range.`);
      if (!Number.isFinite(w.extraLengthMm) || Math.abs(w.extraLengthMm) > 100000) err(where, `Extra length ${w.extraLengthMm} mm is out of range.`);
      if (cat && !cat.wire(w.spec, w.gauge)) warn(where, `${w.spec} ${w.gauge} AWG isn't in the catalog.`);
    }

    // Topology
    const nodeIds = new Set(h.nodes.map((n) => n.id));
    for (const n of h.nodes) if (n.kind === "connector" && (!n.connectorId || !conn.has(n.connectorId))) err(`${R} › nodes`, `Connector node ${n.id} refers to a missing connector.`);
    for (const c of h.connectors) if (!h.nodes.some((n) => n.connectorId === c.id)) warn(`${R} › ${c.refDes}`, `Connector has no bundle node (will be created).`);
    const segIds = new Map(h.segments.map((s) => [s.id, s]));
    for (const s of h.segments) {
      const where = `${R} › segment ${s.label || s.id.slice(0, 6)}`;
      if (!nodeIds.has(s.a) || !nodeIds.has(s.b)) err(where, `Refers to a missing node.`);
      if (s.a === s.b) err(where, `Starts and ends at the same node.`);
      if (!(s.lengthMm > 0) || s.lengthMm > 1e6) err(where, `Length ${s.lengthMm} mm is out of range.`);
    }
    for (const sp of h.splices) {
      if (!nodeIds.has(sp.nodeId)) err(`${R} › splice ${sp.label}`, `Refers to a missing node.`);
      if (!netById.has(sp.netId)) err(`${R} › splice ${sp.label}`, `Refers to a missing net.`);
    }

    // Layers / extents
    for (const l of h.layers) {
      for (const e of l.extents) {
        const s = segIds.get(e.segmentId);
        const where = `${R} › ${l.type} layer`;
        if (!s) {
          err(where, `Extent refers to missing segment ${e.segmentId}.`);
          continue;
        }
        const a = e.startMm ?? 0;
        const b = e.endMm ?? s.lengthMm;
        if (a < 0 || b > s.lengthMm + 1e-6 || a >= b) err(where, `Extent ${a}–${b} mm doesn't fit segment length ${s.lengthMm} mm.`);
      }
    }

    // Groups
    const wireIds = new Set(h.wires.map((w) => w.id));
    for (const c of h.cables) {
      for (const id of c.wireIds) if (!wireIds.has(id)) err(`${R} › cable ${c.label}`, `Refers to missing wire ${id}.`);
      if (c.wireIds.length !== c.count) warn(`${R} › cable ${c.label}`, `Cable is ${c.count}-conductor but ${c.wireIds.length} wires are assigned.`);
    }
    for (const s of h.shields) for (const id of s.wireIds) if (!wireIds.has(id)) err(`${R} › shield ${s.label}`, `Refers to missing wire ${id}.`);
    for (const t of h.twistGroups) for (const id of t.wireIds) if (!wireIds.has(id)) err(`${R} › twist group`, `Refers to missing wire ${id}.`);
    for (const t of h.terminations) {
      if (!nodeIds.has(t.nodeId)) err(`${R} › termination`, `Refers to a missing node.`);
      if (t.drainPin && !conn.has(t.drainPin.connectorId)) err(`${R} › termination`, `Drain pin refers to a missing connector.`);
    }
  }
  return out;
}
