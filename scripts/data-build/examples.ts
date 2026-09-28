/** Builds the example designs (empty-state "Open example") with the real command layer, so they are always valid. */
import {
  addBreakout,
  addConnector,
  applyBatch,
  applyPreset,
  CatalogIndex,
  currentHarness,
  newProject,
  seededUids,
  setBackshell,
  setNetProps,
  setPinSignals,
  setProjectProps,
  setSegmentProps,
  setUidGenerator,
  shieldWires,
  twistWires,
  uid,
  type CatalogBundle,
  type Command,
  type FinishingPreset,
  type Project,
} from "../../packages/model/src/index";

const NOW = "2026-09-27T12:00:00.000Z";

export interface Example {
  id: string;
  name: string;
  description: string;
  project: Project;
}

function run(p: Project, cat: CatalogIndex, cmds: Command[]): Project {
  return applyBatch(p, cmds, { cat, now: () => NOW }).project;
}

function wiresFor(p: Project, names: string[]): string[] {
  const h = currentHarness(p);
  const nets = new Set(h.nets.filter((n) => names.includes(n.name)).map((n) => n.id));
  return h.wires.filter((w) => nets.has(w.netId)).map((w) => w.id);
}

export function buildExamples(bundle: CatalogBundle, _caps: Record<string, unknown>): Example[] {
  const cat = new CatalogIndex(bundle);
  const out: Example[] = [];

  // ─── Example 1: 2-connector jumper ────────────────────────────────────
  {
    const restore = setUidGenerator(seededUids("example-jumper"));
    let p = newProject({ name: "38999 jumper (example)", now: NOW });
    const P1 = uid();
    const P2 = uid();
    const signals = ["+28V_A", "+28V_RTN", "CAN_H", "CAN_L", "RS422_TX+", "RS422_TX-", "RS422_RX+", "RS422_RX-", "DISCRETE_1", "CHASSIS_GND"];
    const cav = cat.connector("D38999/26WB35SN")!.arrangement.cavities.map((c) => c.id);
    p = run(p, cat, [
      setProjectProps({ partNumber: "HS-1001" }),
      addConnector({ id: P1, pn: "D38999/26WB35SN", position: { x: 260, y: 320 }, rotation: 0 }),
      addConnector({ id: P2, pn: "D38999/26WB35PN", position: { x: 900, y: 320 }, rotation: 180 }),
      setPinSignals({ connectorId: P1, entries: signals.map((name, i) => ({ cavityId: cav[i]!, name })) }),
      setPinSignals({ connectorId: P2, entries: signals.map((name, i) => ({ cavityId: cav[i]!, name })) }),
    ]);
    const h = currentHarness(p);
    const byName = (n: string) => h.nets.find((x) => x.name === n)!.id;
    p = run(p, cat, [
      setNetProps({ ids: [byName("+28V_A"), byName("+28V_RTN")], cls: "power", currentA: 2 }),
      setNetProps({ ids: [byName("CHASSIS_GND")], cls: "ground" }),
      setSegmentProps({ ids: [currentHarness(p).segments[0]!.id], lengthMm: 914.4 }),
      twistWires({ ids: wiresFor(p, ["CAN_H", "CAN_L"]), groupId: uid() }),
      twistWires({ ids: wiresFor(p, ["RS422_TX+", "RS422_TX-"]), groupId: uid() }),
      twistWires({ ids: wiresFor(p, ["RS422_RX+", "RS422_RX-"]), groupId: uid() }),
      setBackshell({ id: P1, backshell: { pn: cat.backshellsFor(11).find((b) => b.style === "strainRelief" && b.angle === 0)!.pn, clockingDeg: 0, auto: true } }),
      setBackshell({ id: P2, backshell: { pn: cat.backshellsFor(11).find((b) => b.style === "strainRelief" && b.angle === 0)!.pn, clockingDeg: 0, auto: true } }),
    ]);
    restore();
    out.push({ id: "jumper", name: "2-connector 38999 jumper", description: "Two D38999/26 plugs, 10 signals, three twisted pairs, 36 in.", project: p });
  }

  // ─── Example 2: branched, shielded, overbraided ───────────────────────
  {
    const restore = setUidGenerator(seededUids("example-branched"));
    let p = newProject({ name: "Avionics branch harness (example)", now: NOW });
    const J1 = uid();
    const P2 = uid();
    const P3 = uid();
    const P4 = uid();
    p = run(p, cat, [
      setProjectProps({ partNumber: "HS-2040" }),
      addConnector({ id: J1, pn: "D38999/20WD35PN", position: { x: 220, y: 540 }, rotation: 0 }),
      addConnector({ id: P2, pn: "D38999/26WB35SN", position: { x: 1060, y: 120 }, rotation: 180 }),
      addConnector({ id: P3, pn: "D38999/26WC35SN", position: { x: 1060, y: 560 }, rotation: 180 }),
      addConnector({ id: P4, pn: "D38999/26WA35SN", position: { x: 1060, y: 960 }, rotation: 180 }),
    ]);
    const jc = cat.connector("D38999/20WD35PN")!.arrangement.cavities.map((c) => c.id);
    const c2 = cat.connector("D38999/26WB35SN")!.arrangement.cavities.map((c) => c.id);
    const c3 = cat.connector("D38999/26WC35SN")!.arrangement.cavities.map((c) => c.id);
    const c4 = cat.connector("D38999/26WA35SN")!.arrangement.cavities.map((c) => c.id);
    const toP2 = ["+28V_SENSOR", "SENSOR_RTN", "SENS_A+", "SENS_A-", "SENS_B+", "SENS_B-"];
    const toP3 = ["+28V_ACT", "ACT_RTN", "CAN_H", "CAN_L", "ACT_EN", "ACT_FLT", "ACT_POS+", "ACT_POS-"];
    const toP4 = ["+5V_AUX", "AUX_RTN", "AUX_TX", "AUX_RX"];
    const all = [...toP2, ...toP3, ...toP4];
    p = run(p, cat, [
      setPinSignals({ connectorId: J1, entries: all.map((name, i) => ({ cavityId: jc[i]!, name })) }),
      setPinSignals({ connectorId: P2, entries: toP2.map((name, i) => ({ cavityId: c2[i]!, name })) }),
      setPinSignals({ connectorId: P3, entries: toP3.map((name, i) => ({ cavityId: c3[i]!, name })) }),
      setPinSignals({ connectorId: P4, entries: toP4.map((name, i) => ({ cavityId: c4[i]!, name })) }),
    ]);
    // Build a trunk J1 → breakout B1, with branches to P2/P3/P4 (the auto-created direct segments are replaced).
    let h = currentHarness(p);
    const j1Node = h.nodes.find((n) => n.connectorId === J1)!.id;
    const direct = h.segments.filter((s) => s.a === j1Node || s.b === j1Node).map((s) => s.id);
    const trunk = direct[0]!;
    const B1 = uid();
    const others = direct.slice(1);
    p = run(p, cat, [addBreakout({ segmentId: trunk, t: 0.55, nodeId: B1, position: { x: 640, y: 540 } })]);
    h = currentHarness(p);
    const nodeOf = (cid: string) => h.nodes.find((n) => n.connectorId === cid)!.id;
    // Branch from B1 to the other plugs first, then drop the auto-created direct runs (routes now exist via B1).
    const branchCmds: Command[] = [];
    for (const cid of [P2, P3, P4]) {
      const has = h.segments.some((s) => (s.a === B1 && s.b === nodeOf(cid)) || (s.b === B1 && s.a === nodeOf(cid)));
      if (!has) branchCmds.push({ type: "addSegment", payload: { id: uid(), a: B1, b: nodeOf(cid), lengthMm: 457.2 } });
    }
    branchCmds.push({ type: "deleteSegments", payload: { ids: others } });
    p = run(p, cat, branchCmds);
    h = currentHarness(p);
    const byName = (n: string) => h.nets.find((x) => x.name === n)!.id;
    const segLen: Command[] = h.segments.map((s) => setSegmentProps({ ids: [s.id], lengthMm: s.a === j1Node || s.b === j1Node ? 762 : 457.2 }));
    p = run(p, cat, [
      ...segLen,
      setNetProps({ ids: ["+28V_SENSOR", "+28V_ACT", "+5V_AUX"].map(byName), cls: "power", currentA: 3 }),
      setNetProps({ ids: ["SENSOR_RTN", "ACT_RTN", "AUX_RTN"].map(byName), cls: "ground" }),
      twistWires({ ids: wiresFor(p, ["CAN_H", "CAN_L"]), groupId: uid() }),
      twistWires({ ids: wiresFor(p, ["SENS_A+", "SENS_A-"]), groupId: uid() }),
      shieldWires({ ids: wiresFor(p, ["SENS_A+", "SENS_A-"]), shieldId: uid(), preset: "groundAtFirst" }),
      twistWires({ ids: wiresFor(p, ["ACT_POS+", "ACT_POS-"]), groupId: uid() }),
    ]);
    const preset: FinishingPreset = {
      id: "overbraided",
      name: "Overbraided",
      description: "",
      steps: [
        { action: "backshells", params: { style: "emiBand" } },
        { action: "tape", params: { material: "PTFE" } },
        { action: "overbraid", params: { material: "Tinned copper", coveragePct: 85 } },
        { action: "bandClamps", params: {} },
        { action: "connectorLabels", params: {} },
      ],
    };
    p = run(p, cat, [applyPreset({ preset })]);
    restore();
    out.push({ id: "branched", name: "4-connector branched harness", description: "Receptacle to three plugs through a breakout; shielded twisted pair, overbraid, band clamps, labels.", project: p });
  }
  return out;
}
