import { useEffect, useMemo, useState } from "react";
import { type CustomCond, type CustomRule, type RuleInstance, type Ruleset, type Severity } from "@hs/model";
import { CUSTOM_FIELDS, describeCustom, diffRuleset, parseRulesetFile, RULE_TYPES, RULE_TYPE_BY_ID, runDfm, validateCustom, validateRule, type ParamDef, type RulesetDiff } from "@hs/dfm";
import { Copy, Download, Lock, Plus, Trash2, Upload } from "lucide-react";
import { dispatch, getProject, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { useActiveAnalysis } from "../store/analysis";
import { svc } from "../lib/services";
import { downloadBlob, pickFile } from "../lib/files";
import { Button, Chip, cx, Dialog, Field, IconButton, inputCls, Section, Select, SeverityIcon, Toggle } from "../ui/primitives";

type LayerSel = { kind: "mfg" } | { kind: "ruleset"; id: string } | { kind: "project" } | { kind: "all" };
const SEVS: Severity[] = ["off", "info", "warning", "error"];

export function RulesManager({ data }: { data: { ruleId?: string; importFile?: File } | true }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const a = useActiveAnalysis();
  const s = svc();
  const init = typeof data === "object" ? data : {};
  const [layer, setLayer] = useState<LayerSel>({ kind: "all" });
  const [selected, setSelected] = useState<string | null>(init.ruleId ?? null);
  const [matrix, setMatrix] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importState, setImportState] = useState<{ ruleset: Ruleset; diff: RulesetDiff } | { errors: string[] } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const close = () => ui.closeDialog("rules");

  const allRules = useMemo(() => {
    const out: { rule: RuleInstance; src: "mfg" | "ruleset" | "project"; rs?: Ruleset }[] = [];
    for (const r of s.profile.rules) out.push({ rule: r, src: "mfg" });
    for (const rs of project.rulesets) for (const r of rs.rules) out.push({ rule: r, src: "ruleset", rs });
    for (const r of project.projectRules) out.push({ rule: r, src: "project" });
    return out;
  }, [project.rulesets, project.projectRules, s.profile.rules]);
  const shown = allRules.filter((x) => layer.kind === "all" || (layer.kind === "mfg" && x.src === "mfg") || (layer.kind === "project" && x.src === "project") || (layer.kind === "ruleset" && x.rs?.id === layer.id));
  const res = (id: string) => a?.dfm.results.find((r) => r.eff.rule.id === id);
  const sel = allRules.find((x) => x.rule.id === selected);

  useEffect(() => {
    if (init.importFile) void importFile(init.importFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function importFile(f?: File) {
    const file = f ?? (await pickFile(".json,.harnessrules.json"));
    if (!file) return;
    const parsed = parseRulesetFile(await file.text());
    if (!parsed.ruleset) return setImportState({ errors: parsed.errors });
    const existing = getProject().rulesets.find((r) => r.id === parsed.ruleset!.id);
    setImportState({ ruleset: parsed.ruleset, diff: diffRuleset(existing, parsed.ruleset) });
  }

  const saveRule = (entry: (typeof allRules)[number], rule: RuleInstance) => {
    if (entry.src === "project") dispatch({ type: "upsertProjectRule", payload: { rule } });
    else if (entry.src === "ruleset" && entry.rs) {
      if (entry.rs.enforced) return ui.toast({ kind: "info", text: "Enforced ruleset: edit it at its source" });
      dispatch({ type: "upsertRuleset", payload: { ruleset: { ...entry.rs, rules: entry.rs.rules.map((r) => (r.id === rule.id ? rule : r)) } } });
    }
  };

  const nextId = (prefix: string, rules: RuleInstance[]) => {
    for (let i = 1; ; i++) {
      const id = `${prefix}-${String(i).padStart(3, "0")}`;
      if (!rules.some((r) => r.id === id)) return id;
    }
  };

  return (
    <Dialog open onClose={close} title="Rules" width={1240} description="Manufacturer rules are always applied and can only be tightened. Team rulesets and project rules add your own standards.">
      <div className="grid h-[68vh] grid-cols-[220px_1fr_380px] gap-3">
        {/* Layers */}
        <div className="scroll-thin flex flex-col gap-1 overflow-auto rounded-card border border-border-subtle p-2 text-sm">
          <LayerBtn on={layer.kind === "all"} onClick={() => setLayer({ kind: "all" })}>
            All layers <span className="text-text-tertiary">({allRules.length})</span>
          </LayerBtn>
          <LayerBtn on={layer.kind === "mfg"} onClick={() => setLayer({ kind: "mfg" })}>
            <Lock size={12} /> Manufacturer <span className="text-2xs text-text-tertiary">v{s.profile.version}</span>
          </LayerBtn>
          {project.rulesets.map((rs) => (
            <div key={rs.id} className="group flex items-center">
              <LayerBtn on={layer.kind === "ruleset" && layer.id === rs.id} onClick={() => setLayer({ kind: "ruleset", id: rs.id })}>
                <span className="truncate">{rs.name}</span> <span className="text-2xs text-text-tertiary">v{rs.version}</span>
                {rs.enforced && <Lock size={10} />}
              </LayerBtn>
              <IconButton label="Export ruleset" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => downloadBlob(`${rs.id}_v${rs.version}.harnessrules.json`, JSON.stringify(rs, null, 2))}>
                <Download size={12} />
              </IconButton>
              {!rs.enforced && (
                <IconButton label="Remove from project" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => dispatch({ type: "removeRuleset", payload: { id: rs.id } })}>
                  <Trash2 size={12} />
                </IconButton>
              )}
            </div>
          ))}
          <LayerBtn on={layer.kind === "project"} onClick={() => setLayer({ kind: "project" })}>
            Project rules <span className="text-text-tertiary">({project.projectRules.length})</span>
          </LayerBtn>
          <div className="mt-2 border-t border-border-subtle pt-2">
            <div className="label-caps mb-1">Add ruleset</div>
            {s.library.rulesets
              .filter((r) => r.rules.length && !project.rulesets.some((x) => x.id === r.id))
              .map((r) => (
                <button key={r.id} className="block w-full rounded-control px-2 py-1 text-left text-xs hover:bg-bg-hover" onClick={() => dispatch({ type: "upsertRuleset", payload: { ruleset: r } })}>
                  + {r.name}
                </button>
              ))}
            <button className="flex w-full items-center gap-1 rounded-control px-2 py-1 text-left text-xs hover:bg-bg-hover" onClick={() => void importFile()}>
              <Upload size={12} /> Import .harnessrules.json…
            </button>
            <button
              className="flex w-full items-center gap-1 rounded-control px-2 py-1 text-left text-xs hover:bg-bg-hover"
              onClick={() => {
                const name = prompt("Ruleset name", "Team standard");
                if (!name) return;
                const prefix = (prompt("Rule ID prefix (2–10 capitals, e.g. ACME)", "TEAM") ?? "TEAM").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "TEAM";
                const id = `rs-${Date.now().toString(36)}`;
                dispatch({ type: "upsertRuleset", payload: { ruleset: { schemaVersion: 1, id, name, prefix, version: "1.0.0", author: "", description: "", changelog: [], enforced: false, rules: [] } } });
                setLayer({ kind: "ruleset", id });
              }}
            >
              <Plus size={12} /> New ruleset
            </button>
          </div>
        </div>

        {/* Table / matrix */}
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex items-center gap-2">
            <Toggle checked={matrix} onChange={setMatrix} label="Pedigree matrix" />
            <div className="flex-1" />
            {checked.size > 0 && (
              <>
                <span className="text-xs text-text-secondary">{checked.size} selected</span>
                {(["off", "info", "warning", "error"] as Severity[]).map((sv) => (
                  <Button key={sv} size="sm" variant="ghost" onClick={() => {
                    for (const id of checked) {
                      const e = allRules.find((x) => x.rule.id === id);
                      if (!e || e.src === "mfg") continue;
                      if (e.src === "ruleset" && e.rs?.enforced) continue;
                      if (e.src === "ruleset") dispatch({ type: "setRuleOverride", payload: { override: { ruleId: id, severity: sv, enabled: sv !== "off", note: "Bulk change" } } });
                      else saveRule(e, { ...e.rule, severity: sv === "off" ? e.rule.severity : sv, enabled: sv !== "off" });
                    }
                  }}>
                    {sv}
                  </Button>
                ))}
                {project.rulesets.filter((r) => !r.enforced).length > 0 && (
                  <select className={cx(inputCls, "h-7 text-xs")} value="" onChange={(e) => {
                    const target = project.rulesets.find((r) => r.id === e.target.value);
                    if (!target) return;
                    const moving = project.projectRules.filter((r) => checked.has(r.id));
                    const renamed = moving.map((r, i) => ({ ...r, id: nextId(target.prefix, [...target.rules, ...moving.slice(0, i).map((m) => ({ ...m, id: `${target.prefix}-${i}` }))]) }));
                    dispatch([{ type: "upsertRuleset", payload: { ruleset: { ...target, rules: [...target.rules, ...renamed] } } }, { type: "deleteProjectRules", payload: { ids: moving.map((r) => r.id) } }], "Promote rules to ruleset");
                    setChecked(new Set());
                  }}>
                    <option value="">Promote to ruleset…</option>
                    {project.rulesets.filter((r) => !r.enforced).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                )}
              </>
            )}
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add rule
            </Button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto rounded-card border border-border-subtle">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-bg-surface-2 text-left text-2xs uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="w-6 p-1" />
                  <th className="p-1">ID</th>
                  <th className="p-1">Rule</th>
                  {!matrix && <th className="p-1">Type</th>}
                  {!matrix && <th className="p-1">Severity</th>}
                  {matrix && [...project.pedigreeScheme.pedigrees].sort((x, y) => x.rank - y.rank).map((p) => <th key={p.id} className="mono p-1 text-center">{p.code}</th>)}
                  <th className="p-1">On</th>
                  <th className="p-1 text-right">Result</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => {
                  const r = res(e.rule.id);
                  const ro = e.src === "mfg" || (e.src === "ruleset" && e.rs?.enforced);
                  const ov = project.overrides.find((o) => o.ruleId === e.rule.id);
                  const enabled = e.rule.enabled !== false && ov?.enabled !== false;
                  return (
                    <tr key={e.rule.id} className={cx("cursor-pointer border-b border-border-subtle hover:bg-bg-hover", selected === e.rule.id && "bg-bg-hover")} onClick={() => setSelected(e.rule.id)}>
                      <td className="p-1" onClick={(ev) => ev.stopPropagation()}>
                        <input type="checkbox" checked={checked.has(e.rule.id)} onChange={(ev) => {
                          const n = new Set(checked);
                          ev.target.checked ? n.add(e.rule.id) : n.delete(e.rule.id);
                          setChecked(n);
                        }} aria-label={`Select ${e.rule.id}`} />
                      </td>
                      <td className="mono p-1 text-text-secondary">
                        {ro && <Lock size={9} className="mr-1 inline" />}
                        {e.rule.id}
                      </td>
                      <td className="p-1">{e.rule.title}</td>
                      {!matrix && <td className="mono p-1 text-2xs text-text-tertiary">{e.rule.type}</td>}
                      {!matrix && <td className="p-1 capitalize">{ov?.severity ?? e.rule.severity}{ov ? " *" : ""}</td>}
                      {matrix &&
                        [...project.pedigreeScheme.pedigrees].sort((x, y) => x.rank - y.rank).map((p) => {
                          const sv = r?.eff.severityByPedigree[p.id] ?? e.rule.severityByPedigree?.[p.id] ?? e.rule.severity;
                          const hasParam = !!e.rule.paramsByPedigree?.[p.id];
                          return (
                            <td key={p.id} className="p-1 text-center" onClick={(ev) => ev.stopPropagation()}>
                              <button
                                disabled={!!ro}
                                title={ro ? "Manufacturer / enforced rules can't be edited here" : "Click to cycle off → info → warning → error"}
                                className={cx("relative rounded-chip border px-1.5 py-0.5 text-2xs capitalize", sv === "error" ? "border-status-error text-status-error" : sv === "warning" ? "border-status-warning text-status-warning" : sv === "info" ? "border-border-control text-text-secondary" : "border-border-subtle text-text-tertiary")}
                                onClick={() => {
                                  const nextSev = SEVS[(SEVS.indexOf(sv) + 1) % SEVS.length]!;
                                  saveRule(e, { ...e.rule, severityByPedigree: { ...(e.rule.severityByPedigree ?? {}), [p.id]: nextSev } });
                                }}
                              >
                                {sv}
                                {hasParam && <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent" title="Parameter override at this pedigree" />}
                              </button>
                            </td>
                          );
                        })}
                      <td className="p-1" onClick={(ev) => ev.stopPropagation()}>
                        <input type="checkbox" disabled={!!ro && e.src === "mfg"} checked={enabled} aria-label="Enabled" onChange={(ev) => {
                          if (e.src === "project") saveRule(e, { ...e.rule, enabled: ev.target.checked });
                          else if (e.src === "ruleset" && !e.rs?.enforced) dispatch({ type: "setRuleOverride", payload: { override: ev.target.checked ? { ruleId: e.rule.id, remove: true } : { ruleId: e.rule.id, enabled: false, note: "Disabled for this project" } } });
                        }} />
                      </td>
                      <td className="p-1 text-right">
                        {!r || r.status === "off" ? <span className="text-text-tertiary">—</span> : r.status === "pass" ? <SeverityIcon severity="pass" size={12} /> : r.status === "fail" ? <span className="tnum">{r.violations.length}</span> : <span className="text-text-tertiary">{r.status}</span>}
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-text-tertiary">
                      No rules in this layer yet. Use “Add rule”.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail */}
        <div className="scroll-thin min-h-0 overflow-auto rounded-card border border-border-subtle p-3">
          {importState ? (
            <ImportPreview state={importState} onDone={() => setImportState(null)} />
          ) : adding ? (
            <AddRulePicker
              onPick={(typeId) => {
                const target = layer.kind === "ruleset" ? project.rulesets.find((r) => r.id === layer.id) : undefined;
                const t = RULE_TYPE_BY_ID.get(typeId);
                const prefix = target?.prefix ?? "PRJ";
                const rules = target?.rules ?? project.projectRules;
                const rule: RuleInstance = {
                  id: nextId(prefix, rules),
                  type: typeId,
                  category: t?.category ?? "Custom",
                  severity: "warning",
                  title: t?.name ?? "Custom rule",
                  description: t?.description ?? "",
                  rationale: "",
                  params: Object.fromEntries((t?.params ?? []).filter((p) => p.default !== undefined).map((p) => [p.key, p.default])),
                  enabled: true,
                  custom: typeId === "custom" ? { forEach: "wire", where: [], require: [{ field: "gauge", op: "lte", value: 22 }] } : undefined,
                };
                if (target && !target.enforced) dispatch({ type: "upsertRuleset", payload: { ruleset: { ...target, rules: [...target.rules, rule] } } });
                else dispatch({ type: "upsertProjectRule", payload: { rule } });
                setSelected(rule.id);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : sel ? (
            <RuleEditor key={sel.rule.id} entry={sel} onSave={(r) => saveRule(sel, r)} />
          ) : (
            <div className="text-sm text-text-tertiary">Select a rule to see and edit its parameters, message and rationale, with a live preview of what it flags on this design.</div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function LayerBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx("flex min-w-0 flex-1 items-center gap-1 rounded-control px-2 py-1 text-left", on ? "bg-bg-hover text-text-primary" : "text-text-secondary hover:bg-bg-hover")}>
      {children}
    </button>
  );
}

function AddRulePicker({ onPick, onCancel }: { onPick: (t: string) => void; onCancel: () => void }) {
  const [q, setQ] = useState("");
  const types = [...RULE_TYPES.filter((t) => !["sealed_cavities", "duplicate_pin"].includes(t.id)), { id: "custom", name: "Custom rule (visual builder)", description: "For each wire/net/connector/pin/segment/shield where … require …", example: "Every power wire ≤ 20 AWG", category: "Custom" }];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Add rule</div>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <input autoFocus className={inputCls} placeholder="Search rule types" value={q} onChange={(e) => setQ(e.target.value)} />
      {types
        .filter((t) => !q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q.toLowerCase()))
        .map((t) => (
          <button key={t.id} className="rounded-control border border-border-subtle p-2 text-left hover:border-border-control" onClick={() => onPick(t.id)}>
            <div className="text-sm">{t.name}</div>
            <div className="text-2xs text-text-secondary">{t.description}</div>
            <div className="text-2xs text-text-tertiary">e.g. {t.example}</div>
          </button>
        ))}
    </div>
  );
}

function RuleEditor({ entry, onSave }: { entry: { rule: RuleInstance; src: "mfg" | "ruleset" | "project"; rs?: Ruleset }; onSave: (r: RuleInstance) => void }) {
  const project = useProject((s) => s.project)!;
  const ro = entry.src === "mfg" || (entry.src === "ruleset" && !!entry.rs?.enforced);
  const [draft, setDraft] = useState<RuleInstance>(entry.rule);
  const t = RULE_TYPE_BY_ID.get(draft.type);
  const s = svc();
  const mfgMatch = s.profile.rules.find((r) => r.type === draft.type);
  // Live preview: evaluate the draft on the current design (per pedigree)
  const preview = useMemo(() => {
    const err = validateRule(draft);
    if (err) return { error: err };
    const p = { ...project, projectRules: [{ ...draft, id: "__preview__", enabled: true }], rulesets: [], overrides: [] };
    const per: Record<string, number> = {};
    for (const ped of project.pedigreeScheme.pedigrees) {
      const d = runDfm({ project: p, cat: s.cat, profile: { ...s.profile, rules: [] }, pedigreeId: ped.id });
      per[ped.code] = d.results.find((r) => r.eff.rule.id === "__preview__")?.violations.length ?? 0;
    }
    const d0 = runDfm({ project: p, cat: s.cat, profile: { ...s.profile, rules: [] } });
    return { count: d0.results.find((r) => r.eff.rule.id === "__preview__")?.violations ?? [], per };
  }, [draft, project, s]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(entry.rule);
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="mono text-xs text-text-secondary">{draft.id}</div>
          <input disabled={ro} className="w-full bg-transparent text-md font-semibold outline-none" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </div>
        {ro && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const rules = getProject().projectRules;
              let i = 1;
              while (rules.some((r) => r.id === `PRJ-${String(i).padStart(3, "0")}`)) i++;
              dispatch({ type: "upsertProjectRule", payload: { rule: { ...entry.rule, id: `PRJ-${String(i).padStart(3, "0")}`, title: `${entry.rule.title} (stricter)`, paramSource: undefined } } });
            }}
          >
            <Copy size={12} /> Duplicate as project rule
          </Button>
        )}
      </div>
      {ro && <div className="rounded-control border border-border-subtle p-2 text-2xs text-text-secondary">{entry.src === "mfg" ? "Manufacturer rule: shown read-only so every limit is transparent. Duplicate it as a project rule to make it stricter." : "Enforced ruleset: can't be disabled or downgraded in the project."}</div>}
      <p className="text-xs text-text-secondary">{t?.description ?? "Custom rule"}</p>
      <Field label="Severity">
        <Select disabled={ro} value={draft.severity} onChange={(v) => setDraft({ ...draft, severity: v as Severity })} options={SEVS.filter((x) => x !== "off").map((x) => ({ value: x, label: x }))} />
      </Field>
      {t?.params.map((p) => <ParamInput key={p.key} p={p} value={draft.params[p.key]} disabled={ro} onChange={(v) => setDraft({ ...draft, params: { ...draft.params, [p.key]: v } })} />)}
      {mfgMatch && entry.src !== "mfg" && t?.params.some((p) => p.stricter) && (
        <div className="text-2xs text-text-tertiary">
          Manufacturer limit: {t.params.filter((p) => p.stricter).map((p) => `${p.label} ${JSON.stringify(mfgMatch.params[p.key])}${p.unit ? ` ${p.unit}` : ""}`).join(", ")}. User rules can add or tighten, never loosen.
        </div>
      )}
      {(draft.type === "custom" || draft.custom) && <RuleBuilder value={draft.custom!} disabled={ro} onChange={(c) => setDraft({ ...draft, custom: c })} />}
      {t?.scoped && (
        <Field label="Scope: net name pattern (regex, optional)">
          <input disabled={ro} className={cx(inputCls, "mono")} value={draft.scope?.namePattern ?? ""} onChange={(e) => setDraft({ ...draft, scope: { ...draft.scope, namePattern: e.target.value || undefined } })} />
        </Field>
      )}
      <Field label="Message / description">
        <textarea disabled={ro} className={cx(inputCls, "h-14 py-1")} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
      </Field>
      <Field label="Rationale (why it matters)">
        <textarea disabled={ro} className={cx(inputCls, "h-14 py-1")} value={draft.rationale} onChange={(e) => setDraft({ ...draft, rationale: e.target.value })} />
      </Field>
      <Section title="Per pedigree">
        <div className="grid grid-cols-2 gap-1">
          {[...project.pedigreeScheme.pedigrees].sort((a, b) => a.rank - b.rank).map((p) => (
            <label key={p.id} className="flex items-center gap-1 text-xs">
              <span className="mono w-10">{p.code}</span>
              <select disabled={ro} className={cx(inputCls, "h-6 flex-1 text-xs")} value={draft.severityByPedigree?.[p.id] ?? ""} onChange={(e) => {
                const m = { ...(draft.severityByPedigree ?? {}) };
                if (e.target.value) m[p.id] = e.target.value as Severity;
                else delete m[p.id];
                setDraft({ ...draft, severityByPedigree: m });
              }}>
                <option value="">(base: {draft.severity})</option>
                {SEVS.map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
          ))}
        </div>
      </Section>
      <Section title="Live preview on this design">
        {"error" in preview ? (
          <div className="text-xs text-status-error">{preview.error}</div>
        ) : (
          <>
            <div className="text-xs">
              This rule currently flags <strong>{preview.count.length}</strong> object{preview.count.length === 1 ? "" : "s"} · {Object.entries(preview.per).map(([k, v]) => `${v} at ${k}`).join(", ")}
            </div>
            <ul className="text-2xs text-text-secondary">
              {preview.count.slice(0, 5).map((v, i) => <li key={i}>· {v.message}</li>)}
            </ul>
          </>
        )}
      </Section>
      {!ro && (
        <div className="flex justify-between">
          {entry.src === "project" && (
            <Button size="sm" variant="danger" onClick={() => dispatch({ type: "deleteProjectRules", payload: { ids: [draft.id] } })}>
              Delete
            </Button>
          )}
          <Button size="sm" variant="primary" disabled={!dirty || "error" in preview} onClick={() => onSave(draft)}>
            Save rule
          </Button>
        </div>
      )}
    </div>
  );
}

function ParamInput({ p, value, onChange, disabled }: { p: ParamDef; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const label = `${p.label}${p.unit ? ` (${p.unit})` : ""}`;
  if (p.type === "number") return <Field label={label} hint={p.help}><input disabled={disabled} type="number" className={cx(inputCls, "mono")} value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} /></Field>;
  if (p.type === "netClass") return <Field label={label}><Select<string> value={(value as string) ?? ""} onChange={(v) => onChange(v || undefined)} options={[{ value: "", label: "(any)" }, ...["power", "signal", "ground", "rf", "spare"].map((c) => ({ value: c, label: c }))]} /></Field>;
  if (p.type === "enum") return <Field label={label}><Select<string> value={(value as string) ?? p.options?.[0] ?? ""} onChange={onChange} options={(p.options ?? []).map((o) => ({ value: o, label: o }))} /></Field>;
  if (p.type === "stringList") return <Field label={`${label} (comma separated)`}><input disabled={disabled} className={cx(inputCls, "mono")} value={Array.isArray(value) ? value.join(", ") : ""} onChange={(e) => onChange(e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></Field>;
  if (p.type === "table") return <Field label={`${label} (JSON)`}><textarea disabled={disabled} className={cx(inputCls, "mono h-16 py-1 text-2xs")} defaultValue={JSON.stringify(value ?? p.default ?? {})} onBlur={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* keep */ } }} /></Field>;
  return <Field label={label} hint={p.help}><input disabled={disabled} className={cx(inputCls, "mono")} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} /></Field>;
}

const OPS: { v: CustomCond["op"]; l: string }[] = [
  { v: "eq", l: "=" },
  { v: "neq", l: "≠" },
  { v: "gt", l: ">" },
  { v: "gte", l: "≥" },
  { v: "lt", l: "<" },
  { v: "lte", l: "≤" },
  { v: "matches", l: "matches" },
  { v: "notMatches", l: "doesn't match" },
  { v: "in", l: "in list" },
  { v: "exists", l: "is set" },
  { v: "notExists", l: "is not set" },
];

/** Visual rule builder: For each … where … require … (§9.5.3). Produces declarative JSON; no code. */
function RuleBuilder({ value, onChange, disabled }: { value: CustomRule; onChange: (v: CustomRule) => void; disabled: boolean }) {
  const fields = CUSTOM_FIELDS[value.forEach];
  const errs = validateCustom(value);
  const row = (c: CustomCond, i: number, list: "where" | "require") => (
    <div key={i} className="flex items-center gap-1">
      <select disabled={disabled} className={cx(inputCls, "h-7 flex-1 text-xs")} value={c.field} onChange={(e) => onChange({ ...value, [list]: value[list].map((x, j) => (j === i ? { ...x, field: e.target.value } : x)) })}>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
      </select>
      <select disabled={disabled} className={cx(inputCls, "h-7 w-24 text-xs")} value={c.op} onChange={(e) => onChange({ ...value, [list]: value[list].map((x, j) => (j === i ? { ...x, op: e.target.value as CustomCond["op"] } : x)) })}>
        {OPS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
      {!["exists", "notExists"].includes(c.op) && <input disabled={disabled} className={cx(inputCls, "mono h-7 w-24 text-xs")} value={String(c.value ?? "")} onChange={(e) => onChange({ ...value, [list]: value[list].map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />}
      <IconButton label="Remove" className="h-7 w-7" disabled={disabled} onClick={() => onChange({ ...value, [list]: value[list].filter((_, j) => j !== i) })}>
        <Trash2 size={12} />
      </IconButton>
    </div>
  );
  return (
    <Section title="Rule builder">
      <div className="flex items-center gap-2 text-xs">
        For each
        <select disabled={disabled} className={cx(inputCls, "h-7 text-xs")} value={value.forEach} onChange={(e) => onChange({ forEach: e.target.value as CustomRule["forEach"], where: [], require: [{ field: CUSTOM_FIELDS[e.target.value as CustomRule["forEach"]][0]!.key, op: "exists" }] })}>
          {Object.keys(CUSTOM_FIELDS).map((k) => <option key={k}>{k}</option>)}
        </select>
      </div>
      <div className="text-2xs text-text-tertiary">where</div>
      {value.where.map((c, i) => row(c, i, "where"))}
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...value, where: [...value.where, { field: fields[0]!.key, op: "eq", value: "" }] })}>+ filter</Button>
      <div className="text-2xs text-text-tertiary">require</div>
      {value.require.map((c, i) => row(c, i, "require"))}
      <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange({ ...value, require: [...value.require, { field: fields[0]!.key, op: "exists" }] })}>+ condition</Button>
      <div className="rounded-control bg-bg-app p-2 text-2xs text-text-secondary">{describeCustom(value)}</div>
      {errs.map((e) => <div key={e} className="text-2xs text-status-error">{e}</div>)}
    </Section>
  );
}

function ImportPreview({ state, onDone }: { state: { ruleset: Ruleset; diff: RulesetDiff } | { errors: string[] }; onDone: () => void }) {
  const project = useProject((s) => s.project)!;
  if ("errors" in state)
    return (
      <div className="flex flex-col gap-2">
        <div className="text-sm font-semibold text-status-error">Import failed validation</div>
        {state.errors.map((e) => <div key={e} className="mono text-2xs">{e}</div>)}
        <Button size="sm" onClick={onDone}>Close</Button>
      </div>
    );
  const { ruleset: rs, diff } = state;
  const hasScheme = !!rs.pedigreeScheme;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="font-semibold">Import “{rs.name}” v{rs.version}</div>
      <div className="text-xs text-text-secondary">{rs.description}</div>
      {diff.versionFrom && <Chip>Update v{diff.versionFrom} → v{diff.versionTo}</Chip>}
      <Section title={`New rules (${diff.added.length})`}>{diff.added.map((r) => <div key={r.id} className="text-xs"><span className="mono">{r.id}</span> {r.title}</div>)}</Section>
      {diff.changed.length > 0 && <Section title={`Changed (${diff.changed.length})`}>{diff.changed.map((c) => <div key={c.id} className="text-xs"><span className="mono">{c.id}</span>: {c.changes.join("; ")}</div>)}</Section>}
      {diff.removed.length > 0 && <Section title={`Removed (${diff.removed.length})`}>{diff.removed.map((r) => <div key={r.id} className="mono text-xs">{r.id}</div>)}</Section>}
      {diff.invalid.length > 0 && <Section title="Fail validation (skipped)">{diff.invalid.map((c) => <div key={c.id + c.reason} className="text-xs text-status-error"><span className="mono">{c.id}</span>: {c.reason}</div>)}</Section>}
      {hasScheme && <Section title="Pedigree scheme">{diff.pedigrees.length ? diff.pedigrees.map((p) => <div key={p} className="text-xs">{p}</div>) : <div className="text-xs text-text-tertiary">{rs.pedigreeScheme!.name}</div>}</Section>}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => {
          const bad = new Set(diff.invalid.map((x) => x.id));
          const clean = { ...rs, rules: rs.rules.filter((r) => !bad.has(r.id)) };
          const cmds = [{ type: "upsertRuleset", payload: { ruleset: clean } }];
          if (hasScheme && confirm(`Also use its pedigree scheme “${rs.pedigreeScheme!.name}” for this project?`)) cmds.push({ type: "setPedigreeScheme", payload: { scheme: rs.pedigreeScheme } } as never);
          dispatch(cmds, `Import ruleset ${rs.name}`);
          onDone();
        }}>Apply</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      <div className="text-2xs text-text-tertiary">Rulesets contain data and declarative rules only; they can never run code. Current project: {project.name}.</div>
    </div>
  );
}
