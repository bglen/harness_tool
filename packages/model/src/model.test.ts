import { describe, expect, it } from "vitest";
import {
  addBreakout,
  addConnector,
  addLayer,
  applyCommand,
  applyPatches,
  connectPins,
  currentHarness,
  derive,
  commitRatsnest,
  deleteWires,
  formatLength,
  formatWireColor,
  newProject,
  parseD38999,
  parseLength,
  parseWireColor,
  ratsnest,
  setNetProps,
  setPinSignals,
  setSegmentProps,
  setSettings,
  shieldWires,
  type Command,
  type Project,
} from "./index";
import { loadTestCatalog } from "./test-catalog";

const cat = loadTestCatalog();
const ctx = { cat, now: () => "2026-01-01T00:00:00Z" };

function apply(p: Project, cmd: Command) {
  return applyCommand(p, cmd, ctx).project;
}

function twoConnectors() {
  let p = newProject({ now: "2026-01-01T00:00:00Z" });
  p = apply(p, addConnector({ id: "c1", pn: "D38999/26WB35SN", position: { x: 0, y: 0 } }));
  p = apply(p, addConnector({ id: "c2", pn: "D38999/26WB35PN", position: { x: 500, y: 0 }, rotation: 180 }));
  return p;
}

describe("units & colors", () => {
  it("parses lengths", () => {
    expect(parseLength("12in", "mm")).toBeCloseTo(304.8);
    expect(parseLength("300mm", "in")).toBe(300);
    expect(parseLength("1.2m", "in")).toBe(1200);
    expect(parseLength("12", "in")).toBeCloseTo(304.8);
    expect(parseLength("1ft 6in", "mm")).toBeCloseTo(457.2);
    expect(parseLength("abc", "mm")).toBeNull();
    expect(formatLength(304.8, "in")).toBe("12 in");
  });
  it("formats and parses wire colors", () => {
    expect(formatWireColor({ base: 9, stripes: [6, 2] })).toBe("9-6-2 WHT/BLU/RED");
    expect(parseWireColor("WHT/BLU")).toEqual({ base: 9, stripes: [6] });
    expect(parseWireColor("9-6-2")).toEqual({ base: 9, stripes: [6, 2] });
  });
  it("parses D38999 part numbers", () => {
    expect(parseD38999("D38999/26WB35SN")).toMatchObject({ slash: "26", finish: "W", shellSize: 11, insert: "35", contactStyle: "S", keying: "N" });
    expect(parseD38999("d38999/26 wb35sn")).not.toBeNull();
    expect(cat.connector("D38999/26WB35SN")?.arrangement.contactCount).toBe(13);
  });
});

describe("commands", () => {
  it("creates nets and wires by typing signal names (net join)", () => {
    let p = twoConnectors();
    p = apply(p, setPinSignals({ connectorId: "c1", entries: [{ cavityId: "1", name: "CAN_H" }, { cavityId: "2", name: "CAN_L" }] }));
    p = apply(p, setPinSignals({ connectorId: "c2", entries: [{ cavityId: "1", name: "CAN_H" }] }));
    const h = currentHarness(p);
    expect(h.nets).toHaveLength(2);
    expect(h.nets.find((n) => n.name === "CAN_H")!.members).toHaveLength(2);
    expect(h.wires).toHaveLength(1); // auto-commit ON
    expect(h.wires[0]!.gauge).toBe(22); // size 22D contact → 22 AWG
    expect(h.segments).toHaveLength(1); // auto-created direct segment
  });

  it("drag-to-connect merges nets", () => {
    let p = twoConnectors();
    p = apply(p, connectPins({ pairs: [{ a: { connectorId: "c1", cavityId: "3" }, b: { connectorId: "c2", cavityId: "4" } }] }));
    const h = currentHarness(p);
    expect(h.nets).toHaveLength(1);
    expect(h.wires).toHaveLength(1);
    expect(h.connectors[0]!.pins["3"]!.netId).toBe(h.nets[0]!.id);
  });

  it("ratsnest when auto-commit is off", () => {
    let p = twoConnectors();
    p = apply(p, setSettings({ autoCommit: false }));
    p = apply(p, connectPins({ pairs: [{ a: { connectorId: "c1", cavityId: "1" }, b: { connectorId: "c2", cavityId: "1" } }] }));
    const h = currentHarness(p);
    expect(h.wires).toHaveLength(0);
    expect(ratsnest(h)).toHaveLength(1);
  });

  it("undo via inverse patches restores exactly", () => {
    const p0 = twoConnectors();
    const r = applyCommand(p0, setPinSignals({ connectorId: "c1", entries: [{ cavityId: "1", name: "PWR" }] }), ctx);
    const undone = applyPatches(r.project, r.inverse);
    expect(undone).toEqual(p0);
    const redone = applyPatches(undone, r.patches);
    expect(redone).toEqual(r.project);
  });

  it("daisy chain for 3-member nets, splice topology creates splice", () => {
    let p = twoConnectors();
    p = apply(p, addConnector({ id: "c3", pn: "D38999/26WB35PN", position: { x: 500, y: 300 }, rotation: 180 }));
    p = apply(p, setPinSignals({ connectorId: "c1", entries: [{ cavityId: "1", name: "GND" }] }));
    p = apply(p, setPinSignals({ connectorId: "c2", entries: [{ cavityId: "1", name: "GND" }] }));
    p = apply(p, setPinSignals({ connectorId: "c3", entries: [{ cavityId: "1", name: "GND" }] }));
    let h = currentHarness(p);
    expect(h.wires).toHaveLength(2);
    p = apply(p, setNetProps({ ids: [h.nets[0]!.id], topology: "splice" }));
    h = currentHarness(p);
    expect(h.splices).toHaveLength(1);
    expect(h.wires).toHaveLength(3);
    expect(h.wires.every((w) => w.to.kind === "splice" || w.from.kind === "splice")).toBe(true);
  });

  it("delete wire removes the connection but keeps both pins on the net (names kept, shown as unrouted)", () => {
    let p = twoConnectors();
    p = apply(p, connectPins({ pairs: [{ a: { connectorId: "c1", cavityId: "1" }, b: { connectorId: "c2", cavityId: "1" } }] }));
    p = apply(p, deleteWires({ ids: [currentHarness(p).wires[0]!.id] }));
    let h = currentHarness(p);
    expect(h.wires).toHaveLength(0);
    expect(h.nets[0]!.members).toHaveLength(2);
    expect(h.connectors.every((c) => c.pins["1"]?.netId === h.nets[0]!.id)).toBe(true);
    expect(ratsnest(h)).toHaveLength(1);
    // committing the unrouted connection wires it again
    p = apply(p, commitRatsnest({}));
    h = currentHarness(p);
    expect(h.wires).toHaveLength(1);
    expect(ratsnest(h)).toHaveLength(0);
  });
});

describe("derivation", () => {
  it("routes through breakouts and sums lengths with allowances", () => {
    let p = twoConnectors();
    p = apply(p, connectPins({ pairs: [{ a: { connectorId: "c1", cavityId: "1" }, b: { connectorId: "c2", cavityId: "1" } }] }));
    const seg = currentHarness(p).segments[0]!;
    p = apply(p, setSegmentProps({ ids: [seg.id], lengthMm: 1000 }));
    p = apply(p, addBreakout({ segmentId: seg.id, t: 0.5, nodeId: "b1", position: { x: 250, y: 0 } }));
    const h = currentHarness(p);
    expect(h.segments).toHaveLength(2);
    const d = derive(h, cat, p.settings);
    const w = h.wires[0]!;
    expect(d.routes.get(w.id)).toHaveLength(2);
    // 1000 + 2 × 38 termination + 10 breakout
    expect(d.wireLengthMm.get(w.id)).toBe(1086);
  });

  it("bundle diameter uses k·√Σd² and layers add thickness", () => {
    let p = twoConnectors();
    p = apply(
      p,
      connectPins({
        pairs: [1, 2, 3, 4].map((i) => ({ a: { connectorId: "c1", cavityId: String(i) }, b: { connectorId: "c2", cavityId: String(i) } })),
      }),
    );
    const h0 = currentHarness(p);
    const d0 = derive(h0, cat, p.settings);
    const od = cat.wire("M22759/16", 22)!.odMm;
    expect(d0.segCoreOdMm.get(h0.segments[0]!.id)).toBeCloseTo(1.2 * Math.sqrt(4 * od * od), 5);
    p = apply(p, addLayer({ id: "L1", segmentIds: [h0.segments[0]!.id], type: "overbraid", material: "Tinned copper" }));
    const h = currentHarness(p);
    const d = derive(h, cat, p.settings);
    const core = d.segCoreOdMm.get(h.segments[0]!.id)!;
    expect(d.segOuterOdMm.get(h.segments[0]!.id)).toBeCloseTo(core + 2 * cat.layer(h.layers[0]!.pn)!.thicknessMm, 5);
    // overbraid ends at two connectors → two terminations, no clamps without a band platform backshell
    expect(h.terminations).toHaveLength(2);
  });

  it("shield preset sets per-end terminations", () => {
    let p = twoConnectors();
    p = apply(p, connectPins({ pairs: [{ a: { connectorId: "c1", cavityId: "1" }, b: { connectorId: "c2", cavityId: "1" } }, { a: { connectorId: "c1", cavityId: "2" }, b: { connectorId: "c2", cavityId: "2" } }] }));
    const ids = currentHarness(p).wires.map((w) => w.id);
    p = apply(p, shieldWires({ ids, shieldId: "s1", preset: "groundAtFirst" }));
    const h = currentHarness(p);
    const t = h.terminations.filter((x) => x.targetId === "s1").map((x) => x.method).sort();
    expect(t).toEqual(["band360", "floating"]);
  });
});
