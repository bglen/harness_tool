import { describe, expect, it } from "vitest";
import type { Harness, Point, Wire } from "@hs/model";
import type { ConnLayout } from "./geometry";
import { roundedPath, schematicRoutes, SCH_LANE } from "./schematic";

/** A pin card whose rows sit at the given heights, attaching wires at `attachX` on the `facing` side. */
function card(id: string, attachX: number, facing: 1 | -1, rows: Record<string, number>): ConnLayout {
  const ys = Object.values(rows);
  const top = Math.min(...ys) - 40;
  const h = Math.max(...ys) - top + 20;
  const rs = Object.entries(rows).map(([cavityId, y]) => ({ cavityId, y, top: y - 10, netId: null, size: "22", special: false }));
  return {
    id,
    facing,
    anchor: { x: attachX + facing * 72, y: top + h / 2 },
    card: { x: facing === 1 ? attachX - 236 : attachX, y: top, w: 236, h },
    glyph: { x: 0, y: 0, w: 0, h: 0 },
    attachX,
    rows: rs,
    rowByCavity: new Map(rs.map((r) => [r.cavityId, r])),
    collapsed: null,
    compact: false,
    total: rs.length,
    used: rs.length,
  };
}

let n = 0;
function wire(a: [string, string], b: [string, string]): Wire {
  n++;
  return { id: `w${n}`, label: `W${n}`, netId: `n${n}`, from: { kind: "pin", connectorId: a[0], cavityId: a[1] }, to: { kind: "pin", connectorId: b[0], cavityId: b[1] } } as unknown as Wire;
}

function harness(wires: Wire[]): Harness {
  return { wires, splices: [], nodes: [], connectors: [] } as unknown as Harness;
}

type Seg = [Point, Point];
const segs = (pts: Point[]): Seg[] => pts.slice(1).map((p, i) => [pts[i]!, p]);
const isH = ([a, b]: Seg) => Math.abs(a.y - b.y) < 1e-6;
const between = (v: number, a: number, b: number) => v > Math.min(a, b) + 1e-6 && v < Math.max(a, b) - 1e-6;

/** Proper crossings (and collinear overlaps) between two orthogonal polylines. */
function conflicts(p: Point[], q: Point[]): number {
  let c = 0;
  for (const s of segs(p))
    for (const t of segs(q)) {
      if (isH(s) !== isH(t)) {
        const [hs, vs] = isH(s) ? [s, t] : [t, s];
        if (between(vs[0].x, hs[0].x, hs[1].x) && between(hs[0].y, vs[0].y, vs[1].y)) c++;
      } else if (isH(s) ? Math.abs(s[0].y - t[0].y) < 1e-6 : Math.abs(s[0].x - t[0].x) < 1e-6) {
        const k = isH(s) ? "x" : "y";
        const lo = Math.max(Math.min(s[0][k], s[1][k]), Math.min(t[0][k], t[1][k]));
        const hi = Math.min(Math.max(s[0][k], s[1][k]), Math.max(t[0][k], t[1][k]));
        if (hi - lo > 1e-6) c++;
      }
    }
  return c;
}

function expectOrthogonal(pts: Point[]) {
  for (const [a, b] of segs(pts)) expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(true);
}

describe("schematic wire routing", () => {
  it("draws a wire between rows at the same height as a straight line", () => {
    const L = new Map([
      ["A", card("A", 0, 1, { "1": 100 })],
      ["B", card("B", 400, -1, { "1": 100 })],
    ]);
    const w = wire(["A", "1"], ["B", "1"]);
    expect(schematicRoutes(harness([w]), L).get(w.id)).toEqual([
      { x: 0, y: 100 },
      { x: 400, y: 100 },
    ]);
  });

  it("routes a shifted bus between facing cards with parallel lanes and no self-crossings", () => {
    const L = new Map([
      ["A", card("A", 0, 1, { "1": 100, "2": 120, "3": 140, "4": 160 })],
      ["B", card("B", 400, -1, { "1": 300, "2": 320, "3": 340, "4": 360 })],
    ]);
    const ws = ["1", "2", "3", "4"].map((c) => wire(["A", c], ["B", c]));
    const r = schematicRoutes(harness(ws), L);
    const xs = new Set<number>();
    for (const w of ws) {
      const pts = r.get(w.id)!;
      expectOrthogonal(pts);
      expect(pts[0]).toEqual({ x: 0, y: w.from.kind === "pin" ? L.get("A")!.rowByCavity.get(w.from.cavityId)!.y : 0 });
      expect(pts[pts.length - 1]!.x).toBe(400);
      expect(pts).toHaveLength(4);
      xs.add(pts[1]!.x);
      expect(pts[1]!.x).toBeGreaterThan(0);
      expect(pts[1]!.x).toBeLessThan(400);
    }
    expect(xs.size).toBe(4);
    const sorted = [...xs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i]! - sorted[i - 1]!).toBeCloseTo(SCH_LANE);
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) expect(conflicts(r.get(ws[i]!.id)!, r.get(ws[j]!.id)!)).toBe(0);
  });

  it("orders lanes so a bus heading up doesn't cross itself either", () => {
    const L = new Map([
      ["A", card("A", 0, 1, { "1": 300, "2": 320, "3": 340 })],
      ["B", card("B", 400, -1, { "1": 100, "2": 120, "3": 140 })],
    ]);
    const ws = ["1", "2", "3"].map((c) => wire(["A", c], ["B", c]));
    const r = schematicRoutes(harness(ws), L);
    for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) expect(conflicts(r.get(ws[i]!.id)!, r.get(ws[j]!.id)!)).toBe(0);
  });

  it("keeps the from → to direction when the ends are normalized internally", () => {
    const L = new Map([
      ["A", card("A", 0, 1, { "1": 100 })],
      ["B", card("B", 400, -1, { "1": 200 })],
    ]);
    const w = wire(["B", "1"], ["A", "1"]);
    const pts = schematicRoutes(harness([w]), L).get(w.id)!;
    expect(pts[0]).toEqual({ x: 400, y: 200 });
    expect(pts[pts.length - 1]).toEqual({ x: 0, y: 100 });
  });

  it("wraps nested wires around the outside when both cards attach on the same side", () => {
    const L = new Map([
      ["A", card("A", 0, 1, { "1": 100, "2": 120 })],
      ["B", card("B", 50, 1, { "1": 420, "2": 400 })],
    ]);
    const ws = [wire(["A", "1"], ["B", "1"]), wire(["A", "2"], ["B", "2"])];
    const r = schematicRoutes(harness(ws), L);
    for (const w of ws) {
      const pts = r.get(w.id)!;
      expectOrthogonal(pts);
      expect(pts[1]!.x).toBeGreaterThan(50);
    }
    expect(conflicts(r.get(ws[0]!.id)!, r.get(ws[1]!.id)!)).toBe(0);
  });

  it("goes below both cards when the far card faces away", () => {
    const L = new Map([
      ["A", card("A", 400, 1, { "1": 100, "2": 120 })],
      ["B", card("B", 0, -1, { "1": 100, "2": 120 })],
    ]);
    const ws = [wire(["A", "1"], ["B", "1"]), wire(["A", "2"], ["B", "2"])];
    const r = schematicRoutes(harness(ws), L);
    const bottom = Math.max(L.get("A")!.card.y + L.get("A")!.card.h, L.get("B")!.card.y + L.get("B")!.card.h);
    for (const w of ws) {
      const pts = r.get(w.id)!;
      expect(pts).toHaveLength(6);
      expectOrthogonal(pts);
      expect(pts[2]!.y).toBeGreaterThan(bottom);
      expect(pts[1]!.x).toBeGreaterThan(400);
      expect(pts[4]!.x).toBeLessThan(0);
    }
    expect(conflicts(r.get(ws[0]!.id)!, r.get(ws[1]!.id)!)).toBe(0);
  });

  it("gives separate groups that span the same heights separate channels", () => {
    const L = new Map([
      ["A", card("A", 0, 1, { "1": 100, "2": 150 })],
      ["B", card("B", 400, -1, { "1": 200 })],
      ["C", card("C", 400, -1, { "1": 250 })],
    ]);
    const w1 = wire(["A", "1"], ["B", "1"]);
    const w2 = wire(["A", "2"], ["C", "1"]);
    const r = schematicRoutes(harness([w1, w2]), L);
    const x1 = r.get(w1.id)![1]!.x;
    const x2 = r.get(w2.id)![1]!.x;
    expect(Math.abs(x1 - x2)).toBeGreaterThanOrEqual(SCH_LANE);
  });

  it("rounds corners without leaving the polyline's bounding box", () => {
    const d = roundedPath([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 80 },
      { x: 100, y: 80 },
    ]);
    expect(d.startsWith("M0,0")).toBe(true);
    expect(d.endsWith("L100,80")).toBe(true);
    expect((d.match(/Q/g) ?? []).length).toBe(2);
  });
});
