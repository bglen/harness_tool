import { memo } from "react";
import { spliceGeometry, type Harness, type Severity } from "@hs/model";
import { semantic } from "@hs/ui-tokens";
import type { ConnLayout, ZoomLevel } from "../lib/geometry";

/**
 * Schematic splices: a body with one port per crimp barrel. Drag the body to move it; drag a pin onto a port to wire
 * it into that barrel. The bundle layout keeps the small diamond marker at the splice's bundle node.
 */
export const SpliceSymbols = memo(function SpliceSymbols({ h, layouts, level, theme, selected, sev }: { h: Harness; layouts: Map<string, ConnLayout>; level: ZoomLevel; theme: "dark" | "light"; selected: Set<string>; sev: Record<string, { severity: Severity }> }) {
  if (level === "overview") return null;
  const tp = semantic("text.primary", theme);
  const ts = semantic("text.secondary", theme);
  const accent = semantic("accent", theme);
  return (
    <g>
      {h.splices.map((s) => {
        const g = spliceGeometry(h, s, layouts);
        const { box } = g;
        const sv = sev[s.id]?.severity;
        const kind = s.barrels === 1 ? "single-ended" : `${s.barrels} barrels`;
        return (
          <g key={s.id}>
            <g data-hit="splice" data-id={s.id} style={{ cursor: "move" }}>
              <title>{`Splice ${s.label}: ${s.pn || "no part selected"} (${s.type}, ${kind}${s.buildUp.length ? ", CMA build-up" : ""}). Drag to move; drop a pin on a port to wire it in; click for part and CMA.`}</title>
              {selected.has(s.id) && <rect x={box.x - 4} y={box.y - 4} width={box.w + 8} height={box.h + 8} rx={6} fill="none" stroke={accent} strokeWidth={2} />}
              <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={4} fill={semantic("bg.surface-2", theme)} stroke={sv === "error" ? "var(--status-error)" : sv === "warning" ? "var(--status-warning)" : tp} strokeWidth={1.4} />
              {/* crimp-band ticks */}
              <line x1={g.center.x - 4} x2={g.center.x - 4} y1={box.y + 3} y2={box.y + box.h - 3} stroke={ts} strokeWidth={0.8} />
              <line x1={g.center.x + 4} x2={g.center.x + 4} y1={box.y + 3} y2={box.y + box.h - 3} stroke={ts} strokeWidth={0.8} />
              <text x={g.center.x} y={box.y - 5} fontSize={10} fontWeight={600} textAnchor="middle" fill={tp}>
                {s.label}
              </text>
              {level === "detail" && (
                <text className="mono" x={g.center.x} y={box.y + box.h + 10} fontSize={8} textAnchor="middle" fill={ts}>
                  {s.pn || "no part"}
                  {s.buildUp.length ? " · +CMA" : ""}
                </text>
              )}
              {level !== "detail" && s.buildUp.length > 0 && (
                <text x={g.center.x} y={box.y + box.h + 10} fontSize={8} textAnchor="middle" fill={ts}>
                  +CMA
                </text>
              )}
            </g>
            {g.ports.map((pt) => (
              <g key={pt.barrel} data-hit="splice-port" data-id={`${s.id}:${pt.barrel}`} style={{ cursor: "crosshair" }}>
                <title>{`${s.label} barrel ${pt.barrel + 1}: drop a pin here to wire it in`}</title>
                <line x1={pt.p.x - pt.dir * 8} y1={pt.p.y} x2={pt.p.x} y2={pt.p.y} stroke={tp} strokeWidth={1.2} />
                <circle cx={pt.p.x} cy={pt.p.y} r={6} fill="transparent" />
                <circle cx={pt.p.x} cy={pt.p.y} r={2.6} fill={tp} />
                {s.barrels > 1 && (
                  <text x={pt.p.x - pt.dir * 3} y={pt.p.y - 4} fontSize={7} textAnchor={pt.dir === 1 ? "end" : "start"} fill={ts}>
                    {pt.barrel + 1}
                  </text>
                )}
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
});
