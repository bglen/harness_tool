import { useState } from "react";
import { buildUpFor, contactCmaRange, contactFill, contactPnFor, currentHarness, formatDiameter, formatLength, parseLength, setAccessory, setBackshell, setLeadEnd, setPinBuildUp, type Accessory } from "@hs/model";
import { Check, X } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { useDerived } from "../store/analysis";
import { svc } from "../lib/services";
import { Button, cx, DemoTag, Field, Floating, inputCls, Section, Select, Toggle } from "../ui/primitives";
import { FaceLegend, FaceView } from "../canvas/FaceView";

const STYLE_LABEL: Record<string, string> = { strainRelief: "Strain relief", emiBand: "EMI/RFI with band-clamp platform", shieldRing: "Shield-termination ring", pottingBoot: "Potting boot adapter" };

export function BackshellPopover({ x, y, connectorId }: { x: number; y: number; connectorId: string }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const d = useDerived();
  const c = h.connectors.find((cc) => cc.id === connectorId);
  const cat = svc().cat;
  const part = c && cat.connector(c.pn);
  if (!c || !part) return null;
  const node = h.nodes.find((n) => n.connectorId === c.id);
  const od = (node && d.nodeOdMm.get(node.id)) ?? 0;
  const opts = cat.backshellsFor(part.shellSize);
  const cur = c.backshell && cat.backshell(c.backshell.pn);
  return (
    <Floating x={x} y={y} onClose={() => ui.openPopover(null)} width={460} className="p-3">
      <div className="mb-1 text-sm font-semibold">Backshell for {c.refDes}</div>
      <div className="mb-3 text-xs text-text-secondary">
        Shell {part.shellSize} · bundle at connector {od ? formatDiameter(od, project.units) : "—"}. Options are filtered by series and shell size; the clamp range is checked against the computed bundle diameter.
      </div>
      <div className="flex flex-col gap-1">
        <button className={cx("rounded-control border px-2 py-1.5 text-left text-sm", !c.backshell ? "border-accent bg-bg-hover" : "border-border-subtle hover:border-border-control")} onClick={() => dispatch(setBackshell({ id: c.id, backshell: null }))}>
          None
        </button>
        {opts.map((b) => {
          const fits = !od || (od >= b.clampMinMm && od <= b.clampMaxMm);
          const on = cur?.pn === b.pn;
          const sup = cat.supply(b.pn);
          return (
            <button key={b.pn} onClick={() => dispatch(setBackshell({ id: c.id, backshell: { pn: b.pn, clockingDeg: c.backshell?.clockingDeg ?? 0, auto: true } }))} className={cx("flex items-center gap-2 rounded-control border px-2 py-1.5 text-left", on ? "border-accent bg-bg-hover" : "border-border-subtle hover:border-border-control")}>
              <div className="flex-1">
                <div className="text-sm">
                  {STYLE_LABEL[b.style]} · {b.angle === 0 ? "straight" : `${b.angle}°`}
                </div>
                <div className="mono text-2xs text-text-tertiary">
                  {b.pn} · clamp {formatLength(b.clampMinMm, project.units)}–{formatLength(b.clampMaxMm, project.units)}
                  {b.bandPlatform ? " · band platform" : ""}
                </div>
              </div>
              <span className={cx("flex items-center gap-1 text-2xs", fits ? "text-status-pass" : "text-status-warning")}>
                {fits ? <Check size={12} /> : <X size={12} />}
                {fits ? "fits" : "clamp range"}
              </span>
              <span className="tnum w-14 text-right text-xs">${sup?.breaks[0]!.price.toFixed(0) ?? "—"}</span>
            </button>
          );
        })}
      </div>
      {c.backshell && cur && cur.angle !== 0 && (
        <div className="mt-3">
          <Field label="Angle clocking: which way the backshell points (shown on the glyph and drawing)">
            <select className={inputCls} value={c.backshell.clockingDeg} onChange={(e) => dispatch(setBackshell({ id: c.id, backshell: { ...c.backshell!, clockingDeg: Number(e.target.value) } }))}>
              {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                <option key={a} value={a}>
                  {a}°
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <div className="mt-2 flex items-center justify-between text-2xs text-text-tertiary">
        <span>{c.backshell?.auto ? "Size follows the design (auto)" : ""}</span>
        <DemoTag />
      </div>
    </Floating>
  );
}

export function AccessoriesPopover({ x, y, connectorId }: { x: number; y: number; connectorId: string }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const c = h.connectors.find((cc) => cc.id === connectorId);
  const cat = svc().cat;
  const part = c && cat.connector(c.pn);
  if (!c || !part || part.kind === "flyingLead") return null;
  const avail = cat.accessoriesFor(part.shellSize, part.kind);
  const kinds: { kind: Accessory["kind"]; label: string }[] = [
    { kind: "dustCap", label: "Dust cap / cover" },
    ...(part.kind === "receptacle" && part.mount === "jam nut" ? [{ kind: "jamNut" as const, label: "Jam nut" }, { kind: "oRing" as const, label: "O-ring" }] : []),
    ...(part.kind === "receptacle" && part.mount !== "jam nut" ? [{ kind: "gasket" as const, label: "Flange gasket" }] : []),
    { kind: "groundingRing", label: "Grounding ring" },
  ];
  return (
    <Floating x={x} y={y} onClose={() => ui.openPopover(null)} width={380} className="p-3">
      <div className="mb-2 text-sm font-semibold">Accessories for {c.refDes}</div>
      <div className="flex flex-col gap-2">
        {kinds.map(({ kind, label }) => {
          const has = c.accessories.find((a) => a.kind === kind);
          const parts = avail.filter((a) => a.kind === kind);
          const def = parts.find((p) => kind !== "dustCap" || p.lanyard) ?? parts[0];
          return (
            <div key={kind} className="flex flex-col gap-1">
              <Toggle checked={!!has} onChange={(v) => dispatch(setAccessory({ id: c.id, kind, pn: v ? def?.pn ?? null : null }))} label={label} />
              {has && parts.length > 1 && (
                <select className={cx(inputCls, "ml-9")} value={has.pn} onChange={(e) => dispatch(setAccessory({ id: c.id, kind, pn: e.target.value }))}>
                  {parts.map((p) => (
                    <option key={p.pn} value={p.pn}>
                      {p.pn}: {p.description}
                    </option>
                  ))}
                </select>
              )}
              {has && parts.length <= 1 && <div className="mono ml-9 text-2xs text-text-tertiary">{has.pn}</div>}
            </div>
          );
        })}
        <div className="border-t border-border-subtle pt-2 text-2xs text-text-tertiary">Unused cavities get sealing plugs automatically ({part.arrangement.contactCount - Object.values(c.pins).filter((p) => p.netId).length} on this connector).</div>
      </div>
    </Floating>
  );
}

export function FacePopover({ x, y, connectorId }: { x: number; y: number; connectorId: string }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const c = h.connectors.find((cc) => cc.id === connectorId);
  const part = c && svc().cat.connector(c.pn);
  if (!c || !part) return null;
  return (
    <Floating x={x} y={y} onClose={() => ui.openPopover(null)} width={320} className="flex flex-col items-center gap-2 p-3">
      <div className="text-sm font-semibold">
        {c.refDes} · insert {part.arrangement.id} ({part.gender} face)
      </div>
      <FaceView
        arrangement={part.arrangement}
        gender={part.gender}
        connector={c}
        h={h}
        size={280}
        onCavity={(id) => {
          ui.openPopover(null);
          if (!c.showUnused && !c.pins[id]?.netId) dispatch({ type: "setConnectorProps", payload: { id: c.id, showUnused: true } });
          ui.select("pin", [`${c.id}:${id}`]);
          setTimeout(() => ui.setEditing({ connectorId: c.id, cavityId: id, col: "signal" }), 30);
        }}
      />
      <FaceLegend />
      {part.arrangement.status !== "verified" && <div className="text-center text-2xs text-status-warning">Unreviewed geometry (machine-extracted from MIL-STD-1560C). Verify before release.</div>}
      <div className="text-2xs text-text-tertiary">Click a cavity to jump to its row.</div>
      <Button size="sm" variant="ghost" onClick={() => ui.openPopover(null)}>
        Close
      </Button>
    </Floating>
  );
}

const LEAD_FINISHES = [
  { value: "tinned", label: "Stripped and tinned", short: "Tinned" },
  { value: "stripped", label: "Stripped (bare strands)", short: "Stripped" },
  { value: "ferrule", label: "Ferrule crimped", short: "Ferrule" },
  { value: "unterminated", label: "Cut only (left long, finished at installation)", short: "Cut only" },
] as const;

/**
 * Flying-lead end finishes. The end's default applies to every lead without its own setting; each lead can have its
 * own finish and strip length (one bundle of flying leads often mixes tinned, ferruled and cut-only ends).
 * Opened from selected lead rows, it shows just those leads.
 */
export function LeadEndPopover({ x, y, ids }: { x: number; y: number; ids: string[] }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const units = project.units;
  // Connector ids, or "connectorId:cavityId" keys for selected lead rows.
  const byPin = ids.some((id) => id.includes(":"));
  const cs = h.connectors.filter((c) => ids.some((id) => (byPin ? id.split(":")[0] === c.id : id === c.id)));
  if (!cs.length) return null;
  const wired = (cid: string, cav: string) => h.wires.filter((w) => [w.from, w.to].some((e) => e.kind === "pin" && e.connectorId === cid && e.cavityId === cav));
  const leads = cs.flatMap((c) =>
    Object.keys(c.pins)
      .filter((cav) => (byPin ? ids.includes(`${c.id}:${cav}`) : wired(c.id, cav).length > 0))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
      .map((cav) => ({ c, cav, wire: wired(c.id, cav)[0], net: h.nets.find((n) => n.id === c.pins[cav]?.netId)?.name ?? "", own: c.pins[cav]?.leadEnd })),
  );
  const fmt = (mm: number) => formatLength(mm, units).replace(" ", "");
  const label = (f: string) => LEAD_FINISHES.find((x) => x.value === f)?.short ?? f;
  return (
    <Floating x={x} y={y} onClose={() => useUi.getState().openPopover(null)} width={520} className="flex max-h-[70vh] flex-col gap-3 p-3">
      <div className="text-sm font-semibold">Lead ends {cs.length === 1 ? `on ${cs[0]!.refDes}` : `on ${cs.length} flying-lead ends`}</div>
      {!byPin && (
        <div className="flex items-end gap-2 rounded-control border border-border-subtle p-2">
          <Field label="Default finish (leads without their own)">
            <Select value={cs[0]!.leadEnd?.finish ?? "tinned"} onChange={(v) => dispatch(setLeadEnd({ ids: cs.map((c) => c.id), finish: v }))} options={LEAD_FINISHES.map((f) => ({ value: f.value, label: f.label }))} />
          </Field>
          <Field label="Default strip">
            <LengthInput mm={cs[0]!.leadEnd?.stripMm ?? 6} units={units} onCommit={(mm) => mm !== null && dispatch(setLeadEnd({ ids: cs.map((c) => c.id), stripMm: mm }))} />
          </Field>
        </div>
      )}
      <div className="scroll-thin min-h-0 overflow-auto rounded-control border border-border-subtle">
        <table className="w-full text-xs">
          <thead className="bg-bg-surface-2 text-left text-2xs text-text-tertiary">
            <tr>
              <th className="px-2 py-1">Lead</th>
              <th className="px-2 py-1">Signal / wire</th>
              <th className="px-2 py-1">Finish</th>
              <th className="px-2 py-1">Strip</th>
            </tr>
          </thead>
          <tbody>
            {leads.map(({ c, cav, wire, net, own }) => {
              const pin = [{ connectorId: c.id, cavityId: cav }];
              const def = c.leadEnd ?? { finish: "tinned" as const, stripMm: 6 };
              return (
                <tr key={`${c.id}:${cav}`} className="border-t border-border-subtle">
                  <td className="mono px-2 py-1">
                    {c.refDes}-{cav}
                  </td>
                  <td className="mono truncate px-2 py-1 text-text-secondary">{[net, wire?.label].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="px-2 py-1">
                    <Select
                      value={own?.finish ?? ""}
                      onChange={(v) => dispatch(v ? setLeadEnd({ pins: pin, finish: v as LeadFinish }) : setLeadEnd({ pins: pin, clear: true }))}
                      options={[{ value: "", label: `Default (${label(def.finish)})` }, ...LEAD_FINISHES.map((f) => ({ value: f.value, label: f.short }))]}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <LengthInput mm={own?.stripMm} placeholder={fmt(def.stripMm)} units={units} onCommit={(mm) => dispatch(mm === null ? setLeadEnd({ pins: pin, clear: true }) : setLeadEnd({ pins: pin, stripMm: mm }))} />
                  </td>
                </tr>
              );
            })}
            {!leads.length && (
              <tr>
                <td colSpan={4} className="px-2 py-2 text-text-tertiary">
                  No wired leads yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-2xs text-text-tertiary">Strip length is added to each wire's cut length past the bundle end. Change the number of leads with Part; lead length is the bundle length to this end.</div>
    </Floating>
  );
}

type LeadFinish = (typeof LEAD_FINISHES)[number]["value"];

/** Length field in project units; blank (when allowed) commits null. */
function LengthInput({ mm, units, onCommit, placeholder }: { mm?: number; units: "mm" | "in"; onCommit: (mm: number | null) => void; placeholder?: string }) {
  const [v, setV] = useState(mm === undefined ? "" : formatLength(mm, units).replace(" ", ""));
  const commit = () => {
    if (!v.trim()) return placeholder !== undefined && mm !== undefined && onCommit(null);
    const n = parseLength(v, units);
    if (n !== null && n >= 0) onCommit(n);
  };
  return <input className={cx(inputCls, "mono h-7 w-24 text-xs")} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

/** CMA build-up in a contact: filler strands crimped in with the wire(s) to reach the contact's minimum circular mil area. */
export function PinBuildUpPopover({ x, y, pinKey }: { x: number; y: number; pinKey: string }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const [connectorId, cavityId] = pinKey.split(":") as [string, string];
  const c = h.connectors.find((q) => q.id === connectorId);
  if (!c) return null;
  const cat = svc().cat;
  const f = contactFill(h, connectorId, cavityId);
  const range = contactCmaRange(cat, contactPnFor(h, cat, connectorId, cavityId, Math.max(...f.wires.map((w) => w.gauge), 22)));
  const need = range ? buildUpFor({ ...f, buildUp: null, cma: f.wireCma }, range.min) : null;
  const bu = c.pins[cavityId]?.buildUp;
  const set = (b: { gauge: number; count: number } | null) => dispatch(setPinBuildUp({ connectorId, cavityId, buildUp: b }));
  const fmt = (n: number) => n.toLocaleString("en-US");
  const out = range && (f.cma < range.min || f.cma > range.max);
  return (
    <Floating x={x} y={y} onClose={() => useUi.getState().openPopover(null)} width={320} className="flex flex-col gap-2 p-3">
      <div className="text-sm font-semibold">
        CMA build-up at {c.refDes}-{cavityId}
      </div>
      <div className="text-xs text-text-secondary">
        {f.wires.map((w) => `${w.label} (${w.gauge} AWG)`).join(", ")}: <span className={cx("mono", out ? "text-status-error" : "text-text-primary")}>{fmt(f.cma)} CMA</span>
        {range ? ` · contact takes ${fmt(range.min)}–${fmt(range.max)}` : " · contact range unknown"}
      </div>
      {bu ? (
        <div className="flex items-center gap-2 text-xs">
          <input type="number" min={1} max={9} aria-label="Build-up strands" className={cx(inputCls, "mono h-7 w-14")} value={bu.count} onChange={(e) => set({ gauge: bu.gauge, count: Math.max(1, Number(e.target.value) || 1) })} />
          <span>strands of</span>
          <Select value={String(bu.gauge)} onChange={(v) => set({ gauge: Number(v), count: bu.count })} options={[16, 18, 20, 22, 24, 26, 28].map((g) => ({ value: String(g), label: `${g} AWG` }))} />
          <button className="ml-auto text-accent hover:underline" onClick={() => set(null)}>
            remove
          </button>
        </div>
      ) : (
        <Button size="sm" onClick={() => set(need ?? { gauge: Math.max(...f.wires.map((w) => w.gauge), 22), count: 1 })}>
          {need ? `Add ${need.count}× ${need.gauge} AWG build-up` : "Add build-up"}
        </Button>
      )}
      <div className="text-2xs text-text-tertiary">Recorded on the drawing notes, the BOM (filler wire) and the operations list.</div>
    </Floating>
  );
}
