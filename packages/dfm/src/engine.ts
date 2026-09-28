import {
  currentRevision,
  derive,
  formatLength,
  quickHash,
  resolvePedigree,
  stableStringify,
  type CatalogIndex,
  type Harness,
  type InspectionType,
  type MachineProfile,
  type Project,
  type ResolvedPedigree,
  type Revision,
  type RuleInstance,
  type Severity,
} from "@hs/model";
import { computeBom, type Bom } from "@hs/ops";
import { evaluateCustom } from "./custom";
import { RULE_TYPE_BY_ID } from "./ruletypes";
import type { DfmSummary, EffectiveRule, EntityKind, RuleCtx, RuleResult, RuleSource, Violation } from "./types";

const SEV_RANK: Record<Severity, number> = { off: 0, info: 1, warning: 2, error: 3 };

export interface DfmOptions {
  project: Project;
  rev?: Revision;
  cat: CatalogIndex;
  profile: MachineProfile;
  inspections?: InspectionType[];
  pedigreeId?: string;
  qty?: number;
  tierDays?: number;
  cache?: DfmCache;
}

/** Rules generated from the active pedigree's process/parts policy (§10.1). */
export function pedigreeRules(ped: ResolvedPedigree): RuleInstance[] {
  const out: RuleInstance[] = [];
  const r = (id: string, type: string, title: string, severity: Severity, params: Record<string, unknown> = {}): RuleInstance => ({ id: `PED-${ped.code}-${id}`, type, category: "Process", severity, title, description: "", rationale: `Required by pedigree ${ped.name}.`, params, enabled: true });
  if (ped.process.noSplices) out.push(r("SPL", "no_splices", "No splices or daisy chains", "error"));
  if (ped.process.noPotting) out.push(r("POT", "no_potting", "No potting", "error"));
  if (ped.process.requireBoots) out.push(r("BOOT", "require_boots", "Boots at every backshell", "error"));
  if (ped.process.serializedLabels) out.push(r("SER", "serialized_labels", "Serialized identification label", "error"));
  if (ped.partsPolicy.qplOnly) out.push(r("QPL", "qpl_only", "QPL / standard parts only", "warning"));
  if (ped.partsPolicy.bannedFinishes?.length) out.push(r("FIN", "allowed_parts", `Banned shell classes: ${ped.partsPolicy.bannedFinishes.join(", ")}`, "error", { bannedFinishes: ped.partsPolicy.bannedFinishes }));
  return out;
}

function paramDefaults(type: string): Record<string, unknown> {
  const t = RULE_TYPE_BY_ID.get(type);
  return Object.fromEntries((t?.params ?? []).filter((p) => p.default !== undefined).map((p) => [p.key, p.default]));
}

function severityAt(rule: RuleInstance, lineage: string[]): Severity {
  for (const pid of lineage) {
    const s = rule.severityByPedigree?.[pid];
    if (s) return s;
  }
  return rule.severity;
}

function paramsAt(rule: RuleInstance, lineage: string[]): Record<string, any> {
  let p: Record<string, any> = { ...paramDefaults(rule.type), ...rule.params };
  for (const pid of [...lineage].reverse()) if (rule.paramsByPedigree?.[pid]) p = { ...p, ...rule.paramsByPedigree[pid] };
  return p;
}

function isStricter(dir: "higher" | "lower", a: number, b: number) {
  return dir === "higher" ? a > b : a < b;
}

/** Collect every rule instance with its effective severity/params for a pedigree (§9.4 resolution order). */
export function collectRules(project: Project, profile: MachineProfile, pedigreeId: string): EffectiveRule[] {
  const scheme = project.pedigreeScheme;
  const ped = resolvePedigree(scheme, pedigreeId);
  const lineage = ped.lineage;
  const out: EffectiveRule[] = [];
  const add = (rule: RuleInstance, source: RuleSource) => {
    let severity = severityAt(rule, lineage);
    let params = paramsAt(rule, lineage);
    const notes: string[] = [];
    let overridden = false;
    const o = project.overrides.find((x) => x.ruleId === rule.id);
    if (o && source.layer !== "manufacturer" && source.layer !== "pedigree") {
      if (source.enforced) notes.push("Ruleset is enforced: project override ignored.");
      else {
        if (o.enabled === false) severity = "off";
        if (o.severity) severity = o.severity;
        if (o.params) params = { ...params, ...o.params };
        overridden = true;
        if (o.note) notes.push(`Project override: ${o.note}`);
      }
    }
    const enabled = rule.enabled !== false;
    if (!enabled) severity = "off";
    const byPed: Record<string, Severity> = {};
    for (const p of scheme.pedigrees) byPed[p.id] = enabled ? severityAt(rule, resolvePedigree(scheme, p.id).lineage) : "off";
    out.push({ rule, severity, params, source, sources: [source], notes, overridden, severityByPedigree: byPed });
  };
  const mfgSource: RuleSource = { layer: "manufacturer", name: `Manufacturer (profile ${profile.version})`, version: profile.version };
  for (const r of profile.rules) add(r, mfgSource);
  const pedOnly = new Set(scheme.pedigrees.flatMap((p) => p.extraRulesetIds ?? []));
  for (const rs of project.rulesets) {
    if (pedOnly.has(rs.id) && !ped.extraRulesetIds.includes(rs.id)) continue;
    for (const r of rs.rules) add(r, { layer: "ruleset", name: rs.name, version: rs.version, enforced: rs.enforced });
  }
  for (const r of project.projectRules) add(r, { layer: "project", name: "Project rules" });
  for (const r of pedigreeRules(ped)) add(r, { layer: "pedigree", name: `Pedigree: ${ped.name}` });

  // Stricter-wins: notes vs the Manufacturer layer; merge duplicates between user rule sources (§9.5.1).
  const mfg = out.filter((e) => e.source.layer === "manufacturer");
  const user = out.filter((e) => e.source.layer !== "manufacturer" && e.rule.type !== "custom");
  for (const u of user) {
    const t = RULE_TYPE_BY_ID.get(u.rule.type);
    if (!t) continue;
    for (const pd of t.params.filter((x) => x.stricter)) {
      const m = mfg.find((x) => x.rule.type === u.rule.type && x.severity !== "off");
      const uv = Number(u.params[pd.key]);
      const mv = m ? Number(m.params[pd.key]) : NaN;
      if (m && Number.isFinite(uv) && Number.isFinite(mv) && isStricter(pd.stricter!, mv, uv)) u.notes.push(`Manufacturer limit is stricter (${pd.label}: ${uv} → ${mv}). This rule has no effect below that.`);
    }
  }
  const groups = new Map<string, EffectiveRule[]>();
  for (const u of user) {
    if (u.severity === "off") continue;
    const t = RULE_TYPE_BY_ID.get(u.rule.type);
    const strictKeys = new Set((t?.params ?? []).filter((p) => p.stricter).map((p) => p.key));
    if (!strictKeys.size) continue;
    const rest = Object.fromEntries(Object.entries(u.params).filter(([k]) => !strictKeys.has(k)));
    const key = `${u.rule.type}|${stableStringify(u.rule.scope ?? {})}|${stableStringify(rest)}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(u);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const t = RULE_TYPE_BY_ID.get(g[0]!.rule.type)!;
    const pd = t.params.find((p) => p.stricter)!;
    const winner = g.reduce((a, b) => (isStricter(pd.stricter!, Number(b.params[pd.key]), Number(a.params[pd.key])) ? b : a));
    for (const e of g) {
      if (e === winner) continue;
      winner.sources.push(e.source);
      e.notes.push(`Superseded by stricter ${winner.rule.id} (${winner.source.name}).`);
      (e as EffectiveRule & { superseded?: boolean }).superseded = true;
    }
  }
  return out;
}

/** Caches rule results keyed by the hash of the entity slices each rule type depends on (incremental re-evaluation). */
export class DfmCache {
  private map = new Map<string, { dep: string; violations: Violation[] }>();
  get(key: string, dep: string) {
    const e = this.map.get(key);
    return e && e.dep === dep ? e.violations : undefined;
  }
  set(key: string, dep: string, violations: Violation[]) {
    this.map.set(key, { dep, violations });
    if (this.map.size > 2000) this.map.delete(this.map.keys().next().value!);
  }
}

function sliceHasher(h: Harness, project: Project, qty: number, tierDays: number) {
  const cache = new Map<EntityKind, string>();
  const src: Record<EntityKind, () => unknown> = {
    connector: () => h.connectors,
    pin: () => h.connectors,
    net: () => h.nets,
    wire: () => h.wires,
    segment: () => h.segments,
    node: () => h.nodes,
    layer: () => h.layers,
    shield: () => h.shields,
    termination: () => h.terminations,
    clamp: () => h.clamps,
    boot: () => h.boots,
    label: () => [h.labels, h.labelRules],
    splice: () => h.splices,
    potting: () => h.potting,
    cable: () => h.cables,
    twist: () => h.twistGroups,
    project: () => [project.partNumber, project.settings, project.quote, qty, tierDays],
    bom: () => [h, project.quote, project.settings, qty],
  };
  return (kinds: EntityKind[]) =>
    kinds
      .map((k) => {
        if (!cache.has(k)) cache.set(k, quickHash(stableStringify(src[k]())));
        return cache.get(k)!;
      })
      .join(".");
}

function isWaivable(eff: EffectiveRule): boolean {
  if (eff.source.layer === "manufacturer") return eff.severity !== "error";
  if (eff.source.layer === "pedigree") return false;
  return !eff.source.enforced;
}

export function runDfm(opts: DfmOptions): DfmSummary {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { project, cat, profile } = opts;
  const rev = opts.rev ?? currentRevision(project);
  const pedId = opts.pedigreeId ?? rev.activePedigreeId;
  const ped = resolvePedigree(project.pedigreeScheme, pedId);
  const h = rev.harness;
  const qty = opts.qty ?? project.quote.selected.qty;
  const tierDays = opts.tierDays ?? 15;
  const d = derive(h, cat, { ...project.settings, packingFactor: project.settings.packingFactor ?? profile.capabilities.packingFactor }, { breakoutAllowanceMm: profile.capabilities.breakoutAllowanceMm });
  let bom: Bom | undefined;
  const refs = new Map(h.connectors.map((c) => [c.id, c.refDes || c.pn]));
  const ctx: RuleCtx = {
    project,
    rev,
    h,
    cat,
    d,
    profile,
    ped,
    bom: () => (bom ??= computeBom(project, rev, cat, d, qty)),
    units: project.units,
    qty,
    tierDays,
    len: (mm) => formatLength(mm, project.units, { decimals: project.units === "in" ? 2 : 1 }),
    refDes: (id) => refs.get(id) ?? "?",
  };
  const hashOf = sliceHasher(h, project, qty, tierDays);
  const rules = collectRules(project, profile, pedId);
  const results: RuleResult[] = [];
  const catV = cat.version.hash;
  for (const eff of rules) {
    const r0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    if ((eff as EffectiveRule & { superseded?: boolean }).superseded) {
      results.push({ eff, status: "superseded", violations: [], waived: [], ms: 0 });
      continue;
    }
    if (eff.severity === "off") {
      results.push({ eff, status: "off", violations: [], waived: [], ms: 0 });
      continue;
    }
    let violations: Violation[] = [];
    let error: string | undefined;
    try {
      if (eff.rule.type === "custom" || eff.rule.custom) {
        if (!eff.rule.custom) throw new Error("Custom rule has no definition");
        violations = evaluateCustom(ctx, eff.rule.custom);
      } else {
        const t = RULE_TYPE_BY_ID.get(eff.rule.type);
        if (!t) throw new Error(`Unknown rule type "${eff.rule.type}"`);
        const key = `${eff.rule.id}|${stableStringify(eff.params)}|${stableStringify(eff.rule.scope ?? null)}|${pedId}|${catV}`;
        const dep = hashOf(t.depends);
        const cached = opts.cache?.get(key, dep);
        if (cached) violations = cached;
        else {
          violations = t.evaluate(ctx, eff.params, eff.rule);
          opts.cache?.set(key, dep, violations);
        }
      }
    } catch (e) {
      error = (e as Error).message;
    }
    const waived: RuleResult["waived"] = [];
    if (isWaivable(eff)) {
      violations = violations.filter((v) => {
        const w = project.waivers.find((x) => x.ruleId === eff.rule.id && (x.objectId === "*" || v.objectIds.includes(x.objectId)));
        if (w) {
          waived.push({ ...v, waiverId: w.id, note: w.note });
          return false;
        }
        return true;
      });
    }
    const status = error ? "error" : violations.length ? "fail" : waived.length ? "waived" : "pass";
    results.push({ eff, status, violations, waived, error, ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - r0 });
  }

  const byObject: DfmSummary["byObject"] = {};
  for (const r of results) {
    if (r.status !== "fail") continue;
    for (const v of r.violations)
      for (const id of v.objectIds) {
        const cur = byObject[id];
        if (!cur) byObject[id] = { severity: r.eff.severity, ruleIds: [r.eff.rule.id] };
        else {
          if (SEV_RANK[r.eff.severity] > SEV_RANK[cur.severity]) cur.severity = r.eff.severity;
          if (!cur.ruleIds.includes(r.eff.rule.id)) cur.ruleIds.push(r.eff.rule.id);
        }
      }
  }
  const tally = (rs: RuleResult[]) => {
    const active = rs.filter((r) => r.status !== "off" && r.status !== "superseded");
    const count = (s: Severity) => active.filter((r) => r.status === "fail" && r.eff.severity === s).reduce((a, r) => a + r.violations.length, 0);
    return { checks: active.length, errors: count("error"), warnings: count("warning"), infos: count("info"), passed: active.filter((r) => r.status === "pass" || r.status === "waived").length };
  };
  const mfgR = results.filter((r) => r.eff.source.layer === "manufacturer");
  const desR = results.filter((r) => r.eff.source.layer !== "manufacturer");
  const m = tally(mfgR);
  const manual = mfgR.some((r) => r.status === "fail" && RULE_TYPE_BY_ID.get(r.eff.rule.type)?.manual);
  const status = m.errors > 0 ? "notBuildable" : manual ? "manual" : "ready";
  const des = tally(desR);
  const rulesets = [...new Set(desR.filter((r) => r.status !== "off").map((r) => (r.eff.source.version ? `${r.eff.source.name} v${r.eff.source.version}` : r.eff.source.name)))];
  const hash = quickHash(results.map((r) => `${r.eff.rule.id}:${r.status}:${r.violations.length}`).join(","));
  return {
    pedigreeId: pedId,
    pedigreeName: ped.name,
    manufacturability: { status, ...m },
    design: { ...des, rulesets },
    results,
    byObject,
    durationMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
    hash,
  };
}

/** Human-readable severity-across-pedigrees summary, e.g. "Error at T2 · warning at T3". */
export function severityAcross(eff: EffectiveRule, project: Project): string | null {
  const vals = Object.values(eff.severityByPedigree);
  if (new Set(vals).size <= 1) return null;
  const byCode = project.pedigreeScheme.pedigrees
    .slice()
    .sort((a, b) => b.rank - a.rank)
    .map((p) => `${eff.severityByPedigree[p.id]} at ${p.code}`);
  return byCode.join(" · ").replace(/^./, (c) => c.toUpperCase());
}
