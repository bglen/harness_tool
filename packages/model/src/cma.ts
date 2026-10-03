import type { CatalogIndex } from "./catalog";
import { circularMils } from "./helpers";
import type { Harness, Splice, Wire } from "./schema";

/**
 * Circular mil area (CMA) in crimp barrels: the conductors a contact or splice barrel holds, including CMA build-up
 * filler strands. The CMA checks, splice part selection, BOM and build notes all read this one model.
 */

export interface BarrelFill {
  wires: Wire[];
  /** Drain wires terminated in the barrel (contacts only), by gauge. */
  drains: number[];
  buildUp: { gauge: number; count: number } | null;
  /** Conductors only. */
  wireCma: number;
  /** Conductors + build-up. */
  cma: number;
}

const fill = (wires: Wire[], drains: number[], buildUp: BarrelFill["buildUp"]): BarrelFill => {
  const wireCma = wires.reduce((s, w) => s + circularMils(w.gauge), 0) + drains.reduce((s, g) => s + circularMils(g), 0);
  return { wires, drains, buildUp, wireCma, cma: wireCma + (buildUp ? buildUp.count * circularMils(buildUp.gauge) : 0) };
};

/** What's crimped in a contact. */
export function contactFill(h: Harness, connectorId: string, cavityId: string): BarrelFill {
  const wires = h.wires.filter((w) => [w.from, w.to].some((e) => e.kind === "pin" && e.connectorId === connectorId && e.cavityId === cavityId));
  const drains = h.terminations.filter((t) => t.method === "drainToPin" && t.drainPin?.connectorId === connectorId && t.drainPin.cavityId === cavityId).map((t) => t.drain?.gauge ?? 22);
  const b = h.connectors.find((c) => c.id === connectorId)?.pins[cavityId]?.buildUp;
  return fill(wires, drains, b ?? null);
}

/** What's crimped in each barrel of a splice. */
export function spliceFills(h: Harness, s: Splice): BarrelFill[] {
  return Array.from({ length: s.barrels }, (_, i) => {
    const wires = h.wires.filter((w) => [w.from, w.to].some((e) => e.kind === "splice" && e.spliceId === s.id && (e.barrel ?? 0) === i));
    const b = s.buildUp.filter((x) => x.barrel === i);
    return fill(wires, [], b.length ? { gauge: b[0]!.gauge, count: b.reduce((n, x) => n + x.count, 0) } : null);
  });
}

/** The CMA window a contact's crimp barrel accepts, from its rated gauge range. */
export function contactCmaRange(cat: CatalogIndex, contactPn: string | undefined): { min: number; max: number } | null {
  const cp = contactPn ? cat.contactsByPn.get(contactPn) : undefined;
  if (!cp) return null;
  // gaugeMin is the thinnest (numerically largest) AWG accepted, gaugeMax the heaviest.
  return { min: circularMils(cp.gaugeMin), max: circularMils(cp.gaugeMax) };
}

/**
 * Smallest build-up that lifts a barrel to `min`: filler strands of the barrel's own (thinnest) wire gauge.
 * Null when nothing is needed.
 */
export function buildUpFor(fillNow: BarrelFill, min: number): { gauge: number; count: number } | null {
  const short = min - fillNow.wireCma;
  if (short <= 0) return null;
  const gauge = Math.max(...fillNow.wires.map((w) => w.gauge), ...fillNow.drains, 22);
  return { gauge, count: Math.ceil(short / circularMils(gauge)) };
}

/** Length of one CMA build-up strand (cut from the filler wire): enough to lie the full length of the crimp barrel. */
export const BUILD_UP_STRAND_MM = 25;

/** Every CMA build-up in the harness, for the BOM, operations and build notes. */
export function buildUps(h: Harness): { where: string; gauge: number; count: number; objectId: string }[] {
  const out: { where: string; gauge: number; count: number; objectId: string }[] = [];
  for (const c of h.connectors) for (const [cav, pin] of Object.entries(c.pins)) if (pin.buildUp) out.push({ where: `${c.refDes}-${cav}`, ...pin.buildUp, objectId: c.id });
  for (const s of h.splices) for (const b of s.buildUp) out.push({ where: `${s.label}${s.barrels > 1 ? ` barrel ${b.barrel + 1}` : ""}`, gauge: b.gauge, count: b.count, objectId: s.id });
  return out;
}
