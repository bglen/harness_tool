import { currentHarness, type Point } from "@hs/model";
import { getProject } from "../store/project";
import { useUi } from "../store/ui";
import { bounds, layoutConnector, zoomLevel } from "./geometry";
import { svc } from "./services";

export function canvasRect() {
  return document.getElementById("hs-canvas")?.getBoundingClientRect() ?? new DOMRect(0, 0, 1000, 700);
}

export function screenToCanvas(p: Point): Point {
  const r = canvasRect();
  const v = useUi.getState().viewport;
  return { x: (p.x - r.left - v.x) / v.k, y: (p.y - r.top - v.y) / v.k };
}

export function canvasToScreen(p: Point): Point {
  const r = canvasRect();
  const v = useUi.getState().viewport;
  return { x: p.x * v.k + v.x + r.left, y: p.y * v.k + v.y + r.top };
}

export function zoomToFit(pad = 60) {
  const h = currentHarness(getProject());
  const { w, h: ch } = useUi.getState().canvasSize;
  const b = bounds(h, svc().cat, "harness", useUi.getState().canvasMode === "bundles");
  if (!b) {
    useUi.getState().setViewport({ x: w / 2, y: ch / 2, k: 1 });
    return;
  }
  const k = Math.min(2, Math.max(0.15, Math.min((w - pad * 2) / Math.max(b.w, 1), (ch - pad * 2) / Math.max(b.h, 1))));
  useUi.getState().setViewport({ k, x: w / 2 - (b.x + b.w / 2) * k, y: ch / 2 - (b.y + b.h / 2) * k });
}

/** Center the view on objects (cross-probing from wire list / DFM), zooming in if needed. */
export function zoomToObjects(ids: string[]) {
  const h = currentHarness(getProject());
  const { w, h: ch } = useUi.getState().canvasSize;
  const pts: Point[] = [];
  const cat = svc().cat;
  const lvl = zoomLevel(useUi.getState().viewport.k);
  for (const id of ids) {
    const c = h.connectors.find((x) => x.id === id);
    if (c) {
      const L = layoutConnector(c, cat, lvl, useUi.getState().canvasMode === "bundles");
      pts.push({ x: L.card.x, y: L.card.y }, { x: L.card.x + L.card.w, y: L.card.y + L.card.h });
    }
    const n = h.nodes.find((x) => x.id === id);
    if (n) pts.push(n.kind === "connector" ? h.connectors.find((x) => x.id === n.connectorId)!.position : n.position);
    const s = h.segments.find((x) => x.id === id);
    if (s) for (const nid of [s.a, s.b]) {
      const nn = h.nodes.find((x) => x.id === nid);
      if (nn) pts.push(nn.kind === "connector" ? h.connectors.find((x) => x.id === nn.connectorId)!.position : nn.position);
    }
    const wire = h.wires.find((x) => x.id === id);
    if (wire) for (const e of [wire.from, wire.to]) if (e.kind === "pin") pts.push(h.connectors.find((x) => x.id === e.connectorId)?.position ?? { x: 0, y: 0 });
    const net = h.nets.find((x) => x.id === id);
    if (net) for (const m of net.members) pts.push(h.connectors.find((x) => x.id === m.connectorId)?.position ?? { x: 0, y: 0 });
  }
  if (!pts.length) return;
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const y1 = Math.max(...pts.map((p) => p.y));
  const cur = useUi.getState().viewport.k;
  const fit = Math.min((w - 200) / Math.max(x1 - x0, 1), (ch - 200) / Math.max(y1 - y0, 1));
  const k = Math.max(0.5, Math.min(1.6, Math.min(fit, Math.max(cur, 0.9))));
  useUi.getState().setViewport({ k, x: w / 2 - ((x0 + x1) / 2) * k, y: ch / 2 - ((y0 + y1) / 2) * k });
  useUi.getState().flashObjects(ids);
}
