import tokens from "./tokens.json";
export { tokens };
export * from "./color";

export type Theme = "dark" | "light";
export type WireTheme = Theme | "print";

type SemanticKey = keyof typeof tokens.semantic;

/** CSS variable name for a semantic token, e.g. bg.surface-1 → --bg-surface-1 */
export function cssVar(key: SemanticKey | string): string {
  return `--${key.replace(/\./g, "-")}`;
}

export function semantic(key: SemanticKey, theme: Theme): string {
  return tokens.semantic[key][theme];
}

/** CSS custom properties for both themes (§16.9). Theme switching sets data-theme on <html>. */
export function toCss(): string {
  const block = (theme: Theme) =>
    Object.entries(tokens.semantic)
      .map(([k, v]) => `  ${cssVar(k)}: ${(v as Record<Theme, string>)[theme]};`)
      .concat(Object.entries(tokens.wires).map(([k, v]) => `  --wire-${k}: ${(v as Record<Theme, string>)[theme]};`))
      .concat(tokens.pedigree[theme].map((c, i) => `  --pedigree-${i}: ${c};`))
      .concat(tokens.chart[theme].map((c, i) => `  --chart-${i}: ${c};`))
      .join("\n");
  return [
    `:root {\n  --font-ui: ${tokens.font.ui};\n  --font-mono: ${tokens.font.mono};\n  color-scheme: dark;\n${block("dark")}\n}`,
    `:root[data-theme="light"] {\n  color-scheme: light;\n${block("light")}\n}`,
  ].join("\n");
}

/** Wire fill color for a MIL-STD-681 code in a theme. */
export function wireColor(code: number, theme: WireTheme): string {
  return (tokens.wires as Record<string, Record<string, string>>)[String(code)]?.[theme] ?? "#888888";
}

export function pedigreeColor(i: number, theme: Theme): string {
  return tokens.pedigree[theme][i % tokens.pedigree[theme].length]!;
}

export function chartColor(i: number, theme: Theme): string {
  return tokens.chart[theme][Math.min(i, tokens.chart[theme].length - 1)]!;
}

/** Tailwind theme extension mapping semantic tokens to CSS variables. */
export const tailwindColors: Record<string, string> = Object.fromEntries(Object.keys(tokens.semantic).map((k) => [k.replace(/\./g, "-"), `var(${cssVar(k)})`]));
