import { useMemo, useState } from "react";
import { formatMass, formatMoney, normalizePn, replacePart, setCustomerFurnished } from "@hs/model";
import { purchaseQty, type BomLine } from "@hs/ops";
import { ArrowRightLeft, Check } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { useBom } from "../store/analysis";
import { useUi } from "../store/ui";
import { svc } from "../lib/services";
import { zoomToObjects } from "../lib/viewport";
import { Button, cx, DemoTag, Floating, Section } from "../ui/primitives";

function resolveAlt(pn: string, pattern: string, alt: string): string {
  // Wildcard alternates swap the matched prefix (e.g. D38999/26W* → D38999/26Z*)
  if (pattern.endsWith("*") && alt.endsWith("*")) return alt.slice(0, -1) + normalizePn(pn).slice(pattern.length - 1);
  return alt;
}

export default function BomView() {
  const bom = useBom();
  const project = useProject((s) => s.project)!;
  const ui = useUi();
  const [hoverCat, setHoverCat] = useState<string | null>(null);
  const [alt, setAlt] = useState<{ line: BomLine; x: number; y: number } | null>(null);
  const qty = project.quote.selected.qty;
  const byCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of bom.lines) m.set(l.category, (m.get(l.category) ?? 0) + l.extCost);
    const sorted = [...m].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6);
    const other = sorted.slice(6).reduce((s, [, v]) => s + v, 0);
    return other > 0 ? [...top, ["Other", other] as [string, number]] : top;
  }, [bom]);
  const total = byCat.reduce((s, [, v]) => s + v, 0) || 1;
  const drivers = [...bom.lines].sort((a, b) => b.extCost - a.extCost).slice(0, 5);
  const byLead = [...bom.lines].filter((l) => !l.customerFurnished).sort((a, b) => b.leadDays - a.leadDays);
  // Critical path is judged on stock sufficiency for the order quantity, never just the longest lead.
  const crit = bom.criticalPath;
  const nextLead = byLead.filter((l) => l !== crit && !l.stockSufficient)[0];
  const maxLead = Math.max(1, ...byLead.map((l) => l.leadDays));
  return (
    <div className="scroll-thin h-full overflow-auto p-4">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">Bill of materials</h1>
        <span className="text-sm text-text-secondary">
          {bom.lines.length} lines · material {formatMoney(bom.materialCost)} / unit at {qty} units · est. {formatMass(bom.massG)} · supply data as of {bom.asOfRange.oldest}{bom.asOfRange.newest !== bom.asOfRange.oldest ? ` to ${bom.asOfRange.newest}` : ""}
        </span>
        <DemoTag />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4">
        <Section title="Cost by category (per unit)">
          <div className="relative">
            <div className="flex h-6 w-full gap-[2px]" role="img" aria-label="Material cost by category">
              {byCat.map(([c, v], i) => (
                <div
                  key={c}
                  className="h-full rounded transition-opacity"
                  style={{ width: `${(v / total) * 100}%`, background: `var(--chart-${c === "Other" ? 6 : i})`, opacity: hoverCat && hoverCat !== c ? 0.35 : 1 }}
                  title={`${c}: ${formatMoney(v)} (${((v / total) * 100).toFixed(0)}%)`}
                  onMouseEnter={() => setHoverCat(c)}
                  onMouseLeave={() => setHoverCat(null)}
                />
              ))}
            </div>
            {/* direct labels (identity never by color alone) */}
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {byCat.map(([c, v], i) => (
                <span key={c} className={cx("flex items-center gap-1", hoverCat && hoverCat !== c && "opacity-50")} onMouseEnter={() => setHoverCat(c)} onMouseLeave={() => setHoverCat(null)}>
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(--chart-${c === "Other" ? 6 : i})` }} />
                  <span className="text-text-primary">{c}</span>
                  <span className="tnum text-text-secondary">{formatMoney(v)} · {((v / total) * 100).toFixed(0)}%</span>
                </span>
              ))}
            </div>
          </div>
          <div className="mt-2 text-xs text-text-secondary">Top cost drivers</div>
          <ol className="text-xs">
            {drivers.map((l) => (
              <li key={l.pn} className="flex justify-between border-b border-border-subtle py-0.5">
                <span className="mono truncate">{l.pn}</span>
                <span className="tnum">{formatMoney(l.extCost)}</span>
              </li>
            ))}
          </ol>
        </Section>
        <Section title="Lead time">
          {crit ? (
            <div className="rounded-control border border-border-subtle p-2 text-sm">
              <span className="mono">{crit.pn}</span> is setting the ship date: {crit.stock} in stock is short for {qty} units, {Math.ceil(crit.leadDays / 7)} weeks ({crit.leadDays} d) to get more.
              {nextLead ? <span className="text-text-secondary"> Replacing it would bring the part-driven date to {nextLead.leadDays} d ({nextLead.pn}).</span> : <span className="text-text-secondary"> Every other line is covered by stock.</span>}
            </div>
          ) : (
            <div className="rounded-control border border-border-subtle p-2 text-sm text-text-secondary">Stock covers {qty} units for every line (demo data); parts don't set the ship date.</div>
          )}
          <div className="mt-1 flex flex-col gap-0.5">
            {byLead.slice(0, 8).map((l) => (
              <div key={l.pn} className="flex items-center gap-2 text-xs" title={`${l.pn}: ${l.leadDays} days lead, ${l.stock} in stock`}>
                <span className="mono w-44 truncate">{l.pn}</span>
                <svg className="flex-1" height={10} aria-hidden>
                  <rect width={`${(l.leadDays / maxLead) * 100}%`} height={10} rx={3} fill="var(--chart-0)" opacity={l === crit ? 1 : 0.55} />
                </svg>
                <span className="tnum w-24 text-right text-text-secondary">{l.stockSufficient ? "stock" : `${l.leadDays} d`}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-bg-surface-2 text-left text-2xs uppercase tracking-wide text-text-tertiary">
          <tr>
            {["Line", "Part number", "Description", "Qty", "UoM", "Unit cost", "Ext. cost", "Stock", "Lead", "Machine-ready", "Alternates", "Cust. furnished"].map((h) => (
              <th key={h} className="p-1.5">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bom.lines.map((l) => (
            <tr key={l.category + l.pn} className={cx("border-b border-border-subtle hover:bg-bg-hover", l.lifecycle !== "active" && "text-status-warning")}>
              <td className="tnum p-1.5">{l.line}</td>
              <td className="mono p-1.5">
                <button className="hover:text-accent" onClick={() => (ui.setView("design"), setTimeout(() => zoomToObjects(l.objectIds), 50))}>{l.pn}</button>
                {!l.known && <span className="ml-1 text-status-error">(not in catalog)</span>}
              </td>
              <td className="max-w-[320px] truncate p-1.5 text-text-secondary" title={`${l.description}${l.refs.length ? ` · ${l.refs.join(", ")}` : ""}`}>{l.description}</td>
              <td className="tnum p-1.5" title={l.uom === "ea" ? undefined : `${l.qty} ${l.uom} per harness (exact); buy ${purchaseQty(l, qty)} ${l.uom} for ${qty}`}>
                {l.uom === "ea" ? l.qty : (Math.ceil(l.qty * 1000 - 1e-9) / 1000).toFixed(3)}
                {l.dataStatus !== "verified" && <span className="ml-1 text-2xs text-text-tertiary" title={`${l.dataFields ?? "Catalog data"}: ${l.dataStatus}`}>{l.dataStatus}</span>}
              </td>
              <td className="p-1.5">{l.uom}</td>
              <td className="tnum p-1.5">{formatMoney(l.unitCost)}</td>
              <td className="tnum p-1.5">{l.customerFurnished ? "—" : formatMoney(l.extCost)}</td>
              <td className="tnum p-1.5">{l.stock}</td>
              <td className="tnum p-1.5">{l.leadDays} d</td>
              <td className="p-1.5">{l.machineReady ? <Check size={12} className="text-status-pass" aria-label="yes" /> : <span className="text-text-tertiary">manual</span>}</td>
              <td className="p-1.5">
                {l.alternates.length > 0 && (
                  <button className="flex items-center gap-1 text-accent hover:underline" onClick={(e) => setAlt({ line: l, x: e.clientX, y: e.clientY })}>
                    <ArrowRightLeft size={12} /> {l.alternates.length}
                  </button>
                )}
              </td>
              <td className="p-1.5">
                <span className="flex items-center gap-1">
                  <input type="checkbox" checked={l.customerFurnished} aria-label="Customer-furnished" onChange={(e) => dispatch(setCustomerFurnished({ pn: l.pn, furnished: e.target.checked }))} />
                  {l.customerFurnished && (
                    <input
                      className="tnum h-6 w-14 rounded-chip border border-border-control bg-bg-surface-1 px-1 text-2xs"
                      placeholder="arrival d"
                      aria-label={`${l.pn}: days until the customer's parts arrive`}
                      title="Days after order until the customer's parts arrive (blank = unknown; the quote states its assumption)"
                      defaultValue={project.quote.customerFurnishedArrivalDays[l.pn] ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        dispatch(setCustomerFurnished({ pn: l.pn, furnished: true, arrivalDays: v === "" ? null : Math.max(0, Math.round(Number(v)) || 0) }));
                      }}
                    />
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {alt && <AltPopover {...alt} onClose={() => setAlt(null)} qty={qty} />}
    </div>
  );
}

function AltPopover({ line, x, y, onClose, qty }: { line: BomLine; x: number; y: number; onClose: () => void; qty: number }) {
  const cat = svc().cat;
  return (
    <Floating x={x} y={y} onClose={onClose} width={440} className="p-3">
      <div className="mb-2 text-sm font-semibold">Alternates for <span className="mono">{line.pn}</span></div>
      {line.alternates.map((a) => {
        const pn = resolveAlt(line.pn, a.pn, a.alternate);
        const s = cat.supply(pn);
        const price = s ? [...s.breaks].reverse().find((b) => line.qty * qty >= b.qty)?.price ?? s.breaks[0]!.price : undefined;
        const dPrice = price != null ? price - line.unitCost : undefined;
        const dLead = s ? s.leadDays - line.leadDays : undefined;
        const compatible = !!cat.connector(pn) || !!cat.wire(pn, 22) || !!cat.layer(pn) || !pn.startsWith("D38999");
        return (
          <div key={pn} className="mb-2 rounded-control border border-border-subtle p-2 text-xs">
            <div className="mono text-sm">{pn}</div>
            <div className="text-text-secondary">{a.relationship}</div>
            <div className="tnum mt-1 flex gap-3">
              <span>Price {dPrice == null ? "—" : `${dPrice >= 0 ? "+" : "−"}${formatMoney(Math.abs(dPrice))}`}</span>
              <span>Lead {dLead == null ? "—" : `${dLead >= 0 ? "+" : ""}${dLead} d`}</span>
              <span>Stock {s?.stock ?? "—"}</span>
              <span className={compatible ? "text-status-pass" : "text-status-error"}>{compatible ? "form/fit compatible" : "not in catalog"}</span>
            </div>
            <Button size="sm" className="mt-1" disabled={!compatible} onClick={() => (dispatch(replacePart({ fromPn: line.pn, toPn: pn })), onClose())}>Swap (undoable)</Button>
          </div>
        );
      })}
      <DemoTag />
    </Floating>
  );
}
