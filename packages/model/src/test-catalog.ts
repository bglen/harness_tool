import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CatalogIndex, type CatalogBundle } from "./catalog";

/** Loads the compiled catalog for tests (run `pnpm data:build` first). */
export function loadTestCatalog(): CatalogIndex {
  const p = join(import.meta.dirname, "..", "..", "..", "apps", "web", "public", "catalog", "38999-III.json");
  if (!existsSync(p)) throw new Error("Compiled catalog missing: run `pnpm data:build`");
  return new CatalogIndex(JSON.parse(readFileSync(p, "utf8")) as CatalogBundle);
}
