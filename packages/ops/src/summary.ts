import { quickHash, stableStringify, type ResolvedPedigree } from "@hs/model";
import type { Bom } from "./bom";
import type { OperationsList } from "./operations";

/**
 * Normalized, pricing-relevant summary of a design (§8.2). This is what a quote provider receives:
 * BOM quantities + operations + DFM state + pedigree requirements, never the full design.
 * Everything that changes the obligation (test limits, sampling, review state) is part of its identity (FIX-07).
 */
export interface QuoteSummary {
  lines: { pn: string; qty: number; uom: string; customerFurnished: boolean; cfArrivalDays?: number; leadDays: number; stock: number }[];
  ops: { kind: string; qty: number; automated: boolean; inHouse?: boolean; inspectionId?: string; sampling?: string; params?: Record<string, unknown>; unsupported?: boolean; cureHours?: number }[];
  pedigree: { id: string; name: string; code: string; inspections: { typeId: string; sampling: string; params: Record<string, unknown> }[]; documentation: string[] };
  dfm: {
    mfgErrors: number;
    mfgWarnings: number;
    designErrors: number;
    /** Required checks that didn't produce a result, and findings on unreviewed data. */
    incomplete: number;
    review: number;
    hash: string;
    nonStock: number;
  };
  stats: { connectors: number; uniqueConnectors: number; wires: number; wireLengthM: number; massG: number };
}

export function buildQuoteSummary(bom: Bom, ops: OperationsList, ped: ResolvedPedigree, dfm: QuoteSummary["dfm"], stats: QuoteSummary["stats"], cfArrivalDays: Record<string, number> = {}): QuoteSummary {
  return {
    lines: bom.lines.map((l) => ({ pn: l.pn, qty: l.qty, uom: l.uom, customerFurnished: l.customerFurnished, ...(l.customerFurnished && cfArrivalDays[l.pn] != null ? { cfArrivalDays: cfArrivalDays[l.pn] } : {}), leadDays: l.leadDays, stock: l.stock })),
    ops: ops.ops.map((o) => ({ kind: o.kind, qty: o.qty, automated: o.automated, inHouse: o.inHouse, inspectionId: o.inspectionId, sampling: o.sampling, params: o.params, unsupported: o.unsupported, cureHours: o.cureHours })),
    pedigree: { id: ped.id, name: ped.name, code: ped.code, inspections: ped.inspections.map((i) => ({ typeId: i.typeId, sampling: i.sampling, params: i.params })), documentation: ped.documentation },
    dfm,
    stats,
  };
}

export function summaryHash(s: QuoteSummary): string {
  return quickHash(stableStringify(s));
}
