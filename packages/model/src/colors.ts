/** MIL-STD-681 wire color codes (§16.4). */
export const WIRE_COLORS = [
  { code: 0, name: "Black", abbr: "BLK" },
  { code: 1, name: "Brown", abbr: "BRN" },
  { code: 2, name: "Red", abbr: "RED" },
  { code: 3, name: "Orange", abbr: "ORN" },
  { code: 4, name: "Yellow", abbr: "YEL" },
  { code: 5, name: "Green", abbr: "GRN" },
  { code: 6, name: "Blue", abbr: "BLU" },
  { code: 7, name: "Violet", abbr: "VIO" },
  { code: 8, name: "Gray", abbr: "GRA" },
  { code: 9, name: "White", abbr: "WHT" },
] as const;

export type ColorCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface WireColor {
  base: number;
  stripes: number[];
}

export function colorName(code: number): string {
  return WIRE_COLORS[code]?.name ?? "?";
}

export function colorAbbr(code: number): string {
  return WIRE_COLORS[code]?.abbr ?? "?";
}

/** `9-6-2 WHT/BLU/RED` style code (§16.5). */
export function formatWireColor(c: WireColor): string {
  const codes = [c.base, ...c.stripes];
  return `${codes.join("-")} ${codes.map(colorAbbr).join("/")}`;
}

/** Long form for tooltips / screen readers: "white with blue and red stripes". */
export function describeWireColor(c: WireColor): string {
  const base = colorName(c.base).toLowerCase();
  if (!c.stripes.length) return base;
  const s = c.stripes.map((x) => colorName(x).toLowerCase());
  const list = s.length === 1 ? s[0] : `${s.slice(0, -1).join(", ")} and ${s[s.length - 1]}`;
  return `${base} with ${list} stripe${s.length > 1 ? "s" : ""}`;
}

/** Parse `9-6-2`, `WHT/BLU`, `white`, `2` etc. Returns null if unparseable. */
export function parseWireColor(input: string): WireColor | null {
  const s = input.trim().toUpperCase();
  if (!s) return null;
  const parts = s.split(/[\s\-/,]+/).filter(Boolean);
  const codes: number[] = [];
  for (const p of parts) {
    if (/^\d$/.test(p)) {
      codes.push(Number(p));
      continue;
    }
    const hit = WIRE_COLORS.find((c) => c.abbr === p || c.name.toUpperCase() === p || c.name.toUpperCase().startsWith(p) && p.length >= 3);
    if (hit) codes.push(hit.code);
    else if (p === "GRY" || p === "GREY") codes.push(8);
    else if (p === "PUR" || p === "PURPLE") codes.push(7);
    else if (p === "BK") codes.push(0);
    else if (p === "WH") codes.push(9);
    else if (p === "RD") codes.push(2);
    else if (!/^\d+$/.test(p) || p.length !== 1) {
      // codes like "962" (no separators)
      if (/^\d{2,4}$/.test(p)) codes.push(...p.split("").map(Number));
      else return null;
    }
  }
  if (!codes.length) return null;
  return { base: codes[0]!, stripes: codes.slice(1, 4) };
}

export function sameColor(a: WireColor, b: WireColor): boolean {
  return a.base === b.base && a.stripes.length === b.stripes.length && a.stripes.every((s, i) => s === b.stripes[i]);
}
