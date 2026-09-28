import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";
import { ProjectSchema, type CatalogIndex, type Project } from "@hs/model";
import type { OrderProvider, OrderRequest, ProjectMeta, ProjectStore, SupplyInfo, SupplyProvider } from "./interfaces";

/** Phase 1 ProjectStore: designs live only in the browser (IndexedDB) and in files the user saves (§4.3, §14.3). */
export class LocalProjectStore implements ProjectStore {
  private store: UseStore;
  private meta: UseStore;
  constructor() {
    this.store = createStore("harness-studio", "projects");
    this.meta = createStore("harness-studio-meta", "meta");
  }
  async save(p: Project) {
    await set(p.id, p, this.store);
  }
  async load(id: string) {
    const raw = await get(id, this.store);
    if (!raw) return undefined;
    const r = ProjectSchema.safeParse(raw);
    return r.success ? r.data : undefined;
  }
  async list(): Promise<ProjectMeta[]> {
    const ids = (await keys(this.store)) as string[];
    const out: ProjectMeta[] = [];
    for (const id of ids) {
      const p = (await get(id, this.store)) as Project | undefined;
      if (p) out.push({ id: p.id, name: p.name, partNumber: p.partNumber, updated: p.updated });
    }
    return out.sort((a, b) => b.updated.localeCompare(a.updated));
  }
  async remove(id: string) {
    await del(id, this.store);
  }
  async lastOpened() {
    return (await get("last", this.meta)) as string | undefined;
  }
  async setLastOpened(id: string) {
    await set("last", id, this.meta);
  }
}

export class DemoSupplyProvider implements SupplyProvider {
  constructor(private cat: CatalogIndex) {}
  async supply(pns: string[]): Promise<SupplyInfo[]> {
    return pns.map((pn) => ({ pn, supply: this.cat.supply(pn) }));
  }
}

/** Phase 1: ordering is a clickable mockup. Nothing is ever submitted (§14, acceptance 12). */
export class DemoOrderProvider implements OrderProvider {
  async submit(_req: OrderRequest) {
    return { status: "comingSoon" as const, message: "Online ordering is coming soon. Nothing was sent: download the output package and contact us to order." };
  }
}
