import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff?url";
import mono400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?url";
import { currentRevision, projectForRevision, sha256HexSync, stableStringify, type Project, type Revision } from "@hs/model";
import { buildDocData, registerFonts, renderDrawingPdf, renderReportPdf, type QuoteSnapshot, type Redaction, type SectionId } from "@hs/docs";
import type { DfmSummary } from "@hs/dfm";
import { bomTable, buildZip, dfmTable, pinoutTable, toCsv, toXlsx, wireListTable, type PackageFile } from "@hs/io";
import { computeBom } from "@hs/ops";
import { pedigreeColor, wireColor } from "@hs/ui-tokens";
import { getProject } from "../store/project";
import { useAnalysis } from "../store/analysis";
import { svc } from "./services";
import { downloadBlob, safeName } from "./files";

export const TOOL_VERSION = "0.2.0";

export function docData(project: Project = getProject(), revisionId?: string) {
  registerFonts({ inter400, inter600, mono400 });
  const rev = revisionId ? project.revisions.find((r) => r.id === revisionId)! : currentRevision(project);
  const view = projectForRevision(project, rev.id);
  const vrev = currentRevision(view);
  const ped = view.pedigreeScheme.pedigrees.find((p) => p.id === vrev.activePedigreeId);
  // Frozen revisions use the pricing/stock recorded at release; never today's numbers.
  const snap = rev.frozen ? ((rev.release?.results.quote ?? (rev.legacySnapshot as { quote?: QuoteSnapshot } | undefined)?.quote) as QuoteSnapshot | undefined) : undefined;
  const live = rev.frozen ? undefined : (useAnalysis.getState().quotes[vrev.activePedigreeId] as unknown as QuoteSnapshot | undefined);
  return buildDocData({
    project,
    revisionId: rev.id,
    cat: svc().cat,
    profile: svc().profile,
    inspections: svc().inspections,
    quote: snap ?? live,
    // Frozen revisions are deterministic: stamp with the freeze time
    generatedAt: rev.frozen && rev.frozenAt ? rev.frozenAt : new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    pedigreeColor: pedigreeColor(ped?.color ?? 0, "light"),
    printWire: (c) => wireColor(c, "print"),
  });
}

function base(project: Project, rev: Revision) {
  return `${safeName(project.partNumber)}_Rev${rev.label}`;
}

export async function drawingBlob(revisionId?: string) {
  return renderDrawingPdf(docData(getProject(), revisionId));
}

export async function reportBlob(revisionId?: string, opts: { sections?: Partial<Record<SectionId, boolean>>; hideQuote?: boolean; redact?: Redaction } = {}) {
  const p = getProject();
  return renderReportPdf(docData(p, revisionId), { sections: opts.sections ?? (p.report.sections as Partial<Record<SectionId, boolean>>), hideQuote: opts.hideQuote, redact: opts.redact });
}

export async function downloadDrawing() {
  const p = getProject();
  downloadBlob(`${base(p, currentRevision(p))}_Drawing.pdf`, await drawingBlob());
}

export async function downloadReport() {
  const p = getProject();
  downloadBlob(`${base(p, currentRevision(p))}_Design_Report.pdf`, await reportBlob());
}

export type PackageItem = "drawing" | "report" | "bom" | "wirelist" | "pinouts" | "dfm" | "design" | "rules" | "pricing";

/**
 * Audience presets. `redact` is applied to EVERY file in the package (report sections, BOM columns, DFM supply
 * findings, the native design file), not just the quote section (feedback §7).
 */
export const PACKAGE_PRESETS: { id: string; name: string; items: PackageItem[]; redact: Redaction }[] = [
  { id: "full", name: "Full release (internal)", items: ["drawing", "report", "bom", "wirelist", "pinouts", "dfm", "design", "rules", "pricing"], redact: {} },
  { id: "review", name: "Design review", items: ["drawing", "report", "pricing"], redact: {} },
  { id: "fab", name: "Fabrication", items: ["drawing", "bom", "wirelist", "design"], redact: { pricing: true } },
  { id: "customer", name: "Customer handoff (no prices or supply)", items: ["drawing", "report", "design"], redact: { pricing: true, supply: true } },
];

/** Rule types whose findings disclose supply data (stock, lead time). */
const SUPPLY_RULE_TYPES = new Set(["out_of_stock", "lead_time_vs_tier", "lifecycle"]);

function redactDfm(s: DfmSummary, r: Redaction): DfmSummary {
  if (!r.supply) return s;
  return { ...s, results: s.results.filter((x) => !SUPPLY_RULE_TYPES.has(x.eff.rule.type)) };
}

/** The native design file with commercial data removed per the redaction policy. */
function redactProject(p: Project, r: Redaction): Project {
  if (!r.pricing && !r.supply) return p;
  return {
    ...p,
    quote: { ...p.quote, customerFurnishedArrivalDays: r.supply ? {} : p.quote.customerFurnishedArrivalDays },
    revisions: p.revisions.map((rev) => (rev.release ? { ...rev, release: { ...rev.release, results: { ...rev.release.results, quote: undefined } } } : { ...rev, legacySnapshot: undefined })),
  };
}

/** Deterministic CSV/JSON outputs of a revision and their SHA-256 (recorded at release, re-checked on export). */
export function releaseOutputHashes(project: Project, revisionId: string): { path: string; sha256: string }[] {
  const view = projectForRevision(project, revisionId);
  const rev = currentRevision(view);
  const cat = svc().cat;
  const files: [string, string][] = [
    ["WireList.csv", toCsv(wireListTable(view, cat, rev))],
    ["Pinouts.csv", toCsv(pinoutTable(view, cat, rev))],
    ["BOM.csv", toCsv(bomTable(computeBom(view, rev, cat, undefined, view.quote.selected.qty), { pricing: false }))],
  ];
  return files.map(([path, data]) => ({ path, sha256: sha256HexSync(data) }));
}

/** Generate the output package ZIP with manifest (§13.3). */
export async function buildOutputPackage(items: PackageItem[], opts: { revisionId?: string; hideQuote?: boolean; redact?: Redaction } = {}) {
  const p0 = getProject();
  const rev0 = opts.revisionId ? p0.revisions.find((r) => r.id === opts.revisionId)! : currentRevision(p0);
  const redact: Redaction = { ...opts.redact, pricing: opts.redact?.pricing || opts.hideQuote || !items.includes("pricing") };
  // Released revisions: every file is generated from the release inputs.
  const p = projectForRevision(p0, rev0.id);
  const rev = currentRevision(p);
  const cat = svc().cat;
  const b = base(p, rev);
  const date = (rev.frozen && rev.frozenAt ? rev.frozenAt : new Date().toISOString()).slice(0, 10).replace(/-/g, "");
  const root = `${b}_${date}`;
  const data0 = docData(p0, rev.id);
  // Supply findings (stock, lead time) are removed from every document when supply is redacted.
  const data = { ...data0, dfm: redactDfm(data0.dfm, redact) };
  const pricing = !redact.pricing;
  const files: PackageFile[] = [];
  if (items.includes("drawing")) files.push({ path: `${b}_Drawing.pdf`, data: new Uint8Array(await (await renderDrawingPdf(data)).arrayBuffer()) });
  if (items.includes("report")) files.push({ path: `${b}_Design_Report.pdf`, data: new Uint8Array(await (await renderReportPdf(data, { sections: p.report.sections as never, redact })).arrayBuffer()) });
  if (items.includes("bom")) {
    const t = bomTable(computeBom(p, rev, cat, undefined, p.quote.selected.qty), { pricing, supply: !redact.supply });
    files.push({ path: `${b}_BOM.csv`, data: toCsv(t) }, { path: `${b}_BOM.xlsx`, data: await toXlsx([t]) });
  }
  if (items.includes("wirelist")) files.push({ path: `${b}_WireList.csv`, data: toCsv(wireListTable(p, cat, rev)) });
  if (items.includes("pinouts") || items.includes("wirelist")) files.push({ path: `${b}_Pinouts.csv`, data: toCsv(pinoutTable(p, cat, rev)) });
  if (items.includes("dfm")) files.push({ path: `${b}_DFM_Results.csv`, data: toCsv(dfmTable(data.dfm, rev.harness)) });
  if (items.includes("design")) files.push({ path: `design/${b}.harness.json`, data: stableStringify(redactProject(p, redact), 2) + "\n" });
  if (items.includes("rules")) {
    for (const rs of p.rulesets) files.push({ path: `rules/${rs.id}_v${rs.version}.harnessrules.json`, data: stableStringify(rs, 2) + "\n" });
    files.push({ path: `rules/project_${safeName(p.pedigreeScheme.id)}_v${p.pedigreeScheme.version}.harnessrules.json`, data: stableStringify({ schemaVersion: 1, id: `prj-${p.id.slice(0, 8)}`, name: `${p.name} project rules`, prefix: "PRJ", version: p.pedigreeScheme.version, rules: p.projectRules, pedigreeScheme: p.pedigreeScheme }, 2) + "\n" });
  }
  // A released revision's deterministic outputs must match what was recorded at release.
  const releaseCheck = rev.frozen && rev.release?.outputs.length ? compareRelease(rev.release.outputs, releaseOutputHashes(p0, rev.id)) : undefined;
  const { zip, manifest } = await buildZip(
    root,
    files,
    {
      schemaVersion: 1,
      package: root,
      generatedAt: data.generatedAt,
      generatedBy: `Harness Studio ${TOOL_VERSION}`,
      designHash: rev.release?.designSha256 ?? sha256HexSync(stableStringify(rev.harness)),
      project: { name: p.name, partNumber: p.partNumber, revision: rev.label, frozen: rev.frozen },
      pedigree: { id: data.ped.id, name: data.ped.name, code: data.ped.code, schemeVersion: p.pedigreeScheme.version },
      versions: { tool: TOOL_VERSION, machineProfile: svc().profile.version, catalog: cat.version.hash, rulesets: p.rulesets.map((r) => ({ id: r.id, name: r.name, version: r.version })) },
      demoPricing: pricing,
      redaction: { pricing: !!redact.pricing, supply: !!redact.supply },
      release: rev.release ? { releasedAt: rev.release.releasedAt, inputsSha256: rev.release.inputsSha256, catalogAtRelease: rev.release.versions.catalog.hash, outputsMatchRelease: releaseCheck?.ok ?? null, differences: releaseCheck?.differences ?? [] } : undefined,
    },
    new Date(data.generatedAt),
  );
  return { zip, manifest, name: `${root}.zip`, releaseCheck };
}

function compareRelease(recorded: { path: string; sha256: string }[], now: { path: string; sha256: string }[]) {
  const differences = recorded.filter((r) => now.find((n) => n.path === r.path)?.sha256 !== r.sha256).map((r) => r.path);
  return { ok: differences.length === 0, differences };
}
