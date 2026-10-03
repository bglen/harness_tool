import { describe, expect, it } from "vitest";
import { currentRevision, defaultPedigreeOf, newProject } from "./index";
import type { PedigreeScheme } from "./schema";

const scheme = (defaultPedigreeId?: string): PedigreeScheme => ({
  id: "org",
  name: "Org",
  version: "1.0.0",
  defaultPedigreeId,
  pedigrees: [
    { id: "dev", name: "Development", code: "DEV", rank: 0, color: 0, description: "" },
    { id: "flt", name: "Flight", code: "FLT", rank: 2, color: 2, description: "", extends: "dev" },
  ],
});

describe("default pedigree for new designs", () => {
  it("starts a new design on the scheme's marked default", () => {
    expect(currentRevision(newProject({ scheme: scheme("flt") })).activePedigreeId).toBe("flt");
  });
  it("falls back to the first pedigree when none (or an unknown one) is marked", () => {
    expect(defaultPedigreeOf(scheme())).toBe("dev");
    expect(defaultPedigreeOf(scheme("gone"))).toBe("dev");
  });
});
