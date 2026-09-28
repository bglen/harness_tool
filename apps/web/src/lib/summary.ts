import type { Harness, Project, ResolvedPedigree } from "@hs/model";
import type { DfmSummary } from "@hs/dfm";
import { buildQuoteSummary, type Bom, type OperationsList, type QuoteSummary } from "@hs/ops";

/** One place that turns analysis results into the normalized quote summary (worker, previews, compare). */
export function makeQuoteSummary(project: Project, h: Harness, bom: Bom, ops: OperationsList, ped: ResolvedPedigree, dfm: DfmSummary, totalWireMm: number): QuoteSummary {
  return buildQuoteSummary(
    bom,
    ops,
    ped,
    {
      mfgErrors: dfm.manufacturability.errors,
      mfgWarnings: dfm.manufacturability.warnings,
      designErrors: dfm.design.errors,
      incomplete: dfm.manufacturability.incomplete + dfm.design.incomplete,
      review: dfm.manufacturability.review,
      hash: dfm.hash,
      nonStock: bom.insufficient,
    },
    { connectors: h.connectors.length, uniqueConnectors: new Set(h.connectors.map((c) => c.pn)).size, wires: h.wires.length, wireLengthM: totalWireMm / 1000, massG: bom.massG },
    project.quote.customerFurnishedArrivalDays,
  );
}
