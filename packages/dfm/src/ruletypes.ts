import {
  addBoot,
  colorName,
  commitRatsnest,
  cavityStates,
  contactPnFor,
  diameterUnderLayer,
  effectiveTopology,
  extentCoverage,
  formatWireColor,
  isAutoNetName,
  resolveLabelTemplate,
  setBackshell,
  setDrain,
  setNetProps,
  setSegmentProps,
  setShieldProps,
  setTermination,
  setWireProps,
  shortestPath,
  terminationDiameter,
  updateLayer,
  uid,
  type Cavity,
  type Harness,
  type Net,
  type NetClass,
  type RuleInstance,
  type Wire,
} from "@hs/model";
import { purchaseQty } from "@hs/ops";
import { deltaE, simulateCvd, wireColor } from "@hs/ui-tokens";
import { safeRegExp } from "./regex";
import type { RuleCtx, RuleType, Violation } from "./types";

// ─── helpers ────────────────────────────────────────────────────────────────

function pinEnds(w: Wire) {
  return [w.from, w.to].filter((e): e is Extract<Wire["from"], { kind: "pin" }> => e.kind === "pin");
}

function netOf(h: Harness, id: string): Net | undefined {
  return h.nets.find((n) => n.id === id);
}

/** Does a net match a rule scope (netClass / namePattern)? */
export function netInScope(net: Net | undefined, params: Record<string, any>, rule?: RuleInstance): boolean {
  if (!net) return false;
  const cls = (params.netClass as NetClass | undefined) ?? undefined;
  const pat = (params.namePattern as string | undefined) || undefined;
  if (cls && net.cls !== cls) return false;
  // Invalid/unsafe patterns throw → the rule reports engineError (never a silent pass).
  if (pat && !safeRegExp(pat).test(net.name)) return false;
  if (rule?.scope?.netClass?.length && !rule.scope.netClass.includes(net.cls)) return false;
  if (rule?.scope?.namePattern && !safeRegExp(rule.scope.namePattern).test(net.name)) return false;
  return true;
}

const adjCache = new WeakMap<Cavity[], Map<string, Set<string>>>();
/** Adjacent cavities: within 1.35 × the cavity's nearest-neighbour distance (or an explicit mm limit). */
export function adjacency(cavs: Cavity[], limitMm?: number): Map<string, Set<string>> {
  if (!limitMm && adjCache.has(cavs)) return adjCache.get(cavs)!;
  const out = new Map<string, Set<string>>();
  for (const c of cavs) {
    let nn = Infinity;
    for (const o of cavs) if (o !== c) nn = Math.min(nn, Math.hypot(o.x - c.x, o.y - c.y));
    const lim = limitMm ?? nn * 1.35;
    out.set(c.id, new Set(cavs.filter((o) => o !== c && Math.hypot(o.x - c.x, o.y - c.y) <= lim + 1e-6).map((o) => o.id)));
  }
  if (!limitMm) adjCache.set(cavs, out);
  return out;
}

const pinLabel = (ctx: RuleCtx, connectorId: string, cav: string) => `${ctx.refDes(connectorId)}-${cav}`;
const wireDesc = (ctx: RuleCtx, w: Wire) => `${w.label} (${netOf(ctx.h, w.netId)?.name ?? "?"})`;

function segmentLabel(ctx: RuleCtx, segId: string): string {
  const s = ctx.h.segments.find((x) => x.id === segId);
  if (!s) return "segment";
  if (s.label) return s.label;
  const name = (nid: string) => {
    const n = ctx.h.nodes.find((x) => x.id === nid);
    if (!n) return "?";
    if (n.kind === "connector") return ctx.refDes(n.connectorId!);
    return `B${ctx.h.nodes.filter((x) => x.kind === "breakout").indexOf(n) + 1}`;
  };
  return `${name(s.a)}–${name(s.b)}`;
}

function nodeName(ctx: RuleCtx, nid: string): string {
  const n = ctx.h.nodes.find((x) => x.id === nid);
  if (!n) return "?";
  if (n.kind === "connector") return ctx.refDes(n.connectorId!);
  return `breakout B${ctx.h.nodes.filter((x) => x.kind === "breakout").indexOf(n) + 1}`;
}

// ─── rule types ─────────────────────────────────────────────────────────────

export const RULE_TYPES: RuleType[] = [
  // Connectivity
  {
    id: "net_single_member",
    name: "Net with only one pin",
    description: "Flags nets that connect only one pin.",
    example: "CAN_H assigned on P1-4 but on no other connector.",
    category: "Connectivity",
    params: [],
    depends: ["net"],
    evaluate(ctx) {
      return ctx.h.nets.filter((n) => n.members.length === 1).map((n) => ({ objectIds: [n.id, n.members[0]!.connectorId], objectKind: "net", message: `Net ${n.name} has only one pin (${pinLabel(ctx, n.members[0]!.connectorId, n.members[0]!.cavityId)}).` }));
    },
  },
  {
    id: "pin_unwired",
    name: "Named pin has no wire",
    description: "A pin is on a multi-member net but no wire lands on it.",
    example: "Ratsnest line not yet committed.",
    category: "Connectivity",
    params: [],
    depends: ["net", "wire"],
    evaluate(ctx) {
      const wired = new Set<string>();
      for (const w of ctx.h.wires) for (const e of pinEnds(w)) wired.add(`${e.connectorId}:${e.cavityId}`);
      const out: Violation[] = [];
      for (const n of ctx.h.nets) {
        if (n.members.length < 2) continue;
        const missing = n.members.filter((m) => !wired.has(`${m.connectorId}:${m.cavityId}`));
        if (missing.length) out.push({ objectIds: [n.id, ...missing.map((m) => m.connectorId)], objectKind: "net", message: `${n.name}: ${missing.map((m) => pinLabel(ctx, m.connectorId, m.cavityId)).join(", ")} not wired.`, fix: { label: "Commit connections", commands: [commitRatsnest({ netIds: [n.id] })] } });
      }
      return out;
    },
  },
  {
    id: "loopback",
    name: "Wire loops back to the same connector",
    description: "Both ends of a wire are on the same connector.",
    example: "Jumper P1-A to P1-B.",
    category: "Connectivity",
    params: [],
    depends: ["wire"],
    evaluate(ctx) {
      return ctx.h.wires
        .filter((w) => {
          const e = pinEnds(w);
          return e.length === 2 && e[0]!.connectorId === e[1]!.connectorId;
        })
        .map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} loops back to ${ctx.refDes(pinEnds(w)[0]!.connectorId)}.` }));
    },
  },
  {
    id: "unrouted_wire",
    name: "Wire has no route",
    description: "No path of bundle segments connects the wire's ends.",
    example: "A branch segment was deleted.",
    category: "Connectivity",
    params: [],
    depends: ["wire", "segment", "node"],
    evaluate(ctx) {
      return ctx.h.wires.filter((w) => ctx.d.routes.get(w.id) == null).map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} has no route through the bundle.` }));
    },
  },
  {
    id: "duplicate_pin",
    name: "Pin assigned to two nets",
    description: "A cavity belongs to more than one net.",
    example: "Imported wire list assigns P1-3 to two signals.",
    category: "Connectivity",
    params: [],
    depends: ["net"],
    evaluate(ctx) {
      const seen = new Map<string, string>();
      const out: Violation[] = [];
      for (const n of ctx.h.nets)
        for (const m of n.members) {
          const k = `${m.connectorId}:${m.cavityId}`;
          if (seen.has(k)) out.push({ objectIds: [m.connectorId], objectKind: "pin", message: `${pinLabel(ctx, m.connectorId, m.cavityId)} is on ${seen.get(k)} and ${n.name}.` });
          else seen.set(k, n.name);
        }
      return out;
    },
  },

  // Electrical
  {
    id: "gauge_vs_contact",
    name: "Wire gauge outside contact range",
    description: "Wire gauge must be within the contact's crimp range.",
    example: "16 AWG into a size 22D contact.",
    category: "Electrical",
    params: [],
    depends: ["wire", "pin", "connector"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const w of ctx.h.wires) {
        for (const e of pinEnds(w)) {
          const c = ctx.h.connectors.find((x) => x.id === e.connectorId);
          const cav = c && ctx.cat.cavity(c.pn, e.cavityId);
          if (!c || !cav || cav.special) continue;
          const pn = contactPnFor(ctx.h, ctx.cat, c.id, e.cavityId, w.gauge);
          const cp = pn ? ctx.cat.contactsByPn.get(pn) : undefined;
          if (!cp) continue;
          if (w.gauge > cp.gaugeMin || w.gauge < cp.gaugeMax) {
            const target = w.gauge > cp.gaugeMin ? cp.gaugeMin : cp.gaugeMax;
            out.push({
              objectIds: [w.id, c.id],
              objectKind: "wire",
              message: `${wireDesc(ctx, w)}: ${w.gauge} AWG doesn't fit the size ${cav.size} contact at ${pinLabel(ctx, c.id, e.cavityId)} (${cp.gaugeMax}–${cp.gaugeMin} AWG).`,
              fix: ctx.cat.wire(w.spec, target) ? { label: `Change to ${target} AWG`, commands: [setWireProps({ ids: [w.id], gauge: target })] } : undefined,
            });
          }
        }
      }
      return out;
    },
  },
  {
    id: "gauge_vs_current",
    name: "Wire too small for net current (derating)",
    description: "Wire current rating × derating factor must exceed the net's current.",
    example: "5 A on 24 AWG with 0.5 derating.",
    category: "Electrical",
    params: [{ key: "deratingFactor", label: "Derating factor", type: "number", stricter: "lower", default: 0.7, help: "Fraction of the free-air rating allowed" }],
    depends: ["wire", "net"],
    scoped: true,
    evaluate(ctx, p, rule) {
      const out: Violation[] = [];
      const f = Number(p.deratingFactor ?? 0.7);
      for (const n of ctx.h.nets) {
        if (!n.currentA || !netInScope(n, {}, rule)) continue;
        for (const w of ctx.h.wires.filter((x) => x.netId === n.id)) {
          const ws = ctx.cat.wire(w.spec, w.gauge);
          if (!ws) continue;
          const allowed = ws.currentA * f;
          if (n.currentA > allowed + 1e-9) {
            const better = ctx.cat.gaugesFor(w.spec).filter((g) => (ctx.cat.wire(w.spec, g)?.currentA ?? 0) * f >= n.currentA!).sort((a, b) => b - a)[0];
            out.push({
              objectIds: [w.id, n.id],
              objectKind: "wire",
              message: `${wireDesc(ctx, w)}: ${n.currentA} A exceeds ${w.gauge} AWG rating ${ws.currentA} A × ${f} = ${allowed.toFixed(1)} A.`,
              fix: better ? { label: `Change to ${better} AWG`, commands: [setWireProps({ ids: [w.id], gauge: better })] } : undefined,
            });
          }
        }
      }
      return out;
    },
  },
  {
    id: "contact_current",
    name: "Net current exceeds contact rating",
    description: "Net current must not exceed the contact size rating.",
    example: "10 A through a size 22D contact (5 A).",
    category: "Electrical",
    params: [],
    depends: ["net", "connector"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const n of ctx.h.nets) {
        if (!n.currentA) continue;
        for (const m of n.members) {
          const c = ctx.h.connectors.find((x) => x.id === m.connectorId);
          const cav = c && ctx.cat.cavity(c.pn, m.cavityId);
          const rating = cav && ctx.cat.contactSize(cav.size)?.currentA;
          if (rating && n.currentA > rating) out.push({ objectIds: [n.id, m.connectorId], objectKind: "pin", message: `${n.name}: ${n.currentA} A exceeds size ${cav!.size} contact rating ${rating} A at ${pinLabel(ctx, m.connectorId, m.cavityId)}.` });
        }
      }
      return out;
    },
  },
  {
    id: "twisted_pair_pins",
    name: "Twisted pair not on adjacent pins",
    description: "Members of a twisted pair should land on adjacent cavities at each connector.",
    example: "CAN_H on P1-1 and CAN_L on P1-9.",
    category: "Electrical",
    params: [{ key: "maxSpacingMm", label: "Max cavity spacing", type: "number", unit: "mm", stricter: "lower", default: 4 }],
    depends: ["twist", "wire", "connector"],
    evaluate(ctx, p) {
      const out: Violation[] = [];
      for (const g of ctx.h.twistGroups) {
        const wires = g.wireIds.map((id) => ctx.h.wires.find((w) => w.id === id)!).filter(Boolean);
        const byConn = new Map<string, string[]>();
        for (const w of wires) for (const e of pinEnds(w)) (byConn.get(e.connectorId) ?? byConn.set(e.connectorId, []).get(e.connectorId)!).push(e.cavityId);
        for (const [cid, cavIds] of byConn) {
          if (cavIds.length < 2) continue;
          const c = ctx.h.connectors.find((x) => x.id === cid)!;
          const cavs = ctx.cat.connector(c.pn)?.arrangement.cavities ?? [];
          const pos = cavIds.map((id) => cavs.find((x) => x.id === id)).filter(Boolean) as Cavity[];
          let maxD = 0;
          for (let i = 0; i < pos.length; i++) for (let j = i + 1; j < pos.length; j++) maxD = Math.max(maxD, Math.hypot(pos[i]!.x - pos[j]!.x, pos[i]!.y - pos[j]!.y));
          if (maxD > Number(p.maxSpacingMm ?? 4)) out.push({ objectIds: [...g.wireIds, cid], objectKind: "twist", message: `Twisted ${wires.map((w) => netOf(ctx.h, w.netId)?.name).join("/")} on ${ctx.refDes(cid)} pins ${cavIds.join(", ")} are ${maxD.toFixed(1)} mm apart (not adjacent).` });
        }
      }
      return out;
    },
  },
  {
    id: "special_cavity",
    name: "Coax/twinax cavity used",
    description: "Shielded (coax/twinax) contacts arrive in Phase 2.",
    example: "Signal assigned to a size 8 twinax cavity.",
    category: "Electrical",
    params: [],
    depends: ["pin"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const n of ctx.h.nets)
        for (const m of n.members) {
          const c = ctx.h.connectors.find((x) => x.id === m.connectorId);
          const cav = c && ctx.cat.cavity(c.pn, m.cavityId);
          if (cav?.special) out.push({ objectIds: [m.connectorId, n.id], objectKind: "pin", message: `${pinLabel(ctx, m.connectorId, m.cavityId)} is a size ${cav.size} shielded cavity (coax/twinax contacts: Phase 2).` });
        }
      return out;
    },
  },

  // Mechanical
  {
    id: "bundle_vs_backshell_clamp",
    name: "Bundle doesn't fit backshell clamp",
    description: "Bundle diameter at the connector must be within the backshell cable-clamp range.",
    example: "12 mm bundle into a clamp for 3–9 mm.",
    category: "Mechanical",
    params: [],
    depends: ["connector", "wire", "segment", "layer"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const c of ctx.h.connectors) {
        if (!c.backshell) continue;
        const bs = ctx.cat.backshell(c.backshell.pn);
        const node = ctx.h.nodes.find((n) => n.connectorId === c.id);
        if (!bs || !node) continue;
        let dia = 0;
        for (const s of ctx.h.segments.filter((x) => x.a === node.id || x.b === node.id)) {
          let od = ctx.d.segCoreOdMm.get(s.id) ?? 0;
          for (const la of ctx.d.segStack.get(s.id) ?? []) {
            if (la.layer.type === "overbraid" && bs.bandPlatform) break;
            od = la.odAfterMm;
          }
          dia = Math.max(dia, od);
        }
        if (dia === 0) continue;
        if (dia > bs.clampMaxMm) out.push({ objectIds: [c.id], objectKind: "connector", message: `${c.refDes}: bundle ${ctx.len(dia)} exceeds backshell ${bs.pn} clamp range (max ${ctx.len(bs.clampMaxMm)}).` });
        else if (dia < bs.clampMinMm) out.push({ objectIds: [c.id], objectKind: "connector", message: `${c.refDes}: bundle ${ctx.len(dia)} is below backshell ${bs.pn} clamp range (min ${ctx.len(bs.clampMinMm)}); add build-up tape or a smaller clamp.` });
      }
      return out;
    },
  },
  {
    id: "min_segment_length",
    name: "Segment shorter than minimum",
    description: "Segments shorter than the minimum can't be laid automatically.",
    example: "15 mm branch.",
    category: "Mechanical",
    params: [{ key: "minMm", label: "Minimum length", type: "number", unit: "mm", stricter: "higher", default: 25 }],
    depends: ["segment"],
    evaluate(ctx, p) {
      const min = Number(p.minMm);
      return ctx.h.segments.filter((s) => s.lengthMm < min).map((s) => ({ objectIds: [s.id], objectKind: "segment", message: `Segment ${segmentLabel(ctx, s.id)} is ${ctx.len(s.lengthMm)} (minimum ${ctx.len(min)}).`, fix: { label: `Set to ${ctx.len(min)}`, commands: [setSegmentProps({ ids: [s.id], lengthMm: min })] } }));
    },
  },
  {
    id: "breakout_spacing",
    name: "Breakouts too close together",
    description: "Adjacent breakouts must be at least the minimum distance apart.",
    example: "Two breakouts 20 mm apart.",
    category: "Mechanical",
    params: [{ key: "minMm", label: "Minimum spacing", type: "number", unit: "mm", stricter: "higher", default: 50 }],
    depends: ["segment", "node"],
    evaluate(ctx, p) {
      const min = Number(p.minMm);
      const kind = new Map(ctx.h.nodes.map((n) => [n.id, n.kind]));
      return ctx.h.segments
        .filter((s) => kind.get(s.a) === "breakout" && kind.get(s.b) === "breakout" && s.lengthMm < min)
        .map((s) => ({ objectIds: [s.id, s.a, s.b], objectKind: "segment", message: `Breakouts ${nodeName(ctx, s.a)} and ${nodeName(ctx, s.b)} are ${ctx.len(s.lengthMm)} apart (minimum ${ctx.len(min)}).`, fix: { label: `Set to ${ctx.len(min)}`, commands: [setSegmentProps({ ids: [s.id], lengthMm: min })] } }));
    },
  },
  {
    id: "bend_radius",
    name: "Not enough room for bend radius",
    description: "Segments leaving a 90° backshell or a breakout need room for a bend of N × bundle OD.",
    example: "60 mm segment with a 10 mm bundle at 10× OD.",
    category: "Mechanical",
    params: [{ key: "multiple", label: "Bend radius multiple of OD", type: "number", unit: "× OD", stricter: "higher", default: 6 }],
    depends: ["segment", "connector", "layer", "wire"],
    evaluate(ctx, p) {
      const mult = Math.max(Number(p.multiple ?? 6), ctx.ped.process.bendRadiusMultiple ?? 0);
      const out: Violation[] = [];
      const degree = new Map<string, number>();
      for (const s of ctx.h.segments) for (const n of [s.a, s.b]) degree.set(n, (degree.get(n) ?? 0) + 1);
      for (const s of ctx.h.segments) {
        const od = ctx.d.segOuterOdMm.get(s.id) ?? 0;
        if (!od) continue;
        const need = mult * od;
        for (const nid of [s.a, s.b]) {
          const n = ctx.h.nodes.find((x) => x.id === nid);
          if (!n) continue;
          let bends = false;
          if (n.kind === "connector") {
            const c = ctx.h.connectors.find((x) => x.id === n.connectorId);
            bends = !!(c?.backshell && ctx.cat.backshell(c.backshell.pn)?.angle === 90);
          } else bends = (degree.get(nid) ?? 0) >= 3;
          if (bends && s.lengthMm < need) {
            out.push({ objectIds: [s.id], objectKind: "segment", message: `Segment ${segmentLabel(ctx, s.id)} (${ctx.len(s.lengthMm)}) is too short for a ${mult}× OD bend (${ctx.len(need)}) at ${nodeName(ctx, nid)}.` });
            break;
          }
        }
      }
      return out;
    },
  },
  {
    id: "max_wire_length",
    name: "Wire longer than maximum",
    description: "Wire cut length must not exceed the maximum.",
    example: "7 m wire on a 6 m machine.",
    category: "Mechanical",
    params: [{ key: "maxMm", label: "Maximum length", type: "number", unit: "mm", stricter: "lower", default: 6000 }],
    depends: ["wire", "segment"],
    scoped: true,
    evaluate(ctx, p, rule) {
      const max = Number(p.maxMm);
      return ctx.h.wires.filter((w) => (ctx.d.wireLengthMm.get(w.id) ?? 0) > max && netInScope(netOf(ctx.h, w.netId), {}, rule)).map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} is ${ctx.len(ctx.d.wireLengthMm.get(w.id)!)} (maximum ${ctx.len(max)}).` }));
    },
  },
  {
    id: "min_wire_length",
    name: "Wire shorter than minimum",
    description: "Wires shorter than the minimum cut length need manual processing.",
    example: "80 mm jumper.",
    category: "Mechanical",
    params: [{ key: "minMm", label: "Minimum length", type: "number", unit: "mm", stricter: "higher", default: 100 }],
    depends: ["wire", "segment"],
    manual: true,
    evaluate(ctx, p) {
      const min = Number(p.minMm);
      return ctx.h.wires.filter((w) => (ctx.d.wireLengthMm.get(w.id) ?? 0) < min).map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} is ${ctx.len(ctx.d.wireLengthMm.get(w.id)!)} (machine minimum ${ctx.len(min)}).` }));
    },
  },
  {
    id: "min_braid_segment",
    name: "Overbraid segment too short",
    description: "Overbraid can't be applied to very short runs.",
    example: "Overbraid on a 40 mm segment.",
    category: "Mechanical",
    params: [{ key: "minMm", label: "Minimum length", type: "number", unit: "mm", stricter: "higher", default: 75 }],
    depends: ["layer", "segment"],
    evaluate(ctx, p) {
      const min = Number(p.minMm);
      const out: Violation[] = [];
      for (const l of ctx.h.layers.filter((x) => x.type === "overbraid"))
        for (const e of l.extents) {
          const s = ctx.h.segments.find((x) => x.id === e.segmentId);
          if (!s) continue;
          const [a, b] = extentCoverage(s, e);
          if (b - a < min) out.push({ objectIds: [s.id, l.id], objectKind: "segment", message: `Overbraid on ${segmentLabel(ctx, s.id)} is ${ctx.len(b - a)} (minimum ${ctx.len(min)}).` });
        }
      return out;
    },
  },

  // Machine capability
  {
    id: "connector_machine_ready",
    name: "Connector not machine-ready",
    description: "Connector must be supported for automated placement.",
    example: "Inactive insert arrangement or coax cavities.",
    category: "Machine capability",
    params: [{ key: "slashes", label: "Supported slash sheets", type: "stringList" }],
    depends: ["connector"],
    manual: true,
    evaluate(ctx, p) {
      const slashes: string[] = p.slashes ?? ctx.profile.capabilities.connectorSlashes;
      const out: Violation[] = [];
      for (const c of ctx.h.connectors) {
        const part = ctx.cat.connector(c.pn);
        if (!part) continue;
        const reasons: string[] = [];
        if (!slashes.includes(part.slash)) reasons.push(`/${part.slash} not fixtured`);
        if (part.arrangement.inactive) reasons.push(`insert ${part.arrangement.id} inactive for new design`);
        // Fixture/placement data come from cavity geometry: unreviewed geometry is never machine-ready (FIX-10).
        if (part.arrangement.status !== "verified") reasons.push(`insert ${part.arrangement.id} geometry ${part.arrangement.status}`);
        if (part.arrangement.special) reasons.push("shielded contacts");
        const unsupported = Object.keys(part.arrangement.sizes).filter((s) => !ctx.profile.capabilities.contactSizes.includes(s));
        if (unsupported.length) reasons.push(`contact size ${unsupported.join("/")}`);
        if (reasons.length) out.push({ objectIds: [c.id], objectKind: "connector", message: `${c.refDes} (${part.pn}) placed by hand: ${reasons.join("; ")}.` });
      }
      return out;
    },
  },
  {
    id: "contact_machine_insertable",
    name: "Contact not machine-insertable",
    description: "Contacts must be of a size and type the insertion head supports.",
    example: "Size 10 power contact.",
    category: "Machine capability",
    params: [{ key: "sizes", label: "Supported contact sizes", type: "stringList" }],
    depends: ["wire", "pin", "connector"],
    manual: true,
    evaluate(ctx, p) {
      const sizes: string[] = p.sizes ?? ctx.profile.capabilities.contactSizes;
      const out: Violation[] = [];
      for (const c of ctx.h.connectors) {
        const bad: string[] = [];
        for (const w of ctx.h.wires)
          for (const e of pinEnds(w)) {
            if (e.connectorId !== c.id) continue;
            const cav = ctx.cat.cavity(c.pn, e.cavityId);
            if (!cav || cav.special) continue;
            const pn = contactPnFor(ctx.h, ctx.cat, c.id, e.cavityId, w.gauge);
            const cp = pn ? ctx.cat.contactsByPn.get(pn) : undefined;
            if (!sizes.includes(cav.size) || !cp?.machineInsertable) bad.push(e.cavityId);
          }
        const u = [...new Set(bad)];
        if (u.length) out.push({ objectIds: [c.id], objectKind: "connector", message: `${c.refDes}: ${u.length} contact${u.length > 1 ? "s" : ""} (${u.slice(0, 6).join(", ")}${u.length > 6 ? ", …" : ""}) inserted by hand.` });
      }
      return out;
    },
  },
  {
    id: "max_connectors",
    name: "Too many connectors",
    description: "Number of connectors must not exceed the build limit.",
    example: "14 connectors on a 12-position plate.",
    category: "Machine capability",
    params: [{ key: "max", label: "Maximum connectors", type: "number", stricter: "lower", default: 12 }],
    depends: ["connector"],
    evaluate(ctx, p) {
      const n = ctx.h.connectors.length;
      return n > Number(p.max) ? [{ objectIds: ctx.h.connectors.map((c) => c.id), objectKind: "project", message: `${n} connectors exceed the build limit of ${p.max}.` }] : [];
    },
  },
  {
    id: "harness_envelope",
    name: "Harness exceeds working area",
    description: "Longest end-to-end run must fit the machine working area.",
    example: "4.5 m run on a 4 m table.",
    category: "Machine capability",
    params: [{ key: "maxMm", label: "Working length", type: "number", unit: "mm", stricter: "lower", default: 4000 }],
    depends: ["segment", "node"],
    evaluate(ctx, p) {
      const conns = ctx.h.nodes.filter((n) => n.kind === "connector");
      let longest = 0;
      let pair: [string, string] | null = null;
      for (let i = 0; i < conns.length; i++)
        for (let j = i + 1; j < conns.length; j++) {
          const path = shortestPath(ctx.d.adjacency, conns[i]!.id, conns[j]!.id);
          if (!path) continue;
          const len = path.segs.reduce((s, id) => s + (ctx.h.segments.find((x) => x.id === id)?.lengthMm ?? 0), 0);
          if (len > longest) (longest = len), (pair = [conns[i]!.connectorId!, conns[j]!.connectorId!]);
        }
      return longest > Number(p.maxMm) && pair ? [{ objectIds: pair, objectKind: "project", message: `Run ${ctx.refDes(pair[0])}–${ctx.refDes(pair[1])} is ${ctx.len(longest)} (working area ${ctx.len(Number(p.maxMm))}).` }] : [];
    },
  },
  {
    id: "manual_topology",
    name: "Splice or daisy chain needs manual work",
    description: "Nets with 3 or more members need splices or double crimps.",
    example: "GND on P1, P2 and P3.",
    category: "Machine capability",
    params: [],
    depends: ["net", "splice"],
    manual: true,
    evaluate(ctx) {
      if (ctx.profile.capabilities.supportsSplices && ctx.profile.capabilities.supportsDaisyChain) return [];
      return ctx.h.nets
        .filter((n) => n.members.length >= 3 && effectiveTopology(n) !== "parallel")
        .map((n) => ({ objectIds: [n.id, ...n.members.map((m) => m.connectorId)], objectKind: "net", message: `${n.name} (${n.members.length} pins) needs ${effectiveTopology(n) === "splice" ? "a splice" : "daisy-chain double crimps"}: manual operation.` }));
    },
  },
  {
    id: "unsupported_covering",
    name: "Covering applied by hand",
    description: "Only some covering types are applied by the machine.",
    example: "Heat-shrink jacket.",
    category: "Machine capability",
    params: [{ key: "automated", label: "Automated covering types", type: "stringList" }],
    depends: ["layer"],
    manual: true,
    evaluate(ctx, p) {
      const auto: string[] = p.automated ?? ctx.profile.capabilities.automatedCoverings;
      return ctx.h.layers
        .filter((l) => !auto.includes(l.type) || !ctx.cat.layer(l.pn)?.machineReady)
        .map((l) => ({ objectIds: [l.id, ...l.extents.map((e) => e.segmentId)], objectKind: "layer", message: `${ctx.cat.layer(l.pn)?.description ?? l.type} is applied by hand.` }));
    },
  },
  {
    id: "wire_machine_ready",
    name: "Wire not machine-ready",
    description: "Wire gauge must be within the cut/strip range.",
    example: "10 AWG power feed.",
    category: "Machine capability",
    params: [
      { key: "gaugeMin", label: "Thinnest gauge", type: "number", unit: "AWG", default: 26 },
      { key: "gaugeMax", label: "Heaviest gauge", type: "number", unit: "AWG", default: 12 },
    ],
    depends: ["wire"],
    manual: true,
    evaluate(ctx, p) {
      return ctx.h.wires
        .filter((w) => !w.cableId && (w.gauge > Number(p.gaugeMin) || w.gauge < Number(p.gaugeMax) || !ctx.cat.wire(w.spec, w.gauge)?.machineReady))
        .map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} (${w.gauge} AWG ${w.spec}) is cut and stripped by hand.` }));
    },
  },
  {
    id: "max_bundle_od",
    name: "Bundle diameter over maximum",
    description: "Bundle outside diameter must not exceed the limit.",
    example: "45 mm trunk.",
    category: "Machine capability",
    params: [{ key: "maxMm", label: "Maximum OD", type: "number", unit: "mm", stricter: "lower", default: 40 }],
    depends: ["segment", "wire", "layer"],
    evaluate(ctx, p) {
      return ctx.h.segments.filter((s) => (ctx.d.segOuterOdMm.get(s.id) ?? 0) > Number(p.maxMm)).map((s) => ({ objectIds: [s.id], objectKind: "segment", message: `Segment ${segmentLabel(ctx, s.id)} OD ${ctx.len(ctx.d.segOuterOdMm.get(s.id)!)} exceeds ${ctx.len(Number(p.maxMm))}.` }));
    },
  },

  // Components
  {
    id: "lifecycle",
    name: "Part obsolete, NRND or inactive",
    description: "Parts should be active (not obsolete, NRND or inactive for new design).",
    example: "Class F finish (inactive).",
    category: "Components",
    params: [],
    depends: ["bom"],
    evaluate(ctx) {
      return ctx
        .bom()
        .lines.filter((l) => l.lifecycle !== "active")
        .map((l) => ({ objectIds: l.objectIds, objectKind: "bom", message: `${l.pn} is ${l.lifecycle === "nrnd" ? "not recommended for new design" : l.lifecycle}${l.alternates[0] ? `; alternate ${l.alternates[0].alternate} available in BOM view` : ""}.` }));
    },
  },
  {
    id: "out_of_stock",
    name: "Part short of stock",
    description: "Stock must cover the selected quantity.",
    example: "0 in stock.",
    category: "Components",
    params: [],
    depends: ["bom", "project"],
    evaluate(ctx) {
      return ctx
        .bom()
        .lines.filter((l) => !l.stockSufficient)
        .map((l) => ({ objectIds: l.objectIds, objectKind: "bom", message: `${l.pn}: ${l.stock} in stock, ${purchaseQty(l, ctx.qty)} ${l.uom} needed for ${ctx.qty} units (demo data).` }));
    },
  },
  {
    id: "lead_time_vs_tier",
    name: "Part lead time exceeds quote tier",
    description: "Part lead times must fit the selected lead-time tier.",
    example: "42-day part on a 15-day tier.",
    category: "Components",
    params: [],
    depends: ["bom", "project"],
    evaluate(ctx) {
      return ctx
        .bom()
        .lines.filter((l) => !l.stockSufficient && l.leadDays > ctx.tierDays)
        .map((l) => ({ objectIds: l.objectIds, objectKind: "bom", message: `${l.pn}: ${l.leadDays}-day lead time exceeds the ${ctx.tierDays}-day tier (demo data).` }));
    },
  },
  {
    id: "backshell_required",
    name: "Backshell missing",
    description: "Harness connectors need a backshell for strain relief.",
    example: "P2 has no backshell.",
    category: "Components",
    params: [],
    depends: ["connector"],
    evaluate(ctx) {
      return ctx.h.connectors
        .filter((c) => !c.backshell && ctx.h.segments.some((s) => [s.a, s.b].includes(ctx.h.nodes.find((n) => n.connectorId === c.id)?.id ?? "")))
        .map((c) => {
          const part = ctx.cat.connector(c.pn);
          const bs = part && ctx.cat.backshellsFor(part.shellSize).find((b) => b.style === "strainRelief" && b.angle === 0);
          return { objectIds: [c.id], objectKind: "connector" as const, message: `${c.refDes} has no backshell.`, fix: bs ? { label: "Add strain-relief backshell", commands: [setBackshell({ id: c.id, backshell: { pn: bs.pn, clockingDeg: 0, auto: true } })] } : undefined };
        });
    },
  },
  {
    id: "unreviewed_geometry",
    name: "Insert geometry not reviewed",
    description: "Cavity coordinates for this insert are machine-extracted and not yet reviewed.",
    example: "Insert 13-35 (unreviewed).",
    category: "Components",
    params: [],
    depends: ["connector"],
    review: true,
    evaluate(ctx) {
      return ctx.h.connectors
        .map((c) => ({ c, part: ctx.cat.connector(c.pn) }))
        .filter((x) => x.part && x.part.arrangement.status !== "verified")
        .map(({ c, part }) => ({ objectIds: [c.id], objectKind: "connector", message: `${c.refDes}: insert ${part!.arrangement.id} geometry is ${part!.arrangement.status} (MIL-STD-1560C extraction). Face view, adjacency and fixture data can't be relied on until it's reviewed.` }));
    },
  },
  {
    id: "reference_data_status",
    name: "Reference data not reviewed",
    description: "Catalog fields the build depends on (contact tooling, wire OD/mass, finishing part dimensions) must be reviewed, not seed values.",
    example: "Crimp tool for M39029/58-360 is seed data.",
    category: "Components",
    params: [],
    depends: ["bom"],
    review: true,
    evaluate(ctx) {
      const out: Violation[] = [];
      const seen = new Set<string>();
      const flag = (key: string, ids: string[], msg: string) => {
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ objectIds: ids, objectKind: "bom", message: msg });
      };
      for (const l of ctx.bom().lines) {
        if (l.category === "Connectors") continue; // insert geometry is its own check (unreviewed_geometry)
        if (l.dataStatus && l.dataStatus !== "verified") flag(`p:${l.pn}`, l.objectIds, `${l.pn}: ${l.dataFields ?? "catalog data"} ${l.dataStatus === "seed" ? "is seed data" : "is unreviewed"}; verify before release.`);
      }
      return out;
    },
  },
  {
    id: "contact_compatibility",
    name: "Contact doesn't match connector or cavity",
    description: "Contact gender must match the connector, contact size must match the cavity, and the contact must exist in the catalog.",
    example: "M39029/58-360 (pin) on a socket connector.",
    category: "Electrical",
    params: [],
    depends: ["connector", "wire", "termination"],
    evaluate(ctx) {
      const out: Violation[] = [];
      const wired = new Map<string, number>();
      for (const w of ctx.h.wires) for (const e of pinEnds(w)) wired.set(`${e.connectorId}:${e.cavityId}`, w.gauge);
      for (const t of ctx.h.terminations) if (t.method === "drainToPin" && t.drainPin) wired.set(`${t.drainPin.connectorId}:${t.drainPin.cavityId}`, t.drain?.gauge ?? 22);
      for (const c of ctx.h.connectors) {
        const part = ctx.cat.connector(c.pn);
        if (!part) continue;
        const cavs = new Set([...Object.keys(c.pins).filter((k) => c.pins[k]!.contactPn || c.pins[k]!.filler), ...[...wired.keys()].filter((k) => k.startsWith(`${c.id}:`)).map((k) => k.slice(c.id.length + 1))]);
        for (const cavId of cavs) {
          const cav = ctx.cat.cavity(c.pn, cavId);
          if (!cav || cav.special) continue;
          const pn = contactPnFor(ctx.h, ctx.cat, c.id, cavId, wired.get(`${c.id}:${cavId}`) ?? 22);
          const cp = pn ? ctx.cat.contactsByPn.get(pn) : undefined;
          const where = pinLabel(ctx, c.id, cavId);
          if (!pn || !cp) {
            out.push({ objectIds: [c.id], objectKind: "pin", message: `${where}: contact ${pn ?? `size ${cav.size} ${part.gender}`} is not in the catalog; compatibility can't be confirmed.` });
            continue;
          }
          const problems: string[] = [];
          if (cp.gender !== part.gender) problems.push(`${cp.gender} contact in a ${part.gender} insert`);
          if (cp.size !== cav.size) problems.push(`size ${cp.size} contact in a size ${cav.size} cavity`);
          if (problems.length) out.push({ objectIds: [c.id], objectKind: "pin", message: `${where}: ${cp.pn} doesn't fit (${problems.join("; ")}).` });
        }
      }
      return out;
    },
  },
  {
    id: "net_topology",
    name: "Multi-pin net construction not chosen",
    description:
      "A net with 3 or more pins needs a construction that puts one conductor in each contact, or an explicitly chosen one: parallel wires (pins on exactly two connectors, same count on each, wired pin-to-pin), a splice, or a confirmed daisy chain (two wires in one contact).",
    example: "GND on P1, P2 and P3 with no splice and no confirmation.",
    category: "Connectivity",
    params: [],
    depends: ["net", "splice"],
    evaluate(ctx) {
      return ctx.h.nets
        .filter((n) => {
          if (n.members.length < 3) return false;
          const t = effectiveTopology(n);
          if (t === "parallel") return false; // one wire per contact, no splice: nothing to confirm
          if (t === "splice") return !ctx.h.splices.some((s) => s.netId === n.id);
          return !n.topologyConfirmed;
        })
        .map((n) => {
          const conns = new Set(n.members.map((m) => m.connectorId)).size;
          const why = conns === 2 ? "its pins aren't split evenly between the two connectors, so they can't be wired pin-to-pin" : conns > 2 ? `it spans ${conns} connectors` : "all its pins are on one connector";
          return {
            objectIds: [n.id, ...n.members.map((m) => m.connectorId)],
            objectKind: "net" as const,
            message: `${n.name} joins ${n.members.length} pins and ${why}. It's assumed to be a daisy chain (two wires crimped in one contact): confirm that or use a splice.`,
            fix: { label: "Use a splice", commands: [setNetProps({ ids: [n.id], topology: "splice" })] },
          };
        });
    },
  },
  {
    id: "assumed_dimensions",
    name: "Dimension not confirmed",
    description: "Segment lengths created from defaults are assumptions until someone enters or confirms them.",
    example: "Segment P1–P2 is the default 12 in.",
    category: "Documentation",
    params: [],
    depends: ["segment", "node", "termination"],
    review: true,
    evaluate(ctx) {
      const out: Violation[] = ctx.h.segments
        .filter((s) => s.lengthSource === "default")
        .map((s) => ({ objectIds: [s.id], objectKind: "segment" as const, message: `Segment ${segmentLabel(ctx, s.id)} length ${ctx.len(s.lengthMm)} is a default; enter or confirm the real length.`, fix: { label: "Confirm length", commands: [setSegmentProps({ ids: [s.id], lengthSource: "confirmed" })] } }));
      for (const t of ctx.h.terminations)
        if (t.drain?.lengthSource === "default")
          out.push({ objectIds: [t.targetId, t.nodeId], objectKind: "termination", message: `Drain pigtail at ${nodeName(ctx, t.nodeId)} is the default ${ctx.len(t.drain.lengthMm)}; confirm its length.`, fix: { label: "Confirm length", commands: [setDrain({ id: t.id, lengthSource: "confirmed" })] } });
      return out;
    },
  },
  {
    id: "unknown_part",
    name: "Part not in catalog",
    description: "Every part number must resolve in the component catalog.",
    example: "Typo in an imported PN.",
    category: "Components",
    params: [],
    depends: ["bom"],
    evaluate(ctx) {
      return ctx
        .bom()
        .lines.filter((l) => !l.known)
        .map((l) => ({ objectIds: l.objectIds, objectKind: "bom", message: `${l.pn} is not in the catalog.` }));
    },
  },

  // Documentation
  {
    id: "missing_refdes",
    name: "Connector missing reference designator",
    description: "Every connector needs a reference designator.",
    example: "Blank refDes.",
    category: "Documentation",
    params: [],
    depends: ["connector"],
    evaluate(ctx) {
      return ctx.h.connectors.filter((c) => !c.refDes.trim()).map((c) => ({ objectIds: [c.id], objectKind: "connector", message: `Connector ${c.pn} has no refDes.` }));
    },
  },
  {
    id: "duplicate_refdes",
    name: "Duplicate reference designator",
    description: "No two connectors may share a refDes.",
    example: "Two connectors named P1.",
    category: "Documentation",
    params: [],
    depends: ["connector"],
    evaluate(ctx) {
      const by = new Map<string, string[]>();
      for (const c of ctx.h.connectors) if (c.refDes) (by.get(c.refDes) ?? by.set(c.refDes, []).get(c.refDes)!).push(c.id);
      return [...by].filter(([, ids]) => ids.length > 1).map(([r, ids]) => ({ objectIds: ids, objectKind: "connector", message: `RefDes ${r} is used ${ids.length} times.` }));
    },
  },
  {
    id: "unnamed_nets",
    name: "Net not named",
    description: "Nets still carry an automatic name.",
    example: "NET_003.",
    category: "Documentation",
    params: [],
    depends: ["net"],
    evaluate(ctx) {
      return ctx.h.nets.filter((n) => isAutoNetName(n.name)).map((n) => ({ objectIds: [n.id], objectKind: "net", message: `${n.name} has an automatic name.` }));
    },
  },
  {
    id: "label_length",
    name: "Label text too long for the label",
    description: "Resolved label text must fit the printable length.",
    example: "40 characters on a 25 mm sleeve.",
    category: "Documentation",
    params: [],
    depends: ["label", "connector", "wire"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const l of ctx.h.labels) {
        const lp = ctx.cat.label(l.pn);
        if (!lp) continue;
        const t = l.attachedTo;
        const text = resolveLabelTemplate(l.template, {
          refDes: t.kind === "connector" ? ctx.refDes(t.id) : undefined,
          wireId: t.kind === "wire" ? ctx.h.wires.find((w) => w.id === t.id)?.label : undefined,
          harnessPN: ctx.project.partNumber,
          rev: ctx.rev.label,
        });
        const need = text.length / lp.charsPerMm;
        if (need > lp.printableLengthMm) out.push({ objectIds: [l.id, t.id], objectKind: "label", message: `Label "${text}" needs ${ctx.len(need)} but ${lp.pn} prints ${ctx.len(lp.printableLengthMm)}.` });
      }
      return out;
    },
  },

  // Finishing
  {
    id: "layer_size_fit",
    name: "Covering size doesn't fit the diameter",
    description: "Braid, sleeve and heat shrink must fit the diameter underneath.",
    example: "6 mm braid over a 9 mm bundle.",
    category: "Finishing",
    params: [],
    depends: ["layer", "segment", "wire"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const l of ctx.h.layers) {
        if (l.type === "tape") continue;
        for (const e of l.extents) {
          const part = ctx.cat.layer(e.pn ?? l.pn);
          if (!part) continue;
          const dia = diameterUnderLayer(ctx.d, e.segmentId, l.id);
          if (dia < part.minDiaMm - 1e-6 || dia > part.maxDiaMm + 1e-6) {
            out.push({
              objectIds: [l.id, e.segmentId],
              objectKind: "layer",
              message: `${part.description}: range ${ctx.len(part.minDiaMm)}–${ctx.len(part.maxDiaMm)} doesn't fit ${ctx.len(dia)} on ${segmentLabel(ctx, e.segmentId)}.`,
              fix: l.pinned ? { label: "Auto-size", commands: [updateLayer({ id: l.id, pinned: false })] } : undefined,
            });
            break;
          }
        }
      }
      return out;
    },
  },
  {
    id: "clamp_size_fit",
    name: "Band clamp size doesn't fit",
    description: "Band clamp range must contain the diameter under the clamp.",
    example: "Small clamp on a 20 mm braid.",
    category: "Finishing",
    params: [],
    depends: ["clamp", "termination", "layer", "segment"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const c of ctx.h.clamps) {
        const cp = ctx.cat.clamp(c.pn);
        const t = ctx.h.terminations.find((x) => x.id === c.terminationId);
        if (!t) continue;
        const dia = terminationDiameter(ctx.h, ctx.d, t);
        if (!cp) out.push({ objectIds: [c.id, t.nodeId], objectKind: "clamp", message: `No band clamp fits ${ctx.len(dia)} at ${nodeName(ctx, t.nodeId)}.` });
        else if (dia < cp.minDiaMm || dia > cp.maxDiaMm) out.push({ objectIds: [c.id, t.nodeId], objectKind: "clamp", message: `${cp.pn} (${ctx.len(cp.minDiaMm)}–${ctx.len(cp.maxDiaMm)}) doesn't fit ${ctx.len(dia)} at ${nodeName(ctx, t.nodeId)}.` });
      }
      return out;
    },
  },
  {
    id: "boot_size_fit",
    name: "Boot size doesn't fit",
    description: "Boot or transition must fit the diameter at the node.",
    example: "Boot too small for the jacketed bundle.",
    category: "Finishing",
    params: [],
    depends: ["boot", "segment", "layer"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const b of ctx.h.boots) {
        const bp = ctx.cat.boot(b.pn);
        const od = ctx.d.nodeOdMm.get(b.nodeId) ?? 0;
        if (!bp) out.push({ objectIds: [b.id, b.nodeId], objectKind: "boot", message: `No ${b.shape} boot fits ${ctx.len(od)} at ${nodeName(ctx, b.nodeId)}.` });
        else if (od > bp.maxDiaMm || od < bp.minDiaMm) out.push({ objectIds: [b.id, b.nodeId], objectKind: "boot", message: `${bp.pn} (${ctx.len(bp.minDiaMm)}–${ctx.len(bp.maxDiaMm)}) doesn't fit ${ctx.len(od)} at ${nodeName(ctx, b.nodeId)}.` });
      }
      return out;
    },
  },
  {
    id: "band360_without_platform",
    name: "360° termination has no band-clamp platform",
    description: "A 360° band-clamp termination needs an EMI backshell with a band platform.",
    example: "Overbraid band-clamped to a strain-relief backshell.",
    category: "Finishing",
    params: [],
    depends: ["termination", "connector"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const t of ctx.h.terminations) {
        if (t.method !== "band360") continue;
        const n = ctx.h.nodes.find((x) => x.id === t.nodeId);
        if (!n || n.kind !== "connector") continue;
        const c = ctx.h.connectors.find((x) => x.id === n.connectorId)!;
        const bs = c.backshell && ctx.cat.backshell(c.backshell.pn);
        if (!bs || !bs.bandPlatform) {
          const part = ctx.cat.connector(c.pn);
          const emi = part && ctx.cat.backshellsFor(part.shellSize).find((b) => b.bandPlatform && b.angle === (bs ? bs.angle : 0));
          out.push({ objectIds: [c.id, t.targetId], objectKind: "termination", message: `${c.refDes}: 360° termination but ${bs ? `${bs.pn} has no band-clamp platform` : "no backshell"}.`, fix: emi ? { label: "Use EMI band-clamp backshell", commands: [setBackshell({ id: c.id, backshell: { pn: emi.pn, clockingDeg: c.backshell?.clockingDeg ?? 0, auto: true } })] } : undefined });
        }
      }
      return out;
    },
  },
  {
    id: "shield_unterminated",
    name: "Shield or braid not terminated",
    description: "Shields and braids need a grounded termination at one end at least.",
    example: "Shield floating at both ends.",
    category: "Finishing",
    params: [],
    depends: ["shield", "termination", "layer"],
    evaluate(ctx) {
      const out: Violation[] = [];
      const targets = [...ctx.h.shields.map((s) => ({ id: s.id, name: `Shield ${s.label}` })), ...ctx.h.layers.filter((l) => l.type === "overbraid").map((l) => ({ id: l.id, name: "Overbraid" }))];
      for (const t of targets) {
        const terms = ctx.h.terminations.filter((x) => x.targetId === t.id);
        const grounded = terms.filter((x) => ["band360", "emiRing", "drainToPin"].includes(x.method));
        if (terms.length && !grounded.length) {
          const first = terms.find((x) => ctx.h.nodes.find((n) => n.id === x.nodeId)?.kind === "connector") ?? terms[0]!;
          out.push({ objectIds: [t.id, ...terms.map((x) => x.nodeId)], objectKind: "shield", message: `${t.name} is not grounded at either end.`, fix: { label: `Terminate 360° at ${nodeName(ctx, first.nodeId)}`, commands: [setTermination({ id: first.id, method: "band360" })] } });
        }
      }
      return out;
    },
  },
  {
    id: "layer_stack_order",
    name: "Layer stack order not buildable",
    description: "Layers must be in a buildable order.",
    example: "Jacket under an overbraid.",
    category: "Finishing",
    params: [],
    depends: ["layer", "segment"],
    evaluate(ctx) {
      const out: Violation[] = [];
      const rank: Record<string, number> = { tape: 0, sleeve: 1, overbraid: 1, heatShrink: 2, jacket: 2, conduit: 3 };
      for (const s of ctx.h.segments) {
        const stack = ctx.d.segStack.get(s.id) ?? [];
        for (let i = 1; i < stack.length; i++) {
          const below = stack[i - 1]!.layer;
          const above = stack[i]!.layer;
          if (rank[below.type]! > rank[above.type]! && !(below.type === "heatShrink" && above.type === "overbraid")) {
            out.push({ objectIds: [s.id, below.id, above.id], objectKind: "segment", message: `${segmentLabel(ctx, s.id)}: ${below.type} under ${above.type} can't be built.` });
            break;
          }
        }
      }
      return out;
    },
  },
  {
    id: "extent_overlap",
    name: "Partial layers of the same type overlap",
    description: "Two layers of the same type overlap on a segment.",
    example: "Two abrasion sleeves overlapping.",
    category: "Finishing",
    params: [],
    depends: ["layer", "segment"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const s of ctx.h.segments) {
        const ls = ctx.h.layers.filter((l) => l.extents.some((e) => e.segmentId === s.id));
        for (let i = 0; i < ls.length; i++)
          for (let j = i + 1; j < ls.length; j++) {
            if (ls[i]!.type !== ls[j]!.type) continue;
            const [a1, b1] = extentCoverage(s, ls[i]!.extents.find((e) => e.segmentId === s.id)!);
            const [a2, b2] = extentCoverage(s, ls[j]!.extents.find((e) => e.segmentId === s.id)!);
            if (Math.min(b1, b2) - Math.max(a1, a2) > 1) out.push({ objectIds: [s.id, ls[i]!.id, ls[j]!.id], objectKind: "layer", message: `Two ${ls[i]!.type} layers overlap on ${segmentLabel(ctx, s.id)}.` });
          }
      }
      return out;
    },
  },
  {
    id: "grommet_sealing",
    name: "Wire OD outside grommet sealing range",
    description: "Finished wire OD must be within the grommet sealing range for the contact size.",
    example: "0.9 mm wire in a size 20 cavity (1.02–2.11 mm).",
    category: "Finishing",
    params: [],
    depends: ["wire", "connector"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const w of ctx.h.wires) {
        const od = ctx.d.wireOdMm.get(w.id) ?? 0;
        for (const e of pinEnds(w)) {
          const c = ctx.h.connectors.find((x) => x.id === e.connectorId);
          const cav = c && ctx.cat.cavity(c.pn, e.cavityId);
          const cs = cav && ctx.cat.contactSize(cav.size);
          if (!cs || cav!.special) continue;
          if (od < cs.sealingMinMm - 1e-6 || od > cs.sealingMaxMm + 1e-6) {
            const alt = ctx.cat.wireSpecs().map((s) => ctx.cat.wire(s, w.gauge)).find((x) => x && x.odMm >= cs.sealingMinMm && x.odMm <= cs.sealingMaxMm);
            out.push({
              objectIds: [w.id, c!.id],
              objectKind: "wire",
              message: `${wireDesc(ctx, w)}: OD ${ctx.len(od)} outside size ${cav!.size} sealing range ${ctx.len(cs.sealingMinMm)}–${ctx.len(cs.sealingMaxMm)} at ${pinLabel(ctx, c!.id, e.cavityId)}.`,
              fix: alt ? { label: `Use ${alt.spec}`, commands: [setWireProps({ ids: [w.id], spec: alt.spec })] } : undefined,
            });
            break;
          }
        }
      }
      return out;
    },
  },
  {
    id: "manual_finishing",
    name: "Finishing step done by hand",
    description: "Potting, boots and splice covers are manual operations.",
    example: "Potted P1.",
    category: "Finishing",
    params: [],
    depends: ["potting", "boot", "splice"],
    manual: true,
    evaluate(ctx) {
      const out: Violation[] = [];
      if (!ctx.profile.capabilities.supportsPotting) for (const p of ctx.h.potting) out.push({ objectIds: [p.id, p.targetId], objectKind: "potting", message: `Potting at ${p.targetKind === "connector" ? ctx.refDes(p.targetId) : "splice"} is manual (+${ctx.cat.potting(p.compoundPn)?.cureHours ?? 24} h cure).` });
      for (const b of ctx.h.boots) out.push({ objectIds: [b.id, b.nodeId], objectKind: "boot", message: `${b.shape === "straight" || b.shape === "90" ? "Boot" : "Transition"} at ${nodeName(ctx, b.nodeId)} is fitted by hand.` });
      return out;
    },
  },
  {
    id: "drain_pin_ground",
    name: "Drain not on a ground pin",
    description: "A drain-to-pin termination needs a pin on a ground-class net.",
    example: "Drain landed on a signal pin.",
    category: "Finishing",
    params: [],
    depends: ["termination", "net"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const t of ctx.h.terminations) {
        if (t.method !== "drainToPin") continue;
        if (!t.drainPin) {
          out.push({ objectIds: [t.targetId, t.nodeId], objectKind: "termination", message: `Drain-to-pin at ${nodeName(ctx, t.nodeId)} has no pin assigned.` });
          continue;
        }
        const net = ctx.h.nets.find((n) => n.members.some((m) => m.connectorId === t.drainPin!.connectorId && m.cavityId === t.drainPin!.cavityId));
        if (!net || net.cls !== "ground") out.push({ objectIds: [t.targetId, t.drainPin.connectorId], objectKind: "termination", message: `Drain at ${pinLabel(ctx, t.drainPin.connectorId, t.drainPin.cavityId)} is on ${net ? `${net.name} (${net.cls})` : "no net"}, not a ground net.` });
      }
      return out;
    },
  },
  {
    id: "braid_coverage_min",
    name: "Braid coverage below minimum",
    description: "Optical coverage of shields and overbraids must meet the minimum.",
    example: "80 % braid where 90 % is required.",
    category: "Finishing",
    params: [{ key: "minPct", label: "Minimum coverage", type: "number", unit: "%", stricter: "higher", default: 80 }],
    depends: ["shield", "layer"],
    evaluate(ctx, p) {
      const min = Math.max(Number(p.minPct ?? 0), ctx.ped.process.minBraidCoverage ?? 0);
      const out: Violation[] = [];
      for (const s of ctx.h.shields) if (s.coverage < min) out.push({ objectIds: [s.id, ...s.wireIds], objectKind: "shield", message: `Shield ${s.label} coverage ${s.coverage} % is below ${min} %.`, fix: { label: `Set ${min} %`, commands: [setShieldProps({ id: s.id, coverage: min })] } });
      for (const l of ctx.h.layers.filter((x) => x.type === "overbraid")) {
        const c = l.params.coveragePct ?? 85;
        if (c < min) out.push({ objectIds: [l.id, ...l.extents.map((e) => e.segmentId)], objectKind: "layer", message: `Overbraid coverage ${c} % is below ${min} %.`, fix: { label: `Set ${min} %`, commands: [updateLayer({ id: l.id, params: { coveragePct: min } })] } });
      }
      return out;
    },
  },
  {
    id: "sealed_cavities",
    name: "Cavity not sealed",
    description: "Each cavity must hold a contact with one conductor or a catalog sealing plug. Checks unsupported cavities, missing plugs, named-but-unwired pins, contacts without a conductor, and two wires in one grommet hole.",
    example: "P1-4 has a contact override but no wire.",
    category: "Finishing",
    params: [],
    depends: ["connector", "wire", "termination"],
    evaluate(ctx) {
      const out: Violation[] = [];
      for (const c of ctx.h.connectors) {
        const part = ctx.cat.connector(c.pn);
        if (!part) continue;
        const known = new Set(part.arrangement.cavities.map((x) => x.id));
        const unknown = Object.keys(c.pins).filter((k) => !known.has(k));
        if (unknown.length) out.push({ objectIds: [c.id], objectKind: "connector", message: `${c.refDes}: cavities ${unknown.join(", ")} aren't on insert ${part.arrangement.id}; sealing can't be checked.` });
        const issues: string[] = [];
        for (const s of cavityStates(ctx.h, ctx.cat, c.id)) {
          const where = `${c.refDes}-${s.cavityId}`;
          if (s.fill === "unsupported") issues.push(`${where}: size ${s.size} shielded cavity has no catalog contact or plug`);
          else if (s.fill === "plug" && !ctx.cat.sealingPlug(s.size)) issues.push(`${where}: no size ${s.size} sealing plug in the catalog`);
          if (s.gauges.length > 1) issues.push(`${where}: ${s.gauges.length} conductors in one grommet hole won't seal`);
          if (s.contactWithoutConductor) issues.push(`${where}: contact specified but no conductor (use a wired spare or a plug)`);
          if (s.assignedUnwired) issues.push(`${where}: signal assigned but unwired, so it will be plugged`);
        }
        if (issues.length) out.push({ objectIds: [c.id], objectKind: "connector", message: `${issues.slice(0, 4).join("; ")}${issues.length > 4 ? `; +${issues.length - 4} more` : ""}.` });
      }
      return out;
    },
  },

  // ─── Design rule types (§9.5.2) ───────────────────────────────────────────
  {
    id: "gauge_min_by_class",
    name: "Wire thinner than net-class minimum",
    description: "Nets of a class must use this gauge or heavier.",
    example: "Power nets ≥ 18 AWG.",
    category: "Electrical",
    params: [
      { key: "netClass", label: "Net class", type: "netClass" },
      { key: "maxGauge", label: "Thinnest allowed gauge", type: "number", unit: "AWG", stricter: "lower", default: 20 },
    ],
    depends: ["wire", "net"],
    scoped: true,
    evaluate(ctx, p, rule) {
      const max = Number(p.maxGauge);
      return ctx.h.wires
        .filter((w) => w.gauge > max && netInScope(netOf(ctx.h, w.netId), p, rule))
        .map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} is ${w.gauge} AWG; ${p.netClass ?? "these"} nets need ${max} AWG or heavier.`, fix: ctx.cat.wire(w.spec, max) ? { label: `Change to ${max} AWG`, commands: [setWireProps({ ids: [w.id], gauge: max })] } : undefined }));
    },
  },
  {
    id: "derating_table",
    name: "Wire over derated current (table)",
    description: "Maximum current per gauge, reduced for bundle size (table-driven, e.g. from an AS50881-style table you enter).",
    example: "22 AWG ≤ 3 A in bundles of 15+ wires.",
    category: "Electrical",
    params: [
      { key: "table", label: "Max current by gauge (A)", type: "table", default: { "26": 2, "24": 3, "22": 5, "20": 7.5, "18": 10, "16": 13, "14": 17, "12": 23 } },
      { key: "bundleFactor", label: "Factor for bundles ≥ 15 wires", type: "number", stricter: "lower", default: 0.8 },
    ],
    depends: ["wire", "net", "segment"],
    scoped: true,
    evaluate(ctx, p, rule) {
      const out: Violation[] = [];
      const table = (p.table ?? {}) as Record<string, number>;
      for (const w of ctx.h.wires) {
        const n = netOf(ctx.h, w.netId);
        if (!n?.currentA || !netInScope(n, p, rule)) continue;
        const base = table[String(w.gauge)];
        if (base == null) continue;
        const maxWires = Math.max(0, ...(ctx.d.routes.get(w.id) ?? []).map((sid) => ctx.d.segWires.get(sid)?.length ?? 0));
        const lim = maxWires >= 15 ? base * Number(p.bundleFactor ?? 1) : base;
        if (n.currentA > lim) out.push({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)}: ${n.currentA} A exceeds ${lim.toFixed(1)} A for ${w.gauge} AWG${maxWires >= 15 ? ` in a ${maxWires}-wire bundle` : ""}.` });
      }
      return out;
    },
  },
  {
    id: "required_twist",
    name: "Required twist missing",
    description: "Nets matching a class or name pattern must be twisted.",
    example: "^CAN_ must be a twisted pair.",
    category: "EMC",
    params: [
      { key: "namePattern", label: "Net name pattern (regex)", type: "regex" },
      { key: "netClass", label: "Net class", type: "netClass" },
    ],
    depends: ["wire", "net", "twist"],
    evaluate(ctx, p, rule) {
      return ctx.h.wires.filter((w) => !w.twistGroupId && netInScope(netOf(ctx.h, w.netId), p, rule)).map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} must be twisted.` }));
    },
  },
  {
    id: "required_shield",
    name: "Required shield missing",
    description: "Nets matching a class or name pattern must be individually shielded.",
    example: "RF_* must be shielded.",
    category: "EMC",
    params: [
      { key: "namePattern", label: "Net name pattern (regex)", type: "regex" },
      { key: "netClass", label: "Net class", type: "netClass" },
    ],
    depends: ["wire", "net", "shield"],
    evaluate(ctx, p, rule) {
      return ctx.h.wires.filter((w) => !w.shieldId && netInScope(netOf(ctx.h, w.netId), p, rule)).map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} must be individually shielded.` }));
    },
  },
  {
    id: "pin_adjacency",
    name: "Pins of separated classes too close",
    description: "Nets of class A must not sit in cavities adjacent to class B (uses insert cavity coordinates).",
    example: "Power not next to analog.",
    category: "EMC",
    params: [
      { key: "classA", label: "Class A", type: "netClass" },
      { key: "classB", label: "Class B", type: "netClass" },
      { key: "minMm", label: "Minimum centre spacing", type: "number", unit: "mm", stricter: "higher", optional: true, help: "Blank = adjacent cavities" },
    ],
    depends: ["net", "connector"],
    evaluate(ctx, p) {
      const out: Violation[] = [];
      for (const c of ctx.h.connectors) {
        const cavs = ctx.cat.connector(c.pn)?.arrangement.cavities;
        if (!cavs) continue;
        const cls = new Map<string, Net>();
        for (const [cav, pin] of Object.entries(c.pins)) if (pin.netId) cls.set(cav, netOf(ctx.h, pin.netId)!);
        const adj = adjacency(cavs, p.minMm ? Number(p.minMm) : undefined);
        const seen = new Set<string>();
        for (const [cav, net] of cls) {
          if (net.cls !== p.classA) continue;
          for (const o of adj.get(cav) ?? []) {
            const on = cls.get(o);
            if (on && on.cls === p.classB && !seen.has(`${cav}|${o}`)) {
              seen.add(`${cav}|${o}`);
              out.push({ objectIds: [c.id, net.id, on.id], objectKind: "pin", message: `${c.refDes}: ${net.name} (${p.classA}) at ${cav} is adjacent to ${on.name} (${p.classB}) at ${o}.` });
            }
          }
        }
      }
      return out;
    },
  },
  {
    id: "segregation",
    name: "Segregated nets share a bundle",
    description: "Net classes that must not share a bundle segment.",
    example: "Noisy power and sensitive analog.",
    category: "EMC",
    params: [
      { key: "classA", label: "Class A", type: "netClass" },
      { key: "classB", label: "Class B", type: "netClass" },
    ],
    depends: ["wire", "net", "segment"],
    evaluate(ctx, p) {
      const out: Violation[] = [];
      for (const s of ctx.h.segments) {
        const classes = new Set((ctx.d.segWires.get(s.id) ?? []).map((wid) => netOf(ctx.h, ctx.h.wires.find((w) => w.id === wid)!.netId)?.cls));
        if (classes.has(p.classA) && classes.has(p.classB)) out.push({ objectIds: [s.id], objectKind: "segment", message: `${segmentLabel(ctx, s.id)} carries both ${p.classA} and ${p.classB} nets.` });
      }
      return out;
    },
  },
  {
    id: "spare_pins",
    name: "Too few spare pins",
    description: "Minimum share of unused cavities per connector.",
    example: "≥ 10 % spares at T1.",
    category: "Design",
    params: [{ key: "minPct", label: "Minimum spare cavities", type: "number", unit: "%", stricter: "higher", default: 10 }],
    depends: ["connector", "net"],
    evaluate(ctx, p) {
      const out: Violation[] = [];
      for (const c of ctx.h.connectors) {
        const part = ctx.cat.connector(c.pn);
        if (!part) continue;
        const total = part.arrangement.contactCount;
        const used = Object.values(c.pins).filter((x) => x.netId).length;
        const pct = ((total - used) / total) * 100;
        if (pct + 1e-9 < Number(p.minPct)) out.push({ objectIds: [c.id], objectKind: "connector", message: `${c.refDes}: ${total - used} of ${total} cavities spare (${pct.toFixed(0)} %), minimum ${p.minPct} %.` });
      }
      return out;
    },
  },
  {
    id: "allowed_parts",
    name: "Part not allowed",
    description: "Connector finishes, wire specs and colors that are allowed or banned.",
    example: "No cadmium finishes (W, J).",
    category: "Parts",
    params: [
      { key: "bannedFinishes", label: "Banned shell classes", type: "stringList" },
      { key: "allowedWireSpecs", label: "Allowed wire specs", type: "stringList" },
      { key: "bannedColors", label: "Banned wire color codes", type: "stringList" },
    ],
    depends: ["connector", "wire"],
    evaluate(ctx, p) {
      const out: Violation[] = [];
      const banned: string[] = p.bannedFinishes ?? [];
      for (const c of ctx.h.connectors) {
        const part = ctx.cat.connector(c.pn);
        if (part && banned.includes(part.finish)) out.push({ objectIds: [c.id], objectKind: "connector", message: `${c.refDes}: class ${part.finish} (${part.finishInfo.finish}) is not allowed.` });
      }
      const specs: string[] = p.allowedWireSpecs ?? [];
      const colors: string[] = (p.bannedColors ?? []).map(String);
      for (const w of ctx.h.wires) {
        if (specs.length && !specs.includes(w.spec)) out.push({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)}: ${w.spec} is not an allowed wire spec.` });
        if (colors.includes(String(w.color.base))) out.push({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)}: color ${colorName(w.color.base)} is not allowed.` });
      }
      return out;
    },
  },
  {
    id: "naming",
    name: "Name doesn't follow convention",
    description: "Regex on net names, refDes, wire IDs or labels.",
    example: "Nets upper-case only.",
    category: "Documentation",
    params: [
      { key: "target", label: "Applies to", type: "enum", options: ["net", "connector", "wire"] },
      { key: "pattern", label: "Pattern (regex)", type: "regex" },
    ],
    depends: ["net", "connector", "wire"],
    evaluate(ctx, p) {
      const re = safeRegExp(p.pattern ?? ".*");
      if (p.target === "connector") return ctx.h.connectors.filter((c) => !re.test(c.refDes)).map((c) => ({ objectIds: [c.id], objectKind: "connector", message: `RefDes ${c.refDes} doesn't match ${p.pattern}.` }));
      if (p.target === "wire") return ctx.h.wires.filter((w) => !re.test(w.label)).map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `Wire ID ${w.label} doesn't match ${p.pattern}.` }));
      return ctx.h.nets.filter((n) => !re.test(n.name)).map((n) => ({ objectIds: [n.id], objectKind: "net", message: `Net ${n.name} doesn't match ${p.pattern}.` }));
    },
  },
  {
    id: "required_labels",
    name: "Required label missing",
    description: "Every connector, wire (both ends) or segment must carry a label.",
    example: "Every connector end labeled.",
    category: "Documentation",
    params: [{ key: "target", label: "Applies to", type: "enum", options: ["connector", "wire", "segment"] }],
    depends: ["label", "connector", "wire", "segment"],
    evaluate(ctx, p) {
      const count = (kind: string, id: string) => ctx.h.labels.filter((l) => l.attachedTo.kind === kind && l.attachedTo.id === id).length;
      if (p.target === "wire") return ctx.h.wires.filter((w) => count("wire", w.id) < 2).map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} needs an ID label at both ends.` }));
      if (p.target === "segment") return ctx.h.segments.filter((s) => count("segment", s.id) < 1).map((s) => ({ objectIds: [s.id], objectKind: "segment", message: `${segmentLabel(ctx, s.id)} needs a label.` }));
      return ctx.h.connectors.filter((c) => count("connector", c.id) < 1).map((c) => ({ objectIds: [c.id], objectKind: "connector", message: `${c.refDes} needs a label.` }));
    },
  },
  {
    id: "color_coding",
    name: "Wire color doesn't match coding",
    description: "Net class or name pattern → required wire color (MIL-STD-681 code).",
    example: "Power = 2 (red).",
    category: "Documentation",
    params: [
      { key: "netClass", label: "Net class", type: "netClass" },
      { key: "namePattern", label: "Net name pattern (regex)", type: "regex" },
      { key: "color", label: "Required base color code", type: "string" },
    ],
    depends: ["wire", "net"],
    evaluate(ctx, p, rule) {
      const code = Number(p.color);
      return ctx.h.wires
        .filter((w) => !w.cableId && netInScope(netOf(ctx.h, w.netId), p, rule) && w.color.base !== code)
        .map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} is ${formatWireColor(w.color)}; required base color ${code} ${colorName(code)}.`, fix: { label: `Set ${colorName(code)}`, commands: [setWireProps({ ids: [w.id], color: { base: code, stripes: w.color.stripes } })] } }));
    },
  },
  {
    id: "cvd_confusable",
    name: "CVD-confusable wire colors",
    description: "Flags wires on the same connector whose colors are easily confused by color-vision-deficient technicians and have no other distinguishing feature.",
    example: "Red and green wires on P1 without stripes.",
    category: "Human factors",
    params: [{ key: "minDeltaE", label: "Minimum ΔE under CVD", type: "number", stricter: "higher", default: 25, help: "Red/green fall to about ΔE 20 under deuteranopia" }],
    depends: ["wire", "connector"],
    evaluate(ctx, p) {
      const out: Violation[] = [];
      const min = Number(p.minDeltaE ?? 25);
      for (const c of ctx.h.connectors) {
        const ws = ctx.h.wires.filter((w) => pinEnds(w).some((e) => e.connectorId === c.id) && !w.color.stripes.length);
        const bases = [...new Set(ws.map((w) => w.color.base))];
        for (let i = 0; i < bases.length; i++)
          for (let j = i + 1; j < bases.length; j++) {
            const a = wireColor(bases[i]!, "light");
            const b = wireColor(bases[j]!, "light");
            const d = Math.min(deltaE(simulateCvd(a, "deutan"), simulateCvd(b, "deutan")), deltaE(simulateCvd(a, "protan"), simulateCvd(b, "protan")));
            if (d < min) out.push({ objectIds: [c.id, ...ws.filter((w) => w.color.base === bases[i] || w.color.base === bases[j]).map((w) => w.id)], objectKind: "connector", message: `${c.refDes}: ${colorName(bases[i]!)} and ${colorName(bases[j]!)} wires are hard to tell apart under CVD (ΔE ${d.toFixed(0)}).` });
          }
      }
      return out;
    },
  },
  {
    id: "max_length",
    name: "Wire or segment too long",
    description: "Maximum length per wire or per segment.",
    example: "No segment longer than 2 m.",
    category: "Mechanical",
    params: [
      { key: "target", label: "Applies to", type: "enum", options: ["wire", "segment"] },
      { key: "maxMm", label: "Maximum length", type: "number", unit: "mm", stricter: "lower" },
    ],
    depends: ["wire", "segment"],
    evaluate(ctx, p) {
      const max = Number(p.maxMm);
      if (p.target === "segment") return ctx.h.segments.filter((s) => s.lengthMm > max).map((s) => ({ objectIds: [s.id], objectKind: "segment", message: `${segmentLabel(ctx, s.id)} is ${ctx.len(s.lengthMm)} (max ${ctx.len(max)}).` }));
      return ctx.h.wires.filter((w) => (ctx.d.wireLengthMm.get(w.id) ?? 0) > max).map((w) => ({ objectIds: [w.id], objectKind: "wire", message: `${wireDesc(ctx, w)} is ${ctx.len(ctx.d.wireLengthMm.get(w.id)!)} (max ${ctx.len(max)}).` }));
    },
  },
  {
    id: "max_weight",
    name: "Harness over weight budget",
    description: "Total harness weight must not exceed a budget.",
    example: "≤ 500 g.",
    category: "Mechanical",
    params: [{ key: "maxG", label: "Maximum weight", type: "number", unit: "g", stricter: "lower" }],
    depends: ["bom"],
    evaluate(ctx, p) {
      const m = ctx.bom().massG;
      return m > Number(p.maxG) ? [{ objectIds: [], objectKind: "project", message: `Estimated weight ${Math.round(m)} g exceeds the ${p.maxG} g budget.` }] : [];
    },
  },
  {
    id: "keying_unique",
    name: "Duplicate keying on mating connectors",
    description: "No two connectors of the same kind with the same shell, insert and keying (prevents cross-mating).",
    example: "P1 and P2 both D38999/26WB35SN.",
    category: "Design",
    params: [],
    depends: ["connector"],
    evaluate(ctx) {
      const by = new Map<string, string[]>();
      for (const c of ctx.h.connectors) {
        const part = ctx.cat.connector(c.pn);
        if (!part) continue;
        const k = `${part.kind}|${part.gender}|${part.arrangement.id}|${part.keying}`;
        (by.get(k) ?? by.set(k, []).get(k)!).push(c.id);
      }
      return [...by.values()].filter((ids) => ids.length > 1).map((ids) => ({ objectIds: ids, objectKind: "connector", message: `${ids.map(ctx.refDes).join(", ")} share shell, insert and keying and could be cross-mated; change the keying of all but one.` }));
    },
  },
  // Pedigree process requirements (§10.1)
  {
    id: "no_splices",
    name: "Splice or daisy chain used",
    description: "Splices (and daisy chains) not allowed at this build class.",
    example: "No splices at T1.",
    category: "Process",
    params: [],
    depends: ["splice", "net"],
    evaluate(ctx) {
      return ctx.h.nets
        .filter((n) => n.members.length >= 3 && effectiveTopology(n) !== "parallel")
        .map((n) => ({ objectIds: [n.id], objectKind: "net", message: `${n.name} needs a ${effectiveTopology(n) === "splice" ? "splice" : "daisy chain"}, not allowed at ${ctx.ped.name}.` }));
    },
  },
  {
    id: "no_potting",
    name: "Potting used",
    description: "Potting not allowed at this build class.",
    example: "No potting on Dev units.",
    category: "Process",
    params: [],
    depends: ["potting"],
    evaluate(ctx) {
      return ctx.h.potting.map((p) => ({ objectIds: [p.id, p.targetId], objectKind: "potting", message: `Potting is not allowed at ${ctx.ped.name}.` }));
    },
  },
  {
    id: "require_boots",
    name: "Backshell without a boot",
    description: "Every backshell needs a boot at this build class.",
    example: "Boots at T1.",
    category: "Process",
    params: [],
    depends: ["boot", "connector"],
    evaluate(ctx) {
      return ctx.h.connectors
        .filter((c) => c.backshell && !ctx.h.boots.some((b) => b.nodeId === ctx.h.nodes.find((n) => n.connectorId === c.id)?.id))
        .map((c) => {
          const nid = ctx.h.nodes.find((n) => n.connectorId === c.id)!.id;
          return { objectIds: [c.id], objectKind: "connector" as const, message: `${c.refDes} needs a boot at ${ctx.ped.name}.`, fix: { label: "Add boot", commands: [addBoot({ id: uid(), nodeId: nid, shape: ctx.cat.backshell(c.backshell!.pn)?.angle === 90 ? "90" : "straight" })] } };
        });
    },
  },
  {
    id: "serialized_labels",
    name: "Serialized ID label missing",
    description: "A serialized harness identification label is required.",
    example: "FLIGHT label with S/N.",
    category: "Process",
    params: [],
    depends: ["label"],
    evaluate(ctx) {
      return ctx.h.labels.some((l) => l.template.includes("{serial}")) ? [] : [{ objectIds: [], objectKind: "project", message: `${ctx.ped.name} requires a serialized identification label (turn on the harness ID label rule).` }];
    },
  },
  {
    id: "qpl_only",
    name: "Part without qualification evidence",
    description: "Every part needs a qualified-source evidence record in the catalog (qualifications.csv). A specification-style part number is not evidence; parts without a record are unverified.",
    example: "D38999/26WB35SN with no QPL source on file.",
    category: "Parts",
    params: [],
    depends: ["bom"],
    evaluate(ctx) {
      return ctx
        .bom()
        .lines.filter((l) => l.qualification.status !== "qualified")
        .map((l) => ({
          objectIds: l.objectIds,
          objectKind: "bom",
          message: `${l.pn}: ${l.qualification.status === "expired" ? `qualification evidence expired (${l.qualification.source})` : "no qualified-source evidence on file (unverified)"}; required at ${ctx.ped.name}.`,
        }));
    },
  },
];

export const RULE_TYPE_BY_ID = new Map(RULE_TYPES.map((t) => [t.id, t]));
