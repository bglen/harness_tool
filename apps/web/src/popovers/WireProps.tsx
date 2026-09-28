import { useState } from "react";
import { currentHarness, formatWireColor, setWireDefaults, setWireProps, WIRE_COLORS, type NetClass, type WireColor } from "@hs/model";
import { wireColor } from "@hs/ui-tokens";
import { dispatch, getProject, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { svc } from "../lib/services";
import { Button, cx, Floating, Section, Select, WireSwatch } from "../ui/primitives";

export function ColorPicker({ value, onChange }: { value: WireColor; onChange: (c: WireColor) => void }) {
  const theme = useUi((s) => s.resolvedTheme);
  const [slot, setSlot] = useState(0); // 0 = base, 1..3 stripes
  const codes = [value.base, ...value.stripes];
  const pick = (code: number) => {
    const next = [...codes];
    if (slot === 0) next[0] = code;
    else next[slot] = code;
    const clean = next.filter((c, i) => i === 0 || c !== undefined);
    onChange({ base: clean[0]!, stripes: clean.slice(1).filter((c) => c !== undefined) as number[] });
    if (slot < 3 && slot === codes.length - 1 + (slot === 0 ? 0 : 1)) setSlot(slot);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 text-xs">
        {["Base", "Stripe 1", "Stripe 2", "Stripe 3"].map((l, i) => (
          <button key={l} disabled={i > codes.length} onClick={() => setSlot(i)} className={cx("rounded-chip border px-1.5 py-0.5 disabled:opacity-40", slot === i ? "border-accent text-text-primary" : "border-border-subtle text-text-secondary")}>
            {l}
            {codes[i] !== undefined ? `: ${codes[i]}` : ""}
          </button>
        ))}
        {value.stripes.length > 0 && (
          <button className="ml-auto text-2xs text-text-secondary hover:text-text-primary" onClick={() => (onChange({ base: value.base, stripes: value.stripes.slice(0, -1) }), setSlot(Math.max(0, value.stripes.length - 1)))}>
            remove stripe
          </button>
        )}
      </div>
      <div className="grid grid-cols-5 gap-1">
        {WIRE_COLORS.map((c) => (
          <button key={c.code} onClick={() => pick(c.code)} className="flex items-center gap-1.5 rounded-control border border-border-subtle px-1.5 py-1 text-left text-xs hover:border-border-control" title={`${c.code} ${c.name}`}>
            <span className="h-3 w-3 rounded-sm border border-border-control" style={{ background: wireColor(c.code, theme) }} />
            <span className="mono">{c.code}</span>
            <span className="text-text-secondary">{c.abbr}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        Result: <WireSwatch color={value} />
      </div>
    </div>
  );
}

export function WirePropsPopover({ x, y, ids }: { x: number; y: number; ids: string[] }) {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const h = currentHarness(project);
  const wires = h.wires.filter((w) => ids.includes(w.id));
  const first = wires[0];
  const cat = svc().cat;
  const [spec, setSpec] = useState(first?.spec ?? project.settings.defaultWireSpec);
  const [color, setColor] = useState<WireColor>(first?.color ?? project.settings.defaultColor);
  if (!first) return null;
  const gauges = cat.gaugesFor(spec);
  const netClasses = [...new Set(wires.map((w) => h.nets.find((n) => n.id === w.netId)?.cls).filter(Boolean))] as NetClass[];
  const close = () => ui.openPopover(null);
  return (
    <Floating x={x} y={y} onClose={close} width={440} className="p-3">
      <div className="mb-2 text-sm font-semibold">
        {wires.length === 1 ? `Wire ${first.label}` : `${wires.length} wires`}{" "}
        <span className="text-xs font-normal text-text-secondary">{wires.length === 1 ? `net ${h.nets.find((n) => n.id === first.netId)?.name}` : ""}</span>
      </div>
      <div className="flex flex-col gap-3">
        <Section title="Spec & gauge">
          <Select
            ariaLabel="Wire spec"
            value={spec}
            onChange={(v) => {
              setSpec(v);
              const g = cat.wire(v, first.gauge) ? first.gauge : cat.gaugesFor(v)[0];
              dispatch(setWireProps({ ids, spec: v, gauge: g }));
            }}
            options={cat.wireSpecs().map((s) => ({ value: s, label: `${s} (${cat.bundle.wires.find((w) => w.spec === s)?.insulation})` }))}
          />
          <div className="grid grid-cols-4 gap-1">
            {gauges.map((g) => {
              const w = cat.wire(spec, g)!;
              const on = wires.every((x) => x.gauge === g && x.spec === spec);
              return (
                <button key={g} onClick={() => dispatch(setWireProps({ ids, gauge: g, spec }))} className={cx("rounded-control border px-1.5 py-1 text-left", on ? "border-accent bg-bg-hover" : "border-border-subtle hover:border-border-control")}>
                  <div className="text-sm font-medium">{g}&thinsp;AWG</div>
                  <div className="mono text-2xs text-text-tertiary">
                    ⌀{w.odMm}&thinsp;mm · {w.massGPerM}&thinsp;g/m · {w.currentA}&thinsp;A
                  </div>
                </button>
              );
            })}
          </div>
        </Section>
        <Section title="Color (MIL-STD-681)">
          <ColorPicker
            value={color}
            onChange={(c) => {
              setColor(c);
              dispatch(setWireProps({ ids, color: c }), `Color ${formatWireColor(c)}`);
            }}
          />
        </Section>
        <div className="flex flex-wrap gap-2 border-t border-border-subtle pt-2">
          {netClasses.length === 1 && (
            <Button size="sm" variant="ghost" onClick={() => dispatch(setWireDefaults({ netClass: netClasses[0], spec, gauge: first.gauge, color }))}>
              Apply to all {netClasses[0]} nets
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              dispatch(setWireDefaults({ spec, color }));
              ui.toast({ kind: "success", text: "Project default wire updated" });
            }}
          >
            Set as project default
          </Button>
          <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "unpinWireProps", payload: { ids, fields: ["spec", "gauge", "color"] } })}>
            Reset to defaults
          </Button>
        </div>
      </div>
    </Floating>
  );
}

export function getWires(ids: string[]) {
  return currentHarness(getProject()).wires.filter((w) => ids.includes(w.id));
}
