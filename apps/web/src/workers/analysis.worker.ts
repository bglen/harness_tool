/// <reference lib="webworker" />
import { CatalogIndex, configureForPedigree, currentRevision, derive, resolvePedigree, type CatalogBundle, type InspectionType, type MachineProfile, type Project } from "@hs/model";
import { DfmCache, runDfm, type DfmSummary } from "@hs/dfm";
import { computeBom, deriveOperations, type QuoteSummary } from "@hs/ops";
import { makeQuoteSummary } from "../lib/summary";

/** Sent once by the main thread with the catalog/profile snapshot it loaded through the provider interfaces. */
export interface AnalysisInit {
  type: "init";
  bundle: CatalogBundle;
  profile: MachineProfile;
  inspections: InspectionType[];
}

export interface AnalysisRequest {
  type: "run";
  /** Generation: results from older generations are never shown as current. */
  seq: number;
  projectId: string;
  revisionId: string;
  /** Already the release view for frozen revisions. */
  project: Project;
  pedigreeIds: string[];
  qty: number;
  tierDays: number;
}

export interface AnalysisResult {
  type: "result";
  seq: number;
  projectId: string;
  revisionId: string;
  pedigreeId: string;
  dfm: DfmSummary;
  summary: QuoteSummary;
  massG: number;
  materialCost: number;
  ms: number;
}

export interface AnalysisError {
  type: "error";
  seq: number;
  projectId: string;
  revisionId: string;
  pedigreeId?: string;
  message: string;
}

let cat: CatalogIndex | undefined;
let profile: MachineProfile | undefined;
let inspections: InspectionType[] = [];
let latest = 0;
const cache = new DfmCache();
let pendingRun: AnalysisRequest | undefined;

const yieldToQueue = () => new Promise((r) => setTimeout(r, 0));
const post = (m: AnalysisResult | AnalysisError) => (self as unknown as Worker).postMessage(m);

async function run(req: AnalysisRequest) {
  latest = req.seq;
  for (const pid of req.pedigreeIds) {
    if (req.seq !== latest) return; // a newer edit superseded this run
    const t0 = performance.now();
    try {
      const rev0 = currentRevision(req.project);
      // Each candidate build class is resolved to its own physical configuration before analysis.
      const project = rev0.activePedigreeId === pid ? req.project : configureForPedigree(req.project, pid, cat!);
      const rev = currentRevision(project);
      const ped = resolvePedigree(project.pedigreeScheme, pid);
      const dfm = runDfm({ project, rev, cat: cat!, profile: profile!, pedigreeId: pid, qty: req.qty, tierDays: req.tierDays, cache });
      const d = derive(rev.harness, cat!, project.settings, { breakoutAllowanceMm: profile!.capabilities.breakoutAllowanceMm });
      const bom = computeBom(project, rev, cat!, d, req.qty);
      const ops = deriveOperations(project, rev, cat!, profile!, ped, inspections, d);
      const summary = makeQuoteSummary(project, rev.harness, bom, ops, ped, dfm, d.totalWireMm);
      post({ type: "result", seq: req.seq, projectId: req.projectId, revisionId: req.revisionId, pedigreeId: pid, dfm, summary, massG: bom.massG, materialCost: bom.materialCost, ms: performance.now() - t0 });
    } catch (e) {
      post({ type: "error", seq: req.seq, projectId: req.projectId, revisionId: req.revisionId, pedigreeId: pid, message: (e as Error).message });
    }
    await yieldToQueue();
  }
}

self.onmessage = async (e: MessageEvent<AnalysisInit | AnalysisRequest>) => {
  const m = e.data;
  if (m.type === "init") {
    cat = new CatalogIndex(m.bundle);
    profile = m.profile;
    inspections = m.inspections;
    cache.clear();
    if (pendingRun) {
      const r = pendingRun;
      pendingRun = undefined;
      await run(r);
    }
    return;
  }
  if (m.type !== "run") return;
  if (!cat || !profile) {
    pendingRun = m;
    latest = m.seq;
    return;
  }
  await run(m);
};
