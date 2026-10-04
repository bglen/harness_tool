import {
  contactPnFor,
  currentRevision,
  derive,
  formatWireColor,
  projectForRevision,
  resolveLabelTemplate,
  resolvePedigree,
  sha256HexSync,
  stableStringify,
  type CatalogIndex,
  type Derived,
  type InspectionType,
  type MachineProfile,
  type Project,
  type ResolvedPedigree,
  type Revision,
  wireEndLabel,
  leadEndAt,
} from "@hs/model";
import { computeBom, deriveOperations, type Bom, type OperationsList } from "@hs/ops";
import { runDfm, type DfmSummary } from "@hs/dfm";

export interface QuoteSnapshot {
  state: string;
  reason?: string;
  tiers: { id: string; name: string; days: number }[];
  quantities: number[];
  cells: { qty: number; tier: string; unit: number; total: number; shipDate: string; breakdown: { materials: number; machine: number; manual: number; inspection: number; nre: number; nrePerUnit: number; inspectionItems: { name: string; amount: number; sampling: string }[] } }[];
  validUntil: string;
  asOf: string;
  criticalPart?: { pn: string; leadDays: number };
}

export interface DocData {
  project: Project;
  rev: Revision;
  ped: ResolvedPedigree;
  cat: CatalogIndex;
  d: Derived;
  bom: Bom;
  ops: OperationsList;
  dfm: DfmSummary;
  quote?: QuoteSnapshot;
  inspections: InspectionType[];
  profile: MachineProfile;
  generatedAt: string;
  designHash: string;
  draft: boolean;
  toolVersion: string;
  pedigreeColor: string;
  printWire: (code: number) => string;
  connectorRows: { refDes: string; pn: string; description: string; rows: { cavity: string; size: string; signal: string; wire: string; gauge: string; color: string; colorCode: number[]; contact: string }[] }[];
  wireRows: { id: string; net: string; from: string; to: string; gauge: number; spec: string; color: string; colorCode: number[]; lengthMm: number; twist: string; shield: string }[];
  labelTexts: { text: string; pn: string; where: string }[];
}

/** Assemble everything the drawing and report need from the model (one source of truth). */
export function buildDocData(opts: {
  project: Project;
  cat: CatalogIndex;
  profile: MachineProfile;
  inspections: InspectionType[];
  quote?: QuoteSnapshot;
  generatedAt?: string;
  toolVersion?: string;
  pedigreeColor: string;
  printWire: (code: number) => string;
  revisionId?: string;
}): DocData {
  const { cat, profile, inspections } = opts;
  const rev0 = opts.revisionId ? opts.project.revisions.find((r) => r.id === opts.revisionId)! : currentRevision(opts.project);
  // Released revisions are documented with their release inputs (settings, rules, pedigree), not today's.
  const project = projectForRevision(opts.project, rev0.id);
  const rev = currentRevision(project);
  const h = rev.harness;
  const ped = resolvePedigree(project.pedigreeScheme, rev.activePedigreeId);
  const d = derive(h, cat, project.settings, { breakoutAllowanceMm: profile.capabilities.breakoutAllowanceMm });
  const bom = computeBom(project, rev, cat, d, project.quote.selected.qty);
  const ops = deriveOperations(project, rev, cat, profile, ped, inspections, d);
  const dfm = runDfm({ project, rev, cat, profile });
  // Content identity: SHA-256 of the canonical harness (short form shown on documents).
  const designHash = (rev.release?.designSha256 ?? sha256HexSync(stableStringify(h))).slice(0, 16);
  const connectorRows = [...h.connectors]
    .sort((a, b) => a.refDes.localeCompare(b.refDes, "en", { numeric: true }))
    .map((c) => {
      const part = cat.connector(c.pn);
      return {
        refDes: c.refDes,
        pn: c.pn,
        description: part?.description ?? "",
        rows: (part?.arrangement.cavities ?? []).map((cav) => {
          const net = c.pins[cav.id]?.netId ? h.nets.find((n) => n.id === c.pins[cav.id]!.netId) : undefined;
          const w = h.wires.find((x) => [x.from, x.to].some((e) => e.kind === "pin" && e.connectorId === c.id && e.cavityId === cav.id));
          return {
            cavity: cav.id,
            size: cav.size,
            signal: net?.name ?? (c.pins[cav.id]?.noConnect ? project.settings.noConnectLabel : ""),
            wire: w?.label ?? "",
            gauge: w ? String(w.gauge) : "",
            color: w ? formatWireColor(w.color) : "",
            colorCode: w ? [w.color.base, ...w.color.stripes] : [],
            contact: part?.flyingLead ? (w ? `lead end, ${leadEndAt(c, cav.id).finish}, ${leadEndAt(c, cav.id).stripMm} mm strip` : "") : net ? contactPnFor(h, cat, c.id, cav.id, w?.gauge) ?? "" : cav.special ? "(shielded, Phase 2)" : `${cat.sealingPlug(cav.size)?.pn ?? ""} (plug)`,
          };
        }),
      };
    });
  const endLabel = (e: (typeof h.wires)[number]["from"]) => wireEndLabel(h, e);
  const wireRows = [...h.wires]
    .sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }))
    .map((w) => ({
      id: w.label,
      net: h.nets.find((n) => n.id === w.netId)?.name ?? "",
      from: endLabel(w.from),
      to: endLabel(w.to),
      gauge: w.gauge,
      spec: w.spec,
      color: formatWireColor(w.color),
      colorCode: [w.color.base, ...w.color.stripes],
      lengthMm: d.wireLengthMm.get(w.id) ?? 0,
      twist: w.twistGroupId ? `TW${h.twistGroups.findIndex((g) => g.id === w.twistGroupId) + 1}` : "",
      shield: w.shieldId ? h.shields.find((s) => s.id === w.shieldId)?.label ?? "" : "",
    }));
  const labelTexts = h.labels.map((l) => {
    const t = l.attachedTo;
    const refDes = t.kind === "connector" ? h.connectors.find((c) => c.id === t.id)?.refDes : undefined;
    const wire = t.kind === "wire" ? h.wires.find((w) => w.id === t.id) : undefined;
    return { text: resolveLabelTemplate(l.template, { refDes, wireId: wire?.label, harnessPN: project.partNumber, rev: rev.label }), pn: l.pn, where: t.kind === "connector" ? refDes ?? "" : t.kind === "wire" ? wire?.label ?? "" : "bundle" };
  });
  return {
    project,
    rev,
    ped,
    cat,
    d,
    bom,
    ops,
    dfm,
    quote: opts.quote,
    inspections,
    profile,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    designHash,
    draft: !rev.frozen,
    toolVersion: opts.toolVersion ?? "0.1.0",
    pedigreeColor: opts.pedigreeColor,
    printWire: opts.printWire,
    connectorRows,
    wireRows,
    labelTexts,
  };
}
