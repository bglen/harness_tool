import { describe, expect, it } from "vitest";
import { applyCommand, currentHarness, setPinSignals } from "./index";
import { bigProject, loadTestCatalog } from "./test-catalog";

const cat = loadTestCatalog();
const ctx = { cat, now: () => "2026-01-01T00:00:00Z" };

describe("performance", () => {
  it("a single edit on a 1000-wire harness is fast and produces a small patch", () => {
    const p = bigProject(cat);
    expect(currentHarness(p).wires.length).toBe(1000);
    applyCommand(p, setPinSignals({ connectorId: "C0", entries: [{ cavityId: "1", name: "WARMUP" }] }), ctx);
    const t0 = performance.now();
    const r = applyCommand(p, setPinSignals({ connectorId: "C0", entries: [{ cavityId: "1", name: "RENAMED" }] }), ctx);
    const ms = performance.now() - t0;
    expect(r.patches.length).toBeLessThan(40);
    expect(ms).toBeLessThan(100);
  });
});
