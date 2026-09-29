import { currentRevision, formatMoney } from "@hs/model";
import type { RuleResult } from "@hs/dfm";
import { ChevronRight } from "lucide-react";
import { useProject } from "../store/project";
import { activePedigreeOf, useActiveAnalysis, useAnalysis, useBom } from "../store/analysis";
import { useUi } from "../store/ui";
import { zoomToObjects } from "../lib/viewport";
import { cx, DemoTag, SeverityIcon } from "../ui/primitives";

export const STATUS = {
  ready: { dot: "var(--status-pass)", text: "Ready for automated build" },
  manual: { dot: "var(--status-warning)", text: "Buildable with manual steps" },
  incomplete: { dot: "var(--status-warning)", text: "Needs review before it can be called ready" },
  notBuildable: { dot: "var(--status-error)", text: "Not buildable" },
} as const;

const SEV_ORDER = { error: 0, warning: 1, info: 2, off: 3 } as const;

export function topIssues(results: RuleResult[], n = 5) {
  return results
    .filter((r) => r.status === "fail" || r.status === "engineError" || r.status === "missingInput")
    .flatMap((r) => (r.status === "fail" ? r.violations : [{ objectIds: [], objectKind: "project" as const, message: `Check couldn't run (${r.status}): ${r.error ?? ""}` }]).map((v) => ({ r, v })))
    .sort((a, b) => SEV_ORDER[a.r.eff.severity] - SEV_ORDER[b.r.eff.severity])
    .slice(0, n);
}

export function DfmCard() {
  const a = useActiveAnalysis();
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const ped = project.pedigreeScheme.pedigrees.find((p) => p.id === activePedigreeOf(project));
  const workerError = useAnalysis((s) => s.workerError);
  const pedError = useAnalysis((s) => s.errors[activePedigreeOf(project)]);
  const failure = workerError ?? pedError;
  if (failure)
    return (
      <section className="border-b border-border-subtle p-3" aria-label="Manufacturability" role="alert">
        <h2 className="label-caps mb-1">Manufacturability</h2>
        <div className="flex items-center gap-2 text-sm font-medium text-status-error">
          <SeverityIcon severity="error" /> Checks didn't run
        </div>
        <div className="mt-1 text-xs text-text-secondary">{failure}. No result is shown as passing. Edit the design or reload to retry.</div>
      </section>
    );
  if (!a) return <section className="border-b border-border-subtle p-3 text-xs text-text-tertiary shimmer">Checking…</section>;
  // An empty design has nothing to build; don't claim it's ready.
  if (!currentRevision(project).harness.connectors.length)
    return (
      <section className="border-b border-border-subtle p-3" aria-label="Manufacturability">
        <h2 className="label-caps mb-1">Manufacturability</h2>
        <div className="text-xs text-text-tertiary">Add connectors to check manufacturability.</div>
      </section>
    );
  const m = a.dfm.manufacturability;
  const d = a.dfm.design;
  const st = STATUS[m.status];
  const issues = topIssues(a.dfm.results);
  return (
    <section className="border-b border-border-subtle p-3" aria-label="Manufacturability">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="label-caps">Manufacturability</h2>
        <span className="text-2xs text-text-tertiary">{a.stale ? "Updating…" : `Checked against ${ped?.name}`}</span>
      </div>
      <button className="flex w-full items-center gap-2 text-left" onClick={() => ui.openDialog("dfm", { source: "manufacturer" })}>
        <svg width="10" height="10" aria-hidden>
          <circle cx="5" cy="5" r="5" fill={st.dot} />
        </svg>
        <span className="text-sm font-medium">{st.text}</span>
      </button>
      <div className="tnum mt-0.5 pl-[18px] text-xs text-text-secondary">
        {m.checks} checks · {m.errors} errors · {m.warnings} warnings · {m.infos} info
        {m.incomplete > 0 && <span className="text-status-error"> · {m.incomplete} couldn't run</span>}
      </div>
      {m.status !== "ready" && m.blockers.length > 0 && (
        <details className="mt-1 pl-[18px] text-2xs text-text-secondary">
          <summary className="cursor-pointer text-text-tertiary">Why not ready ({m.blockers.length})</summary>
          <ul className="mt-0.5 list-disc pl-4">
            {m.blockers.slice(0, 8).map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </details>
      )}
      <button className="mt-2 flex w-full items-center gap-2 text-left" onClick={() => ui.openDialog("dfm", { source: "design" })}>
        <SeverityIcon severity={d.errors ? "error" : d.warnings ? "warning" : "pass"} />
        <span className="text-sm font-medium">{d.errors || d.warnings ? `Design rules: ${d.errors} errors · ${d.warnings} warnings` : d.incomplete ? `Design rules: ${d.incomplete} couldn't run` : `Design rules: ${d.passed} checks passed`}</span>
      </button>
      <div className="mt-0.5 truncate pl-[22px] text-2xs text-text-tertiary" title={d.rulesets.join(", ")}>
        {d.rulesets.length ? d.rulesets.join(" · ") : "No team or project rules yet"}
      </div>
      {issues.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5" aria-label="Top issues">
          {issues.map(({ r, v }, i) => (
            <li key={i}>
              <button
                className="flex w-full items-start gap-1.5 rounded-control px-1 py-0.5 text-left text-xs hover:bg-bg-hover"
                onClick={() => {
                  ui.setView("design");
                  const ids = v.objectIds;
                  const h = currentRevision(project).harness;
                  const kind = h.connectors.some((c) => c.id === ids[0]) ? "connector" : h.wires.some((w) => w.id === ids[0]) ? "wire" : h.segments.some((s) => s.id === ids[0]) ? "segment" : h.nets.some((n) => n.id === ids[0]) ? "net" : null;
                  if (kind) ui.select(kind, [ids[0]!]);
                  zoomToObjects(ids);
                }}
              >
                <span className="pt-[1px]">
                  <SeverityIcon severity={r.eff.severity} size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mono mr-1 text-2xs text-text-tertiary">{r.eff.rule.id}</span>
                  <span className="text-text-primary">{v.message}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-between text-xs">
        <button className="flex items-center text-accent hover:underline" onClick={() => ui.openDialog("dfm")}>
          {m.checks + d.checks} checks <ChevronRight size={12} />
        </button>
        <button className="flex items-center text-text-secondary hover:text-text-primary" onClick={() => ui.openDialog("rules")}>
          Rules <ChevronRight size={12} />
        </button>
      </div>
      {m.status === "ready" && !a.stale && d.errors === 0 && currentRevision(project).harness.wires.length > 0 && (
        <button className="mt-2 w-full rounded-control border border-status-pass px-2 py-1 text-xs text-status-pass hover:bg-bg-hover" onClick={() => ui.openDialog("order")}>
          Ready for automated build: order now
        </button>
      )}
    </section>
  );
}

export function BomSnapshot() {
  const bom = useBom();
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const crit = bom.criticalPath;
  const byCat = new Map<string, number>();
  for (const l of bom.lines) byCat.set(l.category, (byCat.get(l.category) ?? 0) + l.extCost);
  const top = [...byCat].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <section className="p-3" aria-label="BOM snapshot">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="label-caps">BOM snapshot</h2>
        <DemoTag />
      </div>
      <div className="flex items-baseline justify-between">
        <span className="tnum text-lg font-semibold">{formatMoney(bom.materialCost)}</span>
        <span className="text-xs text-text-secondary">{bom.lines.length} lines · material / unit</span>
      </div>
      <ul className="mt-1 flex flex-col gap-0.5 text-xs">
        {top.map(([c, v]) => (
          <li key={c} className="flex justify-between text-text-secondary">
            <span>{c}</span>
            <span className="tnum">{formatMoney(v)}</span>
          </li>
        ))}
      </ul>
      {crit && (
        <div className={cx("mt-2 rounded-control border border-border-subtle px-2 py-1 text-xs")}>
          <div className="text-2xs text-text-tertiary">Critical part (stock short for {project.quote.selected.qty} units)</div>
          <div className="mono truncate">{crit.pn}</div>
          <div className="text-text-secondary">
            {crit.stock} in stock · {crit.leadDays} days lead time
          </div>
        </div>
      )}
      {!crit && bom.lines.length > 0 && <div className="mt-2 text-xs text-text-secondary">Stock covers {project.quote.selected.qty} units (demo data)</div>}
      <button className="mt-2 flex items-center text-xs text-accent hover:underline" onClick={() => ui.setView("bom")}>
        Open BOM <ChevronRight size={12} />
      </button>
    </section>
  );
}
