import { useState } from "react";
import { currentRevision, formatMass, formatMoney, formatTotalLength, setQuoteSelection } from "@hs/model";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { useActiveAnalysis, useActiveQuote, useAnalysis } from "../store/analysis";
import { cx, DemoTag, Tip } from "../ui/primitives";
import { PedigreePill } from "./TopBar";

export function QuoteCard() {
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  const q = useActiveQuote();
  const a = useActiveAnalysis();
  const updating = useAnalysis((s) => s.quoteUpdating);
  const delta = useAnalysis((s) => s.delta);
  const [open, setOpen] = useState(false);
  const [addQty, setAddQty] = useState<string | null>(null);
  const sel = project.quote.selected;
  const cell = q?.cells.find((c) => c.qty === sel.qty && c.tier === sel.tier);
  const stateLabel = updating ? "Updating…" : q?.state === "instant" ? "Instant quote" : q?.state === "needsReview" ? "Needs review" : q?.state === "unavailable" ? "Unavailable" : "Calculating…";
  const stateCls = q?.state === "needsReview" ? "text-status-warning" : q?.state === "unavailable" ? "text-text-tertiary" : "text-status-pass";
  const showDelta = delta && Date.now() - delta.at < 4500 && !updating;
  return (
    <section className="border-b border-border-subtle p-3" aria-label="Instant quote">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="label-caps">Instant quote</h2>
        <span className={cx("flex items-center gap-1 text-xs", updating ? "text-text-tertiary" : stateCls)}>
          {stateLabel} <DemoTag />
        </span>
      </div>
      <div className="mb-2 flex items-center justify-between text-xs text-text-secondary">
        <PedigreePill id={rev.activePedigreeId} className="text-2xs" />
        {cell && (
          <span>
            Ships <span className="tnum text-text-primary">{new Date(cell.shipDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          </span>
        )}
      </div>
      {q?.state === "unavailable" ? (
        <div className="rounded-control border border-dashed border-border-subtle p-3 text-center text-xs text-text-tertiary">{q.reason}</div>
      ) : (
        <div className={cx("overflow-hidden rounded-control border border-border-subtle", updating && "shimmer")}>
          <table className="w-full table-fixed text-right text-xs" aria-label="Price matrix: rows are lead time, columns are quantity">
            <thead>
              <tr className="bg-bg-surface-2 text-2xs text-text-tertiary">
                <th className="w-[54px] p-1 text-left font-normal">Qty</th>
                {project.quote.quantities.map((n) => (
                  <th key={n} className="tnum p-1 font-medium">
                    {n}
                  </th>
                ))}
                <th className="w-4 p-0">
                  {addQty == null ? (
                    <Tip label="Add a custom quantity">
                      <button aria-label="Add quantity" className="text-text-tertiary hover:text-text-primary" onClick={() => setAddQty("")}>
                        <Plus size={12} />
                      </button>
                    </Tip>
                  ) : (
                    <input
                      autoFocus
                      className="tnum w-10 rounded-chip border border-accent bg-bg-surface-1 px-0.5 text-2xs"
                      value={addQty}
                      onChange={(e) => setAddQty(e.target.value.replace(/\D/g, ""))}
                      onBlur={() => setAddQty(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && Number(addQty) > 0) {
                          dispatch(setQuoteSelection({ quantities: [...project.quote.quantities, Number(addQty)], qty: Number(addQty) }));
                          setAddQty(null);
                        }
                      }}
                    />
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {(q?.tiers ?? [{ id: "standard", name: "Standard", days: 15 }, { id: "expedited", name: "Expedited", days: 8 }, { id: "rush", name: "Rush", days: 4 }]).map((t) => (
                <tr key={t.id} className="border-t border-border-subtle">
                  <td className="py-1 pl-1 text-left">
                    <div className="truncate text-2xs" title={t.name}>{t.name}</div>
                    <div className="text-2xs text-text-tertiary">{t.days}&thinsp;d</div>
                  </td>
                  {project.quote.quantities.map((n) => {
                    const c = q?.cells.find((x) => x.qty === n && x.tier === t.id);
                    const on = sel.qty === n && sel.tier === t.id;
                    return (
                      <td key={n} className="p-0">
                        <button onClick={() => dispatch(setQuoteSelection({ qty: n, tier: t.id }), "Select quote cell")} aria-pressed={on} className={cx("w-full px-0.5 py-1 text-right hover:bg-bg-hover", on && "bg-bg-hover outline outline-1 -outline-offset-1 outline-accent")}>
                          <div className="tnum truncate text-[11.5px] font-medium" title={c ? `${formatMoney(c.unit)} per unit` : undefined}>
                            {c ? (c.unit >= 1000 ? `$${(c.unit / 1000).toFixed(2)}k` : formatMoney(c.unit, c.unit >= 100 ? 0 : 2)) : "—"}
                          </div>
                          <div className="tnum text-2xs text-text-tertiary" title={c ? `${formatMoney(c.total)} total` : undefined}>
                            {c ? compact(c.total) : ""}
                          </div>
                        </button>
                      </td>
                    );
                  })}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showDelta && (
        <div className={cx("fade-delta mt-2 text-xs", delta!.amount > 0 ? "text-status-warning" : "text-status-pass")} role="status">
          {delta!.amount > 0 ? "▲" : "▼"} {formatMoney(Math.abs(delta!.amount))}/unit: {delta!.label.toLowerCase()}
        </div>
      )}
      {q?.state === "needsReview" && q.reason && <div className="mt-2 text-xs text-status-warning">{q.reason}. Order becomes “Request quote”.</div>}
      {cell && (
        <div className="mt-2">
          <button className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Price breakdown ({sel.qty} units, {q?.tiers.find((t) => t.id === sel.tier)?.name})
          </button>
          {open && (
            <table className="mt-1 w-full text-xs">
              <tbody className="tnum">
                <Row label="Materials" v={cell.breakdown.materials} />
                <Row label="Machine time" v={cell.breakdown.machine} />
                <Row label="Manual operations" v={cell.breakdown.manual} />
                <Row label={`Inspection & test (${q?.pedigreeName})`} v={cell.breakdown.inspection} />
                {cell.breakdown.inspectionItems.map((i) => (
                  <Row key={i.name} label={`· ${i.name} (${i.sampling})`} v={i.amount} sub />
                ))}
                <Row label={`Setup / NRE ${formatMoney(cell.breakdown.nre, 0)} ÷ ${sel.qty}`} v={cell.breakdown.nrePerUnit} />
                <tr className="border-t border-border-subtle font-medium">
                  <td className="py-1">Unit price</td>
                  <td className="py-1 text-right">{formatMoney(cell.unit)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
      <div className="mt-2 flex justify-between text-2xs text-text-tertiary">
        <span>
          Wire {a ? formatTotalLength(a.summary.stats.wireLengthM * 1000, project.units) : "—"} · est. {a ? formatMass(a.massG) : "—"}
        </span>
        {q && <span>Valid until {q.validUntil}</span>}
      </div>
    </section>
  );
}

function compact(n: number) {
  return n >= 10000 ? `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : formatMoney(n, 0);
}

function Row({ label, v, sub }: { label: string; v: number; sub?: boolean }) {
  return (
    <tr className={sub ? "text-text-tertiary" : undefined}>
      <td className={cx("py-0.5", sub && "pl-2 text-2xs")}>{label}</td>
      <td className={cx("py-0.5 text-right", sub && "text-2xs")}>{formatMoney(v)}</td>
    </tr>
  );
}
