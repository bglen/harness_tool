import { readFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { applyBatch, currentHarness, newProject, parseProject, stableStringify, type MachineProfile } from "@hs/model";
import { runDfm } from "@hs/dfm";
import { computeBom } from "@hs/ops";
import { loadTestCatalog } from "../../model/src/test-catalog";
import { applyMapping, autoMap, buildImportCommands, buildZip, bomTable, dfmTable, exportWireViz, expandDeferred, importWireViz, isDeferred, parseDelimited, pinoutTable, resolveConnectorPn, toCsv, verifyZip, wireListTable } from "./index";

const cat = loadTestCatalog();
const PUB = join(import.meta.dirname, "..", "..", "..", "apps", "web", "public", "catalog");
const profile = JSON.parse(readFileSync(join(PUB, "profile.json"), "utf8")) as MachineProfile;
const example = () => parseProject(JSON.parse(readFileSync(join(PUB, "example-branched.harness.json"), "utf8")));

describe("wire list import", () => {
  it("auto-maps standard headers with no manual mapping (acceptance 7)", () => {
    const rows = ["Wire ID,Signal,From,From Pin,To,To Pin,Gauge,Color,Length (in)"];
    for (let i = 1; i <= 100; i++) rows.push(`W${i},SIG_${i},J1,${i},P2,${i},22,9-6,48`);
    const t = parseDelimited(rows.join("\n"));
    const map = autoMap(t.header);
    expect(map).toEqual(["wireId", "signal", "fromConn", "fromPin", "toConn", "toPin", "gauge", "color", "length"]);
    const m = applyMapping(t, map, "mm");
    expect(m.rows).toHaveLength(100);
    expect(m.issues).toEqual([]);
    expect(m.rows[0]!.lengthMm).toBeCloseTo(48 * 25.4);
    expect(m.rows[0]!.color).toEqual({ base: 9, stripes: [6] });
  });

  it("splits combined endpoint cells and builds a harness", () => {
    const t = parseDelimited("Wire\tFrom\tTo\tSignal\nW1\tP1-1\tP2-1\tPWR\nW2\tP1-2\tP2-2\tGND");
    const m = applyMapping(t, autoMap(t.header), "in");
    expect(m.rows[1]!.from).toMatchObject({ conn: "P1", pin: "2" });
    let p = newProject();
    const pns = Object.fromEntries(m.connectors.map((c) => [c.refDes, resolveConnectorPn(c.pn, cat, ["1", "2"]).pn!]));
    const { commands } = buildImportCommands(p, cat, m, pns);
    p = applyBatch(p, commands.filter((c) => !isDeferred(c)), { cat }).project;
    const after = expandDeferred(p, commands.filter(isDeferred), cat);
    if (after.length) p = applyBatch(p, after, { cat }).project;
    const h = currentHarness(p);
    expect(h.connectors.map((c) => c.refDes).sort()).toEqual(["P1", "P2"]);
    expect(h.wires).toHaveLength(2);
    expect(h.nets.find((n) => n.name === "PWR")?.cls).toBe("power");
  });

  it("resolves connector part numbers exact → normalized → fuzzy", () => {
    expect(resolveConnectorPn("D38999/26WB35SN", cat).status).toBe("exact");
    expect(resolveConnectorPn("d38999/26 wb35sn", cat).status).toBe("normalized");
    expect(resolveConnectorPn("MIL 38999 11-35 socket", cat).status).toBe("fuzzy");
  });
});

describe("WireViz", () => {
  it("round-trips connectivity through export and import", () => {
    const p = example();
    const yml = exportWireViz(p, cat);
    const m = importWireViz(yml);
    expect(m.rows).toHaveLength(currentHarness(p).wires.length);
    expect(m.connectors.map((c) => c.refDes).sort()).toEqual(currentHarness(p).connectors.map((c) => c.refDes).sort());
    expect(m.rows.every((r) => r.signal)).toBe(true);
  });
});

describe("output package", () => {
  const files = () => {
    const p = example();
    const rev = p.revisions[0]!;
    const dfm = runDfm({ project: p, cat, profile });
    return [
      { path: "WireList.csv", data: toCsv(wireListTable(p, cat, rev)) },
      { path: "Pinouts.csv", data: toCsv(pinoutTable(p, cat, rev)) },
      { path: "BOM.csv", data: toCsv(bomTable(computeBom(p, rev, cat, undefined, 10))) },
      { path: "DFM_Results.csv", data: toCsv(dfmTable(dfm)) },
      { path: "design/x.harness.json", data: stableStringify(p, 2) + "\n" },
    ];
  };

  it("regenerates byte-identical CSV/JSON files (acceptance 10)", () => {
    const a = files();
    const b = files();
    for (let i = 0; i < a.length; i++) expect(b[i]!.data).toBe(a[i]!.data);
  });

  it("manifest hashes verify, and tampering is detected", async () => {
    const meta = { schemaVersion: 1 as const, package: "X_RevA", generatedAt: "2026-01-01T00:00:00.000Z", generatedBy: "test", designHash: "h", project: { name: "x", partNumber: "X", revision: "A", frozen: true }, pedigree: { id: "std", name: "Standard", code: "STD", schemeVersion: "1.0.0" }, versions: { tool: "0", machineProfile: profile.version, catalog: cat.version.hash, rulesets: [] }, demoPricing: true };
    const { zip, manifest } = await buildZip("X_RevA", files(), meta, new Date(meta.generatedAt));
    expect(manifest.files).toHaveLength(5);
    expect((await verifyZip(zip)).ok).toBe(true);
    const z = await JSZip.loadAsync(zip);
    z.file("X_RevA/BOM.csv", "tampered");
    const bad = await verifyZip(await z.generateAsync({ type: "uint8array" }));
    expect(bad.ok).toBe(false);
    expect(bad.problems[0]).toMatch(/BOM\.csv: hash mismatch/);
  });
});
