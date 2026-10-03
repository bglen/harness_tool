import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { parseProject, type InspectionType, type MachineProfile, type Project, type Ruleset } from "@hs/model";
import { loadTestCatalog } from "../../model/src/test-catalog";
import { buildDocData } from "./data";
import { MfgReportDocument } from "./mfgReport";
import { simulateBuild, type MfgOrder } from "./mfgSim";

const cat = loadTestCatalog();
const ROOT = join(import.meta.dirname, "..", "..", "..");
const PUB = join(ROOT, "apps", "web", "public", "catalog");
const profile = JSON.parse(readFileSync(join(PUB, "profile.json"), "utf8")) as MachineProfile;
const inspections = JSON.parse(readFileSync(join(PUB, "inspections.json"), "utf8")) as InspectionType[];
const flight = JSON.parse(readFileSync(join(ROOT, "data", "library", "rulesets", "dev-cnf-flight.harnessrules.json"), "utf8")) as Ruleset;
const EXAMPLE = readFileSync(join(PUB, "example-branched.harness.json"), "utf8");
const project = (): Project => ({ ...parseProject(JSON.parse(EXAMPLE)), pedigreeScheme: flight.pedigreeScheme! });
const data = (p: Project) => buildDocData({ project: p, cat, profile, inspections, generatedAt: "2026-01-01T00:00:00Z", pedigreeColor: "#000", printWire: () => "#888" });
const order = (pedigreeId: string, extraDocs: string[] = []): MfgOrder => ({ po: "PO-1", workOrder: "WO-1", qty: 3, serialPrefix: "SN", buildDate: "2026-09-01", pedigreeId, extraDocs, customer: "Acme" });

describe("example manufacturing report", () => {
  it("tests what the pedigree requires, with the sampling it sets", () => {
    const d = data(project());
    const sim = simulateBuild(d, order("flight"));
    const ids = sim.inspections.map((r) => r.typeId);
    for (const t of ["visual", "retention", "xray", "bond", "dimensional", "hipot", "continuity"]) expect(ids).toContain(t);
    expect(sim.testDataPackage).toBe(true);
    // 100% continuity: one table per serial, one row per wire
    const cont = sim.inspections.find((r) => r.typeId === "continuity")!;
    expect(cont.sections.filter((s) => s.title.startsWith("Serial"))).toHaveLength(3);
    expect(cont.sections[0]!.table.rows).toHaveLength(d.wireRows.length);
    // first/last article pull test covers two units
    expect(sim.inspections.find((r) => r.typeId === "pull")!.tested).toContain("SN0001, SN0003");
  });

  it("is deterministic and only includes detail data when asked for", () => {
    const d = data(project());
    expect(JSON.stringify(simulateBuild(d, order("flight")))).toBe(JSON.stringify(simulateBuild(d, order("flight"))));
    expect(simulateBuild(d, order("dev")).testDataPackage).toBe(false);
    expect(simulateBuild(d, order("dev", ["Test data package"])).testDataPackage).toBe(true);
  });

  it("renders to PDF", async () => {
    const d = data(project());
    const blob = await pdf(createElement(MfgReportDocument, { data: d, sim: simulateBuild(d, order("flight", ["Customer source-inspection hold point"])) }) as never).toBlob();
    expect(blob.size).toBeGreaterThan(5000);
  });
});
