import { uid } from "./helpers";
import { HarnessSchema, SCHEMA_VERSION, type Harness, type PedigreeScheme, type Project, ProjectSchema } from "./schema";

/** Default single-pedigree scheme for new users (§10.6). */
export const STANDARD_SCHEME: PedigreeScheme = {
  id: "standard",
  name: "Standard",
  version: "1.0.0",
  pedigrees: [
    {
      id: "std",
      name: "Standard",
      code: "STD",
      rank: 0,
      color: 1,
      description: "Default build class. Continuity tested; IPC/WHMA-A-620 Class 3 workmanship.",
      workmanship: "IPC/WHMA-A-620 Class 3",
      inspections: [
        { typeId: "continuity", sampling: "100%", params: { maxOhm: 1 } },
        { typeId: "visual", sampling: "100%", params: { magnification: "4x", acceptanceClass: "Class 3" } },
      ],
      documentation: ["Certificate of Conformance (CoC)"],
      markings: [],
    },
  ],
};

export function emptyHarness(): Harness {
  return HarnessSchema.parse({});
}

/** The pedigree a new design using this scheme starts on: its marked default, else the first pedigree. */
export function defaultPedigreeOf(scheme: PedigreeScheme): string {
  return scheme.pedigrees.some((p) => p.id === scheme.defaultPedigreeId) ? scheme.defaultPedigreeId! : scheme.pedigrees[0]!.id;
}

export function newProject(opts: { name?: string; units?: "mm" | "in"; scheme?: PedigreeScheme; now?: string } = {}): Project {
  const now = opts.now ?? new Date().toISOString();
  const revId = uid();
  const scheme = opts.scheme ?? STANDARD_SCHEME;
  return ProjectSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: uid(),
    name: opts.name ?? "Untitled harness",
    partNumber: "HS-0001",
    units: opts.units ?? "in",
    pedigreeScheme: scheme,
    revisions: [{ id: revId, label: "A", notes: "", frozen: false, activePedigreeId: defaultPedigreeOf(scheme), harness: emptyHarness() }],
    currentRevisionId: revId,
    created: now,
    updated: now,
  });
}

export interface LabelContext {
  refDes?: string;
  wireId?: string;
  harnessPN: string;
  rev: string;
  pedigreeMarking?: string;
  net?: string;
  segment?: string;
}

/** Resolve label template fields (§6.8). `{serial}` stays a placeholder for per-unit printing. */
export function resolveLabelTemplate(tpl: string, ctx: LabelContext): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => {
    switch (k) {
      case "refDes":
        return ctx.refDes ?? m;
      case "wireId":
        return ctx.wireId ?? m;
      case "harnessPN":
        return ctx.harnessPN;
      case "rev":
        return ctx.rev;
      case "serial":
        return "####";
      case "pedigreeMarking":
        return ctx.pedigreeMarking ?? "";
      case "net":
        return ctx.net ?? m;
      case "segment":
        return ctx.segment ?? m;
      default:
        return m;
    }
  });
}
