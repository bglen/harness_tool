import { produce } from "immer";
import type { CatalogIndex } from "./catalog";
import { sha256HexSync, stableStringify } from "./hash";
import type { InspectionType, MachineProfile } from "./profile";
import { ReleaseSnapshotSchema, type Project, type ReleaseSnapshot, type Revision } from "./schema";
import { normalize } from "./sync";

/** Canonical content identity of a harness (SHA-256 over sorted-key JSON). */
export function designSha256(rev: Revision): string {
  return sha256HexSync(stableStringify(rev.harness));
}

function releaseInputs(p: Project): ReleaseSnapshot["inputs"] {
  return structuredClone({
    name: p.name,
    partNumber: p.partNumber,
    units: p.units,
    settings: p.settings,
    pedigreeScheme: p.pedigreeScheme,
    rulesets: p.rulesets,
    projectRules: p.projectRules,
    overrides: p.overrides,
    waivers: p.waivers,
    presets: p.presets,
    titleBlock: p.titleBlock,
    drawingTemplate: p.drawingTemplate,
    report: p.report,
    quote: p.quote,
  });
}

export interface ReleaseResultsInput {
  dfm?: NonNullable<ReleaseSnapshot["results"]>["dfm"];
  bom?: { pn: string; qty: number; uom: string }[];
  wireLengthsMm?: Record<string, number>;
  quote?: unknown;
}

/** Build the typed release record for the current revision (FIX-01, feedback §2). */
export function buildReleaseSnapshot(p: Project, o: { at: string; tool: string; cat: CatalogIndex; profile: MachineProfile; inspections?: InspectionType[]; results?: ReleaseResultsInput }): ReleaseSnapshot {
  const rev = p.revisions.find((r) => r.id === p.currentRevisionId)!;
  const inputs = releaseInputs(p);
  return ReleaseSnapshotSchema.parse({
    schemaVersion: 1,
    releasedAt: o.at,
    pedigreeId: rev.activePedigreeId,
    inputs,
    versions: {
      tool: o.tool,
      catalog: { hash: o.cat.version.hash, date: o.cat.version.date },
      profile: { version: o.profile.version, sha256: sha256HexSync(stableStringify(o.profile)) },
      inspectionsSha256: o.inspections ? sha256HexSync(stableStringify(o.inspections)) : "",
    },
    designSha256: designSha256(rev),
    inputsSha256: sha256HexSync(stableStringify(inputs)),
    results: o.results ?? {},
    outputs: [],
    approvals: [],
  });
}

/**
 * The project as it applies to one revision. For a released revision, every release-affecting input comes
 * from its snapshot, so later edits to settings/rules/pedigrees on the working revision don't change it.
 */
export function projectForRevision(p: Project, revId: string): Project {
  const rev = p.revisions.find((r) => r.id === revId);
  if (!rev) throw new Error(`Unknown revision ${revId}`);
  const idx = p.revisions.indexOf(rev);
  const base: Project = { ...p, revisions: p.revisions.slice(0, idx + 1), currentRevisionId: rev.id, updated: rev.frozen && rev.frozenAt ? rev.frozenAt : p.updated };
  if (!rev.frozen || !rev.release) return base;
  const i = rev.release.inputs;
  return {
    ...base,
    name: i.name,
    partNumber: i.partNumber,
    units: i.units,
    settings: i.settings,
    pedigreeScheme: i.pedigreeScheme,
    rulesets: i.rulesets,
    projectRules: i.projectRules,
    overrides: i.overrides,
    waivers: i.waivers,
    presets: i.presets,
    titleBlock: i.titleBlock,
    // Releases from before templates keep the classic layout they were released with.
    drawingTemplate: i.drawingTemplate ?? null,
    report: i.report,
    quote: i.quote,
    revisions: base.revisions.map((r) => (r.id === rev.id ? { ...r, activePedigreeId: rev.release!.pedigreeId } : r)),
  };
}

/** Does a released revision still match its recorded content hash? */
export function verifyRelease(rev: Revision): { ok: boolean; problems: string[] } {
  if (!rev.frozen) return { ok: true, problems: [] };
  if (!rev.release) return { ok: false, problems: ["No typed release record (frozen with an older version)."] };
  const problems: string[] = [];
  if (designSha256(rev) !== rev.release.designSha256) problems.push("Harness content differs from the released design hash.");
  if (sha256HexSync(stableStringify(rev.release.inputs)) !== rev.release.inputsSha256) problems.push("Release inputs differ from their recorded hash.");
  return { ok: !problems.length, problems };
}

/**
 * The physical configuration of the working design built as another pedigree (pedigree comparison, feedback §1).
 * Pedigrees change construction (boots, markings, double band clamps), so each candidate is resolved before its
 * BOM, operations, checks and price are derived. Works on a copy; the stored project is never changed.
 */
export function configureForPedigree(p: Project, pedigreeId: string, cat: CatalogIndex): Project {
  const rev = p.revisions.find((r) => r.id === p.currentRevisionId)!;
  if (rev.activePedigreeId === pedigreeId) return p;
  return produce(p, (d) => {
    const r = d.revisions.find((x) => x.id === d.currentRevisionId)!;
    r.activePedigreeId = pedigreeId;
    normalize(d as Project, { cat, autoRoute: false });
  });
}
