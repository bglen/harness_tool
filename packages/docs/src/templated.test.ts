import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_TEMPLATES,
  buildReleaseSnapshot,
  newTemplateBlock,
  parseDrawingTemplate,
  parseProject,
  projectForRevision,
  resolveDrawingTokens,
  type DrawingTemplate,
  type InspectionType,
  type MachineProfile,
  type Project,
} from "@hs/model";
import { loadTestCatalog } from "../../model/src/test-catalog";
import { buildDocData } from "./data";
import { packFlow, type FlowGroup, type FlowItem } from "./flow";
import { drawingTokenValues, planTemplatePages, TemplateDrawingDocument } from "./templated";

const cat = loadTestCatalog();
const PUB = join(import.meta.dirname, "..", "..", "..", "apps", "web", "public", "catalog");
const profile = JSON.parse(readFileSync(join(PUB, "profile.json"), "utf8")) as MachineProfile;
const inspections = JSON.parse(readFileSync(join(PUB, "inspections.json"), "utf8")) as InspectionType[];
const example = (f: string) => parseProject(JSON.parse(readFileSync(join(PUB, `${f}.harness.json`), "utf8")));
const data = (p: Project) => buildDocData({ project: p, cat, profile, inspections, generatedAt: "2026-01-01T00:00:00Z", pedigreeColor: "#000", printWire: () => "#888" });

const row = (h = 10): FlowItem => ({ t: "row", cols: [], cells: [], h, zebra: false });
const head = (text: string): FlowItem[] => [{ t: "title", text, h: 10 }];

describe("flow packing", () => {
  it("fills columns, then pages, keeping at least one page", () => {
    expect(packFlow([], 100, 2)).toEqual([[[]]]);
    const g: FlowGroup = { head: [], items: Array.from({ length: 25 }, () => row()) };
    const pages = packFlow([g], 100, 2);
    expect(pages.map((p) => p.map((c) => c.length))).toEqual([[10, 10], [5]]);
  });

  it("never strands a heading without its first row, and repeats the continued heading", () => {
    const g1: FlowGroup = { head: head("A"), items: Array.from({ length: 8 }, () => row()) };
    const g2: FlowGroup = { head: head("B"), contHead: head("B (cont.)"), items: Array.from({ length: 12 }, () => row()) };
    const [page] = packFlow([g1, g2], 100, 3);
    // A: title + 8 rows = 90; B's title + first row (20) doesn't fit → next column.
    expect(page![0]!.length).toBe(9);
    expect(page![1]![0]).toMatchObject({ t: "title", text: "B" });
    expect(page![2]![0]).toMatchObject({ t: "title", text: "B (cont.)" });
  });
});

describe("drawing templates", () => {
  it("built-ins and new blocks validate as template files", () => {
    for (const t of BUILTIN_TEMPLATES) expect(parseDrawingTemplate(JSON.parse(JSON.stringify(t))).ok).toBe(true);
    expect(parseDrawingTemplate({ kind: "something-else" })).toMatchObject({ ok: false });
    expect(parseDrawingTemplate({ ...BUILTIN_TEMPLATES[0], schemaVersion: 99 })).toMatchObject({ ok: false });
    const t = { ...BUILTIN_TEMPLATES[0]!, logo: { dataUrl: "data:image/svg+xml;base64,AAA", width: 1, height: 1, name: "" } };
    expect(parseDrawingTemplate(t).ok).toBe(false);
  });

  it("resolves title-block tokens from the project and leaves unknown tokens visible", () => {
    const d = data(example("example-jumper"));
    const v = drawingTokenValues(d, { company: "Acme Wire Co." });
    expect(resolveDrawingTokens("{partNumber} Rev {rev} · {nope}", v)).toBe(`${d.project.partNumber} Rev ${d.rev.label} · {nope}`);
    // The project's own company name wins over the template's default.
    expect(v.company).toBe(d.project.titleBlock.company === "Harness Studio" ? "Acme Wire Co." : d.project.titleBlock.company);
  });

  it("adds continuation pages when a table overflows its box", () => {
    const d = data(example("example-branched"));
    const base = BUILTIN_TEMPLATES[0]!;
    expect(planTemplatePages(d, base)).toHaveLength(2);
    const tiny: DrawingTemplate = { ...base, sheets: [{ id: "s", name: "Wires", blocks: [newTemplateBlock("wireList", "w", undefined, { x: 0.05, y: 0.05, w: 0.5, h: 0.1 })] }] };
    const pages = planTemplatePages(d, tiny);
    expect(pages.length).toBeGreaterThan(1);
    const rows = pages.flatMap((p) => p.flows.get("w")!.flat()).filter((x) => x.t === "row");
    expect(rows).toHaveLength(d.wireRows.length);
  });

  it("renders every built-in template to a PDF", async () => {
    const d = data(example("example-branched"));
    for (const t of BUILTIN_TEMPLATES) {
      const buf = await pdf(createElement(TemplateDrawingDocument, { data: d, template: t }) as never).toBuffer();
      const chunks: Buffer[] = [];
      for await (const c of buf as unknown as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
      const out = Buffer.concat(chunks).toString("latin1");
      expect(out.startsWith("%PDF")).toBe(true);
      expect((out.match(/\/Type\s*\/Page\b/g) ?? []).length).toBe(planTemplatePages(d, t).length);
    }
  }, 60_000);

  it("a released revision keeps the template it was released with", () => {
    const p0 = example("example-jumper");
    const t = BUILTIN_TEMPLATES[0]!;
    const withT: Project = { ...p0, drawingTemplate: t };
    const rel = buildReleaseSnapshot(withT, { at: "2026-01-01T00:00:00Z", tool: "test", cat, profile });
    const rev = { ...withT.revisions[0]!, frozen: true, frozenAt: "2026-01-01T00:00:00Z", release: rel };
    const later: Project = { ...withT, drawingTemplate: { ...t, name: "Changed later" }, revisions: [rev] };
    expect(projectForRevision(later, rev.id).drawingTemplate?.name).toBe(t.name);
    // Releases recorded before templates existed keep the classic layout.
    const old = { ...rev, release: { ...rel, inputs: { ...rel.inputs, drawingTemplate: undefined } } };
    expect(projectForRevision({ ...later, revisions: [old] }, rev.id).drawingTemplate).toBeNull();
  });
});
