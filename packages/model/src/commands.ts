import { enablePatches, produceWithPatches, applyPatches, current, isDraft, type Patch } from "immer";

/** Deep copy of a (possibly drafted) value. */
function snapshot<T>(v: T): T {
  return structuredClone(isDraft(v) ? current(v) : v);
}
import type { CatalogIndex } from "./catalog";
import { derive } from "./derive";
import { connectorById, currentHarness, currentRevision, memberKey, netOfPin, nextLabel, nextNetName, nextRefDes, uid } from "./helpers";
import { normalizePn } from "./pn38999";
import type {
  Accessory,
  BackshellRef,
  Boot,
  ConnectorInstance,
  CustomRule,
  FinishingPreset,
  Harness,
  Hardware,
  Label,
  Layer,
  Net,
  NetClass,
  NetMember,
  PedigreeScheme,
  Point,
  Project,
  RuleInstance,
  RuleOverride,
  Ruleset,
  Settings,
  Termination,
  TitleBlock,
  Waiver,
  WireEnd,
} from "./schema";
import { normalize } from "./sync";
import type { WireColor } from "./colors";

enablePatches();

export interface Command<P = any> {
  type: string;
  payload: P;
}

export interface CommandContext {
  cat: CatalogIndex;
  now?: () => string;
}

export interface CommandResult {
  project: Project;
  patches: Patch[];
  inverse: Patch[];
  label: string;
}

type Handler<P> = {
  label: (p: P) => string;
  run: (proj: Project, payload: P, ctx: CommandContext) => void;
  /** Allowed while the current revision is frozen. */
  allowFrozen?: boolean;
};

const handlers: Record<string, Handler<any>> = {};

function def<P>(type: string, h: Handler<P>) {
  handlers[type] = h;
  return (payload: P): Command<P> => ({ type, payload });
}

export class FrozenRevisionError extends Error {
  constructor() {
    super("This revision is frozen. Create a new revision to edit.");
  }
}

export function applyCommand(project: Project, cmd: Command, ctx: CommandContext): CommandResult {
  const h = handlers[cmd.type];
  if (!h) throw new Error(`Unknown command ${cmd.type}`);
  if (currentRevision(project).frozen && !h.allowFrozen) throw new FrozenRevisionError();
  const [next, patches, inverse] = produceWithPatches(project, (draft) => {
    h.run(draft as Project, cmd.payload, ctx);
    normalize(draft as Project, { cat: ctx.cat });
    (draft as Project).updated = ctx.now ? ctx.now() : new Date().toISOString();
  });
  return { project: next, patches, inverse, label: h.label(cmd.payload) };
}

export function applyBatch(project: Project, cmds: Command[], ctx: CommandContext, label?: string): CommandResult {
  if (currentRevision(project).frozen && cmds.some((c) => !handlers[c.type]?.allowFrozen)) throw new FrozenRevisionError();
  const [next, patches, inverse] = produceWithPatches(project, (draft) => {
    for (const cmd of cmds) {
      const h = handlers[cmd.type];
      if (!h) throw new Error(`Unknown command ${cmd.type}`);
      h.run(draft as Project, cmd.payload, ctx);
      normalize(draft as Project, { cat: ctx.cat });
    }
    (draft as Project).updated = ctx.now ? ctx.now() : new Date().toISOString();
  });
  return { project: next, patches, inverse, label: label ?? (cmds.length === 1 ? handlers[cmds[0]!.type]!.label(cmds[0]!.payload) : `${cmds.length} changes`) };
}

export { applyPatches };

export function commandLabel(cmd: Command): string {
  return handlers[cmd.type]?.label(cmd.payload) ?? cmd.type;
}

export function isCommandType(t: string) {
  return t in handlers;
}

// ─── Helpers used by handlers ───────────────────────────────────────────────

function H(p: Project): Harness {
  return currentHarness(p);
}

function setPinNet(h: Harness, m: NetMember, netId: string | null) {
  for (const n of h.nets) n.members = n.members.filter((x) => !(x.connectorId === m.connectorId && x.cavityId === m.cavityId));
  if (netId) h.nets.find((n) => n.id === netId)!.members.push({ ...m });
}

function mergeNets(h: Harness, keep: Net, drop: Net) {
  if (keep.id === drop.id) return;
  for (const m of drop.members) keep.members.push(m);
  drop.members = [];
  if (keep.currentA == null && drop.currentA != null) keep.currentA = drop.currentA;
}

function connectTwo(h: Harness, a: NetMember, b: NetMember) {
  const na = netOfPin(h, a.connectorId, a.cavityId);
  const nb = netOfPin(h, b.connectorId, b.cavityId);
  if (na && nb) mergeNets(h, na, nb);
  else if (na) setPinNet(h, b, na.id);
  else if (nb) setPinNet(h, a, nb.id);
  else {
    const net: Net = { id: uid(), name: nextNetName(h), cls: "signal", topology: "daisy", members: [{ ...a }, { ...b }] };
    h.nets.push(net);
  }
}

function deleteConnectorFrom(h: Harness, id: string) {
  h.connectors = h.connectors.filter((c) => c.id !== id);
  for (const n of h.nets) n.members = n.members.filter((m) => m.connectorId !== id);
  const node = h.nodes.find((n) => n.connectorId === id);
  if (node) removeNode(h, node.id, false);
}

/** Remove a node; if it joins exactly two segments, merge them into one. */
function removeNode(h: Harness, nodeId: string, merge = true) {
  const segs = h.segments.filter((s) => s.a === nodeId || s.b === nodeId);
  if (merge && segs.length === 2) {
    const [s1, s2] = segs as [typeof segs[0], typeof segs[0]];
    const o1 = s1.a === nodeId ? s1.b : s1.a;
    const o2 = s2.a === nodeId ? s2.b : s2.a;
    s1.a = o1;
    s1.b = o2;
    s1.lengthMm += s2.lengthMm;
    for (const l of h.layers) l.extents = l.extents.filter((e) => e.segmentId !== s2.id);
    h.segments = h.segments.filter((s) => s.id !== s2.id);
  } else {
    const ids = new Set(segs.map((s) => s.id));
    h.segments = h.segments.filter((s) => !ids.has(s.id));
  }
  h.nodes = h.nodes.filter((n) => n.id !== nodeId);
  h.splices = h.splices.filter((s) => s.nodeId !== nodeId);
}

function cloneConnector(h: Harness, src: ConnectorInstance, kind: "plug" | "receptacle", offset: Point, newId: string, withNets: boolean): ConnectorInstance {
  const c: ConnectorInstance = snapshot(src);
  c.id = newId;
  c.refDes = nextRefDes(h, kind);
  c.position = { x: src.position.x + offset.x, y: src.position.y + offset.y };
  c.accessories = c.accessories.map((a) => ({ ...a, id: uid() }));
  if (!withNets) for (const p of Object.values(c.pins)) p.netId = null;
  return c;
}

// ─── Connectors ─────────────────────────────────────────────────────────────

export const addConnector = def<{ id: string; pn: string; position: Point; refDes?: string; rotation?: number; kind?: "plug" | "receptacle" }>("addConnector", {
  label: (p) => `Add connector ${p.pn}`,
  run(proj, p, { cat }) {
    const h = H(proj);
    const part = cat.connector(p.pn);
    const kind = part?.kind ?? p.kind ?? "plug";
    let backshell: BackshellRef | null = null;
    if (part && proj.settings.defaultBackshell !== "none") {
      const style = proj.settings.defaultBackshell;
      const bs = cat.backshellsFor(part.shellSize).find((b) => b.style === style && b.angle === 0);
      if (bs) backshell = { pn: bs.pn, clockingDeg: 0, auto: true };
    }
    h.connectors.push({
      id: p.id,
      refDes: p.refDes ?? nextRefDes(h, kind),
      pn: part?.pn ?? normalizePn(p.pn),
      position: p.position,
      rotation: p.rotation ?? 0,
      clocking: part?.keying ?? "N",
      backshell,
      accessories: [],
      pins: {},
      showUnused: false,
      description: "",
    });
  },
});

export const moveConnectors = def<{ moves: { id: string; position: Point }[] }>("moveConnectors", {
  label: (p) => (p.moves.length === 1 ? "Move connector" : `Move ${p.moves.length} connectors`),
  run(proj, p) {
    const h = H(proj);
    for (const m of p.moves) {
      const c = connectorById(h, m.id);
      if (c) c.position = m.position;
    }
  },
});

export const moveNodes = def<{ moves: { id: string; position: Point }[] }>("moveNodes", {
  label: () => "Move",
  run(proj, p) {
    const h = H(proj);
    for (const m of p.moves) {
      const n = h.nodes.find((x) => x.id === m.id);
      if (!n) continue;
      if (n.kind === "connector") {
        const c = connectorById(h, n.connectorId!);
        if (c) c.position = m.position;
      } else n.position = m.position;
    }
  },
});

export const rotateConnector = def<{ id: string; rotation: number }>("rotateConnector", {
  label: () => "Rotate connector",
  run(proj, p) {
    const c = connectorById(H(proj), p.id);
    if (c) c.rotation = ((p.rotation % 360) + 360) % 360;
  },
});

export const deleteConnectors = def<{ ids: string[] }>("deleteConnectors", {
  label: (p) => (p.ids.length === 1 ? "Delete connector" : `Delete ${p.ids.length} connectors`),
  run(proj, p) {
    const h = H(proj);
    for (const id of p.ids) deleteConnectorFrom(h, id);
  },
});

export const duplicateConnectors = def<{ ids: string[]; newIds: string[]; offset: Point; withNets?: boolean }>("duplicateConnectors", {
  label: (p) => (p.ids.length === 1 ? "Duplicate connector" : `Duplicate ${p.ids.length} connectors`),
  run(proj, p, { cat }) {
    const h = H(proj);
    p.ids.forEach((id, i) => {
      const src = connectorById(h, id);
      if (!src) return;
      const kind = cat.connector(src.pn)?.kind ?? "plug";
      h.connectors.push(cloneConnector(h, src, kind, p.offset, p.newIds[i]!, false));
    });
  },
});

/** Paste connectors (with their pinouts as signal names) from the clipboard. */
export const pasteConnectors = def<{ items: { id: string; pn: string; position: Point; rotation: number; backshell: BackshellRef | null; pins: Record<string, { name: string; cls: NetClass }> }[] }>("pasteConnectors", {
  label: (p) => `Paste ${p.items.length} connector${p.items.length > 1 ? "s" : ""}`,
  run(proj, p, { cat }) {
    const h = H(proj);
    for (const it of p.items) {
      const kind = cat.connector(it.pn)?.kind ?? "plug";
      h.connectors.push({ id: it.id, refDes: nextRefDes(h, kind), pn: it.pn, position: it.position, rotation: it.rotation, clocking: "N", backshell: it.backshell, accessories: [], pins: {}, showUnused: false, description: "" });
      for (const [cav, v] of Object.entries(it.pins)) assignSignal(h, { connectorId: it.id, cavityId: cav }, v.name, v.cls);
    }
  },
});

export const setConnectorPart = def<{ id: string; pn: string }>("setConnectorPart", {
  label: (p) => `Change part to ${p.pn}`,
  run(proj, p, { cat }) {
    const c = connectorById(H(proj), p.id);
    const part = cat.connector(p.pn);
    if (c) {
      c.pn = part?.pn ?? normalizePn(p.pn);
      if (part) c.clocking = part.keying;
    }
  },
});

export const setConnectorProps = def<{ id: string; refDes?: string; description?: string; showUnused?: boolean; clocking?: string }>("setConnectorProps", {
  label: (p) => (p.refDes ? `Rename to ${p.refDes}` : "Edit connector"),
  run(proj, p) {
    const c = connectorById(H(proj), p.id);
    if (!c) return;
    if (p.refDes !== undefined) c.refDes = p.refDes.trim();
    if (p.description !== undefined) c.description = p.description;
    if (p.showUnused !== undefined) c.showUnused = p.showUnused;
    if (p.clocking !== undefined) c.clocking = p.clocking;
  },
});

export const setBackshell = def<{ id: string; backshell: BackshellRef | null }>("setBackshell", {
  label: (p) => (p.backshell ? "Set backshell" : "Remove backshell"),
  run(proj, p) {
    const c = connectorById(H(proj), p.id);
    if (c) c.backshell = p.backshell;
  },
});

export const setAccessory = def<{ id: string; kind: Accessory["kind"]; pn: string | null }>("setAccessory", {
  label: (p) => (p.pn ? `Add ${p.kind}` : `Remove ${p.kind}`),
  run(proj, p) {
    const c = connectorById(H(proj), p.id);
    if (!c) return;
    c.accessories = c.accessories.filter((a) => a.kind !== p.kind);
    if (p.pn) c.accessories.push({ id: uid(), kind: p.kind, pn: p.pn, auto: false });
  },
});

export const setPinContact = def<{ connectorId: string; cavityIds: string[]; contactPn: string | null; filler?: boolean }>("setPinContact", {
  label: () => "Change contact",
  run(proj, p) {
    const c = connectorById(H(proj), p.connectorId);
    if (!c) return;
    for (const cav of p.cavityIds) {
      const pin = c.pins[cav] ?? (c.pins[cav] = { netId: null });
      if (p.contactPn === null) delete pin.contactPn;
      else pin.contactPn = p.contactPn;
      if (p.filler !== undefined) pin.filler = p.filler || undefined;
    }
  },
});

// ─── Signals / nets ─────────────────────────────────────────────────────────

function assignSignal(h: Harness, m: NetMember, rawName: string, cls?: NetClass) {
  const name = rawName.trim();
  const cur = netOfPin(h, m.connectorId, m.cavityId);
  if (!name) {
    if (cur) setPinNet(h, m, null);
    return;
  }
  if (cur && cur.name === name) return;
  const existing = h.nets.find((n) => n.name === name);
  if (existing) {
    setPinNet(h, m, existing.id);
    return;
  }
  if (cur && cur.members.length === 1) {
    cur.name = name; // sole member: rename the net
    return;
  }
  const net: Net = { id: uid(), name, cls: cls ?? guessNetClass(name), topology: "daisy", members: [] };
  h.nets.push(net);
  setPinNet(h, m, net.id);
}

/** Guess a net class from its name (power/ground/RF), else signal. */
export function guessNetClass(name: string): NetClass {
  const n = name.toUpperCase();
  if (/^(GND|RTN|GROUND|CHASSIS|SHIELD|DRAIN)|_(GND|RTN)$|^0V/.test(n)) return "ground";
  if (/^\+?\d+(\.\d+)?V|^V(CC|DD|BAT|IN)|PWR|POWER|^\+/.test(n)) return "power";
  if (/^RF|_RF$|ANT/.test(n)) return "rf";
  if (/^SPARE/.test(n)) return "spare";
  return "signal";
}

export const setPinSignals = def<{ connectorId: string; entries: { cavityId: string; name: string }[] }>("setPinSignals", {
  label: (p) => (p.entries.length === 1 ? `Set ${p.entries[0]!.cavityId} = ${p.entries[0]!.name || "(none)"}` : `Set ${p.entries.length} signals`),
  run(proj, p) {
    const h = H(proj);
    for (const e of p.entries) assignSignal(h, { connectorId: p.connectorId, cavityId: e.cavityId }, e.name);
  },
});

export const connectPins = def<{ pairs: { a: NetMember; b: NetMember }[] }>("connectPins", {
  label: (p) => (p.pairs.length === 1 ? "Connect pins" : `Connect ${p.pairs.length} pins`),
  run(proj, p) {
    const h = H(proj);
    for (const { a, b } of p.pairs) {
      if (memberKey(a) === memberKey(b)) continue;
      connectTwo(h, a, b);
    }
  },
});

/** Connect two connectors by signal name / pin-for-pin (§5.4). */
export const connectConnectors = def<{ a: string; b: string; mode: "byName" | "pinForPin" }>("connectConnectors", {
  label: (p) => (p.mode === "byName" ? "Connect by signal name" : "Connect pin-for-pin"),
  run(proj, p, { cat }) {
    const h = H(proj);
    const ca = connectorById(h, p.a);
    const cb = connectorById(h, p.b);
    if (!ca || !cb) return;
    const partB = cat.connector(cb.pn);
    const cavB = new Set(partB?.arrangement.cavities.map((c) => c.id) ?? []);
    if (p.mode === "pinForPin") {
      const partA = cat.connector(ca.pn);
      for (const cav of partA?.arrangement.cavities ?? []) {
        if (!cavB.has(cav.id)) continue;
        const na = netOfPin(h, ca.id, cav.id);
        const nb = netOfPin(h, cb.id, cav.id);
        if (!na && !nb) continue; // only connect assigned pins
        connectTwo(h, { connectorId: ca.id, cavityId: cav.id }, { connectorId: cb.id, cavityId: cav.id });
        const net = netOfPin(h, ca.id, cav.id)!;
        if (net.name.startsWith("NET_") && na == null && nb == null) net.name = `${ca.refDes}_${cav.id}`;
      }
    } else {
      // byName: for each named net on A, if B has a free pin with the same cavity id use it; else first free cavity of compatible size.
      for (const n of h.nets) {
        if (!n.members.some((m) => m.connectorId === ca.id) || n.members.some((m) => m.connectorId === cb.id)) continue;
        const aMember = n.members.find((m) => m.connectorId === ca.id)!;
        const aSize = cat.cavity(ca.pn, aMember.cavityId)?.size;
        const used = new Set(h.nets.flatMap((x) => x.members.filter((m) => m.connectorId === cb.id).map((m) => m.cavityId)));
        let target = cavB.has(aMember.cavityId) && !used.has(aMember.cavityId) ? aMember.cavityId : undefined;
        if (!target) target = partB?.arrangement.cavities.find((c) => !used.has(c.id) && c.size === aSize)?.id;
        if (target) n.members.push({ connectorId: cb.id, cavityId: target });
      }
    }
  },
});

export const renameNet = def<{ id: string; name: string }>("renameNet", {
  label: (p) => `Rename net to ${p.name}`,
  run(proj, p) {
    const h = H(proj);
    const n = h.nets.find((x) => x.id === p.id);
    const name = p.name.trim();
    if (!n || !name) return;
    const other = h.nets.find((x) => x.name === name && x.id !== n.id);
    if (other) mergeNets(h, other, n);
    else n.name = name;
  },
});

export const setNetProps = def<{ ids: string[]; cls?: NetClass; currentA?: number | null; topology?: "daisy" | "splice" }>("setNetProps", {
  label: (p) => (p.topology ? `Set topology: ${p.topology}` : p.cls ? `Set net class: ${p.cls}` : "Edit net"),
  run(proj, p) {
    for (const id of p.ids) {
      const n = H(proj).nets.find((x) => x.id === id);
      if (!n) continue;
      if (p.cls) n.cls = p.cls;
      if (p.currentA !== undefined) n.currentA = p.currentA ?? undefined;
      if (p.topology) n.topology = p.topology;
    }
  },
});

export const deleteNets = def<{ ids: string[] }>("deleteNets", {
  label: () => "Delete net",
  run(proj, p) {
    const h = H(proj);
    h.nets = h.nets.filter((n) => !p.ids.includes(n.id));
  },
});

/** Disconnect a pin from its net (keeps the net). */
export const disconnectPins = def<{ members: NetMember[] }>("disconnectPins", {
  label: () => "Disconnect pin",
  run(proj, p) {
    const h = H(proj);
    for (const m of p.members) setPinNet(h, m, null);
  },
});

/** Commit ratsnest lines into wires (§5.4). */
export const commitRatsnest = def<{ netIds?: string[]; connectorIds?: string[] }>("commitRatsnest", {
  label: () => "Commit connections",
  run(proj, p, { cat }) {
    const h = H(proj);
    const prev = proj.settings.autoCommit;
    // Temporarily create wires by running a normalize pass with auto-commit, then filter scope.
    const before = new Set(h.wires.map((w) => w.id));
    proj.settings.autoCommit = true;
    normalize(proj, { cat });
    proj.settings.autoCommit = prev;
    const h2 = H(proj);
    h2.wires = h2.wires.filter((w) => {
      if (before.has(w.id)) return true;
      if (p.netIds && !p.netIds.includes(w.netId)) return false;
      if (p.connectorIds) {
        const ends = [w.from, w.to].filter((e): e is Extract<WireEnd, { kind: "pin" }> => e.kind === "pin");
        if (!ends.some((e) => p.connectorIds!.includes(e.connectorId))) return false;
      }
      return true;
    });
  },
});

// ─── Wires ──────────────────────────────────────────────────────────────────

export const setWireProps = def<{ ids: string[]; spec?: string; gauge?: number; color?: WireColor; extraLengthMm?: number }>("setWireProps", {
  label: (p) => (p.gauge ? `Set ${p.gauge} AWG` : p.color ? "Set wire color" : p.spec ? `Set spec ${p.spec}` : "Edit wire"),
  run(proj, p) {
    for (const w of H(proj).wires) {
      if (!p.ids.includes(w.id)) continue;
      if (p.spec) {
        w.spec = p.spec;
        if (!w.pinned.includes("spec")) w.pinned.push("spec");
      }
      if (p.gauge) {
        w.gauge = p.gauge;
        if (!w.pinned.includes("gauge")) w.pinned.push("gauge");
      }
      if (p.color) {
        w.color = p.color;
        if (!w.pinned.includes("color")) w.pinned.push("color");
      }
      if (p.extraLengthMm !== undefined) w.extraLengthMm = p.extraLengthMm;
    }
  },
});

export const unpinWireProps = def<{ ids: string[]; fields: ("spec" | "gauge" | "color")[] }>("unpinWireProps", {
  label: () => "Reset wire to default",
  run(proj, p) {
    for (const w of H(proj).wires) if (p.ids.includes(w.id)) w.pinned = w.pinned.filter((f) => !p.fields.includes(f));
  },
});

/** Set spec/gauge/color on every wire of a net class, or change the project default (§6.3). */
export const setWireDefaults = def<{ netClass?: NetClass; spec?: string; gauge?: number; color?: WireColor }>("setWireDefaults", {
  label: (p) => (p.netClass ? `Set wires for ${p.netClass} nets` : "Set project wire defaults"),
  run(proj, p) {
    const h = H(proj);
    if (!p.netClass) {
      if (p.spec) proj.settings.defaultWireSpec = p.spec;
      if (p.color) proj.settings.defaultColor = p.color;
      return;
    }
    const nets = new Set(h.nets.filter((n) => n.cls === p.netClass).map((n) => n.id));
    for (const w of h.wires) {
      if (!nets.has(w.netId)) continue;
      if (p.spec) (w.spec = p.spec), w.pinned.includes("spec") || w.pinned.push("spec");
      if (p.gauge) (w.gauge = p.gauge), w.pinned.includes("gauge") || w.pinned.push("gauge");
      if (p.color) (w.color = p.color), w.pinned.includes("color") || w.pinned.push("color");
    }
  },
});

/** Delete a wire = disconnect its far-end pin from the net (a wire can't exist without connectivity). */
export const deleteWires = def<{ ids: string[] }>("deleteWires", {
  label: (p) => (p.ids.length === 1 ? "Delete wire" : `Delete ${p.ids.length} wires`),
  run(proj, p) {
    const h = H(proj);
    for (const id of p.ids) {
      const w = h.wires.find((x) => x.id === id);
      if (!w) continue;
      const end = w.to.kind === "pin" ? w.to : w.from.kind === "pin" ? w.from : null;
      if (end && end.kind === "pin") setPinNet(h, { connectorId: end.connectorId, cavityId: end.cavityId }, null);
    }
  },
});

export const twistWires = def<{ ids: string[]; groupId: string }>("twistWires", {
  label: (p) => (p.ids.length === 2 ? "Twist pair" : p.ids.length === 3 ? "Twist triple" : "Twist"),
  run(proj, p) {
    const h = H(proj);
    for (const g of h.twistGroups) g.wireIds = g.wireIds.filter((id) => !p.ids.includes(id));
    h.twistGroups.push({ id: p.groupId, wireIds: [...p.ids] });
  },
});

export const untwist = def<{ groupIds: string[] }>("untwist", {
  label: () => "Untwist",
  run(proj, p) {
    const h = H(proj);
    h.twistGroups = h.twistGroups.filter((g) => !p.groupIds.includes(g.id));
    for (const w of h.wires) if (w.twistGroupId && p.groupIds.includes(w.twistGroupId)) delete w.twistGroupId;
  },
});

export type ShieldPreset = "both360" | "groundAtFirst" | "drainToPin" | "floating";

export const shieldWires = def<{ ids: string[]; shieldId: string; drainWire?: boolean; preset?: ShieldPreset }>("shieldWires", {
  label: () => "Shield wires",
  run(proj, p, { cat }) {
    const h = H(proj);
    for (const s of h.shields) s.wireIds = s.wireIds.filter((id) => !p.ids.includes(id));
    h.shields.push({ id: p.shieldId, label: nextLabel(h.shields.map((s) => s.label), "SH"), wireIds: [...p.ids], material: "tinned copper", coverage: 85, drainWire: !!p.drainWire || p.preset === "drainToPin" });
    normalize(proj, { cat });
    if (p.preset) applyShieldPreset(H(proj), p.shieldId, p.preset);
  },
});

function applyShieldPreset(h: Harness, shieldId: string, preset: ShieldPreset) {
  const terms = h.terminations.filter((t) => t.targetId === shieldId);
  const connOrder = new Map(h.connectors.map((c, i) => [c.id, i]));
  const nodeRank = (t: Termination) => connOrder.get(h.nodes.find((n) => n.id === t.nodeId)?.connectorId ?? "") ?? 99;
  terms.sort((a, b) => nodeRank(a) - nodeRank(b));
  terms.forEach((t, i) => {
    if (preset === "both360") t.method = "band360";
    else if (preset === "floating") t.method = "floating";
    else if (preset === "groundAtFirst") t.method = i === 0 ? "band360" : "floating";
    else if (preset === "drainToPin") t.method = i === 0 ? "drainToPin" : "floating";
    t.auto = false;
  });
}

export const setShieldProps = def<{ id: string; material?: string; coverage?: number; drainWire?: boolean; preset?: ShieldPreset }>("setShieldProps", {
  label: () => "Edit shield",
  run(proj, p) {
    const h = H(proj);
    const s = h.shields.find((x) => x.id === p.id);
    if (!s) return;
    if (p.material) s.material = p.material;
    if (p.coverage !== undefined) s.coverage = p.coverage;
    if (p.drainWire !== undefined) s.drainWire = p.drainWire;
    if (p.preset) applyShieldPreset(h, s.id, p.preset);
  },
});

export const removeShields = def<{ ids: string[] }>("removeShields", {
  label: () => "Remove shield",
  run(proj, p) {
    const h = H(proj);
    h.shields = h.shields.filter((s) => !p.ids.includes(s.id));
    for (const w of h.wires) if (w.shieldId && p.ids.includes(w.shieldId)) delete w.shieldId;
  },
});

/** Set the termination method at one end. For drain-to-pin, the drain lands on a pin assigned to a ground net (§6.4). */
export const setTermination = def<{ id: string; method: Termination["method"]; drainPin?: NetMember; groundNetName?: string }>("setTermination", {
  label: (p) => `Termination: ${p.method}`,
  run(proj, p) {
    const h = H(proj);
    const t = h.terminations.find((x) => x.id === p.id);
    if (!t) return;
    t.method = p.method;
    t.auto = false;
    if (p.method === "drainToPin") {
      // The UI picks the pin (first free cavity by default); without one the end stays unassigned and DFM flags it.
      const pin = p.drainPin;
      if (pin) {
        t.drainPin = pin;
        const gname = p.groundNetName ?? "SHIELD_GND";
        assignSignal(h, pin, gname, "ground");
        const net = h.nets.find((n) => n.name === gname);
        if (net) net.cls = "ground";
      }
    } else delete t.drainPin;
  },
});

// ─── Cables ────────────────────────────────────────────────────────────────

export const createCable = def<{ id: string; wireIds: string[]; wireCode: string; gauge: number; shield: string; jacket: string }>("createCable", {
  label: () => "Make cable",
  run(proj, p, { cat }) {
    const h = H(proj);
    for (const c of h.cables) c.wireIds = c.wireIds.filter((id) => !p.wireIds.includes(id));
    h.cables.push({ id: p.id, label: nextLabel(h.cables.map((c) => c.label), "C"), wireCode: p.wireCode, gauge: p.gauge, count: p.wireIds.length, shield: p.shield, jacket: p.jacket, wireIds: [...p.wireIds], stripJacketMm: 38, stripShieldMm: 25 });
    const spec = cat.bundle.cableWireCodes.find((w) => w.wireCode === p.wireCode)?.spec ?? "M22759/16";
    // Standard M27500 conductor colors: 9 (white), 9-2 (white/red), 9-6 (white/blue), 9-5, 9-4 ...
    const colors: WireColor[] = [{ base: 9, stripes: [] }, { base: 9, stripes: [2] }, { base: 9, stripes: [6] }, { base: 9, stripes: [5] }, { base: 9, stripes: [4] }, { base: 9, stripes: [7] }, { base: 9, stripes: [3] }, { base: 9, stripes: [8] }];
    p.wireIds.forEach((id, i) => {
      const w = h.wires.find((x) => x.id === id);
      if (!w) return;
      w.cableId = p.id;
      w.spec = spec;
      w.gauge = p.gauge;
      w.color = colors[i] ?? colors[0]!;
      w.pinned = ["spec", "gauge", "color"];
    });
    if (p.shield !== "U") {
      h.shields = h.shields.map((s) => ({ ...s, wireIds: s.wireIds.filter((id) => !p.wireIds.includes(id)) }));
      h.shields.push({ id: uid(), label: nextLabel(h.shields.map((s) => s.label), "SH"), wireIds: [...p.wireIds], cableId: p.id, material: cat.bundle.cableShields.find((s) => s.code === p.shield)?.material ?? "tinned copper", coverage: 85, drainWire: false });
    }
    if (p.wireIds.length >= 2) {
      h.twistGroups = h.twistGroups.map((g) => ({ ...g, wireIds: g.wireIds.filter((id) => !p.wireIds.includes(id)) }));
      if (p.wireIds.length <= 4) h.twistGroups.push({ id: uid(), wireIds: [...p.wireIds] });
    }
  },
});

export const removeCable = def<{ id: string }>("removeCable", {
  label: () => "Remove cable",
  run(proj, p) {
    const h = H(proj);
    const c = h.cables.find((x) => x.id === p.id);
    if (!c) return;
    h.shields = h.shields.filter((s) => s.cableId !== c.id);
    for (const w of h.wires) if (w.cableId === c.id) (delete w.cableId, (w.pinned = []));
    h.cables = h.cables.filter((x) => x.id !== p.id);
  },
});

export const setCableProps = def<{ id: string; stripJacketMm?: number; stripShieldMm?: number; jacket?: string; shield?: string }>("setCableProps", {
  label: () => "Edit cable",
  run(proj, p) {
    const c = H(proj).cables.find((x) => x.id === p.id);
    if (!c) return;
    if (p.stripJacketMm !== undefined) c.stripJacketMm = p.stripJacketMm;
    if (p.stripShieldMm !== undefined) c.stripShieldMm = p.stripShieldMm;
    if (p.jacket) c.jacket = p.jacket;
    if (p.shield) c.shield = p.shield;
  },
});

// ─── Topology ───────────────────────────────────────────────────────────────

/** Split a segment at fraction t with a new breakout node; optionally add a branch to a connector or free point (§5.4). */
export const addBreakout = def<{ segmentId: string; t: number; nodeId: string; position: Point; branch?: { toConnectorId?: string; toPosition?: Point; newNodeId?: string; lengthMm?: number } }>("addBreakout", {
  label: (p) => (p.branch ? "Add branch" : "Add breakout"),
  run(proj, p) {
    const h = H(proj);
    const s = h.segments.find((x) => x.id === p.segmentId);
    if (!s) return;
    const t = Math.min(0.95, Math.max(0.05, p.t));
    const la = Math.max(1, Math.round(s.lengthMm * t));
    const lb = Math.max(1, Math.round(s.lengthMm - la));
    h.nodes.push({ id: p.nodeId, kind: "breakout", position: p.position });
    const s2 = { id: uid(), a: p.nodeId, b: s.b, lengthMm: lb, toleranceMm: s.toleranceMm, label: "" };
    // Split layer extents that covered the whole segment.
    for (const l of h.layers) {
      const e = l.extents.find((x) => x.segmentId === s.id);
      if (e) {
        if (e.startMm == null && e.endMm == null) l.extents.push({ segmentId: s2.id });
        else {
          const st = e.startMm ?? 0;
          const en = e.endMm ?? s.lengthMm;
          if (en > la) l.extents.push({ segmentId: s2.id, startMm: Math.max(0, st - la), endMm: en - la });
          if (st >= la) l.extents = l.extents.filter((x) => x !== e);
          else e.endMm = Math.min(en, la);
        }
      }
    }
    s.b = p.nodeId;
    s.lengthMm = la;
    h.segments.push(s2);
    if (p.branch) {
      const len = p.branch.lengthMm ?? proj.settings.defaultSegmentMm;
      if (p.branch.toConnectorId) {
        const cn = h.nodes.find((n) => n.connectorId === p.branch!.toConnectorId);
        if (cn) {
          // Re-route: drop direct segments from this connector that bypass the new breakout.
          h.segments.push({ id: uid(), a: p.nodeId, b: cn.id, lengthMm: len, toleranceMm: 10, label: "" });
        }
      } else if (p.branch.toPosition && p.branch.newNodeId) {
        h.nodes.push({ id: p.branch.newNodeId, kind: "breakout", position: p.branch.toPosition });
        h.segments.push({ id: uid(), a: p.nodeId, b: p.branch.newNodeId, lengthMm: len, toleranceMm: 10, label: "" });
      }
    }
  },
});

export const addSegment = def<{ id: string; a: string; b: string; lengthMm?: number }>("addSegment", {
  label: () => "Add segment",
  run(proj, p) {
    const h = H(proj);
    if (p.a === p.b) return;
    h.segments.push({ id: p.id, a: p.a, b: p.b, lengthMm: p.lengthMm ?? proj.settings.defaultSegmentMm, toleranceMm: 10, label: "" });
  },
});

/** Add a free breakout node, optionally connected to an existing node. */
export const addNode = def<{ id: string; position: Point; connectTo?: string; lengthMm?: number }>("addNode", {
  label: () => "Add breakout",
  run(proj, p) {
    const h = H(proj);
    h.nodes.push({ id: p.id, kind: "breakout", position: p.position });
    if (p.connectTo) h.segments.push({ id: uid(), a: p.connectTo, b: p.id, lengthMm: p.lengthMm ?? proj.settings.defaultSegmentMm, toleranceMm: 10, label: "" });
  },
});

/** Merge a node onto another (drop a free breakout onto a connector). */
export const mergeNodes = def<{ from: string; into: string }>("mergeNodes", {
  label: () => "Connect branch",
  run(proj, p) {
    const h = H(proj);
    if (p.from === p.into) return;
    for (const s of h.segments) {
      if (s.a === p.from) s.a = p.into;
      if (s.b === p.from) s.b = p.into;
    }
    h.segments = h.segments.filter((s) => s.a !== s.b);
    for (const b of h.boots) if (b.nodeId === p.from) b.nodeId = p.into;
    for (const s of h.splices) if (s.nodeId === p.from) s.nodeId = p.into;
    h.nodes = h.nodes.filter((n) => n.id !== p.from || n.kind === "connector");
  },
});

export const setSegmentProps = def<{ ids: string[]; lengthMm?: number; toleranceMm?: number; label?: string; tieSpacingMm?: number | null }>("setSegmentProps", {
  label: (p) => (p.lengthMm ? "Set segment length" : "Edit segment"),
  run(proj, p) {
    for (const s of H(proj).segments) {
      if (!p.ids.includes(s.id)) continue;
      if (p.lengthMm && p.lengthMm > 0) {
        const scale = p.lengthMm / s.lengthMm;
        s.lengthMm = p.lengthMm;
        for (const l of H(proj).layers)
          for (const e of l.extents)
            if (e.segmentId === s.id) {
              if (e.startMm != null) e.startMm *= scale;
              if (e.endMm != null) e.endMm *= scale;
            }
      }
      if (p.toleranceMm !== undefined) s.toleranceMm = p.toleranceMm;
      if (p.label !== undefined) s.label = p.label;
      if (p.tieSpacingMm !== undefined) s.tieSpacingMm = p.tieSpacingMm ?? undefined;
    }
  },
});

export const deleteSegments = def<{ ids: string[] }>("deleteSegments", {
  label: () => "Delete segment",
  run(proj, p) {
    const h = H(proj);
    h.segments = h.segments.filter((s) => !p.ids.includes(s.id));
    // Remove orphaned breakouts
    h.nodes = h.nodes.filter((n) => n.kind === "connector" || h.segments.some((s) => s.a === n.id || s.b === n.id));
  },
});

export const deleteNodes = def<{ ids: string[] }>("deleteNodes", {
  label: () => "Delete breakout",
  run(proj, p) {
    const h = H(proj);
    for (const id of p.ids) {
      const n = h.nodes.find((x) => x.id === id);
      if (n && n.kind === "breakout") removeNode(h, id, true);
    }
  },
});

export const setSpliceProps = def<{ id: string; type?: "solderSleeve" | "crimp" | "ultrasonic"; cover?: "heatShrink" | "potting"; pn?: string; nodeId?: string }>("setSpliceProps", {
  label: () => "Edit splice",
  run(proj, p) {
    const s = H(proj).splices.find((x) => x.id === p.id);
    if (!s) return;
    if (p.type) s.type = p.type;
    if (p.cover) s.cover = p.cover;
    if (p.pn) (s.pn = p.pn), (s.pinned = true);
    if (p.nodeId) s.nodeId = p.nodeId;
  },
});

// ─── Layers, clamps, boots, labels, potting, hardware ───────────────────────

export const addLayer = def<{ id: string; segmentIds: string[]; type: Layer["type"]; material?: string; pn?: string; params?: Layer["params"]; stackOrder?: number }>("addLayer", {
  label: (p) => `Add ${layerTypeName(p.type)}`,
  run(proj, p, { cat }) {
    const h = H(proj);
    const maxOrder = Math.max(0, ...h.layers.map((l) => l.stackOrder));
    const pn = p.pn ?? cat.bundle.layers.find((l) => l.type === p.type && (!p.material || l.material === p.material))?.pn ?? "";
    const defaults: Layer["params"] = p.type === "overbraid" ? { coveragePct: 85 } : p.type === "tape" ? { overlapPct: 50, direction: "cw" } : {};
    h.layers.push({ id: p.id, type: p.type, pn, material: p.material ?? cat.layer(pn)?.material ?? "", extents: p.segmentIds.map((segmentId) => ({ segmentId })), stackOrder: p.stackOrder ?? maxOrder + 1, params: { ...defaults, ...p.params }, auto: false, pinned: !!p.pn });
  },
});

export function layerTypeName(t: Layer["type"]): string {
  return { tape: "tape wrap", sleeve: "braided sleeving", heatShrink: "heat shrink", jacket: "jacket", conduit: "conduit", overbraid: "overbraid" }[t];
}

export const updateLayer = def<{ id: string; pn?: string; material?: string; params?: Layer["params"]; pinned?: boolean; extents?: Layer["extents"] }>("updateLayer", {
  label: () => "Edit layer",
  run(proj, p) {
    const l = H(proj).layers.find((x) => x.id === p.id);
    if (!l) return;
    if (p.pn) {
      l.pn = p.pn;
      l.pinned = true;
      for (const e of l.extents) delete e.pn;
    }
    if (p.material) (l.material = p.material), (l.pinned = false);
    if (p.params) l.params = { ...l.params, ...p.params };
    if (p.pinned !== undefined) l.pinned = p.pinned;
    if (p.extents) l.extents = p.extents;
  },
});

export const setLayerExtent = def<{ id: string; segmentId: string; startMm?: number; endMm?: number }>("setLayerExtent", {
  label: () => "Set layer extent",
  run(proj, p) {
    const h = H(proj);
    const l = h.layers.find((x) => x.id === p.id);
    const s = h.segments.find((x) => x.id === p.segmentId);
    if (!l || !s) return;
    const e = l.extents.find((x) => x.segmentId === p.segmentId);
    if (!e) return;
    const st = p.startMm == null ? undefined : Math.max(0, Math.min(s.lengthMm, p.startMm));
    const en = p.endMm == null ? undefined : Math.max(st ?? 0, Math.min(s.lengthMm, p.endMm));
    e.startMm = st && st > 0.01 ? st : undefined;
    e.endMm = en != null && en < s.lengthMm - 0.01 ? en : undefined;
  },
});

export const reorderLayers = def<{ segmentId?: string; orderedIds: string[] }>("reorderLayers", {
  label: () => "Reorder layers",
  run(proj, p) {
    const h = H(proj);
    const orders = p.orderedIds.map((id) => h.layers.find((l) => l.id === id)?.stackOrder ?? 0).sort((a, b) => a - b);
    p.orderedIds.forEach((id, i) => {
      const l = h.layers.find((x) => x.id === id);
      if (l) l.stackOrder = orders[i]!;
    });
  },
});

export const removeLayers = def<{ ids: string[]; segmentId?: string }>("removeLayers", {
  label: () => "Remove layer",
  run(proj, p) {
    const h = H(proj);
    if (p.segmentId) {
      for (const l of h.layers) if (p.ids.includes(l.id)) l.extents = l.extents.filter((e) => e.segmentId !== p.segmentId);
    } else h.layers = h.layers.filter((l) => !p.ids.includes(l.id));
  },
});

export const addClamp = def<{ id: string; nodeId: string; pn: string; quantity?: number }>("addClamp", {
  label: () => "Add band clamp",
  run(proj, p) {
    H(proj).clamps.push({ id: p.id, nodeId: p.nodeId, pn: p.pn, quantity: p.quantity ?? 1, auto: false, pinned: true });
  },
});

export const updateClamp = def<{ id: string; pn?: string; quantity?: number }>("updateClamp", {
  label: () => "Edit band clamp",
  run(proj, p) {
    const c = H(proj).clamps.find((x) => x.id === p.id);
    if (!c) return;
    if (p.pn) c.pn = p.pn;
    if (p.quantity) c.quantity = p.quantity;
    c.pinned = true;
  },
});

export const removeClamps = def<{ ids: string[] }>("removeClamps", {
  label: () => "Remove band clamp",
  run(proj, p) {
    const h = H(proj);
    for (const c of h.clamps) if (p.ids.includes(c.id) && c.terminationId) h.suppressedAuto.push(`clamp@${c.terminationId}`);
    h.clamps = h.clamps.filter((c) => !p.ids.includes(c.id));
  },
});

export const addBoot = def<{ id: string; nodeId: string; shape: Boot["shape"]; pn?: string }>("addBoot", {
  label: () => "Add boot",
  run(proj, p) {
    const h = H(proj);
    h.boots = h.boots.filter((b) => b.nodeId !== p.nodeId);
    h.suppressedAuto = h.suppressedAuto.filter((k) => k !== `boot@${p.nodeId}`);
    h.boots.push({ id: p.id, nodeId: p.nodeId, shape: p.shape, pn: p.pn ?? "", auto: !p.pn, pinned: !!p.pn });
  },
});

export const removeBoots = def<{ ids: string[] }>("removeBoots", {
  label: () => "Remove boot",
  run(proj, p) {
    const h = H(proj);
    for (const b of h.boots) if (p.ids.includes(b.id) && b.rule) h.suppressedAuto.push(`boot@${b.nodeId}`);
    h.boots = h.boots.filter((b) => !p.ids.includes(b.id));
  },
});

export const addLabel = def<{ id: string; attachedTo: Label["attachedTo"]; template: string; type?: Label["type"]; distanceMm?: number }>("addLabel", {
  label: () => "Add label",
  run(proj, p) {
    H(proj).labels.push({ id: p.id, attachedTo: p.attachedTo, template: p.template, type: p.type ?? "sleeve", pn: "", distanceMm: p.distanceMm ?? proj.settings.defaultLabelDistanceMm, auto: false, pinned: false });
  },
});

export const updateLabel = def<{ id: string; template?: string; type?: Label["type"]; distanceMm?: number; pn?: string }>("updateLabel", {
  label: () => "Edit label",
  run(proj, p) {
    const l = H(proj).labels.find((x) => x.id === p.id);
    if (!l) return;
    if (p.template !== undefined) l.template = p.template;
    if (p.type) l.type = p.type;
    if (p.distanceMm !== undefined) l.distanceMm = p.distanceMm;
    if (p.pn) l.pn = p.pn;
    if (l.auto) l.pinned = true;
  },
});

export const removeLabels = def<{ ids: string[] }>("removeLabels", {
  label: () => "Delete label",
  run(proj, p) {
    const h = H(proj);
    for (const l of h.labels) {
      if (!p.ids.includes(l.id) || !l.auto) continue;
      h.suppressedAuto.push(`label:${l.rule}|${l.attachedTo.kind}|${l.attachedTo.id}|${l.attachedTo.nodeId ?? ""}`);
    }
    h.labels = h.labels.filter((l) => !p.ids.includes(l.id));
  },
});

export const setLabelRules = def<{ connectorRefDes?: boolean; wireIds?: boolean; harnessId?: boolean; pedigreeMarkings?: boolean }>("setLabelRules", {
  label: () => "Labeling rules",
  run(proj, p) {
    const h = H(proj);
    Object.assign(h.labelRules, p);
    h.suppressedAuto = h.suppressedAuto.filter((k) => !k.startsWith("label:"));
  },
});

export const addPotting = def<{ id: string; targetKind: "connector" | "splice"; targetId: string; compoundPn: string; moldPn?: string; depthMm?: number }>("addPotting", {
  label: () => "Add potting",
  run(proj, p) {
    const h = H(proj);
    h.potting = h.potting.filter((x) => x.targetId !== p.targetId);
    h.potting.push({ id: p.id, targetKind: p.targetKind, targetId: p.targetId, compoundPn: p.compoundPn, moldPn: p.moldPn ?? "", depthMm: p.depthMm ?? 12 });
  },
});

export const removePotting = def<{ ids: string[] }>("removePotting", {
  label: () => "Remove potting",
  run(proj, p) {
    const h = H(proj);
    h.potting = h.potting.filter((x) => !p.ids.includes(x.id));
  },
});

export const addHardware = def<{ id: string; segmentId: string; positionMm: number; type: Hardware["type"]; pn?: string }>("addHardware", {
  label: (p) => (p.type === "cushionClamp" ? "Add tie-down clamp" : "Add tie"),
  run(proj, p) {
    H(proj).hardware.push({ id: p.id, segmentId: p.segmentId, positionMm: p.positionMm, type: p.type, pn: p.pn ?? "", inBom: false });
  },
});

export const updateHardware = def<{ id: string; positionMm?: number; pn?: string; inBom?: boolean }>("updateHardware", {
  label: () => "Edit tie-down",
  run(proj, p) {
    const x = H(proj).hardware.find((y) => y.id === p.id);
    if (!x) return;
    if (p.positionMm !== undefined) x.positionMm = p.positionMm;
    if (p.pn !== undefined) x.pn = p.pn;
    if (p.inBom !== undefined) x.inBom = p.inBom;
  },
});

export const removeHardware = def<{ ids: string[] }>("removeHardware", {
  label: () => "Remove tie-down",
  run(proj, p) {
    const h = H(proj);
    h.hardware = h.hardware.filter((x) => !p.ids.includes(x.id));
  },
});

export const addNote = def<{ id: string; position: Point; text: string }>("addNote", {
  label: () => "Add note",
  run(proj, p) {
    H(proj).notes.push({ id: p.id, position: p.position, text: p.text });
  },
});

export const updateNote = def<{ id: string; text?: string; position?: Point }>("updateNote", {
  label: () => "Edit note",
  run(proj, p) {
    const n = H(proj).notes.find((x) => x.id === p.id);
    if (!n) return;
    if (p.text !== undefined) n.text = p.text;
    if (p.position) n.position = p.position;
  },
});

export const deleteNotes = def<{ ids: string[] }>("deleteNotes", {
  label: () => "Delete note",
  run(proj, p) {
    const h = H(proj);
    h.notes = h.notes.filter((n) => !p.ids.includes(n.id));
  },
});

// ─── Finishing presets (§6.13) ──────────────────────────────────────────────

export const applyPreset = def<{ preset: FinishingPreset; segmentIds?: string[]; connectorIds?: string[] }>("applyPreset", {
  label: (p) => `Finish: ${p.preset.name}`,
  run(proj, p, { cat }) {
    const h = H(proj);
    const segs = p.segmentIds ?? h.segments.map((s) => s.id);
    const conns = p.connectorIds ?? h.connectors.map((c) => c.id);
    for (const step of p.preset.steps) {
      switch (step.action) {
        case "tape":
        case "sleeve":
        case "jacket":
        case "overbraid": {
          const type = step.action === "sleeve" ? "sleeve" : step.action;
          // Skip segments that already have this layer type
          const covered = new Set(h.layers.filter((l) => l.type === type).flatMap((l) => l.extents.map((e) => e.segmentId)));
          const target = segs.filter((s) => !covered.has(s));
          if (!target.length) break;
          const maxOrder = Math.max(0, ...h.layers.map((l) => l.stackOrder));
          const material = step.params.material as string | undefined;
          const pn = cat.bundle.layers.find((l) => l.type === type && (!material || l.material === material))?.pn ?? "";
          h.layers.push({
            id: uid(),
            type,
            pn,
            material: material ?? "",
            extents: target.map((segmentId) => ({ segmentId })),
            stackOrder: (step.params.stackOrder as number | undefined) ?? maxOrder + 1,
            params: type === "overbraid" ? { coveragePct: (step.params.coveragePct as number) ?? 85 } : type === "tape" ? { overlapPct: 50, direction: "cw" } : {},
            auto: true,
            pinned: false,
          });
          break;
        }
        case "backshells": {
          const style = (step.params.style as string) ?? "emiBand";
          for (const cid of conns) {
            const c = connectorById(h, cid);
            const part = c && cat.connector(c.pn);
            if (!c || !part) continue;
            const cur = c.backshell && cat.backshell(c.backshell.pn);
            if (cur && (cur.style === style || (style === "emiBand" && cur.bandPlatform))) continue;
            const bs = cat.backshellsFor(part.shellSize).find((b) => b.style === style && b.angle === (cur?.angle ?? 0));
            if (bs) c.backshell = { pn: bs.pn, clockingDeg: c.backshell?.clockingDeg ?? 0, auto: true };
          }
          break;
        }
        case "bandClamps":
          // Clamps follow terminations automatically; ensure 360° at connectors.
          normalize(proj, { cat });
          for (const t of H(proj).terminations) {
            const isConn = H(proj).nodes.find((n) => n.id === t.nodeId)?.kind === "connector";
            if (isConn && t.auto && (t.method === "floating" || t.method === "foldBack")) t.method = "band360";
          }
          break;
        case "connectorLabels":
          h.labelRules.connectorRefDes = true;
          break;
        case "wireIdLabels":
          h.labelRules.wireIds = true;
          break;
        case "boots":
          for (const cid of conns) {
            const node = h.nodes.find((n) => n.connectorId === cid);
            if (!node || h.boots.some((b) => b.nodeId === node.id)) continue;
            const c = connectorById(h, cid)!;
            const bs = c.backshell && cat.backshell(c.backshell.pn);
            h.boots.push({ id: uid(), nodeId: node.id, shape: bs && bs.angle === 90 ? "90" : "straight", pn: "", auto: true, pinned: false });
          }
          break;
      }
      normalize(proj, { cat });
    }
  },
});

// ─── Project-level ─────────────────────────────────────────────────────────

export const setProjectProps = def<{ name?: string; partNumber?: string; units?: "mm" | "in" }>("setProjectProps", {
  label: (p) => (p.units ? `Units: ${p.units}` : "Edit project"),
  allowFrozen: true,
  run(proj, p) {
    if (p.name !== undefined) proj.name = p.name;
    if (p.partNumber !== undefined) proj.partNumber = p.partNumber;
    if (p.units) proj.units = p.units;
  },
});

export const setSettings = def<Partial<Settings>>("setSettings", {
  label: () => "Change settings",
  run(proj, p) {
    Object.assign(proj.settings, p);
  },
});

export const setActivePedigree = def<{ id: string }>("setActivePedigree", {
  label: (p) => `Switch pedigree`,
  allowFrozen: true,
  run(proj, p) {
    if (proj.pedigreeScheme.pedigrees.some((x) => x.id === p.id)) currentRevision(proj).activePedigreeId = p.id;
  },
});

export const setPedigreeScheme = def<{ scheme: PedigreeScheme; activeId?: string }>("setPedigreeScheme", {
  label: () => "Edit pedigrees",
  allowFrozen: true,
  run(proj, p) {
    proj.pedigreeScheme = p.scheme;
    for (const r of proj.revisions) {
      if (!p.scheme.pedigrees.some((x) => x.id === r.activePedigreeId)) r.activePedigreeId = p.scheme.pedigrees[0]!.id;
    }
    if (p.activeId) currentRevision(proj).activePedigreeId = p.activeId;
  },
});

export const upsertProjectRule = def<{ rule: RuleInstance }>("upsertProjectRule", {
  label: (p) => `Edit rule ${p.rule.id}`,
  allowFrozen: true,
  run(proj, p) {
    const i = proj.projectRules.findIndex((r) => r.id === p.rule.id);
    if (i >= 0) proj.projectRules[i] = p.rule;
    else proj.projectRules.push(p.rule);
  },
});

export const deleteProjectRules = def<{ ids: string[] }>("deleteProjectRules", {
  label: () => "Delete rule",
  allowFrozen: true,
  run(proj, p) {
    proj.projectRules = proj.projectRules.filter((r) => !p.ids.includes(r.id));
  },
});

export const setRuleOverride = def<{ override: RuleOverride | { ruleId: string; remove: true } }>("setRuleOverride", {
  label: () => "Override rule",
  allowFrozen: true,
  run(proj, p) {
    proj.overrides = proj.overrides.filter((o) => o.ruleId !== p.override.ruleId);
    if (!("remove" in p.override)) proj.overrides.push(p.override);
  },
});

export const addWaiver = def<{ waiver: Waiver }>("addWaiver", {
  label: () => "Waive",
  allowFrozen: true,
  run(proj, p) {
    proj.waivers.push(p.waiver);
  },
});

export const removeWaivers = def<{ ids: string[] }>("removeWaivers", {
  label: () => "Remove waiver",
  allowFrozen: true,
  run(proj, p) {
    proj.waivers = proj.waivers.filter((w) => !p.ids.includes(w.id));
  },
});

export const upsertRuleset = def<{ ruleset: Ruleset }>("upsertRuleset", {
  label: (p) => `Apply ruleset ${p.ruleset.name}`,
  allowFrozen: true,
  run(proj, p) {
    const i = proj.rulesets.findIndex((r) => r.id === p.ruleset.id);
    if (i >= 0) proj.rulesets[i] = p.ruleset;
    else proj.rulesets.push(p.ruleset);
  },
});

export const removeRuleset = def<{ id: string }>("removeRuleset", {
  label: () => "Remove ruleset",
  allowFrozen: true,
  run(proj, p) {
    proj.rulesets = proj.rulesets.filter((r) => r.id !== p.id);
  },
});

export const upsertPreset = def<{ preset: FinishingPreset }>("upsertPreset", {
  label: (p) => `Save preset ${p.preset.name}`,
  allowFrozen: true,
  run(proj, p) {
    const i = proj.presets.findIndex((x) => x.id === p.preset.id);
    if (i >= 0) proj.presets[i] = p.preset;
    else proj.presets.push(p.preset);
  },
});

export const setTitleBlock = def<Partial<TitleBlock>>("setTitleBlock", {
  label: () => "Edit title block",
  allowFrozen: true,
  run(proj, p) {
    Object.assign(proj.titleBlock, p);
  },
});

export const setReportText = def<{ summary?: string; designNotes?: string; reviewComments?: string; sections?: Record<string, boolean> }>("setReportText", {
  label: () => "Edit report",
  allowFrozen: true,
  run(proj, p) {
    if (p.summary !== undefined) proj.report.summary = p.summary;
    if (p.designNotes !== undefined) proj.report.designNotes = p.designNotes;
    if (p.reviewComments !== undefined) proj.report.reviewComments = p.reviewComments;
    if (p.sections) proj.report.sections = { ...proj.report.sections, ...p.sections };
  },
});

export const setQuoteSelection = def<{ qty?: number; tier?: string; quantities?: number[] }>("setQuoteSelection", {
  label: () => "Select quote",
  allowFrozen: true,
  run(proj, p) {
    if (p.quantities) proj.quote.quantities = [...new Set(p.quantities)].sort((a, b) => a - b);
    if (p.qty !== undefined) proj.quote.selected.qty = p.qty;
    if (p.tier) proj.quote.selected.tier = p.tier;
  },
});

export const setCustomerFurnished = def<{ pn: string; furnished: boolean }>("setCustomerFurnished", {
  label: (p) => (p.furnished ? `Customer-furnished: ${p.pn}` : `We supply: ${p.pn}`),
  allowFrozen: true,
  run(proj, p) {
    const list = proj.quote.customerFurnished.filter((x) => x !== p.pn);
    if (p.furnished) list.push(p.pn);
    proj.quote.customerFurnished = list;
  },
});

/** Freeze the current revision (immutable) and continue on the next letter (§4.3). */
export const freezeRevision = def<{ notes: string; newRevisionId: string; snapshot?: unknown; at: string }>("freezeRevision", {
  label: () => "Freeze revision",
  allowFrozen: false,
  run(proj, p) {
    const cur = currentRevision(proj);
    cur.frozen = true;
    cur.frozenAt = p.at;
    cur.notes = p.notes;
    cur.snapshot = p.snapshot;
    const next = nextRevisionLabel(cur.label);
    proj.revisions.push({ id: p.newRevisionId, label: next, notes: "", frozen: false, activePedigreeId: cur.activePedigreeId, harness: snapshot(cur.harness) });
    proj.currentRevisionId = p.newRevisionId;
  },
});

export const openRevision = def<{ id: string }>("openRevision", {
  label: () => "Open revision",
  allowFrozen: true,
  run(proj, p) {
    if (proj.revisions.some((r) => r.id === p.id)) proj.currentRevisionId = p.id;
  },
});

export function nextRevisionLabel(label: string): string {
  // A..Z then AA.. (skip I, O, Q, S, X, Z per ASME Y14.35 convention)
  const letters = "ABCDEFGHJKLMNPRTUVWY";
  const i = letters.indexOf(label);
  if (i >= 0 && i < letters.length - 1) return letters[i + 1]!;
  return label + "A";
}

/** Swap every use of a part PN for another (BOM alternates, §11). */
export const replacePart = def<{ fromPn: string; toPn: string }>("replacePart", {
  label: (p) => `Swap ${p.fromPn} → ${p.toPn}`,
  run(proj, p) {
    const h = H(proj);
    const from = normalizePn(p.fromPn);
    const eq = (x: string) => normalizePn(x) === from;
    for (const c of h.connectors) {
      if (eq(c.pn)) c.pn = p.toPn;
      if (c.backshell && eq(c.backshell.pn)) c.backshell = { ...c.backshell, pn: p.toPn, auto: false };
      for (const a of c.accessories) if (eq(a.pn)) a.pn = p.toPn;
      for (const pin of Object.values(c.pins)) if (pin.contactPn && eq(pin.contactPn)) pin.contactPn = p.toPn;
    }
    for (const w of h.wires) {
      if (eq(w.spec)) (w.spec = p.toPn), w.pinned.includes("spec") || w.pinned.push("spec");
    }
    for (const l of h.layers) if (eq(l.pn)) (l.pn = p.toPn), (l.pinned = true);
    for (const c of h.clamps) if (eq(c.pn)) (c.pn = p.toPn), (c.pinned = true);
    for (const b of h.boots) if (eq(b.pn)) (b.pn = p.toPn), (b.pinned = true);
    for (const l of h.labels) if (eq(l.pn)) l.pn = p.toPn;
    for (const s of h.splices) if (eq(s.pn)) (s.pn = p.toPn), (s.pinned = true);
  },
});

/** Replace the whole harness (import). */
export const replaceHarness = def<{ harness: Harness; label?: string }>("replaceHarness", {
  label: (p) => p.label ?? "Import",
  run(proj, p) {
    currentRevision(proj).harness = p.harness;
  },
});

/** Merge imported content into the harness (import into existing design). */
export const mergeHarness = def<{ harness: Harness; label?: string }>("mergeHarness", {
  label: (p) => p.label ?? "Import",
  run(proj, p) {
    const h = H(proj);
    const src = p.harness;
    const used = new Set(h.connectors.map((c) => c.refDes));
    for (const c of src.connectors) {
      if (used.has(c.refDes)) c.refDes = `${c.refDes}_${h.connectors.length + 1}`;
      h.connectors.push(c);
    }
    h.nodes.push(...src.nodes);
    h.segments.push(...src.segments);
    for (const n of src.nets) {
      const existing = h.nets.find((x) => x.name === n.name);
      if (existing) existing.members.push(...n.members);
      else h.nets.push(n);
    }
    h.wires.push(...src.wires);
  },
});

// Utility re-exports for the UI
export { derive };
export type { CustomRule, Accessory };
