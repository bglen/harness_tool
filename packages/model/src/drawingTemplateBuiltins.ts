import { DrawingTemplateSchema, TEMPLATE_SCHEMA_VERSION, type BlockKind, type DrawingTemplate, type DrawingTemplateInput, type TemplateBlock, type TitleRow } from "./drawingTemplate";

/** Title block rows matching the classic drawing's title block. Ids are prefixed so copies stay unique per block. */
export function defaultTitleRows(prefix = "tb"): TitleRow[] {
  const c = (id: string, label: string, value: string, flex = 1, more: Partial<TitleRow["cells"][number]> = {}) => ({ id: `${prefix}-${id}`, label, value, flex, size: 8, bold: true, mono: false, ...more });
  return [
    { id: `${prefix}-r1`, height: 1.35, cells: [c("co", "", "{company}\n{title}", 2, { size: 9 }), c("ped", "PEDIGREE", "{pedigree}", 1.1)] },
    { id: `${prefix}-r2`, height: 1, cells: [c("dwg", "DRAWING NO.", "{drawingNumber}", 1.4, { mono: true }), c("rev", "REV", "{rev}", 0.5, { mono: true }), c("date", "DATE", "{date}", 0.9), c("units", "UNITS", "{units}", 0.6)] },
    { id: `${prefix}-r3`, height: 1, cells: [c("drawn", "DRAWN", "{drawnBy}"), c("chk", "CHECKED", "{checkedBy}"), c("appr", "APPROVED", "{approvedBy}"), c("sheet", "SHEET", "{sheet} OF {sheets}")] },
    { id: `${prefix}-r4`, height: 0.75, cells: [c("tol", "", "TOLERANCES: {tolerances}. HARNESS PN {partNumber}. DESIGN HASH {designHash}.", 1, { size: 5.5, bold: false })] },
  ];
}

const DEFAULT_SIZE: Record<BlockKind, [number, number]> = {
  titleBlock: [0.37, 0.17],
  logo: [0.08, 0.1],
  text: [0.2, 0.04],
  bundleView: [0.5, 0.45],
  schematicView: [0.5, 0.45],
  notes: [0.28, 0.35],
  revisionBlock: [0.3, 0.1],
  connectorTables: [0.45, 0.4],
  wireList: [0.45, 0.3],
  bom: [0.45, 0.25],
  labels: [0.3, 0.2],
};

const DEFAULT_TITLE: Partial<Record<BlockKind, string>> = {
  notes: "NOTES",
  revisionBlock: "REVISIONS",
  connectorTables: "CONNECTORS",
  wireList: "WIRE LIST",
  bom: "BILL OF MATERIALS",
  labels: "LABELS",
};

export const BLOCK_LABELS: Record<BlockKind, string> = {
  titleBlock: "Title block",
  logo: "Logo",
  text: "Text",
  bundleView: "Bundle layout (formboard)",
  schematicView: "Schematic",
  notes: "Notes",
  revisionBlock: "Revision block",
  connectorTables: "Connector tables",
  wireList: "Wire list",
  bom: "Bill of materials",
  labels: "Labels",
};

/** A new block of the given kind with sensible defaults, centred at (cx, cy) on the sheet. */
export function newTemplateBlock(kind: BlockKind, id: string, at: { cx: number; cy: number } = { cx: 0.5, cy: 0.5 }, extra: Partial<TemplateBlock> = {}): TemplateBlock {
  const [w, h] = DEFAULT_SIZE[kind];
  return {
    id,
    kind,
    x: Math.min(1 - w, Math.max(0, at.cx - w / 2)),
    y: Math.min(1 - h, Math.max(0, at.cy - h / 2)),
    w,
    h,
    title: DEFAULT_TITLE[kind] ?? "",
    text: kind === "text" ? "{company}" : "",
    fontSize: kind === "text" ? 10 : 7,
    bold: kind === "text",
    align: "left",
    columns: 1,
    frame: kind === "logo",
    showLengths: true,
    rows: kind === "titleBlock" ? defaultTitleRows(`${id}-tb`) : [],
    ...extra,
  };
}

function tpl(t: Omit<DrawingTemplateInput, "kind" | "schemaVersion">): DrawingTemplate {
  return DrawingTemplateSchema.parse({ kind: "harness-drawing-template", schemaVersion: TEMPLATE_SCHEMA_VERSION, ...t });
}

/** Title block + logo in the bottom-right corner, shared by the built-ins. */
function corner(sheet: string): TemplateBlock[] {
  return [newTemplateBlock("titleBlock", `${sheet}-tb`, undefined, { x: 0.6, y: 0.8, w: 0.37, h: 0.17 }), newTemplateBlock("logo", `${sheet}-logo`, undefined, { x: 0.515, y: 0.8, w: 0.08, h: 0.17 })];
}

/** Starter templates. Read-only in the library: editing one saves a copy. */
export const BUILTIN_TEMPLATES: DrawingTemplate[] = [
  tpl({
    id: "builtin-standard-b",
    name: "Standard — ANSI B",
    description: "Assembly sheet (formboard, notes, revisions) and a tables sheet (connectors, wire list, BOM).",
    sheetSize: "ANSI B",
    sheets: [
      {
        id: "s1",
        name: "Assembly",
        blocks: [
          newTemplateBlock("bundleView", "s1-bundle", undefined, { x: 0.03, y: 0.045, w: 0.62, h: 0.73 }),
          newTemplateBlock("revisionBlock", "s1-rev", undefined, { x: 0.67, y: 0.03, w: 0.3, h: 0.12 }),
          newTemplateBlock("notes", "s1-notes", undefined, { x: 0.67, y: 0.17, w: 0.3, h: 0.6 }),
          ...corner("s1"),
        ],
      },
      {
        id: "s2",
        name: "Tables",
        blocks: [
          newTemplateBlock("connectorTables", "s2-conn", undefined, { x: 0.03, y: 0.035, w: 0.46, h: 0.745, columns: 2 }),
          newTemplateBlock("wireList", "s2-wires", undefined, { x: 0.51, y: 0.035, w: 0.46, h: 0.33 }),
          newTemplateBlock("bom", "s2-bom", undefined, { x: 0.51, y: 0.38, w: 0.46, h: 0.4 }),
          ...corner("s2"),
        ],
      },
    ],
  }),
  tpl({
    id: "builtin-schematic-d",
    name: "Schematic + formboard — ANSI D",
    description: "Formboard sheet, a full schematic sheet and a tables sheet on ANSI D.",
    sheetSize: "ANSI D",
    sheets: [
      {
        id: "s1",
        name: "Formboard",
        blocks: [
          newTemplateBlock("bundleView", "s1-bundle", undefined, { x: 0.03, y: 0.045, w: 0.66, h: 0.73 }),
          newTemplateBlock("revisionBlock", "s1-rev", undefined, { x: 0.71, y: 0.03, w: 0.26, h: 0.1 }),
          newTemplateBlock("notes", "s1-notes", undefined, { x: 0.71, y: 0.15, w: 0.26, h: 0.62, fontSize: 8 }),
          ...corner("s1"),
        ],
      },
      {
        id: "s2",
        name: "Schematic",
        blocks: [newTemplateBlock("schematicView", "s2-sch", undefined, { x: 0.03, y: 0.035, w: 0.94, h: 0.745, title: "SCHEMATIC" }), ...corner("s2")],
      },
      {
        id: "s3",
        name: "Tables",
        blocks: [
          newTemplateBlock("connectorTables", "s3-conn", undefined, { x: 0.03, y: 0.035, w: 0.55, h: 0.745, columns: 3 }),
          newTemplateBlock("wireList", "s3-wires", undefined, { x: 0.6, y: 0.035, w: 0.37, h: 0.43 }),
          newTemplateBlock("bom", "s3-bom", undefined, { x: 0.6, y: 0.48, w: 0.37, h: 0.3 }),
          ...corner("s3"),
        ],
      },
    ],
  }),
];

export function isBuiltinTemplate(id: string): boolean {
  return BUILTIN_TEMPLATES.some((t) => t.id === id);
}
