/** Color math for contrast (WCAG 2.2), CVD simulation (Machado 2009) and CIELAB ΔE. */

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

const toLin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const fromLin = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLin) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Machado, Oliveira & Fernandes (2009) matrices at severity 1.0, applied in linear RGB. */
const MACHADO: Record<"protan" | "deutan" | "tritan", number[]> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

export type CvdType = keyof typeof MACHADO | "achroma";

export function simulateCvd(hex: string, type: CvdType): string {
  const lin = hexToRgb(hex).map(toLin) as RGB;
  if (type === "achroma") {
    const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    return rgbToHex([fromLin(y), fromLin(y), fromLin(y)]);
  }
  const m = MACHADO[type];
  const out: RGB = [
    m[0]! * lin[0] + m[1]! * lin[1] + m[2]! * lin[2],
    m[3]! * lin[0] + m[4]! * lin[1] + m[5]! * lin[2],
    m[6]! * lin[0] + m[7]! * lin[1] + m[8]! * lin[2],
  ];
  return rgbToHex(out.map((c) => fromLin(Math.max(0, Math.min(1, c)))) as RGB);
}

/** SVG feColorMatrix values for a CVD simulation (sRGB approximation used for the canvas filter, §16.5). */
export function cvdFilterMatrix(type: CvdType): string {
  if (type === "achroma") return "0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0";
  const m = MACHADO[type];
  return `${m[0]} ${m[1]} ${m[2]} 0 0 ${m[3]} ${m[4]} ${m[5]} 0 0 ${m[6]} ${m[7]} ${m[8]} 0 0 0 0 0 1 0`;
}

export function toLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(toLin) as RGB;
  let x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  let y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  let z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** CIE76 ΔE*ab. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Wire casing rule (§16.4): casing needed when fill contrast against canvas < 3:1. Computed, so custom colors are covered. */
export function needsCasing(fill: string, canvas: string): boolean {
  return contrast(fill, canvas) < 3;
}
