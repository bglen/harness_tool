/** Print the DFM headline and blockers of the bundled examples (dev aid: `pnpm exec tsx scripts/check-examples.ts`). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseProject } from "../packages/model/src/index";
import { runDfm } from "../packages/dfm/src/index";
import { loadTestCatalog } from "../packages/model/src/test-catalog";

const PUB = join(import.meta.dirname, "..", "apps", "web", "public", "catalog");
const cat = loadTestCatalog();
const profile = JSON.parse(readFileSync(join(PUB, "profile.json"), "utf8"));
for (const f of ["example-jumper", "example-branched"]) {
  const p = parseProject(JSON.parse(readFileSync(join(PUB, `${f}.harness.json`), "utf8")));
  const s = runDfm({ project: p, cat, profile });
  const m = s.manufacturability;
  console.log(`${f}: ${m.status} · ${m.checks} checks · ${m.errors} errors · ${m.warnings} warnings · ${m.incomplete} incomplete · ${m.review} review`);
  for (const b of m.blockers) console.log(`  - ${b}`);
}
