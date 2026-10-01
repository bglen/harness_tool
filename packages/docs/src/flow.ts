/**
 * Deterministic pagination for template blocks whose content can run long (tables, notes). Content is a list of
 * fixed-height items grouped under headings; items are packed top-to-bottom into the block's columns, and whatever
 * doesn't fit continues in the same box on an extra page of the same sheet. Heights are computed up front (single-line
 * table rows, estimated wrapping for notes), so the page count is known before rendering and {sheets} is exact.
 */

export interface FlowCol {
  label: string;
  /** Relative width. */
  w: number;
  mono?: boolean;
  align?: "left" | "right";
}

export type FlowCell = string | { codes: number[]; text: string };

export type FlowItem =
  | { t: "title"; text: string; h: number }
  | { t: "header"; cols: FlowCol[]; h: number }
  | { t: "row"; cols: FlowCol[]; cells: FlowCell[]; h: number; zebra: boolean }
  | { t: "note"; n: number; text: string; h: number };

export interface FlowGroup {
  /** Kept with the first item; repeated (as `contHead`, if given) at the top of each column the group continues in. */
  head: FlowItem[];
  items: FlowItem[];
  contHead?: FlowItem[];
}

const sum = (xs: FlowItem[]) => xs.reduce((a, x) => a + x.h, 0);

/** Pack groups into columns of height `colH`, `columns` per page. Returns pages → columns → items (at least one page). */
export function packFlow(groups: FlowGroup[], colH: number, columns: number): FlowItem[][][] {
  const cols: FlowItem[][] = [];
  let cur: FlowItem[] = [];
  let used = 0;
  const newCol = () => {
    cols.push(cur);
    cur = [];
    used = 0;
  };
  const put = (xs: FlowItem[]) => {
    for (const x of xs) cur.push(x);
    used += sum(xs);
  };
  for (const g of groups) {
    // Don't strand a heading at the bottom of a column: it needs room for its first row.
    const need = sum(g.head) + (g.items[0]?.h ?? 0);
    if (used > 0 && used + need > colH + 1e-6) newCol();
    put(g.head);
    let inCol = 0;
    for (const it of g.items) {
      if (used + it.h > colH + 1e-6 && (inCol > 0 || used > sum(g.head))) {
        newCol();
        put(g.contHead ?? g.head);
        inCol = 0;
      }
      put([it]);
      inCol++;
    }
  }
  if (cur.length || !cols.length) cols.push(cur);
  const pages: FlowItem[][][] = [];
  for (let i = 0; i < cols.length; i += columns) pages.push(cols.slice(i, i + columns));
  return pages;
}

/** Height of a single-line table row at a font size (pt). */
export const rowH = (fs: number) => fs * 1.25 + 3;
export const headerH = (fs: number) => fs * 1.2 + 4;
export const titleH = (fs: number) => fs * 1.3 + 5;

/** Approximate glyph advance as a fraction of the font size (conservative, so estimates err toward more lines). */
export const charW = (fs: number, mono = false) => fs * (mono ? 0.62 : 0.55);

/** Truncate to what fits on one line of `widthPt`. */
export function fitText(s: string, widthPt: number, fs: number, mono = false): string {
  const max = Math.max(1, Math.floor(widthPt / charW(fs, mono)));
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + "…";
}

/** Estimated wrapped line count of text in a column `widthPt` wide (word wrap). */
export function estimateLines(text: string, widthPt: number, fs: number): number {
  const per = Math.max(8, Math.floor(widthPt / charW(fs)));
  let lines = 0;
  for (const para of text.split("\n")) {
    let len = 0;
    let n = 1;
    for (const w of para.split(/\s+/).filter(Boolean)) {
      if (len && len + 1 + w.length > per) {
        n += Math.ceil(Math.max(1, w.length) / per);
        len = w.length % per;
      } else len += (len ? 1 : 0) + w.length;
    }
    lines += n;
  }
  return lines;
}
