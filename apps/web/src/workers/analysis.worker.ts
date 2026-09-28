/// <reference lib="webworker" />
import { CatalogIndex, currentRevision, derive, resolvePedigree, type CatalogBundle, type InspectionType, type MachineProfile, type Project } from "@hs/model";
import { DfmCache, runDfm, type DfmSummary } from "@hs/dfm";
import { buildQuoteSummary, computeBom, deriveOperations, type QuoteSummary } from "@hs/ops";

export interface AnalysisRequest {
  type: "run";
  seq: number;
  project: Project;
  pedigreeIds: string[];
  qty: number;
  tierDays: number;
}

export interface AnalysisResult {
  type: "result";
  seq: number;
  pedigreeId: string;
  dfm: DfmSummary;
  summary: QuoteSummary;
  massG: number;
  materialCost: number;
  ms: number;
}

let cat: CatalogIndex | undefined;
let profile: MachineProfile | undefined;
let inspections: InspectionType[] = [];
let latest = 0;
const cache = new DfmCache();

const ready = (async () => {
  const [bundle, prof, insp] = await Promise.all([
    fetch("/catalog/38999-III.json").then((r) => r.json() as Promise<CatalogBundle>),
    fetch("/catalog/profile.json").then((r) => r.json() as Promise<MachineProfile>),
    fetch("/catalog/inspections.json").then((r) => r.json() as Promise<InspectionType[]>),
  ]);
  cat = new CatalogIndex(bundle);
  profile = prof;
  inspections = insp;
})();

const yieldToQueue = () => new Promise((r) => setTimeout(r, 0));

self.onmessage = async (e: MessageEvent<AnalysisRequest>) => {
  if (e.data.type !== "run") return;
  const req = e.data;
  latest = req.seq;
  await ready;
  for (const pid of req.pedigreeIds) {
    if (req.seq !== latest) return; // a newer edit superseded this run
    const t0 = performance.now();
    const project = req.project;
    const rev = currentRevision(project);
    const ped = resolvePedigree(project.pedigreeScheme, pid);
    const dfm = runDfm({ project, rev, cat: cat!, profile: profile!, pedigreeId: pid, qty: req.qty, tierDays: req.tierDays, cache });
    const d = derive(rev.harness, cat!, project.settings, { breakoutAllowanceMm: profile!.capabilities.breakoutAllowanceMm });
    const bom = computeBom(project, rev, cat!, d, req.qty);
    const ops = deriveOperations(project, rev, cat!, profile!, ped, inspections, d);
    const designErrors = dfm.design.errors;
    const summary = buildQuoteSummary(
      bom,
      ops,
      ped,
      { mfgErrors: dfm.manufacturability.errors, mfgWarnings: dfm.manufacturability.warnings, designErrors, hash: dfm.hash, nonStock: bom.lines.filter((l) => l.stock < l.qty * req.qty).length },
      { connectors: rev.harness.connectors.length, uniqueConnectors: new Set(rev.harness.connectors.map((c) => c.pn)).size, wires: rev.harness.wires.length, wireLengthM: d.totalWireMm / 1000, massG: bom.massG },
    );
    const msg: AnalysisResult = { type: "result", seq: req.seq, pedigreeId: pid, dfm, summary, massG: bom.massG, materialCost: bom.materialCost, ms: performance.now() - t0 };
    (self as unknown as Worker).postMessage(msg);
    await yieldToQueue();
  }
};
