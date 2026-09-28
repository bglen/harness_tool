import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff?url";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff?url";
import mono400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?url";
import { currentRevision, stableStringify, type Project, type Revision } from "@hs/model";
import { buildDocData, registerFonts, renderDrawingPdf, renderReportPdf, type QuoteSnapshot, type SectionId } from "@hs/docs";
import { bomTable, buildZip, dfmTable, pinoutTable, toCsv, toXlsx, wireListTable, type PackageFile } from "@hs/io";
import { computeBom } from "@hs/ops";
import { pedigreeColor, wireColor } from "@hs/ui-tokens";
import { getProject } from "../store/project";
import { useAnalysis } from "../store/analysis";
import { svc } from "./services";
import { downloadBlob, safeName } from "./files";

const TOOL_VERSION = "0.1.0";

export function docData(project: Project = getProject(), revisionId?: string) {
  registerFonts({ inter400, inter600, mono400 });
  const rev = revisionId ? project.revisions.find((r) => r.id === revisionId)! : currentRevision(project);
  const ped = project.pedigreeScheme.pedigrees.find((p) => p.id === rev.activePedigreeId);
  const snap = rev.frozen ? (rev.snapshot as { quote?: QuoteSnapshot } | undefined)?.quote : undefined;
  const live = useAnalysis.getState().quotes[rev.activePedigreeId] as unknown as QuoteSnapshot | undefined;
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

export async function reportBlob(revisionId?: string, opts: { sections?: Partial<Record<SectionId, boolean>>; hideQuote?: boolean } = {}) {
  const p = getProject();
  return renderReportPdf(docData(p, revisionId), { sections: opts.sections ?? (p.report.sections as Partial<Record<SectionId, boolean>>), hideQuote: opts.hideQuote });
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

export const PACKAGE_PRESETS: { id: string; name: string; items: PackageItem[]; hideQuote?: boolean }[] = [
  { id: "full", name: "Full release", items: ["drawing", "report", "bom", "wirelist", "pinouts", "dfm", "design", "rules", "pricing"] },
  { id: "review", name: "Design review", items: ["drawing", "report", "pricing"] },
  { id: "fab", name: "Fabrication", items: ["drawing", "bom", "wirelist", "design"] },
  { id: "customer", name: "Customer handoff", items: ["drawing", "report", "design"], hideQuote: true },
];

/** A project restricted to one revision, for the design file inside a package (stable bytes for frozen revisions). */
function projectForRevision(p: Project, rev: Revision): Project {
  const idx = p.revisions.findIndex((r) => r.id === rev.id);
  return { ...p, revisions: p.revisions.slice(0, idx + 1), currentRevisionId: rev.id, updated: rev.frozen && rev.frozenAt ? rev.frozenAt : p.updated };
}

/** Generate the output package ZIP with manifest (§13.3). */
export async function buildOutputPackage(items: PackageItem[], opts: { revisionId?: string; hideQuote?: boolean } = {}) {
  const p0 = getProject();
  const rev = opts.revisionId ? p0.revisions.find((r) => r.id === opts.revisionId)! : currentRevision(p0);
  const p = projectForRevision(p0, rev);
  const cat = svc().cat;
  const b = base(p, rev);
  const date = (rev.frozen && rev.frozenAt ? rev.frozenAt : new Date().toISOString()).slice(0, 10).replace(/-/g, "");
  const root = `${b}_${date}`;
  const data = docData(p, rev.id);
  const pricing = items.includes("pricing") && !opts.hideQuote;
  const files: PackageFile[] = [];
  if (items.includes("drawing")) files.push({ path: `${b}_Drawing.pdf`, data: new Uint8Array(await (await renderDrawingPdf(data)).arrayBuffer()) });
  if (items.includes("report")) files.push({ path: `${b}_Design_Report.pdf`, data: new Uint8Array(await (await renderReportPdf(data, { sections: p.report.sections as never, hideQuote: opts.hideQuote || !pricing })).arrayBuffer()) });
  if (items.includes("bom")) {
    const t = bomTable(computeBom(p, rev, cat, undefined, p.quote.selected.qty), { pricing });
    files.push({ path: `${b}_BOM.csv`, data: toCsv(t) }, { path: `${b}_BOM.xlsx`, data: await toXlsx([t]) });
  }
  if (items.includes("wirelist")) files.push({ path: `${b}_WireList.csv`, data: toCsv(wireListTable(p, cat, rev)) });
  if (items.includes("pinouts") || items.includes("wirelist")) files.push({ path: `${b}_Pinouts.csv`, data: toCsv(pinoutTable(p, cat, rev)) });
  if (items.includes("dfm")) files.push({ path: `${b}_DFM_Results.csv`, data: toCsv(dfmTable(data.dfm)) });
  if (items.includes("design")) files.push({ path: `design/${b}.harness.json`, data: stableStringify(p, 2) + "\n" });
  if (items.includes("rules")) {
    for (const rs of p.rulesets) files.push({ path: `rules/${rs.id}_v${rs.version}.harnessrules.json`, data: stableStringify(rs, 2) + "\n" });
    files.push({ path: `rules/project_${safeName(p.pedigreeScheme.id)}_v${p.pedigreeScheme.version}.harnessrules.json`, data: stableStringify({ schemaVersion: 1, id: `prj-${p.id.slice(0, 8)}`, name: `${p.name} project rules`, prefix: "PRJ", version: p.pedigreeScheme.version, rules: p.projectRules, pedigreeScheme: p.pedigreeScheme }, 2) + "\n" });
  }
  const { zip, manifest } = await buildZip(
    root,
    files,
    {
      schemaVersion: 1,
      package: root,
      generatedAt: data.generatedAt,
      generatedBy: `Harness Studio ${TOOL_VERSION}`,
      designHash: data.designHash,
      project: { name: p.name, partNumber: p.partNumber, revision: rev.label, frozen: rev.frozen },
      pedigree: { id: data.ped.id, name: data.ped.name, code: data.ped.code, schemeVersion: p.pedigreeScheme.version },
      versions: { tool: TOOL_VERSION, machineProfile: svc().profile.version, catalog: cat.version.hash, rulesets: p.rulesets.map((r) => ({ id: r.id, name: r.name, version: r.version })) },
      demoPricing: pricing,
    },
    new Date(data.generatedAt),
  );
  return { zip, manifest, name: `${root}.zip` };
}
