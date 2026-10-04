import * as DM from "@radix-ui/react-dropdown-menu";
import { currentRevision, formatMoney, resolvePedigree, setActivePedigree, setProjectProps, setRevisionLabel } from "@hs/model";
import { Check, ChevronDown, CircleAlert, CloudOff, Download, FileInput, HardDrive, Loader2, Redo2, Share2, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { dispatch, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { activePedigreeOf, useActiveQuote, useAnalysis } from "../store/analysis";
import { cx, IconButton, Kbd, Tip } from "../ui/primitives";
import { runAction } from "../lib/actions";
import { EXPORTS } from "../lib/exports";
import { createNewProject } from "../lib/projects";
import { svc } from "../lib/services";

const menuCls = "pop-in z-50 min-w-[220px] rounded-card border border-border-subtle bg-bg-surface-2 p-1 shadow-xl";
const itemCls = "flex cursor-default items-center gap-2 rounded-control px-2 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-bg-hover data-[disabled]:opacity-40";

function Item({ children, onSelect, shortcut, disabled }: { children: ReactNode; onSelect: () => void; shortcut?: string; disabled?: boolean }) {
  return (
    <DM.Item className={itemCls} onSelect={onSelect} disabled={disabled}>
      <span className="flex-1">{children}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </DM.Item>
  );
}

export function PedigreePill({ id, withCode = true, className }: { id: string; withCode?: boolean; className?: string }) {
  const project = useProject((s) => s.project)!;
  const p = project.pedigreeScheme.pedigrees.find((x) => x.id === id);
  if (!p) return null;
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs", className)} style={{ borderColor: `var(--pedigree-${p.color})` }}>
      <span className="h-2 w-2 rotate-45" style={{ background: `var(--pedigree-${p.color})` }} aria-hidden />
      {withCode && <span className="mono font-semibold">{p.code}</span>}
      <span>{p.name}</span>
    </span>
  );
}

function PedigreeSwitcher() {
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  const ui = useUi();
  const byPed = useAnalysis((s) => s.byPedigree);
  const quotes = useAnalysis((s) => s.quotes);
  const [hover, setHover] = useState<string | null>(null);
  const activeId = activePedigreeOf(project);
  const released = rev.frozen;
  const active = byPed[activeId];
  const sel = project.quote.selected;
  const cell = (pid: string) => quotes[pid]?.cells.find((c) => c.qty === sel.qty && c.tier === sel.tier);
  const preview = (pid: string) => {
    const a = byPed[pid];
    if (!a || !active) return "Evaluating…";
    const errs = a.dfm.manufacturability.errors + a.dfm.design.errors - (active.dfm.manufacturability.errors + active.dfm.design.errors);
    const warns = a.dfm.manufacturability.warnings + a.dfm.design.warnings - (active.dfm.manufacturability.warnings + active.dfm.design.warnings);
    const pa = resolvePedigree(project.pedigreeScheme, pid);
    const pb = resolvePedigree(project.pedigreeScheme, activeId);
    const added = pa.inspections.filter((i) => !pb.inspections.some((j) => j.typeId === i.typeId && j.sampling === i.sampling)).map((i) => `${svc().inspections.find((t) => t.id === i.typeId)?.name ?? i.typeId} ${i.sampling}`);
    const c1 = cell(pid);
    const c0 = cell(activeId);
    const parts: string[] = [];
    parts.push(`${errs >= 0 ? "+" : ""}${errs} errors, ${warns >= 0 ? "+" : ""}${warns} warnings`);
    if (added.length) parts.push(`adds ${added.slice(0, 3).join(", ")}${added.length > 3 ? "…" : ""}`);
    if (c1 && c0) {
      const d = c1.unit - c0.unit;
      parts.push(`${d >= 0 ? "+" : "−"}${formatMoney(Math.abs(d), 0)}/unit`);
      const days = Math.round((new Date(c1.shipDate).getTime() - new Date(c0.shipDate).getTime()) / 86400000);
      if (days) parts.push(`${days > 0 ? "+" : ""}${days} days`);
    }
    return parts.join(" · ");
  };
  return (
    <DM.Root onOpenChange={(o) => !o && setHover(null)}>
      <Tip label={released ? "Released revision: its build class is fixed. Use Compare to see other classes." : "Pedigree (build class): switch to re-run checks, quote and documents"} side="bottom">
        <DM.Trigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-label="Pedigree">
          <span className="inline-flex items-center gap-1">
            <PedigreePill id={activeId} />
            <ChevronDown size={12} className="text-text-tertiary" />
          </span>
        </DM.Trigger>
      </Tip>
      <DM.Portal>
        <DM.Content className={cx(menuCls, "w-[380px]")} sideOffset={6} align="start">
          <DM.Label className="label-caps px-2 py-1">Pedigree: {project.pedigreeScheme.name}</DM.Label>
          {released && <div className="px-2 pb-1 text-2xs text-text-secondary">Rev {rev.label} was released as this class and can't be switched. Hover a class to preview its differences.</div>}
          {[...project.pedigreeScheme.pedigrees]
            .sort((a, b) => a.rank - b.rank)
            .map((p) => (
              <DM.Item key={p.id} className={cx(itemCls, "flex-col items-start")} onSelect={(e) => (released ? e.preventDefault() : dispatch(setActivePedigree({ id: p.id }), `Switch pedigree to ${p.name}`))} onMouseEnter={() => setHover(p.id)}>
                <span className="flex w-full items-center gap-2">
                  <PedigreePill id={p.id} />
                  {p.id === activeId && <Check size={14} className="ml-auto text-accent" />}
                </span>
                {hover === p.id && p.id !== activeId && <span className="pl-1 text-2xs text-text-secondary">{preview(p.id)}</span>}
              </DM.Item>
            ))}
          <DM.Separator className="my-1 h-px bg-border-subtle" />
          <Item onSelect={() => ui.openDialog("pedigreeCompare")}>Compare pedigrees…</Item>
          <Item onSelect={() => ui.openDialog("pedigreeEditor")}>Define pedigrees…</Item>
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

/** Honest persistence state: local to this browser; nothing is uploaded in Phase 1 (feedback §6). */
function SaveState() {
  const s = useProject((x) => x.saveState);
  const err = useProject((x) => x.saveError);
  const conflict = useProject((x) => x.conflict);
  const map = {
    saved: { icon: <HardDrive size={14} />, text: "Saved on this device" },
    saving: { icon: <Loader2 size={14} className="animate-spin" />, text: "Saving on this device…" },
    unsaved: { icon: <HardDrive size={14} />, text: "Not saved yet" },
    error: { icon: <CloudOff size={14} />, text: "Not saved: storage failed" },
    conflict: { icon: <CircleAlert size={14} />, text: "Changed in another tab" },
  }[s];
  const tip = s === "error" ? `${err ?? "Storage failed"} Your edits are still open here; Ctrl+S downloads a copy.` : s === "conflict" ? `Another tab saved this project at ${conflict?.updated.slice(11, 19) ?? "?"}. Autosave is paused so neither copy is lost.` : "Autosaved in this browser's storage only (IndexedDB). Nothing is uploaded. Ctrl+S downloads a .harness.json file.";
  if (s === "conflict" || s === "error")
    return (
      <DM.Root>
        <DM.Trigger className={cx("flex items-center gap-1 rounded-control px-1 text-xs", "text-status-error hover:bg-bg-hover")} aria-label={map.text} title={tip}>
          {map.icon}
          {map.text}
          <ChevronDown size={12} />
        </DM.Trigger>
        <DM.Portal>
          <DM.Content className={cx(menuCls, "w-[300px]")} sideOffset={6} align="start">
            <div className="px-2 py-1 text-2xs text-text-secondary">{tip}</div>
            {s === "conflict" && <Item onSelect={() => void useProject.getState().reloadFromStorage()}>Load the other tab's version (discard mine)</Item>}
            <Item onSelect={() => void useProject.getState().saveNow({ force: true })}>{s === "conflict" ? "Keep mine (overwrite the other tab's save)" : "Retry save"}</Item>
            <Item onSelect={() => runAction("save")}>Download a copy (.harness.json)</Item>
          </DM.Content>
        </DM.Portal>
      </DM.Root>
    );
  return (
    <Tip label={tip} side="bottom">
      <span className="flex items-center gap-1 whitespace-nowrap text-xs text-text-tertiary">
        {map.icon}
        <span className="hidden xl:inline">{map.text}</span>
        <span className="xl:hidden">{s === "saved" ? "Saved locally" : s === "saving" ? "Saving…" : "Not saved"}</span>
      </span>
    </Tip>
  );
}

export function OrderButton({ compact }: { compact?: boolean }) {
  const project = useProject((s) => s.project)!;
  const q = useActiveQuote();
  const ui = useUi();
  const updating = useAnalysis((s) => s.quoteUpdating);
  const sel = project.quote.selected;
  const cell = q?.cells.find((c) => c.qty === sel.qty && c.tier === sel.tier);
  const tier = q?.tiers.find((t) => t.id === sel.tier);
  const empty = !currentRevision(project).harness.connectors.length;
  const review = q?.state === "needsReview";
  const label = empty ? "Order" : review ? "Request quote" : "Order";
  const disabledReason = empty ? "Add connectors to order" : q?.state === "unavailable" ? q.reason : undefined;
  return (
    <Tip label={disabledReason ?? (cell ? `${sel.qty} units · ${tier?.name} · ships ${new Date(cell.shipDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} (demo)` : "Calculating…")} side="bottom">
      <span>
        <button disabled={!!disabledReason} onClick={() => ui.openDialog("order")} className="flex h-8 items-center gap-2 whitespace-nowrap rounded-control bg-accent px-3 text-sm font-semibold text-accent-on hover:brightness-110 disabled:opacity-50">
          {label}
          {!compact && cell && !empty && (
            <span className={cx("tnum border-l border-accent-on/30 pl-2", updating && "opacity-60")}>
              {review ? "~" : ""}
              {formatMoney(cell.total, 0)}
            </span>
          )}
        </button>
      </span>
    </Tip>
  );
}

export function TopBar() {
  const project = useProject((s) => s.project)!;
  const { past, future, undo, redo } = useProject();
  const ui = useUi();
  const rev = currentRevision(project);
  const [editingName, setEditingName] = useState(false);
  const [editingPn, setEditingPn] = useState(false);
  const [editingRev, setEditingRev] = useState(false);
  // Part numbers usually come from the company's own system: pasted in, trimmed, never left empty.
  const savePn = (v: string) => {
    const pn = v.trim();
    if (pn && pn !== project.partNumber) dispatch(setProjectProps({ partNumber: pn }), `Part number ${pn}`);
    setEditingPn(false);
  };
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border-subtle bg-bg-app px-3" role="banner">
      <div className="flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 32 32" aria-label="Harness Studio">
          <rect width="32" height="32" rx="7" fill="var(--bg-surface-2)" />
          <path d="M6 16h7l3-6 3 12 3-6h4" stroke="var(--accent)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="hidden whitespace-nowrap text-sm font-semibold 2xl:inline">Harness Studio</span>
      </div>
      <div className="h-5 w-px bg-border-subtle" />
      {/* Project */}
      {editingName ? (
        <input autoFocus className="h-7 w-52 rounded-control border border-accent bg-bg-surface-1 px-2 text-sm" defaultValue={project.name} onBlur={(e) => (dispatch(setProjectProps({ name: e.target.value })), setEditingName(false))} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} aria-label="Project name" />
      ) : (
        <DM.Root>
          <DM.Trigger className="flex items-center gap-1 rounded-control px-1.5 py-1 text-sm hover:bg-bg-hover" aria-label="Project menu">
            <span className="max-w-[200px] truncate font-medium">{project.name}</span>
            <ChevronDown size={12} className="text-text-tertiary" />
          </DM.Trigger>
          <DM.Portal>
            <DM.Content className={menuCls} sideOffset={6} align="start">
              <Item onSelect={() => setEditingName(true)}>Rename</Item>
              <Item onSelect={() => setEditingPn(true)}>Change part number</Item>
              <Item onSelect={() => ui.openDialog("settings")}>Project settings…</Item>
              <DM.Separator className="my-1 h-px bg-border-subtle" />
              <Item onSelect={() => createNewProject()}>New project</Item>
              <Item onSelect={() => ui.openDialog("open")}>Projects &amp; examples…</Item>
              <Item onSelect={() => runAction("open")} shortcut="Ctrl+O">
                Open .harness.json…
              </Item>
              <Item onSelect={() => runAction("save")} shortcut="Ctrl+S">
                Save .harness.json
              </Item>
            </DM.Content>
          </DM.Portal>
        </DM.Root>
      )}
      {/* Harness part number: click to edit or paste one from your own numbering system */}
      {editingPn ? (
        <input
          autoFocus
          className="mono h-7 w-40 rounded-control border border-accent bg-bg-surface-1 px-2 text-xs"
          defaultValue={project.partNumber}
          spellCheck={false}
          aria-label="Harness part number"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => savePn(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditingPn(false);
          }}
        />
      ) : (
        <button className="mono -ml-1 whitespace-nowrap rounded-control px-1 py-1 text-xs text-text-tertiary hover:bg-bg-hover hover:text-text-primary" title="Harness part number: click to change or paste your own" onClick={() => setEditingPn(true)}>
          {project.partNumber}
        </button>
      )}
      {editingRev ? (
        <input
          autoFocus
          className="mono h-7 w-24 rounded-control border border-accent bg-bg-surface-1 px-2 text-sm"
          defaultValue={rev.labelPinned ? rev.label : ""}
          placeholder={rev.label}
          spellCheck={false}
          aria-label="Revision label (blank = follow the pedigree's revision scheme)"
          title="Blank follows the pedigree's revision scheme"
          onBlur={(e) => (dispatch(setRevisionLabel({ label: e.target.value })), setEditingRev(false))}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditingRev(false);
          }}
        />
      ) : (
      <DM.Root>
        <DM.Trigger className="flex items-center gap-1 rounded-control px-1.5 py-1 text-sm hover:bg-bg-hover" aria-label="Revision">
          <span className="mono whitespace-nowrap">Rev {rev.label}</span>
          {rev.frozen && <span className="whitespace-nowrap text-2xs text-text-tertiary">(released)</span>}
          <ChevronDown size={12} className="text-text-tertiary" />
        </DM.Trigger>
        <DM.Portal>
          <DM.Content className={menuCls} sideOffset={6} align="start">
            {project.revisions.map((r) => (
              <Item key={r.id} onSelect={() => dispatch({ type: "openRevision", payload: { id: r.id } })}>
                <span className="mono">Rev {r.label}</span> {r.frozen ? `· frozen ${r.frozenAt?.slice(0, 10) ?? ""}` : "· working draft"} {r.id === rev.id && "✓"}
              </Item>
            ))}
            <DM.Separator className="my-1 h-px bg-border-subtle" />
            <Item disabled={rev.frozen} onSelect={() => setEditingRev(true)}>
              Rename Rev {rev.label}…
            </Item>
            <Item disabled={rev.frozen} onSelect={() => ui.openDialog("freeze")}>
              Freeze Rev {rev.label}…
            </Item>
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      )}
      <PedigreeSwitcher />
      <SaveState />
      <div className="flex items-center">
        <IconButton label={past.length ? `Undo ${past[past.length - 1]!.label}` : "Undo"} shortcut="Ctrl+Z" disabled={!past.length} onClick={undo} tipSide="bottom">
          <Undo2 size={16} />
        </IconButton>
        <IconButton label={future.length ? `Redo ${future[0]!.label}` : "Redo"} shortcut="Ctrl+Shift+Z" disabled={!future.length} onClick={redo} tipSide="bottom">
          <Redo2 size={16} />
        </IconButton>
      </div>
      <div className="flex-1" />
      <nav className="flex items-center rounded-control border border-border-subtle p-0.5" aria-label="Views">
        {(["design", "bom", "outputs"] as const).map((v, i) => (
          <Tip key={v} label={`${v === "bom" ? "BOM" : v[0]!.toUpperCase() + v.slice(1)} view`} shortcut={String(i + 1)} side="bottom">
            <button onClick={() => ui.setView(v)} aria-current={ui.view === v} className={cx("h-7 rounded-[5px] px-3 text-sm", ui.view === v ? "bg-bg-hover font-medium text-text-primary" : "text-text-secondary hover:text-text-primary")}>
              {v === "bom" ? "BOM" : v[0]!.toUpperCase() + v.slice(1)}
            </button>
          </Tip>
        ))}
      </nav>
      {ui.view === "design" && (
        <nav className="ml-2 flex items-center rounded-control border border-border-subtle p-0.5" aria-label="Canvas mode">
          {(
            [
              ["schematic", "Schematic", "Schematic: connectors, pins, signals and every wire pin-to-pin"],
              ["bundles", "Bundles", "Bundle layout: routing, branches, lengths and sleeving (wires hidden)"],
            ] as const
          ).map(([m, label, tip]) => (
            <Tip key={m} label={tip} shortcut="Tab" side="bottom">
              <button onClick={() => ui.setCanvasMode(m)} aria-pressed={ui.canvasMode === m} className={cx("h-7 rounded-[5px] px-3 text-sm", ui.canvasMode === m ? "bg-bg-hover font-medium text-text-primary" : "text-text-secondary hover:text-text-primary")}>
                {label}
              </button>
            </Tip>
          ))}
        </nav>
      )}
      <div className="flex-1" />
      <Tip label="Import wire list (CSV/XLSX), WireViz YAML, ruleset" side="bottom">
        <button className="flex h-8 items-center gap-1.5 rounded-control px-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary" onClick={() => ui.openDialog("import")}>
          <FileInput size={15} /> Import
        </button>
      </Tip>
      <DM.Root>
        <DM.Trigger className="flex h-8 items-center gap-1.5 rounded-control px-2 text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary">
          <Download size={15} /> Export <ChevronDown size={12} />
        </DM.Trigger>
        <DM.Portal>
          <DM.Content className={menuCls} sideOffset={6} align="end">
            {EXPORTS.map((e, i) =>
              e === "-" ? (
                <DM.Separator key={i} className="my-1 h-px bg-border-subtle" />
              ) : (
                <Item key={e.id} onSelect={() => void e.run()} shortcut={e.shortcut}>
                  {e.label}
                </Item>
              ),
            )}
          </DM.Content>
        </DM.Portal>
      </DM.Root>
      <Tip label="Share links: coming soon (Phase 2)" side="bottom">
        <span>
          <button disabled className="flex h-8 items-center gap-1.5 rounded-control px-2 text-sm text-text-tertiary">
            <Share2 size={15} /> Share
          </button>
        </span>
      </Tip>
      <OrderButton />
      {currentRevision(project).frozen && (
        <Tip label="This revision is frozen (read-only). Create a new revision from the Rev menu." side="bottom">
          <CircleAlert size={16} className="text-status-warning" />
        </Tip>
      )}
    </header>
  );
}
