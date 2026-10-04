import { FLYING_LEAD_SIZE, type CatalogIndex, type ConnectorKind } from "./catalog";
import type { ConnectorInstance, Harness, LeadEnd, Net, NetMember, Project, Revision, Settings, WireEnd } from "./schema";

/**
 * Filter an array property, assigning only when something is removed.
 * Avoids whole-array replace patches (large undo entries) on no-op normalization passes.
 */
export function prune<T, K extends keyof T>(obj: T, key: K, keep: (x: T[K] extends (infer E)[] ? E : never) => boolean): void {
  const arr = obj[key] as unknown as unknown[];
  let drop = false;
  for (const x of arr) if (!keep(x as never)) {
    drop = true;
    break;
  }
  if (drop) obj[key] = arr.filter((x) => keep(x as never)) as unknown as T[K];
}

let uidGen: () => string = () => globalThis.crypto.randomUUID();

export function uid(): string {
  return uidGen();
}

/** Override the id generator (deterministic ids for examples/tests). Returns a restore function. */
export function setUidGenerator(fn: () => string): () => void {
  const prev = uidGen;
  uidGen = fn;
  return () => {
    uidGen = prev;
  };
}

/** Deterministic UUID-shaped ids from a seed (for reproducible examples and fixtures). */
export function seededUids(seed: string): () => string {
  let n = 0;
  return () => {
    n++;
    let h = 2166136261;
    const s = `${seed}:${n}`;
    const out: string[] = [];
    for (let k = 0; k < 4; k++) {
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
      h = Math.imul(h ^ k, 2246822507) >>> 0;
      out.push(h.toString(16).padStart(8, "0"));
    }
    const x = out.join("");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-4${x.slice(13, 16)}-a${x.slice(17, 20)}-${x.slice(20, 32)}`;
  };
}

export function currentRevision(p: Project): Revision {
  const r = p.revisions.find((x) => x.id === p.currentRevisionId);
  if (!r) throw new Error("Current revision missing");
  return r;
}

export function currentHarness(p: Project): Harness {
  return currentRevision(p).harness;
}

const DEFAULT_NC = ["NC", "N/C", "N.C.", "NO_CONNECT", "NOCONNECT", "NO CONNECT"];

/** Is this signal name one of the project's no-connect aliases (case-insensitive, spaces ignored)? */
export function isNoConnectName(settings: Pick<Settings, "noConnectAliases"> | undefined, name: string): boolean {
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, "");
  const n = norm(name);
  if (!n) return false;
  return (settings?.noConnectAliases ?? DEFAULT_NC).some((a) => norm(a) === n);
}

export function memberKey(m: NetMember): string {
  return `${m.connectorId}:${m.cavityId}`;
}

export function endKey(e: WireEnd): string {
  return e.kind === "pin" ? `${e.connectorId}:${e.cavityId}` : spliceKey(e.spliceId, e.barrel ?? 0);
}

export function pairKey(a: WireEnd, b: WireEnd): string {
  const ka = endKey(a);
  const kb = endKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** RefDes prefix: P for plugs, J for receptacles (common aerospace convention). */
export function nextRefDes(h: Harness, kind: ConnectorKind): string {
  const prefix = kind === "plug" ? "P" : kind === "flyingLead" ? "FL" : "J";
  const used = new Set(h.connectors.map((c) => c.refDes));
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

export function nextLabel(existing: string[], prefix: string): string {
  const used = new Set(existing);
  for (let i = 1; ; i++) if (!used.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

export function nextNetName(h: Harness): string {
  const used = new Set(h.nets.map((n) => n.name));
  for (let i = 1; ; i++) {
    const n = `NET_${String(i).padStart(3, "0")}`;
    if (!used.has(n)) return n;
  }
}

export function isAutoNetName(name: string): boolean {
  return /^NET_\d+$/.test(name);
}

export function netOfPin(h: Harness, connectorId: string, cavityId: string): Net | undefined {
  return h.nets.find((n) => n.members.some((m) => m.connectorId === connectorId && m.cavityId === cavityId));
}

export function connectorById(h: Harness, id: string): ConnectorInstance | undefined {
  return h.connectors.find((c) => c.id === id);
}

/** Default gauge for a contact size (§4.2): size 20 → 20 AWG, 22D → 22 AWG. */
export function gaugeForContactSize(size: string): number {
  switch (size) {
    case "23":
      return 24;
    case "22D":
    case "22":
    case "22M":
      return 22;
    case "20":
      return 20;
    case "16":
      return 16;
    case "12":
      return 12;
    case "10":
      return 10;
    case "8":
      return 8;
    default:
      return 22;
  }
}

export function defaultGaugeForEnds(h: Harness, cat: CatalogIndex, ends: WireEnd[]): number {
  let gauge = 0;
  for (const e of ends) {
    if (e.kind !== "pin") continue;
    const c = connectorById(h, e.connectorId);
    const cav = c && cat.cavity(c.pn, e.cavityId);
    // Flying leads take any gauge: the contact at the other end decides.
    if (cav && cav.size !== FLYING_LEAD_SIZE) gauge = Math.max(gauge, gaugeForContactSize(cav.size));
  }
  return gauge || 22;
}

export function defaultColorFor(settings: Settings, net: Net | undefined) {
  const c = settings.colorByClass && net ? (settings.classColors[net.cls] ?? settings.defaultColor) : settings.defaultColor;
  return { base: c.base, stripes: [...c.stripes] };
}

/** Resolve the contact PN used at a pin (override or derived). */
export function contactPnFor(h: Harness, cat: CatalogIndex, connectorId: string, cavityId: string, gauge?: number): string | undefined {
  const c = connectorById(h, connectorId);
  if (!c) return undefined;
  const pin = c.pins[cavityId];
  if (pin?.contactPn) return pin.contactPn;
  const part = cat.connector(c.pn);
  const cav = part?.arrangement.cavities.find((x) => x.id === cavityId);
  if (!part || !cav) return undefined;
  return cat.contactFor(cav.size, part.gender, gauge)?.pn;
}

/** Key of a splice barrel in a net's drawn links (pins use `memberKey`). */
export function spliceKey(spliceId: string, barrel = 0): string {
  return `@sp:${spliceId}:${barrel}`;
}

/** Parse a drawn-link key: a pin, or a splice barrel. */
export function parseLinkKey(k: string): WireEnd {
  if (k.startsWith("@sp:")) {
    const i = k.lastIndexOf(":");
    return { kind: "splice", spliceId: k.slice(4, i), barrel: Number(k.slice(i + 1)) || 0 };
  }
  const i = k.indexOf(":");
  return { kind: "pin", connectorId: k.slice(0, i), cavityId: k.slice(i + 1) };
}

export const isSpliceKey = (k: string) => k.startsWith("@sp:");

/**
 * Nominal circular mil area of a stranded conductor by AWG (MIL-W-22759 / M27500 strandings: 19 strands up to
 * 14 AWG, 37 above). Seed values: verify against the wire spec sheet. Unknown gauges fall back to the solid-wire formula.
 */
const CMA_BY_AWG: Record<number, number> = { 30: 112, 28: 175, 26: 304, 24: 475, 22: 754, 20: 1216, 18: 1900, 16: 2426, 14: 3831, 12: 5874, 10: 9354, 8: 16983 };
export function circularMils(awg: number): number {
  return CMA_BY_AWG[awg] ?? Math.round((5 * 92 ** ((36 - awg) / 39)) ** 2);
}

/** Printed name of a wire end: "P1-3" for a pin, "SP1" / "SP1.2" (barrel 2) for a splice. */
export function wireEndLabel(h: Harness, e: WireEnd): string {
  if (e.kind === "pin") return `${h.connectors.find((c) => c.id === e.connectorId)?.refDes ?? "?"}-${e.cavityId}`;
  const s = h.splices.find((x) => x.id === e.spliceId);
  if (!s) return "SPLICE";
  return s.barrels > 1 ? `${s.label}.${(e.barrel ?? 0) + 1}` : s.label;
}

/** Finish of a flying lead: its own setting, else the flying-lead end's default (tinned, 6 mm strip). */
export function leadEndAt(c: ConnectorInstance, cavityId: string): LeadEnd {
  return c.pins[cavityId]?.leadEnd ?? c.leadEnd ?? { finish: "tinned", stripMm: 6 };
}
