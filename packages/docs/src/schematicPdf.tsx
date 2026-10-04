import { G, Path, Polygon, Rect, Svg, Text as SText } from "@react-pdf/renderer";
import { gridCardTop, roundedPath, SCH_GRID, schematicRoutes, snapToGrid, spliceGeometry, type ConnectorInstance, type Point, type SchematicCard } from "@hs/model";
import type { DocData } from "./data";
import { C } from "./common";

// Same card proportions and grid as the canvas pin cards, so the drawing reads like the schematic on screen.
const W = 236;
const HEADER = 46;
const ROW = SCH_GRID;
const FAN = 4 * SCH_GRID;

interface Card extends SchematicCard {
  c: ConnectorInstance;
  x: number;
  w: number;
  rows: { cavityId: string; y: number; signal: string }[];
}

/** Stripe i of n as a dash pattern (phase folded into a leading zero-length dash; react-pdf has no dash offset). */
const stripeDash = (i: number, n: number) => {
  const period = 8.4 + n * 2.4;
  const o = i * 3.2;
  return `0 ${o} 2.4 ${period - o - 2.4}`;
};

/** Light insulation colors need a dark outline to show on white paper. */
const LIGHT = new Set([4, 9]);

/** The pin-to-pin schematic (right-angle wire runs, used pins only) for a template's schematic block. */
export function SchematicDiagram({ data, width, height }: { data: DocData; width: number; height: number }) {
  const h = data.rev.harness;
  const cards = new Map<string, Card>();
  for (const c of h.connectors) {
    const part = data.cat.connector(c.pn);
    const r = ((c.rotation % 360) + 360) % 360;
    const facing: 1 | -1 = r > 90 && r < 270 ? -1 : 1;
    const wired = new Set(h.wires.flatMap((w) => [w.from, w.to]).filter((e) => e.kind === "pin" && e.connectorId === c.id).map((e) => (e.kind === "pin" ? e.cavityId : "")));
    const cavs = (part?.arrangement.cavities.map((x) => x.id) ?? Object.keys(c.pins)).filter((id) => c.pins[id]?.netId || wired.has(id));
    const hh = HEADER + Math.max(1, cavs.length) * ROW + 6;
    const ax = snapToGrid(c.position.x);
    const x = facing === 1 ? ax - FAN - W : ax + FAN;
    const top = gridCardTop(snapToGrid(c.position.y), hh, HEADER, ROW);
    const rows = cavs.map((id, i) => ({ cavityId: id, y: top + HEADER + i * ROW + ROW / 2, signal: h.nets.find((n) => n.id === c.pins[id]?.netId)?.name ?? "" }));
    cards.set(c.id, { c, x, w: W, facing, attachX: facing === 1 ? x + W : x, card: { x, y: top, w: W, h: hh }, rows, rowByCavity: new Map(rows.map((r) => [r.cavityId, r])) });
  }
  const routes = schematicRoutes(h, cards);
  const pts: Point[] = [];
  for (const k of cards.values()) pts.push({ x: k.x, y: k.card.y }, { x: k.x + k.w, y: k.card.y + k.card.h });
  for (const r of routes.values()) pts.push(...r);
  if (!pts.length) return <Svg width={width} height={height} />;
  const x0 = Math.min(...pts.map((p) => p.x)) - 20;
  const y0 = Math.min(...pts.map((p) => p.y)) - 20;
  const vw = Math.max(...pts.map((p) => p.x)) + 20 - x0;
  const vh = Math.max(...pts.map((p) => p.y)) + 20 - y0;
  return (
    <Svg width={width} height={height} viewBox={`${x0} ${y0} ${vw} ${vh}`}>
      {h.wires.map((w) => {
        const r = routes.get(w.id);
        if (!r) return null;
        const d = roundedPath(r);
        const col = data.printWire(w.color.base);
        return (
          <G key={w.id}>
            {LIGHT.has(w.color.base) && <Path d={d} stroke={C.text2} strokeWidth={2.6} fill="none" />}
            <Path d={d} stroke={col} strokeWidth={1.8} fill="none" />
            {w.color.stripes.map((sc, i) => (
              <Path key={i} d={d} stroke={data.printWire(sc)} strokeWidth={1.1} fill="none" strokeDasharray={stripeDash(i, w.color.stripes.length)} />
            ))}
          </G>
        );
      })}
      {h.splices.map((sp) => {
        // Same symbol as the canvas: a body with one port per crimp barrel.
        const g = spliceGeometry(h, sp, cards);
        return (
          <G key={sp.id}>
            {g.ports.map((pt) => (
              <Path key={pt.barrel} d={`M${pt.p.x - pt.dir * 8},${pt.p.y} L${pt.p.x},${pt.p.y}`} stroke={C.text} strokeWidth={1.2} />
            ))}
            <Rect x={g.box.x} y={g.box.y} width={g.box.w} height={g.box.h} rx={3} fill="#FFFFFF" stroke={C.text} strokeWidth={1.2} />
            <SText x={g.center.x - 7} y={g.box.y - 4} style={{ fontSize: 8 }} fill={C.text}>
              {sp.label}
            </SText>
            <SText x={g.box.x} y={g.box.y + g.box.h + 9} style={{ fontSize: 6.5 }} fill={C.text2}>
              {sp.pn}
            </SText>
          </G>
        );
      })}
      {[...cards.values()].map((k) => (
        <G key={k.c.id}>
          <Rect x={k.x} y={k.card.y} width={k.w} height={k.card.h} fill="#FFFFFF" stroke={C.text} strokeWidth={1.2} />
          <SText x={k.x + 8} y={k.card.y + 18} style={{ fontSize: 14, fontWeight: 600 }} fill={C.text}>
            {k.c.refDes}
          </SText>
          <SText x={k.x + 8} y={k.card.y + 34} style={{ fontSize: 9 }} fill={C.text2}>
            {k.c.pn}
          </SText>
          <Path d={`M${k.x},${k.card.y + HEADER - 4} H${k.x + k.w}`} stroke={C.border} strokeWidth={0.8} />
          {k.rows.map((r) => (
            <G key={r.cavityId}>
              <SText x={k.facing === 1 ? k.x + 8 : k.x + k.w - 8} y={r.y + 3.5} style={{ fontSize: 9 }} textAnchor={k.facing === 1 ? "start" : "end"} fill={C.text3}>
                {r.cavityId}
              </SText>
              <SText x={k.facing === 1 ? k.x + 40 : k.x + k.w - 40} y={r.y + 3.5} style={{ fontSize: 9.5 }} textAnchor={k.facing === 1 ? "start" : "end"} fill={C.text}>
                {r.signal.length > 20 ? r.signal.slice(0, 19) + "…" : r.signal}
              </SText>
            </G>
          ))}
        </G>
      ))}
    </Svg>
  );
}
