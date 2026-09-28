import { useState } from "react";
import {
  addHardware,
  addLayer,
  currentHarness,
  extentCoverage,
  formatDiameter,
  formatLength,
  layerTypeName,
  parseLength,
  reattachSegment,
  removeHardware,
  removeLayers,
  reorderLayers,
  setLayerExtent,
  setSegmentProps,
  uid,
  updateLayer,
  type Layer,
} from "@hs/model";
import { ArrowDown, ArrowUp, Pin, Trash2 } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { useDerived } from "../store/analysis";
import { svc } from "../lib/services";
import { Button, cx, Field, Floating, IconButton, inputCls, Section } from "../ui/primitives";

const PALETTE: { type: Layer["type"]; material: string; label: string }[] = [
  { type: "tape", material: "PTFE", label: "PTFE tape" },
  { type: "tape", material: "Polyimide (Kapton)", label: "Kapton tape" },
  { type: "tape", material: "Fiberglass", label: "Fiberglass tape" },
  { type: "tape", material: "Self-fusing silicone", label: "Silicone self-fusing" },
  { type: "sleeve", material: "PET", label: "PET braided sleeve" },
  { type: "sleeve", material: "Nomex", label: "Nomex sleeve" },
  { type: "sleeve", material: "Fiberglass", label: "Fiberglass sleeve" },
  { type: "overbraid", material: "Tinned copper", label: "Overbraid, tinned Cu" },
  { type: "overbraid", material: "Nickel-plated copper", label: "Overbraid, Ni-plated Cu" },
  { type: "overbraid", material: "Stainless steel", label: "Overbraid, stainless" },
  { type: "overbraid", material: "Metal-clad fiber (lightweight)", label: "Overbraid, metal-clad fiber" },
  { type: "heatShrink", material: "Polyolefin", label: "Heat shrink, polyolefin" },
  { type: "heatShrink", material: "PVDF (Kynar)", label: "Heat shrink, Kynar" },
  { type: "jacket", material: "Fluoroelastomer (Viton)", label: "Heat-shrink jacket, Viton" },
  { type: "conduit", material: "Nylon", label: "Convoluted conduit" },
];

/** Layer stack editor: inside → out with OD after each layer, add from palette, reorder, extents (§6.6). */
export function CoveringPopover({ x, y, segmentIds }: { x: number; y: number; segmentIds: string[] }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const d = useDerived();
  const cat = svc().cat;
  const segs = h.segments.filter((s) => segmentIds.includes(s.id));
  const seg = segs[0];
  if (!seg) return null;
  const stack = d.segStack.get(seg.id) ?? [];
  const core = d.segCoreOdMm.get(seg.id) ?? 0;
  const u = project.units;
  const multi = segs.length > 1;
  return (
    <Floating x={x} y={y} onClose={() => ui.openPopover(null)} width={520} className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Covering {multi ? `(${segs.length} segments)` : ""}</div>
        <div className="text-xs text-text-secondary">{multi ? "Layers added apply to every selected segment, merged through breakouts" : `${formatLength(seg.lengthMm, u)} · ${d.segWires.get(seg.id)?.length ?? 0} wires`}</div>
      </div>
      <Section title="Stack, inside → out">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 rounded-control border border-border-subtle px-2 py-1 text-xs">
            <StackIcon n={0} />
            <span className="flex-1">Wires ({d.segWires.get(seg.id)?.length ?? 0})</span>
            <span className="mono text-text-secondary">{formatDiameter(core, u)}</span>
          </div>
          {stack.map((la, i) => {
            const e = la.layer.extents.find((x) => x.segmentId === seg.id)!;
            const [s0, s1] = extentCoverage(seg, e);
            const part = cat.layer(e.pn ?? la.layer.pn);
            return (
              <div key={la.layer.id} className="flex flex-col gap-1 rounded-control border border-border-subtle px-2 py-1">
                <div className="flex items-center gap-2 text-xs">
                  <StackIcon n={i + 1} />
                  <div className="flex-1">
                    <div>
                      {part?.description ?? layerTypeName(la.layer.type)}
                      {la.layer.auto && !la.layer.pinned && <span className="ml-1 text-2xs text-text-tertiary">(auto size)</span>}
                    </div>
                    <div className="mono text-2xs text-text-tertiary">
                      {e.pn ?? la.layer.pn} · +{(la.thicknessMm * 2).toFixed(2)}&thinsp;mm
                      {la.layer.type === "overbraid" && ` · ${la.layer.params.coveragePct ?? 85}% coverage`}
                      {la.layer.type === "tape" && ` · ${la.layer.params.overlapPct ?? 50}% overlap`}
                    </div>
                  </div>
                  <span className="mono text-text-secondary">{formatDiameter(la.odAfterMm, u)}</span>
                  <IconButton label="Move inward" disabled={i === 0} onClick={() => dispatch(reorderLayers({ orderedIds: swap(stack.map((s) => s.layer.id), i, i - 1) }))}>
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton label="Move outward" disabled={i === stack.length - 1} onClick={() => dispatch(reorderLayers({ orderedIds: swap(stack.map((s) => s.layer.id), i, i + 1) }))}>
                    <ArrowDown size={14} />
                  </IconButton>
                  <IconButton label={la.layer.pinned ? "Unpin (auto-size)" : "Pinned parts are not resized automatically"} active={la.layer.pinned} onClick={() => dispatch(updateLayer({ id: la.layer.id, pinned: !la.layer.pinned }))}>
                    <Pin size={14} />
                  </IconButton>
                  <IconButton label="Remove from this segment" onClick={() => dispatch(removeLayers({ ids: [la.layer.id], segmentId: multi ? undefined : seg.id }))}>
                    <Trash2 size={14} />
                  </IconButton>
                </div>
                <div className="flex items-center gap-2 pl-6 text-2xs text-text-secondary">
                  Extent
                  <LenInput value={s0} units={u} onCommit={(mm) => dispatch(setLayerExtent({ id: la.layer.id, segmentId: seg.id, startMm: mm, endMm: e.endMm }))} />
                  to
                  <LenInput value={s1} units={u} onCommit={(mm) => dispatch(setLayerExtent({ id: la.layer.id, segmentId: seg.id, startMm: e.startMm, endMm: mm }))} />
                  from node A
                  {la.layer.type === "overbraid" && (
                    <select className={cx(inputCls, "h-6 text-2xs")} value={la.layer.params.coveragePct ?? 85} onChange={(ev) => dispatch(updateLayer({ id: la.layer.id, params: { coveragePct: Number(ev.target.value) } }))}>
                      {[80, 85, 90, 95].map((c) => (
                        <option key={c} value={c}>
                          {c}% coverage
                        </option>
                      ))}
                    </select>
                  )}
                  {la.layer.type === "tape" && (
                    <select className={cx(inputCls, "h-6 text-2xs")} value={la.layer.params.overlapPct ?? 50} onChange={(ev) => dispatch(updateLayer({ id: la.layer.id, params: { overlapPct: Number(ev.target.value) } }))}>
                      {[25, 50, 66].map((c) => (
                        <option key={c} value={c}>
                          {c}% overlap
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      <Section title="Add layer">
        <div className="grid grid-cols-3 gap-1">
          {PALETTE.map((p) => (
            <button key={p.label} onClick={() => dispatch(addLayer({ id: uid(), segmentIds, type: p.type, material: p.material }))} className="rounded-control border border-border-subtle px-2 py-1 text-left text-xs hover:border-border-control">
              {p.label}
            </button>
          ))}
        </div>
      </Section>
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => (ui.openPopover(null), ui.openDialog("finish", { segmentIds }))}>
          Finishing presets…
        </Button>
      </div>
    </Floating>
  );
}

function swap(a: string[], i: number, j: number) {
  const b = [...a];
  [b[i], b[j]] = [b[j]!, b[i]!];
  return b;
}

function StackIcon({ n }: { n: number }) {
  return (
    <svg width={16} height={16} aria-hidden>
      {Array.from({ length: n + 1 }, (_, i) => (
        <circle key={i} cx={8} cy={8} r={2 + i * 1.6} fill="none" stroke={i === n ? "var(--accent)" : "var(--text-tertiary)"} strokeWidth={i === n ? 1.4 : 0.8} />
      ))}
    </svg>
  );
}

function LenInput({ value, units, onCommit }: { value: number; units: "mm" | "in"; onCommit: (mm: number) => void }) {
  const [v, setV] = useState<string | null>(null);
  return (
    <input
      className={cx(inputCls, "mono h-6 w-20 px-1 text-2xs")}
      value={v ?? formatLength(value, units).replace(" ", "")}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v != null) {
          const mm = parseLength(v, units);
          if (mm != null) onCommit(mm);
          setV(null);
        }
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

export function SegmentLengthPopover({ x, y, segmentId }: { x: number; y: number; segmentId: string }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const s = currentHarness(project).segments.find((q) => q.id === segmentId);
  const [len, setLen] = useState(s ? formatLength(s.lengthMm, project.units).replace(" ", "") : "");
  const [tol, setTol] = useState(s ? formatLength(s.toleranceMm, project.units).replace(" ", "") : "");
  const [label, setLabel] = useState(s?.label ?? "");
  if (!s) return null;
  const apply = () => {
    const mm = parseLength(len, project.units);
    const t = parseLength(tol, project.units);
    if (!mm || mm <= 0) return ui.toast({ kind: "error", text: "Enter a length like 12in, 300mm or 1.2m" });
    dispatch(setSegmentProps({ ids: [s.id], lengthMm: mm, toleranceMm: t ?? s.toleranceMm, label }));
    ui.openPopover(null);
  };
  return (
    <Floating x={x} y={y} onClose={() => ui.openPopover(null)} width={300} className="flex flex-col gap-2 p-3">
      <div className="text-sm font-semibold">Segment</div>
      <Field label="Length (accepts 12in, 300mm, 1.2m)">
        <input autoFocus className={cx(inputCls, "mono")} value={len} onChange={(e) => setLen(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
      </Field>
      <Field label="Tolerance ±">
        <input className={cx(inputCls, "mono")} value={tol} onChange={(e) => setTol(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
      </Field>
      <Field label="Label">
        <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} />
      </Field>
      <div className="text-2xs text-text-tertiary">
        Length is {s.lengthSource === "confirmed" ? "confirmed" : s.lengthSource === "estimated" ? "estimated (imported/derived)" : "a default placeholder"}.{" "}
        {s.lengthSource !== "confirmed" && (
          <button className="text-accent hover:underline" onClick={() => dispatch(setSegmentProps({ ids: [s.id], lengthSource: "confirmed" }))}>
            Confirm as is
          </button>
        )}
      </div>
      <Button variant="primary" size="sm" onClick={apply}>
        Apply
      </Button>
      <SegmentEnds segmentId={s.id} />
    </Floating>
  );
}

/** Keyboard-accessible branch editing: choose what each end of a bundle attaches to (same as dragging its end handle). */
function SegmentEnds({ segmentId }: { segmentId: string }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const s = h.segments.find((x) => x.id === segmentId);
  if (!s) return null;
  const nodeName = (id: string) => {
    const n = h.nodes.find((x) => x.id === id);
    if (!n) return "?";
    return n.kind === "connector" ? h.connectors.find((c) => c.id === n.connectorId)?.refDes ?? "?" : `Breakout B${h.nodes.filter((x) => x.kind === "breakout").indexOf(n) + 1}`;
  };
  const options = h.nodes.map((n) => ({ id: n.id, name: nodeName(n.id) })).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return (
    <Section title="Bundle ends">
      {(["a", "b"] as const).map((end) => (
        <label key={end} className="flex items-center justify-between gap-2 text-xs">
          <span className="text-text-secondary">End {end.toUpperCase()}</span>
          <select
            className={cx(inputCls, "h-7 flex-1 text-xs")}
            value={s[end]}
            onChange={(e) => dispatch(reattachSegment({ segmentId: s.id, end, toNodeId: e.target.value }), "Re-attach bundle")}
            aria-label={`Bundle end ${end.toUpperCase()} attaches to`}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id} disabled={o.id === (end === "a" ? s.b : s.a)}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="text-2xs text-text-tertiary">Re-attaching changes topology only; the length stays {formatLength(s.lengthMm, project.units)}.</div>
    </Section>
  );
}

export function TieDownsPopover({ x, y, segmentId }: { x: number; y: number; segmentId: string }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const d = useDerived();
  const s = h.segments.find((q) => q.id === segmentId);
  const [pos, setPos] = useState(s ? formatLength(s.lengthMm / 2, project.units).replace(" ", "") : "");
  if (!s) return null;
  const hw = h.hardware.filter((x) => x.segmentId === s.id);
  const od = d.segOuterOdMm.get(s.id) ?? 5;
  const clamp = svc().cat.hardwareFor("cushionClamp", od);
  return (
    <Floating x={x} y={y} onClose={() => ui.openPopover(null)} width={360} className="flex flex-col gap-3 p-3">
      <div className="text-sm font-semibold">Tie-downs &amp; support</div>
      <Field label="Spot-tie / lacing spacing (counted as a manual operation)">
        <select className={inputCls} value={s.tieSpacingMm ?? 0} onChange={(e) => dispatch(setSegmentProps({ ids: [s.id], tieSpacingMm: Number(e.target.value) || null }))}>
          <option value={0}>None</option>
          {[100, 150, 200, 300].map((v) => (
            <option key={v} value={v}>
              Every {formatLength(v, project.units)}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end gap-2">
        <Field label="Cushion clamp at (from node A)">
          <input className={cx(inputCls, "mono w-28")} value={pos} onChange={(e) => setPos(e.target.value)} />
        </Field>
        <Button
          size="sm"
          onClick={() => {
            const mm = parseLength(pos, project.units);
            if (mm == null) return;
            dispatch(addHardware({ id: uid(), segmentId: s.id, positionMm: Math.min(s.lengthMm, mm), type: "cushionClamp", pn: clamp?.pn ?? "" }));
          }}
        >
          Add {clamp?.pn ?? "clamp"}
        </Button>
      </div>
      {hw.length > 0 && (
        <div className="flex flex-col gap-1">
          {hw.map((x) => (
            <div key={x.id} className="flex items-center justify-between text-xs">
              <span>
                <span className="mono">{x.pn || x.type}</span> at {formatLength(x.positionMm, project.units)}
              </span>
              <label className="flex items-center gap-1 text-2xs text-text-secondary">
                <input type="checkbox" checked={x.inBom} onChange={(e) => dispatch({ type: "updateHardware", payload: { id: x.id, inBom: e.target.checked } })} /> in BOM
              </label>
              <IconButton label="Remove" onClick={() => dispatch(removeHardware({ ids: [x.id] }))}>
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
      <div className="text-2xs text-text-tertiary">Clamps are customer-installed: shown on the drawing, optional in the BOM.</div>
    </Floating>
  );
}
