/**
 * pnpm data:build (spec 15.4)
 *  1. Parse each catalog CSV with a Zod schema; errors report file, row and column.
 *  2. Check references (compatibility rows, cavities, alternates, duplicate PNs).
 *  3. Compile a JSON bundle per family + a MiniSearch index for the part picker.
 *  4. Write a catalog version (content hash + date).
 * Also validates profile/library/demo JSON and builds example designs.
 * A failure exits non-zero, which blocks the build.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import MiniSearch from "minisearch";
import Papa from "papaparse";
import { z, type ZodTypeAny } from "zod";
import type { CatalogBundle } from "../../packages/model/src/catalog";
import { RulesetSchema, FinishingPresetSchema, RuleInstanceSchema } from "../../packages/model/src/schema";
import { buildExamples } from "./examples";

const ROOT = join(import.meta.dirname, "..", "..");
const CAT = join(ROOT, "data", "catalog");
const OUT = join(ROOT, "apps", "web", "public", "catalog");
const errors: string[] = [];
const warnings: string[] = [];
const hash = createHash("sha256");

// ─── CSV loading with row-level Zod validation ─────────────────────────────
const num = z.coerce.number().refine(Number.isFinite, "must be a number");
const bool = z.preprocess((v) => (v === "true" || v === true ? true : v === "false" || v === false ? false : v), z.boolean());
const str = z.string();
const optStr = z.string().optional().default("");
const optNum = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().optional());
const list = (sep = ";") => z.string().transform((s) => (s ? s.split(sep).map((x) => x.trim()) : []));
const numList = z.string().transform((s) => (s ? s.split(";").map(Number) : []));
const status = z.enum(["verified", "unreviewed", "seed"]);
const lifecycle = z.enum(["active", "nrnd", "obsolete", "inactive"]);

function load<S extends ZodTypeAny>(file: string, row: S): z.infer<S>[] {
  const path = join(CAT, file);
  if (!existsSync(path)) {
    errors.push(`${file}: missing`);
    return [];
  }
  const raw = readFileSync(path, "utf8");
  hash.update(file).update(raw);
  const body = raw
    .split(/\r?\n/)
    .filter((l) => !l.startsWith("#"))
    .join("\n");
  const parsed = Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });
  for (const e of parsed.errors) errors.push(`${file}: row ${(e.row ?? 0) + 2}: ${e.message}`);
  const out: z.infer<S>[] = [];
  parsed.data.forEach((r, i) => {
    const res = row.safeParse(r);
    if (res.success) out.push(res.data);
    else for (const iss of res.error.issues) errors.push(`${file}: row ${i + 2}, column "${iss.path.join(".")}": ${iss.message}`);
  });
  return out;
}

const SHELLS = [9, 11, 13, 15, 17, 19, 21, 23, 25];

const connectors = load(
  "connectors.csv",
  z.object({ slash: str, series: str, kind: z.enum(["plug", "receptacle"]), mount: str, description: str, termination_allowance_mm: num, machine_ready: bool, fixture_prefix: str, lifecycle, status }).passthrough(),
);
const finishes = load("finishes.csv", z.object({ code: str, material: str, finish: str, conductive: bool, hermetic: bool, temp_max_c: num, cadmium: bool, lifecycle, notes: optStr }));
const shells = load("shell_sizes.csv", z.object({ code: str, shell_size: num, accessory_id_mm: num, shell_od_mm: num, accessory_thread: str }));
const contactSizes = load("contact_sizes.csv", z.object({ size: str, sealing_min_mm: num, sealing_max_mm: num, gauges: numList, current_a: num, source: str }));
const arrangements = load(
  "connector_arrangements.csv",
  z.object({ arrangement: z.string().regex(/^\d+-\d+$/), shell_size: num, insert: str, contact_count: num, sizes: str, service_rating: optStr, status, inactive: bool, incomplete: bool, special: optStr, source: str, notes: optStr }),
);
const cavities = load("connector_cavities.csv", z.object({ arrangement: str, cavity_id: z.string().min(1), x_mm: num, y_mm: num, contact_size: str, status }));
const contacts = load(
  "contacts.csv",
  z.object({ pn: str, size: str, gender: z.enum(["pin", "socket"]), gauge_min: num, gauge_max: num, plating: str, crimp_tool: str, positioner: str, insertion_tool: str, removal_tool: str, machine_insertable: bool, current_a: num, status }),
);
const connContacts = load("connector_contacts.csv", z.object({ series: str, size: str, gender: str, contact_pn: str }));
const backshells = load(
  "backshells.csv",
  z.object({ pn: str, description: str, shell_sizes: numList, angle: z.coerce.number().pipe(z.union([z.literal(0), z.literal(45), z.literal(90)])), style: z.enum(["strainRelief", "emiBand", "shieldRing", "pottingBoot"]), clamp_min_mm: num, clamp_max_mm: num, band_platform: bool, mass_g: num, length_mm: num, machine_ready: bool, status }),
);
const connBackshells = load("connector_backshells.csv", z.object({ series: str, shell_size: num, backshell_pn: str }));
const accessories = load(
  "accessories.csv",
  z.object({ pn: str, kind: z.enum(["dustCap", "jamNut", "oRing", "gasket", "groundingRing", "sealingPlug"]), description: str, shell_sizes: numList, for_kind: z.enum(["plug", "receptacle", "any"]), lanyard: bool, contact_size: optStr, mass_g: num, status }),
);
const wires = load(
  "wires.csv",
  z.object({ spec: str, gauge: num, pn_pattern: str, od_mm: num, mass_g_per_m: num, ohm_per_km: num, current_a: num, temp_c: num, insulation: str, conductor: str, machine_ready: bool, status }),
);
const cables = load("cables.csv", z.object({ kind: z.enum(["wire", "shield", "jacket"]), code: str, spec: optStr, material: optStr, thickness_mm: optNum, coverage: optNum, gauges: numList }));
const layers = load(
  "layers.csv",
  z.object({
    pn: str,
    type: z.enum(["tape", "sleeve", "heatShrink", "jacket", "conduit", "overbraid"]),
    material: str,
    description: str,
    min_dia_mm: num,
    max_dia_mm: num,
    thickness_mm: num,
    mass_g_per_m: num,
    coverage_options: numList,
    shrink_ratio: optNum,
    machine_ready: bool,
    status,
  }),
);
const clamps = load("clamps.csv", z.object({ pn: str, description: str, min_dia_mm: num, max_dia_mm: num, tension_spec: str, tool: str, mass_g: num }));
const boots = load("boots.csv", z.object({ pn: str, shape: z.enum(["straight", "90", "Y", "T", "multi"]), description: str, min_dia_mm: num, max_dia_mm: num, mass_g: num }));
const labels = load("labels.csv", z.object({ pn: str, type: z.enum(["sleeve", "flag", "wrap", "direct"]), description: str, min_dia_mm: num, max_dia_mm: num, printable_length_mm: num, chars_per_mm: num }));
const splices = load("splices.csv", z.object({ pn: str, type: z.enum(["solderSleeve", "crimp", "ultrasonic"]), description: str, gauge_min: num, gauge_max: num, max_wires: num, mass_g: num }));
const potting = load("potting.csv", z.object({ pn: str, kind: z.enum(["compound", "mold"]), description: str, cure_hours: num, density_g_per_cc: optNum, shell_sizes: numList }));
const hardware = load("hardware.csv", z.object({ pn: str, type: z.enum(["cushionClamp", "spotTie", "lacing"]), description: str, min_dia_mm: num, max_dia_mm: num }));
const alternates = load("alternates.csv", z.object({ pn: str, alternate: str, relationship: str }));
const supply = load("supply.csv", z.object({ pattern: str, price_1: num, price_10: num, price_100: num, stock: num, lead_days: num, lifecycle, as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }));

// ─── Reference checks ──────────────────────────────────────────────────────
const dup = <T>(file: string, rows: T[], key: (r: T) => string) => {
  const seen = new Set<string>();
  for (const r of rows) {
    const k = key(r);
    if (seen.has(k)) errors.push(`${file}: duplicate key ${k}`);
    seen.add(k);
  }
};
const norm = (pn: string) => pn.toUpperCase().replace(/\s+/g, "");
dup("contacts.csv", contacts, (r) => norm(r.pn));
dup("backshells.csv", backshells, (r) => norm(r.pn));
dup("layers.csv", layers, (r) => norm(r.pn));
dup("wires.csv", wires, (r) => `${r.spec}|${r.gauge}`);
dup("connector_arrangements.csv", arrangements, (r) => r.arrangement);
dup("connector_cavities.csv", cavities, (r) => `${r.arrangement}|${r.cavity_id}`);
dup("finishes.csv", finishes, (r) => r.code);

const contactPns = new Set(contacts.map((c) => norm(c.pn)));
connContacts.forEach((r, i) => contactPns.has(norm(r.contact_pn)) || errors.push(`connector_contacts.csv: row ${i + 2}: unknown contact ${r.contact_pn}`));
const bsPns = new Set(backshells.map((b) => norm(b.pn)));
connBackshells.forEach((r, i) => bsPns.has(norm(r.backshell_pn)) || errors.push(`connector_backshells.csv: row ${i + 2}: unknown backshell ${r.backshell_pn}`));
for (const s of SHELLS) if (!shells.some((x) => x.shell_size === s)) errors.push(`shell_sizes.csv: missing shell ${s}`);

const cavByArr = new Map<string, typeof cavities>();
for (const c of cavities) (cavByArr.get(c.arrangement) ?? cavByArr.set(c.arrangement, []).get(c.arrangement)!).push(c);
// Natural cavity order: numbers numerically; letters uppercase A–Z before lowercase a–z (extraction interleaves table columns)
const cavKey = (id: string) => (/^\d+$/.test(id) ? [0, Number(id), ""] : /^[A-Z]+$/.test(id) ? [1, id.length, id] : [2, id.length, id]) as [number, number, string];
for (const list of cavByArr.values())
  list.sort((a, b) => {
    const x = cavKey(a.cavity_id);
    const y = cavKey(b.cavity_id);
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
  });
const knownSizes = new Set(contactSizes.map((c) => c.size));
for (const a of arrangements) {
  const cs = cavByArr.get(a.arrangement) ?? [];
  if (!cs.length) errors.push(`connector_arrangements.csv: ${a.arrangement} has no cavities`);
  if (cs.length !== a.contact_count) errors.push(`connector_arrangements.csv: ${a.arrangement} contact_count ${a.contact_count} != ${cs.length} cavities`);
  for (const c of cs) if (!knownSizes.has(c.contact_size)) errors.push(`connector_cavities.csv: ${a.arrangement}/${c.cavity_id}: unknown contact size ${c.contact_size}`);
}
for (const c of cavities) if (!arrangements.some((a) => a.arrangement === c.arrangement)) errors.push(`connector_cavities.csv: cavity for unknown arrangement ${c.arrangement}`);
// Every contact size used by a buildable arrangement must have a pin and socket (or be special).
for (const size of new Set(cavities.map((c) => c.contact_size))) {
  if (size === "8") continue;
  for (const g of ["pin", "socket"]) if (!contacts.some((c) => c.size === size && c.gender === g)) errors.push(`contacts.csv: no ${g} contact for size ${size}`);
}
// Alternates must reference known families/parts
const knownPrefixes = [...supply.map((s) => norm(s.pattern).replace(/\*$/, ""))];
alternates.forEach((a, i) => {
  const alt = norm(a.alternate).replace(/\*$/, "");
  if (!knownPrefixes.some((p) => alt.startsWith(p) || p.startsWith(alt)) && !wires.some((w) => norm(w.spec) === alt)) errors.push(`alternates.csv: row ${i + 2}: alternate ${a.alternate} not found in catalog`);
});
for (const c of connectors) for (const s of SHELLS) if (!Number.isFinite(Number((c as Record<string, unknown>)[`mass_g_${s}`]))) errors.push(`connectors.csv: /${c.slash} missing mass_g_${s}`);

// ─── Compile ───────────────────────────────────────────────────────────────
const buildable = arrangements.filter((a) => !a.incomplete);
const skipped = arrangements.filter((a) => a.incomplete).map((a) => a.arrangement);
if (skipped.length) warnings.push(`excluded ${skipped.length} incomplete arrangements: ${skipped.join(", ")}`);

const bundle: Omit<CatalogBundle, "version"> = {
  connectorStyles: connectors.map((c) => ({
    slash: c.slash,
    series: c.series,
    kind: c.kind,
    mount: c.mount,
    description: c.description,
    terminationAllowanceMm: c.termination_allowance_mm,
    machineReady: c.machine_ready,
    fixturePrefix: c.fixture_prefix,
    lifecycle: c.lifecycle,
    massBySize: Object.fromEntries(SHELLS.map((s) => [String(s), Number((c as Record<string, unknown>)[`mass_g_${s}`])])),
  })),
  finishes: finishes.map((f) => ({ code: f.code, material: f.material, finish: f.finish, conductive: f.conductive, hermetic: f.hermetic, tempMaxC: f.temp_max_c, cadmium: f.cadmium, lifecycle: f.lifecycle, notes: f.notes })),
  shellSizes: shells.map((s) => ({ code: s.code, size: s.shell_size, accessoryIdMm: s.accessory_id_mm, shellOdMm: s.shell_od_mm, accessoryThread: s.accessory_thread })),
  arrangements: buildable.map((a) => ({
    id: a.arrangement,
    shellSize: a.shell_size,
    insert: a.insert,
    contactCount: a.contact_count,
    sizes: Object.fromEntries(a.sizes.split(";").map((p) => [p.split(":")[0]!, Number(p.split(":")[1])])),
    serviceRating: a.service_rating,
    status: a.status,
    inactive: a.inactive,
    source: a.source,
    special: a.special || undefined,
    notes: a.notes || undefined,
    cavities: (cavByArr.get(a.arrangement) ?? []).map((c) => ({ id: c.cavity_id, x: c.x_mm, y: c.y_mm, size: c.contact_size, ...(c.contact_size === "8" ? { special: true } : {}) })),
  })),
  contactSizes: contactSizes.map((c) => ({ size: c.size, sealingMinMm: c.sealing_min_mm, sealingMaxMm: c.sealing_max_mm, gauges: c.gauges, currentA: c.current_a, source: c.source })),
  contacts: contacts.map((c) => ({ pn: c.pn, size: c.size, gender: c.gender, gaugeMin: c.gauge_min, gaugeMax: c.gauge_max, plating: c.plating, crimpTool: c.crimp_tool, positioner: c.positioner, insertionTool: c.insertion_tool, removalTool: c.removal_tool, machineInsertable: c.machine_insertable, currentA: c.current_a, status: c.status })),
  sealingPlugs: accessories.filter((a) => a.kind === "sealingPlug").map((a) => ({ pn: a.pn, size: a.contact_size, color: /\((\w+)\)/.exec(a.description)?.[1] ?? "" })),
  wires: wires.map((w) => ({ spec: w.spec, gauge: w.gauge, pn: w.pn_pattern, odMm: w.od_mm, massGPerM: w.mass_g_per_m, ohmPerKm: w.ohm_per_km, currentA: w.current_a, tempC: w.temp_c, insulation: w.insulation, conductor: w.conductor, machineReady: w.machine_ready, status: w.status })),
  cableWireCodes: cables.filter((c) => c.kind === "wire").map((c) => ({ wireCode: c.code, spec: c.spec, gauges: c.gauges })),
  cableShields: cables.filter((c) => c.kind === "shield").map((c) => ({ code: c.code, material: c.material, coverage: c.coverage ?? 0, thicknessMm: c.thickness_mm ?? 0 })),
  cableJackets: cables.filter((c) => c.kind === "jacket").map((c) => ({ code: c.code, material: c.material, thicknessMm: c.thickness_mm ?? 0 })),
  backshells: backshells.map((b) => ({ pn: b.pn, description: b.description, shellSizes: b.shell_sizes, angle: b.angle as 0 | 45 | 90, style: b.style, clampMinMm: b.clamp_min_mm, clampMaxMm: b.clamp_max_mm, bandPlatform: b.band_platform, massG: b.mass_g, lengthMm: b.length_mm, machineReady: b.machine_ready, status: b.status })),
  accessories: accessories.filter((a) => a.kind !== "sealingPlug").map((a) => ({ pn: a.pn, kind: a.kind as Exclude<typeof a.kind, "sealingPlug">, description: a.description, shellSizes: a.shell_sizes, forKind: a.for_kind, lanyard: a.lanyard, massG: a.mass_g })),
  layers: layers.map((l) => ({ pn: l.pn, type: l.type, material: l.material, description: l.description, minDiaMm: l.min_dia_mm, maxDiaMm: l.max_dia_mm, thicknessMm: l.thickness_mm, massGPerM: l.mass_g_per_m, coverageOptions: l.coverage_options.length ? l.coverage_options : undefined, shrinkRatio: l.shrink_ratio, machineReady: l.machine_ready, status: l.status })),
  clamps: clamps.map((c) => ({ pn: c.pn, description: c.description, minDiaMm: c.min_dia_mm, maxDiaMm: c.max_dia_mm, tensionSpec: c.tension_spec, tool: c.tool, massG: c.mass_g })),
  boots: boots.map((b) => ({ pn: b.pn, shape: b.shape, description: b.description, minDiaMm: b.min_dia_mm, maxDiaMm: b.max_dia_mm, massG: b.mass_g })),
  labels: labels.map((l) => ({ pn: l.pn, type: l.type, description: l.description, minDiaMm: l.min_dia_mm, maxDiaMm: l.max_dia_mm, printableLengthMm: l.printable_length_mm, charsPerMm: l.chars_per_mm })),
  splices: splices.map((s) => ({ pn: s.pn, type: s.type, description: s.description, gaugeMin: s.gauge_min, gaugeMax: s.gauge_max, maxWires: s.max_wires, massG: s.mass_g })),
  potting: potting.map((p) => ({ pn: p.pn, kind: p.kind, description: p.description, cureHours: p.cure_hours, densityGPerCc: p.density_g_per_cc, shellSizes: p.shell_sizes.length ? p.shell_sizes : undefined })),
  hardware: hardware.map((h) => ({ pn: h.pn, type: h.type, description: h.description, minDiaMm: h.min_dia_mm, maxDiaMm: h.max_dia_mm })),
  alternates: alternates.map((a) => ({ pn: a.pn, alternate: a.alternate, relationship: a.relationship })),
  supply: supply.map((s) => ({ pattern: s.pattern, breaks: [{ qty: 1, price: s.price_1 }, { qty: 10, price: s.price_10 }, { qty: 100, price: s.price_100 }], stock: s.stock, leadDays: s.lead_days, lifecycle: s.lifecycle, asOf: s.as_of })),
};

// ─── Profile / library / demo JSON validation ─────────────────────────────
function readJson(rel: string): unknown {
  const p = join(ROOT, "data", rel);
  const raw = readFileSync(p, "utf8");
  hash.update(rel).update(raw);
  try {
    return JSON.parse(raw);
  } catch (e) {
    errors.push(`${rel}: invalid JSON (${(e as Error).message})`);
    return null;
  }
}

const profile = readJson("profile/machine-profile.json") as { version: string; rules: unknown[]; capabilities: Record<string, unknown> } | null;
const MachineProfileSchema = z.object({ version: z.string(), name: z.string(), capabilities: z.record(z.string(), z.any()), rules: z.array(RuleInstanceSchema) });
if (profile) {
  const r = MachineProfileSchema.safeParse(profile);
  if (!r.success) for (const iss of r.error.issues) errors.push(`profile/machine-profile.json: ${iss.path.join(".")}: ${iss.message}`);
  else for (const rule of r.data.rules) if (!rule.id.startsWith("MFG-")) errors.push(`profile/machine-profile.json: rule ${rule.id} must use the MFG- prefix`);
}
const inspections = readJson("profile/inspections.json");
const InspectionSchema = z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), inHouse: z.boolean(), params: z.array(z.any()), samplingOptions: z.array(z.string()), costPerUnit: z.number(), setupCost: z.number(), leadDays: z.number() }));
{
  const r = InspectionSchema.safeParse(inspections);
  if (!r.success) for (const iss of r.error.issues) errors.push(`profile/inspections.json: ${iss.path.join(".")}: ${iss.message}`);
}
const pricing = readJson("demo/pricing.json");

const libDir = join(ROOT, "data", "library", "rulesets");
const rulesets = readdirSync(libDir)
  .filter((f) => f.endsWith(".harnessrules.json"))
  .sort()
  .map((f) => {
    const r = RulesetSchema.safeParse(readJson(`library/rulesets/${f}`));
    if (!r.success) {
      for (const iss of r.error.issues) errors.push(`library/rulesets/${f}: ${iss.path.join(".")}: ${iss.message}`);
      return null;
    }
    for (const rule of r.data.rules) if (!rule.id.startsWith(`${r.data.prefix}-`)) errors.push(`library/rulesets/${f}: rule ${rule.id} must use prefix ${r.data.prefix}-`);
    return { file: f, ruleset: r.data };
  })
  .filter(Boolean);
const presetDir = join(ROOT, "data", "library", "presets");
const presets = readdirSync(presetDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => {
    const r = FinishingPresetSchema.safeParse(readJson(`library/presets/${f}`));
    if (!r.success) {
      for (const iss of r.error.issues) errors.push(`library/presets/${f}: ${iss.path.join(".")}: ${iss.message}`);
      return null;
    }
    return r.data;
  })
  .filter(Boolean);

if (errors.length) {
  console.error(`\n✗ data:build failed with ${errors.length} error(s):\n` + errors.map((e) => `  - ${e}`).join("\n"));
  process.exit(1);
}

// ─── Write outputs ─────────────────────────────────────────────────────────
const digest = hash.digest("hex").slice(0, 12);
const version = { hash: digest, date: new Date().toISOString().slice(0, 10) };
const full: CatalogBundle = { version, ...bundle };
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "38999-III.json"), JSON.stringify(full));

// Search index: one doc per connector family (slash × arrangement); gender/key/finish are facets.
interface Doc {
  id: string;
  slash: string;
  arrangement: string;
  text: string;
  kind: string;
  mount: string;
  shellSize: number;
  sizes: string;
  count: number;
  status: string;
}
const docs: Doc[] = [];
for (const st of full.connectorStyles)
  for (const a of full.arrangements)
    docs.push({
      id: `${st.slash}|${a.id}`,
      slash: st.slash,
      arrangement: a.id,
      kind: st.kind,
      mount: st.mount,
      shellSize: a.shellSize,
      sizes: Object.keys(a.sizes).join(" "),
      count: a.contactCount,
      status: a.status,
      text: `D38999/${st.slash} 38999 series III ${st.kind} ${st.mount} ${st.description} ${a.id} shell ${a.shellSize} ${full.shellSizes.find((s) => s.size === a.shellSize)?.code ?? ""} insert ${a.insert} ${a.contactCount} contacts ${Object.keys(a.sizes)
        .map((s) => `size${s} ${s}`)
        .join(" ")}`,
    });
const ms = new MiniSearch<Doc>({ fields: ["text", "arrangement"], storeFields: ["slash", "arrangement", "kind", "mount", "shellSize", "sizes", "count", "status"], searchOptions: { prefix: true, fuzzy: 0.15, combineWith: "AND" } });
ms.addAll(docs);
writeFileSync(join(OUT, "38999-III.search.json"), JSON.stringify(ms));

writeFileSync(join(OUT, "profile.json"), JSON.stringify(profile));
writeFileSync(join(OUT, "inspections.json"), JSON.stringify(inspections));
writeFileSync(join(OUT, "pricing.json"), JSON.stringify(pricing));
writeFileSync(join(OUT, "library.json"), JSON.stringify({ rulesets: rulesets.map((r) => r!.ruleset), presets }));

const examples = buildExamples(full, profile!.capabilities);
writeFileSync(join(OUT, "examples.json"), JSON.stringify(examples.map((e) => ({ id: e.id, name: e.name, description: e.description }))));
mkdirSync(join(ROOT, "data", "examples"), { recursive: true });
for (const e of examples) {
  writeFileSync(join(OUT, `example-${e.id}.harness.json`), JSON.stringify(e.project, null, 2));
  writeFileSync(join(ROOT, "data", "examples", `${e.id}.harness.json`), JSON.stringify(e.project, null, 2) + "\n");
}
writeFileSync(join(OUT, "version.json"), JSON.stringify(version));

const reviewed = full.arrangements.filter((a) => a.status === "verified").length;
console.log(`✓ data:build ${version.hash} (${version.date})`);
console.log(`  ${full.arrangements.length} arrangements (${reviewed} verified), ${full.arrangements.reduce((s, a) => s + a.cavities.length, 0)} cavities, ${full.contacts.length} contacts, ${full.wires.length} wires, ${full.layers.length} layers, ${full.backshells.length} backshells`);
console.log(`  ${rulesets.length} rulesets, ${presets.length} presets, ${examples.length} examples`);
for (const w of warnings) console.log(`  ! ${w}`);
