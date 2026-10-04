import { useState } from "react";
import { currentRevision, defaultPedigreeOf, stableStringify, DEFAULT_REVISION_SCHEME, firstRevision, nextRevision, revisionPreview, formatMoney, monotonicityWarnings, resolvePedigree, type InspectionReq, type Pedigree, type PedigreeScheme } from "@hs/model";
import { tokens } from "@hs/ui-tokens";
import { Copy, Plus, Trash2 } from "lucide-react";
import { dispatch, getProject, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { useAnalysis } from "../store/analysis";
import { svc } from "../lib/services";
import { Button, cx, DemoTag, Dialog, Field, IconButton, inputCls, Select, SeverityIcon, Toggle } from "../ui/primitives";
import { PedigreePill } from "../chrome/TopBar";
import { getOrgScheme, setOrgScheme } from "../lib/orgScheme";

const TABS = ["General", "Inspections", "Parts policy", "Process", "Documentation", "Marking"] as const;
const DOCS = ["Certificate of Conformance (CoC)", "AS9102 First Article Inspection", "Material certifications", "Lot traceability", "Serial traceability", "Test data package", "Customer source-inspection hold point"];

export function PedigreeEditor() {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const [scheme, setScheme] = useState<PedigreeScheme>(structuredClone(project.pedigreeScheme));
  const [selId, setSelId] = useState(scheme.pedigrees[0]!.id);
  const [tab, setTab] = useState<(typeof TABS)[number]>("General");
  const p = scheme.pedigrees.find((x) => x.id === selId) ?? scheme.pedigrees[0]!;
  const resolved = resolvePedigree(scheme, p.id);
  const warnings = monotonicityWarnings(scheme);
  const close = () => ui.closeDialog("pedigreeEditor");
  const upd = (patch: Partial<Pedigree>) => setScheme({ ...scheme, pedigrees: scheme.pedigrees.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) });
  const inspections = svc().inspections;
  const own = (k: keyof Pedigree) => p[k] !== undefined;
  const bump = (v: string) => v.replace(/(\d+)$/, (m) => String(Number(m) + 1));
  const [org, setOrg] = useState(() => getOrgScheme());
  const defaultId = defaultPedigreeOf(scheme);
  // Unsaved edits: each pedigree against the scheme saved in the design (version bumps don't count).
  const saved = project.pedigreeScheme;
  const savedById = new Map(saved.pedigrees.map((x) => [x.id, x]));
  const editState = (x: Pedigree): "new" | "edited" | null => (!savedById.has(x.id) ? "new" : stableStringify(x) === stableStringify(savedById.get(x.id)) ? null : "edited");
  const removed = saved.pedigrees.filter((x) => !scheme.pedigrees.some((y) => y.id === x.id));
  const schemeEdited = scheme.name !== saved.name || (scheme.defaultPedigreeId ?? "") !== (saved.defaultPedigreeId ?? "");
  const edits = scheme.pedigrees.filter((x) => editState(x)).length + removed.length + (schemeEdited ? 1 : 0);
  const saveToDesign = () => {
    dispatch({ type: "setPedigreeScheme", payload: { scheme: { ...scheme, version: bump(scheme.version) } } }, "Edit pedigrees");
    // Keep editing on what was just saved, so the edited markers clear.
    setScheme(structuredClone(getProject().pedigreeScheme));
  };
  const closeAsk = () => {
    if (edits && !confirm(`Discard ${edits} unsaved pedigree change${edits === 1 ? "" : "s"}?`)) return;
    close();
  };
  return (
    <Dialog
      open
      onClose={closeAsk}
      title="Pedigrees"
      width={1080}
      description="A pedigree captures everything that changes between build classes: rule severities, inspections, workmanship, parts policy, process limits, documentation and markings."
      footer={
        <>
          <select className={cx(inputCls, "mr-auto")} value="" onChange={(e) => {
            if (e.target.value === "__org") {
              if (org && confirm(`Replace the pedigree scheme with the organization scheme “${org.name}”?`)) (setScheme(structuredClone(org)), setSelId(defaultPedigreeOf(org)));
              return;
            }
            const rs = svc().library.rulesets.find((r) => r.id === e.target.value);
            if (!rs?.pedigreeScheme) return;
            if (!confirm(`Replace the pedigree scheme with the “${rs.pedigreeScheme.name}” template?`)) return;
            setScheme(structuredClone(rs.pedigreeScheme));
            setSelId(defaultPedigreeOf(rs.pedigreeScheme));
            if (rs.rules.length && !project.rulesets.some((x) => x.id === rs.id)) dispatch({ type: "upsertRuleset", payload: { ruleset: rs } });
          }}>
            <option value="">Load template…</option>
            {org && <option value="__org">Organization scheme: {org.name}</option>}
            {svc().library.rulesets.filter((r) => r.pedigreeScheme).map((r) => <option key={r.id} value={r.id}>{r.pedigreeScheme!.name}</option>)}
          </select>
          {edits > 0 && <span className="text-xs text-status-warning">{edits} unsaved change{edits === 1 ? "" : "s"}</span>}
          <Button variant="ghost" onClick={closeAsk}>Close</Button>
          <Button variant="secondary" title="Save to this design and make it the scheme (and default pedigree) new designs start with, in this browser" onClick={() => {
            setOrgScheme(scheme);
            setOrg(scheme);
            saveToDesign();
            ui.toast({ kind: "success", text: `New designs will use “${scheme.name}” starting on ${scheme.pedigrees.find((x) => x.id === defaultId)?.code}` });
          }}>Save as organization scheme</Button>
          {edits > 0 && (
            <Button variant="primary" onClick={() => (saveToDesign(), ui.toast({ kind: "success", text: "Pedigrees saved to this design" }))}>
              Save changes
            </Button>
          )}
        </>
      }
    >
      <div className="grid h-[62vh] grid-cols-[240px_1fr] gap-4">
        <div className="flex flex-col gap-1">
          <Field label="Scheme name">
            <input className={inputCls} value={scheme.name} onChange={(e) => setScheme({ ...scheme, name: e.target.value })} />
          </Field>
          <div className="label-caps mt-2">Pedigrees (least → most stringent)</div>
          {[...scheme.pedigrees].sort((a, b) => a.rank - b.rank).map((x) => (
            <button key={x.id} onClick={() => setSelId(x.id)} className={cx("flex items-center gap-2 rounded-control px-2 py-1.5 text-left", x.id === p.id ? "bg-bg-hover" : "hover:bg-bg-hover")}>
              <span className="h-2.5 w-2.5 rotate-45" style={{ background: `var(--pedigree-${x.color})` }} />
              <span className="mono text-xs font-semibold">{x.code}</span>
              <span className="truncate text-sm">{x.name}</span>
              {x.id === defaultId && <span className="rounded-chip border border-accent px-1 text-2xs text-accent" title="New designs start on this pedigree">default</span>}
              {editState(x) && <span className="rounded-chip border border-status-warning px-1 text-2xs text-status-warning" title="Unsaved changes">{editState(x)}</span>}
              {x.extends && <span className="ml-auto text-2xs text-text-tertiary">extends {scheme.pedigrees.find((y) => y.id === x.extends)?.code}</span>}
            </button>
          ))}
          {removed.length > 0 && <div className="px-2 text-2xs text-status-warning">Removed (unsaved): {removed.map((x) => x.code).join(", ")}</div>}
          {schemeEdited && <div className="px-2 text-2xs text-status-warning">Scheme name or default changed (unsaved)</div>}
          <div className="mt-1 flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => {
              const id = `p${Date.now().toString(36)}`;
              const rank = Math.max(...scheme.pedigrees.map((x) => x.rank)) + 1;
              setScheme({ ...scheme, pedigrees: [...scheme.pedigrees, { id, name: "New pedigree", code: `P${rank}`, rank, color: rank % 8, extends: p.id, description: "" }] });
              setSelId(id);
            }}>
              <Plus size={12} /> Add
            </Button>
            <IconButton label="Duplicate" onClick={() => {
              const id = `p${Date.now().toString(36)}`;
              setScheme({ ...scheme, pedigrees: [...scheme.pedigrees, { ...structuredClone(p), id, name: `${p.name} copy`, code: `${p.code}2`, rank: p.rank + 0.5 }] });
              setSelId(id);
            }}><Copy size={14} /></IconButton>
            <IconButton label="Delete" disabled={scheme.pedigrees.length < 2} onClick={() => {
              const rest = scheme.pedigrees.filter((x) => x.id !== p.id).map((x) => (x.extends === p.id ? { ...x, extends: p.extends } : x));
              setScheme({ ...scheme, pedigrees: rest });
              setSelId(rest[0]!.id);
            }}><Trash2 size={14} /></IconButton>
          </div>
          <div className="mt-2 rounded-control border border-border-subtle p-2 text-2xs text-text-secondary">
            {org ? <>Organization scheme (this browser): <span className="text-text-primary">{org.name}</span>, new designs start on <span className="mono text-text-primary">{org.pedigrees.find((x) => x.id === defaultPedigreeOf(org))?.code}</span>.</> : <>No organization scheme yet: new designs use the built-in Standard scheme. Use “Save as organization scheme” to set one.</>}
            {org && (
              <button className="ml-1 text-accent hover:underline" onClick={() => (setOrgScheme(null), setOrg(null))}>
                clear
              </button>
            )}
          </div>
          {warnings.length > 0 && (
            <div className="mt-2 flex flex-col gap-1 rounded-control border border-status-warning p-2">
              {warnings.map((w) => <div key={w} className="flex gap-1 text-2xs text-status-warning"><SeverityIcon severity="warning" size={11} /> {w}</div>)}
            </div>
          )}
        </div>
        <div className="flex min-h-0 flex-col">
          <div className="mb-3 flex gap-1 border-b border-border-subtle">
            {TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={cx("-mb-px border-b-2 px-3 py-1.5 text-sm", tab === t ? "border-accent text-text-primary" : "border-transparent text-text-secondary hover:text-text-primary")}>
                {t}
              </button>
            ))}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => (close(), ui.openDialog("rules"))}>Rules matrix…</Button>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto pr-1">
            {tab === "General" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Toggle checked={p.id === defaultId} onChange={(v) => setScheme({ ...scheme, defaultPedigreeId: v ? p.id : undefined })} label="Default pedigree for new designs (and the pedigree a design starts on when it takes this scheme)" />
                </div>
                <Field label="Name"><input className={inputCls} value={p.name} onChange={(e) => upd({ name: e.target.value })} /></Field>
                <Field label="Code (shown with the color everywhere)"><input className={cx(inputCls, "mono")} value={p.code} onChange={(e) => upd({ code: e.target.value.toUpperCase().slice(0, 6) })} /></Field>
                <Field label="Rank (higher = more stringent)"><input type="number" className={cx(inputCls, "mono")} value={p.rank} onChange={(e) => upd({ rank: Number(e.target.value) })} /></Field>
                <Field label="Extends (inherit and list only differences)">
                  <Select value={p.extends ?? ""} onChange={(v) => upd({ extends: v || undefined })} options={[{ value: "", label: "(none)" }, ...scheme.pedigrees.filter((x) => x.id !== p.id).map((x) => ({ value: x.id, label: `${x.code} ${x.name}` }))]} />
                </Field>
                <Field label="Color (CVD-checked palette)">
                  <div className="flex gap-1">
                    {tokens.pedigree.dark.map((_, i) => (
                      <button key={i} aria-label={`Color ${i}`} onClick={() => upd({ color: i })} className={cx("h-6 w-6 rotate-45 rounded-sm border-2", p.color === i ? "border-text-primary" : "border-transparent")} style={{ background: `var(--pedigree-${i})` }} />
                    ))}
                  </div>
                </Field>
                <Field label="Workmanship standard">
                  <input className={inputCls} placeholder={`inherited: ${resolved.workmanship}`} value={p.workmanship ?? ""} onChange={(e) => upd({ workmanship: e.target.value || undefined })} />
                </Field>
                <div className="col-span-2"><Field label="Description"><textarea className={cx(inputCls, "h-16 py-1")} value={p.description} onChange={(e) => upd({ description: e.target.value })} /></Field></div>
                <RevisionSchemeFields p={p} resolved={resolved.revisionScheme} parentCode={p.extends ? scheme.pedigrees.find((x) => x.id === p.extends)?.code : undefined} onChange={(revisionScheme) => upd({ revisionScheme })} />
              </div>
            )}
            {tab === "Inspections" && (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-text-secondary">Resolved (with inheritance). Checked items are defined on this pedigree; inherited ones show their source. Inspections become operations and are priced in the quote.</div>
                {inspections.map((t) => {
                  const mine = p.inspections?.find((i) => i.typeId === t.id);
                  const eff = resolved.inspections.find((i) => i.typeId === t.id);
                  const setIns = (next: InspectionReq | null) => {
                    const list = (p.inspections ?? []).filter((i) => i.typeId !== t.id);
                    if (next) list.push(next);
                    upd({ inspections: list });
                  };
                  return (
                    <div key={t.id} className="flex items-center gap-2 rounded-control border border-border-subtle px-2 py-1.5">
                      <input type="checkbox" checked={!!eff} disabled={t.id === "continuity"} onChange={(e) => setIns(e.target.checked ? { typeId: t.id, sampling: t.samplingOptions[0]!, params: Object.fromEntries(t.params.map((x) => [x.key, x.default])) } : p.extends && resolvePedigree(scheme, p.extends).inspections.some((i) => i.typeId === t.id) ? { typeId: t.id, sampling: "none", params: {} } : null)} aria-label={t.name} />
                      <div className="flex-1">
                        <div className="text-sm">{t.name} {!t.inHouse && <span className="text-2xs text-status-warning">(outsourced, +{t.leadDays} d)</span>}</div>
                        <div className="text-2xs text-text-tertiary">{t.description}{eff && !mine ? " · inherited" : ""}</div>
                      </div>
                      {eff && (
                        <select className={cx(inputCls, "h-7 text-xs")} value={eff.sampling} onChange={(e) => setIns({ ...(mine ?? eff), sampling: e.target.value })}>
                          {t.samplingOptions.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      )}
                      {eff && t.params.filter((x) => x.type === "number").map((x) => (
                        <label key={x.key} className="flex items-center gap-1 text-2xs text-text-secondary">
                          {x.label}
                          <input className={cx(inputCls, "mono h-7 w-16 text-xs")} value={String(eff.params[x.key] ?? x.default ?? "")} onChange={(e) => setIns({ ...(mine ?? eff), params: { ...eff.params, [x.key]: Number(e.target.value) } })} />
                          {x.unit}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
            {tab === "Parts policy" && (
              <div className="flex flex-col gap-2">
                <Toggle checked={!!resolved.partsPolicy.qplOnly} onChange={(v) => upd({ partsPolicy: { ...p.partsPolicy, qplOnly: v } })} label="QPL / approved parts only" />
                <Toggle checked={!!resolved.partsPolicy.noAlternates} onChange={(v) => upd({ partsPolicy: { ...p.partsPolicy, noAlternates: v } })} label="No alternates without approval" />
                <Toggle checked={!!resolved.partsPolicy.authorizedDistributionOnly} onChange={(v) => upd({ partsPolicy: { ...p.partsPolicy, authorizedDistributionOnly: v } })} label="Authorized distribution only (counterfeit avoidance)" />
                <Field label="Banned shell classes (comma separated, e.g. W, J)"><input className={cx(inputCls, "mono")} value={(resolved.partsPolicy.bannedFinishes ?? []).join(", ")} onChange={(e) => upd({ partsPolicy: { ...p.partsPolicy, bannedFinishes: e.target.value.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) } })} /></Field>
                <Field label="Date-code age limit (years)"><input className={cx(inputCls, "mono w-24")} value={resolved.partsPolicy.dateCodeMaxYears ?? ""} onChange={(e) => upd({ partsPolicy: { ...p.partsPolicy, dateCodeMaxYears: e.target.value ? Number(e.target.value) : undefined } })} /></Field>
              </div>
            )}
            {tab === "Process" && (
              <div className="grid grid-cols-2 gap-3">
                <Toggle checked={!!resolved.process.noSplices} onChange={(v) => upd({ process: { ...p.process, noSplices: v } })} label="Splices / daisy chains not allowed" />
                <Toggle checked={!!resolved.process.noPotting} onChange={(v) => upd({ process: { ...p.process, noPotting: v } })} label="Potting not allowed" />
                <Toggle checked={!!resolved.process.noManualRework} onChange={(v) => upd({ process: { ...p.process, noManualRework: v } })} label="No manual rework" />
                <Toggle checked={!!resolved.process.serializedLabels} onChange={(v) => upd({ process: { ...p.process, serializedLabels: v } })} label="Serialized identification label required" />
                <Toggle checked={!!resolved.process.doubleBandClamps} onChange={(v) => upd({ process: { ...p.process, doubleBandClamps: v } })} label="Double band clamps on 360° terminations" />
                <Toggle checked={!!resolved.process.requireBoots} onChange={(v) => upd({ process: { ...p.process, requireBoots: v } })} label="Boots required at every backshell" />
                <Field label="Min bend radius (× OD)"><input className={cx(inputCls, "mono w-24")} value={resolved.process.bendRadiusMultiple ?? ""} onChange={(e) => upd({ process: { ...p.process, bendRadiusMultiple: e.target.value ? Number(e.target.value) : undefined } })} /></Field>
                <Field label="Min braid coverage (%)"><input className={cx(inputCls, "mono w-24")} value={resolved.process.minBraidCoverage ?? ""} onChange={(e) => upd({ process: { ...p.process, minBraidCoverage: e.target.value ? Number(e.target.value) : undefined } })} /></Field>
                <Field label="Wire branching off a pin is built as" hint="Applies when you draw a second wire from a pin. Change any branch later with Make splice / Make double crimp. Add the “Too many wires crimped in one contact” rule to forbid double crimps.">
                  <Select value={resolved.process.branchJoin ?? "doubleCrimp"} onChange={(v) => upd({ process: { ...p.process, branchJoin: v as "doubleCrimp" | "splice" } })} options={[{ value: "doubleCrimp", label: "Double crimp (two wires in the contact)" }, { value: "splice", label: "Splice" }]} />
                </Field>
                <Field label="Required finishing preset">
                  <Select value={resolved.process.requiredPresetId ?? ""} onChange={(v) => upd({ process: { ...p.process, requiredPresetId: v || undefined } })} options={[{ value: "", label: "(none)" }, ...svc().library.presets.map((x) => ({ value: x.id, label: x.name }))]} />
                </Field>
              </div>
            )}
            {tab === "Documentation" && (
              <div className="flex flex-col gap-2">
                {DOCS.map((d) => (
                  <Toggle key={d} checked={resolved.documentation.includes(d)} onChange={(v) => upd({ documentation: v ? [...resolved.documentation, d] : resolved.documentation.filter((x) => x !== d) })} label={d} />
                ))}
              </div>
            )}
            {tab === "Marking" && (
              <div className="flex flex-col gap-2">
                <div className="text-xs text-text-secondary">Markings are added to labels and the BOM automatically (e.g. a red NOT FOR FLIGHT tag). Fields like {"{harnessPN}"}, {"{rev}"}, {"{serial}"} are allowed.</div>
                {resolved.markings.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input className={cx(inputCls, "mono flex-1")} value={m.text} onChange={(e) => upd({ markings: resolved.markings.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                    <Select value={m.type} onChange={(v) => upd({ markings: resolved.markings.map((x, j) => (j === i ? { ...x, type: v } : x)) })} options={[{ value: "tag", label: "Tag (flag)" }, { value: "label", label: "Label (sleeve)" }]} />
                    <IconButton label="Remove" onClick={() => upd({ markings: resolved.markings.filter((_, j) => j !== i) })}><Trash2 size={14} /></IconButton>
                  </div>
                ))}
                <Button size="sm" variant="ghost" onClick={() => upd({ markings: [...resolved.markings, { text: "NOT FOR FLIGHT", type: "tag", color: "red" }] })}><Plus size={12} /> Add marking</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** Compare pedigrees side by side: "what does it take to make this flight-worthy?" (§10.2) */
export function PedigreeCompare() {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const byPed = useAnalysis((s) => s.byPedigree);
  const quotes = useAnalysis((s) => s.quotes);
  const peds = [...project.pedigreeScheme.pedigrees].sort((a, b) => a.rank - b.rank);
  const sel = project.quote.selected;
  const insp = svc().inspections;
  const active = currentRevision(project).activePedigreeId;
  const rows: { label: string; cell: (id: string) => React.ReactNode }[] = [
    { label: "Manufacturability", cell: (id) => { const a = byPed[id]; return a ? `${a.dfm.manufacturability.errors} errors · ${a.dfm.manufacturability.warnings} warnings` : "…"; } },
    { label: "Design rules", cell: (id) => { const a = byPed[id]; return a ? `${a.dfm.design.errors} errors · ${a.dfm.design.warnings} warnings` : "…"; } },
    { label: `Unit price (${sel.qty} units, ${sel.tier})`, cell: (id) => { const c = quotes[id]?.cells.find((x) => x.qty === sel.qty && x.tier === sel.tier); return c ? <span className="tnum">{formatMoney(c.unit)}</span> : "…"; } },
    { label: "Ship date", cell: (id) => quotes[id]?.cells.find((x) => x.qty === sel.qty && x.tier === sel.tier)?.shipDate ?? "…" },
    { label: "Workmanship", cell: (id) => resolvePedigree(project.pedigreeScheme, id).workmanship },
    { label: "Inspections & tests", cell: (id) => <ul>{resolvePedigree(project.pedigreeScheme, id).inspections.map((i) => <li key={i.typeId}>{insp.find((t) => t.id === i.typeId)?.name ?? i.typeId} <span className="text-text-tertiary">{i.sampling}</span></li>)}</ul> },
    { label: "Documentation", cell: (id) => <ul>{resolvePedigree(project.pedigreeScheme, id).documentation.map((d) => <li key={d}>{d}</li>)}</ul> },
    { label: "Markings", cell: (id) => resolvePedigree(project.pedigreeScheme, id).markings.map((m) => m.text).join(", ") || "—" },
  ];
  return (
    <Dialog open onClose={() => ui.closeDialog("pedigreeCompare")} title="Compare pedigrees" width={Math.min(1300, 260 + peds.length * 220)} description={<span className="flex items-center gap-2">Evaluated on this design <DemoTag /></span>}>
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="w-48" />
            {peds.map((p) => (
              <th key={p.id} className="p-2 text-left">
                <button onClick={() => dispatch({ type: "setActivePedigree", payload: { id: p.id } })} className={cx("rounded-full", p.id === active && "ring-2 ring-accent")} title="Switch to this pedigree">
                  <PedigreePill id={p.id} />
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border-subtle align-top">
              <td className="p-2 font-medium text-text-secondary">{r.label}</td>
              {peds.map((p) => <td key={p.id} className="p-2">{r.cell(p.id)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

/**
 * A pedigree's revision scheme: letters, numbers or letter+number, with start, prefix, padding and skipped letters.
 * Fields left unset inherit from the parent pedigree (the preview shows the result).
 */
function RevisionSchemeFields({ p, resolved, parentCode, onChange }: { p: Pedigree; resolved: Pedigree["revisionScheme"]; parentCode?: string; onChange: (v: Pedigree["revisionScheme"]) => void }) {
  const own = p.revisionScheme ?? {};
  const eff = { ...DEFAULT_REVISION_SCHEME, ...resolved };
  const set = (patch: Partial<NonNullable<Pedigree["revisionScheme"]>>) => {
    const next = { ...own, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  const STARTS = { alpha: "A", numeric: "1", alphanumeric: "A1" } as const;
  return (
    <div className="col-span-2 flex flex-col gap-2 rounded-control border border-border-subtle p-3">
      <div className="flex items-baseline justify-between">
        <span className="label-caps">Revision scheme</span>
        <span className="text-2xs text-text-tertiary">{own.style || own.start || own.prefix || own.skip !== undefined || own.pad !== undefined ? "set on this pedigree" : parentCode ? `inherited from ${parentCode}` : "default (ASME Y14.35 letters)"}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Field label="Style">
          <Select value={eff.style} onChange={(v) => set({ style: v as typeof eff.style, start: STARTS[v as typeof eff.style] })} options={[{ value: "alpha", label: "Letters (A, B, C)" }, { value: "numeric", label: "Numbers (1, 2, 3)" }, { value: "alphanumeric", label: "Letter + number (A1, A2)" }]} />
        </Field>
        <Field label="First revision">
          <input className={cx(inputCls, "mono")} value={own.start ?? ""} placeholder={eff.start} onChange={(e) => set({ start: e.target.value.toUpperCase() || undefined })} />
        </Field>
        <Field label="Prefix">
          <input className={cx(inputCls, "mono")} value={own.prefix ?? ""} placeholder={eff.prefix || "none"} onChange={(e) => set({ prefix: e.target.value.toUpperCase() || undefined })} />
        </Field>
        {eff.style === "numeric" ? (
          <Field label="Digits (zero-pad)">
            <input type="number" min={0} max={6} className={cx(inputCls, "mono")} value={own.pad ?? ""} placeholder={String(eff.pad)} onChange={(e) => set({ pad: e.target.value === "" ? undefined : Math.max(0, Math.min(6, Number(e.target.value))) })} />
          </Field>
        ) : (
          <Field label="Letters never used">
            <input className={cx(inputCls, "mono")} value={own.skip ?? ""} placeholder={eff.skip} onChange={(e) => set({ skip: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") || undefined })} />
          </Field>
        )}
      </div>
      <div className="text-xs text-text-secondary">
        Sequence: <span className="mono text-text-primary">{revisionPreview(eff, 6).join(", ")} …</span>
        {eff.style === "alphanumeric" && <span className="text-text-tertiary"> · a major revision moves to the next letter ({nextRevision(firstRevision(eff), eff, true)})</span>}
      </div>
      <div className="text-2xs text-text-tertiary">A working revision takes the next label in its pedigree's scheme; switching pedigree relabels it until you type a label yourself.</div>
    </div>
  );
}
