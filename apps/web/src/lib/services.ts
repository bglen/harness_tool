import { CatalogIndex, type DemoPricing, type InspectionType, type MachineProfile } from "@hs/model";
import { DemoOrderProvider, DemoQuoteProvider, LocalProjectStore, StaticCatalogProvider, type CatalogProvider, type ExampleInfo, type LibraryIndex, type OrderProvider, type ProjectStore, type QuoteProvider } from "@hs/providers";

/**
 * The app depends on provider interfaces only (feedback §11). Phase 1 wires in the static/demo implementations;
 * the analysis worker receives the same catalog/profile snapshot from here instead of fetching its own.
 */
export interface Services {
  cat: CatalogIndex;
  catalog: CatalogProvider;
  profile: MachineProfile;
  inspections: InspectionType[];
  library: LibraryIndex;
  pricing: DemoPricing;
  quote: QuoteProvider;
  store: ProjectStore;
  orders: OrderProvider;
  examples: ExampleInfo[];
}

let services: Services | null = null;

export async function loadServices(): Promise<Services> {
  if (services) return services;
  const catalog: CatalogProvider = new StaticCatalogProvider();
  const [bundle, profile, inspections, library, examples, pricingRaw] = await Promise.all([
    catalog.load(),
    catalog.machineProfile(),
    catalog.inspectionCatalog(),
    catalog.library(),
    catalog.examples(),
    fetch("/catalog/pricing.json").then((r) => r.json() as Promise<DemoPricing>),
  ]);
  const cat = new CatalogIndex(bundle);
  const quote: QuoteProvider = new DemoQuoteProvider(cat, pricingRaw, inspections);
  services = { cat, catalog, profile, inspections, library, pricing: await quote.pricing(), quote, store: new LocalProjectStore(), orders: new DemoOrderProvider(), examples };
  return services;
}

/** Available after boot (App renders only once services are loaded). */
export function svc(): Services {
  if (!services) throw new Error("Services not loaded");
  return services;
}

/** Synchronous price preview when the provider supports it (demo provider); undefined otherwise. */
export function previewPrice(...args: Parameters<DemoQuoteProvider["price"]>) {
  const q = svc().quote as Partial<DemoQuoteProvider>;
  return typeof q.price === "function" ? q.price.apply(svc().quote, args) : undefined;
}
