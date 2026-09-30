import { Command } from "cmdk";
import { useEffect, useMemo, useState } from "react";
import {
  addPotting,
  applyBatch,
  applyPreset,
  buildReleaseSnapshot,
  currentRevision,
  derive,
  formatLength,
  formatMoney,
  freezeRevision,
  parseLength,
  setProjectProps,
  setSettings,
  uid,
  WIRE_COLORS,
  type FinishingPreset,
} from "@hs/model";
import { computeBom, deriveOperations } from "@hs/ops";
import { makeQuoteSummary } from "../lib/summary";
import { releaseOutputHashes, TOOL_VERSION } from "../lib/docs";
import { runDfm } from "@hs/dfm";
import { resolvePedigree } from "@hs/model";
import { dispatch, getProject, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { useActiveQuote, useAnalysis } from "../store/analysis";
import { ACTIONS, actionCtx } from "../lib/actions";
import { previewPrice, svc } from "../lib/services";
import { createNewProject, openExample } from "../lib/projects";
import { openProjectFile } from "../lib/files";
import { Icon } from "../ui/icons";
import { Button, cx, Dialog, Field, inputCls, Kbd, Section, Select, Toggle } from "../ui/primitives";

export function CommandPalette() {
  const ui = useUi();
  const close = () => ui.closeDialog("palette");
  const ctx = actionCtx();
  const items = ACTIONS.filter((a) => !a.when || a.when(ctx));
  const groups = [...new Set(items.map((a) => a.group))];
  return (
    <Dialog open onClose={close} title="Command palette" width={560}>
      <Command label="Commands" className="flex flex-col gap-2">
        <Command.Input autoFocus placeholder="Type a command…" className={cx(inputCls, "w-full")} />
        <Command.List className="scroll-thin max-h-[50vh] overflow-auto">
          <Command.Empty className="p-4 text-sm text-text-tertiary">No matching command.</Command.Empty>
          {groups.map((g) => (
            <Command.Group key={g} heading={g} className="[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
              {items
                .filter((a) => a.group === g)
                .map((a) => (
                  <Command.Item key={a.id} value={`${a.label} ${a.group}`} onSelect={() => (close(), setTimeout(() => a.run(ctx), 10))} className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-sm aria-selected:bg-bg-hover">
                    <span className="w-4 text-text-secondary">
                      <Icon name={a.icon} size={14} />
                    </span>
                    <span className="flex-1">{a.label}</span>
                    {a.shortcut && <Kbd>{a.shortcut}</Kbd>}
                  </Command.Item>
                ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </Dialog>
  );
}

export function ShortcutsDialog() {
  const ui = useUi();
  const rows: [string, string][] = [
    ["Add connector (part picker at cursor)", "C / double-click"],
    ["Drag pin → pin", "connect"],
    ["Drag pin → empty canvas", "new connector + wire"],
    ["Drag connector onto connector", "mate: by name / 1→1 / manual"],
    ["Drag from middle of a bundle", "pull out a breakout"],
    ["Commit ratsnest", "R"],
    ["Twist selected wires", "T"],
    ["Flip connector direction", "F"],
    ["Shield view", "G"],
    ["Wire list", "L"],
    ["Zoom to fit", "Shift+F"],
    ["Pan", "Space+drag / middle mouse"],
    ["Zoom", "scroll wheel"],
    ["Disable snap while dragging", "Alt"],
    ["Command palette", "Ctrl+K"],
    ["Undo / redo", "Ctrl+Z / Ctrl+Shift+Z"],
    ["Duplicate", "Ctrl+D"],
    ["Copy / paste connectors", "Ctrl+C / Ctrl+V"],
    ["Save .harness.json", "Ctrl+S"],
    ["Pin card: next / previous row", "Enter or Tab / Shift+Tab"],
    ["Views: Design · BOM · Outputs", "1 · 2 · 3"],
  ];
  return (
    <Dialog open onClose={() => ui.closeDialog("shortcuts")} title="Keyboard shortcuts" width={520}>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([a, b]) => (
            <tr key={a} className="border-b border-border-subtle">
              <td className="py-1.5">{a}</td>
              <td className="py-1.5 text-right">
                <Kbd>{b}</Kbd>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

export function OpenDialog() {
  const ui = useUi();
  const [list, setList] = useState<{ id: string; name: string; partNumber: string; updated: string }[]>([]);
  useEffect(() => {
    void svc().store.list().then(setList);
  }, []);
  const lib = svc().library;
  const close = () => ui.closeDialog("open");
  return (
    <Dialog open onClose={close} title="Projects & examples" width={640} description="Designs are stored only in this browser. Save .harness.json files to keep or share them.">
      <div className="flex flex-col gap-4">
        <Section title="New project">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => (createNewProject(), close())}>Blank (Standard pedigree)</Button>
            {lib.rulesets
              .filter((r) => r.pedigreeScheme && r.pedigreeScheme.pedigrees.length > 1)
              .map((r) => (
                <Button key={r.id} variant="ghost" onClick={() => (createNewProject(r.pedigreeScheme), useProject.getState().dispatch({ type: "upsertRuleset", payload: { ruleset: r } }), close())}>
                  With “{r.pedigreeScheme!.name}”
                </Button>
              ))}
            <Button variant="ghost" onClick={() => (close(), void openProjectFile())}>
              Open .harness.json…
            </Button>
          </div>
        </Section>
        <Section title="Examples">
          <div className="grid grid-cols-2 gap-2">
            {svc().examples.map((e) => (
              <button key={e.id} className="rounded-card border border-border-subtle p-3 text-left hover:border-border-control" onClick={() => (void openExample(e.id), close())}>
                <div className="text-sm font-medium">{e.name}</div>
                <div className="text-xs text-text-secondary">{e.description}</div>
              </button>
            ))}
          </div>
        </Section>
        <Section title="Recent (this browser)">
          <div className="flex flex-col">
            {list.map((p) => (
              <div key={p.id} className="flex items-center justify-between border-b border-border-subtle py-1.5 text-sm">
                <button
                  className="text-left hover:text-accent"
                  onClick={async () => {
                    try {
                      const pr = await svc().store.load(p.id);
                      if (pr) useProject.getState().init(pr);
                      close();
                    } catch (e) {
                      ui.toast({ kind: "error", text: `${(e as Error).message}. The stored copy is kept unchanged.` });
                    }
                  }}
                >
                  {p.name} <span className="mono text-xs text-text-tertiary">{p.partNumber}</span>
                </button>
                <span className="flex items-center gap-2 text-xs text-text-tertiary">
                  {new Date(p.updated).toLocaleString()}
                  <button
                    className="text-status-error hover:underline"
                    onClick={async () => {
                      if (p.id === getProject().id) return ui.toast({ kind: "info", text: "Can't delete the open project" });
                      if (!confirm(`Delete “${p.name}” from this browser?`)) return;
                      await svc().store.remove(p.id);
                      setList(await svc().store.list());
                    }}
                  >
                    delete
                  </button>
                </span>
              </div>
            ))}
            {!list.length && <div className="text-xs text-text-tertiary">No saved projects yet.</div>}
          </div>
        </Section>
      </div>
    </Dialog>
  );
}

export function FreezeDialog() {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  const [notes, setNotes] = useState("");
  const close = () => ui.closeDialog("freeze");
  return (
    <Dialog
      open
      onClose={close}
      title={`Freeze Rev ${rev.label}`}
      width={480}
      description="A frozen revision is immutable. Work continues on the next revision; outputs from a frozen revision are deterministic."
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={rev.frozen}
            onClick={async () => {
              const p = getProject();
              const s = svc();
              const at = new Date().toISOString();
              const r = currentRevision(p);
              const d = derive(r.harness, s.cat, p.settings, { breakoutAllowanceMm: s.profile.capabilities.breakoutAllowanceMm });
              const dfm = runDfm({ project: p, cat: s.cat, profile: s.profile });
              const bom = computeBom(p, r, s.cat, d, p.quote.selected.qty);
              // Typed release record (FIX-01): inputs, versions, content hashes and results as released.
              const release = buildReleaseSnapshot(p, {
                at,
                tool: TOOL_VERSION,
                cat: s.cat,
                profile: s.profile,
                inspections: s.inspections,
                results: {
                  dfm: { status: dfm.manufacturability.status, errors: dfm.manufacturability.errors, warnings: dfm.manufacturability.warnings, incomplete: dfm.manufacturability.incomplete, review: dfm.manufacturability.review, hash: dfm.hash, designErrors: dfm.design.errors },
                  bom: bom.lines.map((l) => ({ pn: l.pn, qty: l.qty, uom: l.uom })),
                  wireLengthsMm: Object.fromEntries(r.harness.wires.map((w) => [w.label, d.wireLengthMm.get(w.id) ?? 0])),
                  // Pricing/stock snapshot stored with the frozen revision (§13.3)
                  quote: useAnalysis.getState().quotes[rev.activePedigreeId] ?? undefined,
                },
              });
              release.outputs = releaseOutputHashes({ ...p, revisions: p.revisions.map((x) => (x.id === r.id ? { ...x, frozen: true, frozenAt: at, release } : x)) }, r.id);
              if (dispatch(freezeRevision({ notes, newRevisionId: uid(), release, at }), `Freeze Rev ${rev.label}`)) {
                ui.toast({ kind: "success", text: `Rev ${rev.label} frozen. You're now editing the next revision. Its release package is in Outputs → Package.` });
                close();
              }
            }}
          >
            Freeze Rev {rev.label}
          </Button>
        </>
      }
    >
      <Field label="Revision notes">
        <textarea className={cx(inputCls, "h-24 py-1")} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What changed in this revision?" />
      </Field>
    </Dialog>
  );
}

export function SettingsDialog() {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const st = project.settings;
  const u = project.units;
  const close = () => ui.closeDialog("settings");
  const lenField = (label: string, v: number, key: keyof typeof st) => (
    <Field label={label}>
      <input className={cx(inputCls, "mono")} defaultValue={formatLength(v, u).replace(" ", "")} onBlur={(e) => {
        const mm = parseLength(e.target.value, u);
        if (mm != null) dispatch(setSettings({ [key]: mm } as never));
      }} />
    </Field>
  );
  return (
    <Dialog open onClose={close} title="Project settings" width={620}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Project name">
          <input className={inputCls} defaultValue={project.name} onBlur={(e) => dispatch(setProjectProps({ name: e.target.value }))} />
        </Field>
        <Field label="Harness part number">
          <input className={cx(inputCls, "mono")} defaultValue={project.partNumber} onBlur={(e) => dispatch(setProjectProps({ partNumber: e.target.value }))} />
        </Field>
        <Field label="Units">
          <Select value={u} onChange={(v) => dispatch(setProjectProps({ units: v }))} options={[{ value: "in", label: "Inches" }, { value: "mm", label: "Millimetres" }]} />
        </Field>
        <Field label="Default wire spec">
          <Select value={st.defaultWireSpec} onChange={(v) => dispatch(setSettings({ defaultWireSpec: v }))} options={svc().cat.wireSpecs().map((s) => ({ value: s, label: s }))} />
        </Field>
        <Field label="Default wire color">
          <Select value={st.defaultColor.base} onChange={(v) => dispatch(setSettings({ defaultColor: { base: v, stripes: [] } }))} options={WIRE_COLORS.map((c) => ({ value: c.code, label: `${c.code} ${c.name}` }))} />
        </Field>
        <Field label="Default backshell for new connectors">
          <Select value={st.defaultBackshell} onChange={(v) => dispatch(setSettings({ defaultBackshell: v }))} options={[{ value: "none", label: "None" }, { value: "strainRelief", label: "Strain relief" }, { value: "emiBand", label: "EMI band-clamp" }]} />
        </Field>
        {lenField("Default segment length", st.defaultSegmentMm, "defaultSegmentMm")}
        {lenField("Service loop (added to every wire)", st.serviceLoopMm, "serviceLoopMm")}
        {lenField("Default label distance", st.defaultLabelDistanceMm, "defaultLabelDistanceMm")}
        <Field label="Packing factor k (bundle diameter)">
          <input className={cx(inputCls, "mono")} defaultValue={st.packingFactor} onBlur={(e) => dispatch(setSettings({ packingFactor: Number(e.target.value) || 1.2 }))} />
        </Field>
        <Field label="No-connect label" hint="Shown on pin cards, pinouts and drawings for pins marked no-connect.">
          <input
            className={cx(inputCls, "mono")}
            defaultValue={st.noConnectLabel}
            onBlur={(e) => {
              const v = e.target.value.trim() || "NC";
              // The label always works as an alias too, so typing what you see marks a pin NC.
              dispatch(setSettings({ noConnectLabel: v, noConnectAliases: [...new Set([v, ...st.noConnectAliases])] }));
            }}
          />
        </Field>
        <Field label="No-connect names (comma separated)" hint="Typing any of these as a signal marks the pin no-connect instead of creating a net.">
          <input className={cx(inputCls, "mono")} defaultValue={st.noConnectAliases.join(", ")} onBlur={(e) => dispatch(setSettings({ noConnectAliases: [...new Set([st.noConnectLabel, ...e.target.value.split(",").map((s) => s.trim()).filter(Boolean)])] }))} />
        </Field>
        <div className="col-span-2 flex flex-col gap-2">
          <Toggle checked={st.autoCommit} onChange={(v) => dispatch(setSettings({ autoCommit: v }))} label="Auto-commit connections (off: same-name pins show dashed ratsnest lines until you commit with R)" />
          <Toggle checked={st.colorByClass} onChange={(v) => dispatch(setSettings({ colorByClass: v }))} label="Auto-assign wire color by net class (power red, ground black…)" />
          <Toggle checked={st.wiredSpares} onChange={(v) => dispatch(setSettings({ wiredSpares: v }))} label="Pedigree/user requires wired spares (filler contacts instead of sealing plugs)" />
        </div>
        <Section title="Display">
          <Field label="Theme">
            <Select value={ui.theme} onChange={(v) => ui.setTheme(v)} options={[{ value: "dark", label: "Dark (default)" }, { value: "light", label: "Light" }, { value: "system", label: "System" }]} />
          </Field>
          <Field label="Wire color labels">
            <Select value={ui.wireColorLabels} onChange={(v) => ui.setWireColorLabels(v)} options={[{ value: "detail", label: "Detail zoom only (default)" }, { value: "always", label: "Always" }, { value: "hover", label: "Hover only" }]} />
          </Field>
          <Toggle checked={ui.colorblindAssist} onChange={(v) => ui.setColorblindAssist(v)} label="Colorblind assist (always show color codes)" />
        </Section>
      </div>
    </Dialog>
  );
}

export function PottingDialog({ connectorId }: { connectorId: string }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const c = currentRevision(project).harness.connectors.find((x) => x.id === connectorId);
  const pot = svc().cat.bundle.potting;
  const [compound, setCompound] = useState(pot.find((p) => p.kind === "compound")!.pn);
  const part = c && svc().cat.connector(c.pn);
  const mold = pot.find((p) => p.kind === "mold" && p.shellSizes?.includes(part?.shellSize ?? 0));
  const existing = currentRevision(project).harness.potting.find((p) => p.targetId === connectorId);
  const close = () => ui.closeDialog("potting");
  if (!c) return null;
  return (
    <Dialog
      open
      onClose={close}
      title={`Pot ${c.refDes}?`}
      width={460}
      description="Potting makes rework impossible. It adds cure time to the lead time and is a manual operation on this machine profile."
      footer={
        <>
          {existing && (
            <Button variant="danger" onClick={() => (dispatch({ type: "removePotting", payload: { ids: [existing.id] } }), close())}>
              Remove potting
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => (dispatch(addPotting({ id: uid(), targetKind: "connector", targetId: c.id, compoundPn: compound, moldPn: mold?.pn })), close())}>
            Yes, pot {c.refDes}
          </Button>
        </>
      }
    >
      <Field label="Compound">
        <Select value={compound} onChange={setCompound} options={pot.filter((p) => p.kind === "compound").map((p) => ({ value: p.pn, label: `${p.description} (${p.cureHours} h cure)` }))} />
      </Field>
      {mold && <div className="mt-2 text-xs text-text-secondary">Mold / boot: <span className="mono">{mold.pn}</span></div>}
    </Dialog>
  );
}

/** "Finish harness": apply a finishing preset with a preview of the price change (§6.13). */
export function FinishDialog({ segmentIds }: { segmentIds?: string[] }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const presets = [...svc().library.presets, ...project.presets];
  const [sel, setSel] = useState<FinishingPreset>(presets[1] ?? presets[0]!);
  const quote = useActiveQuote();
  const close = () => ui.closeDialog("finish");
  const preview = useMemo(() => {
    try {
      const s = svc();
      const r = applyBatch(project, [applyPreset({ preset: sel, segmentIds })], { cat: s.cat });
      const p2 = r.project;
      const rev = currentRevision(p2);
      const ped = resolvePedigree(p2.pedigreeScheme, rev.activePedigreeId);
      const bom = computeBom(p2, rev, s.cat, undefined, p2.quote.selected.qty);
      const ops = deriveOperations(p2, rev, s.cat, s.profile, ped, s.inspections);
      const dfm = runDfm({ project: p2, cat: s.cat, profile: s.profile });
      const sum = makeQuoteSummary(p2, rev.harness, bom, ops, ped, dfm, 0);
      const priced = previewPrice(sum, [p2.quote.selected.qty], "preview");
      const cell = priced?.cells.find((c) => c.tier === p2.quote.selected.tier);
      const h0 = currentRevision(project).harness;
      const h1 = rev.harness;
      return { unit: cell?.unit, layers: h1.layers.length - h0.layers.length, clamps: h1.clamps.length - h0.clamps.length, labels: h1.labels.length - h0.labels.length, boots: h1.boots.length - h0.boots.length, backshells: h1.connectors.filter((c) => c.backshell).length - h0.connectors.filter((c) => c.backshell).length };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [sel, project, segmentIds]);
  const cur = quote?.cells.find((c) => c.qty === project.quote.selected.qty && c.tier === project.quote.selected.tier);
  return (
    <Dialog
      open
      onClose={close}
      title="Finish harness"
      width={620}
      description={segmentIds?.length ? `Applies to ${segmentIds.length} selected segment(s).` : "Applies to the whole harness. Auto-added parts follow later design changes until you edit them."}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => (dispatch(applyPreset({ preset: sel, segmentIds })), close())}>
            Apply “{sel.name}”
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[220px_1fr] gap-4">
        <div className="flex flex-col gap-1">
          {presets.map((p) => (
            <button key={p.id} onClick={() => setSel(p)} className={cx("rounded-control border px-2 py-1.5 text-left text-sm", sel.id === p.id ? "border-accent bg-bg-hover" : "border-border-subtle hover:border-border-control")}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <div className="text-text-secondary">{sel.description}</div>
          <ul className="list-disc pl-5 text-xs text-text-secondary">
            {sel.steps.map((s, i) => (
              <li key={i}>
                {s.action}
                {Object.keys(s.params).length ? `: ${Object.values(s.params).join(", ")}` : ""}
              </li>
            ))}
          </ul>
          <Section title="Preview">
            {"error" in preview ? (
              <div className="text-xs text-status-error">{preview.error}</div>
            ) : (
              <div className="grid grid-cols-2 gap-1 text-xs">
                <span>Layers</span>
                <span className="tnum">+{preview.layers}</span>
                <span>Band clamps</span>
                <span className="tnum">+{preview.clamps}</span>
                <span>Labels</span>
                <span className="tnum">+{preview.labels}</span>
                <span>Boots</span>
                <span className="tnum">+{preview.boots}</span>
                <span>Backshells added/changed</span>
                <span className="tnum">{preview.backshells >= 0 ? "+" : ""}{preview.backshells}</span>
                <span className="font-medium">Unit price (demo)</span>
                <span className="tnum font-medium">
                  {preview.unit != null ? formatMoney(preview.unit) : "—"}
                  {cur && preview.unit != null && <span className={cx("ml-1", preview.unit > cur.unit ? "text-status-warning" : "text-status-pass")}>({preview.unit >= cur.unit ? "+" : "−"}{formatMoney(Math.abs(preview.unit - cur.unit))})</span>}
                </span>
              </div>
            )}
          </Section>
        </div>
      </div>
    </Dialog>
  );
}
