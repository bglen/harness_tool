import { derive, extentCoverage, type CatalogIndex, type Derived, type InspectionType, type MachineProfile, type Project, type ResolvedPedigree, type Revision } from "@hs/model";

export type OpKind =
  | "connectorLoad"
  | "backshell"
  | "accessory"
  | "contactCrimpInsert"
  | "sealingPlug"
  | "wireCutStrip"
  | "wireLayPerM"
  | "twist"
  | "cableStrip"
  | "shieldTermination"
  | "drainTermination"
  | "overbraidPerM"
  | "tapePerM"
  | "heatShrinkPerM"
  | "sleevePerM"
  | "jacketPerM"
  | "conduitPerM"
  | "bandClamp"
  | "label"
  | "splice"
  | "daisyChain"
  | "potting"
  | "boot"
  | "tieDown"
  | "test"
  | "inspection";

export interface Operation {
  kind: OpKind;
  /** Count (ea) or metres for *PerM kinds. */
  qty: number;
  automated: boolean;
  reason?: string;
  refs: string[];
  /** For inspections */
  inspectionId?: string;
  sampling?: string;
  inHouse?: boolean;
  cureHours?: number;
}

export interface OperationsList {
  ops: Operation[];
  automatedCount: number;
  manualCount: number;
  manualReasons: string[];
  cureHours: number;
}

const OP_LABEL: Record<OpKind, string> = {
  connectorLoad: "Connector placement",
  backshell: "Backshell assembly",
  accessory: "Accessory fit",
  contactCrimpInsert: "Contact crimp + insert",
  sealingPlug: "Sealing plug insertion",
  wireCutStrip: "Wire cut + strip",
  wireLayPerM: "Wire layup",
  twist: "Twisting",
  cableStrip: "Cable jacket/shield strip",
  shieldTermination: "360° shield termination",
  drainTermination: "Drain wire termination",
  overbraidPerM: "Overbraiding",
  tapePerM: "Tape wrap",
  heatShrinkPerM: "Heat shrink",
  sleevePerM: "Sleeving",
  jacketPerM: "Jacketing",
  conduitPerM: "Conduit",
  bandClamp: "Band clamp",
  label: "Labeling",
  splice: "Splice",
  daisyChain: "Daisy-chain double crimp",
  potting: "Potting",
  boot: "Boot / transition",
  tieDown: "Spot ties / lacing",
  test: "Electrical test",
  inspection: "Inspection",
};

export function opLabel(k: OpKind): string {
  return OP_LABEL[k];
}

/** Derive manufacturing operations for a revision (automated vs manual per machine profile). */
export function deriveOperations(project: Project, rev: Revision, cat: CatalogIndex, profile: MachineProfile, ped: ResolvedPedigree, inspections: InspectionType[], d?: Derived): OperationsList {
  const h = rev.harness;
  const caps = profile.capabilities;
  const der = d ?? derive(h, cat, project.settings, { breakoutAllowanceMm: caps.breakoutAllowanceMm });
  const ops: Operation[] = [];
  const push = (kind: OpKind, qty: number, automated: boolean, refs: string[] = [], reason?: string, extra: Partial<Operation> = {}) => {
    if (qty <= 0) return;
    const existing = ops.find((o) => o.kind === kind && o.automated === automated && o.reason === reason && !extra.inspectionId);
    if (existing) {
      existing.qty += qty;
      existing.refs.push(...refs);
    } else ops.push({ kind, qty, automated, refs: [...refs], reason, ...extra });
  };

  const pinWires = new Map<string, number>();
  for (const w of h.wires) for (const e of [w.from, w.to]) if (e.kind === "pin") pinWires.set(`${e.connectorId}:${e.cavityId}`, (pinWires.get(`${e.connectorId}:${e.cavityId}`) ?? 0) + 1);

  for (const c of h.connectors) {
    const part = cat.connector(c.pn);
    const ok = !!part?.machineReady && caps.connectorSlashes.includes(part.slash);
    push("connectorLoad", 1, ok, [c.refDes], ok ? undefined : `${c.refDes}: connector not supported for automated placement`);
    if (c.backshell) push("backshell", 1, caps.automatedFinishing.includes("backshell") && !!cat.backshell(c.backshell.pn)?.machineReady, [c.refDes], cat.backshell(c.backshell.pn)?.machineReady ? undefined : "Potting-boot backshells are fitted by hand");
    if (c.accessories.length) push("accessory", c.accessories.length, false, [c.refDes], "Accessories fitted by hand");
    if (!part) continue;
    for (const cav of part.arrangement.cavities) {
      const n = pinWires.get(`${c.id}:${cav.id}`) ?? 0;
      if (cav.special) continue;
      if (n === 0) {
        if (!c.pins[cav.id]?.filler) push("sealingPlug", 1, caps.automatedFinishing.includes("sealingPlug"), [c.refDes]);
        else push("contactCrimpInsert", 1, false, [`${c.refDes}-${cav.id}`], "Wired spare (filler) contacts inserted by hand");
        continue;
      }
      const cpn = c.pins[cav.id]?.contactPn;
      const contact = cpn ? cat.contactsByPn.get(cpn) : cat.contactFor(cav.size, part.gender);
      const auto = !!contact?.machineInsertable && caps.contactSizes.includes(cav.size) && n === 1;
      push("contactCrimpInsert", 1, auto, [`${c.refDes}-${cav.id}`], auto ? undefined : n > 1 ? "Two wires in one contact (daisy chain)" : `Size ${cav.size} contact inserted by hand`);
      if (n > 1) push("daisyChain", 1, caps.supportsDaisyChain, [`${c.refDes}-${cav.id}`], caps.supportsDaisyChain ? undefined : "Daisy-chain double crimps are manual");
    }
  }

  let layM = 0;
  for (const w of h.wires) {
    const len = der.wireLengthMm.get(w.id) ?? 0;
    const ws = cat.wire(w.spec, w.gauge);
    const inRange = w.gauge <= caps.wireGaugeMin && w.gauge >= caps.wireGaugeMax && len >= caps.minWireLengthMm && len <= caps.maxWireLengthMm;
    const auto = !!ws?.machineReady && inRange && !w.cableId;
    push("wireCutStrip", 1, auto, [w.label], auto ? undefined : w.cableId ? "Cable conductors are prepared by hand" : "Wire gauge or length outside cutter range");
    layM += len / 1000;
  }
  push("wireLayPerM", +layM.toFixed(2), true);
  for (const t of h.twistGroups) push("twist", 1, !t.wireIds.some((id) => h.wires.find((w) => w.id === id)?.cableId), [], undefined);
  for (const c of h.cables) push("cableStrip", 2, false, [c.label], "Cable jacket/shield strip-back is manual");

  for (const t of h.terminations) {
    if (t.method === "band360" || t.method === "emiRing" || t.method === "junction") push("shieldTermination", 1, t.method !== "emiRing", [], t.method === "emiRing" ? "EMI ring termination is manual" : undefined);
    else if (t.method === "drainToPin") push("drainTermination", 1, false, [], "Drain-to-pin solder sleeves are manual");
  }

  const metres = (layerId: string) => {
    const l = h.layers.find((x) => x.id === layerId)!;
    let mm = 0;
    for (const e of l.extents) {
      const s = h.segments.find((x) => x.id === e.segmentId);
      if (s) {
        const [a, b] = extentCoverage(s, e);
        mm += b - a;
      }
    }
    return mm / 1000;
  };
  for (const l of h.layers) {
    const m = +metres(l.id).toFixed(2);
    const part = cat.layer(l.pn);
    const auto = caps.automatedCoverings.includes(l.type) && !!part?.machineReady;
    const kind: OpKind = ({ overbraid: "overbraidPerM", tape: "tapePerM", heatShrink: "heatShrinkPerM", sleeve: "sleevePerM", jacket: "jacketPerM", conduit: "conduitPerM" } as const)[l.type];
    push(kind, m, auto, [], auto ? undefined : `${opLabel(kind)} (${part?.material ?? l.type}) is a manual operation`);
  }
  for (const c of h.clamps) push("bandClamp", c.quantity, caps.automatedFinishing.includes("bandClamp"));
  for (const l of h.labels) push("label", 1, caps.labelTypes.includes(l.type), [], caps.labelTypes.includes(l.type) ? undefined : `${l.type} labels applied by hand`);
  for (const s of h.splices) push("splice", 1, caps.supportsSplices, [s.label], caps.supportsSplices ? undefined : "Splices are manual operations");
  let cure = 0;
  for (const p of h.potting) {
    const comp = cat.potting(p.compoundPn);
    cure = Math.max(cure, comp?.cureHours ?? 24);
    push("potting", 1, caps.supportsPotting, [], caps.supportsPotting ? undefined : "Potting is a manual operation", { cureHours: comp?.cureHours ?? 24 });
  }
  for (const b of h.boots) push("boot", 1, false, [], "Boots and transitions are fitted by hand");
  const ties = h.hardware.filter((x) => x.type !== "cushionClamp").length + h.segments.reduce((s, seg) => s + (seg.tieSpacingMm ? Math.floor(seg.lengthMm / seg.tieSpacingMm) : 0), 0);
  push("tieDown", ties, false, [], "Spot ties and lacing are manual");

  // Tests and inspections from the pedigree (§10.3)
  push("test", 1, true);
  for (const req of ped.inspections) {
    const t = inspections.find((i) => i.id === req.typeId);
    if (!t || t.id === "continuity") continue;
    ops.push({ kind: "inspection", qty: 1, automated: t.inHouse, refs: [], inspectionId: t.id, sampling: req.sampling, inHouse: t.inHouse, reason: t.inHouse ? undefined : `${t.name} is outsourced` });
  }

  for (const o of ops) o.qty = +o.qty.toFixed(3);
  const manual = ops.filter((o) => !o.automated && o.kind !== "inspection");
  return {
    ops,
    automatedCount: ops.filter((o) => o.automated && o.kind !== "inspection").reduce((s, o) => s + (o.kind.endsWith("PerM") ? 1 : o.qty), 0),
    manualCount: manual.reduce((s, o) => s + (o.kind.endsWith("PerM") ? 1 : o.qty), 0),
    manualReasons: [...new Set(manual.map((o) => o.reason).filter(Boolean) as string[])],
    cureHours: cure,
  };
}
