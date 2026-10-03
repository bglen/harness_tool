import { createElement } from "react";
import { pdf } from "@react-pdf/renderer";
import type { DrawingTemplate } from "@hs/model";
import { DrawingDocument } from "./drawing";
import { TemplateDrawingDocument } from "./templated";
import { ReportDocument, type Redaction, type SectionId } from "./report";
import type { DocData } from "./data";
import { MfgReportDocument } from "./mfgReport";
import { simulateBuild, type MfgOrder } from "./mfgSim";

export * from "./data";
export { registerFonts } from "./common";
export { REPORT_SECTIONS, autoSummary, type SectionId, type Redaction } from "./report";
export { drawingNotes } from "./drawing";

export { drawingTokenValues, planTemplatePages, flowGroups } from "./templated";
export { packFlow, type FlowItem, type FlowGroup } from "./flow";

/**
 * The drawing PDF. Uses the template embedded in the project (or the one passed in, e.g. a template being edited);
 * projects without one, and revisions released before templates existed, keep the classic layout.
 */
export async function renderDrawingPdf(data: DocData, template: DrawingTemplate | null = data.project.drawingTemplate): Promise<Blob> {
  const el = template ? createElement(TemplateDrawingDocument, { data, template }) : createElement(DrawingDocument, { data });
  return pdf(el as never).toBlob();
}

export async function renderReportPdf(data: DocData, opts: { sections?: Partial<Record<SectionId, boolean>>; hideQuote?: boolean; redact?: Redaction } = {}): Promise<Blob> {
  return pdf(createElement(ReportDocument, { data, ...opts }) as never).toBlob();
}

export { simulateBuild, DOC_TDP, type MfgOrder, type SimulatedBuild } from "./mfgSim";

/** Example post-manufacturing report (simulated lot record) for the design, a pedigree and an order. */
export async function renderMfgReportPdf(data: DocData, order: MfgOrder): Promise<Blob> {
  return pdf(createElement(MfgReportDocument, { data, sim: simulateBuild(data, order) }) as never).toBlob();
}
