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
import { INCOMPLETE_STATUSES, type DfmSummary, type EffectiveRule, type RuleCtx, type RuleResult, type RuleSource, type Violation } from "./types";

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
  // Titles name the finding (what's wrong), not the requirement.
  if (ped.process.noSplices) out.push(r("SPL", "no_splices", "Splice or daisy chain used (not allowed)", "error"));
  if (ped.process.noPotting) out.push(r("POT", "no_potting", "Potting used (not allowed)", "error"));
  if (ped.process.requireBoots) out.push(r("BOOT", "require_boots", "Backshell without a boot", "error"));
  if (ped.process.serializedLabels) out.push(r("SER", "serialized_labels", "Serialized ID label missing", "error"));
  if (ped.partsPolicy.qplOnly) out.push(r("QPL", "qpl_only", "Part without qualification evidence", "warning"));
  if (ped.partsPolicy.bannedFinishes?.length) out.push(r("FIN", "allowed_parts", `Banned shell class used (${ped.partsPolicy.bannedFinishes.join(", ")})`, "error", { bannedFinishes: ped.partsPolicy.bannedFinishes }));
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
  // Duplicate constraints from different sources are NOT merged or superseded (FIX-04): every mandatory
  // obligation is evaluated independently with its own severity, scope and source. Only an informational
  // note links them, so a 50 mm project warning can never hide an enforced 100 mm ruleset error.
  const byType = new Map<string, EffectiveRule[]>();
  for (const u of user) if (u.severity !== "off") (byType.get(u.rule.type) ?? byType.set(u.rule.type, []).get(u.rule.type)!).push(u);
  for (const g of byType.values()) {
    if (g.length < 2) continue;
    for (const e of g) {
      const others = g.filter((x) => x !== e).map((x) => `${x.rule.id} (${x.source.name}, ${x.severity})`);
      e.notes.push(`Also constrained by ${others.join(", ")}; each rule is checked independently.`);
    }
  }
  return out;
}

/** What a rule evaluation read, recorded automatically so cache invalidation can't miss a dependency (FIX-03). */
interface DepSet {
  /** Top-level harness collections read (connectors, wires, …). */
  h: string[];
  /** Derived data (routes, lengths, diameters) — depends on the whole harness + settings. */
  d: boolean;
  /** BOM or revision object — depends on everything. */
  all: boolean;
  /** Project-level fields (settings, quote, part number, …). */
  project: boolean;
}

interface CacheEntry {
  deps: DepSet;
  dep: string;
  violations: Violation[];
}

/**
 * Caches rule results. Each entry records which inputs the evaluation actually read (via a tracking proxy),
 * and is reused only when the hash of exactly those inputs is unchanged. Global inputs (catalog, profile,
 * resolved pedigree, params, qty/tier) are part of the key.
 */
export class DfmCache {
  private map = new Map<string, CacheEntry>();
  entry(key: string) {
    return this.map.get(key);
  }
  set(key: string, e: CacheEntry) {
    this.map.delete(key);
    this.map.set(key, e);
    if (this.map.size > 2000) this.map.delete(this.map.keys().next().value!);
  }
  clear() {
    this.map.clear();
  }
}

function depHasher(h: Harness, project: Project, rev: Revision, derivedHash: () => string) {
  const slices = new Map<string, string>();
  let projectHash: string | undefined;
  let allHash: string | undefined;
  const slice = (k: string) => {
    if (!slices.has(k)) slices.set(k, quickHash(stableStringify((h as Record<string, unknown>)[k] ?? null)));
    return slices.get(k)!;
  };
  const proj = () => (projectHash ??= quickHash(stableStringify({ ...project, revisions: undefined, updated: undefined, rev: { ...rev, harness: undefined } })));
  const all = () => (allHash ??= quickHash(stableStringify(h)));
  return (deps: DepSet) => {
    const parts: string[] = [];
    if (deps.all) parts.push(`A${all()}`, `P${proj()}`);
    else {
      for (const k of [...deps.h].sort()) parts.push(`${k}:${slice(k)}`);
      if (deps.d) parts.push(`D${derivedHash()}`);
      if (deps.project) parts.push(`P${proj()}`);
    }
    return parts.join(".");
  };
}

function trackedCtx(ctx: RuleCtx, deps: DepSet): RuleCtx {
  const hs = new Set<string>();
  const h = new Proxy(ctx.h, {
    get(t, k, r) {
      if (typeof k === "string") hs.add(k);
      return Reflect.get(t, k, r);
    },
  });
  const finish = () => (deps.h = [...hs]);
  const out: RuleCtx = {
    ...ctx,
    h,
    get d() {
      deps.d = true;
      return ctx.d;
    },
    get project() {
      deps.project = true;
      return ctx.project;
    },
    get rev() {
      deps.all = true;
      return ctx.rev;
    },
    bom: () => {
      deps.all = true;
      return ctx.bom();
    },
  };
  (out as RuleCtx & { __finish: () => void }).__finish = finish;
  return out;
}

/** Identity of one finding for waivers: the exact set of objects it's about (order-independent). */
export function violationKey(v: Pick<Violation, "objectIds">): string {
  return [...v.objectIds].sort().join("|");
}

/** Thrown by a rule when a required input is absent: the outcome is `missingInput`, never a pass. */
export class MissingInputError extends Error {}

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
  let dHash: string | undefined;
  const derivedHash = () =>
    (dHash ??= quickHash(
      stableStringify({
        len: [...d.wireLengthMm],
        routes: [...d.routes],
        od: [...d.segOuterOdMm],
        core: [...d.segCoreOdMm],
        node: [...d.nodeOdMm],
        wod: [...d.wireOdMm],
        stack: [...d.segStack].map(([k, v]) => [k, v.map((x) => [x.layer.id, x.odAfterMm, x.thicknessMm])]),
        settings: project.settings,
      }),
    ));
  const hashOf = depHasher(h, project, rev, derivedHash);
  const rules = collectRules(project, profile, pedId);
  const results: RuleResult[] = [];
  // Global inputs every rule may read: catalog identity, machine profile content, resolved pedigree, qty/tier.
  const globalKey = quickHash(stableStringify({ cat: cat.version.hash, profile, ped, qty, tierDays, units: project.units }));
  const usedWaivers = new Set<string>();
  for (const eff of rules) {
    const r0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (eff.severity === "off") {
      results.push({ eff, status: "off", violations: [], waived: [], ms: 0 });
      continue;
    }
    let violations: Violation[] = [];
    let error: string | undefined;
    let status: RuleResult["status"] | undefined;
    try {
      const isCustom = eff.rule.type === "custom" || !!eff.rule.custom;
      const t = isCustom ? undefined : RULE_TYPE_BY_ID.get(eff.rule.type);
      if (isCustom && !eff.rule.custom) throw new Error("Custom rule has no definition");
      if (!isCustom && !t) throw new Error(`Unknown rule type "${eff.rule.type}"`);
      // Runtime parameter validation: a missing or non-numeric limit must never evaluate as a pass.
      for (const pd of t?.params ?? []) {
        const v = eff.params[pd.key];
        if (pd.optional && (v === undefined || v === null || v === "")) continue;
        if (pd.type === "number" && (v === undefined || v === null || v === "" || !Number.isFinite(Number(v)))) throw new MissingInputError(`Parameter "${pd.label}" is ${v === undefined || v === "" ? "missing" : `not a number (${String(v)})`}`);
        if (pd.type === "enum" && v !== undefined && pd.options && !pd.options.includes(String(v))) throw new MissingInputError(`Parameter "${pd.label}" has an unknown value "${String(v)}"`);
      }
      const key = `${eff.rule.id}|${eff.rule.type}|${stableStringify(eff.params)}|${stableStringify(eff.rule.scope ?? null)}|${stableStringify(eff.rule.custom ?? null)}|${globalKey}`;
      const prev = opts.cache?.entry(key);
      if (prev && prev.dep === hashOf(prev.deps)) violations = prev.violations;
      else {
        const deps: DepSet = { h: [], d: false, all: false, project: false };
        const tctx = trackedCtx(ctx, deps);
        violations = isCustom ? evaluateCustom(tctx, eff.rule.custom!) : t!.evaluate(tctx, eff.params, eff.rule);
        (tctx as RuleCtx & { __finish: () => void }).__finish();
        opts.cache?.set(key, { deps, dep: hashOf(deps), violations });
      }
    } catch (e) {
      error = (e as Error).message;
      status = e instanceof MissingInputError ? "missingInput" : "engineError";
      violations = [];
    }
    const waived: RuleResult["waived"] = [];
    if (!error && isWaivable(eff)) {
      const ruleWaivers = project.waivers.filter((x) => x.ruleId === eff.rule.id);
      violations = violations.filter((v) => {
        const key = violationKey(v);
        // A waiver covers one specific finding (exact object set); legacy waivers fall back to object/"*" scope.
        const w = ruleWaivers.find((x) => (x.violationKey !== undefined ? x.violationKey === key : x.objectId === "*" || v.objectIds.includes(x.objectId)));
        if (w) {
          usedWaivers.add(w.id);
          waived.push({ ...v, waiverId: w.id, note: w.note, author: w.author, date: w.date, changed: w.message !== undefined && w.message !== v.message, waivedMessage: w.message });
          return false;
        }
        return true;
      });
    }
    status ??= violations.length ? "fail" : waived.length ? "waived" : "pass";
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
  // Waived findings per object, so a selected part can show what was waived on it.
  const waivedByObject: DfmSummary["waivedByObject"] = {};
  for (const r of results)
    for (const w of r.waived)
      for (const id of w.objectIds) {
        const cur = (waivedByObject[id] ??= { ruleIds: [], count: 0 });
        cur.count++;
        if (!cur.ruleIds.includes(r.eff.rule.id)) cur.ruleIds.push(r.eff.rule.id);
      }
  // Waivers that no longer match any finding (fixed, or the finding moved): kept, but listed for clean-up.
  const evaluated = new Set(results.filter((r) => r.status !== "off" && !INCOMPLETE_STATUSES.includes(r.status)).map((r) => r.eff.rule.id));
  const unmatchedWaivers = project.waivers.filter((w) => !usedWaivers.has(w.id) && evaluated.has(w.ruleId)).map((w) => w.id);
  const tally = (rs: RuleResult[]) => {
    const active = rs.filter((r) => r.status !== "off");
    const count = (s: Severity) => active.filter((r) => r.status === "fail" && r.eff.severity === s).reduce((a, r) => a + r.violations.length, 0);
    return {
      checks: active.length,
      errors: count("error"),
      warnings: count("warning"),
      infos: count("info"),
      passed: active.filter((r) => r.status === "pass" || r.status === "waived" || r.status === "notApplicable").length,
      incomplete: active.filter((r) => INCOMPLETE_STATUSES.includes(r.status)).length,
    };
  };
  const mfgR = results.filter((r) => r.eff.source.layer === "manufacturer");
  const desR = results.filter((r) => r.eff.source.layer !== "manufacturer");
  const m = tally(mfgR);
  // A waiver documents acceptance; it doesn't remove the manual operation behind a finding.
  const manual = mfgR.some((r) => (r.status === "fail" || r.status === "waived") && RULE_TYPE_BY_ID.get(r.eff.rule.type)?.manual);
  const reviewRs = mfgR.filter((r) => (r.status === "fail" || r.status === "waived") && RULE_TYPE_BY_ID.get(r.eff.rule.type)?.review);
  const review = reviewRs.reduce((a, r) => a + r.violations.length + r.waived.length, 0);
  // Design-rule errors that couldn't run also block a "ready" claim for the build class.
  const desIncomplete = desR.filter((r) => INCOMPLETE_STATUSES.includes(r.status) && r.eff.severity === "error");
  const blockers: string[] = [];
  if (m.errors) blockers.push(`${m.errors} manufacturer error${m.errors > 1 ? "s" : ""}`);
  for (const r of mfgR.filter((x) => INCOMPLETE_STATUSES.includes(x.status))) blockers.push(`${r.eff.rule.id} ${r.eff.rule.title}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
  for (const r of desIncomplete) blockers.push(`${r.eff.rule.id} ${r.eff.rule.title}: ${r.status}${r.error ? ` (${r.error})` : ""}`);
  for (const r of reviewRs) blockers.push(`${r.eff.rule.title}: ${r.violations.length + r.waived.length} item${r.violations.length + r.waived.length > 1 ? "s" : ""} need data review`);
  const status: DfmSummary["manufacturability"]["status"] = m.errors > 0 ? "notBuildable" : m.incomplete > 0 || desIncomplete.length > 0 || review > 0 ? "incomplete" : manual ? "manual" : "ready";
  const des = tally(desR);
  const rulesets = [...new Set(desR.filter((r) => r.status !== "off").map((r) => (r.eff.source.version ? `${r.eff.source.name} v${r.eff.source.version}` : r.eff.source.name)))];
  const hash = quickHash(results.map((r) => `${r.eff.rule.id}:${r.status}:${r.violations.length}:${r.waived.length}`).join(","));
  return {
    pedigreeId: pedId,
    pedigreeName: ped.name,
    manufacturability: { status, ...m, review, blockers },
    design: { ...des, rulesets },
    results,
    byObject,
    waivedByObject,
    unmatchedWaivers,
    durationMs: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
    hash,
    inputHash: dfmInputHash({ project, rev, cat, profile, pedigreeId: pedId, qty, tierDays }),
  };
}

/** Identity of all DFM inputs; results with a different input hash are stale. */
export function dfmInputHash(o: { project: Project; rev: Revision; cat: CatalogIndex; profile: MachineProfile; pedigreeId: string; qty: number; tierDays: number }): string {
  return quickHash(stableStringify({ p: { ...o.project, revisions: undefined, updated: undefined }, rev: o.rev, cat: o.cat.version.hash, profile: o.profile.version, pid: o.pedigreeId, qty: o.qty, tier: o.tierDays }));
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
