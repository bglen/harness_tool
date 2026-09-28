/**
 * Generates the initial hand-editable catalog CSVs (spec 15.2) from D38999 research data plus
 * representative seed data. After the first run the CSVs are the source of truth: edit them directly.
 * Re-running refuses to overwrite existing files unless --force is passed.
 *
 * Data status column: verified = checked against a cited source; seed = representative placeholder
 * values that must be verified before production use (tooling, generic finishing parts, masses).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";

const ROOT = join(import.meta.dirname, "..", "..");
const RES = join(ROOT, "data", "connectors", "d38999", "research");
const OUT = join(ROOT, "data", "catalog");
const force = process.argv.includes("--force");
const AS_OF = "2026-09-27";

type Row = Record<string, string | number | boolean>;
const readCsv = (f: string) => Papa.parse<Record<string, string>>(readFileSync(join(RES, f), "utf8"), { header: true, skipEmptyLines: true }).data;

function write(name: string, comment: string, rows: Row[]) {
  const path = join(OUT, name);
  if (existsSync(path) && !force) {
    console.log(`skip ${name} (exists)`);
    return;
  }
  writeFileSync(path, `# schema=1; ${comment}\n` + Papa.unparse(rows) + "\n");
  console.log(`wrote ${name} (${rows.length} rows)`);
}

const SHELLS = [9, 11, 13, 15, 17, 19, 21, 23, 25];
const CODE: Record<number, string> = { 9: "A", 11: "B", 13: "C", 15: "D", 17: "E", 19: "F", 21: "G", 23: "H", 25: "J" };
const acc = new Map(readCsv("accessory_interface.csv").map((r) => [Number(r.shell_size), r]));
const s26 = new Map(readCsv("slash26.csv").map((r) => [Number(r.shell_size), r]));
const s24 = new Map(readCsv("slash24.csv").map((r) => [Number(r.shell_size), r]));
const jam = new Map(readCsv("jam_nuts.csv").map((r) => [Number(r.shell_size), r]));

// ─── Connector families ────────────────────────────────────────────────────
const massPlug = [14, 20, 27, 34, 42, 52, 62, 72, 85];
write("connectors.csv", "one row per connector family (slash sheet); PNs are built parametrically: D38999/<slash><class><shell><insert><contact><key>; masses g (seed)", [
  { slash: "26", series: "III", kind: "plug", mount: "straight", description: "Straight plug", termination_allowance_mm: 38, machine_ready: true, fixture_prefix: "FX26", lifecycle: "active", ...Object.fromEntries(SHELLS.map((s, i) => [`mass_g_${s}`, massPlug[i]!])), status: "seed", source: "MIL-DTL-38999/26" },
  { slash: "20", series: "III", kind: "receptacle", mount: "wall flange", description: "Wall-mount receptacle", termination_allowance_mm: 38, machine_ready: true, fixture_prefix: "FX20", lifecycle: "active", ...Object.fromEntries(SHELLS.map((s, i) => [`mass_g_${s}`, Math.round(massPlug[i]! * 0.9)])), status: "seed", source: "MIL-DTL-38999/20" },
  { slash: "24", series: "III", kind: "receptacle", mount: "jam nut", description: "Jam-nut receptacle", termination_allowance_mm: 38, machine_ready: true, fixture_prefix: "FX24", lifecycle: "active", ...Object.fromEntries(SHELLS.map((s, i) => [`mass_g_${s}`, Math.round(massPlug[i]! * 1.05)])), status: "seed", source: "MIL-DTL-38999/24" },
]);

// ─── Finishes (classes) ────────────────────────────────────────────────────
write(
  "finishes.csv",
  "shell class/finish codes from MIL-DTL-38999N Table II",
  readCsv("classes.csv")
    .filter((r) => r.hermetic === "false")
    .map((r) => ({
      code: r.code!,
      material: r.material!,
      finish: r.finish!,
      conductive: !/nonconductive|passivated/.test(`${r.notes} ${r.finish}`),
      hermetic: r.hermetic!,
      temp_max_c: r.temperature_max_c!,
      cadmium: /cadmium/.test(r.finish!),
      lifecycle: /inactive/.test(r.notes!) ? "inactive" : "active",
      notes: r.notes!,
      source: `${r.source} p${r.page}`,
      status: "verified",
    })),
);

// ─── Shell sizes ───────────────────────────────────────────────────────────
write(
  "shell_sizes.csv",
  "mm; accessory_id_mm = rear accessory bore A max (MIL-DTL-38999N Fig. 10); shell_od_mm = /26 coupling nut B max",
  SHELLS.map((s) => ({ code: CODE[s]!, shell_size: s, accessory_id_mm: acc.get(s)!.A_max!, shell_od_mm: s26.get(s)!.B_max!, accessory_thread: `M${acc.get(s)!.thread_diameter}x${acc.get(s)!.thread_pitch}`, status: "verified", source: "MIL-DTL-38999N Fig. 10; MIL-DTL-38999/26 Fig. 1" })),
);

// ─── Contact sizes (Table IV) ──────────────────────────────────────────────
write("contact_sizes.csv", "wire sealing range (finished wire OD, mm) and wire gauges per contact size, MIL-DTL-38999N Table IV", [
  { size: "23", sealing_min_mm: 0.76, sealing_max_mm: 1.27, gauges: "26;24;22", current_a: 5, status: "verified", source: "MIL-DTL-38999N Table IV" },
  { size: "22D", sealing_min_mm: 0.76, sealing_max_mm: 1.37, gauges: "28;26;24;22", current_a: 5, status: "verified", source: "MIL-DTL-38999N Table IV" },
  { size: "20", sealing_min_mm: 1.02, sealing_max_mm: 2.11, gauges: "24;22;20", current_a: 7.5, status: "verified", source: "MIL-DTL-38999N Table IV" },
  { size: "16", sealing_min_mm: 1.65, sealing_max_mm: 2.77, gauges: "20;18;16", current_a: 13, status: "verified", source: "MIL-DTL-38999N Table IV" },
  { size: "12", sealing_min_mm: 2.46, sealing_max_mm: 3.61, gauges: "14;12", current_a: 23, status: "verified", source: "MIL-DTL-38999N Table IV" },
  { size: "10", sealing_min_mm: 3.43, sealing_max_mm: 4.12, gauges: "10", current_a: 33, status: "verified", source: "MIL-DTL-38999N Table IV" },
  { size: "8", sealing_min_mm: 3.15, sealing_max_mm: 3.94, gauges: "", current_a: 0, status: "verified", source: "MIL-DTL-38999N Table IV (coax/twinax, Phase 2)" },
]);

// ─── Contacts ──────────────────────────────────────────────────────────────
const tool = (size: string) =>
  ({
    "23": ["M22520/2-01", "M22520/2-37", "M81969/14-01", "M81969/14-01"],
    "22D": ["M22520/2-01", "M22520/2-09", "M81969/14-01", "M81969/14-01"],
    "20": ["M22520/1-01", "M22520/1-04", "M81969/14-10", "M81969/14-10"],
    "16": ["M22520/1-01", "M22520/1-04", "M81969/14-03", "M81969/14-03"],
    "12": ["M22520/1-01", "M22520/1-04", "M81969/14-04", "M81969/14-04"],
    "10": ["M22520/1-01", "(verify)", "(verify)", "(verify)"],
  })[size]!;
const contacts: Row[] = [];
const cdef: [string, string, string, number, number, number, boolean, string][] = [
  // size, pin PN, socket PN, gaugeMin(thin), gaugeMax(thick), current, machine, status
  ["23", "M39029/122-670", "M39029/121-663", 26, 22, 5, false, "verified"],
  ["22D", "M39029/58-360", "M39029/56-348", 28, 22, 5, true, "verified"],
  ["20", "M39029/58-363", "M39029/56-351", 24, 20, 7.5, true, "verified"],
  ["16", "M39029/58-364", "M39029/56-352", 20, 16, 13, true, "seed"],
  ["12", "M39029/58-365", "M39029/56-353", 14, 12, 23, true, "seed"],
  ["10", "TBD-S10-PIN", "TBD-S10-SKT", 10, 10, 33, false, "seed"],
];
for (const [size, pin, skt, gmin, gmax, cur, machine, status] of cdef) {
  const [crimp, pos, ins, rem] = tool(size);
  for (const [pn, gender] of [
    [pin, "pin"],
    [skt, "socket"],
  ] as const)
    contacts.push({ pn, size, gender, gauge_min: gmin, gauge_max: gmax, plating: "gold", crimp_tool: crimp!, positioner: pos!, insertion_tool: ins!, removal_tool: rem!, machine_insertable: machine, current_a: cur, status, source: status === "verified" ? "MIL-STD-1560C insert tables" : "seed: verify tooling/PN" });
}
write("contacts.csv", "crimp contacts; tooling columns are seed data (verify before release); gauge_min = thinnest AWG, gauge_max = thickest", contacts);
write(
  "connector_contacts.csv",
  "compatibility: connector series + cavity size + gender -> contact PN",
  contacts.map((c) => ({ series: "38999 III", size: c.size, gender: c.gender, contact_pn: c.pn })),
);

// ─── Backshells (generic seed catalog) ─────────────────────────────────────
const backshells: Row[] = [];
const bsCompat: Row[] = [];
for (const s of SHELLS) {
  const bore = Number(acc.get(s)!.A_max);
  const clampMax = +(bore * 0.95).toFixed(1);
  const clampMin = +(bore * 0.35).toFixed(1);
  const defs: [string, number, string, boolean, string][] = [
    ["SR", 0, "strainRelief", false, "Strain relief backshell, straight"],
    ["SR", 45, "strainRelief", false, "Strain relief backshell, 45°"],
    ["SR", 90, "strainRelief", false, "Strain relief backshell, 90°"],
    ["EB", 0, "emiBand", true, "EMI/RFI backshell with band-clamp platform, straight"],
    ["EB", 45, "emiBand", true, "EMI/RFI backshell with band-clamp platform, 45°"],
    ["EB", 90, "emiBand", true, "EMI/RFI backshell with band-clamp platform, 90°"],
    ["SH", 0, "shieldRing", false, "Shield-termination ring backshell, straight"],
    ["PB", 0, "pottingBoot", false, "Potting boot adapter, straight"],
  ];
  for (const [code, angle, style, band, desc] of defs) {
    const pn = `HSB-${code}${angle ? String(angle) : "S"}-${String(s).padStart(2, "0")}`;
    backshells.push({ pn, description: desc, shell_sizes: s, angle, style, clamp_min_mm: clampMin, clamp_max_mm: clampMax, band_platform: band, mass_g: Math.round((8 + s * 1.6) * (angle === 90 ? 1.4 : angle === 45 ? 1.25 : 1)), length_mm: angle === 90 ? 28 : 32, machine_ready: style !== "pottingBoot", status: "seed" });
    bsCompat.push({ series: "38999 III", shell_size: s, backshell_pn: pn });
  }
}
write("backshells.csv", "generic backshell seed catalog; clamp range derived from rear accessory bore (seed)", backshells);
write("connector_backshells.csv", "compatibility: series + shell size -> backshell", bsCompat);

// ─── Accessories ───────────────────────────────────────────────────────────
const accessories: Row[] = [];
for (const s of SHELLS) {
  const c = CODE[s]!;
  accessories.push({ pn: `D38999/32W${c}R`, kind: "dustCap", description: `Protective cover for plug, shell ${s}, with lanyard`, shell_sizes: s, for_kind: "plug", lanyard: true, contact_size: "", mass_g: 6 + s / 2, status: "seed" });
  accessories.push({ pn: `D38999/32W${c}N`, kind: "dustCap", description: `Protective cover for plug, shell ${s}`, shell_sizes: s, for_kind: "plug", lanyard: false, contact_size: "", mass_g: 5 + s / 2, status: "seed" });
  accessories.push({ pn: `D38999/33W${c}R`, kind: "dustCap", description: `Protective cover for receptacle, shell ${s}, with lanyard`, shell_sizes: s, for_kind: "receptacle", lanyard: true, contact_size: "", mass_g: 6 + s / 2, status: "seed" });
  accessories.push({ pn: `D38999/33W${c}N`, kind: "dustCap", description: `Protective cover for receptacle, shell ${s}`, shell_sizes: s, for_kind: "receptacle", lanyard: false, contact_size: "", mass_g: 5 + s / 2, status: "seed" });
  accessories.push({ pn: `D38999/28W-${jam.get(s)!.dash}`, kind: "jamNut", description: `Jam nut, M${jam.get(s)!.thread_diameter} thread, shell ${s}`, shell_sizes: s, for_kind: "receptacle", lanyard: false, contact_size: "", mass_g: 4 + s / 3, status: "seed" });
  accessories.push({ pn: `M25988/1-${s24.get(s)!.oring_dash}`, kind: "oRing", description: `O-ring (-${s24.get(s)!.oring_dash}) for jam-nut receptacle, shell ${s}`, shell_sizes: s, for_kind: "receptacle", lanyard: false, contact_size: "", mass_g: 0.5, status: "seed" });
  accessories.push({ pn: `HSG-FG-${String(s).padStart(2, "0")}`, kind: "gasket", description: `Flange gasket, conductive, shell ${s}`, shell_sizes: s, for_kind: "receptacle", lanyard: false, contact_size: "", mass_g: 1.5, status: "seed" });
  accessories.push({ pn: `HSG-GR-${String(s).padStart(2, "0")}`, kind: "groundingRing", description: `Grounding ring, shell ${s}`, shell_sizes: s, for_kind: "any", lanyard: false, contact_size: "", mass_g: 1, status: "seed" });
}
const plugs: [string, string, string][] = [
  ["22D", "MS27488-22-2", "black"],
  ["23", "MS27488-22-2", "black"],
  ["20", "MS27488-20-2", "red"],
  ["16", "MS27488-16-2", "blue"],
  ["12", "MS27488-12-2", "yellow"],
  ["10", "MS27488-10-2", "white"],
];
for (const [size, pn, color] of plugs) accessories.push({ pn, kind: "sealingPlug", description: `Sealing plug, contact size ${size} (${color})`, shell_sizes: "", for_kind: "any", lanyard: false, contact_size: size, mass_g: 0.1, status: "seed" });
write("accessories.csv", "dust caps, jam nuts, o-rings, gaskets, grounding rings, sealing plugs (seed; PN formats to verify)", accessories);

// ─── Wires ─────────────────────────────────────────────────────────────────
const wires: Row[] = [];
const Rtin: Record<number, number> = { 26: 150, 24: 94.5, 22: 57.4, 20: 34.6, 18: 22.0, 16: 15.1, 14: 9.18, 12: 5.64, 10: 3.64 };
const Rag: Record<number, number> = { 26: 136, 24: 86, 22: 52.8, 20: 33.3, 18: 20.9, 16: 14.1, 14: 8.6, 12: 5.2, 10: 3.3 };
const Rhs: Record<number, number> = { 26: 159, 24: 99, 22: 62, 20: 39, 18: 24.6, 16: 16.5, 14: 10, 12: 6.3, 10: 4 };
const amps: Record<number, number> = { 26: 3.3, 24: 5, 22: 7.5, 20: 11, 18: 16, 16: 22, 14: 32, 12: 41, 10: 55 };
const specs: { spec: string; ins: string; cond: string; temp: number; R: Record<number, number>; od: Record<number, number>; mass: Record<number, number> }[] = [
  { spec: "M22759/16", ins: "ETFE, 600 V", cond: "tin-coated copper", temp: 150, R: Rtin, od: { 24: 1.17, 22: 1.32, 20: 1.55, 18: 1.8, 16: 2.06, 14: 2.49, 12: 3.02, 10: 3.81 }, mass: { 24: 3.3, 22: 4.8, 20: 7.2, 18: 10.4, 16: 13.4, 14: 20.8, 12: 31.8, 10: 50.3 } },
  { spec: "M22759/32", ins: "XL-ETFE lightweight, 600 V", cond: "tin-coated copper", temp: 150, R: Rtin, od: { 26: 0.89, 24: 0.99, 22: 1.14, 20: 1.35, 18: 1.57, 16: 1.83, 14: 2.24, 12: 2.74 }, mass: { 26: 1.9, 24: 2.8, 22: 4.0, 20: 6.1, 18: 9.1, 16: 11.8, 14: 18.6, 12: 28.3 } },
  { spec: "M22759/33", ins: "XL-ETFE lightweight, 600 V", cond: "silver-coated high-strength copper alloy", temp: 200, R: Rhs, od: { 26: 0.89, 24: 0.99, 22: 1.14, 20: 1.35, 18: 1.57, 16: 1.83, 14: 2.24, 12: 2.74 }, mass: { 26: 1.8, 24: 2.7, 22: 3.9, 20: 6.0, 18: 8.9, 16: 11.5, 14: 18.2, 12: 27.9 } },
  { spec: "M22759/44", ins: "XL-ETFE normal wall, 600 V", cond: "silver-coated copper", temp: 200, R: Rag, od: { 24: 1.17, 22: 1.32, 20: 1.52, 18: 1.78, 16: 2.03, 14: 2.44, 12: 2.95, 10: 3.73 }, mass: { 24: 3.2, 22: 4.6, 20: 7.0, 18: 10.1, 16: 13.1, 14: 20.3, 12: 31.2, 10: 49.1 } },
  { spec: "M22759/86", ins: "PTFE/polyimide tape, 600 V", cond: "silver-coated copper", temp: 200, R: Rag, od: { 26: 0.84, 24: 0.94, 22: 1.07, 20: 1.27, 18: 1.5, 16: 1.73, 14: 2.13, 12: 2.62, 10: 3.3 }, mass: { 26: 1.7, 24: 2.6, 22: 3.8, 20: 5.8, 18: 8.7, 16: 11.2, 14: 17.8, 12: 27.3, 10: 44.5 } },
];
for (const s of specs)
  for (const g of Object.keys(s.od).map(Number).sort((a, b) => b - a))
    wires.push({ spec: s.spec, gauge: g, pn_pattern: `${s.spec}-${g}-{color}`, od_mm: s.od[g]!, mass_g_per_m: s.mass[g]!, ohm_per_km: s.R[g]!, current_a: amps[g]!, temp_c: s.temp, insulation: s.ins, conductor: s.cond, colors: "0-9 + up to 3 stripes", machine_ready: g >= 12, status: "seed" });
write("wires.csv", "hookup wire by spec and gauge; OD/mass/resistance nominal (seed, verify against spec sheets); current = single wire in free air", wires);

// ─── Cables (M27500 parametric) ────────────────────────────────────────────
write("cables.csv", "M27500 PN building blocks: kind=wire code|shield|jacket (seed; verify code tables)", [
  { kind: "wire", code: "TE", spec: "M22759/16", material: "", thickness_mm: "", coverage: "", gauges: "24;22;20;18;16;14;12" },
  { kind: "wire", code: "SE", spec: "M22759/32", material: "", thickness_mm: "", coverage: "", gauges: "26;24;22;20;18;16;14;12" },
  { kind: "wire", code: "SB", spec: "M22759/33", material: "", thickness_mm: "", coverage: "", gauges: "26;24;22;20;18;16;14;12" },
  { kind: "wire", code: "RC", spec: "M22759/44", material: "", thickness_mm: "", coverage: "", gauges: "24;22;20;18;16;14;12" },
  { kind: "shield", code: "U", spec: "", material: "none (unshielded)", thickness_mm: 0, coverage: 0, gauges: "" },
  { kind: "shield", code: "T", spec: "", material: "tin-coated copper, round", thickness_mm: 0.25, coverage: 85, gauges: "" },
  { kind: "shield", code: "S", spec: "", material: "silver-coated copper, round", thickness_mm: 0.25, coverage: 85, gauges: "" },
  { kind: "shield", code: "N", spec: "", material: "nickel-coated copper, round", thickness_mm: 0.25, coverage: 85, gauges: "" },
  { kind: "jacket", code: "00", spec: "", material: "no jacket", thickness_mm: 0, coverage: "", gauges: "" },
  { kind: "jacket", code: "14", spec: "", material: "extruded FEP, white", thickness_mm: 0.2, coverage: "", gauges: "" },
  { kind: "jacket", code: "23", spec: "", material: "extruded ETFE, white", thickness_mm: 0.2, coverage: "", gauges: "" },
  { kind: "jacket", code: "24", spec: "", material: "extruded XL-ETFE, white", thickness_mm: 0.18, coverage: "", gauges: "" },
]);

// ─── Layers ────────────────────────────────────────────────────────────────
const layers: Row[] = [];
const L = (r: Row) => layers.push({ coverage_options: "", shrink_ratio: "", machine_ready: false, status: "seed", ...r });
L({ pn: "HSL-TP-PTFE-12", type: "tape", material: "PTFE", description: "PTFE tape, 12.7 mm wide", min_dia_mm: 1, max_dia_mm: 80, thickness_mm: 0.08, mass_g_per_m: 3, machine_ready: true });
L({ pn: "HSL-TP-PI-12", type: "tape", material: "Polyimide (Kapton)", description: "Polyimide tape, 12.7 mm wide", min_dia_mm: 1, max_dia_mm: 80, thickness_mm: 0.05, mass_g_per_m: 2, machine_ready: true });
L({ pn: "HSL-TP-FG-19", type: "tape", material: "Fiberglass", description: "Fiberglass tape, 19 mm wide", min_dia_mm: 3, max_dia_mm: 80, thickness_mm: 0.18, mass_g_per_m: 8, machine_ready: true });
L({ pn: "HSL-TP-SIL-25", type: "tape", material: "Self-fusing silicone", description: "Self-fusing silicone tape, 25 mm wide", min_dia_mm: 3, max_dia_mm: 80, thickness_mm: 0.5, mass_g_per_m: 18 });
const sleeveRanges: [number, number, string][] = [
  [2, 5, "03"],
  [3, 9, "06"],
  [6, 14, "10"],
  [8, 19, "13"],
  [12, 25, "19"],
  [16, 32, "25"],
  [22, 40, "32"],
];
for (const [mat, code, t, m] of [
  ["PET", "PET", 0.4, 1],
  ["Nomex", "NMX", 0.5, 1.3],
  ["Fiberglass", "FG", 0.6, 1.8],
] as const)
  for (const [lo, hi, sz] of sleeveRanges) L({ pn: `HSL-SL-${code}-${sz}`, type: "sleeve", material: mat, description: `Expandable braided sleeving, ${mat}, ${lo}-${hi} mm`, min_dia_mm: lo, max_dia_mm: hi, thickness_mm: t, mass_g_per_m: +((lo + hi) * m).toFixed(1) });
const hsSizes: [number, number][] = [
  [3.2, 1.6],
  [4.8, 2.4],
  [6.4, 3.2],
  [9.5, 4.8],
  [12.7, 6.4],
  [19.1, 9.5],
  [25.4, 12.7],
  [38.1, 19.1],
  [50.8, 25.4],
];
for (const [mat, code, ratio, type] of [
  ["Polyolefin", "PO", 2, "heatShrink"],
  ["PVDF (Kynar)", "KY", 2, "heatShrink"],
  ["Fluoroelastomer (Viton)", "VT", 2, "jacket"],
] as const)
  for (const [sup, rec] of hsSizes) {
    const t = +(0.25 + rec * 0.04).toFixed(2);
    L({ pn: `HSL-${type === "jacket" ? "JK" : "HS"}-${code}-${String(Math.round(sup * 10)).padStart(3, "0")}`, type, material: mat, description: `${type === "jacket" ? "Heat-shrink jacket" : "Heat-shrink tubing"}, ${mat}, ${ratio}:1, ${sup} mm supplied / ${rec} mm recovered`, min_dia_mm: +(rec * 1.05).toFixed(2), max_dia_mm: +(sup * 0.85).toFixed(2), thickness_mm: type === "jacket" ? t * 1.6 : t, mass_g_per_m: +(sup * 1.1).toFixed(1), shrink_ratio: ratio, machine_ready: false });
  }
for (const [id, od] of [
  [4.8, 7.6],
  [6.4, 9.9],
  [9.5, 13.2],
  [12.7, 16.9],
  [19.1, 23.8],
  [25.4, 31.4],
] as const)
  L({ pn: `HSL-CV-NY-${String(Math.round(id * 10)).padStart(3, "0")}`, type: "conduit", material: "Nylon", description: `Convoluted tubing, nylon, ${id} mm ID`, min_dia_mm: +(id * 0.5).toFixed(1), max_dia_mm: id, thickness_mm: +((od - id) / 2).toFixed(2), mass_g_per_m: +(od * 2.2).toFixed(1) });
const braidRanges: [number, number][] = [
  [3, 6],
  [5, 10],
  [8, 14],
  [12, 20],
  [16, 26],
  [22, 34],
  [30, 45],
];
for (const [mat, code, t, dens, machine] of [
  ["Tinned copper", "TC", 0.5, 3.4, true],
  ["Nickel-plated copper", "NC", 0.5, 3.4, true],
  ["Stainless steel", "SS", 0.45, 3.0, false],
  ["Metal-clad fiber (lightweight)", "MF", 0.35, 1.1, true],
] as const)
  for (const [lo, hi] of braidRanges) L({ pn: `HSL-OB-${code}-${String(hi).padStart(2, "0")}`, type: "overbraid", material: mat, description: `Overbraid, ${mat}, ${lo}-${hi} mm`, min_dia_mm: lo, max_dia_mm: hi, thickness_mm: t, mass_g_per_m: +(((lo + hi) / 2) * dens).toFixed(1), coverage_options: "85;90;95", machine_ready: machine });
write("layers.csv", "bundle coverings: tape, sleeve, heat shrink, jacket, conduit, overbraid; mm, g/m (generic seed catalog)", layers);

// ─── Band clamps, boots, labels, splices, potting, hardware ────────────────
write("clamps.csv", "band clamps (generic seed catalog)", [
  { pn: "HSC-BC-S", description: "Band clamp, small, 3.2 mm band", min_dia_mm: 3, max_dia_mm: 15, tension_spec: "450 N", tool: "Band clamp tool, pneumatic", mass_g: 1.2 },
  { pn: "HSC-BC-M", description: "Band clamp, medium, 3.2 mm band", min_dia_mm: 12, max_dia_mm: 28, tension_spec: "450 N", tool: "Band clamp tool, pneumatic", mass_g: 1.8 },
  { pn: "HSC-BC-L", description: "Band clamp, large, 4.8 mm band", min_dia_mm: 24, max_dia_mm: 45, tension_spec: "670 N", tool: "Band clamp tool, pneumatic", mass_g: 2.9 },
  { pn: "HSC-BC-XL", description: "Band clamp, extra large, 4.8 mm band", min_dia_mm: 40, max_dia_mm: 70, tension_spec: "670 N", tool: "Band clamp tool, pneumatic", mass_g: 4.2 },
]);
const boots: Row[] = [];
const bootRanges: [number, number][] = [
  [3, 8],
  [6, 13],
  [10, 19],
  [15, 26],
  [22, 36],
  [30, 48],
];
bootRanges.forEach(([lo, hi], i) => {
  boots.push({ pn: `HSK-BS-${i + 1}`, shape: "straight", description: `Heat-shrink boot, straight, ${lo}-${hi} mm`, min_dia_mm: lo, max_dia_mm: hi, mass_g: 3 + i * 3 });
  boots.push({ pn: `HSK-B9-${i + 1}`, shape: "90", description: `Heat-shrink boot, 90°, ${lo}-${hi} mm`, min_dia_mm: lo, max_dia_mm: hi, mass_g: 4 + i * 4 });
  boots.push({ pn: `HSK-TY-${i + 1}`, shape: "Y", description: `Y transition, ${lo}-${hi} mm`, min_dia_mm: lo, max_dia_mm: hi, mass_g: 5 + i * 4 });
  boots.push({ pn: `HSK-TT-${i + 1}`, shape: "T", description: `T transition, ${lo}-${hi} mm`, min_dia_mm: lo, max_dia_mm: hi, mass_g: 5 + i * 4 });
  boots.push({ pn: `HSK-TM-${i + 1}`, shape: "multi", description: `Multi-leg transition, ${lo}-${hi} mm`, min_dia_mm: lo, max_dia_mm: hi, mass_g: 6 + i * 5 });
});
write("boots.csv", "boots and transitions (generic seed catalog)", boots);
const labels: Row[] = [];
const lblRanges: [number, number, string][] = [
  [0.8, 1.8, "1"],
  [1.5, 3.2, "2"],
  [2.8, 6, "3"],
  [5, 11, "4"],
  [9, 20, "5"],
  [17, 38, "6"],
  [32, 70, "7"],
];
for (const [lo, hi, c] of lblRanges) labels.push({ pn: `HSM-SL-${c}`, type: "sleeve", description: `Heat-shrink marker sleeve, ${lo}-${hi} mm`, min_dia_mm: lo, max_dia_mm: hi, printable_length_mm: hi < 3.5 ? 25 : 38, chars_per_mm: 0.55 });
labels.push({ pn: "HSM-FL-50", type: "flag", description: "Flag label, 50 x 19 mm", min_dia_mm: 1, max_dia_mm: 60, printable_length_mm: 45, chars_per_mm: 0.5 });
labels.push({ pn: "HSM-WR-38", type: "wrap", description: "Self-laminating wrap-around label, 38 mm", min_dia_mm: 2, max_dia_mm: 25, printable_length_mm: 30, chars_per_mm: 0.5 });
labels.push({ pn: "HSM-DM", type: "direct", description: "Direct marking on insulation (inkjet)", min_dia_mm: 0.8, max_dia_mm: 5, printable_length_mm: 60, chars_per_mm: 0.6 });
write("labels.csv", "label stock: heat-shrink sleeves, flags, wraps, direct marking (generic seed catalog)", labels);
write("splices.csv", "splices (seed; verify PN/range)", [
  { pn: "M81824/1-1", type: "crimp", description: "Crimp splice, environment resistant, 26-20 AWG", gauge_min: 26, gauge_max: 20, max_wires: 4, mass_g: 0.6 },
  { pn: "M81824/1-2", type: "crimp", description: "Crimp splice, environment resistant, 20-16 AWG", gauge_min: 20, gauge_max: 16, max_wires: 4, mass_g: 0.9 },
  { pn: "M81824/1-3", type: "crimp", description: "Crimp splice, environment resistant, 16-12 AWG", gauge_min: 16, gauge_max: 12, max_wires: 4, mass_g: 1.4 },
  { pn: "HSS-SS-1", type: "solderSleeve", description: "Solder sleeve splice, 26-20 AWG", gauge_min: 26, gauge_max: 20, max_wires: 3, mass_g: 0.4 },
  { pn: "HSS-SS-2", type: "solderSleeve", description: "Solder sleeve splice, 20-16 AWG", gauge_min: 20, gauge_max: 16, max_wires: 3, mass_g: 0.6 },
  { pn: "HSS-US-1", type: "ultrasonic", description: "Ultrasonic weld splice (with heat-shrink cover)", gauge_min: 26, gauge_max: 10, max_wires: 8, mass_g: 0.5 },
]);
const potting: Row[] = [
  { pn: "HSP-PU-2", kind: "compound", description: "Polyurethane potting compound, 2-part", cure_hours: 24, density_g_per_cc: 1.1, shell_sizes: "" },
  { pn: "HSP-EP-2", kind: "compound", description: "Epoxy potting compound, 2-part", cure_hours: 24, density_g_per_cc: 1.25, shell_sizes: "" },
  { pn: "HSP-SI-2", kind: "compound", description: "Silicone potting compound, 2-part", cure_hours: 24, density_g_per_cc: 1.05, shell_sizes: "" },
];
for (const s of SHELLS) potting.push({ pn: `HSP-MB-${String(s).padStart(2, "0")}`, kind: "mold", description: `Potting boot / mold, shell ${s}`, cure_hours: 0, density_g_per_cc: "", shell_sizes: s });
write("potting.csv", "potting compounds and molds (generic seed catalog)", potting);
const hardware: Row[] = [];
for (let n = 2; n <= 32; n += 2) hardware.push({ pn: `MS21919WDG${n}`, type: "cushionClamp", description: `Cushion clamp, ${n}/16 in (${((n / 16) * 25.4).toFixed(1)} mm)`, min_dia_mm: +(((n - 1.5) / 16) * 25.4).toFixed(1), max_dia_mm: +((n / 16) * 25.4).toFixed(1) });
hardware.push({ pn: "A-A-52081-C-2", type: "spotTie", description: "Spot tie, lacing tape, polyester", min_dia_mm: 1, max_dia_mm: 80 });
hardware.push({ pn: "A-A-52081-C-2", type: "lacing", description: "Continuous lacing, polyester tape", min_dia_mm: 1, max_dia_mm: 80 });
write("hardware.csv", "tie-down and support hardware (customer-installed clamps shown on drawing)", hardware);

// ─── Alternates ────────────────────────────────────────────────────────────
write("alternates.csv", "alternate parts; * = prefix wildcard", [
  { pn: "D38999/26W*", alternate: "D38999/26Z*", relationship: "Cadmium-free finish (zinc-nickel), same form/fit" },
  { pn: "D38999/26Z*", alternate: "D38999/26W*", relationship: "Cadmium olive drab finish, same form/fit" },
  { pn: "D38999/26W*", alternate: "D38999/26M*", relationship: "Composite shell, nickel finish (lighter)" },
  { pn: "D38999/26F*", alternate: "D38999/26G*", relationship: "Electroless nickel, space grade (F is inactive)" },
  { pn: "D38999/20W*", alternate: "D38999/20Z*", relationship: "Cadmium-free finish (zinc-nickel)" },
  { pn: "D38999/20Z*", alternate: "D38999/20W*", relationship: "Cadmium olive drab finish" },
  { pn: "D38999/24W*", alternate: "D38999/24Z*", relationship: "Cadmium-free finish (zinc-nickel)" },
  { pn: "D38999/24Z*", alternate: "D38999/24W*", relationship: "Cadmium olive drab finish" },
  { pn: "M22759/16", alternate: "M22759/32", relationship: "Lightweight XL-ETFE, smaller OD" },
  { pn: "M22759/32", alternate: "M22759/16", relationship: "Normal wall ETFE" },
  { pn: "M22759/32", alternate: "M22759/33", relationship: "High-strength alloy, 200 °C" },
  { pn: "HSL-OB-TC*", alternate: "HSL-OB-MF*", relationship: "Lightweight metal-clad fiber braid" },
]);

// ─── Demo supply ───────────────────────────────────────────────────────────
const sup: Row[] = [];
const S = (pattern: string, p1: number, stock: number, leadDays: number, lifecycle = "active") =>
  sup.push({ pattern, price_1: p1, price_10: +(p1 * 0.88).toFixed(2), price_100: +(p1 * 0.74).toFixed(2), stock, lead_days: leadDays, lifecycle, as_of: AS_OF });
S("D38999/26W*", 78, 140, 10);
S("D38999/26Z*", 92, 60, 21);
S("D38999/26M*", 115, 25, 35);
S("D38999/26F*", 88, 0, 70, "inactive");
S("D38999/26G*", 140, 12, 42);
S("D38999/26*", 95, 40, 28);
S("D38999/20W*", 84, 120, 10);
S("D38999/20Z*", 98, 50, 21);
S("D38999/20*", 102, 30, 28);
S("D38999/24W*", 96, 80, 14);
S("D38999/24Z*", 108, 30, 28);
S("D38999/24*", 118, 20, 35);
S("M39029/58*", 1.85, 25000, 5);
S("M39029/56*", 2.1, 25000, 5);
S("M39029/12*", 4.5, 2000, 21);
S("TBD-S10*", 6, 0, 42);
S("MS27488*", 0.18, 50000, 3);
S("M22759/16*", 0.95, 8000, 5);
S("M22759/32*", 1.1, 6000, 5);
S("M22759/33*", 1.45, 4000, 10);
S("M22759/44*", 1.6, 2000, 14);
S("M22759/86*", 2.4, 1500, 21);
S("M27500*", 4.2, 1200, 14);
S("HSB-SR*", 38, 200, 10);
S("HSB-EB*", 62, 120, 14);
S("HSB-SH*", 55, 60, 21);
S("HSB-PB*", 44, 40, 21);
S("D38999/32*", 14, 300, 7);
S("D38999/33*", 14, 300, 7);
S("D38999/28*", 6.5, 400, 7);
S("M25988*", 0.9, 2000, 5);
S("HSG-*", 7.5, 300, 10);
S("HSL-TP*", 0.35, 5000, 5);
S("HSL-SL*", 0.9, 3000, 7);
S("HSL-HS*", 1.2, 3000, 5);
S("HSL-JK*", 4.8, 800, 14);
S("HSL-CV*", 1.6, 1500, 7);
S("HSL-OB-TC*", 6.5, 2000, 7);
S("HSL-OB-NC*", 8.2, 1200, 10);
S("HSL-OB-SS*", 11.5, 600, 21);
S("HSL-OB-MF*", 14, 400, 28);
S("HSC-BC*", 2.1, 5000, 5);
S("HSK-B*", 6.5, 800, 10);
S("HSK-T*", 9.5, 400, 14);
S("HSM-*", 0.3, 20000, 3);
S("M81824*", 1.4, 3000, 7);
S("HSS-*", 1.1, 3000, 7);
S("HSP-PU*", 0.12, 900, 7);
S("HSP-EP*", 0.14, 900, 7);
S("HSP-SI*", 0.16, 900, 7);
S("HSP-MB*", 11, 200, 14);
S("MS21919*", 0.85, 5000, 5);
S("A-A-52081*", 0.02, 100000, 3);
write("supply.csv", `DEMO DATA ONLY: plausible prices (USD; wire/tape/braid per metre, compound per cc) and lead times as of ${AS_OF}; never real costs (spec 15.6)`, sup);
