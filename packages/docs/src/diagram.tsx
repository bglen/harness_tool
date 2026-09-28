import { Circle, G, Line, Path, Polygon, Rect, Svg, Text as SText } from "@react-pdf/renderer";
import type { Arrangement, ConnectorInstance, Harness } from "@hs/model";
import type { DocData } from "./data";
import { C, fmtLen } from "./common";

/** Vector harness diagram from the canvas geometry, cleaned (no grid, no badges) (§13.1). */
export function HarnessDiagram({ data, width, height, showLengths = true }: { data: DocData; width: number; height: number; showLengths?: boolean }) {
  const h = data.rev.harness;
  const pos = (nid: string) => {
    const n = h.nodes.find((x) => x.id === nid)!;
    return n.kind === "connector" ? h.connectors.find((c) => c.id === n.connectorId)!.position : n.position;
  };
  const facing = (c: ConnectorInstance) => {
    const r = ((c.rotation % 360) + 360) % 360;
    return r > 90 && r < 270 ? -1 : 1;
  };
  const BOX_W = 150;
  const BOX_H = 44;
  const pts: { x: number; y: number }[] = [];
  for (const c of h.connectors) {
    const f = facing(c);
    pts.push({ x: c.position.x - (f === 1 ? BOX_W + 30 : -30), y: c.position.y - BOX_H }, { x: c.position.x + (f === 1 ? 10 : BOX_W + 30), y: c.position.y + BOX_H });
  }
  for (const n of h.nodes) pts.push(n.position);
  if (!pts.length) return <Svg width={width} height={height} />;
  const x0 = Math.min(...pts.map((p) => p.x)) - 30;
  const y0 = Math.min(...pts.map((p) => p.y)) - 40;
  const x1 = Math.max(...pts.map((p) => p.x)) + 30;
  const y1 = Math.max(...pts.map((p) => p.y)) + 40;
  const vw = x1 - x0;
  const vh = y1 - y0;
  const u = data.project.units;
  return (
    <Svg width={width} height={height} viewBox={`${x0} ${y0} ${vw} ${vh}`}>
      {h.segments.map((sg) => {
        const a = pos(sg.a);
        const b = pos(sg.b);
        const n = data.d.segWires.get(sg.id)?.length ?? 0;
        const w = 3 + 2.4 * Math.log2(1 + n);
        const braid = (data.d.segStack.get(sg.id) ?? []).some((x) => x.layer.type === "overbraid");
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <G key={sg.id}>
            <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={braid ? "#8A919C" : "#AEB4BD"} strokeWidth={w} strokeLinecap="round" />
            {braid && <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#FFFFFF" strokeWidth={0.8} strokeDasharray="3 3" />}
            {showLengths && (
              <G>
                <Rect x={mx - 48} y={my - w / 2 - 20} width={96} height={14} fill="#FFFFFF" stroke={C.border} strokeWidth={0.6} />
                <SText x={mx} y={my - w / 2 - 10} style={{ fontSize: 9 }} textAnchor="middle" fill={C.text}>
                  {`${fmtLen(sg.lengthMm, u)} ±${fmtLen(sg.toleranceMm, u, u === "in" ? 2 : 0)}`}
                </SText>
                <SText x={mx} y={my + w / 2 + 11} style={{ fontSize: 7.5 }} textAnchor="middle" fill={C.text3}>
                  {`${n} wires${sg.label ? " · " + sg.label : ""}`}
                </SText>
              </G>
            )}
          </G>
        );
      })}
      {h.nodes
        .filter((n) => n.kind === "breakout")
        .map((n, i) => (
          <G key={n.id}>
            <Circle cx={n.position.x} cy={n.position.y} r={5} fill={C.text} />
            <SText x={n.position.x + 8} y={n.position.y - 8} style={{ fontSize: 8 }} fill={C.text2}>{`B${i + 1}`}</SText>
          </G>
        ))}
      {h.splices.map((sp) => {
        const p = pos(sp.nodeId);
        return (
          <G key={sp.id}>
            <Polygon points={`${p.x + 14},${p.y + 6} ${p.x + 20},${p.y + 12} ${p.x + 14},${p.y + 18} ${p.x + 8},${p.y + 12}`} fill="#FFFFFF" stroke={C.text} strokeWidth={1} />
            <SText x={p.x + 23} y={p.y + 15} style={{ fontSize: 7 }} fill={C.text2}>{sp.label}</SText>
          </G>
        );
      })}
      {h.connectors.map((c) => {
        const f = facing(c);
        const bx = f === 1 ? c.position.x - BOX_W - 20 : c.position.x + 20;
        const by = c.position.y - BOX_H / 2;
        const part = data.cat.connector(c.pn);
        return (
          <G key={c.id}>
            <Line x1={f === 1 ? bx + BOX_W : bx} y1={c.position.y} x2={c.position.x} y2={c.position.y} stroke="#AEB4BD" strokeWidth={4} />
            <Rect x={bx} y={by} width={BOX_W} height={BOX_H} fill="#FFFFFF" stroke={C.text} strokeWidth={1} />
            <Rect x={f === 1 ? bx - 14 : bx + BOX_W} y={by + 8} width={14} height={BOX_H - 16} fill="#E4E7EB" stroke={C.text2} strokeWidth={0.8} />
            <SText x={bx + 6} y={by + 15} style={{ fontSize: 12, fontWeight: 600 }} fill={C.text}>{c.refDes}</SText>
            <SText x={bx + 6} y={by + 28} style={{ fontSize: 7.5 }} fill={C.text2}>{c.pn}</SText>
            <SText x={bx + 6} y={by + 38} style={{ fontSize: 6.5 }} fill={C.text3}>{part ? `${part.kind}, ${Object.values(c.pins).filter((p) => p.netId).length}/${part.arrangement.contactCount} pins${c.backshell ? ", " + (data.cat.backshell(c.backshell.pn)?.angle ?? 0) + "° backshell" : ""}` : ""}</SText>
          </G>
        );
      })}
    </Svg>
  );
}

/** Insert face view with cavities colored by net class + legend (report §3). */
export function FaceSvg({ arr, gender, c, h, size = 150 }: { arr: Arrangement; gender: "pin" | "socket"; c: ConnectorInstance; h: Harness; size?: number }) {
  const R = Math.max(...arr.cavities.map((q) => Math.hypot(q.x, q.y)), 1);
  const r = size / 2;
  const sc = (r - 10) / (R + 1.4);
  const mir = gender === "socket" ? -1 : 1;
  const classFill: Record<string, string> = { power: "#C4234F", ground: "#16181D", signal: "#0B7F92", rf: "#7A3CC2", spare: "#8A9098" };
  return (
    <Svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`}>
      <Circle cx={0} cy={0} r={r - 2} fill="#FFFFFF" stroke={C.text2} strokeWidth={1} />
      <Rect x={-4} y={-r + 2} width={8} height={7} fill={C.text2} />
      {arr.cavities.map((q) => {
        const net = c.pins[q.id]?.netId ? h.nets.find((n) => n.id === c.pins[q.id]!.netId) : undefined;
        const rr = Math.max(1.8, Math.min(5, sc * ({ "22D": 0.5, "20": 0.65, "16": 0.9, "12": 1.3 }[q.size] ?? 0.6)));
        return (
          <G key={q.id}>
            <Circle cx={q.x * sc * mir} cy={-q.y * sc} r={rr} fill={net ? classFill[net.cls] : "#FFFFFF"} stroke={C.text3} strokeWidth={0.5} />
            {rr > 3.2 && <SText x={q.x * sc * mir} y={-q.y * sc + 2} style={{ fontSize: Math.min(5, rr) }} textAnchor="middle" fill={net ? "#FFFFFF" : C.text2}>{q.id}</SText>}
          </G>
        );
      })}
    </Svg>
  );
}

export function Bar({ w, h, fill }: { w: number; h: number; fill: string }) {
  return (
    <Svg width={Math.max(0.5, w)} height={h}>
      <Path d={`M0,0 H${Math.max(0.5, w)} V${h} H0 Z`} fill={fill} />
    </Svg>
  );
}
