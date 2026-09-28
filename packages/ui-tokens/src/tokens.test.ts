/** CI checks on the token file (§16.9): a failing check blocks the merge. */
import { describe, expect, it } from "vitest";
import { contrast, deltaE, needsCasing, simulateCvd, tokens, type Theme } from "./index";

const themes: Theme[] = ["dark", "light"];
const S = (k: keyof typeof tokens.semantic, t: Theme) => tokens.semantic[k][t];

describe("WCAG 2.2 contrast", () => {
  for (const t of themes) {
    it(`${t}: text contrast`, () => {
      for (const bg of ["bg.canvas", "bg.app", "bg.surface-1", "bg.surface-2"] as const) {
        expect(contrast(S("text.primary", t), S(bg, t))).toBeGreaterThanOrEqual(7);
        expect(contrast(S("text.secondary", t), S(bg, t))).toBeGreaterThanOrEqual(4.5);
        expect(contrast(S("text.tertiary", t), S(bg, t))).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${t}: controls, status and accent ≥ 3:1`, () => {
      for (const bg of ["bg.surface-1", "bg.surface-2", "bg.canvas"] as const) {
        expect(contrast(S("border.control", t), S(bg, t))).toBeGreaterThanOrEqual(3);
        expect(contrast(S("accent", t), S(bg, t))).toBeGreaterThanOrEqual(3);
        for (const s of ["status.error", "status.warning", "status.pass"] as const) expect(contrast(S(s, t), S(bg, t))).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(S("accent.on", t), S("accent", t))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("CVD separation (Machado 2009, full severity)", () => {
  for (const t of themes) {
    it(`${t}: error vs warning stays distinct`, () => {
      for (const cvd of ["protan", "deutan", "tritan"] as const) {
        const d = deltaE(simulateCvd(S("status.error", t), cvd), simulateCvd(S("status.warning", t), cvd));
        expect(d, `${cvd} ΔE`).toBeGreaterThanOrEqual(27);
      }
    });
    it(`${t}: pedigree hues keep a minimum ΔE`, () => {
      const cols = tokens.pedigree[t];
      for (const cvd of ["protan", "deutan", "tritan"] as const) {
        let min = Infinity;
        for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) min = Math.min(min, deltaE(simulateCvd(cols[i]!, cvd), simulateCvd(cols[j]!, cvd)));
        // Pedigrees always also show a text code; the palette was chosen by max-min ΔE search (≈20).
        expect(min, `${cvd} min ΔE`).toBeGreaterThanOrEqual(15);
      }
    });
  }
});

describe("wire casing rule", () => {
  it("flags exactly the low-contrast wires per theme", () => {
    const need = (t: Theme) =>
      Object.entries(tokens.wires)
        .filter(([, v]) => needsCasing(v[t], S("bg.canvas", t)))
        .map(([k]) => Number(k));
    expect(need("dark")).toContain(0); // black on dark
    expect(need("light")).toEqual(expect.arrayContaining([4, 9])); // yellow, white on light
    expect(need("dark")).not.toContain(9);
  });
  it("casing color contrasts with canvas", () => {
    for (const t of themes) expect(contrast(S("wire.casing", t), S("bg.canvas", t))).toBeGreaterThanOrEqual(3);
  });
});
