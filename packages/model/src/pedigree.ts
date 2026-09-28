import type { InspectionReq, Pedigree, PedigreeScheme, Project } from "./schema";

export interface ResolvedPedigree extends Pedigree {
  inspections: InspectionReq[];
  partsPolicy: NonNullable<Pedigree["partsPolicy"]>;
  process: NonNullable<Pedigree["process"]>;
  documentation: string[];
  markings: NonNullable<Pedigree["markings"]>;
  extraRulesetIds: string[];
  workmanship: string;
  /** Ancestor chain, nearest first (for severityByPedigree lookups). */
  lineage: string[];
}

/** Resolve inheritance (§10.1): child fields override; inspections merge by type; policies shallow-merge. */
export function resolvePedigree(scheme: PedigreeScheme, id: string): ResolvedPedigree {
  const chain: Pedigree[] = [];
  const seen = new Set<string>();
  let cur = scheme.pedigrees.find((p) => p.id === id) ?? scheme.pedigrees[0]!;
  while (cur && !seen.has(cur.id)) {
    chain.unshift(cur);
    seen.add(cur.id);
    cur = cur.extends ? scheme.pedigrees.find((p) => p.id === cur!.extends)! : (undefined as unknown as Pedigree);
  }
  const self = chain[chain.length - 1]!;
  const out: ResolvedPedigree = {
    ...self,
    inspections: [],
    partsPolicy: {},
    process: {},
    documentation: [],
    markings: [],
    extraRulesetIds: [],
    workmanship: "IPC/WHMA-A-620 Class 3",
    lineage: chain.map((p) => p.id).reverse(),
  };
  for (const p of chain) {
    if (p.workmanship) out.workmanship = p.workmanship;
    if (p.inspections) {
      for (const ins of p.inspections) {
        const i = out.inspections.findIndex((x) => x.typeId === ins.typeId);
        if (i >= 0) out.inspections[i] = ins;
        else out.inspections.push(ins);
      }
    }
    if (p.partsPolicy) out.partsPolicy = { ...out.partsPolicy, ...p.partsPolicy };
    if (p.process) out.process = { ...out.process, ...p.process };
    if (p.documentation) out.documentation = [...p.documentation];
    if (p.markings) out.markings = [...p.markings];
    if (p.extraRulesetIds) out.extraRulesetIds = [...p.extraRulesetIds];
  }
  out.inspections = out.inspections.filter((i) => i.sampling !== "none");
  return out;
}

export function activePedigree(p: Project): ResolvedPedigree {
  const rev = p.revisions.find((r) => r.id === p.currentRevisionId)!;
  return resolvePedigree(p.pedigreeScheme, rev.activePedigreeId);
}

/** Monotonicity warnings (§10.1): higher rank looser than lower rank. */
export function monotonicityWarnings(scheme: PedigreeScheme): string[] {
  const sorted = [...scheme.pedigrees].sort((a, b) => a.rank - b.rank);
  const res = sorted.map((p) => resolvePedigree(scheme, p.id));
  const out: string[] = [];
  for (let i = 1; i < res.length; i++) {
    const lo = res[i - 1]!;
    const hi = res[i]!;
    const flags: [keyof ResolvedPedigree["process"], string][] = [
      ["noSplices", "splices"],
      ["noPotting", "potting"],
      ["noManualRework", "manual rework"],
    ];
    for (const [k, label] of flags) if (lo.process[k] && !hi.process[k]) out.push(`${hi.name} allows ${label} but ${lo.name} does not. Intended?`);
    for (const ins of lo.inspections) if (!hi.inspections.some((x) => x.typeId === ins.typeId)) out.push(`${hi.name} drops inspection "${ins.typeId}" required at ${lo.name}. Intended?`);
    if ((hi.process.minBraidCoverage ?? 0) < (lo.process.minBraidCoverage ?? 0)) out.push(`${hi.name} has a lower minimum braid coverage than ${lo.name}. Intended?`);
    if (lo.partsPolicy.qplOnly && !hi.partsPolicy.qplOnly) out.push(`${hi.name} doesn't require QPL parts but ${lo.name} does. Intended?`);
  }
  return out;
}
