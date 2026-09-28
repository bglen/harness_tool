import {
  contactPnFor,
  derive,
  extentCoverage,
  normalizePn,
  resolveLabelTemplate,
  type Alternate,
  type CatalogIndex,
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
  | "Coverings"
  | "Band clamps"
  | "Boots"
  | "Labels"
  | "Splices"
  | "Potting"
  | "Hardware";

export const BOM_CATEGORIES: BomCategory[] = ["Connectors", "Contacts", "Sealing plugs", "Backshells", "Accessories", "Wire", "Cable", "Coverings", "Band clamps", "Boots", "Labels", "Splices", "Potting", "Hardware"];

export interface BomLine {
  line: number;
  pn: string;
  description: string;
  category: BomCategory;
  qty: number;
  uom: "ea" | "m" | "cc";
  refs: string[];
  unitCost: number;
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
  /** Source object ids (for cross-probing). */
  objectIds: string[];
}

export interface Bom {
  lines: BomLine[];
  materialCost: number;
  massG: number;
  partCount: number;
  criticalPath?: BomLine;
  asOf: string;
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
  objectIds: Set<string>;
}

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
  const add = (pn: string, f: Omit<Acc, "pn" | "refs" | "objectIds" | "qty" | "massG"> & { qty: number; ref?: string; massG?: number; objectId?: string }) => {
    const key = `${f.category}|${normalizePn(pn)}`;
    let a = acc.get(key);
    if (!a) {
      a = { pn, description: f.description, category: f.category, qty: 0, uom: f.uom, refs: new Set(), massG: 0, machineReady: f.machineReady, known: f.known, objectIds: new Set() };
      acc.set(key, a);
    }
    a.qty += f.qty;
    a.massG += f.massG ?? 0;
    if (f.ref) a.refs.add(f.ref);
    if (f.objectId) a.objectIds.add(f.objectId);
  };

  const wiresAtPin = new Map<string, number[]>();
  for (const w of h.wires)
    for (const e of [w.from, w.to]) if (e.kind === "pin") (wiresAtPin.get(`${e.connectorId}:${e.cavityId}`) ?? wiresAtPin.set(`${e.connectorId}:${e.cavityId}`, []).get(`${e.connectorId}:${e.cavityId}`)!).push(w.gauge);

  // Connectors, contacts, sealing plugs, backshells, accessories
  for (const c of h.connectors) {
    const part = cat.connector(c.pn);
    add(part?.pn ?? c.pn, { description: part?.description ?? "Unknown connector", category: "Connectors", qty: 1, uom: "ea", ref: c.refDes, massG: part?.massG ?? 0, machineReady: !!part?.machineReady, known: !!part, objectId: c.id });
    if (part) {
      for (const cav of part.arrangement.cavities) {
        const key = `${c.id}:${cav.id}`;
        const gauges = wiresAtPin.get(key);
        const pin = c.pins[cav.id];
        if (cav.special) continue; // coax/twinax cavities: sealed per connector supplier (Phase 2)
        if (gauges || pin?.filler) {
          const gauge = gauges ? Math.max(...gauges) : 22;
          const cpn = contactPnFor(h, cat, c.id, cav.id, gauge);
          const cp = cpn ? cat.contactsByPn.get(cpn) : undefined;
          add(cpn ?? `CONTACT-${cav.size}`, { description: cp ? `Crimp contact, size ${cp.size}, ${cp.gender}, ${cp.gaugeMin}–${cp.gaugeMax} AWG` : `Contact size ${cav.size} (no catalog part)`, category: "Contacts", qty: 1, uom: "ea", ref: `${c.refDes}-${cav.id}`, massG: 0.25, machineReady: !!cp?.machineInsertable, known: !!cp, objectId: c.id });
        } else {
          const sp = cat.sealingPlug(cav.size);
          add(sp?.pn ?? `PLUG-${cav.size}`, { description: sp ? `Sealing plug, size ${cav.size} (${sp.color})` : `Sealing plug size ${cav.size}`, category: "Sealing plugs", qty: 1, uom: "ea", ref: c.refDes, massG: 0.1, machineReady: true, known: !!sp, objectId: c.id });
        }
      }
    }
    if (c.backshell) {
      const bs = cat.backshell(c.backshell.pn);
      add(c.backshell.pn, { description: bs?.description ?? "Backshell", category: "Backshells", qty: 1, uom: "ea", ref: c.refDes, massG: bs?.massG ?? 0, machineReady: !!bs?.machineReady, known: !!bs, objectId: c.id });
    }
    for (const a of c.accessories) {
      const ap = cat.bundle.accessories.find((x) => normalizePn(x.pn) === normalizePn(a.pn));
      add(a.pn, { description: ap?.description ?? a.kind, category: "Accessories", qty: 1, uom: "ea", ref: c.refDes, massG: ap?.massG ?? 0, machineReady: true, known: !!ap, objectId: c.id });
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
    });
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
        const stack = der.segStack.get(s.id) ?? [];
        const idx = stack.findIndex((x) => x.layer.id === l.id);
        const under = idx > 0 ? stack[idx - 1]!.odAfterMm : (der.segCoreOdMm.get(s.id) ?? 3);
        acc2.tapeMm += tapeLengthMm(b - a, under, l.params.overlapPct ?? 50);
      }
    }
    for (const [pn, { runMm, tapeMm }] of perPn) {
      const part = cat.layer(pn);
      const lenMm = l.type === "tape" ? tapeMm : runMm * 1.05; // 5 % allowance for trimming
      add(pn || `LAYER-${l.type}`, { description: part?.description ?? l.type, category: "Coverings", qty: lenMm / 1000, uom: "m", massG: ((part?.massGPerM ?? 10) * runMm) / 1000, machineReady: !!part?.machineReady, known: !!part, objectId: l.id });
    }
  }
  for (const c of h.clamps) {
    const cp = cat.clamp(c.pn);
    add(c.pn || "CLAMP", { description: cp?.description ?? "Band clamp", category: "Band clamps", qty: c.quantity, uom: "ea", massG: (cp?.massG ?? 2) * c.quantity, machineReady: true, known: !!cp, objectId: c.id });
  }
  for (const b of h.boots) {
    const bp = cat.boot(b.pn);
    add(b.pn || "BOOT", { description: bp?.description ?? "Boot", category: "Boots", qty: 1, uom: "ea", massG: bp?.massG ?? 5, machineReady: false, known: !!bp, objectId: b.id });
  }
  for (const l of h.labels) {
    const lp = cat.label(l.pn);
    add(l.pn || "LABEL", { description: lp?.description ?? "Label", category: "Labels", qty: 1, uom: "ea", massG: 0.3, machineReady: true, known: !!lp, objectId: l.id });
  }
  for (const s of h.splices) {
    const sp = cat.splice(s.pn);
    add(s.pn || "SPLICE", { description: sp?.description ?? "Splice", category: "Splices", qty: 1, uom: "ea", ref: s.label, massG: sp?.massG ?? 1, machineReady: false, known: !!sp, objectId: s.id });
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
    const cc = +((areaMm2 * p.depthMm) / 1000).toFixed(1);
    add(p.compoundPn, { description: comp?.description ?? "Potting compound", category: "Potting", qty: cc, uom: "cc", massG: cc * (comp?.densityGPerCc ?? 1.1), machineReady: false, known: !!comp, objectId: p.id });
    if (p.moldPn) {
      const mold = cat.potting(p.moldPn);
      add(p.moldPn, { description: mold?.description ?? "Potting mold", category: "Potting", qty: 1, uom: "ea", massG: 4, machineReady: false, known: !!mold, objectId: p.id });
    }
  }
  for (const x of h.hardware) {
    if (!x.inBom || !x.pn) continue;
    const hp = cat.bundle.hardware.find((y) => y.pn === x.pn);
    add(x.pn, { description: hp?.description ?? x.type, category: "Hardware", qty: 1, uom: "ea", massG: 2, machineReady: false, known: !!hp, objectId: x.id });
  }

  const furnished = new Set(project.quote.customerFurnished.map(normalizePn));
  const order = new Map(BOM_CATEGORIES.map((c, i) => [c, i]));
  const lines: BomLine[] = [...acc.values()]
    .filter((a) => a.qty > 0)
    .sort((a, b) => order.get(a.category)! - order.get(b.category)! || a.pn.localeCompare(b.pn))
    .map((a, i) => {
      const s = cat.supply(a.pn);
      const q = a.uom === "ea" ? a.qty : +a.qty.toFixed(2);
      const total = q * qty;
      const brk = s ? [...s.breaks].reverse().find((b) => total >= b.qty) ?? s.breaks[0]! : undefined;
      const unitCost = brk?.price ?? 0;
      const cf = furnished.has(normalizePn(a.pn));
      return {
        line: i + 1,
        pn: a.pn,
        description: a.description,
        category: a.category,
        qty: q,
        uom: a.uom,
        refs: [...a.refs].sort((x, y) => x.localeCompare(y, "en", { numeric: true })),
        unitCost,
        extCost: cf ? 0 : +(unitCost * q).toFixed(2),
        stock: s?.stock ?? 0,
        leadDays: s?.leadDays ?? 60,
        lifecycle: s?.lifecycle ?? "active",
        asOf: s?.asOf ?? "",
        machineReady: a.machineReady,
        alternates: cat.alternates(a.pn),
        massG: +a.massG.toFixed(2),
        customerFurnished: cf,
        known: a.known,
        objectIds: [...a.objectIds],
      };
    });
  const materialCost = +lines.reduce((s, l) => s + l.extCost, 0).toFixed(2);
  const massG = lines.reduce((s, l) => s + l.massG, 0);
  const critical = lines.filter((l) => !l.customerFurnished).sort((a, b) => b.leadDays - a.leadDays || b.extCost - a.extCost)[0];
  const asOf = lines.map((l) => l.asOf).filter(Boolean).sort().pop() ?? "";
  return { lines, materialCost, massG, partCount: lines.reduce((s, l) => s + (l.uom === "ea" ? l.qty : 1), 0), criticalPath: critical, asOf };
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
