import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { currentRevision, effectiveTopology, formatLength, formatWireColor, parseWireColor, renameNet, setNetProps, setWireProps, wireEndLabel, type Harness, type Wire } from "@hs/model";
import { ChevronDown, ChevronUp, Columns3, GripHorizontal, Search } from "lucide-react";
import { dispatch, useProject } from "../store/project";
import { storage, useUi } from "../store/ui";
import { useDerived } from "../store/analysis";
import { svc } from "../lib/services";
import { zoomToObjects } from "../lib/viewport";
import { cx, inputCls, WireSwatch } from "../ui/primitives";

type Col = { key: string; label: string; w: number; get: (w: Wire, h: Harness) => string | number; edit?: "net" | "gauge" | "spec" | "color" };

const endLabel = (h: Harness, e: Wire["from"]) => wireEndLabel(h, e);

export function WireListDrawer() {
  const ui = useUi();
  const project = useProject((s) => s.project)!;
  const h = currentRevision(project).harness;
  const d = useDerived();
  const height = ui.drawerHeight;
  const open = height > 40;
  const dragRef = useRef<{ y: number; h: number } | null>(null);
  const tab = ui.drawerTab;
  return (
    <section className="flex shrink-0 flex-col border-t border-border-subtle bg-bg-surface-1" style={{ height }} aria-label="Wire list">
      <div
        className="flex h-9 shrink-0 cursor-row-resize items-center gap-3 border-b border-border-subtle px-3"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button,input,select")) return;
          (e.target as Element).setPointerCapture(e.pointerId);
          dragRef.current = { y: e.clientY, h: height };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          ui.setDrawer(Math.max(36, Math.min(window.innerHeight * 0.75, dragRef.current.h - (e.clientY - dragRef.current.y))));
        }}
        onPointerUp={() => (dragRef.current = null)}
        onDoubleClick={() => ui.setDrawer(open ? 36 : 300)}
      >
        <GripHorizontal size={14} className="text-text-tertiary" />
        <button className="flex items-center gap-1 text-sm font-medium" onClick={() => ui.setDrawer(open ? 36 : 300)} aria-expanded={open}>
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />} Wire list
        </button>
        {(["wires", "nets", "connectors"] as const).map((t) => (
          <button key={t} onClick={() => ui.setDrawer(open ? height : 300, t)} className={cx("rounded-chip px-2 py-0.5 text-xs", tab === t && open ? "bg-bg-hover text-text-primary" : "text-text-secondary hover:text-text-primary")}>
            {t === "wires" ? `Wires (${h.wires.length})` : t === "nets" ? `Nets (${h.nets.length})` : `Connectors (${h.connectors.length})`}
          </button>
        ))}
        <span className="ml-auto text-2xs text-text-tertiary">Paste rows from Excel to import · <kbd className="mono">L</kbd> toggles</span>
      </div>
      {open && tab === "wires" && <WiresTable h={h} lengths={d.wireLengthMm} units={project.units} />}
      {open && tab === "nets" && <NetsTable h={h} />}
      {open && tab === "connectors" && <ConnectorsTable h={h} />}
    </section>
  );
}

function WiresTable({ h, lengths, units }: { h: Harness; lengths: Map<string, number>; units: "mm" | "in" }) {
  const ui = useUi();
  const cat = svc().cat;
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "id", dir: 1 });
  const [group, setGroup] = useState<"none" | "connector" | "net">("none");
  const [hidden, setHidden] = useState<string[]>(() => storage.get("wlHidden", []));
  const [colMenu, setColMenu] = useState(false);
  const cols: Col[] = useMemo(
    () => [
      { key: "id", label: "Wire ID", w: 70, get: (w) => w.label },
      { key: "net", label: "Net", w: 150, get: (w, hh) => hh.nets.find((n) => n.id === w.netId)?.name ?? "", edit: "net" },
      { key: "from", label: "From", w: 90, get: (w, hh) => endLabel(hh, w.from) },
      { key: "to", label: "To", w: 90, get: (w, hh) => endLabel(hh, w.to) },
      { key: "gauge", label: "Gauge", w: 70, get: (w) => w.gauge, edit: "gauge" },
      { key: "spec", label: "Spec", w: 100, get: (w) => w.spec, edit: "spec" },
      { key: "color", label: "Color", w: 150, get: (w) => formatWireColor(w.color), edit: "color" },
      { key: "length", label: `Length (${units})`, w: 90, get: (w) => lengths.get(w.id) ?? 0 },
      { key: "twist", label: "Twist", w: 60, get: (w, hh) => (w.twistGroupId ? `TW${hh.twistGroups.findIndex((g) => g.id === w.twistGroupId) + 1}` : "") },
      { key: "shield", label: "Shield", w: 60, get: (w, hh) => (w.shieldId ? hh.shields.find((s) => s.id === w.shieldId)?.label ?? "" : "") },
      { key: "label", label: "Label", w: 90, get: (w, hh) => hh.labels.filter((l) => l.attachedTo.kind === "wire" && l.attachedTo.id === w.id).length || "" },
    ],
    [lengths, units],
  );
  const visible = cols.filter((c) => !hidden.includes(c.key));
  const rows = useMemo(() => {
    const f = filter.toLowerCase();
    let ws = h.wires.filter((w) => !f || cols.some((c) => String(c.get(w, h)).toLowerCase().includes(f)));
    const col = cols.find((c) => c.key === sort.key)!;
    ws = [...ws].sort((a, b) => {
      const x = col.get(a, h);
      const y = col.get(b, h);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * sort.dir;
    });
    if (group === "none") return ws.map((w) => ({ kind: "row" as const, w }));
    const key = (w: Wire) => (group === "net" ? h.nets.find((n) => n.id === w.netId)?.name ?? "" : endLabel(h, w.from).split("-")[0]!);
    const groups = new Map<string, Wire[]>();
    for (const w of ws) (groups.get(key(w)) ?? groups.set(key(w), []).get(key(w))!).push(w);
    return [...groups].sort((a, b) => a[0].localeCompare(b[0], "en", { numeric: true })).flatMap(([g, list]) => [{ kind: "group" as const, label: `${g} (${list.length})` }, ...list.map((w) => ({ kind: "row" as const, w }))]);
  }, [h, filter, sort, group, cols]);
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => 28, overscan: 12 });
  const sel = ui.selection.kind === "wire" ? new Set(ui.selection.ids) : new Set<string>();
  // Canvas → table cross-probing: scroll selected wire into view
  useEffect(() => {
    if (ui.selection.kind !== "wire" || !ui.selection.ids.length) return;
    const i = rows.findIndex((r) => r.kind === "row" && r.w.id === ui.selection.ids[0]);
    if (i >= 0) v.scrollToIndex(i, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.selection]);
  const width = visible.reduce((a, c) => a + c.w, 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col" onPaste={(e) => {
      const t = e.clipboardData.getData("text");
      if (t.includes("\t") && t.includes("\n") && !(e.target as HTMLElement).closest("input")) {
        e.preventDefault();
        ui.openDialog("import", { text: t });
      }
    }}>
      <div className="flex items-center gap-2 px-3 py-1">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-2 text-text-tertiary" />
          <input className={cx(inputCls, "h-7 w-56 pl-6 text-xs")} placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter wires" />
        </div>
        <label className="flex items-center gap-1 text-xs text-text-secondary">
          Group
          <select className={cx(inputCls, "h-7 text-xs")} value={group} onChange={(e) => setGroup(e.target.value as typeof group)}>
            <option value="none">None</option>
            <option value="connector">By connector</option>
            <option value="net">By net</option>
          </select>
        </label>
        <div className="relative">
          <button className="flex h-7 items-center gap-1 rounded-control px-2 text-xs text-text-secondary hover:bg-bg-hover" onClick={() => setColMenu(!colMenu)}>
            <Columns3 size={13} /> Columns
          </button>
          {colMenu && (
            <div className="absolute left-0 top-8 z-30 w-44 rounded-card border border-border-subtle bg-bg-surface-2 p-2 shadow-xl">
              {cols.map((c) => (
                <label key={c.key} className="flex items-center gap-2 py-0.5 text-xs">
                  <input
                    type="checkbox"
                    checked={!hidden.includes(c.key)}
                    onChange={(e) => {
                      const next = e.target.checked ? hidden.filter((k) => k !== c.key) : [...hidden, c.key];
                      setHidden(next);
                      storage.set("wlHidden", next);
                    }}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <span className="text-2xs text-text-tertiary">{rows.filter((r) => r.kind === "row").length} rows</span>
      </div>
      <div ref={parent} className="scroll-thin min-h-0 flex-1 overflow-auto" role="grid" aria-rowcount={rows.length}>
        <div style={{ width: Math.max(width, 100) + "px", minWidth: "100%" }}>
          <div className="sticky top-0 z-10 flex border-b border-border-subtle bg-bg-surface-2 text-2xs font-medium uppercase tracking-wide text-text-tertiary" role="row">
            {visible.map((c) => (
              <button key={c.key} role="columnheader" style={{ width: c.w }} className="shrink-0 px-2 py-1 text-left hover:text-text-primary" onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? (-sort.dir as 1 | -1) : 1 })} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                {c.label} {sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : ""}
              </button>
            ))}
          </div>
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((vi) => {
              const r = rows[vi.index]!;
              if (r.kind === "group")
                return (
                  <div key={vi.key} className="absolute left-0 right-0 flex items-center bg-bg-app px-2 text-xs font-medium text-text-secondary" style={{ top: vi.start, height: 28 }}>
                    {r.label}
                  </div>
                );
              const w = r.w;
              return (
                <div
                  key={vi.key}
                  role="row"
                  aria-selected={sel.has(w.id)}
                  className={cx("absolute left-0 flex items-center border-b border-border-subtle text-xs hover:bg-bg-hover", sel.has(w.id) && "bg-bg-hover")}
                  style={{ top: vi.start, height: 28, width: "100%" }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("input,select")) return;
                    ui.select("wire", [w.id], e.shiftKey || e.ctrlKey || e.metaKey);
                    zoomToObjects([w.id]);
                  }}
                >
                  {visible.map((c) => (
                    <div key={c.key} role="gridcell" style={{ width: c.w }} className="shrink-0 truncate px-2">
                      <Cell c={c} w={w} h={h} units={units} length={lengths.get(w.id) ?? 0} gauges={cat.gaugesFor(w.spec)} specs={cat.wireSpecs()} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Cell({ c, w, h, units, length, gauges, specs }: { c: Col; w: Wire; h: Harness; units: "mm" | "in"; length: number; gauges: number[]; specs: string[] }) {
  const [edit, setEdit] = useState(false);
  if (c.key === "length") return <span className="tnum mono">{formatLength(length, units, { unit: false })}</span>;
  if (c.key === "color" && !edit)
    return (
      <span onDoubleClick={() => setEdit(true)} title="Double-click to edit">
        <WireSwatch color={w.color} />
      </span>
    );
  if (!c.edit || !edit) {
    const v = c.get(w, h);
    return (
      <span className={cx(["id", "net", "from", "to", "spec"].includes(c.key) && "mono")} onDoubleClick={() => c.edit && setEdit(true)} title={c.edit ? "Double-click to edit" : undefined}>
        {v}
      </span>
    );
  }
  if (c.edit === "gauge")
    return (
      <select autoFocus className="h-6 w-full rounded-chip border border-accent bg-bg-surface-1 text-xs" defaultValue={w.gauge} onBlur={() => setEdit(false)} onChange={(e) => (dispatch(setWireProps({ ids: [w.id], gauge: Number(e.target.value) })), setEdit(false))}>
        {gauges.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    );
  if (c.edit === "spec")
    return (
      <select autoFocus className="h-6 w-full rounded-chip border border-accent bg-bg-surface-1 text-xs" defaultValue={w.spec} onBlur={() => setEdit(false)} onChange={(e) => (dispatch(setWireProps({ ids: [w.id], spec: e.target.value })), setEdit(false))}>
        {specs.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    );
  return (
    <input
      autoFocus
      className="mono h-6 w-full rounded-chip border border-accent bg-bg-surface-1 px-1 text-xs"
      defaultValue={c.edit === "color" ? formatWireColor(w.color).split(" ")[0] : String(c.get(w, h))}
      onBlur={() => setEdit(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setEdit(false);
        if (e.key !== "Enter") return;
        const v = e.currentTarget.value;
        if (c.edit === "net") dispatch(renameNet({ id: w.netId, name: v }));
        if (c.edit === "color") {
          const col = parseWireColor(v);
          if (col) dispatch(setWireProps({ ids: [w.id], color: col }));
          else useUi.getState().toast({ kind: "error", text: "Use MIL-STD-681 codes like 9-6-2 or WHT/BLU/RED" });
        }
        setEdit(false);
      }}
    />
  );
}

function NetsTable({ h }: { h: Harness }) {
  const ui = useUi();
  const nets = [...h.nets].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-bg-surface-2 text-left text-2xs uppercase tracking-wide text-text-tertiary">
          <tr>
            <th className="px-2 py-1">Net</th>
            <th className="px-2 py-1">Class</th>
            <th className="px-2 py-1">Current</th>
            <th className="px-2 py-1">Pins</th>
            <th className="px-2 py-1">Topology</th>
          </tr>
        </thead>
        <tbody>
          {nets.map((n) => (
            <tr key={n.id} className={cx("border-b border-border-subtle hover:bg-bg-hover", ui.selection.kind === "net" && ui.selection.ids.includes(n.id) && "bg-bg-hover")} onClick={() => (ui.select("net", [n.id]), zoomToObjects([n.id]))}>
              <td className="mono px-2 py-1">{n.name}</td>
              <td className="px-2 py-1">
                <select className="bg-transparent text-xs" value={n.cls} onClick={(e) => e.stopPropagation()} onChange={(e) => dispatch(setNetProps({ ids: [n.id], cls: e.target.value as never }))}>
                  {["signal", "power", "ground", "rf", "spare"].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </td>
              <td className="tnum px-2 py-1">{n.currentA != null ? `${n.currentA} A` : "—"}</td>
              <td className="mono px-2 py-1">{n.members.map((m) => `${h.connectors.find((c) => c.id === m.connectorId)?.refDes}-${m.cavityId}`).join(", ")}</td>
              <td className="px-2 py-1">{effectiveTopology(n) === "wired" ? "as drawn" : n.members.length >= 3 ? effectiveTopology(n) : "point-to-point"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectorsTable({ h }: { h: Harness }) {
  const cat = svc().cat;
  const ui = useUi();
  return (
    <div className="scroll-thin flex min-h-0 flex-1 gap-4 overflow-auto p-3">
      {h.connectors.map((c) => {
        const part = cat.connector(c.pn);
        return (
          <div key={c.id} className="min-w-[260px] rounded-card border border-border-subtle">
            <button className="flex w-full items-center justify-between border-b border-border-subtle px-2 py-1 text-left" onClick={() => (ui.select("connector", [c.id]), zoomToObjects([c.id]))}>
              <span className="font-semibold">{c.refDes}</span>
              <span className="mono text-2xs text-text-secondary">{c.pn}</span>
            </button>
            <table className="w-full text-xs">
              <tbody>
                {(part?.arrangement.cavities ?? []).map((cav) => {
                  const net = c.pins[cav.id]?.netId ? h.nets.find((n) => n.id === c.pins[cav.id]!.netId) : undefined;
                  return (
                    <tr key={cav.id} className="border-b border-border-subtle">
                      <td className="mono w-10 px-2 py-0.5 text-text-secondary">{cav.id}</td>
                      <td className="mono px-2 py-0.5">{net?.name ?? <span className="text-text-tertiary">spare</span>}</td>
                      <td className="px-2 py-0.5 text-2xs text-text-tertiary">{cav.size}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
