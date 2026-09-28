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
}

export interface Fix {
  label: string;
  commands: Command[];
}

export interface Violation {
  objectIds: string[];
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

export type RuleStatus = "pass" | "fail" | "waived" | "off" | "error" | "superseded";

export interface RuleResult {
  eff: EffectiveRule;
  status: RuleStatus;
  violations: Violation[];
  waived: (Violation & { waiverId: string; note: string })[];
  error?: string;
  ms: number;
}

export type BuildStatus = "ready" | "manual" | "notBuildable";

export interface DfmSummary {
  pedigreeId: string;
  pedigreeName: string;
  manufacturability: { status: BuildStatus; checks: number; errors: number; warnings: number; infos: number; passed: number };
  design: { checks: number; errors: number; warnings: number; infos: number; passed: number; rulesets: string[] };
  results: RuleResult[];
  /** objectId → worst severity + rule ids */
  byObject: Record<string, { severity: Severity; ruleIds: string[] }>;
  durationMs: number;
  hash: string;
}
