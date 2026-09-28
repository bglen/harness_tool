/** All lengths are stored in millimetres. These helpers convert for display/input. */
export type LengthUnit = "mm" | "in";

/** Thin space used between a value and its unit (§16.6). */
export const THIN = " ";

const PER_UNIT: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  '"': 25.4,
  inch: 25.4,
  inches: 25.4,
  ft: 304.8,
  "'": 304.8,
};

/**
 * Parse a user-typed length. Accepts `12in`, `300mm`, `1.2m`, `12"`, `1ft 6in`
 * or a bare number (interpreted in `defaultUnit`). Returns mm, or null if invalid.
 */
export function parseLength(input: string, defaultUnit: LengthUnit): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, "");
  if (!s) return null;
  const re = /(-?\d*\.?\d+)\s*(mm|cm|m|inches|inch|in|ft|"|')?/g;
  let total = 0;
  let matched = "";
  let m: RegExpExecArray | null;
  let any = false;
  while ((m = re.exec(s))) {
    if (m[0].length === 0) break;
    any = true;
    matched += m[0];
    const v = parseFloat(m[1]!);
    const unit = m[2] ?? defaultUnit;
    total += v * PER_UNIT[unit]!;
  }
  if (!any) return null;
  // Reject junk such as "12abc" by checking that everything was consumed.
  if (s.replace(/\s+/g, "") !== matched.replace(/\s+/g, "")) return null;
  if (!Number.isFinite(total)) return null;
  return total;
}

export function toUnit(mm: number, unit: LengthUnit): number {
  return unit === "in" ? mm / 25.4 : mm;
}

export function fromUnit(v: number, unit: LengthUnit): number {
  return unit === "in" ? v * 25.4 : v;
}

/** Format a length for display, e.g. `11.81 in` or `300 mm`. */
export function formatLength(mm: number, unit: LengthUnit, opts: { decimals?: number; unit?: boolean } = {}): string {
  const v = toUnit(mm, unit);
  const decimals = opts.decimals ?? (unit === "in" ? 2 : v >= 100 ? 0 : 1);
  const num = v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
  return opts.unit === false ? num : `${num}${THIN}${unit}`;
}

export function formatTotalLength(mm: number, unit: LengthUnit): string {
  if (unit === "in") {
    const ft = mm / 304.8;
    return ft >= 10 ? `${ft.toFixed(1)}${THIN}ft` : `${(mm / 25.4).toFixed(1)}${THIN}in`;
  }
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)}${THIN}m` : `${Math.round(mm)}${THIN}mm`;
}

export function formatMass(g: number): string {
  return g >= 1000 ? `${(g / 1000).toFixed(2)}${THIN}kg` : `${Math.round(g)}${THIN}g`;
}

export function formatMoney(usd: number, decimals = 2): string {
  return usd.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatDiameter(mm: number, unit: LengthUnit): string {
  return `⌀${THIN}${formatLength(mm, unit, { decimals: unit === "in" ? 3 : 1 })}`;
}

/** Round a length up to a resolution (e.g. machine cut resolution). */
export function roundUp(mm: number, resolution: number): number {
  if (resolution <= 0) return mm;
  return Math.ceil(mm / resolution - 1e-9) * resolution;
}
