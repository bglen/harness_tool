import type { Bom } from "@hs/ops";
import type { CatalogIndex, Command, Derived, Harness, LengthUnit, MachineProfile, Project, ResolvedPedigree, Revision, RuleInstance, Severity } from "@hs/model";

export type EntityKind = "connector" | "pin" | "net" | "wire" | "segment" | "node" | "layer" | "shield" | "termination" | "clamp" | "boot" | "label" | "splice" | "potting" | "cable" | "twist" | "project" | "bom";

export interface ParamDef {
  key: string;
  label: string;
  type: "number" | "string" | "enum" | "bool" | "stringList" | "netClass" | "table" | "regex";
  unit?: string;
  options?: string[];
  /** Which direction is stricter (for stricter-wins against the Manufacturer layer and between rulesets). */
  stricter?: "higher" | "lower";
  help?: string;
  default?: unknown;
  /** Blank is meaningful (the rule has a documented fallback); otherwise a missing number is `missingInput`. */
  optional?: boolean;
}

export interface Fix {
  label: string;
  commands: Command[];
}

export interface Violation {
  objectIds: string[];
  /** Identity of the original finding for waivers (set by the engine; stays the same when part of it is waived). */
  key?: string;
  /**
   * What the finding is about when a rule can report several findings on the same objects (a part number, a
   * cavity). Part of the waiver identity, so waiving one doesn't waive the others.
   */
  subject?: string;
  objectKind: EntityKind;
  message: string;
  fix?: Fix;
}

export interface RuleCtx {
  project: Project;
  rev: Revision;
  h: Harness;
  cat: CatalogIndex;
  d: Derived;
  profile: MachineProfile;
  ped: ResolvedPedigree;
  bom: () => Bom;
  units: LengthUnit;
  qty: number;
  tierDays: number;
  len: (mm: number) => string;
  refDes: (connectorId: string) => string;
}

export interface RuleType {
  id: string;
  name: string;
  description: string;
  example: string;
  category: string;
  params: ParamDef[];
  depends: EntityKind[];
  /** Failing this rule means a manual operation (drives "Buildable with manual steps"). */
  manual?: boolean;
  /** Violations mean unapproved/unreviewed reference data: the design can't be claimed ready until reviewed (FIX-10). */
  review?: boolean;
  /** Scope filter supported (netClass / namePattern). */
  scoped?: boolean;
  evaluate(ctx: RuleCtx, params: Record<string, any>, rule: RuleInstance): Violation[];
}

export type RuleLayer = "manufacturer" | "ruleset" | "project" | "pedigree";

export interface RuleSource {
  layer: RuleLayer;
  name: string;
  version?: string;
  enforced?: boolean;
}

export interface EffectiveRule {
  rule: RuleInstance;
  severity: Severity;
  params: Record<string, any>;
  source: RuleSource;
  /** Other sources merged into this rule (stricter-wins). */
  sources: RuleSource[];
  notes: string[];
  overridden?: boolean;
  /** Severity at each pedigree in the scheme (for "Error at T2 · warning at T3"). */
  severityByPedigree: Record<string, Severity>;
}

/**
 * Rule outcome (feedback §4). A rule that could not run is never a pass:
 * - notApplicable: nothing in the design the rule applies to
 * - missingInput: required input (catalog record, parameter) is absent
 * - engineError: the rule threw, or its type is unknown
 * - notEvaluated: evaluation was skipped (e.g. worker failure)
 */
export type RuleStatus = "pass" | "fail" | "waived" | "off" | "notApplicable" | "notEvaluated" | "missingInput" | "engineError";

export const INCOMPLETE_STATUSES: RuleStatus[] = ["notEvaluated", "missingInput", "engineError"];

export interface RuleResult {
  eff: EffectiveRule;
  status: RuleStatus;
  violations: Violation[];
  waived: (Violation & {
    waiverId: string;
    note: string;
    author: string;
    date: string;
    /** The finding's text differs from when it was waived: re-assess. */
    changed: boolean;
    waivedMessage?: string;
  })[];
  error?: string;
  ms: number;
}

/** "incomplete" = can't be claimed ready: a required check didn't run, or reference data is unreviewed. */
export type BuildStatus = "ready" | "manual" | "incomplete" | "notBuildable";

export interface DfmSummary {
  pedigreeId: string;
  pedigreeName: string;
  manufacturability: {
    status: BuildStatus;
    checks: number;
    errors: number;
    warnings: number;
    infos: number;
    passed: number;
    /** Enabled rules that didn't produce a result (engineError / missingInput / notEvaluated). */
    incomplete: number;
    /** Findings on unreviewed / unapproved reference data. */
    review: number;
    /** Human-readable reasons the status isn't "ready". */
    blockers: string[];
  };
  design: { checks: number; errors: number; warnings: number; infos: number; passed: number; incomplete: number; rulesets: string[] };
  results: RuleResult[];
  /** objectId → worst severity + rule ids */
  byObject: Record<string, { severity: Severity; ruleIds: string[] }>;
  /** objectId → waived findings on it */
  waivedByObject: Record<string, { ruleIds: string[]; count: number }>;
  /** Ids of waivers that match no current finding. */
  unmatchedWaivers: string[];
  durationMs: number;
  /** Identity of the result (rule ids × outcomes). */
  hash: string;
  /** Identity of every input this result was computed from (design, settings, rules, profile, catalog, pedigree, qty/tier). */
  inputHash: string;
}
