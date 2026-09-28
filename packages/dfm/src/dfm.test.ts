import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addBoot,
  addBreakout,
  addConnector,
  addLabel,
  addLayer,
  addPotting,
  applyBatch,
  connectPins,
  currentHarness,
  newProject,
  parseProject,
  setBackshell,
  setConnectorProps,
  setNetProps,
  setPinSignals,
  seededUids,
  setQuoteSelection,
  setSegmentProps,
  setUidGenerator,
  setSettings,
  setShieldProps,
  setTermination,
  setWireProps,
  shieldWires,
  twistWires,
  updateClamp,
  updateLayer,
  type Command,
  type MachineProfile,
  type Project,
  type RuleInstance,
} from "@hs/model";
import { loadTestCatalog } from "../../model/src/test-catalog";
import { collectRules, DfmCache, parseRulesetFile, diffRuleset, RULE_TYPES, runDfm } from "./index";

const cat = loadTestCatalog();
const PUB = join(import.meta.dirname, "..", "..", "..", "apps", "web", "public", "catalog");
const profile = JSON.parse(readFileSync(join(PUB, "profile.json"), "utf8")) as MachineProfile;
const ctx = { cat, now: () => "2026-01-01T00:00:00Z" };

const run = (p: Project, cmds: Command[]) => applyBatch(p, cmds, ctx).project;

/** Fixtures reseed the id generator so building the same fixture twice yields identical ids. */
function base(pnA = "D38999/26WB35SN", pnB = "D38999/26WB35PN") {
  setUidGenerator(seededUids(`fixture-${pnA}-${pnB}`));
  return run(newProject({ now: "2026-01-01T00:00:00Z" }), [
    addConnector({ id: "A", pn: pnA, position: { x: 0, y: 0 } }),
    addConnector({ id: "B", pn: pnB, position: { x: 600, y: 0 }, rotation: 180 }),
  ]);
}
const pair = (cA: string, cB: string, a = "A", b = "B") => ({ a: { connectorId: a, cavityId: cA }, b: { connectorId: b, cavityId: cB } });

function wired(n = 2) {
  let p = base();
  p = run(p, [setPinSignals({ connectorId: "A", entries: Array.from({ length: n }, (_, i) => ({ cavityId: String(i + 1), name: `SIG_${i + 1}` })) }), setPinSignals({ connectorId: "B", entries: Array.from({ length: n }, (_, i) => ({ cavityId: String(i + 1), name: `SIG_${i + 1}` })) })]);
  return p;
}

function failing(p: Project, type: string, opts: { rules?: RuleInstance[]; qty?: number; tierDays?: number } = {}) {
  if (opts.rules) p = { ...p, projectRules: opts.rules };
  const s = runDfm({ project: p, cat, profile, qty: opts.qty, tierDays: opts.tierDays });
  return s.results.filter((r) => r.eff.rule.type === type).flatMap((r) => r.violations);
}

const prj = (type: string, params: Record<string, unknown> = {}, custom?: RuleInstance["custom"]): RuleInstance => ({ id: `PRJ-${type}`, type, category: "Test", severity: "error", title: type, description: "", rationale: "", params, enabled: true, custom });

describe("engine", () => {
  it("clean example has no manufacturability errors", () => {
    const p = parseProject(JSON.parse(readFileSync(join(PUB, "example-jumper.harness.json"), "utf8")));
    const s = runDfm({ project: p, cat, profile });
    const errs = s.results.filter((r) => r.status === "fail" && r.eff.severity === "error");
    expect(errs.map((r) => `${r.eff.rule.id}: ${r.violations[0]?.message}`)).toEqual([]);
    expect(s.manufacturability.checks).toBeGreaterThan(40);
    expect(s.manufacturability.passed).toBeGreaterThan(30);
  });

  it("branched example (shields, braid, clamps) is buildable", () => {
    const p = parseProject(JSON.parse(readFileSync(join(PUB, "example-branched.harness.json"), "utf8")));
    const s = runDfm({ project: p, cat, profile });
    const errs = s.results.filter((r) => r.status === "fail" && r.eff.severity === "error");
    expect(errs.map((r) => `${r.eff.rule.id}: ${r.violations[0]?.message}`)).toEqual([]);
  });

  it("every rule type referenced by the profile exists", () => {
    const ids = new Set(RULE_TYPES.map((t) => t.id));
    for (const r of profile.rules) expect(ids.has(r.type), r.type).toBe(true);
  });

  it("per-pedigree severity and params resolve through inheritance", () => {
    const lib = JSON.parse(readFileSync(join(PUB, "library.json"), "utf8"));
    const rs = lib.rulesets.find((r: { id: string }) => r.id === "lib-dev-cnf-flight");
    const p = { ...wired(), rulesets: [rs], pedigreeScheme: rs.pedigreeScheme };
    const dev = collectRules(p, profile, "dev").find((e) => e.rule.id === "PED-001")!;
    const flt = collectRules(p, profile, "flight").find((e) => e.rule.id === "PED-001")!;
    expect(dev.severity).toBe("off");
    expect(flt.severity).toBe("error");
    expect(flt.params.minPct).toBe(10);
  });

  it("user rules can't loosen manufacturer limits (note shown)", () => {
    const p = { ...wired(), projectRules: [prj("min_segment_length", { minMm: 10 })] };
    const e = collectRules(p, profile, "std").find((x) => x.rule.id === "PRJ-min_segment_length")!;
    expect(e.notes.join(" ")).toMatch(/Manufacturer limit is stricter/);
  });

  it("waivers move warnings out of the violation list; manufacturer errors can't be waived", () => {
    let p = wired(1);
    p = run(p, [setSettings({ autoCommit: false }), setPinSignals({ connectorId: "A", entries: [{ cavityId: "5", name: "LONELY" }] })]);
    const net = currentHarness(p).nets.find((n) => n.name === "LONELY")!;
    p = { ...p, waivers: [{ id: "w1", ruleId: "MFG-CONN-001", objectId: net.id, note: "spare", author: "", date: "2026-01-01" }] };
    const r = runDfm({ project: p, cat, profile }).results.find((x) => x.eff.rule.id === "MFG-CONN-001")!;
    expect(r.status).toBe("waived");
  });

  it("incremental cache returns identical results", () => {
    const p = wired(3);
    const cache = new DfmCache();
    const a = runDfm({ project: p, cat, profile, cache });
    const b = runDfm({ project: p, cat, profile, cache });
    expect(b.hash).toBe(a.hash);
  });

  it("DFM on a 1000-wire harness stays within budget", () => {
    let p = newProject({ now: "2026-01-01T00:00:00Z" });
    const cmds: Command[] = [];
    for (let i = 0; i < 20; i++) cmds.push(addConnector({ id: `C${i}`, pn: i % 2 ? "D38999/26WJ35PN" : "D38999/26WJ35SN", position: { x: (i % 2) * 800, y: i * 120 } }));
    p = run(p, cmds);
    const conns: Command[] = [];
    for (let i = 0; i < 20; i += 2) {
      const cavs = cat.connector("D38999/26WJ35SN")!.arrangement.cavities.slice(0, 100);
      conns.push(connectPins({ pairs: cavs.map((c) => pair(c.id, c.id, `C${i}`, `C${i + 1}`)) }));
    }
    p = run(p, conns);
    expect(currentHarness(p).wires.length).toBeGreaterThanOrEqual(900);
    const t0 = performance.now();
    runDfm({ project: p, cat, profile });
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe("rulesets", () => {
  it("parses, validates and diffs a ruleset file", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "..", "..", "data", "library", "rulesets", "example-emc.harnessrules.json"), "utf8");
    const parsed = parseRulesetFile(text);
    expect(parsed.errors).toEqual([]);
    const changed = structuredClone(parsed.ruleset!);
    changed.rules[0]!.severity = "warning";
    changed.rules.push({ ...changed.rules[0]!, id: "EMC-099", type: "no_such_type" });
    const d = diffRuleset(parsed.ruleset, changed);
    expect(d.added.map((r) => r.id)).toEqual(["EMC-099"]);
    expect(d.changed[0]!.changes[0]).toMatch(/severity error → warning/);
    expect(d.invalid.map((x) => x.id)).toContain("EMC-099");
    expect(parseRulesetFile('{"rules": [], "x": "() => 1"}').errors[0]).toMatch(/data only/);
  });
});

describe("manufacturer rule fixtures fail as expected", () => {
  const cases: [string, () => Project, Parameters<typeof failing>[2]?][] = [
    ["net_single_member", () => run(base(), [setPinSignals({ connectorId: "A", entries: [{ cavityId: "1", name: "X" }] })])],
    ["pin_unwired", () => run(base(), [setSettings({ autoCommit: false }), connectPins({ pairs: [pair("1", "1")] })])],
    ["loopback", () => run(base(), [connectPins({ pairs: [pair("1", "2", "A", "A")] })])],
    [
      "unrouted_wire",
      () => {
        const p = wired(1);
        const q = structuredClone(p);
        currentHarness(q).segments = [];
        return q;
      },
    ],
    ["gauge_vs_contact", () => run(wired(1), [setWireProps({ ids: [currentHarness(wired(1)).wires[0]!.id], gauge: 16 })])],
    [
      "gauge_vs_current",
      () => {
        const p = wired(1);
        return run(p, [setNetProps({ ids: [currentHarness(p).nets[0]!.id], currentA: 6 })]);
      },
    ],
    [
      "contact_current",
      () => {
        const p = wired(1);
        return run(p, [setNetProps({ ids: [currentHarness(p).nets[0]!.id], currentA: 6 })]);
      },
    ],
    [
      "twisted_pair_pins",
      () => {
        let p = base();
        p = run(p, [connectPins({ pairs: [pair("1", "1"), pair("13", "13")] })]);
        return run(p, [twistWires({ ids: currentHarness(p).wires.map((w) => w.id), groupId: "t" })]);
      },
    ],
    ["special_cavity", () => run(base("D38999/26WE2SN", "D38999/26WE2PN"), [connectPins({ pairs: [pair(cat.connector("D38999/26WE2SN")!.arrangement.cavities.find((c) => c.special)!.id, cat.connector("D38999/26WE2SN")!.arrangement.cavities.find((c) => c.special)!.id)] })])],
    [
      "bundle_vs_backshell_clamp",
      () => {
        const p = wired(1);
        return run(p, [setBackshell({ id: "A", backshell: { pn: "HSB-SRS-11", clockingDeg: 0, auto: false } })]);
      },
    ],
    ["min_segment_length", () => run(wired(1), [setSegmentProps({ ids: [currentHarness(wired(1)).segments[0]!.id], lengthMm: 10 })])],
    [
      "breakout_spacing",
      () => {
        let p = wired(1);
        const s = currentHarness(p).segments[0]!;
        p = run(p, [addBreakout({ segmentId: s.id, t: 0.5, nodeId: "b1", position: { x: 300, y: 0 } })]);
        const s2 = currentHarness(p).segments.find((x) => x.a === "b1" || x.b === "b1")!;
        p = run(p, [addBreakout({ segmentId: s2.id, t: 0.1, nodeId: "b2", position: { x: 320, y: 0 } })]);
        const between = currentHarness(p).segments.find((x) => [x.a, x.b].includes("b1") && [x.a, x.b].includes("b2"))!;
        return run(p, [setSegmentProps({ ids: [between.id], lengthMm: 20 })]);
      },
    ],
    [
      "bend_radius",
      () => {
        const p = wired(4);
        return run(p, [setBackshell({ id: "A", backshell: { pn: "HSB-SR90-11", clockingDeg: 0, auto: false } }), setSegmentProps({ ids: [currentHarness(p).segments[0]!.id], lengthMm: 15 })]);
      },
    ],
    ["max_wire_length", () => run(wired(1), [setSegmentProps({ ids: [currentHarness(wired(1)).segments[0]!.id], lengthMm: 7000 })])],
    ["min_wire_length", () => run(wired(1), [setSegmentProps({ ids: [currentHarness(wired(1)).segments[0]!.id], lengthMm: 20 })])],
    [
      "min_braid_segment",
      () => {
        const p = run(wired(1), [setSegmentProps({ ids: [currentHarness(wired(1)).segments[0]!.id], lengthMm: 50 })]);
        return run(p, [addLayer({ id: "L", segmentIds: [currentHarness(p).segments[0]!.id], type: "overbraid" })]);
      },
    ],
    ["connector_machine_ready", () => base("D38999/26WB13SN", "D38999/26WB13PN")],
    ["contact_machine_insertable", () => run(base("D38999/26WA23SN", "D38999/26WA23PN"), [connectPins({ pairs: [pair("1", "1")] })])],
    ["manual_topology", () => run(run(base(), [addConnector({ id: "C", pn: "D38999/26WB35PN", position: { x: 600, y: 300 } })]), [setPinSignals({ connectorId: "A", entries: [{ cavityId: "1", name: "GND" }] }), setPinSignals({ connectorId: "B", entries: [{ cavityId: "1", name: "GND" }] }), setPinSignals({ connectorId: "C", entries: [{ cavityId: "1", name: "GND" }] })])],
    ["unsupported_covering", () => run(wired(2), [addLayer({ id: "L", segmentIds: [currentHarness(wired(2)).segments[0]!.id], type: "heatShrink" })])],
    ["lifecycle", () => base("D38999/26FB35SN", "D38999/26FB35PN")],
    ["out_of_stock", () => wired(2), { qty: 10000 }],
    ["lead_time_vs_tier", () => wired(2), { qty: 10000, tierDays: 4 }],
    ["backshell_required", () => wired(1)],
    ["unreviewed_geometry", () => base("D38999/26WC35SN", "D38999/26WC35PN")],
    ["unknown_part", () => run(base(), [{ type: "setConnectorPart", payload: { id: "A", pn: "ABC-123" } }])],
    ["missing_refdes", () => run(base(), [setConnectorProps({ id: "A", refDes: "" })])],
    ["duplicate_refdes", () => run(base(), [setConnectorProps({ id: "A", refDes: "P9" }), setConnectorProps({ id: "B", refDes: "P9" })])],
    ["unnamed_nets", () => run(base(), [connectPins({ pairs: [pair("1", "1")] })])],
    ["label_length", () => run(wired(1), [addLabel({ id: "lb", attachedTo: { kind: "connector", id: "A" }, template: "{refDes} THIS IS A VERY LONG LABEL TEXT FOR A SMALL SLEEVE MARKER" })])],
    [
      "layer_size_fit",
      () => {
        const p = wired(8);
        return run(p, [addLayer({ id: "L", segmentIds: [currentHarness(p).segments[0]!.id], type: "overbraid", pn: "HSL-OB-TC-45" })]);
      },
    ],
    [
      "clamp_size_fit",
      () => {
        let p = wired(8);
        p = run(p, [setBackshell({ id: "A", backshell: { pn: "HSB-EBS-11", clockingDeg: 0, auto: false } }), addLayer({ id: "L", segmentIds: [currentHarness(p).segments[0]!.id], type: "overbraid" })]);
        return run(p, [updateClamp({ id: currentHarness(p).clamps[0]!.id, pn: "HSC-BC-XL" })]);
      },
    ],
    ["boot_size_fit", () => run(wired(8), [addBoot({ id: "bt", nodeId: currentHarness(wired(8)).nodes[0]!.id, shape: "straight", pn: "HSK-BS-6" })])],
    [
      "band360_without_platform",
      () => {
        let p = wired(2);
        p = run(p, [addLayer({ id: "L", segmentIds: [currentHarness(p).segments[0]!.id], type: "overbraid" })]);
        return run(p, [setTermination({ id: currentHarness(p).terminations[0]!.id, method: "band360" })]);
      },
    ],
    [
      "shield_unterminated",
      () => {
        const p = wired(2);
        return run(p, [shieldWires({ ids: currentHarness(p).wires.map((w) => w.id), shieldId: "s", preset: "floating" })]);
      },
    ],
    [
      "layer_stack_order",
      () => {
        const p = wired(2);
        const sid = currentHarness(p).segments[0]!.id;
        return run(p, [addLayer({ id: "J", segmentIds: [sid], type: "jacket" }), addLayer({ id: "O", segmentIds: [sid], type: "overbraid" })]);
      },
    ],
    [
      "extent_overlap",
      () => {
        const p = wired(2);
        const sid = currentHarness(p).segments[0]!.id;
        return run(p, [addLayer({ id: "S1", segmentIds: [sid], type: "sleeve" }), addLayer({ id: "S2", segmentIds: [sid], type: "sleeve" })]);
      },
    ],
    [
      "grommet_sealing",
      () => {
        const p = run(base("D38999/26WB5SN", "D38999/26WB5PN"), [connectPins({ pairs: [pair("A", "A")] })]);
        return run(p, [setWireProps({ ids: [currentHarness(p).wires[0]!.id], spec: "M22759/86", gauge: 24 })]);
      },
    ],
    ["manual_finishing", () => run(wired(1), [addPotting({ id: "pt", targetKind: "connector", targetId: "A", compoundPn: "HSP-PU-2" })])],
    [
      "drain_pin_ground",
      () => {
        let p = wired(3);
        const ids = currentHarness(p).wires.slice(0, 2).map((w) => w.id);
        p = run(p, [shieldWires({ ids, shieldId: "s", preset: "floating" })]);
        const t = currentHarness(p).terminations[0]!;
        p = run(p, [setTermination({ id: t.id, method: "drainToPin", drainPin: { connectorId: "A", cavityId: "9" }, groundNetName: "SHLD" })]);
        return run(p, [setNetProps({ ids: [currentHarness(p).nets.find((n) => n.name === "SHLD")!.id], cls: "signal" })]);
      },
    ],
    [
      "braid_coverage_min",
      () => {
        const p = wired(2);
        return run(p, [shieldWires({ ids: currentHarness(p).wires.map((w) => w.id), shieldId: "s", preset: "both360" }), setShieldProps({ id: "s", coverage: 60 })]);
      },
    ],
  ];
  for (const [type, build, opts] of cases) {
    it(type, () => {
      expect(failing(build(), type, opts).length, `${type} should fail`).toBeGreaterThan(0);
    });
  }
  it("manual_topology / max_connectors / harness_envelope / wire_machine_ready / max_bundle_od", () => {
    let p = newProject({ now: "2026-01-01T00:00:00Z" });
    p = run(
      p,
      Array.from({ length: 13 }, (_, i) => addConnector({ id: `C${i}`, pn: "D38999/26WB35SN", position: { x: i * 50, y: 0 } })),
    );
    expect(failing(p, "max_connectors").length).toBe(1);
    let q = wired(1);
    q = run(q, [setSegmentProps({ ids: [currentHarness(q).segments[0]!.id], lengthMm: 5000 })]);
    expect(failing(q, "harness_envelope").length).toBe(1);
    const r = run(base("D38999/26WB5SN", "D38999/26WB5PN"), [connectPins({ pairs: [pair("A", "A")] })]);
    expect(failing(run(r, [setWireProps({ ids: [currentHarness(r).wires[0]!.id], gauge: 10 })]), "wire_machine_ready").length).toBe(1);
    expect(failing(wired(4), "max_bundle_od", { rules: [prj("max_bundle_od", { maxMm: 1 })] }).length).toBe(1);
  });
});

describe("design rule types", () => {
  const w3 = () => wired(3);
  it("gauge_min_by_class", () => {
    const p = run(w3(), [setNetProps({ ids: [currentHarness(w3()).nets[0]!.id], cls: "power" })]);
    expect(failing(p, "gauge_min_by_class", { rules: [prj("gauge_min_by_class", { netClass: "power", maxGauge: 20 })] }).length).toBe(1);
  });
  it("required_twist / required_shield", () => {
    expect(failing(w3(), "required_twist", { rules: [prj("required_twist", { namePattern: "^SIG_1$" })] }).length).toBe(1);
    expect(failing(w3(), "required_shield", { rules: [prj("required_shield", { namePattern: "^SIG_" })] }).length).toBe(3);
  });
  it("pin_adjacency", () => {
    const p = run(w3(), [setNetProps({ ids: [currentHarness(w3()).nets.find((n) => n.name === "SIG_1")!.id], cls: "power" })]);
    expect(failing(p, "pin_adjacency", { rules: [prj("pin_adjacency", { classA: "power", classB: "signal" })] }).length).toBeGreaterThan(0);
  });
  it("segregation", () => {
    const p = run(w3(), [setNetProps({ ids: [currentHarness(w3()).nets[0]!.id], cls: "power" })]);
    expect(failing(p, "segregation", { rules: [prj("segregation", { classA: "power", classB: "signal" })] }).length).toBe(1);
  });
  it("spare_pins", () => expect(failing(wired(13), "spare_pins", { rules: [prj("spare_pins", { minPct: 10 })] }).length).toBe(2));
  it("allowed_parts", () => expect(failing(w3(), "allowed_parts", { rules: [prj("allowed_parts", { bannedFinishes: ["W"] })] }).length).toBe(2));
  it("naming", () => expect(failing(w3(), "naming", { rules: [prj("naming", { target: "net", pattern: "^[a-z]+$" })] }).length).toBe(3));
  it("required_labels", () => expect(failing(run(w3(), [{ type: "setLabelRules", payload: { connectorRefDes: false } }]), "required_labels", { rules: [prj("required_labels", { target: "connector" })] }).length).toBe(2));
  it("color_coding", () => expect(failing(w3(), "color_coding", { rules: [prj("color_coding", { namePattern: "SIG_1", color: "2" })] }).length).toBe(1));
  it("cvd_confusable", () => {
    const p = w3();
    const [a, b] = currentHarness(p).wires;
    const q = run(p, [setWireProps({ ids: [a!.id], color: { base: 2, stripes: [] } }), setWireProps({ ids: [b!.id], color: { base: 5, stripes: [] } })]);
    expect(failing(q, "cvd_confusable", { rules: [prj("cvd_confusable")] }).length).toBeGreaterThan(0);
  });
  it("max_length / max_weight / keying_unique", () => {
    expect(failing(w3(), "max_length", { rules: [prj("max_length", { target: "segment", maxMm: 100 })] }).length).toBe(1);
    expect(failing(w3(), "max_weight", { rules: [prj("max_weight", { maxG: 1 })] }).length).toBe(1);
    const p = run(base(), [addConnector({ id: "C", pn: "D38999/26WB35SN", position: { x: 0, y: 300 } })]);
    expect(failing(p, "keying_unique", { rules: [prj("keying_unique")] }).length).toBe(1);
  });
  it("derating_table", () => {
    const p = run(w3(), [setNetProps({ ids: [currentHarness(w3()).nets[0]!.id], currentA: 6 })]);
    expect(failing(p, "derating_table", { rules: [prj("derating_table", { table: { "22": 5 } })] }).length).toBe(1);
  });
  it("process rules: no_splices / no_potting / require_boots / serialized_labels / qpl_only", () => {
    const pot = run(w3(), [addPotting({ id: "pt", targetKind: "connector", targetId: "A", compoundPn: "HSP-PU-2" })]);
    expect(failing(pot, "no_potting", { rules: [prj("no_potting")] }).length).toBe(1);
    const bs = run(w3(), [setBackshell({ id: "A", backshell: { pn: "HSB-SRS-11", clockingDeg: 0, auto: false } })]);
    expect(failing(bs, "require_boots", { rules: [prj("require_boots")] }).length).toBe(1);
    expect(failing(w3(), "serialized_labels", { rules: [prj("serialized_labels")] }).length).toBe(1);
    expect(failing(bs, "qpl_only", { rules: [prj("qpl_only")] }).length).toBeGreaterThan(0);
  });
  it("custom visual rule", () => {
    const rule = prj("custom", {}, { forEach: "wire", where: [{ field: "net", op: "matches", value: "^SIG_" }], require: [{ field: "gauge", op: "lte", value: 20 }] });
    expect(failing(w3(), "custom", { rules: [rule] }).length).toBe(3);
  });
  it("switching quote quantity changes stock result", () => {
    const p = run(w3(), [setQuoteSelection({ qty: 1 })]);
    expect(failing(p, "out_of_stock").length).toBe(0);
    void updateLayer;
  });
});
