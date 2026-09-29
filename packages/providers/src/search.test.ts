import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StaticCatalogProvider } from "./static-catalog";

const PUB = join(import.meta.dirname, "..", "..", "..", "apps", "web", "public", "catalog");
const provider = new StaticCatalogProvider(async (path) => JSON.parse(readFileSync(join(PUB, path), "utf8")));
const pns = async (q: string) => (await provider.searchParts(q, {})).hits.map((h) => h.pn);

describe("part picker search", () => {
  it("finds D38999/24FA35SN at every stage of typing it", async () => {
    for (const q of ["24", "24F", "24FA", "24FA3", "24FA35", "24FA35S", "24FA35SN", "D38999/24", "D38999/24F", "d38999/24fa35", "D38999/24FA35SN"]) {
      const hits = await pns(q);
      expect(hits.length, q).toBeGreaterThan(0);
      if (/fa35/i.test(q)) expect(hits, q).toContain("D38999/24FA35SN");
      if (/24f/i.test(q)) expect(hits.every((p) => p.startsWith("D38999/24F")), q).toBe(true);
    }
  });

  it("partial PNs narrow the results", async () => {
    expect((await pns("24")).every((p) => p.startsWith("D38999/24"))).toBe(true);
    expect((await pns("24F")).every((p) => p.startsWith("D38999/24F"))).toBe(true);
    expect((await pns("24FA")).every((p) => /^D38999\/24FA/.test(p))).toBe(true);
    expect(await pns("24FA35S")).toEqual(["D38999/24FA35SN"]);
  });

  it("contact style + key from the end of a PN (SN, PN, 35SN)", async () => {
    const sn = await pns("SN");
    expect(sn.length).toBeGreaterThan(10);
    expect(sn.every((p) => p.endsWith("SN"))).toBe(true);
    expect((await pns("PN")).every((p) => p.endsWith("PN"))).toBe(true);
    const x = await pns("35SN");
    expect(x.length).toBeGreaterThan(0);
    expect(x.every((p) => /35SN$/.test(p))).toBe(true);
  });

  it("still does free-text and arrangement search", async () => {
    expect((await pns("13-35")).length).toBeGreaterThan(0);
    expect((await pns("13-35 pin")).every((p) => p.endsWith("PN"))).toBe(true);
  });
});
