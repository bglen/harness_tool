import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addBreakout,
  commitRatsnest,
  connectPins,
  currentRevision,
  formatLength,
  mergeNodes,
  moveNodes,
  netOfPin,
  parseLength,
  reattachSegment,
  setConnectorProps,
  setPinSignals,
  setSegmentProps,
  uid,
  type Command,
  type Harness,
  type Point,
  type Wire,
} from "@hs/model";
import { cvdFilterMatrix, semantic } from "@hs/ui-tokens";
import { dispatch, useProject } from "../store/project";
import { useUi } from "../store/ui";
import { activePedigreeOf, useActiveAnalysis, useDerived } from "../store/analysis";
import { svc } from "../lib/services";
import { bundleWidth, layoutConnector, nodePos, projectOnSegment, zoomLevel, type ConnLayout, type ZoomLevel } from "../lib/geometry";
import { ConnectorView, type RowState } from "./ConnectorView";
import { BundleChips, BundleLayer, SegmentHandles } from "./BundleLayer";
import { WireLayer } from "./WireLayer";
import { canvasToScreen, zoomToFit } from "../lib/viewport";
import { EmptyState } from "./EmptyState";
import { FloatingToolbar } from "./FloatingToolbar";
import { ContextBar } from "./ContextBar";
import { NotesLayer } from "./NotesLayer";
import { openFile } from "../lib/files";

type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; ids: string[]; nodeIds: string[]; start: Point; cur: Point; moved: boolean; hitId: string; hitKind: "connector" | "node" }
  | { kind: "wire"; from: { connectorId: string; cavityId: string }[]; start: Point; cur: Point; moved: boolean; srcKey: string }
  | { kind: "branch"; segmentId: string; t: number; start: Point; cur: Point; moved: boolean }
  | { kind: "reattach"; segmentId: string; end: "a" | "b"; start: Point; cur: Point; moved: boolean }
  | { kind: "marquee"; start: Point; cur: Point; additive: boolean }
  | { kind: "note"; id: string; start: Point; cur: Point; moved: boolean };

function hitAt(e: { target: EventTarget | null }): { hit: string; id: string } | null {
  const el = (e.target as Element | null)?.closest?.("[data-hit]");
  if (!el) return null;
  return { hit: el.getAttribute("data-hit")!, id: el.getAttribute("data-id") ?? "" };
}

/** Every hit target under a screen point, top-most first (skips drag previews and hit-less elements). */
function hitsAtPoint(x: number, y: number): { hit: string; id: string }[] {
  const out: { hit: string; id: string }[] = [];
  const seen = new Set<Element>();
  for (const el of document.elementsFromPoint(x, y)) {
    const h = (el as Element).closest?.("[data-hit]");
    if (!h || seen.has(h) || h.getAttribute("data-hit") === "drag-preview") continue;
    seen.add(h);
    out.push({ hit: h.getAttribute("data-hit")!, id: h.getAttribute("data-id") ?? "" });
  }
  return out;
}

function hitAtPoint(x: number, y: number): { hit: string; id: string } | null {
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    const h = (el as Element).closest?.("[data-hit]");
    if (h && h.getAttribute("data-hit") !== "drag-preview") return { hit: h.getAttribute("data-hit")!, id: h.getAttribute("data-id") ?? "" };
  }
  return null;
}

/** Compatible when the gauge ranges of the two contact sizes intersect (§5.4 invalid-target dimming). */
function sizesCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const cat = svc().cat;
  const ga = cat.contactSize(a)?.gauges ?? [];
  const gb = cat.contactSize(b)?.gauges ?? [];
  return ga.some((g) => gb.includes(g));
}

export function Canvas() {
  const project = useProject((s) => s.project)!;
  const rev = currentRevision(project);
  const h0 = rev.harness;
  const d = useDerived();
  const analysis = useActiveAnalysis();
  const ui = useUi();
  const { viewport: vp, resolvedTheme: theme } = ui;
  const cat = svc().cat;
  const ref = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const spaceDown = useRef(false);
  const [lengthEdit, setLengthEdit] = useState<{ segId: string; screen: Point; value: string } | null>(null);
  const [hint, setHint] = useState<{ x: number; y: number; text: string } | null>(null);
  const level = zoomLevel(vp.k);
  // Quantized zoom for text sizing inside memoized layers, so wheel zoom doesn't re-render every wire
  const kq = Math.round(vp.k * 4) / 4 || 0.25;

  // Resize observer
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      ui.setCanvasSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial fit
  const fitted = useRef<string>("");
  useEffect(() => {
    if (fitted.current !== project.id && ui.canvasSize.w > 100) {
      fitted.current = project.id;
      if (h0.connectors.length) zoomToFit();
      else ui.setViewport({ x: ui.canvasSize.w / 2, y: ui.canvasSize.h / 2, k: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, ui.canvasSize.w]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target as HTMLElement).closest("input,textarea")) spaceDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const toCanvas = useCallback(
    (sx: number, sy: number): Point => {
      const r = ref.current!.getBoundingClientRect();
      return { x: (sx - r.left - vp.x) / vp.k, y: (sy - r.top - vp.y) / vp.k };
    },
    [vp],
  );

  // View harness: apply live drag offsets without dispatching every frame
  const h: Harness = useMemo(() => {
    if (!drag || drag.kind !== "move" || !drag.moved) return h0;
    const dx = drag.cur.x - drag.start.x;
    const dy = drag.cur.y - drag.start.y;
    const snap = (v: number) => v;
    return {
      ...h0,
      connectors: h0.connectors.map((c) => (drag.ids.includes(c.id) ? { ...c, position: { x: snap(c.position.x + dx), y: snap(c.position.y + dy) } } : c)),
      nodes: h0.nodes.map((n) => (drag.nodeIds.includes(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)),
    };
  }, [h0, drag]);

  // Layout cached per connector object (Immer structural sharing keeps unchanged connectors identical)
  const layoutCache = useRef(new WeakMap<object, { level: ZoomLevel; L: ConnLayout }>());
  const layouts = useMemo(() => {
    const m = new Map<string, ConnLayout>();
    for (const c of h.connectors) {
      const hit = layoutCache.current.get(c);
      if (hit && hit.level === level) m.set(c.id, hit.L);
      else {
        const L = layoutConnector(c, cat, level);
        layoutCache.current.set(c, { level, L });
        m.set(c.id, L);
      }
    }
    return m;
  }, [h.connectors, cat, level]);
  // Per-connector pin → wires and pin → name maps, reused when content is unchanged so memoized cards skip re-render
  const connCache = useRef(new Map<string, { wKey: string; wires: Map<string, Wire[]>; nKey: string; names: Map<string, string> }>());
  const perConn = useMemo(() => {
    const netName = new Map(h.nets.map((n) => [n.id, n.name]));
    const byConn = new Map<string, Map<string, Wire[]>>();
    for (const w of h.wires)
      for (const e of [w.from, w.to]) {
        if (e.kind !== "pin") continue;
        const m = byConn.get(e.connectorId) ?? byConn.set(e.connectorId, new Map()).get(e.connectorId)!;
        (m.get(e.cavityId) ?? m.set(e.cavityId, []).get(e.cavityId)!).push(w);
      }
    const out = new Map<string, { wires: Map<string, Wire[]>; names: Map<string, string> }>();
    for (const c of h.connectors) {
      const wires = byConn.get(c.id) ?? new Map<string, Wire[]>();
      const wKey = [...wires].map(([k, ws]) => `${k}=${ws.map((w) => `${w.id}/${w.gauge}/${w.color.base}.${w.color.stripes.join(".")}/${w.label}`).join(",")}`).join("|");
      const names = new Map<string, string>();
      for (const [cav, p] of Object.entries(c.pins)) if (p.netId) names.set(cav, netName.get(p.netId) ?? "");
      const nKey = [...names].map(([k, v]) => `${k}=${v}`).join("|");
      const prev = connCache.current.get(c.id);
      const entry = { wKey, wires: prev && prev.wKey === wKey ? prev.wires : wires, nKey, names: prev && prev.nKey === nKey ? prev.names : names };
      connCache.current.set(c.id, entry);
      out.set(c.id, entry);
    }
    return out;
  }, [h.wires, h.nets, h.connectors]);

  const sel = ui.selection;
  const selSet = useMemo(() => new Set(sel.ids), [sel.ids]);
  const flashSet = useMemo(() => new Set(ui.flash && Date.now() - ui.flash.at < 1600 ? ui.flash.ids : []), [ui.flash]);
  useEffect(() => {
    if (!ui.flash) return;
    const t = setTimeout(() => useUi.setState({ flash: null }), 1600);
    return () => clearTimeout(t);
  }, [ui.flash]);
  const sev = analysis?.dfm.byObject ?? {};
  const focusNet = ui.focusNetId ?? (sel.kind === "net" && sel.ids.length === 1 ? sel.ids[0]! : null);

  // Valid drop targets during a wire drag (§5.4)
  const dragTargets = useMemo(() => {
    if (!drag || drag.kind !== "wire" || !drag.moved) return null;
    const m = new Map<string, RowState>();
    const src = drag.from[0]!;
    const srcC = h.connectors.find((c) => c.id === src.connectorId)!;
    const srcCav = cat.cavity(srcC.pn, src.cavityId);
    const srcNet = netOfPin(h, src.connectorId, src.cavityId);
    const srcKeys = new Set(drag.from.map((f) => `${f.connectorId}:${f.cavityId}`));
    for (const c of h.connectors) {
      const L = layouts.get(c.id)!;
      for (const r of L.rows) {
        const key = `${c.id}:${r.cavityId}`;
        if (srcKeys.has(key)) continue;
        if (r.special) m.set(key, { valid: false, reason: "Coax/twinax cavity (Phase 2)" });
        else if (r.netId && srcNet && r.netId !== srcNet.id) m.set(key, { valid: false, reason: `Occupied by ${h.nets.find((n) => n.id === r.netId)?.name}` });
        else if (r.netId && !srcNet) m.set(key, { valid: false, reason: `Occupied by ${h.nets.find((n) => n.id === r.netId)?.name}` });
        else if (srcCav && !sizesCompatible(srcCav.size, r.size)) m.set(key, { valid: false, reason: `Incompatible contact size (${srcCav.size} → ${r.size})` });
        else m.set(key, { valid: true });
      }
    }
    return m;
  }, [drag, h, layouts, cat]);

  // ─── Pointer handling ───────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toCanvas(e.clientX, e.clientY);
    const hit = hitAt(e);
    ui.openContextMenu(null);
    if (e.button === 1 || spaceDown.current) {
      setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y });
      return;
    }
    // Breakout tool: a click on a bundle splits it there; anywhere else cancels the tool.
    if (ui.tool === "breakout") {
      ui.setTool(null);
      if (hit?.hit === "segment" || hit?.hit === "chip-length") {
        const s = h.segments.find((x) => x.id === hit.id)!;
        const a = nodePos(h, s.a);
        const b = nodePos(h, s.b);
        const t = hit.hit === "segment" ? projectOnSegment(a, b, p) : 0.5;
        const nodeId = uid();
        if (dispatch(addBreakout({ segmentId: s.id, t, nodeId, position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } }), "Add breakout")) ui.select("node", [nodeId]);
        return;
      }
      if (!hit) return;
    }
    if (!hit) {
      setDrag({ kind: "marquee", start: p, cur: p, additive: e.shiftKey || e.ctrlKey || e.metaKey });
      return;
    }
    if (hit.hit === "wire-color") {
      // Wire color swatch on a pin card: edit that pin's wire(s) directly.
      e.preventDefault();
      const ids = hit.id.split(",").filter(Boolean);
      ui.select("wire", ids);
      ui.openPopover({ kind: "wireProps", screen: { x: e.clientX, y: e.clientY + 12 }, data: { ids, focus: "color" } });
      return;
    }
    if (hit.hit === "seg-end") {
      const [segmentId, end] = hit.id.split(":") as [string, "a" | "b"];
      setDrag({ kind: "reattach", segmentId, end, start: p, cur: p, moved: false });
      return;
    }
    if (hit.hit === "pin" || hit.hit === "signal") {
      const [cid, cav] = hit.id.split(":") as [string, string];
      let from = [{ connectorId: cid, cavityId: cav }];
      if (sel.kind === "pin" && selSet.has(hit.id) && sel.ids.length > 1) {
        const L = layouts.get(cid)!;
        from = sel.ids
          .filter((k) => k.startsWith(`${cid}:`))
          .map((k) => ({ connectorId: cid, cavityId: k.split(":")[1]! }))
          .sort((a, b) => (L.rowByCavity.get(a.cavityId)?.y ?? 0) - (L.rowByCavity.get(b.cavityId)?.y ?? 0));
      }
      setDrag({ kind: "wire", from, start: p, cur: p, moved: false, srcKey: hit.id });
      return;
    }
    if (hit.hit === "connector") {
      const already = sel.kind === "connector" && selSet.has(hit.id);
      const ids = already ? sel.ids : [hit.id];
      const nodeIds: string[] = [];
      // Select on press (not only on release) so a connector being dragged is selected, e.g. F flips it mid-drag.
      if (!already && !(e.shiftKey || e.ctrlKey || e.metaKey)) ui.select("connector", [hit.id]);
      setDrag({ kind: "move", ids, nodeIds, start: p, cur: p, moved: false, hitId: hit.id, hitKind: "connector" });
      return;
    }
    if (hit.hit === "node") {
      const already = sel.kind === "node" && selSet.has(hit.id);
      const nodeIds = already ? sel.ids : [hit.id];
      if (!already && !(e.shiftKey || e.ctrlKey || e.metaKey)) ui.select("node", [hit.id]);
      setDrag({ kind: "move", ids: [], nodeIds, start: p, cur: p, moved: false, hitId: hit.id, hitKind: "node" });
      return;
    }
    if (hit.hit === "segment") {
      const s = h.segments.find((x) => x.id === hit.id)!;
      const t = projectOnSegment(nodePos(h, s.a), nodePos(h, s.b), p);
      setDrag({ kind: "branch", segmentId: s.id, t, start: p, cur: p, moved: false });
      return;
    }
    if (hit.hit === "note") {
      setDrag({ kind: "note", id: hit.id, start: p, cur: p, moved: false });
      return;
    }
    // simple click targets
    const map: Record<string, Parameters<typeof ui.select>[0]> = { wire: "wire", label: "label", splice: "splice", clamp: "clamp", boot: "boot", hardware: "hardware", shield: "shield" };
    if (map[hit.hit]) {
      if (hit.hit === "wire" && !(e.shiftKey || e.ctrlKey || e.metaKey) && e.altKey) {
        const w = h.wires.find((x) => x.id === hit.id);
        if (w) ui.select("net", [w.netId]);
      } else ui.select(map[hit.hit]!, [hit.id], e.shiftKey || e.ctrlKey || e.metaKey);
    }
    if (hit.hit === "collapsed") dispatch(setConnectorProps({ id: hit.id, showUnused: true }));
    if (hit.hit === "chip-length") {
      const s = h.segments.find((x) => x.id === hit.id)!;
      // Stop the browser's default mousedown focus change, which would blur (and close) the editor opened here.
      e.preventDefault();
      ui.select("segment", [s.id]);
      setLengthEdit({ segId: s.id, screen: { x: e.clientX, y: e.clientY }, value: formatLength(s.lengthMm, project.units, { unit: true }).replace(" ", "") });
    }
    if (hit.hit === "chip-od") ui.openPopover({ kind: "covering", screen: { x: e.clientX, y: e.clientY }, data: { ids: [hit.id] } });
    if (hit.hit === "face") ui.openPopover({ kind: "face", screen: { x: e.clientX, y: e.clientY }, data: { connectorId: hit.id } });
    if (hit.hit === "badge") ui.openDialog("dfm", { objectId: hit.id });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    (window as unknown as { __hsMouse: Point }).__hsMouse = { x: e.clientX, y: e.clientY };
    const dr = dragRef.current;
    if (!dr) {
      const hit = hitAt(e);
      const hv = hit && hit.hit === "wire" ? { kind: "wire" as const, id: hit.id } : null;
      if ((hv?.id ?? null) !== (ui.hover?.id ?? null)) ui.setHover(hv);
      if (hit?.hit === "pin" && !ui.hintsSeen.includes("dragPin")) {
        const r = ref.current!.getBoundingClientRect();
        setHint({ x: e.clientX - r.left + 14, y: e.clientY - r.top - 26, text: "Drag to another pin to connect" });
      } else if (hint?.text.startsWith("Drag to another")) setHint(null);
      return;
    }
    if (dr.kind === "pan") {
      ui.setViewport({ ...vp, x: dr.vx + e.clientX - dr.sx, y: dr.vy + e.clientY - dr.sy });
      return;
    }
    const p = toCanvas(e.clientX, e.clientY);
    const moved = Math.hypot(p.x - dr.start.x, p.y - dr.start.y) * vp.k > 4;
    if (dr.kind === "move" && !e.altKey && moved) {
      // snap-to-grid (hold Alt to disable)
      const g = 10;
      p.x = dr.start.x + Math.round((p.x - dr.start.x) / g) * g;
      p.y = dr.start.y + Math.round((p.y - dr.start.y) / g) * g;
    }
    setDrag({ ...dr, cur: p, moved: ("moved" in dr ? dr.moved : false) || moved } as Drag);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const dr = dragRef.current;
    setDrag(null);
    if (!dr) return;
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (dr.kind === "marquee") {
      const x0 = Math.min(dr.start.x, dr.cur.x);
      const x1 = Math.max(dr.start.x, dr.cur.x);
      const y0 = Math.min(dr.start.y, dr.cur.y);
      const y1 = Math.max(dr.start.y, dr.cur.y);
      if ((x1 - x0) * vp.k < 4 && (y1 - y0) * vp.k < 4) {
        if (!add) ui.clearSelection();
        return;
      }
      // Pins inside a single card → pin selection; otherwise connectors + breakouts
      const pins: string[] = [];
      for (const [cid, L] of layouts) for (const r of L.rows) if (r.y >= y0 && r.y <= y1 && L.card.x <= x1 && L.card.x + L.card.w >= x0) pins.push(`${cid}:${r.cavityId}`);
      const conns = h.connectors.filter((c) => {
        const L = layouts.get(c.id)!;
        return L.card.x >= x0 && L.card.x + L.card.w <= x1 && L.card.y >= y0 && L.card.y + L.card.h <= y1;
      });
      if (conns.length) ui.select("connector", conns.map((c) => c.id), add);
      else if (pins.length) ui.select("pin", pins, add);
      else {
        const nodes = h.nodes.filter((n) => n.kind === "breakout" && n.position.x >= x0 && n.position.x <= x1 && n.position.y >= y0 && n.position.y <= y1);
        ui.select("node", nodes.map((n) => n.id), add);
      }
      return;
    }
    if (dr.kind === "move") {
      if (!dr.moved) {
        if (dr.hitKind === "connector") ui.select("connector", [dr.hitId], add);
        else ui.select("node", [dr.hitId], add);
        return;
      }
      const dx = dr.cur.x - dr.start.x;
      const dy = dr.cur.y - dr.start.y;
      // Dropped a connector onto another connector → mate popover (§5.4)
      if (dr.hitKind === "connector" && dr.ids.length === 1) {
        const target = h.connectors.find((c) => {
          if (c.id === dr.hitId) return false;
          const L = layoutConnector(h0.connectors.find((x) => x.id === c.id)!, cat, level);
          return dr.cur.x >= L.card.x && dr.cur.x <= L.card.x + L.card.w && dr.cur.y >= L.card.y && dr.cur.y <= L.card.y + L.card.h;
        });
        if (target) {
          ui.openPopover({ kind: "mate", screen: { x: e.clientX, y: e.clientY }, data: { a: dr.hitId, b: target.id } });
          return;
        }
      }
      // A breakout dropped onto a connector, another breakout or a bundle joins them there (lengths unchanged).
      if (dr.hitKind === "node" && dr.nodeIds.length === 1) {
        const node = h0.nodes.find((n) => n.id === dr.hitId);
        const incident = (segId: string) => h0.segments.some((s) => s.id === segId && (s.a === dr.hitId || s.b === dr.hitId));
        const over = hitsAtPoint(e.clientX, e.clientY).find((x) => !(x.hit === "node" && x.id === dr.hitId) && !(x.hit === "segment" && incident(x.id)) && ["connector", "pin", "signal", "node", "segment"].includes(x.hit));
        if (node?.kind === "breakout" && over) {
          if (over.hit === "connector" || over.hit === "pin" || over.hit === "signal") {
            const into = h0.nodes.find((n) => n.connectorId === over.id.split(":")[0])!.id;
            dispatch(mergeNodes({ from: node.id, into }), "Route branch to connector");
            return;
          }
          if (over.hit === "node") {
            dispatch(mergeNodes({ from: node.id, into: over.id }), "Merge breakouts");
            return;
          }
          if (over.hit === "segment") {
            const s = h0.segments.find((x) => x.id === over.id)!;
            if (s.a !== node.id && s.b !== node.id) {
              const a = nodePos(h0, s.a);
              const b = nodePos(h0, s.b);
              const t = projectOnSegment(a, b, dr.cur);
              const nodeId = uid();
              dispatch([addBreakout({ segmentId: s.id, t, nodeId, position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } }), mergeNodes({ from: node.id, into: nodeId })], "Join breakout to bundle");
              ui.select("node", [nodeId]);
              return;
            }
          }
        }
      }
      const moves = [
        ...dr.ids.map((id) => {
          const c = h0.connectors.find((x) => x.id === id)!;
          return { id: h0.nodes.find((n) => n.connectorId === id)!.id, position: { x: c.position.x + dx, y: c.position.y + dy } };
        }),
        ...dr.nodeIds.map((id) => {
          const n = h0.nodes.find((x) => x.id === id)!;
          return { id, position: { x: n.position.x + dx, y: n.position.y + dy } };
        }),
      ];
      dispatch(moveNodes({ moves }), dr.ids.length ? "Move connector" : "Move breakout");
      return;
    }
    if (dr.kind === "wire") {
      if (!dr.moved) {
        ui.select("pin", [dr.srcKey], add);
        return;
      }
      const over = hitAtPoint(e.clientX, e.clientY);
      if (over && (over.hit === "pin" || over.hit === "signal")) {
        const [tc, tcav] = over.id.split(":") as [string, string];
        if (dragTargets?.get(over.id)?.valid === false) {
          ui.toast({ kind: "info", text: dragTargets.get(over.id)!.reason ?? "Invalid target" });
          return;
        }
        const L = layouts.get(tc)!;
        const startIdx = L.rows.findIndex((r) => r.cavityId === tcav);
        const pairs = dr.from
          .map((f, i) => {
            const row = L.rows[startIdx + i];
            return row ? { a: f, b: { connectorId: tc, cavityId: row.cavityId } } : null;
          })
          .filter(Boolean) as { a: { connectorId: string; cavityId: string }; b: { connectorId: string; cavityId: string } }[];
        if (dispatch(connectPins({ pairs }))) ui.markHint("dragPin");
        return;
      }
      if (!over) {
        // Drag to empty canvas → part picker; wire lands on the equivalent pin (§5.4)
        ui.openPicker({ screen: { x: e.clientX, y: e.clientY }, canvas: dr.cur, mode: "fromPin", fromPins: dr.from });
      }
      return;
    }
    if (dr.kind === "branch") {
      if (!dr.moved) {
        ui.select("segment", [dr.segmentId], add);
        return;
      }
      const s = h.segments.find((x) => x.id === dr.segmentId)!;
      const a = nodePos(h, s.a);
      const b = nodePos(h, s.b);
      const bp = { x: a.x + (b.x - a.x) * dr.t, y: a.y + (b.y - a.y) * dr.t };
      const over = hitAtPoint(e.clientX, e.clientY);
      const targetConn = over && (over.hit === "connector" || over.hit === "pin") ? over.id.split(":")[0]! : undefined;
      const nodeId = uid();
      const dist = Math.hypot(dr.cur.x - bp.x, dr.cur.y - bp.y);
      const lengthMm = Math.max(50, Math.round((dist * 1.2) / 5) * 5);
      if (targetConn) dispatch(addBreakout({ segmentId: s.id, t: dr.t, nodeId, position: bp, branch: { toConnectorId: targetConn, lengthMm } }), "Add branch");
      else dispatch(addBreakout({ segmentId: s.id, t: dr.t, nodeId, position: bp, branch: { toPosition: dr.cur, newNodeId: uid(), lengthMm } }), "Add branch");
      ui.select("node", [nodeId]);
      return;
    }
    if (dr.kind === "reattach") {
      if (!dr.moved) return;
      const s = h0.segments.find((x) => x.id === dr.segmentId);
      if (!s) return;
      const over = hitsAtPoint(e.clientX, e.clientY).find((x) => ["connector", "pin", "signal", "node", "segment"].includes(x.hit) && !(x.hit === "segment" && x.id === s.id));
      let cmds: Command[] = [];
      let nodeId: string | undefined;
      if (over && (over.hit === "connector" || over.hit === "pin" || over.hit === "signal")) {
        cmds = [reattachSegment({ segmentId: s.id, end: dr.end, toNodeId: h0.nodes.find((n) => n.connectorId === over.id.split(":")[0])!.id })];
      } else if (over?.hit === "node") {
        cmds = [reattachSegment({ segmentId: s.id, end: dr.end, toNodeId: over.id })];
      } else if (over?.hit === "segment") {
        // Drop on another bundle: split it there and attach to the new breakout.
        const t = h0.segments.find((x) => x.id === over.id)!;
        const a = nodePos(h0, t.a);
        const b = nodePos(h0, t.b);
        const f = projectOnSegment(a, b, dr.cur);
        nodeId = uid();
        cmds = [addBreakout({ segmentId: t.id, t: f, nodeId, position: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f } }), reattachSegment({ segmentId: s.id, end: dr.end, toNodeId: nodeId })];
      } else {
        // Empty canvas: detach this end to a new free breakout.
        nodeId = uid();
        cmds = [reattachSegment({ segmentId: s.id, end: dr.end, toPosition: dr.cur, newNodeId: nodeId })];
      }
      if (dispatch(cmds, "Re-attach bundle")) ui.select("segment", [s.id]);
      return;
    }
    if (dr.kind === "note") {
      if (!dr.moved) ui.select("note", [dr.id], add);
      else {
        const n = h0.notes.find((x) => x.id === dr.id)!;
        dispatch({ type: "updateNote", payload: { id: dr.id, position: { x: n.position.x + dr.cur.x - dr.start.x, y: n.position.y + dr.cur.y - dr.start.y } } }, "Move note");
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const hit = hitAt(e);
    if (!hit) {
      ui.openPicker({ screen: { x: e.clientX, y: e.clientY }, canvas: toCanvas(e.clientX, e.clientY), mode: "place" });
      return;
    }
    if (hit.hit === "pin" || hit.hit === "signal") {
      const [cid, cav] = hit.id.split(":") as [string, string];
      ui.setEditing({ connectorId: cid, cavityId: cav, col: "signal" });
      return;
    }
    if (hit.hit === "ratsnest") dispatch(commitRatsnest({ netIds: [hit.id] }));
    if (hit.hit === "wire") {
      const w = h.wires.find((x) => x.id === hit.id);
      if (w) ui.select("net", [w.netId]);
    }
    if (hit.hit === "label") ui.openPopover({ kind: "labelEdit", screen: { x: e.clientX, y: e.clientY }, data: { id: hit.id } });
    if (hit.hit === "note") ui.openPopover({ kind: "noteEdit", screen: { x: e.clientX, y: e.clientY }, data: { id: hit.id } });
    if (hit.hit === "connector") ui.select("connector", [hit.id]);
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const hit = hitAt(e);
    const kinds: Record<string, Parameters<typeof ui.select>[0]> = { connector: "connector", pin: "pin", signal: "pin", wire: "wire", segment: "segment", node: "node", label: "label", splice: "splice", note: "note", clamp: "clamp", boot: "boot", hardware: "hardware", shield: "shield", "chip-length": "segment" };
    if (hit && kinds[hit.hit]) {
      const k = kinds[hit.hit]!;
      if (!(ui.selection.kind === k && selSet.has(hit.id))) ui.select(k, [hit.id]);
    } else if (!hit) ui.clearSelection();
    ui.openContextMenu({ screen: { x: e.clientX, y: e.clientY } });
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const k = Math.min(4, Math.max(0.1, vp.k * factor));
    ui.setViewport({ k, x: mx - ((mx - vp.x) / vp.k) * k, y: my - ((my - vp.y) / vp.k) * k });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (/\.(csv|tsv|xlsx|xls|ya?ml)$/i.test(f.name)) ui.openDialog("import", { file: f });
    else if (/\.harnessrules\.json$/i.test(f.name)) ui.openDialog("rules", { importFile: f });
    else void openFile(f);
  };

  // Ghost hint after the first connector (§5.5)
  useEffect(() => {
    if (h0.connectors.length === 1 && !ui.hintsSeen.includes("second")) {
      const c = h0.connectors[0]!;
      const L = layouts.get(c.id);
      if (!L) return;
      const s = canvasToScreen({ x: L.card.x + L.card.w + 100, y: L.card.y });
      const r = ref.current?.getBoundingClientRect();
      if (r) setHint({ x: s.x - r.left, y: s.y - r.top, text: "Add a second connector (C), then drag between pins." });
    } else if (hint?.text.startsWith("Add a second")) {
      setHint(null);
      if (h0.connectors.length > 1) ui.markHint("second");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h0.connectors.length, vp]);

  const selectedPins = useMemo(() => new Set(sel.kind === "pin" ? sel.ids : []), [sel]);
  const potted = useMemo(() => new Set(h.potting.filter((p) => p.targetKind === "connector").map((p) => p.targetId)), [h.potting]);
  const dimAll = ui.shieldView;
  const bg = semantic("bg.canvas", theme);
  const grid = semantic("canvas.grid", theme);
  const ped = project.pedigreeScheme.pedigrees.find((p) => p.id === activePedigreeOf(project));

  // Drag preview elements
  let preview: JSX.Element | null = null;
  if (drag?.kind === "wire" && drag.moved) {
    const L = layouts.get(drag.from[0]!.connectorId)!;
    const r = L.rowByCavity.get(drag.from[0]!.cavityId);
    const s = r ? { x: L.attachX, y: r.y } : L.anchor;
    preview = (
      <g data-hit="drag-preview" pointerEvents="none">
        <path d={`M${s.x},${s.y} C${s.x + L.facing * 60},${s.y} ${drag.cur.x - L.facing * 40},${drag.cur.y} ${drag.cur.x},${drag.cur.y}`} stroke={semantic("accent", theme)} strokeWidth={1.6} fill="none" strokeDasharray="5 3" />
        {drag.from.length > 1 && (
          <text x={drag.cur.x + 10} y={drag.cur.y - 8} fontSize={12} fill={semantic("accent", theme)}>
            {drag.from.length} pins
          </text>
        )}
      </g>
    );
  } else if (drag?.kind === "branch" && drag.moved) {
    const s = h.segments.find((x) => x.id === drag.segmentId)!;
    const a = nodePos(h, s.a);
    const b = nodePos(h, s.b);
    const bp = { x: a.x + (b.x - a.x) * drag.t, y: a.y + (b.y - a.y) * drag.t };
    preview = (
      <g pointerEvents="none">
        <line x1={bp.x} y1={bp.y} x2={drag.cur.x} y2={drag.cur.y} stroke={semantic("bundle.fill", theme)} strokeWidth={bundleWidth(2, level)} strokeLinecap="round" opacity={0.8} />
        <circle cx={bp.x} cy={bp.y} r={7} fill={semantic("text.primary", theme)} />
      </g>
    );
  } else if (drag?.kind === "reattach" && drag.moved) {
    const s = h.segments.find((x) => x.id === drag.segmentId);
    if (s) {
      const fixed = nodePos(h, drag.end === "a" ? s.b : s.a);
      preview = (
        <g data-hit="drag-preview" pointerEvents="none">
          <line x1={fixed.x} y1={fixed.y} x2={drag.cur.x} y2={drag.cur.y} stroke={semantic("accent", theme)} strokeWidth={bundleWidth(2, level)} strokeDasharray="8 5" strokeLinecap="round" opacity={0.7} />
          <circle cx={drag.cur.x} cy={drag.cur.y} r={7} fill="none" stroke={semantic("accent", theme)} strokeWidth={2} />
          <text x={drag.cur.x + 12} y={drag.cur.y - 10} fontSize={11 / Math.max(vp.k, 0.6)} fill={semantic("accent", theme)}>
            Drop on a connector, breakout or bundle
          </text>
        </g>
      );
    }
  } else if (drag?.kind === "marquee") {
    const x = Math.min(drag.start.x, drag.cur.x);
    const y = Math.min(drag.start.y, drag.cur.y);
    preview = <rect x={x} y={y} width={Math.abs(drag.cur.x - drag.start.x)} height={Math.abs(drag.cur.y - drag.start.y)} fill={semantic("accent", theme)} fillOpacity={0.08} stroke={semantic("accent", theme)} strokeDasharray="4 3" strokeWidth={1 / vp.k} pointerEvents="none" />;
  } else if (drag?.kind === "note" && drag.moved) {
    // handled via NotesLayer offset
  }

  const editing = ui.editing;
  const editRow = editing ? layouts.get(editing.connectorId)?.rowByCavity.get(editing.cavityId) : undefined;
  const editL = editing ? layouts.get(editing.connectorId) : undefined;

  return (
    <div
      ref={ref}
      id="hs-canvas"
      className="relative h-full w-full select-none overflow-hidden"
      style={{ background: bg, cursor: drag?.kind === "pan" ? "grabbing" : undefined }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      aria-label="Harness canvas"
    >
      {/* pedigree band along the top edge (§10.2) */}
      {ped && <div className="absolute left-0 right-0 top-0 z-10 h-[3px]" style={{ background: `var(--pedigree-${ped.color})` }} title={`Active pedigree: ${ped.name} (${ped.code})`} />}
      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
        onPointerLeave={() => ui.setHover(null)}
      >
        <defs>
          <pattern id="dots" width={20 * vp.k} height={20 * vp.k} patternUnits="userSpaceOnUse" x={vp.x % (20 * vp.k)} y={vp.y % (20 * vp.k)}>
            <circle cx={1} cy={1} r={vp.k > 0.5 ? 1 : 0.6} fill={grid} />
          </pattern>
          {ui.cvd && (
            <filter id="cvd">
              <feColorMatrix type="matrix" values={cvdFilterMatrix(ui.cvd)} />
            </filter>
          )}
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
        <g transform={`translate(${vp.x},${vp.y}) scale(${vp.k})`} filter={ui.cvd ? "url(#cvd)" : undefined}>
          <BundleLayer
            h={h}
            d={d}
            cat={cat}
            level={level}
            theme={theme}
            units={project.units}
            selectedSegs={sel.kind === "segment" ? selSet : EMPTY}
            selectedNodes={sel.kind === "node" ? selSet : EMPTY}
            selectedLabels={sel.kind === "label" ? selSet : EMPTY}
            sev={sev}
            dimmed={!!focusNet}
            shieldView={ui.shieldView}
            harnessPN={project.partNumber}
            rev={rev.label}
            k={kq}
            flash={flashSet}
          />
          <WireLayer h={h} d={d} layouts={layouts} level={level} theme={theme} selected={sel.kind === "wire" ? selSet : EMPTY} hoverId={ui.hover?.id ?? null} sev={sev} focusNetId={focusNet} shieldView={ui.shieldView} colorLabels={ui.wireColorLabels} k={kq} flash={flashSet} />
          {h.connectors.map((c) => (
            <ConnectorView
              key={c.id}
              c={c}
              L={layouts.get(c.id)!}
              level={level}
              names={perConn.get(c.id)!.names}
              cat={cat}
              theme={theme}
              selected={sel.kind === "connector" && selSet.has(c.id)}
              selectedPins={sel.kind === "pin" && sel.ids.some((k) => k.startsWith(`${c.id}:`)) ? selectedPins : EMPTY}
              severity={sev[c.id]?.severity}
              editingCavity={editing?.connectorId === c.id ? editing.cavityId : null}
              dragTargets={dragTargets}
              dimmed={dimAll || (!!focusNet && !h.nets.find((n) => n.id === focusNet)?.members.some((m) => m.connectorId === c.id))}
              wiresByPin={perConn.get(c.id)!.wires}
              potted={potted.has(c.id)}
              flash={flashSet.has(c.id)}
            />
          ))}
          <NotesLayer notes={h.notes} theme={theme} selected={sel.kind === "note" ? selSet : EMPTY} offset={drag?.kind === "note" && drag.moved ? { id: drag.id, dx: drag.cur.x - drag.start.x, dy: drag.cur.y - drag.start.y } : null} />
          <BundleChips h={h} d={d} level={level} theme={theme} units={project.units} selectedSegs={sel.kind === "segment" ? selSet : EMPTY} sev={sev} />
          {sel.kind === "segment" && <SegmentHandles h={h} selected={selSet} k={kq} theme={theme} />}
          {preview}
        </g>
      </svg>

      {editing && editRow && editL && (
        <PinEditor
          key={`${editing.connectorId}:${editing.cavityId}`}
          h={h}
          connectorId={editing.connectorId}
          cavityId={editing.cavityId}
          layout={editL}
          screen={{ x: (editL.card.x + 38) * vp.k + vp.x, y: editRow.top * vp.k + vp.y }}
          width={(editL.card.w - 90) * vp.k}
          height={20 * vp.k}
          fontSize={Math.max(10, 11.5 * vp.k)}
        />
      )}
      {lengthEdit && (
        <input
          autoFocus
          aria-label="Segment length"
          className="mono absolute z-20 h-7 w-28 rounded-control border border-accent bg-bg-surface-2 px-2 text-sm text-text-primary"
          style={{ left: lengthEdit.screen.x - (ref.current?.getBoundingClientRect().left ?? 0) - 56, top: lengthEdit.screen.y - (ref.current?.getBoundingClientRect().top ?? 0) - 14 }}
          defaultValue={lengthEdit.value}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const mm = parseLength(e.currentTarget.value, project.units);
              if (mm && mm > 0) dispatch(setSegmentProps({ ids: [lengthEdit.segId], lengthMm: mm }));
              else ui.toast({ kind: "error", text: "Enter a length like 12in, 300mm or 1.2m" });
              setLengthEdit(null);
            }
            if (e.key === "Escape") setLengthEdit(null);
          }}
          onBlur={() => setLengthEdit(null)}
        />
      )}
      {hint && (
        <div className="pointer-events-none absolute z-10 rounded-control border border-border-subtle bg-bg-surface-2 px-2 py-1 text-xs text-text-secondary shadow" style={{ left: hint.x, top: hint.y }}>
          {hint.text}
        </div>
      )}
      {!h.connectors.length && <EmptyState />}
      <ContextBar layouts={layouts} />
      <FloatingToolbar />
      {level !== "harness" && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-chip bg-bg-surface-2 px-2 py-0.5 text-2xs text-text-tertiary">
          {level === "overview" ? "Overview: zoom in for pin cards" : "Detail view"} · {Math.round(vp.k * 100)}%
        </div>
      )}
      {ui.shieldView && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-control border border-accent bg-bg-surface-2 px-3 py-1 text-xs text-text-primary">Shield view: grounding scheme (press G to exit)</div>}
      {ui.tool === "breakout" && <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-control border border-accent bg-bg-surface-2 px-3 py-1 text-xs text-text-primary">Click a bundle to add a breakout there (Esc to cancel)</div>}
      {ui.cvd && <div className="absolute right-3 top-3 rounded-control border border-border-subtle bg-bg-surface-2 px-2 py-1 text-xs text-text-secondary">Simulating {ui.cvd === "achroma" ? "achromatopsia" : `${ui.cvd}opia`} <button className="ml-2 text-accent" onClick={() => ui.setCvd(null)}>off</button></div>}
      <BranchingTip count={h0.connectors.length} segments={h0.segments.length} />
    </div>
  );
}

/** One-time tip once a harness has 3+ connectors: how to edit bundle branching. */
function BranchingTip({ count, segments }: { count: number; segments: number }) {
  const ui = useUi();
  if (count < 3 || segments < 2 || ui.hintsSeen.includes("branching")) return null;
  return (
    <div className="absolute bottom-10 left-3 z-10 w-[290px] rounded-card border border-border-subtle bg-bg-surface-2 p-3 text-xs text-text-secondary shadow-lg" role="note">
      <div className="mb-1 font-medium text-text-primary">Adjusting how bundles branch</div>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>Drag from the middle of a bundle to pull out a branch; drop it on a connector to route that connector through it.</li>
        <li>Select two bundles that leave the same connector (Shift+click) and choose <b>Combine into trunk</b>.</li>
        <li>Select a bundle and drag its end handle onto another connector, breakout or bundle to re-attach it.</li>
        <li>Drop a breakout onto another breakout or a connector to join them. <b>B</b> adds a breakout by clicking a bundle.</li>
      </ul>
      <button className="mt-2 text-accent hover:underline" onClick={() => ui.markHint("branching")}>
        Got it
      </button>
    </div>
  );
}

const EMPTY = new Set<string>();

/** Inline signal-name editor: Enter moves down, Tab/Shift+Tab next/previous, paste a column fills downward (§5.4). */
function PinEditor({ h, connectorId, cavityId, layout, screen, width, height, fontSize }: { h: Harness; connectorId: string; cavityId: string; layout: ConnLayout; screen: Point; width: number; height: number; fontSize: number }) {
  const ui = useUi.getState();
  const cur = netOfPin(h, connectorId, cavityId)?.name ?? "";
  const inputRef = useRef<HTMLInputElement>(null);
  const names = useMemo(() => [...new Set(h.nets.map((n) => n.name))].sort(), [h.nets]);
  const rows = layout.rows.filter((r) => !r.special);
  const idx = rows.findIndex((r) => r.cavityId === cavityId);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const commit = (v: string) => {
    if (v.trim() !== cur) dispatch(setPinSignals({ connectorId, entries: [{ cavityId, name: v }] }));
  };
  const move = (delta: number) => {
    const next = rows[idx + delta];
    if (next) ui.setEditing({ connectorId, cavityId: next.cavityId, col: "signal" });
    else ui.setEditing(null);
  };
  return (
    <>
      <input
        ref={inputRef}
        list="hs-net-names"
        aria-label={`Signal name for pin ${cavityId}`}
        className="mono absolute z-20 rounded-chip border border-accent bg-bg-surface-1 px-1 text-text-primary outline-none"
        style={{ left: screen.x, top: screen.y, width: Math.max(90, width), height: Math.max(18, height), fontSize }}
        defaultValue={cur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit(e.currentTarget.value);
            move(1);
            e.preventDefault();
          } else if (e.key === "Tab") {
            commit(e.currentTarget.value);
            move(e.shiftKey ? -1 : 1);
            e.preventDefault();
          } else if (e.key === "ArrowDown" && !e.currentTarget.value) move(1);
          else if (e.key === "ArrowUp" && !e.currentTarget.value) move(-1);
          else if (e.key === "Escape") ui.setEditing(null);
          e.stopPropagation();
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          const lines = text.split(/\r?\n/).map((l) => l.split("\t")[0]!.trim());
          while (lines.length && !lines[lines.length - 1]) lines.pop();
          if (lines.length > 1) {
            e.preventDefault();
            const entries = lines.map((name, i) => ({ cavityId: rows[idx + i]?.cavityId, name })).filter((x) => x.cavityId) as { cavityId: string; name: string }[];
            dispatch(setPinSignals({ connectorId, entries }), `Paste ${entries.length} signals`);
            ui.setEditing(null);
            ui.toast({ kind: "success", text: `Filled ${entries.length} pins from the clipboard` });
          }
        }}
        onBlur={(e) => {
          commit(e.currentTarget.value);
          if (useUi.getState().editing?.cavityId === cavityId) ui.setEditing(null);
        }}
      />
      <datalist id="hs-net-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}
