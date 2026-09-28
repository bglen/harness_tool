import { useMemo, useState } from "react";
import { currentRevision, uid } from "@hs/model";
import { RULE_TYPE_BY_ID, severityAcross, type RuleResult } from "@hs/dfm";
import { ChevronDown, ChevronRight, Wand2 } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { useActiveAnalysis } from "../store/analysis";
import { zoomToObjects } from "../lib/viewport";
import { Button, Chip, cx, Dialog, inputCls, SeverityIcon } from "../ui/primitives";
import { PedigreePill } from "../chrome/TopBar";

type SourceFilter = "all" | "manufacturer" | "design";

export function DfmDialog({ data }: { data: { source?: SourceFilter; objectId?: string } | true }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const a = useActiveAnalysis();
  const init = typeof data === "object" ? data : {};
  const [src, setSrc] = useState<SourceFilter>(init.source ?? "all");
  const [q, setQ] = useState("");
  const [openRule, setOpenRule] = useState<string | null>(() => (init.objectId && a ? a.dfm.results.find((r) => r.violations.some((v) => v.objectIds.includes(init.objectId!)))?.eff.rule.id ?? null : null));
  const [showPassed, setShowPassed] = useState(false);
  const close = () => ui.closeDialog("dfm");
  const results = useMemo(() => {
    if (!a) return [] as RuleResult[];
    return a.dfm.results.filter((r) => (src === "all" ? true : src === "manufacturer" ? r.eff.source.layer === "manufacturer" : r.eff.source.layer !== "manufacturer") && (!q || `${r.eff.rule.id} ${r.eff.rule.title} ${r.eff.rule.category}`.toLowerCase().includes(q.toLowerCase())) && (!init.objectId || r.violations.some((v) => v.objectIds.includes(init.objectId!)) || !openRule));
  }, [a, src, q, init.objectId, openRule]);
  if (!a) return null;
  const failing = results.filter((r) => r.status === "fail" || r.status === "error");
  const passed = results.filter((r) => r.status === "pass" || r.status === "waived");
  const off = results.filter((r) => r.status === "off" || r.status === "superseded");
  const cats = [...new Set(failing.map((r) => r.eff.rule.category))];
  const detail = a.dfm.results.find((r) => r.eff.rule.id === openRule);
  return (
    <Dialog open onClose={close} title="Checks" width={1080} description={<span className="flex items-center gap-2">Checked against <PedigreePill id={currentRevision(project).activePedigreeId} /> · {a.dfm.manufacturability.checks + a.dfm.design.checks} active checks · evaluated in {Math.round(a.ms)} ms</span>}>
      <div className="grid h-[64vh] grid-cols-[1fr_380px] gap-4">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "manufacturer", "design"] as const).map((s) => (
              <button key={s} onClick={() => setSrc(s)} className={cx("rounded-chip border px-2 py-0.5 text-xs", src === s ? "border-accent text-text-primary" : "border-border-subtle text-text-secondary")}>
                {s === "all" ? "All sources" : s === "manufacturer" ? "Manufacturer" : "Design rules (team, project, pedigree)"}
              </button>
            ))}
            <input className={cx(inputCls, "ml-auto h-7 w-48 text-xs")} placeholder="Filter rules" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button size="sm" variant="ghost" onClick={() => (close(), ui.openDialog("rules"))}>
              Manage rules
            </Button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded-card border border-border-subtle">
            {!failing.length && <div className="p-4 text-sm text-status-pass">No open issues{src !== "all" ? " for this source" : ""}. {passed.length} checks passed.</div>}
            {cats.map((c) => (
              <div key={c}>
                <div className="label-caps sticky top-0 bg-bg-surface-2 px-3 py-1">{c}</div>
                {failing
                  .filter((r) => r.eff.rule.category === c)
                  .map((r) => (
                    <RuleRow key={r.eff.rule.id} r={r} active={openRule === r.eff.rule.id} onClick={() => setOpenRule(r.eff.rule.id)} />
                  ))}
              </div>
            ))}
            <button className="flex w-full items-center gap-1 border-t border-border-subtle px-3 py-2 text-left text-xs text-text-secondary hover:text-text-primary" onClick={() => setShowPassed(!showPassed)} aria-expanded={showPassed}>
              {showPassed ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <SeverityIcon severity="pass" size={12} /> {passed.length} passed{off.length ? ` · ${off.length} off or superseded` : ""}
            </button>
            {showPassed &&
              [...passed, ...off].map((r) => (
                <RuleRow key={r.eff.rule.id} r={r} active={openRule === r.eff.rule.id} onClick={() => setOpenRule(r.eff.rule.id)} />
              ))}
          </div>
        </div>
        <div className="scroll-thin min-h-0 overflow-auto rounded-card border border-border-subtle p-3">{detail ? <RuleDetail r={detail} /> : <div className="text-sm text-text-tertiary">Select a check to see what it checks, why it matters, its threshold and source, and the affected objects.</div>}</div>
      </div>
    </Dialog>
  );
}

function RuleRow({ r, active, onClick }: { r: RuleResult; active: boolean; onClick: () => void }) {
  const project = useProject((s) => s.project)!;
  const across = severityAcross(r.eff, project);
  return (
    <button onClick={onClick} className={cx("flex w-full items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-left text-sm hover:bg-bg-hover", active && "bg-bg-hover")}>
      <SeverityIcon severity={r.status === "pass" || r.status === "waived" ? "pass" : r.status === "off" || r.status === "superseded" ? "off" : r.eff.severity} />
      <span className="mono w-28 shrink-0 text-2xs text-text-secondary">{r.eff.rule.id}</span>
      <span className="min-w-0 flex-1 truncate">{r.eff.rule.title}</span>
      {across && <span className="hidden text-2xs text-text-tertiary xl:inline">{across}</span>}
      <Chip>{r.eff.source.layer === "manufacturer" ? "Manufacturer" : r.eff.source.layer === "project" ? "Project" : r.eff.source.name}</Chip>
      <span className="tnum w-16 text-right text-xs text-text-secondary">{r.status === "fail" ? `${r.violations.length} affected` : r.status === "waived" ? "waived" : r.status === "error" ? "rule error" : r.status}</span>
    </button>
  );
}

function RuleDetail({ r }: { r: RuleResult }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const [note, setNote] = useState("");
  const t = RULE_TYPE_BY_ID.get(r.eff.rule.type);
  const waivable = r.eff.source.layer === "manufacturer" ? r.eff.severity !== "error" : r.eff.source.layer !== "pedigree" && !r.eff.source.enforced;
  const across = severityAcross(r.eff, project);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        <div className="mono text-xs text-text-secondary">{r.eff.rule.id}</div>
        <div className="text-md font-semibold">{r.eff.rule.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Chip>{r.eff.source.name}</Chip>
          <Chip>{r.eff.rule.category}</Chip>
          <Chip className="capitalize">{r.eff.severity}</Chip>
          {r.eff.overridden && <Chip>overridden in project</Chip>}
        </div>
      </div>
      <div>
        <div className="label-caps">What it checks</div>
        <p className="text-text-secondary">{r.eff.rule.description || t?.description}</p>
      </div>
      {r.eff.rule.rationale && (
        <div>
          <div className="label-caps">Why it matters</div>
          <p className="text-text-secondary">{r.eff.rule.rationale}</p>
        </div>
      )}
      {t && t.params.length > 0 && (
        <div>
          <div className="label-caps">Threshold</div>
          {t.params.map((p) => (
            <div key={p.key} className="flex justify-between text-xs">
              <span className="text-text-secondary">{p.label}</span>
              <span className="mono">
                {JSON.stringify(r.eff.params[p.key] ?? p.default ?? "—")} {p.unit ?? ""}
              </span>
            </div>
          ))}
          <div className="mt-1 text-2xs text-text-tertiary">Source: {r.eff.rule.paramSource ?? r.eff.source.name}</div>
        </div>
      )}
      {across && <div className="text-xs text-text-secondary">{across}</div>}
      {r.eff.notes.map((n, i) => (
        <div key={i} className="rounded-control border border-border-subtle p-2 text-xs text-text-secondary">
          {n}
        </div>
      ))}
      {r.error && <div className="text-xs text-status-error">Rule error: {r.error}</div>}
      {r.violations.length > 0 && (
        <div>
          <div className="label-caps">Affected ({r.violations.length})</div>
          <ul className="flex flex-col gap-1">
            {r.violations.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <button className="flex-1 text-left hover:text-accent" onClick={() => (ui.closeDialog("dfm"), ui.setView("design"), zoomToObjects(v.objectIds))}>
                  {v.message}
                </button>
                {v.fix && (
                  <Button size="sm" variant="secondary" onClick={() => dispatch(v.fix!.commands, v.fix!.label)}>
                    <Wand2 size={12} /> {v.fix.label}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.waived.length > 0 && (
        <div>
          <div className="label-caps">Waived</div>
          {r.waived.map((w, i) => (
            <div key={i} className="flex items-center justify-between text-xs text-text-secondary">
              <span>
                {w.message} <em>“{w.note}”</em>
              </span>
              <button className="text-accent" onClick={() => dispatch({ type: "removeWaivers", payload: { ids: [w.waiverId] } })}>
                un-waive
              </button>
            </div>
          ))}
        </div>
      )}
      {r.status === "fail" && (
        <div className="flex flex-col gap-1 border-t border-border-subtle pt-2">
          {waivable ? (
            <>
              <input className={inputCls} placeholder="Waiver note (required)" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button
                size="sm"
                disabled={!note.trim()}
                onClick={() => {
                  dispatch(r.violations.map((v) => ({ type: "addWaiver", payload: { waiver: { id: uid(), ruleId: r.eff.rule.id, objectId: v.objectIds[0] ?? "*", note, author: "", date: new Date().toISOString().slice(0, 10) } } })), `Waive ${r.eff.rule.id}`);
                  setNote("");
                }}
              >
                Waive {r.violations.length} with note
              </Button>
              <div className="text-2xs text-text-tertiary">Waivers are recorded in the design and on the drawing.</div>
            </>
          ) : (
            <div className="text-2xs text-text-tertiary">{r.eff.source.layer === "manufacturer" ? "Manufacturer errors can't be waived: the design can't be built as designed." : r.eff.source.enforced ? "This ruleset is enforced: resolve or get a formally approved waiver." : "Pedigree requirements can't be waived."}</div>
          )}
        </div>
      )}
      <Button size="sm" variant="ghost" onClick={() => (ui.closeDialog("dfm"), ui.openDialog("rules", { ruleId: r.eff.rule.id }))}>
        Edit this rule
      </Button>
    </div>
  );
}
