/** DFM timing on the 20-connector / 1,000-wire fixture (dev aid: `pnpm exec tsx scripts/bench-dfm.ts`). Node, not a browser. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyCommand, currentHarness, setSegmentProps } from "../packages/model/src/index";
import { DfmCache, runDfm } from "../packages/dfm/src/index";
import { bigProject, loadTestCatalog } from "../packages/model/src/test-catalog";

const cat = loadTestCatalog();
const profile = JSON.parse(readFileSync(join(import.meta.dirname, "..", "apps", "web", "public", "catalog", "profile.json"), "utf8"));
const p = bigProject(cat);
const cache = new DfmCache();
const time = (label: string, f: () => void) => {
  const t0 = performance.now();
  f();
  console.log(`${label}: ${(performance.now() - t0).toFixed(0)} ms`);
};
console.log(`${currentHarness(p).wires.length} wires`);
time("cold (no cache)", () => runDfm({ project: p, cat, profile }));
time("first run with cache", () => runDfm({ project: p, cat, profile, cache }));
time("unchanged, cached", () => runDfm({ project: p, cat, profile, cache }));
const seg = currentHarness(p).segments[0]!.id;
const q = applyCommand(p, setSegmentProps({ ids: [seg], lengthMm: 999 }), { cat }).project;
time("after a segment-length edit, cached", () => runDfm({ project: q, cat, profile, cache }));
