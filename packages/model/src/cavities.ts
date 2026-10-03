import type { CatalogIndex } from "./catalog";
import type { Harness } from "./schema";

export interface CavityState {
  cavityId: string;
  size: string;
  /** Coax/twinax cavity: no crimp contact or plug in the Phase 1 catalog. */
  special: boolean;
  /** What fills the cavity: a crimped contact, a sealing plug, or nothing we can supply. */
  fill: "contact" | "plug" | "unsupported";
  /** Why it has a contact. */
  reason?: "wire" | "drain" | "filler";
  /** Gauges of every conductor crimped into this cavity (wires + drain). */
  gauges: number[];
  /** A signal is assigned but no conductor lands here (it will be plugged). */
  assignedUnwired: boolean;
  /** A contact PN override on a cavity that has no conductor and isn't a filler. */
  contactWithoutConductor: boolean;
}

/**
 * The physical fill of every cavity of a connector (FIX-05): contacts for wires, drains and fillers; sealing
 * plugs for the rest. Shared by the BOM and the sealing check so they can't disagree.
 */
export function cavityStates(h: Harness, cat: CatalogIndex, connectorId: string): CavityState[] {
  const c = h.connectors.find((x) => x.id === connectorId);
  const part = c && cat.connector(c.pn);
  if (!c || !part || part.flyingLead) return []; // flying-lead ends: no contacts or plugs
  const gauges = new Map<string, number[]>();
  const add = (cav: string, g: number) => (gauges.get(cav) ?? gauges.set(cav, []).get(cav)!).push(g);
  for (const w of h.wires) for (const e of [w.from, w.to]) if (e.kind === "pin" && e.connectorId === c.id) add(e.cavityId, w.gauge);
  const drains = new Set<string>();
  for (const t of h.terminations)
    if (t.method === "drainToPin" && t.drainPin?.connectorId === c.id) {
      drains.add(t.drainPin.cavityId);
      add(t.drainPin.cavityId, t.drain?.gauge ?? 22);
    }
  return part.arrangement.cavities.map((cav) => {
    const g = gauges.get(cav.id) ?? [];
    const pin = c.pins[cav.id];
    const reason = drains.has(cav.id) ? "drain" : g.length ? "wire" : pin?.filler ? "filler" : undefined;
    const fill: CavityState["fill"] = cav.special ? "unsupported" : reason ? "contact" : "plug";
    return {
      cavityId: cav.id,
      size: cav.size,
      special: !!cav.special,
      fill,
      reason,
      gauges: g,
      assignedUnwired: !!pin?.netId && !reason,
      contactWithoutConductor: !!pin?.contactPn && !reason,
    };
  });
}
