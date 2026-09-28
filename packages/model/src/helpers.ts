import type { CatalogIndex } from "./catalog";
import type { ConnectorInstance, Harness, Net, NetMember, Project, Revision, Settings, WireEnd } from "./schema";

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

export function memberKey(m: NetMember): string {
  return `${m.connectorId}:${m.cavityId}`;
}

export function endKey(e: WireEnd): string {
  return e.kind === "pin" ? `${e.connectorId}:${e.cavityId}` : `splice:${e.spliceId}`;
}

export function pairKey(a: WireEnd, b: WireEnd): string {
  const ka = endKey(a);
  const kb = endKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** RefDes prefix: P for plugs, J for receptacles (common aerospace convention). */
export function nextRefDes(h: Harness, kind: "plug" | "receptacle"): string {
  const prefix = kind === "plug" ? "P" : "J";
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
    if (cav) gauge = Math.max(gauge, gaugeForContactSize(cav.size));
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
