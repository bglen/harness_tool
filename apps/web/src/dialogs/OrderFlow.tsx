import { useMemo, useState } from "react";
import { currentRevision, formatMoney, resolvePedigree } from "@hs/model";
import { Check, Lock, Plus, Trash2 } from "lucide-react";
import { useProject } from "../store/project";
import { useUi } from "../store/ui";
import { useAnalysis } from "../store/analysis";
import { svc } from "../lib/services";
import { canvasSvgString } from "../lib/canvasExport";
import { Button, cx, DemoTag, Dialog, Field, inputCls, Section, Select, SeverityIcon, Toggle } from "../ui/primitives";
import { PedigreePill } from "../chrome/TopBar";

const STEPS = ["Review", "Details", "Compliance", "Payment", "Confirmation"] as const;

interface Line {
  pedigreeId: string;
  qty: number;
  tier: string;
}

export function OrderFlow() {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  const byPed = useAnalysis((s) => s.byPedigree);
  const quotes = useAnalysis((s) => s.quotes);
  const [step, setStep] = useState(0);
  const [lines, setLines] = useState<Line[]>([{ pedigreeId: rev.activePedigreeId, qty: project.quote.selected.qty, tier: project.quote.selected.tier }]);
  const [ackDesign, setAckDesign] = useState(false);
  const [ackLower, setAckLower] = useState(false);
  const [extras, setExtras] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const close = () => ui.closeDialog("order");
  const thumb = useMemo(() => {
    try {
      return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(canvasSvgString());
    } catch {
      return null;
    }
  }, []);
  const peds = project.pedigreeScheme.pedigrees;
  const rankOf = (id: string) => peds.find((p) => p.id === id)?.rank ?? 0;
  const highest = project.quote.highestOrderedPedigree;
  const lower = highest && lines.some((l) => rankOf(l.pedigreeId) < rankOf(highest));
  const cellFor = (l: Line) => quotes[l.pedigreeId]?.cells.find((c) => c.qty === l.qty && c.tier === l.tier);
  const total = lines.reduce((s, l) => s + (cellFor(l)?.total ?? 0), 0);
  const mfgErrors = lines.some((l) => (byPed[l.pedigreeId]?.dfm.manufacturability.errors ?? 0) > 0);
  const designErrors = lines.reduce((s, l) => s + (byPed[l.pedigreeId]?.dfm.design.errors ?? 0), 0);
  const enforcedErrors = lines.some((l) => byPed[l.pedigreeId]?.dfm.results.some((r) => r.status === "fail" && r.eff.severity === "error" && r.eff.source.enforced));
  const canContinue = step !== 0 || ((!designErrors || ackDesign) && (!lower || ackLower) && !enforcedErrors);
  const tiers = svc().pricing.leadTiers;
  return (
    <Dialog
      open
      onClose={close}
      title={mfgErrors ? "Request quote" : "Order"}
      width={900}
      description={<span className="flex items-center gap-2">Phase 1: this order flow is a demonstration. Nothing is submitted. <DemoTag /></span>}
      footer={
        step < 4 ? (
          <>
            <div className="mr-auto flex gap-1 text-xs">
              {STEPS.map((s, i) => (
                <span key={s} className={cx("rounded-chip px-2 py-0.5", i === step ? "bg-bg-hover text-text-primary" : i < step ? "text-status-pass" : "text-text-tertiary")}>
                  {i < step ? "✓ " : ""}
                  {s}
                </span>
              ))}
            </div>
            {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
            <Button
              variant="primary"
              disabled={!canContinue}
              onClick={async () => {
                if (step === 3) {
                  const r = await svc().orders.submit({ projectName: project.name, lines });
                  setResult(r.message);
                }
                setStep(step + 1);
              }}
            >
              {step === 3 ? (mfgErrors ? "Request quote" : "Place order") : "Continue"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Close</Button>
            <Button variant="primary" onClick={() => (close(), ui.setView("outputs"))}>Download output package</Button>
          </>
        )
      }
    >
      {step === 0 && (
        <div className="grid grid-cols-[260px_1fr] gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex h-44 items-center justify-center overflow-hidden rounded-card border border-border-subtle bg-bg-canvas">{thumb ? <img src={thumb} alt="Design thumbnail" className="max-h-full max-w-full" /> : <span className="text-xs text-text-tertiary">Open the Design view for a thumbnail</span>}</div>
            <div className="text-sm font-medium">{project.name}</div>
            <div className="mono text-xs text-text-secondary">{project.partNumber} Rev {rev.label}{rev.frozen ? "" : " (will be frozen on order)"}</div>
          </div>
          <div className="flex flex-col gap-3">
            <Section title="Order lines">
              {lines.map((l, i) => {
                const a = byPed[l.pedigreeId];
                const c = cellFor(l);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-control border border-border-subtle p-2">
                    <Select value={l.pedigreeId} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, pedigreeId: v } : x)))} options={peds.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} />
                    <input className={cx(inputCls, "tnum w-20")} type="number" min={1} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(1, Number(e.target.value)) } : x)))} aria-label="Quantity" />
                    <Select value={l.tier} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, tier: v } : x)))} options={tiers.map((t) => ({ value: t.id, label: `${t.name} (${t.days} d)` }))} />
                    <span className="tnum ml-auto text-sm">{c ? formatMoney(c.total) : project.quote.quantities.includes(l.qty) ? "…" : "price on request"}</span>
                    {a && (
                      <span className="flex items-center gap-1 text-2xs text-text-secondary">
                        <SeverityIcon severity={a.dfm.manufacturability.errors ? "error" : a.dfm.design.errors ? "warning" : "pass"} size={11} />
                        {a.dfm.manufacturability.errors + a.dfm.design.errors} errors · {a.dfm.manufacturability.warnings + a.dfm.design.warnings} warnings
                      </span>
                    )}
                    {c && <span className="text-2xs text-text-tertiary">ships {c.shipDate}</span>}
                    {lines.length > 1 && <button aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}
                  </div>
                );
              })}
              <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { pedigreeId: peds.find((p) => p.id !== lines[0]!.pedigreeId)?.id ?? lines[0]!.pedigreeId, qty: 1, tier: "standard" }])}>
                <Plus size={12} /> Add a line at another pedigree
              </Button>
            </Section>
            <div className="flex items-center gap-2 text-sm">
              Primary pedigree: <PedigreePill id={lines[0]!.pedigreeId} />
            </div>
            {lower && (
              <div className="rounded-control border border-status-warning p-2 text-sm">
                This revision was last ordered at <strong>{peds.find((p) => p.id === highest)?.name}</strong>. You are ordering at a lower pedigree.
                {resolvePedigree(project.pedigreeScheme, lines[0]!.pedigreeId).markings.length > 0 && ` Units will be marked ${resolvePedigree(project.pedigreeScheme, lines[0]!.pedigreeId).markings.map((m) => m.text).join(", ")}.`}
                <Toggle checked={ackLower} onChange={setAckLower} label="I confirm the lower pedigree" />
              </div>
            )}
            {mfgErrors && <div className="text-sm text-status-warning">Manufacturability errors: this becomes a quote request and the price is an estimate.</div>}
            {enforcedErrors && <div className="text-sm text-status-error">An enforced ruleset has open errors. Resolve them or record an approved waiver before ordering.</div>}
            {designErrors > 0 && !enforcedErrors && (
              <div className="rounded-control border border-border-subtle p-2 text-sm">
                {designErrors} design-rule error{designErrors > 1 ? "s" : ""} (your own standard) don't block ordering.
                <Toggle checked={ackDesign} onChange={setAckDesign} label="Acknowledge and continue" />
              </div>
            )}
            <div className="tnum text-right text-lg font-semibold">
              {formatMoney(total)} <DemoTag />
            </div>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-3">
            <Field label="Customer PN / revision"><input className={cx(inputCls, "mono")} defaultValue={`${project.partNumber} Rev ${rev.label}`} /></Field>
            <Field label="Special requirements"><textarea className={cx(inputCls, "h-20 py-1")} /></Field>
            <Field label="Attach customer spec / ICD"><input type="file" disabled className="text-xs text-text-tertiary" title="File uploads arrive with accounts (Phase 2)" /></Field>
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((l, i) => {
              const ped = resolvePedigree(project.pedigreeScheme, l.pedigreeId);
              return (
                <Section key={i} title={<span className="flex items-center gap-2">Requirements from <PedigreePill id={l.pedigreeId} className="text-2xs" /></span>}>
                  <ul className="flex flex-col gap-0.5 text-xs">
                    <li className="flex items-center gap-1"><Lock size={10} /> Workmanship: {ped.workmanship}</li>
                    {ped.inspections.map((x) => <li key={x.typeId} className="flex items-center gap-1"><Lock size={10} /> {svc().inspections.find((t) => t.id === x.typeId)?.name} ({x.sampling})</li>)}
                    {ped.documentation.map((d) => <li key={d} className="flex items-center gap-1"><Lock size={10} /> {d}</li>)}
                    {ped.markings.map((m) => <li key={m.text} className="flex items-center gap-1"><Lock size={10} /> Marking: {m.text}</li>)}
                  </ul>
                  <div className="text-2xs text-text-tertiary">Locked: requirements from the pedigree can't be removed.</div>
                </Section>
              );
            })}
            <Section title="Additional requirements">
              {["Extra hipot at 1500 V", "Customer source inspection", "Additional X-ray 100%"].map((x) => <Toggle key={x} checked={extras.includes(x)} onChange={(v) => setExtras(v ? [...extras, x] : extras.filter((y) => y !== x))} label={x} />)}
            </Section>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="flex flex-col gap-3 opacity-80">
          <div className="text-sm text-text-secondary">Compliance handling arrives with accounts and compliant hosting (Phase 2). Phase 1 makes no export-control claims; nothing leaves your machine.</div>
          <Field label="Export-control classification"><select disabled className={inputCls}><option>EAR99</option><option>ITAR</option><option>Unknown</option></select></Field>
          <label className="flex items-center gap-2 text-sm text-text-tertiary"><input type="checkbox" disabled /> CUI acknowledgment</label>
          <label className="flex items-center gap-2 text-sm text-text-tertiary"><input type="checkbox" disabled /> US-person attestation (ITAR)</label>
        </div>
      )}
      {step === 3 && (
        <div className="flex flex-col gap-3 opacity-80">
          <div className="text-sm text-text-secondary">Payment is inactive in Phase 1.</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Card number"><input disabled className={inputCls} placeholder="•••• •••• •••• ••••" /></Field>
            <Field label="Or purchase order number"><input disabled className={inputCls} /></Field>
            <Field label="Shipping address"><textarea disabled className={cx(inputCls, "h-16")} /></Field>
          </div>
        </div>
      )}
      {step === 4 && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-status-pass text-status-pass"><Check size={24} /></div>
          <div className="text-md font-semibold">Online ordering is coming soon</div>
          <div className="max-w-md text-sm text-text-secondary">{result}</div>
          <div className="text-xs text-text-tertiary">Download the output package from Outputs → Package and send it to us to order.</div>
        </div>
      )}
    </Dialog>
  );
}
