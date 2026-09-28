import { create } from "zustand";
import { currentRevision, derive, type Derived, type Project } from "@hs/model";
import type { DfmSummary } from "@hs/dfm";
import { computeBom, summaryHash, type Bom, type QuoteSummary } from "@hs/ops";
import type { QuoteResult } from "@hs/providers";
import { useEffect, useMemo, useRef } from "react";
import { svc } from "../lib/services";
import { useProject } from "./project";
import type { AnalysisRequest, AnalysisResult } from "../workers/analysis.worker";

interface PedAnalysis {
  dfm: DfmSummary;
  summary: QuoteSummary;
  massG: number;
  materialCost: number;
  seq: number;
  ms: number;
}

interface AnalysisState {
  seq: number;
  byPedigree: Record<string, PedAnalysis>;
  quotes: Record<string, QuoteResult>;
  quoteUpdating: boolean;
  /** Previous quote for the selected cell (delta indicator §8.1). */
  delta: { amount: number; label: string; at: number } | null;
  quoteError?: string;
}

export const useAnalysis = create<AnalysisState>(() => ({ seq: 0, byPedigree: {}, quotes: {}, quoteUpdating: false, delta: null }));

let worker: Worker | undefined;
function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/analysis.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<AnalysisResult>) => {
      const r = e.data;
      if (r.type !== "result") return;
      const st = useAnalysis.getState();
      if (r.seq < st.seq && st.byPedigree[r.pedigreeId] && st.byPedigree[r.pedigreeId]!.seq > r.seq) return;
      useAnalysis.setState({ byPedigree: { ...st.byPedigree, [r.pedigreeId]: { dfm: r.dfm, summary: r.summary, massG: r.massG, materialCost: r.materialCost, seq: r.seq, ms: r.ms } } });
    };
  }
  return worker;
}

let seq = 0;
export function requestAnalysis(project: Project) {
  seq++;
  const rev = currentRevision(project);
  const active = rev.activePedigreeId;
  const others = project.pedigreeScheme.pedigrees.map((p) => p.id).filter((id) => id !== active);
  const tierDays = svc().pricing.leadTiers.find((t) => t.id === project.quote.selected.tier)?.days ?? 15;
  useAnalysis.setState({ seq });
  const msg: AnalysisRequest = { type: "run", seq, project, pedigreeIds: [active, ...others], qty: project.quote.selected.qty, tierDays };
  getWorker().postMessage(msg);
}

/** Bridge: runs analysis on every project change and the (debounced, cancellable) quote. */
export function useAnalysisBridge() {
  const project = useProject((s) => s.project);
  const lastChange = useProject((s) => s.lastChange);
  useEffect(() => {
    if (project) requestAnalysis(project);
  }, [project]);

  const active = project ? currentRevision(project).activePedigreeId : "";
  const byPed = useAnalysis((s) => s.byPedigree);
  const quantities = project?.quote.quantities ?? [];
  const key = useMemo(() => project?.pedigreeScheme.pedigrees.map((p) => (byPed[p.id] ? summaryHash(byPed[p.id]!.summary) : "")).join("|") + `|${quantities.join(",")}`, [byPed, project?.pedigreeScheme, quantities]);
  const abortRef = useRef<AbortController>();
  const labelRef = useRef<string>("");
  labelRef.current = lastChange?.label ?? "";

  useEffect(() => {
    if (!project) return;
    const activeA = byPed[active];
    if (!activeA) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    useAnalysis.setState({ quoteUpdating: true });
    const t = setTimeout(async () => {
      try {
        const ids = project.pedigreeScheme.pedigrees.map((p) => p.id).filter((id) => byPed[id]);
        const summaries = ids.map((id) => byPed[id]!.summary);
        const results = await svc().quote.compute(summaries, quantities, ac.signal);
        const st = useAnalysis.getState();
        const quotes = { ...st.quotes };
        const prev = st.quotes[active];
        ids.forEach((id, i) => (quotes[id] = results[i]!));
        const sel = project.quote.selected;
        const cellOf = (q?: QuoteResult) => q?.cells.find((c) => c.qty === sel.qty && c.tier === sel.tier);
        const before = cellOf(prev);
        const after = cellOf(quotes[active]);
        const delta = before && after && Math.abs(after.unit - before.unit) >= 0.01 && prev!.pedigreeId === active ? { amount: after.unit - before.unit, label: labelRef.current, at: Date.now() } : st.delta;
        useAnalysis.setState({ quotes, quoteUpdating: false, delta, quoteError: undefined });
      } catch (e) {
        if ((e as Error).name !== "AbortError") useAnalysis.setState({ quoteUpdating: false, quoteError: (e as Error).message });
      }
    }, 500); // 500 ms debounce after edits (§8.2)
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, project?.quote.selected.qty, project?.quote.selected.tier]);
}

export function useActiveAnalysis(): PedAnalysis | undefined {
  const project = useProject((s) => s.project);
  const byPed = useAnalysis((s) => s.byPedigree);
  return project ? byPed[currentRevision(project).activePedigreeId] : undefined;
}

export function useActiveQuote(): QuoteResult | undefined {
  const project = useProject((s) => s.project);
  const q = useAnalysis((s) => s.quotes);
  return project ? q[currentRevision(project).activePedigreeId] : undefined;
}

/** Main-thread derivation (routes, lengths, diameters) for rendering. Memoized per harness. */
export function useDerived(): Derived {
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  return useMemo(() => derive(rev.harness, svc().cat, project.settings, { breakoutAllowanceMm: svc().profile.capabilities.breakoutAllowanceMm }), [rev.harness, project.settings]);
}

export function useBom(): Bom {
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  const d = useDerived();
  return useMemo(() => computeBom(project, rev, svc().cat, d, project.quote.selected.qty), [rev, d, project.quote]);
}
