/**
 * Re-runnable import of D38999 research data into the Phase 1 catalog CSV layout (spec 15.2).
 *
 *   research/insert_arrangements.csv + insert_coordinates.csv   -> verified rows
 *   research/insert_coordinates_unreviewed.csv + insert_index   -> unreviewed rows (flagged)
 *   research/text/MIL-STD-1560C.txt                             -> contact sizes / counts / service rating
 *
 * Outputs data/catalog/connector_arrangements.csv, data/catalog/connector_cavities.csv and
 * data/catalog/import-38999-report.md (anomalies). Run: pnpm data:import-38999
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";

const ROOT = join(import.meta.dirname, "..", "..");
const RES = join(ROOT, "data", "connectors", "d38999", "research");
const OUT = join(ROOT, "data", "catalog");

type Row = Record<string, string>;
const readCsv = (f: string): Row[] => Papa.parse<Row>(readFileSync(join(RES, f), "utf8"), { header: true, skipEmptyLines: true }).data;

const SIZE_TOKENS = ["23-22", "22D", "22M", "22", "23", "20", "16", "12", "10", "8"];
const SPECIAL = /^(Coax|Twinax|Quadrax|Power|Thermocouple|Fiber)/i;

interface SizeRow {
  count: number;
  size: string;
  special?: string;
  locations: string[] | "all" | "others";
}

interface Arr {
  id: string;
  shell: number;
  insert: string;
  pages: number[];
  coords: { id: string; x: number; y: number }[];
  sizeRows: SizeRow[];
  service: string;
  inactive: boolean;
  status: "verified" | "unreviewed";
  source: string;
  notes: string[];
}

const report: string[] = [];
const note = (a: Arr, msg: string) => {
  a.notes.push(msg);
  report.push(`- **${a.id}**: ${msg}`);
};

// --- Load text pages -------------------------------------------------------
const text = readFileSync(join(RES, "text", "MIL-STD-1560C.txt"), "utf8");
const pages = new Map<number, string>();
{
  const parts = text.split(/=== PDF PAGE (\d+) ===/);
  for (let i = 1; i < parts.length; i += 2) pages.set(Number(parts[i]), parts[i + 1]!);
}

// --- Arrangement index + coordinates ---------------------------------------
const isSeriesIII = (shell: number) => shell % 2 === 1 && shell >= 9 && shell <= 25;
const index = readCsv("insert_index.csv");
const arrs = new Map<string, Arr>();
for (const r of index) {
  const id = r.arrangement!;
  const [shell, insert] = id.split("-");
  if (!isSeriesIII(Number(shell))) continue;
  let a = arrs.get(id);
  if (!a) {
    a = { id, shell: Number(shell), insert: insert!, pages: [], coords: [], sizeRows: [], service: "", inactive: false, status: "unreviewed", source: "MIL-STD-1560C Change 3 (machine-extracted, unreviewed)", notes: [] };
    arrs.set(id, a);
  }
  a.pages.push(Number(r.pdf_page));
}

const toIn = (v: string) => {
  const n = parseFloat(v.replace(/^\+/, ""));
  return Number.isFinite(n) ? n : NaN;
};
for (const r of readCsv("insert_coordinates_unreviewed.csv")) {
  const a = arrs.get(r.arrangement!);
  if (!a) continue;
  const x = toIn(r.x!);
  const y = toIn(r.y!);
  if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
  if (a.coords.some((c) => c.id === r.contact_id)) continue; // duplicate extraction
  a.coords.push({ id: r.contact_id!, x, y });
}

// Verified data overrides
const verified = readCsv("insert_arrangements.csv");
const verCoords = readCsv("insert_coordinates.csv");
for (const v of verified) {
  const id = v.arrangement!;
  const [shell, insert] = id.split("-");
  const a: Arr = arrs.get(id) ?? { id, shell: Number(shell), insert: insert!, pages: [Number(v.pdf_page)], coords: [], sizeRows: [], service: "", inactive: false, status: "verified", source: "", notes: [] };
  a.status = "verified";
  a.source = `${v.source}, p${v.printed_page}`;
  a.service = v.service_rating!;
  a.coords = verCoords.filter((c) => c.arrangement === id).map((c) => ({ id: c.contact_id!, x: Number(c.x), y: Number(c.y) }));
  a.sizeRows = [{ count: Number(v.contact_count), size: v.contact_size!, locations: "all" }];
  arrs.set(id, a);
}

// --- Parse size tables from text -------------------------------------------
function tokenRe(a: Arr) {
  return new RegExp(`(^|\\s)${a.shell}\\s+-\\s?${a.insert}(\\s|$)`, "m");
}

function tableText(a: Arr): string {
  const own = a.pages.map((p) => pages.get(p) ?? "").join("\n");
  if (tokenRe(a).test(own)) return own;
  // Size table continues on the following page.
  const nxt = pages.get(Math.max(...a.pages) + 1) ?? "";
  return own + "\n" + nxt;
}

function parseLocations(s: string): string[] | "all" | "others" | null {
  const t = s.trim();
  if (!t) return null;
  if (/^all\s*other/i.test(t)) return "others";
  if (/^all\b/i.test(t)) return "all";
  const out: string[] = [];
  for (const part of t.split(/\s*,\s*/)) {
    const range = /^(\d+)\s*(?:-|thru)\s*(\d+)$/i.exec(part);
    if (range) {
      for (let i = Number(range[1]); i <= Number(range[2]); i++) out.push(String(i));
    } else if (/^[A-Za-z0-9]{1,3}$/.test(part)) out.push(part);
    else break;
  }
  return out.length ? out : null;
}

function parseSizeTable(a: Arr) {
  const txt = tableText(a);
  if (/Inactive for new design/i.test(txt)) a.inactive = true;
  const lines = txt.split(/\r?\n/);
  const tok = tokenRe(a);
  const tokLine = lines.findIndex((l) => tok.test(l) && !/Insert arrangement/i.test(l));
  if (tokLine < 0) {
    note(a, "size table not found; sizes guessed");
    return;
  }
  // Size rows can sit a few lines above the shell/arrangement row (multi-row tables).
  let start = tokLine;
  for (let i = tokLine - 1; i >= Math.max(0, tokLine - 8); i--) {
    if (/contacts|Shell|Arrange|location/i.test(lines[i]!)) break;
    start = i;
  }
  let end = lines.length;
  for (let i = tokLine + 1; i < lines.length; i++) {
    if (/^\s*(FIGURE|NOTE)/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  const rows: SizeRow[] = [];
  const sizeRe = new RegExp(`(?:^|\\s)(\\d{1,3})\\s+(${SIZE_TOKENS.join("|")})(?=\\s|$)(.*)$`);
  let pending: SizeRow | null = null;
  for (const raw of lines.slice(start, end)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const withoutShell = line.replace(new RegExp(`^${a.shell}\\s+-\\s?${a.insert}\\b`), "").trim();
    const m = sizeRe.exec(" " + withoutShell);
    if (m) {
      const count = Number(m[1]);
      const size = m[2]!;
      let rest = m[3]!.trim();
      let special: string | undefined;
      const sp = SPECIAL.exec(rest);
      if (sp) {
        special = sp[1];
        rest = rest.slice(sp[0].length).trim();
      }
      // Drop a service-rating token (M, N, I, II, D) that precedes the location column.
      rest = rest.replace(/^(M|N|I|II|III|D)\s+(?=All|[A-Za-z0-9]{1,3}\s*,|[A-Za-z0-9]{1,3}\s)/, (_s0, r: string) => {
        if (!a.service) a.service = r;
        return "";
      });
      rest = rest.replace(/\b(M39029\/\S+|MS\d+\S*)\b.*$/, "").trim();
      const loc = parseLocations(rest);
      if (count === 0 || count > 200) continue;
      const row: SizeRow = { count, size: size === "23-22" ? "23" : size === "22M" || size === "22" ? "22D" : size, special, locations: loc ?? "others" };
      rows.push(row);
      pending = loc ? null : row;
      continue;
    }
    const tw = /^(\d{1,2})\s+(Coax|Twinax|Quadrax)\s+(.*)$/i.exec(line);
    if (tw) {
      const loc = parseLocations(tw[3]!.replace(/\b(M39029\/\S+).*$/, ""));
      rows.push({ count: Number(tw[1]), size: "8", special: tw[2], locations: loc ?? "others" });
      continue;
    }
    if (pending && /^[A-Za-z0-9]{1,3}(\s*,\s*[A-Za-z0-9]{1,3})*$/.test(line)) {
      pending.locations = parseLocations(line) ?? "others";
      pending = null;
    }
  }
  const seen = new Set<string>();
  a.sizeRows = rows.filter((r) => {
    const k = `${r.count}|${r.size}|${JSON.stringify(r.locations)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const region = lines.slice(start, end).join("\n");
  const svc = /\b(M|N|I|II)\b\s+(All|ALL)\b/.exec(region);
  if (!a.service && svc) a.service = svc[1]!;
}

for (const a of arrs.values()) if (a.status === "unreviewed") parseSizeTable(a);

// --- Coordinate sanity + size assignment -----------------------------------
const SHELL_INSERT_RADIUS_IN: Record<number, number> = { 9: 0.2, 11: 0.26, 13: 0.33, 15: 0.4, 17: 0.46, 19: 0.52, 21: 0.6, 23: 0.66, 25: 0.73 };
const SIZE_RANK: Record<string, number> = { "23": 0, "22D": 1, "20": 2, "16": 3, "12": 4, "10": 5, "8": 6 };

function nnDist(c: { x: number; y: number }, all: { x: number; y: number }[]) {
  let d = Infinity;
  for (const o of all) if (o !== c) d = Math.min(d, Math.hypot(o.x - c.x, o.y - c.y));
  return d;
}

const outArr: Row[] = [];
const outCav: Row[] = [];

for (const a of [...arrs.values()].sort((p, q) => p.shell - q.shell || p.insert.localeCompare(q.insert, "en", { numeric: true }))) {
  if (!a.coords.length) {
    note(a, "no coordinates extracted; arrangement skipped");
    continue;
  }
  // Values that look like mm mis-read as inches
  const lim = SHELL_INSERT_RADIUS_IN[a.shell] ?? 0.8;
  const tooBig = a.coords.filter((c) => Math.hypot(c.x, c.y) > lim * 1.15);
  if (tooBig.length) {
    const scaled = a.coords.map((c) => (Math.hypot(c.x, c.y) > lim * 1.15 ? { ...c, x: c.x / 25.4, y: c.y / 25.4 } : c));
    if (scaled.every((c) => Math.hypot(c.x, c.y) <= lim * 1.15)) {
      a.coords = scaled;
      note(a, `${tooBig.length} coordinate(s) outside the insert looked like mm values; converted`);
    } else {
      a.coords = a.coords.filter((c) => Math.hypot(c.x, c.y) <= lim * 1.15);
      note(a, `${tooBig.length} coordinate(s) outside the insert dropped`);
    }
  }
  const posKey = new Map<string, string>();
  for (const c of a.coords) {
    const k = `${c.x.toFixed(3)},${c.y.toFixed(3)}`;
    if (posKey.has(k)) note(a, `cavities ${posKey.get(k)} and ${c.id} share a position (possible lost sign)`);
    else posKey.set(k, c.id);
  }

  let rows = a.sizeRows;
  const expected = rows.reduce((s, r) => s + r.count, 0);
  let incomplete = false;
  if (!rows.length) {
    rows = [{ count: a.coords.length, size: "22D", locations: "all" }];
    note(a, "contact sizes not parsed; assumed all 22D");
  } else if (expected !== a.coords.length) {
    incomplete = expected > a.coords.length;
    note(a, `table lists ${expected} contacts but ${a.coords.length} coordinates were extracted${incomplete ? " (marked incomplete, excluded from the catalog build)" : ""}`);
  }

  // Assign sizes: explicit location lists first, then 'others'/'all'.
  const sizeOf = new Map<string, string>();
  let explicitOk = true;
  for (const r of rows) {
    if (Array.isArray(r.locations)) {
      const found = r.locations.filter((id) => a.coords.some((c) => c.id === id));
      if (found.length !== r.count) explicitOk = false;
      for (const id of found) sizeOf.set(id, r.size);
    }
  }
  const fallbackRows = rows.filter((r) => !Array.isArray(r.locations));
  if (!explicitOk || fallbackRows.length > 1) {
    // Geometric heuristic: biggest contacts where there is most room.
    sizeOf.clear();
    const bySize = [...rows].sort((p, q) => (SIZE_RANK[q.size] ?? 1) - (SIZE_RANK[p.size] ?? 1));
    const pool = [...a.coords].sort((p, q) => nnDist(q, a.coords) - nnDist(p, a.coords));
    for (const r of bySize) for (let i = 0; i < r.count && pool.length; i++) sizeOf.set(pool.shift()!.id, r.size);
    for (const c of pool) sizeOf.set(c.id, bySize[bySize.length - 1]!.size);
    if (rows.length > 1) note(a, "mixed contact sizes assigned by spacing heuristic (locations not parsed)");
  } else {
    const other = fallbackRows[0]?.size ?? rows[rows.length - 1]!.size;
    for (const c of a.coords) if (!sizeOf.has(c.id)) sizeOf.set(c.id, other);
  }
  const specials = rows.filter((r) => r.special).map((r) => `${r.count}x ${r.special} (size ${r.size})`);
  if (specials.length) note(a, `special contacts: ${specials.join(", ")} (coax/twinax contacts are Phase 2)`);

  const sizes: Record<string, number> = {};
  for (const c of a.coords) sizes[sizeOf.get(c.id)!] = (sizes[sizeOf.get(c.id)!] ?? 0) + 1;

  outArr.push({
    arrangement: a.id,
    shell_size: String(a.shell),
    insert: a.insert,
    contact_count: String(a.coords.length),
    sizes: Object.entries(sizes)
      .sort((p, q) => (SIZE_RANK[q[0]] ?? 0) - (SIZE_RANK[p[0]] ?? 0))
      .map(([s, n]) => `${s}:${n}`)
      .join(";"),
    service_rating: a.service || "",
    status: a.status,
    inactive: String(a.inactive),
    incomplete: String(incomplete),
    special: specials.join("; "),
    source: a.status === "verified" ? a.source : `MIL-STD-1560C Change 3, PDF p${a.pages.join("/")}`,
    notes: a.notes.join(" | "),
  });
  for (const c of a.coords) {
    outCav.push({ arrangement: a.id, cavity_id: c.id, x_mm: (c.x * 25.4).toFixed(3), y_mm: (c.y * 25.4).toFixed(3), contact_size: sizeOf.get(c.id)!, status: a.status });
  }
}

const header = "# schema=1; units: x_mm/y_mm in millimetres, pin mating-face view; generated by scripts/data-build/import-38999.ts (edit research data and re-run, or edit here and set status=verified)\n";
writeFileSync(join(OUT, "connector_arrangements.csv"), header + Papa.unparse(outArr) + "\n");
writeFileSync(join(OUT, "connector_cavities.csv"), header + Papa.unparse(outCav) + "\n");
writeFileSync(
  join(OUT, "import-38999-report.md"),
  `# D38999 insert import report\n\n${outArr.length} Series III arrangements, ${outCav.length} cavities. ` +
    `${outArr.filter((r) => r.status === "verified").length} verified; the rest are machine-extracted and **unreviewed** (shown with an "Unreviewed geometry" tag in the app). ` +
    `Arrangements marked incomplete are excluded from the catalog build.\n\n## Anomalies\n\n${report.join("\n")}\n`,
);
console.log(`arrangements=${outArr.length} cavities=${outCav.length} anomalies=${report.length}`);
