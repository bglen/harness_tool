import { resolvePedigree } from "./pedigree";
import type { Project, RevisionScheme } from "./schema";

/**
 * Revision labelling, per pedigree (inherited like other pedigree fields):
 *  - alpha:         A, B, C … Y, AA, AB … skipping letters that read like digits (ASME Y14.35: I, O, Q, S, X, Z)
 *  - numeric:       1, 2, 3 … (optionally zero-padded: 01, 02 …)
 *  - alphanumeric:  A1, A2 … (minor); a major revision moves to B1
 * An optional prefix is part of every label (e.g. "X" for development: X1, X2 …).
 */

export const DEFAULT_REVISION_SCHEME: RevisionScheme = { style: "alpha", start: "A", skip: "IOQSXZ", pad: 0, prefix: "" };

export function revisionSchemeOf(proj: Project, pedigreeId: string): RevisionScheme {
  return { ...DEFAULT_REVISION_SCHEME, ...(resolvePedigree(proj.pedigreeScheme, pedigreeId).revisionScheme ?? {}) };
}

const lettersOf = (s: RevisionScheme) => [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter((c) => !s.skip.toUpperCase().includes(c));

/** Letters → ordinal in the scheme's alphabet (A=0 … Y=19, AA=20 …), or null. */
function letterIndex(t: string, s: RevisionScheme): number | null {
  const L = lettersOf(s);
  if (!t || [...t].some((c) => !L.includes(c))) return null;
  let n = 0;
  for (const c of t) n = n * L.length + L.indexOf(c) + 1;
  return n - 1;
}
function letterAt(i: number, s: RevisionScheme): string {
  const L = lettersOf(s);
  let n = i + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % L.length;
    out = L[r]! + out;
    n = Math.floor((n - 1) / L.length);
  }
  return out;
}
const num = (n: number, s: RevisionScheme) => String(n).padStart(s.pad || 0, "0");

/** Position of a label in the scheme's sequence ([major, minor]), or null when the label isn't in this scheme. */
export function revisionOrder(label: string, s: RevisionScheme): [number, number] | null {
  if (s.prefix && !label.startsWith(s.prefix)) return null;
  const t = label.slice(s.prefix.length);
  if (s.style === "numeric") return /^\d+$/.test(t) ? [Number(t), 0] : null;
  if (s.style === "alpha") {
    const i = letterIndex(t, s);
    return i === null ? null : [i, 0];
  }
  const m = t.match(/^([A-Z]+)(\d+)$/);
  const i = m ? letterIndex(m[1]!, s) : null;
  return m && i !== null ? [i, Number(m[2])] : null;
}

/** First revision of a scheme (its start value, normalised to the scheme). */
export function firstRevision(s: RevisionScheme): string {
  const start = s.start.trim().toUpperCase();
  if (s.style === "numeric") return s.prefix + num(/^\d+$/.test(start) ? Number(start) : 1, s);
  if (s.style === "alpha") return s.prefix + (letterIndex(start, s) !== null ? start : letterAt(0, s));
  const m = start.match(/^([A-Z]+)(\d+)$/);
  return s.prefix + (m && letterIndex(m[1]!, s) !== null ? start : `${letterAt(0, s)}1`);
}

/** The revision after `label`. Alphanumeric: minor bumps the number, major moves to the next letter at 1. */
export function nextRevision(label: string, s: RevisionScheme, major = false): string {
  const o = revisionOrder(label, s);
  if (!o) return firstRevision(s);
  if (s.style === "numeric") return s.prefix + num(o[0] + 1, s);
  if (s.style === "alpha") return s.prefix + letterAt(o[0] + 1, s);
  return s.prefix + (major ? `${letterAt(o[0] + 1, s)}1` : `${letterAt(o[0], s)}${o[1] + 1}`);
}

/** The first few labels of a scheme (for previews). */
export function revisionPreview(s: RevisionScheme, n = 5): string[] {
  const out = [firstRevision(s)];
  while (out.length < n) out.push(nextRevision(out[out.length - 1]!, s));
  return out;
}

/**
 * Label for a working revision built to `pedigreeId`: the next one after the latest frozen revision labelled in that
 * pedigree's scheme, else the scheme's first. Never repeats a label already used in the project.
 */
export function workingRevisionLabel(proj: Project, pedigreeId: string, opts: { exceptRevisionId?: string; major?: boolean } = {}): string {
  const s = revisionSchemeOf(proj, pedigreeId);
  const others = proj.revisions.filter((r) => r.id !== opts.exceptRevisionId);
  const used = new Set(others.map((r) => r.label));
  const ordered = others
    .filter((r) => r.frozen)
    .map((r) => ({ r, o: revisionOrder(r.label, s) }))
    .filter((x) => x.o)
    .sort((a, b) => a.o![0] - b.o![0] || a.o![1] - b.o![1]);
  const last = ordered[ordered.length - 1];
  let label = last ? nextRevision(last.r.label, s, opts.major) : firstRevision(s);
  for (let i = 0; used.has(label) && i < 1000; i++) label = nextRevision(label, s);
  return label;
}
