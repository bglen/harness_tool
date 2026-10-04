import { memo, useMemo } from "react";
import { colorAbbr, describeWireColor, ratsnest, type Derived, type Harness, type Point, type Severity, type Wire, type WireEnd } from "@hs/model";
import { needsCasing, semantic, wireColor } from "@hs/ui-tokens";
import { LANE, laneMap, nodePos, wirePath, wireTrunk, type ConnLayout, type ZoomLevel } from "../lib/geometry";
import { connectorPairs, roundedPath, splicePoint } from "@hs/model";
import type { CanvasMode } from "../store/ui";

interface Props {
  h: Harness;
  d: Derived;
  layouts: Map<string, ConnLayout>;
  level: ZoomLevel;
  theme: "dark" | "light";
  selected: Set<string>;
  hoverId: string | null;
  sev: Record<string, { severity: Severity }>;
  focusNetId: string | null;
  shieldView: boolean;
  colorLabels: "detail" | "always" | "hover";
  k: number;
  flash: Set<string>;
  /** Schematic: every wire pin-to-pin. Bundle layout: wires hidden except ones no bundle carries yet (all of them in shield view). */
  mode: CanvasMode;
  /** Schematic polylines per wire (computed by the canvas, which also drags them); null outside the schematic. */
  schRoutes: Map<string, Point[]> | null;
}

interface WireGeom {
  w: Wire;
  path: string;
  start: Point | null;
  end: Point | null;
  trunk: Point[];
  unrouted: boolean;
}

function endPoint(e: WireEnd, layouts: Map<string, ConnLayout>, h: Harness): { p: Point; dir: number } | null {
  if (e.kind !== "pin") return null;
  const L = layouts.get(e.connectorId);
  if (!L) return null;
  const r = L.rowByCavity.get(e.cavityId);
  if (!r) return { p: L.anchor, dir: L.facing };
  void h;
  return { p: { x: L.attachX, y: r.y }, dir: L.facing };
}

function pointAlong(pts: Point[], dist: number, fromEnd = false): { p: Point; ux: number; uy: number } | null {
  const P = fromEnd ? [...pts].reverse() : pts;
  let left = dist;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1]!;
    const b = P[i]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l >= left || i === P.length - 1) {
      const t = l ? Math.min(1, left / l) : 0;
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ux: l ? (b.x - a.x) / l : 1, uy: l ? (b.y - a.y) / l : 0 };
    }
    left -= l;
  }
  return null;
}

/** One wire. Primitive props so unchanged wires skip re-render on unrelated edits. True insulation color; state via halos only (§16.4). */
const WireView = memo(function WireView({ id, path, unrouted, base, stripes, title, theme, sw, opacity, selected, hover, severity }: { id: string; path: string; unrouted: boolean; base: number; stripes: string; title: string; theme: "dark" | "light"; sw: number; opacity: number; selected: boolean; hover: boolean; severity?: Severity }) {
  const col = wireColor(base, theme);
  const casing = needsCasing(col, semantic("bg.canvas", theme));
  const accent = semantic("accent", theme);
  const st = stripes ? stripes.split(",").map(Number) : [];
  return (
    <g opacity={opacity} data-hit="wire" data-id={id} style={{ cursor: "pointer" }}>
      <title>{title}</title>
      <path d={path} stroke="transparent" strokeWidth={8} fill="none" />
      {selected && <path d={path} stroke={accent} strokeWidth={sw + 4.5} fill="none" opacity={0.7} strokeLinecap="round" />}
      {!selected && hover && <path d={path} stroke={accent} strokeWidth={sw + 2} fill="none" strokeLinecap="round" />}
      {casing && <path d={path} stroke={semantic("wire.casing", theme)} strokeWidth={sw + 1.1} fill="none" strokeLinecap="round" />}
      <path d={path} stroke={col} strokeWidth={selected ? sw + 0.5 : sw} fill="none" strokeLinecap="round" strokeDasharray={unrouted ? "4 3" : undefined} />
      {st.map((sc, i) => (
        <path key={i} d={path} stroke={wireColor(sc, theme)} strokeWidth={Math.max(0.8, sw * 0.6)} fill="none" strokeDasharray={`2.4 ${6 + st.length * 2.4}`} strokeDashoffset={-i * 3.2} />
      ))}
    </g>
  );
});

export const WireLayer = memo(function WireLayer({ h, d, layouts, level, theme, selected, hoverId, sev, focusNetId, shieldView, colorLabels, k, flash, mode, schRoutes }: Props) {
  const schematic = mode === "schematic";
  const lanes = useMemo(() => (schematic ? new Map<string, Map<string, number>>() : laneMap(h, d)), [schematic, h, d]);
  const routes = schRoutes;
  const gap = level === "detail" ? LANE : LANE * 0.75;
  const canvasBg = semantic("bg.canvas", theme);
  const accent = semantic("accent", theme);
  const geoms: WireGeom[] = useMemo(() => {
    if (level === "overview") return [];
    if (routes)
      return h.wires.flatMap((w) => {
        const pts = routes.get(w.id);
        if (!pts) return [];
        return [{ w, path: roundedPath(pts), start: endPoint(w.from, layouts, h)?.p ?? null, end: endPoint(w.to, layouts, h)?.p ?? null, trunk: pts, unrouted: false }];
      });
    const all = h.wires.map((w) => {
      const s = endPoint(w.from, layouts, h);
      const e = endPoint(w.to, layouts, h);
      const trunk = wireTrunk(h, d, lanes, w.id, gap);
      if (!trunk.length) {
        const a = s?.p ?? nodePos(h, h.splices.find((x) => w.from.kind === "splice" && x.id === w.from.spliceId)?.nodeId ?? "");
        const b = e?.p ?? nodePos(h, h.splices.find((x) => w.to.kind === "splice" && x.id === w.to.spliceId)?.nodeId ?? "");
        return { w, path: `M${a.x},${a.y} L${b.x},${b.y}`, start: s?.p ?? null, end: e?.p ?? null, trunk: [a, b], unrouted: true };
      }
      return { w, path: wirePath(s, trunk, e), start: s?.p ?? null, end: e?.p ?? null, trunk, unrouted: false };
    });
    // Bundle layout: bundles stand in for their wires; only wires with no bundle to ride in stay visible (dashed).
    return shieldView ? all : all.filter((g) => g.unrouted);
  }, [h, d, layouts, lanes, gap, level, routes, shieldView]);
  /** Twist marks, shield rings and drains need the individual wires drawn. */
  const showDetail = schematic || shieldView;

  const rats = useMemo(() => (schematic ? ratsnest(h) : []), [schematic, h]);
  const pairs = useMemo(() => (schematic && level === "overview" ? connectorPairs(h) : []), [schematic, level, h]);
  const netNames = useMemo(() => new Map(h.nets.map((n) => [n.id, n.name])), [h.nets]);
  const sw = level === "detail" ? 1.7 : 1.25;
  const netDim = (w: Wire) => (focusNetId && w.netId !== focusNetId ? 0.18 : shieldView && !w.shieldId && !w.cableId ? 0.15 : 1);

  return (
    <g>
      {/* zoomed-out schematic: one line per connected pair of connectors */}
      {pairs.map(({ a, b, count }) => {
        const La = layouts.get(a);
        const Lb = layouts.get(b);
        if (!La || !Lb) return null;
        const pa = { x: La.attachX, y: La.anchor.y };
        const pb = { x: Lb.attachX, y: Lb.anchor.y };
        const mx = (pa.x + pb.x) / 2;
        return (
          <g key={`${a}|${b}`} pointerEvents="none">
            <path d={roundedPath([pa, { x: mx, y: pa.y }, { x: mx, y: pb.y }, pb], 10)} stroke={semantic("text.secondary", theme)} strokeWidth={Math.min(8, 1.5 + Math.log2(1 + count))} fill="none" opacity={0.7} />
            <text x={mx + 8} y={(pa.y + pb.y) / 2 - 6} fontSize={22} fill={semantic("text.secondary", theme)}>
              {count} wire{count === 1 ? "" : "s"}
            </text>
          </g>
        );
      })}
      {geoms.map(({ w, path, unrouted }) => {
        const netName = netNames.get(w.netId) ?? "";
        return (
          <WireView
            key={w.id}
            id={w.id}
            path={path}
            unrouted={unrouted}
            base={w.color.base}
            stripes={w.color.stripes.join(",")}
            title={`Wire ${w.label}, net ${netName}, ${w.gauge} AWG ${w.spec}, ${describeWireColor(w.color)} (${[w.color.base, ...w.color.stripes].join("-")})${unrouted ? ". Not carried by any bundle yet: add or re-attach a bundle between its ends." : ""}`}
            theme={theme}
            sw={sw}
            opacity={netDim(w)}
            selected={selected.has(w.id) || flash.has(w.id)}
            hover={hoverId === w.id}
            severity={sev[w.id]?.severity}
          />
        );
      })}
      {/* twist marks near both ends of each twisted group */}
      {level !== "overview" &&
        showDetail &&
        h.twistGroups.map((g) => {
          const members = geoms.filter((x) => g.wireIds.includes(x.w.id) && !x.unrouted);
          if (members.length < 2) return null;
          const marks: JSX.Element[] = [];
          for (const fromEnd of [false, true]) {
            const pts = members.map((m) => pointAlong(m.trunk, 22, fromEnd)).filter(Boolean) as { p: Point; ux: number; uy: number }[];
            if (pts.length < 2) continue;
            const c = { x: pts.reduce((a, q) => a + q.p.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.p.y, 0) / pts.length };
            const { ux, uy } = pts[0]!;
            const half = Math.max(3, (members.length * gap) / 2 + 1.5);
            const nx = -uy;
            const ny = ux;
            const d1 = `M${c.x - ux * 5 + nx * half},${c.y - uy * 5 + ny * half} L${c.x + ux * 5 - nx * half},${c.y + uy * 5 - ny * half}`;
            const d2 = `M${c.x - ux * 5 - nx * half},${c.y - uy * 5 - ny * half} L${c.x + ux * 5 + nx * half},${c.y + uy * 5 + ny * half}`;
            marks.push(<path key={`${fromEnd}`} d={`${d1} ${d2}`} stroke={semantic("text.primary", theme)} strokeWidth={1.1} fill="none" />);
          }
          return (
            <g key={g.id} opacity={focusNetId ? 0.3 : 1}>
              <title>Twisted {members.length === 2 ? "pair" : members.length === 3 ? "triple" : "group"}</title>
              {marks}
            </g>
          );
        })}
      {/* shields: ellipse around member wires near each end; drain line */}
      {level !== "overview" &&
        showDetail &&
        h.shields.map((s) => {
          const members = geoms.filter((x) => s.wireIds.includes(x.w.id) && !x.unrouted);
          if (!members.length) return null;
          const out: JSX.Element[] = [];
          const terms = h.terminations.filter((t) => t.targetId === s.id);
          for (const fromEnd of [false, true]) {
            const pts = members.map((m) => pointAlong(m.trunk, 40, fromEnd)).filter(Boolean) as { p: Point; ux: number; uy: number }[];
            if (!pts.length) continue;
            const c = { x: pts.reduce((a, q) => a + q.p.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.p.y, 0) / pts.length };
            const ang = (Math.atan2(pts[0]!.uy, pts[0]!.ux) * 180) / Math.PI;
            const ry = Math.max(4, (members.length * gap) / 2 + 3);
            out.push(<ellipse key={`e${fromEnd}`} cx={c.x} cy={c.y} rx={4} ry={ry} transform={`rotate(${ang} ${c.x} ${c.y})`} fill="none" stroke={semantic("text.primary", theme)} strokeWidth={1.2} />);
            // drain
            const endNode = fromEnd ? members[0]!.trunk[members[0]!.trunk.length - 1] : members[0]!.trunk[0];
            const term = terms.find((t) => {
              const np = nodePos(h, t.nodeId);
              return endNode && Math.hypot(np.x - endNode.x, np.y - endNode.y) < 40;
            });
            if (term?.method === "drainToPin" && term.drainPin) {
              const L = layouts.get(term.drainPin.connectorId);
              const r = L?.rowByCavity.get(term.drainPin.cavityId);
              if (L && r) out.push(<path key={`d${fromEnd}`} d={`M${c.x},${c.y + ry} Q${c.x},${r.y} ${L.attachX},${r.y}`} stroke={semantic("text.secondary", theme)} strokeWidth={1} strokeDasharray="2 2" fill="none" />);
            }
          }
          return (
            <g key={s.id} data-hit="shield" data-id={s.id} opacity={focusNetId ? 0.3 : 1}>
              <title>{`Shield ${s.label} (${s.material}, ${s.coverage}%)`}</title>
              {shieldView && members[0] && <path d={members[0].path} stroke={accent} strokeWidth={members.length * gap + 6} opacity={0.18} fill="none" />}
              {out}
            </g>
          );
        })}
      {/* shield view: termination markers by type */}
      {shieldView &&
        h.terminations.map((t) => {
          const p = nodePos(h, t.nodeId);
          const isBraid = h.layers.some((l) => l.id === t.targetId);
          const off = isBraid ? 0 : 14;
          const x = p.x;
          const y = p.y + off;
          const col = semantic("text.primary", theme);
          const label = { band360: "360° band clamp", emiRing: "EMI ring", drainToPin: "Drain to pin", floating: "Floating", foldBack: "Folded back", junction: "Braid junction" }[t.method];
          return (
            <g key={t.id}>
              <title>{`${isBraid ? "Overbraid" : "Shield"} termination: ${label}`}</title>
              {t.method === "band360" || t.method === "emiRing" ? (
                <>
                  <circle cx={x} cy={y} r={7} fill="none" stroke={accent} strokeWidth={2.5} />
                  <circle cx={x} cy={y} r={2.5} fill={accent} />
                </>
              ) : t.method === "drainToPin" ? (
                <path d={`M${x - 6},${y} h12 M${x},${y - 6} v12`} stroke={accent} strokeWidth={2.2} />
              ) : t.method === "junction" ? (
                <rect x={x - 5} y={y - 5} width={10} height={10} transform={`rotate(45 ${x} ${y})`} fill={accent} />
              ) : (
                <>
                  <circle cx={x} cy={y} r={6} fill="none" stroke="var(--status-warning)" strokeWidth={1.8} />
                  <path d={`M${x - 4},${y + 4} L${x + 4},${y - 4}`} stroke="var(--status-warning)" strokeWidth={1.8} />
                </>
              )}
              <text x={x + 10} y={y + 4} fontSize={9.5 / Math.max(0.7, k)} fill={col}>
                {label}
              </text>
            </g>
          );
        })}
      {/* color code labels (§16.5) */}
      {geoms.map(({ w, start, end }) => {
        const show = colorLabels === "always" || (colorLabels === "detail" && level === "detail") || (colorLabels === "hover" && hoverId === w.id);
        if (!show || level === "overview" || !schematic) return null;
        const text = [w.color.base, ...w.color.stripes].join("-") + (level === "detail" ? ` ${[w.color.base, ...w.color.stripes].map(colorAbbr).join("/")}` : "");
        const fs = Math.max(7, 8.5 / Math.max(0.8, k));
        return (
          <g key={`cl-${w.id}`} opacity={netDim(w)} pointerEvents="none">
            {[start, end].map((p, i) => {
              if (!p) return null;
              const e = i === 0 ? w.from : w.to;
              const dir = e.kind === "pin" ? layouts.get(e.connectorId)?.facing ?? 1 : 1;
              return (
                <text key={i} className="mono" x={p.x + dir * 8} y={p.y - 2.5} fontSize={fs} textAnchor={dir === 1 ? "start" : "end"} fill={semantic("text.secondary", theme)}>
                  {text}
                </text>
              );
            })}
          </g>
        );
      })}
      {/* ratsnest (same net, no wire yet) */}
      {rats.map((r, i) => {
        const a = endPoint(r.a, layouts, h)?.p ?? (r.a.kind === "splice" ? splicePoint(h, r.a.spliceId) : null);
        const b = endPoint(r.b, layouts, h)?.p ?? (r.b.kind === "splice" ? splicePoint(h, r.b.spliceId) : null);
        if (!a || !b) return null;
        return (
          <g key={i} data-hit="ratsnest" data-id={r.netId} style={{ cursor: "pointer" }}>
            <title>Unrouted connection (ratsnest): double-click or press R to commit into a wire</title>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={8} />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={semantic("text.secondary", theme)} strokeWidth={1} strokeDasharray="5 4" />
          </g>
        );
      })}
    </g>
  );
});
