import { describe, expect, it } from "vitest";
import type { Harness, Point, Wire } from "./schema";
import { dragSegment, gridCardTop, orthoThrough, roundedPath, SCH_GRID, SCH_LANE, schematicRoutes, splicePoint, type SchematicCard } from "./schematic";

/** A pin card whose rows sit at the given heights, attaching wires at `attachX` on the `facing` side. */
function card(_id: string, attachX: number, facing: 1 | -1, rows: Record<string, number>): SchematicCard {
  const ys = Object.values(rows);
  const top = Math.min(...ys) - 40;
  const h = Math.max(...ys) - top + 20;
  return { facing, card: { y: top, h }, attachX, rowByCavity: new Map(Object.entries(rows).map(([cavityId, y]) => [cavityId, { y }])) };
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


  it("puts every corner and lane on the grid when the pin cards sit on it", () => {
    const L = new Map([
      ["A", card("A", 0, 1, { "1": 100, "2": 120, "3": 140, "4": 160 })],
      ["B", card("B", 400, -1, { "1": 300, "2": 320, "3": 340 })],
      ["C", card("C", 60, 1, { "1": 500, "2": 520 })],
      ["D", card("D", -300, -1, { "1": 100 })],
    ]);
    const ws = [
      ...["1", "2", "3"].map((c) => wire(["A", c], ["B", c])),
      wire(["A", "4"], ["C", "1"]),
      wire(["C", "2"], ["D", "1"]),
      wire(["B", "1"], ["A", "4"]),
    ];
    const splices = [{ id: "s1", nodeId: "n1", barrels: 1, buildUp: [] }];
    const nodes = [{ id: "n1", kind: "breakout", position: { x: 187, y: 233 } }];
    const sw = { ...wire(["A", "1"], ["B", "1"]), to: { kind: "splice", spliceId: "s1" } } as unknown as Wire;
    const h = { wires: [...ws, sw], splices, nodes, connectors: [] } as unknown as Harness;
    const r = schematicRoutes(h, L);
    expect(r.size).toBe(ws.length + 1);
    for (const pts of r.values()) {
      expectOrthogonal(pts);
      for (const p of pts) {
        expect(p.x % SCH_GRID).toBeCloseTo(0);
        expect(p.y % SCH_GRID).toBeCloseTo(0);
      }
    }
    expect(splicePoint(h, "s1")).toEqual({ x: 200, y: 240 });
  });

  it("places a pin card so its rows land on grid lines", () => {
    for (const h of [70, 90, 130, 250])
      for (const y of [0, 20, 240]) {
        const top = gridCardTop(y, h, 46, 20);
        expect((top + 46 + 10) % SCH_GRID).toBeCloseTo(0);
        expect(Math.abs(top + h / 2 - y)).toBeLessThanOrEqual(SCH_GRID / 2);
      }
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

describe("wires the user shapes", () => {
  it("keeps a drawn path orthogonal as the ends move", () => {
    const pts = orthoThrough({ x: 0, y: 0 }, [{ x: 100, y: 0 }, { x: 100, y: 80 }], { x: 300, y: 95 });
    expectOrthogonal(pts);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 300, y: 95 });
    // last leg enters the pin horizontally
    expect(pts[pts.length - 2]!.y).toBe(95);
  });

  it("drags a middle segment and keeps the pins fixed", () => {
    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 300, y: 80 }];
    const path = dragSegment(route, 1, 40, 1, -1); // vertical segment 40 px to the right
    const full = orthoThrough(route[0]!, path, route[3]!);
    expectOrthogonal(full);
    expect(full.some((p) => p.x === 140)).toBe(true);
    expect(full[0]).toEqual({ x: 0, y: 0 });
    expect(full[full.length - 1]).toEqual({ x: 300, y: 80 });
  });

  it("drags the first segment by adding a jog at the pin", () => {
    const route = [{ x: 0, y: 0 }, { x: 300, y: 0 }];
    const full = orthoThrough(route[0]!, dragSegment(route, 0, 60, 1, -1), route[1]!);
    expectOrthogonal(full);
    expect(full[0]).toEqual({ x: 0, y: 0 });
    expect(full[full.length - 1]).toEqual({ x: 300, y: 0 });
    expect(full.some((p) => p.y === 60)).toBe(true);
  });

  it("routes wires with a path through it, and the rest automatically", () => {
    const L = new Map([
      ["A", card("A", 0, 1, { "1": 100, "2": 120 })],
      ["B", card("B", 400, -1, { "1": 300, "2": 320 })],
    ]);
    const w1 = { ...wire(["A", "1"], ["B", "1"]), schPath: [{ x: 60, y: 100 }, { x: 60, y: 300 }] } as Wire;
    const w2 = wire(["A", "2"], ["B", "2"]);
    const r = schematicRoutes(harness([w1, w2]), L);
    expect(r.get(w1.id)).toEqual([{ x: 0, y: 100 }, { x: 60, y: 100 }, { x: 60, y: 300 }, { x: 400, y: 300 }]);
    expect(r.get(w2.id)!.length).toBeGreaterThan(2);
  });
});
