import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DemoPricing, InspectionType } from "@hs/model";
import type { QuoteSummary } from "@hs/ops";
import { loadTestCatalog } from "../../model/src/test-catalog";
import { DemoQuoteProvider } from "./demo-quote";

const cat = loadTestCatalog();
const PUB = join(import.meta.dirname, "..", "..", "..", "apps", "web", "public", "catalog");
const pricing = JSON.parse(readFileSync(join(PUB, "pricing.json"), "utf8")) as DemoPricing;
const inspections = JSON.parse(readFileSync(join(PUB, "inspections.json"), "utf8")) as InspectionType[];
const q = new DemoQuoteProvider(cat, pricing, inspections, () => new Date("2026-01-01T00:00:00Z"));

const summary = (over: Partial<QuoteSummary> = {}): QuoteSummary => ({
  lines: [],
  ops: [{ kind: "test", qty: 1, automated: true, inspectionId: "continuity", params: { maxOhm: 1 } }],
  pedigree: { id: "std", name: "Standard", code: "STD", inspections: [], documentation: [] },
  dfm: { mfgErrors: 0, mfgWarnings: 0, designErrors: 0, incomplete: 0, review: 0, hash: "h", nonStock: 0 },
  stats: { connectors: 2, uniqueConnectors: 2, wires: 1, wireLengthM: 1, massG: 10 },
  ...over,
});

describe("demo quote", () => {
  it("prices the continuity test once (inspection line, not also machine time)", () => {
    const r = q.price(summary(), [1], "h");
    const c = r.cells.find((x) => x.tier === "standard") ?? r.cells[0]!;
    expect(c.breakdown.machine).toBe(0);
    expect(c.breakdown.inspectionItems.filter((i) => /Continuity/.test(i.name))).toHaveLength(1);
  });

  it("critical parts are judged per quantity cell", () => {
    // Demo supply row D38999/26W*: 140 in stock.
    const pn = "D38999/26WB35SN";
    const r = q.price(summary({ lines: [{ pn, qty: 1, uom: "ea", customerFurnished: false, leadDays: 10, stock: 140 }] }), [1, 1000], "h");
    expect(r.cells.find((c) => c.qty === 1)!.criticalPart).toBeUndefined();
    expect(r.cells.find((c) => c.qty === 1000)!.criticalPart?.pn).toBe(pn);
  });

  it("customer-furnished arrival pushes ship dates; unknown arrival is stated as an assumption", () => {
    const line = { pn: "X-CF", qty: 1, uom: "ea", customerFurnished: true, leadDays: 0, stock: 0 };
    const known = q.price(summary({ lines: [{ ...line, cfArrivalDays: 60 }] }), [1], "h");
    const unknown = q.price(summary({ lines: [line] }), [1], "h");
    expect(known.cells[0]!.shipDate > unknown.cells[0]!.shipDate).toBe(true);
    expect(unknown.assumptions?.[0]).toMatch(/X-CF/);
  });

  it("incomplete checks, unreviewed data and unknown inspections force review", () => {
    expect(q.price(summary({ dfm: { ...summary().dfm, incomplete: 1 } }), [1], "h").state).toBe("needsReview");
    expect(q.price(summary({ dfm: { ...summary().dfm, review: 2 } }), [1], "h").state).toBe("needsReview");
    const r = q.price(summary({ ops: [...summary().ops, { kind: "inspection", qty: 1, automated: false, inspectionId: "tempcycle", unsupported: true }] }), [1], "h");
    expect(r.state).toBe("needsReview");
    expect(r.reason).toMatch(/tempcycle/);
  });
});
