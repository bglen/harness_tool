import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CatalogIndex, type CatalogBundle } from "./catalog";
import { addConnector, applyBatch, applyCommand, connectPins, type Command } from "./commands";
import { newProject } from "./project";
import type { Project } from "./schema";

/** Loads the compiled catalog for tests (run `pnpm data:build` first). */
export function loadTestCatalog(): CatalogIndex {
  const p = join(import.meta.dirname, "..", "..", "..", "apps", "web", "public", "catalog", "38999-III.json");
  if (!existsSync(p)) throw new Error("Compiled catalog missing: run `pnpm data:build`");
  return new CatalogIndex(JSON.parse(readFileSync(p, "utf8")) as CatalogBundle);
}

/** 20 connectors / 1,000 wires fixture (acceptance criterion 5). */
export function bigProject(cat: CatalogIndex): Project {
  const ctx = { cat, now: () => "2026-01-01T00:00:00Z" };
  let p = newProject({ now: "2026-01-01T00:00:00Z" });
  const cmds: Command[] = [];
  const ids: string[] = [];
  for (let i = 0; i < 20; i++) {
    ids.push(`C${i}`);
    cmds.push(addConnector({ id: `C${i}`, pn: i % 2 ? "D38999/26WJ35PN" : "D38999/26WJ35SN", position: { x: (i % 2) * 1600, y: Math.floor(i / 2) * 2800 } }));
  }
  p = applyBatch(p, cmds, ctx).project;
  const cavs = cat.connector("D38999/26WJ35SN")!.arrangement.cavities.slice(0, 100);
  const pairs = [];
  for (let i = 0; i < 20; i += 2) for (const c of cavs) pairs.push({ a: { connectorId: ids[i]!, cavityId: c.id }, b: { connectorId: ids[i + 1]!, cavityId: c.id } });
  return applyCommand(p, connectPins({ pairs }), ctx).project;
}
