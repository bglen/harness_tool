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

    const cells: QuoteCell[] = [];
    for (const q of quantities) {
      let materials = 0;
      let shortLead = 0;
      for (const l of s.lines) {
        if (l.customerFurnished) continue;
        const sup = this.cat.supply(l.pn);
        const need = l.qty * q;
        const brk = sup ? ([...sup.breaks].reverse().find((b) => need >= b.qty) ?? sup.breaks[0]!) : undefined;
        materials += (brk?.price ?? 0) * l.qty;
        if (l.stock < need && l.leadDays > shortLead) {
          shortLead = l.leadDays;
          if (!critical || l.leadDays > critical.leadDays) critical = { pn: l.pn, leadDays: l.leadDays };
        }
      }
      materials *= R.materialMarkup;
      let machineMin = 0;
      let manualMin = 0;
      for (const o of s.ops) {
        if (o.kind === "inspection") continue;
        if (o.automated) machineMin += (R.opMinutes[o.kind] ?? 0.5) * o.qty;
        else manualMin += (R.manualOpMinutes[o.kind] ?? (R.opMinutes[o.kind] ?? 0.5) * 4) * o.qty;
      }
      const items: QuoteBreakdown["inspectionItems"] = [];
      for (const o of s.ops.filter((x) => x.kind === "inspection" || x.kind === "test")) {
        if (o.kind === "test") {
          items.push({ name: "Continuity test (machine jig)", amount: (R.opMinutes.test ?? 1.5) * R.machineRatePerMin, inHouse: true, sampling: "100%" });
          continue;
        }
        const t = this.inspections.find((i) => i.id === o.inspectionId);
        if (!t) continue;
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
        const days = Math.max(buildDays, shortLead ? shortLead + 3 + cureDays : 0);
        cells.push({
          qty: q,
          tier: t.id,
          unit: round2(unit),
          total: round2(unit * q),
          shipDate: addDays(today, days),
          breakdown: { materials: round2(materials), machine: round2(machine), manual: round2(manual), inspection: round2(insp), inspectionItems: items.map((i) => ({ ...i, amount: round2(i.amount * t.multiplier) })), nre: round2(nre), nrePerUnit: round2(nrePer) },
        });
      }
    }
    const unknown = s.lines.some((l) => !this.cat.supply(l.pn));
    const needsReview = s.dfm.mfgErrors > 0 || unknown;
    return {
      ...base,
      state: needsReview ? "needsReview" : "instant",
      reason: s.dfm.mfgErrors > 0 ? `${s.dfm.mfgErrors} manufacturability error${s.dfm.mfgErrors > 1 ? "s" : ""}: price is an estimate` : unknown ? "Some parts have no price data: price is an estimate" : undefined,
      cells,
      criticalPart: critical,
      cureDays,
    };
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
