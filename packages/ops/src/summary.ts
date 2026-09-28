import { quickHash, stableStringify, type ResolvedPedigree } from "@hs/model";
import type { Bom } from "./bom";
import type { OperationsList } from "./operations";

/**
 * Normalized, pricing-relevant summary of a design (§8.2). This is what a quote provider receives:
 * BOM quantities + operations + DFM state + pedigree requirements, never the full design.
 */
export interface QuoteSummary {
  lines: { pn: string; qty: number; uom: string; customerFurnished: boolean; leadDays: number; stock: number }[];
  ops: { kind: string; qty: number; automated: boolean; inspectionId?: string; sampling?: string; cureHours?: number }[];
  pedigree: { id: string; name: string; code: string; inspections: { typeId: string; sampling: string }[]; documentation: string[] };
  dfm: { mfgErrors: number; mfgWarnings: number; designErrors: number; hash: string; nonStock: number };
  stats: { connectors: number; uniqueConnectors: number; wires: number; wireLengthM: number; massG: number };
}

export function buildQuoteSummary(bom: Bom, ops: OperationsList, ped: ResolvedPedigree, dfm: QuoteSummary["dfm"], stats: QuoteSummary["stats"]): QuoteSummary {
  return {
    lines: bom.lines.map((l) => ({ pn: l.pn, qty: l.qty, uom: l.uom, customerFurnished: l.customerFurnished, leadDays: l.leadDays, stock: l.stock })),
    ops: ops.ops.map((o) => ({ kind: o.kind, qty: o.qty, automated: o.automated, inspectionId: o.inspectionId, sampling: o.sampling, cureHours: o.cureHours })),
    pedigree: { id: ped.id, name: ped.name, code: ped.code, inspections: ped.inspections.map((i) => ({ typeId: i.typeId, sampling: i.sampling })), documentation: ped.documentation },
    dfm,
    stats,
  };
}

export function summaryHash(s: QuoteSummary): string {
  return quickHash(stableStringify(s));
}
