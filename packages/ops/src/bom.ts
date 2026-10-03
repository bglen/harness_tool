import {
  BUILD_UP_STRAND_MM,
  buildUps,
  cavityStates,
  contactPnFor,
  derive,
  diameterUnderLayer,
  extentCoverage,
  normalizePn,
  resolveLabelTemplate,
  type Alternate,
  type CatalogIndex,
  type DataStatus,
  type QualificationStatus,
  type Derived,
  type Harness,
  type Lifecycle,
  type Project,
  type Revision,
  type Settings,
} from "@hs/model";

export type BomCategory =
  | "Connectors"
  | "Contacts"
  | "Sealing plugs"
  | "Backshells"
  | "Accessories"
  | "Wire"
  | "Cable"
  | "Shielding"
  | "Termination hardware"
  | "Coverings"
  | "Band clamps"
  | "Boots"
  | "Labels"
  | "Splices"
  | "Potting"
  | "Hardware";

export const BOM_CATEGORIES: BomCategory[] = ["Connectors", "Contacts", "Sealing plugs", "Backshells", "Accessories", "Wire", "Cable", "Shielding", "Termination hardware", "Coverings", "Band clamps", "Boots", "Labels", "Splices", "Potting", "Hardware"];

export interface BomLine {
  line: number;
  pn: string;
  description: string;
  category: BomCategory;
  /** Engineering quantity per harness, unrounded (never rounded down for display). */
  qty: number;
  uom: "ea" | "m" | "cc";
  refs: string[];
  unitCost: number;
  /** Cost per harness at the selected quantity's price break (engineering qty × unit price). */
  extCost: number;
  stock: number;
  leadDays: number;
  lifecycle: Lifecycle;
  asOf: string;
  machineReady: boolean;
  alternates: Alternate[];
  massG: number;
  customerFurnished: boolean;
  known: boolean;
  /** Review status of the catalog fields this line depends on (FIX-10). */
  dataStatus: DataStatus | "unknown";
  dataFields?: string;
  /** Qualified-source evidence (FIX-08). */
  qualification: QualificationStatus;
  /** Stock covers the purchase quantity for the selected order quantity. */
  stockSufficient: boolean;
  /** Source object ids (for cross-probing). */
  objectIds: string[];
}

export interface Bom {
  lines: BomLine[];
  materialCost: number;
  massG: number;
  partCount: number;
  /** Longest-lead line whose stock doesn't cover the order (undefined when everything is in stock). */
  criticalPath?: BomLine;
  /** Lines whose stock doesn't cover the order quantity. */
  insufficient: number;
  /** Oldest supply timestamp (the BOM is only as fresh as its stalest line). */
  asOf: string;
  asOfRange: { oldest: string; newest: string };
}

/** Purchase/cut quantity for n harnesses: whole pieces; wire/coverings to the next cm; potting to the next 0.1 cc. */
export function purchaseQty(l: Pick<BomLine, "qty" | "uom">, n: number): number {
  const q = l.qty * n;
  if (l.uom === "ea") return Math.ceil(q - 1e-9);
  const step = l.uom === "m" ? 0.01 : 0.1;
  return +(Math.ceil(q / step - 1e-9) * step).toFixed(2);
}

interface Acc {
  pn: string;
  description: string;
  category: BomCategory;
  qty: number;
  uom: BomLine["uom"];
  refs: Set<string>;
  massG: number;
  machineReady: boolean;
  known: boolean;
  status: DataStatus | "unknown";
  fields?: string;
  objectIds: Set<string>;
}

const STATUS_RANK: Record<string, number> = { verified: 0, seed: 1, unreviewed: 2, unknown: 3 };
const worse = (a: DataStatus | "unknown", b: DataStatus | "unknown") => (STATUS_RANK[b]! > STATUS_RANK[a]! ? b : a);
const statusOf = (part: unknown): DataStatus | "unknown" => ((part as { status?: DataStatus } | undefined)?.status ?? "unknown");

/** Wire part number with MIL-STD-681 color code suffix, e.g. M22759/16-22-96. */
export function wirePn(spec: string, gauge: number, color: { base: number; stripes: number[] }): string {
  return `${spec}-${gauge}-${[color.base, ...color.stripes].join("")}`;
}

export function cablePn(c: { gauge: number; wireCode: string; count: number; shield: string; jacket: string }): string {
  return `M27500-${c.gauge}${c.wireCode}${c.count}${c.shield}${c.jacket}`;
}

/** Tape length for a helical wrap: L × πD / (w × (1 − overlap)). */
export function tapeLengthMm(runMm: number, diaMm: number, overlapPct: number, widthMm = 12.7): number {
  const ov = Math.min(0.9, Math.max(0, overlapPct / 100));
  return (runMm * Math.PI * Math.max(diaMm, 1)) / (widthMm * (1 - ov));
}

export function computeBom(project: Project, rev: Revision, cat: CatalogIndex, d?: Derived, qty = 1): Bom {
  const h = rev.harness;
  const settings: Settings = project.settings;
  const der = d ?? derive(h, cat, settings);
  const acc = new Map<string, Acc>();
  const add = (pn: string, f: Omit<Acc, "pn" | "refs" | "objectIds" | "qty" | "massG" | "status"> & { qty: number; ref?: string; massG?: number; objectId?: string; status: DataStatus | "unknown" }) => {
    const key = `${f.category}|${normalizePn(pn)}`;
    let a = acc.get(key);
    if (!a) {
      a = { pn, description: f.description, category: f.category, qty: 0, uom: f.uom, refs: new Set(), massG: 0, machineReady: f.machineReady, known: f.known, status: f.status, fields: f.fields, objectIds: new Set() };
      acc.set(key, a);
    }
    a.qty += f.qty;
    a.massG += f.massG ?? 0;
    a.status = worse(a.status, f.status);
    if (f.ref) a.refs.add(f.ref);
    if (f.objectId) a.objectIds.add(f.objectId);
  };

  // Connectors, contacts, sealing plugs, backshells, accessories
  for (const c of h.connectors) {
    const part = cat.connector(c.pn);
    if (part?.flyingLead) continue; // bare wire ends: the wire itself is the only material
    add(part?.pn ?? c.pn, { description: part?.description ?? "Unknown connector", category: "Connectors", qty: 1, uom: "ea", ref: c.refDes, massG: part?.massG ?? 0, machineReady: !!part?.machineReady, known: !!part, objectId: c.id, status: part ? part.arrangement.status : "unknown", fields: "insert geometry" });
    if (part) {
      // Contacts vs plugs come from the shared cavity model: drains get contacts, not plugs (FIX-05).
      for (const s of cavityStates(h, cat, c.id)) {
        if (s.fill === "unsupported") continue; // coax/twinax: flagged by the sealing check, no catalog part (Phase 2)
        if (s.fill === "contact") {
          const gauge = s.gauges.length ? Math.max(...s.gauges) : 22;
          const cpn = contactPnFor(h, cat, c.id, s.cavityId, gauge);
          const cp = cpn ? cat.contactsByPn.get(cpn) : undefined;
          const st = cp ? worse(cp.status, cp.toolingStatus ?? "unknown") : "unknown";
          add(cpn ?? `CONTACT-${s.size}`, { description: cp ? `Crimp contact, size ${cp.size}, ${cp.gender}, ${cp.gaugeMin}–${cp.gaugeMax} AWG` : `Contact size ${s.size} (no catalog part)`, category: "Contacts", qty: 1, uom: "ea", ref: `${c.refDes}-${s.cavityId}${s.reason === "drain" ? " (drain)" : ""}`, massG: 0.25, machineReady: !!cp?.machineInsertable, known: !!cp, objectId: c.id, status: st, fields: cp && cp.status === "verified" ? "crimp/insertion tooling" : "contact data" });
        } else {
          const sp = cat.sealingPlug(s.size);
          add(sp?.pn ?? `PLUG-${s.size}`, { description: sp ? `Sealing plug, size ${s.size} (${sp.color})` : `Sealing plug size ${s.size}`, category: "Sealing plugs", qty: 1, uom: "ea", ref: c.refDes, massG: 0.1, machineReady: true, known: !!sp, objectId: c.id, status: statusOf(sp) });
        }
      }
    }
    if (c.backshell) {
      const bs = cat.backshell(c.backshell.pn);
      add(c.backshell.pn, { description: bs?.description ?? "Backshell", category: "Backshells", qty: 1, uom: "ea", ref: c.refDes, massG: bs?.massG ?? 0, machineReady: !!bs?.machineReady, known: !!bs, objectId: c.id, status: statusOf(bs), fields: "dimensions" });
    }
    for (const a of c.accessories) {
      const ap = cat.bundle.accessories.find((x) => normalizePn(x.pn) === normalizePn(a.pn));
      add(a.pn, { description: ap?.description ?? a.kind, category: "Accessories", qty: 1, uom: "ea", ref: c.refDes, massG: ap?.massG ?? 0, machineReady: true, known: !!ap, objectId: c.id, status: statusOf(ap) });
    }
  }

  // Wire (by spec/gauge/color) and cables
  const cableIds = new Set(h.cables.flatMap((c) => c.wireIds));
  for (const w of h.wires) {
    if (cableIds.has(w.id)) continue;
    const len = der.wireLengthMm.get(w.id) ?? 0;
    const ws = cat.wire(w.spec, w.gauge);
    add(wirePn(w.spec, w.gauge, w.color), {
      description: ws ? `Wire, ${w.spec}, ${w.gauge} AWG, ${ws.insulation}` : `Wire ${w.spec} ${w.gauge} AWG (not in catalog)`,
      category: "Wire",
      qty: len / 1000,
      uom: "m",
      ref: w.label,
      massG: ((ws?.massGPerM ?? 5) * len) / 1000,
      machineReady: !!ws?.machineReady,
      known: !!ws,
      objectId: w.id,
      status: statusOf(ws),
      fields: "OD/mass/resistance",
    });
  }
  // CMA build-up filler strands (cut from the project's default wire, white)
  for (const b of buildUps(h)) {
    const spec = project.settings.defaultWireSpec;
    const ws = cat.wire(spec, b.gauge);
    const mm = b.count * BUILD_UP_STRAND_MM;
    add(wirePn(spec, b.gauge, { base: 9, stripes: [] }), { description: ws ? `Wire, ${spec}, ${b.gauge} AWG, ${ws.insulation}` : `Wire ${spec} ${b.gauge} AWG (not in catalog)`, category: "Wire", qty: mm / 1000, uom: "m", ref: `CMA build-up ${b.where}`, massG: ((ws?.massGPerM ?? 5) * mm) / 1000, machineReady: false, known: !!ws, objectId: b.objectId, status: statusOf(ws), fields: "OD/mass/resistance" });
  }
  // Drain / pigtail conductors (FIX-05)
  for (const t of h.terminations) {
    if (t.method !== "drainToPin" || !t.drainPin || !t.drain) continue;
    const ws = cat.wire(t.drain.spec, t.drain.gauge);
    const c = h.connectors.find((x) => x.id === t.drainPin!.connectorId);
    add(wirePn(t.drain.spec, t.drain.gauge, { base: 9, stripes: [] }), {
      description: ws ? `Wire, ${t.drain.spec}, ${t.drain.gauge} AWG, ${ws.insulation}` : `Wire ${t.drain.spec} ${t.drain.gauge} AWG (not in catalog)`,
      category: "Wire",
      qty: t.drain.lengthMm / 1000,
      uom: "m",
      ref: `drain ${c?.refDes ?? "?"}-${t.drainPin.cavityId}`,
      massG: ((ws?.massGPerM ?? 5) * t.drain.lengthMm) / 1000,
      machineReady: false,
      known: !!ws,
      objectId: t.targetId,
      status: statusOf(ws),
      fields: "OD/mass/resistance",
    });
  }
  // Individual shields over wire groups (cable shields are part of the cable PN)
  for (const s of h.shields) {
    if (s.cableId) continue;
    const ws = h.wires.filter((w) => s.wireIds.includes(w.id));
    if (!ws.length) continue;
    const runMm = Math.max(...ws.map((w) => der.wireLengthMm.get(w.id) ?? 0));
    const dia = (settings.packingFactor ?? 1.2) * Math.sqrt(ws.reduce((a, w) => a + (der.wireOdMm.get(w.id) ?? 1.3) ** 2, 0));
    const mat = cat.bundle.layers.find((x) => x.type === "overbraid" && x.material.toLowerCase() === s.material.toLowerCase())?.material;
    const part = cat.layerFor("overbraid", mat, dia) ?? cat.layerFor("overbraid", undefined, dia);
    add(part?.pn ?? "SHIELD-BRAID", {
      description: part ? `Shield braid over ${ws.length} wire${ws.length > 1 ? "s" : ""} (${s.material}, ${s.coverage} %): ${part.description}` : `Shield braid, ${s.material}, ${s.coverage} % (no catalog size for ${dia.toFixed(1)} mm)`,
      category: "Shielding",
      qty: (runMm * 1.05) / 1000,
      uom: "m",
      ref: s.label,
      massG: ((part?.massGPerM ?? 8) * runMm) / 1000,
      machineReady: false,
      known: !!part,
      objectId: s.id,
      status: statusOf(part),
    });
  }
  // Termination hardware referenced by shield/braid terminations
  for (const t of h.terminations)
    for (const pn of t.partPns) {
      const found = cat.partsByPn.get(normalizePn(pn));
      add(pn, { description: (found?.part as { description?: string } | undefined)?.description ?? "Termination part", category: "Termination hardware", qty: 1, uom: "ea", massG: 1, machineReady: false, known: !!found, objectId: t.targetId, status: statusOf(found?.part) });
    }
  for (const c of h.cables) {
    const len = Math.max(0, ...c.wireIds.map((id) => der.wireLengthMm.get(id) ?? 0));
    const code = cat.bundle.cableWireCodes.find((x) => x.wireCode === c.wireCode);
    const ws = cat.wire(code?.spec ?? "M22759/16", c.gauge);
    add(cablePn(c), {
      description: `Cable, M27500, ${c.count} × ${c.gauge} AWG (${code?.spec ?? "?"}), shield ${c.shield}, jacket ${c.jacket}`,
      category: "Cable",
      qty: len / 1000,
      uom: "m",
      ref: c.label,
      massG: (((ws?.massGPerM ?? 5) * c.count * 1.3) * len) / 1000,
      machineReady: false,
      known: !!code,
      objectId: c.id,
      status: code ? statusOf(ws) : "unknown",
      fields: "conductor data",
    });
  }

  // Coverings
  for (const l of h.layers) {
    const perPn = new Map<string, { runMm: number; tapeMm: number }>();
    for (const e of l.extents) {
      const s = h.segments.find((x) => x.id === e.segmentId);
      if (!s) continue;
      const pn = e.pn ?? l.pn;
      const acc2 = perPn.get(pn) ?? perPn.set(pn, { runMm: 0, tapeMm: 0 }).get(pn)!;
      const [a, b] = extentCoverage(s, e);
      acc2.runMm += b - a;
      if (l.type === "tape") {
        const under = diameterUnderLayer(der, s.id, l.id) || 3;
        acc2.tapeMm += tapeLengthMm(b - a, under, l.params.overlapPct ?? 50);
      }
    }
    for (const [pn, { runMm, tapeMm }] of perPn) {
      const part = cat.layer(pn);
      const lenMm = l.type === "tape" ? tapeMm : runMm * 1.05; // 5 % allowance for trimming
      add(pn || `LAYER-${l.type}`, { description: part?.description ?? l.type, category: "Coverings", qty: lenMm / 1000, uom: "m", massG: ((part?.massGPerM ?? 10) * runMm) / 1000, machineReady: !!part?.machineReady, known: !!part, objectId: l.id, status: statusOf(part), fields: "size range/thickness" });
    }
  }
  for (const c of h.clamps) {
    const cp = cat.clamp(c.pn);
    add(c.pn || "CLAMP", { description: cp?.description ?? "Band clamp", category: "Band clamps", qty: c.quantity, uom: "ea", massG: (cp?.massG ?? 2) * c.quantity, machineReady: true, known: !!cp, objectId: c.id, status: statusOf(cp) });
  }
  for (const b of h.boots) {
    const bp = cat.boot(b.pn);
    add(b.pn || "BOOT", { description: bp?.description ?? "Boot", category: "Boots", qty: 1, uom: "ea", massG: bp?.massG ?? 5, machineReady: false, known: !!bp, objectId: b.id, status: statusOf(bp) });
  }
  for (const l of h.labels) {
    const lp = cat.label(l.pn);
    add(l.pn || "LABEL", { description: lp?.description ?? "Label", category: "Labels", qty: 1, uom: "ea", massG: 0.3, machineReady: true, known: !!lp, objectId: l.id, status: statusOf(lp) });
  }
  for (const s of h.splices) {
    const sp = cat.splice(s.pn);
    add(s.pn || "SPLICE", { description: sp?.description ?? "Splice", category: "Splices", qty: 1, uom: "ea", ref: s.label, massG: sp?.massG ?? 1, machineReady: false, known: !!sp, objectId: s.id, status: statusOf(sp) });
  }
  for (const p of h.potting) {
    const comp = cat.potting(p.compoundPn);
    let areaMm2 = 80;
    if (p.targetKind === "connector") {
      const c = h.connectors.find((x) => x.id === p.targetId);
      const part = c && cat.connector(c.pn);
      const r = (part?.shell.accessoryIdMm ?? 10) / 2;
      areaMm2 = Math.PI * r * r;
    }
    const cc = (areaMm2 * p.depthMm) / 1000;
    add(p.compoundPn, { description: comp?.description ?? "Potting compound", category: "Potting", qty: cc, uom: "cc", massG: cc * (comp?.densityGPerCc ?? 1.1), machineReady: false, known: !!comp, objectId: p.id, status: statusOf(comp) });
    if (p.moldPn) {
      const mold = cat.potting(p.moldPn);
      add(p.moldPn, { description: mold?.description ?? "Potting mold", category: "Potting", qty: 1, uom: "ea", massG: 4, machineReady: false, known: !!mold, objectId: p.id, status: statusOf(mold) });
    }
  }
  for (const x of h.hardware) {
    if (!x.inBom || !x.pn) continue;
    const hp = cat.bundle.hardware.find((y) => y.pn === x.pn);
    add(x.pn, { description: hp?.description ?? x.type, category: "Hardware", qty: 1, uom: "ea", massG: 2, machineReady: false, known: !!hp, objectId: x.id, status: statusOf(hp) });
  }

  const furnished = new Set(project.quote.customerFurnished.map(normalizePn));
  const order = new Map(BOM_CATEGORIES.map((c, i) => [c, i]));
  const lines: BomLine[] = [...acc.values()]
    .filter((a) => a.qty > 0)
    .sort((a, b) => order.get(a.category)! - order.get(b.category)! || a.pn.localeCompare(b.pn))
    .map((a, i) => {
      const s = cat.supply(a.pn);
      // Price break and stock are judged on the purchase quantity (rounded up), never a rounded-down figure.
      const buy = purchaseQty(a, qty);
      const brk = s ? [...s.breaks].reverse().find((b) => buy >= b.qty) ?? s.breaks[0]! : undefined;
      const unitCost = brk?.price ?? 0;
      const cf = furnished.has(normalizePn(a.pn));
      return {
        line: i + 1,
        pn: a.pn,
        description: a.description,
        category: a.category,
        qty: a.qty,
        uom: a.uom,
        refs: [...a.refs].sort((x, y) => x.localeCompare(y, "en", { numeric: true })),
        unitCost,
        extCost: cf ? 0 : +((unitCost * buy) / Math.max(1, qty)).toFixed(4),
        stock: s?.stock ?? 0,
        leadDays: s?.leadDays ?? 60,
        lifecycle: s?.lifecycle ?? "active",
        asOf: s?.asOf ?? "",
        machineReady: a.machineReady,
        alternates: cat.alternates(a.pn),
        massG: a.massG,
        customerFurnished: cf,
        known: a.known,
        dataStatus: a.status,
        dataFields: a.fields,
        qualification: cat.qualification(a.pn),
        stockSufficient: cf || (!!s && s.stock >= buy),
        objectIds: [...a.objectIds],
      };
    });
  const materialCost = +lines.reduce((s, l) => s + l.extCost, 0).toFixed(2);
  const massG = lines.reduce((s, l) => s + l.massG, 0);
  // Critical path: only lines that actually need procurement (stock doesn't cover the order), longest lead first.
  const short = lines.filter((l) => !l.customerFurnished && !l.stockSufficient);
  const critical = [...short].sort((a, b) => b.leadDays - a.leadDays || b.extCost - a.extCost)[0];
  const dates = lines.map((l) => l.asOf).filter(Boolean).sort();
  const asOfRange = { oldest: dates[0] ?? "", newest: dates[dates.length - 1] ?? "" };
  return { lines, materialCost, massG, partCount: lines.reduce((s, l) => s + (l.uom === "ea" ? l.qty : 1), 0), criticalPath: critical, insufficient: short.length, asOf: asOfRange.oldest, asOfRange };
}

/** Resolved label text for a label (templates §6.8). */
export function labelText(project: Project, rev: Revision, h: Harness, labelId: string, pedigreeMarking?: string): string {
  const l = h.labels.find((x) => x.id === labelId);
  if (!l) return "";
  const t = l.attachedTo;
  const refDes = t.kind === "connector" ? h.connectors.find((c) => c.id === t.id)?.refDes : undefined;
  const wire = t.kind === "wire" ? h.wires.find((w) => w.id === t.id) : undefined;
  const seg = t.kind === "segment" ? h.segments.find((s) => s.id === t.id) : undefined;
  return resolveLabelTemplate(l.template, {
    refDes,
    wireId: wire?.label,
    net: wire ? h.nets.find((n) => n.id === wire.netId)?.name : undefined,
    segment: seg?.label,
    harnessPN: project.partNumber,
    rev: rev.label,
    pedigreeMarking,
  });
}
