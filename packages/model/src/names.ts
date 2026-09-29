import type { Harness } from "./schema";

/** Short human name of any harness object id: P1, W3, SP1, B2, net GND, P1–P2 (segment) … or null if unknown. */
export function objectLabel(h: Harness, id: string): string | null {
  const c = h.connectors.find((x) => x.id === id);
  if (c) return c.refDes || c.pn;
  const w = h.wires.find((x) => x.id === id);
  if (w) return w.label;
  const sp = h.splices.find((x) => x.id === id);
  if (sp) return sp.label;
  const cb = h.cables.find((x) => x.id === id);
  if (cb) return cb.label;
  const sh = h.shields.find((x) => x.id === id);
  if (sh) return sh.label;
  const nodeName = (nid: string) => {
    const n = h.nodes.find((x) => x.id === nid);
    if (!n) return "?";
    if (n.kind === "connector") return h.connectors.find((x) => x.id === n.connectorId)?.refDes ?? "?";
    return `B${h.nodes.filter((x) => x.kind === "breakout").indexOf(n) + 1}`;
  };
  const nd = h.nodes.find((x) => x.id === id);
  if (nd) return nodeName(nd.id);
  const s = h.segments.find((x) => x.id === id);
  if (s) return s.label || `${nodeName(s.a)}–${nodeName(s.b)}`;
  const n = h.nets.find((x) => x.id === id);
  if (n) return n.name;
  const l = h.layers.find((x) => x.id === id);
  if (l) return l.type;
  return null;
}

/**
 * Parts a finding is about, most physical first (connectors, splices, wires, segments, then nets), as display
 * names. Pass `max` to shorten long lists ("P1, P2, P3 +4").
 */
export function affectedParts(h: Harness, ids: string[], max = Infinity): string {
  const rank = (id: string) => (h.connectors.some((c) => c.id === id) ? 0 : h.splices.some((s) => s.id === id) ? 1 : h.wires.some((w) => w.id === id) || h.cables.some((c) => c.id === id) ? 2 : h.nets.some((n) => n.id === id) ? 4 : 3);
  const names = [...new Set([...ids].sort((a, b) => rank(a) - rank(b)).map((id) => objectLabel(h, id)).filter((x): x is string => !!x))];
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}
