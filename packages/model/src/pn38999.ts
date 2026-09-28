/**
 * MIL-DTL-38999 Series III part-number build/parse.
 * Format: D38999/<slash><class><shell code><insert no.><contact style><key>[-]
 * e.g. D38999/26WB35SN = /26 straight plug, class W, shell B (size 11), insert 11-35, sockets, normal key.
 */
export const SHELL_CODES: Record<string, number> = { A: 9, B: 11, C: 13, D: 15, E: 17, F: 19, G: 21, H: 23, J: 25 };
export const SHELL_CODE_BY_SIZE: Record<number, string> = Object.fromEntries(Object.entries(SHELL_CODES).map(([k, v]) => [v, k]));
export const KEYINGS = ["N", "A", "B", "C", "D", "E"] as const;
export type Keying = (typeof KEYINGS)[number];

export interface D38999Parts {
  slash: string; // "20" | "24" | "26"
  finish: string; // class code, e.g. "W"
  shellSize: number;
  insert: string; // insert number, e.g. "35"
  contactStyle: string; // "P" | "S" | ...
  keying: string;
}

export function arrangementId(shellSize: number, insert: string): string {
  return `${shellSize}-${insert}`;
}

export function buildD38999(p: D38999Parts): string {
  const code = SHELL_CODE_BY_SIZE[p.shellSize];
  if (!code) throw new Error(`Invalid shell size ${p.shellSize}`);
  const trailing = p.finish.length === 2 ? "-" : "";
  return `D38999/${p.slash}${p.finish}${code}${p.insert}${p.contactStyle}${p.keying}${trailing}`;
}

const RE = /^(?:M|D)?38999\/?(\d{2})(AA|AB|[A-Z])([A-HJ])(\d{1,3})([A-Z])([NABCDE])-?$/;

/** Parse a D38999 PN (tolerates missing "D", spaces, lowercase). Returns null when not a Series III PN. */
export function parseD38999(pn: string): D38999Parts | null {
  const s = normalizePn(pn);
  const m = RE.exec(s);
  if (!m) return null;
  const shellSize = SHELL_CODES[m[3]!];
  if (!shellSize) return null;
  return { slash: m[1]!, finish: m[2]!, shellSize, insert: m[4]!, contactStyle: m[5]!, keying: m[6]! };
}

/** Normalized PN key: uppercase, no spaces (§15.2). */
export function normalizePn(pn: string): string {
  return pn.toUpperCase().replace(/\s+/g, "");
}
