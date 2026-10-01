import { useRef, type ReactNode } from "react";
import { BLOCK_LABELS, DRAWING_TOKENS, FLOW_KINDS, SHEET_SIZES, uid, type DrawingTemplate, type LengthUnit, type SheetSize, type TemplateBlock, type TitleCell, type TitleRow } from "@hs/model";
import { ArrowDown, ArrowUp, Copy, ImagePlus, Plus, Trash2 } from "lucide-react";
import { Button, cx, Field, inputCls, Section, Select, Toggle } from "../ui/primitives";
import { pickFile } from "../lib/files";
import { logoFromFile } from "../lib/templates";
import { useUi } from "../store/ui";

const smallInput = cx(inputCls, "h-7 px-1.5 text-xs");

/** Points ↔ the project's length unit for position fields. */
const toUnit = (pt: number, u: LengthUnit) => (u === "in" ? pt / 72 : (pt / 72) * 25.4);
const fromUnit = (v: number, u: LengthUnit) => (u === "in" ? v * 72 : (v / 25.4) * 72);

function Num({ value, onCommit, step = 0.1, min, label, decimals = 2 }: { value: number; onCommit: (v: number) => void; step?: number; min?: number; label: string; decimals?: number }) {
  return (
    <input
      key={value}
      aria-label={label}
      type="number"
      step={step}
      min={min}
      className={cx(smallInput, "mono w-full")}
      defaultValue={Number(value.toFixed(decimals))}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v !== Number(value.toFixed(decimals))) onCommit(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** "Insert token" menu that appends {token} to a field. */
function TokenMenu({ onPick }: { onPick: (token: string) => void }) {
  return (
    <select aria-label="Insert field" className={cx(smallInput, "w-[92px] shrink-0 text-text-secondary")} value="" onChange={(e) => e.target.value && onPick(`{${e.target.value}}`)}>
      <option value="">+ field…</option>
      {DRAWING_TOKENS.map((t) => (
        <option key={t.token} value={t.token}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1.5">{children}</div>;
}

export function TemplateSettings({ t, onChange }: { t: DrawingTemplate; onChange: (patch: Partial<DrawingTemplate>, label: string) => void }) {
  const ui = useUi();
  const uploadLogo = async () => {
    const f = await pickFile("image/png,image/jpeg,image/svg+xml,.png,.jpg,.jpeg,.svg");
    if (!f) return;
    try {
      onChange({ logo: await logoFromFile(f) }, "Set logo");
    } catch (e) {
      ui.toast({ kind: "error", text: (e as Error).message });
    }
  };
  return (
    <>
      <Section title="Template">
        <Field label="Name">
          <input className={inputCls} defaultValue={t.name} key={`n${t.id}${t.name}`} onBlur={(e) => e.target.value.trim() && e.target.value !== t.name && onChange({ name: e.target.value.trim() }, "Rename template")} />
        </Field>
        <Field label="Description">
          <textarea className={cx(inputCls, "h-14 py-1 text-xs")} defaultValue={t.description} key={`d${t.id}`} onBlur={(e) => e.target.value !== t.description && onChange({ description: e.target.value }, "Edit description")} />
        </Field>
        <Field label="Company" hint="Shown for {company} unless the project sets its own company name.">
          <input className={inputCls} defaultValue={t.company} key={`c${t.id}${t.company}`} onBlur={(e) => e.target.value !== t.company && onChange({ company: e.target.value }, "Set company")} />
        </Field>
      </Section>
      <Section title="Logo">
        {t.logo ? (
          <div className="flex items-center gap-2">
            <div className="flex h-16 w-28 items-center justify-center rounded-control border border-border-subtle bg-white p-1">
              <img src={t.logo.dataUrl} alt="Company logo" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="flex flex-col gap-1">
              <Button size="sm" onClick={uploadLogo}>
                <ImagePlus size={13} /> Replace
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onChange({ logo: null }, "Remove logo")}>
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={uploadLogo}>
            <ImagePlus size={14} /> Upload logo
          </Button>
        )}
        <div className="text-2xs text-text-tertiary">PNG, JPEG or SVG (SVG is converted to a high-resolution PNG). It appears in every Logo block.</div>
      </Section>
      <Section title="Sheet">
        <Field label="Size (landscape)">
          <Select value={t.sheetSize} onChange={(v) => onChange({ sheetSize: v as SheetSize }, "Change sheet size")} options={(Object.keys(SHEET_SIZES) as SheetSize[]).map((k) => ({ value: k, label: `${k} (${(SHEET_SIZES[k][0] / 72).toFixed(1)} × ${(SHEET_SIZES[k][1] / 72).toFixed(1)} in)` }))} />
        </Field>
        <Field label="Border inset (pt, 0 for no frame)">
          <Num label="Border inset" value={t.marginPt} step={1} min={0} decimals={0} onCommit={(v) => onChange({ marginPt: Math.max(0, v) }, "Change border")} />
        </Field>
        <Toggle checked={t.zones} onChange={(v) => onChange({ zones: v }, v ? "Show zones" : "Hide zones")} label="Zone letters and numbers around the border" />
      </Section>
    </>
  );
}

function CellEditor({ c, selected, onChange, onRemove, onSelect, canRemove }: { c: TitleCell; selected: boolean; onChange: (p: Partial<TitleCell>) => void; onRemove: () => void; onSelect: () => void; canRemove: boolean }) {
  const valRef = useRef<HTMLInputElement>(null);
  return (
    <div className={cx("flex flex-col gap-1 rounded-control border p-1.5", selected ? "border-accent bg-bg-hover" : "border-border-subtle")} onFocus={onSelect} data-cell-editor={c.id}>
      <Row>
        <input aria-label="Cell label" placeholder="Label" className={cx(smallInput, "flex-1")} defaultValue={c.label} key={`l${c.id}${c.label}`} onBlur={(e) => e.target.value !== c.label && onChange({ label: e.target.value })} />
        <span className="text-2xs text-text-tertiary">width</span>
        <div className="w-16 shrink-0">
          <Num label="Cell width" value={c.flex} step={0.1} min={0.1} decimals={2} onCommit={(v) => onChange({ flex: Math.max(0.1, v) })} />
        </div>
        <button aria-label="Remove cell" disabled={!canRemove} className="text-text-tertiary hover:text-status-error disabled:opacity-30" onClick={onRemove}>
          <Trash2 size={13} />
        </button>
      </Row>
      <Row>
        <input
          ref={valRef}
          aria-label="Cell value"
          placeholder="Value, e.g. {drawingNumber}"
          className={cx(smallInput, "mono flex-1")}
          defaultValue={c.value.replace(/\n/g, "\\n")}
          key={`v${c.id}${c.value}`}
          onBlur={(e) => {
            const v = e.target.value.replace(/\\n/g, "\n");
            if (v !== c.value) onChange({ value: v });
          }}
        />
        <TokenMenu onPick={(tok) => onChange({ value: c.value + tok })} />
      </Row>
      <Row>
        <span className="text-2xs text-text-tertiary">size</span>
        <div className="w-16 shrink-0">
          <Num label="Font size" value={c.size} step={0.5} min={4} decimals={1} onCommit={(v) => onChange({ size: Math.max(4, v) })} />
        </div>
        <label className="flex items-center gap-1 text-2xs">
          <input type="checkbox" checked={c.bold} onChange={(e) => onChange({ bold: e.target.checked })} /> bold
        </label>
        <label className="flex items-center gap-1 text-2xs">
          <input type="checkbox" checked={c.mono} onChange={(e) => onChange({ mono: e.target.checked })} /> mono
        </label>
      </Row>
    </div>
  );
}

function TitleBlockEditor({ b, selectedCell, onSelectCell, onRows }: { b: TemplateBlock; selectedCell: string | null; onSelectCell: (id: string | null) => void; onRows: (rows: TitleRow[], label: string) => void }) {
  const rows = b.rows;
  const setRow = (i: number, r: TitleRow, label: string) => onRows(rows.map((x, j) => (j === i ? r : x)), label);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    onRows(next, "Reorder rows");
  };
  const newCell = (): TitleCell => ({ id: uid(), label: "LABEL", value: "", flex: 1, size: 8, bold: true, mono: false });
  return (
    <Section title="Title block cells" right={<span className="text-2xs text-text-tertiary">Click a cell on the sheet to jump to it</span>}>
      <div className="text-2xs text-text-tertiary">Values can mix text and fields such as {"{drawingNumber}"}; type \n for a second line.</div>
      {rows.map((r, i) => (
        <div key={r.id} className="flex flex-col gap-1 rounded-card border border-border-subtle p-1.5">
          <Row>
            <span className="text-xs font-medium">Row {i + 1}</span>
            <span className="ml-auto text-2xs text-text-tertiary">height</span>
            <div className="w-16 shrink-0">
              <Num label="Row height" value={r.height} step={0.1} min={0.2} decimals={2} onCommit={(v) => setRow(i, { ...r, height: Math.max(0.2, v) }, "Row height")} />
            </div>
            <button aria-label="Move row up" className="text-text-tertiary hover:text-text-primary" onClick={() => move(i, -1)}>
              <ArrowUp size={13} />
            </button>
            <button aria-label="Move row down" className="text-text-tertiary hover:text-text-primary" onClick={() => move(i, 1)}>
              <ArrowDown size={13} />
            </button>
            <button aria-label="Remove row" disabled={rows.length < 2} className="text-text-tertiary hover:text-status-error disabled:opacity-30" onClick={() => onRows(rows.filter((_, j) => j !== i), "Remove row")}>
              <Trash2 size={13} />
            </button>
          </Row>
          {r.cells.map((c, ci) => (
            <CellEditor
              key={c.id}
              c={c}
              selected={selectedCell === c.id}
              onSelect={() => onSelectCell(c.id)}
              canRemove={r.cells.length > 1}
              onRemove={() => setRow(i, { ...r, cells: r.cells.filter((_, k) => k !== ci) }, "Remove cell")}
              onChange={(p) => setRow(i, { ...r, cells: r.cells.map((x, k) => (k === ci ? { ...x, ...p } : x)) }, "Edit cell")}
            />
          ))}
          <button className="self-start text-2xs text-accent hover:underline" onClick={() => setRow(i, { ...r, cells: [...r.cells, newCell()] }, "Add cell")}>
            + Add cell
          </button>
        </div>
      ))}
      <Button size="sm" onClick={() => onRows([...rows, { id: uid(), height: 1, cells: [newCell()] }], "Add row")}>
        <Plus size={13} /> Add row
      </Button>
    </Section>
  );
}

/** Properties of the selected block. Positions are shown in the project's length unit. */
export function BlockProps({
  b,
  W,
  H,
  units,
  selectedCell,
  onSelectCell,
  onChange,
  onDuplicate,
  onDelete,
  onOrder,
}: {
  b: TemplateBlock;
  W: number;
  H: number;
  units: LengthUnit;
  selectedCell: string | null;
  onSelectCell: (id: string | null) => void;
  onChange: (patch: Partial<TemplateBlock>, label: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onOrder: (front: boolean) => void;
}) {
  const u = units;
  const dec = u === "in" ? 2 : 1;
  const flow = FLOW_KINDS.includes(b.kind);
  const hasTitle = !["titleBlock", "logo", "text"].includes(b.kind);
  return (
    <>
      <Section
        title={BLOCK_LABELS[b.kind]}
        right={
          <div className="flex items-center gap-1">
            <button className="text-2xs text-text-secondary hover:text-text-primary" onClick={() => onOrder(true)}>
              Front
            </button>
            <button className="text-2xs text-text-secondary hover:text-text-primary" onClick={() => onOrder(false)}>
              Back
            </button>
            <button aria-label="Duplicate block" className="text-text-tertiary hover:text-text-primary" onClick={onDuplicate}>
              <Copy size={13} />
            </button>
            <button aria-label="Delete block" className="text-text-tertiary hover:text-status-error" onClick={onDelete}>
              <Trash2 size={13} />
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-4 gap-1.5 text-2xs text-text-tertiary">
          {(["x", "y", "w", "h"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-0.5">
              {{ x: "X", y: "Y", w: "Width", h: "Height" }[k]} ({u})
              <Num label={k} value={toUnit(b[k] * (k === "x" || k === "w" ? W : H), u)} decimals={dec} step={u === "in" ? 0.05 : 1} onCommit={(v) => onChange({ [k]: fromUnit(v, u) / (k === "x" || k === "w" ? W : H) }, "Move block")} />
            </label>
          ))}
        </div>
        {hasTitle && (
          <Field label="Heading">
            <input className={inputCls} defaultValue={b.title} key={`t${b.id}${b.title}`} onBlur={(e) => e.target.value !== b.title && onChange({ title: e.target.value }, "Edit heading")} />
          </Field>
        )}
        {b.kind === "text" && (
          <Field label="Text">
            <textarea className={cx(inputCls, "mono h-20 py-1 text-xs")} defaultValue={b.text} key={`x${b.id}${b.text}`} onBlur={(e) => e.target.value !== b.text && onChange({ text: e.target.value }, "Edit text")} />
            <div className="mt-1">
              <TokenMenu onPick={(tok) => onChange({ text: b.text + tok }, "Insert field")} />
            </div>
          </Field>
        )}
        {b.kind !== "titleBlock" && b.kind !== "logo" && !["bundleView", "schematicView"].includes(b.kind) && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Font size (pt)">
              <Num label="Font size" value={b.fontSize} step={0.5} min={4} decimals={1} onCommit={(v) => onChange({ fontSize: Math.max(4, v) }, "Font size")} />
            </Field>
            {flow && (
              <Field label="Columns">
                <Num label="Columns" value={b.columns} step={1} min={1} decimals={0} onCommit={(v) => onChange({ columns: Math.min(6, Math.max(1, Math.round(v))) }, "Columns")} />
              </Field>
            )}
            {b.kind === "text" && (
              <Field label="Align">
                <Select value={b.align} onChange={(v) => onChange({ align: v }, "Align text")} options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]} />
              </Field>
            )}
          </div>
        )}
        {b.kind === "text" && <Toggle checked={b.bold} onChange={(v) => onChange({ bold: v }, "Bold")} label="Bold" />}
        {b.kind !== "titleBlock" && <Toggle checked={b.frame} onChange={(v) => onChange({ frame: v }, "Frame")} label="Draw a border around this block" />}
        {b.kind === "bundleView" && <Toggle checked={b.showLengths} onChange={(v) => onChange({ showLengths: v }, "Length callouts")} label="Segment length callouts" />}
        {flow && <div className="text-2xs text-text-tertiary">Content that doesn't fit continues in this same box on extra pages of this sheet (marked CONT.).</div>}
      </Section>
      {b.kind === "titleBlock" && <TitleBlockEditor b={b} selectedCell={selectedCell} onSelectCell={onSelectCell} onRows={(rows, label) => onChange({ rows }, label)} />}
    </>
  );
}
