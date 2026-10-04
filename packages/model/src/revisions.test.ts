import { describe, expect, it } from "vitest";
import { applyBatch, currentRevision, freezeRevision, newProject, setActivePedigree, setRevisionLabel, type ReleaseSnapshot } from "./index";
import { DEFAULT_REVISION_SCHEME, nextRevision, revisionPreview } from "./revisions";
import type { PedigreeScheme, RevisionScheme } from "./schema";
import { loadTestCatalog } from "./test-catalog";

const S = (x: Partial<RevisionScheme>): RevisionScheme => ({ ...DEFAULT_REVISION_SCHEME, ...x });
const cat = loadTestCatalog();
const ctx = { cat, now: () => "2026-01-01T00:00:00Z" };

describe("revision schemes", () => {
  it("letters skip I O Q S X Z and roll over to AA after Y", () => {
    expect(revisionPreview(S({}), 9)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "J"]);
    expect(nextRevision("Y", S({}))).toBe("AA");
    expect(nextRevision("AA", S({}))).toBe("AB");
  });
  it("numbers, zero-padded and prefixed", () => {
    expect(revisionPreview(S({ style: "numeric", start: "1" }), 3)).toEqual(["1", "2", "3"]);
    expect(revisionPreview(S({ style: "numeric", start: "1", pad: 2 }), 3)).toEqual(["01", "02", "03"]);
    expect(revisionPreview(S({ style: "numeric", start: "1", prefix: "X" }), 3)).toEqual(["X1", "X2", "X3"]);
    expect(nextRevision("09", S({ style: "numeric", pad: 2 }))).toBe("10");
  });
  it("letter + number: minor bumps the number, major the letter", () => {
    const s = S({ style: "alphanumeric", start: "A1" });
    expect(revisionPreview(s, 3)).toEqual(["A1", "A2", "A3"]);
    expect(nextRevision("A3", s, true)).toBe("B1");
  });
});

describe("revisions follow the pedigree", () => {
  const scheme: PedigreeScheme = {
    id: "org",
    name: "Org",
    version: "1.0.0",
    defaultPedigreeId: "dev",
    pedigrees: [
      { id: "dev", name: "Development", code: "DEV", rank: 0, color: 0, description: "", revisionScheme: { style: "numeric", start: "1", pad: 2 } },
      { id: "flt", name: "Flight", code: "FLT", rank: 2, color: 2, description: "", extends: "dev", revisionScheme: { style: "alpha", start: "A" } },
    ],
  };
  const release = {} as ReleaseSnapshot;
  const freeze = (p: ReturnType<typeof newProject>, id: string, extra: { nextLabel?: string } = {}) => applyBatch(p, [freezeRevision({ notes: "", newRevisionId: id, release, at: "2026-01-01T00:00:00Z", ...extra })], ctx).project;

  it("starts on the default pedigree's first revision and continues its sequence", () => {
    let p = newProject({ scheme });
    expect(currentRevision(p).label).toBe("01");
    p = freeze(p, "r2");
    expect(currentRevision(p).label).toBe("02");
  });

  it("switching the working revision to another pedigree relabels it in that scheme", () => {
    let p = freeze(newProject({ scheme }), "r2");
    p = applyBatch(p, [setActivePedigree({ id: "flt" })], ctx).project;
    expect(currentRevision(p).label).toBe("A");
    p = freeze(p, "r3");
    expect(currentRevision(p).label).toBe("B");
    p = applyBatch(p, [setActivePedigree({ id: "dev" })], ctx).project;
    expect(currentRevision(p).label).toBe("02");
  });

  it("a typed label sticks; clearing it follows the scheme again; duplicates are refused", () => {
    let p = newProject({ scheme });
    p = applyBatch(p, [setRevisionLabel({ label: "P1" })], ctx).project;
    p = applyBatch(p, [setActivePedigree({ id: "flt" })], ctx).project;
    expect(currentRevision(p).label).toBe("P1");
    p = applyBatch(p, [setRevisionLabel({ label: "" })], ctx).project;
    expect(currentRevision(p).label).toBe("A");
    p = freeze(p, "r2");
    expect(() => applyBatch(p, [setRevisionLabel({ label: "A" })], ctx)).toThrow(/already exists/);
  });
});
