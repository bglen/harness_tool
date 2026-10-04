import type { Point } from "@hs/model";
import { semantic } from "@hs/ui-tokens";

/**
 * Edit handles on the selected schematic wire, ECAD style: drag a segment to move it (horizontal segments move up and
 * down, vertical ones sideways); drag an end square onto another pin or splice barrel to reconnect that end.
 */
export function WireHandles({ id, pts, theme, k }: { id: string; pts: Point[]; theme: "dark" | "light"; k: number }) {
  const accent = semantic("accent", theme);
  const s = 4.5 / Math.max(0.6, k);
  return (
    <g>
      {pts.slice(1).map((b, i) => {
        const a = pts[i]!;
        const horizontal = a.y === b.y;
        const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
        if (len < 1) return null;
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        return (
          <g key={i} data-hit="wire-seg" data-id={`${id}:${i}`} style={{ cursor: horizontal ? "ns-resize" : "ew-resize" }}>
            <title>Drag to move this segment</title>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={10 / Math.max(0.6, k)} />
            {len > 14 && <rect x={m.x - (horizontal ? s * 1.6 : s * 0.7)} y={m.y - (horizontal ? s * 0.7 : s * 1.6)} width={horizontal ? s * 3.2 : s * 1.4} height={horizontal ? s * 1.4 : s * 3.2} rx={1} fill={accent} />}
          </g>
        );
      })}
      {(["from", "to"] as const).map((end) => {
        const p = end === "from" ? pts[0]! : pts[pts.length - 1]!;
        return (
          <g key={end} data-hit="wire-end" data-id={`${id}:${end}`} style={{ cursor: "grab" }}>
            <title>Drag onto another pin or splice barrel to reconnect this end</title>
            <rect x={p.x - s} y={p.y - s} width={s * 2} height={s * 2} fill="white" stroke={accent} strokeWidth={1.5 / Math.max(0.6, k)} />
          </g>
        );
      })}
    </g>
  );
}
