import { CatalogIndex, type DemoPricing, type InspectionType, type MachineProfile } from "@hs/model";
import { DemoOrderProvider, DemoQuoteProvider, LocalProjectStore, StaticCatalogProvider, type ExampleInfo, type LibraryIndex } from "@hs/providers";

export interface Services {
  cat: CatalogIndex;
  catalog: StaticCatalogProvider;
  profile: MachineProfile;
  inspections: InspectionType[];
  library: LibraryIndex;
  pricing: DemoPricing;
  quote: DemoQuoteProvider;
  store: LocalProjectStore;
  orders: DemoOrderProvider;
  examples: ExampleInfo[];
}

let services: Services | null = null;

export async function loadServices(): Promise<Services> {
  if (services) return services;
  const catalog = new StaticCatalogProvider();
  const [bundle, profile, inspections, library, examples, pricing] = await Promise.all([
    catalog.load(),
    catalog.machineProfile(),
    catalog.inspectionCatalog(),
    catalog.library(),
    catalog.examples(),
    fetch("/catalog/pricing.json").then((r) => r.json() as Promise<DemoPricing>),
  ]);
  const cat = new CatalogIndex(bundle);
  services = { cat, catalog, profile, inspections, library, pricing, quote: new DemoQuoteProvider(cat, pricing, inspections), store: new LocalProjectStore(), orders: new DemoOrderProvider(), examples };
  return services;
}

/** Available after boot (App renders only once services are loaded). */
export function svc(): Services {
  if (!services) throw new Error("Services not loaded");
  return services;
}
