import { Font, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";

/** Print palette: light theme, CMYK-safe (§16.8). */
export const C = {
  text: "#16181D",
  text2: "#4A515C",
  text3: "#646C79",
  border: "#C9CED6",
  rule: "#E1E4E8",
  fill: "#F4F5F7",
  accent: "#0B7F92",
  error: "#C4234F",
  warning: "#8F5B00",
  pass: "#3F7F1F",
};

let fontsOk = false;
/** Register the same Inter / JetBrains Mono fonts the app uses (embedded in PDFs). Falls back to Helvetica/Courier. */
export function registerFonts(src?: { inter400?: string; inter600?: string; mono400?: string }) {
  if (fontsOk || !src?.inter400) return;
  Font.register({ family: "Inter", fonts: [{ src: src.inter400, fontWeight: 400 }, { src: src.inter600 ?? src.inter400, fontWeight: 600 }] });
  if (src.mono400) Font.register({ family: "JetBrains Mono", src: src.mono400 });
  Font.registerHyphenationCallback((w) => [w]);
  fontsOk = true;
}
export const fontUi = () => (fontsOk ? "Inter" : "Helvetica");
export const fontMono = () => (fontsOk ? "JetBrains Mono" : "Courier");

export const s = StyleSheet.create({
  h1: { fontSize: 18, fontWeight: 600, marginBottom: 6 },
  h2: { fontSize: 13, fontWeight: 600, marginTop: 10, marginBottom: 5, color: C.text },
  h3: { fontSize: 10, fontWeight: 600, marginTop: 6, marginBottom: 3, color: C.text },
  p: { fontSize: 8.5, lineHeight: 1.4, color: C.text2, marginBottom: 4 },
  small: { fontSize: 7, color: C.text3 },
  caps: { fontSize: 7, letterSpacing: 0.5, textTransform: "uppercase", color: C.text3, fontWeight: 600 },
  row: { flexDirection: "row" },
});

export interface Column {
  label: string;
  w: number; // flex weight
  mono?: boolean;
  align?: "left" | "right";
}

/** Table that paginates automatically; header repeats on each page. */
export function Table({ cols, rows, fontSize = 7, zebra = true }: { cols: Column[]; rows: ReactNode[][]; fontSize?: number; zebra?: boolean }) {
  return (
    <View style={{ borderTop: `0.75pt solid ${C.border}` }}>
      <View fixed style={{ flexDirection: "row", backgroundColor: C.fill, borderBottom: `0.75pt solid ${C.border}` }}>
        {cols.map((c) => (
          <Text key={c.label} style={{ flex: c.w, fontSize: fontSize - 0.5, padding: 2, fontWeight: 600, color: C.text2, textAlign: c.align ?? "left" }}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={i} wrap={false} style={{ flexDirection: "row", borderBottom: `0.4pt solid ${C.rule}`, backgroundColor: zebra && i % 2 ? "#FAFAFB" : undefined }}>
          {r.map((cell, j) => (
            <View key={j} style={{ flex: cols[j]!.w, padding: 2, justifyContent: "center", alignItems: cols[j]!.align === "right" ? "flex-end" : "flex-start" }}>
              {typeof cell === "string" || typeof cell === "number" ? <Text style={{ fontSize, fontFamily: cols[j]!.mono ? fontMono() : fontUi(), color: C.text }}>{cell}</Text> : cell}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** Wire color swatch + printed code (works in grayscale and for CVD readers). */
export function Swatch({ codes, text, wire }: { codes: number[]; text: string; wire: (c: number) => string }) {
  if (!codes.length) return <Text style={{ fontSize: 7 }}>{text}</Text>;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: 12, height: 6, flexDirection: "row", border: `0.4pt solid ${C.text3}`, marginRight: 3 }}>
        {codes.map((c, i) => (
          <View key={i} style={{ flex: i === 0 ? 2 : 1, backgroundColor: wire(c) }} />
        ))}
      </View>
      <Text style={{ fontSize: 6.5, fontFamily: fontMono() }}>{text}</Text>
    </View>
  );
}

export function DraftStamp({ draft }: { draft: boolean }) {
  if (!draft) return null;
  return (
    <Text fixed style={{ position: "absolute", top: 8, left: 0, right: 0, textAlign: "center", fontSize: 9, color: C.error, fontWeight: 600, letterSpacing: 1 }}>
      DRAFT — NOT RELEASED
    </Text>
  );
}

export function ExportBanner({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Text fixed style={{ position: "absolute", bottom: 6, left: 0, right: 0, textAlign: "center", fontSize: 7, color: C.error, fontWeight: 600 }}>
      {text}
    </Text>
  );
}

export const DEMO_FOOTER = "Demo pricing — not a quotation";

/** Replace glyphs missing from the embedded Latin font subset (Ω, arrows, ≤/≥). */
export function pdfSafe(s: string): string {
  return s.replace(/MΩ/g, "Mohm").replace(/mΩ/g, "mohm").replace(/Ω/g, "ohm").replace(/→/g, "/").replace(/≤/g, "<=").replace(/≥/g, ">=");
}

export function fmtLen(mm: number, units: "mm" | "in", dec?: number) {
  return units === "in" ? `${(mm / 25.4).toFixed(dec ?? 2)} in` : `${mm.toFixed(dec ?? 0)} mm`;
}

export function money(n: number, d = 2) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d });
}
