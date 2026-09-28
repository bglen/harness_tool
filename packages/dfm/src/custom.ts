import { formatWireColor, isAutoNetName, type CustomCond, type CustomRule } from "@hs/model";
import { safeRegExp } from "./regex";
import type { RuleCtx, Violation, EntityKind } from "./types";

/**
 * Visual rule builder (§9.5.3): For each [entity] where [filters] require [conditions].
 * Evaluated against a documented, read-only view of the model. No code execution.
 */
export interface FieldDef {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "enum";
  options?: string[];
  unit?: string;
}

export const CUSTOM_FIELDS: Record<CustomRule["forEach"], FieldDef[]> = {
  wire: [
    { key: "id", label: "Wire ID", type: "string" },
    { key: "net", label: "Net name", type: "string" },
    { key: "netClass", label: "Net class", type: "enum", options: ["power", "signal", "rf", "ground", "spare"] },
    { key: "gauge", label: "Gauge", type: "number", unit: "AWG" },
    { key: "spec", label: "Wire spec", type: "string" },
    { key: "color", label: "Color code", type: "string" },
    { key: "lengthMm", label: "Length", type: "number", unit: "mm" },
    { key: "twisted", label: "Twisted", type: "boolean" },
    { key: "shielded", label: "Shielded", type: "boolean" },
    { key: "inCable", label: "In a cable", type: "boolean" },
    { key: "from", label: "From connector", type: "string" },
    { key: "to", label: "To connector", type: "string" },
  ],
  net: [
    { key: "name", label: "Name", type: "string" },
    { key: "class", label: "Class", type: "enum", options: ["power", "signal", "rf", "ground", "spare"] },
    { key: "currentA", label: "Current", type: "number", unit: "A" },
    { key: "pins", label: "Pin count", type: "number" },
    { key: "topology", label: "Topology", type: "enum", options: ["daisy", "splice"] },
    { key: "autoNamed", label: "Automatic name", type: "boolean" },
  ],
  connector: [
    { key: "refDes", label: "RefDes", type: "string" },
    { key: "pn", label: "Part number", type: "string" },
    { key: "kind", label: "Kind", type: "enum", options: ["plug", "receptacle"] },
    { key: "shellSize", label: "Shell size", type: "number" },
    { key: "arrangement", label: "Insert arrangement", type: "string" },
    { key: "finish", label: "Shell class", type: "string" },
    { key: "gender", label: "Contact gender", type: "enum", options: ["pin", "socket"] },
    { key: "keying", label: "Keying", type: "string" },
    { key: "pinCount", label: "Cavities", type: "number" },
    { key: "usedPins", label: "Used cavities", type: "number" },
    { key: "sparePct", label: "Spare cavities", type: "number", unit: "%" },
    { key: "hasBackshell", label: "Has backshell", type: "boolean" },
    { key: "backshellAngle", label: "Backshell angle", type: "number", unit: "°" },
    { key: "potted", label: "Potted", type: "boolean" },
  ],
  pin: [
    { key: "connector", label: "Connector", type: "string" },
    { key: "cavity", label: "Cavity", type: "string" },
    { key: "size", label: "Contact size", type: "string" },
    { key: "net", label: "Net", type: "string" },
    { key: "netClass", label: "Net class", type: "enum", options: ["power", "signal", "rf", "ground", "spare"] },
    { key: "assigned", label: "Assigned", type: "boolean" },
  ],
  segment: [
    { key: "label", label: "Label", type: "string" },
    { key: "lengthMm", label: "Length", type: "number", unit: "mm" },
    { key: "wireCount", label: "Wire count", type: "number" },
    { key: "odMm", label: "Outside diameter", type: "number", unit: "mm" },
    { key: "hasBraid", label: "Overbraided", type: "boolean" },
    { key: "hasJacket", label: "Jacketed", type: "boolean" },
    { key: "layerCount", label: "Layer count", type: "number" },
  ],
  shield: [
    { key: "label", label: "Label", type: "string" },
    { key: "wireCount", label: "Wire count", type: "number" },
    { key: "coverage", label: "Coverage", type: "number", unit: "%" },
    { key: "material", label: "Material", type: "string" },
    { key: "groundedEnds", label: "Grounded ends", type: "number" },
    { key: "drainWire", label: "Has drain wire", type: "boolean" },
  ],
};

interface View {
  id: string;
  ids: string[];
  name: string;
  props: Record<string, unknown>;
}

function views(ctx: RuleCtx, kind: CustomRule["forEach"]): View[] {
  const h = ctx.h;
  switch (kind) {
    case "wire":
      return h.wires.map((w) => {
        const net = h.nets.find((n) => n.id === w.netId);
        const ends = [w.from, w.to].map((e) => (e.kind === "pin" ? ctx.refDes(e.connectorId) : "splice"));
        return { id: w.id, ids: [w.id], name: w.label, props: { id: w.label, net: net?.name, netClass: net?.cls, gauge: w.gauge, spec: w.spec, color: formatWireColor(w.color).split(" ")[0], lengthMm: ctx.d.wireLengthMm.get(w.id), twisted: !!w.twistGroupId, shielded: !!w.shieldId, inCable: !!w.cableId, from: ends[0], to: ends[1] } };
      });
    case "net":
      return h.nets.map((n) => ({ id: n.id, ids: [n.id], name: n.name, props: { name: n.name, class: n.cls, currentA: n.currentA, pins: n.members.length, topology: n.topology, autoNamed: isAutoNetName(n.name) } }));
    case "connector":
      return h.connectors.map((c) => {
        const part = ctx.cat.connector(c.pn);
        const total = part?.arrangement.contactCount ?? 0;
        const used = Object.values(c.pins).filter((p) => p.netId).length;
        return {
          id: c.id,
          ids: [c.id],
          name: c.refDes,
          props: { refDes: c.refDes, pn: c.pn, kind: part?.kind, shellSize: part?.shellSize, arrangement: part?.arrangement.id, finish: part?.finish, gender: part?.gender, keying: part?.keying, pinCount: total, usedPins: used, sparePct: total ? ((total - used) / total) * 100 : 0, hasBackshell: !!c.backshell, backshellAngle: c.backshell ? ctx.cat.backshell(c.backshell.pn)?.angle : undefined, potted: h.potting.some((p) => p.targetId === c.id) },
        };
      });
    case "pin": {
      const out: View[] = [];
      for (const c of h.connectors) {
        const part = ctx.cat.connector(c.pn);
        for (const cav of part?.arrangement.cavities ?? []) {
          const net = c.pins[cav.id]?.netId ? h.nets.find((n) => n.id === c.pins[cav.id]!.netId) : undefined;
          out.push({ id: `${c.id}:${cav.id}`, ids: [c.id], name: `${c.refDes}-${cav.id}`, props: { connector: c.refDes, cavity: cav.id, size: cav.size, net: net?.name, netClass: net?.cls, assigned: !!net } });
        }
      }
      return out;
    }
    case "segment":
      return h.segments.map((s) => {
        const stack = ctx.d.segStack.get(s.id) ?? [];
        return { id: s.id, ids: [s.id], name: s.label || "segment", props: { label: s.label, lengthMm: s.lengthMm, wireCount: ctx.d.segWires.get(s.id)?.length ?? 0, odMm: ctx.d.segOuterOdMm.get(s.id), hasBraid: stack.some((x) => x.layer.type === "overbraid"), hasJacket: stack.some((x) => x.layer.type === "jacket"), layerCount: stack.length } };
      });
    case "shield":
      return h.shields.map((s) => ({
        id: s.id,
        ids: [s.id, ...s.wireIds],
        name: s.label,
        props: { label: s.label, wireCount: s.wireIds.length, coverage: s.coverage, material: s.material, drainWire: s.drainWire, groundedEnds: h.terminations.filter((t) => t.targetId === s.id && ["band360", "emiRing", "drainToPin"].includes(t.method)).length },
      }));
  }
}

export function evalCond(v: unknown, c: CustomCond): boolean {
  const val = c.value;
  switch (c.op) {
    case "exists":
      return v !== undefined && v !== null && v !== "";
    case "notExists":
      return v === undefined || v === null || v === "";
    case "eq":
      return String(v) === String(val);
    case "neq":
      return String(v) !== String(val);
    case "gt":
      return Number(v) > Number(val);
    case "gte":
      return Number(v) >= Number(val);
    case "lt":
      return Number(v) < Number(val);
    case "lte":
      return Number(v) <= Number(val);
    case "in":
      return (Array.isArray(val) ? val : String(val).split(",")).map((x) => String(x).trim()).includes(String(v));
    case "notIn":
      return !(Array.isArray(val) ? val : String(val).split(",")).map((x) => String(x).trim()).includes(String(v));
    case "matches":
    case "notMatches": {
      const ok = safeRegExp(String(val)).test(String(v ?? ""));
      return c.op === "matches" ? ok : !ok;
    }
  }
}

const OP_TEXT: Record<CustomCond["op"], string> = { eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤", matches: "matches", notMatches: "doesn't match", in: "in", notIn: "not in", exists: "is set", notExists: "is not set" };

export function describeCond(forEach: CustomRule["forEach"], c: CustomCond): string {
  const f = CUSTOM_FIELDS[forEach].find((x) => x.key === c.field);
  const v = c.op === "exists" || c.op === "notExists" ? "" : ` ${Array.isArray(c.value) ? c.value.join(", ") : c.value}${f?.unit ? ` ${f.unit}` : ""}`;
  return `${f?.label ?? c.field} ${OP_TEXT[c.op]}${v}`;
}

export function describeCustom(r: CustomRule): string {
  const where = r.where.length ? ` where ${r.where.map((c) => describeCond(r.forEach, c)).join(" and ")}` : "";
  return `For each ${r.forEach}${where}, require ${r.require.map((c) => describeCond(r.forEach, c)).join(" and ")}.`;
}

/** Type-check a custom rule (fields exist, regexes compile). Returns error strings. */
export function validateCustom(r: CustomRule): string[] {
  const errs: string[] = [];
  for (const c of [...r.where, ...r.require]) {
    if (!CUSTOM_FIELDS[r.forEach].some((f) => f.key === c.field)) errs.push(`Unknown field "${c.field}" for ${r.forEach}`);
    if (c.op === "matches" || c.op === "notMatches") {
      try {
        safeRegExp(String(c.value));
      } catch (e) {
        errs.push(`Pattern "${c.value}": ${(e as Error).message}`);
      }
    }
    const f = CUSTOM_FIELDS[r.forEach].find((x) => x.key === c.field);
    if (f?.type === "number" && ["gt", "gte", "lt", "lte"].includes(c.op) && !Number.isFinite(Number(c.value))) errs.push(`${f.label} needs a number`);
  }
  return errs;
}

export function evaluateCustom(ctx: RuleCtx, r: CustomRule, budgetMs = 50): Violation[] {
  const t0 = Date.now();
  const out: Violation[] = [];
  const kindMap: Record<CustomRule["forEach"], EntityKind> = { wire: "wire", net: "net", connector: "connector", pin: "pin", segment: "segment", shield: "shield" };
  for (const v of views(ctx, r.forEach)) {
    if (Date.now() - t0 > budgetMs) throw new Error(`Rule exceeded its ${budgetMs} ms time budget and was disabled`);
    if (!r.where.every((c) => evalCond(v.props[c.field], c))) continue;
    const failed = r.require.filter((c) => !evalCond(v.props[c.field], c));
    if (failed.length) out.push({ objectIds: v.ids, objectKind: kindMap[r.forEach], message: `${v.name}: ${failed.map((c) => describeCond(r.forEach, c)).join(" and ")} not met.` });
  }
  return out;
}
