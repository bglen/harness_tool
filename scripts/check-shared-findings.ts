/** Dev aid: list findings in the jumper example that involve more than one connector. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentHarness, parseProject } from "../packages/model/src/index";
import { runDfm } from "../packages/dfm/src/index";
import { loadTestCatalog } from "../packages/model/src/test-catalog";

const PUB = join(import.meta.dirname, "..", "apps", "web", "public", "catalog");
const cat = loadTestCatalog();
const profile = JSON.parse(readFileSync(join(PUB, "profile.json"), "utf8"));
const p = parseProject(JSON.parse(readFileSync(join(PUB, "example-jumper.harness.json"), "utf8")));
const h = currentHarness(p);
const conns = new Map(h.connectors.map((c) => [c.id, c.refDes]));
for (const r of runDfm({ project: p, cat, profile }).results)
  for (const v of r.violations) {
    const cs = v.objectIds.filter((id) => conns.has(id)).map((id) => conns.get(id));
    console.log(`${r.eff.rule.id} [${cs.join(",") || "-"}] ${v.message}`);
  }
