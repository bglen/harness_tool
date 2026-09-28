import { RulesetSchema, stableStringify, type Project, type RuleInstance, type Ruleset } from "@hs/model";
import { validateCustom } from "./custom";
import { RULE_TYPE_BY_ID } from "./ruletypes";

export interface RulesetDiff {
  added: RuleInstance[];
  changed: { id: string; changes: string[] }[];
  removed: RuleInstance[];
  invalid: { id: string; reason: string }[];
  pedigrees: string[];
  versionFrom?: string;
  versionTo: string;
}

export interface ParsedRuleset {
  ruleset?: Ruleset;
  errors: string[];
}

/** Parse and validate a .harnessrules.json file. Only data (and declarative custom rules) are accepted, never code. */
export function parseRulesetFile(text: string): ParsedRuleset {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  if (/"(function|eval|script)"\s*:|=>|function\s*\(/.test(text)) return { errors: ["Rulesets may contain data only (no executable code)."] };
  const r = RulesetSchema.safeParse(json);
  if (!r.success) return { errors: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  return { ruleset: r.data, errors: [] };
}

export function validateRule(rule: RuleInstance): string | null {
  if (rule.type === "custom" || rule.custom) {
    if (!rule.custom) return "Custom rule has no definition";
    const errs = validateCustom(rule.custom);
    return errs.length ? errs.join("; ") : null;
  }
  if (!RULE_TYPE_BY_ID.has(rule.type)) return `Unknown rule type "${rule.type}"`;
  return null;
}

export function diffRuleset(existing: Ruleset | undefined, incoming: Ruleset): RulesetDiff {
  const before = new Map((existing?.rules ?? []).map((r) => [r.id, r]));
  const after = new Map(incoming.rules.map((r) => [r.id, r]));
  const diff: RulesetDiff = { added: [], changed: [], removed: [], invalid: [], pedigrees: [], versionFrom: existing?.version, versionTo: incoming.version };
  for (const r of incoming.rules) {
    const bad = validateRule(r);
    if (bad) diff.invalid.push({ id: r.id, reason: bad });
    if (!r.id.startsWith(`${incoming.prefix}-`)) diff.invalid.push({ id: r.id, reason: `ID must start with ${incoming.prefix}-` });
    const b = before.get(r.id);
    if (!b) diff.added.push(r);
    else if (stableStringify(b) !== stableStringify(r)) {
      const changes: string[] = [];
      if (b.severity !== r.severity) changes.push(`severity ${b.severity} → ${r.severity}`);
      for (const k of new Set([...Object.keys(b.params), ...Object.keys(r.params)])) if (stableStringify(b.params[k]) !== stableStringify(r.params[k])) changes.push(`${k}: ${stableStringify(b.params[k]) ?? "—"} → ${stableStringify(r.params[k]) ?? "—"}`);
      if (stableStringify(b.severityByPedigree ?? {}) !== stableStringify(r.severityByPedigree ?? {})) changes.push("per-pedigree severities");
      if (stableStringify(b.paramsByPedigree ?? {}) !== stableStringify(r.paramsByPedigree ?? {})) changes.push("per-pedigree parameters");
      if (b.enabled !== r.enabled) changes.push(r.enabled ? "enabled" : "disabled");
      if (b.title !== r.title) changes.push("title");
      diff.changed.push({ id: r.id, changes: changes.length ? changes : ["text"] });
    }
  }
  for (const r of existing?.rules ?? []) if (!after.has(r.id)) diff.removed.push(r);
  const bp = existing?.pedigreeScheme?.pedigrees ?? [];
  for (const p of incoming.pedigreeScheme?.pedigrees ?? []) {
    const o = bp.find((x) => x.id === p.id);
    if (!o) diff.pedigrees.push(`+ ${p.name} (${p.code})`);
    else if (stableStringify(o) !== stableStringify(p)) diff.pedigrees.push(`~ ${p.name} (${p.code}) changed`);
  }
  for (const p of bp) if (!incoming.pedigreeScheme?.pedigrees.some((x) => x.id === p.id)) diff.pedigrees.push(`− ${p.name} (${p.code})`);
  return diff;
}

/** Export project rules (+ pedigree scheme + presets) as a ruleset file. */
export function exportProjectRuleset(project: Project, opts: { name?: string; prefix?: string; version?: string; author?: string } = {}): Ruleset {
  return RulesetSchema.parse({
    schemaVersion: 1,
    id: `prj-${project.id.slice(0, 8)}`,
    name: opts.name ?? `${project.name} rules`,
    prefix: opts.prefix ?? "PRJ",
    version: opts.version ?? "1.0.0",
    author: opts.author ?? "",
    description: `Project rules and pedigree scheme exported from ${project.name}.`,
    changelog: [],
    enforced: false,
    rules: project.projectRules,
    pedigreeScheme: project.pedigreeScheme,
    presets: project.presets.length ? project.presets : undefined,
  });
}
