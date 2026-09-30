import { memo } from "react";
import { formatWireColor, type CatalogIndex, type ConnectorInstance, type Severity, type Wire } from "@hs/model";
import { needsCasing, semantic, wireColor } from "@hs/ui-tokens";
import { ROW_H, HEADER_H, type ConnLayout, type ZoomLevel } from "../lib/geometry";
import { BackshellShape, backshellLabel, bendOf, bendReach, REAR } from "./BackshellGlyph";

export interface RowState {
  valid?: boolean;
  reason?: string;
}

interface Props {
  c: ConnectorInstance;
  L: ConnLayout;
  level: ZoomLevel;
  /** cavityId → signal name for this connector (cached by content so unrelated edits don't re-render). */
  names: Map<string, string>;
  cat: CatalogIndex;
  theme: "dark" | "light";
  selected: boolean;
  selectedPins: Set<string>;
  severity?: Severity;
  editingCavity: string | null;
  dragTargets: Map<string, RowState> | null;
  dimmed: boolean;
  wiresByPin: Map<string, Wire[]>;
  potted: boolean;
  flash: boolean;
  /** Label shown on no-connect pins (project setting). */
  ncLabel: string;
}

function Glyph({ c, L, cat, theme, potted }: { c: ConnectorInstance; L: ConnLayout; cat: CatalogIndex; theme: "dark" | "light"; potted: boolean }) {
  const part = cat.connector(c.pn);
  const { x, y, w, h } = L.glyph;
  const f = L.facing; // 1: bundle to the right → mating face on the left
  const fill = semantic("glyph.fill", theme);
  const stroke = semantic("glyph.stroke", theme);
  const bs = c.backshell ? cat.backshell(c.backshell.pn) : undefined;
  // Build in a local frame where the mating face is at x=0 and the rear at x=w, then mirror if needed.
  const tf = f === 1 ? `translate(${x},${y})` : `translate(${x + w},${y}) scale(-1,1)`;
  const kind = part?.kind ?? "plug";
  const mount = part?.mount ?? "straight";
  return (
    <g transform={tf} aria-hidden>
      {kind === "plug" ? (
        <>
          {/* coupling nut with knurl marks */}
          <rect x={0} y={2} width={24} height={h - 4} rx={3} fill={fill} stroke={stroke} strokeWidth={1} />
          {[5, 10, 15, 20].map((k) => (
            <line key={k} x1={k} y1={4} x2={k} y2={h - 4} stroke={stroke} strokeOpacity={0.45} strokeWidth={0.8} />
          ))}
          <rect x={24} y={7} width={24} height={h - 14} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        </>
      ) : (
        <>
          <rect x={0} y={8} width={20} height={h - 16} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
          {mount === "jam nut" ? (
            <path d={`M20,${2} h9 l3,4 v${h - 12} l-3,4 h-9z`} fill={fill} stroke={stroke} strokeWidth={1} />
          ) : (
            <rect x={20} y={0} width={6} height={h} rx={1} fill={fill} stroke={stroke} strokeWidth={1} />
          )}
          <rect x={mount === "jam nut" ? 32 : 26} y={7} width={mount === "jam nut" ? 16 : 22} height={h - 14} rx={2} fill={fill} stroke={stroke} strokeWidth={1} />
        </>
      )}
      {bs && c.backshell && <BackshellShape bs={bs} fit={c.backshell} h={h} theme={theme} />}
      {potted && <rect x={44} y={10} width={6} height={h - 20} fill={stroke} />}
    </g>
  );
}

/**
 * Click target over a fitted backshell (drawn after the card's hit area so it wins) with its name underneath.
 * Clicking opens the backshell picker.
 */
function BackshellTag({ c, L, cat, theme, level }: { c: ConnectorInstance; L: ConnLayout; cat: CatalogIndex; theme: "dark" | "light"; level: ZoomLevel }) {
  const bs = c.backshell ? cat.backshell(c.backshell.pn) : undefined;
  if (!bs || !c.backshell) return null;
  const { x, y, w, h } = L.glyph;
  // Backshell span in canvas coordinates (the glyph is mirrored for left-facing connectors).
  const x0 = L.facing === 1 ? x + REAR : x;
  const x1 = L.facing === 1 ? x + w : x + w - REAR;
  const bend = bs.angle ? bendOf(c.backshell.clockingDeg) : null;
  const extra = bend === "up" || bend === "down" ? bendReach(bs.angle, h) : 0;
  const clocking = bs.angle ? `, clocked ${c.backshell.clockingDeg}° (${bend === "toward" ? "toward the viewer" : bend === "away" ? "away from the viewer" : bend})` : "";
  return (
    <g data-hit="backshell" data-id={c.id} style={{ cursor: "pointer" }}>
      <title>{`Backshell ${bs.pn}: ${bs.description}${clocking}. Clamp ${bs.clampMinMm}–${bs.clampMaxMm} mm${c.backshell.auto ? ", size follows the design" : ""}. Click to change.`}</title>
      <rect x={x0 - 2} y={y - (bend === "up" ? extra : 0) - 2} width={x1 - x0 + 4} height={h + extra + 4} fill="transparent" />
      {level !== "overview" && (
        <text x={x + w / 2} y={y + h + (bend === "down" ? extra : 0) + 11} fontSize={9} textAnchor="middle" fill={semantic("text.secondary", theme)}>
          {backshellLabel(bs)}
        </text>
      )}
    </g>
  );
}

function FaceThumb({ c, L, cat, theme, cx: x, cy: y, r }: { c: ConnectorInstance; L: ConnLayout; cat: CatalogIndex; theme: "dark" | "light"; cx: number; cy: number; r: number }) {
  const part = cat.connector(c.pn);
  if (!part) return null;
  const cavs = part.arrangement.cavities;
  const R = Math.max(...cavs.map((q) => Math.hypot(q.x, q.y)), 1) + 1.2;
  const s = (r - 2) / R;
  const dot = Math.max(0.9, Math.min(2.2, r / Math.sqrt(cavs.length) / 1.6));
  const mir = part.gender === "socket" ? -1 : 1; // sockets are the mirror image of the pin face
  void L;
  return (
    <g data-hit="face" data-id={c.id} style={{ cursor: "zoom-in" }}>
      <title>Insert {part.arrangement.id} face view: click to expand</title>
      <circle cx={x} cy={y} r={r} fill={semantic("bg.surface-1", theme)} stroke={semantic("border.control", theme)} strokeWidth={1} />
      {cavs.map((q) => {
        const used = !!c.pins[q.id]?.netId;
        return <circle key={q.id} cx={x + q.x * s * mir} cy={y - q.y * s} r={dot} fill={used ? semantic("text.primary", theme) : "none"} stroke={semantic("text.tertiary", theme)} strokeWidth={0.5} />;
      })}
    </g>
  );
}

function ColorRect({ color, x, y, theme }: { color: Wire["color"]; x: number; y: number; theme: "dark" | "light" }) {
  const all = [color.base, ...color.stripes];
  const W = 14;
  return (
    <g>
      <rect x={x} y={y} width={W} height={8} fill={wireColor(color.base, theme)} />
      {color.stripes.map((sc, i) => (
        <rect key={i} x={x + (W * (i + 1)) / all.length - 1.5} y={y} width={2.4} height={8} fill={wireColor(sc, theme)} />
      ))}
      {needsCasing(wireColor(color.base, theme), semantic("bg.surface-2", theme)) && <rect x={x + 0.4} y={y + 0.4} width={W - 0.8} height={7.2} fill="none" stroke={semantic("wire.casing", theme)} strokeWidth={0.8} />}
    </g>
  );
}

export const ConnectorView = memo(function ConnectorView({ c, L, level, names, cat, theme, selected, selectedPins, severity, editingCavity, dragTargets, dimmed, wiresByPin, potted, flash, ncLabel }: Props) {
  const part = cat.connector(c.pn);
  const { card } = L;
  const accent = semantic("accent", theme);
  const tp = semantic("text.primary", theme);
  const ts = semantic("text.secondary", theme);
  const tt = semantic("text.tertiary", theme);
  const surface = semantic("bg.surface-2", theme);
  const border = semantic("border.subtle", theme);
  const statusCol = severity === "error" ? "var(--status-error)" : severity === "warning" ? "var(--status-warning)" : "var(--status-info)";
  const unreviewed = part && part.arrangement.status !== "verified";

  if (L.compact) {
    const overview = level === "overview";
    return (
      <g opacity={dimmed ? 0.25 : 1} aria-label={`Connector ${c.refDes}, ${c.pn}`}>
        {/* bundle attach stub from the block to the connector's bundle end */}
        {!overview && <line x1={L.attachX} y1={L.anchor.y} x2={L.anchor.x} y2={L.anchor.y} stroke={semantic("bundle.fill", theme)} strokeWidth={5} strokeLinecap="round" />}
        <Glyph c={c} L={L} cat={cat} theme={theme} potted={potted} />
        <g data-hit="connector" data-id={c.id} style={{ cursor: "move" }}>
          <title>{`${c.refDes} ${c.pn}: ${L.used}/${L.total} pins used. Pins and wires are edited in the schematic (Tab).`}</title>
          <rect x={L.glyph.x} y={L.glyph.y} width={L.glyph.w} height={L.glyph.h} fill="transparent" />
          <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={8} fill={surface} stroke={selected || flash ? accent : border} strokeWidth={selected || flash ? 2 : 1} />
          {overview ? (
            <>
              <text x={card.x + 10} y={card.y + 21} fontSize={15} fontWeight={600} fill={tp}>
                {c.refDes}
              </text>
              <text x={card.x + card.w - 10} y={card.y + 21} fontSize={12} textAnchor="end" fill={ts}>
                {L.used}/{L.total} pins
              </text>
            </>
          ) : (
            <>
              <text x={card.x + 10} y={card.y + 18} fontSize={14} fontWeight={600} fill={tp}>
                {c.refDes || "—"}
              </text>
              <text x={card.x + card.w - 10} y={card.y + 18} fontSize={10.5} textAnchor="end" fill={ts}>
                {L.used}/{L.total} pins
              </text>
              <text className="mono" x={card.x + 10} y={card.y + 34} fontSize={10} fill={ts}>
                {c.pn.length > 24 ? c.pn.slice(0, 23) + "…" : c.pn}
              </text>
            </>
          )}
        </g>
        <BackshellTag c={c} L={L} cat={cat} theme={theme} level={level} />
        {severity && (
          <g transform={`translate(${card.x + card.w - 6},${card.y - 6})`} data-hit="badge" data-id={c.id}>
            <circle r={7} fill={surface} />
            <text textAnchor="middle" y={4} fontSize={11} fontWeight={700} fill={statusCol}>
              {severity === "error" ? "⨯" : severity === "warning" ? "!" : "i"}
            </text>
            <circle r={7} fill="none" stroke={statusCol} strokeWidth={1.5} />
          </g>
        )}
      </g>
    );
  }

  const wide = level === "detail";
  const colPin = card.x + 8;
  const colSig = card.x + 40;
  const colWire = card.x + (wide ? 150 : 160);
  const colContact = card.x + 250;
  return (
    <g opacity={dimmed ? 0.25 : 1} aria-label={`Connector ${c.refDes}, ${c.pn}`}>
      <Glyph c={c} L={L} cat={cat} theme={theme} potted={potted} />
      {/* bundle stub from card to anchor */}
      <g data-hit="connector" data-id={c.id} style={{ cursor: "move" }}>
        <rect x={L.glyph.x} y={L.glyph.y} width={L.glyph.w} height={L.glyph.h} fill="transparent" />
        <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={8} fill={surface} stroke={selected || flash ? accent : border} strokeWidth={selected || flash ? 2 : 1} />
        <text x={card.x + 10} y={card.y + 19} fontSize={14} fontWeight={600} fill={tp}>
          {c.refDes || "—"}
        </text>
        <text x={card.x + 10 + Math.max(24, (c.refDes.length || 1) * 9)} y={card.y + 19} fontSize={10} fill={ts}>
          {part ? (part.kind === "plug" ? "plug" : "receptacle") : "unknown part"}
        </text>
        <text className="mono" x={card.x + 10} y={card.y + 35} fontSize={10.5} fill={ts}>
          {c.pn}
        </text>
        {unreviewed && (
          <g>
            <title>Insert {part!.arrangement.id} geometry is machine-extracted from MIL-STD-1560C and unreviewed</title>
            <rect x={card.x + card.w - 106} y={card.y + 8} width={62} height={13} rx={3} fill="none" stroke={tt} strokeWidth={0.8} />
            <text x={card.x + card.w - 75} y={card.y + 17.5} fontSize={8} textAnchor="middle" fill={tt}>
              UNREVIEWED
            </text>
          </g>
        )}
      </g>
      <BackshellTag c={c} L={L} cat={cat} theme={theme} level={level} />
      <FaceThumb c={c} L={L} cat={cat} theme={theme} cx={card.x + card.w - 22} cy={card.y + 22} r={16} />
      <line x1={card.x} x2={card.x + card.w} y1={card.y + HEADER_H - 3} y2={card.y + HEADER_H - 3} stroke={border} />
      {L.rows.map((r) => {
        const key = `${c.id}:${r.cavityId}`;
        const sel = selectedPins.has(key);
        const ds = dragTargets?.get(key);
        const wires = wiresByPin.get(r.cavityId) ?? [];
        const w = wires[0];
        const name = names.get(r.cavityId) ?? "";
        const pin = c.pins[r.cavityId];
        const contact = wide && (r.netId || pin?.filler) ? pin?.contactPn ?? (part ? cat.contactFor(r.size, part.gender, w?.gauge)?.pn : undefined) : undefined;
        const editing = editingCavity === r.cavityId;
        return (
          <g key={r.cavityId} data-hit="pin" data-id={key} opacity={ds && ds.valid === false ? 0.3 : 1} style={{ cursor: "crosshair" }}>
            <title>{ds?.reason ? ds.reason : `${c.refDes}-${r.cavityId} (size ${r.size})${name ? `: ${name}` : ""}${w ? `, ${w.label} ${w.gauge} AWG ${formatWireColor(w.color)}` : ""}. Drag to connect; double-click to name.`}</title>
            <rect x={card.x + 1} y={r.top} width={card.w - 2} height={ROW_H} fill={sel ? "var(--bg-hover)" : "transparent"} />
            {ds?.valid && <rect x={card.x + 2} y={r.top + 1} width={card.w - 4} height={ROW_H - 2} rx={3} fill="none" stroke={accent} strokeWidth={1} strokeDasharray="3 2" />}
            {sel && <rect x={card.x + 1} y={r.top} width={3} height={ROW_H} fill={accent} />}
            <text className="mono" x={colPin} y={r.y + 4} fontSize={11} fill={ts}>
              {r.cavityId}
            </text>
            {!editing && (
              <text className="mono" x={colSig} y={r.y + 4} fontSize={11.5} fill={name ? tp : tt} fontStyle={!name && pin?.noConnect ? "italic" : undefined} data-hit="signal" data-id={key}>
                {name ? (name.length > (wide ? 14 : 16) ? name.slice(0, wide ? 13 : 15) + "…" : name) : pin?.noConnect ? ncLabel : r.special ? "coax/twinax (Phase 2)" : "—"}
              </text>
            )}
            {w && (
              <g data-hit="wire-color" data-id={wires.map((x) => x.id).join(",")} style={{ cursor: "pointer" }}>
                <title>{`${wires.map((x) => x.label).join(", ")}: ${formatWireColor(w.color)}, ${w.gauge} AWG. Click to change color or gauge.`}</title>
                <rect x={colWire - 2} y={r.top + 1} width={wide ? 74 : 40} height={ROW_H - 2} rx={3} fill="transparent" />
                <ColorRect color={w.color} x={colWire} y={r.y - 4} theme={theme} />
                <text className="mono" x={colWire + 18} y={r.y + 4} fontSize={10} fill={ts}>
                  {wide ? `${w.gauge} · ${formatWireColor(w.color).split(" ")[1]}` : `${w.gauge}`}
                </text>
              </g>
            )}
            {wide && contact && (
              <text className="mono" x={colContact} y={r.y + 4} fontSize={9.5} fill={tt}>
                {contact}
              </text>
            )}
            {/* attach handle on the bundle side */}
            <circle cx={L.attachX} cy={r.y} r={2.4} fill={w ? tp : "none"} stroke={ts} strokeWidth={0.8} />
          </g>
        );
      })}
      {L.collapsed && (
        <g data-hit="collapsed" data-id={c.id} style={{ cursor: "pointer" }}>
          <title>Show all cavities</title>
          <text x={card.x + 40} y={L.collapsed.y + 4} fontSize={11} fill={accent}>
            + {L.collapsed.count} unused
          </text>
        </g>
      )}
      {severity && (
        <g transform={`translate(${card.x + card.w - 6},${card.y - 6})`} data-hit="badge" data-id={c.id}>
          <circle r={7} fill={surface} />
          <text textAnchor="middle" y={4} fontSize={11} fontWeight={700} fill={statusCol}>
            {severity === "error" ? "⨯" : severity === "warning" ? "!" : "i"}
          </text>
          <circle r={7} fill="none" stroke={statusCol} strokeWidth={1.5} />
        </g>
      )}
      {potted && (
        <g transform={`translate(${L.glyph.x + L.glyph.w / 2},${L.glyph.y - 8})`}>
          <title>Potted</title>
          <rect x={-7} y={-7} width={14} height={14} rx={3} fill={tp} />
          <text textAnchor="middle" y={4} fontSize={10} fontWeight={700} fill={surface}>
            P
          </text>
        </g>
      )}
    </g>
  );
});
