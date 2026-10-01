import { z } from "zod";

/**
 * Drawing templates: the sheet format a harness drawing is generated into. A template is a set of sheets, each a
 * list of positioned blocks (title block, logo, text, harness views, notes, revision block, tables). Block
 * positions are fractions of the sheet so a template keeps its layout when the sheet size changes; font sizes are
 * in points. Templates live in a per-browser library and travel as .harnesstemplate.json files; a project
 * embeds a copy of the one it uses, so released drawings don't change when the library does.
 */

export const TEMPLATE_SCHEMA_VERSION = 1;

/** Landscape sheet sizes in points (1/72 in). */
export const SHEET_SIZES = {
  "ANSI A": [792, 612],
  "ANSI B": [1224, 792],
  "ANSI C": [1584, 1224],
  "ANSI D": [2448, 1584],
  "ISO A4": [842, 595],
  "ISO A3": [1191, 842],
  "ISO A2": [1684, 1191],
  "ISO A1": [2384, 1684],
} as const satisfies Record<string, readonly [number, number]>;
export type SheetSize = keyof typeof SHEET_SIZES;
const SheetSizeSchema = z.enum(Object.keys(SHEET_SIZES) as [SheetSize, ...SheetSize[]]);

export const BLOCK_KINDS = ["titleBlock", "logo", "text", "bundleView", "schematicView", "notes", "revisionBlock", "connectorTables", "wireList", "bom", "labels"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** Blocks whose content can run past their box; the overflow continues in the same box on extra pages. */
export const FLOW_KINDS: BlockKind[] = ["notes", "connectorTables", "wireList", "bom", "labels"];

export const TitleCellSchema = z.object({
  id: z.string(),
  /** Small caption above the value, e.g. "DRAWING NO." (empty for none). */
  label: z.string().default(""),
  /** Value with {tokens}, e.g. "{drawingNumber}"; "\n" starts a new line. */
  value: z.string().default(""),
  /** Relative width within the row. */
  flex: z.number().positive().default(1),
  size: z.number().positive().default(8),
  bold: z.boolean().default(true),
  mono: z.boolean().default(false),
});
export type TitleCell = z.infer<typeof TitleCellSchema>;

export const TitleRowSchema = z.object({
  id: z.string(),
  /** Relative height within the title block. */
  height: z.number().positive().default(1),
  cells: z.array(TitleCellSchema).min(1),
});
export type TitleRow = z.infer<typeof TitleRowSchema>;

export const TemplateBlockSchema = z.object({
  id: z.string(),
  kind: z.enum(BLOCK_KINDS),
  /** Position and size as fractions of the sheet (0..1, origin top-left). */
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  /** Heading drawn at the top of views, notes and tables ("" for none). */
  title: z.string().default(""),
  /** Text blocks: content with {tokens}. */
  text: z.string().default(""),
  fontSize: z.number().positive().default(8),
  bold: z.boolean().default(false),
  align: z.enum(["left", "center", "right"]).default("left"),
  /** Tables and notes: number of columns the content flows through. */
  columns: z.number().int().min(1).max(6).default(1),
  /** Views and text: draw a thin border around the block. */
  frame: z.boolean().default(false),
  /** Bundle view: segment length callouts. */
  showLengths: z.boolean().default(true),
  /** Title block rows. */
  rows: z.array(TitleRowSchema).default([]),
});
export type TemplateBlock = z.infer<typeof TemplateBlockSchema>;

export const TemplateSheetSchema = z.object({
  id: z.string(),
  name: z.string().default("Sheet"),
  blocks: z.array(TemplateBlockSchema).default([]),
});
export type TemplateSheet = z.infer<typeof TemplateSheetSchema>;

export const LogoSchema = z.object({
  /** PNG or JPEG data URL (SVG uploads are rasterized before storing). */
  dataUrl: z.string().regex(/^data:image\/(png|jpeg);base64,/, "Logo must be a PNG or JPEG data URL"),
  width: z.number().positive(),
  height: z.number().positive(),
  name: z.string().default(""),
});
export type Logo = z.infer<typeof LogoSchema>;

export const DrawingTemplateSchema = z.object({
  kind: z.literal("harness-drawing-template"),
  schemaVersion: z.literal(TEMPLATE_SCHEMA_VERSION),
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  sheetSize: SheetSizeSchema.default("ANSI B"),
  /** Border frame inset from the sheet edge (pt); 0 draws no frame. */
  marginPt: z.number().min(0).default(12),
  /** Zone letters/numbers around the frame. */
  zones: z.boolean().default(true),
  logo: LogoSchema.nullable().default(null),
  /** Company name used for {company} when the project doesn't set its own. */
  company: z.string().default(""),
  sheets: z.array(TemplateSheetSchema).min(1),
  updated: z.string().default(""),
});
export type DrawingTemplate = z.infer<typeof DrawingTemplateSchema>;
export type DrawingTemplateInput = z.input<typeof DrawingTemplateSchema>;

/** Largest accepted template file (a logo is the bulk of it). */
export const MAX_TEMPLATE_BYTES = 5_000_000;

export function parseDrawingTemplate(json: unknown): { ok: true; template: DrawingTemplate } | { ok: false; error: string } {
  if (!json || typeof json !== "object") return { ok: false, error: "Not a drawing template file." };
  const src = json as Record<string, unknown>;
  if (src.kind !== "harness-drawing-template") return { ok: false, error: "Not a drawing template file (expected kind “harness-drawing-template”)." };
  if (typeof src.schemaVersion === "number" && src.schemaVersion > TEMPLATE_SCHEMA_VERSION) return { ok: false, error: `This template uses format v${src.schemaVersion}; this version of the tool reads up to v${TEMPLATE_SCHEMA_VERSION}.` };
  const r = DrawingTemplateSchema.safeParse(json);
  if (!r.success) {
    const i = r.error.issues[0]!;
    return { ok: false, error: `${i.path.join(".") || "template"}: ${i.message}` };
  }
  return { ok: true, template: r.data };
}

/** Tokens available in title-block cells and text blocks, with what they show. */
export const DRAWING_TOKENS: { token: string; label: string }[] = [
  { token: "company", label: "Company" },
  { token: "title", label: "Drawing title" },
  { token: "drawingNumber", label: "Drawing number" },
  { token: "partNumber", label: "Harness part number" },
  { token: "rev", label: "Revision" },
  { token: "date", label: "Date" },
  { token: "status", label: "DRAFT / RELEASED" },
  { token: "units", label: "Units" },
  { token: "drawnBy", label: "Drawn by" },
  { token: "checkedBy", label: "Checked by" },
  { token: "approvedBy", label: "Approved by" },
  { token: "pedigree", label: "Pedigree" },
  { token: "tolerances", label: "Tolerances" },
  { token: "sheet", label: "Sheet number" },
  { token: "sheets", label: "Sheet count" },
  { token: "sheetName", label: "Sheet name" },
  { token: "designHash", label: "Design hash" },
  { token: "projectName", label: "Project name" },
  { token: "exportControl", label: "Export-control marking" },
];

/** Replace {tokens}; unknown tokens are left visible so typos show up on the drawing preview. */
export function resolveDrawingTokens(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k]! : m));
}

/** Keep a block on the sheet (positions are fractions, so a sheet-size change needs no rescaling). */
export function clampBlock<T extends Pick<TemplateBlock, "x" | "y" | "w" | "h">>(b: T): T {
  const w = Math.min(1, Math.max(0.01, b.w));
  const h = Math.min(1, Math.max(0.01, b.h));
  return { ...b, w, h, x: Math.min(1 - w, Math.max(0, b.x)), y: Math.min(1 - h, Math.max(0, b.y)) };
}
