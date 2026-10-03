import { resolvePedigree, type InspectionReq, type InspectionType, type ResolvedPedigree } from "@hs/model";
import type { DocData } from "./data";

/**
 * Simulated as-built record for the example manufacturing report: what a manufacturer would hand over with a lot of
 * harnesses built to this design, pedigree and order. Every value is generated (deterministically, from the design
 * hash, serial and test point) so the report shows the shape and depth of a real test data package without
 * pretending to be one.
 */

export interface MfgOrder {
  /** Customer purchase order. */
  po: string;
  /** Manufacturer's work order. */
  workOrder: string;
  qty: number;
  serialPrefix: string;
  /** ISO date the lot finished final test. */
  buildDate: string;
  /** Pedigree the lot was built to (defaults to the design's active pedigree). */
  pedigreeId?: string;
  /** Documents the order asks for on top of the pedigree's own list. */
  extraDocs: string[];
  customer: string;
}

export interface TestTable {
  cols: { label: string; w: number; mono?: boolean; align?: "left" | "right" }[];
  rows: string[][];
}

export interface InspectionRecord {
  typeId: string;
  name: string;
  sampling: string;
  /** Plain-language acceptance criterion with the pedigree's parameters. */
  criterion: string;
  /** Which units / samples were tested. */
  tested: string;
  equipment: string;
  /** Sections of detail data (e.g. one per serial). */
  sections: { title: string; table: TestTable }[];
  result: "PASS";
}

export interface SimulatedBuild {
  order: MfgOrder;
  ped: ResolvedPedigree;
  serials: { serial: string; built: string; assembler: string; inspector: string; tester: string }[];
  docs: string[];
  testDataPackage: boolean;
  inspections: InspectionRecord[];
  lots: { line: number; pn: string; description: string; qty: string; lot: string; dateCode: string; cert: string }[];
  equipment: { name: string; id: string; calDue: string }[];
}

export const DOC_COC = "Certificate of Conformance (CoC)";
export const DOC_FAI = "AS9102 First Article Inspection";
export const DOC_MATCERT = "Material certifications";
export const DOC_LOT = "Lot traceability";
export const DOC_SERIAL = "Serial traceability";
export const DOC_TDP = "Test data package";
export const DOC_SOURCE = "Customer source-inspection hold point";

/** FNV-1a string hash → 32-bit seed. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic uniform [0, 1) for one test point. */
function rnd(...key: (string | number)[]): number {
  let a = hash32(key.join("|"));
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo: number, hi: number, ...key: (string | number)[]) => lo + (hi - lo) * rnd(...key);
const fix = (n: number, d: number) => n.toFixed(d);
const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86400000).toISOString().slice(0, 10);

/** Which built units a sampling plan covers (destructive plans test coupons from the same lot instead). */
function sampled(sampling: string, serials: string[]): { units: string[]; label: string; coupons?: number } {
  const n = serials.length;
  if (/^100%/.test(sampling)) return { units: serials, label: `All ${n} unit${n === 1 ? "" : "s"} (100%)` };
  if (/first\/last/i.test(sampling)) {
    const u = n > 1 ? [serials[0]!, serials[n - 1]!] : [serials[0]!];
    return { units: u, label: `First and last article (${u.join(", ")})` };
  }
  if (/first article/i.test(sampling)) return { units: [serials[0]!], label: `First article (${serials[0]})` };
  const pct = sampling.match(/(\d+)%/);
  if (pct) {
    const k = Math.max(1, Math.ceil((n * Number(pct[1])) / 100));
    return { units: serials.slice(0, k), label: `${sampling} sample: ${k} of ${n} (${serials.slice(0, k).join(", ")})` };
  }
  const lot = sampling.match(/n=(\d+)/);
  if (lot) return { units: [], label: `${lot[1]} crimp coupons per lot, made on the production setup`, coupons: Number(lot[1]) };
  if (/setup/i.test(sampling)) return { units: [], label: "1 coupon per crimp setup (gauge / contact / tool)", coupons: 1 };
  return { units: serials, label: sampling };
}

function paramsOf(req: InspectionReq, t: InspectionType | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of t?.params ?? []) out[p.key] = (p as { default?: unknown }).default;
  return { ...out, ...req.params };
}

const VISUAL_ITEMS = [
  "Connector mating faces, keying and coupling",
  "Contact insertion depth and seating",
  "Wire insulation (nicks, cuts, heat damage)",
  "Conductor strands at crimp (bird-caging, cut strands)",
  "Coverings, braid coverage and terminations",
  "Backshells, clamps and strain relief",
  "Labels and markings (legible, positioned per drawing)",
  "Cleanliness / foreign object debris",
];

/** Build the simulated lot record for a design + order. */
export function simulateBuild(data: DocData, order: MfgOrder): SimulatedBuild {
  const ped = order.pedigreeId ? resolvePedigree(data.project.pedigreeScheme, order.pedigreeId) : data.ped;
  const h = data.rev.harness;
  const seed = `${data.designHash}|${order.workOrder}`;
  const qty = Math.max(1, Math.min(50, Math.round(order.qty)));
  const serialIds = Array.from({ length: qty }, (_, i) => `${order.serialPrefix}${String(i + 1).padStart(4, "0")}`);
  const people = ["A. Rivera", "J. Chen", "M. Okafor", "S. Patel", "K. Novak", "L. Haddad"];
  const serials = serialIds.map((serial, i) => ({
    serial,
    built: addDays(order.buildDate, -Math.floor((qty - 1 - i) / 4)),
    assembler: people[Math.floor(rnd(seed, serial, "asm") * 3)]!,
    inspector: people[3 + Math.floor(rnd(seed, serial, "insp") * 2)]!,
    tester: people[5]!,
  }));
  const docs = [...new Set([...ped.documentation, ...order.extraDocs])];
  const testDataPackage = docs.includes(DOC_TDP);
  const units = data.project.units;
  const len = (mm: number) => (units === "in" ? `${fix(mm / 25.4, 2)}` : `${fix(mm, 0)}`);
  const lenUnit = units === "in" ? "in" : "mm";

  const nets = h.nets.map((n) => n.name).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const nodeName = (id: string) => {
    const n = h.nodes.find((x) => x.id === id);
    if (n?.connectorId) return h.connectors.find((c) => c.id === n.connectorId)?.refDes ?? "?";
    return `BO${h.nodes.filter((x) => x.kind === "breakout").findIndex((x) => x.id === id) + 1}`;
  };
  // Distinct crimp setups: gauge × contact part number.
  const setups = new Map<string, { gauge: number; contact: string }>();
  const crimped = data.connectorRows.filter((c) => !data.cat.connector(c.pn)?.flyingLead);
  for (const c of crimped) for (const r of c.rows) if (r.gauge && r.contact && !r.contact.includes("(plug)")) setups.set(`${r.gauge}|${r.contact}`, { gauge: Number(r.gauge), contact: r.contact });
  const pinRows = crimped.flatMap((c) => c.rows.filter((r) => r.wire).map((r) => ({ ref: `${c.refDes}-${r.cavity}`, contact: r.contact, gauge: r.gauge })));

  const equipment: SimulatedBuild["equipment"] = [];
  const eq = (name: string, id: string) => {
    if (!equipment.some((e) => e.id === id)) equipment.push({ name, id, calDue: addDays(order.buildDate, 60 + Math.floor(rnd(seed, id) * 240)) });
    return `${name} (${id})`;
  };

  const inspections: InspectionRecord[] = [];
  for (const req of ped.inspections.filter((r) => r.sampling !== "none")) {
    const t = data.inspections.find((x) => x.id === req.typeId);
    const prm = paramsOf(req, t);
    const s = sampled(req.sampling, serialIds);
    const rec: InspectionRecord = { typeId: req.typeId, name: t?.name ?? req.typeId, sampling: req.sampling, criterion: "", tested: s.label, equipment: "", sections: [], result: "PASS" };
    switch (req.typeId) {
      case "continuity": {
        const max = Number(prm.maxOhm ?? 1);
        rec.criterion = `Every wire end-to-end <= ${max} ohm; no unintended connection between nets (isolation >= 100 Mohm at 50 V).`;
        rec.equipment = eq("Automated cable tester", "ACT-0117");
        for (const u of s.units)
          rec.sections.push({
            title: `Serial ${u}`,
            table: {
              cols: [{ label: "Wire", w: 1, mono: true }, { label: "From", w: 1.3, mono: true }, { label: "To", w: 1.3, mono: true }, { label: "AWG", w: 0.6, align: "right" }, { label: `Length (${lenUnit})`, w: 1, align: "right" }, { label: "Measured (mohm)", w: 1.2, align: "right" }, { label: "Limit (mohm)", w: 1, align: "right" }, { label: "Result", w: 0.8 }],
              rows: data.wireRows.map((w) => {
                const opk = data.cat.wire(w.spec, w.gauge)?.ohmPerKm ?? 50;
                const mohm = (opk * w.lengthMm) / 1000 + 2 * between(1.5, 4, seed, u, "cc", w.id) + between(-0.5, 0.5, seed, u, "n", w.id);
                return [w.id, w.from, w.to, String(w.gauge), len(w.lengthMm), fix(mohm, 1), fix(max * 1000, 0), "PASS"];
              }),
            },
          });
        if (s.units.length)
          rec.sections.push({
            title: "Isolation (all nets, low-voltage scan)",
            table: { cols: [{ label: "Serial", w: 1, mono: true }, { label: "Net pairs scanned", w: 1, align: "right" }, { label: "Lowest isolation (Mohm)", w: 1.4, align: "right" }, { label: "Shorts / opens", w: 1 }, { label: "Result", w: 0.8 }], rows: s.units.map((u) => [u, String((nets.length * (nets.length + 1)) / 2), fix(between(400, 2000, seed, u, "iso"), 0), "None", "PASS"]) },
          });
        break;
      }
      case "hipot": {
        const v = Number(prm.voltage ?? 1000);
        const maxMa = Number(prm.maxLeakageMa ?? 1);
        rec.criterion = `${v} V ${prm.mode ?? "DC"} for ${prm.dwellS ?? 1} s, ${prm.pairs ?? "all-to-all"}; leakage <= ${maxMa} mA; no breakdown.`;
        rec.equipment = eq("Automated cable tester, HV module", "ACT-0117-HV");
        for (const u of s.units)
          rec.sections.push({
            title: `Serial ${u}`,
            table: {
              cols: [{ label: "Net under test", w: 1.6, mono: true }, { label: "Against", w: 1.6 }, { label: "Applied (V)", w: 0.9, align: "right" }, { label: "Dwell (s)", w: 0.7, align: "right" }, { label: "Leakage (uA)", w: 1, align: "right" }, { label: "Limit (uA)", w: 0.9, align: "right" }, { label: "Result", w: 0.7 }],
              rows: nets.map((n) => [n, prm.pairs === "all-to-shell" ? "Shell" : "All other nets + shell", fix(v * between(0.995, 1.01, seed, u, "hv", n), 0), String(prm.dwellS ?? 1), fix(between(0.4, 9, seed, u, "lk", n), 2), fix(maxMa * 1000, 0), "PASS"]),
            },
          });
        break;
      }
      case "ir": {
        const minM = Number(prm.minMohm ?? 100);
        rec.criterion = `${prm.voltage ?? 500} V DC, 60 s; insulation resistance >= ${minM} Mohm from each net to all others and shell.`;
        rec.equipment = eq("Insulation resistance meter", "IRM-0042");
        for (const u of s.units)
          rec.sections.push({
            title: `Serial ${u}`,
            table: {
              cols: [{ label: "Net", w: 1.8, mono: true }, { label: "Test voltage (V)", w: 1, align: "right" }, { label: "Measured (Mohm)", w: 1.2, align: "right" }, { label: "Minimum (Mohm)", w: 1.1, align: "right" }, { label: "Result", w: 0.7 }],
              rows: nets.map((n) => [n, String(prm.voltage ?? 500), fix(10 ** between(3.6, 4.6, seed, u, "ir", n), 0), String(minM), "PASS"]),
            },
          });
        break;
      }
      case "pull": {
        const table = (prm.table ?? {}) as Record<string, number>;
        const n = s.coupons ?? 5;
        rec.criterion = "Crimp tensile strength >= the minimum for the gauge (per contact manufacturer / SAE AS7928), pulled to failure.";
        rec.equipment = eq("Crimp pull tester", "CPT-0208");
        const rows = [...setups.values()].map((st) => {
          const min = table[String(st.gauge)] ?? 50;
          const vals = s.coupons ? Array.from({ length: n }, (_, i) => min * between(1.3, 1.75, seed, "pull", st.contact, st.gauge, i)) : s.units.map((u) => min * between(1.3, 1.75, seed, "pull", u, st.contact, st.gauge));
          return [String(st.gauge), st.contact, String(vals.length), vals.map((x) => fix(x, 0)).join(", "), fix(Math.min(...vals), 0), String(min), "PASS"];
        });
        rec.sections.push({ title: s.coupons ? "Lot coupons" : "Sampled units (pulled at a spare / witness crimp)", table: { cols: [{ label: "AWG", w: 0.5, align: "right" }, { label: "Contact", w: 1.4, mono: true }, { label: "n", w: 0.3, align: "right" }, { label: "Forces (N)", w: 2.2 }, { label: "Lowest (N)", w: 0.7, align: "right" }, { label: "Min (N)", w: 0.6, align: "right" }, { label: "Result", w: 0.6 }], rows } });
        break;
      }
      case "retention": {
        const f = Number(prm.forceN ?? 44);
        rec.criterion = `Each seated contact withstands ${f} N axial push from the mating side with <= 0.30 mm displacement.`;
        rec.equipment = eq("Contact retention tester", "CRT-0033");
        for (const u of s.units)
          rec.sections.push({ title: `Serial ${u}`, table: { cols: [{ label: "Contact", w: 1, mono: true }, { label: "Contact P/N", w: 1.6, mono: true }, { label: "Force (N)", w: 0.8, align: "right" }, { label: "Displacement (mm)", w: 1.1, align: "right" }, { label: "Result", w: 0.7 }], rows: pinRows.map((p) => [p.ref, p.contact, String(f), fix(between(0.01, 0.12, seed, u, "ret", p.ref), 2), "PASS"]) } });
        break;
      }
      case "xray": {
        rec.criterion = `Radiographic inspection of ${prm.targets ?? "contact seating"}: every contact fully seated past the retention clip; no foreign objects.`;
        rec.equipment = eq("Real-time X-ray system", "RTX-0005");
        rec.sections.push({ title: "Images reviewed", table: { cols: [{ label: "Serial", w: 0.9, mono: true }, { label: "Connector", w: 0.8, mono: true }, { label: "Contacts", w: 0.7, align: "right" }, { label: "Seated", w: 0.7, align: "right" }, { label: "Image ref", w: 1.4, mono: true }, { label: "Result", w: 0.6 }], rows: s.units.flatMap((u) => crimped.map((c) => { const k = c.rows.filter((r) => r.wire).length; return [u, c.refDes, String(k), String(k), `XR-${u}-${c.refDes}`, "PASS"]; })) } });
        break;
      }
      case "xsection": {
        rec.criterion = "Crimp cross-section: no voids at the conductor, all strands captured, compaction within the contact manufacturer's window.";
        rec.equipment = eq("Metallographic prep + microscope", "MET-0011");
        rec.sections.push({ title: "Crimp setups", table: { cols: [{ label: "AWG", w: 0.5, align: "right" }, { label: "Contact", w: 1.4, mono: true }, { label: "Compaction (%)", w: 0.9, align: "right" }, { label: "Voids", w: 0.6 }, { label: "Strands", w: 0.8 }, { label: "Image ref", w: 1.2, mono: true }, { label: "Result", w: 0.6 }], rows: [...setups.values()].map((st) => [String(st.gauge), st.contact, fix(between(82, 92, seed, "xs", st.contact, st.gauge), 1), "None", "All captured", `XS-${st.gauge}-${hash32(st.contact).toString(16).slice(0, 4).toUpperCase()}`, "PASS"]) } });
        break;
      }
      case "visual": {
        rec.criterion = `Workmanship to ${ped.workmanship || "IPC/WHMA-A-620"} ${prm.acceptanceClass ?? ""} at ${prm.magnification ?? "4x"}.`.replace(/\s+\./, ".");
        rec.equipment = eq("Inspection stereo microscope", "MIC-0021");
        rec.sections.push({ title: "Checklist", table: { cols: [{ label: "Item", w: 2.6 }, ...s.units.map((u) => ({ label: u, w: 0.8 }))], rows: VISUAL_ITEMS.map((it) => [it, ...s.units.map(() => "Accept")]) } });
        break;
      }
      case "dimensional": {
        rec.criterion = "Segment lengths and breakout locations within the drawing tolerance.";
        rec.equipment = eq("Calibrated layout board + steel rule", "LB-0003");
        for (const u of s.units)
          rec.sections.push({
            title: `Serial ${u}`,
            table: {
              cols: [{ label: "Segment", w: 1.4, mono: true }, { label: `Nominal (${lenUnit})`, w: 1, align: "right" }, { label: `Tol (+/-${lenUnit})`, w: 0.9, align: "right" }, { label: `Measured (${lenUnit})`, w: 1, align: "right" }, { label: "Result", w: 0.7 }],
              rows: h.segments.map((sg) => [`${nodeName(sg.a)}-${nodeName(sg.b)}${sg.label ? ` (${sg.label})` : ""}`, len(sg.lengthMm), len(sg.toleranceMm), len(sg.lengthMm + sg.toleranceMm * between(-0.45, 0.45, seed, u, "dim", sg.id)), "PASS"]),
            },
          });
        break;
      }
      case "bond": {
        const max = Number(prm.maxMohm ?? 2.5);
        rec.criterion = `Shield / backshell to connector shell bond <= ${max} mohm (4-wire).`;
        rec.equipment = eq("Micro-ohmmeter (4-wire)", "MOM-0019");
        const points = [...h.connectors.filter((c) => c.backshell).map((c) => `${c.refDes} backshell to shell`), ...h.shields.map((sh) => `Shield ${sh.label} termination`), ...h.layers.filter((l) => l.type === "overbraid").map((_, i) => `Overbraid ${i + 1} to backshells`)];
        for (const u of s.units) rec.sections.push({ title: `Serial ${u}`, table: { cols: [{ label: "Bond point", w: 2.2 }, { label: "Measured (mohm)", w: 1, align: "right" }, { label: "Limit (mohm)", w: 0.9, align: "right" }, { label: "Result", w: 0.7 }], rows: (points.length ? points : ["Connector shells (no shields or backshells fitted)"]).map((pt) => [pt, fix(between(0.3, max * 0.7, seed, u, "bond", pt), 2), String(max), "PASS"]) } });
        break;
      }
      default:
        rec.criterion = t?.description ?? "";
        rec.sections.push({ title: "Results", table: { cols: [{ label: "Serial", w: 1, mono: true }, { label: "Result", w: 1 }], rows: s.units.map((u) => [u, "PASS"]) } });
    }
    inspections.push(rec);
  }

  const lots = data.bom.lines.map((l) => ({
    line: l.line,
    pn: l.pn,
    description: l.description,
    qty: `${+(l.qty * qty).toFixed(l.uom === "ea" ? 0 : 2)} ${l.uom}`,
    lot: `L${(hash32(`${seed}|lot|${l.pn}`) % 900000) + 100000}`,
    dateCode: `${String(new Date(order.buildDate).getUTCFullYear() - (hash32(`${seed}|dc|${l.pn}`) % 2)).slice(2)}${String((hash32(`${seed}|wk|${l.pn}`) % 52) + 1).padStart(2, "0")}`,
    cert: `CoC-${(hash32(`${seed}|cert|${l.pn}`) % 90000) + 10000}`,
  }));
  return { order: { ...order, qty }, ped, serials, docs, testDataPackage, inspections, lots, equipment };
}
