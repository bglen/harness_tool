import type { CatalogBundle, DemoPricing, InspectionType, MachineProfile, Project, Ruleset, FinishingPreset, SupplyRow } from "@hs/model";
import type { QuoteSummary } from "@hs/ops";

export interface FacetFilter {
  slash?: string;
  shellSize?: number;
  arrangement?: string;
  gender?: "pin" | "socket";
  keying?: string;
  finish?: string;
  kind?: "plug" | "receptacle";
}

export interface ConnectorSearchHit {
  pn: string;
  slash: string;
  arrangement: string;
  kind: string;
  mount: string;
  shellSize: number;
  sizes: string;
  count: number;
  status: string;
  score: number;
  /** The variant this hit's PN was built for. */
  gender: "pin" | "socket";
  keying: string;
  finish: string;
}

export interface SearchResult {
  hits: ConnectorSearchHit[];
  /** Facet values present in the hits (for chips). */
  facets: { slash: string[]; shellSize: number[]; arrangement: string[] };
  /** Facets inferred from the query text (e.g. "socket" → gender). */
  inferred: FacetFilter;
}

export interface LibraryIndex {
  rulesets: Ruleset[];
  presets: FinishingPreset[];
}

export interface ExampleInfo {
  id: string;
  name: string;
  description: string;
}

/** §15.5 — the UI and rules engine only use this interface; Phase 2 swaps in an API-backed implementation. */
export interface CatalogProvider {
  load(): Promise<CatalogBundle>;
  searchParts(query: string, facets: FacetFilter): Promise<SearchResult>;
  machineProfile(): Promise<MachineProfile>;
  inspectionCatalog(): Promise<InspectionType[]>;
  library(): Promise<LibraryIndex>;
  examples(): Promise<ExampleInfo[]>;
  example(id: string): Promise<unknown>;
  catalogVersion(): string;
}

export interface SupplyInfo {
  pn: string;
  supply?: SupplyRow;
}

export interface SupplyProvider {
  supply(pns: string[]): Promise<SupplyInfo[]>;
}

export type QuoteState = "updating" | "instant" | "needsReview" | "unavailable";

export interface QuoteCell {
  qty: number;
  tier: string;
  unit: number;
  total: number;
  shipDate: string;
  breakdown: QuoteBreakdown;
  /** Longest-lead part whose stock doesn't cover this quantity. */
  criticalPart?: { pn: string; leadDays: number };
}

export interface QuoteBreakdown {
  materials: number;
  machine: number;
  manual: number;
  inspection: number;
  inspectionItems: { name: string; amount: number; inHouse: boolean; sampling: string }[];
  nre: number;
  nrePerUnit: number;
}

export interface QuoteResult {
  state: Exclude<QuoteState, "updating">;
  reason?: string;
  pedigreeId: string;
  pedigreeName: string;
  tiers: { id: string; name: string; days: number }[];
  quantities: number[];
  cells: QuoteCell[];
  validUntil: string;
  asOf: string;
  hash: string;
  demo: boolean;
  /** Worst critical part across all cells; use the cell's own criticalPart for a specific quantity. */
  criticalPart?: { pn: string; leadDays: number };
  cureDays: number;
  /** Assumptions behind ship dates/prices that the customer must confirm. */
  assumptions?: string[];
}

export interface QuoteProvider {
  /** One price matrix per pedigree (§17: quote.compute accepts a list of pedigrees). */
  compute(summaries: QuoteSummary[], quantities: number[], signal?: AbortSignal): Promise<QuoteResult[]>;
  pricing(): Promise<DemoPricing>;
}

export interface OrderRequest {
  projectName: string;
  lines: { pedigreeId: string; qty: number; tier: string }[];
}

export interface OrderProvider {
  /** Phase 1: never sends anything; always returns comingSoon. */
  submit(req: OrderRequest): Promise<{ status: "comingSoon"; message: string }>;
}

export interface ProjectMeta {
  id: string;
  name: string;
  partNumber: string;
  updated: string;
}

export interface ProjectStore {
  save(p: Project): Promise<void>;
  load(id: string): Promise<Project | undefined>;
  list(): Promise<ProjectMeta[]>;
  remove(id: string): Promise<void>;
  lastOpened(): Promise<string | undefined>;
  setLastOpened(id: string): Promise<void>;
}
