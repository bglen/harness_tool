import type { BackshellPart, BackshellRef } from "@hs/model";
import { semantic } from "@hs/ui-tokens";

/**
 * Side-view backshell drawn behind the connector body, in the glyph's local frame: the connector's rear face is at
 * x = REAR, the glyph centre line at y = h / 2, and the cable leaves toward +x. The glyph mirrors this for left-facing
 * connectors. Each style gets its own silhouette; angled bodies bend up or down according to the clocking.
 */

export const REAR = 48;

export const BACKSHELL_STYLE: Record<BackshellPart["style"], string> = {
  strainRelief: "Strain relief",
  emiBand: "EMI band",
  shieldRing: "Shield ring",
  pottingBoot: "Potting boot",
};

/** Which way an angled backshell points in the side view, from its clocking (0° = up, 180° = down, 90°/270° = toward/away from the viewer). */
export function bendOf(clockingDeg: number): "up" | "down" | "toward" | "away" {
  const r = (((clockingDeg % 360) + 360) % 360) * (Math.PI / 180);
  const c = Math.cos(r);
  if (Math.abs(c) >= 0.38) return c > 0 ? "up" : "down";
  return Math.sin(r) > 0 ? "toward" : "away";
}

export function backshellLabel(bs: BackshellPart): string {
  return `${BACKSHELL_STYLE[bs.style]}${bs.angle ? ` ${bs.angle}°` : ""}`;
}

/** Bend radius of an angled backshell's centre line (half-width 10, so the inside of the bend has radius 2). */
const BEND_R = 12;
/** Length of the style-specific tail drawn by `Tail`. */
const TAIL = 26;

/**
 * Elbow geometry for a body of half-width 10 turning by `angle` at x = px: the annular sector drawn as the bend, and
 * the rotation (about the bend centre) that carries a straight tail starting at px round to the bend's exit.
 */
export function elbow(angle: number, bend: "up" | "down", px: number, cy: number): { path: string; transform: string } {
  const s = bend === "up" ? -1 : 1;
  const c = { x: px, y: cy + s * BEND_R };
  const th = s * angle;
  const rot = (p: { x: number; y: number }) => {
    const r = (th * Math.PI) / 180;
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: c.x + dx * Math.cos(r) - dy * Math.sin(r), y: c.y + dx * Math.sin(r) + dy * Math.cos(r) };
  };
  // Outer edge is on the far side from the bend centre.
  const far = { x: px, y: cy - s * 10 };
  const near = { x: px, y: cy + s * 10 };
  const f2 = rot(far);
  const n2 = rot(near);
  const sweep = th > 0 ? 1 : 0;
  const path = `M${far.x},${far.y} A${BEND_R + 10},${BEND_R + 10} 0 0 ${sweep} ${f2.x},${f2.y} L${n2.x},${n2.y} A${BEND_R - 10},${BEND_R - 10} 0 0 ${1 - sweep} ${near.x},${near.y}Z`;
  return { path, transform: `rotate(${th} ${c.x} ${c.y})` };
}

/** How far an angled backshell reaches beyond the glyph's top or bottom edge (for hit areas and the label). */
export function bendReach(angle: number, h: number): number {
  const a = (angle * Math.PI) / 180;
  // Tail end, outer corner: bend offset plus the tail and half-width projected on the vertical.
  return Math.max(0, BEND_R * (1 - Math.cos(a)) + TAIL * Math.sin(a) + 13 * Math.cos(a) - h / 2);
}

/** Style-specific rear section from x0 along +x (about 26 long), centred on y = cy. */
function Tail({ bs, x0, cy, fill, stroke }: { bs: BackshellPart; x0: number; cy: number; fill: string; stroke: string }) {
  switch (bs.style) {
    case "strainRelief":
      // Tapered body into a two-bar cable clamp (saddle bars with screw heads).
      return (
        <g>
          <path d={`M${x0},${cy - 10} L${x0 + 12},${cy - 8} L${x0 + 12},${cy + 8} L${x0},${cy + 10}z`} fill={fill} stroke={stroke} strokeWidth={1} />
          <rect x={x0 + 12} y={cy - 7} width={12} height={14} fill={fill} stroke={stroke} strokeWidth={0.8} opacity={0.7} />
          <rect x={x0 + 11} y={cy - 12} width={14} height={4.5} rx={1} fill={fill} stroke={stroke} strokeWidth={1} />
          <rect x={x0 + 11} y={cy + 7.5} width={14} height={4.5} rx={1} fill={fill} stroke={stroke} strokeWidth={1} />
          <circle cx={x0 + 14.5} cy={cy - 9.75} r={1.3} fill={stroke} />
          <circle cx={x0 + 21.5} cy={cy - 9.75} r={1.3} fill={stroke} />
          <circle cx={x0 + 14.5} cy={cy + 9.75} r={1.3} fill={stroke} />
          <circle cx={x0 + 21.5} cy={cy + 9.75} r={1.3} fill={stroke} />
        </g>
      );
    case "emiBand":
      // Body into a knurled band-clamp platform with the band strap around it.
      return (
        <g>
          <rect x={x0} y={cy - 10} width={10} height={20} rx={1.5} fill={fill} stroke={stroke} strokeWidth={1} />
          <rect x={x0 + 10} y={cy - 8.5} width={15} height={17} rx={1} fill={fill} stroke={stroke} strokeWidth={1} />
          {[0, 3.5, 7, 10.5, 14].map((k) => (
            <line key={k} x1={x0 + 10 + k} y1={cy - 8.5} x2={x0 + 10 + Math.min(15, k + 3)} y2={cy + 8.5} stroke={stroke} strokeWidth={0.6} opacity={0.6} />
          ))}
          <rect x={x0 + 16} y={cy - 10} width={3.5} height={20} rx={0.8} fill={stroke} />
        </g>
      );
    case "shieldRing":
      // Straight body with a shield-termination ring flange.
      return (
        <g>
          <rect x={x0} y={cy - 10} width={16} height={20} rx={1.5} fill={fill} stroke={stroke} strokeWidth={1} />
          <rect x={x0 + 16} y={cy - 13} width={4} height={26} rx={1} fill={fill} stroke={stroke} strokeWidth={1.2} />
          <rect x={x0 + 20} y={cy - 7} width={6} height={14} rx={1} fill={fill} stroke={stroke} strokeWidth={1} />
        </g>
      );
    case "pottingBoot":
      // Adapter ring into a tapered, ribbed moulded boot.
      return (
        <g>
          <rect x={x0} y={cy - 10} width={5} height={20} rx={1} fill={fill} stroke={stroke} strokeWidth={1} />
          <path d={`M${x0 + 5},${cy - 11} C${x0 + 16},${cy - 11} ${x0 + 20},${cy - 6} ${x0 + 26},${cy - 5} L${x0 + 26},${cy + 5} C${x0 + 20},${cy + 6} ${x0 + 16},${cy + 11} ${x0 + 5},${cy + 11}z`} fill={fill} stroke={stroke} strokeWidth={1} />
          {[9, 13, 17].map((k) => (
            <line key={k} x1={x0 + k} y1={cy - 10 + k * 0.28} x2={x0 + k} y2={cy + 10 - k * 0.28} stroke={stroke} strokeWidth={0.6} opacity={0.6} />
          ))}
        </g>
      );
  }
}

/** The backshell in the glyph's local frame (see file comment). `theme` picks the metallic backshell tone. */
export function BackshellShape({ bs, fit: r, h, theme }: { bs: BackshellPart; fit: BackshellRef; h: number; theme: "dark" | "light" }) {
  const fill = semantic("backshell.fill", theme);
  const stroke = semantic("backshell.stroke", theme);
  const cy = h / 2;
  // Coupling nut that threads onto the connector's rear accessory thread (knurled).
  const nut = (
    <g>
      <rect x={REAR} y={cy - 15} width={8} height={30} rx={1.5} fill={fill} stroke={stroke} strokeWidth={1} />
      {[2, 4, 6].map((k) => (
        <line key={k} x1={REAR + k} y1={cy - 13} x2={REAR + k} y2={cy + 13} stroke={stroke} strokeWidth={0.6} opacity={0.55} />
      ))}
    </g>
  );
  const x0 = REAR + 8;
  if (!bs.angle) {
    return (
      <g>
        {nut}
        <Tail bs={bs} x0={x0} cy={cy} fill={fill} stroke={stroke} />
      </g>
    );
  }
  const bend = bendOf(r.clockingDeg);
  if (bend === "toward" || bend === "away") {
    // Bent toward/away from the viewer: straight silhouette, with a ⊙ (toward) or ⊗ (away) marker on the elbow.
    const mx = x0 + 8;
    return (
      <g>
        {nut}
        <Tail bs={bs} x0={x0} cy={cy} fill={fill} stroke={stroke} />
        <circle cx={mx} cy={cy} r={4.2} fill={semantic("bg.canvas", theme)} stroke={stroke} strokeWidth={1} />
        {bend === "toward" ? <circle cx={mx} cy={cy} r={1.4} fill={stroke} /> : <path d={`M${mx - 2.6},${cy - 2.6} L${mx + 2.6},${cy + 2.6} M${mx - 2.6},${cy + 2.6} L${mx + 2.6},${cy - 2.6}`} stroke={stroke} strokeWidth={1} />}
      </g>
    );
  }
  // Up or down: a short neck, a curved elbow about the bend centre, then the tail carried round the bend.
  const e = elbow(bs.angle, bend, x0 + 3, cy);
  return (
    <g>
      {nut}
      <rect x={x0} y={cy - 10} width={4} height={20} fill={fill} stroke={stroke} strokeWidth={1} />
      <g transform={e.transform}>
        <Tail bs={bs} x0={x0 + 3} cy={cy} fill={fill} stroke={stroke} />
      </g>
      <path d={e.path} fill={fill} stroke={stroke} strokeWidth={1} />
    </g>
  );
}
