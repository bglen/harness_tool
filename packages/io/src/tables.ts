import Papa from "papaparse";
import { affectedParts, contactPnFor, currentRevision, derive, formatWireColor, wireEndLabel, type CatalogIndex, type Derived, type Harness, type Project, type Revision, type WireEnd } from "@hs/model";
import { computeBom, type Bom } from "@hs/ops";
import type { DfmSummary } from "@hs/dfm";

export type Table = { name: string; header: string[]; rows: (string | number)[][] };

const r3 = (n: number) => Math.round(n * 1000) / 1000;

function ends(rev: Revision, e: WireEnd) {
  return wireEndLabel(rev.harness, e);
}

export function wireListTable(project: Project, cat: CatalogIndex, rev: Revision = currentRevision(project), d?: Derived): Table {
  const h = rev.harness;
  const der = d ?? derive(h, cat, project.settings);
  const rows = [...h.wires]
    .sort((a, b) => a.label.localeCompare(b.label, "en", { numeric: true }))
    .map((w) => {
      const net = h.nets.find((n) => n.id === w.netId);
      const tw = w.twistGroupId ? `TW${h.twistGroups.findIndex((g) => g.id === w.twistGroupId) + 1}` : "";
      const sh = w.shieldId ? h.shields.find((s) => s.id === w.shieldId)?.label ?? "" : "";
      const labels = h.labels.filter((l) => l.attachedTo.kind === "wire" && l.attachedTo.id === w.id).length;
      return [w.label, net?.name ?? "", ends(rev, w.from), ends(rev, w.to), w.gauge, w.spec, formatWireColor(w.color), r3(der.wireLengthMm.get(w.id) ?? 0), tw, sh, labels ? `${labels}` : ""];
    });
  return { name: "Wire list", header: ["Wire ID", "Net", "From", "To", "Gauge (AWG)", "Spec", "Color", "Length (mm)", "Twist", "Shield", "Labels"], rows };
}

export function pinoutTable(project: Project, cat: CatalogIndex, rev: Revision = currentRevision(project)): Table {
  const h = rev.harness;
  const rows: (string | number)[][] = [];
  for (const c of [...h.connectors].sort((a, b) => a.refDes.localeCompare(b.refDes, "en", { numeric: true }))) {
    const part = cat.connector(c.pn);
    for (const cav of part?.arrangement.cavities ?? []) {
      const pin = c.pins[cav.id];
      const net = pin?.netId ? h.nets.find((n) => n.id === pin.netId) : undefined;
      const w = h.wires.find((x) => [x.from, x.to].some((e) => e.kind === "pin" && e.connectorId === c.id && e.cavityId === cav.id));
      const contact = net || pin?.filler ? contactPnFor(h, cat, c.id, cav.id, w?.gauge) ?? "" : cat.sealingPlug(cav.size)?.pn ?? "";
      const nc = !net && pin?.noConnect;
      const status = net ? "" : nc ? "no connect" : pin?.filler ? "wired spare" : "unassigned";
      rows.push([c.refDes, c.pn, cav.id, cav.size, net?.name ?? (nc ? project.settings.noConnectLabel : ""), status, w?.label ?? "", w?.gauge ?? "", w ? formatWireColor(w.color) : "", contact]);
    }
  }
  return { name: "Pinouts", header: ["RefDes", "Connector PN", "Cavity", "Contact size", "Signal", "Status", "Wire ID", "Gauge (AWG)", "Color", "Contact / plug PN"], rows };
}

/** Quantity for output: exact to 1e-6, rounded UP (a requirement is never rounded down). */
const qtyOut = (q: number) => Math.ceil(q * 1e6 - 1e-6) / 1e6;

/** BOM export. `pricing` and `supply` implement the audience redaction policy (feedback §7). */
export function bomTable(bom: Bom, opts: { pricing: boolean; supply?: boolean } = { pricing: true }): Table {
  const supply = opts.supply ?? opts.pricing;
  const header = ["Line", "Part number", "Description", "Category", "Qty per harness", "UoM", "Refs", "Mass (g)", "Machine-ready", "Customer-furnished", "Data status", "Qualification"];
  if (opts.pricing) header.push("Unit cost (USD, demo)", "Ext. cost (USD, demo)");
  if (supply) header.push("Stock (demo)", "Covers order", "Lead time (days, demo)", "Lifecycle", "As of");
  const rows = bom.lines.map((l) => {
    const r: (string | number)[] = [l.line, l.pn, l.description, l.category, qtyOut(l.qty), l.uom, l.refs.join(" "), r3(l.massG), l.machineReady ? "yes" : "no", l.customerFurnished ? "yes" : "", l.dataStatus, l.qualification.status];
    if (opts.pricing) r.push(l.unitCost, l.extCost);
    if (supply) r.push(l.stock, l.stockSufficient ? "yes" : "no", l.leadDays, l.lifecycle, l.asOf);
    return r;
  });
  return { name: "BOM", header, rows };
}

/** DFM results, one row per finding (open and waived), with the affected parts named (P1, W3, SP1 …). */
export function dfmTable(s: DfmSummary, h?: Harness): Table {
  const rows: (string | number)[][] = [];
  const parts = (ids: string[]) => (h ? affectedParts(h, ids) : "");
  for (const r of s.results) {
    const base = [r.eff.rule.id, r.eff.source.name + (r.eff.source.version ? ` v${r.eff.source.version}` : ""), r.eff.rule.category, r.eff.rule.title, r.eff.severity];
    for (const v of r.violations) rows.push([...base, "fail", parts(v.objectIds), v.message, "", "", ""]);
    for (const v of r.waived) rows.push([...base, "waived", parts(v.objectIds), v.message, v.note, v.author, v.date]);
    if (!r.violations.length && !r.waived.length) rows.push([...base, r.status === "pass" ? "none found" : r.status, "", r.error ?? "", "", "", ""]);
  }
  return { name: "DFM results", header: ["Rule ID", "Source", "Category", "Finding", "Severity", "Status", "Affected", "Message", "Waiver note", "Waived by", "Waived on"], rows };
}

/** Deterministic CSV (fixed column order, \n line endings, no BOM) for byte-identical regeneration. */
export function toCsv(t: Table): string {
  return Papa.unparse({ fields: t.header, data: t.rows }, { newline: "\n" }) + "\n";
}

export async function toXlsx(tables: Table[]): Promise<Uint8Array> {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const t of tables) {
    const ws = XLSX.utils.aoa_to_sheet([t.header, ...t.rows]);
    ws["!cols"] = t.header.map((h, i) => ({ wch: Math.min(48, Math.max(h.length, ...t.rows.slice(0, 200).map((r) => String(r[i] ?? "").length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, t.name.slice(0, 31));
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
  return new Uint8Array(out);
}

export function bomFor(project: Project, cat: CatalogIndex, qty = project.quote.selected.qty): Bom {
  const rev = currentRevision(project);
  return computeBom(project, rev, cat, undefined, qty);
}
