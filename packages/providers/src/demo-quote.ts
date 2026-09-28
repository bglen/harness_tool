import type { CatalogIndex, DemoPricing, InspectionType } from "@hs/model";
import { summaryHash, type QuoteSummary } from "@hs/ops";
import type { QuoteBreakdown, QuoteCell, QuoteProvider, QuoteResult } from "./interfaces";

function samplingFactor(s: string | undefined, qty: number): number {
  if (!s || s === "100%") return 1;
  const pct = /^(\d+)%$/.exec(s);
  if (pct) return Number(pct[1]) / 100;
  if (/n=(\d+)/.test(s)) return Math.min(1, Number(/n=(\d+)/.exec(s)![1]) / qty);
  if (/first\/last/i.test(s)) return Math.min(1, 2 / qty);
  if (/first/i.test(s) || /per setup|per lot/i.test(s)) return Math.min(1, 1 / qty);
  return 1;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + Math.ceil(days));
  return d.toISOString().slice(0, 10);
}

/**
 * Phase 1 demo quote (§18.2): real BOM/operations × arbitrary demo rates, computed in the browser
 * with simulated latency. Never contains real margins or costs (§15.6).
 */
export class DemoQuoteProvider implements QuoteProvider {
  private cache = new Map<string, QuoteResult>();
  constructor(
    private cat: CatalogIndex,
    private rates: DemoPricing,
    private inspections: InspectionType[],
    private now: () => Date = () => new Date(),
  ) {}

  async pricing() {
    return this.rates;
  }

  async compute(summaries: QuoteSummary[], quantities: number[], signal?: AbortSignal): Promise<QuoteResult[]> {
    const out = summaries.map((s) => {
      const key = `${summaryHash(s)}|${quantities.join(",")}`;
      const hit = this.cache.get(key);
      return { key, hit, s };
    });
    if (out.some((o) => !o.hit)) {
      const [lo, hi] = this.rates.latencyMs;
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, lo + Math.random() * (hi - lo));
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }
    return out.map(({ key, hit, s }) => {
      if (hit) return hit;
      const r = this.price(s, quantities, key);
      this.cache.set(key, r);
      if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value!);
      return r;
    });
  }

  price(s: QuoteSummary, quantities: number[], hash: string): QuoteResult {
    const R = this.rates;
    const today = this.now().toISOString();
    const tiers = R.leadTiers.map((t) => ({ id: t.id, name: t.name, days: t.days }));
    const base = { pedigreeId: s.pedigree.id, pedigreeName: s.pedigree.name, tiers, quantities, validUntil: addDays(today, R.quoteValidityDays), asOf: today, hash, demo: true, cureDays: 0 };
    if (s.stats.connectors === 0) return { ...base, state: "unavailable", reason: "Add connectors to get a quote.", cells: [] };
    if (s.stats.wires === 0) return { ...base, state: "unavailable", reason: "Connect at least one wire to get a quote.", cells: [] };

    const cureHours = Math.max(0, ...s.ops.map((o) => o.cureHours ?? 0));
    const cureDays = cureHours / 24;
    const outsourcedLead = Math.max(0, ...s.ops.filter((o) => o.kind === "inspection").map((o) => this.inspections.find((i) => i.id === o.inspectionId)).filter((i) => i && !i.inHouse).map((i) => i!.leadDays));
    const manualKinds = new Set(s.ops.filter((o) => !o.automated && o.kind !== "inspection").map((o) => o.kind));
    const nre = R.setupNre + R.setupPerUniqueConnector * s.stats.uniqueConnectors + R.setupPerManualOpType * manualKinds.size;
    let critical: { pn: string; leadDays: number } | undefined;

    // Customer-furnished parts: the build can't start before they arrive; unknown arrival is an explicit assumption.
    const assumptions: string[] = [];
    const cf = s.lines.filter((l) => l.customerFurnished);
    const cfArrival = Math.max(0, ...cf.map((l) => l.cfArrivalDays ?? 0));
    const cfUnknown = cf.filter((l) => l.cfArrivalDays == null);
    if (cfUnknown.length) assumptions.push(`Ship dates assume customer-furnished ${cfUnknown.map((l) => l.pn).slice(0, 3).join(", ")}${cfUnknown.length > 3 ? "…" : ""} are on hand at order (arrival date not given).`);
    const unsupported = s.ops.filter((o) => o.unsupported).map((o) => o.inspectionId ?? "?");

    const cells: QuoteCell[] = [];
    for (const q of quantities) {
      let materials = 0;
      let shortLead = 0;
      let cellCritical: { pn: string; leadDays: number } | undefined;
      for (const l of s.lines) {
        if (l.customerFurnished) continue;
        const sup = this.cat.supply(l.pn);
        const need = l.uom === "ea" ? Math.ceil(l.qty * q - 1e-9) : l.qty * q;
        const brk = sup ? ([...sup.breaks].reverse().find((b) => need >= b.qty) ?? sup.breaks[0]!) : undefined;
        materials += (brk?.price ?? 0) * l.qty;
        // Availability per cell: a part is on the critical path only if stock can't cover this quantity.
        if (l.stock < need && l.leadDays > shortLead) {
          shortLead = l.leadDays;
          cellCritical = { pn: l.pn, leadDays: l.leadDays };
        }
      }
      if (cellCritical && (!critical || cellCritical.leadDays > critical.leadDays)) critical = cellCritical;
      materials *= R.materialMarkup;
      let machineMin = 0;
      let manualMin = 0;
      for (const o of s.ops) {
        // Tests and inspections are priced once, below (no continuity double count).
        if (o.kind === "inspection" || o.kind === "test") continue;
        if (o.automated) machineMin += (R.opMinutes[o.kind] ?? 0.5) * o.qty;
        else manualMin += (R.manualOpMinutes[o.kind] ?? (R.opMinutes[o.kind] ?? 0.5) * 4) * o.qty;
      }
      const items: QuoteBreakdown["inspectionItems"] = [];
      for (const o of s.ops.filter((x) => x.kind === "inspection" || x.kind === "test")) {
        if (o.kind === "test") {
          items.push({ name: `Continuity test (machine jig${o.params?.maxOhm != null ? `, ≤ ${o.params.maxOhm} Ω` : ""})`, amount: (R.opMinutes.test ?? 1.5) * R.machineRatePerMin, inHouse: true, sampling: o.sampling ?? "100%" });
          continue;
        }
        const t = this.inspections.find((i) => i.id === o.inspectionId);
        if (!t) {
          items.push({ name: `${o.inspectionId} (not priced: needs review)`, amount: 0, inHouse: false, sampling: o.sampling ?? "100%" });
          continue;
        }
        const amount = t.costPerUnit * samplingFactor(o.sampling, q) + t.setupCost / q;
        items.push({ name: t.name + (t.inHouse ? "" : " (outsourced)"), amount, inHouse: t.inHouse, sampling: o.sampling ?? "100%" });
      }
      const inspection = items.reduce((a, i) => a + i.amount, 0);
      const qf = [...R.quantityFactors].reverse().find((f) => q >= f.qty)?.factor ?? 1;
      for (const t of R.leadTiers) {
        const machine = machineMin * R.machineRatePerMin * qf * t.multiplier;
        const manual = manualMin * R.manualRatePerMin * qf * t.multiplier;
        const insp = inspection * t.multiplier;
        const nrePer = nre / q;
        const unit = materials + machine + manual + insp + nrePer;
        const buildDays = t.days + cureDays + outsourcedLead + Math.ceil(q / 50);
        const days = Math.max(buildDays, shortLead ? shortLead + 3 + cureDays : 0, cfArrival ? cfArrival + t.days : 0);
        cells.push({
          qty: q,
          tier: t.id,
          unit: round2(unit),
          total: round2(unit * q),
          shipDate: addDays(today, days),
          criticalPart: cellCritical,
          breakdown: { materials: round2(materials), machine: round2(machine), manual: round2(manual), inspection: round2(insp), inspectionItems: items.map((i) => ({ ...i, amount: round2(i.amount * t.multiplier) })), nre: round2(nre), nrePerUnit: round2(nrePer) },
        });
      }
    }
    const unknown = s.lines.some((l) => !this.cat.supply(l.pn));
    const reasons: string[] = [];
    if (s.dfm.mfgErrors > 0) reasons.push(`${s.dfm.mfgErrors} manufacturability error${s.dfm.mfgErrors > 1 ? "s" : ""}`);
    if (s.dfm.designErrors > 0) reasons.push(`${s.dfm.designErrors} required design-rule error${s.dfm.designErrors > 1 ? "s" : ""}`);
    if (s.dfm.incomplete > 0) reasons.push(`${s.dfm.incomplete} check${s.dfm.incomplete > 1 ? "s" : ""} couldn't run`);
    if (s.dfm.review > 0) reasons.push("unreviewed reference data");
    if (unsupported.length) reasons.push(`inspection${unsupported.length > 1 ? "s" : ""} ${unsupported.join(", ")} not in the catalog`);
    if (unknown) reasons.push("some parts have no price data");
    return {
      ...base,
      state: reasons.length ? "needsReview" : "instant",
      reason: reasons.length ? `Estimate only: ${reasons.join("; ")}.` : undefined,
      assumptions,
      cells,
      criticalPart: critical,
      cureDays,
    };
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
