import Papa from "papaparse";
import {
  addConnector,
  addNode,
  addSegment,
  arrangementId,
  buildD38999,
  currentHarness,
  normalizePn,
  parseD38999,
  parseLength,
  parseWireColor,
  setPinSignals,
  setSegmentProps,
  uid,
  type CatalogIndex,
  type Command,
  type LengthUnit,
  type Project,
  type WireColor,
} from "@hs/model";

export type FieldKey = "wireId" | "signal" | "fromConn" | "fromPin" | "toConn" | "toPin" | "fromPn" | "toPn" | "gauge" | "color" | "length" | "spec" | "ignore";

export const FIELD_LABELS: Record<FieldKey, string> = {
  wireId: "Wire ID",
  signal: "Signal / net",
  fromConn: "From connector",
  fromPin: "From pin",
  toConn: "To connector",
  toPin: "To pin",
  fromPn: "From connector PN",
  toPn: "To connector PN",
  gauge: "Gauge (AWG)",
  color: "Color",
  length: "Length",
  spec: "Wire spec",
  ignore: "(ignore)",
};

const SYN: Record<Exclude<FieldKey, "ignore">, string[]> = {
  wireId: ["wire", "wire id", "wireid", "wire no", "wire #", "wire number", "id", "w#", "wire_id", "cable"],
  signal: ["signal", "net", "net name", "signal name", "name", "function", "description", "signal_name", "netname"],
  fromConn: ["from", "from connector", "from conn", "source", "src", "from refdes", "connector a", "end a", "from_connector", "conn a", "from ref", "from_conn", "a connector", "a"],
  fromPin: ["from pin", "pin a", "from cavity", "src pin", "from_pin", "pin from", "a pin", "from contact", "from_cavity"],
  toConn: ["to", "to connector", "to conn", "destination", "dest", "dst", "to refdes", "connector b", "end b", "to_connector", "conn b", "to ref", "to_conn", "b connector", "b"],
  toPin: ["to pin", "pin b", "to cavity", "dst pin", "dest pin", "to_pin", "pin to", "b pin", "to contact", "to_cavity"],
  fromPn: ["from pn", "from part", "from part number", "from p/n", "a pn", "from_pn", "connector a pn"],
  toPn: ["to pn", "to part", "to part number", "to p/n", "b pn", "to_pn", "connector b pn"],
  gauge: ["gauge", "awg", "wire gauge", "size", "wire size", "ga"],
  color: ["color", "colour", "wire color", "insulation color", "col"],
  length: ["length", "len", "wire length", "cut length", "length (mm)", "length (in)", "length mm", "length in"],
  spec: ["spec", "wire spec", "wire type", "type", "specification", "wire_spec"],
};

export interface ParsedTable {
  header: string[];
  rows: string[][];
}

export function parseDelimited(text: string): ParsedTable {
  const res = Papa.parse<string[]>(text.trim(), { skipEmptyLines: true, delimiter: text.includes("\t") ? "\t" : "" });
  const [header = [], ...rows] = res.data as string[][];
  return { header: header.map((h) => h.trim()), rows: rows.map((r) => r.map((c) => (c ?? "").trim())) };
}

export async function parseXlsx(data: ArrayBuffer): Promise<ParsedTable> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, blankrows: false }) as string[][];
  const [header = [], ...rows] = aoa;
  return { header: header.map((h) => String(h ?? "").trim()), rows: rows.map((r) => header.map((_, i) => String(r[i] ?? "").trim())) };
}

const norm = (s: string) => s.toLowerCase().replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim();

/** Auto-detect a column mapping from header names (§12). */
export function autoMap(header: string[]): FieldKey[] {
  const used = new Set<FieldKey>();
  const out: FieldKey[] = header.map(() => "ignore");
  // exact synonym matches first, then prefix/contains
  for (const pass of [0, 1] as const) {
    header.forEach((hRaw, i) => {
      if (out[i] !== "ignore") return;
      const h = norm(hRaw.replace(/\((mm|in|m|inch|inches|awg)\)/i, ""));
      for (const [k, syns] of Object.entries(SYN) as [Exclude<FieldKey, "ignore">, string[]][]) {
        if (used.has(k)) continue;
        const hit = pass === 0 ? syns.some((s) => norm(s) === h) : syns.some((s) => s.length > 2 && (h.startsWith(norm(s)) || h.includes(` ${norm(s)}`)));
        if (hit) {
          out[i] = k;
          used.add(k);
          return;
        }
      }
    });
  }
  return out;
}

export interface WireRow {
  wireId?: string;
  signal?: string;
  from: { conn: string; pin: string; pn?: string };
  to: { conn: string; pin: string; pn?: string };
  gauge?: number;
  color?: WireColor;
  lengthMm?: number;
  spec?: string;
}

export interface MappedImport {
  rows: WireRow[];
  issues: string[];
  connectors: { refDes: string; pn?: string }[];
}

function splitEnd(conn: string, pin: string | undefined): { conn: string; pin: string } {
  if (pin) return { conn: conn.trim(), pin: pin.trim() };
  const m = /^([A-Za-z]+[0-9]+[A-Za-z]?)[\s\-:.]+([A-Za-z0-9]+)$/.exec(conn.trim());
  return m ? { conn: m[1]!, pin: m[2]! } : { conn: conn.trim(), pin: "" };
}

export function applyMapping(t: ParsedTable, map: FieldKey[], units: LengthUnit, lengthHeaderUnit?: LengthUnit): MappedImport {
  const col = (k: FieldKey) => map.indexOf(k);
  const issues: string[] = [];
  const rows: WireRow[] = [];
  const lenIdx = col("length");
  const hdrUnit: LengthUnit | undefined = lengthHeaderUnit ?? (lenIdx >= 0 ? (/\bin\b|inch/i.test(t.header[lenIdx]!) ? "in" : /\bmm\b/i.test(t.header[lenIdx]!) ? "mm" : /\(m\)/i.test(t.header[lenIdx]!) ? undefined : undefined) : undefined);
  t.rows.forEach((r, i) => {
    const get = (k: FieldKey) => (col(k) >= 0 ? r[col(k)] ?? "" : "");
    const from = splitEnd(get("fromConn"), get("fromPin") || undefined);
    const to = splitEnd(get("toConn"), get("toPin") || undefined);
    if (!from.conn || !from.pin || !to.conn || !to.pin) {
      if (r.some((c) => c)) issues.push(`Row ${i + 2}: missing from/to connector or pin; skipped`);
      return;
    }
    const g = get("gauge").replace(/awg/i, "").trim();
    const gauge = g ? Number(g) : undefined;
    if (g && !Number.isFinite(gauge)) issues.push(`Row ${i + 2}: gauge "${g}" not understood`);
    const c = get("color");
    const color = c ? parseWireColor(c) ?? undefined : undefined;
    if (c && !color) issues.push(`Row ${i + 2}: color "${c}" not understood (use MIL-STD-681 codes like 9-6 or WHT/BLU)`);
    const l = get("length");
    const lengthMm = l ? parseLength(l, hdrUnit ?? units) ?? undefined : undefined;
    rows.push({ wireId: get("wireId") || undefined, signal: get("signal") || undefined, from: { ...from, pn: get("fromPn") || undefined }, to: { ...to, pn: get("toPn") || undefined }, gauge: Number.isFinite(gauge) ? gauge : undefined, color, lengthMm, spec: get("spec") || undefined });
  });
  const conns = new Map<string, string | undefined>();
  for (const r of rows) {
    if (!conns.has(r.from.conn) || r.from.pn) conns.set(r.from.conn, r.from.pn ?? conns.get(r.from.conn));
    if (!conns.has(r.to.conn) || r.to.pn) conns.set(r.to.conn, r.to.pn ?? conns.get(r.to.conn));
  }
  return { rows, issues, connectors: [...conns].map(([refDes, pn]) => ({ refDes, pn })) };
}

export interface PartMatch {
  input: string;
  status: "exact" | "normalized" | "fuzzy" | "none";
  pn?: string;
  candidates: string[];
}

/** Match an imported connector PN to the catalog: exact → normalized → fuzzy (§12). */
export function resolveConnectorPn(input: string | undefined, cat: CatalogIndex, pinsNeeded: string[] = []): PartMatch {
  const raw = (input ?? "").trim();
  if (raw) {
    const exact = cat.connector(raw);
    if (exact && exact.pn === raw.toUpperCase()) return { input: raw, status: "exact", pn: exact.pn, candidates: [exact.pn] };
    const n = normalizePn(raw).replace(/^M38999/, "D38999").replace(/^MS27/, "D38999");
    const byNorm = cat.connector(n) ?? cat.connector(n.replace(/-$/, ""));
    if (byNorm) return { input: raw, status: "normalized", pn: byNorm.pn, candidates: [byNorm.pn] };
    // fuzzy: extract shell-insert (e.g. "13-35") and gender hints
    const arr = /(\d{1,2})-(\d{1,3})/.exec(raw);
    const gender = /\bS\b|socket|SN$|S[A-E]$/i.test(raw) ? "S" : "P";
    const slash = /\/?(20|24|26)/.exec(raw)?.[1] ?? "26";
    const cands: string[] = [];
    if (arr) {
      const shell = Number(arr[1]);
      const id = arrangementId(shell, arr[2]!);
      if (cat.arrangements.has(id)) for (const sl of [slash, "26", "20", "24"]) cands.push(buildD38999({ slash: sl, finish: "W", shellSize: shell, insert: arr[2]!, contactStyle: gender, keying: "N" }));
    }
    const p = parseD38999(n);
    if (p) for (const f of ["W", "Z", "M"]) cands.push(buildD38999({ ...p, finish: f }));
    const uniq = [...new Set(cands)].filter((c) => cat.connector(c));
    if (uniq.length) return { input: raw, status: "fuzzy", pn: uniq[0], candidates: uniq };
  }
  // No PN: suggest the smallest insert that has all needed pin ids
  const machine = (a: { special?: string; sizes: Record<string, number> }) => !a.special && Object.keys(a.sizes).every((s) => ["22D", "20", "16", "12"].includes(s));
  const fits = [...cat.arrangements.values()]
    .filter((a) => !a.inactive && pinsNeeded.every((pin) => a.cavities.some((c) => c.id === pin)) && a.contactCount >= pinsNeeded.length)
    .sort((a, b) => Number(machine(b)) - Number(machine(a)) || Number(b.status === "verified") - Number(a.status === "verified") || a.contactCount - b.contactCount || a.shellSize - b.shellSize)
    .slice(0, 5)
    .map((a) => buildD38999({ slash: "26", finish: "W", shellSize: a.shellSize, insert: a.insert, contactStyle: "S", keying: "N" }));
  return { input: raw, status: "none", pn: fits[0], candidates: fits };
}

/**
 * Build commands that add the imported connectors, nets, wires and segments.
 * Connectors already on the canvas (same refDes) are reused. Layout: left-to-right; star from a central breakout for > 2 connectors.
 */
export function buildImportCommands(project: Project, cat: CatalogIndex, imp: MappedImport, pns: Record<string, string>): { commands: Command[]; notes: string[] } {
  const h = currentHarness(project);
  const commands: Command[] = [];
  const notes: string[] = [];
  const idOf = new Map<string, string>();
  const newConns = imp.connectors.filter((c) => !h.connectors.some((x) => x.refDes === c.refDes));
  const x0 = h.connectors.length ? Math.max(...h.connectors.map((c) => c.position.x)) + 500 : 0;
  // Sources (mostly "from") go in the left column, destinations on the right.
  const fromCount = new Map<string, number>();
  for (const r of imp.rows) {
    fromCount.set(r.from.conn, (fromCount.get(r.from.conn) ?? 0) + 1);
    fromCount.set(r.to.conn, (fromCount.get(r.to.conn) ?? 0) - 1);
  }
  let leftCol = newConns.filter((c) => (fromCount.get(c.refDes) ?? 0) > 0);
  let rightCol = newConns.filter((c) => !leftCol.includes(c));
  if (!leftCol.length || !rightCol.length) {
    const half = Math.ceil(newConns.length / 2);
    leftCol = newConns.slice(0, half);
    rightCol = newConns.slice(half);
  }
  const place = (list: typeof newConns, left: boolean) =>
    list.forEach((c, i) => {
      const id = uid();
      idOf.set(c.refDes, id);
      const pn = pns[c.refDes] ?? c.pn ?? "";
      const y = (i - (list.length - 1) / 2) * 420;
      commands.push(addConnector({ id, pn, position: { x: x0 + (left ? 0 : 900), y }, rotation: left ? 0 : 180, refDes: c.refDes }));
    });
  place(leftCol, true);
  place(rightCol, false);
  for (const c of h.connectors) idOf.set(c.refDes, c.id);
  // Signals: each row puts its signal (or a generated name) on both pins
  const byConn = new Map<string, { cavityId: string; name: string }[]>();
  imp.rows.forEach((r, i) => {
    const name = r.signal || r.wireId || `NET_IMP_${i + 1}`;
    for (const e of [r.from, r.to]) {
      const cid = idOf.get(e.conn)!;
      (byConn.get(cid) ?? byConn.set(cid, []).get(cid)!).push({ cavityId: e.pin, name });
    }
  });
  for (const [cid, entries] of byConn) commands.push(setPinSignals({ connectorId: cid, entries }));
  // Topology: star from a central breakout when > 2 connectors (§12)
  const conns = [...new Set(imp.connectors.map((c) => c.refDes))].map((r) => idOf.get(r)!);
  if (conns.length > 2 && newConns.length === conns.length) {
    const hub = uid();
    commands.push(addNode({ id: hub, position: { x: x0 + 400, y: 0 } }));
    notes.push("Segments were created as a star from a central breakout; adjust lengths and layout on the canvas.");
    // Segments are added after connector nodes exist: use a deferred command sequence
    commands.push({ type: "__starSegments", payload: { hub, connectorIds: conns } });
  }
  // Wire lengths → segment length for simple 2-connector harnesses
  const lens = imp.rows.map((r) => r.lengthMm).filter((x): x is number => !!x);
  if (conns.length === 2 && lens.length) {
    const allowance = 2 * 38;
    commands.push({ type: "__segmentLength", payload: { a: conns[0], b: conns[1], lengthMm: Math.max(25, Math.max(...lens) - allowance) } });
    notes.push("Segment length set from the longest wire length minus termination allowances.");
  }
  // Gauge/color/spec per wire: applied after wires exist
  commands.push({ type: "__wireProps", payload: { rows: imp.rows.map((r) => ({ from: { c: idOf.get(r.from.conn), p: r.from.pin }, to: { c: idOf.get(r.to.conn), p: r.to.pin }, gauge: r.gauge, color: r.color, spec: r.spec, label: r.wireId })) } });
  // Net classes (power/ground/RF) are guessed from signal names when nets are created.
  return { commands, notes };
}

/** Expand the deferred pseudo-commands against the harness state after the main batch ran. */
export function expandDeferred(project: Project, cmds: Command[], cat: CatalogIndex): Command[] {
  const h = currentHarness(project);
  const out: Command[] = [];
  for (const c of cmds) {
    if (c.type === "__starSegments") {
      const { hub, connectorIds } = c.payload as { hub: string; connectorIds: string[] };
      // remove auto-created direct segments between connectors, add star
      const connNodes = connectorIds.map((id) => h.nodes.find((n) => n.connectorId === id)?.id).filter(Boolean) as string[];
      for (const nid of connNodes) out.push(addSegment({ id: uid(), a: hub, b: nid, lengthMm: project.settings.defaultSegmentMm }));
      const direct = h.segments.filter((s) => connNodes.includes(s.a) && connNodes.includes(s.b)).map((s) => s.id);
      if (direct.length) out.push({ type: "deleteSegments", payload: { ids: direct } });
    } else if (c.type === "__segmentLength") {
      const { a, b, lengthMm } = c.payload as { a: string; b: string; lengthMm: number };
      const na = h.nodes.find((n) => n.connectorId === a)?.id;
      const nb = h.nodes.find((n) => n.connectorId === b)?.id;
      const seg = h.segments.find((s) => (s.a === na && s.b === nb) || (s.a === nb && s.b === na));
      if (seg) out.push(setSegmentProps({ ids: [seg.id], lengthMm }));
    } else if (c.type === "__wireProps") {
      const rows = (c.payload as { rows: { from: { c: string; p: string }; to: { c: string; p: string }; gauge?: number; color?: WireColor; spec?: string }[] }).rows;
      for (const r of rows) {
        const w = h.wires.find((x) => {
          const e = [x.from, x.to].filter((q) => q.kind === "pin") as { connectorId: string; cavityId: string }[];
          const k = e.map((q) => `${q.connectorId}:${q.cavityId}`);
          return k.includes(`${r.from.c}:${r.from.p}`) && k.includes(`${r.to.c}:${r.to.p}`);
        });
        if (!w) continue;
        const payload: Record<string, unknown> = { ids: [w.id] };
        if (r.gauge && cat.wire(r.spec && cat.wire(r.spec, r.gauge) ? r.spec : w.spec, r.gauge)) payload.gauge = r.gauge;
        if (r.color) payload.color = r.color;
        if (r.spec && cat.wire(r.spec, r.gauge ?? w.gauge)) payload.spec = r.spec;
        if (Object.keys(payload).length > 1) out.push({ type: "setWireProps", payload });
      }
    }
  }
  return out;
}

export function isDeferred(c: Command) {
  return c.type.startsWith("__");
}

export type { LengthUnit };
