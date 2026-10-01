import { useEffect, useMemo, useRef, useState } from "react";
import { BLOCK_KINDS, BLOCK_LABELS, clampBlock, isBuiltinTemplate, newTemplateBlock, setDrawingTemplate, SHEET_SIZES, uid, type BlockKind, type DrawingTemplate, type TemplateBlock, type TemplateSheet } from "@hs/model";
import { drawingNotes, drawingTokenValues, renderDrawingPdf } from "@hs/docs";
import { ArrowDown, ArrowUp, Copy, Download, Eye, FileStack, Loader2, Plus, Redo2, Save, Trash2, Undo2, X } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { docData } from "../lib/docs";
import { exportTemplate, useTemplates } from "../lib/templates";
import { Button, cx, IconButton, Kbd } from "../ui/primitives";
import { BlockPreview, type PreviewCtx } from "./BlockPreview";
import { BlockProps, TemplateSettings } from "./TemplateProps";

export interface TemplateEditorData {
  template: DrawingTemplate;
  /** Where it was opened from: the project's own template, a library template, or a new one. */
  source: "project" | "library" | "new";
}

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type Drag = { mode: "move" | Handle; id: string; sx: number; sy: number; orig: TemplateBlock; base: DrawingTemplate; moved: boolean };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_POS: Record<Handle, [number, number]> = { nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5] };
const CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

/** Full-screen visual editor for a drawing template: drag/resize blocks on each sheet, edit their properties, preview the PDF. */
export function TemplateEditor({ data }: { data: TemplateEditorData }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const lib = useTemplates();
  const [tpl, setTpl] = useState<DrawingTemplate>(data.template);
  const [past, setPast] = useState<{ t: DrawingTemplate; label: string }[]>([]);
  const [future, setFuture] = useState<{ t: DrawingTemplate; label: string }[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [cell, setCell] = useState<string | null>(null);
  const [saved, setSaved] = useState<DrawingTemplate>(data.template);
  const [preview, setPreview] = useState<{ url: string | null; busy: boolean; err?: string } | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const tplRef = useRef(tpl);
  tplRef.current = tpl;

  const sheet = tpl.sheets[Math.min(sheetIdx, tpl.sheets.length - 1)]!;
  const block = sheet.blocks.find((b) => b.id === sel) ?? null;
  const [W, H] = SHEET_SIZES[tpl.sheetSize];
  const dirty = tpl !== saved;
  const snapPt = project.units === "in" ? 9 : (2.5 / 25.4) * 72;

  // Project data for live previews (title-block values, notes, revisions).
  const ctx: PreviewCtx = useMemo(() => {
    const d = docData(project);
    return {
      tokens: { ...drawingTokenValues(d, tpl), sheet: "1", sheets: String(tpl.sheets.length), sheetName: "" },
      notes: drawingNotes(d),
      revisions: project.revisions.map((r) => [r.label, r.notes || (!r.frozen ? "Working draft" : ""), r.frozenAt?.slice(0, 10) ?? "", r.frozen ? "Released" : "Draft"]),
      connectors: [...d.connectorRows.map((c) => `${c.refDes} — ${c.pn}`)],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, tpl.company, tpl.sheets.length]);

  useEffect(() => {
    if (!lib.loaded) void lib.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (next: DrawingTemplate, label: string, base: DrawingTemplate = tpl) => {
    setPast((p) => [...p.slice(-99), { t: base, label }]);
    setFuture([]);
    setTpl(next);
  };
  const undo = () => {
    const last = past[past.length - 1];
    if (!last) return;
    setPast(past.slice(0, -1));
    setFuture([{ t: tpl, label: last.label }, ...future]);
    setTpl(last.t);
  };
  const redo = () => {
    const nx = future[0];
    if (!nx) return;
    setFuture(future.slice(1));
    setPast([...past, { t: tpl, label: nx.label }]);
    setTpl(nx.t);
  };

  const withSheet = (fn: (s: TemplateSheet) => TemplateSheet, t: DrawingTemplate = tpl): DrawingTemplate => ({ ...t, sheets: t.sheets.map((s) => (s.id === sheet.id ? fn(s) : s)) });
  const patchBlock = (id: string, patch: Partial<TemplateBlock>, label: string) => commit(withSheet((s) => ({ ...s, blocks: s.blocks.map((b) => (b.id === id ? clampBlock({ ...b, ...patch }) : b)) })), label);
  const addBlock = (kind: BlockKind) => {
    const n = sheet.blocks.length;
    const b = newTemplateBlock(kind, uid(), { cx: 0.5 + ((n % 5) - 2) * 0.02, cy: 0.45 + ((n % 5) - 2) * 0.02 });
    commit(withSheet((s) => ({ ...s, blocks: [...s.blocks, b] })), `Add ${BLOCK_LABELS[kind]}`);
    setSel(b.id);
    setCell(null);
  };
  const deleteBlock = (id: string) => {
    commit(withSheet((s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== id) })), "Delete block");
    setSel(null);
  };
  const duplicateBlock = (id: string) => {
    const b = sheet.blocks.find((x) => x.id === id);
    if (!b) return;
    const nid = uid();
    const copy = clampBlock({ ...structuredClone(b), id: nid, x: b.x + 0.015, y: b.y + 0.015, rows: b.rows.map((r) => ({ ...r, id: uid(), cells: r.cells.map((c) => ({ ...c, id: uid() })) })) });
    commit(withSheet((s) => ({ ...s, blocks: [...s.blocks, copy] })), "Duplicate block");
    setSel(nid);
  };
  const order = (id: string, front: boolean) =>
    commit(
      withSheet((s) => {
        const b = s.blocks.find((x) => x.id === id)!;
        const rest = s.blocks.filter((x) => x.id !== id);
        return { ...s, blocks: front ? [...rest, b] : [b, ...rest] };
      }),
      front ? "Bring to front" : "Send to back",
    );

  // ─── Sheets ────────────────────────────────────────────────────────────
  const addSheet = () => {
    // A new sheet starts with this sheet's title block and logo, so every sheet carries the format.
    const keep = sheet.blocks.filter((b) => b.kind === "titleBlock" || b.kind === "logo").map((b) => ({ ...structuredClone(b), id: uid() }));
    const s: TemplateSheet = { id: uid(), name: `Sheet ${tpl.sheets.length + 1}`, blocks: keep };
    commit({ ...tpl, sheets: [...tpl.sheets, s] }, "Add sheet");
    setSheetIdx(tpl.sheets.length);
    setSel(null);
  };
  const duplicateSheet = () => {
    const s: TemplateSheet = { ...structuredClone(sheet), id: uid(), name: `${sheet.name} copy`, blocks: sheet.blocks.map((b) => ({ ...structuredClone(b), id: uid() })) };
    const sheets = [...tpl.sheets];
    sheets.splice(sheetIdx + 1, 0, s);
    commit({ ...tpl, sheets }, "Duplicate sheet");
    setSheetIdx(sheetIdx + 1);
  };
  const deleteSheet = () => {
    if (tpl.sheets.length < 2) return;
    commit({ ...tpl, sheets: tpl.sheets.filter((s) => s.id !== sheet.id) }, "Delete sheet");
    setSheetIdx(Math.max(0, sheetIdx - 1));
    setSel(null);
  };
  const moveSheet = (d: -1 | 1) => {
    const j = sheetIdx + d;
    if (j < 0 || j >= tpl.sheets.length) return;
    const sheets = [...tpl.sheets];
    [sheets[sheetIdx], sheets[j]] = [sheets[j]!, sheets[sheetIdx]!];
    commit({ ...tpl, sheets }, "Reorder sheets");
    setSheetIdx(j);
  };

  // ─── Save / use / close ────────────────────────────────────────────────
  const saveToLibrary = async () => {
    try {
      const s = await lib.save(tpl);
      setTpl(s);
      setSaved(s);
      ui.toast({ kind: "success", text: isBuiltinTemplate(tpl.id) ? `Saved as “${s.name}” in your template library (built-ins stay unchanged)` : `Saved “${s.name}” to your template library` });
    } catch (e) {
      ui.toast({ kind: "error", text: `Couldn't save template: ${(e as Error).message}` });
    }
  };
  const useInProject = () => {
    if (dispatch(setDrawingTemplate({ template: tpl }))) {
      setSaved(tpl);
      ui.toast({ kind: "success", text: `${project.name} now generates its drawing from “${tpl.name}”` });
    }
  };
  const close = () => {
    if (dirty && !window.confirm("Close the template editor? Changes that weren't saved to the library or used in the project will be lost.")) return;
    if (preview?.url) URL.revokeObjectURL(preview.url);
    ui.closeDialog("templateEditor");
  };
  const showPreview = async () => {
    setPreview({ url: null, busy: true });
    try {
      const blob = await renderDrawingPdf(docData(project), tpl);
      setPreview((old) => {
        if (old?.url) URL.revokeObjectURL(old.url);
        return { url: URL.createObjectURL(blob), busy: false };
      });
    } catch (e) {
      console.error(e);
      setPreview({ url: null, busy: false, err: (e as Error).message });
    }
  };

  // ─── Keyboard (the editor owns the keyboard while open) ─────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = !!(e.target as HTMLElement).closest?.("input,textarea,select,[contenteditable=true]");
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === "Escape") {
        e.preventDefault();
        if (preview) return setPreview(null);
        if (typing) return (e.target as HTMLElement).blur();
        if (cell) return setCell(null);
        if (sel) return setSel(null);
        return close();
      }
      if (typing) return;
      if (mod && k === "z" && !e.shiftKey) return e.preventDefault(), undo();
      if ((mod && k === "z" && e.shiftKey) || (mod && k === "y")) return e.preventDefault(), redo();
      if (!sel) return;
      if (mod && k === "d") return e.preventDefault(), duplicateBlock(sel);
      if (e.key === "Delete" || e.key === "Backspace") return e.preventDefault(), deleteBlock(sel);
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const a = arrows[e.key];
      if (a && block) {
        e.preventDefault();
        const step = e.shiftKey ? snapPt : 1;
        patchBlock(sel, { x: block.x + (a[0] * step) / W, y: block.y + (a[1] * step) / H }, "Nudge block");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ─── Sheet canvas sizing and dragging ───────────────────────────────────
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 800, h: 600 });
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const s = Math.max(0.1, Math.min((area.w - 48) / W, (area.h - 48) / H));

  const startDrag = (e: React.PointerEvent, b: TemplateBlock, mode: Drag["mode"]) => {
    e.stopPropagation();
    e.preventDefault();
    setSel(b.id);
    if (mode !== "move" || b.kind !== "titleBlock") setCell(null);
    dragRef.current = { mode, id: b.id, sx: e.clientX, sy: e.clientY, orig: b, base: tpl, moved: false };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dxPt = (e.clientX - d.sx) / s;
    const dyPt = (e.clientY - d.sy) / s;
    if (!d.moved && Math.hypot(dxPt, dyPt) * s < 3) return;
    d.moved = true;
    const snap = (pt: number) => (e.altKey ? pt : Math.round(pt / snapPt) * snapPt);
    const o = d.orig;
    let x = o.x * W;
    let y = o.y * H;
    let x2 = (o.x + o.w) * W;
    let y2 = (o.y + o.h) * H;
    if (d.mode === "move") {
      const nx = snap(x + dxPt);
      const ny = snap(y + dyPt);
      x2 += nx - x;
      y2 += ny - y;
      x = nx;
      y = ny;
    } else {
      if (d.mode.includes("w")) x = Math.min(snap(x + dxPt), x2 - 6);
      if (d.mode.includes("e")) x2 = Math.max(snap(x2 + dxPt), x + 6);
      if (d.mode.includes("n")) y = Math.min(snap(y + dyPt), y2 - 6);
      if (d.mode.includes("s")) y2 = Math.max(snap(y2 + dyPt), y + 6);
    }
    const nb = clampBlock({ ...o, x: x / W, y: y / H, w: (x2 - x) / W, h: (y2 - y) / H });
    setTpl(withSheet((sh) => ({ ...sh, blocks: sh.blocks.map((b) => (b.id === d.id ? nb : b)) }), tplRef.current));
  };
  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved) {
      setPast((p) => [...p.slice(-99), { t: d.base, label: d.mode === "move" ? "Move block" : "Resize block" }]);
      setFuture([]);
    }
  };

  const m = tpl.marginPt;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-app" role="dialog" aria-label="Drawing template editor" aria-modal="true">
      {/* toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle bg-bg-surface-1 px-3">
        <FileStack size={16} className="text-text-secondary" />
        <span className="text-sm font-semibold">Drawing template</span>
        <span className="max-w-[260px] truncate text-sm text-text-secondary">· {tpl.name}</span>
        {isBuiltinTemplate(tpl.id) && <span className="rounded-chip border border-border-subtle px-1.5 text-2xs text-text-tertiary">built-in: saving makes a copy</span>}
        {dirty && <span className="text-2xs text-status-warning">unsaved changes</span>}
        <div className="ml-2 flex items-center">
          <IconButton label={past.length ? `Undo ${past[past.length - 1]!.label}` : "Undo"} shortcut="Ctrl+Z" disabled={!past.length} onClick={undo} tipSide="bottom">
            <Undo2 size={16} />
          </IconButton>
          <IconButton label={future.length ? `Redo ${future[0]!.label}` : "Redo"} shortcut="Ctrl+Shift+Z" disabled={!future.length} onClick={redo} tipSide="bottom">
            <Redo2 size={16} />
          </IconButton>
        </div>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={showPreview}>
          <Eye size={14} /> Preview PDF
        </Button>
        <Button size="sm" variant="ghost" onClick={() => exportTemplate(tpl)}>
          <Download size={14} /> Export
        </Button>
        <Button size="sm" onClick={saveToLibrary}>
          <Save size={14} /> Save to library
        </Button>
        <Button size="sm" variant="primary" onClick={useInProject}>
          Use in this project
        </Button>
        <IconButton label="Close" shortcut="Esc" onClick={close} tipSide="bottom">
          <X size={18} />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* left: blocks + sheets */}
        <div className="scroll-thin flex w-56 shrink-0 flex-col gap-4 overflow-auto border-r border-border-subtle bg-bg-surface-1 p-3">
          <div>
            <div className="label-caps mb-1.5">Add block</div>
            <div className="flex flex-col gap-0.5">
              {BLOCK_KINDS.map((k) => (
                <button key={k} className="flex items-center gap-2 rounded-control px-2 py-1 text-left text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary" onClick={() => addBlock(k)}>
                  <Plus size={12} /> {BLOCK_LABELS[k]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center">
              <span className="label-caps">Sheets</span>
              <div className="ml-auto flex items-center gap-1 text-text-tertiary">
                <button aria-label="Move sheet up" onClick={() => moveSheet(-1)} className="hover:text-text-primary">
                  <ArrowUp size={13} />
                </button>
                <button aria-label="Move sheet down" onClick={() => moveSheet(1)} className="hover:text-text-primary">
                  <ArrowDown size={13} />
                </button>
                <button aria-label="Duplicate sheet" onClick={duplicateSheet} className="hover:text-text-primary">
                  <Copy size={13} />
                </button>
                <button aria-label="Delete sheet" disabled={tpl.sheets.length < 2} onClick={deleteSheet} className="hover:text-status-error disabled:opacity-30">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              {tpl.sheets.map((sh, i) =>
                i === sheetIdx ? (
                  <input
                    key={sh.id}
                    aria-label="Sheet name"
                    className={cx("h-7 rounded-control border border-accent bg-bg-surface-2 px-2 text-sm")}
                    defaultValue={sh.name}
                    onBlur={(e) => e.target.value.trim() && e.target.value !== sh.name && commit({ ...tpl, sheets: tpl.sheets.map((x) => (x.id === sh.id ? { ...x, name: e.target.value.trim() } : x)) }, "Rename sheet")}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <button key={sh.id} className="h-7 rounded-control px-2 text-left text-sm text-text-secondary hover:bg-bg-hover" onClick={() => (setSheetIdx(i), setSel(null), setCell(null))}>
                    {i + 1}. {sh.name}
                  </button>
                ),
              )}
              <button className="flex items-center gap-1 px-2 py-1 text-left text-xs text-accent hover:underline" onClick={addSheet}>
                <Plus size={12} /> Add sheet
              </button>
            </div>
          </div>
          <div className="mt-auto text-2xs leading-relaxed text-text-tertiary">
            Drag blocks to move, handles to resize (snaps to {project.units === "in" ? "⅛ in" : "2.5 mm"}; hold <Kbd>Alt</Kbd> for free placement). <Kbd>Del</Kbd> deletes, arrows nudge, <Kbd>Ctrl+D</Kbd> duplicates.
          </div>
        </div>
        {/* centre: the sheet */}
        <div ref={areaRef} className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-bg-canvas" onPointerDown={() => (setSel(null), setCell(null))}>
          <div
            data-testid="template-sheet"
            className="relative shadow-xl"
            style={{ width: W * s, height: H * s, background: "#fff" }}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerDown={(e) => {
              e.stopPropagation();
              setSel(null);
              setCell(null);
            }}
          >
            {m > 0 && <div className="pointer-events-none absolute" style={{ left: m * s, top: m * s, right: m * s, bottom: m * s, border: `${Math.max(1, 1.2 * s)}px solid #16181D` }} />}
            {sheet.blocks.map((b) => {
              const isSel = b.id === sel;
              return (
                <div
                  key={b.id}
                  data-block={b.kind}
                  data-id={b.id}
                  className="absolute"
                  style={{ left: b.x * W * s, top: b.y * H * s, width: b.w * W * s, height: b.h * H * s, cursor: "move", outline: isSel ? "2px solid var(--accent)" : "1px dashed rgba(11,127,146,0.35)", outlineOffset: 1 }}
                  onPointerDown={(e) => startDrag(e, b, "move")}
                  title={BLOCK_LABELS[b.kind]}
                >
                  <div className="pointer-events-auto h-full w-full overflow-hidden" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
                    <BlockPreview b={b} s={s} ctx={ctx} template={tpl} selectedCell={isSel ? cell : null} onCell={b.kind === "titleBlock" ? (id) => (setSel(b.id), setCell(id)) : undefined} />
                  </div>
                  {isSel &&
                    HANDLES.map((hd) => (
                      <div
                        key={hd}
                        data-handle={hd}
                        onPointerDown={(e) => startDrag(e, b, hd)}
                        className="absolute h-2.5 w-2.5 rounded-sm border border-white bg-accent"
                        style={{ left: `calc(${HANDLE_POS[hd][0] * 100}% - 5px)`, top: `calc(${HANDLE_POS[hd][1] * 100}% - 5px)`, cursor: CURSOR[hd] }}
                      />
                    ))}
                </div>
              );
            })}
          </div>
          <div className="pointer-events-none absolute bottom-2 left-3 text-2xs text-text-tertiary">
            {sheet.name} · {tpl.sheetSize} · {Math.round(s * 100)}%
          </div>
        </div>
        {/* right: properties */}
        <div className="scroll-thin w-80 shrink-0 overflow-auto border-l border-border-subtle bg-bg-surface-1 p-3">
          {block ? (
            <BlockProps
              key={block.id}
              b={block}
              W={W}
              H={H}
              units={project.units}
              selectedCell={cell}
              onSelectCell={setCell}
              onChange={(p, label) => patchBlock(block.id, p, label)}
              onDuplicate={() => duplicateBlock(block.id)}
              onDelete={() => deleteBlock(block.id)}
              onOrder={(front) => order(block.id, front)}
            />
          ) : (
            <TemplateSettings t={tpl} onChange={(p, label) => commit({ ...tpl, ...p }, label)} />
          )}
        </div>
      </div>
      {preview && (
        <div className="absolute inset-0 z-10 flex flex-col bg-black/50 p-6" onPointerDown={() => setPreview(null)}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-border-subtle bg-bg-surface-1" onPointerDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 text-sm">
              {preview.busy && <Loader2 size={14} className="animate-spin" />}
              <span className="text-text-secondary">{preview.busy ? "Rendering PDF…" : preview.err ? `Failed: ${preview.err}` : `Preview: ${project.partNumber} with “${tpl.name}”`}</span>
              <IconButton label="Close preview" shortcut="Esc" className="ml-auto" onClick={() => setPreview(null)}>
                <X size={16} />
              </IconButton>
            </div>
            {preview.url && <iframe title="Drawing preview" src={preview.url} className="min-h-0 flex-1 bg-white" />}
          </div>
        </div>
      )}
    </div>
  );
}
