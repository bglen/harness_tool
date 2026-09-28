import yaml from "js-yaml";
import { currentRevision, derive, type CatalogIndex, type Project, type WireColor } from "@hs/model";
import type { MappedImport, WireRow } from "./import-wirelist";

// WireViz uses IEC 60757 two-letter color codes; MIL-STD-681 codes are 0–9.
const IEC_TO_MIL: Record<string, number> = { BK: 0, BN: 1, RD: 2, OG: 3, YE: 4, GN: 5, BU: 6, VT: 7, GY: 8, WH: 9, PK: 2, TQ: 6 };
const MIL_TO_IEC = ["BK", "BN", "RD", "OG", "YE", "GN", "BU", "VT", "GY", "WH"];

function iecToColor(c: string): WireColor | undefined {
  const parts = (c.toUpperCase().match(/[A-Z]{2}/g) ?? []).map((p) => IEC_TO_MIL[p]).filter((x): x is number => x !== undefined);
  return parts.length ? { base: parts[0]!, stripes: parts.slice(1, 4) } : undefined;
}

function expandRange(v: unknown): (string | number)[] {
  if (Array.isArray(v)) return v.flatMap(expandRange);
  if (typeof v === "string" && /^\d+-\d+$/.test(v)) {
    const [a, b] = v.split("-").map(Number) as [number, number];
    const out: number[] = [];
    for (let i = a; a <= b ? i <= b : i >= b; a <= b ? i++ : i--) out.push(i);
    return out;
  }
  return [v as string | number];
}

interface WvConnector {
  type?: string;
  subtype?: string;
  pn?: string;
  mpn?: string;
  pincount?: number;
  pins?: (string | number)[];
  pinlabels?: string[];
}

interface WvCable {
  gauge?: number | string;
  gauge_unit?: string;
  length?: number | string;
  length_unit?: string;
  colors?: string[];
  color_code?: string;
  wirecount?: number;
  shield?: boolean | string;
  wirelabels?: string[];
}

/** Import a WireViz YAML file as a mapped wire list (then goes through the same part-resolution flow). */
export function importWireViz(text: string): MappedImport {
  const doc = yaml.load(text) as { connectors?: Record<string, WvConnector>; cables?: Record<string, WvCable>; connections?: unknown[][] };
  const issues: string[] = [];
  const conns = doc.connectors ?? {};
  const cables = doc.cables ?? {};
  const rows: WireRow[] = [];
  const pinName = (cname: string, pin: string | number) => {
    const c = conns[cname];
    if (!c) return undefined;
    const pins = c.pins ?? Array.from({ length: c.pincount ?? c.pinlabels?.length ?? 0 }, (_, i) => i + 1);
    const idx = pins.map(String).indexOf(String(pin));
    return idx >= 0 ? c.pinlabels?.[idx] : undefined;
  };
  for (const set of doc.connections ?? []) {
    if (!Array.isArray(set) || set.length < 3) continue;
    // Pattern: connector → cable → connector
    for (let i = 0; i + 2 < set.length; i += 2) {
      const [a, w, b] = [set[i], set[i + 1], set[i + 2]] as Record<string, unknown>[];
      const an = Object.keys(a ?? {})[0];
      const wn = Object.keys(w ?? {})[0];
      const bn = Object.keys(b ?? {})[0];
      if (!an || !wn || !bn || !conns[an] || !cables[wn] || !conns[bn]) {
        issues.push(`Connection set ${JSON.stringify(set).slice(0, 60)}… not in connector→cable→connector form; skipped`);
        continue;
      }
      const ap = expandRange(a![an]);
      const wp = expandRange(w![wn]);
      const bp = expandRange(b![bn]);
      const cab = cables[wn]!;
      const n = Math.min(ap.length, wp.length, bp.length);
      for (let k = 0; k < n; k++) {
        const wi = Number(wp[k]) - 1;
        const gauge = cab.gauge_unit && /awg/i.test(cab.gauge_unit) ? Number(cab.gauge) : typeof cab.gauge === "string" && /awg/i.test(cab.gauge) ? Number(cab.gauge.replace(/awg/i, "")) : undefined;
        const lengthM = cab.length != null ? Number(String(cab.length).replace(/[^\d.]/g, "")) : undefined;
        const unit = cab.length_unit ?? (typeof cab.length === "string" && /mm/.test(cab.length) ? "mm" : "m");
        rows.push({
          wireId: cab.wirelabels?.[wi] ?? `${wn}.${wi + 1}`,
          signal: pinName(an, ap[k]!) ?? pinName(bn, bp[k]!),
          from: { conn: an, pin: String(ap[k]), pn: conns[an]!.pn ?? conns[an]!.mpn ?? conns[an]!.type },
          to: { conn: bn, pin: String(bp[k]), pn: conns[bn]!.pn ?? conns[bn]!.mpn ?? conns[bn]!.type },
          gauge: Number.isFinite(gauge) ? gauge : undefined,
          color: cab.colors?.[wi] ? iecToColor(cab.colors[wi]!) : undefined,
          lengthMm: lengthM ? (unit === "mm" ? lengthM : unit === "in" ? lengthM * 25.4 : lengthM * 1000) : undefined,
        });
      }
    }
  }
  const connectors = Object.entries(conns).map(([refDes, c]) => ({ refDes, pn: c.pn ?? c.mpn ?? c.type }));
  if (!rows.length) issues.push("No connections found in the WireViz file.");
  return { rows, issues, connectors };
}

/** Export the design as WireViz YAML: one cable per connector pair. */
export function exportWireViz(project: Project, cat: CatalogIndex): string {
  const rev = currentRevision(project);
  const h = rev.harness;
  const d = derive(h, cat, project.settings);
  const connectors: Record<string, WvConnector> = {};
  for (const c of h.connectors) {
    const part = cat.connector(c.pn);
    const cavs = part?.arrangement.cavities ?? [];
    connectors[c.refDes] = {
      type: "MIL-DTL-38999 Series III",
      subtype: part ? `${part.kind}, shell ${part.shellSize}, insert ${part.arrangement.id}` : undefined,
      pn: c.pn,
      pins: cavs.map((x) => x.id),
      pinlabels: cavs.map((x) => (c.pins[x.id]?.netId ? h.nets.find((n) => n.id === c.pins[x.id]!.netId)?.name ?? "" : "")),
    };
  }
  const groups = new Map<string, typeof h.wires>();
  for (const w of h.wires) {
    if (w.from.kind !== "pin" || w.to.kind !== "pin") continue;
    const a = h.connectors.find((c) => c.id === (w.from as { connectorId: string }).connectorId)!.refDes;
    const b = h.connectors.find((c) => c.id === (w.to as { connectorId: string }).connectorId)!.refDes;
    const key = `${a}|${b}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(w);
  }
  const cables: Record<string, WvCable> = {};
  const connections: unknown[][] = [];
  let n = 1;
  for (const [key, ws] of groups) {
    const [a, b] = key.split("|") as [string, string];
    const name = `W${n++}`;
    const sorted = [...ws].sort((x, y) => x.label.localeCompare(y.label, "en", { numeric: true }));
    const gauges = [...new Set(sorted.map((w) => w.gauge))];
    cables[name] = {
      wirecount: sorted.length,
      gauge: gauges.length === 1 ? gauges[0] : undefined,
      gauge_unit: gauges.length === 1 ? "AWG" : undefined,
      length: Math.round((Math.max(...sorted.map((w) => d.wireLengthMm.get(w.id) ?? 0)) / 1000) * 1000) / 1000,
      length_unit: "m",
      colors: sorted.map((w) => [w.color.base, ...w.color.stripes].map((c) => MIL_TO_IEC[c]).join("")),
      wirelabels: sorted.map((w) => w.label),
      shield: sorted.some((w) => w.shieldId) || undefined,
    };
    connections.push([{ [a]: sorted.map((w) => (w.from as { cavityId: string }).cavityId) }, { [name]: sorted.map((_, i) => i + 1) }, { [b]: sorted.map((w) => (w.to as { cavityId: string }).cavityId) }]);
  }
  const doc = { metadata: { title: project.name, pn: project.partNumber, revision: rev.label, generator: "Harness Studio" }, connectors, cables, connections };
  return `# WireViz YAML exported by Harness Studio (${project.partNumber} Rev ${rev.label})\n` + yaml.dump(doc, { noRefs: true, lineWidth: 140, skipInvalid: true });
}
