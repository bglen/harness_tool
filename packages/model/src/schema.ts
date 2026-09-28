import { z } from "zod";

export const SCHEMA_VERSION = 2;

const Id = z.string().min(1);
const Point = z.object({ x: z.number(), y: z.number() });
export type Point = z.infer<typeof Point>;

export const WireColorSchema = z.object({
  base: z.number().int().min(0).max(9),
  stripes: z.array(z.number().int().min(0).max(9)).max(3),
});

// ─── Harness entities (§4.1) ────────────────────────────────────────────────

export const PinAssignmentSchema = z.object({
  netId: Id.nullable(),
  /** Contact PN override; null/undefined = derived default (§6.2). */
  contactPn: z.string().optional(),
  /** Wired spare / filler contact instead of sealing plug. */
  filler: z.boolean().optional(),
});
export type PinAssignment = z.infer<typeof PinAssignmentSchema>;

export const AccessorySchema = z.object({
  id: Id,
  kind: z.enum(["dustCap", "jamNut", "oRing", "gasket", "groundingRing"]),
  pn: z.string(),
  auto: z.boolean().default(false),
});
export type Accessory = z.infer<typeof AccessorySchema>;

export const BackshellSchema = z.object({
  pn: z.string(),
  clockingDeg: z.number().default(0),
  auto: z.boolean().default(false),
});
export type BackshellRef = z.infer<typeof BackshellSchema>;

export const ConnectorSchema = z.object({
  id: Id,
  refDes: z.string(),
  pn: z.string(),
  position: Point,
  /** Direction the bundle leaves the connector, degrees (0 = right). Glyph mates away from it. */
  rotation: z.number().default(0),
  clocking: z.string().default("N"),
  backshell: BackshellSchema.nullable().default(null),
  accessories: z.array(AccessorySchema).default([]),
  pins: z.record(z.string(), PinAssignmentSchema).default({}),
  showUnused: z.boolean().default(false),
  description: z.string().default(""),
});
export type ConnectorInstance = z.infer<typeof ConnectorSchema>;

export const NetClass = z.enum(["power", "signal", "rf", "ground", "spare"]);
export type NetClass = z.infer<typeof NetClass>;

export const NetMemberSchema = z.object({ connectorId: Id, cavityId: z.string() });
export type NetMember = z.infer<typeof NetMemberSchema>;

export const NetSchema = z.object({
  id: Id,
  name: z.string(),
  cls: NetClass.default("signal"),
  currentA: z.number().nonnegative().optional(),
  topology: z.enum(["daisy", "splice"]).default("daisy"),
  /** A 3+ pin daisy chain (two wires in one contact) was explicitly chosen, not assumed. */
  topologyConfirmed: z.boolean().default(false),
  members: z.array(NetMemberSchema),
});
export type Net = z.infer<typeof NetSchema>;

export const WireEndSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pin"), connectorId: Id, cavityId: z.string() }),
  z.object({ kind: z.literal("splice"), spliceId: Id }),
]);
export type WireEnd = z.infer<typeof WireEndSchema>;

export const WireSchema = z.object({
  id: Id,
  label: z.string(),
  netId: Id,
  from: WireEndSchema,
  to: WireEndSchema,
  spec: z.string(),
  gauge: z.number(),
  color: WireColorSchema,
  cableId: Id.optional(),
  twistGroupId: Id.optional(),
  shieldId: Id.optional(),
  /** Fields the user set explicitly; derivation won't overwrite them. */
  pinned: z.array(z.enum(["spec", "gauge", "color"])).default([]),
  extraLengthMm: z.number().default(0),
});
export type Wire = z.infer<typeof WireSchema>;

export const NodeSchema = z.object({
  id: Id,
  kind: z.enum(["connector", "breakout"]),
  connectorId: Id.optional(),
  position: Point,
});
export type HarnessNode = z.infer<typeof NodeSchema>;

export const SegmentSchema = z.object({
  id: Id,
  a: Id,
  b: Id,
  lengthMm: z.number().positive(),
  /** default = placeholder from settings; estimated = imported/derived; confirmed = entered by a person. */
  lengthSource: z.enum(["default", "estimated", "confirmed"]).default("confirmed"),
  toleranceMm: z.number().nonnegative().default(10),
  label: z.string().default(""),
  tieSpacingMm: z.number().nonnegative().optional(),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const SpliceSchema = z.object({
  id: Id,
  label: z.string(),
  netId: Id,
  nodeId: Id,
  type: z.enum(["solderSleeve", "crimp", "ultrasonic"]).default("crimp"),
  pn: z.string().default(""),
  cover: z.enum(["heatShrink", "potting"]).default("heatShrink"),
  pinned: z.boolean().default(false),
});
export type Splice = z.infer<typeof SpliceSchema>;

export const CableSchema = z.object({
  id: Id,
  label: z.string(),
  wireCode: z.string(),
  gauge: z.number(),
  count: z.number().int().min(1).max(8),
  shield: z.string(), // shield code, "U" = none
  jacket: z.string(),
  wireIds: z.array(Id),
  stripJacketMm: z.number().default(38),
  stripShieldMm: z.number().default(25),
});
export type Cable = z.infer<typeof CableSchema>;

export const TwistGroupSchema = z.object({ id: Id, wireIds: z.array(Id).min(2).max(4), twistsPerM: z.number().optional() });
export type TwistGroup = z.infer<typeof TwistGroupSchema>;

export const ShieldSchema = z.object({
  id: Id,
  label: z.string(),
  wireIds: z.array(Id),
  cableId: Id.optional(),
  material: z.string().default("tinned copper"),
  coverage: z.number().default(85),
  drainWire: z.boolean().default(false),
});
export type Shield = z.infer<typeof ShieldSchema>;

export const LayerExtentSchema = z.object({
  segmentId: Id,
  /** Distance from node A in mm; undefined = segment start */
  startMm: z.number().optional(),
  endMm: z.number().optional(),
  /** Per-segment part when one size can't cover every segment (e.g. braid on branches vs trunk). */
  pn: z.string().optional(),
});
export type LayerExtent = z.infer<typeof LayerExtentSchema>;

export const LayerSchema = z.object({
  id: Id,
  type: z.enum(["tape", "sleeve", "heatShrink", "jacket", "conduit", "overbraid"]),
  pn: z.string(),
  material: z.string().default(""),
  extents: z.array(LayerExtentSchema),
  stackOrder: z.number(),
  params: z
    .object({
      coveragePct: z.number().optional(),
      overlapPct: z.number().optional(),
      direction: z.enum(["cw", "ccw"]).optional(),
      color: z.string().optional(),
    })
    .default({}),
  auto: z.boolean().default(false),
  pinned: z.boolean().default(false),
});
export type Layer = z.infer<typeof LayerSchema>;

export const TerminationMethod = z.enum(["band360", "emiRing", "drainToPin", "floating", "foldBack", "junction"]);
export type TerminationMethod = z.infer<typeof TerminationMethod>;

export const TerminationSchema = z.object({
  id: Id,
  targetId: Id, // shield or overbraid layer id
  nodeId: Id,
  method: TerminationMethod,
  drainPin: NetMemberSchema.optional(),
  /** Physical drain/pigtail conductor from the shield to the drain pin (FIX-05). */
  drain: z
    .object({
      spec: z.string(),
      gauge: z.number(),
      lengthMm: z.number().positive(),
      lengthSource: z.enum(["default", "estimated", "confirmed"]).default("default"),
    })
    .optional(),
  /** Termination hardware (grounding rings, solder sleeves, …); consumed by the BOM. */
  partPns: z.array(z.string()).default([]),
  auto: z.boolean().default(false),
});
export type Termination = z.infer<typeof TerminationSchema>;

export const ClampSchema = z.object({
  id: Id,
  terminationId: Id.optional(),
  nodeId: Id,
  pn: z.string(),
  quantity: z.number().int().min(1).max(2).default(1),
  auto: z.boolean().default(true),
  pinned: z.boolean().default(false),
});
export type Clamp = z.infer<typeof ClampSchema>;

export const BootSchema = z.object({
  id: Id,
  nodeId: Id,
  shape: z.enum(["straight", "90", "Y", "T", "multi"]),
  pn: z.string(),
  auto: z.boolean().default(false),
  pinned: z.boolean().default(false),
  rule: z.string().optional(),
});
export type Boot = z.infer<typeof BootSchema>;

export const PottingSchema = z.object({
  id: Id,
  targetKind: z.enum(["connector", "splice"]),
  targetId: Id,
  compoundPn: z.string(),
  moldPn: z.string().default(""),
  depthMm: z.number().positive().default(12),
});
export type Potting = z.infer<typeof PottingSchema>;

export const LabelSchema = z.object({
  id: Id,
  attachedTo: z.object({
    kind: z.enum(["wire", "segment", "connector", "cable"]),
    id: Id,
    /** Node the label is measured from (wire/segment end). */
    nodeId: Id.optional(),
  }),
  template: z.string(),
  type: z.enum(["sleeve", "flag", "wrap", "direct"]).default("sleeve"),
  pn: z.string().default(""),
  distanceMm: z.number().default(50),
  auto: z.boolean().default(false),
  pinned: z.boolean().default(false),
  rule: z.string().optional(),
});
export type Label = z.infer<typeof LabelSchema>;

export const HardwareSchema = z.object({
  id: Id,
  segmentId: Id,
  positionMm: z.number(),
  type: z.enum(["cushionClamp", "spotTie", "lacing"]),
  pn: z.string().default(""),
  inBom: z.boolean().default(false),
});
export type Hardware = z.infer<typeof HardwareSchema>;

export const NoteSchema = z.object({ id: Id, position: Point, text: z.string() });
export type Note = z.infer<typeof NoteSchema>;

export const HarnessSchema = z.object({
  connectors: z.array(ConnectorSchema).default([]),
  nodes: z.array(NodeSchema).default([]),
  segments: z.array(SegmentSchema).default([]),
  nets: z.array(NetSchema).default([]),
  wires: z.array(WireSchema).default([]),
  splices: z.array(SpliceSchema).default([]),
  cables: z.array(CableSchema).default([]),
  twistGroups: z.array(TwistGroupSchema).default([]),
  shields: z.array(ShieldSchema).default([]),
  layers: z.array(LayerSchema).default([]),
  terminations: z.array(TerminationSchema).default([]),
  clamps: z.array(ClampSchema).default([]),
  boots: z.array(BootSchema).default([]),
  potting: z.array(PottingSchema).default([]),
  labels: z.array(LabelSchema).default([]),
  hardware: z.array(HardwareSchema).default([]),
  notes: z.array(NoteSchema).default([]),
  labelRules: z
    .object({
      connectorRefDes: z.boolean().default(true),
      wireIds: z.boolean().default(false),
      harnessId: z.boolean().default(false),
      pedigreeMarkings: z.boolean().default(true),
    })
    .default({}),
  /** Keys of auto items the user deleted; rules won't re-create them. */
  suppressedAuto: z.array(z.string()).default([]),
});
export type Harness = z.infer<typeof HarnessSchema>;

// ─── Rules, pedigrees (§9, §10) ────────────────────────────────────────────

export const Severity = z.enum(["off", "info", "warning", "error"]);
export type Severity = z.infer<typeof Severity>;

export const CustomCondSchema = z.object({
  field: z.string(),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "matches", "notMatches", "in", "notIn", "exists", "notExists"]),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
});
export type CustomCond = z.infer<typeof CustomCondSchema>;

export const CustomRuleSchema = z.object({
  forEach: z.enum(["wire", "net", "connector", "pin", "segment", "shield"]),
  where: z.array(CustomCondSchema).default([]),
  require: z.array(CustomCondSchema).min(1),
});
export type CustomRule = z.infer<typeof CustomRuleSchema>;

export const RuleInstanceSchema = z.object({
  id: z.string(),
  type: z.string(), // built-in rule type id, or "custom"
  category: z.string(),
  severity: Severity,
  title: z.string(),
  description: z.string().default(""),
  rationale: z.string().default(""),
  params: z.record(z.string(), z.any()).default({}),
  scope: z.object({ netClass: z.array(NetClass).optional(), namePattern: z.string().optional() }).optional(),
  severityByPedigree: z.record(z.string(), Severity).optional(),
  paramsByPedigree: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  enabled: z.boolean().default(true),
  custom: CustomRuleSchema.optional(),
  paramSource: z.string().optional(),
});
export type RuleInstance = z.infer<typeof RuleInstanceSchema>;

export const InspectionReqSchema = z.object({
  typeId: z.string(),
  sampling: z.string().default("100%"),
  params: z.record(z.string(), z.any()).default({}),
});
export type InspectionReq = z.infer<typeof InspectionReqSchema>;

export const PedigreeSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  rank: z.number(),
  color: z.number().int().min(0).max(7),
  extends: z.string().optional(),
  description: z.string().default(""),
  workmanship: z.string().optional(),
  inspections: z.array(InspectionReqSchema).optional(),
  partsPolicy: z
    .object({
      qplOnly: z.boolean().optional(),
      noAlternates: z.boolean().optional(),
      bannedFinishes: z.array(z.string()).optional(),
      authorizedDistributionOnly: z.boolean().optional(),
      dateCodeMaxYears: z.number().optional(),
    })
    .optional(),
  process: z
    .object({
      noSplices: z.boolean().optional(),
      noManualRework: z.boolean().optional(),
      noPotting: z.boolean().optional(),
      serializedLabels: z.boolean().optional(),
      doubleBandClamps: z.boolean().optional(),
      requiredPresetId: z.string().optional(),
      bendRadiusMultiple: z.number().optional(),
      minBraidCoverage: z.number().optional(),
      requireBoots: z.boolean().optional(),
    })
    .optional(),
  documentation: z.array(z.string()).optional(),
  markings: z.array(z.object({ text: z.string(), type: z.enum(["tag", "label"]), color: z.string().optional() })).optional(),
  extraRulesetIds: z.array(z.string()).optional(),
});
export type Pedigree = z.infer<typeof PedigreeSchema>;

export const PedigreeSchemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().default("1.0.0"),
  pedigrees: z.array(PedigreeSchema).min(1),
});
export type PedigreeScheme = z.infer<typeof PedigreeSchemeSchema>;

export const FinishingStepSchema = z.object({
  action: z.enum(["overbraid", "bandClamps", "tape", "jacket", "sleeve", "connectorLabels", "wireIdLabels", "boots", "backshells"]),
  params: z.record(z.string(), z.any()).default({}),
});
export const FinishingPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  steps: z.array(FinishingStepSchema),
});
export type FinishingPreset = z.infer<typeof FinishingPresetSchema>;

export const RulesetSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string(),
  name: z.string(),
  prefix: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
  version: z.string().default("1.0.0"),
  author: z.string().default(""),
  description: z.string().default(""),
  changelog: z.array(z.object({ version: z.string(), date: z.string(), notes: z.string() })).default([]),
  enforced: z.boolean().default(false),
  rules: z.array(RuleInstanceSchema).default([]),
  pedigreeScheme: PedigreeSchemeSchema.optional(),
  presets: z.array(FinishingPresetSchema).optional(),
});
export type Ruleset = z.infer<typeof RulesetSchema>;

export const RuleOverrideSchema = z.object({
  ruleId: z.string(),
  enabled: z.boolean().optional(),
  severity: Severity.optional(),
  params: z.record(z.string(), z.any()).optional(),
  note: z.string().default(""),
});
export type RuleOverride = z.infer<typeof RuleOverrideSchema>;

export const WaiverSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  objectId: z.string(), // "*" = all objects for the rule
  note: z.string().min(1),
  author: z.string().default(""),
  date: z.string(),
});
export type Waiver = z.infer<typeof WaiverSchema>;

// ─── Project (§4.1) ────────────────────────────────────────────────────────

export const SettingsSchema = z.object({
  autoCommit: z.boolean().default(true),
  serviceLoopMm: z.number().default(0),
  defaultWireSpec: z.string().default("M22759/16"),
  defaultColor: WireColorSchema.default({ base: 9, stripes: [] }),
  colorByClass: z.boolean().default(false),
  classColors: z.record(z.string(), WireColorSchema).default({
    power: { base: 2, stripes: [] },
    ground: { base: 0, stripes: [] },
    signal: { base: 9, stripes: [] },
    rf: { base: 9, stripes: [6] },
    spare: { base: 8, stripes: [] },
  }),
  defaultSegmentMm: z.number().default(304.8),
  defaultBackshell: z.enum(["none", "strainRelief", "emiBand"]).default("none"),
  cutResolutionMm: z.number().default(1),
  packingFactor: z.number().default(1.2),
  defaultLabelDistanceMm: z.number().default(50),
  wiredSpares: z.boolean().default(false),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const TitleBlockSchema = z.object({
  company: z.string().default("Harness Studio"),
  title: z.string().default(""),
  drawingNumber: z.string().default(""),
  drawnBy: z.string().default(""),
  checkedBy: z.string().default(""),
  approvedBy: z.string().default(""),
  sheetSize: z.enum(["ANSI B", "ANSI D", "ISO A3", "ISO A1"]).default("ANSI B"),
  tolerances: z.string().default("Lengths ±10 mm (±0.4 in) unless noted"),
  notes: z.array(z.string()).default([]),
  exportControl: z.string().default(""),
});
export type TitleBlock = z.infer<typeof TitleBlockSchema>;

export const ReportTextSchema = z.object({
  summary: z.string().default(""),
  designNotes: z.string().default(""),
  reviewComments: z.string().default(""),
  sections: z.record(z.string(), z.boolean()).default({}),
});

const QuoteSettingsSchema = z
  .object({
    quantities: z.array(z.number().int().positive()).default([1, 5, 10, 25, 100]),
    selected: z.object({ qty: z.number(), tier: z.string() }).default({ qty: 10, tier: "standard" }),
    customerFurnished: z.array(z.string()).default([]),
    /** Expected arrival (days from order) of customer-furnished parts, by PN; unknown when absent. */
    customerFurnishedArrivalDays: z.record(z.string(), z.number().nonnegative()).default({}),
    highestOrderedPedigree: z.string().optional(),
  })
  .default({});

/**
 * Typed, versioned release record (feedback §2). Everything that affects a released revision's content is
 * captured here, so later changes to settings, rules, pedigrees or the catalog can't alter it.
 */
export const ReleaseSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  releasedAt: z.string(),
  /** The build class the revision was released for. Viewing other classes never mutates the revision. */
  pedigreeId: z.string(),
  inputs: z.object({
    name: z.string(),
    partNumber: z.string(),
    units: z.enum(["mm", "in"]),
    settings: SettingsSchema,
    pedigreeScheme: PedigreeSchemeSchema,
    rulesets: z.array(RulesetSchema),
    projectRules: z.array(RuleInstanceSchema),
    overrides: z.array(RuleOverrideSchema),
    waivers: z.array(WaiverSchema),
    presets: z.array(FinishingPresetSchema),
    titleBlock: TitleBlockSchema,
    report: ReportTextSchema,
    quote: QuoteSettingsSchema,
  }),
  versions: z.object({
    tool: z.string(),
    catalog: z.object({ hash: z.string(), date: z.string() }),
    profile: z.object({ version: z.string(), sha256: z.string() }),
    inspectionsSha256: z.string().default(""),
  }),
  /** SHA-256 of the canonical harness JSON and of the canonical release inputs. */
  designSha256: z.string(),
  inputsSha256: z.string(),
  /** Results as released (not recomputed): DFM headline, BOM quantities, cut lengths, demo quote. */
  results: z
    .object({
      dfm: z.object({ status: z.string(), errors: z.number(), warnings: z.number(), incomplete: z.number().default(0), review: z.number().default(0), hash: z.string(), designErrors: z.number() }).optional(),
      bom: z.array(z.object({ pn: z.string(), qty: z.number(), uom: z.string() })).default([]),
      wireLengthsMm: z.record(z.string(), z.number()).default({}),
      quote: z.any().optional(),
    })
    .default({}),
  /** Output files generated at release (path → SHA-256). */
  outputs: z.array(z.object({ path: z.string(), sha256: z.string() })).default([]),
  /** Release decisions. Roles and who may approve are owner decisions; nothing is recorded automatically. */
  approvals: z.array(z.object({ role: z.string(), name: z.string(), decision: z.enum(["approved", "rejected"]), at: z.string(), note: z.string().default("") })).default([]),
});
export type ReleaseSnapshot = z.infer<typeof ReleaseSnapshotSchema>;

export const RevisionSchema = z.object({
  id: z.string(),
  label: z.string(),
  notes: z.string().default(""),
  frozen: z.boolean().default(false),
  frozenAt: z.string().optional(),
  activePedigreeId: z.string(),
  harness: HarnessSchema,
  /** Typed release record, present on revisions frozen with schema v2+. */
  release: ReleaseSnapshotSchema.optional(),
  /** Untyped snapshot from schema v1 files (kept verbatim, read-only). */
  legacySnapshot: z.any().optional(),
});
export type Revision = z.infer<typeof RevisionSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  partNumber: z.string().default("HS-0001"),
  units: z.enum(["mm", "in"]).default("in"),
  settings: SettingsSchema.default({}),
  pedigreeScheme: PedigreeSchemeSchema,
  allowedPedigrees: z.array(z.string()).optional(),
  rulesets: z.array(RulesetSchema).default([]),
  projectRules: z.array(RuleInstanceSchema).default([]),
  overrides: z.array(RuleOverrideSchema).default([]),
  waivers: z.array(WaiverSchema).default([]),
  presets: z.array(FinishingPresetSchema).default([]),
  titleBlock: TitleBlockSchema.default({}),
  report: ReportTextSchema.default({}),
  quote: QuoteSettingsSchema,
  revisions: z.array(RevisionSchema).min(1),
  currentRevisionId: z.string(),
  catalogVersion: z.string().default(""),
  created: z.string(),
  updated: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectInput = z.input<typeof ProjectSchema>;

export class UnsupportedSchemaError extends Error {}

/**
 * Explicit schema migrations (feedback §2). Each step is a pure JSON transform; unknown/newer versions are
 * refused rather than reinterpreted, so loading never silently discards engineering information.
 */
export function migrateProject(json: unknown): { data: unknown; from: number; notes: string[] } {
  if (!json || typeof json !== "object") throw new UnsupportedSchemaError("Not a project file.");
  const src = json as Record<string, any>;
  const from = Number(src.schemaVersion);
  if (!Number.isInteger(from) || from < 1) throw new UnsupportedSchemaError(`Unknown schema version "${src.schemaVersion}".`);
  if (from > SCHEMA_VERSION) throw new UnsupportedSchemaError(`This file uses schema v${from}; this version of the tool reads up to v${SCHEMA_VERSION}. Update the tool to open it.`);
  const notes: string[] = [];
  let d: Record<string, any> = structuredClone(src);
  if (d.schemaVersion === 1) {
    // v1 → v2: untyped release snapshot kept as legacySnapshot; segment lengths of unknown provenance are "estimated".
    for (const r of d.revisions ?? []) {
      if (r.snapshot !== undefined) {
        r.legacySnapshot = r.snapshot;
        delete r.snapshot;
        notes.push(`Rev ${r.label}: release snapshot from schema v1 kept as a legacy (untyped) record.`);
      }
      for (const s of r.harness?.segments ?? []) if (s.lengthSource === undefined) s.lengthSource = "estimated";
    }
    d.schemaVersion = 2;
  }
  return { data: d, from, notes };
}

export function parseProject(json: unknown): Project {
  return ProjectSchema.parse(migrateProject(json).data);
}

/** Migrate + validate, reporting problems instead of throwing. */
export function safeParseProject(json: unknown): { ok: true; project: Project; notes: string[]; from: number } | { ok: false; error: string } {
  try {
    const m = migrateProject(json);
    const r = ProjectSchema.safeParse(m.data);
    if (!r.success) return { ok: false, error: r.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
    return { ok: true, project: r.data, notes: m.notes, from: m.from };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
