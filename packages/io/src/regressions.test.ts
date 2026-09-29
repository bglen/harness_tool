/**
 * Regression coverage for the implementation review (harness-tool-implementation-feedback_9_28, §1 and §12).
 * Expected values are written out from the scenario (catalog cavity counts, stated limits), not produced by the
 * helper under test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  affectedParts,
  addBreakout,
  addConnector,
  applyBatch,
  applyCommand,
  buildReleaseSnapshot,
  CatalogIndex,
  combineSegments,
  CommandRejectedError,
  configureForPedigree,
  connectPins,
  currentHarness,
  currentRevision,
  derive,
  FrozenRevisionError,
  freezeRevision,
  mergeNodes,
  newProject,
  openRevision,
  parseProject,
  projectForRevision,
  reattachSegment,
  resolvePedigree,
  seededUids,
  setActivePedigree,
  setBackshell,
  setConnectorPart,
  setNetProps,
  setPedigreeScheme,
  setPinContact,
  setPinSignals,
  setProjectProps,
  setSegmentProps,
  setSettings,
  setTermination,
  setUidGenerator,
  sha256HexSync,
  shieldWires,
  stableStringify,
  UnsupportedSchemaError,
  validateProject,
  verifyRelease,
  type CatalogBundle,
  type Command,
  type Harness,
  type InspectionType,
  type MachineProfile,
  type PedigreeScheme,
  type Project,
  type RuleInstance,
  type Ruleset,
} from "@hs/model";
import { DfmCache, runDfm, violationKey, type DfmSummary } from "@hs/dfm";
import { buildQuoteSummary, computeBom, deriveOperations, purchaseQty, summaryHash } from "@hs/ops";
import { loadTestCatalog } from "../../model/src/test-catalog";
import { toCsv, wireListTable } from "./index";

const cat = loadTestCatalog();
const PUB = join(import.meta.dirname, "..", "..", "..", "apps", "web", "public", "catalog");
const profile = JSON.parse(readFileSync(join(PUB, "profile.json"), "utf8")) as MachineProfile;
const inspections = JSON.parse(readFileSync(join(PUB, "inspections.json"), "utf8")) as InspectionType[];
const AT = "2026-01-01T00:00:00Z";
const ctx = { cat, now: () => AT };
const run = (p: Project, cmds: Command[]) => applyBatch(p, cmds, ctx).project;

const SOCKET = "D38999/26WB35SN"; // 11-35, socket contacts
const PIN = "D38999/26WB35PN";

function base(seed = "reg") {
  setUidGenerator(seededUids(seed));
  return run(newProject({ now: AT }), [addConnector({ id: "A", pn: SOCKET, position: { x: 0, y: 0 } }), addConnector({ id: "B", pn: PIN, position: { x: 600, y: 0 }, rotation: 180 })]);
}
function wired(n: number, seed?: string) {
  const entries = Array.from({ length: n }, (_, i) => ({ cavityId: String(i + 1), name: `SIG_${i + 1}` }));
  return run(base(seed), [setPinSignals({ connectorId: "A", entries }), setPinSignals({ connectorId: "B", entries })]);
}
const byRule = (s: DfmSummary) => Object.fromEntries(s.results.map((r) => [r.eff.rule.id, `${r.status}:${r.violations.length}:${r.violations.map((v) => v.message).join("|")}`]));
const rule = (over: Partial<RuleInstance> & Pick<RuleInstance, "id" | "type">): RuleInstance => ({ category: "Test", severity: "error", title: over.id, description: "", rationale: "", params: {}, enabled: true, ...over });

const SCHEME: PedigreeScheme = {
  id: "t",
  name: "Test scheme",
  version: "1.0.0",
  pedigrees: [
    { id: "std", name: "Standard", code: "STD", rank: 0, color: 1, description: "", inspections: [{ typeId: "continuity", sampling: "100%", params: { maxOhm: 1 } }] },
    { id: "flt", name: "Flight", code: "FLT", rank: 1, color: 2, extends: "std", description: "", process: { requireBoots: true }, markings: [{ text: "FLIGHT", type: "label" }] },
  ],
};

function withBackshells(p: Project) {
  const bs = cat.backshellsFor(cat.connector(SOCKET)!.shellSize).find((b) => b.style === "strainRelief" && b.angle === 0)!;
  return run(p, [setBackshell({ id: "A", backshell: { pn: bs.pn, clockingDeg: 0, auto: true } }), setBackshell({ id: "B", backshell: { pn: bs.pn, clockingDeg: 0, auto: true } })]);
}

describe("FIX-01 released revisions are immutable", () => {
  it("freeze A, change settings/rules/pedigrees in B, reopen A: content and outputs unchanged", () => {
    let p = withBackshells(wired(2, "fix01"));
    p = run(p, [setPedigreeScheme({ scheme: SCHEME, activeId: "std" })]);
    const release = buildReleaseSnapshot(p, { at: AT, tool: "test", cat, profile, inspections });
    p = run(p, [freezeRevision({ notes: "first", newRevisionId: "revB", release, at: AT })]);
    const revA = p.revisions[0]!;
    const before = stableStringify(revA);
    const csvBefore = toCsv(wireListTable(projectForRevision(p, revA.id), cat, revA));

    const changed: PedigreeScheme = { ...SCHEME, pedigrees: SCHEME.pedigrees.map((x) => ({ ...x, markings: [{ text: "CHANGED", type: "label" as const }] })) };
    p = run(p, [setSettings({ serviceLoopMm: 500 }), setPedigreeScheme({ scheme: changed }), setActivePedigree({ id: "flt" }), { type: "upsertProjectRule", payload: { rule: rule({ id: "PRJ-1", type: "max_length", params: { target: "wire", maxMm: 10 } }) } }]);
    p = run(p, [openRevision({ id: revA.id })]);
    expect(stableStringify(p.revisions[0])).toBe(before);

    // Switching build class on a released revision is refused; editing the scheme while it's open doesn't touch it.
    expect(() => run(p, [setActivePedigree({ id: "flt" })])).toThrow(FrozenRevisionError);
    p = run(p, [setPedigreeScheme({ scheme: { ...changed, pedigrees: changed.pedigrees.slice(0, 1) } })]);
    expect(stableStringify(p.revisions[0])).toBe(before);

    const view = projectForRevision(p, revA.id);
    expect(view.settings.serviceLoopMm).toBe(0);
    expect(view.projectRules).toEqual([]);
    expect(view.pedigreeScheme.pedigrees.map((x) => x.id)).toEqual(["std", "flt"]);
    expect(toCsv(wireListTable(view, cat, currentRevision(view)))).toBe(csvBefore);
    expect(verifyRelease(p.revisions[0]!)).toEqual({ ok: true, problems: [] });
    // The working revision did pick up the change.
    const b = p.revisions.find((r) => r.id === "revB")!;
    expect(toCsv(wireListTable({ ...p, currentRevisionId: "revB" }, cat, b))).not.toBe(csvBefore);
  });

  it("tampering with released content is detected", () => {
    let p = wired(1, "fix01b");
    p = run(p, [freezeRevision({ notes: "", newRevisionId: "revB", release: buildReleaseSnapshot(p, { at: AT, tool: "test", cat, profile }), at: AT })]);
    const q = structuredClone(p);
    q.revisions[0]!.harness.segments[0]!.lengthMm += 1;
    expect(verifyRelease(q.revisions[0]!).ok).toBe(false);
  });

  it("SHA-256 matches the FIPS 180-4 test vector", () => {
    expect(sha256HexSync("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256HexSync("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("FIX-02 checks that can't run never pass", () => {
  it("every built-in manufacturer rule actually runs on the examples and a 3-connector star", () => {
    setUidGenerator(seededUids("star"));
    const star = run(newProject({ now: AT }), [
      addConnector({ id: "A", pn: SOCKET, position: { x: 0, y: 0 } }),
      addConnector({ id: "B", pn: PIN, position: { x: 900, y: -300 }, rotation: 180 }),
      addConnector({ id: "C", pn: PIN, position: { x: 900, y: 300 }, rotation: 180 }),
      connectPins({ pairs: [1, 2].map((i) => ({ a: { connectorId: "A", cavityId: String(i) }, b: { connectorId: "B", cavityId: String(i) } })) }),
      connectPins({ pairs: [3, 4].map((i) => ({ a: { connectorId: "A", cavityId: String(i) }, b: { connectorId: "C", cavityId: String(i - 2) } })) }),
    ]);
    const projects = [star, ...["example-jumper", "example-branched"].map((f) => parseProject(JSON.parse(readFileSync(join(PUB, `${f}.harness.json`), "utf8"))))];
    for (const p of projects) {
      const s = runDfm({ project: p, cat, profile, cache: new DfmCache() });
      expect(s.results.filter((r) => r.status === "engineError" || r.status === "missingInput").map((r) => `${r.eff.rule.id}: ${r.error}`)).toEqual([]);
    }
  });

  it("unknown rule type → engineError, blocks ready", () => {
    const p = wired(1, "fix02");
    const bad: MachineProfile = { ...profile, rules: [...profile.rules, rule({ id: "MFG-X-001", type: "no_such_rule", title: "Broken rule" })] };
    const ok = runDfm({ project: p, cat, profile });
    const s = runDfm({ project: p, cat, profile: bad });
    const r = s.results.find((x) => x.eff.rule.id === "MFG-X-001")!;
    expect(r.status).toBe("engineError");
    expect(s.manufacturability.incomplete).toBe(ok.manufacturability.incomplete + 1);
    expect(s.manufacturability.status).not.toBe("ready");
    expect(s.manufacturability.blockers.join(" ")).toMatch(/MFG-X-001/);
  });

  it("a missing numeric limit is missingInput, not a pass", () => {
    const p = { ...wired(1, "fix02b"), projectRules: [rule({ id: "PRJ-L", type: "max_length", params: { target: "wire" } })] };
    const s = runDfm({ project: p, cat, profile });
    expect(s.results.find((x) => x.eff.rule.id === "PRJ-L")!.status).toBe("missingInput");
    expect(s.design.incomplete).toBe(1);
    expect(s.manufacturability.status).not.toBe("ready");
  });

  it("an unsafe regex is an engine error, not a silent pass", () => {
    const p = { ...wired(1, "fix02c"), projectRules: [rule({ id: "PRJ-N", type: "naming", params: { target: "net", pattern: "(a+)+$" } })] };
    expect(runDfm({ project: p, cat, profile }).results.find((x) => x.eff.rule.id === "PRJ-N")!.status).toBe("engineError");
  });
});

describe("FIX-03 cached and fresh evaluations agree after every kind of edit", () => {
  it("settings, topology, parts, requirements, profile and catalog", () => {
    const cache = new DfmCache();
    let p = wired(2, "fix03");
    const seg = currentHarness(p).segments[0]!.id;
    const check = (proj: Project, prof = profile, c: CatalogIndex = cat) => {
      const warm = runDfm({ project: proj, cat: c, profile: prof, cache });
      const fresh = runDfm({ project: proj, cat: c, profile: prof });
      expect(byRule(warm)).toEqual(byRule(fresh));
      return warm;
    };
    check(p);
    // The reported defect: a 10 m service loop must fail the machine's maximum wire length.
    p = run(p, [setSettings({ serviceLoopMm: 10000 })]);
    const s = check(p);
    expect(s.results.find((r) => r.eff.rule.type === "max_wire_length" && r.eff.source.layer === "manufacturer")!.status).toBe("fail");
    p = run(p, [setSettings({ serviceLoopMm: 0 })]);
    check(p);
    p = run(p, [setSegmentProps({ ids: [seg], lengthMm: 5000 })]);
    check(p);
    p = run(p, [setConnectorPart({ id: "B", pn: "D38999/26WD35PN" })]);
    check(p);
    p = { ...p, projectRules: [rule({ id: "PRJ-W", type: "max_length", params: { target: "wire", maxMm: 100 } })] };
    check(p);
    const strict: MachineProfile = { ...profile, rules: profile.rules.map((r) => (r.type === "max_wire_length" ? { ...r, params: { maxMm: 50 } } : r)) };
    expect(check(p, strict).manufacturability.errors).toBeGreaterThan(0);
    const fat = new CatalogIndex({ ...cat.bundle, version: { hash: "variant", date: "2026-01-01" }, wires: cat.bundle.wires.map((w) => ({ ...w, odMm: w.odMm * 4 })) } as CatalogBundle);
    check(p, profile, fat);
  });
});

describe("FIX-04 obligations are evaluated independently", () => {
  it("a stricter project warning doesn't remove an enforced ruleset error", () => {
    const rs: Ruleset = { schemaVersion: 1, id: "cust", name: "Customer", prefix: "CUS", version: "1.0.0", author: "", description: "", changelog: [], enforced: true, rules: [rule({ id: "CUS-001", type: "max_length", severity: "error", params: { target: "wire", maxMm: 100 } })] };
    const p = { ...wired(1, "fix04"), rulesets: [rs], projectRules: [rule({ id: "PRJ-001", type: "max_length", severity: "warning", params: { target: "wire", maxMm: 50 } })] };
    const s = runDfm({ project: p, cat, profile });
    expect(s.results.find((r) => r.eff.rule.id === "CUS-001")!.status).toBe("fail");
    expect(s.results.find((r) => r.eff.rule.id === "PRJ-001")!.status).toBe("fail");
    expect(s.design.errors).toBe(1);
    expect(s.design.warnings).toBe(1);
  });
});

describe("FIX-05 drain conductors and shield material", () => {
  it("drain-to-pin creates a conductor + contact, isn't plugged, and shield braid is in the BOM", () => {
    let p = wired(2, "fix05");
    const h0 = currentHarness(p);
    p = run(p, [shieldWires({ ids: h0.wires.map((w) => w.id), shieldId: "SH1" })]);
    const nodeA = currentHarness(p).nodes.find((n) => n.connectorId === "A")!.id;
    const term = currentHarness(p).terminations.find((t) => t.targetId === "SH1" && t.nodeId === nodeA)!;
    p = run(p, [setTermination({ id: term.id, method: "drainToPin", drainPin: { connectorId: "A", cavityId: "9" }, groundNetName: "SHLD" })]);
    const h = currentHarness(p);
    const refA = h.connectors.find((c) => c.id === "A")!.refDes;
    const refB = h.connectors.find((c) => c.id === "B")!.refDes;
    const cavities = cat.connector(SOCKET)!.arrangement.cavities.length; // 13 for insert 11-35
    const bom = computeBom(p, currentRevision(p), cat);
    const contactRefs = bom.lines.filter((l) => l.category === "Contacts").flatMap((l) => l.refs);
    expect(contactRefs.filter((r) => r.startsWith(`${refA}-`)).sort()).toEqual([`${refA}-1`, `${refA}-2`, `${refA}-9 (drain)`]);
    const plugs = bom.lines.filter((l) => l.category === "Sealing plugs").reduce((a, l) => a + l.qty, 0);
    expect(plugs).toBe(cavities - 3 + (cavities - 2));
    // The drain is the same wire material as the signals here, so it shares their BOM line: +75 mm default pigtail.
    const drain = bom.lines.find((l) => l.category === "Wire" && l.refs.some((r) => r.startsWith("drain")))!;
    const d = derive(h, cat, p.settings, { breakoutAllowanceMm: profile.capabilities.breakoutAllowanceMm });
    const signals = h.wires.filter((w) => drain.refs.includes(w.label)).reduce((a, w) => a + d.wireLengthMm.get(w.id)! / 1000, 0);
    expect(drain.qty - signals).toBeCloseTo(0.075, 6);
    expect(bom.lines.some((l) => l.category === "Shielding" && l.qty > 0)).toBe(true);
    const ops = deriveOperations(p, currentRevision(p), cat, profile, resolvePedigree(p.pedigreeScheme, "std"), inspections);
    expect(ops.ops.some((o) => o.kind === "drainTermination")).toBe(true);
    expect(ops.ops.find((o) => o.kind === "contactCrimpInsert" && o.refs.includes(`${refA}-9`))).toBeTruthy();
    const sealing = runDfm({ project: p, cat, profile }).results.find((r) => r.eff.rule.type === "sealed_cavities")!;
    expect(sealing.violations.map((v) => v.message).join(" ")).not.toMatch(new RegExp(`${refA}-9`));
    expect(refB).toBeTruthy();
  });
});

describe("FIX-06 contact compatibility is validated at the model boundary", () => {
  it("M39029/58-360 (pin) on a D38999/26WB35SN cavity is refused, and flagged when it arrives in a file", () => {
    const p = wired(1, "fix06");
    expect(() => applyCommand(p, setPinContact({ connectorId: "A", cavityIds: ["1"], contactPn: "M39029/58-360" }), ctx)).toThrow(CommandRejectedError);
    const q = structuredClone(p);
    currentHarness(q).connectors.find((c) => c.id === "A")!.pins["1"]!.contactPn = "M39029/58-360";
    const r = runDfm({ project: q, cat, profile }).results.find((x) => x.eff.rule.type === "contact_compatibility")!;
    expect(r.status).toBe("fail");
    expect(r.eff.severity).toBe("error");
    expect(r.violations[0]!.message).toMatch(/pin contact in a socket insert/);
  });
});

describe("FIX-07 inspection requirements keep their identity", () => {
  const scheme: PedigreeScheme = {
    ...SCHEME,
    pedigrees: [
      { id: "std", name: "Standard", code: "STD", rank: 0, color: 1, description: "", inspections: [{ typeId: "continuity", sampling: "100%", params: { maxOhm: 1 } }, { typeId: "hipot", sampling: "100%", params: { voltage: 1500 } }, { typeId: "tempcycle", sampling: "100%", params: { cycles: 10 } }] },
    ],
  };
  const summaryFor = (p: Project) => {
    const rev = currentRevision(p);
    const ped = resolvePedigree(p.pedigreeScheme, "std");
    const ops = deriveOperations(p, rev, cat, profile, ped, inspections);
    return { ops, s: buildQuoteSummary(computeBom(p, rev, cat), ops, ped, { mfgErrors: 0, mfgWarnings: 0, designErrors: 0, incomplete: 0, review: 0, hash: "h", nonStock: 0 }, { connectors: 2, uniqueConnectors: 2, wires: 1, wireLengthM: 1, massG: 1 }) };
  };
  it("unknown inspections are kept and flagged; params travel; inHouse ≠ automated", () => {
    const p = { ...wired(1, "fix07"), pedigreeScheme: scheme };
    const { ops, s } = summaryFor(p);
    expect(ops.unsupportedInspections).toEqual(["tempcycle"]);
    expect(s.ops.find((o) => o.inspectionId === "tempcycle")).toMatchObject({ unsupported: true, params: { cycles: 10 } });
    const hipot = ops.ops.find((o) => o.inspectionId === "hipot")!;
    expect(hipot).toMatchObject({ inHouse: true, automated: false, params: { voltage: 1500, mode: "DC" } });
    expect(ops.ops.find((o) => o.kind === "test")!.params).toMatchObject({ maxOhm: 1 });
  });
  it("changing a continuity limit changes the requirement identity", () => {
    const p = { ...wired(1, "fix07b"), pedigreeScheme: scheme };
    const tighter = structuredClone(scheme);
    tighter.pedigrees[0]!.inspections![0]!.params = { maxOhm: 0.5 };
    expect(summaryHash(summaryFor({ ...p, pedigreeScheme: tighter }).s)).not.toBe(summaryHash(summaryFor(p).s));
  });
});

describe("FIX-08 qualification needs explicit evidence", () => {
  it("a QPL-looking PN without a record is unverified; records qualify; expired records don't", () => {
    const p = wired(1, "fix08");
    const line = (c: CatalogIndex) => computeBom(p, currentRevision(p), c).lines.find((l) => l.pn === SOCKET)!;
    expect(line(cat).qualification.status).toBe("unverified");
    const withEvidence = new CatalogIndex({ ...cat.bundle, qualifications: [{ pn: SOCKET, specification: "MIL-DTL-38999", source: "Test source", evidence: "QPL listing (test)", reviewedBy: "test" }] } as CatalogBundle);
    expect(line(withEvidence).qualification).toEqual({ status: "qualified", source: "Test source" });
    const expired = new CatalogIndex({ ...cat.bundle, qualifications: [{ pn: "D38999/26*", specification: "MIL-DTL-38999", source: "Old", evidence: "x", validUntil: "2000-01-01", reviewedBy: "t" }] } as CatalogBundle);
    expect(line(expired).qualification.status).toBe("expired");
    const s = runDfm({ project: p, cat, profile, pedigreeId: "std" });
    expect(s.results.some((r) => r.eff.rule.type === "qpl_only")).toBe(false); // only when the pedigree requires it
    expect(cat.connector(SOCKET)!.manufacturer).not.toMatch(/QPL/);
  });
});

describe("FIX-09 coverings stack per interval", () => {
  it("1.32 mm core with two disjoint 0.4 mm sleeves has max OD 2.12 mm", () => {
    const c2 = new CatalogIndex({
      ...cat.bundle,
      wires: [...cat.bundle.wires, { ...cat.bundle.wires[0]!, spec: "TEST/1", gauge: 22, odMm: 1.32 }],
      layers: [...cat.bundle.layers, { pn: "TEST-SLV", type: "sleeve", material: "test", description: "test sleeve", minDiaMm: 0.5, maxDiaMm: 10, thicknessMm: 0.4, massGPerM: 1, machineReady: true, status: "seed" }],
    } as CatalogBundle);
    const h = {
      connectors: [],
      nodes: [
        { id: "n1", kind: "breakout", position: { x: 0, y: 0 } },
        { id: "n2", kind: "breakout", position: { x: 300, y: 0 } },
      ],
      segments: [{ id: "s", a: "n1", b: "n2", lengthMm: 300, lengthSource: "confirmed", toleranceMm: 10, label: "" }],
      nets: [{ id: "net", name: "N", cls: "signal", topology: "daisy", topologyConfirmed: false, members: [] }],
      wires: [{ id: "w", label: "W1", netId: "net", from: { kind: "splice", spliceId: "sp1" }, to: { kind: "splice", spliceId: "sp2" }, spec: "TEST/1", gauge: 22, color: { base: 9, stripes: [] }, pinned: [], extraLengthMm: 0 }],
      splices: [
        { id: "sp1", label: "SP1", netId: "net", nodeId: "n1", type: "crimp", pn: "", cover: "heatShrink", pinned: false },
        { id: "sp2", label: "SP2", netId: "net", nodeId: "n2", type: "crimp", pn: "", cover: "heatShrink", pinned: false },
      ],
      layers: [
        { id: "L1", type: "sleeve", pn: "TEST-SLV", material: "test", extents: [{ segmentId: "s", startMm: 0, endMm: 100 }], stackOrder: 1, params: {}, auto: false, pinned: true },
        { id: "L2", type: "sleeve", pn: "TEST-SLV", material: "test", extents: [{ segmentId: "s", startMm: 200, endMm: 300 }], stackOrder: 2, params: {}, auto: false, pinned: true },
      ],
      cables: [],
      twistGroups: [],
      shields: [],
      terminations: [],
      clamps: [],
      boots: [],
      potting: [],
      labels: [],
      hardware: [],
      notes: [],
      labelRules: { connectorRefDes: false, wireIds: false, harnessId: false, pedigreeMarkings: false },
      suppressedAuto: [],
    } as unknown as Harness;
    const d = derive(h, c2, { packingFactor: 1.2, serviceLoopMm: 0, cutResolutionMm: 1 });
    expect(d.segCoreOdMm.get("s")).toBeCloseTo(1.32, 9);
    expect(d.segOuterOdMm.get("s")).toBeCloseTo(2.12, 9);
    // Endpoint queries see the local stack: both ends carry one sleeve; the middle carries none.
    const iv = d.segIntervals.get("s")!;
    expect(iv.map((x) => +x.odMm.toFixed(2))).toEqual([2.12, 1.32, 2.12]);
  });
});

describe("FIX-10 unreviewed geometry can't be machine-ready", () => {
  it("an unreviewed insert isn't machine-ready and the design can't be claimed ready", () => {
    expect(cat.connector(SOCKET)!.arrangement.status).not.toBe("verified");
    expect(cat.connector(SOCKET)!.machineReady).toBe(false);
    const s = runDfm({ project: wired(1, "fix10"), cat, profile });
    expect(s.results.find((r) => r.eff.rule.type === "connector_machine_ready")!.violations[0]!.message).toMatch(/geometry unreviewed/);
    expect(s.manufacturability.status).not.toBe("ready");
    expect(s.manufacturability.review).toBeGreaterThan(0);
  });
});

describe("pedigree comparison resolves each candidate's construction", () => {
  it("a class that requires boots gets boots in its own configuration; the stored design is untouched", () => {
    const p = run(withBackshells(wired(1, "ped")), [setPedigreeScheme({ scheme: SCHEME, activeId: "std" })]);
    const flt = configureForPedigree(p, "flt", cat);
    expect(currentHarness(p).boots).toHaveLength(0);
    expect(currentHarness(flt).boots).toHaveLength(2);
    expect(computeBom(flt, currentRevision(flt), cat).lines.some((l) => l.category === "Boots")).toBe(true);
    expect(computeBom(p, currentRevision(p), cat).lines.some((l) => l.category === "Boots")).toBe(false);
  });
});

describe("normalization reports instead of silently repairing", () => {
  it("duplicate memberships in a file are diagnosed on open and reported when repaired", () => {
    const p = wired(2, "norm");
    const q = structuredClone(p);
    const h = currentHarness(q);
    h.nets[1]!.members.push({ ...h.nets[0]!.members[0]! });
    const diags = validateProject(q, cat);
    expect(diags.some((d) => d.severity === "error" && /is also on net/.test(d.message))).toBe(true);
    const r = applyCommand(q, setProjectProps({ name: "x" }), ctx);
    expect(r.repairs.join(" ")).toMatch(/was on both/);
  });
  it("auto-created routes are flagged as default lengths", () => {
    const s = runDfm({ project: wired(1, "norm2"), cat, profile });
    expect(s.results.find((r) => r.eff.rule.type === "assumed_dimensions")!.status).toBe("fail");
  });
});

describe("sealing check is real", () => {
  it("flags a contact without a conductor and two wires in one hole; confirmed daisy chains clear the topology error", () => {
    let p = wired(1, "seal");
    const socket22 = cat.contactFor("22D", "socket")!.pn;
    p = run(p, [setPinContact({ connectorId: "A", cavityIds: ["5"], contactPn: socket22 })]);
    p = run(p, [setPinSignals({ connectorId: "A", entries: [{ cavityId: "2", name: "SIG_1" }] })]);
    const s = runDfm({ project: p, cat, profile });
    const msg = s.results.find((r) => r.eff.rule.type === "sealed_cavities")!.violations.map((v) => v.message).join(" ");
    expect(msg).toMatch(/-5: contact specified but no conductor/);
    expect(msg).toMatch(/2 conductors in one grommet hole/);
    expect(s.results.find((r) => r.eff.rule.type === "net_topology")!.status).toBe("fail");
    const net = currentHarness(p).nets.find((n) => n.name === "SIG_1")!;
    const t = runDfm({ project: run(p, [setNetProps({ ids: [net.id], topology: "daisy" })]), cat, profile });
    expect(t.results.find((r) => r.eff.rule.type === "net_topology")!.status).toBe("pass");
  });
});

describe("multi-pin nets: parallel wires", () => {
  const net3x3 = (bPins = ["4", "5", "6"]) =>
    run(base("par"), [setPinSignals({ connectorId: "A", entries: ["1", "2", "3"].map((c) => ({ cavityId: c, name: "GND" })) }), setPinSignals({ connectorId: "B", entries: bPins.map((c) => ({ cavityId: c, name: "GND" })) })]);
  const rule = (p: Project, type: string) => runDfm({ project: p, cat, profile }).results.find((r) => r.eff.rule.type === type)!;

  it("3 pins on each of two connectors are wired pin-to-pin, with no splice, double crimp or finding", () => {
    const p = net3x3();
    const h = currentHarness(p);
    const ends = h.wires.map((w) => [w.from, w.to].map((e) => (e.kind === "pin" ? `${e.connectorId}${e.cavityId}` : "splice")).sort().join("-")).sort();
    expect(ends).toEqual(["A1-B4", "A2-B5", "A3-B6"]);
    expect(h.splices).toHaveLength(0);
    expect(rule(p, "net_topology").status).toBe("pass");
    expect(rule(p, "manual_topology").status).toBe("pass");
    expect(rule(p, "sealed_cavities").violations.map((v) => v.message).join(" ")).not.toMatch(/grommet hole/);
  });

  it("unequal counts or 3+ connectors still need a splice or a confirmed daisy chain", () => {
    expect(rule(net3x3(["4", "5"]), "net_topology").status).toBe("fail");
    const three = run(net3x3(["4"]), [addConnector({ id: "C", pn: PIN, position: { x: 600, y: 400 }, rotation: 180 }), setPinSignals({ connectorId: "C", entries: [{ cavityId: "1", name: "GND" }] })]);
    const r = rule(three, "net_topology");
    expect(r.status).toBe("fail");
    expect(r.violations[0]!.message).toMatch(/spans 3 connectors/);
  });

  it("an explicit choice wins, and parallel is refused when the pins can't pair up", () => {
    const p = net3x3();
    const net = currentHarness(p).nets[0]!;
    const daisy = run(p, [setNetProps({ ids: [net.id], topology: "daisy" })]);
    expect(currentHarness(daisy).wires).toHaveLength(5);
    const q = net3x3(["4", "5"]);
    expect(() => run(q, [setNetProps({ ids: [currentHarness(q).nets[0]!.id], topology: "parallel" })])).toThrow(/two connectors with the same count/);
  });
});

describe("wires follow the connections as drawn", () => {
  const pin = (c: string, cav: string) => ({ connectorId: c, cavityId: cav });
  const wiresOf = (p: Project) => currentHarness(p).wires.map((w) => [w.from, w.to].map((e) => (e.kind === "pin" ? `${e.connectorId}${e.cavityId}` : "sp")).join("-")).sort();

  it("looping a pin back into its own connector keeps its existing run", () => {
    let p = run(base("loop"), [connectPins({ pairs: [{ a: pin("A", "1"), b: pin("B", "1") }] })]);
    expect(wiresOf(p)).toEqual(["A1-B1"]);
    p = run(p, [connectPins({ pairs: [{ a: pin("A", "1"), b: pin("A", "5") }] })]);
    expect(wiresOf(p)).toEqual(["A1-A5", "A1-B1"]);
    const s = runDfm({ project: p, cat, profile });
    expect(s.results.find((r) => r.eff.rule.type === "net_topology")!.status).toBe("pass"); // drawn = chosen
    expect(s.results.find((r) => r.eff.rule.type === "manual_topology")!.violations[0]!.message).toMatch(/two wires crimped in one contact/);
  });

  it("a stand-alone loopback on one connector is a single wire", () => {
    const p = run(base("loop2"), [connectPins({ pairs: [{ a: pin("A", "11"), b: pin("A", "13") }] })]);
    expect(wiresOf(p)).toEqual(["A11-A13"]);
    expect(runDfm({ project: p, cat, profile }).results.find((r) => r.eff.rule.type === "loopback")!.violations).toHaveLength(1);
  });

  it("deleting the loopback wire leaves the original run", () => {
    let p = run(base("loop3"), [connectPins({ pairs: [{ a: pin("A", "1"), b: pin("B", "1") }] }), connectPins({ pairs: [{ a: pin("A", "1"), b: pin("A", "5") }] })]);
    const loop = currentHarness(p).wires.find((w) => w.to.kind === "pin" && w.from.kind === "pin" && w.from.connectorId === "A" && w.to.connectorId === "A")!;
    p = run(p, [{ type: "deleteWires", payload: { ids: [loop.id] } }]);
    expect(wiresOf(p)).toEqual(["A1-B1"]);
  });
});

describe("waivers target one finding", () => {
  const backshell = (p: Project) => runDfm({ project: p, cat, profile }).results.find((r) => r.eff.rule.id === "MFG-CMP-004")!;
  const waive = (p: Project, v: { objectIds: string[]; message: string }, author = "J. Engineer") =>
    run(p, [{ type: "addWaiver", payload: { waiver: { id: `w-${v.objectIds.join("")}`, ruleId: "MFG-CMP-004", objectId: v.objectIds[0]!, violationKey: violationKey(v), message: v.message, note: "customer supplies backshell", author, date: "2026-09-28" } } }]);

  it("waiving one finding leaves the rule's other findings open, and records who waived it", () => {
    const p = wired(1, "waive");
    const r0 = backshell(p);
    expect(r0.violations).toHaveLength(2); // A and B have no backshell
    const q = waive(p, r0.violations[0]!);
    const r1 = backshell(q);
    expect(r1.status).toBe("fail");
    expect(r1.violations).toHaveLength(1);
    expect(r1.waived).toHaveLength(1);
    expect(r1.waived[0]).toMatchObject({ author: "J. Engineer", date: "2026-09-28", note: "customer supplies backshell", changed: false });
    const s = runDfm({ project: q, cat, profile });
    expect(s.waivedByObject[r0.violations[0]!.objectIds[0]!]).toMatchObject({ count: 1 });
  });

  it("a waiver whose finding is fixed is reported as unmatched; engineer name is required", () => {
    const p = wired(1, "waive2");
    const v = backshell(p).violations.find((x) => x.objectIds.includes("A"))!;
    let q = waive(p, v);
    q = withBackshells(q);
    const s = runDfm({ project: q, cat, profile });
    expect(s.unmatchedWaivers).toEqual([`w-${v.objectIds.join("")}`]);
    expect(() => waive(p, v, "  ")).toThrow(/engineer/);
  });

  it("a finding shared by two connectors can be waived for one of them only", () => {
    const p = withBackshells(wired(1, "waive4")); // same backshell PN on A and B → one shared reference-data finding
    const find = (proj: Project) => runDfm({ project: proj, cat, profile }).results.find((r) => r.eff.rule.type === "reference_data_status")!;
    const shared = find(p).violations.find((v) => v.objectIds.includes("A") && v.objectIds.includes("B"))!;
    expect(shared).toBeTruthy();
    const q = run(p, [{ type: "addWaiver", payload: { waiver: { id: "wA", ruleId: find(p).eff.rule.id, objectId: "A", violationKey: violationKey(shared), scopeObjectId: "A", message: shared.message, note: "reviewed for A", author: "J. Engineer", date: "2026-09-28" } } }]);
    const r = find(q);
    const open = r.violations.find((v) => v.message === shared.message)!;
    expect(open.objectIds).toContain("B");
    expect(open.objectIds).not.toContain("A");
    expect(r.waived.find((w) => w.message === shared.message)!.objectIds).toEqual(["A"]);
    const s = runDfm({ project: q, cat, profile });
    expect(s.waivedByObject.A?.count).toBe(1);
    expect(s.waivedByObject.B).toBeUndefined();
    expect(affectedParts(currentHarness(q), open.objectIds)).toMatch(/^P\d+$|^J\d+$/);
  });

  it("legacy rule-wide waivers ('*') still apply", () => {
    const p = { ...wired(1, "waive3"), waivers: [{ id: "old", ruleId: "MFG-CMP-004", objectId: "*", note: "legacy", author: "", date: "2026-01-01" }] };
    expect(backshell(p).status).toBe("waived");
  });
});

describe("BOM arithmetic", () => {
  it("keeps engineering quantities unrounded and rounds purchases up", () => {
    const p = wired(1, "bom");
    const rev = currentRevision(p);
    const d = derive(rev.harness, cat, p.settings, { breakoutAllowanceMm: profile.capabilities.breakoutAllowanceMm });
    const bom = computeBom(p, rev, cat, d);
    const wire = bom.lines.find((l) => l.category === "Wire")!;
    expect(wire.qty).toBe(d.wireLengthMm.get(rev.harness.wires[0]!.id)! / 1000);
    expect(purchaseQty({ qty: 0.1234, uom: "m" }, 3)).toBe(0.38);
    expect(purchaseQty({ qty: 2, uom: "ea" }, 3)).toBe(6);
    expect(purchaseQty({ qty: 0.004, uom: "m" }, 1)).toBe(0.01); // never rounds a requirement down to zero
    if (bom.criticalPath) expect(bom.criticalPath.stockSufficient).toBe(false);
    expect(bom.asOf).toBe(bom.asOfRange.oldest);
  });
});

describe("schema migration", () => {
  it("v1 files migrate explicitly; newer versions are refused", () => {
    const raw = JSON.parse(readFileSync(join(PUB, "example-jumper.harness.json"), "utf8"));
    raw.schemaVersion = 1;
    raw.revisions[0].snapshot = { legacy: true };
    for (const s of raw.revisions[0].harness.segments) delete s.lengthSource;
    const p = parseProject(raw);
    expect(p.revisions[0]!.legacySnapshot).toEqual({ legacy: true });
    expect(p.revisions[0]!.harness.segments.every((s) => s.lengthSource === "estimated")).toBe(true);
    expect(() => parseProject({ ...raw, schemaVersion: 99 })).toThrow(UnsupportedSchemaError);
  });
});

describe("branch editing", () => {
  function three() {
    setUidGenerator(seededUids("branch"));
    let p = run(newProject({ now: AT }), [
      addConnector({ id: "A", pn: SOCKET, position: { x: 0, y: 0 } }),
      addConnector({ id: "B", pn: PIN, position: { x: 600, y: -200 }, rotation: 180 }),
      addConnector({ id: "C", pn: PIN, position: { x: 600, y: 200 }, rotation: 180 }),
    ]);
    p = run(p, [connectPins({ pairs: [{ a: { connectorId: "A", cavityId: "1" }, b: { connectorId: "B", cavityId: "1" } }] }), connectPins({ pairs: [{ a: { connectorId: "A", cavityId: "2" }, b: { connectorId: "C", cavityId: "1" } }] })]);
    const h = currentHarness(p);
    const node = (id: string) => h.nodes.find((n) => n.connectorId === id)!.id;
    const seg = (x: string, y: string) => h.segments.find((s) => [s.a, s.b].includes(node(x)) && [s.a, s.b].includes(node(y)))!;
    return { p, node, seg };
  }
  const lens = (p: Project) => {
    const d = derive(currentHarness(p), cat, p.settings, { breakoutAllowanceMm: 10 });
    return currentHarness(p).wires.map((w) => d.wireLengthMm.get(w.id)!);
  };

  it("combine two bundles into a trunk: topology changes, wire lengths only gain the breakout allowance", () => {
    const { p, seg } = three();
    expect(currentHarness(p).segments).toHaveLength(2);
    const before = lens(p);
    const q = run(p, [combineSegments({ segmentIds: [seg("A", "B").id, seg("A", "C").id], nodeId: "BK", trunkMm: 100, position: { x: 200, y: 0 } })]);
    expect(currentHarness(q).segments).toHaveLength(3);
    expect(lens(q)).toEqual(before.map((x) => x + 10));
    expect(() => run(p, [combineSegments({ segmentIds: [seg("A", "B").id, seg("A", "C").id], nodeId: "BK", trunkMm: 5000, position: { x: 0, y: 0 } })])).toThrow(CommandRejectedError);
  });

  it("branching a connector off a bundle replaces its redundant direct bundle, and says so", () => {
    const { p, seg } = three();
    const r = applyBatch(p, [addBreakout({ segmentId: seg("A", "B").id, t: 0.5, nodeId: "BK", position: { x: 300, y: -100 }, branch: { toConnectorId: "C", lengthMm: 200 } })], ctx);
    const h = currentHarness(r.project);
    expect(h.segments).toHaveLength(3);
    expect(h.segments.every((s) => s.a === "BK" || s.b === "BK")).toBe(true);
    expect(r.repairs.join(" ")).toMatch(/now routes through the new branch/);
    expect(h.wires.every((w) => derive(h, cat, r.project.settings).routes.get(w.id))).toBe(true);
  });

  it("re-attach a bundle end to another node; refuse loops and connector merges", () => {
    const { p, node, seg } = three();
    const ac = seg("A", "C");
    const end = ac.a === node("A") ? "a" : "b";
    const q = run(p, [reattachSegment({ segmentId: ac.id, end, toNodeId: node("B") })]);
    const moved = currentHarness(q).segments.find((s) => s.id === ac.id)!;
    expect([moved.a, moved.b].sort()).toEqual([node("B"), node("C")].sort());
    expect(moved.lengthMm).toBe(ac.lengthMm);
    expect(lens(q).every((x) => x > 0)).toBe(true);
    expect(() => run(p, [reattachSegment({ segmentId: ac.id, end, toNodeId: node("C") })])).toThrow(CommandRejectedError);
    expect(() => run(p, [mergeNodes({ from: node("A"), into: node("B") })])).toThrow(CommandRejectedError);
  });
});
