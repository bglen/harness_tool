import { useState } from "react";
import {
  addBoot,
  addLabel,
  connectConnectors,
  connectPins,
  createCable,
  currentHarness,
  formatLength,
  parseLength,
  removeBoots,
  removeCable,
  removeLabels,
  removeShields,
  renameNet,
  resolveLabelTemplate,
  setConnectorProps,
  setLabelRules,
  setNetProps,
  effectiveTopology,
  joinKind,
  parallelPairs,
  setSegmentProps,
  setShieldProps,
  setSpliceProps,
  buildUpFor,
  spliceFills,
  setTermination,
  setWireProps,
  shieldWires,
  uid,
  updateLabel,
  type Label,
  type NetClass,
  type ShieldPreset,
  type Termination,
} from "@hs/model";
import { cablePn } from "@hs/ops";
import { X } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { svc } from "../lib/services";
import { Button, cx, Field, Floating, IconButton, inputCls, Section, Select, Toggle } from "../ui/primitives";

const close = () => useUi.getState().openPopover(null);

const LABEL_FIELDS = ["{refDes}", "{wireId}", "{harnessPN}", "{rev}", "{serial}", "{net}", "{pedigreeMarking}"];

/**
 * Add a label to the selected connectors / wires / bundles, or (with `labelId`) edit an existing one: template,
 * type and position (distance from the end it's measured from), plus the project's one-click labeling rules.
 */
export function LabelPopover({ x, y, kind, ids, labelId }: { x: number; y: number; kind?: string; ids?: string[]; labelId?: string }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const existing = labelId ? h.labels.find((l) => l.id === labelId) : undefined;
  const target = existing ? existing.attachedTo.kind : kind === "wire" ? "wire" : kind === "segment" ? "segment" : "connector";
  const targetId = existing ? existing.attachedTo.id : ids?.[0];
  const [tpl, setTpl] = useState(existing?.template ?? (target === "wire" ? "{wireId}" : target === "connector" ? "{refDes}" : "{harnessPN}-{rev}"));
  const [type, setType] = useState<Label["type"]>(existing?.type ?? "sleeve");
  const [dist, setDist] = useState(formatLength(existing?.distanceMm ?? project.settings.defaultLabelDistanceMm, project.units).replace(" ", ""));
  if (labelId && !existing) return null;
  const rules = h.labelRules;
  const rev = project.revisions.find((r) => r.id === project.currentRevisionId)!;
  const preview = resolveLabelTemplate(tpl, { refDes: h.connectors.find((c) => c.id === targetId)?.refDes, wireId: h.wires.find((w) => w.id === targetId)?.label, harnessPN: project.partNumber, rev: rev.label });
  const lp = existing?.pn ? svc().cat.label(existing.pn) : undefined;
  const onName = target === "connector" ? h.connectors.find((c) => c.id === targetId)?.refDes : target === "wire" ? h.wires.find((w) => w.id === targetId)?.label : "bundle";
  const save = () => {
    const mm = parseLength(dist, project.units);
    if (mm === null || mm < 0) return useUi.getState().toast({ kind: "error", text: "Enter a distance like 2in or 50mm" });
    if (existing) dispatch(updateLabel({ id: existing.id, template: tpl, type, distanceMm: mm }));
    else dispatch((ids ?? []).map((id) => addLabel({ id: uid(), attachedTo: { kind: target, id }, template: tpl, type, distanceMm: mm })));
    close();
  };
  return (
    <Floating x={x} y={y} onClose={close} width={400} className="flex flex-col gap-3 p-3">
      <div className="text-sm font-semibold">
        {existing ? `Label on ${onName ?? target}` : `Add label to ${(ids?.length ?? 0) > 1 ? `${ids!.length} ${target}s` : target}`}
        {existing?.auto && <span className="ml-1 text-xs font-normal text-text-tertiary">(auto: editing pins it)</span>}
      </div>
      <Field label="Template">
        <input autoFocus={!!existing} className={cx(inputCls, "mono")} value={tpl} onChange={(e) => setTpl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
      </Field>
      <div className="flex flex-wrap gap-1">
        {LABEL_FIELDS.map((f) => (
          <button key={f} className="mono rounded-chip border border-border-subtle px-1 text-2xs text-text-secondary hover:border-border-control" onClick={() => setTpl((t) => t + f)}>
            {f}
          </button>
        ))}
      </div>
      <div className="text-xs text-text-secondary">
        Preview: <span className="mono text-text-primary">{preview}</span>
      </div>
      <div className="flex gap-2">
        <Field label="Type">
          <Select<Label["type"]> value={type} onChange={setType} options={[{ value: "sleeve", label: "Heat-shrink sleeve" }, { value: "flag", label: "Flag" }, { value: "wrap", label: "Wrap-around" }, { value: "direct", label: "Direct marking" }]} />
        </Field>
        <Field label="Distance from end">
          <input className={cx(inputCls, "mono w-24")} value={dist} onChange={(e) => setDist(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        </Field>
      </div>
      {existing && (
        <div className="mono -mt-1 text-2xs text-text-tertiary">
          {existing.pn || "part number assigned automatically"} {lp ? `· prints ${formatLength(lp.printableLengthMm, project.units)}` : ""} · or drag the label along the bundle
        </div>
      )}
      <div className="flex justify-between">
        {existing ? (
          <Button size="sm" variant="danger" onClick={() => (dispatch(removeLabels({ ids: [existing.id] })), close())}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" size="sm" onClick={save}>
          {existing ? "Save" : "Add label"}
        </Button>
      </div>
      <Section title="Labeling rules (one click)">
        <Toggle checked={rules.connectorRefDes} onChange={(v) => dispatch(setLabelRules({ connectorRefDes: v }))} label="Every connector end labeled with its refDes" />
        <Toggle checked={rules.wireIds} onChange={(v) => dispatch(setLabelRules({ wireIds: v }))} label="Every wire labeled with its ID at both ends" />
        <Toggle checked={rules.harnessId} onChange={(v) => dispatch(setLabelRules({ harnessId: v }))} label="Harness ID label near P1" />
        <Toggle checked={rules.pedigreeMarkings} onChange={(v) => dispatch(setLabelRules({ pedigreeMarkings: v }))} label="Pedigree markings (e.g. NOT FOR FLIGHT)" />
      </Section>
    </Floating>
  );
}

export function NoteEditPopover({ x, y, id }: { x: number; y: number; id: string }) {
  const project = useProject((s) => s.project)!;
  const n = currentHarness(project).notes.find((q) => q.id === id);
  const [text, setText] = useState(n?.text ?? "");
  if (!n) return null;
  return (
    <Floating x={x} y={y} onClose={() => (dispatch({ type: "updateNote", payload: { id, text } }), close())} width={320} className="flex flex-col gap-2 p-3">
      <textarea autoFocus rows={4} className={cx(inputCls, "h-auto py-1")} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="flex justify-between">
        <Button size="sm" variant="danger" onClick={() => (dispatch({ type: "deleteNotes", payload: { ids: [id] } }), close())}>
          Delete
        </Button>
        <Button size="sm" variant="primary" onClick={() => (dispatch({ type: "updateNote", payload: { id, text } }), close())}>
          Save
        </Button>
      </div>
    </Floating>
  );
}

export function NetPopover({ x, y, ids }: { x: number; y: number; ids: string[] }) {
  const project = useProject((s) => s.project)!;
  const nets = currentHarness(project).nets.filter((n) => ids.includes(n.id));
  const n = nets[0];
  const [name, setName] = useState(n?.name ?? "");
  const [cur, setCur] = useState(n?.currentA != null ? String(n.currentA) : "");
  if (!n) return null;
  return (
    <Floating x={x} y={y} onClose={close} width={320} className="flex flex-col gap-3 p-3">
      <div className="text-sm font-semibold">{nets.length > 1 ? `${nets.length} nets` : `Net ${n.name}`}</div>
      {nets.length === 1 && (
        <Field label="Name (typing an existing name merges the nets)">
          <input autoFocus className={cx(inputCls, "mono")} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && dispatch(renameNet({ id: n.id, name }))} onBlur={() => name !== n.name && dispatch(renameNet({ id: n.id, name }))} />
        </Field>
      )}
      <Field label="Class">
        <div className="flex flex-wrap gap-1">
          {(["signal", "power", "ground", "rf", "spare"] as NetClass[]).map((c) => (
            <button key={c} onClick={() => dispatch(setNetProps({ ids, cls: c }))} className={cx("rounded-chip border px-2 py-0.5 text-xs", nets.every((x) => x.cls === c) ? "border-accent text-text-primary" : "border-border-subtle text-text-secondary")}>
              {c}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Current (A), for derating checks">
        <input className={cx(inputCls, "mono w-28")} value={cur} placeholder="—" onChange={(e) => setCur(e.target.value)} onBlur={() => dispatch(setNetProps({ ids, currentA: cur.trim() ? Number(cur) : null }))} />
      </Field>
      {nets.some((x) => x.members.length >= 3) && (
        <Field label="Construction (3+ pins)">
          <div className="flex flex-wrap gap-1">
            {(["parallel", "splice", "daisy"] as const).map((t) => {
              const ok = t !== "parallel" || nets.every((x) => x.members.length < 3 || parallelPairs(x));
              return (
                <button
                  key={t}
                  disabled={!ok}
                  title={t === "parallel" ? (ok ? "One wire per pin, pin-to-pin between the two connectors (no splice, no double crimp)" : "Needs the pins on exactly two connectors with the same count on each") : t === "splice" ? "All pins wired to a splice" : "Chained pin to pin: two wires crimped in intermediate contacts"}
                  onClick={() => dispatch(setNetProps({ ids, topology: t }))}
                  className={cx("rounded-chip border px-2 py-0.5 text-xs disabled:opacity-40", nets.every((x) => effectiveTopology(x) === t) ? "border-accent text-text-primary" : "border-border-subtle text-text-secondary")}
                >
                  {t === "daisy" ? "Daisy chain" : t === "splice" ? "Splice (star)" : "Parallel wires"}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      <div className="text-2xs text-text-tertiary">
        {n.members.length} pins ·{" "}
        {effectiveTopology(n) === "wired"
          ? `wired as you drew it (${n.members.length} pins)${joinKind(n) === "doubleCrimp" ? ": a pin carries two wires, so it's crimped by hand" : ""}`
          : n.members.length < 3
          ? "point-to-point"
          : effectiveTopology(n) === "parallel"
            ? `parallel: ${n.members.length / 2} wires pin-to-pin${!n.topologyConfirmed ? " (automatic: pins split evenly across two connectors)" : ""}`
            : effectiveTopology(n) === "splice"
              ? "splice: manual operation"
              : `daisy chain${n.topologyConfirmed ? "" : " (assumed, not confirmed)"}: double crimps are a manual operation`}
      </div>
    </Floating>
  );
}

const PRESETS: { id: ShieldPreset; label: string; hint: string }[] = [
  { id: "both360", label: "Both ends 360°", hint: "Band clamp or EMI ring at each backshell" },
  { id: "groundAtFirst", label: "Ground at one end only", hint: "360° at the first connector, floating at the other" },
  { id: "drainToPin", label: "Drain to pin", hint: "Drain wire to a ground pin at the first end" },
  { id: "floating", label: "Floating", hint: "Folded back and insulated at both ends" },
];

export function ShieldPopover({ x, y, ids }: { x: number; y: number; ids: string[] }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const shieldIds = [...new Set(h.wires.filter((w) => ids.includes(w.id)).map((w) => w.shieldId).filter(Boolean))] as string[];
  const shield = shieldIds.length === 1 ? h.shields.find((s) => s.id === shieldIds[0]) : undefined;
  const [drain, setDrain] = useState(shield?.drainWire ?? false);
  const terms = shield ? h.terminations.filter((t) => t.targetId === shield.id) : [];
  return (
    <Floating x={x} y={y} onClose={close} width={380} className="flex flex-col gap-3 p-3">
      <div className="text-sm font-semibold">{shield ? `Shield ${shield.label}` : `Shield ${ids.length} wire${ids.length > 1 ? "s" : ""}`}</div>
      {!shield && <Toggle checked={drain} onChange={setDrain} label="Include drain wire" />}
      <Section title={shield ? "Apply preset" : "Choose termination"}>
        <div className="flex flex-col gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className="rounded-control border border-border-subtle px-2 py-1.5 text-left hover:border-border-control"
              onClick={() => {
                if (shield) dispatch(setShieldProps({ id: shield.id, preset: p.id }));
                else {
                  dispatch(shieldWires({ ids, shieldId: uid(), drainWire: drain, preset: p.id }));
                  close();
                }
              }}
            >
              <div className="text-sm">{p.label}</div>
              <div className="text-2xs text-text-tertiary">{p.hint}</div>
            </button>
          ))}
        </div>
      </Section>
      {shield && (
        <>
          <Section title="Termination at each end">
            {terms.map((t) => (
              <TermRow key={t.id} t={t} />
            ))}
          </Section>
          <div className="flex items-center gap-2">
            <Field label="Coverage">
              <Select value={shield.coverage} onChange={(v) => dispatch(setShieldProps({ id: shield.id, coverage: v }))} options={[70, 80, 85, 90, 95].map((c) => ({ value: c, label: `${c}%` }))} />
            </Field>
            <Field label="Material">
              <Select value={shield.material} onChange={(v) => dispatch(setShieldProps({ id: shield.id, material: v }))} options={["tinned copper", "silver-plated copper", "nickel-plated copper"].map((m) => ({ value: m, label: m }))} />
            </Field>
          </div>
          <Button size="sm" variant="danger" onClick={() => (dispatch(removeShields({ ids: [shield.id] })), close())}>
            Remove shield
          </Button>
        </>
      )}
    </Floating>
  );
}

const METHOD_LABEL: Record<Termination["method"], string> = { band360: "360° band clamp", emiRing: "360° EMI ring", drainToPin: "Drain to pin", floating: "Floating (insulated)", foldBack: "Folded back", junction: "Braid junction" };

export function TermRow({ t }: { t: Termination }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const node = h.nodes.find((n) => n.id === t.nodeId);
  const conn = node?.connectorId ? h.connectors.find((c) => c.id === node.connectorId) : undefined;
  const part = conn && svc().cat.connector(conn.pn);
  const free = part ? part.arrangement.cavities.filter((c) => !c.special && !conn!.pins[c.id]?.netId) : [];
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 truncate">{conn ? conn.refDes : "Breakout"}</span>
      <select
        className={cx(inputCls, "h-7 flex-1 text-xs")}
        value={t.method}
        onChange={(e) => {
          const m = e.target.value as Termination["method"];
          if (m === "drainToPin" && conn) {
            const cav = t.drainPin?.cavityId ?? free[free.length - 1]?.id;
            dispatch(setTermination({ id: t.id, method: m, drainPin: cav ? { connectorId: conn.id, cavityId: cav } : undefined, groundNetName: "SHIELD_GND" }));
          } else dispatch(setTermination({ id: t.id, method: m }));
        }}
      >
        {(conn ? ["band360", "emiRing", "drainToPin", "floating", "foldBack"] : ["junction", "foldBack", "floating"]).map((m) => (
          <option key={m} value={m}>
            {METHOD_LABEL[m as Termination["method"]]}
          </option>
        ))}
      </select>
      {t.method === "drainToPin" && conn && (
        <select className={cx(inputCls, "mono h-7 w-20 text-xs")} value={t.drainPin?.cavityId ?? ""} onChange={(e) => dispatch(setTermination({ id: t.id, method: "drainToPin", drainPin: { connectorId: conn.id, cavityId: e.target.value }, groundNetName: "SHIELD_GND" }))}>
          {[...(t.drainPin ? [{ id: t.drainPin.cavityId }] : []), ...free].map((c) => (
            <option key={c.id} value={c.id}>
              pin {c.id}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function TerminationsPopover({ x, y, id }: { x: number; y: number; id: string }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const nodeId = h.nodes.find((n) => n.id === id || n.connectorId === id)?.id;
  const terms = h.terminations.filter((t) => t.nodeId === nodeId);
  return (
    <Floating x={x} y={y} onClose={close} width={380} className="flex flex-col gap-2 p-3">
      <div className="text-sm font-semibold">Shield &amp; braid terminations here</div>
      {terms.map((t) => (
        <div key={t.id}>
          <div className="text-2xs text-text-tertiary">{h.shields.find((s) => s.id === t.targetId) ? `Shield ${h.shields.find((s) => s.id === t.targetId)!.label}` : "Overbraid"}</div>
          <TermRow t={t} />
        </div>
      ))}
      {!terms.length && <div className="text-xs text-text-tertiary">No shields or braids end here.</div>}
    </Floating>
  );
}

export function CablePopover({ x, y, ids }: { x: number; y: number; ids: string[] }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const cat = svc().cat;
  const existing = h.cables.find((c) => ids.every((id) => c.wireIds.includes(id)));
  const [code, setCode] = useState(cat.bundle.cableWireCodes[0]!.wireCode);
  const [gauge, setGauge] = useState(h.wires.find((w) => w.id === ids[0])?.gauge ?? 22);
  const [shield, setShield] = useState("T");
  const [jacket, setJacket] = useState("23");
  const gauges = cat.bundle.cableWireCodes.find((c) => c.wireCode === code)?.gauges ?? [];
  const pn = cablePn({ gauge, wireCode: code, count: ids.length, shield, jacket });
  if (existing)
    return (
      <Floating x={x} y={y} onClose={close} width={340} className="flex flex-col gap-2 p-3">
        <div className="text-sm font-semibold">Cable {existing.label}</div>
        <div className="mono text-xs">{cablePn(existing)}</div>
        <Field label="Jacket strip-back">
          <input className={cx(inputCls, "mono")} defaultValue={formatLength(existing.stripJacketMm, project.units).replace(" ", "")} onBlur={(e) => dispatch({ type: "setCableProps", payload: { id: existing.id, stripJacketMm: parseLength(e.target.value, project.units) ?? existing.stripJacketMm } })} />
        </Field>
        <Field label="Shield strip-back">
          <input className={cx(inputCls, "mono")} defaultValue={formatLength(existing.stripShieldMm, project.units).replace(" ", "")} onBlur={(e) => dispatch({ type: "setCableProps", payload: { id: existing.id, stripShieldMm: parseLength(e.target.value, project.units) ?? existing.stripShieldMm } })} />
        </Field>
        <Button size="sm" variant="danger" onClick={() => (dispatch(removeCable({ id: existing.id })), close())}>
          Break cable into wires
        </Button>
      </Floating>
    );
  return (
    <Floating x={x} y={y} onClose={close} width={380} className="flex flex-col gap-2 p-3">
      <div className="text-sm font-semibold">Make M27500 cable from {ids.length} conductor{ids.length > 1 ? "s" : ""}</div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Conductor (wire code)">
          <Select value={code} onChange={setCode} options={cat.bundle.cableWireCodes.map((c) => ({ value: c.wireCode, label: `${c.wireCode}: ${c.spec}` }))} />
        </Field>
        <Field label="Gauge">
          <Select value={gauge} onChange={setGauge} options={gauges.map((g) => ({ value: g, label: `${g} AWG` }))} />
        </Field>
        <Field label="Shield">
          <Select value={shield} onChange={setShield} options={cat.bundle.cableShields.map((s) => ({ value: s.code, label: `${s.code}: ${s.material}` }))} />
        </Field>
        <Field label="Jacket">
          <Select value={jacket} onChange={setJacket} options={cat.bundle.cableJackets.map((j) => ({ value: j.code, label: `${j.code}: ${j.material}` }))} />
        </Field>
      </div>
      <div className="text-xs text-text-secondary">
        Part number: <span className="mono text-text-primary">{pn}</span>
      </div>
      <Button
        variant="primary"
        size="sm"
        onClick={() => {
          dispatch(createCable({ id: uid(), wireIds: ids, wireCode: code, gauge, shield, jacket }));
          close();
        }}
      >
        Create cable
      </Button>
      <div className="text-2xs text-text-tertiary">Conductors get standard M27500 colors; the shield is terminated like an individual shield.</div>
    </Floating>
  );
}

/**
 * Splice editor: part (auto-selected from the wires' circular mil area, or chosen), barrels, type and cover, and the
 * CMA in each barrel against the part's window, with build-up to bring a light barrel up to the minimum.
 */
export function SplicePopover({ x, y, id }: { x: number; y: number; id: string }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const s = h.splices.find((q) => q.id === id);
  if (!s) return null;
  const cat = svc().cat;
  const part = cat.splice(s.pn);
  const fills = spliceFills(h, s);
  const fitting = cat.splicesFitting(null, fills.map((f) => f.cma), fills.map((f) => f.wires.length));
  const options = [...new Map([...fitting, ...cat.bundle.splices].map((p) => [p.pn, p])).values()];
  const fmt = (n: number) => n.toLocaleString("en-US");
  const setBuildUp = (barrel: number, b: { gauge: number; count: number } | null) => dispatch(setSpliceProps({ id, buildUp: [...s.buildUp.filter((x) => x.barrel !== barrel), ...(b ? [{ barrel, ...b }] : [])] }));
  return (
    <Floating x={x} y={y} onClose={close} width={380} className="flex flex-col gap-2 p-3">
      <div className="text-sm font-semibold">
        Splice {s.label} <span className="text-xs font-normal text-text-secondary">{s.barrels === 1 ? "single-ended" : `${s.barrels} barrels`}</span>
      </div>
      <Field label="Part" hint={s.pinned ? "Chosen by you." : "Picked automatically: the smallest part of this type whose CMA window fits every barrel."}>
        <Select
          value={s.pinned ? s.pn : ""}
          onChange={(v) => dispatch(setSpliceProps({ id, pn: v }))}
          options={[{ value: "", label: `Automatic${!s.pinned && s.pn ? ` (${s.pn})` : ""}` }, ...options.map((p) => ({ value: p.pn, label: `${p.pn}: ${p.barrels === 1 ? "single-ended" : `${p.barrels} barrels`}, ${fmt(p.cmaMin)}–${fmt(p.cmaMax)} CMA${fitting.includes(p) ? "" : " (doesn't fit)"}` }))]}
        />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Barrels">
          <Select value={String(s.barrels)} onChange={(v) => dispatch(setSpliceProps({ id, barrels: Number(v), pn: s.pinned ? "" : undefined }))} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: n === 1 ? "1 (single-ended)" : n === 2 ? "2 (butt)" : String(n) }))} />
        </Field>
        <Field label="Type">
          <Select value={s.type} onChange={(v) => dispatch(setSpliceProps({ id, type: v, pn: s.pinned ? "" : undefined }))} options={[{ value: "crimp", label: "Crimp" }, { value: "solderSleeve", label: "Solder sleeve" }, { value: "ultrasonic", label: "Ultrasonic" }]} />
        </Field>
        <Field label="Cover">
          <Select value={s.cover} onChange={(v) => dispatch(setSpliceProps({ id, cover: v }))} options={[{ value: "heatShrink", label: "Heat shrink" }, { value: "potting", label: "Potting" }]} />
        </Field>
      </div>
      <Section title="Circular mil area by barrel">
        {fills.map((f, i) => {
          const lo = part && f.cma < part.cmaMin;
          const hi = part && f.cma > part.cmaMax;
          const bu = s.buildUp.find((b) => b.barrel === i);
          const need = part ? buildUpFor(f, part.cmaMin) : null;
          return (
            <div key={i} className="flex flex-col gap-1 border-b border-border-subtle pb-1.5 text-xs last:border-0">
              <div className="flex items-center gap-2">
                <span className="w-16 font-medium">{s.barrels === 1 ? "Barrel" : `Barrel ${i + 1}`}</span>
                <span className="mono flex-1 text-text-secondary">{f.wires.map((w) => `${w.label} (${w.gauge})`).join(", ") || "no wires"}</span>
                <span className={cx("mono tnum", lo || hi ? "text-status-error" : "text-text-primary")}>{fmt(f.cma)}</span>
              </div>
              {part && (
                <div className={cx("text-2xs", lo || hi ? "text-status-error" : "text-text-tertiary")}>
                  {lo ? `Below the ${fmt(part.cmaMin)} CMA minimum` : hi ? `Above the ${fmt(part.cmaMax)} CMA maximum: use a larger part` : `Within ${fmt(part.cmaMin)}–${fmt(part.cmaMax)} CMA`}
                  {bu ? ` · includes ${bu.count}× ${bu.gauge} AWG build-up` : ""}
                </div>
              )}
              <div className="flex items-center gap-2 text-2xs">
                {bu ? (
                  <>
                    <span className="text-text-secondary">Build-up</span>
                    <input type="number" min={1} max={9} aria-label="Build-up strands" className={cx(inputCls, "mono h-6 w-12 text-2xs")} value={bu.count} onChange={(e) => setBuildUp(i, { gauge: bu.gauge, count: Math.max(1, Number(e.target.value) || 1) })} />
                    <span>×</span>
                    <Select value={String(bu.gauge)} onChange={(v) => setBuildUp(i, { gauge: Number(v), count: bu.count })} options={[16, 18, 20, 22, 24, 26, 28].map((g) => ({ value: String(g), label: `${g} AWG` }))} />
                    <button className="text-accent hover:underline" onClick={() => setBuildUp(i, null)}>
                      remove
                    </button>
                  </>
                ) : (
                  f.wires.length > 0 && (
                    <button className="text-accent hover:underline" onClick={() => setBuildUp(i, need ?? { gauge: Math.max(...f.wires.map((w) => w.gauge)), count: 1 })}>
                      {need ? `Add build-up (${need.count}× ${need.gauge} AWG)` : "Add CMA build-up"}
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </Section>
      <div className="text-2xs text-text-tertiary">Build-up is listed on the drawing, the BOM (filler wire) and the operations. Splices are manual operations on this machine profile.</div>
    </Floating>
  );
}

export function BootPopover({ x, y, id }: { x: number; y: number; id: string }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const node = h.nodes.find((n) => n.id === id || n.connectorId === id);
  if (!node) return null;
  const boot = h.boots.find((b) => b.nodeId === node.id);
  const shapes = node.kind === "connector" ? (["straight", "90"] as const) : (["Y", "T", "multi"] as const);
  return (
    <Floating x={x} y={y} onClose={close} width={300} className="flex flex-col gap-2 p-3">
      <div className="text-sm font-semibold">{node.kind === "connector" ? "Backshell boot" : "Breakout transition"}</div>
      <div className="flex flex-wrap gap-1">
        {shapes.map((s) => (
          <Button key={s} size="sm" variant={boot?.shape === s ? "primary" : "secondary"} onClick={() => dispatch(addBoot({ id: uid(), nodeId: node.id, shape: s }))}>
            {s === "90" ? "90°" : s === "multi" ? "Multi-leg" : s}
          </Button>
        ))}
      </div>
      {boot && (
        <>
          <div className="mono text-2xs text-text-tertiary">
            {boot.pn || "no size fits"} {boot.auto ? "(auto-sized)" : ""}
          </div>
          <Button size="sm" variant="danger" onClick={() => (dispatch(removeBoots({ ids: [boot.id] })), close())}>
            Remove
          </Button>
        </>
      )}
    </Floating>
  );
}

/** Connector dropped onto connector: Connect by signal name / Pin-for-pin / Map manually (§5.4). */
export function MatePopover({ x, y, a, b }: { x: number; y: number; a: string; b: string }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const ca = h.connectors.find((c) => c.id === a)!;
  const cb = h.connectors.find((c) => c.id === b)!;
  const [manual, setManual] = useState(false);
  const cat = svc().cat;
  const pa = cat.connector(ca.pn);
  const pb = cat.connector(cb.pn);
  const [map, setMap] = useState<Record<string, string>>({});
  if (!ca || !cb) return null;
  const aPins = pa?.arrangement.cavities.filter((c) => ca.pins[c.id]?.netId) ?? [];
  return (
    <Floating x={x} y={y} onClose={close} width={manual ? 420 : 300} className="flex flex-col gap-1 p-2">
      <div className="px-1 pb-1 text-sm font-semibold">
        Connect {ca.refDes} → {cb.refDes}
      </div>
      {!manual ? (
        <>
          <button className="rounded-control px-2 py-1.5 text-left hover:bg-bg-hover" onClick={() => (dispatch(connectConnectors({ a, b, mode: "byName" })), close())}>
            <div className="text-sm">Connect by signal name</div>
            <div className="text-2xs text-text-tertiary">Each named signal on {ca.refDes} lands on the same pin (or the first free compatible pin) of {cb.refDes}</div>
          </button>
          <button className="rounded-control px-2 py-1.5 text-left hover:bg-bg-hover" onClick={() => (dispatch(connectConnectors({ a, b, mode: "pinForPin" })), close())}>
            <div className="text-sm">Pin-for-pin (1→1)</div>
            <div className="text-2xs text-text-tertiary">Extension cable / adapter: A→A, B→B…</div>
          </button>
          <button className="rounded-control px-2 py-1.5 text-left hover:bg-bg-hover" onClick={() => setManual(true)}>
            <div className="text-sm">Map manually…</div>
          </button>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="scroll-thin max-h-72 overflow-auto">
            {aPins.map((c) => (
              <div key={c.id} className="flex items-center gap-2 px-1 py-0.5 text-xs">
                <span className="mono w-10">{c.id}</span>
                <span className="mono w-32 truncate">{h.nets.find((n) => n.id === ca.pins[c.id]!.netId)?.name}</span>
                →
                <select className={cx(inputCls, "mono h-7 flex-1 text-xs")} value={map[c.id] ?? ""} onChange={(e) => setMap({ ...map, [c.id]: e.target.value })}>
                  <option value="">—</option>
                  {pb?.arrangement.cavities
                    .filter((x) => !x.special)
                    .map((x) => (
                      <option key={x.id} value={x.id} disabled={!!cb.pins[x.id]?.netId}>
                        {cb.refDes}-{x.id}
                      </option>
                    ))}
                </select>
              </div>
            ))}
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              const pairs = Object.entries(map)
                .filter(([, v]) => v)
                .map(([k, v]) => ({ a: { connectorId: a, cavityId: k }, b: { connectorId: b, cavityId: v } }));
              if (pairs.length) dispatch(connectPins({ pairs }));
              close();
            }}
          >
            Connect {Object.values(map).filter(Boolean).length}
          </Button>
        </div>
      )}
      <div className="px-1 pt-1 text-2xs text-text-tertiary">The connector was not moved.</div>
    </Floating>
  );
}

/** "More…": compact property sheet for everything else (§5.4). */
export function PropertySheet({ x, y, kind, ids }: { x: number; y: number; kind: string; ids: string[] }) {
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const u = project.units;
  const id = ids[0]!;
  let body: JSX.Element | null = null;
  if (kind === "connector") {
    const c = h.connectors.find((q) => q.id === id);
    if (!c) return null;
    const part = svc().cat.connector(c.pn);
    body = (
      <>
        <Field label="RefDes">
          <input className={cx(inputCls, "mono")} defaultValue={c.refDes} onBlur={(e) => e.target.value !== c.refDes && dispatch(setConnectorProps({ id, refDes: e.target.value }))} />
        </Field>
        <Field label="Description / function">
          <input className={inputCls} defaultValue={c.description} onBlur={(e) => dispatch(setConnectorProps({ id, description: e.target.value }))} />
        </Field>
        <Field label="Clocking (key orientation, for the drawing)">
          <input className={cx(inputCls, "mono")} defaultValue={c.clocking} onBlur={(e) => dispatch(setConnectorProps({ id, clocking: e.target.value }))} />
        </Field>
        <Toggle checked={c.showUnused} onChange={(v) => dispatch(setConnectorProps({ id, showUnused: v }))} label="Show unused cavities" />
        {part && (
          <div className="rounded-control border border-border-subtle p-2 text-2xs text-text-secondary">
            <div className="mono text-text-primary">{part.pn}</div>
            {part.description}
            <div>
              Mass {part.massG}&thinsp;g · fixture {part.fixtureId} · {part.lifecycle}
            </div>
            <div>Source: {part.arrangement.source}</div>
          </div>
        )}
      </>
    );
  } else if (kind === "wire") {
    const w = h.wires.find((q) => q.id === id);
    if (!w) return null;
    body = (
      <>
        <div className="text-xs">
          <span className="mono">{w.label}</span> · {w.spec} {w.gauge}&thinsp;AWG
        </div>
        <Field label="Extra length (service loop for this wire)">
          <input className={cx(inputCls, "mono")} defaultValue={formatLength(w.extraLengthMm, u).replace(" ", "")} onBlur={(e) => dispatch(setWireProps({ ids: [id], extraLengthMm: parseLength(e.target.value, u) ?? 0 }))} />
        </Field>
        <div className="text-2xs text-text-tertiary">Pinned fields (not changed by defaults): {w.pinned.join(", ") || "none"}</div>
      </>
    );
  } else if (kind === "segment") {
    const s = h.segments.find((q) => q.id === id);
    if (!s) return null;
    body = (
      <>
        <Field label="Label">
          <input className={inputCls} defaultValue={s.label} onBlur={(e) => dispatch(setSegmentProps({ ids: [id], label: e.target.value }))} />
        </Field>
        <Field label="Length">
          <input className={cx(inputCls, "mono")} defaultValue={formatLength(s.lengthMm, u).replace(" ", "")} onBlur={(e) => (parseLength(e.target.value, u) ?? 0) > 0 && dispatch(setSegmentProps({ ids: [id], lengthMm: parseLength(e.target.value, u)! }))} />
        </Field>
        <Field label="Tolerance ±">
          <input className={cx(inputCls, "mono")} defaultValue={formatLength(s.toleranceMm, u).replace(" ", "")} onBlur={(e) => dispatch(setSegmentProps({ ids: [id], toleranceMm: parseLength(e.target.value, u) ?? s.toleranceMm }))} />
        </Field>
      </>
    );
  } else if (kind === "net") return <NetPopover x={x} y={y} ids={ids} />;
  else if (kind === "splice") return <SplicePopover x={x} y={y} id={id} />;
  else if (kind === "node") return <TerminationsPopover x={x} y={y} id={id} />;
  return (
    <Floating x={x} y={y} onClose={close} width={320} className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Properties</div>
        <IconButton label="Close" onClick={close}>
          <X size={14} />
        </IconButton>
      </div>
      {body}
    </Floating>
  );
}
