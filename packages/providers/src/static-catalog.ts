import MiniSearch from "minisearch";
import { arrangementId, buildD38999, parseD38999, type CatalogBundle, type InspectionType, type MachineProfile } from "@hs/model";
import type { CatalogProvider, ConnectorSearchHit, ExampleInfo, FacetFilter, LibraryIndex, SearchResult } from "./interfaces";

type Fetcher = (path: string) => Promise<unknown>;

const defaultFetch = (base: string): Fetcher => async (path) => {
  const r = await fetch(`${base}${path}`);
  if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
  return r.json();
};

interface Doc {
  id: string;
  slash: string;
  arrangement: string;
  kind: string;
  mount: string;
  shellSize: number;
  sizes: string;
  count: number;
  status: string;
}

/** Phase 1 CatalogProvider over the compiled static bundles (cached in memory by the browser). */
export class StaticCatalogProvider implements CatalogProvider {
  private bundle?: CatalogBundle;
  private index?: MiniSearch<Doc>;
  private cache = new Map<string, Promise<unknown>>();
  constructor(private fetcher: Fetcher = defaultFetch("/catalog/")) {}

  private get<T>(path: string): Promise<T> {
    if (!this.cache.has(path)) this.cache.set(path, this.fetcher(path));
    return this.cache.get(path) as Promise<T>;
  }

  async load(): Promise<CatalogBundle> {
    if (!this.bundle) this.bundle = await this.get<CatalogBundle>("38999-III.json");
    return this.bundle;
  }

  private async idx(): Promise<MiniSearch<Doc>> {
    if (!this.index) {
      const json = await this.get<unknown>("38999-III.search.json");
      this.index = MiniSearch.loadJSON<Doc>(JSON.stringify(json), { fields: ["text", "arrangement"], storeFields: ["slash", "arrangement", "kind", "mount", "shellSize", "sizes", "count", "status"], searchOptions: { prefix: true, fuzzy: 0.15, combineWith: "AND" } });
    }
    return this.index;
  }

  /** Free text or PN search with facet chips (§5.4). Gender/keying/finish are PN options applied to every hit. */
  async searchParts(query: string, facets: FacetFilter): Promise<SearchResult> {
    const bundle = await this.load();
    const idx = await this.idx();
    const inferred: FacetFilter = {};
    let q = query.trim();
    // Exact PN typed
    const pn = parseD38999(q.replace(/\s+/g, ""));
    if (pn) {
      Object.assign(inferred, { slash: pn.slash, shellSize: pn.shellSize, arrangement: arrangementId(pn.shellSize, pn.insert), gender: ["P", "H", "R", "G", "A", "X", "C"].includes(pn.contactStyle) ? "pin" : "socket", keying: pn.keying, finish: pn.finish });
      q = "";
    }
    // Word facets
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rest: string[] = [];
    for (const w of words) {
      if (/^(socket|sockets|female|s)$/.test(w)) inferred.gender = "socket";
      else if (/^(pin|pins|male|p)$/.test(w)) inferred.gender = "pin";
      else if (/^plug/.test(w)) inferred.kind = "plug";
      else if (/^(receptacle|recept|rcpt)/.test(w)) inferred.kind = "receptacle";
      else if (/^\d{1,2}-\d{1,3}$/.test(w)) inferred.arrangement = w;
      else if (/^(38999|d38999|mil|series|iii|3)$/.test(w)) continue;
      else rest.push(w);
    }
    const f: FacetFilter = { ...inferred, ...stripUndef(facets) };
    let docs: (Doc & { score: number })[];
    if (rest.length) docs = idx.search(rest.join(" ")) as unknown as (Doc & { score: number })[];
    else docs = bundle.connectorStyles.flatMap((st) => bundle.arrangements.map((a) => ({ id: `${st.slash}|${a.id}`, slash: st.slash, arrangement: a.id, kind: st.kind, mount: st.mount, shellSize: a.shellSize, sizes: Object.keys(a.sizes).join(" "), count: a.contactCount, status: a.status, score: 1 })));
    const matchFacets = (d: Doc) => (!f.slash || d.slash === f.slash) && (!f.shellSize || d.shellSize === f.shellSize) && (!f.arrangement || d.arrangement === f.arrangement) && (!f.kind || d.kind === f.kind);
    const filtered = docs.filter(matchFacets);
    // Rank: active before inactive, verified geometry first, then machine-ready (standard crimp sizes, no coax), then relevance and size
    const byId = new Map(bundle.arrangements.map((a) => [a.id, a]));
    const rank = (d: Doc) => {
      const a = byId.get(d.arrangement);
      if (!a) return 9;
      const machine = !a.special && Object.keys(a.sizes).every((s) => ["22D", "20", "16", "12"].includes(s));
      return (a.inactive ? 4 : 0) + (a.status === "verified" ? 0 : 1) + (machine ? 0 : 2);
    };
    filtered.sort((a, b) => rank(a) - rank(b) || b.score - a.score || a.shellSize - b.shellSize || Number(a.arrangement.split("-")[1]) - Number(b.arrangement.split("-")[1]) || b.slash.localeCompare(a.slash));
    const gender = f.gender ?? "socket";
    const hits: ConnectorSearchHit[] = filtered.slice(0, 60).map((d) => ({
      pn: buildD38999({ slash: d.slash, finish: f.finish ?? "W", shellSize: d.shellSize, insert: d.arrangement.split("-")[1]!, contactStyle: gender === "pin" ? "P" : "S", keying: f.keying ?? "N" }),
      slash: d.slash,
      arrangement: d.arrangement,
      kind: d.kind,
      mount: d.mount,
      shellSize: d.shellSize,
      sizes: d.sizes,
      count: d.count,
      status: d.status,
      score: d.score,
    }));
    const base = docs.filter((d) => (!f.slash || d.slash === f.slash) && (!f.kind || d.kind === f.kind));
    return {
      hits,
      facets: {
        slash: [...new Set(docs.map((d) => d.slash))].sort(),
        shellSize: [...new Set(base.map((d) => d.shellSize))].sort((a, b) => a - b),
        arrangement: [...new Set(base.filter((d) => !f.shellSize || d.shellSize === f.shellSize).map((d) => d.arrangement))].sort((a, b) => Number(a.split("-")[0]) - Number(b.split("-")[0]) || Number(a.split("-")[1]) - Number(b.split("-")[1])),
      },
      inferred,
    };
  }

  machineProfile() {
    return this.get<MachineProfile>("profile.json");
  }
  inspectionCatalog() {
    return this.get<InspectionType[]>("inspections.json");
  }
  library() {
    return this.get<LibraryIndex>("library.json");
  }
  examples() {
    return this.get<ExampleInfo[]>("examples.json");
  }
  example(id: string) {
    return this.get<unknown>(`example-${id}.harness.json`);
  }
  catalogVersion() {
    return this.bundle?.version.hash ?? "";
  }
}

function stripUndef<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;
}
