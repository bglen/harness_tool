import { memo } from "react";
import { extentCoverage, formatDiameter, formatLength, resolveLabelTemplate, type CatalogIndex, type Derived, type Harness, type LengthUnit, type Point, type Severity } from "@hs/model";
import { semantic } from "@hs/ui-tokens";
import { bundleWidth, nodePos, type ZoomLevel } from "../lib/geometry";

interface Props {
  h: Harness;
  d: Derived;
  cat: CatalogIndex;
  level: ZoomLevel;
  theme: "dark" | "light";
  units: LengthUnit;
  selectedSegs: Set<string>;
  selectedNodes: Set<string>;
  selectedLabels: Set<string>;
  sev: Record<string, { severity: Severity }>;
  dimmed: boolean;
  shieldView: boolean;
  harnessPN: string;
  rev: string;
  k: number;
  flash: Set<string>;
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function Chip({ x, y, text, sub, hit, id, theme, sev }: { x: number; y: number; text: string; sub?: string; hit: string; id: string; theme: "dark" | "light"; sev?: Severity }) {
  const w = Math.max(38, text.length * 6.6 + (sub ? sub.length * 5.6 + 8 : 0) + 12);
  const col = sev === "error" ? "var(--status-error)" : sev === "warning" ? "var(--status-warning)" : undefined;
  return (
    <g data-hit={hit} data-id={id} style={{ cursor: "text" }}>
      <rect x={x - w / 2} y={y - 9} width={w} height={18} rx={4} fill={semantic("bg.surface-2", theme)} stroke={col ?? semantic("border.control", theme)} strokeWidth={col ? 1.4 : 0.8} strokeDasharray={col ? "3 2" : undefined} />
      <text className="mono" x={x - w / 2 + 6} y={y + 3.8} fontSize={10.5} fill={semantic("text.primary", theme)}>
        {text}
        {sub && (
          <tspan dx={6} fill={semantic("text.secondary", theme)} fontSize={9.5}>
            {sub}
          </tspan>
        )}
      </text>
    </g>
  );
}

export const BundleLayer = memo(function BundleLayer({ h, d, cat, level, theme, units, selectedSegs, selectedNodes, selectedLabels, sev, dimmed, shieldView, harnessPN, rev, k, flash }: Props) {
  const fill = semantic("bundle.fill", theme);
  const stroke = semantic("bundle.stroke", theme);
  const accent = semantic("accent", theme);
  const tp = semantic("text.primary", theme);
  const ts = semantic("text.secondary", theme);
  const labelFont = Math.max(8, 10 / Math.max(k, 0.6));
  return (
    <g opacity={dimmed ? 0.25 : 1}>
      <defs>
        <pattern id="braidHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={semantic("braid.hatch", theme)} strokeWidth="1" />
          <line x1="3" y1="0" x2="3" y2="6" stroke={semantic("braid.hatch", theme)} strokeWidth="0.4" />
        </pattern>
      </defs>
      {h.segments.map((s) => {
        const a = nodePos(h, s.a);
        const b = nodePos(h, s.b);
        const n = d.segWires.get(s.id)?.length ?? 0;
        const w = bundleWidth(n, level);
        const stack = d.segStack.get(s.id) ?? [];
        const selected = selectedSegs.has(s.id) || flash.has(s.id);
        const segSev = sev[s.id]?.severity;
        const m = lerp(a, b, 0.5);
        const od = d.segOuterOdMm.get(s.id) ?? 0;
        return (
          <g key={s.id}>
            {selected && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={accent} strokeWidth={w + 8} strokeLinecap="round" opacity={0.55} />}
            {segSev && segSev !== "info" && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={segSev === "error" ? "var(--status-error)" : "var(--status-warning)"} strokeWidth={w + 5} strokeDasharray="6 4" strokeLinecap="round" opacity={0.8} />}
            {/* jacket outline */}
            {stack.some((x) => x.layer.type === "jacket" || x.layer.type === "heatShrink" || x.layer.type === "conduit") && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ts} strokeWidth={w + 3} strokeLinecap="round" />}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={n ? fill : stroke} strokeWidth={n ? w : 3} strokeDasharray={n ? undefined : "4 4"} strokeLinecap="round" />
            {stack.map((la) => {
              const e = la.layer.extents.find((x) => x.segmentId === s.id)!;
              const [s0, s1] = extentCoverage(s, e);
              const p0 = lerp(a, b, s0 / s.lengthMm);
              const p1 = lerp(a, b, s1 / s.lengthMm);
              const ticks = la.partial ? (
                <g stroke={ts} strokeWidth={1.2}>
                  {[p0, p1].map((p, i) => {
                    const dx = b.x - a.x;
                    const dy = b.y - a.y;
                    const l = Math.hypot(dx, dy) || 1;
                    const nx = (-dy / l) * (w / 2 + 4);
                    const ny = (dx / l) * (w / 2 + 4);
                    return <line key={i} x1={p.x - nx} y1={p.y - ny} x2={p.x + nx} y2={p.y + ny} />;
                  })}
                </g>
              ) : null;
              if (la.layer.type === "overbraid")
                return (
                  <g key={la.layer.id} opacity={shieldView ? 1 : 0.9}>
                    <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="url(#braidHatch)" strokeWidth={w} strokeLinecap="butt" />
                    {shieldView && <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={accent} strokeWidth={1.2} strokeDasharray="1 3" />}
                    {ticks}
                  </g>
                );
              const tint = la.layer.type === "tape" ? "rgba(255,255,255,0.10)" : la.layer.type === "sleeve" ? "rgba(140,160,190,0.22)" : "rgba(0,0,0,0.12)";
              return (
                <g key={la.layer.id}>
                  <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={tint} strokeWidth={w} />
                  {ticks}
                </g>
              );
            })}
            {/* hit target */}
            <line data-hit="segment" data-id={s.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={Math.max(w, 14)} style={{ cursor: "copy" }}>
              <title>Bundle: drag from here to branch off a breakout (drop on a connector to route it there). Click to select, then drag an end handle to re-attach that end.</title>
            </line>
            {/* tie-downs */}
            {s.tieSpacingMm && level !== "overview" && Array.from({ length: Math.floor(s.lengthMm / s.tieSpacingMm) }, (_, i) => lerp(a, b, ((i + 1) * s.tieSpacingMm!) / s.lengthMm)).map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={1.6} fill={tp} />)}
            {h.hardware
              .filter((x) => x.segmentId === s.id)
              .map((x) => {
                const p = lerp(a, b, Math.min(1, x.positionMm / s.lengthMm));
                return (
                  <g key={x.id} data-hit="hardware" data-id={x.id}>
                    <title>{`${x.type === "cushionClamp" ? "Cushion clamp" : x.type === "spotTie" ? "Spot tie" : "Lacing"} ${x.pn} at ${formatLength(x.positionMm, units)}`}</title>
                    <rect x={p.x - 4} y={p.y - w / 2 - 6} width={8} height={w + 12} rx={2} fill="none" stroke={tp} strokeWidth={1.4} />
                  </g>
                );
              })}
            {/* chips */}
            {level !== "overview" ? (
              <>
                <Chip x={m.x} y={m.y - w / 2 - 14} text={formatLength(s.lengthMm, units)} sub={`${n}w`} hit="chip-length" id={s.id} theme={theme} sev={segSev} />
                {od > 0 && level === "detail" && <Chip x={m.x} y={m.y + w / 2 + 14} text={formatDiameter(od, units)} hit="chip-od" id={s.id} theme={theme} />}
              </>
            ) : (
              <Chip x={m.x} y={m.y - w / 2 - 14} text={`${n} · ${formatLength(s.lengthMm, units, { decimals: 0 })}`} hit="chip-length" id={s.id} theme={theme} />
            )}
          </g>
        );
      })}
      {/* band clamps: thin metallic ring near the node end */}
      {h.clamps.map((c) => {
        const t = h.terminations.find((x) => x.id === c.terminationId);
        const nodeId = t?.nodeId ?? c.nodeId;
        const seg = h.segments.find((s) => (s.a === nodeId || s.b === nodeId) && (!t || h.layers.find((l) => l.id === t.targetId)?.extents.some((e) => e.segmentId === s.id) !== false));
        if (!seg) return null;
        const a = nodePos(h, nodeId);
        const b = nodePos(h, seg.a === nodeId ? seg.b : seg.a);
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const w = bundleWidth(d.segWires.get(seg.id)?.length ?? 0, level);
        const out: JSX.Element[] = [];
        for (let i = 0; i < c.quantity; i++) {
          const p = lerp(a, b, Math.min(0.4, (10 + i * 5) / l));
          const nx = (-(b.y - a.y) / l) * (w / 2 + 3);
          const ny = ((b.x - a.x) / l) * (w / 2 + 3);
          out.push(<line key={i} x1={p.x - nx} y1={p.y - ny} x2={p.x + nx} y2={p.y + ny} stroke="#B9C0C9" strokeWidth={2.2} strokeLinecap="round" />);
        }
        return (
          <g key={c.id} data-hit="clamp" data-id={c.id}>
            <title>{`Band clamp ${c.pn || "(no size fits)"}${c.quantity > 1 ? " × 2" : ""}${c.auto ? " (auto)" : ""}`}</title>
            {out}
          </g>
        );
      })}
      {/* boots */}
      {h.boots.map((b) => {
        const p = nodePos(h, b.nodeId);
        const node = h.nodes.find((n) => n.id === b.nodeId);
        const seg = h.segments.find((s) => s.a === b.nodeId || s.b === b.nodeId);
        if (!seg || !node) return null;
        const o = nodePos(h, seg.a === b.nodeId ? seg.b : seg.a);
        const l = Math.hypot(o.x - p.x, o.y - p.y) || 1;
        const ux = (o.x - p.x) / l;
        const uy = (o.y - p.y) / l;
        const w = bundleWidth(d.segWires.get(seg.id)?.length ?? 0, level) / 2 + 3;
        const len = Math.min(26, l * 0.3);
        const pts = [
          [p.x - uy * (w + 4), p.y + ux * (w + 4)],
          [p.x + ux * len - uy * w, p.y + uy * len + ux * w],
          [p.x + ux * len + uy * w, p.y + uy * len - ux * w],
          [p.x + uy * (w + 4), p.y - ux * (w + 4)],
        ];
        return (
          <g key={b.id} data-hit="boot" data-id={b.id}>
            <title>{`${b.shape === "straight" || b.shape === "90" ? "Boot" : "Transition"} ${b.pn || "(no size fits)"}${b.auto ? " (auto)" : ""}`}</title>
            <polygon points={pts.map((q) => q.join(",")).join(" ")} fill={semantic("glyph.fill", theme)} stroke={ts} strokeWidth={1} opacity={0.9} />
          </g>
        );
      })}
      {/* breakout nodes */}
      {h.nodes
        .filter((n) => n.kind === "breakout")
        .map((n, i) => {
          const sel = selectedNodes.has(n.id);
          return (
            <g key={n.id} data-hit="node" data-id={n.id} style={{ cursor: "move" }}>
              <title>{`Breakout B${i + 1}: drag to move (lengths don't change); drop onto a connector, another breakout or a bundle to join them there`}</title>
              {sel && <circle cx={n.position.x} cy={n.position.y} r={11} fill="none" stroke={accent} strokeWidth={2} />}
              <circle cx={n.position.x} cy={n.position.y} r={7} fill={tp} stroke={semantic("bg.canvas", theme)} strokeWidth={2} />
              {level !== "overview" && (
                <text x={n.position.x + 10} y={n.position.y - 10} fontSize={10} fill={ts}>
                  B{i + 1}
                </text>
              )}
              {sev[n.id] && <circle cx={n.position.x + 8} cy={n.position.y - 8} r={3.5} fill={sev[n.id]!.severity === "error" ? "var(--status-error)" : "var(--status-warning)"} />}
            </g>
          );
        })}
      {/* splices: diamond near host node */}
      {h.splices.map((s) => {
        const p = nodePos(h, s.nodeId);
        const x = p.x + 16;
        const y = p.y + 16;
        return (
          <g key={s.id} data-hit="splice" data-id={s.id} style={{ cursor: "pointer" }}>
            <title>{`Splice ${s.label} ${s.pn || ""} (${s.type}, ${s.cover}) for ${h.nets.find((n) => n.id === s.netId)?.name ?? ""}`}</title>
            <rect x={x - 6} y={y - 6} width={12} height={12} transform={`rotate(45 ${x} ${y})`} fill={semantic("bg.surface-2", theme)} stroke={tp} strokeWidth={1.6} />
            {level !== "overview" && (
              <text x={x + 10} y={y + 4} fontSize={10} fill={ts}>
                {s.label}
              </text>
            )}
          </g>
        );
      })}
      {/* labels: tag icons at position */}
      {level !== "overview" &&
        h.labels.map((l) => {
          const t = l.attachedTo;
          let p: Point | null = null;
          if (t.kind === "connector") {
            const c = h.connectors.find((x) => x.id === t.id);
            const node = h.nodes.find((n) => n.connectorId === t.id);
            const seg = node && h.segments.find((s) => s.a === node.id || s.b === node.id);
            if (c && seg) {
              const a = c.position;
              const b = nodePos(h, seg.a === node!.id ? seg.b : seg.a);
              p = lerp(a, b, Math.min(0.45, l.distanceMm / seg.lengthMm));
            }
          } else if (t.kind === "segment") {
            const seg = h.segments.find((s) => s.id === t.id);
            if (seg) {
              const fromA = !t.nodeId || t.nodeId === seg.a;
              const a = nodePos(h, fromA ? seg.a : seg.b);
              const b = nodePos(h, fromA ? seg.b : seg.a);
              p = lerp(a, b, Math.min(0.9, l.distanceMm / seg.lengthMm));
            }
          }
          if (!p) return null;
          const c = t.kind === "connector" ? h.connectors.find((x) => x.id === t.id) : undefined;
          const text = resolveLabelTemplate(l.template, { refDes: c?.refDes, harnessPN, rev });
          const sel = selectedLabels.has(l.id);
          return (
            <g key={l.id} data-hit="label" data-id={l.id} transform={`translate(${p.x},${p.y - 16})`} style={{ cursor: "pointer" }}>
              <title>{`Label "${text}" ${l.pn}${l.auto ? " (auto)" : ""}`}</title>
              <path d="M-6,-5 h9 l4,5 l-4,5 h-9z" fill={sel ? accent : semantic("bg.surface-2", theme)} stroke={sev[l.id] ? "var(--status-warning)" : ts} strokeWidth={1} />
              {level === "detail" && (
                <text className="mono" x={8} y={3.5} fontSize={labelFont} fill={ts}>
                  {text.length > 22 ? text.slice(0, 21) + "…" : text}
                </text>
              )}
            </g>
          );
        })}
    </g>
  );
});

export { lerp };

/**
 * End handles on selected bundles, drawn above connectors and wires so they're always grabbable:
 * drag one onto a connector, breakout or another bundle to re-attach that end.
 */
export function SegmentHandles({ h, selected, k, theme }: { h: Harness; selected: Set<string>; k: number; theme: "dark" | "light" }) {
  const accent = semantic("accent", theme);
  const kk = Math.max(k, 0.6);
  return (
    <g>
      {h.segments
        .filter((s) => selected.has(s.id))
        .flatMap((s) => {
          const a = nodePos(h, s.a);
          const b = nodePos(h, s.b);
          return (["a", "b"] as const).map((end) => {
            const from = end === "a" ? a : b;
            const to = end === "a" ? b : a;
            const L = Math.hypot(to.x - from.x, to.y - from.y) || 1;
            // Clear of the pin fan at connector ends (fan ≈ 72 canvas px), and never past the middle.
            const off = Math.min(L * 0.35, Math.max(48, 30 / kk));
            const p = { x: from.x + ((to.x - from.x) / L) * off, y: from.y + ((to.y - from.y) / L) * off };
            return (
              <g key={`${s.id}:${end}`} data-hit="seg-end" data-id={`${s.id}:${end}`} style={{ cursor: "grab" }} role="button" aria-label={`Bundle end ${end.toUpperCase()}: drag to re-attach`}>
                <title>Drag this end onto a connector, breakout or another bundle to re-attach it (lengths stay the same)</title>
                <circle cx={p.x} cy={p.y} r={11 / kk} fill="transparent" />
                <circle cx={p.x} cy={p.y} r={6 / kk} fill={semantic("bg.surface-2", theme)} stroke={accent} strokeWidth={2.2 / kk} />
              </g>
            );
          });
        })}
    </g>
  );
}
