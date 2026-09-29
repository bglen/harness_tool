import { useMemo, useState } from "react";
import { currentHarness, uid, type Harness } from "@hs/model";
import { RULE_TYPE_BY_ID, severityAcross, violationKey, type RuleResult, type Violation } from "@hs/dfm";
import { ChevronDown, ChevronRight, ShieldCheck, Wand2, X } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { activePedigreeOf, useActiveAnalysis } from "../store/analysis";
import { zoomToObjects } from "../lib/viewport";
import { Button, Chip, cx, Dialog, inputCls, SeverityIcon } from "../ui/primitives";
import { PedigreePill } from "../chrome/TopBar";

type SourceFilter = "all" | "manufacturer" | "design";

/** Human name of any object id in the harness (for the "findings for …" filter). */
export function objectName(h: Harness, id: string): string {
  const c = h.connectors.find((x) => x.id === id);
  if (c) return c.refDes || c.pn;
  const w = h.wires.find((x) => x.id === id);
  if (w) return `wire ${w.label}`;
  const n = h.nets.find((x) => x.id === id);
  if (n) return `net ${n.name}`;
  const s = h.segments.find((x) => x.id === id);
  if (s) return s.label ? `segment ${s.label}` : "segment";
  const nd = h.nodes.find((x) => x.id === id);
  if (nd) return nd.kind === "breakout" ? `breakout B${h.nodes.filter((x) => x.kind === "breakout").indexOf(nd) + 1}` : "node";
  const sh = h.shields.find((x) => x.id === id);
  if (sh) return `shield ${sh.label}`;
  return "object";
}

const involves = (r: RuleResult, id: string) => r.violations.some((v) => v.objectIds.includes(id)) || r.waived.some((v) => v.objectIds.includes(id));

export function DfmDialog({ data }: { data: { source?: SourceFilter; objectId?: string } | true }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const a = useActiveAnalysis();
  const init = typeof data === "object" ? data : {};
  const [src, setSrc] = useState<SourceFilter>(init.source ?? "all");
  const [q, setQ] = useState("");
  // Opened from a selected part: show only findings (open and waived) that involve it, until cleared.
  const [objectId, setObjectId] = useState<string | undefined>(init.objectId);
  const [openRule, setOpenRule] = useState<string | null>(() => (init.objectId && a ? a.dfm.results.find((r) => involves(r, init.objectId!))?.eff.rule.id ?? null : null));
  const [showPassed, setShowPassed] = useState(false);
  const [showWaived, setShowWaived] = useState(true);
  const close = () => ui.closeDialog("dfm");
  const h = currentHarness(project);
  const results = useMemo(() => {
    if (!a) return [] as RuleResult[];
    return a.dfm.results.filter(
      (r) =>
        (src === "all" ? true : src === "manufacturer" ? r.eff.source.layer === "manufacturer" : r.eff.source.layer !== "manufacturer") &&
        (!q || `${r.eff.rule.id} ${r.eff.rule.title} ${r.eff.rule.category}`.toLowerCase().includes(q.toLowerCase())) &&
        (!objectId || involves(r, objectId)),
    );
  }, [a, src, q, objectId]);
  if (!a) return null;
  const failing = results.filter((r) => r.status === "fail" || r.status === "engineError" || r.status === "missingInput" || r.status === "notEvaluated");
  const waivedRules = results.filter((r) => r.waived.length > 0);
  const waivedCount = waivedRules.reduce((s, r) => s + r.waived.filter((w) => !objectId || w.objectIds.includes(objectId)).length, 0);
  const passed = results.filter((r) => r.status === "pass" || r.status === "notApplicable" || (r.status === "waived" && !r.violations.length));
  const off = results.filter((r) => r.status === "off");
  const cats = [...new Set(failing.map((r) => (r.status === "fail" ? r.eff.rule.category : "Couldn't run")))];
  const detail = a.dfm.results.find((r) => r.eff.rule.id === openRule);
  const unmatched = project.waivers.filter((w) => a.dfm.unmatchedWaivers.includes(w.id));
  return (
    <Dialog open onClose={close} title="Checks" width={1120} description={<span className="flex items-center gap-2">Checked against <PedigreePill id={activePedigreeOf(project)} /> · {a.dfm.manufacturability.checks + a.dfm.design.checks} active checks · evaluated in {Math.round(a.ms)} ms</span>}>
      <div className="grid h-[64vh] grid-cols-[1fr_420px] gap-4">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "manufacturer", "design"] as const).map((s) => (
              <button key={s} onClick={() => setSrc(s)} className={cx("rounded-chip border px-2 py-0.5 text-xs", src === s ? "border-accent text-text-primary" : "border-border-subtle text-text-secondary")}>
                {s === "all" ? "All sources" : s === "manufacturer" ? "Manufacturer" : "Design rules (team, project, pedigree)"}
              </button>
            ))}
            {objectId && (
              <span className="flex items-center gap-1 rounded-chip border border-accent px-2 py-0.5 text-xs">
                Findings for {objectName(h, objectId)}
                <button aria-label="Show all findings" className="text-text-tertiary hover:text-text-primary" onClick={() => setObjectId(undefined)}>
                  <X size={12} />
                </button>
              </span>
            )}
            <input className={cx(inputCls, "ml-auto h-7 w-44 text-xs")} placeholder="Filter rules" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button size="sm" variant="ghost" onClick={() => (close(), ui.openDialog("rules"))}>
              Manage rules
            </Button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded-card border border-border-subtle">
            {!failing.length && <div className="p-4 text-sm text-status-pass">No open findings{objectId ? ` for ${objectName(h, objectId)}` : src !== "all" ? " for this source" : ""}.</div>}
            {cats.map((c) => (
              <div key={c}>
                <div className="label-caps sticky top-0 bg-bg-surface-2 px-3 py-1">{c}</div>
                {failing
                  .filter((r) => (r.status === "fail" ? r.eff.rule.category : "Couldn't run") === c)
                  .map((r) => (
                    <RuleRow key={r.eff.rule.id} r={r} objectId={objectId} active={openRule === r.eff.rule.id} onClick={() => setOpenRule(r.eff.rule.id)} />
                  ))}
              </div>
            ))}
            {waivedRules.length > 0 && (
              <>
                <button className="flex w-full items-center gap-1 border-t border-border-subtle px-3 py-2 text-left text-xs text-text-secondary hover:text-text-primary" onClick={() => setShowWaived(!showWaived)} aria-expanded={showWaived}>
                  {showWaived ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <ShieldCheck size={12} /> {waivedCount} waived finding{waivedCount === 1 ? "" : "s"}
                </button>
                {showWaived &&
                  waivedRules.map((r) => (
                    <RuleRow key={`w-${r.eff.rule.id}`} r={r} objectId={objectId} waivedView active={openRule === r.eff.rule.id} onClick={() => setOpenRule(r.eff.rule.id)} />
                  ))}
              </>
            )}
            {unmatched.length > 0 && !objectId && (
              <div className="border-t border-border-subtle px-3 py-2 text-xs">
                <div className="mb-1 text-text-secondary">Waivers that no longer match a finding ({unmatched.length}): the finding was fixed or changed.</div>
                {unmatched.map((w) => (
                  <div key={w.id} className="flex items-center gap-2 py-0.5 text-text-tertiary">
                    <span className="mono text-2xs">{w.ruleId}</span>
                    <span className="min-w-0 flex-1 truncate">{w.message ?? w.note}</span>
                    <span className="text-2xs">
                      {w.author || "unknown"} · {w.date}
                    </span>
                    <button className="text-accent hover:underline" onClick={() => dispatch({ type: "removeWaivers", payload: { ids: [w.id] } }, "Remove waiver")}>
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button className="flex w-full items-center gap-1 border-t border-border-subtle px-3 py-2 text-left text-xs text-text-secondary hover:text-text-primary" onClick={() => setShowPassed(!showPassed)} aria-expanded={showPassed}>
              {showPassed ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <SeverityIcon severity="pass" size={12} /> {passed.length} checks with no findings{off.length ? ` · ${off.length} off` : ""}
            </button>
            {showPassed &&
              [...passed, ...off].map((r) => (
                <RuleRow key={`p-${r.eff.rule.id}`} r={r} active={openRule === r.eff.rule.id} onClick={() => setOpenRule(r.eff.rule.id)} />
              ))}
          </div>
        </div>
        <div className="scroll-thin min-h-0 overflow-auto rounded-card border border-border-subtle p-3">
          {detail ? <RuleDetail r={detail} objectId={objectId} /> : <div className="text-sm text-text-tertiary">Select a check to see what it looks for, why it matters, its threshold and source, the affected objects and any waivers.</div>}
        </div>
      </div>
    </Dialog>
  );
}

function RuleRow({ r, active, onClick, objectId, waivedView }: { r: RuleResult; active: boolean; onClick: () => void; objectId?: string; waivedView?: boolean }) {
  const project = useProject((s) => s.project)!;
  const across = severityAcross(r.eff, project);
  const open = r.violations.filter((v) => !objectId || v.objectIds.includes(objectId)).length;
  const waived = r.waived.filter((v) => !objectId || v.objectIds.includes(objectId)).length;
  const status = waivedView
    ? `${waived} waived`
    : r.status === "fail"
      ? `${open} affected${waived ? ` · ${waived} waived` : ""}`
      : r.status === "waived"
        ? "all waived"
        : r.status === "engineError"
          ? "rule error"
          : r.status === "missingInput"
            ? "missing input"
            : r.status === "notEvaluated"
              ? "not run"
              : r.status === "notApplicable"
                ? "n/a"
                : r.status === "pass"
                  ? "none found"
                  : r.status;
  return (
    <button onClick={onClick} className={cx("flex w-full items-center gap-2 border-b border-border-subtle px-3 py-1.5 text-left text-sm hover:bg-bg-hover", active && "bg-bg-hover")}>
      {waivedView ? <ShieldCheck size={14} className="text-text-tertiary" /> : <SeverityIcon severity={r.status === "pass" || r.status === "waived" || r.status === "notApplicable" ? "pass" : r.status === "off" ? "off" : r.status === "fail" ? r.eff.severity : "error"} />}
      <span className="mono w-28 shrink-0 text-2xs text-text-secondary">{r.eff.rule.id}</span>
      <span className={cx("min-w-0 flex-1 truncate", waivedView && "text-text-secondary")}>{r.eff.rule.title}</span>
      {across && <span className="hidden text-2xs text-text-tertiary xl:inline">{across}</span>}
      <Chip>{r.eff.source.layer === "manufacturer" ? "Manufacturer" : r.eff.source.layer === "project" ? "Project" : r.eff.source.name}</Chip>
      <span className="tnum w-28 text-right text-xs text-text-secondary">{status}</span>
    </button>
  );
}

/** Waive one finding: reason + engineer (prefilled with the current user, editable). */
function WaiveForm({ r, targets, onDone, label }: { r: RuleResult; targets: Violation[]; onDone: () => void; label: string }) {
  const ui = useUi();
  const [note, setNote] = useState("");
  const [author, setAuthor] = useState(ui.userName);
  const ok = note.trim() && author.trim();
  const submit = () => {
    if (!ok) return;
    if (author.trim() !== ui.userName) ui.setUserName(author.trim());
    const date = new Date().toISOString().slice(0, 10);
    const cmds = targets.map((v) => ({ type: "addWaiver", payload: { waiver: { id: uid(), ruleId: r.eff.rule.id, objectId: v.objectIds[0] ?? "*", violationKey: violationKey(v), message: v.message, note: note.trim(), author: author.trim(), date } } }));
    if (dispatch(cmds, targets.length === 1 ? `Waive ${r.eff.rule.id} finding` : `Waive ${targets.length} ${r.eff.rule.id} findings`)) onDone();
  };
  return (
    <div className="mt-1 flex flex-col gap-1 rounded-control border border-border-subtle bg-bg-surface-1 p-2">
      <input autoFocus className={cx(inputCls, "h-7 text-xs")} placeholder="Reason (required)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
      <label className="flex items-center gap-2 text-2xs text-text-secondary">
        Waived by
        <input className={cx(inputCls, "h-7 flex-1 text-xs")} value={author} onChange={(e) => setAuthor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} aria-label="Engineer name" />
      </label>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={!ok} onClick={submit}>
          {label}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <span className="ml-auto text-2xs text-text-tertiary">Signed-in user is a mock (Phase 1)</span>
      </div>
    </div>
  );
}

function RuleDetail({ r, objectId }: { r: RuleResult; objectId?: string }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  // Which finding (index) or "all" is being waived.
  const [waiving, setWaiving] = useState<number | "all" | null>(null);
  const t = RULE_TYPE_BY_ID.get(r.eff.rule.type);
  const waivable = r.eff.source.layer === "manufacturer" ? r.eff.severity !== "error" : r.eff.source.layer !== "pedigree" && !r.eff.source.enforced;
  const across = severityAcross(r.eff, project);
  const open = r.violations.filter((v) => !objectId || v.objectIds.includes(objectId));
  const waived = r.waived.filter((v) => !objectId || v.objectIds.includes(objectId));
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
        <div className="label-caps">What it looks for</div>
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
      {open.length > 0 && (
        <div>
          <div className="flex items-center justify-between">
            <div className="label-caps">Open findings ({open.length})</div>
            {waivable && open.length > 1 && waiving === null && (
              <button className="text-2xs text-accent hover:underline" onClick={() => setWaiving("all")}>
                Waive all {open.length}…
              </button>
            )}
          </div>
          {waiving === "all" && <WaiveForm r={r} targets={open} label={`Waive all ${open.length}`} onDone={() => setWaiving(null)} />}
          <ul className="flex flex-col gap-1.5">
            {open.map((v, i) => (
              <li key={violationKey(v) + i} className="text-xs">
                <div className="flex items-start gap-2">
                  <button className="flex-1 text-left hover:text-accent" onClick={() => (ui.closeDialog("dfm"), ui.setView("design"), zoomToObjects(v.objectIds))}>
                    {v.message}
                  </button>
                  {v.fix && (
                    <Button size="sm" variant="secondary" onClick={() => dispatch(v.fix!.commands, v.fix!.label)}>
                      <Wand2 size={12} /> {v.fix.label}
                    </Button>
                  )}
                  {waivable && waiving === null && (
                    <Button size="sm" variant="ghost" onClick={() => setWaiving(i)} title="Waive only this finding">
                      Waive…
                    </Button>
                  )}
                </div>
                {waiving === i && <WaiveForm r={r} targets={[v]} label="Waive this finding" onDone={() => setWaiving(null)} />}
              </li>
            ))}
          </ul>
          {!waivable && <div className="mt-1 text-2xs text-text-tertiary">{r.eff.source.layer === "manufacturer" ? "Manufacturer errors can't be waived: the design can't be built as designed." : r.eff.source.enforced ? "This ruleset is enforced: resolve or get a formally approved waiver." : "Pedigree requirements can't be waived."}</div>}
        </div>
      )}
      {waived.length > 0 && (
        <div>
          <div className="label-caps">Waived ({waived.length})</div>
          <div className="mb-1 text-2xs text-text-tertiary">A waiver records acceptance of one finding. Manual operations, cost and lead-time consequences still apply.</div>
          <ul className="flex flex-col gap-1.5">
            {waived.map((w) => (
              <li key={w.waiverId} className="rounded-control border border-border-subtle p-2 text-xs">
                <div className="flex items-start gap-2">
                  <ShieldCheck size={13} className="mt-[1px] shrink-0 text-text-tertiary" />
                  <button className="flex-1 text-left text-text-secondary hover:text-accent" onClick={() => (ui.closeDialog("dfm"), ui.setView("design"), zoomToObjects(w.objectIds))}>
                    {w.message}
                  </button>
                  <button className="shrink-0 text-accent hover:underline" onClick={() => dispatch({ type: "removeWaivers", payload: { ids: [w.waiverId] } }, "Remove waiver")}>
                    un-waive
                  </button>
                </div>
                <div className="mt-1 pl-5 text-text-secondary">
                  “{w.note}” <span className="text-text-tertiary">· {w.author || "unknown engineer"} · {w.date}</span>
                </div>
                {w.changed && (
                  <div className="mt-1 pl-5 text-2xs text-status-warning">
                    Changed since it was waived (was: “{w.waivedMessage}”). Re-assess and re-waive or un-waive.
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button size="sm" variant="ghost" onClick={() => (ui.closeDialog("dfm"), ui.openDialog("rules", { ruleId: r.eff.rule.id }))}>
        Edit this rule
      </Button>
    </div>
  );
}
